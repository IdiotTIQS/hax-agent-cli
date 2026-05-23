"use strict";

/**
 * DeprecationManager — tracks deprecated API paths, emits warnings, and
 * provides migration guidance so callers can stay ahead of breaking changes.
 *
 *   const mgr = new DeprecationManager({ onWarn: (info) => { ... } });
 *   mgr.deprecate("tools.legacySearch", "2.0.0", "tools.search");
 *   mgr.warn("tools.legacySearch");               // console.warn + callback
 *   mgr.getDeprecationSchedule();                 // timeline view
 */

// ---------------------------------------------------------------------------
// Deprecation levels
// ---------------------------------------------------------------------------

/**
 * SOFT  — still fully functional; a heads-up that a replacement exists.
 * HARD  — still works but emits a warning on every call; may break in a
 *         future release.
 * REMOVED — the API has been removed; calling it is an error.
 */
const LEVELS = Object.freeze({
  SOFT: "SOFT",
  HARD: "HARD",
  REMOVED: "REMOVED",
});

// ---------------------------------------------------------------------------
// DeprecationManager
// ---------------------------------------------------------------------------

class DeprecationManager {
  /**
   * @param {object} [opts]
   * @param {function} [opts.onWarn]  Custom warning handler — receives the
   *   full deprecation info object.  Fires *in addition* to console.warn.
   */
  constructor(opts) {
    opts = opts || {};
    /** @type {Map<string, object>} */
    this._entries = new Map();
    /** @type {function|null} */
    this._onWarn = typeof opts.onWarn === "function" ? opts.onWarn : null;
    /** @type {function} */
    this._clock = opts.clock || (() => Date.now());
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Mark an API path as deprecated.
   *
   * @param {string}  apiPath      Dot-separated path, e.g. "tools.legacySearch"
   * @param {string}  version      SemVer at which deprecation was introduced
   * @param {string}  [replacement] Suggested replacement API path
   * @param {string}  [message]    Custom deprecation message
   * @param {string}  [level]      One of "SOFT" (default), "HARD", "REMOVED"
   * @returns {DeprecationManager} this (chainable)
   */
  deprecate(apiPath, version, replacement, message, level) {
    if (typeof apiPath !== "string" || apiPath.trim().length === 0) {
      throw new TypeError("apiPath must be a non-empty string");
    }
    if (typeof version !== "string" || version.trim().length === 0) {
      throw new TypeError("version must be a non-empty string");
    }

    const normalizedLevel = this._normalizeLevel(level || LEVELS.SOFT);

    this._entries.set(apiPath, {
      apiPath,
      version,
      replacement: replacement || null,
      message: message || null,
      level: normalizedLevel,
      deprecatedAt: this._clock(),
    });

    return this;
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /**
   * Check whether an API path is deprecated (any level).
   *
   * @param {string} apiPath
   * @returns {boolean}
   */
  isDeprecated(apiPath) {
    return this._entries.has(apiPath);
  }

  /**
   * Return full deprecation metadata for an API path, or null if not found.
   *
   * @param {string} apiPath
   * @returns {object|null}
   */
  getDeprecationInfo(apiPath) {
    return this._entries.get(apiPath) || null;
  }

  /**
   * Emit a deprecation warning for the given API path.
   *
   * Behaviour depends on the deprecation level:
   *   - SOFT  : no automatic warning (callers may choose to alert)
   *   - HARD  : console.warn + optional onWarn callback
   *   - REMOVED : throws an Error
   *
   * @param {string} apiPath
   * @param {object} [ctx]  Optional context (caller, stack, etc.) merged into
   *   the info object passed to the warning handler.
   * @returns {boolean}  true if the path is deprecated and a warning was
   *   produced, false if the path is unknown.
   */
  warn(apiPath, ctx) {
    const info = this._entries.get(apiPath);
    if (!info) return false;

    if (info.level === LEVELS.REMOVED) {
      throw new Error(
        `[DEPRECATION] "${apiPath}" has been REMOVED.` +
          (info.replacement ? ` Use "${info.replacement}" instead.` : "") +
          (info.message ? ` ${info.message}` : ""),
      );
    }

    if (info.level === LEVELS.HARD) {
      const enriched = Object.assign({}, info, ctx || {});
      const msg =
        `[DEPRECATION] "${apiPath}" is deprecated since v${info.version} (HARD).` +
        (info.replacement ? ` Use "${info.replacement}" instead.` : "") +
        (info.message ? ` ${info.message}` : "");

      console.warn(msg);

      if (this._onWarn) {
        try {
          this._onWarn(enriched);
        } catch (_) {
          // Silently swallow user-callback errors to avoid cascading failures
        }
      }
    }

    // SOFT level intentionally silent — the info is available but no noise
    return true;
  }

  // -----------------------------------------------------------------------
  // Bulk / listing
  // -----------------------------------------------------------------------

  /**
   * Return a shallow copy of all deprecated API entries.
   *
   * @param {string} [level]  Optional filter by level ("SOFT", "HARD", "REMOVED")
   * @returns {object[]}
   */
  getAllDeprecated(level) {
    const results = Array.from(this._entries.values());
    if (level) {
      const normalized = this._normalizeLevel(level);
      return results.filter((e) => e.level === normalized);
    }
    return results;
  }

  /**
   * Build a timeline of pending (non-REMOVED) deprecations sorted by version.
   *
   * Returns an array of { version, apis: [{apiPath, level, replacement}] }
   * ordered from earliest version to latest.
   *
   * @returns {object[]}
   */
  getDeprecationSchedule() {
    // Group by version, excluding REMOVED items
    const byVersion = new Map();

    for (const entry of this._entries.values()) {
      if (entry.level === LEVELS.REMOVED) continue;
      if (!byVersion.has(entry.version)) {
        byVersion.set(entry.version, []);
      }
      byVersion.get(entry.version).push({
        apiPath: entry.apiPath,
        level: entry.level,
        replacement: entry.replacement,
        message: entry.message,
      });
    }

    // Sort versions using simple semver comparison (numeric segments)
    const sorted = Array.from(byVersion.keys()).sort((a, b) => {
      const segA = a.split(".").map(Number);
      const segB = b.split(".").map(Number);
      for (let i = 0; i < Math.max(segA.length, segB.length); i++) {
        const diff = (segA[i] || 0) - (segB[i] || 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });

    return sorted.map((version) => ({
      version,
      apis: byVersion.get(version),
    }));
  }

  /**
   * Remove a previously registered deprecation entry (e.g. for testing).
   *
   * @param {string} apiPath
   * @returns {boolean} true if removed, false if not found
   */
  unDeprecate(apiPath) {
    return this._entries.delete(apiPath);
  }

  /**
   * Return the total count of registered deprecation entries.
   *
   * @returns {number}
   */
  get size() {
    return this._entries.size;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** @param {string} level */
  _normalizeLevel(level) {
    const upper = String(level).toUpperCase();
    if (upper === LEVELS.SOFT) return LEVELS.SOFT;
    if (upper === LEVELS.HARD) return LEVELS.HARD;
    if (upper === LEVELS.REMOVED) return LEVELS.REMOVED;
    throw new Error(
      `Unknown deprecation level: "${level}". Must be one of SOFT, HARD, REMOVED.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

DeprecationManager.LEVELS = LEVELS;

module.exports = {
  DeprecationManager,
  LEVELS,
};
