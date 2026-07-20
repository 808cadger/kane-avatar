// Oculus/ARKit 15-shape viseme set — matches the `viseme_*` morph names Avaturn T2 uses.
const VISEME_KEYS = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'];
// Open vowels drive near-full amplitude; closed/narrow consonant shapes (lips together
// for PP, tongue-constricted for kk/CH/SS/nn) look distorted at full blend — the shape
// itself already encodes how open the mouth should be, so don't force it wide open too.
const VISEME_AMPLITUDE = {
  sil: 0, aa: 1, E: 0.9, I: 0.8, O: 0.95, U: 0.85,
  PP: 0.55, FF: 0.6, TH: 0.55, DD: 0.55, kk: 0.55, CH: 0.55, SS: 0.5, nn: 0.5, RR: 0.6,
};
// VRM only has these 5 viseme-like expression presets (no per-consonant shapes).
const VRM_EXPRESSION_FOR_VISEME = { aa: 'aa', I: 'ih', U: 'ou', E: 'ee', O: 'oh' };

/**
 * Drives idle motion, gaze/head tracking, blinking, and viseme-driven lip sync
 * on top of a KaneViewer's loaded model. Works against either a real glTF avatar
 * (using morph targets / named bones) or the placeholder stand-in.
 */
export class KaneAnimator {
  constructor(viewer) {
    this.viewer = viewer;
    this.pointer = { x: 0, y: 0 }; // normalized -1..1
    this.visemeTarget = { name: 'sil', weight: 0 };
    this.visemeWeights = {};
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

  /** Set the current target mouth shape, e.g. from KaneVoice's per-word viseme timeline. */
  setViseme(name, weight) { this.visemeTarget = { name, weight: Math.max(0, Math.min(1, weight)) }; }

  /** 'idle' | 'thinking' | 'talking' — drives subtle posture cues beyond mouth/blink/gaze. */
  setState(state) { this.state = state; }

  update(dt) {
    this.idleT += dt;
    this._updateBlink(dt);
    this._updateGazeAndIdle();
    this._updateMouth(dt);
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
      const rest = this.viewer.boneRest?.head;
      head.rotation.y = (rest?.y || 0) + this.pointer.x * 0.35 + sway + thinkTilt;
      head.rotation.x = (rest?.x || 0) - this.pointer.y * 0.2 + breathe;
    } else if (this.viewer.root?.userData.isPlaceholder) {
      const { head: h } = this.viewer.root.userData.parts;
      h.rotation.y = this.pointer.x * 0.35 + sway + thinkTilt;
      h.rotation.x = -this.pointer.y * 0.2 + breathe;
    }

    const spine = this.viewer.bones?.spine;
    if (spine) {
      const spineRest = this.viewer.boneRest?.spine;
      spine.rotation.x = (spineRest?.x || 0) + breathe * 1.5;
      spine.rotation.z = (spineRest?.z || 0) + sway * 0.4;
    }

    if (this.viewer.root && !head) {
      this.viewer.root.position.y = breathe * 0.3;
    }
  }

  _updateMouth(dt) {
    const { name, weight } = this.visemeTarget;
    const hasVisemeShapes = (this.viewer.morphMeshes || []).some(
      (m) => m.morphTargetDictionary.viseme_aa !== undefined
    );
    let openness = 0;
    let wrote = false;
    for (const key of VISEME_KEYS) {
      const target = key === name ? weight * (VISEME_AMPLITUDE[key] ?? 1) : 0;
      const current = this.visemeWeights[key] || 0;
      // Fast attack into a shape, slower release — reads as co-articulated speech
      // instead of the mouth snapping open/shut on every viseme change.
      const rate = target > current ? 18 : 8;
      const next = current + (target - current) * Math.min(1, dt * rate);
      this.visemeWeights[key] = next;
      if (key !== 'sil') openness = Math.max(openness, next);

      const vrmName = VRM_EXPRESSION_FOR_VISEME[key];
      if (vrmName) wrote = this._setExpression(vrmName, next) || wrote;
      wrote = this._setMorph(`viseme_${key}`, next) || wrote;
    }
    // Only drive the generic open/close shapes as a fallback for models that lack
    // full per-phoneme visemes — on a model that has both (like this one), forcing
    // jawOpen/mouthOpen on top of e.g. viseme_PP's closed-lips shape fights it and
    // produces a distorted, over-wide mouth on every syllable.
    if (!hasVisemeShapes) {
      wrote = this._setMorph('mouthOpen', openness) || wrote;
      wrote = this._setMorph('jawOpen', openness * 0.6) || wrote;
    }

    if (!wrote && this.viewer.root?.userData.isPlaceholder) {
      const { mouth } = this.viewer.root.userData.parts;
      mouth.scale.y = 1 + openness * 6;
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
