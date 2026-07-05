import { mountKane } from './kane-mount.js';

// The single embedding contract for host apps:
//   <script src="kane.js" data-backend="https://your-kane-backend" data-mode="corner"></script>
// No host markup, no bundler, no other setup required.
(function () {
  const script = document.currentScript;
  const ds = script ? script.dataset : {};

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(() => {
    const container = ds.container ? document.getElementById(ds.container) : undefined;
    window.Kane = mountKane({
      mode: ds.mode || (container ? 'inline' : 'corner'),
      position: ds.position || 'bottom-right',
      container,
      chatUI: ds.chatUi !== 'false',
      backendUrl: ds.backend || 'http://127.0.0.1:8787',
      modelUrl: ds.model || undefined,
    });
  });
})();
