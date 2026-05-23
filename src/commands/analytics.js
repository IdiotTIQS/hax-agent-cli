"use strict";

/**
 * Slash-command handlers for analytics and reporting.
 *
 *   /analytics               — show current session stats
 *   /analytics tools          — tool usage insights
 *   /analytics predict        — predictions for current session
 *   /analytics anomalies      — anomaly scan results
 *   /report                   — generate and display session report
 *   /report weekly            — weekly activity summary
 *   /report export <format>   — export report (md|json|text)
 */

const path = require("node:path");
const fs = require("node:fs");
const { THEME, styled, VERSION } = require("../renderer");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireAnalyticsBridge() {
  try {
    return require("../infrastructure/analytics-setup");
  } catch (_) {
    return null;
  }
}

function requireReportGenerator() {
  try {
    return require("../analytics/report-generator");
  } catch (_) {
    return null;
  }
}

function requireConversationStats() {
  try {
    return require("../analytics/conversation-stats");
  } catch (_) {
    return null;
  }
}

function formatTokens(n) {
  if (n == null || !Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatDuration(ms) {
  if (ms == null || ms === 0) return "N/A";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function bar(data, maxWidth, labelWidth) {
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  return data
    .map((d) => {
      const barLen = Math.max(1, Math.round((d.value / maxVal) * maxWidth));
      const bar = "█".repeat(barLen);
      return `  ${d.label.padEnd(labelWidth)} | ${bar} (${d.value})`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Command: /analytics
// ---------------------------------------------------------------------------

async function handleAnalyticsCommand(args, { screen, session }) {
  const [subCommand] = args;
  const bridge = requireAnalyticsBridge();
  const statsModule = requireConversationStats();

  if (!bridge || !statsModule) {
    screen.write(
      `${THEME.warning}Analytics modules are not available.${THEME.reset || ""}\n`
    );
    return;
  }

  // Ensure analytics are wired
  if (!session.analytics) {
    bridge.setupAnalytics(session);
  }

  if (subCommand === "tools" || subCommand === "t") {
    return showToolInsights({ screen, session, bridge });
  }

  if (subCommand === "predict" || subCommand === "p") {
    return showPredictions({ screen, session, bridge });
  }

  if (subCommand === "anomalies" || subCommand === "a") {
    return showAnomalies({ screen, session, bridge });
  }

  // Default: show session stats
  return showSessionStats({ screen, session, bridge, statsModule });
}

function showSessionStats({ screen, session, bridge, statsModule }) {
  // Check for cached stats from analytics bridge
  let stats = session.analytics?.stats;
  if (!stats) {
    // Compute on demand
    const entries = session.messages || [];
    if (entries.length === 0) {
      screen.write(
        `${THEME.dim}No messages in this session yet. Start a conversation first.${THEME.reset || ""}\n`
      );
      return;
    }
    stats = statsModule.analyzeSession(entries, {
      includeLatency: true,
      includeTokenDetails: true,
    });
    if (session.analytics) {
      session.analytics.stats = stats;
    }
  }

  const h = THEME.heading;
  const d = THEME.dim;
  const b = THEME.accent;
  const r = THEME.reset || "";

  screen.write(`\n${h}Session Analytics${r}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${r}\n`);

  screen.write(`\n${b}${"Overview".padEnd(20)}${r}\n`);
  screen.write(`  ${d}Total entries${r}      ${stats.totalEntries}\n`);
  screen.write(`  ${d}Turns${r}              ${stats.turns}\n`);
  screen.write(`  ${d}Duration${r}           ${formatDuration(stats.durationMs)}\n`);
  screen.write(`  ${d}Files modified${r}     ${stats.filesModified.length}\n`);

  if (stats.filesModified.length > 0) {
    for (const f of stats.filesModified.slice(0, 5)) {
      screen.write(`    ${d}•${r} ${f}\n`);
    }
    if (stats.filesModified.length > 5) {
      screen.write(`    ${d}… and ${stats.filesModified.length - 5} more${r}\n`);
    }
  }

  screen.write(`\n${b}${"Messages by Role".padEnd(20)}${r}\n`);
  for (const role of ["user", "assistant", "tool", "system"]) {
    screen.write(`  ${d}${role.padEnd(14)}${r} ${stats.roles[role] || 0}\n`);
  }

  screen.write(`\n${b}${"Token Usage".padEnd(20)}${r}\n`);
  screen.write(`  ${d}Input${r}             ${formatTokens(stats.totalTokens.input)}\n`);
  screen.write(`  ${d}Output${r}            ${formatTokens(stats.totalTokens.output)}\n`);
  if (stats.totalTokens.cacheCreation > 0) {
    screen.write(`  ${d}Cache write${r}       ${formatTokens(stats.totalTokens.cacheCreation)}\n`);
  }
  if (stats.totalTokens.cacheRead > 0) {
    screen.write(`  ${d}Cache read${r}        ${formatTokens(stats.totalTokens.cacheRead)}\n`);
  }
  screen.write(`  ${d}Total${r}             ${formatTokens(stats.totalTokens.total)}\n`);

  screen.write(`\n${b}${"Errors".padEnd(20)}${r}\n`);
  screen.write(`  ${d}Error count${r}       ${stats.errorCount}\n`);
  screen.write(`  ${d}Error rate${r}        ${(stats.errorRate * 100).toFixed(1)}%\n`);

  // Tool usage bar chart
  const toolEntries = Object.entries(stats.toolUsage).sort((a, b) => b[1] - a[1]);
  if (toolEntries.length > 0) {
    screen.write(`\n${b}${"Tool Usage".padEnd(20)}${r}\n`);
    const chartData = toolEntries.slice(0, 10).map(([name, count]) => ({
      label: name,
      value: count,
    }));
    screen.write(`${d}${bar(chartData, 30, 20)}${r}\n`);
  }

  // Token trends (simple sparkline-ish)
  if (stats.tokenUsageTrends && stats.tokenUsageTrends.length > 0) {
    screen.write(`\n${b}${"Token Trends".padEnd(20)}${r}\n`);
    const trends = stats.tokenUsageTrends;
    const maxTok = Math.max(
      ...trends.map((t) => t.inputTokens + t.outputTokens),
      1
    );
    for (const t of trends.slice(-8)) {
      const total = t.inputTokens + t.outputTokens;
      const width = Math.max(1, Math.round((total / maxTok) * 30));
      screen.write(
        `  ${d}T${String(t.turn).padStart(2)}${r} ${"█".repeat(width)} ${d}${formatTokens(total)}${r}\n`
      );
    }
  }

  screen.write(
    `\n${d}───────────────────────────────────${r}\n`
  );
  screen.write(
    `${d}/analytics tools  ·  /analytics predict  ·  /report${r}\n\n`
  );
}

function showToolInsights({ screen, session, bridge }) {
  const insights = bridge.getToolInsights(session);
  const h = THEME.heading;
  const d = THEME.dim;
  const b = THEME.accent;
  const w = THEME.warning;
  const r = THEME.reset || "";

  if (!insights) {
    screen.write(
      `${d}No tool usage data available yet.${r}\n`
    );
    return;
  }

  screen.write(`\n${h}Tool Usage Insights${r}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${r}\n`);

  // Most used tools
  if (insights.mostUsed && insights.mostUsed.length > 0) {
    screen.write(`\n${b}${"Most Used Tools".padEnd(20)}${r}\n`);
    for (const t of insights.mostUsed.slice(0, 10)) {
      const rateStr = t.successRate !== undefined
        ? ` ${d}(${(t.successRate * 100).toFixed(0)}% success)${r}`
        : "";
      screen.write(`  ${d}•${r} ${t.name.padEnd(20)} ${t.count} calls${rateStr}\n`);
    }
  }

  // Error-prone tools
  if (insights.errorProne && insights.errorProne.length > 0) {
    screen.write(`\n${w}${"Error-Prone Tools".padEnd(20)}${r}\n`);
    for (const t of insights.errorProne.slice(0, 5)) {
      screen.write(
        `  ${d}•${r} ${t.name.padEnd(20)} ${t.errorCount}/${t.count} errors (${(t.errorRate * 100).toFixed(1)}%)\n`
      );
    }
  } else if (insights.mostUsed && insights.mostUsed.length > 0) {
    screen.write(`\n${d}No error-prone tools detected (all tools healthy).${r}\n`);
  }

  // Tool sequence patterns
  if (insights.patterns && insights.patterns.length > 0) {
    screen.write(`\n${b}${"Common Tool Sequences".padEnd(20)}${r}\n`);
    for (const p of insights.patterns.slice(0, 5)) {
      const seq = p.sequence.join(" → ");
      screen.write(`  ${d}•${r} ${seq} ${d}(×${p.count})${r}\n`);
    }
  } else if (insights.mostUsed && insights.mostUsed.length > 0) {
    screen.write(`\n${d}Not enough tool calls to detect sequence patterns.${r}\n`);
  }

  if (!insights.mostUsed || insights.mostUsed.length === 0) {
    screen.write(`\n${d}No tool calls recorded in this session yet.${r}\n`);
  }

  screen.write(
    `\n${d}───────────────────────────────────${r}\n`
  );
  screen.write(`${d}/analytics predict  ·  /analytics anomalies${r}\n\n`);
}

function showPredictions({ screen, session, bridge }) {
  const prediction = bridge.getPrediction(session);
  const h = THEME.heading;
  const d = THEME.dim;
  const b = THEME.accent;
  const s = THEME.success;
  const w = THEME.warning;
  const e = THEME.error;
  const r = THEME.reset || "";

  if (!prediction) {
    screen.write(
      `${d}Not enough data for predictions. Start a conversation first.${r}\n`
    );
    return;
  }

  screen.write(`\n${h}Session Predictions${r}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${r}\n`);

  // Success prediction
  const { success } = prediction;
  if (success) {
    const predColor = success.prediction === "success"
      ? s : success.prediction === "failure"
        ? e : w;
    screen.write(`\n${b}${"Success Prediction".padEnd(22)}${r}\n`);
    screen.write(`  ${d}Outcome${r}      ${predColor}${success.prediction}${r} (score: ${(success.score * 100).toFixed(1)}%)\n`);
    if (success.confidence) {
      screen.write(`  ${d}Confidence${r}    ${success.confidence.level} (${(success.confidence.value * 100).toFixed(0)}%)\n`);
      screen.write(`  ${d}Data points${r}   ${success.confidence.dataPoints}\n`);
    }
    if (success.factors) {
      screen.write(`\n  ${b}${"Factor Breakdown".padEnd(20)}${r}\n`);
      for (const [factor, score] of Object.entries(success.factors)) {
        const barLen = Math.round(score * 20);
        screen.write(`  ${d}${factor.padEnd(20)}${r} ${"█".repeat(barLen)}${"·".repeat(20 - barLen)} ${(score * 100).toFixed(0)}%\n`);
      }
    }
  }

  // Duration prediction
  const { duration } = prediction;
  if (duration && duration.estimatedMs > 0) {
    screen.write(`\n${b}${"Duration Estimate".padEnd(22)}${r}\n`);
    screen.write(`  ${d}Elapsed${r}        ${formatDuration(duration.elapsedMs)}\n`);
    screen.write(`  ${d}Remaining${r}      ~${formatDuration(duration.estimatedMs)} (${duration.estimatedRemainingTurns} turns)\n`);
    screen.write(`  ${d}Avg / turn${r}      ${formatDuration(duration.avgTimePerTurnMs)}\n`);
    screen.write(`  ${d}Confidence${r}      ${(duration.confidence * 100).toFixed(0)}%\n`);
  }

  // Tool needs
  const { toolNeeds } = prediction;
  if (toolNeeds && toolNeeds.predictions && toolNeeds.predictions.length > 0) {
    screen.write(`\n${b}${"Predicted Tool Needs".padEnd(22)}${r}\n`);
    for (const tn of toolNeeds.predictions) {
      const barLen = Math.round(tn.score * 20);
      screen.write(`  ${d}${tn.name.padEnd(18)}${r} ${"█".repeat(barLen)}${"·".repeat(20 - barLen)} ${(tn.score * 100).toFixed(0)}%\n`);
    }
    screen.write(`  ${d}Confidence${r}        ${(toolNeeds.confidence * 100).toFixed(0)}%\n`);
  }

  screen.write(
    `\n${d}───────────────────────────────────${r}\n`
  );
  screen.write(`${d}Predictions are heuristic-based and improve with more data.${r}\n\n`);
}

function showAnomalies({ screen, session, bridge }) {
  const h = THEME.heading;
  const d = THEME.dim;
  const w = THEME.warning;
  const e = THEME.error;
  const r = THEME.reset || "";

  const analytics = session.analytics;
  if (!analytics) {
    screen.write(`${d}Analytics not initialized for this session.${r}\n`);
    return;
  }

  // Re-run detection on current messages
  let anomalies;
  try {
    const entries = session.messages || [];
    anomalies = analytics.anomalyDetector.detect(entries);
    analytics.anomalies = anomalies;
  } catch (_) {
    anomalies = analytics.anomalies || [];
  }

  const summary = analytics.anomalyDetector.getSeveritySummary();

  screen.write(`\n${h}Anomaly Detection${r}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${r}\n`);

  screen.write(`\n${h}${"Severity Summary".padEnd(20)}${r}\n`);
  screen.write(`  ${d}CRITICAL${r}  ${summary.CRITICAL || 0}\n`);
  screen.write(`  ${d}HIGH${r}      ${summary.HIGH || 0}\n`);
  screen.write(`  ${d}MEDIUM${r}    ${summary.MEDIUM || 0}\n`);
  screen.write(`  ${d}LOW${r}       ${summary.LOW || 0}\n`);
  screen.write(`  ${d}Total${r}     ${summary.total}\n`);

  if (anomalies.length === 0) {
    screen.write(`\n${THEME.success}No anomalies detected.${r}\n`);
    screen.write(`\n\n`);
    return;
  }

  screen.write(`\n${h}${"Detected Anomalies".padEnd(20)}${r}\n`);

  for (const a of anomalies.slice(0, 15)) {
    const sevColor =
      a.severity === "CRITICAL" ? e :
      a.severity === "HIGH" ? w :
      d;
    screen.write(`  ${sevColor}[${a.severity}]${r} ${a.message}\n`);
  }

  if (anomalies.length > 15) {
    screen.write(`  ${d}… and ${anomalies.length - 15} more anomalies${r}\n`);
  }

  // Group by category
  const grouped = analytics.anomalyDetector.getAnomaliesByCategory();
  const nonEmptyCategories = Object.entries(grouped).filter(([, list]) => list.length > 0);
  if (nonEmptyCategories.length > 0) {
    screen.write(`\n${h}${"By Category".padEnd(20)}${r}\n`);
    for (const [category, list] of nonEmptyCategories) {
      const label = category.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
      screen.write(`  ${d}${label.padEnd(24)}${r} ${list.length} anomalies\n`);
    }
  }

  screen.write(
    `\n${d}───────────────────────────────────${r}\n`
  );
  screen.write(`${d}/analytics tools  ·  /report${r}\n\n`);
}

// ---------------------------------------------------------------------------
// Command: /report
// ---------------------------------------------------------------------------

async function handleReportCommand(args, { screen, session }) {
  const [subCommand, ...rest] = args;
  const bridge = requireAnalyticsBridge();
  const reportModule = requireReportGenerator();

  if (!bridge || !reportModule) {
    screen.write(
      `${THEME.warning}Report modules are not available.${THEME.reset || ""}\n`
    );
    return;
  }

  // Ensure analytics are wired
  if (!session.analytics) {
    bridge.setupAnalytics(session);
  }

  if (subCommand === "weekly" || subCommand === "w") {
    return showWeeklyReport({ screen, session, bridge, reportModule });
  }

  if (subCommand === "export" || subCommand === "e") {
    const format = rest[0] || "md";
    return exportReport(format, { screen, session, bridge, reportModule });
  }

  // Default: generate and display session report
  return showSessionReport({ screen, session, bridge, reportModule });
}

function showSessionReport({ screen, session, bridge, reportModule }) {
  const d = THEME.dim;
  const r = THEME.reset || "";

  try {
    const report = bridge.getSessionReport(session, { force: true });
    if (!report) {
      screen.write(
        `${d}No data available for session report. Start a conversation first.${r}\n`
      );
      return;
    }

    // Write the markdown report with basic rendering
    screen.write(`\n`);
    for (const line of report.split("\n")) {
      if (line.startsWith("# ")) {
        screen.write(`${THEME.heading}${line}${r}\n`);
      } else if (line.startsWith("## ")) {
        screen.write(`${THEME.accent}${line}${r}\n`);
      } else if (line.startsWith("```")) {
        screen.write(`${d}${line}${r}\n`);
      } else if (line.startsWith("|")) {
        // Table rendering with alternating dim
        screen.write(`${d}${line}${r}\n`);
      } else if (line.startsWith("- **")) {
        screen.write(`${THEME.warning}${line}${r}\n`);
      } else {
        screen.write(`${line}\n`);
      }
    }

    screen.write(
      `\n${d}───────────────────────────────────${r}\n`
    );
    screen.write(
      `${d}/report weekly  ·  /report export md  ·  /analytics${r}\n\n`
    );
  } catch (err) {
    screen.write(
      `${THEME.error}Failed to generate report: ${err.message}${r}\n`
    );
  }
}

function showWeeklyReport({ screen, session, bridge, reportModule }) {
  const d = THEME.dim;
  const r = THEME.reset || "";

  try {
    const { listSessions } = require("../memory");
    const sessions = listSessions(session.settings);

    if (sessions.length === 0) {
      screen.write(`${d}No previous sessions found for the weekly report.${r}\n`);
      return;
    }

    const report = bridge.getWeeklyReport(sessions, {
      title: `Weekly Activity Report (${sessions.length} sessions)`,
    });

    if (!report) {
      screen.write(`${d}Failed to generate weekly report.${r}\n`);
      return;
    }

    screen.write(`\n`);
    for (const line of report.split("\n")) {
      if (line.startsWith("# ")) {
        screen.write(`${THEME.heading}${line}${r}\n`);
      } else if (line.startsWith("## ")) {
        screen.write(`${THEME.accent}${line}${r}\n`);
      } else if (line.startsWith("```")) {
        screen.write(`${d}${line}${r}\n`);
      } else if (line.startsWith("|")) {
        screen.write(`${d}${line}${r}\n`);
      } else if (line.startsWith("- **")) {
        screen.write(`${THEME.warning}${line}${r}\n`);
      } else {
        screen.write(`${line}\n`);
      }
    }

    screen.write(
      `\n${d}───────────────────────────────────${r}\n`
    );
    screen.write(`${d}/report export md  ·  /analytics${r}\n\n`);
  } catch (err) {
    screen.write(
      `${THEME.error}Failed to generate weekly report: ${err.message}${r}\n`
    );
  }
}

function exportReport(format, { screen, session, bridge, reportModule }) {
  const validFormats = { md: "markdown", json: "json", text: "text", txt: "text" };
  const resolvedFormat = validFormats[format.toLowerCase()] || "markdown";
  const d = THEME.dim;
  const r = THEME.reset || "";

  try {
    const exportDir = path.join(process.cwd(), ".hax-agent", "exports");
    fs.mkdirSync(exportDir, { recursive: true });

    const timestamp = Date.now();
    let ext, content;
    const entries = session.messages || [];

    if (resolvedFormat === "markdown") {
      ext = "md";
      const report = reportModule.generateSessionReport(
        { id: session.id, entries },
        { includeCharts: true, includeFindings: true }
      );
      content = report;
    } else if (resolvedFormat === "json") {
      ext = "json";
      const stats = require("../analytics/conversation-stats").analyzeSession(
        entries,
        { includeLatency: true, includeTokenDetails: true }
      );
      content = JSON.stringify(
        {
          sessionId: session.id,
          exportedAt: new Date().toISOString(),
          version: VERSION,
          stats,
        },
        null,
        2
      );
    } else {
      ext = "txt";
      const report = reportModule.generateSessionReport(
        { id: session.id, entries },
        { includeCharts: false, includeFindings: true }
      );
      // Strip ANSI-like markdown formatting for plain text
      content = report
        .replace(/```/g, "")
        .replace(/\*\*/g, "")
        .replace(/`/g, "");
    }

    const outputPath = path.join(exportDir, `${session.id}-report-${timestamp}.${ext}`);
    fs.writeFileSync(outputPath, content, "utf-8");

    screen.write(
      `${THEME.success}Report exported to ${outputPath}${r}\n`
    );
    screen.write(`${d}Format: ${resolvedFormat}, Size: ${content.length.toLocaleString()} bytes${r}\n\n`);
  } catch (err) {
    screen.write(
      `${THEME.error}Export failed: ${err.message}${r}\n`
    );
  }
}

// ---------------------------------------------------------------------------
// Event handler for anomaly alerts (wired by analytics-setup)
// ---------------------------------------------------------------------------

/**
 * Handle analytics:anomaly events to display notifications.
 * Called from the EventBus subscriber chain; can consume the event to
 * print alerts in the interactive shell.
 *
 * @param {object} data - { sessionId, anomaly, severitySummary, timestamp }
 * @param {object} session - target session
 * @param {object} screen - terminal screen for output
 */
function handleAnomalyAlert(data, { session, screen }) {
  if (!data || !data.anomaly) return;

  const sev = data.anomaly.severity;
  const color =
    sev === "CRITICAL" ? THEME.error :
    sev === "HIGH" ? THEME.warning :
    THEME.dim;
  const r = THEME.reset || "";

  if (sev === "CRITICAL" || sev === "HIGH") {
    screen.write(
      `${color}⚠ Anomaly [${sev}]:${r} ${data.anomaly.message}\n`
    );
  }
}

module.exports = {
  handleAnalyticsCommand,
  handleReportCommand,
  handleAnomalyAlert,
};
