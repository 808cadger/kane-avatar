/** Minimal caption-style overlay: Kane's speech appears as a subtitle, no chat-log clutter over the avatar. */
export function mountKaneUI({ onSend, onMicToggle }) {
  const bar = document.createElement('div');
  bar.id = 'kane-bar';
  bar.innerHTML = `
    <div id="kane-caption"></div>
    <div id="kane-inputrow">
      <button id="kane-mic" title="Hold to speak">🎤</button>
      <input id="kane-input" type="text" placeholder="Ask Kane anything…" autocomplete="off" />
      <button id="kane-send" title="Send">➤</button>
    </div>
  `;
  document.body.appendChild(bar);

  const input = bar.querySelector('#kane-input');
  const sendBtn = bar.querySelector('#kane-send');
  const mic = bar.querySelector('#kane-mic');
  const caption = bar.querySelector('#kane-caption');

  const doSend = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    onSend(text);
  };
  sendBtn.addEventListener('click', doSend);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });

  let held = false;
  const start = (e) => { e.preventDefault(); held = true; onMicToggle(true); };
  const stop = () => { if (held) { held = false; onMicToggle(false); } };
  mic.addEventListener('mousedown', start);
  mic.addEventListener('touchstart', start, { passive: false });
  mic.addEventListener('mouseup', stop);
  mic.addEventListener('mouseleave', stop);
  mic.addEventListener('touchend', stop);

  let captionTimer = null;
  return {
    setCaption(text) {
      clearTimeout(captionTimer);
      caption.textContent = text || '';
      caption.classList.toggle('visible', !!text);
    },
    setMicActive(active) { mic.classList.toggle('active', active); },
    setInputValue(v) { input.value = v; },
  };
}
