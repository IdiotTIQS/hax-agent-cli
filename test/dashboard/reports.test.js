"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MetricsCollector } = require("../../src/dashboard/collector");
const {
  generateDailyReport,
  generateWeeklyReport,
  generateHealthCheck,
  generatePerformanceReport,
  generateCostReport,
} = require("../../src/dashboard/reports");

// ---------------------------------------------------------------------------
// Mock data factory
// ---------------------------------------------------------------------------

function createCollector(overrides) {
  const mc = new MetricsCollector();

  const tool = overrides && overrides.toolMetrics ? overrides.toolMetrics : {
    tools: { "file.read": 150, "file.edit": 80, "shell.run": 45 },
    totalExecutions: 275,
    totalErrors: 7,
    durations: [120, 340, 90, 560, 210, 75, 890, 150, 300],
  };

  const now = Date.now();
  const sessions = overrides && overrides.sessionMetrics ? overrides.sessionMetrics : {
    sessions: [
      { timestamp: new Date(now - 5 * 86400000).toISOString(), turns: 5, cost: 0.15, totalTokens: 4500 },
      { timestamp: new Date(now - 2 * 86400000).toISOString(), turns: 8, cost: 0.28, totalTokens: 8200 },
      { timestamp: new Date(now - 0).toISOString(), turns: 3, cost: 0.09, totalTokens: 2800 },
    ],
  };

  const sys = overrides && overrides.systemMetrics ? overrides.systemMetrics : {
    uptimeMs: 36000000,
    memory: { usedMB: 512, totalMB: 1024, usagePercent: 50 },
    cpu: { usagePercent: 35, loadAvg1m: 1.2, loadAvg5m: 0.9, loadAvg15m: 0.7 },
  };

  const tkn = overrides && overrides.tokenMetrics ? overrides.tokenMetrics : {
    totalInputTokens: 50000,
    totalOutputTokens: 15000,
    totalCacheCreationTokens: 3000,
    totalCacheReadTokens: 12000,
    avgTokensPerTurn: 2500,
    costEstimate: { total: 2.45, breakdown: { "claude-sonnet": 1.8, "claude-opus": 0.65 } },
  };

  const agent = overrides && overrides.agentMetrics ? overrides.agentMetrics : {
    totalTurns: 48,
    avgResponseTimeMs: 3200,
    errorRate: 0.02,
  };

  mc.registerSource("toolMetrics", tool);
  mc.registerSource("sessionMetrics", sessions);
  mc.registerSource("systemMetrics", sys);
  mc.registerSource("tokenMetrics", tkn);
  mc.registerSource("agentMetrics", agent);

  return mc;
}

// ---------------------------------------------------------------------------
// generateDailyReport tests
// ---------------------------------------------------------------------------

test("generateDailyReport: returns a non-empty string", () => {
  const mc = createCollector();
  const report = generateDailyReport(mc);
  assert.ok(typeof report === "string");
  assert.ok(report.length > 50);
});

test("generateDailyReport: includes key metrics in plain-text mode", () => {
  const mc = createCollector();
  const report = generateDailyReport(mc);

  assert.ok(report.includes("DAILY SUMMARY REPORT"));
  assert.ok(report.includes("Tool Activity"));
  assert.ok(report.includes("Sessions"));
  assert.ok(report.includes("Token Usage"));
  assert.ok(report.includes("System Health"));
  assert.ok(report.includes("275")); // total executions
  assert.ok(report.includes("file.read")); // top tool
});

test("generateDailyReport: renders in markdown mode", () => {
  const mc = createCollector();
  const report = generateDailyReport(mc, { markdown: true });

  assert.ok(report.includes("## DAILY SUMMARY REPORT"));
  assert.ok(report.includes("### Tool Activity"));
  assert.ok(report.includes("- ")); // markdown bullet
});

// ---------------------------------------------------------------------------
// generateWeeklyReport tests
// ---------------------------------------------------------------------------

test("generateWeeklyReport: returns a non-empty string", () => {
  const mc = createCollector();
  const report = generateWeeklyReport(mc);
  assert.ok(typeof report === "string");
  assert.ok(report.length > 100);
});

test("generateWeeklyReport: includes trend and insight sections", () => {
  const mc = createCollector();
  const report = generateWeeklyReport(mc);

  assert.ok(report.includes("WEEKLY TRENDS REPORT"));
  assert.ok(report.includes("Activity Trends"));
  assert.ok(report.includes("Tool Usage Trends"));
  assert.ok(report.includes("Error Analysis"));
  assert.ok(report.includes("Token & Cost Trends"));
  assert.ok(report.includes("Insights & Recommendations"));
});

test("generateWeeklyReport: warns on high error rate", () => {
  const mc = createCollector({
    toolMetrics: {
      tools: { "failing.tool": 100 },
      totalExecutions: 100,
      totalErrors: 40,
      durations: [100],
    },
  });
  const report = generateWeeklyReport(mc);
  assert.ok(report.includes("WARNING") || report.includes("40"));
});

test("generateWeeklyReport: renders in markdown mode", () => {
  const mc = createCollector();
  const report = generateWeeklyReport(mc, { markdown: true });

  assert.ok(report.includes("## WEEKLY TRENDS REPORT"));
  assert.ok(report.includes("- "));
});

// ---------------------------------------------------------------------------
// generateHealthCheck tests
// ---------------------------------------------------------------------------

test("generateHealthCheck: returns a non-empty string with PASS/WARN/FAIL", () => {
  const mc = createCollector();
  const report = generateHealthCheck(mc);
  assert.ok(typeof report === "string");
  assert.ok(report.includes("[PASS]") || report.includes("[WARN]") || report.includes("[FAIL]"));
});

test("generateHealthCheck: includes all health checks", () => {
  const mc = createCollector();
  const report = generateHealthCheck(mc);

  assert.ok(report.includes("Tool Success Rate"));
  assert.ok(report.includes("Tool Error Rate"));
  assert.ok(report.includes("Memory Usage"));
  assert.ok(report.includes("CPU Usage"));
  assert.ok(report.includes("Uptime"));
});

test("generateHealthCheck: shows FAIL when health is failing", () => {
  const mc = createCollector({
    toolMetrics: {
      tools: { x: 10 },
      totalExecutions: 100,
      totalErrors: 95,
      durations: [100],
    },
    systemMetrics: {
      uptimeMs: 0,
      memory: { usedMB: 1000, totalMB: 1024, usagePercent: 97 },
      cpu: { usagePercent: 95, loadAvg1m: 5, loadAvg5m: 4, loadAvg15m: 3 },
    },
  });
  const report = generateHealthCheck(mc);
  assert.ok(report.includes("[FAIL]"));
});

test("generateHealthCheck: renders markdown table", () => {
  const mc = createCollector();
  const report = generateHealthCheck(mc, { markdown: true });

  assert.ok(report.includes("| Check | Status | Value |"));
  assert.ok(report.includes("|-------|--------|-------|"));
});

// ---------------------------------------------------------------------------
// generatePerformanceReport tests
// ---------------------------------------------------------------------------

test("generatePerformanceReport: returns a non-empty string", () => {
  const mc = createCollector();
  const report = generatePerformanceReport(mc);
  assert.ok(typeof report === "string");
  assert.ok(report.length > 100);
});

test("generatePerformanceReport: includes response times and throughput", () => {
  const mc = createCollector();
  const report = generatePerformanceReport(mc);

  assert.ok(report.includes("PERFORMANCE REPORT"));
  assert.ok(report.includes("Response Times"));
  assert.ok(report.includes("Bottleneck Analysis"));
  assert.ok(report.includes("System Metrics"));
  assert.ok(report.includes("Throughput"));
});

test("generatePerformanceReport: detects bottlenecks when applicable", () => {
  const mc = createCollector({
    toolMetrics: {
      tools: { slow: 10 },
      totalExecutions: 10,
      totalErrors: 0,
      durations: [2500],
    },
    agentMetrics: {
      totalTurns: 10,
      avgResponseTimeMs: 6000,
      errorRate: 0.05,
    },
    systemMetrics: {
      uptimeMs: 3600000,
      memory: { usedMB: 950, totalMB: 1024, usagePercent: 93 },
      cpu: { usagePercent: 88, loadAvg1m: 3, loadAvg5m: 2.5, loadAvg15m: 2 },
    },
  });
  const report = generatePerformanceReport(mc);
  assert.ok(report.includes("1 second") || report.includes("1000ms") || report.includes("2.5s") || report.includes("slow"));
  assert.ok(report.includes("5 seconds") || report.includes("6000ms") || report.includes("6.0s"));
});

test("generatePerformanceReport: renders in markdown mode", () => {
  const mc = createCollector();
  const report = generatePerformanceReport(mc, { markdown: true });

  assert.ok(report.includes("## PERFORMANCE REPORT"));
  assert.ok(report.includes("- "));
});

// ---------------------------------------------------------------------------
// generateCostReport tests
// ---------------------------------------------------------------------------

test("generateCostReport: returns a non-empty string", () => {
  const mc = createCollector();
  const report = generateCostReport(mc);
  assert.ok(typeof report === "string");
  assert.ok(report.length > 100);
});

test("generateCostReport: includes cost breakdown by provider", () => {
  const mc = createCollector();
  const report = generateCostReport(mc);

  assert.ok(report.includes("COST ANALYSIS REPORT"));
  assert.ok(report.includes("Cost Summary"));
  assert.ok(report.includes("Token Breakdown"));
  assert.ok(report.includes("claude-sonnet"));
  assert.ok(report.includes("claude-opus"));
  assert.ok(report.includes("1.8000") || report.includes("$1.80"));
  assert.ok(report.includes("Projections"));
});

test("generateCostReport: shows optimization tips for high cost", () => {
  const mc = createCollector({
    tokenMetrics: {
      totalInputTokens: 5000000,
      totalOutputTokens: 1500000,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      avgTokensPerTurn: 25000,
      costEstimate: {
        total: 250,
        breakdown: { "claude-opus": 200, "claude-sonnet": 50 },
      },
    },
  });
  const report = generateCostReport(mc);
  assert.ok(report.includes("Optimization Tips") || report.includes("caching"));
});

test("generateCostReport: renders in markdown mode", () => {
  const mc = createCollector();
  const report = generateCostReport(mc, { markdown: true });

  assert.ok(report.includes("## COST ANALYSIS REPORT"));
  assert.ok(report.includes("| Provider/Model | Cost |"));
});
