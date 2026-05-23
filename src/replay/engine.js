"use strict";

const { EventEmitter } = require('node:events');

const SPEED_PRESETS = {
  '1x': 1,
  '2x': 2,
  '5x': 5,
  '10x': 10,
  '50x': 50,
  MAX: Infinity,
};

const VALID_SPEED_KEYS = Object.keys(SPEED_PRESETS);

/**
 * ReplayEngine — replays recorded conversation sessions with configurable
 * speed, step-through navigation, position tracking, and built-in analysis.
 */
class ReplayEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this._session = null;
    this._currentIndex = -1;
    this._speed = 1;
    this._paused = false;
    this._timerId = null;
    this._startedAt = null;
    this._analysis = null;
    this._onStep = options.onStep || null;
    this._onEnd = options.onEnd || null;
    this._previousTimestamp = null;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────

  /**
   * Load a session recording for replay.
   * @param {object} session - Session recording object (from SessionRecorder output).
   */
  load(session) {
    if (!session || typeof session !== 'object') {
      throw new Error('Session must be an object.');
    }
    if (!Array.isArray(session.events)) {
      throw new Error('Session must have an "events" array.');
    }

    this._session = session;
    this._currentIndex = -1;
    this._paused = false;
    this._speed = 1;
    this._startedAt = null;
    this._analysis = null;
    this._previousTimestamp = null;
    this._clearTimer();
  }

  /**
   * Replay the loaded session at the given speed.
   * @param {object|string|number} [sessionOrSpeed] - Session object, speed string/number, or options bag.
   *   When called with a session object, loads it first.
   *   When called with a speed string/number/options, replays the already-loaded session.
   * @param {string|number} [speed='1x'] - Playback speed (1x, 2x, 5x, 10x, 50x, MAX, or a positive number).
   */
  replay(sessionOrSpeed, speed) {
    let session;
    let resolvedSpeed;

    if (sessionOrSpeed && typeof sessionOrSpeed === 'object' && sessionOrSpeed.events) {
      // Called as replay(session, speed)
      session = sessionOrSpeed;
      resolvedSpeed = speed;
      this.load(session);
    } else {
      // Called as replay(speed) or replay({ speed: '2x' })
      if (!this._session) {
        throw new Error('No session loaded. Pass a session object or call load() first.');
      }
      resolvedSpeed = sessionOrSpeed;
    }

    this._speed = this._resolveSpeed(resolvedSpeed);
    this._paused = false;
    this._startedAt = Date.now();
    this._currentIndex = -1;
    this._previousTimestamp = null;
    this._clearTimer();
    this._analysis = null;

    const total = this._session.events.length;
    if (total === 0) {
      this._emitEnd();
      return;
    }

    if (this._speed === Infinity) {
      this._playAllImmediate();
    } else {
      this._scheduleNext(0);
    }
  }

  /**
   * Advance one event. Returns the event, or null if at end.
   * @returns {object|null}
   */
  step() {
    if (!this._session) {
      throw new Error('No session loaded. Call load() first.');
    }

    const total = this._session.events.length;
    if (total === 0 || this._currentIndex >= total - 1) {
      this._emitEnd();
      return null;
    }

    this._currentIndex += 1;
    const event = this._session.events[this._currentIndex];
    this._previousTimestamp = event.timestamp;

    this.emit('step', event, this.getCurrentPosition());
    if (this._onStep) this._onStep(event, this.getCurrentPosition());

    if (this._currentIndex >= total - 1) {
      this._emitEnd();
    }

    return event;
  }

  /**
   * Fast-forward to a target position.
   * @param {number|string} target - Event index (number) or ISO timestamp (string).
   * @returns {object} New position.
   */
  fastForward(target) {
    if (!this._session) {
      throw new Error('No session loaded. Call load() first.');
    }

    this._clearTimer();
    const events = this._session.events;
    const total = events.length;

    if (total === 0) {
      this._currentIndex = -1;
      return this.getCurrentPosition();
    }

    let targetIndex;

    if (typeof target === 'number') {
      // Jump to specific event index
      targetIndex = Math.max(0, Math.min(total - 1, Math.floor(target)));
    } else if (typeof target === 'string') {
      // Jump to timestamp
      const targetTime = new Date(target).getTime();
      if (Number.isNaN(targetTime)) {
        throw new Error(`Invalid timestamp: ${target}`);
      }
      targetIndex = -1;
      for (let i = 0; i < total; i++) {
        const eventTime = new Date(events[i].timestamp).getTime();
        if (eventTime <= targetTime) {
          targetIndex = i;
        } else {
          break;
        }
      }
      if (targetIndex < 0) {
        targetIndex = 0;
      }
    } else {
      throw new Error('target must be a number (event index) or string (ISO timestamp).');
    }

    if (targetIndex <= this._currentIndex) {
      throw new Error(
        `Cannot fast-forward backwards. Current index is ${this._currentIndex}, target is ${targetIndex}. Use rewind() instead.`
      );
    }

    // Emit step for each event we skip past (for analysis hooks)
    for (let i = this._currentIndex + 1; i <= targetIndex; i++) {
      this._currentIndex = i;
      this._previousTimestamp = events[i].timestamp;
      this.emit('step', events[i], this.getCurrentPosition());
      if (this._onStep) this._onStep(events[i], this.getCurrentPosition());
    }

    if (this._currentIndex >= total - 1) {
      this._emitEnd();
    }

    return this.getCurrentPosition();
  }

  /**
   * Rewind to a target position.
   * @param {number|string} target - Event index (number) or ISO timestamp (string).
   * @returns {object} New position.
   */
  rewind(target) {
    if (!this._session) {
      throw new Error('No session loaded. Call load() first.');
    }

    this._clearTimer();
    const events = this._session.events;
    const total = events.length;

    if (total === 0) {
      this._currentIndex = -1;
      return this.getCurrentPosition();
    }

    let targetIndex;

    if (typeof target === 'number') {
      targetIndex = Math.max(-1, Math.min(total - 1, Math.floor(target)));
    } else if (typeof target === 'string') {
      const targetTime = new Date(target).getTime();
      if (Number.isNaN(targetTime)) {
        throw new Error(`Invalid timestamp: ${target}`);
      }
      targetIndex = -1;
      for (let i = 0; i < total; i++) {
        const eventTime = new Date(events[i].timestamp).getTime();
        if (eventTime <= targetTime) {
          targetIndex = i;
        } else {
          break;
        }
      }
    } else {
      throw new Error('target must be a number (event index) or string (ISO timestamp).');
    }

    if (targetIndex >= this._currentIndex) {
      throw new Error(
        `Cannot rewind forward. Current index is ${this._currentIndex}, target is ${targetIndex}. Use fastForward() instead.`
      );
    }

    this._currentIndex = targetIndex;
    this._paused = false;
    this.emit('rewind', this.getCurrentPosition());

    return this.getCurrentPosition();
  }

  /**
   * Get the current replay position and state.
   * @returns {object}
   */
  getCurrentPosition() {
    if (!this._session) {
      return {
        index: -1,
        total: 0,
        percent: 0,
        event: null,
        speed: this._speed,
        paused: this._paused,
        elapsedMs: 0,
        remainingCount: 0,
        sessionId: null,
      };
    }

    const total = this._session.events.length;
    const index = this._currentIndex;
    const event = index >= 0 && index < total ? this._session.events[index] : null;

    return {
      index,
      total,
      percent: total > 0 ? Math.round(((index + 1) / total) * 100) : 0,
      event,
      speed: this._speed,
      paused: this._paused,
      elapsedMs: this._startedAt ? Date.now() - this._startedAt : 0,
      remainingCount: Math.max(0, total - (index + 1)),
      sessionId: this._session.metadata?.id || null,
    };
  }

  /**
   * Pause playback.
   */
  pause() {
    this._paused = true;
    this._clearTimer();
    this.emit('pause', this.getCurrentPosition());
  }

  /**
   * Resume from the current position.
   */
  resume() {
    if (!this._paused) return;
    this._paused = false;

    if (!this._session || this._currentIndex >= this._session.events.length - 1) {
      this._emitEnd();
      return;
    }

    if (this._speed === Infinity) {
      this._playAllImmediate();
    } else {
      this._scheduleNext(this._currentIndex + 1);
    }
  }

  /**
   * Reset to the beginning of the session.
   */
  reset() {
    this._clearTimer();
    this._currentIndex = -1;
    this._paused = false;
    this._speed = 1;
    this._startedAt = null;
    this._previousTimestamp = null;
    this._analysis = null;
  }

  // ── analysis ──────────────────────────────────────────────────────────

  /**
   * Analyze the session and extract insights.
   * Runs against the loaded session.  Call after replay, or on any session.
   * @param {object} [session] - Optional session object. Uses loaded session if omitted.
   * @returns {object} Analysis results.
   */
  analyzeReplay(session) {
    const target = session || this._session;
    if (!target || !Array.isArray(target.events)) {
      throw new Error('No valid session available for analysis.');
    }

    const events = target.events;
    const countsByType = {};
    const timings = [];
    const toolCalls = [];
    const errors = [];
    const messages = [];
    let firstEventTime = null;
    let lastEventTime = null;

    for (let i = 0; i < events.length; i++) {
      const evt = events[i];
      const type = evt.type || 'unknown';

      // Count by type
      countsByType[type] = (countsByType[type] || 0) + 1;

      // Track timestamps
      const ts = evt.timestamp ? new Date(evt.timestamp).getTime() : null;
      if (ts) {
        if (firstEventTime === null) firstEventTime = ts;
        lastEventTime = ts;
        timings.push({ index: i, type, timestamp: evt.timestamp, ts });
      }

      // Collect tool calls
      if (type === 'tool_call') {
        toolCalls.push({
          index: i,
          timestamp: evt.timestamp,
          tool: evt.data?.tool || evt.data?.name || 'unknown',
          input: evt.data?.input || evt.data || null,
        });
      }

      // Collect errors
      if (type === 'error') {
        errors.push({
          index: i,
          timestamp: evt.timestamp,
          message: evt.data?.message || evt.data?.error || String(evt.data || ''),
        });
      }

      // Collect messages
      if (type === 'user_message' || type === 'assistant_response') {
        messages.push({
          index: i,
          timestamp: evt.timestamp,
          type,
          content: typeof evt.data === 'string' ? evt.data : (evt.data?.content || evt.data?.text || ''),
          tokenCount: evt.context?.tokenCount || null,
        });
      }
    }

    // Inter-event delays
    const delays = [];
    for (let i = 1; i < timings.length; i++) {
      delays.push({
        fromIndex: i - 1,
        toIndex: i,
        fromType: timings[i - 1].type,
        toType: timings[i].type,
        delayMs: timings[i].ts - timings[i - 1].ts,
      });
    }

    // Turns (user_message → assistant_response pairs)
    const turns = [];
    let currentTurn = null;
    for (const msg of messages) {
      if (msg.type === 'user_message') {
        currentTurn = { user: msg, assistant: null, tools: [] };
        turns.push(currentTurn);
      } else if (currentTurn && msg.type === 'assistant_response') {
        currentTurn.assistant = msg;
      }
    }

    // Attach tool calls to their turns
    for (const tc of toolCalls) {
      if (turns.length > 0) {
        const lastTurn = turns[turns.length - 1];
        lastTurn.tools.push(tc);
      }
    }

    const totalDurationMs = firstEventTime && lastEventTime
      ? lastEventTime - firstEventTime
      : 0;

    const avgDelayMs = delays.length > 0
      ? delays.reduce((s, d) => s + d.delayMs, 0) / delays.length
      : 0;

    const maxDelay = delays.length > 0
      ? delays.reduce((max, d) => d.delayMs > max.delayMs ? d : max, delays[0])
      : null;

    const analysis = {
      sessionId: target.metadata?.id || null,
      totalEvents: events.length,
      countsByType,
      totalTurns: turns.length,
      totalToolCalls: toolCalls.length,
      totalErrors: errors.length,
      totalDurationMs,
      avgDelayMs: Math.round(avgDelayMs),
      maxDelay,
      toolNames: [...new Set(toolCalls.map(t => t.tool))],
      errorSummary: errors.map(e => e.message).slice(0, 10),
      messages,
      toolCalls,
      errors,
      delays,
      turns,
      metadata: target.metadata || null,
    };

    this._analysis = analysis;
    this.emit('analysis', analysis);

    return analysis;
  }

  /**
   * Returns the cached analysis from the last analyzeReplay() call, or null.
   * @returns {object|null}
   */
  getAnalysis() {
    return this._analysis;
  }

  /**
   * Get the current playback speed.
   * @returns {number}
   */
  getSpeed() {
    return this._speed;
  }

  /**
   * Check if playback is paused.
   * @returns {boolean}
   */
  isPaused() {
    return this._paused;
  }

  /**
   * Check if a session is loaded.
   * @returns {boolean}
   */
  hasSession() {
    return this._session !== null;
  }

  /**
   * Get the loaded session (shallow copy).
   * @returns {object|null}
   */
  getSession() {
    return this._session ? { ...this._session, events: [...this._session.events] } : null;
  }

  // ── private helpers ───────────────────────────────────────────────────

  _resolveSpeed(speed) {
    if (speed === undefined || speed === null) return 1;

    if (typeof speed === 'number') {
      if (speed <= 0) throw new Error('Speed must be a positive number.');
      return speed;
    }

    const key = String(speed);
    if (SPEED_PRESETS[key] !== undefined) {
      return SPEED_PRESETS[key];
    }

    const parsed = parseFloat(key);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    throw new Error(
      `Invalid speed "${speed}". Use: ${VALID_SPEED_KEYS.join(', ')}, or a positive number.`
    );
  }

  _scheduleNext(index) {
    this._clearTimer();

    if (!this._session || index >= this._session.events.length) {
      this._emitEnd();
      return;
    }

    if (this._paused) return;

    const delay = this._calcDelay(index);

    this._timerId = setTimeout(() => {
      if (this._paused) return;

      this._currentIndex = index;
      const event = this._session.events[index];
      this._previousTimestamp = event.timestamp;

      this.emit('step', event, this.getCurrentPosition());
      if (this._onStep) this._onStep(event, this.getCurrentPosition());

      this._scheduleNext(index + 1);
    }, delay);
  }

  _playAllImmediate() {
    const events = this._session.events;
    const total = events.length;

    for (let i = this._currentIndex + 1; i < total; i++) {
      if (this._paused) return;
      this._currentIndex = i;
      this._previousTimestamp = events[i].timestamp;
      this.emit('step', events[i], this.getCurrentPosition());
      if (this._onStep) this._onStep(events[i], this.getCurrentPosition());
    }

    if (!this._paused) {
      this._emitEnd();
    }
  }

  _calcDelay(nextIndex) {
    if (nextIndex === 0 || !this._previousTimestamp) {
      return 0;
    }

    const events = this._session.events;
    const prevTime = new Date(this._previousTimestamp).getTime();
    const nextTime = new Date(events[nextIndex].timestamp).getTime();
    const originalDelay = nextTime - prevTime;

    if (originalDelay <= 0) return 0;

    const clamped = Math.min(originalDelay, 60000);
    return clamped / this._speed;
  }

  _clearTimer() {
    if (this._timerId) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
  }

  _emitEnd() {
    if (this._session) {
      this._currentIndex = this._session.events.length - 1;
    }
    this._clearTimer();
    this.emit('end', this.getCurrentPosition());
    if (this._onEnd) this._onEnd(this.getCurrentPosition());
  }
}

module.exports = {
  ReplayEngine,
  SPEED_PRESETS,
};
