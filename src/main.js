import { mountKane } from './kane-mount.js';
import { connectQtBridge } from './kane-qt-bridge.js';

const params = new URLSearchParams(location.search);

window.Kane = mountKane({
  mode: params.get('mode') || 'fullpage',
  backendUrl: params.get('backend') || 'http://127.0.0.1:8787',
  // Avaturn T2 export — full ARKit blendshapes (visemes, blink, brows) + LeftEye/RightEye
  // bones for gaze tracking. Override with ?model=<url> for anything else.
  modelUrl: params.get('model') || '/kane-avatar.glb',
});

// No-op outside a QWebEngineView host (window.qt is only present there).
connectQtBridge();
