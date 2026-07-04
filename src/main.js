import { KaneViewer } from './kane-viewer.js';
import { KaneAnimator } from './kane-animator.js';
import { KaneEngine } from './kane-engine.js';
import { KaneVoice } from './kane-voice.js';
import { mountKaneUI } from './kane-ui.js';

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

async function handleUserMessage(text) {
  ui.setCaption('');
  setStatus('thinking…');
  animator.setState('thinking');
  try {
    const { reply } = await engine.send(text);
    setStatus('speaking…');
    ui.setCaption(reply);
    animator.setState('talking');
    voice.speak(reply, {
      onEnd: () => { animator.setState('idle'); setStatus('ready'); ui.setCaption(''); },
    });
  } catch (err) {
    animator.setState('idle');
    setStatus('error');
    ui.setCaption(err.message);
  }
}

// Manual test hooks for the console.
window.Kane = { viewer, animator, engine, voice, ui };
