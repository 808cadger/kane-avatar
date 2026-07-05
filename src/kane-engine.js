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

  async _post(path, body) {
    let res;
    try {
      res = await fetch(`${this.backendUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // A raw network-level failure (no response at all) is almost always the host
      // page's Content-Security-Policy connect-src blocking this origin, CORS, or the
      // backend simply being unreachable — the browser gives no way to tell which, so
      // name the most likely fix rather than surface the opaque "Failed to fetch".
      throw new Error(
        `Can't reach Kane's backend at ${this.backendUrl} — if this page has a Content-Security-Policy, ` +
        `make sure connect-src allows ${this.backendUrl}, and confirm the backend is running.`
      );
    }
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `Kane backend error ${res.status}`);
    }
    return res.json();
  }

  send(message, context) {
    return this._post('/chat', { sessionId: this.sessionId, message, context }); // { reply, gesture }
  }

  /** Kane speaks on its own initiative; context describes the situation, not a user message. */
  nudge(context) {
    return this._post('/nudge', { sessionId: this.sessionId, context }); // { reply, gesture }
  }

  async history() {
    const res = await fetch(`${this.backendUrl}/memory/${this.sessionId}`);
    return res.ok ? res.json() : { history: [], facts: [] };
  }
}
