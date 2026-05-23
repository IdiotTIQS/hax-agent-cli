/**
 * Notification triggers — react to agent lifecycle events and
 * environmental conditions, dispatching notifications through
 * a NotificationManager.
 *
 *   const engine = new TriggerEngine(manager);
 *   engine.register(createCompletionTrigger({ channels: ['desktop'] }));
 *   engine.onTaskComplete({ taskId: 't1', durationMs: 3200 });
 */
"use strict";

const { createNotification } = require("./channels");

// ---- Trigger factory functions ---------------------------------------------

/**
 * Fires a notification when an agent task completes successfully.
 *
 * @param {object} options
 * @param {string|string[]} [options.channels] - Target channel names
 * @param {string} [options.title='Task completed']
 * @param {Function} [options.messageFn] - (context) => message string
 * @param {number} [options.cooldownMs=0] - Ignore duplicate events within this window
 * @returns {object}
 */
function createCompletionTrigger(options = {}) {
  const cooldownMs = positiveInteger(options.cooldownMs, 0);

  return {
    type: "task.complete",
    channels: options.channels,
    cooldownMs,
    lastFired: 0,

    /** @param {object} context - { taskId, durationMs, result, ... } */
    condition(context) {
      return true; // always fires on completion
    },

    buildNotification(context) {
      const messageFn = options.messageFn || ((ctx) =>
        `Task "${ctx.taskId || "unknown"}" completed in ${formatDuration(ctx.durationMs)}.`
      );
      return {
        type: this.type,
        title: options.title || "Task completed",
        message: messageFn(context),
        severity: "info",
        data: context,
      };
    },
  };
}

/**
 * Fires on errors. Includes a severity threshold so transient
 * warnings do not flood notification channels.
 *
 * @param {object} options
 * @param {string|string[]} [options.channels]
 * @param {'warn'|'error'|'critical'} [options.minSeverity='error'] - Minimum severity to fire
 * @param {number} [options.cooldownMs=60000] - Default 60s between error alerts
 * @param {Function} [options.shouldFire] - (errorContext) => boolean override
 * @returns {object}
 */
function createErrorTrigger(options = {}) {
  const minSeverity = normalizeSeverity(options.minSeverity, "error");
  const cooldownMs = positiveInteger(options.cooldownMs, 60000);

  return {
    type: "task.error",
    channels: options.channels,
    cooldownMs,
    minSeverity,
    shouldFireOverride: options.shouldFire || null,
    lastFired: 0,

    condition(context) {
      if (this.shouldFireOverride) {
        return this.shouldFireOverride(context);
      }
      return severityRank(context.severity || "error") >= severityRank(this.minSeverity);
    },

    buildNotification(context) {
      const msg = context.message || context.error?.message || "An unknown error occurred";
      return {
        type: this.type,
        title: options.title || "Task error",
        message: String(msg),
        severity: context.severity || "error",
        data: context,
      };
    },
  };
}

/**
 * Fires if a task runs longer than a configured duration threshold.
 * The condition is evaluated when `checkDuration()` is called.
 *
 * @param {number} maxMinutes - Maximum allowed duration in minutes
 * @param {object} [options]
 * @param {string|string[]} [options.channels]
 * @param {boolean} [options.repeat=false] - Fire again after another threshold period
 * @param {number} [options.cooldownMs=300000] - 5 min default cooldown
 * @returns {object}
 */
function createDurationTrigger(maxMinutes, options = {}) {
  const thresholdMs = positiveInteger(maxMinutes, 0) * 60 * 1000;
  const repeat = options.repeat === true;

  return {
    type: "task.duration_warning",
    channels: options.channels,
    cooldownMs: positiveInteger(options.cooldownMs, 300000),
    thresholdMs,
    repeat,
    lastFired: 0,
    firedCount: 0,

    /** @param {object} context - { taskId, elapsedMs, ... } */
    condition(context) {
      const elapsed = positiveInteger(context.elapsedMs, 0);
      if (elapsed < this.thresholdMs) return false;

      if (this.repeat) {
        const exceededPeriods = Math.floor(elapsed / this.thresholdMs);
        return exceededPeriods > this.firedCount;
      }

      return true;
    },

    buildNotification(context) {
      const elapsedMin = Math.round(context.elapsedMs / 60000);
      const thresholdMin = Math.round(this.thresholdMs / 60000);
      return {
        type: this.type,
        title: options.title || "Duration threshold exceeded",
        message: `Task "${context.taskId || "unknown"}" has been running for ${elapsedMin} min (threshold: ${thresholdMin} min).`,
        severity: elapsedMin > thresholdMin * 3 ? "critical" : "warn",
        data: context,
      };
    },
  };
}

/**
 * Fires when token usage exceeds a configured threshold.
 *
 * @param {number} maxTokens - Maximum allowed token usage
 * @param {object} [options]
 * @param {string|string[]} [options.channels]
 * @param {number} [options.warningRatio=0.8] - Fire a warning at this fraction of maxTokens
 * @param {number} [options.cooldownMs=120000] - 2 min default
 * @returns {object}
 */
function createTokenThresholdTrigger(maxTokens, options = {}) {
  const maxT = positiveInteger(maxTokens, 0);
  const warningRatio = clamp(options.warningRatio, 0.1, 1, 0.8);
  const warningTokens = Math.floor(maxT * warningRatio);

  return {
    type: "task.token_threshold",
    channels: options.channels,
    cooldownMs: positiveInteger(options.cooldownMs, 120000),
    maxTokens: maxT,
    warningTokens,
    warningRatio,
    lastFired: 0,

    /** @param {object} context - { currentTokens, maxTokens, ... } */
    condition(context) {
      const current = positiveInteger(context.currentTokens, 0);
      return current >= maxT || current >= this.warningTokens;
    },

    buildNotification(context) {
      const current = positiveInteger(context.currentTokens, 0);
      const isOver = current >= this.maxTokens;
      return {
        type: this.type,
        title: options.title || (isOver ? "Token limit exceeded" : "Token usage warning"),
        message: `Token usage: ${current}/${this.maxTokens}${isOver ? " — LIMIT EXCEEDED" : ""}`,
        severity: isOver ? "critical" : "warn",
        data: context,
      };
    },
  };
}

/**
 * Fires when files matching given patterns are modified.
 *
 * The condition is evaluated externally — the caller is responsible
 * for comparing old and new file hashes / mtimes.
 *
 * @param {string|string[]} patterns - Glob patterns to watch
 * @param {object} [options]
 * @param {string|string[]} [options.channels]
 * @param {number} [options.cooldownMs=30000] - Debounce period in ms
 * @param {Function} [options.onChange] - Called with (files[]) for custom logic
 * @returns {object}
 */
function createFileChangeTrigger(patterns, options = {}) {
  const globs = Array.isArray(patterns) ? [...patterns] : [patterns];

  return {
    type: "file.change",
    channels: options.channels,
    cooldownMs: positiveInteger(options.cooldownMs, 30000),
    patterns: globs,
    onChange: options.onChange || null,
    lastFired: 0,

    /**
     * @param {object} context - { files: string[], ... }
     */
    condition(context) {
      const files = Array.isArray(context.files) ? context.files : [];
      if (files.length === 0) return false;

      // Check if any changed file matches the configured patterns
      return files.some((file) =>
        this.patterns.some((pattern) => simpleGlobMatch(file, pattern))
      );
    },

    buildNotification(context) {
      const fileList = (context.files || []).slice(0, 5);
      const more = (context.files || []).length > 5
        ? ` (+${context.files.length - 5} more)`
        : "";

      return {
        type: this.type,
        title: options.title || "File change detected",
        message: `Changed: ${fileList.join(", ")}${more}`,
        severity: "info",
        data: { ...context, matchedPatterns: this.patterns },
      };
    },
  };
}

// ---- TriggerEngine ---------------------------------------------------------

/**
 * Manages a collection of triggers, evaluates conditions, and fires
 * notifications through a NotificationManager.
 */
class TriggerEngine {
  /**
   * @param {object} notificationManager - NotificationManager instance
   * @param {object} [options]
   * @param {boolean} [options.autoCooldown=true] - Respect per-trigger cooldowns
   */
  constructor(notificationManager, options = {}) {
    if (!notificationManager || typeof notificationManager.notify !== "function") {
      throw new Error("TriggerEngine requires a NotificationManager instance");
    }
    this._manager = notificationManager;
    this._triggers = [];
    this._autoCooldown = options.autoCooldown !== false;
  }

  /**
   * Register a trigger.
   * @param {object} trigger - Trigger object from factory functions
   * @returns {object} trigger (for chaining)
   */
  register(trigger) {
    if (!trigger || typeof trigger.condition !== "function") {
      throw new Error("Trigger must have a `condition(context)` function");
    }
    this._triggers.push(trigger);
    return trigger;
  }

  /**
   * Remove a trigger by reference.
   * @param {object} trigger
   * @returns {boolean} true if removed
   */
  unregister(trigger) {
    const idx = this._triggers.indexOf(trigger);
    if (idx === -1) return false;
    this._triggers.splice(idx, 1);
    return true;
  }

  /**
   * Number of registered triggers.
   * @returns {number}
   */
  get count() {
    return this._triggers.length;
  }

  /**
   * Evaluate all triggers of a given type with the provided context.
   * Does NOT check cooldowns — intended for manual fire.
   *
   * @param {string} type - Event type
   * @param {object} context - Evaluation context
   * @returns {Promise<object[]>} Array of delivery results
   */
  async evaluate(type, context = {}) {
    const results = [];
    const matching = this._triggers.filter((t) => t.type === type);

    for (const trigger of matching) {
      if (!trigger.condition(context)) continue;

      const notification = trigger.buildNotification(context);
      let result;

      if (trigger.channels) {
        result = await this._manager.send(notification, trigger.channels);
      } else {
        result = await this._manager.notify(type, notification);
      }

      results.push({ trigger, result });
    }

    return results;
  }

  /**
   * Check all triggers of a given type, respecting cooldowns.
   * Only fires when the condition passes AND the cooldown period has elapsed.
   *
   * @param {string} type
   * @param {object} context
   * @returns {Promise<object[]>}
   */
  async check(type, context = {}) {
    const now = Date.now();
    const results = [];
    const matching = this._triggers.filter((t) => t.type === type);

    for (const trigger of matching) {
      if (!trigger.condition(context)) continue;

      if (this._autoCooldown && trigger.cooldownMs > 0) {
        if (now - trigger.lastFired < trigger.cooldownMs) continue;
        trigger.lastFired = now;
      }

      const notification = trigger.buildNotification(context);

      if (trigger.onChange && typeof trigger.onChange === "function") {
        try {
          trigger.onChange(context);
        } catch (_) {
          // onChange is best-effort, never block notification
        }
      }

      let result;
      if (trigger.channels) {
        result = await this._manager.send(notification, trigger.channels);
      } else {
        result = await this._manager.notify(type, notification);
      }

      if (trigger.firedCount !== undefined) {
        trigger.firedCount += 1;
      }

      results.push({ trigger, result });
    }

    return results;
  }

  // -- Convenience methods for common agent lifecycle events -----------------

  /**
   * Evaluate all "task.complete" triggers.
   * @param {object} context - { taskId, durationMs, result, ... }
   * @returns {Promise<object[]>}
   */
  async onTaskComplete(context = {}) {
    return this.check("task.complete", context);
  }

  /**
   * Evaluate all "task.error" triggers.
   * @param {object} context - { error, taskId, severity, ... }
   * @returns {Promise<object[]>}
   */
  async onTaskError(context = {}) {
    return this.check("task.error", context);
  }

  /**
   * Evaluate all "task.duration_warning" triggers.
   * @param {object} context - { taskId, elapsedMs, ... }
   * @returns {Promise<object[]>}
   */
  async onDurationCheck(context = {}) {
    return this.check("task.duration_warning", context);
  }

  /**
   * Evaluate all "task.token_threshold" triggers.
   * @param {object} context - { currentTokens, maxTokens, ... }
   * @returns {Promise<object[]>}
   */
  async onTokenCheck(context = {}) {
    return this.check("task.token_threshold", context);
  }

  /**
   * Evaluate all "file.change" triggers.
   * @param {object} context - { files: string[], ... }
   * @returns {Promise<object[]>}
   */
  async onFileChange(context = {}) {
    return this.check("file.change", context);
  }

  /**
   * Reset cooldown state for all triggers (useful for testing).
   */
  resetCooldowns() {
    for (const trigger of this._triggers) {
      trigger.lastFired = 0;
      if (trigger.firedCount !== undefined) {
        trigger.firedCount = 0;
      }
    }
  }

  /**
   * List all registered trigger types with counts.
   * @returns {object[]}
   */
  listTriggers() {
    const counts = {};
    for (const t of this._triggers) {
      counts[t.type] = (counts[t.type] || 0) + 1;
    }
    return Object.entries(counts).map(([type, count]) => ({ type, count }));
  }
}

// ---- Helpers ---------------------------------------------------------------

function positiveInteger(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function formatDuration(ms) {
  if (!ms || ms < 1000) return `${ms || 0}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 120) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}min`;
}

const SEVERITY_RANKS = { info: 0, warn: 1, error: 2, critical: 3 };

function severityRank(severity) {
  return SEVERITY_RANKS[String(severity).toLowerCase()] ?? 0;
}

function normalizeSeverity(value, fallback) {
  const lowered = String(value || fallback).toLowerCase();
  return SEVERITY_RANKS.hasOwnProperty(lowered) ? lowered : fallback;
}

/**
 * Simple glob matching supporting * wildcard (single-segment) and ** (multi-segment).
 */
function simpleGlobMatch(str, pattern) {
  if (pattern === "*" || pattern === "**") return true;
  if (!pattern.includes("*")) return str === pattern;

  // Convert glob pattern to regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<GLOBSTAR>>>/g, ".*");

  const regex = new RegExp(`^${escaped}$`);
  return regex.test(str);
}

// ---- Exports ---------------------------------------------------------------

module.exports = {
  createCompletionTrigger,
  createErrorTrigger,
  createDurationTrigger,
  createTokenThresholdTrigger,
  createFileChangeTrigger,
  TriggerEngine,
};
