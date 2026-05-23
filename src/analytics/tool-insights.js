"use strict";

/**
 * Tool-focused analytics — usage frequency, success rates, sequence
 * patterns, and timeline views.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isToolMsg(entry) {
  return entry && entry.role === "tool";
}

function isAssistantMsg(entry) {
  return entry && entry.role === "assistant";
}

function isErrorTool(entry) {
  return isToolMsg(entry) && entry.isError === true;
}

function roundTo(value, decimals = 1) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function parseTs(entry) {
  if (!entry || !entry.timestamp) return null;
  const t = new Date(entry.timestamp).getTime();
  return Number.isNaN(t) ? null : t;
}

function extractEntries(session) {
  if (Array.isArray(session)) return session;
  if (session && Array.isArray(session.entries)) return session.entries;
  if (session && typeof session.entries === "function") return session.entries();
  return [];
}

function normalizeSessions(sessions) {
  if (!Array.isArray(sessions)) return [];
  return sessions;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get usage statistics for every tool across sessions.
 *
 * @param {object[]} sessions — session objects or arrays of entries
 * @returns {object}   { toolName: { count, successCount, errorCount, successRate, avgDurationMs } }
 */
function getToolUsageStats(sessions) {
  const sList = normalizeSessions(sessions);
  const stats = {};

  for (const sess of sList) {
    const entries = extractEntries(sess);
    for (const e of entries) {
      if (!isToolMsg(e)) continue;
      const name = e.name || "(unnamed)";

      if (!stats[name]) {
        stats[name] = { count: 0, successCount: 0, errorCount: 0, durations: [] };
      }

      stats[name].count += 1;
      if (e.isError) {
        stats[name].errorCount += 1;
      } else {
        stats[name].successCount += 1;
      }

      // Attempt to determine duration if present
      if (typeof e.duration === "number" && e.duration >= 0) {
        stats[name].durations.push(e.duration);
      } else if (typeof e.durationMs === "number" && e.durationMs >= 0) {
        stats[name].durations.push(e.durationMs);
      }
    }
  }

  // Compute derived metrics
  const result = {};
  for (const [name, s] of Object.entries(stats)) {
    result[name] = {
      count: s.count,
      successCount: s.successCount,
      errorCount: s.errorCount,
      successRate: s.count > 0 ? roundTo(s.successCount / s.count, 4) : 0,
      avgDurationMs:
        s.durations.length > 0
          ? roundTo(
              s.durations.reduce((a, b) => a + b, 0) / s.durations.length,
              0
            )
          : null,
      minDurationMs:
        s.durations.length > 0 ? Math.min(...s.durations) : null,
      maxDurationMs:
        s.durations.length > 0 ? Math.max(...s.durations) : null,
    };
  }

  return result;
}

/**
 * Get the top-N most used tools.
 *
 * @param {object[]} sessions
 * @param {number}   [n=10]
 * @returns {object[]} sorted array of { name, count, successRate }
 */
function getMostUsedTools(sessions, n = 10) {
  const stats = getToolUsageStats(sessions);
  return Object.entries(stats)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, n)
    .map(([name, data]) => ({
      name,
      count: data.count,
      successRate: data.successRate,
      errorCount: data.errorCount,
    }));
}

/**
 * Find tools with error rates above a given threshold.
 *
 * @param {object[]} sessions
 * @param {number}   [threshold=0.1] — 0.1 = 10%
 * @returns {object[]} sorted by error rate (highest first)
 */
function getErrorProneTools(sessions, threshold = 0.1) {
  const stats = getToolUsageStats(sessions);
  return Object.entries(stats)
    .filter(([, data]) => {
      const errorRate =
        data.count > 0 ? (data.errorCount / data.count) : 0;
      return errorRate >= threshold;
    })
    .sort((a, b) => {
      const rateA = a[1].count > 0 ? a[1].errorCount / a[1].count : 0;
      const rateB = b[1].count > 0 ? b[1].errorCount / b[1].count : 0;
      return rateB - rateA;
    })
    .map(([name, data]) => ({
      name,
      count: data.count,
      errorCount: data.errorCount,
      errorRate: data.count > 0 ? roundTo(data.errorCount / data.count, 4) : 0,
    }));
}

/**
 * Discover common tool-call sequences (bigrams).
 *
 * @param {object[]} sessions
 * @returns {object[]} sorted array of { sequence: string[], count }
 */
function getToolSequencePatterns(sessions) {
  const sList = normalizeSessions(sessions);

  // Collect tool names in order for each session
  const bigramCounts = {};

  for (const sess of sList) {
    const entries = extractEntries(sess);
    const toolNames = entries
      .filter((e) => isToolMsg(e))
      .map((e) => e.name || "(unnamed)");

    // Count bigrams (adjacent pairs)
    for (let i = 0; i < toolNames.length - 1; i++) {
      const key = `${toolNames[i]}|${toolNames[i + 1]}`;
      bigramCounts[key] = (bigramCounts[key] || 0) + 1;
    }
  }

  // Sort by frequency
  return Object.entries(bigramCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({
      sequence: key.split("|"),
      count,
    }));
}

/**
 * Build a chronological timeline of tool usage with timestamps.
 *
 * @param {object[]} sessions
 * @returns {object[]} sorted array of { toolName, timestamp, sessionId, isError, duration }
 */
function getToolUsageTimeline(sessions) {
  const sList = normalizeSessions(sessions);
  const timeline = [];

  for (const sess of sList) {
    const entries = extractEntries(sess);
    const sid = sess.id || "unknown";

    for (const e of entries) {
      if (!isToolMsg(e)) continue;

      const ts = parseTs(e);

      timeline.push({
        toolName: e.name || "(unnamed)",
        timestamp: e.timestamp || null,
        timestampMs: ts,
        sessionId: sid,
        isError: !!e.isError,
        duration: e.duration || e.durationMs || null,
      });
    }
  }

  // Sort chronologically
  timeline.sort((a, b) => {
    if (a.timestampMs === null && b.timestampMs === null) return 0;
    if (a.timestampMs === null) return 1;
    if (b.timestampMs === null) return -1;
    return a.timestampMs - b.timestampMs;
  });

  return timeline;
}

module.exports = {
  getToolUsageStats,
  getMostUsedTools,
  getErrorProneTools,
  getToolSequencePatterns,
  getToolUsageTimeline,
};
