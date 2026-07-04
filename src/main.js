import { KaneViewer } from './kane-viewer.js';
import { KaneAnimator } from './kane-animator.js';
import { KaneEngine } from './kane-engine.js';
import { KaneVoice } from './kane-voice.js';
import { mountKaneUI } from './kane-ui.js';
import { KaneTelemetry } from './kane-telemetry.js';
import { KaneDecisionEngine } from './kane-decision.js';

const statusEl = document.getElementById('kane-status');
const setStatus = (msg) => { statusEl.textContent = msg; };

const stage = document.getElementById('kane-stage');
const viewer = new KaneViewer(stage, { onStatus: setStatus });

const params = new URLSearchParams(location.search);
const modelUrl = params.get('model');
if (modelUrl) viewer.loadModel(modelUrl);
else viewer.usePlaceholder();

const animator = new KaneAnimator(viewer);
const engine = new KaneEngine({ backendUrl: params.get('backend') || 'http://127.0.0.1:8787' });
const voice = new KaneVoice({ onMouthLevel: (l) => animator.setMouthLevel(l) });
const telemetry = new KaneTelemetry();

const ui = mountKaneUI({
  onSend: handleUserMessage,
  onMicToggle: (active) => {
    if (active) {
      if (!voice.supportsSTT()) { setStatus('speech recognition needs Chrome/Edge'); return; }
      ui.setMicActive(true);
      animator.setState('idle');
      voice.startListening({
        onResult: (text) => ui.setInputValue(text),
        onEnd: (finalText) => {
          ui.setMicActive(false);
          ui.setInputValue('');
          if (finalText) handleUserMessage(finalText);
        },
      });
    } else {
      voice.stopListening();
    }
  },
});

// Local models sometimes answer in markdown; captions are spoken aloud, so strip formatting.
function stripMarkdown(text) {
  return text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/[*_`]/g, '').replace(/^#{1,6}\s*/gm, '').trim();
}

/** Speaks + animates a reply, whether it came from a direct question or a proactive nudge. */
function presentReply({ reply }) {
  const clean = stripMarkdown(reply);
  setStatus('speaking…');
  ui.setCaption(clean);
  animator.setState('talking');
  decision.setPaused(true);
  voice.speak(clean, {
    onEnd: () => {
      animator.setState('idle');
      setStatus('ready');
      ui.setCaption('');
      decision.setPaused(false);
    },
  });
}

async function handleUserMessage(text) {
  ui.setCaption('');
  setStatus('thinking…');
  animator.setState('thinking');
  decision.setPaused(true);
  try {
    const result = await engine.send(text);
    presentReply(result);
  } catch (err) {
    decision.setPaused(false);
    animator.setState('idle');
    setStatus('error');
    ui.setCaption(err.message);
  }
}

const decision = new KaneDecisionEngine({
  telemetry, engine,
  onNudge: (result) => presentReply(result),
});

// Public API for host apps: <script> loads this, then calls window.Kane.notify(...)
// to describe screens, flows, and progress so the decision layer can react.
window.Kane = {
  viewer, animator, engine, voice, ui, telemetry, decision,
  notify: (type, payload) => telemetry.notify(type, payload),
};
