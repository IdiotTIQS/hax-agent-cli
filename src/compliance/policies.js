"use strict";

/**
 * Compliance Policy Engine for HaxAgent.
 *
 * Defines and enforces configuration policies through a rule-based system.
 * Rules are evaluated against a config and produce violations when the
 * config fails to meet requirements.
 */

// ---------------------------------------------------------------------------
// Rule severity
// ---------------------------------------------------------------------------

const RULE_SEVERITY = Object.freeze({
  MUST: "MUST",
  SHOULD: "SHOULD",
  MAY: "MAY",
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely read a nested value from an object using a dotted path.
 * @param {object} obj
 * @param {string} path - e.g. "agent.model"
 * @returns {*}
 */
function getByPath(obj, path) {
  const segments = path.split(".");
  let cursor = obj;
  for (const seg of segments) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = cursor[seg];
  }
  return cursor;
}

/**
 * Check whether a value is a plain object.
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Pre-built validation helpers
// ---------------------------------------------------------------------------

/**
 * Check that an API key is set (non-empty, not the string "undefined").
 * @param {*} val
 * @returns {boolean}
 */
function hasApiKey(val) {
  return typeof val === "string" && val.length > 1 && val !== "undefined";
}

/**
 * Check that a URL uses HTTPS.
 * @param {*} val
 * @returns {boolean}
 */
function isSecureUrl(val) {
  if (typeof val !== "string") return false;
  return val.startsWith("https://");
}

// ---------------------------------------------------------------------------
// Pre-built rules
// ---------------------------------------------------------------------------

/**
 * @type {Array<object>}
 */
const PREBUILT_RULES = Object.freeze([
  {
    id: "require-api-key",
    description:
      "A valid API key must be configured (via env var or config file)",
    severity: RULE_SEVERITY.MUST,
    evaluate(config) {
      const apiKey = getByPath(config, "agent.apiKey");
      if (!hasApiKey(apiKey)) {
        return {
          passed: false,
          message:
            "No API key found. Set ANTHROPIC_API_KEY or configure agent.apiKey.",
        };
      }
      return { passed: true };
    },
  },

  {
    id: "disallow-yolo-without-explicit-flag",
    description:
      "YOLO permission mode must only be enabled with explicit opt-in",
    severity: RULE_SEVERITY.MUST,
    evaluate(config) {
      const mode = getByPath(config, "permissions.mode");
      const yoloFlag = getByPath(config, "permissions.yoloExplicitOptIn");
      if (mode === "yolo" && !yoloFlag) {
        return {
          passed: false,
          message:
            "YOLO mode is enabled without explicit opt-in. Set permissions.yoloExplicitOptIn to true to acknowledge the risk.",
        };
      }
      return { passed: true };
    },
  },

  {
    id: "require-secure-endpoints",
    description: "All configured API URLs must use HTTPS",
    severity: RULE_SEVERITY.MUST,
    evaluate(config) {
      const apiUrl = getByPath(config, "agent.apiUrl");
      // Only fail if a URL is explicitly set and it is not secure
      if (typeof apiUrl === "string" && apiUrl.length > 0 && !isSecureUrl(apiUrl)) {
        return {
          passed: false,
          message:
            `API URL "${apiUrl}" does not use HTTPS. Use a secure endpoint for production.`,
        };
      }
      return { passed: true };
    },
  },

  {
    id: "enforce-model-version-range",
    description: "The configured model should be from a supported version range",
    severity: RULE_SEVERITY.SHOULD,
    evaluate(config) {
      const model = getByPath(config, "agent.model");
      if (typeof model !== "string" || model.length === 0) {
        return { passed: true }; // provider default is fine
      }

      // Known deprecated / unsupported model patterns
      const deprecatedModels = [
        "claude-1",
        "claude-2.0",
        "claude-instant",
        "gpt-3.5-turbo",
      ];

      if (deprecatedModels.includes(model.toLowerCase())) {
        return {
          passed: false,
          message:
            `Model "${model}" has been deprecated. Upgrade to a supported model version.`,
        };
      }

      return { passed: true };
    },
  },

  {
    id: "require-timeout-limits",
    description: "Tool execution must have reasonable timeout limits configured",
    severity: RULE_SEVERITY.SHOULD,
    evaluate(config) {
      const timeout = getByPath(config, "tools.shell.timeoutMs");
      if (timeout === undefined || timeout === null) {
        return {
          passed: false,
          message:
            "No shell timeout configured. Set tools.shell.timeoutMs to prevent runaway commands.",
        };
      }
      if (typeof timeout !== "number" || !Number.isFinite(timeout)) {
        return {
          passed: false,
          message:
            `Shell timeout must be a finite number, got ${typeof timeout}.`,
        };
      }
      if (timeout > 300_000) {
        return {
          passed: false,
          message:
            `Shell timeout of ${timeout}ms is too high (max recommended: 300000ms).`,
        };
      }
      if (timeout < 1_000) {
        return {
          passed: false,
          message:
            `Shell timeout of ${timeout}ms is too low (min recommended: 1000ms).`,
        };
      }
      return { passed: true };
    },
  },
]);

// ---------------------------------------------------------------------------
// Enforce actions
// ---------------------------------------------------------------------------

const ENFORCE_ACTION = Object.freeze({
  FIX: "FIX",
  WARN: "WARN",
  REPORT: "REPORT",
});

// ---------------------------------------------------------------------------
// CompliancePolicy
// ---------------------------------------------------------------------------

class CompliancePolicy {
  /**
   * @param {{ rules?: Array<object> }} [opts]
   */
  constructor(opts = {}) {
    /** @type {Array<object>} */
    this._rules = [];
    /** @type {Array<object>} */
    this._violations = [];
    /** @type {Array<object>} */
    this._fixes = [];

    // Load pre-built rules by default
    const rulesToLoad = opts.rules || PREBUILT_RULES;
    for (const rule of rulesToLoad) {
      this.addRule(rule);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Add a compliance rule.
   *
   * A rule is an object with:
   *  - id: string (unique identifier)
   *  - description: string
   *  - severity: MUST | SHOULD | MAY
   *  - evaluate(config): function returning { passed: boolean, message?: string }
   *
   * @param {object} rule
   * @returns {this}
   */
  addRule(rule) {
    if (!rule || typeof rule !== "object") {
      throw new TypeError("Rule must be an object");
    }
    if (!rule.id || typeof rule.id !== "string") {
      throw new TypeError("Rule must have a string id");
    }
    if (typeof rule.evaluate !== "function") {
      throw new TypeError(`Rule "${rule.id}" must have an evaluate() function`);
    }

    // Check for duplicate id
    const existing = this._rules.find((r) => r.id === rule.id);
    if (existing) {
      throw new Error(`A rule with id "${rule.id}" already exists`);
    }

    this._rules.push({
      id: rule.id,
      description: rule.description || "",
      severity: rule.severity || RULE_SEVERITY.MAY,
      evaluate: rule.evaluate,
    });

    return this;
  }

  /**
   * Evaluate all rules against a config object.
   * Populates internal violations list and returns it.
   *
   * @param {object} config
   * @returns {Array<object>}
   */
  evaluate(config) {
    this._violations = [];

    for (const rule of this._rules) {
      try {
        const result = rule.evaluate(config);
        if (result && result.passed === false) {
          this._violations.push({
            ruleId: rule.id,
            severity: rule.severity,
            description: rule.description,
            message: result.message || "Rule violation detected",
          });
        }
      } catch (error) {
        // If evaluation throws, treat as a violation
        this._violations.push({
          ruleId: rule.id,
          severity: rule.severity,
          description: rule.description,
          message: `Rule evaluation failed: ${error.message}`,
        });
      }
    }

    return this.getViolations();
  }

  /**
   * Enforce rules on a config — either fix or warn.
   *
   * MUST rules are enforced as FIX (attempt auto-correction).
   * SHOULD rules are enforced as WARN.
   * MAY rules are enforced as REPORT.
   *
   * @param {object} config
   * @returns {{ config: object, fixes: Array<object>, warnings: Array<object> }}
   */
  enforce(config) {
    const violations = this.evaluate(config);
    const fixes = [];
    const warnings = [];
    let mutatedConfig = deepClone(config);

    for (const v of violations) {
      const rule = this._rules.find((r) => r.id === v.ruleId);
      if (!rule) continue;

      if (rule.severity === RULE_SEVERITY.MUST) {
        // Attempt auto-fix for MUST violations
        const fix = this._applyFix(v.ruleId, mutatedConfig);
        if (fix) {
          fixes.push({
            ruleId: v.ruleId,
            action: ENFORCE_ACTION.FIX,
            applied: true,
            previousState: fix.previousState,
            fix: fix.description,
          });
          mutatedConfig = fix.config;
        } else {
          warnings.push({
            ruleId: v.ruleId,
            action: ENFORCE_ACTION.WARN,
            message:
              "MUST violation could not be auto-fixed and requires manual intervention.",
            violation: v,
          });
        }
      } else if (rule.severity === RULE_SEVERITY.SHOULD) {
        warnings.push({
          ruleId: v.ruleId,
          action: ENFORCE_ACTION.WARN,
          message: v.message,
          violation: v,
        });
      } else {
        // MAY violations are purely informational
        warnings.push({
          ruleId: v.ruleId,
          action: ENFORCE_ACTION.REPORT,
          message: v.message,
          violation: v,
        });
      }
    }

    return { config: mutatedConfig, fixes, warnings };
  }

  /**
   * Return current violations.
   * @returns {Array<object>}
   */
  getViolations() {
    return [...this._violations];
  }

  /**
   * Return all registered rules.
   * @returns {Array<object>}
   */
  getRules() {
    return this._rules.map((r) => ({
      id: r.id,
      description: r.description,
      severity: r.severity,
    }));
  }

  /**
   * Remove a rule by id.
   * @param {string} ruleId
   * @returns {boolean} whether removal succeeded
   */
  removeRule(ruleId) {
    const idx = this._rules.findIndex((r) => r.id === ruleId);
    if (idx === -1) return false;
    this._rules.splice(idx, 1);
    return true;
  }

  /**
   * Reset all state.
   */
  reset() {
    this._rules = [];
    this._violations = [];
    this._fixes = [];
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Apply a fix for a known rule.
   * @param {string} ruleId
   * @param {object} config
   * @returns {{ config: object, previousState: *, description: string } | null}
   * @private
   */
  _applyFix(ruleId, config) {
    switch (ruleId) {
      case "require-api-key": {
        // Cannot auto-generate a key, but we can warn
        return null;
      }

      case "disallow-yolo-without-explicit-flag": {
        const mode = getByPath(config, "permissions.mode");
        if (mode === "yolo") {
          const previousState = { "permissions.mode": "yolo" };
          // Downgrade to "ask" as a safe default
          setByPath(config, "permissions.mode", "ask");
          return {
            config,
            previousState,
            description: "Downgraded permissions.mode from 'yolo' to 'ask'",
          };
        }
        return null;
      }

      case "require-secure-endpoints": {
        const apiUrl = getByPath(config, "agent.apiUrl");
        if (typeof apiUrl === "string" && !isSecureUrl(apiUrl)) {
          const previousState = { "agent.apiUrl": apiUrl };
          // Remove the insecure URL — user must configure a secure one
          setByPath(config, "agent.apiUrl", undefined);
          return {
            config,
            previousState,
            description:
              "Removed insecure agent.apiUrl. Reconfigure with an HTTPS endpoint.",
          };
        }
        return null;
      }

      case "require-timeout-limits": {
        const timeout = getByPath(config, "tools.shell.timeoutMs");
        if (timeout === undefined || timeout === null) {
          const previousState = { "tools.shell.timeoutMs": undefined };
          setByPath(config, "tools.shell.timeoutMs", 30_000);
          return {
            config,
            previousState,
            description: "Set tools.shell.timeoutMs to default 30000ms",
          };
        }
        if (timeout > 300_000) {
          const previousState = { "tools.shell.timeoutMs": timeout };
          setByPath(config, "tools.shell.timeoutMs", 300_000);
          return {
            config,
            previousState,
            description:
              "Capped tools.shell.timeoutMs to maximum 300000ms",
          };
        }
        if (timeout < 1_000) {
          const previousState = { "tools.shell.timeoutMs": timeout };
          setByPath(config, "tools.shell.timeoutMs", 10_000);
          return {
            config,
            previousState,
            description:
              "Raised tools.shell.timeoutMs to minimum 10000ms",
          };
        }
        return null;
      }

      default:
        return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers (non-exported)
// ---------------------------------------------------------------------------

function setByPath(obj, path, value) {
  const segments = path.split(".");
  let cursor = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (!isPlainObject(cursor[seg])) {
      cursor[seg] = {};
    }
    cursor = cursor[seg];
  }
  cursor[segments[segments.length - 1]] = value;
}

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
  CompliancePolicy,
  RULE_SEVERITY,
  ENFORCE_ACTION,
  PREBUILT_RULES,
};
