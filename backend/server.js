import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { getHistory, appendMessage, getFacts, addFact } from './db.js';
import { converse, activeProvider, activeModel } from './llm.js';

const PORT = process.env.PORT || 8787;

const app = express();
app.use(cors());
app.use(express.json());

const TOOLS = [
  {
    name: 'remember_fact',
    description: 'Store a short, durable fact about the user or their situation so Kane can recall it in future sessions (e.g. their name, a goal they mentioned, a preference).',
    parameters: {
      type: 'object',
      properties: { fact: { type: 'string', description: 'The fact to remember, written concisely in third person.' } },
      required: ['fact'],
    },
  },
];

function systemPrompt(facts, context) {
  return `You are Kane — a warm, sharp AI companion embodied as a real-time 3D avatar standing beside the user in whatever app they're using.

PERSONALITY
Speak like a knowledgeable friend: direct, warm, curious, never robotic. Use contractions and natural speech. Be honest, including "I'm not sure." Never open with "Great question!" or "Certainly!".

GESTURES
Trigger at most one physical animation per response by placing exactly one tag at the natural moment: [wave] greeting/farewell, [point] drawing attention to something on screen, [think] pausing before a complex answer. Most responses need no tag.

MEMORY
Use the remember_fact tool whenever the user shares something worth recalling next time (their name, a goal, a preference, something they're stuck on). Don't narrate that you're saving it.
${facts.length ? `\nKNOWN FACTS ABOUT THIS USER:\n${facts.map((f) => `- ${f}`).join('\n')}` : ''}
${context ? `\nCURRENT SITUATION: ${context}` : ''}

RESPONSE STYLE
Casual chat: 1-3 sentences, flowing prose, no headers or bullet lists. Keep sentences short — you'll be read aloud via TTS.`;
}

app.get('/health', (_req, res) => res.json({ ok: true, provider: activeProvider, model: activeModel }));

app.get('/memory/:sessionId', (req, res) => {
  res.json({ history: getHistory(req.params.sessionId, 100), facts: getFacts(req.params.sessionId) });
});

async function executeTool(sessionId, name, input) {
  if (name === 'remember_fact') {
    // Smaller local models don't always respect the string type in the schema.
    const fact = typeof input?.fact === 'string' ? input.fact : JSON.stringify(input?.fact ?? input);
    if (fact) addFact(sessionId, fact);
    return 'saved';
  }
  return `unknown tool ${name}`;
}

function finalizeReply(text) {
  const match = text.match(/\[(wave|point|think)\]/i);
  const gesture = match ? match[1].toLowerCase() : null;
  const clean = text.replace(/\[(wave|point|think)\]/gi, '').replace(/ {2,}/g, ' ').trim();
  return { reply: clean, gesture };
}

app.post('/chat', async (req, res) => {
  const { sessionId, message, context } = req.body || {};
  if (!sessionId || !message) return res.status(400).json({ error: 'sessionId and message are required' });

  try {
    appendMessage(sessionId, 'user', message);
    const facts = getFacts(sessionId);
    const system = systemPrompt(facts, context);
    const history = getHistory(sessionId, 20).map((m) => ({ role: m.role, content: m.content }));

    const finalText = await converse({
      system, history, tools: TOOLS,
      executeTool: (name, input) => executeTool(sessionId, name, input),
    });

    appendMessage(sessionId, 'assistant', finalText);
    res.json(finalizeReply(finalText));
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
      tools: TOOLS,
      executeTool: (name, input) => executeTool(sessionId, name, input),
    });

    appendMessage(sessionId, 'assistant', finalText);
    res.json(finalizeReply(finalText));
  } catch (err) {
    console.error('Kane /nudge error:', err);
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
});

app.listen(PORT, () => console.log(`Kane backend listening on :${PORT}`));
