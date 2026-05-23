"use strict";

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const SPEED_PRESETS = {
  '1x': 1,
  '2x': 2,
  '5x': 5,
  '10x': 10,
  MAX: Infinity,
};

class SessionPlayer extends EventEmitter {
  constructor() {
    super();
    this._recording = null;
    this._currentIndex = -1;
    this._paused = false;
    this._speed = 1;
    this._timerId = null;
    this._startedAt = null;
    this._previousTimestamp = null;
  }

  /**
   * Load a recording from a file path.
   * @param {string} recordingPath - Path to the recording JSON file.
   */
  load(recordingPath) {
    const resolvedPath = path.resolve(recordingPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Recording file not found: ${resolvedPath}`);
    }

    const raw = fs.readFileSync(resolvedPath, 'utf8');

    let recording;
    try {
      recording = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Invalid recording JSON in ${resolvedPath}: ${err.message}`);
    }

    this._validateRecording(recording);

    this._recording = recording;
    this._currentIndex = -1;
    this._paused = false;
    this._speed = 1;
    this._prevTimestamp = null;
    this.resetTimer();
  }

  /**
   * Replay the session from the current position.
   * @param {object} [options]
   * @param {string|number} [options.speed='1x'] - Playback speed.
   * @param {number} [options.from] - Start from a specific event index.
   */
  play(options = {}) {
    if (!this._recording) {
      throw new Error('No recording loaded. Call load() first.');
    }

    const speed = this._resolveSpeed(options.speed);
    const fromIndex = typeof options.from === 'number' ? Math.max(0, options.from) : this._currentIndex + 1;

    if (fromIndex >= this._recording.events.length) {
      this._currentIndex = this._recording.events.length - 1;
      this.emit('end', this._getProgress());
      return;
    }

    this._speed = speed;
    this._paused = false;
    this._currentIndex = Math.max(-1, fromIndex - 1);
    this._previousTimestamp = null;

    if (speed === Infinity) {
      // MAX speed: emit all events immediately
      this._playAllImmediate();
    } else {
      this._scheduleNext(fromIndex);
    }
  }

  /**
   * Advance one event. Emits 'step' with the event, or 'end'.
   */
  step() {
    if (!this._recording) {
      throw new Error('No recording loaded. Call load() first.');
    }

    if (this._currentIndex >= this._recording.events.length - 1) {
      this.emit('end', this._getProgress());
      return null;
    }

    this._currentIndex += 1;
    const event = this._recording.events[this._currentIndex];
    this.emit('step', event, this._getProgress());
    return event;
  }

  /**
   * Jump to a specific timestamp.
   * @param {string} timestamp - ISO timestamp to seek to.
   */
  seek(timestamp) {
    if (!this._recording) {
      throw new Error('No recording loaded. Call load() first.');
    }

    this.resetTimer();

    const targetTime = new Date(timestamp).getTime();
    if (Number.isNaN(targetTime)) {
      throw new Error(`Invalid timestamp: ${timestamp}`);
    }

    let foundIndex = -1;
    for (let i = 0; i < this._recording.events.length; i++) {
      const eventTime = new Date(this._recording.events[i].timestamp).getTime();
      if (eventTime <= targetTime) {
        foundIndex = i;
      } else {
        break;
      }
    }

    this._currentIndex = foundIndex;
    this.emit('seek', this._getProgress());
    return this._getProgress();
  }

  /**
   * Pause playback.
   */
  pause() {
    this._paused = true;
    this.resetTimer();
    this.emit('pause', this._getProgress());
  }

  /**
   * Resume playback from the current position.
   */
  resume() {
    if (!this._paused) return;
    this._paused = false;
    if (this._speed === Infinity) {
      this._playAllImmediate();
    } else {
      this._scheduleNext(this._currentIndex + 1);
    }
  }

  /**
   * Reset playback to the beginning.
   */
  reset() {
    this.resetTimer();
    this._currentIndex = -1;
    this._paused = false;
    this._speed = 1;
    this._previousTimestamp = null;
  }

  /**
   * Get the current event (or null if at start).
   */
  getCurrentEvent() {
    if (!this._recording || this._currentIndex < 0) {
      return null;
    }

    return this._recording.events[this._currentIndex];
  }

  /**
   * Get playback progress.
   * @returns {{ current: number, total: number, percent: number, elapsed, remaining }}
   */
  getProgress() {
    return this._getProgress();
  }

  // ---- private ----

  _getProgress() {
    if (!this._recording) {
      return { current: 0, total: 0, percent: 0, elapsed: 0, remaining: 0 };
    }

    const total = this._recording.events.length;
    const current = Math.max(0, this._currentIndex + 1);

    return {
      current,
      total,
      percent: total > 0 ? Math.round((current / total) * 100) : 0,
      elapsed: this._startedAt ? Date.now() - this._startedAt : 0,
      remaining: total === 0 ? 0 : Math.max(0, total - current),
    };
  }

  _validateRecording(recording) {
    if (!recording || typeof recording !== 'object') {
      throw new Error('Recording must be an object.');
    }
    if (!Array.isArray(recording.events)) {
      throw new Error('Recording must have an "events" array.');
    }
    if (!recording.version) {
      throw new Error('Recording must have a "version" field.');
    }
    for (let i = 0; i < recording.events.length; i++) {
      const evt = recording.events[i];
      if (!evt.type || !evt.timestamp) {
        throw new Error(`Invalid event at index ${i}: missing type or timestamp.`);
      }
    }
  }

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

    throw new Error(`Invalid speed "${speed}". Use: 1x, 2x, 5x, 10x, MAX, or a positive number.`);
  }

  _scheduleNext(index) {
    this.resetTimer();

    if (index >= this._recording.events.length) {
      this.emit('end', this._getProgress());
      return;
    }

    if (this._paused) {
      return;
    }

    const delay = this._calculateDelay(index);
    this._timerId = setTimeout(() => {
      this._currentIndex = index;
      const event = this._recording.events[index];
      this._previousTimestamp = event.timestamp;
      this.emit('step', event, this._getProgress());

      this._scheduleNext(index + 1);
    }, delay);
  }

  _playAllImmediate() {
    const startIndex = Math.max(0, this._currentIndex + 1);

    if (startIndex >= this._recording.events.length) {
      if (!this._paused) this.emit('end', this._getProgress());
      return;
    }

    for (let i = startIndex; i < this._recording.events.length; i++) {
      if (this._paused) return;
      this._currentIndex = i;
      this.emit('step', this._recording.events[i], this._getProgress());
    }
    if (!this._paused) {
      this.emit('end', this._getProgress());
    }
  }

  _calculateDelay(nextIndex) {
    // First event: no delay
    if (nextIndex === 0 || !this._previousTimestamp) {
      return 0;
    }

    const prevTime = new Date(this._previousTimestamp).getTime();
    const nextTime = new Date(this._recording.events[nextIndex].timestamp).getTime();
    const originalDelay = nextTime - prevTime;

    // Clamp to reasonable bounds and apply speed divisor
    if (originalDelay <= 0) return 0;

    const clamped = Math.min(originalDelay, 60000); // max 60s per step
    return clamped / this._speed;
  }

  resetTimer() {
    if (this._timerId) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
  }
}

module.exports = {
  SessionPlayer,
  SPEED_PRESETS,
};
