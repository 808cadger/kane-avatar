import { mountKane } from './kane-mount.js';
import { connectQtBridge } from './kane-qt-bridge.js';

const params = new URLSearchParams(location.search);

window.Kane = mountKane({
  mode: params.get('mode') || 'fullpage',
  backendUrl: params.get('backend') || 'http://127.0.0.1:8787',
  // Raw-glTF export of the "Modern Tarzan" character asset (Blender/Auto-Rig Pro,
  // posed to a relaxed stand via kane-avatar's Blender pipeline — no facial shape
  // keys, so blink/lip-sync stay on the generic fallback). Override with ?model=<url>
  // for anything else, e.g. a VRM (uses kane-viewer.js's VRM path instead).
  modelUrl: params.get('model') || '/kane-tarzan.glb',
});

// No-op outside a QWebEngineView host (window.qt is only present there).
connectQtBridge();
