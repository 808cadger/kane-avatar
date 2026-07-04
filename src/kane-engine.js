const SESSION_KEY = 'kane_session_id';

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

/** Talks to the Kane backend, carrying a persistent session id so memory resumes across page loads. */
export class KaneEngine {
  constructor({ backendUrl }) {
    this.backendUrl = backendUrl.replace(/\/$/, '');
    this.sessionId = getSessionId();
  }

  async send(message, context) {
    const res = await fetch(`${this.backendUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId, message, context }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `Kane backend error ${res.status}`);
    }
    return res.json(); // { reply, gesture }
  }

  /** Kane speaks on its own initiative; context describes the situation, not a user message. */
  async nudge(context) {
    const res = await fetch(`${this.backendUrl}/nudge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId, context }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `Kane backend error ${res.status}`);
    }
    return res.json(); // { reply, gesture }
  }

  async history() {
    const res = await fetch(`${this.backendUrl}/memory/${this.sessionId}`);
    return res.ok ? res.json() : { history: [], facts: [] };
  }
}
