'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Severity levels used for alerting.
 */
const ALERT_SEVERITIES = Object.freeze(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/**
 * Default alert threshold — alerts fire for HIGH and CRITICAL by default.
 */
const DEFAULT_ALERT_THRESHOLD = 'HIGH';

/**
 * Maximum number of attempt records to retain in history.
 */
const MAX_HISTORY_SIZE = 10000;

/**
 * Window duration in milliseconds for rate limiting checks.
 */
const RATE_WINDOW_MS = 60_000; // 1 minute

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get a numeric weight for severity levels for comparison.
 *
 * @param {string} severity
 * @returns {number}
 */
function severityWeight(severity) {
  const map = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  return map[severity] !== undefined ? map[severity] : 0;
}

/**
 * Check if a severity meets or exceeds a threshold.
 *
 * @param {string} severity
 * @param {string} threshold
 * @returns {boolean}
 */
function meetsThreshold(severity, threshold) {
  return severityWeight(severity) >= severityWeight(threshold);
}

/**
 * Truncate a string for evidence display.
 *
 * @param {string} text
 * @param {number} [maxLen]
 * @returns {string}
 */
function truncate(text, maxLen) {
  const limit = maxLen || 150;
  if (text.length <= limit) return text;
  return text.substring(0, limit) + '...';
}

// ---------------------------------------------------------------------------
// InjectionMonitor
// ---------------------------------------------------------------------------

/**
 * Monitors agent sessions for prompt injection attempts, maintains a
 * history of detections, generates statistics, and triggers alerts
 * for high-severity incidents.
 */
class InjectionMonitor {
  /**
   * @param {object} [options]
   * @param {string} [options.alertThreshold] — minimum severity to trigger alerts (default: 'HIGH')
   * @param {function} [options.alertHandler] — callback: (attempt) => void, invoked on alert
   * @param {function} [options.logHandler] — callback: (attempt) => void, invoked on every log
   * @param {number} [options.maxHistorySize] — max records in history (default: 10000)
   * @param {object} [options.rateLimit] — { maxAttempts, windowMs } for rate-aware monitoring
   */
  constructor(options = {}) {
    this._attempts = [];
    this._alertThreshold = ALERT_SEVERITIES.includes(options.alertThreshold)
      ? options.alertThreshold
      : DEFAULT_ALERT_THRESHOLD;
    this._alertHandler = typeof options.alertHandler === 'function' ? options.alertHandler : null;
    this._logHandler = typeof options.logHandler === 'function' ? options.logHandler : null;
    this._maxHistorySize =
      Number.isSafeInteger(options.maxHistorySize) && options.maxHistorySize > 0
        ? options.maxHistorySize
        : MAX_HISTORY_SIZE;
    this._rateLimit = options.rateLimit || { maxAttempts: 0, windowMs: RATE_WINDOW_MS };
    this._isMonitoring = false;
    this._currentSession = null;
    this._alertCount = 0;
    this._loggedCount = 0;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Begin monitoring a session for injection attempts.
   *
   * @param {object} session — session object (must have an `id` property)
   * @returns {object} monitoring context
   */
  monitor(session) {
    if (!session || typeof session !== 'object') {
      throw new TypeError('monitor: session must be an object');
    }
    if (typeof session.id !== 'string' && typeof session.id !== 'number') {
      throw new TypeError('monitor: session must have a string or numeric "id"');
    }

    this._isMonitoring = true;
    this._currentSession = {
      id: String(session.id),
      startTime: new Date().toISOString(),
      metadata: session.metadata || {},
    };

    return {
      sessionId: this._currentSession.id,
      monitoring: true,
      startTime: this._currentSession.startTime,
    };
  }

  /**
   * Log a detected injection attempt.
   *
   * @param {object} attempt
   * @param {string} attempt.threatLevel — NONE / LOW / MEDIUM / HIGH / CRITICAL
   * @param {string} [attempt.source] — where the attempt originated
   * @param {string} [attempt.evidence] — the suspicious content
   * @param {string[]} [attempt.categories] — detection categories
   * @param {number} [attempt.matchCount] — number of matches found
   * @param {object} [attempt.metadata] — additional context
   * @returns {object} log entry
   */
  logAttempt(attempt) {
    if (!attempt || typeof attempt !== 'object') {
      throw new TypeError('logAttempt: attempt must be an object');
    }

    const entry = {
      id: this._generateId(),
      sessionId: this._currentSession ? this._currentSession.id : 'unknown',
      threatLevel: ALERT_SEVERITIES.includes(attempt.threatLevel)
        ? attempt.threatLevel
        : 'MEDIUM',
      source: typeof attempt.source === 'string' ? attempt.source : 'unknown',
      evidence: truncate(
        typeof attempt.evidence === 'string' ? attempt.evidence : '',
      ),
      categories: Array.isArray(attempt.categories) ? [...attempt.categories] : [],
      matchCount: Number.isSafeInteger(attempt.matchCount) ? attempt.matchCount : 0,
      metadata: attempt.metadata || {},
      timestamp: new Date().toISOString(),
      alerted: false,
    };

    // Add to history with size cap
    this._attempts.push(entry);
    while (this._attempts.length > this._maxHistorySize) {
      this._attempts.shift();
    }

    this._loggedCount += 1;

    // Invoke log handler
    if (this._logHandler) {
      try {
        this._logHandler(entry);
      } catch (_err) {
        // Log handler should not crash the monitor
      }
    }

    // Check if alert threshold is met
    if (meetsThreshold(entry.threatLevel, this._alertThreshold)) {
      this.alert(entry);
    }

    return entry;
  }

  /**
   * Get the complete history of injection attempts.
   *
   * @param {object} [options]
   * @param {string} [options.sessionId] — filter by session
   * @param {string} [options.minSeverity] — filter by minimum severity
   * @param {number} [options.limit] — max entries to return
   * @param {number} [options.offset] — start offset for pagination
   * @returns {object[]} array of attempt records
   */
  getAttemptHistory(options = {}) {
    let results = [...this._attempts];

    // Filter by session
    if (options.sessionId) {
      results = results.filter((a) => a.sessionId === String(options.sessionId));
    }

    // Filter by minimum severity
    if (options.minSeverity && ALERT_SEVERITIES.includes(options.minSeverity)) {
      const minWeight = severityWeight(options.minSeverity);
      results = results.filter((a) => severityWeight(a.threatLevel) >= minWeight);
    }

    // Sort by timestamp descending (newest first)
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // Pagination
    const offset = Number.isSafeInteger(options.offset) && options.offset > 0
      ? options.offset
      : 0;
    const limit = Number.isSafeInteger(options.limit) && options.limit > 0
      ? options.limit
      : results.length;

    return results.slice(offset, offset + limit);
  }

  /**
   * Get statistics on injection attempts.
   *
   * @param {object} [options]
   * @param {string} [options.sessionId] — restrict stats to a session
   * @param {string} [options.since] — ISO timestamp, only include entries after this
   * @returns {object} stats object
   */
  getStats(options = {}) {
    let dataset = [...this._attempts];

    if (options.sessionId) {
      dataset = dataset.filter((a) => a.sessionId === String(options.sessionId));
    }
    if (options.since) {
      dataset = dataset.filter((a) => a.timestamp >= options.since);
    }

    // Per-severity counts
    const bySeverity = {};
    for (const sev of ALERT_SEVERITIES) {
      bySeverity[sev] = dataset.filter((a) => a.threatLevel === sev).length;
    }

    // Per-category counts
    const byCategory = {};
    for (const a of dataset) {
      for (const cat of a.categories) {
        byCategory[cat] = (byCategory[cat] || 0) + 1;
      }
    }

    // Per-source counts
    const bySource = {};
    for (const a of dataset) {
      bySource[a.source] = (bySource[a.source] || 0) + 1;
    }

    // Time range
    let firstTimestamp = null;
    let lastTimestamp = null;
    if (dataset.length > 0) {
      firstTimestamp = dataset[0].timestamp;
      lastTimestamp = dataset[dataset.length - 1].timestamp;
    }

    // Rate
    const ratePerMinute = this._calculateRate(dataset, options);

    // Most common evidence snippets (top 5)
    const evidenceCounts = {};
    for (const a of dataset) {
      if (a.evidence) {
        const key = a.evidence.substring(0, 60);
        evidenceCounts[key] = (evidenceCounts[key] || 0) + 1;
      }
    }
    const topEvidence = Object.entries(evidenceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([evidence, count]) => ({ evidence, count }));

    return {
      totalAttempts: dataset.length,
      alertedCount: this._alertCount,
      loggedCount: this._loggedCount,
      isMonitoring: this._isMonitoring,
      currentSession: this._currentSession ? this._currentSession.id : null,
      bySeverity,
      byCategory,
      bySource,
      topEvidence,
      ratePerMinute,
      firstTimestamp,
      lastTimestamp,
    };
  }

  /**
   * Trigger an alert for a high-severity injection attempt.
   *
   * @param {object} attempt — the attempt object from logAttempt
   * @returns {object} alert record
   */
  alert(attempt) {
    if (!attempt || typeof attempt !== 'object') {
      throw new TypeError('alert: attempt must be an object');
    }

    // Mark the attempt as alerted
    if (attempt.id) {
      const stored = this._attempts.find((a) => a.id === attempt.id);
      if (stored) {
        stored.alerted = true;
      }
    }

    this._alertCount += 1;

    // Build alert record
    const alertRecord = {
      id: `alert-${this._alertCount}`,
      attemptId: attempt.id || 'unknown',
      threatLevel: attempt.threatLevel,
      source: attempt.source,
      evidence: attempt.evidence,
      timestamp: new Date().toISOString(),
      sessionId: attempt.sessionId || (this._currentSession ? this._currentSession.id : null),
    };

    // Invoke alert handler
    if (this._alertHandler) {
      try {
        this._alertHandler(alertRecord);
      } catch (_err) {
        // Alert handler should not crash the monitor
      }
    }

    return alertRecord;
  }

  /**
   * Generate a comprehensive security summary report.
   *
   * @param {object} [options]
   * @param {string} [options.sessionId]
   * @param {string} [options.since]
   * @returns {object} report
   */
  generateSecurityReport(options = {}) {
    const stats = this.getStats(options);

    // Determine overall risk level
    let overallRisk = 'NONE';
    const criticalCount = stats.bySeverity.CRITICAL || 0;
    const highCount = stats.bySeverity.HIGH || 0;
    const mediumCount = stats.bySeverity.MEDIUM || 0;

    if (criticalCount > 0) overallRisk = 'CRITICAL';
    else if (highCount > 2) overallRisk = 'CRITICAL';
    else if (highCount > 0) overallRisk = 'HIGH';
    else if (mediumCount > 5) overallRisk = 'HIGH';
    else if (mediumCount > 0) overallRisk = 'MEDIUM';
    else if (stats.totalAttempts > 0) overallRisk = 'LOW';

    // Top sessions by attempts
    const sessionCounts = {};
    for (const a of this._attempts) {
      if (options.sessionId && a.sessionId !== options.sessionId) continue;
      sessionCounts[a.sessionId] = (sessionCounts[a.sessionId] || 0) + 1;
    }
    const topSessions = Object.entries(sessionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ sessionId: id, attempts: count }));

    // Recommendations
    const recommendations = [];
    if (criticalCount > 0) {
      recommendations.push(
        'CRITICAL: Immediate investigation required — critical injection attempts detected',
      );
    }
    if (stats.ratePerMinute > 5) {
      recommendations.push(
        'HIGH: High rate of injection attempts — consider rate limiting or IP blocking',
      );
    }
    if (stats.byCategory['instruction_override'] > 0) {
      recommendations.push(
        'MODERATE: Instruction override patterns detected — review input validation rules',
      );
    }
    if (stats.byCategory['tool_manipulation'] > 0) {
      recommendations.push(
        'HIGH: Tool manipulation patterns detected — audit tool permissions and access controls',
      );
    }
    if (stats.byCategory['encoded_payload'] > 0) {
      recommendations.push(
        'MODERATE: Encoded payloads detected — review content decoding and sanitization',
      );
    }
    if (stats.totalAttempts === 0) {
      recommendations.push('No injection attempts detected — system appears secure');
    }

    return {
      generatedAt: new Date().toISOString(),
      reportType: 'prompt_injection_security',
      overallRisk,
      summary: stats,
      topSessions,
      recommendations,
      alertThreshold: this._alertThreshold,
      monitoringActive: this._isMonitoring,
    };
  }

  /**
   * Stop monitoring the current session.
   *
   * @returns {object} final session record
   */
  stopMonitoring() {
    const session = this._currentSession;
    this._isMonitoring = false;
    this._currentSession = null;

    return {
      sessionId: session ? session.id : null,
      endTime: new Date().toISOString(),
      totalAttemptsDuringSession: session
        ? this._attempts.filter((a) => a.sessionId === session.id).length
        : 0,
    };
  }

  /**
   * Clear all stored history and reset counters.
   */
  reset() {
    this._attempts = [];
    this._isMonitoring = false;
    this._currentSession = null;
    this._alertCount = 0;
    this._loggedCount = 0;
  }

  /**
   * Check if the monitor is currently active.
   *
   * @returns {boolean}
   */
  isMonitoring() {
    return this._isMonitoring;
  }

  /**
   * Get the current alert threshold.
   *
   * @returns {string}
   */
  getAlertThreshold() {
    return this._alertThreshold;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Generate a unique ID for attempt records.
   *
   * @returns {string}
   * @private
   */
  _generateId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return `inj-${ts}-${rand}`;
  }

  /**
   * Calculate the rate of injection attempts per minute.
   *
   * @param {object[]} dataset
   * @param {object} options
   * @returns {number}
   * @private
   */
  _calculateRate(dataset, options) {
    if (dataset.length < 2) return dataset.length;

    // Get time range in minutes
    const timestamps = dataset.map((a) => new Date(a.timestamp).getTime());
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);
    const rangeMinutes = (maxTs - minTs) / 60_000;

    if (rangeMinutes <= 0) return dataset.length;

    return Math.round((dataset.length / rangeMinutes) * 100) / 100;
  }
}

module.exports = {
  InjectionMonitor,
  ALERT_SEVERITIES,
  DEFAULT_ALERT_THRESHOLD,
};
