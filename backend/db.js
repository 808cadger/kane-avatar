import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'kane.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

  CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    fact TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_facts_session ON facts(session_id);
`);

export function getHistory(sessionId, limit = 20) {
  const rows = db.prepare(
    `SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?`
  ).all(sessionId, limit);
  return rows.reverse();
}

export function appendMessage(sessionId, role, content) {
  db.prepare(
    `INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)`
  ).run(sessionId, role, content, Date.now());
}

export function getFacts(sessionId) {
  return db.prepare(`SELECT fact FROM facts WHERE session_id = ? ORDER BY id`).all(sessionId)
    .map((r) => r.fact);
}

// Keeps the MEMORY block in the system prompt from growing unbounded over a
// long-running session — once a session hits the cap, the oldest fact is
// dropped to make room for the newest one.
const MAX_FACTS_PER_SESSION = 30;

export function addFact(sessionId, fact) {
  const duplicate = db.prepare(
    `SELECT 1 FROM facts WHERE session_id = ? AND fact = ? COLLATE NOCASE`
  ).get(sessionId, fact);
  if (duplicate) return;

  db.prepare(
    `INSERT INTO facts (session_id, fact, created_at) VALUES (?, ?, ?)`
  ).run(sessionId, fact, Date.now());

  db.prepare(`
    DELETE FROM facts WHERE session_id = ? AND id NOT IN (
      SELECT id FROM facts WHERE session_id = ? ORDER BY id DESC LIMIT ?
    )
  `).run(sessionId, sessionId, MAX_FACTS_PER_SESSION);
}

export default db;
