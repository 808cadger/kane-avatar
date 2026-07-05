import { mountKane } from './kane-mount.js';
import { connectQtBridge } from './kane-qt-bridge.js';

const params = new URLSearchParams(location.search);

window.Kane = mountKane({
  mode: params.get('mode') || 'fullpage',
  backendUrl: params.get('backend') || 'http://127.0.0.1:8787',
  // VRM (VRoid's official AvatarSample_B, female) — full humanoid rig + standard
  // expression presets (visemes/blink/emotions), used via kane-viewer.js's VRM path
  // instead of the raw-glTF morph-name search. Override with ?model=<url> for anything
  // else; the earlier Avaturn T2 male model is still at /kane-avatar.glb if needed.
  modelUrl: params.get('model') || '/kane-avatar-female.vrm',
});

// No-op outside a QWebEngineView host (window.qt is only present there).
connectQtBridge();
