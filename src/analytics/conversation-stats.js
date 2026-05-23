"use strict";

/**
 * Conversation analytics — per-session and cross-session metrics.
 *
 * NOTE: These functions operate on transcript *entries* (arrays of plain
 * objects read from JSONL lines).  They are deliberately decoupled from the
 * I/O layer so they can be tested with in-memory mock data.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isUserMsg(entry) {
  return entry && entry.role === "user";
}

function isAssistantMsg(entry) {
  return entry && entry.role === "assistant";
}

function isToolMsg(entry) {
  return entry && entry.role === "tool";
}

function isSystemMsg(entry) {
  return entry && entry.role === "system";
}

function isErrorTool(entry) {
  return isToolMsg(entry) && entry.isError === true;
}

function safeAvg(list, decimals = 1) {
  if (!Array.isArray(list) || list.length === 0) return 0;
  const sum = list.reduce((a, b) => a + b, 0);
  const avg = sum / list.length;
  return decimals >= 0 ? roundTo(avg, decimals) : avg;
}

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function parseTs(entry) {
  if (!entry || !entry.timestamp) return null;
  const t = new Date(entry.timestamp).getTime();
  return Number.isNaN(t) ? null : t;
}

function getContentLength(entry) {
  return typeof entry.content === "string" ? entry.content.length : 0;
}

function parseUsageNumber(usage, ...keys) {
  if (!usage) return 0;
  for (const key of keys) {
    if (Number.isFinite(usage[key])) return usage[key];
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @param {object[]} entries — transcript entries (plain objects from JSONL)
 * @param {object}   [options]
 * @param {boolean}  [options.includeTokenDetails] — add per-turn token arrays
 * @param {boolean}  [options.includeLatency]      — add inter-message timing
 * @returns {object} session stats
 */
function analyzeSession(entries, options = {}) {
  const opts = { includeTokenDetails: false, includeLatency: false, ...options };

  if (!Array.isArray(entries)) {
    entries = [];
  }

  // Filter out session metadata entries
  const filtered = entries.filter(
    (e) => !e || e.type !== "session.meta"
  );

  // --- Role counts ---
  const roles = { user: 0, assistant: 0, tool: 0, system: 0 };
  for (const e of filtered) {
    const r = (e.role || "").toLowerCase();
    if (roles.hasOwnProperty(r)) roles[r] += 1;
    else roles[r] = (roles[r] || 0) + 1;
  }
  const total = filtered.length;

  // --- Turn lengths (content length) ---
  const lengths = filtered.map(getContentLength).filter((l) => l > 0);
  const turnLengths = {
    avg: safeAvg(lengths),
    max: lengths.length ? Math.max(...lengths) : 0,
    min: lengths.length ? Math.min(...lengths) : 0,
  };

  // Per-role turn lengths
  const roleLengths = {};
  for (const role of ["user", "assistant", "tool", "system"]) {
    const val = filtered
      .filter((e) => e.role === role && typeof e.content === "string")
      .map((e) => e.content.length)
      .filter((l) => l > 0);
    roleLengths[role] = {
      avg: safeAvg(val),
      max: val.length ? Math.max(...val) : 0,
      min: val.length ? Math.min(...val) : 0,
    };
  }

  // --- Tool usage breakdown ---
  const toolUsage = {};
  for (const e of filtered) {
    if (!isToolMsg(e)) continue;
    const name = e.name || "(unnamed)";
    toolUsage[name] = (toolUsage[name] || 0) + 1;
  }

  // --- Error rate ---
  const errorCount = filtered.filter((e) => isErrorTool(e)).length;
  const errorRate = total > 0 ? roundTo(errorCount / total, 4) : 0;

  // --- Token usage ---
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCacheReadTokens = 0;

  for (const e of filtered) {
    if (!e.usage) continue;
    totalInputTokens += parseUsageNumber(
      e.usage,
      "input_tokens",
      "inputTokens",
      "prompt_tokens",
      "promptTokens"
    );
    totalOutputTokens += parseUsageNumber(
      e.usage,
      "output_tokens",
      "outputTokens",
      "completion_tokens",
      "completionTokens"
    );
    totalCacheCreationTokens += parseUsageNumber(
      e.usage,
      "cache_creation_input_tokens",
      "cacheCreationInputTokens"
    );
    totalCacheReadTokens += parseUsageNumber(
      e.usage,
      "cache_read_input_tokens",
      "cacheReadInputTokens"
    );
  }

  const totalTokens = {
    input: totalInputTokens,
    output: totalOutputTokens,
    cacheCreation: totalCacheCreationTokens,
    cacheRead: totalCacheReadTokens,
    total: totalInputTokens + totalOutputTokens + totalCacheCreationTokens,
  };

  // --- Response latency ---
  let avgLatencyMs = null;
  let maxLatencyMs = null;
  let minLatencyMs = null;

  if (opts.includeLatency) {
    const latencies = [];
    for (let i = 0; i < filtered.length; i++) {
      if (!isUserMsg(filtered[i])) continue;
      const userTs = parseTs(filtered[i]);
      if (!userTs) continue;
      // Find next assistant message
      for (let j = i + 1; j < filtered.length; j++) {
        if (isAssistantMsg(filtered[j])) {
          const asstTs = parseTs(filtered[j]);
          if (asstTs) {
            latencies.push(asstTs - userTs);
          }
          break;
        }
      }
    }
    if (latencies.length > 0) {
      avgLatencyMs = safeAvg(latencies);
      maxLatencyMs = Math.max(...latencies);
      minLatencyMs = Math.min(...latencies);
    }
  }

  const latency = { avg: avgLatencyMs, max: maxLatencyMs, min: minLatencyMs };

  // --- Session duration ---
  let durationMs = 0;
  if (filtered.length >= 2) {
    const first = parseTs(filtered[0]);
    const last = parseTs(filtered[filtered.length - 1]);
    if (first !== null && last !== null) {
      durationMs = Math.max(0, last - first);
    }
  }

  // --- Turn count ---
  const turns = filtered.filter((e) => {
    // Count distinct "turns" off user→assistant pairs
    return isUserMsg(e);
  }).length;

  // --- Token usage trends ---
  let tokenTrends = null;
  if (opts.includeTokenDetails) {
    tokenTrends = [];
    let turnNum = 0;
    for (const e of filtered) {
      if (isUserMsg(e)) turnNum += 1;
      if (!e.usage) continue;
      tokenTrends.push({
        turn: turnNum,
        timestamp: e.timestamp || null,
        inputTokens: parseUsageNumber(
          e.usage,
          "input_tokens",
          "inputTokens",
          "prompt_tokens",
          "promptTokens"
        ),
        outputTokens: parseUsageNumber(
          e.usage,
          "output_tokens",
          "outputTokens",
          "completion_tokens",
          "completionTokens"
        ),
      });
    }
  }

  // --- Tool calls extracted from assistant messages ---
  let toolCallCount = 0;
  const toolCallNames = {};
  for (const e of filtered) {
    if (!isAssistantMsg(e)) continue;
    if (!Array.isArray(e.tool_calls)) continue;
    toolCallCount += e.tool_calls.length;
    for (const tc of e.tool_calls) {
      const fn = (tc.function && tc.function.name) || tc.name || "(unnamed)";
      toolCallNames[fn] = (toolCallNames[fn] || 0) + 1;
    }
  }

  // --- Modified files ---
  const filesModified = new Set();
  for (const e of filtered) {
    if (isToolMsg(e) && e.data) {
      if (e.data.path) filesModified.add(e.data.path);
      if (e.data.filePath) filesModified.add(e.data.filePath);
    }
  }

  const result = {
    totalEntries: total,
    roles,
    turns,
    turnLengths,
    roleTurnLengths: roleLengths,
    durationMs,
    toolUsage,
    toolCallCount,
    toolCallNames,
    errorCount,
    errorRate,
    totalTokens,
    filesModified: [...filesModified],
  };

  if (opts.includeLatency) {
    result.responseLatency = latency;
  }

  if (opts.includeTokenDetails && tokenTrends) {
    result.tokenUsageTrends = tokenTrends;
  }

  return result;
}

/**
 * Aggregate analysis across multiple sessions.
 *
 * @param {object[]} sessions — array of { id, entries: object[] }
 * @param {object}   [options]
 * @returns {object} aggregate stats
 */
function analyzeSessions(sessions, options = {}) {
  if (!Array.isArray(sessions)) {
    sessions = [];
  }

  const sessionStats = sessions.map((s) => {
    const entries = Array.isArray(s.entries)
      ? s.entries
      : typeof s.entries === "function"
        ? s.entries()
        : [];
    return {
      id: s.id || "unknown",
      ...analyzeSession(entries, options),
    };
  });

  const totalEntries = sessionStats.reduce((a, s) => a + s.totalEntries, 0);
  const sessionCount = sessionStats.length;

  // Aggregate roles
  const aggregateRoles = { user: 0, assistant: 0, tool: 0, system: 0 };
  for (const s of sessionStats) {
    for (const role of Object.keys(aggregateRoles)) {
      aggregateRoles[role] += s.roles[role] || 0;
    }
  }

  // Aggregate tokens
  const aggregateTokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  for (const s of sessionStats) {
    aggregateTokens.input += s.totalTokens.input;
    aggregateTokens.output += s.totalTokens.output;
    aggregateTokens.cacheCreation += s.totalTokens.cacheCreation;
    aggregateTokens.cacheRead += s.totalTokens.cacheRead;
  }
  aggregateTokens.total =
    aggregateTokens.input +
    aggregateTokens.output +
    aggregateTokens.cacheCreation;

  // Aggregate tool usage
  const aggregateToolUsage = {};
  for (const s of sessionStats) {
    for (const [tool, count] of Object.entries(s.toolUsage)) {
      aggregateToolUsage[tool] = (aggregateToolUsage[tool] || 0) + count;
    }
  }

  // Aggregate errors
  const totalErrors = sessionStats.reduce((a, s) => a + s.errorCount, 0);
  const aggregateErrorRate =
    totalEntries > 0 ? roundTo(totalErrors / totalEntries, 4) : 0;

  const avgEntriesPerSession = sessionCount > 0 ? roundTo(totalEntries / sessionCount, 1) : 0;
  const avgTurnsPerSession = sessionCount > 0 ? roundTo(sessionStats.reduce((a, s) => a + s.turns, 0) / sessionCount, 1) : 0;

  // Top tools across sessions
  const topTools = Object.entries(aggregateToolUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Most modified files
  const allFiles = sessionStats.flatMap((s) => s.filesModified);
  const fileFrequency = {};
  for (const f of allFiles) {
    fileFrequency[f] = (fileFrequency[f] || 0) + 1;
  }
  const topFiles = Object.entries(fileFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return {
    sessionCount,
    totalEntries,
    avgEntriesPerSession,
    avgTurnsPerSession,
    aggregateRoles,
    aggregateTokens,
    aggregateToolUsage,
    topTools,
    totalErrors,
    aggregateErrorRate,
    topFiles,
    perSession: sessionStats,
  };
}

/**
 * Time-based usage trends across sessions.
 *
 * @param {object[]} sessions — array of { id, entries: object[] }
 * @param {object}   [options]
 * @param {string}   [options.groupBy] — "day" | "week" (default "day")
 * @returns {object} trends data
 */
function getUsageTrends(sessions, options = {}) {
  const opts = { groupBy: "day", ...options };

  if (!Array.isArray(sessions)) {
    sessions = [];
  }

  // Collect all entries with session context
  const allEntries = [];
  for (const s of sessions) {
    const entries = Array.isArray(s.entries)
      ? s.entries
      : typeof s.entries === "function"
        ? s.entries()
        : [];
    for (const e of entries) {
      if (!e || e.type === "session.meta") continue;
      allEntries.push({ ...e, _sessionId: s.id || "unknown" });
    }
  }

  // Sort by timestamp
  allEntries.sort((a, b) => {
    const ta = parseTs(a) || 0;
    const tb = parseTs(b) || 0;
    return ta - tb;
  });

  // Group by period
  const getBucketKey = (ts) => {
    const d = new Date(ts);
    if (opts.groupBy === "week") {
      // Get Monday of the current week
      const day = d.getUTCDay();
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
      const mon = new Date(d);
      mon.setUTCDate(diff);
      mon.setUTCHours(0, 0, 0, 0);
      return mon.toISOString().slice(0, 10);
    }
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  };

  const messagesPerBucket = {};
  const toolsPerBucket = {};
  let tokenTrendPoints = [];

  for (const e of allEntries) {
    const ts = parseTs(e);
    if (!ts) continue;

    const bucket = getBucketKey(ts);
    messagesPerBucket[bucket] = (messagesPerBucket[bucket] || 0) + 1;

    if (isToolMsg(e)) {
      toolsPerBucket[bucket] = (toolsPerBucket[bucket] || 0) + 1;
    }

    if (e.usage) {
      tokenTrendPoints.push({
        bucket,
        timestamp: e.timestamp,
        inputTokens: parseUsageNumber(e.usage, "input_tokens", "inputTokens"),
        outputTokens: parseUsageNumber(e.usage, "output_tokens", "outputTokens"),
      });
    }
  }

  // Aggregate tokens per bucket
  const tokensPerBucket = {};
  for (const tp of tokenTrendPoints) {
    if (!tokensPerBucket[tp.bucket]) {
      tokensPerBucket[tp.bucket] = { input: 0, output: 0, count: 0 };
    }
    tokensPerBucket[tp.bucket].input += tp.inputTokens;
    tokensPerBucket[tp.bucket].output += tp.outputTokens;
    tokensPerBucket[tp.bucket].count += 1;
  }

  // Per-session tool counts
  const toolsPerSession = sessions.map((s) => {
    const entries = Array.isArray(s.entries)
      ? s.entries
      : typeof s.entries === "function"
        ? s.entries()
        : [];
    const toolCount = entries.filter((e) => isToolMsg(e)).length;
    return { id: s.id || "unknown", toolCount };
  });

  // Daily/weekly messages (sorted)
  const sortedMessages = Object.entries(messagesPerBucket).sort(
    (a, b) => a[0].localeCompare(b[0])
  );

  // Tokens per turn over time
  const avgTokensPerTurn = Object.entries(tokensPerBucket)
    .map(([bucket, data]) => ({
      bucket,
      avgInputPerUsage: data.count > 0 ? roundTo(data.input / data.count, 0) : 0,
      avgOutputPerUsage: data.count > 0 ? roundTo(data.output / data.count, 0) : 0,
    }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  return {
    messagesPerPeriod: sortedMessages,
    toolsPerPeriod: Object.entries(toolsPerBucket).sort((a, b) => a[0].localeCompare(b[0])),
    toolsPerSession,
    tokensPerTurnOverTime: avgTokensPerTurn,
    totalTimeRange: {
      first: sortedMessages.length > 0 ? sortedMessages[0][0] : null,
      last:
        sortedMessages.length > 0
          ? sortedMessages[sortedMessages.length - 1][0]
          : null,
    },
  };
}

module.exports = {
  analyzeSession,
  analyzeSessions,
  getUsageTrends,
};
