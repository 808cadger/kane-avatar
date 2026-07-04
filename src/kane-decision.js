/**
 * Rule-based proactive layer: decides WHEN Kane should speak up unprompted,
 * based on telemetry the host app reports plus raw idle time. Keeps the rules
 * simple and inspectable rather than an opaque model call on every tick —
 * the LLM is only invoked once a rule actually fires, to phrase the nudge.
 */
export class KaneDecisionEngine {
  constructor({
    telemetry, engine, onNudge,
    idleThresholdSec = 25,
    stuckThresholdSec = 20,
    minGapBetweenNudgesSec = 60,
    tickMs = 5000,
  }) {
    this.telemetry = telemetry;
    this.engine = engine;
    this.onNudge = onNudge;
    this.idleThresholdSec = idleThresholdSec;
    this.stuckThresholdSec = stuckThresholdSec;
    this.minGapBetweenNudgesSec = minGapBetweenNudgesSec;
    this.lastNudgeAt = 0;
    this.activeFlow = null; // { name, startedAt }
    this.paused = false;

    telemetry.on((event) => this._onEvent(event));
    this._interval = setInterval(() => this._tick(), tickMs);
  }

  stop() { clearInterval(this._interval); }

  /** Suppress nudges while the user is actively talking with Kane. */
  setPaused(paused) { this.paused = paused; }

  _onEvent(event) {
    if (event.type === 'flow_start') this.activeFlow = { name: event.payload.flow || 'a task', startedAt: Date.now() };
    if (event.type === 'flow_complete' || event.type === 'flow_abandon') this.activeFlow = null;
  }

  async _tick() {
    if (this.paused) return;
    const secSinceLastNudge = (Date.now() - this.lastNudgeAt) / 1000;
    if (secSinceLastNudge < this.minGapBetweenNudgesSec) return;

    const idleSec = this.telemetry.idleSeconds();

    if (this.activeFlow) {
      const flowAgeSec = (Date.now() - this.activeFlow.startedAt) / 1000;
      if (flowAgeSec > this.stuckThresholdSec && idleSec > 8) {
        await this._fireNudge(
          `The user started "${this.activeFlow.name}" ${Math.round(flowAgeSec)}s ago and hasn't finished it, ` +
          `and has been idle for ${Math.round(idleSec)}s. They may be stuck or unsure what to do next.`
        );
        return;
      }
    }

    if (idleSec > this.idleThresholdSec) {
      await this._fireNudge(`The user has been idle for ${Math.round(idleSec)}s with no interaction.`);
    }
  }

  async _fireNudge(context) {
    this.lastNudgeAt = Date.now();
    try {
      const result = await this.engine.nudge(context);
      this.onNudge(result);
    } catch (err) {
      console.warn('Kane decision layer: nudge failed', err);
    }
  }
}
