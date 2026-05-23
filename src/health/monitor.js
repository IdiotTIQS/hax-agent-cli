"use strict";

/**
 * HealthMonitor — continuous project health monitoring and alerting system.
 *
 * Tracks five core health dimensions over time:
 *   - codeHealth     (0-100 aggregate code quality score)
 *   - testCoverage   (0-100 estimated test coverage)
 *   - debtRatio      (0-1 ratio of active debt to total codebase size)
 *   - docCoverage    (0-100 documentation coverage)
 *   - dependencyHealth (0-100 dependency freshness / vulnerability score)
 *
 * Supports interval-based polling via start()/stop(), single-shot check(),
 * historical snapshots, and a pub/sub alerting system.
 */

const { EventEmitter } = require("events");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 30000; // 30 seconds

const HEALTH_DIMENSIONS = Object.freeze([
  "codeHealth",
  "testCoverage",
  "debtRatio",
  "docCoverage",
  "dependencyHealth",
]);

const DEFAULT_THRESHOLDS = Object.freeze({
  codeHealth:        { warn: 70, critical: 50 },
  testCoverage:      { warn: 60, critical: 30 },
  debtRatio:         { warn: 0.3, critical: 0.6 },
  docCoverage:       { warn: 50, critical: 25 },
  dependencyHealth:  { warn: 70, critical: 40 },
});

const ALERT_LEVELS = Object.freeze(["info", "warn", "critical"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowISO() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeHealthScore(dimensions) {
  const weights = {
    codeHealth: 0.30,
    testCoverage: 0.25,
    debtRatio: 0.20,
    docCoverage: 0.15,
    dependencyHealth: 0.10,
  };

  let total = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const val = dimensions[key];
    if (val == null) continue;

    // debtRatio is inverted (lower is better)
    const normalized = key === "debtRatio"
      ? clamp(100 - val * 100, 0, 100)
      : clamp(val, 0, 100);

    total += normalized * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? Math.round(total / totalWeight) : 0;
}

function gradeFromScore(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

// ---------------------------------------------------------------------------
// HealthMonitor
// ---------------------------------------------------------------------------

class HealthMonitor extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.maxHistory]      - max history entries to retain (default 1000)
   * @param {number} [options.maxAlerts]       - max active alerts to retain (default 500)
   * @param {object} [options.thresholds]      - override default alert thresholds
   * @param {object} [options.initialMetrics]  - seed initial metric values
   */
  constructor(options = {}) {
    super();

    this._options = options;
    this._maxHistory = options.maxHistory || 1000;
    this._maxAlerts = options.maxAlerts || 500;
    this._thresholds = options.thresholds
      ? { ...DEFAULT_THRESHOLDS, ...options.thresholds }
      : { ...DEFAULT_THRESHOLDS };

    // Current metric state
    this._dimensions = {
      codeHealth: options.initialMetrics?.codeHealth ?? null,
      testCoverage: options.initialMetrics?.testCoverage ?? null,
      debtRatio: options.initialMetrics?.debtRatio ?? null,
      docCoverage: options.initialMetrics?.docCoverage ?? null,
      dependencyHealth: options.initialMetrics?.dependencyHealth ?? null,
    };

    // History ring buffer
    this._history = [];

    // Active alerts
    this._alerts = [];

    // Monitoring state
    this._intervalId = null;
    this._running = false;
    this._checkCount = 0;
    this._startedAt = null;
    this._lastCheckAt = null;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Begin continuous health monitoring at the configured interval.
   *
   * @param {object} [options]
   * @param {number} [options.intervalMs]  - polling interval in ms (default 30000)
   * @param {boolean} [options.immediate]  - run a check immediately (default true)
   * @returns {HealthMonitor} this instance for chaining
   */
  start(options = {}) {
    if (this._running) {
      this.emit("warning", { message: "HealthMonitor is already running" });
      return this;
    }

    const intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;

    if (typeof intervalMs !== "number" || intervalMs < 100) {
      throw new RangeError("intervalMs must be a number >= 100");
    }

    this._running = true;
    this._startedAt = nowISO();

    if (options.immediate !== false) {
      this.check();
    }

    this._intervalId = setInterval(() => {
      this.check();
    }, intervalMs);

    this.emit("started", {
      intervalMs,
      startedAt: this._startedAt,
    });

    return this;
  }

  /**
   * Stop continuous health monitoring.
   *
   * @returns {HealthMonitor} this instance for chaining
   */
  stop() {
    if (!this._running) {
      return this;
    }

    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }

    this._running = false;

    this.emit("stopped", {
      stoppedAt: nowISO(),
      totalChecks: this._checkCount,
    });

    return this;
  }

  /**
   * Run a single health check. Accepts external metric values so that
   * external tools (scorer, debt tracker, etc.) can feed data in.
   *
   * @param {object} [metrics] - partial set of dimension values to merge
   * @returns {object} health snapshot
   */
  check(metrics = {}) {
    // Merge incoming metrics into tracked dimensions
    for (const dim of HEALTH_DIMENSIONS) {
      if (metrics[dim] != null) {
        this._dimensions[dim] = metrics[dim];
      }
    }

    this._checkCount++;
    this._lastCheckAt = nowISO();

    // Build per-dimension statuses
    const dimensionStatuses = {};
    let alertCount = 0;

    for (const dim of HEALTH_DIMENSIONS) {
      const value = this._dimensions[dim];
      const threshold = this._thresholds[dim] || {};

      let status = "unknown";
      if (value != null) {
        if (dim === "debtRatio") {
          // debtRatio: higher is worse
          if (value > threshold.critical) {
            status = "critical";
          } else if (value > threshold.warn) {
            status = "warn";
          } else {
            status = "pass";
          }
        } else {
          // All other metrics: higher is better
          if (value < threshold.critical) {
            status = "critical";
          } else if (value < threshold.warn) {
            status = "warn";
          } else {
            status = "pass";
          }
        }
      }

      dimensionStatuses[dim] = {
        value,
        status,
        threshold: threshold,
      };

      if (status === "warn" || status === "critical") {
        alertCount++;
      }
    }

    // Compute aggregate score
    const overallScore = computeHealthScore(this._dimensions);
    const grade = gradeFromScore(overallScore);

    const snapshot = {
      timestamp: this._lastCheckAt,
      checkNumber: this._checkCount,
      overallScore,
      grade,
      dimensions: { ...this._dimensions },
      dimensionStatuses,
      activeAlerts: this._alerts.length,
    };

    // Append to history
    this._history.push(snapshot);
    if (this._history.length > this._maxHistory) {
      this._history.shift();
    }

    // Evaluate thresholds and emit alerts
    this._evaluateAlerts(snapshot);

    this.emit("check", snapshot);

    return snapshot;
  }

  /**
   * Get the current health status including all tracked dimensions,
   * the aggregate score, grade, running state, and monitoring metadata.
   *
   * @returns {object}
   */
  getStatus() {
    const overallScore = computeHealthScore(this._dimensions);
    const grade = gradeFromScore(overallScore);

    // Build dimension statuses
    const dimensionStatuses = {};
    for (const dim of HEALTH_DIMENSIONS) {
      const value = this._dimensions[dim];
      const threshold = this._thresholds[dim] || {};
      let status = "unknown";
      if (value != null) {
        if (dim === "debtRatio") {
          status = value > threshold.critical ? "critical"
            : value > threshold.warn ? "warn" : "pass";
        } else {
          status = value < threshold.critical ? "critical"
            : value < threshold.warn ? "warn" : "pass";
        }
      }
      dimensionStatuses[dim] = { value, status, threshold };
    }

    return {
      timestamp: nowISO(),
      overallScore,
      grade,
      dimensions: { ...this._dimensions },
      dimensionStatuses,
      monitoring: {
        running: this._running,
        startedAt: this._startedAt,
        lastCheckAt: this._lastCheckAt,
        totalChecks: this._checkCount,
      },
      alerts: {
        active: this._alerts.length,
        recent: this._alerts.slice(0, 10),
      },
    };
  }

  /**
   * Get the full history of health snapshots.
   *
   * @param {object} [options]
   * @param {number} [options.limit]     - max entries to return
   * @param {string} [options.since]     - ISO timestamp; only entries after this
   * @param {boolean} [options.summary]  - return only overallScore per snapshot
   * @returns {Array<object>}
   */
  getHistory(options = {}) {
    let results = [...this._history];

    if (options.since) {
      const sinceDate = new Date(options.since).getTime();
      results = results.filter((s) => new Date(s.timestamp).getTime() >= sinceDate);
    }

    if (options.summary) {
      results = results.map((s) => ({
        timestamp: s.timestamp,
        checkNumber: s.checkNumber,
        overallScore: s.overallScore,
        grade: s.grade,
      }));
    }

    if (options.limit && options.limit > 0) {
      // Return the most recent N entries
      results = results.slice(-options.limit);
    }

    return results;
  }

  /**
   * Get all active (unresolved) alerts.
   *
   * @param {object} [options]
   * @param {string} [options.level]   - filter by alert level (info|warn|critical)
   * @param {string} [options.dimension] - filter by health dimension
   * @returns {Array<object>}
   */
  getAlerts(options = {}) {
    let results = [...this._alerts];

    if (options.level) {
      results = results.filter((a) => a.level === options.level);
    }
    if (options.dimension) {
      results = results.filter((a) => a.dimension === options.dimension);
    }

    return results;
  }

  /**
   * Subscribe a handler to be called whenever an alert is raised.
   * Alias for `on("alert", handler)`. Returns unsubscribe function.
   *
   * @param {function} handler - receives the alert object
   * @returns {function} unsubscribe function
   */
  onAlert(handler) {
    if (typeof handler !== "function") {
      throw new TypeError("handler must be a function");
    }

    this.on("alert", handler);

    // Return an unsubscribe function
    return () => {
      this.off("alert", handler);
    };
  }

  /**
   * Dismiss (remove) an alert by its ID.
   *
   * @param {string} alertId
   * @returns {boolean} true if found and removed
   */
  dismissAlert(alertId) {
    const idx = this._alerts.findIndex((a) => a.id === alertId);
    if (idx === -1) return false;
    this._alerts.splice(idx, 1);
    this.emit("alertDismissed", { id: alertId });
    return true;
  }

  /**
   * Dismiss all active alerts.
   *
   * @returns {number} count of dismissed alerts
   */
  dismissAllAlerts() {
    const count = this._alerts.length;
    this._alerts = [];
    this.emit("alertsCleared", { count });
    return count;
  }

  /**
   * Update alert thresholds at runtime.
   *
   * @param {object} thresholds - partial thresholds to merge
   */
  updateThresholds(thresholds) {
    if (!thresholds || typeof thresholds !== "object") {
      throw new TypeError("thresholds must be an object");
    }
    this._thresholds = { ...this._thresholds, ...thresholds };
    this.emit("thresholdsUpdated", { thresholds: this._thresholds });
  }

  /**
   * Manually set a dimension value without triggering a full check cycle.
   *
   * @param {string} dimension - key from HEALTH_DIMENSIONS
   * @param {number} value    - new value
   */
  setDimension(dimension, value) {
    if (!HEALTH_DIMENSIONS.includes(dimension)) {
      throw new TypeError(
        `Unknown dimension "${dimension}". Valid: ${HEALTH_DIMENSIONS.join(", ")}`
      );
    }
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new TypeError(`value for "${dimension}" must be a number`);
    }

    this._dimensions[dimension] = value;
  }

  /**
   * Reset all state: stop monitoring, clear history, clear alerts.
   */
  reset() {
    this.stop();

    for (const dim of HEALTH_DIMENSIONS) {
      this._dimensions[dim] = null;
    }

    this._history = [];
    this._alerts = [];
    this._checkCount = 0;
    this._startedAt = null;
    this._lastCheckAt = null;

    this.emit("reset");
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Evaluate current snapshot against thresholds and raise alerts as needed.
   */
  _evaluateAlerts(snapshot) {
    for (const [dim, status] of Object.entries(snapshot.dimensionStatuses)) {
      if (status.status !== "warn" && status.status !== "critical") continue;

      // Check if we already have a non-dismissed alert for this dimension
      const existing = this._alerts.find(
        (a) => a.dimension === dim && !a.resolved
      );

      if (existing) {
        // Update the existing alert
        existing.lastSeenAt = snapshot.timestamp;
        existing.value = status.value;
        existing.level = status.status;
        existing.count = (existing.count || 1) + 1;
        continue;
      }

      // Create new alert
      const thresholds = this._thresholds[dim] || {};
      const label = this._dimensionLabel(dim);
      const direction = dim === "debtRatio" ? "exceeds" : "below";

      const alert = {
        id: `alert_${dim}_${Date.now()}_${this._checkCount}`,
        dimension: dim,
        label,
        level: status.status,
        value: status.value,
        threshold: status.status === "critical"
          ? thresholds.critical
          : thresholds.warn,
        message: `${label} ${direction} threshold (${status.value}, threshold: ${status.status === "critical" ? thresholds.critical : thresholds.warn})`,
        raisedAt: snapshot.timestamp,
        lastSeenAt: snapshot.timestamp,
        resolved: false,
        resolvedAt: null,
        count: 1,
      };

      this._alerts.push(alert);
      if (this._alerts.length > this._maxAlerts) {
        this._alerts.shift();
      }

      // Emit on the instance and via any onAlert subscribers
      this.emit("alert", alert);
    }

    // Auto-resolve alerts for dimensions that have recovered
    for (const alert of this._alerts) {
      if (alert.resolved) continue;

      const current = snapshot.dimensionStatuses[alert.dimension];
      if (current && current.status === "pass") {
        alert.resolved = true;
        alert.resolvedAt = snapshot.timestamp;
        this.emit("alertResolved", alert);
      }
    }
  }

  _dimensionLabel(dim) {
    const labels = {
      codeHealth: "Code Health",
      testCoverage: "Test Coverage",
      debtRatio: "Debt Ratio",
      docCoverage: "Documentation Coverage",
      dependencyHealth: "Dependency Health",
    };
    return labels[dim] || dim;
  }
}

module.exports = {
  HealthMonitor,
  HEALTH_DIMENSIONS,
  DEFAULT_THRESHOLDS,
  DEFAULT_INTERVAL_MS,
  ALERT_LEVELS,
};
