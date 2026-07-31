// Crude letter->viseme classifier (Oculus/ARKit 15-shape set — matches the
// `viseme_*` morph names Avaturn T2 exports use directly). Not real phonetics,
// just enough to make consecutive words look distinct instead of one repeating flap.
const VISEME_DIGRAPH = { th: 'TH', ch: 'CH', sh: 'CH', ph: 'FF', ng: 'kk', wh: 'U' };
const VISEME_SINGLE = {
  a: 'aa', e: 'E', i: 'I', o: 'O', u: 'U', y: 'I', w: 'U',
  p: 'PP', b: 'PP', m: 'PP',
  f: 'FF', v: 'FF',
  t: 'DD', d: 'DD', l: 'DD',
  n: 'nn',
  k: 'kk', g: 'kk', c: 'kk', q: 'kk', x: 'kk',
  s: 'SS', z: 'SS',
  r: 'RR',
};

function wordToVisemes(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return ['sil'];
  const seq = [];
  let i = 0;
  while (i < w.length) {
    const two = w.slice(i, i + 2);
    const digraph = VISEME_DIGRAPH[two];
    const v = digraph || VISEME_SINGLE[w[i]];
    if (v && v !== seq[seq.length - 1]) seq.push(v);
    i += digraph ? 2 : 1;
  }
  return seq.length ? seq : ['aa'];
}

function splitWords(text) {
  const words = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) words.push({ text: m[0], start: m.index });
  return words;
}

/**
 * Browser-native speech in/out — zero API keys, zero cost. Swap in a cloud
 * TTS/STT provider later without touching callers (same speak/startListening surface).
 */
export class KaneVoice {
  constructor({ onViseme, onListeningChange } = {}) {
    this.onViseme = onViseme || (() => {});
    this.onListeningChange = onListeningChange || (() => {});
    this.enabled = true;
    this._talkInterval = null;
    this._visemeTimer = null;
    this.recognition = null;
  }

  speak(text, { onStart, onEnd } = {}) {
    if (!this.enabled || !text) { onEnd?.(); return; }
    window.speechSynthesis.cancel();
    clearTimeout(this._visemeTimer);
    clearInterval(this._talkInterval);
    clearTimeout(this._minDurationTimer);

    const startedAt = Date.now();
    const words = splitWords(text);
    // Floor for how long the caption stays up, independent of actual TTS duration.
    // Covers machines with no TTS voices installed (common on bare Linux — confirmed
    // via getVoices().length === 0 below), where speechSynthesis errors out near-
    // instantly with nothing audible and would otherwise clear the reply before
    // anyone could read it.
    const minVisibleMs = Math.min(12000, Math.max(1200, words.length * 280));
    const voices = window.speechSynthesis.getVoices();

    if (!voices.length) {
      onStart?.();
      this._startFallbackChatter();
      this._minDurationTimer = setTimeout(() => { this._stopMouth(); onEnd?.(); }, minVisibleMs);
      return;
    }

    const u = new SpeechSynthesisUtterance(text);
    const pref = voices.find((v) => v.lang.startsWith('en') && v.localService)
      || voices.find((v) => v.lang.startsWith('en'));
    if (pref) u.voice = pref;
    u.rate = 1.0; u.pitch = 1.0;

    let boundaryFired = false;
    u.onboundary = (e) => {
      if (e.name && e.name !== 'word') return; // ignore sentence-level boundaries
      boundaryFired = true;
      const word = words.find((w) => w.start === e.charIndex) || words.find((w) => w.start >= e.charIndex);
      if (word) this._animateWord(word.text);
    };
    u.onstart = () => {
      onStart?.();
      // Some voices/browsers never fire 'boundary' at all — fall back to generic
      // chatter rather than leaving the mouth frozen shut for the whole reply.
      setTimeout(() => { if (!boundaryFired) this._startFallbackChatter(); }, 250);
    };
    u.onend = u.onerror = () => {
      this._stopMouth();
      const remaining = minVisibleMs - (Date.now() - startedAt);
      if (remaining > 0) this._minDurationTimer = setTimeout(() => onEnd?.(), remaining);
      else onEnd?.();
    };
    window.speechSynthesis.speak(u);
  }

  /** Steps through a word's viseme sequence in real time, timed to fit before the next boundary. */
  _animateWord(word) {
    clearTimeout(this._visemeTimer);
    clearInterval(this._talkInterval);
    const visemes = wordToVisemes(word);
    const stepMs = Math.max(140, Math.min(650, word.length * 65)) / visemes.length;
    let i = 0;
    const advance = () => {
      if (i >= visemes.length) return;
      this.onViseme(visemes[i], 1);
      i += 1;
      this._visemeTimer = setTimeout(advance, stepMs);
    };
    advance();
  }

  _startFallbackChatter() {
    const shapes = ['aa', 'E', 'PP', 'O'];
    let i = 0;
    clearInterval(this._talkInterval);
    this._talkInterval = setInterval(() => {
      this.onViseme(shapes[i % shapes.length], 0.6 + Math.random() * 0.4);
      i += 1;
    }, 130);
  }

  _stopMouth() {
    clearTimeout(this._visemeTimer);
    clearInterval(this._talkInterval);
    this.onViseme('sil', 0);
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
