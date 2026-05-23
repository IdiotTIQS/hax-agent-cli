"use strict";

/**
 * Analytics bridge — wires conversation analytics, tool insights, anomaly
 * detection, and prediction into the session lifecycle via the EventBus.
 *
 * Usage:
 *   const { setupAnalytics } = require('./infrastructure/analytics-setup');
 *   setupAnalytics(session);
 */

const path = require("node:path");
const os = require("node:os");

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** @type {Map<string, object>} sessionId -> collected analytics */
const _results = new Map();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize analytics tracking for a session.
 *
 * Subscribes to EventBus events (session:start, agent:turn_end, session:end)
 * and wires together conversation stats, anomaly detection, predictions,
 * and report generation.
 *
 * Results are stored on `session.analytics` and in the internal _results map.
 *
 * @param {object} session
 * @param {object} [options]
 * @param {boolean} [options.anomalyAlerts] - emit analytics:anomaly events (default true)
 * @param {boolean} [options.generateReportOnEnd] - auto-generate report on session:end (default false)
 */
function setupAnalytics(session, options = {}) {
  const opts = {
    anomalyAlerts: true,
    generateReportOnEnd: false,
    ...options,
  };

  if (!session || !session.eventBus) {
    // EventBus not wired — analytics cannot function
    return;
  }

  // Check that analytics modules exist before subscribing
  let analyzeSession, analyzeSessions, getUsageTrends;
  let ConversationPredictor;
  let AnomalyDetector;
  let generateSessionReport, generateWeeklyReport;
  let getToolUsageStats, getMostUsedTools, getErrorProneTools, getToolSequencePatterns;
  let modulesLoaded = false;

  try {
    ({ analyzeSession, analyzeSessions, getUsageTrends } = require("../analytics/conversation-stats"));
    ({ ConversationPredictor } = require("../analytics/predictor"));
    ({ AnomalyDetector } = require("../analytics/anomaly-detector"));
    ({ generateSessionReport, generateWeeklyReport } = require("../analytics/report-generator"));
    ({
      getToolUsageStats,
      getMostUsedTools,
      getErrorProneTools,
      getToolSequencePatterns,
    } = require("../analytics/tool-insights"));
    modulesLoaded = true;
  } catch (_) {
    // Analytics modules not available — silently skip
  }

  if (!modulesLoaded) return;

  // Initialize per-session analytics state
  session.analytics = {
    stats: null,
    anomalies: [],
    prediction: null,
    toolInsights: null,
    report: null,
    weeklyReport: null,
    turnCount: 0,
    anomalyDetector: new AnomalyDetector(),
    predictor: new ConversationPredictor(),
  };

  _results.set(session.id, session.analytics);

  // Subscribe to agent:turn_end to detect anomalies after each turn
  if (session.eventBus) {
    session.eventBus.on("agent:turn_end", (data) => {
      try {
        session.analytics.turnCount += 1;

        // Detect anomalies on each turn
        const entries = Array.isArray(data?.entries)
          ? data.entries
          : (session.messages || []);

        const detected = session.analytics.anomalyDetector.detect(entries);
        session.analytics.anomalies = detected;

        // Emit anomaly events if any found
        if (opts.anomalyAlerts && detected.length > 0) {
          const summary = session.analytics.anomalyDetector.getSeveritySummary();
          for (const anomaly of detected) {
            session.eventBus.emit("analytics:anomaly", {
              sessionId: session.id,
              anomaly,
              severitySummary: summary,
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch (_) { /* best-effort */ }
    });

    // Subscribe to session:end to run final analysis
    session.eventBus.on("session:end", (data) => {
      try {
        const entries = Array.isArray(data?.entries)
          ? data.entries
          : (session.messages || []);

        // Run conversation analysis
        session.analytics.stats = analyzeSession(entries, {
          includeLatency: true,
          includeTokenDetails: true,
        });

        // Run tool insights
        session.analytics.toolInsights = {
          toolStats: getToolUsageStats([{ id: session.id, entries }]),
          mostUsed: getMostUsedTools([{ id: session.id, entries }], 10),
          errorProne: getErrorProneTools([{ id: session.id, entries }]),
          patterns: getToolSequencePatterns([{ id: session.id, entries }]),
        };

        // Run prediction
        try {
          session.analytics.prediction = session.analytics.predictor.predictSuccess(entries);
        } catch (_) { /* prediction is best-effort */ }

        // Run final anomaly scan
        try {
          session.analytics.anomalies = session.analytics.anomalyDetector.detect(entries);
        } catch (_) { /* best-effort */ }

        // Auto-generate report if configured
        if (opts.generateReportOnEnd) {
          try {
            session.analytics.report = generateSessionReport(
              { id: session.id, entries },
              { includeCharts: true, includeFindings: true }
            );
          } catch (_) { /* best-effort */ }
        }

        // Emit final analytics event
        session.eventBus.emit("analytics:session_complete", {
          sessionId: session.id,
          stats: session.analytics.stats,
          anomalyCount: session.analytics.anomalies.length,
          timestamp: new Date().toISOString(),
        });
      } catch (_) { /* best-effort */ }
    });
  }
}

/**
 * Get stored analytics results for a session.
 *
 * @param {string} sessionId
 * @returns {object|null}
 */
function getAnalytics(sessionId) {
  return _results.get(sessionId) || null;
}

/**
 * Get or compute tool insights for a session.
 *
 * @param {object} session
 * @returns {object} tool insights
 */
function getToolInsights(session) {
  const analytics = session?.analytics;
  if (!analytics) return null;

  if (analytics.toolInsights) return analytics.toolInsights;

  // Compute on demand
  try {
    const { getToolUsageStats, getMostUsedTools, getErrorProneTools, getToolSequencePatterns } =
      require("../analytics/tool-insights");
    const entries = session.messages || [];
    analytics.toolInsights = {
      toolStats: getToolUsageStats([{ id: session.id, entries }]),
      mostUsed: getMostUsedTools([{ id: session.id, entries }], 10),
      errorProne: getErrorProneTools([{ id: session.id, entries }]),
      patterns: getToolSequencePatterns([{ id: session.id, entries }]),
    };
    return analytics.toolInsights;
  } catch (_) {
    return null;
  }
}

/**
 * Generate and cache a session report.
 *
 * @param {object} session
 * @param {object} [opts]
 * @returns {string|null} markdown report
 */
function getSessionReport(session, opts = {}) {
  const analytics = session?.analytics;
  if (!analytics) return null;

  if (analytics.report && !opts.force) return analytics.report;

  try {
    const { generateSessionReport } = require("../analytics/report-generator");
    const entries = session.messages || [];
    analytics.report = generateSessionReport(
      { id: session.id, entries },
      { includeCharts: true, includeFindings: true, ...opts }
    );
    return analytics.report;
  } catch (_) {
    return null;
  }
}

/**
 * Generate a weekly report from all available sessions.
 *
 * @param {object[]} sessions - array of { id, entries }
 * @param {object} [opts]
 * @returns {string|null} markdown report
 */
function getWeeklyReport(sessions, opts = {}) {
  try {
    const { generateWeeklyReport } = require("../analytics/report-generator");
    return generateWeeklyReport(sessions, opts);
  } catch (_) {
    return null;
  }
}

/**
 * Run predictions for the current session.
 *
 * @param {object} session
 * @returns {object|null} prediction result
 */
function getPrediction(session) {
  const analytics = session?.analytics;
  if (!analytics) return null;

  try {
    const entries = session.messages || [];
    const success = analytics.predictor.predictSuccess(entries);
    const duration = analytics.predictor.predictDuration(entries);
    const toolNeeds = analytics.predictor.predictToolNeeds(entries);
    analytics.prediction = { success, duration, toolNeeds };
    return analytics.prediction;
  } catch (_) {
    return null;
  }
}

module.exports = {
  setupAnalytics,
  getAnalytics,
  getToolInsights,
  getSessionReport,
  getWeeklyReport,
  getPrediction,
};
