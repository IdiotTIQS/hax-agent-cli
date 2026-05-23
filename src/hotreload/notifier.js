"use strict";

const VALID_COMPONENTS = new Set([
  "renderer",
  "permissionManager",
  "toolRegistry",
  "session",
]);

/**
 * Dispatches configuration-change events to subscribed components.
 *
 * Two event patterns are used:
 *   - "config.changed"       — broad, fired for every change
 *   - "config.{section}.changed" — narrow, fired per changed section
 */
class ConfigNotifier {
  constructor() {
    /** @type {Map<string, Array<{component: string, handler: Function}>>} */
    this._subscribers = new Map();

    /** @type {Array<{
     *   timestamp: string,
     *   changes: Array<{section: string, oldVal: *, newVal: *}>
     * }>} */
    this._changeLog = [];

    /** @type {Array<Function>} */
    this._wildcardHandlers = [];
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Notify subscribers about a batch of config changes.
   * @param {Array<{section: string, oldVal: *, newVal: *}>} changes
   */
  notifyChanges(changes) {
    if (!Array.isArray(changes)) {
      throw new TypeError("changes must be an array");
    }

    const timestamp = new Date().toISOString();
    const validChanges = [];

    for (const ch of changes) {
      if (!ch || typeof ch.section !== "string" || ch.section === "") continue;
      validChanges.push({
        section: ch.section,
        oldVal: ch.oldVal,
        newVal: ch.newVal,
      });
    }

    if (validChanges.length === 0) return;

    // Record in history.
    this._changeLog.push({ timestamp, changes: validChanges });

    // Broadcast the "config.changed" wildcard event.
    for (const handler of this._wildcardHandlers) {
      try {
        handler(validChanges, timestamp);
      } catch (_err) {
        // Swallow handler errors.
      }
    }

    // Broadcast per-section events: "config.{section}.changed".
    for (const ch of validChanges) {
      this.broadcast(ch.section, ch.oldVal, ch.newVal, timestamp);
    }
  }

  /**
   * Subscribe a component to config changes.
   *
   * The handler receives (section, oldVal, newVal, timestamp) when a change
   * to the subscribed section occurs. If no section is provided, the handler
   * listens to *all* config.changed events.
   *
   * @param {string} component - one of the recognised component names
   * @param {Function} handler
   * @param {string} [section] - if omitted, subscribes to all sections
   */
  subscribe(component, handler, section) {
    if (!VALID_COMPONENTS.has(component)) {
      throw new Error(
        `Unknown component "${component}". Must be one of: ${[...VALID_COMPONENTS].join(", ")}`,
      );
    }
    if (typeof handler !== "function") {
      throw new TypeError("handler must be a function");
    }

    if (!section) {
      this._wildcardHandlers.push(handler);
      return;
    }

    if (!this._subscribers.has(section)) {
      this._subscribers.set(section, []);
    }

    this._subscribers.get(section).push({ component, handler });
  }

  /**
   * Broadcast a section-level change to all matching subscribers.
   * Also fires "config.changed" for wildcard listeners.
   * @param {string} section
   * @param {*} oldVal
   * @param {*} newVal
   * @param {string} [timestamp] - ISO timestamp, auto-generated if omitted
   */
  broadcast(section, oldVal, newVal, timestamp) {
    const ts = timestamp || new Date().toISOString();

    // Notify section-specific subscribers.
    const subs = this._subscribers.get(section);
    if (subs) {
      for (const { handler } of subs) {
        try {
          handler(section, oldVal, newVal, ts);
        } catch (_err) {
          // Swallow handler errors.
        }
      }
    }
  }

  /**
   * Return the full history of config changes.
   * @param {{ since?: string, limit?: number }} [opts]
   * @returns {Array<object>}
   */
  getChangeLog(opts = {}) {
    let log = [...this._changeLog];

    if (opts.since) {
      log = log.filter((entry) => entry.timestamp >= opts.since);
    }

    if (typeof opts.limit === "number" && opts.limit > 0) {
      log = log.slice(-opts.limit);
    }

    return log;
  }

  /**
   * Clear all change history and subscriber state.
   */
  reset() {
    this._subscribers.clear();
    this._wildcardHandlers = [];
    this._changeLog = [];
  }
}

module.exports = { ConfigNotifier, VALID_COMPONENTS };
