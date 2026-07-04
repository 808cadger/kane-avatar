/**
 * Public event surface for host apps: Kane.notify('screen_view', {...}) etc.
 * Tracks two separate signals the decision layer needs:
 *  - raw user activity (pointer/keyboard) -> idle time
 *  - host-reported app events (screen views, flow start/complete/abandon, form state)
 */
export class KaneTelemetry {
  constructor() {
    this._listeners = [];
    this._events = [];
    this.lastActivityAt = Date.now();

    const markActive = () => { this.lastActivityAt = Date.now(); };
    ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((evt) =>
      window.addEventListener(evt, markActive, { passive: true }));
  }

  idleSeconds() { return (Date.now() - this.lastActivityAt) / 1000; }

  /** Host apps call this to describe what's happening: screen_view, flow_start, flow_complete, flow_abandon, form_incomplete, custom... */
  notify(type, payload = {}) {
    const event = { type, payload, t: Date.now() };
    this._events.push(event);
    if (this._events.length > 100) this._events.shift();
    this._listeners.forEach((fn) => fn(event));
  }

  on(fn) { this._listeners.push(fn); }

  recentEvents(withinMs = 60000) {
    const cutoff = Date.now() - withinMs;
    return this._events.filter((e) => e.t >= cutoff);
  }
}
