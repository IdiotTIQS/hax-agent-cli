"use strict";

/**
 * Configuration Drift Detector for HaxAgent.
 *
 * Detects drift between a current config and a baseline (desired state),
 * categorizes findings by severity, and provides auto-correction for safe
 * deviations.
 */

// ---------------------------------------------------------------------------
// Drift types
// ---------------------------------------------------------------------------

const DRIFT_TYPES = Object.freeze({
  MISSING_KEY: "MISSING_KEY",
  EXTRA_KEY: "EXTRA_KEY",
  VALUE_CHANGED: "VALUE_CHANGED",
  TYPE_CHANGED: "TYPE_CHANGED",
  DEPRECATED: "DEPRECATED",
  INSECURE: "INSECURE",
});

// ---------------------------------------------------------------------------
// Severity levels
// ---------------------------------------------------------------------------

const SEVERITY = Object.freeze({
  CRITICAL: "CRITICAL",
  WARNING: "WARNING",
  INFO: "INFO",
});

// ---------------------------------------------------------------------------
// Known deprecated keys (mapped to replacement or null)
// ---------------------------------------------------------------------------

const DEPRECATED_KEYS = Object.freeze({
  "agent.maxTurns": "agent.maxToolTurns",
  "agent.legacyModel": "agent.model",
  "memory.maxItems": "memory.maxEntries",
  "tools.shell.commandTimeout": "tools.shell.timeoutMs",
  "context.legacyWindowSize": "context.windowTokens",
});

// ---------------------------------------------------------------------------
// Insecure value patterns
// ---------------------------------------------------------------------------

const INSECURE_PATTERNS = [
  {
    key: "permissions.mode",
    test: (val) => val === "yolo",
    reason: "YOLO mode auto-approves all tool calls without confirmation",
  },
  {
    key: "tools.shell.allowedCommands",
    test: (val) =>
      Array.isArray(val) && val.length === 1 && val[0] === "*",
    reason: "Unrestricted shell commands can execute arbitrary code",
  },
  {
    key: "tools.file.allowedPaths",
    test: (val) =>
      Array.isArray(val) && val.length === 1 && val[0] === "*",
    reason: "Unrestricted file paths allow access to the entire filesystem",
  },
  {
    key: "agent.apiKey",
    test: (val) => typeof val === "string" && val.length > 0,
    reason:
      "API key stored in config file — prefer environment variables instead",
  },
  {
    key: "agent.apiUrl",
    test: (val) =>
      typeof val === "string" && val.length > 0 && !val.startsWith("https://"),
    reason: "API URL is not using HTTPS",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined)
    return a === b;
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

/**
 * Flatten a nested object into dot-delimited keys.
 * @param {object} obj
 * @param {string} [prefix]
 * @returns {Record<string, *>}
 */
function flatten(obj, prefix = "") {
  const result = {};
  for (const [key, val] of Object.entries(obj || {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(val)) {
      Object.assign(result, flatten(val, fullKey));
    } else {
      result[fullKey] = val;
    }
  }
  return result;
}

/**
 * Get the type tag for a value.
 * @param {*} value
 * @returns {string}
 */
function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// ---------------------------------------------------------------------------
// DriftDetector
// ---------------------------------------------------------------------------

class DriftDetector {
  /**
   * @param {{ baseline?: object }} [opts]
   */
  constructor(opts = {}) {
    this._baseline = opts.baseline ? deepClone(opts.baseline) : null;
    /** @type {Array<object>} */
    this._drifts = [];
    /** @type {Array<object>} */
    this._autoCorrected = [];
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Detect drift between a current config and the baseline.
   *
   * @param {object} current - the running/existing configuration
   * @param {object} baseline - the desired/reference configuration
   * @returns {Array<object>} drift entries
   */
  detect(current, baseline) {
    const ref = baseline || this._baseline;
    if (!ref) {
      throw new Error(
        "A baseline must be provided either at construction or at detect() call"
      );
    }

    const drifts = [];
    const flatCurrent = flatten(current);
    const flatBaseline = flatten(ref);

    const allKeys = new Set([
      ...Object.keys(flatCurrent),
      ...Object.keys(flatBaseline),
    ]);

    for (const key of allKeys) {
      const currentVal = flatCurrent[key];
      const baselineVal = flatBaseline[key];

      // --- MISSING_KEY: exists in baseline but not in current ---
      if (!(key in flatCurrent) && key in flatBaseline) {
        drifts.push({
          type: DRIFT_TYPES.MISSING_KEY,
          key,
          baselineValue: baselineVal,
          currentValue: undefined,
          severity: null, // filled by categorize()
        });
        continue;
      }

      // --- EXTRA_KEY: exists in current but not in baseline ---
      if (key in flatCurrent && !(key in flatBaseline)) {
        drifts.push({
          type: DRIFT_TYPES.EXTRA_KEY,
          key,
          baselineValue: undefined,
          currentValue: currentVal,
          severity: null,
        });
        continue;
      }

      // --- Both present — compare values ---
      if (!deepEqual(currentVal, baselineVal)) {
        // Check insecure patterns first — they take precedence over all other types
        const insecure = INSECURE_PATTERNS.find(
          (p) => p.key === key && p.test(currentVal)
        );
        if (insecure) {
          drifts.push({
            type: DRIFT_TYPES.INSECURE,
            key,
            baselineValue: baselineVal,
            currentValue: currentVal,
            reason: insecure.reason,
            severity: null,
          });
          continue;
        }

        if (DEPRECATED_KEYS.hasOwnProperty(key)) {
          drifts.push({
            type: DRIFT_TYPES.DEPRECATED,
            key,
            baselineValue: baselineVal,
            currentValue: currentVal,
            replacement: DEPRECATED_KEYS[key] || null,
            severity: null,
          });
          continue;
        }

        const currentType = typeOf(currentVal);
        const baselineType = typeOf(baselineVal);

        if (currentType !== baselineType) {
          drifts.push({
            type: DRIFT_TYPES.TYPE_CHANGED,
            key,
            baselineValue: baselineVal,
            currentValue: currentVal,
            baselineType,
            currentType,
            severity: null,
          });
        } else {
          drifts.push({
            type: DRIFT_TYPES.VALUE_CHANGED,
            key,
            baselineValue: baselineVal,
            currentValue: currentVal,
            severity: null,
          });
        }
      }
    }

    // Categorize all drifts before returning
    this._drifts = drifts.map((d) => {
      d.severity = this.categorizeDrift(d);
      return d;
    });

    return [...this._drifts];
  }

  /**
   * Categorize a single drift entry by severity.
   * @param {object} drift
   * @returns {string} severity level
   */
  categorizeDrift(drift) {
    switch (drift.type) {
      case DRIFT_TYPES.INSECURE:
        return SEVERITY.CRITICAL;

      case DRIFT_TYPES.DEPRECATED:
        return SEVERITY.WARNING;

      case DRIFT_TYPES.TYPE_CHANGED:
        return SEVERITY.CRITICAL;

      case DRIFT_TYPES.MISSING_KEY: {
        // Missing API keys are critical
        if (drift.key.includes("apiKey") || drift.key.includes("api_key")) {
          return SEVERITY.CRITICAL;
        }
        // Missing required tool configs
        if (drift.key.startsWith("tools.")) {
          return SEVERITY.WARNING;
        }
        return SEVERITY.INFO;
      }

      case DRIFT_TYPES.EXTRA_KEY:
        return SEVERITY.INFO;

      case DRIFT_TYPES.VALUE_CHANGED: {
        // Sensitive keys that change are critical
        const criticalKeys = [
          "permissions.mode",
          "agent.apiKey",
          "agent.apiUrl",
          "tools.shell.allowedCommands",
          "tools.file.allowedPaths",
        ];
        if (criticalKeys.includes(drift.key)) {
          return SEVERITY.CRITICAL;
        }
        return SEVERITY.WARNING;
      }

      default:
        return SEVERITY.INFO;
    }
  }

  /**
   * Categorize an array of drifts (convenience wrapper).
   * Mutates the array in-place and also returns it.
   * @param {Array<object>} drifts
   * @returns {Array<object>}
   */
  categorize(drifts) {
    if (!Array.isArray(drifts)) {
      throw new TypeError("drifts must be an array");
    }
    for (const d of drifts) {
      d.severity = this.categorizeDrift(d);
    }
    return drifts;
  }

  /**
   * Generate a human-readable drift summary report.
   * @param {Array<object>} [drifts] - uses stored drifts if not provided
   * @returns {string}
   */
  getDriftSummary(drifts) {
    const entries = drifts || this._drifts;
    if (entries.length === 0) {
      return "No configuration drift detected.";
    }

    const critical = entries.filter((d) => d.severity === SEVERITY.CRITICAL);
    const warnings = entries.filter((d) => d.severity === SEVERITY.WARNING);
    const infos = entries.filter((d) => d.severity === SEVERITY.INFO);

    const lines = [];
    lines.push("=== Configuration Drift Report ===");
    lines.push(
      `Total drifts: ${entries.length} (${critical.length} CRITICAL, ${warnings.length} WARNING, ${infos.length} INFO)`
    );
    lines.push("");

    if (critical.length > 0) {
      lines.push("--- CRITICAL ---");
      for (const d of critical) {
        lines.push(
          `  ${d.type}: ${d.key} (current: ${JSON.stringify(d.currentValue)}, baseline: ${JSON.stringify(d.baselineValue)})`
        );
        if (d.reason) lines.push(`    Reason: ${d.reason}`);
        if (d.baselineType && d.currentType) {
          lines.push(
            `    Type mismatch: expected ${d.baselineType}, got ${d.currentType}`
          );
        }
      }
      lines.push("");
    }

    if (warnings.length > 0) {
      lines.push("--- WARNING ---");
      for (const d of warnings) {
        lines.push(
          `  ${d.type}: ${d.key} (current: ${JSON.stringify(d.currentValue)}, baseline: ${JSON.stringify(d.baselineValue)})`
        );
        if (d.replacement) lines.push(`    Replaced by: ${d.replacement}`);
      }
      lines.push("");
    }

    if (infos.length > 0) {
      lines.push("--- INFO ---");
      for (const d of infos) {
        lines.push(
          `  ${d.type}: ${d.key} (current: ${JSON.stringify(d.currentValue)}, baseline: ${JSON.stringify(d.baselineValue)})`
        );
      }
      lines.push("");
    }

    lines.push("=== End of Report ===");
    return lines.join("\n");
  }

  /**
   * Automatically correct safe drifts (INFO severity only).
   * Returns an array of corrections that were applied.
   *
   * @param {Array<object>} [drifts] - uses stored drifts if not provided
   * @returns {Array<{key: string, action: string, oldValue: *, newValue: *}>}
   */
  autoCorrect(drifts) {
    const entries = drifts || this._drifts;
    const corrected = [];

    for (const d of entries) {
      // Only auto-correct INFO-level drifts
      if (d.severity !== SEVERITY.INFO && d.severity !== null) {
        continue;
      }

      if (d.type === DRIFT_TYPES.MISSING_KEY) {
        corrected.push({
          key: d.key,
          action: "restore",
          oldValue: undefined,
          newValue: d.baselineValue,
        });
      } else if (d.type === DRIFT_TYPES.EXTRA_KEY) {
        corrected.push({
          key: d.key,
          action: "remove",
          oldValue: d.currentValue,
          newValue: undefined,
        });
      } else if (d.type === DRIFT_TYPES.VALUE_CHANGED && d.severity !== null) {
        // This shouldn't reach here since VALUE_CHANGED is WARNING or CRITICAL,
        // but guard just in case
        corrected.push({
          key: d.key,
          action: "restore",
          oldValue: d.currentValue,
          newValue: d.baselineValue,
        });
      }
    }

    this._autoCorrected.push(...corrected);
    return corrected;
  }

  /**
   * Determine which drifts require manual approval before correction.
   *
   * @param {Array<object>} [drifts] - uses stored drifts if not provided
   * @returns {Array<object>} drifts requiring approval
   */
  requiresApproval(drifts) {
    const entries = drifts || this._drifts;
    return entries.filter((d) =>
      [SEVERITY.CRITICAL, SEVERITY.WARNING].includes(d.severity)
    );
  }

  /**
   * Return all currently stored drifts.
   * @returns {Array<object>}
   */
  getDrifts() {
    return [...this._drifts];
  }

  /**
   * Return all auto-corrected entries.
   * @returns {Array<object>}
   */
  getAutoCorrected() {
    return [...this._autoCorrected];
  }

  /**
   * Reset internal state.
   */
  reset() {
    this._drifts = [];
    this._autoCorrected = [];
  }

  /**
   * Set or update the baseline config.
   * @param {object} baseline
   */
  setBaseline(baseline) {
    this._baseline = deepClone(baseline);
  }
}

// ---------------------------------------------------------------------------
// Helpers (non-exported)
// ---------------------------------------------------------------------------

function deepClone(value) {
  if (isPlainObject(value)) {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = deepClone(val);
    }
    return result;
  }
  if (Array.isArray(value)) {
    return value.map(deepClone);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  DriftDetector,
  DRIFT_TYPES,
  SEVERITY,
  DEPRECATED_KEYS,
  INSECURE_PATTERNS,
};
