"use strict";

/**
 * Report generators for the HaxAgent metrics dashboard.
 *
 * All generators accept a MetricsCollector instance and return plain-text
 * reports.  Pass `{ markdown: true }` as the second argument for Markdown
 * output.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function safeAvg(values, decimals) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  return decimals !== undefined ? roundTo(avg, decimals) : avg;
}

function safePercent(part, total, decimals) {
  if (total === 0) return 0;
  const pct = (part / total) * 100;
  return decimals !== undefined ? roundTo(pct, decimals) : pct;
}

function formatNumber(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatCost(n) {
  return `$${n.toFixed(4)}`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function hdr(text, md) {
  return md ? `## ${text}` : `\n=== ${text} ===`;
}

function hdrSmall(text, md) {
  return md ? `### ${text}` : `\n--- ${text} ---`;
}

function bullet(text, md) {
  return md ? `- ${text}` : `  * ${text}`;
}

function tableRow(cells, md) {
  if (md) return `| ${cells.join(" | ")} |`;
  return cells.join("  |  ");
}

function separator(md) {
  return md ? "" : "------------------------------------------------------------";
}

// ---------------------------------------------------------------------------
// Daily Report
// ---------------------------------------------------------------------------

/**
 * Generate a daily summary report.
 *
 * @param {MetricsCollector} collector
 * @param {object} [opts]
 * @param {boolean} [opts.markdown=false]
 * @returns {string}
 */
function generateDailyReport(collector, opts) {
  const md = !!(opts && opts.markdown);
  const snap = collector.getSnapshot();
  const lines = [];

  lines.push(hdr("DAILY SUMMARY REPORT", md));
  lines.push(`Generated: ${snap.timestamp}`);
  lines.push("");

  // Tool activity
  lines.push(hdrSmall("Tool Activity", md));
  lines.push(bullet(`Total executions: ${snap.tools.totalExecutions}`, md));
  lines.push(
    bullet(
      `Success rate: ${snap.tools.successRate}% (${snap.tools.successCount}/${snap.tools.totalExecutions})`,
      md
    )
  );
  lines.push(bullet(`Error rate: ${snap.tools.errorRate}%`, md));
  lines.push(
    bullet(`Avg duration: ${formatDuration(snap.tools.avgDurationMs)}`, md)
  );

  if (snap.tools.topTools.length > 0) {
    lines.push(bullet("Top tools:", md));
    for (const t of snap.tools.topTools.slice(0, 5)) {
      lines.push(md ? `  - ${t.name}: ${t.count}` : `      ${t.name}: ${t.count}`);
    }
  }

  // Sessions
  lines.push("");
  lines.push(hdrSmall("Sessions", md));
  lines.push(bullet(`Total sessions: ${snap.sessions.totalSessions}`, md));
  lines.push(
    bullet(`Sessions/day: ${snap.sessions.sessionsPerDay}`, md)
  );
  lines.push(
    bullet(
      `Avg turns/session: ${snap.sessions.avgTurnsPerSession}`,
      md
    )
  );

  // Tokens
  lines.push("");
  lines.push(hdrSmall("Token Usage", md));
  lines.push(
    bullet(`Input: ${formatNumber(snap.tokens.totalInput)} tokens`, md)
  );
  lines.push(
    bullet(`Output: ${formatNumber(snap.tokens.totalOutput)} tokens`, md)
  );
  lines.push(
    bullet(`Total: ${formatNumber(snap.tokens.totalTokens)} tokens`, md)
  );
  lines.push(
    bullet(`Estimated cost: ${formatCost(snap.tokens.costEstimate.total)}`, md)
  );

  // Health
  lines.push("");
  lines.push(hdrSmall("System Health", md));
  lines.push(bullet(`Overall: ${snap.health.overall.toUpperCase()}`, md));
  lines.push(
    bullet(
      `Uptime: ${snap.system.uptimeHours}h  ` +
        `Memory: ${snap.system.memory.usagePercent}%  ` +
        `CPU: ${snap.system.cpu.usagePercent}%`,
      md
    )
  );

  lines.push("");
  lines.push(separator(md));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Weekly Report
// ---------------------------------------------------------------------------

/**
 * Generate a weekly trends and insights report.
 *
 * @param {MetricsCollector} collector
 * @param {object} [opts]
 * @param {boolean} [opts.markdown=false]
 * @returns {string}
 */
function generateWeeklyReport(collector, opts) {
  const md = !!(opts && opts.markdown);
  const snap = collector.getSnapshot();
  const lines = [];

  lines.push(hdr("WEEKLY TRENDS REPORT", md));
  lines.push(`Generated: ${snap.timestamp}`);
  lines.push("");

  // Trend summary
  lines.push(hdrSmall("Activity Trends", md));

  const sessionsPerWeek = snap.sessions.sessionsPerDay * 7;
  lines.push(
    bullet(`Estimated sessions this week: ${roundTo(sessionsPerWeek, 0)}`, md)
  );
  lines.push(
    bullet(
      `Avg turns/session: ${snap.sessions.avgTurnsPerSession}`,
      md
    )
  );
  lines.push(
    bullet(
      `Tokens per session: ${formatNumber(snap.sessions.avgTokensPerSession)}`,
      md
    )
  );

  // Tool usage trends
  lines.push("");
  lines.push(hdrSmall("Tool Usage Trends", md));
  if (snap.tools.topTools.length > 0) {
    const totalTool = snap.tools.totalExecutions || 1;
    for (const t of snap.tools.topTools.slice(0, 5)) {
      const pct = safePercent(t.count, totalTool, 1);
      lines.push(
        bullet(`${t.name}: ${t.count} calls (${pct}% of total)`, md)
      );
    }
  }

  // Error patterns
  lines.push("");
  lines.push(hdrSmall("Error Analysis", md));
  lines.push(
    bullet(
      `Tool error rate: ${snap.tools.errorRate}%`,
      md
    )
  );

  if (snap.tools.errorRate > 5) {
    lines.push(
      bullet(
        `WARNING: Tool error rate exceeds 5% threshold. ` +
          `${snap.tools.totalErrors} errors in ${snap.tools.totalExecutions} executions.`,
        md
      )
    );
    lines.push(
      bullet("Recommendation: Review failing tool calls and adjust configurations.", md)
    );
  } else {
    lines.push(bullet("Tool error rate is within acceptable range.", md));
  }

  // Token and cost trends
  lines.push("");
  lines.push(hdrSmall("Token & Cost Trends", md));
  const weeklyTokens = snap.tokens.totalTokens * 7;
  const weeklyCost = snap.tokens.costEstimate.total * 7;

  lines.push(
    bullet(`Projected weekly tokens: ${formatNumber(weeklyTokens)}`, md)
  );
  lines.push(
    bullet(`Projected weekly cost: ${formatCost(weeklyCost)}`, md)
  );

  if (snap.tokens.costEstimate.breakdown) {
    const breakdown = snap.tokens.costEstimate.breakdown;
    for (const [key, val] of Object.entries(breakdown)) {
      lines.push(
        bullet(`  ${key} weekly: ${formatCost(val * 7)}`, md)
      );
    }
  }

  // Insights
  lines.push("");
  lines.push(hdrSmall("Insights & Recommendations", md));
  lines.push(_generateInsights(snap, md));

  lines.push("");
  lines.push(separator(md));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

/**
 * Generate a quick health status report (pass/warn/fail).
 *
 * @param {MetricsCollector} collector
 * @param {object} [opts]
 * @param {boolean} [opts.markdown=false]
 * @returns {string}
 */
function generateHealthCheck(collector, opts) {
  const md = !!(opts && opts.markdown);
  const snap = collector.getSnapshot();
  const lines = [];

  const statusIcon = snap.health.overall === "pass" ? "[PASS]" : snap.health.overall === "fail" ? "[FAIL]" : "[WARN]";

  lines.push(hdr(`HEALTH CHECK ${statusIcon}`, md));
  lines.push(`Generated: ${snap.timestamp}`);
  lines.push("");

  if (md) {
    lines.push("| Check | Status | Value |");
    lines.push("|-------|--------|-------|");
    for (const check of snap.health.checks) {
      const emoji = check.status === "pass" ? "✅" : check.status === "fail" ? "❌" : "⚠️";
      lines.push(`| ${check.label} | ${emoji} ${check.status} | ${check.value} |`);
    }
  } else {
    for (const check of snap.health.checks) {
      const icon = check.status === "pass" ? "[OK]" : check.status === "fail" ? "[XX]" : "[??]";
      const label = check.label.padEnd(22);
      lines.push(`  ${icon} ${label} ${check.value}`);
    }
  }

  lines.push("");
  lines.push(bullet(`Overall health: ${snap.health.overall.toUpperCase()}`, md));
  lines.push(
    bullet(
      `${snap.health.checks.filter((c) => c.status === "pass").length}/${snap.health.checks.length} checks passing`,
      md
    )
  );

  // Quick stats
  lines.push("");
  lines.push(
    bullet(
      `Uptime: ${snap.system.uptimeHours}h | ` +
        `Memory: ${snap.system.memory.usagePercent}% | ` +
        `CPU: ${snap.system.cpu.usagePercent}%`,
      md
    )
  );

  lines.push("");
  lines.push(separator(md));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Performance Report
// ---------------------------------------------------------------------------

/**
 * Generate a performance trends and bottlenecks report.
 *
 * @param {MetricsCollector} collector
 * @param {object} [opts]
 * @param {boolean} [opts.markdown=false]
 * @returns {string}
 */
function generatePerformanceReport(collector, opts) {
  const md = !!(opts && opts.markdown);
  const snap = collector.getSnapshot();
  const lines = [];

  lines.push(hdr("PERFORMANCE REPORT", md));
  lines.push(`Generated: ${snap.timestamp}`);
  lines.push("");

  // Response times
  lines.push(hdrSmall("Response Times", md));
  lines.push(
    bullet(`Avg agent response: ${formatDuration(snap.agent.avgResponseTimeMs)}`, md)
  );
  lines.push(
    bullet(`Avg tool duration: ${formatDuration(snap.tools.avgDurationMs)}`, md)
  );
  lines.push(
    bullet(
      `Tool duration range: ${formatDuration(snap.tools.minDurationMs)} - ${formatDuration(snap.tools.maxDurationMs)}`,
      md
    )
  );

  // Bottleneck detection
  lines.push("");
  lines.push(hdrSmall("Bottleneck Analysis", md));

  const bottlenecks = [];
  if (snap.tools.avgDurationMs > 1000) {
    bottlenecks.push("Tool execution average exceeds 1 second — investigate slow-running tools.");
  }
  if (snap.agent.avgResponseTimeMs > 5000) {
    bottlenecks.push("Agent response time exceeds 5 seconds — consider model optimization.");
  }
  if (snap.system.cpu.usagePercent > 80) {
    bottlenecks.push(`CPU usage at ${snap.system.cpu.usagePercent}% — may impact responsiveness.`);
  }
  if (snap.system.memory.usagePercent > 80) {
    bottlenecks.push(`Memory usage at ${snap.system.memory.usagePercent}% — consider scaling resources.`);
  }

  if (bottlenecks.length === 0) {
    lines.push(bullet("No significant bottlenecks detected.", md));
  } else {
    for (const b of bottlenecks) {
      lines.push(bullet(b, md));
    }
  }

  // System metrics
  lines.push("");
  lines.push(hdrSmall("System Metrics", md));
  lines.push(
    bullet(`CPU: ${snap.system.cpu.usagePercent}% utilization`, md)
  );
  if (snap.system.cpu.loadAvg1m) {
    lines.push(
      bullet(
        `Load avg: ${snap.system.cpu.loadAvg1m} / ${snap.system.cpu.loadAvg5m} / ${snap.system.cpu.loadAvg15m}`,
        md
      )
    );
  }
  lines.push(
    bullet(`Memory: ${snap.system.memory.usagePercent}% used (${roundTo(snap.system.memory.usedMB, 0)}MB)`, md)
  );
  lines.push(bullet(`Uptime: ${snap.system.uptimeHours}h`, md));

  // Throughput
  lines.push("");
  lines.push(hdrSmall("Throughput", md));
  const toolsPerHour =
    snap.system.uptimeHours > 0
      ? roundTo(snap.tools.totalExecutions / snap.system.uptimeHours, 1)
      : 0;
  lines.push(
    bullet(`Tool executions: ${toolsPerHour}/hour avg`, md)
  );
  lines.push(
    bullet(
      `Sessions: ${snap.sessions.totalSessions} total, ${snap.sessions.sessionsPerDay}/day`,
      md
    )
  );

  lines.push("");
  lines.push(separator(md));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Cost Report
// ---------------------------------------------------------------------------

/**
 * Generate a cost breakdown by model/provider.
 *
 * @param {MetricsCollector} collector
 * @param {object} [opts]
 * @param {boolean} [opts.markdown=false]
 * @returns {string}
 */
function generateCostReport(collector, opts) {
  const md = !!(opts && opts.markdown);
  const snap = collector.getSnapshot();
  const lines = [];

  lines.push(hdr("COST ANALYSIS REPORT", md));
  lines.push(`Generated: ${snap.timestamp}`);
  lines.push("");

  // Summary
  lines.push(hdrSmall("Cost Summary", md));
  lines.push(
    bullet(`Total estimated cost: ${formatCost(snap.tokens.costEstimate.total)}`, md)
  );
  lines.push(
    bullet(
      `Avg cost/session: ${formatCost(snap.sessions.avgCostPerSession)}`,
      md
    )
  );
  lines.push(
    bullet(
      `Sessions: ${snap.sessions.totalSessions}`,
      md
    )
  );

  // Token cost breakdown
  lines.push("");
  lines.push(hdrSmall("Token Breakdown", md));
  const inputTokens = snap.tokens.totalInput || 0;
  const outputTokens = snap.tokens.totalOutput || 0;
  const cacheTokens = snap.tokens.totalCacheCreation || 0;
  const totalT = inputTokens + outputTokens + cacheTokens || 1;

  lines.push(
    bullet(
      `Input tokens: ${formatNumber(inputTokens)} (${safePercent(inputTokens, totalT, 1)}%)`,
      md
    )
  );
  lines.push(
    bullet(
      `Output tokens: ${formatNumber(outputTokens)} (${safePercent(outputTokens, totalT, 1)}%)`,
      md
    )
  );
  if (cacheTokens > 0) {
    lines.push(
      bullet(
        `Cache creation tokens: ${formatNumber(cacheTokens)} (${safePercent(cacheTokens, totalT, 1)}%)`,
        md
      )
    );
  }

  // Provider/model breakdown
  const breakdown = snap.tokens.costEstimate.breakdown || {};
  if (Object.keys(breakdown).length > 0) {
    lines.push("");
    lines.push(hdrSmall("Per-Provider/Model Cost", md));

    if (md) {
      lines.push("| Provider/Model | Cost |");
      lines.push("|----------------|------|");
      for (const [key, amt] of Object.entries(breakdown)) {
        lines.push(`| ${key} | ${formatCost(amt)} |`);
      }
    } else {
      const maxLen = Math.max(...Object.keys(breakdown).map((k) => k.length), 16);
      for (const [key, amt] of Object.entries(breakdown)) {
        const paddedKey = key.padEnd(maxLen);
        const pct = snap.tokens.costEstimate.total > 0
          ? safePercent(amt, snap.tokens.costEstimate.total, 1)
          : 0;
        lines.push(`  ${paddedKey}  ${formatCost(amt)}  (${pct}%)`);
      }
    }
  }

  // Projections
  lines.push("");
  lines.push(hdrSmall("Projections", md));
  const dailyTokens = snap.tokens.totalTokens * snap.sessions.sessionsPerDay;
  const monthlyTokens = dailyTokens * 30;
  const dailyCost = snap.tokens.costEstimate.total * snap.sessions.sessionsPerDay;
  const monthlyCost = dailyCost * 30;

  lines.push(bullet(`Daily token estimate: ${formatNumber(dailyTokens)}`, md));
  lines.push(
    bullet(`Monthly token estimate: ${formatNumber(monthlyTokens)}`, md)
  );
  lines.push(bullet(`Daily cost estimate: ${formatCost(dailyCost)}`, md));
  lines.push(
    bullet(`Monthly cost estimate: ${formatCost(monthlyCost)}`, md)
  );

  // Optimization tips
  if (monthlyCost > 100) {
    lines.push("");
    lines.push(hdrSmall("Optimization Tips", md));
    lines.push(
      bullet("Consider enabling prompt caching to reduce input token costs.", md)
    );
    lines.push(
      bullet("Review tool call frequency — reduce unnecessary round trips.", md)
    );
    lines.push(
      bullet("Evaluate using smaller models for simple tasks.", md)
    );
  }

  lines.push("");
  lines.push(separator(md));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal: generate insights for weekly reports
// ---------------------------------------------------------------------------

function _generateInsights(snap, md) {
  const insights = [];

  if (snap.tools.successRate >= 95) {
    insights.push("Tool execution reliability is excellent (>= 95% success rate).");
  } else if (snap.tools.successRate >= 80) {
    insights.push("Tool execution is reliable, but consider investigating occasional failures.");
  } else {
    insights.push(`High tool failure rate (${snap.tools.successRate}%) — immediate investigation recommended.`);
  }

  if (snap.sessions.avgTurnsPerSession > 20) {
    insights.push("High average turns per session suggests complex conversations. Consider checkpoint strategies.");
  }

  if (snap.tokens.avgTokensPerTurn > 50000) {
    insights.push("High token usage per turn — review prompt efficiency and context size.");
  }

  if (snap.tokens.costEstimate.total > 10) {
    insights.push("Significant cost accrual — review usage patterns and consider caching strategies.");
  }

  if (snap.system.cpu.usagePercent > 70) {
    insights.push("System CPU usage is elevated. Monitor for potential scaling needs.");
  }

  if (insights.length === 0) {
    insights.push("All metrics are within normal parameters. No action needed.");
  }

  return insights.map((i) => bullet(i, md)).join("\n");
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  generateDailyReport,
  generateWeeklyReport,
  generateHealthCheck,
  generatePerformanceReport,
  generateCostReport,
};
