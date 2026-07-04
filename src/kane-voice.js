/**
 * Browser-native speech in/out — zero API keys, zero cost. Swap in a cloud
 * TTS/STT provider later without touching callers (same speak/startListening surface).
 */
export class KaneVoice {
  constructor({ onMouthLevel, onListeningChange } = {}) {
    this.onMouthLevel = onMouthLevel || (() => {});
    this.onListeningChange = onListeningChange || (() => {});
    this.enabled = true;
    this._talkInterval = null;
    this.recognition = null;
  }

  speak(text, { onStart, onEnd } = {}) {
    if (!this.enabled || !text) { onEnd?.(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const pref = voices.find((v) => v.lang.startsWith('en') && v.localService)
      || voices.find((v) => v.lang.startsWith('en'));
    if (pref) u.voice = pref;
    u.rate = 1.0; u.pitch = 1.0;
    u.onstart = () => { onStart?.(); this._startFakeLipSync(); };
    u.onend = u.onerror = () => { this._stopFakeLipSync(); onEnd?.(); };
    window.speechSynthesis.speak(u);
  }

  _startFakeLipSync() {
    let m = 0;
    clearInterval(this._talkInterval);
    this._talkInterval = setInterval(() => {
      m = (m + 1) % 4;
      this.onMouthLevel([0, 0.7, 1, 0.4][m]);
    }, 110);
  }

  _stopFakeLipSync() {
    clearInterval(this._talkInterval);
    this.onMouthLevel(0);
  }

  supportsSTT() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }

  /** Starts continuous recognition; onResult fires with interim+final text, onEnd fires once with the final transcript. */
  startListening({ onResult, onEnd } = {}) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;
    window.speechSynthesis.cancel();
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = 'en-US';
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      onResult?.((finalText + interim).trim());
    };
    const finish = () => { this.onListeningChange(false); onEnd?.(finalText.trim()); };
    r.onend = finish;
    r.onerror = finish;
    this.recognition = r;
    this.onListeningChange(true);
    r.start();
    return true;
  }

  stopListening() { try { this.recognition?.stop(); } catch { /* already stopped */ } }
}
