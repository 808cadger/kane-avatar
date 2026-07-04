// Benchmarks the dedicated fact-extraction call in isolation, separate from
// the conversational tool-calling benchmark in benchmark.mjs.
import { extractFact } from './extract-fact.mjs';

const MODELS = (process.argv[2] || 'qwen2.5:0.5b,qwen2.5:1.5b,llama3.2:3b').split(',');
const REPEATS = parseInt(process.argv[3] || '4', 10);

const CASES = [
  { msg: 'Hi Kane, my name is Kai and I run a small bakery.', shouldExtract: true, mustContain: ['kai', 'bakery'] },
  { msg: 'What do you remember about me?', shouldExtract: false },
  { msg: "I'm trying to launch my habit tracker app by next month.", shouldExtract: true, mustContain: ['habit tracker'] },
  { msg: 'How do I bake sourdough bread?', shouldExtract: false },
];

async function main() {
  for (const model of MODELS) {
    const t0 = performance.now();
    await extractFact('hi', { model }); // warmup
    console.log(`\n${model} (warmup ${Math.round(performance.now() - t0)}ms)`);

    let pass = 0, total = 0, latencySum = 0;
    for (const c of CASES) {
      for (let i = 0; i < REPEATS; i++) {
        total++;
        const start = performance.now();
        const fact = await extractFact(c.msg, { model });
        const latency = Math.round(performance.now() - start);
        latencySum += latency;
        const extracted = !!fact;
        const contentOk = c.shouldExtract
          ? extracted && c.mustContain.every((w) => fact.toLowerCase().includes(w))
          : !extracted;
        if (contentOk) pass++;
        console.log(`  [${extracted ? 'FACT' : 'none'}] "${c.msg.slice(0, 40)}..." -> ${JSON.stringify(fact)} (${latency}ms) ${contentOk ? 'OK' : 'FAIL'}`);
      }
    }
    console.log(`  => ${model}: ${pass}/${total} correct, avg ${Math.round(latencySum / total)}ms`);
  }
}

main();
