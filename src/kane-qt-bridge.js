/**
 * Bridges Kane's web frontend to a native host embedding it via Qt's
 * QWebEngineView + QWebChannel (e.g. IT_Manager's desktop app). No-op in a
 * normal browser — `window.qt.webChannelTransport` only exists inside Qt's
 * embedded Chromium once the host registers a QWebChannel on the page.
 */
export function connectQtBridge() {
  if (!window.qt || !window.qt.webChannelTransport) return;

  const script = document.createElement('script');
  script.src = 'qrc:///qtwebchannel/qwebchannel.js';
  script.onload = () => {
    new QWebChannel(window.qt.webChannelTransport, (channel) => {
      window.kaneBridge = channel.objects.kaneBridge;
      // Pulled once at connect time, not pushed — the registry is small/static enough
      // that a live-update channel isn't worth the complexity yet.
      window.kaneBridge.get_highlightable_elements((json) => {
        window.kaneHighlightableElements = JSON.parse(json);
      });
      addDebugHighlightButton();
    });
  };
  document.head.appendChild(script);
}

// Phase-1/2 scaffold: proves the JS -> Qt -> Python(registry) -> overlay round trip
// works at all, ahead of the real LLM `[[highlight:name]]` marker protocol (a later
// phase). Two targets on different tabs, so this also proves the registry's
// auto-tab-switch behavior, not just a same-tab highlight. Remove once real
// marker-driven highlighting lands.
function addDebugHighlightButton() {
  const bar = document.querySelector('#kane-root .kane-bar');
  if (!bar) return;
  const targets = [
    ['settings_apply_btn', '⚡ Debug: Apply Profile (Settings tab)'],
    ['permissions_revoke_btn', '⚡ Debug: Revoke Selected (Permissions tab)'],
  ];
  for (const [name, text] of targets) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.title = 'Debug scaffold for the Qt bridge/registry — not the real guidance feature yet';
    btn.style.cssText =
      'margin-top:6px; font: 11px system-ui, sans-serif; padding:4px 10px; border-radius:8px; ' +
      'border:1px dashed #f59e0b; background:rgba(245,158,11,.15); color:#f59e0b; ' +
      'cursor:pointer; pointer-events:auto; display:block; width:100%;';
    btn.addEventListener('click', () => window.kaneBridge.highlight_element(name));
    bar.appendChild(btn);
  }
}
