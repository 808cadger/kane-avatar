# Kane-avatar

3D avatar viewer with persona-driven LLM interaction via Ollama.

## Stack
- Frontend: Vite, Three.js, @pixiv/three-vrm
- Backend: Node.js, better-sqlite3, cors
- AI: Ollama HTTP API (localhost:11434)
- Runtime: Node 20+

## Structure
- `src/` — Vite frontend (Three.js VRM viewer, UI)
- `backend/` — Node server (SQLite, Ollama client, persona logic)

## Standards
- Async/await for all I/O
- CORS enabled for frontend ↔ backend
- SQLite for persistent persona/state
- Handle Ollama offline/error gracefully

## Commands
- Dev: `npm run dev`
- Build: `npm run build`
- Backend: `node backend/server.js` (or your entry point)

## Constraints
- Ollama on localhost:11434 (HTTP, not local CUDA)
- VRM models via @pixiv/three-vrm
- No Python, FastAPI, uv, pytest, ruff

## Principles
- Verify stack before refactoring (Node vs Python)
- Show plan, wait for approval
- Test Ollama connectivity before persona calls
