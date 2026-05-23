"use strict";

/**
 * CITriggerManager — registers and fires CI pipeline triggers.
 *
 * Supports four trigger types:
 *   - push  : code pushed to repository
 *   - schedule : cron-based recurring trigger
 *   - pull_request : PR opened / updated
 *   - manual : on-demand with optional parameters
 *
 * Each trigger stores its handler and metadata.  Fire a trigger to get
 * back the handler result (typically a pipeline run summary).
 */

const { EventEmitter } = require("node:events");

const TRIGGER_TYPES = new Set(["push", "schedule", "pull_request", "manual"]);

class TriggerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TriggerError";
    this.code = String(code);
  }
}

class CITriggerManager extends EventEmitter {
  constructor() {
    super();
    this._triggers = new Map();  // triggerId -> trigger entry
    this._triggerCounter = 0;
  }

  /**
   * Register a push trigger.
   * @param {function} handler - async (event) => result
   *   event: { type: 'push', branch, commit, author, message, files, timestamp }
   * @param {{ name?: string, enabled?: boolean }} [options]
   * @returns {string} trigger id
   */
  onPush(handler, options = {}) {
    return this._register("push", handler, options);
  }

  /**
   * Register a schedule (cron) trigger.
   * @param {string} cron - Cron-style expression (validates simple patterns).
   * @param {function} handler - async (event) => result
   *   event: { type: 'schedule', cron, timestamp }
   * @param {{ name?: string, enabled?: boolean }} [options]
   * @returns {string} trigger id
   */
  onSchedule(cron, handler, options = {}) {
    if (typeof cron !== "string" || cron.trim().length === 0) {
      throw new TriggerError("INVALID_CRON", "Cron expression must be a non-empty string.");
    }

    // Basic validation: must have 5 parts (min hour dom month dow)
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5 && parts.length !== 6) {
      throw new TriggerError(
        "INVALID_CRON",
        `Cron expression must have 5 or 6 parts, got ${parts.length}.`
      );
    }

    return this._register("schedule", handler, {
      ...options,
      cron: cron.trim(),
    });
  }

  /**
   * Register a pull-request trigger.
   * @param {function} handler - async (event) => result
   *   event: { type: 'pull_request', action, branch, targetBranch, prNumber, author, title, timestamp }
   * @param {{ name?: string, enabled?: boolean }} [options]
   * @returns {string} trigger id
   */
  onPullRequest(handler, options = {}) {
    return this._register("pull_request", handler, options);
  }

  /**
   * Register a manual (on-demand) trigger.
   * @param {string} name - Unique name for this manual trigger.
   * @param {function} [handler] - async (params) => result, optional handler
   * @param {{ enabled?: boolean }} [options]
   * @returns {string} trigger id
   */
  onDemand(name, handler = null, options = {}) {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new TriggerError("INVALID_NAME", "Manual trigger name must be a non-empty string.");
    }

    return this._register("manual", handler || ((params) => params), {
      ...options,
      manualName: name.trim(),
    });
  }

  /**
   * Fire a trigger by its id.
   * @param {string} triggerId
   * @param {object} [eventPayload] - Data to pass to the handler.
   * @returns {Promise<*>} handler result.
   */
  async fire(triggerId, eventPayload = {}) {
    const entry = this._triggers.get(triggerId);
    if (!entry) {
      throw new TriggerError("NOT_FOUND", `Trigger not found: ${triggerId}`);
    }

    if (!entry.enabled) {
      throw new TriggerError("DISABLED", `Trigger "${triggerId}" is disabled.`);
    }

    const event = this._buildEvent(entry, eventPayload);

    this.emit("trigger.start", {
      triggerId,
      type: entry.type,
      name: entry.name,
      event,
    });

    const startedAt = Date.now();
    let result;
    let error;

    try {
      result = await entry.handler(event);
    } catch (err) {
      error = err;
    }

    const duration = Date.now() - startedAt;

    if (error) {
      const serialized = serializeError(error);
      this.emit("trigger.error", {
        triggerId,
        type: entry.type,
        name: entry.name,
        error: serialized,
        duration,
      });

      entry.lastRun = {
        status: "error",
        error: serialized,
        timestamp: new Date().toISOString(),
        duration,
      };

      throw error;
    }

    entry.lastRun = {
      status: "success",
      timestamp: new Date().toISOString(),
      duration,
    };

    this.emit("trigger.complete", {
      triggerId,
      type: entry.type,
      name: entry.name,
      result,
      duration,
    });

    return result;
  }

  /**
   * Fire a manual trigger by its registered name.
   * @param {string} name - The manualName given when calling onDemand().
   * @param {object} [params] - Parameters to pass to the handler.
   * @returns {Promise<*>}
   */
  async fireDemand(name, params = {}) {
    const entry = this._findManualByName(name);
    if (!entry) {
      throw new TriggerError("NOT_FOUND", `Manual trigger not found: ${name}`);
    }

    return this.fire(entry.id, { params });
  }

  /**
   * Bulk fire: fire all triggers of a given type with the same payload.
   * @param {string} type - One of: push, schedule, pull_request, manual
   * @param {object} [eventPayload]
   * @returns {Promise<Array<{ triggerId, status, result?, error? }>>}
   */
  async fireAll(type, eventPayload = {}) {
    if (!TRIGGER_TYPES.has(type)) {
      throw new TriggerError(
        "INVALID_TYPE",
        `Unknown trigger type "${type}". Must be one of: ${[...TRIGGER_TYPES].join(", ")}.`
      );
    }

    const matches = this.getTriggers().filter((t) => t.type === type);
    const results = [];

    for (const match of matches) {
      try {
        const result = await this.fire(match.id, eventPayload);
        results.push({ triggerId: match.id, status: "success", result });
      } catch (err) {
        results.push({
          triggerId: match.id,
          status: "error",
          error: serializeError(err),
        });
      }
    }

    return results;
  }

  /**
   * Check if a cron expression matches a given date.
   * Supports: *, number, comma-separated, dash-range, step (/).
   * @param {string} cronExpr - "min hour dom month dow" (5 parts)
   * @param {Date} [date] - defaults to now
   * @returns {boolean}
   */
  matchesCron(cronExpr, date = new Date()) {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5 && parts.length !== 6) {
      return false;
    }

    // seconds are optional (part 0 when 6 parts)
    const offset = parts.length === 6 ? 1 : 0;

    let fieldIndex = 0;

    // Validate seconds if 6-part cron
    if (offset === 1) {
      if (!this._cronFieldMatches(parts[0], date.getSeconds())) {
        return false;
      }
    }

    const fields = [
      parts[offset],     // minute
      parts[offset + 1], // hour
      parts[offset + 2], // dom
      parts[offset + 3], // month
      parts[offset + 4], // dow
    ];
    const values = [
      date.getMinutes(),
      date.getHours(),
      date.getDate(),
      date.getMonth() + 1,
      date.getDay(),
    ];

    for (let i = 0; i < fields.length; i++) {
      if (!this._cronFieldMatches(fields[i], values[i])) {
        return false;
      }
    }

    return true;
  }

  /**
   * Return all registered triggers.
   * @returns {Array<object>}
   */
  getTriggers() {
    const results = [];
    for (const [id, entry] of this._triggers) {
      results.push({
        id,
        type: entry.type,
        name: entry.name,
        enabled: entry.enabled,
        createdAt: entry.createdAt,
        lastRun: entry.lastRun,
        ...(entry.cron ? { cron: entry.cron } : {}),
        ...(entry.manualName ? { manualName: entry.manualName } : {}),
      });
    }
    return results;
  }

  /**
   * Enable a trigger.
   * @param {string} triggerId
   */
  enable(triggerId) {
    const entry = this._triggers.get(triggerId);
    if (!entry) {
      throw new TriggerError("NOT_FOUND", `Trigger not found: ${triggerId}`);
    }
    entry.enabled = true;
    this.emit("trigger.enable", { triggerId, name: entry.name });
  }

  /**
   * Disable a trigger.
   * @param {string} triggerId
   */
  disable(triggerId) {
    const entry = this._triggers.get(triggerId);
    if (!entry) {
      throw new TriggerError("NOT_FOUND", `Trigger not found: ${triggerId}`);
    }
    entry.enabled = false;
    this.emit("trigger.disable", { triggerId, name: entry.name });
  }

  /**
   * Remove a trigger entirely.
   * @param {string} triggerId
   * @returns {boolean}
   */
  remove(triggerId) {
    return this._triggers.delete(triggerId);
  }

  /**
   * Total number of registered triggers.
   */
  get count() {
    return this._triggers.size;
  }

  // ---- Internal ----

  _register(type, handler, options) {
    if (!TRIGGER_TYPES.has(type)) {
      throw new TriggerError(
        "INVALID_TYPE",
        `Unknown trigger type "${type}". Must be one of: ${[...TRIGGER_TYPES].join(", ")}.`
      );
    }

    if (typeof handler !== "function") {
      throw new TriggerError("INVALID_HANDLER", `Trigger handler must be a function, got ${typeof handler}.`);
    }

    this._triggerCounter += 1;
    const id = `trigger-${Date.now().toString(36)}-${this._triggerCounter}`;

    const entry = {
      id,
      type,
      name: options.name || `${type}-${this._triggerCounter}`,
      enabled: options.enabled !== undefined ? Boolean(options.enabled) : true,
      handler,
      createdAt: new Date().toISOString(),
      lastRun: null,
      cron: options.cron || null,
      manualName: options.manualName || null,
    };

    this._triggers.set(id, entry);

    this.emit("trigger.register", {
      triggerId: id,
      type,
      name: entry.name,
      enabled: entry.enabled,
    });

    return id;
  }

  _findManualByName(name) {
    for (const [, entry] of this._triggers) {
      if (entry.manualName === name) {
        return entry;
      }
    }
    return null;
  }

  _buildEvent(entry, payload = {}) {
    const base = {
      type: entry.type,
      timestamp: new Date().toISOString(),
    };

    switch (entry.type) {
      case "push":
        return {
          ...base,
          branch: payload.branch || "main",
          commit: payload.commit || "",
          author: payload.author || "",
          message: payload.message || "",
          files: payload.files || [],
        };

      case "schedule":
        return {
          ...base,
          cron: entry.cron || payload.cron || "",
        };

      case "pull_request":
        return {
          ...base,
          action: payload.action || "opened",
          branch: payload.branch || "",
          targetBranch: payload.targetBranch || "main",
          prNumber: payload.prNumber || null,
          author: payload.author || "",
          title: payload.title || "",
        };

      case "manual":
        return {
          ...base,
          params: payload.params || {},
        };

      default:
        return { ...base, ...payload };
    }
  }

  _cronFieldMatches(pattern, value) {
    if (pattern === "*") return true;

    // Comma-separated list
    const parts = pattern.split(",");
    for (const part of parts) {
      if (this._cronPartMatches(part.trim(), value)) {
        return true;
      }
    }
    return false;
  }

  _cronPartMatches(part, value) {
    // Step: */2 or 0/15
    let step = 1;
    if (part.includes("/")) {
      const [rangeStr, stepStr] = part.split("/");
      step = parseInt(stepStr, 10);
      if (!Number.isSafeInteger(step) || step <= 0) return false;

      if (rangeStr === "*") {
        return value % step === 0;
      }

      return this._rangeMatches(rangeStr, value, step);
    }

    // Range: 1-5
    if (part.includes("-")) {
      return this._rangeMatches(part, value, 1);
    }

    // Single value
    const num = parseInt(part, 10);
    return Number.isSafeInteger(num) && num === value;
  }

  _rangeMatches(rangePart, value, step) {
    const [startStr, endStr] = rangePart.split("-");
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return false;

    for (let v = start; v <= end; v += step) {
      if (v === value) return true;
    }
    return false;
  }
}

// ---- helpers ----

function serializeError(err) {
  if (err instanceof Error) {
    return {
      name: err.name || "Error",
      message: err.message,
      stack: err.stack,
      code: err.code,
    };
  }
  if (err && typeof err === "object") {
    return { name: "Error", message: JSON.stringify(err) };
  }
  return { name: "Error", message: String(err || "Unknown error") };
}

module.exports = { CITriggerManager, TriggerError, TRIGGER_TYPES };
