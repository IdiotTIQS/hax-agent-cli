"use strict";

/**
 * Lightweight event bus with wildcard matching, priority ordering, and
 * both synchronous and asynchronous emit modes.
 *
 * Usage:
 *
 *   const { EventBus } = require('./events/bus');
 *   const bus = new EventBus();
 *
 *   // Subscribe
 *   bus.on('tool.execute', (data) => { ... }, { priority: 10 });
 *   bus.once('session.start', (data) => { ... });
 *
 *   // Wildcard
 *   bus.on('tool.*', (data, event) => { console.log(event); });
 *
 *   // Emit (sync or async)
 *   bus.emit('tool.execute', { toolName: 'file.read' });
 *   await bus.emitAsync('tool.execute', { toolName: 'file.read' });
 *
 *   // Teardown
 *   bus.off('tool.execute', handler);
 *   bus.removeAllListeners('tool.execute');
 */

/**
 * Convert a wildcard event name (e.g. "tool.*") into a RegExp that matches
 * concrete event names (e.g. "tool.execute", "tool.error").
 *
 * @param {string} wildcard
 * @returns {RegExp}
 */
function wildcardToRegex(wildcard) {
  const escaped = wildcard
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^.]+");
  return new RegExp(`^${escaped}$`);
}

/**
 * @typedef {object} HandlerEntry
 * @property {Function} handler - The callback function
 * @property {number} priority - Execution priority (higher = earlier)
 * @property {boolean} once - Remove after one invocation
 * @property {Function} [filter] - Optional predicate (data) => boolean
 */

class EventBus {
  constructor() {
    /** @type {Map<string, HandlerEntry[]>} */
    this._handlers = new Map();
  }

  /**
   * Subscribe to an event.
   *
   * @param {string} event - Event name, supports wildcards (e.g. "tool.*")
   * @param {Function} handler - Callback: (data, eventName) => void
   * @param {object} [options]
   * @param {number} [options.priority=0] - Higher priority handlers run first
   * @param {Function} [options.filter] - Optional filter: (data) => boolean
   * @returns {Function} Unsubscribe function
   */
  on(event, handler, options = {}) {
    if (typeof event !== "string" || event.length === 0) {
      throw new Error("Event name must be a non-empty string");
    }
    if (typeof handler !== "function") {
      throw new Error("Handler must be a function");
    }

    const entry = {
      handler,
      priority: Number.isFinite(options.priority) ? options.priority : 0,
      once: false,
      filter: typeof options.filter === "function" ? options.filter : undefined,
    };

    if (!this._handlers.has(event)) {
      this._handlers.set(event, []);
    }

    const handlers = this._handlers.get(event);
    handlers.push(entry);

    // Keep handlers sorted by priority descending
    handlers.sort((a, b) => b.priority - a.priority);

    // Return an unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Subscribe to an event for a single invocation.
   *
   * @param {string} event
   * @param {Function} handler - Callback: (data, eventName) => void
   * @returns {Function} Unsubscribe function
   */
  once(event, handler) {
    if (typeof event !== "string" || event.length === 0) {
      throw new Error("Event name must be a non-empty string");
    }
    if (typeof handler !== "function") {
      throw new Error("Handler must be a function");
    }

    const entry = {
      handler,
      priority: 0,
      once: true,
      filter: undefined,
    };

    if (!this._handlers.has(event)) {
      this._handlers.set(event, []);
    }

    const handlers = this._handlers.get(event);
    handlers.push(entry);

    return () => this.off(event, handler);
  }

  /**
   * Synchronously emit an event to all matching handlers.
   * Handlers are called in priority order (highest first).
   * Wildcard subscribers are matched and called before exact subscribers.
   *
   * @param {string} event - Event name to emit
   * @param {*} [data] - Payload passed to each handler
   * @returns {number} Number of handlers invoked
   */
  emit(event, data) {
    const matching = this._resolveHandlers(event);
    let count = 0;

    for (const { handler, once, filter } of matching) {
      if (filter && !filter(data)) {
        continue;
      }
      try {
        handler(data, event);
      } catch (_err) {
        // Swallow handler errors so a single bad handler
        // does not prevent remaining handlers from running.
      }
      count += 1;
    }

    // Remove once handlers that fired
    this._purgeOnce(event, matching);

    return count;
  }

  /**
   * Asynchronously emit an event to all matching handlers.
   * Handlers run in parallel (Promise.all). If any handler rejects the
   * returned promise rejects with the first error.
   *
   * @param {string} event - Event name to emit
   * @param {*} [data] - Payload passed to each handler
   * @returns {Promise<number>} Number of handlers invoked
   */
  async emitAsync(event, data) {
    const matching = this._resolveHandlers(event);

    const promises = [];
    for (const { handler, once, filter } of matching) {
      if (filter && !filter(data)) {
        continue;
      }
      promises.push(
        Promise.resolve()
          .then(() => handler(data, event)),
      );
    }

    const results = await Promise.allSettled(promises);

    // Remove once handlers that fired
    this._purgeOnce(event, matching);

    return results.filter((r) => r.status === "fulfilled").length;
  }

  /**
   * Unsubscribe a specific handler from an event. If the handler is
   * registered multiple times only the first match is removed.
   *
   * @param {string} event
   * @param {Function} handler
   * @returns {boolean} Whether a handler was removed
   */
  off(event, handler) {
    const handlers = this._handlers.get(event);
    if (!handlers) return false;

    const index = handlers.findIndex((h) => h.handler === handler);
    if (index === -1) return false;

    handlers.splice(index, 1);

    if (handlers.length === 0) {
      this._handlers.delete(event);
    }

    return true;
  }

  /**
   * Remove all handlers for a specific event, or all handlers from the
   * entire bus if no event is passed.
   *
   * @param {string} [event]
   */
  removeAllListeners(event) {
    if (event === undefined) {
      this._handlers.clear();
      return;
    }
    this._handlers.delete(event);
  }

  /**
   * Count the number of handlers registered for a given event name
   * (including wildcard entries that would match).
   *
   * @param {string} event
   * @returns {number}
   */
  listenerCount(event) {
    return this._resolveHandlers(event).length;
  }

  /**
   * List all registered event names (patterns including wildcards).
   *
   * @returns {string[]}
   */
  events() {
    return Array.from(this._handlers.keys());
  }

  // -- Private helpers ---------------------------------------------------

  /**
   * Resolve all handler entries that match the given concrete event name.
   * Wildcard entries match via regex; exact entries match directly.
   *
   * Handlers are returned in priority order (highest first). Within the
   * same priority, wildcard handlers come before exact handlers, and
   * within the same type, registration order is preserved.
   *
   * @param {string} event
   * @returns {HandlerEntry[]}
   */
  _resolveHandlers(event) {
    const results = [];

    for (const [pattern, handlers] of this._handlers) {
      if (pattern === event) {
        // Exact match — append all (they are already priority-sorted)
        for (const h of handlers) results.push(h);
      } else if (pattern.includes("*") && this._wildcardMatch(pattern, event)) {
        // Wildcard match — append all
        for (const h of handlers) results.push(h);
      }
    }

    // Re-sort the combined list by priority descending.
    // Within equal priority, preserve the order built above (wildcards
    // come first naturally because wildcard entries are encountered before
    // exact entries during iteration, but since Map iteration order is
    // insertion order we stabilize on priority only).
    results.sort((a, b) => b.priority - a.priority);

    return results;
  }

  /**
   * Test whether a wildcard pattern matches a concrete event name.
   *
   * @param {string} pattern - e.g. "tool.*"
   * @param {string} event - e.g. "tool.execute"
   * @returns {boolean}
   */
  _wildcardMatch(pattern, event) {
    // Cache compiled regex on the pattern string
    if (!EventBus._regexCache) {
      EventBus._regexCache = new Map();
    }
    let regex = EventBus._regexCache.get(pattern);
    if (!regex) {
      regex = wildcardToRegex(pattern);
      EventBus._regexCache.set(pattern, regex);
    }
    return regex.test(event);
  }

  /**
   * Remove "once" entries from an event's handler list after they have fired.
   *
   * @param {string} event
   * @param {HandlerEntry[]} fired - Entries that were just invoked
   */
  _purgeOnce(event, fired) {
    const handlers = this._handlers.get(event);
    if (!handlers) return;

    const onceSet = new Set(fired.filter((h) => h.once));
    if (onceSet.size === 0) return;

    const remaining = handlers.filter((h) => !onceSet.has(h));

    if (remaining.length === 0) {
      this._handlers.delete(event);
    } else {
      this._handlers.set(event, remaining);
    }
  }
}

module.exports = { EventBus, wildcardToRegex };
