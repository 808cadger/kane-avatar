const PROVIDER = process.env.KANE_PROVIDER || 'ollama';
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.KANE_MODEL || (PROVIDER === 'ollama' ? 'llama3.2:3b' : 'claude-sonnet-5');
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * Runs a full tool-calling conversation turn against whichever provider is
 * configured, executing tools locally and looping until the model produces
 * a final text answer (capped at maxTurns round-trips).
 *
 * @param {object} opts
 * @param {string} opts.system - system prompt
 * @param {{role:string, content:string}[]} opts.history - prior turns, ending with the new user message
 * @param {{name:string, description:string, parameters:object}[]} opts.tools - generic JSON-schema tool defs
 * @param {(name:string, input:object) => Promise<string>} opts.executeTool
 * @returns {Promise<string>} final assistant text
 */
export async function converse({ system, history, tools = [], executeTool, maxTurns = 3, model }) {
  if (PROVIDER === 'anthropic') return converseAnthropic({ system, history, tools, executeTool, maxTurns, model: model || MODEL });
  return converseOllama({ system, history, tools, executeTool, maxTurns, model: model || MODEL });
}

// ── Ollama (default, local, free) ──
async function converseOllama({ system, history, tools, executeTool, maxTurns, model }) {
  const messages = [{ role: 'system', content: system }, ...history];
  const toolsPayload = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, tools: toolsPayload, stream: false }),
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const msg = json.message || {};

    if (msg.tool_calls?.length) {
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
      for (const call of msg.tool_calls) {
        const result = await executeTool(call.function.name, call.function.arguments);
        messages.push({ role: 'tool', content: result });
      }
      continue;
    }
    return msg.content || '';
  }
  return '';
}

// ── Anthropic (optional, paid, higher quality) ──
async function converseAnthropic({ system, history, tools, executeTool, maxTurns, model }) {
  if (!ANTHROPIC_KEY) throw new Error('Server missing ANTHROPIC_API_KEY');
  let messages = history.map((m) => ({ role: m.role, content: m.content }));
  const toolsPayload = tools.map((t) => ({
    name: t.name, description: t.description, input_schema: t.parameters,
  }));

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: 1024, system, messages, tools: toolsPayload }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e?.error?.message || `Anthropic API error ${res.status}`);
    }
    const result = await res.json();

    if (result.stop_reason === 'tool_use') {
      const toolResults = [];
      for (const block of result.content) {
        if (block.type === 'tool_use') {
          const resultText = await executeTool(block.name, block.input);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultText });
        }
      }
      messages = [...messages, { role: 'assistant', content: result.content }, { role: 'user', content: toolResults }];
      continue;
    }
    return result.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  }
  return '';
}

export const activeProvider = PROVIDER;
export const activeModel = MODEL;
