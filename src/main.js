import { mountKane } from './kane-mount.js';

const params = new URLSearchParams(location.search);

window.Kane = mountKane({
  mode: params.get('mode') || 'fullpage',
  backendUrl: params.get('backend') || 'http://127.0.0.1:8787',
  // Avaturn T1 export (static face, no blendshapes) — a real placeholder until a T2
  // re-export or a VRM model is available. Override with ?model=<url> for anything else.
  modelUrl: params.get('model') || '/kane-avatar.glb',
});
