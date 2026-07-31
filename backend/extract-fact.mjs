// Dedicated, single-purpose fact extraction — deliberately NOT bundled into the
// main conversational tool-calling loop. Benchmarking showed small local models
// (qwen2.5:0.5b/1.5b) almost never invoke a remember_fact tool correctly while
// also staying in character, but are much more reliable at a narrow classify-
// and-extract task when that's the only thing they're asked to do.
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

const SYSTEM = `A user is chatting with an AI assistant named Kane. You extract durable facts about the USER (the person who wrote the message) from a single message — never facts about Kane, and never generic knowledge (recipes, how-tos, trivia) that isn't about the user personally.

Only extract: the user's own name, a goal or project of theirs, a personal preference, or something they said they're stuck on. If the message is a question, a request for information, or contains no personal fact about the user, reply with exactly: NONE

Otherwise reply with ONLY the fact as one short third-person sentence about the user (e.g. "Kai runs a small bakery"). Never use the name "Kane" in the fact — that's the assistant, not the user.`;

export async function extractFact(userMessage, { model }) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMessage }],
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const text = (json.message?.content || '').trim();
  if (!text || text.toUpperCase() === 'NONE') return null;
  const fact = text.replace(/^"|"$/g, '');

  // The extraction model is small (0.5b) and occasionally hallucinates instead of
  // following the "one short third-person sentence" instruction -- observed on
  // messages that named no one: bare invented words ("Alice", "Kai") or it echoing
  // the prompt's own meta-language back ("The user's own name.", "NAME: User.").
  // A real extracted fact reads as a multi-word sentence; reject anything that
  // doesn't clear that bar rather than trust it into the user's permanent memory.
  const wordCount = fact.split(/\s+/).filter(Boolean).length;
  if (wordCount < 3 || /^(NAME|USER)\s*:/i.test(fact)) return null;

  return fact;
}
