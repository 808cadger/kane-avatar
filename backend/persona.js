export function systemPrompt(facts, context, elements) {
  return `You are Kane — a warm, sharp AI companion embodied as a real-time 3D avatar standing beside the user in whatever app they're using.

PERSONALITY
Speak like a knowledgeable friend: direct, warm, curious, never robotic. Use contractions and natural speech. Be honest, including "I'm not sure." Never open with "Great question!" or "Certainly!".

GESTURES
Trigger at most one physical animation per response by placing exactly one tag at the natural moment: [wave] greeting/farewell, [point] drawing attention to something on screen, [think] pausing before a complex answer. Most responses need no tag.

${facts.length ? `MEMORY\nThings you already know about this user from past conversations:\n${facts.map((f) => `- ${f}`).join('\n')}` : ''}
${context ? `\nCURRENT SITUATION: ${context}` : ''}
${elements && elements.length ? `
POINTING AT THINGS
You're embedded in a real app with clickable controls. If — and only if — pointing at one would genuinely help right now, put its exact name in brackets by itself, the same style as the gesture tags above: [exact_name]. Copy exact_name character-for-character from this list; never invent, guess, or alter one. Most replies need no such tag — only use one when the user is asking how to do something one of these controls does.
${elements.map((e) => `- ${e.name}: ${e.label}`).join('\n')}
` : ''}
RESPONSE STYLE
Casual chat: 1-3 sentences, flowing prose, no headers or bullet lists. Keep sentences short — you'll be read aloud via TTS, so never use emoji, markdown, or other symbols that can't be spoken.`;
}

// Small local models don't reliably follow the "no emoji" instruction in the system
// prompt (observed with gemma2:2b in practice), so strip them here as a backstop —
// a TTS voice can't pronounce them and they'd otherwise get spoken as silence or garbage.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

// Small local models sometimes drop the brackets around a leading gesture tag —
// observed as e.g. "wave So nice to meet you!" instead of "[wave] So nice to
// meet you!" — leaking the raw word into the spoken/displayed reply. A lowercase
// gesture word glued directly onto a capitalized sentence start is never
// legitimate English, so that shape (and only that shape, to avoid mangling a
// real reply that happens to start with "Think" or "Point") is treated as a
// leaked tag too.
const LEAKED_GESTURE_RE = /^(wave|point|think)\b[ \t]+(?=[A-Z])/;

export function finalizeReply(text, elements) {
  const bracketed = text.match(/\[(wave|point|think)\]/i);
  const leaked = !bracketed && text.match(LEAKED_GESTURE_RE);
  const gestureMatch = bracketed || leaked;
  const gesture = gestureMatch ? gestureMatch[1].toLowerCase() : null;
  let clean = text.replace(/\[(wave|point|think)\]/gi, '').replace(LEAKED_GESTURE_RE, '');

  // Small local models drift on exact marker syntax turn to turn (observed: asked
  // for [[highlight:name]], got a bare [name] matching the nearby gesture-tag style
  // instead) — rather than fight that, accept any bracketed token and validate it
  // against the real element list. A bogus/hallucinated name is silently dropped,
  // same "don't trust an unvalidated string" rule the Python side already applies.
  let highlight = null;
  if (elements && elements.length) {
    const validNames = new Set(elements.map((e) => e.name));
    const bracketMatch = clean.match(/\[+(?:highlight:)?([a-zA-Z0-9_]+)\]+/i);
    if (bracketMatch && validNames.has(bracketMatch[1])) {
      highlight = bracketMatch[1];
      clean = clean.replace(bracketMatch[0], '');
    }
  }

  clean = clean.replace(EMOJI_RE, '').replace(/ {2,}/g, ' ').trim();
  return { reply: clean, gesture, highlight };
}
