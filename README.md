# Kane

Kane is a life-like, proactive AI companion avatar meant to be dropped into **any** web app with a single `<script>` tag — not a chatbot widget you open, but a presence that watches what's happening in the app and speaks up on its own when it's useful: idle nudges, stuck-in-a-flow detection, and normal conversation with memory that persists across sessions.

Rendered as a real-time 3D avatar (Three.js + glTF), not a flat illustration or a cloud-rendered video avatar — see [Why real-time 3D](#why-real-time-3d) for the reasoning.

## Why real-time 3D

Three rendering approaches were considered for "life-like":

| Approach | Latency | Cost | Fidelity |
|---|---|---|---|
| **Real-time 3D (chosen)** — Three.js + rigged glTF | Instant, client-side | Free after the model | Realistic stylized 3D, not photoreal |
| Cloud photoreal video avatar (D-ID/HeyGen/Tavus) | 1-3+s per utterance (network + generation) | Per-minute API fees | Genuinely photorealistic |
| Unreal Engine MetaHuman, GPU-streamed | Low if co-located, needs a live GPU server | GPU hosting 24/7 | Highest possible |

Kane needs to react *instantly* to being idle or stuck — that's the whole point of the proactive layer — so the multi-second round-trip of a cloud video avatar defeats the purpose, and an always-on GPU server is the wrong cost profile for something meant to be embedded in arbitrary apps. Real-time 3D was the only option with zero per-use latency and cost.

## Quickstart

```bash
# 1. Install
npm install
cd backend && npm install && cd ..

# 2. Pull local models (see Model choice below for why these two)
ollama pull gemma2:2b
ollama pull qwen2.5:0.5b

# 3. Configure the backend
cp backend/.env.example backend/.env

# 4. Run
cd backend && node server.js &   # backend on :8787
npm run dev                      # demo page — Vite will print the port
```

Open the demo page — you'll see a full-page 3D avatar (a placeholder humanoid until you supply a real glTF model, see [Avatar model](#avatar-model)). Type or hold the mic button to talk.

## Embedding in a host app

This is the actual point of Kane — no host markup, no bundler on the host side:

```bash
npm run build:embed   # produces dist/kane.js (self-contained, ~620KB incl. three.js)
```

```html
<script src="kane.js"
        data-backend="https://your-kane-backend.example.com"
        data-mode="corner"
        data-position="bottom-right"></script>
```

That's it — Kane injects its own DOM/CSS and mounts as a transparent-background floating avatar in the chosen corner. `data-mode="fullpage"` is also available (used by this repo's own demo page).

**`data-position`**: `bottom-right` (default) | `bottom-left` | `top-right` | `top-left`. Use this if Kane's default spot collides with the host app's own UI — this happened in real testing (see [Sandbox integration](#sandbox-integration)).

### If the host app has a Content-Security-Policy

Kane's chat is completely silent — with no error visible in the UI beyond a generic "can't reach backend" message — if the host page's CSP `connect-src` doesn't whitelist Kane's backend origin. This is not optional: **any host app with a CSP must add the backend's origin to `connect-src`**, e.g.:

```
connect-src 'self' https://your-kane-backend.example.com;
```

This was found the hard way: an earlier "successful" sandbox integration test only exercised `Kane.notify()` (pure JS, no network) and never actually drove a real `/chat` call through the host page — the CSP block was silently there the whole time. `KaneEngine` now throws a message naming this as the likely cause when a raw network failure occurs, but it still can't fix the host's CSP for it.

### Telemetry API

Host apps report what's happening via one function:

```js
window.Kane.notify('screen_view', { screen: 'onboarding' });
window.Kane.notify('flow_start', { flow: 'checkout' });
window.Kane.notify('flow_complete', { flow: 'checkout' });
```

Kane's decision layer (`src/kane-decision.js`) combines this with raw idle time (mouse/keyboard inactivity) to decide when to proactively speak — a stuck-in-flow nudge if a flow has been open too long while the user goes idle, or a general re-engagement nudge after prolonged inactivity. Both are cooldown-limited so Kane doesn't spam.

## Architecture

```
src/
  kane-mount.js    – the actual embedding contract: builds Kane's own DOM/CSS, wires everything together
  embed.js         – auto-running entry point for <script src="kane.js">, reads data-* config
  main.js          – this repo's own demo entry (fullpage mode), same mount path as any host app
  kane-viewer.js   – Three.js scene, camera, lighting, glTF loading, placeholder avatar
  kane-animator.js – idle sway, cursor gaze tracking, blink, morph-target lip sync
  kane-engine.js   – talks to the backend, persistent session id (localStorage) for cross-session memory
  kane-voice.js    – browser-native TTS/STT (no API key, no cost)
  kane-telemetry.js/kane-decision.js – the proactive layer described above

backend/
  server.js        – Express: /chat, /nudge, /memory/:sessionId, /health
  llm.js           – provider-agnostic adapter (Ollama by default, Anthropic optional)
  persona.js       – Kane's system prompt (shared by server.js and the benchmark scripts)
  db.js            – SQLite: message history + long-term facts, keyed by session id
  extract-fact.mjs – dedicated background fact-extraction call (see Memory below)
  benchmark.mjs / benchmark-extract.mjs – the benchmarks behind every model choice below
```

## Model choice

Everything here runs on **local Ollama** by default — free, no API key, no per-message cost. `KANE_PROVIDER=anthropic` switches to the Anthropic API for higher quality at the cost of money and (usually) latency; see `backend/llm.js`.

Two different models are used for two different jobs, because benchmarking showed a single small model can't do both reliably at once:

| Role | Model | Why |
|---|---|---|
| Conversation (`KANE_MODEL`) | `gemma2:2b` | 100% reliable recall of known facts across repeated tests, in-character replies, ~3s typical latency. |
| Fact extraction (`KANE_EXTRACT_MODEL`) | `qwen2.5:0.5b` | Fast (sub-second), and — counterintuitively — *more* accurate than the larger 1.5b model at this one narrow task. Runs in the background after the reply is already sent, so its latency never affects the conversation. |

### Why two separate calls instead of one tool-calling model

The original design used a single model with a `remember_fact` tool, following Kane's chat like any agentic assistant. Benchmarking (`benchmark.mjs`) found this **unreliable with small models**: `qwen2.5:0.5b` and `qwen2.5:1.5b` invoked the tool 0 times out of 4 in repeated identical tests, despite occasionally appearing to work in ad-hoc manual testing — small models struggle to simultaneously stay in character *and* decide to call a tool. `llama3.2:3b` called it reliably (3/3) but took 5-10x longer per reply and occasionally leaked raw tool-call JSON into the visible response.

The fix: **fact extraction is no longer part of the conversation at all.** After every user message, a separate, narrow, single-purpose call (`extract-fact.mjs`) asks a small model just one question — "does this message contain a durable fact about the user, yes/no, what is it" — with no persona, no tools, no chat history. That kind of narrow classification task is exactly what small models are good at, and it can't slow down or derail the actual conversation because it runs after the reply has already been sent.

This took two prompt iterations to get right — the first version confused the assistant's own name ("Kane") with the user's, and hallucinated "facts" out of ordinary questions like "how do I bake sourdough bread." See `extract-fact.mjs` for the current prompt.

### Known quality ceiling

Even with a fact correctly present in the system prompt on every single call (verified directly, not assumed), a model can still choose not to use it. Measured recall reliability on repeated identical tests:

| Model | Recall reliability |
|---|---|
| `qwen2.5:0.5b` | 0/4 |
| `qwen2.5:1.5b` | 2/4 |
| `llama3.2:3b` | 4/4 |
| `gemma2:2b` | 4/4 |

This is why the default moved from `qwen2.5:1.5b` (fastest, ~1.6s avg, but coinflip-reliable recall) to `gemma2:2b` (~3.2s avg in isolation, ~7s observed in practice when the background extraction call runs concurrently on the same CPU-only Ollama instance, but reliable). **If you need speed over reliability** — e.g. you don't care about Kane remembering things across a session, just fast back-and-forth — set `KANE_MODEL=qwen2.5:1.5b` and accept it'll sometimes claim not to know something it was just told.

`gemma2:2b` does not support tool calling in Ollama at all (`"does not support tools"` error) — irrelevant now since the conversational model no longer uses tools, but worth knowing if you extend Kane with real tool use later, since you'd need a different model for that specific call.

### Re-running the benchmarks

```bash
cd backend
node benchmark.mjs "qwen2.5:0.5b,qwen2.5:1.5b,llama3.2:3b,gemma2:2b" 4   # conversation: models, repeats
node benchmark-extract.mjs "qwen2.5:0.5b,qwen2.5:1.5b" 4                 # fact extraction
```

Both scripts warm up each model once, then run repeated trials and print a pass/fail summary with full reply text for every failure — useful whenever you're evaluating a newly-released small model as a candidate.

## Avatar model

Kane's viewer (`kane-viewer.js`) loads a rigged glTF/GLB and looks for standard bone names (`Head`, `LeftEye`, `RightEye`, ...) and morph targets (ARKit-style `eyeBlinkLeft`, `mouthOpen`, etc.) for gaze, blink, and lip sync. Until a real model is supplied it falls back to a simple placeholder humanoid so the whole pipeline is testable.

To use a real model: generate one at Ready Player Me (free, ~2 minutes) and pass its `.glb` URL via `?model=` (demo) or `modelUrl` (`mountKane()` / `data-model` on the embed script tag).

## Sandbox integration

`/home/cadger/glowai-kane-sandbox` is a throwaway copy of a real app's frontend used to prove Kane embeds cleanly without touching production. Findings from that test:

- Kane's default `bottom-right` position overlapped the host app's own UI in that specific layout — this is exactly why `data-position` exists. Don't assume the default corner is safe for every host; check and override if needed.
- The host app's CSP blocked every real backend call (`connect-src` didn't list Kane's backend origin) — chat and nudges were silently broken the whole time despite an earlier test appearing to pass, because that test never actually drove a real network call through the host page. Fixed in the sandbox by adding the backend origin to `connect-src`; see [above](#if-the-host-app-has-a-content-security-policy). Confirmed working with a real `/chat` and `/nudge` call executed from inside the host page after the fix.
- The host app's own heavy JS (large ML bundles, service workers) made headless browser testing flaky/crash-prone. Verify real integrations in an actual browser, not headless automation.

### If the host app is a PWA with a service worker

Some PWAs cache static JS with a stale-while-revalidate strategy (GlowAI's does, for any `.js`/`.css` path). That means after you update `dist/kane.js` on a host that already has an old copy cached, a returning user's *first* load still serves the stale cached version — the service worker fetches the update in the background for next time, so it takes two loads before a fix actually lands for that user. Not something Kane's code can control; if this matters, ask the host to exclude Kane's bundle from long-lived static-asset caching, or serve it from a versioned/hashed filename.

## Known limitations

- No real 3D avatar model wired in yet — still the placeholder.
- Conversational latency on CPU-only Ollama varies a lot (observed 1-8s) depending on what else is running on the same Ollama instance concurrently; there's no GPU acceleration configured here.
- The Anthropic provider path (`KANE_PROVIDER=anthropic`) exists and is wired up, but hasn't been validated against a funded account — the key used during development returned a "credit balance too low" error, not an auth error, so the integration itself is confirmed correct.
