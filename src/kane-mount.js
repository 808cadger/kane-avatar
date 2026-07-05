import { KaneViewer } from './kane-viewer.js';
import { KaneAnimator } from './kane-animator.js';
import { KaneEngine } from './kane-engine.js';
import { KaneVoice } from './kane-voice.js';
import { KaneTelemetry } from './kane-telemetry.js';
import { KaneDecisionEngine } from './kane-decision.js';

const STYLE_ID = 'kane-styles';

const CSS = `
#kane-root { position: fixed; z-index: 2147483000; font-family: system-ui, sans-serif; }
#kane-root.mode-fullpage { inset: 0; }
#kane-root.mode-corner { width: 220px; height: 320px; }
#kane-root.mode-corner.pos-bottom-right { right: 18px; bottom: 18px; }
#kane-root.mode-corner.pos-bottom-left { left: 18px; bottom: 18px; }
#kane-root.mode-corner.pos-top-right { right: 18px; top: 18px; }
#kane-root.mode-corner.pos-top-left { left: 18px; top: 18px; }
#kane-root .kane-stage { position: absolute; inset: 0; }
#kane-root.mode-corner .kane-stage { pointer-events: none; }
#kane-root .kane-stage canvas { display: block; }
#kane-root .kane-hud {
  position: absolute; top: 16px; left: 16px; font: 12px/1.4 system-ui, sans-serif;
  color: #8a8aa8; letter-spacing: 1px; text-transform: uppercase; pointer-events: none;
}
#kane-root.mode-corner .kane-hud { display: none; }
#kane-root .kane-debug-status {
  position: absolute; bottom: 4px; left: 4px; font: 11px system-ui, sans-serif; color: #6a6a88;
  pointer-events: none;
}
#kane-root.mode-corner .kane-debug-status { display: none; }

#kane-root .kane-bar {
  position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%);
  width: min(560px, 92vw); display: flex; flex-direction: column; align-items: center; gap: 10px;
}
#kane-root.mode-corner .kane-bar { bottom: 4px; width: 100%; gap: 4px; }
#kane-root .kane-caption {
  max-width: 100%; text-align: center; color: #f0f0fa; pointer-events: none;
  font: 15px/1.5 system-ui, sans-serif; text-shadow: 0 2px 12px rgba(0,0,0,.8);
  opacity: 0; transform: translateY(6px); transition: opacity .25s ease, transform .25s ease;
}
#kane-root.mode-corner .kane-caption {
  font-size: 12px; background: rgba(10,10,18,.72); border-radius: 10px; padding: 6px 10px;
}
#kane-root .kane-caption.visible { opacity: 1; transform: translateY(0); }
#kane-root .kane-inputrow {
  width: 100%; display: flex; align-items: center; gap: 8px; pointer-events: auto;
  background: rgba(20,20,32,.72); backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,.08); border-radius: 26px; padding: 6px 8px;
}
#kane-root.mode-corner .kane-inputrow { border-radius: 16px; padding: 4px 6px; }
#kane-root .kane-mic {
  width: 38px; height: 38px; border-radius: 50%; border: none; flex-shrink: 0;
  background: rgba(255,255,255,.08); color: #cfcfe6; font-size: 15px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; transition: background .15s;
}
#kane-root.mode-corner .kane-mic { width: 28px; height: 28px; font-size: 12px; }
#kane-root .kane-mic.active { background: #ff4444; color: #fff; }
#kane-root .kane-input {
  flex: 1; min-width: 0; background: transparent; border: none; outline: none;
  color: #f0f0fa; font: 14px system-ui, sans-serif; padding: 8px 4px;
}
#kane-root.mode-corner .kane-input { font-size: 12px; padding: 4px; }
#kane-root .kane-input::placeholder { color: #6a6a88; }
#kane-root .kane-send {
  width: 38px; height: 38px; border-radius: 50%; border: none; flex-shrink: 0;
  background: #6c63ff; color: #fff; font-size: 15px; cursor: pointer;
}
#kane-root.mode-corner .kane-send { width: 28px; height: 28px; font-size: 12px; }
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function buildDom(mode, position) {
  const root = document.createElement('div');
  root.id = 'kane-root';
  root.className = `mode-${mode} pos-${position}`;
  root.innerHTML = `
    <div class="kane-stage"></div>
    <div class="kane-hud">Kane · AI Companion</div>
    <div class="kane-debug-status">loading…</div>
    <div class="kane-bar">
      <div class="kane-caption"></div>
      <div class="kane-inputrow">
        <button class="kane-mic" title="Hold to speak">🎤</button>
        <input class="kane-input" type="text" placeholder="Ask Kane anything…" autocomplete="off" />
        <button class="kane-send" title="Send">➤</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

function stripMarkdown(text) {
  return text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/[*_`]/g, '').replace(/^#{1,6}\s*/gm, '').trim();
}

/**
 * Mounts Kane into the current page. This is the whole embedding contract:
 * one call (or the auto-run embed.js entry) gives a host app a live avatar,
 * a chat surface, and window.Kane.notify(...) for telemetry — no host markup required.
 *
 * @param {object} opts
 * @param {'fullpage'|'corner'} [opts.mode='corner']
 * @param {'bottom-right'|'bottom-left'|'top-right'|'top-left'} [opts.position='bottom-right'] - corner mode only; use when Kane's default spot collides with host page content
 * @param {string} opts.backendUrl
 * @param {string} [opts.modelUrl] - glTF/GLB URL; falls back to a placeholder avatar if omitted
 */
export function mountKane({ mode = 'corner', position = 'bottom-right', backendUrl, modelUrl } = {}) {
  injectStyles();
  const root = buildDom(mode, position);

  const stage = root.querySelector('.kane-stage');
  const statusEl = root.querySelector('.kane-debug-status');
  const captionEl = root.querySelector('.kane-caption');
  const inputEl = root.querySelector('.kane-input');
  const micEl = root.querySelector('.kane-mic');
  const sendEl = root.querySelector('.kane-send');

  const setStatus = (msg) => { statusEl.textContent = msg; };
  const setCaption = (text) => {
    captionEl.textContent = text || '';
    captionEl.classList.toggle('visible', !!text);
  };

  const fullpage = mode === 'fullpage';
  const viewer = new KaneViewer(stage, { onStatus: setStatus, transparent: !fullpage, showFloor: fullpage });
  if (modelUrl) viewer.loadModel(modelUrl);
  else viewer.usePlaceholder();

  const animator = new KaneAnimator(viewer);
  const engine = new KaneEngine({ backendUrl });
  const voice = new KaneVoice({ onViseme: (name, weight) => animator.setViseme(name, weight) });
  const telemetry = new KaneTelemetry();

  function presentReply({ reply, highlight }) {
    const clean = stripMarkdown(reply);
    // Ignore any name the LLM didn't copy exactly from the manifest we gave it —
    // Python's registry lookup already guards this too, but failing silently
    // client-side as well means a bad name never even reaches the bridge call.
    if (highlight && window.kaneBridge && window.kaneHighlightableElements?.some((e) => e.name === highlight)) {
      window.kaneBridge.highlight_element(highlight);
    }
    setStatus('speaking…');
    setCaption(clean);
    animator.setState('talking');
    decision.setPaused(true);
    voice.speak(clean, {
      onEnd: () => {
        animator.setState('idle');
        setStatus('ready');
        setCaption('');
        decision.setPaused(false);
      },
    });
  }

  async function handleUserMessage(text) {
    setCaption('');
    setStatus('thinking…');
    animator.setState('thinking');
    decision.setPaused(true);
    try {
      presentReply(await engine.send(text, undefined, window.kaneHighlightableElements));
    } catch (err) {
      decision.setPaused(false);
      animator.setState('idle');
      setStatus('error');
      setCaption(err.message);
    }
  }

  const decision = new KaneDecisionEngine({ telemetry, engine, onNudge: presentReply });

  const doSend = () => {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    handleUserMessage(text);
  };
  sendEl.addEventListener('click', doSend);
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });

  let held = false;
  const startMic = (e) => {
    e.preventDefault();
    if (!voice.supportsSTT()) { setStatus('speech recognition needs Chrome/Edge'); return; }
    held = true;
    micEl.classList.add('active');
    animator.setState('idle');
    voice.startListening({
      onResult: (text) => { inputEl.value = text; },
      onEnd: (finalText) => {
        micEl.classList.remove('active');
        inputEl.value = '';
        if (finalText) handleUserMessage(finalText);
      },
    });
  };
  const stopMic = () => { if (held) { held = false; voice.stopListening(); } };
  micEl.addEventListener('mousedown', startMic);
  micEl.addEventListener('touchstart', startMic, { passive: false });
  micEl.addEventListener('mouseup', stopMic);
  micEl.addEventListener('mouseleave', stopMic);
  micEl.addEventListener('touchend', stopMic);

  return {
    root, viewer, animator, engine, voice, telemetry, decision,
    notify: (type, payload) => telemetry.notify(type, payload),
  };
}
