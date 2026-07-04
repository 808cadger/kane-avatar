import { mountKane } from './kane-mount.js';

const params = new URLSearchParams(location.search);

window.Kane = mountKane({
  mode: params.get('mode') || 'fullpage',
  backendUrl: params.get('backend') || 'http://127.0.0.1:8787',
  modelUrl: params.get('model') || undefined,
});
