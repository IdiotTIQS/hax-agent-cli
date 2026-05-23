/**
 * RegressionDetector — compares benchmark runs to detect performance regressions
 * across latency, throughput, token usage, cost, error rate, and memory.
 *
 * Supports configurable per-metric thresholds with optional auto-adjustment
 * that learns from historical data to reduce false positives.
 */
"use strict";

// ---------------------------------------------------------------------------
// Metric definitions
// ---------------------------------------------------------------------------

/**
 * Built-in metric descriptors. Each entry defines the metric key, a human
 * label, the default regression threshold as a percentage, and the direction
 * that constitutes a regression ("up" = higher is worse, "down" = lower is
 * worse).
 */
const DEFAULT_METRICS = {
  // Latency
  avg:        { label: "Avg Latency",          unit: "ms",   defaultThreshold: 10, direction: "up" },
  p50:        { label: "P50 Latency",          unit: "ms",   defaultThreshold: 10, direction: "up" },
  p95:        { label: "P95 Latency",          unit: "ms",   defaultThreshold: 15, direction: "up" },
  p99:        { label: "P99 Latency",          unit: "ms",   defaultThreshold: 20, direction: "up" },
  min:        { label: "Min Latency",          unit: "ms",   defaultThreshold: 50, direction: "up" },
  max:        { label: "Max Latency",          unit: "ms",   defaultThreshold: 25, direction: "up" },
  stddev:     { label: "Std Deviation",        unit: "ms",   defaultThreshold: 30, direction: "up" },
  // Throughput
  opsPerSec:  { label: "Throughput",           unit: "ops/s", defaultThreshold: 10, direction: "down" },
  // Token usage
  tokensTotal:     { label: "Total Tokens",    unit: "tokens", defaultThreshold: 15, direction: "up" },
  tokensInput:     { label: "Input Tokens",    unit: "tokens", defaultThreshold: 15, direction: "up" },
  tokensOutput:    { label: "Output Tokens",   unit: "tokens", defaultThreshold: 15, direction: "up" },
  // Cost
  cost:       { label: "Cost",                 unit: "USD",  defaultThreshold: 10, direction: "up" },
  // Error
  errorRate:  { label: "Error Rate",           unit: "%",    defaultThreshold: 5,  direction: "up" },
  // Memory
  memoryPeak:      { label: "Peak Memory",     unit: "MB",   defaultThreshold: 15, direction: "up" },
  memoryAvg:       { label: "Avg Memory",      unit: "MB",   defaultThreshold: 15, direction: "up" },
};

// ---------------------------------------------------------------------------
// Severity classification
// ---------------------------------------------------------------------------

/**
 * Severity levels for regressions.
 * @readonly
 * @enum {string}
 */
const SEVERITY = Object.freeze({
  NONE:     "none",
  MINOR:    "minor",
  MODERATE: "moderate",
  MAJOR:    "major",
  CRITICAL: "critical",
});

/**
 * Classify the severity of a regression based on the percentage deviation
 * relative to the metric's threshold.
 *
 * @param {number} changePct - observed percentage change
 * @param {number} threshold - configured threshold for this metric
 * @returns {string} severity level from SEVERITY
 */
function classifySeverity(changePct, threshold) {
  const ratio = changePct / Math.max(threshold, 0.001);

  if (ratio < 1.0)   return SEVERITY.NONE;
  if (ratio < 1.5)   return SEVERITY.MINOR;
  if (ratio < 3.0)   return SEVERITY.MODERATE;
  if (ratio < 6.0)   return SEVERITY.MAJOR;
  return SEVERITY.CRITICAL;
}

/**
 * Compute the absolute percentage change between two numeric values.
 * Returns a positive number when the change is in the "worse" direction.
 *
 * @param {number} current
 * @param {number} baseline
 * @param {string} direction - "up" or "down"
 * @returns {number} signed percentage (positive = regression)
 */
function computeChange(current, baseline, direction) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) {
    return 0;
  }
  const raw = ((current - baseline) / Math.abs(baseline)) * 100;
  return direction === "down" ? -raw : raw;
}

// ---------------------------------------------------------------------------
// Metric registry helpers
// ---------------------------------------------------------------------------

/**
 * Resolve metric thresholds from user-supplied overrides, falling back to
 * defaults.
 *
 * @param {object} overrides - partially specified custom thresholds
 * @returns {object} complete threshold map { metricKey: number }
 */
function resolveThresholds(overrides) {
  const map = {};
  for (const [key, def] of Object.entries(DEFAULT_METRICS)) {
    const userVal = (overrides && overrides[key] !== undefined) ? overrides[key] : null;
    map[key] = Number.isFinite(userVal) ? Number(userVal) : def.defaultThreshold;
  }
  return map;
}

/**
 * Given a key, return the metric descriptor (with defaults if custom).
 * @param {string} key
 * @returns {object} { label, unit, direction }
 */
function describeMetric(key) {
  return DEFAULT_METRICS[key] || { label: key, unit: "", direction: "up" };
}

// ---------------------------------------------------------------------------
// RegressionDetector
// ---------------------------------------------------------------------------

class RegressionDetector {
  /**
   * @param {object} [options]
   * @param {object} [options.thresholds] - per-metric threshold overrides
   * @param {boolean} [options.autoAdjust] - enable adaptive thresholds (default false)
   * @param {number} [options.autoAdjustFactor] - multiplier applied per false-positive (default 0.1)
   * @param {number} [options.autoAdjustMax] - max multiplier cap (default 3.0)
   */
  constructor(options = {}) {
    this._baseline = null;
    this._regressions = [];
    this._thresholds = resolveThresholds(options.thresholds || null);
    this._autoAdjust = options.autoAdjust === true;
    this._autoAdjustFactor = Number.isFinite(options.autoAdjustFactor)
      ? options.autoAdjustFactor : 0.1;
    this._autoAdjustMax = Number.isFinite(options.autoAdjustMax)
      ? options.autoAdjustMax : 3.0;
    this._adjustmentMultipliers = {};
  }

  // ---------------------------------------------------------------------------
  // Baseline management
  // ---------------------------------------------------------------------------

  /**
   * Set the baseline result against which future runs are compared.
   * Accepts a single benchmark result object or a named suite result.
   *
   * @param {object} result - benchmark result object or { name, results: [...] }
   */
  setBaseline(result) {
    if (!result || typeof result !== "object") {
      throw new TypeError("setBaseline expects a benchmark result object.");
    }
    this._baseline = JSON.parse(JSON.stringify(result)); // deep-copy
  }

  /**
   * Discard the current baseline.
   */
  clearBaseline() {
    this._baseline = null;
    this._regressions = [];
    this._adjustmentMultipliers = {};
  }

  /**
   * Retrieve the current baseline.
   * @returns {object|null}
   */
  getBaseline() {
    return this._baseline ? JSON.parse(JSON.stringify(this._baseline)) : null;
  }

  // ---------------------------------------------------------------------------
  // Comparison
  // ---------------------------------------------------------------------------

  /**
   * Compare two benchmark runs (or two named suites) and produce a detailed
   * per-metric comparison object.
   *
   * @param {object} baseline - baseline result
   * @param {object} current - current result to compare against baseline
   * @returns {object[]} array of per-metric comparison entries
   */
  compare(baseline, current) {
    const baselineList = this._normalizeResults(baseline);
    const currentList = this._normalizeResults(current);
    const comparisons = [];

    const maxLen = Math.max(baselineList.length, currentList.length);
    for (let i = 0; i < maxLen; i++) {
      const base = baselineList[i] || null;
      const curr = currentList[i] || null;
      const name = (curr && curr.name) || (base && base.name) || "unnamed";

      const entry = { name, metrics: {} };

      const metricKeys = Object.keys(DEFAULT_METRICS);
      for (const key of metricKeys) {
        const baseVal = base && Number.isFinite(base[key]) ? base[key] : null;
        const currVal = curr && Number.isFinite(curr[key]) ? curr[key] : null;

        if (baseVal === null && currVal === null) continue;

        const direction = describeMetric(key).direction;
        const changePct = baseVal !== null && currVal !== null
          ? computeChange(currVal, baseVal, direction)
          : null;

        entry.metrics[key] = {
          baseline: baseVal,
          current: currVal,
          changePct: changePct !== null ? roundTo(changePct, 2) : null,
          direction,
          threshold: this._getEffectiveThreshold(key),
        };
      }

      comparisons.push(entry);
    }

    return comparisons;
  }

  // ---------------------------------------------------------------------------
  // Regression detection
  // ---------------------------------------------------------------------------

  /**
   * Detect regressions by comparing current results against the stored
   * baseline (or an explicit baseline argument).
   *
   * @param {object} baseline - explicit baseline result (overrides stored)
   * @param {object} current - current result
   * @param {number|object} [threshold] - single threshold % or per-metric map
   * @returns {object} detection report
   */
  detectRegression(baseline, current, threshold) {
    const base = baseline || this._baseline;
    if (!base) {
      return { hasRegression: false, baseline: null, regressions: [], message: "No baseline set" };
    }
    if (!current) {
      return { hasRegression: false, baseline: this._describeBaseline(base), regressions: [], message: "No current results" };
    }

    // Apply explicit threshold overrides temporarily
    const savedThresholds = this._thresholds;
    if (threshold !== undefined && threshold !== null) {
      if (typeof threshold === "number" && Number.isFinite(threshold)) {
        // Single threshold for all metrics
        const map = {};
        for (const key of Object.keys(DEFAULT_METRICS)) {
          map[key] = threshold;
        }
        this._thresholds = map;
      } else if (typeof threshold === "object") {
        this._thresholds = resolveThresholds(threshold);
      }
    }

    try {
      const comparisons = this.compare(base, current);
      const regressions = [];

      for (const entry of comparisons) {
        for (const [metricKey, metricData] of Object.entries(entry.metrics)) {
          if (metricData.changePct === null) continue;

          const effectiveThreshold = this._getEffectiveThreshold(metricKey);
          const absChange = Math.abs(metricData.changePct);

          if (absChange > effectiveThreshold) {
            const severity = classifySeverity(absChange, effectiveThreshold);
            if (severity === SEVERITY.NONE) continue;

            const desc = describeMetric(metricKey);

            regressions.push({
              name: entry.name,
              metric: metricKey,
              label: desc.label,
              unit: desc.unit,
              baseline: metricData.baseline,
              current: metricData.current,
              changePct: metricData.changePct,
              absoluteChange: Math.abs(metricData.current - metricData.baseline),
              direction: metricData.direction,
              threshold: effectiveThreshold,
              severity,
              detectedAt: new Date().toISOString(),
            });
          }
        }
      }

      // Sort regressions by severity and change magnitude
      regressions.sort((a, b) => {
        const severityOrder = { critical: 0, major: 1, moderate: 2, minor: 3 };
        const sevDiff = (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99);
        if (sevDiff !== 0) return sevDiff;
        return Math.abs(b.changePct) - Math.abs(a.changePct);
      });

      this._regressions = regressions;

      // Auto-adjust thresholds on detection
      if (this._autoAdjust) {
        for (const reg of regressions) {
          this._adjustThreshold(reg.metric);
        }
      }

      return {
        hasRegression: regressions.length > 0,
        baseline: this._describeBaseline(base),
        current: this._describeBaseline(current),
        regressions,
        summary: this._buildSummary(regressions),
        comparedAt: new Date().toISOString(),
      };
    } finally {
      // Restore thresholds if they were temporarily overridden
      if (threshold !== undefined && threshold !== null) {
        this._thresholds = savedThresholds;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Categorization
  // ---------------------------------------------------------------------------

  /**
   * Categorize a single regression entry.
   *
   * @param {object} regression - a single regression object
   * @returns {object} enriched categorization
   */
  categorize(regression) {
    if (!regression) return { category: "unknown", priority: 0, recommendation: "No data" };

    const severity = regression.severity || SEVERITY.NONE;
    const change = Math.abs(regression.changePct || 0);
    const metric = regression.metric || "";

    let category = "latency";
    if (metric.startsWith("token"))       category = "token-usage";
    else if (metric === "cost")           category = "cost";
    else if (metric === "errorRate")      category = "reliability";
    else if (metric === "opsPerSec")      category = "throughput";
    else if (metric.startsWith("memory")) category = "memory";

    // Priority: 1 (highest) to 5 (lowest)
    let priority = 3;
    if (severity === SEVERITY.CRITICAL) priority = 1;
    else if (severity === SEVERITY.MAJOR) priority = 2;
    else if (severity === SEVERITY.MODERATE) priority = 3;
    else if (severity === SEVERITY.MINOR) priority = 4;
    else priority = 5;

    // Bump priority for error-rate regressions
    if (category === "reliability" && severity !== SEVERITY.NONE) {
      priority = Math.max(1, priority - 1);
    }

    const recommendation = this._buildRecommendation(category, severity, change);

    return {
      metric,
      category,
      severity,
      priority,
      changePct: change,
      recommendation,
    };
  }

  // ---------------------------------------------------------------------------
  // Retrieval
  // ---------------------------------------------------------------------------

  /**
   * Return all regressions detected by the most recent `detectRegression` call.
   * @returns {object[]}
   */
  getRegressions() {
    return this._regressions.slice();
  }

  /**
   * Return regressions filtered by severity.
   * @param {string} severity - e.g., "critical", "major", "moderate", "minor"
   * @returns {object[]}
   */
  getRegressionsBySeverity(severity) {
    return this._regressions.filter((r) => r.severity === severity);
  }

  /**
   * Return regressions filtered by category.
   * @param {string} category - e.g., "latency", "cost", "token-usage"
   * @returns {object[]}
   */
  getRegressionsByCategory(category) {
    return this._regressions.filter((r) => this.categorize(r).category === category);
  }

  /**
   * Get the current effective threshold for a metric (including auto-adjustment).
   * @param {string} metricKey
   * @returns {number}
   */
  getThreshold(metricKey) {
    return this._getEffectiveThreshold(metricKey);
  }

  /**
   * Update a single metric threshold manually.
   * @param {string} metricKey
   * @param {number} value - percentage threshold
   */
  setThreshold(metricKey, value) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`Threshold for "${metricKey}" must be a positive number.`);
    }
    this._thresholds[metricKey] = value;
    // Reset auto-adjustment for this metric since user set it explicitly
    delete this._adjustmentMultipliers[metricKey];
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Normalize a result to an array of individual bench results.
   * Supports either a single result `{ name, avg, ... }` or a suite
   * `{ name, results: [{ name, avg, ... }, ...] }`.
   */
  _normalizeResults(result) {
    if (!result) return [];
    if (Array.isArray(result.results)) return result.results;
    if (result.avg !== undefined || result.min !== undefined) return [result];
    if (Array.isArray(result)) return result;
    return [];
  }

  _describeBaseline(result) {
    if (!result) return null;
    const list = this._normalizeResults(result);
    return {
      name: result.name || "unnamed",
      count: list.length,
      names: list.map((r) => r.name || "unnamed"),
    };
  }

  _getEffectiveThreshold(metricKey) {
    const base = this._thresholds[metricKey] || 10;
    const mult = this._adjustmentMultipliers[metricKey] || 1.0;
    return base * mult;
  }

  _buildSummary(regressions) {
    if (regressions.length === 0) return "No regressions detected.";

    const bySeverity = { critical: 0, major: 0, moderate: 0, minor: 0 };
    for (const r of regressions) {
      bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
    }

    const parts = [];
    if (bySeverity.critical > 0) parts.push(`${bySeverity.critical} critical`);
    if (bySeverity.major > 0)    parts.push(`${bySeverity.major} major`);
    if (bySeverity.moderate > 0) parts.push(`${bySeverity.moderate} moderate`);
    if (bySeverity.minor > 0)    parts.push(`${bySeverity.minor} minor`);

    const worstReg = regressions[0];
    return `${regressions.length} regression(s) detected: ${parts.join(", ")}. Worst: ${worstReg.label} changed by ${worstReg.changePct.toFixed(1)}% (${worstReg.severity}).`;
  }

  _buildRecommendation(category, severity, change) {
    const recommendations = {
      latency:    "Profile hot paths and check for additional I/O or blocking operations introduced in recent changes.",
      throughput: "Investigate connection pooling, concurrency limits, or resource contention in the latest changeset.",
      "token-usage": "Review prompt templates and response lengths. Consider trimming context or enabling caching.",
      cost:       "Audit API call patterns and model selection. Evaluate whether the same work can be done with a cheaper model.",
      reliability: "Check error logs and increase test coverage around failure-prone code paths. Consider adding retry logic.",
      memory:     "Look for memory leaks, large object allocations, or undisposed resources in recent changes.",
    };

    const urgency = severity === "critical" ? "Immediately " : severity === "major" ? "Promptly " : "";

    return `${urgency}${recommendations[category] || "Review the recent changes for potential causes."}`;
  }

  /**
   * Auto-adjust a metric's threshold upward when a regression is detected,
   * to reduce false positives from noisy metrics.
   */
  _adjustThreshold(metricKey) {
    const current = this._adjustmentMultipliers[metricKey] || 1.0;
    const next = Math.min(current + this._autoAdjustFactor, this._autoAdjustMax);
    this._adjustmentMultipliers[metricKey] = next;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { RegressionDetector, SEVERITY, classifySeverity, DEFAULT_METRICS };
