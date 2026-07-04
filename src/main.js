import { KaneViewer } from './kane-viewer.js';
import { KaneAnimator } from './kane-animator.js';

const statusEl = document.getElementById('kane-status');
const setStatus = (msg) => { statusEl.textContent = msg; };

const stage = document.getElementById('kane-stage');
const viewer = new KaneViewer(stage, { onStatus: setStatus });

// Until a real Ready Player Me .glb is provided, show the placeholder stand-in
// so the pipeline (lighting, gaze, blink, lip sync) is fully testable.
const params = new URLSearchParams(location.search);
const modelUrl = params.get('model');

if (modelUrl) {
  viewer.loadModel(modelUrl);
} else {
  viewer.usePlaceholder();
}

const animator = new KaneAnimator(viewer);

// Temporary manual test hook: open devtools and call Kane.testTalk() to see
// the mouth react without needing TTS wired up yet.
window.Kane = {
  viewer, animator,
  testTalk(seconds = 3) {
    const start = performance.now();
    const step = () => {
      const t = (performance.now() - start) / 1000;
      if (t > seconds) { animator.setMouthLevel(0); return; }
      animator.setMouthLevel(0.3 + Math.random() * 0.7);
      requestAnimationFrame(step);
    };
    step();
  },
};
