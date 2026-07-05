/**
 * Drives idle motion, gaze/head tracking, blinking, and audio-reactive lip sync
 * on top of a KaneViewer's loaded model. Works against either a real glTF avatar
 * (using morph targets / named bones) or the placeholder stand-in.
 */
export class KaneAnimator {
  constructor(viewer) {
    this.viewer = viewer;
    this.pointer = { x: 0, y: 0 }; // normalized -1..1
    this.mouthLevel = 0;
    this.blinkTimer = randomBlinkDelay();
    this.blinkPhase = 0; // 0 = open, ramps to 1 (closed) and back
    this.idleT = 0;
    this.state = 'idle'; // 'idle' | 'thinking' | 'talking'

    window.addEventListener('pointermove', (e) => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    });

    viewer.onFrame((dt) => this.update(dt));
  }

  /** Feed 0..1 mouth-open energy, e.g. from a TTS audio analyser. */
  setMouthLevel(level) { this.mouthLevel = Math.max(0, Math.min(1, level)); }

  /** 'idle' | 'thinking' | 'talking' — drives subtle posture cues beyond mouth/blink/gaze. */
  setState(state) { this.state = state; }

  update(dt) {
    this.idleT += dt;
    this._updateBlink(dt);
    this._updateGazeAndIdle();
    this._updateMouth();
  }

  _updateBlink(dt) {
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkPhase === 0) {
      this.blinkPhase = 0.0001; // trigger a blink cycle
    }
    if (this.blinkPhase > 0) {
      this.blinkPhase += dt / 0.09; // ~90ms half-cycle
      if (this.blinkPhase >= 2) {
        this.blinkPhase = 0;
        this.blinkTimer = randomBlinkDelay();
      }
    }
    const closed = this.blinkPhase === 0 ? 0
      : this.blinkPhase <= 1 ? this.blinkPhase
      : 2 - this.blinkPhase;

    const vrmHandled = this._setExpression('blink', closed);
    if (!vrmHandled) {
      this._setMorph('eyeBlinkLeft', closed);
      this._setMorph('eyeBlinkRight', closed);
      this._setMorph('eyesClosed', closed);
    }

    if (this.viewer.root?.userData.isPlaceholder) {
      const { eyeL, eyeR } = this.viewer.root.userData.parts;
      const s = 1 - closed * 0.9;
      eyeL.scale.y = s; eyeR.scale.y = s;
    }
  }

  _updateGazeAndIdle() {
    const breathe = Math.sin(this.idleT * 1.4) * 0.01;
    const sway = Math.sin(this.idleT * 0.7) * 0.015;

    const thinkTilt = this.state === 'thinking' ? Math.sin(this.idleT * 2.2) * 0.06 - 0.08 : 0;
    const head = this.viewer.bones?.head;
    if (head) {
      head.rotation.y = this.pointer.x * 0.35 + sway + thinkTilt;
      head.rotation.x = -this.pointer.y * 0.2 + breathe;
    } else if (this.viewer.root?.userData.isPlaceholder) {
      const { head: h } = this.viewer.root.userData.parts;
      h.rotation.y = this.pointer.x * 0.35 + sway + thinkTilt;
      h.rotation.x = -this.pointer.y * 0.2 + breathe;
    }

    if (this.viewer.root && !head) {
      this.viewer.root.position.y = breathe * 0.3;
    }
  }

  _updateMouth() {
    const v = this.mouthLevel;
    // 'aa' is VRM's open-mouth "ah" viseme — a reasonable single-viseme stand-in for
    // generic audio-energy-driven lip sync, same approach as mouthOpen/jawOpen below.
    const wrote = this._setExpression('aa', v) | this._setMorph('mouthOpen', v) | this._setMorph('jawOpen', v);
    if (!wrote && this.viewer.root?.userData.isPlaceholder) {
      const { mouth } = this.viewer.root.userData.parts;
      mouth.scale.y = 1 + v * 6;
    }
  }

  /** Sets a named morph target influence across all morph meshes that have it. Returns true if any mesh had it. */
  _setMorph(name, value) {
    let found = false;
    for (const mesh of this.viewer.morphMeshes || []) {
      const idx = mesh.morphTargetDictionary[name];
      if (idx !== undefined) {
        mesh.morphTargetInfluences[idx] = value;
        found = true;
      }
    }
    return found;
  }

  /** Sets a VRM expression preset by name (e.g. 'blink', 'aa'). Returns true if this is a VRM model. */
  _setExpression(name, value) {
    const manager = this.viewer.vrm?.expressionManager;
    if (!manager) return false;
    manager.setValue(name, value);
    return true;
  }
}

function randomBlinkDelay() { return 2.5 + Math.random() * 4; }
