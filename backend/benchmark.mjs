// Compares local Ollama models on the exact things that matter for Kane:
// reply latency, tool-calling correctness, and basic persona adherence.
// Usage: node benchmark.mjs [model1,model2,...]
import { converse } from './llm.js';
import { TOOLS, systemPrompt, finalizeReply } from './persona.js';

const MODELS = (process.argv[2] || 'qwen2.5:0.5b,qwen2.5:1.5b,llama3.2:3b,gemma2:2b').split(',');
const REPEATS = parseInt(process.argv[3] || '1', 10);

function makeToolTracker() {
  const calls = [];
  const executeTool = async (name, input) => {
    calls.push({ name, input });
    if (name === 'remember_fact') return 'saved';
    return `unknown tool ${name}`;
  };
  return { calls, executeTool };
}

const SCENARIOS = [
  {
    name: 'greeting',
    history: [{ role: 'user', content: 'Hey Kane, how are you?' }],
    facts: [], context: null,
    expectTool: false,
  },
  {
    name: 'remember-name',
    history: [{ role: 'user', content: 'Hi Kane, my name is Kai and I run a small bakery.' }],
    facts: [], context: null,
    expectTool: true,
  },
  {
    name: 'recall',
    history: [
      { role: 'user', content: 'My name is Kai and I run a bakery.' },
      { role: 'assistant', content: "Nice to meet you, Kai! How's the bakery going?" },
      { role: 'user', content: 'What do you remember about me?' },
    ],
    facts: ['Kai runs a small bakery'], context: null,
    expectTool: false,
    expectMention: ['kai', 'bakery'],
  },
  {
    name: 'proactive-nudge',
    history: [{ role: 'user', content: '(proactive trigger, not a real message from the user)' }],
    facts: [], context: 'The user has been idle for 40s with no interaction.',
    expectTool: false,
    isNudge: true,
  },
];

function checkQuality(reply) {
  const issues = [];
  if (/[*_#`]/.test(reply)) issues.push('markdown-leakage');
  if (reply.length > 500) issues.push('too-long');
  if (reply.length === 0) issues.push('empty');
  if (/as an ai|i('m| am) an ai language model/i.test(reply)) issues.push('breaks-persona');
  return issues;
}

async function runScenario(model, scenario) {
  const { calls, executeTool } = makeToolTracker();
  const system = scenario.isNudge
    ? `${systemPrompt(scenario.facts, scenario.context)}\n\nPROACTIVE TRIGGER\nYou are speaking up on your own initiative. Say something brief and natural. Never mention you were triggered automatically.`
    : systemPrompt(scenario.facts, scenario.context);

  const t0 = performance.now();
  let rawText = '';
  let error = null;
  try {
    rawText = await converse({ system, history: scenario.history, tools: TOOLS, executeTool, model });
  } catch (err) {
    error = err.message;
  }
  const latencyMs = Math.round(performance.now() - t0);
  const { reply, gesture } = finalizeReply(rawText || '');

  const toolCalled = calls.some((c) => c.name === 'remember_fact');
  const toolArgValid = calls.every((c) => typeof c.input?.fact === 'string' && c.input.fact.length > 0);
  const qualityIssues = checkQuality(reply);
  const mentionsExpected = scenario.expectMention
    ? scenario.expectMention.every((w) => reply.toLowerCase().includes(w))
    : true;

  const pass = !error
    && (scenario.expectTool ? toolCalled && toolArgValid : true)
    && mentionsExpected
    && qualityIssues.length === 0;

  return { model, scenario: scenario.name, latencyMs, toolCalled, toolArgValid, mentionsExpected, qualityIssues, gesture, error, reply, pass };
}

async function main() {
  const results = [];
  for (const model of MODELS) {
    process.stdout.write(`\nWarming up ${model}... `);
    const warmStart = performance.now();
    try {
      await converse({ system: 'You are a test.', history: [{ role: 'user', content: 'hi' }], tools: [], executeTool: async () => '', model });
      console.log(`ready (${Math.round(performance.now() - warmStart)}ms cold load)`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      continue;
    }

    for (const scenario of SCENARIOS) {
      for (let i = 0; i < REPEATS; i++) {
        process.stdout.write(`  ${model} / ${scenario.name} (${i + 1}/${REPEATS})... `);
        const r = await runScenario(model, scenario);
        console.log(`${r.latencyMs}ms  pass=${r.pass}${r.error ? '  ERROR: ' + r.error : ''}`);
        results.push(r);
      }
    }
  }

  console.log('\n\n=== SUMMARY ===\n');
  const byModel = {};
  for (const r of results) {
    byModel[r.model] = byModel[r.model] || [];
    byModel[r.model].push(r);
  }
  for (const [model, rows] of Object.entries(byModel)) {
    const avgLatency = Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / rows.length);
    const passCount = rows.filter((r) => r.pass).length;
    console.log(`${model}: avg ${avgLatency}ms, ${passCount}/${rows.length} runs passed`);
    for (const scenario of SCENARIOS) {
      const scenarioRows = rows.filter((r) => r.scenario === scenario.name);
      if (!scenarioRows.length) continue;
      const scenarioPass = scenarioRows.filter((r) => r.pass).length;
      console.log(`    ${scenario.name}: ${scenarioPass}/${scenarioRows.length}`);
    }
    for (const r of rows) {
      if (!r.pass) {
        console.log(`  ✗ ${r.scenario}: ${r.error || [
          r.qualityIssues.length ? 'quality:' + r.qualityIssues.join(',') : null,
          !r.mentionsExpected ? 'missing-expected-recall' : null,
          !r.toolCalled && r.scenario.includes('remember') ? 'tool-not-called' : null,
        ].filter(Boolean).join(' ')}`);
        console.log(`      reply: ${JSON.stringify(r.reply).slice(0, 200)}`);
      }
    }
  }
}

main();
