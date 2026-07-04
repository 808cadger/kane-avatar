import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { getHistory, appendMessage, getFacts, addFact } from './db.js';
import { converse, activeProvider, activeModel } from './llm.js';
import { systemPrompt, finalizeReply } from './persona.js';
import { extractFact } from './extract-fact.mjs';

const PORT = process.env.PORT || 8787;
// Benchmarked separately from the conversational model (see benchmark-extract.mjs):
// small models are far more reliable at this narrow extraction task alone than
// at deciding to invoke a remember_fact tool mid-conversation (0% vs ~75%).
const EXTRACT_MODEL = process.env.KANE_EXTRACT_MODEL || 'qwen2.5:0.5b';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, provider: activeProvider, model: activeModel }));

app.get('/memory/:sessionId', (req, res) => {
  res.json({ history: getHistory(req.params.sessionId, 100), facts: getFacts(req.params.sessionId) });
});

// Runs after the user-facing reply is already sent, so extraction latency never
// delays the conversation — it only affects what Kane knows on the *next* turn.
function extractFactInBackground(sessionId, message) {
  extractFact(message, { model: EXTRACT_MODEL })
    .then((fact) => { if (fact) addFact(sessionId, fact); })
    .catch((err) => console.warn('Kane fact extraction failed:', err.message));
}

app.post('/chat', async (req, res) => {
  const { sessionId, message, context } = req.body || {};
  if (!sessionId || !message) return res.status(400).json({ error: 'sessionId and message are required' });

  try {
    appendMessage(sessionId, 'user', message);
    const facts = getFacts(sessionId);
    const system = systemPrompt(facts, context);
    const history = getHistory(sessionId, 20).map((m) => ({ role: m.role, content: m.content }));

    const finalText = await converse({ system, history });

    appendMessage(sessionId, 'assistant', finalText);
    res.json(finalizeReply(finalText));
    extractFactInBackground(sessionId, message);
  } catch (err) {
    console.error('Kane /chat error:', err);
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
});

// Kane speaks on its own initiative (idle nudge, stuck-in-flow, etc). The triggering
// "context" is never stored as a user turn — only the resulting assistant reply is,
// so the conversation history stays coherent from the user's point of view.
app.post('/nudge', async (req, res) => {
  const { sessionId, context } = req.body || {};
  if (!sessionId || !context) return res.status(400).json({ error: 'sessionId and context are required' });

  try {
    const facts = getFacts(sessionId);
    const system = `${systemPrompt(facts, context)}

PROACTIVE TRIGGER
You are speaking up on your own initiative because of the situation above — the user has not asked you anything right now. Say something brief, natural, and genuinely useful given the situation. Never mention that you were triggered automatically or that this is a "nudge".`;
    const history = getHistory(sessionId, 20).map((m) => ({ role: m.role, content: m.content }));

    const finalText = await converse({
      system,
      history: [...history, { role: 'user', content: '(proactive trigger, not a real message from the user)' }],
    });

    appendMessage(sessionId, 'assistant', finalText);
    res.json(finalizeReply(finalText));
  } catch (err) {
    console.error('Kane /nudge error:', err);
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
});

app.listen(PORT, () => console.log(`Kane backend listening on :${PORT}`));
