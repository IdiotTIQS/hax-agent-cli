"use strict";

/**
 * MetricsCollector — gathers, aggregates, and exposes observability and
 * analytics data from all registered sources into a unified snapshot.
 *
 * Sources can be toolMetrics, agentMetrics, sessionMetrics, systemMetrics,
 * tokenMetrics, or any user-registered source.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeAvg(values, decimals) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  return decimals !== undefined ? roundTo(avg, decimals) : avg;
}

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function safePercent(part, total, decimals) {
  if (total === 0) return 0;
  const pct = (part / total) * 100;
  return decimals !== undefined ? roundTo(pct, decimals) : pct;
}

// ---------------------------------------------------------------------------
// MetricsCollector
// ---------------------------------------------------------------------------

class MetricsCollector {
  constructor() {
    this._sources = new Map();
  }

  /**
   * Register a named metrics data source.
   *
   * @param {string} name   - unique source name
   * @param {object} source - provider object with a `collect()` method or raw data
   */
  registerSource(name, source) {
    if (!name || typeof name !== "string") {
      throw new TypeError("Source name must be a non-empty string.");
    }
    if (!source) {
      throw new TypeError("Source must be a non-null object.");
    }
    this._sources.set(name, source);
  }

  /**
   * Collect all metrics from every registered source.
   *
   * @returns {object} aggregated result keyed by source name
   */
  collect() {
    const result = {};
    for (const [name, source] of this._sources) {
      try {
        result[name] =
          typeof source.collect === "function" ? source.collect() : source;
      } catch (err) {
        result[name] = { error: err.message };
      }
    }
    return result;
  }

  /**
   * Get an aggregated snapshot of all key metrics.
   *
   * @returns {object} snapshot with tool, session, system, agent, and token sections
   */
  getSnapshot() {
    const raw = this.collect();

    const toolMetrics = raw.toolMetrics || {};
    const agentMetrics = raw.agentMetrics || {};
    const sessionMetrics = raw.sessionMetrics || {};
    const systemMetrics = raw.systemMetrics || {};
    const tokenMetrics = raw.tokenMetrics || {};

    const toolSnapshot = this.collectToolMetrics(toolMetrics);
    const sessionSnapshot = this.collectSessionMetrics(sessionMetrics);
    const systemSnapshot = this.collectSystemMetrics(systemMetrics);
    const tokenSnapshot = {
      totalInput: tokenMetrics.totalInputTokens || 0,
      totalOutput: tokenMetrics.totalOutputTokens || 0,
      totalCacheCreation: tokenMetrics.totalCacheCreationTokens || 0,
      totalCacheRead: tokenMetrics.totalCacheReadTokens || 0,
      totalTokens:
        (tokenMetrics.totalInputTokens || 0) +
        (tokenMetrics.totalOutputTokens || 0) +
        (tokenMetrics.totalCacheCreationTokens || 0),
      avgTokensPerTurn: tokenMetrics.avgTokensPerTurn || 0,
      costEstimate: tokenMetrics.costEstimate || { total: 0, breakdown: {} },
    };
    const agentSnapshot = {
      totalTurns: agentMetrics.totalTurns || 0,
      avgResponseTimeMs: agentMetrics.avgResponseTimeMs || 0,
      errorRate: agentMetrics.errorRate || 0,
    };

    return {
      timestamp: new Date().toISOString(),
      health: this._computeHealth(toolSnapshot, systemSnapshot),
      tools: toolSnapshot,
      sessions: sessionSnapshot,
      system: systemSnapshot,
      tokens: tokenSnapshot,
      agent: agentSnapshot,
    };
  }

  // -----------------------------------------------------------------------
  // Per-domain collectors
  // -----------------------------------------------------------------------

  /**
   * Aggregate tool metrics: success rate, avg duration, top tools, error rate.
   */
  collectToolMetrics(metrics) {
    const tools = metrics.tools || {};
    const executions = metrics.totalExecutions || 0;
    const errors = metrics.totalErrors || 0;
    const durations = metrics.durations || [];
    const successCount = executions - errors;

    const topTools = Object.entries(tools)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    return {
      totalExecutions: executions,
      totalErrors: errors,
      successCount: Math.max(0, successCount),
      successRate: safePercent(successCount, executions, 2),
      errorRate: safePercent(errors, executions, 2),
      avgDurationMs: safeAvg(durations, 1),
      minDurationMs: durations.length ? Math.min(...durations) : 0,
      maxDurationMs: durations.length ? Math.max(...durations) : 0,
      topTools,
    };
  }

  /**
   * Aggregate session metrics: sessions per day, avg turns, avg cost, total tokens.
   */
  collectSessionMetrics(metrics) {
    const sessions = metrics.sessions || [];
    const totalSessions = sessions.length;
    const turns = sessions.map((s) => s.turns || 0);
    const costs = sessions.map((s) => s.cost || 0);
    const tokens = sessions.map((s) => s.totalTokens || 0);

    // Sessions per day estimate
    let sessionsPerDay = 0;
    if (totalSessions >= 2) {
      const timestamps = sessions
        .map((s) => s.timestamp)
        .filter(Boolean)
        .sort();
      if (timestamps.length >= 2) {
        const first = new Date(timestamps[0]).getTime();
        const last = new Date(timestamps[timestamps.length - 1]).getTime();
        const days = Math.max(1, (last - first) / (1000 * 60 * 60 * 24));
        sessionsPerDay = roundTo(totalSessions / days, 1);
      }
    }

    return {
      totalSessions,
      sessionsPerDay,
      avgTurnsPerSession: safeAvg(turns, 1),
      maxTurns: turns.length ? Math.max(...turns) : 0,
      avgCostPerSession: safeAvg(costs, 4),
      totalCost: roundTo(costs.reduce((a, b) => a + b, 0), 4),
      totalTokens: tokens.reduce((a, b) => a + b, 0),
      avgTokensPerSession: safeAvg(tokens, 0),
    };
  }

  /**
   * Aggregate system metrics: uptime, memory usage, CPU usage.
   */
  collectSystemMetrics(metrics) {
    const uptimeMs = metrics.uptimeMs || (typeof metrics.uptime === "number" ? metrics.uptime * 1000 : 0);
    const uptimeHours = roundTo(uptimeMs / (1000 * 60 * 60), 1);

    const mem = metrics.memory || {};
    const cpu = metrics.cpu || {};

    return {
      uptimeMs,
      uptimeHours,
      memory: {
        usedMB: mem.usedMB || mem.rss || 0,
        totalMB: mem.totalMB || mem.heapTotal || 0,
        usagePercent: mem.usagePercent || safePercent(mem.usedMB || 0, mem.totalMB || 1, 1),
      },
      cpu: {
        usagePercent: cpu.usagePercent || cpu.utilization || 0,
        loadAvg1m: cpu.loadAvg1m || 0,
        loadAvg5m: cpu.loadAvg5m || 0,
        loadAvg15m: cpu.loadAvg15m || 0,
      },
      timestamp: metrics.timestamp || new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Internal health computation
  // -----------------------------------------------------------------------

  _computeHealth(toolSnapshot, systemSnapshot) {
    const checks = [];

    // Tool health
    checks.push({
      name: "tool_success_rate",
      label: "Tool Success Rate",
      status: toolSnapshot.successRate >= 95 ? "pass" : toolSnapshot.successRate >= 80 ? "warn" : "fail",
      value: `${toolSnapshot.successRate}%`,
    });

    // Error rate
    checks.push({
      name: "tool_error_rate",
      label: "Tool Error Rate",
      status: toolSnapshot.errorRate <= 5 ? "pass" : toolSnapshot.errorRate <= 20 ? "warn" : "fail",
      value: `${toolSnapshot.errorRate}%`,
    });

    // Memory
    const memUsage = systemSnapshot.memory.usagePercent;
    checks.push({
      name: "memory_usage",
      label: "Memory Usage",
      status: memUsage < 75 ? "pass" : memUsage < 90 ? "warn" : "fail",
      value: `${memUsage}%`,
    });

    // CPU
    const cpuUsage = systemSnapshot.cpu.usagePercent;
    checks.push({
      name: "cpu_usage",
      label: "CPU Usage",
      status: cpuUsage < 75 ? "pass" : cpuUsage < 90 ? "warn" : "fail",
      value: `${cpuUsage}%`,
    });

    // Uptime
    checks.push({
      name: "uptime",
      label: "Uptime",
      status: systemSnapshot.uptimeHours > 0 ? "pass" : "warn",
      value: `${systemSnapshot.uptimeHours}h`,
    });

    const overall =
      checks.every((c) => c.status === "pass")
        ? "pass"
        : checks.some((c) => c.status === "fail")
          ? "fail"
          : "warn";

    return { overall, checks };
  }
}

module.exports = { MetricsCollector };
