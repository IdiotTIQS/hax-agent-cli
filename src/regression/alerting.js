/**
 * RegressionAlerter — monitors detected regressions and sends alerts
 * through configurable channels (console, file, callback) with
 * severity-based routing, muting, and alert history tracking.
 */
"use strict";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ALERT_LEVELS = Object.freeze({
  INFO:     "INFO",
  WARNING:  "WARNING",
  CRITICAL: "CRITICAL",
  BLOCKER:  "BLOCKER",
});

/**
 * Map a detector severity to an alert level.
 */
function severityToAlertLevel(severity) {
  switch (severity) {
    case "critical": return ALERT_LEVELS.BLOCKER;
    case "major":    return ALERT_LEVELS.CRITICAL;
    case "moderate": return ALERT_LEVELS.WARNING;
    case "minor":    return ALERT_LEVELS.INFO;
    default:         return ALERT_LEVELS.INFO;
  }
}

/**
 * Check whether an alert level satisfies a minimum-level filter.
 */
function meetsLevel(level, minimum) {
  const order = { INFO: 0, WARNING: 1, CRITICAL: 2, BLOCKER: 3 };
  return (order[level] || 0) >= (order[minimum] || 0);
}

/**
 * Format a human-readable alert message.
 */
function formatAlertMessage(regression, level) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const changeSign = regression.changePct > 0 ? "+" : "";
  let line = `[${ts}] [${level}] [${regression.name || "?"}] ${regression.label}: `;
  line += `${regression.baseline.toFixed(2)} → ${regression.current.toFixed(2)} `;
  line += `(${changeSign}${regression.changePct.toFixed(1)}%)`;
  return line;
}

/**
 * Write a string to a file synchronously, appending a newline.
 */
function appendToFile(filePath, line) {
  const fs = require("fs");
  const path = require("path");
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(filePath, line + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// RegressionAlerter
// ---------------------------------------------------------------------------

class RegressionAlerter {
  /**
   * @param {object} [options]
   * @param {string} [options.minLevel] - minimum alert level to fire (default "INFO")
   * @param {boolean} [options.console] - enable console channel (default true)
   * @param {string} [options.file] - file path for file channel (disabled if absent)
   * @param {function} [options.callback] - callback channel fn(report) => void
   * @param {number} [options.cooldownMs] - minimum ms between same-metric alerts (default 60000)
   * @param {object} [options.detector] - RegressionDetector instance to use internally
   */
  constructor(options = {}) {
    this._minLevel = options.minLevel || ALERT_LEVELS.INFO;
    this._consoleEnabled = options.console !== false;
    this._filePath = typeof options.file === "string" ? options.file : null;
    this._callback = typeof options.callback === "function" ? options.callback : null;
    this._cooldownMs = Number.isFinite(options.cooldownMs) ? options.cooldownMs : 60000;
    this._detector = options.detector || null;
    this._history = [];
    this._muted = new Map(); // metric -> expiry timestamp
    this._lastAlertTime = new Map(); // metric -> timestamp of last alert
  }

  // ---------------------------------------------------------------------------
  // Detection + alerting
  // ---------------------------------------------------------------------------

  /**
   * Run regression detection on `current` vs `baseline` and fire alerts for
   * any regressions that meet the configured policy.
   *
   * @param {object} current - current benchmark result
   * @param {object} [baseline] - baseline result (uses detector's stored baseline if omitted)
   * @returns {object} { alertsFired, report }
   */
  checkAndAlert(current, baseline) {
    if (!this._detector) {
      throw new Error("RegressionAlerter is not connected to a RegressionDetector. Provide `detector` in constructor options.");
    }

    const report = this._detector.detectRegression(baseline || null, current);
    const alertsFired = [];

    if (!report.hasRegression) {
      return { alertsFired: [], report };
    }

    for (const reg of report.regressions) {
      const level = severityToAlertLevel(reg.severity);

      // Skip if below minimum level
      if (!meetsLevel(level, this._minLevel)) {
        continue;
      }

      // Skip if metric is muted
      if (this._isMuted(reg.metric)) {
        continue;
      }

      // Cooldown check
      if (this._isInCooldown(reg.metric)) {
        continue;
      }

      // Build alert entry
      const alertEntry = {
        level,
        regression: reg,
        message: formatAlertMessage(reg, level),
        timestamp: new Date().toISOString(),
      };

      // Deliver via enabled channels
      this._deliver(alertEntry);

      this._history.push(alertEntry);
      this._lastAlertTime.set(reg.metric, Date.now());
      alertsFired.push(alertEntry);
    }

    return { alertsFired, report };
  }

  // ---------------------------------------------------------------------------
  // Threshold / policy
  // ---------------------------------------------------------------------------

  /**
   * Return the current minimum alert level.
   * @returns {string}
   */
  getAlertThreshold() {
    return this._minLevel;
  }

  /**
   * Configure alerting policy.
   *
   * @param {object} policy
   * @param {string} [policy.minLevel] - "INFO", "WARNING", "CRITICAL", "BLOCKER"
   * @param {boolean} [policy.console] - enable/disable console channel
   * @param {string|null} [policy.file] - file path or null to disable
   * @param {function|null} [policy.callback] - callback or null to disable
   * @param {number} [policy.cooldownMs]
   */
  setAlertPolicy(policy) {
    if (!policy || typeof policy !== "object") {
      throw new TypeError("setAlertPolicy expects a policy object.");
    }

    if (typeof policy.minLevel === "string" && ALERT_LEVELS.hasOwnProperty(policy.minLevel)) {
      this._minLevel = policy.minLevel;
    }
    if (typeof policy.console === "boolean") {
      this._consoleEnabled = policy.console;
    }
    if (policy.file !== undefined) {
      this._filePath = typeof policy.file === "string" ? policy.file : null;
    }
    if (policy.callback !== undefined) {
      this._callback = typeof policy.callback === "function" ? policy.callback : null;
    }
    if (Number.isFinite(policy.cooldownMs)) {
      this._cooldownMs = policy.cooldownMs;
    }
  }

  // ---------------------------------------------------------------------------
  // Muting
  // ---------------------------------------------------------------------------

  /**
   * Temporarily mute alerts for a specific metric.
   *
   * @param {string} metric - metric key to mute (e.g., "avg", "cost", "errorRate")
   * @param {number} durationMs - duration in milliseconds
   */
  mute(metric, durationMs) {
    if (typeof metric !== "string" || metric.length === 0) {
      throw new TypeError("mute: metric must be a non-empty string.");
    }
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError("mute: durationMs must be a non-negative number.");
    }
    this._muted.set(metric, Date.now() + durationMs);
  }

  /**
   * Unmute a previously muted metric.
   * @param {string} metric
   */
  unmute(metric) {
    this._muted.delete(metric);
  }

  /**
   * Unmute all muted metrics.
   */
  unmuteAll() {
    this._muted.clear();
  }

  /**
   * Return an array of currently muted metrics with their remaining durations.
   * @returns {{ metric: string, remainingMs: number }[]}
   */
  getMutedMetrics() {
    const now = Date.now();
    const result = [];
    for (const [metric, expiry] of this._muted.entries()) {
      if (expiry > now) {
        result.push({ metric, remainingMs: expiry - now });
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  /**
   * Return the full alert history.
   * @returns {object[]}
   */
  getAlertHistory() {
    return this._history.slice();
  }

  /**
   * Return alert history filtered by level.
   * @param {string} level
   * @returns {object[]}
   */
  getAlertHistoryByLevel(level) {
    return this._history.filter((e) => e.level === level);
  }

  /**
   * Clear alert history.
   */
  clearAlertHistory() {
    this._history = [];
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _isMuted(metric) {
    const expiry = this._muted.get(metric);
    if (!expiry) return false;
    if (Date.now() >= expiry) {
      this._muted.delete(metric);
      return false;
    }
    return true;
  }

  _isInCooldown(metric) {
    const last = this._lastAlertTime.get(metric);
    if (!last) return false;
    return (Date.now() - last) < this._cooldownMs;
  }

  _deliver(alertEntry) {
    // Console channel
    if (this._consoleEnabled) {
      const method = alertEntry.level === "BLOCKER" || alertEntry.level === "CRITICAL"
        ? "error"
        : "warn";
      console[method](alertEntry.message);
    }

    // File channel
    if (this._filePath) {
      try {
        appendToFile(this._filePath, alertEntry.message);
      } catch (err) {
        // File I/O should not crash the alerter
        if (this._consoleEnabled) {
          console.error(`[RegressionAlerter] Failed to write alert to file "${this._filePath}": ${err.message}`);
        }
      }
    }

    // Callback channel
    if (typeof this._callback === "function") {
      try {
        this._callback(alertEntry);
      } catch (err) {
        if (this._consoleEnabled) {
          console.error(`[RegressionAlerter] Alert callback threw: ${err.message}`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { RegressionAlerter, ALERT_LEVELS, severityToAlertLevel };
