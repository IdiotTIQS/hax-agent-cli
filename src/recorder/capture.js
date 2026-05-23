"use strict";

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RECORDING_VERSION = 1;

const VALID_EVENT_TYPES = new Set([
  'user_message',
  'assistant_response',
  'tool_call',
  'tool_result',
  'error',
  'state_change',
]);

class SessionRecorder {
  constructor(options = {}) {
    this._recording = null;
    this._startTime = null;
    this._options = options;
  }

  /**
   * Begin recording a session.
   * @param {object} session - The session object to record.
   */
  start(session) {
    if (this._recording) {
      throw new Error('SessionRecorder is already recording. Call stop() first.');
    }

    const now = new Date().toISOString();

    this._recording = {
      version: RECORDING_VERSION,
      metadata: {
        id: crypto.randomUUID(),
        sessionId: session?.id || '',
        provider: session?.provider?.name || '',
        model: session?.provider?.model || '',
        recordingStartedAt: now,
        nodeVersion: process.version,
        platform: process.platform,
      },
      events: [],
      startTime: now,
      endTime: null,
    };

    this._startTime = Date.now();
  }

  /**
   * Stop recording and finalize the capture.
   */
  stop() {
    if (!this._recording) {
      throw new Error('SessionRecorder is not recording. Call start() first.');
    }

    this._recording.endTime = new Date().toISOString();
    const recording = this._recording;
    this._recording = null;
    this._startTime = null;

    return recording;
  }

  /**
   * Record a single event.
   * @param {object} event - The event to record.
   * @param {string} event.type - One of: user_message, assistant_response, tool_call, tool_result, error, state_change.
   * @param {*} event.data - The event payload.
   * @param {object} [event.context] - Optional context (e.g. turn number, token counts).
   */
  recordEvent(event) {
    if (!this._recording) {
      throw new Error('SessionRecorder is not recording. Call start() first.');
    }

    if (!event || typeof event !== 'object') {
      throw new Error('Event must be an object.');
    }

    const type = String(event.type || '').trim();
    if (!type || !VALID_EVENT_TYPES.has(type)) {
      throw new Error(
        `Invalid event type "${type}". Must be one of: ${[...VALID_EVENT_TYPES].join(', ')}`
      );
    }

    const recorded = {
      type,
      timestamp: new Date().toISOString(),
      data: event.data !== undefined ? event.data : null,
      context: event.context !== undefined ? event.context : {},
    };

    this._recording.events.push(recorded);
    return recorded;
  }

  /**
   * Return the full recording object.
   */
  getRecording() {
    if (!this._recording) {
      return null;
    }

    return {
      ...this._recording,
      events: [...this._recording.events],
    };
  }

  /**
   * Save the recording to a file.
   * @param {string} outputPath - File path to write the recording to.
   */
  save(outputPath) {
    const recording = this.getRecording();
    if (!recording) {
      throw new Error('No recording to save. Call start() and record some events first.');
    }

    const resolvedPath = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, JSON.stringify(recording, null, 2), 'utf8');

    return resolvedPath;
  }

  /**
   * Returns true if the recorder is actively recording.
   */
  isRecording() {
    return this._recording !== null;
  }

  /**
   * Returns the number of events recorded so far.
   */
  eventCount() {
    return this._recording ? this._recording.events.length : 0;
  }

  /**
   * Returns elapsed time since recording started (in milliseconds), or 0.
   */
  elapsedMs() {
    return this._startTime ? Date.now() - this._startTime : 0;
  }
}

module.exports = {
  SessionRecorder,
  RECORDING_VERSION,
  VALID_EVENT_TYPES,
};
