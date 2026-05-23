"use strict";

/**
 * Dashboard slash commands — /health, /metrics, /audit
 *
 * Each handler renders a rich-text terminal dashboard by delegating
 * to the respective analytics module (health, tokens, governance).
 */

const { HealthMonitor } = require("../health/monitor");
const { HealthVisualizer } = require("../health/visualizer");
const { TokenVisualizer } = require("../tokens/visualizer");
const { TokenReport } = require("../tokens/report");
const { PolicyAuditor } = require("../governance/auditor");
const { THEME, ANSI } = require("../renderer");

// ---------------------------------------------------------------------------
// /health — project health dashboard
// ---------------------------------------------------------------------------

function handleHealthCommand(_args, { session, screen }) {
  const monitor = new HealthMonitor();
  const visualizer = new HealthVisualizer();

  // Run a single-shot health check using observability metrics if available
  let metrics = {};
  try {
    const { getMetrics } = require("../observability/metrics");
    const observed = getMetrics();
    if (observed) {
      metrics = {
        codeHealth: observed.codeHealth,
        testCoverage: observed.testCoverage,
        debtRatio: observed.debtRatio,
        docCoverage: observed.docCoverage,
        dependencyHealth: observed.dependencyHealth,
      };
    }
  } catch (_) {
    /* metrics module not available */
  }

  const snapshot = monitor.check(metrics);
  const dashboard = visualizer.renderDashboard(snapshot);
  screen.write(`${dashboard}\n`);
}

// ---------------------------------------------------------------------------
// /metrics — token usage and cost metrics
// ---------------------------------------------------------------------------

function handleMetricsCommand(_args, { session, screen }) {
  const costData = session.costTracker?.getSessionCost
    ? session.costTracker.getSessionCost()
    : {
        sessionName: session.id?.slice(0, 12) || "unknown",
        totalTokens: session.costTracker?.totalTokens || 0,
        totalInputTokens: session.costTracker?.totalInputTokens || 0,
        totalOutputTokens: session.costTracker?.totalOutputTokens || 0,
        totalCost: session.costTracker?.getCost
          ? session.costTracker.getCost(session.provider?.model)
          : 0,
        totalCalls: session.costTracker?.turnCount || 0,
        budgetLimit: session.costTracker?.budgetLimit || 0,
        budgetUsedPercent: session.costTracker?.budgetUsedPercent || 0,
      };

  const report = new TokenReport();
  const visualizer = new TokenVisualizer();

  const reportData = report.generateUsageReport(costData);

  // Header
  screen.write(`\n${THEME.heading}Token Usage & Cost Metrics${ANSI.reset || ""}\n`);
  screen.write(`${THEME.dim}${"─".repeat(48)}${ANSI.reset || ""}\n\n`);

  // Usage bar
  const modelContextWindow = session.settings?.context?.windowTokens
    || (session.provider?.model ? 200000 : 100000);
  const totalUsed = costData.totalTokens || 0;

  screen.write(
    `  ${visualizer.renderUsageBar(totalUsed, modelContextWindow, {
      label: "Context Usage",
    })}\n`
  );

  // Token breakdown
  screen.write(
    `  Input:  ${formatNumber(costData.totalInputTokens || 0)} tokens\n`
  );
  screen.write(
    `  Output: ${formatNumber(costData.totalOutputTokens || 0)} tokens\n`
  );
  screen.write(
    `  Total:  ${THEME.bold || ""}${formatNumber(totalUsed)} tokens${ANSI.reset || ""}\n\n`
  );

  // Cost
  const cost = typeof costData.totalCost === "number" ? costData.totalCost : 0;
  screen.write(`  ${THEME.cost || ""}Cost:   $${cost.toFixed(4)}${ANSI.reset || ""}\n`);
  screen.write(`  ${THEME.muted || THEME.dim}Calls:  ${costData.totalCalls || 0}${ANSI.reset || ""}\n`);

  if (costData.budgetLimit > 0) {
    screen.write(
      `  ${THEME.muted || THEME.dim}Budget: $${Number(costData.budgetLimit).toFixed(2)} (${costData.budgetUsedPercent || 0}% used)${ANSI.reset || ""}\n`
    );
  }

  // Efficiency
  const efficiency =
    totalUsed > 0
      ? ((costData.totalOutputTokens || 0) / totalUsed) * 100
      : 0;
  screen.write(
    `\n  ${THEME.muted || THEME.dim}Efficiency (output/total): ${efficiency.toFixed(1)}%${ANSI.reset || ""}\n`
  );
  screen.write(`\n${THEME.dim}  /cost for compact view${ANSI.reset || ""}\n\n`);
}

// ---------------------------------------------------------------------------
// /audit — security audit status
// ---------------------------------------------------------------------------

function handleAuditCommand(_args, { session, screen }) {
  const auditor = new PolicyAuditor();

  // Build a lightweight session snapshot for auditing
  const auditTarget = {
    id: session.id || "unknown",
    agentId: session.agentId || "cli-agent",
    actions: buildActionsFromSession(session),
  };

  const result = auditor.audit(auditTarget);

  // Compose the rendered report
  screen.write(`\n${THEME.heading}Security Audit${ANSI.reset || ""}\n`);
  screen.write(`${THEME.dim}${"─".repeat(48)}${ANSI.reset || ""}\n\n`);

  // Score
  const score = result.complianceScore;
  const scoreColor =
    score >= 80
      ? THEME.success
      : score >= 60
        ? THEME.warning
        : THEME.error;
  screen.write(
    `  Compliance Score:  ${scoreColor}${score}/100${ANSI.reset || ""}\n\n`
  );

  // Category scores
  if (result.categoryScores) {
    screen.write(`  ${THEME.bold || ""}Category Scores:${ANSI.reset || ""}\n`);
    for (const [key, val] of Object.entries(result.categoryScores)) {
      const label = String(key).replace(/_/g, " ");
      screen.write(
        `    ${THEME.muted || THEME.dim}${label.padEnd(24)}${ANSI.reset || ""} ${val}\n`
      );
    }
    screen.write("\n");
  }

  // Violations summary
  const violations = result.violations || [];
  if (violations.length === 0) {
    screen.write(
      `  ${THEME.success}No policy violations detected.${ANSI.reset || ""}\n`
    );
  } else {
    const bySeverity = { CRITICAL: [], MAJOR: [], MINOR: [], ADVISORY: [] };
    for (const v of violations) {
      if (bySeverity[v.severity]) {
        bySeverity[v.severity].push(v);
      }
    }

    for (const [severity, items] of Object.entries(bySeverity)) {
      if (items.length === 0) continue;
      const color =
        severity === "CRITICAL"
          ? THEME.error
          : severity === "MAJOR"
            ? THEME.warning
            : THEME.muted || THEME.dim;
      screen.write(
        `  ${color}${severity}: ${items.length} violation(s)${ANSI.reset || ""}\n`
      );
    }
    screen.write("\n");

    // Detail listing (top 5)
    const topViolations = violations.slice(0, 5);
    for (const v of topViolations) {
      const sevColor =
        v.severity === "CRITICAL"
          ? THEME.error
          : v.severity === "MAJOR"
            ? THEME.warning
            : THEME.muted || THEME.dim;
      screen.write(
        `  ${sevColor}[${v.severity}]${ANSI.reset || ""} ${THEME.muted || THEME.dim}${v.actionType || "?"}${ANSI.reset || ""} — ${v.reason || "No reason provided"}\n`
      );
    }
    screen.write("\n");
  }

  // Footer
  screen.write(`${THEME.dim}  Run /permissions status for tool-level policy details${ANSI.reset || ""}\n\n`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an actions array from session state suitable for PolicyAuditor.audit().
 */
function buildActionsFromSession(session) {
  const actions = [];

  // Reflect permission decisions recorded during the session
  if (session._actionsLog && Array.isArray(session._actionsLog)) {
    return session._actionsLog;
  }

  // Fallback: capture what we can from the session
  if (session.messages && Array.isArray(session.messages)) {
    for (const msg of session.messages) {
      if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
        for (const tc of msg.toolCalls) {
          actions.push({
            type: tc.name || tc.tool || "unknown",
            target: tc.arguments
              ? JSON.stringify(tc.arguments).slice(0, 80)
              : "(none)",
            executed: true,
            context: {
              role: msg.role,
              timestamp: msg.timestamp || new Date().toISOString(),
            },
          });
        }
      }
    }
  }

  return actions;
}

/**
 * Format a number for display (e.g., 1234 → "1.2K").
 */
function formatNumber(n) {
  const num = Number(n) || 0;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(Math.round(num));
}

module.exports = {
  handleHealthCommand,
  handleMetricsCommand,
  handleAuditCommand,
};
