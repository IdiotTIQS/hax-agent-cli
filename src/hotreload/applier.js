"use strict";

/**
 * Settings that can be hot-reloaded without restarting the agent.
 * Mapped as dotted paths.
 */
const HOT_RELOADABLE = new Set([
  "ui.theme",
  "ui.locale",
  "permissions.mode",
  "context.enabled",
  "context.windowTokens",
  "context.reserveOutputTokens",
  "context.charsPerToken",
  "context.autoCompact",
  "context.threshold",
  "tools.shell.enabled",
  "tools.shell.timeoutMs",
  "tools.shell.maxBuffer",
  "tools.shell.allowedCommands",
  "tools.file.maxBytes",
  "tools.file.allowedPaths",
  "prompts.includeSettings",
  "prompts.includeMemory",
  "prompts.includeTranscript",
  "prompts.maxTranscriptMessages",
  "fileContext.enabled",
  "fileContext.maxFiles",
  "fileContext.maxIndexFiles",
  "fileContext.maxFileSize",
  "fileContext.maxBytesPerFile",
  "fileContext.maxTotalBytes",
]);

/**
 * Settings that *always* require a full agent restart.
 * These take effect only after the process re-reads the config.
 */
const RESTART_REQUIRED = new Set([
  "agent.provider",
  "agent.model",
  "agent.name",
  "agent.apiKey",
  "agent.apiUrl",
  "agent.maxToolTurns",
  "agent.maxTokens",
  "agent.temperature",
  "agent.systemPrompt",
]);

/**
 * Applies configuration deltas to a running agent, understanding which
 * settings can be live-applied and which demand a restart.
 */
class ConfigApplier {
  /**
   * @param {{ rollbackFn?: Function }} [opts]
   */
  constructor(opts = {}) {
    this._rollbackFn = typeof opts.rollbackFn === "function" ? opts.rollbackFn : null;
    /** @type {Array<{setting: string, oldVal: *, newVal: *}>} */
    this._applied = [];
    /** @type {Array<string>} */
    this._pendingRestarts = [];
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Compute the difference between two config objects and apply only
   * hot-reloadable changes. Settings that require a restart are collected
   * but not applied live.
   *
   * @param {object} oldConfig
   * @param {object} newConfig
   * @returns {{
   *   applied: Array<{path: string, oldVal: *, newVal: *}>,
   *   skipped: Array<{path: string, oldVal: *, newVal: *}>,
   *   requiresRestart: boolean
   * }}
   */
  applyDelta(oldConfig, newConfig) {
    const diff = computeDelta(oldConfig, newConfig);
    const applied = [];
    const skipped = [];

    for (const entry of diff) {
      if (HOT_RELOADABLE.has(entry.path)) {
        this._applyEntry(entry);
        applied.push(entry);
      } else {
        skipped.push(entry);
      }
    }

    const restartPaths = diff
      .filter((e) => RESTART_REQUIRED.has(e.path))
      .map((e) => e.path);

    if (restartPaths.length > 0) {
      this._pendingRestarts = [...new Set([...this._pendingRestarts, ...restartPaths])];
    }

    return {
      applied,
      skipped,
      requiresRestart: restartPaths.length > 0,
    };
  }

  /**
   * Check whether an individual setting supports hot-reload.
   * @param {string} dottedPath - e.g. "ui.theme"
   * @returns {boolean}
   */
  canHotReload(dottedPath) {
    if (typeof dottedPath !== "string" || dottedPath === "") return false;

    // Check exact match first.
    if (HOT_RELOADABLE.has(dottedPath)) return true;

    // A section-level check: e.g. "ui" maps to ui.theme + ui.locale.
    const parts = dottedPath.split(".");
    if (parts.length === 1) {
      for (const hr of HOT_RELOADABLE) {
        if (hr.startsWith(`${dottedPath}.`)) return true;
      }
    }

    return false;
  }

  /**
   * Return the set of dotted paths that demand a full restart.
   * @param {object} settings - full or partial config containing the keys to check
   * @returns {Array<string>}
   */
  requiresRestart(settings) {
    const paths = [];
    const flat = flattenConfig(settings);

    for (const [key] of Object.entries(flat)) {
      if (RESTART_REQUIRED.has(key)) {
        paths.push(key);
      }
    }

    return paths;
  }

  /**
   * Apply one section change directly (bypasses full delta computation).
   * @param {string} section - top-level section name
   * @param {*} oldVal
   * @param {*} newVal
   */
  applySection(section, oldVal, newVal) {
    if (!section || typeof section !== "string") {
      throw new TypeError("section must be a non-empty string");
    }

    const entries = expandSection(section, oldVal, newVal);
    for (const entry of entries) {
      if (HOT_RELOADABLE.has(entry.path)) {
        this._applyEntry(entry);
      }
    }
  }

  /**
   * Roll back the most recently applied change, or a specific setting.
   * Restores the previous value if a rollback handler was provided.
   * @param {string} [failedSetting] - dotted path of the setting to revert
   */
  rollback(failedSetting) {
    if (!failedSetting) {
      // Revert the last applied entry.
      const entry = this._applied.pop();
      if (entry && this._rollbackFn) {
        this._rollbackFn(entry.path, entry.oldVal);
      }
      return;
    }

    // Revert a specific setting.
    const idx = this._applied.findIndex((e) => e.path === failedSetting);
    if (idx === -1) return;

    const [entry] = this._applied.splice(idx, 1);
    if (this._rollbackFn) {
      this._rollbackFn(entry.path, entry.oldVal);
    }
  }

  /**
   * Settings that are currently queued for restart.
   * @returns {Array<string>}
   */
  pendingRestarts() {
    return [...this._pendingRestarts];
  }
}

// ---------------------------------------------------------------------------
// Delta computation
// ---------------------------------------------------------------------------

/**
 * Deep-diff two config objects, returning a flat list of dotted-path changes.
 * @param {object} oldConfig
 * @param {object} newConfig
 * @returns {Array<{path: string, oldVal: *, newVal: *}>}
 */
function computeDelta(oldConfig, newConfig) {
  const diff = [];
  const seen = new Set();

  const allKeys = new Set([
    ...Object.keys(oldConfig || {}),
    ...Object.keys(newConfig || {}),
  ]);

  for (const key of allKeys) {
    const oldVal = (oldConfig || {})[key];
    const newVal = (newConfig || {})[key];

    if (isPlainObject(oldVal) && isPlainObject(newVal)) {
      // Recurse into nested sections.
      const nested = computeDelta(oldVal, newVal);
      for (const entry of nested) {
        diff.push({ path: `${key}.${entry.path}`, oldVal: entry.oldVal, newVal: entry.newVal });
      }
    } else if (isPlainObject(newVal) && oldVal === undefined) {
      // New section added — expand all keys so individual settings are diffed.
      for (const [subKey, subVal] of Object.entries(newVal)) {
        diff.push({ path: `${key}.${subKey}`, oldVal: undefined, newVal: subVal });
      }
    } else if (isPlainObject(oldVal) && newVal === undefined) {
      // Section removed — expand all keys.
      for (const [subKey, subVal] of Object.entries(oldVal)) {
        diff.push({ path: `${key}.${subKey}`, oldVal: subVal, newVal: undefined });
      }
    } else if (!deepEqual(oldVal, newVal)) {
      diff.push({ path: key, oldVal, newVal });
    }
  }

  return diff;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }

  return false;
}

function flattenConfig(obj, prefix = "") {
  const result = {};
  for (const [key, val] of Object.entries(obj || {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(val)) {
      Object.assign(result, flattenConfig(val, fullKey));
    } else {
      result[fullKey] = val;
    }
  }
  return result;
}

function expandSection(section, oldVal, newVal) {
  const entries = [];
  if (isPlainObject(oldVal) && isPlainObject(newVal)) {
    const nested = computeDelta(oldVal, newVal);
    for (const e of nested) {
      entries.push({ path: `${section}.${e.path}`, oldVal: e.oldVal, newVal: e.newVal });
    }
  } else {
    entries.push({ path: section, oldVal, newVal });
  }
  return entries;
}

function _applyEntry(entry) {
  // Store for potential rollback.
  this._applied.push(entry);
}

ConfigApplier.prototype._applyEntry = _applyEntry;

module.exports = { ConfigApplier, HOT_RELOADABLE, RESTART_REQUIRED, computeDelta };
