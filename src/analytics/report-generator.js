"use strict";

/**
 * Report generator — produces human-readable markdown reports from
 * the analytics modules (conversation-stats.js and tool-insights.js).
 */

const { analyzeSession, analyzeSessions } = require("./conversation-stats");
const {
  getMostUsedTools,
  getErrorProneTools,
  getToolSequencePatterns,
} = require("./tool-insights");

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function round(v, d = 1) {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function formatDuration(ms) {
  if (ms == null) return "N/A";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatTokens(n) {
  if (n == null || !Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${round(n / 1_000_000, 1)}M`;
  if (n >= 1_000) return `${round(n / 1_000, 1)}K`;
  return String(Math.round(n));
}

function barChart(data, maxWidth = 40, labelWidth = 20) {
  if (!data || data.length === 0) return "  (no data)\n";

  const maxVal = Math.max(...data.map((d) => d.value));
  if (maxVal === 0) {
    return data
      .map((d) => `  ${d.label.padEnd(labelWidth)} | (0)`)
      .join("\n") + "\n";
  }

  return data
    .map((d) => {
      const barLen = Math.max(1, Math.round((d.value / maxVal) * maxWidth));
      const bar = "█".repeat(barLen);
      return `  ${d.label.padEnd(labelWidth)} | ${bar} (${d.value})`;
    })
    .join("\n") + "\n";
}

function extractEntries(session) {
  if (Array.isArray(session)) return session;
  if (session && Array.isArray(session.entries)) return session.entries;
  if (session && typeof session.entries === "function") return session.entries();
  return [];
}

function getSummaryLine(entries) {
  const userMsgs = entries
    .filter((e) => e.role === "user")
    .map((e) => (e.content || "").trim())
    .filter(Boolean);
  if (userMsgs.length === 0) return "Empty session";
  if (userMsgs.length === 1)
    return userMsgs[0].length > 70
      ? userMsgs[0].slice(0, 67) + "..."
      : userMsgs[0];
  const first = userMsgs[0].slice(0, 35);
  return `${first}... → ...(${userMsgs.length} turns)`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a detailed markdown report for a single session.
 *
 * @param {object[]|object} session — entries array or { id, entries }
 * @param {object}          [options]
 * @param {boolean}         [options.includeCharts]
 * @param {boolean}         [options.includeFindings]
 * @returns {string} markdown report
 */
function generateSessionReport(session, options = {}) {
  const opts = { includeCharts: true, includeFindings: true, ...options };
  const entries = extractEntries(session);
  const sessionId =
    (typeof session === "object" && session !== null && session.id) ||
    "session";
  const stats = analyzeSession(entries, {
    includeLatency: true,
    includeTokenDetails: true,
  });

  let report = "";

  // Title
  report += `# Session Report: \`${sessionId}\`\n\n`;

  // Key metrics table
  report += `## Key Metrics\n\n`;
  report += `| Metric | Value |\n`;
  report += `| ------ | ----- |\n`;
  report += `| Total entries | ${stats.totalEntries} |\n`;
  report += `| Turns | ${stats.turns} |\n`;
  report += `| Duration | ${formatDuration(stats.durationMs)} |\n`;
  report += `| Error count | ${stats.errorCount} |\n`;
  report += `| Error rate | ${round(stats.errorRate * 100, 1)}% |\n`;
  report += `| Files modified | ${stats.filesModified.length} |\n`;
  report += `\n`;

  // Role breakdown
  report += `## Messages by Role\n\n`;
  for (const role of ["user", "assistant", "tool", "system"]) {
    report += `- **${role}**: ${stats.roles[role] || 0}\n`;
  }
  report += `\n`;

  // Token usage
  report += `## Token Usage\n\n`;
  report += `| Type | Count |\n`;
  report += `| ---- | ----- |\n`;
  report += `| Input tokens | ${formatTokens(stats.totalTokens.input)} |\n`;
  report += `| Output tokens | ${formatTokens(stats.totalTokens.output)} |\n`;
  if (stats.totalTokens.cacheCreation > 0) {
    report += `| Cache creation tokens | ${formatTokens(stats.totalTokens.cacheCreation)} |\n`;
  }
  if (stats.totalTokens.cacheRead > 0) {
    report += `| Cache read tokens | ${formatTokens(stats.totalTokens.cacheRead)} |\n`;
  }
  report += `| **Total** | **${formatTokens(stats.totalTokens.total)}** |\n`;
  report += `\n`;

  // Turn length stats
  report += `## Turn Lengths (characters)\n\n`;
  report += `| Role | Avg | Min | Max |\n`;
  report += `| ---- | --- | --- | --- |\n`;
  for (const role of ["user", "assistant", "tool", "system"]) {
    const rl = stats.roleTurnLengths[role] || { avg: 0, min: 0, max: 0 };
    report += `| ${role} | ${rl.avg} | ${rl.min} | ${rl.max} |\n`;
  }
  report += `\n`;

  // Tool usage chart
  if (opts.includeCharts && Object.keys(stats.toolUsage).length > 0) {
    report += `## Tool Usage\n\n`;
    const chartData = Object.entries(stats.toolUsage)
      .map(([name, count]) => ({ label: name, value: count }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    report += "```\n";
    report += barChart(chartData, 30, 20);
    report += "```\n\n";
  }

  // Top findings
  if (opts.includeFindings) {
    report += `## Key Findings\n\n`;
    const findings = [];

    if (stats.errorRate > 0.05) {
      findings.push(
        `- **High error rate**: ${round(stats.errorRate * 100, 1)}% of tool calls resulted in errors.`
      );
    }
    if (stats.turns === 0) {
      findings.push(`- No user-assistant turns detected in this session.`);
    }
    if (stats.totalTokens.total > 100_000) {
      findings.push(
        `- **High token usage**: ${formatTokens(stats.totalTokens.total)} total tokens used across ${stats.turns} turns.`
      );
    }
    if (stats.filesModified.length > 10) {
      findings.push(
        `- **Many files modified**: ${stats.filesModified.length} files were touched during this session.`
      );
    }
    if (stats.toolUsage["file.read"] && stats.toolUsage["file.edit"] && stats.toolUsage["file.write"]) {
      findings.push(
        `- Read-edit-write pattern detected (${stats.toolUsage["file.read"]} reads, ${stats.toolUsage["file.edit"]} edits, ${stats.toolUsage["file.write"]} writes).`
      );
    }

    if (findings.length === 0) {
      findings.push("- No notable findings for this session.");
    }

    report += findings.join("\n") + "\n\n";
  }

  return report;
}

/**
 * Generate a weekly activity summary report.
 *
 * @param {object[]} sessions — session objects or entries arrays
 * @param {object}   [options]
 * @param {string}   [options.title] — report title override
 * @returns {string} markdown report
 */
function generateWeeklyReport(sessions, options = {}) {
  const opts = { title: "Weekly Activity Report", ...options };
  if (!Array.isArray(sessions)) sessions = [];

  const sessList = sessions.map((s) => ({
    id: s.id || "unknown",
    entries: extractEntries(s),
  }));

  const agg = analyzeSessions(sessList);

  let report = "";
  report += `# ${opts.title}\n\n`;

  // Overview
  report += `## Overview\n\n`;
  report += `| Metric | Value |\n`;
  report += `| ------ | ----- |\n`;
  report += `| Sessions | ${agg.sessionCount} |\n`;
  report += `| Total entries | ${agg.totalEntries} |\n`;
  report += `| Avg entries / session | ${agg.avgEntriesPerSession} |\n`;
  report += `| Avg turns / session | ${agg.avgTurnsPerSession} |\n`;
  report += `| Total errors | ${agg.totalErrors} |\n`;
  report += `| Error rate | ${round(agg.aggregateErrorRate * 100, 1)}% |\n`;
  report += `\n`;

  // Messages by role
  report += `## Messages by Role\n\n`;
  for (const role of ["user", "assistant", "tool", "system"]) {
    report += `- **${role}**: ${agg.aggregateRoles[role] || 0}\n`;
  }
  report += `\n`;

  // Token summary
  report += `## Token Summary\n\n`;
  report += `| Type | Count |\n`;
  report += `| ---- | ----- |\n`;
  report += `| Input tokens | ${formatTokens(agg.aggregateTokens.input)} |\n`;
  report += `| Output tokens | ${formatTokens(agg.aggregateTokens.output)} |\n`;
  report += `| Total | ${formatTokens(agg.aggregateTokens.total)} |\n`;
  report += `\n`;

  // Top tools
  if (agg.topTools.length > 0) {
    report += `## Top Tools\n\n`;
    const chartData = agg.topTools.map(([name, count]) => ({
      label: name,
      value: count,
    }));
    report += "```\n";
    report += barChart(chartData, 30, 20);
    report += "```\n\n";
  }

  // Top files
  if (agg.topFiles.length > 0) {
    report += `## Most Modified Files\n\n`;
    for (const [file, count] of agg.topFiles.slice(0, 10)) {
      report += `- \`${file}\` (${count} times)\n`;
    }
    report += `\n`;
  }

  // Per-session summary table
  report += `## Per-Session Summary\n\n`;
  report += `| Session | Entries | Turns | Errors | Input Tokens | Output Tokens |\n`;
  report += `| ------- | ------- | ----- | ------ | ------------ | ------------- |\n`;
  for (const ps of agg.perSession) {
    report += `| \`${ps.id.slice(0, 12)}\` | ${ps.totalEntries} | ${ps.turns} | ${ps.errorCount} | ${formatTokens(ps.totalTokens.input)} | ${formatTokens(ps.totalTokens.output)} |\n`;
  }
  report += `\n`;

  return report;
}

/**
 * Generate a team collaboration metrics report.
 *
 * @param {object}   teamSessions — { teamName, members: [{ id, entries }] }
 * @param {object}   [options]
 * @returns {string} markdown report
 */
function generateTeamReport(teamSessions, options = {}) {
  const opts = {
    teamName: teamSessions.teamName || "Unnamed Team",
    ...options,
  };

  const members = Array.isArray(teamSessions.members)
    ? teamSessions.members
    : [];

  const memberStats = members.map((m) => {
    const entries = extractEntries(m);
    return {
      id: m.id || "unknown",
      stats: analyzeSession(entries),
    };
  });

  // Team aggregate
  const agg = analyzeSessions(
    members.map((m) => ({
      id: m.id || "unknown",
      entries: extractEntries(m),
    }))
  );

  let report = "";
  report += `# Team Report: ${opts.teamName}\n\n`;

  // Team overview
  report += `## Team Overview\n\n`;
  report += `| Metric | Value |\n`;
  report += `| ------ | ----- |\n`;
  report += `| Members | ${members.length} |\n`;
  report += `| Total sessions | ${agg.sessionCount} |\n`;
  report += `| Total entries | ${agg.totalEntries} |\n`;
  report += `| Total turns | ${memberStats.reduce((a, m) => a + m.stats.turns, 0)} |\n`;
  report += `| Total errors | ${agg.totalErrors} |\n`;
  report += `\n`;

  // Per-member contribution
  report += `## Member Activity\n\n`;
  report += `| Member | Entries | Turns | Errors | Files Modified |\n`;
  report += `| ------ | ------- | ----- | ------ | -------------- |\n`;
  for (const ms of memberStats) {
    report += `| \`${ms.id.slice(0, 12)}\` | ${ms.stats.totalEntries} | ${ms.stats.turns} | ${ms.stats.errorCount} | ${ms.stats.filesModified.length} |\n`;
  }
  report += `\n`;

  // Tool collaboration (tools used by multiple members)
  const memberToolSets = memberStats.map((ms) => new Set(Object.keys(ms.stats.toolUsage)));
  if (memberToolSets.length >= 2) {
    const sharedTools = [...memberToolSets[0]].filter((t) =>
      memberToolSets.slice(1).every((s) => s.has(t))
    );
    if (sharedTools.length > 0) {
      report += `## Shared Tools\n\n`;
      report += `Tools used by all team members:\n`;
      for (const t of sharedTools) {
        report += `- \`${t}\`\n`;
      }
      report += `\n`;
    }
  }

  report += `## Most Active Member\n\n`;
  const mostActive = memberStats.reduce(
    (best, curr) => (curr.stats.totalEntries > best.stats.totalEntries ? curr : best),
    memberStats[0] || { id: "N/A", stats: { totalEntries: 0 } }
  );
  report += `- **\`${mostActive.id.slice(0, 12)}\`** with ${mostActive.stats.totalEntries} entries\n`;
  report += `\n`;

  return report;
}

/**
 * Generate a one-line summary for display in session lists.
 *
 * @param {object[]|object} session — entries or { id, entries }
 * @returns {string} one-line summary
 */
function generateSummaryCard(session) {
  const entries = extractEntries(session);
  const sessionId =
    (typeof session === "object" && session !== null && session.id) ||
    "session";
  const stats = analyzeSession(entries);
  const summary = getSummaryLine(entries);
  const tokStr = formatTokens(stats.totalTokens.total);
  const durStr = formatDuration(stats.durationMs);

  const parts = [
    sessionId.slice(0, 12),
    `${stats.totalEntries}e`,
    `${stats.turns}t`,
    `err:${round(stats.errorRate * 100, 0)}%`,
    `${tokStr} tokens`,
    durStr,
    summary,
  ];

  return parts.join(" | ");
}

module.exports = {
  generateSessionReport,
  generateWeeklyReport,
  generateTeamReport,
  generateSummaryCard,
};
