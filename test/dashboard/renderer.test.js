"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DashboardRenderer,
  barChart,
  sparkline,
  healthIcon,
} = require("../../src/dashboard/renderer");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripAnsi(str) {
  return str.replace(/\x1B\[\d*(;\d+)*m/g, "");
}

function mockSnapshot(overrides) {
  return {
    timestamp: new Date().toISOString(),
    health: {
      overall: "pass",
      checks: [
        { name: "tool_success_rate", label: "Tool Success Rate", status: "pass", value: "96.31%" },
        { name: "tool_error_rate", label: "Tool Error Rate", status: "pass", value: "3.69%" },
        { name: "memory_usage", label: "Memory Usage", status: "pass", value: "50%" },
        { name: "cpu_usage", label: "CPU Usage", status: "warn", value: "82%" },
        { name: "uptime", label: "Uptime", status: "pass", value: "24h" },
      ],
    },
    tools: {
      totalExecutions: 325,
      totalErrors: 12,
      successCount: 313,
      successRate: 96.31,
      errorRate: 3.69,
      avgDurationMs: 275,
      minDurationMs: 75,
      maxDurationMs: 890,
      topTools: [
        { name: "file.read", count: 150 },
        { name: "file.edit", count: 80 },
        { name: "shell.run", count: 45 },
        { name: "file.write", count: 30 },
        { name: "web.search", count: 20 },
      ],
    },
    sessions: {
      totalSessions: 42,
      sessionsPerDay: 6,
      avgTurnsPerSession: 7.5,
      maxTurns: 15,
      avgCostPerSession: 0.23,
      totalCost: 9.66,
      totalTokens: 245000,
      avgTokensPerSession: 5833,
      turnsHistory: [3, 5, 8, 6, 10, 4, 7, 9, 5, 8, 6, 4],
    },
    system: {
      uptimeMs: 86400000,
      uptimeHours: 24,
      memory: { usedMB: 512, totalMB: 1024, usagePercent: 50 },
      cpu: { usagePercent: 35, loadAvg1m: 1.2, loadAvg5m: 0.9, loadAvg15m: 0.7 },
      timestamp: new Date().toISOString(),
    },
    tokens: {
      totalInput: 50000,
      totalOutput: 15000,
      totalCacheCreation: 3000,
      totalCacheRead: 12000,
      totalTokens: 68000,
      avgTokensPerTurn: 2500,
      costEstimate: {
        total: 2.45,
        breakdown: { "claude-sonnet": 1.8, "claude-opus": 0.65 },
      },
    },
    agent: {
      totalTurns: 48,
      avgResponseTimeMs: 3200,
      errorRate: 0.02,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// barChart tests
// ---------------------------------------------------------------------------

test("barChart: renders filled/unfilled characters", () => {
  const result = barChart(50, 100, 10);
  assert.ok(result.includes("█"));
  assert.ok(result.includes("─"));
});

test("barChart: full bar at 100%", () => {
  const result = barChart(100, 100, 10);
  const stripped = stripAnsi(result);
  assert.ok(stripped.includes("─".repeat(10)) || stripped.includes("█".repeat(10)));
});

test("barChart: empty bar at 0 value or 0 max", () => {
  const r1 = barChart(0, 100, 10);
  const r2 = barChart(50, 0, 10);
  assert.ok(r1.includes("─"));
  assert.ok(r2.includes("─"));
});

// ---------------------------------------------------------------------------
// sparkline tests
// ---------------------------------------------------------------------------

test("sparkline: renders spark characters from values", () => {
  const result = sparkline([1, 2, 3, 4, 5, 6, 7, 8], 8);
  const stripped = stripAnsi(result);
  assert.ok(stripped.length >= 8);
});

test("sparkline: handles empty array", () => {
  const result = sparkline([], 10);
  assert.ok(result.includes("─"));
});

test("sparkline: handles single value", () => {
  const result = sparkline([5], 4);
  assert.ok(result.length > 0);
});

// ---------------------------------------------------------------------------
// healthIcon tests
// ---------------------------------------------------------------------------

test("healthIcon: returns correct symbols for each status", () => {
  assert.ok(stripAnsi(healthIcon("pass")).includes("✓"));
  assert.ok(stripAnsi(healthIcon("warn")).includes("⚠"));
  assert.ok(stripAnsi(healthIcon("fail")).includes("✗"));
});

// ---------------------------------------------------------------------------
// DashboardRenderer tests
// ---------------------------------------------------------------------------

test("DashboardRenderer: renderOverview returns non-empty string", () => {
  const renderer = new DashboardRenderer();
  const snap = mockSnapshot();
  const output = renderer.renderOverview(snap);
  assert.ok(typeof output === "string");
  assert.ok(output.length > 100);
});

test("DashboardRenderer: renderOverview includes all sections", () => {
  const renderer = new DashboardRenderer();
  const snap = mockSnapshot();
  const output = renderer.renderOverview(snap);

  const stripped = stripAnsi(output);
  assert.ok(stripped.includes("HAXAGENT METRICS DASHBOARD"));
  assert.ok(stripped.includes("TOOL USAGE"));
  assert.ok(stripped.includes("SESSION STATS"));
  assert.ok(stripped.includes("TOKEN USAGE"));
  assert.ok(stripped.includes("SYSTEM HEALTH"));
  assert.ok(stripped.includes("AGENT PERFORMANCE"));
});

test("DashboardRenderer: renderToolSection shows tool stats", () => {
  const renderer = new DashboardRenderer();
  const metrics = mockSnapshot().tools;
  const output = renderer.renderToolSection(metrics);

  const stripped = stripAnsi(output);
  assert.ok(stripped.includes("325"));
  assert.ok(stripped.includes("313"));
  assert.ok(stripped.includes("96.31%"));
  assert.ok(stripped.includes("file.read"));
  assert.ok(stripped.includes("150"));
});

test("DashboardRenderer: renderToolSection handles empty metrics", () => {
  const renderer = new DashboardRenderer();
  const output = renderer.renderToolSection(null);
  assert.equal(output, "");
});

test("DashboardRenderer: renderSessionSection shows session stats with sparkline", () => {
  const renderer = new DashboardRenderer();
  const metrics = mockSnapshot().sessions;
  const output = renderer.renderSessionSection(metrics);

  const stripped = stripAnsi(output);
  assert.ok(stripped.includes("42"));
  assert.ok(stripped.includes("6/day"));
  assert.ok(stripped.includes("7.5"));
  assert.ok(stripped.includes("9.6600"));
  assert.ok(stripped.includes("245.0K"));
});

test("DashboardRenderer: renderSessionSection handles missing turnsHistory", () => {
  const renderer = new DashboardRenderer();
  const metrics = { totalSessions: 5, sessionsPerDay: 1, avgTurnsPerSession: 3, maxTurns: 5, totalCost: 1.0, avgCostPerSession: 0.2, totalTokens: 10000, avgTokensPerSession: 2000 };
  const output = renderer.renderSessionSection(metrics);
  const stripped = stripAnsi(output);
  assert.ok(stripped.includes("5"));
});

test("DashboardRenderer: renderHealthSection shows all checks", () => {
  const renderer = new DashboardRenderer();
  const snap = mockSnapshot();
  const output = renderer.renderHealthSection(snap.health, snap.system);

  const stripped = stripAnsi(output);
  assert.ok(stripped.includes("Tool Success Rate"));
  assert.ok(stripped.includes("Tool Error Rate"));
  assert.ok(stripped.includes("Memory Usage"));
  assert.ok(stripped.includes("CPU Usage"));
  assert.ok(stripped.includes("Uptime"));
  assert.ok(stripped.includes("24 hours"));
});

test("DashboardRenderer: renderHealthSection handles null inputs", () => {
  const renderer = new DashboardRenderer();
  assert.equal(renderer.renderHealthSection(null, null), "");
  assert.equal(renderer.renderHealthSection(null, {}), "");
});

test("DashboardRenderer: renderTokenSection shows token breakdown and cost", () => {
  const renderer = new DashboardRenderer();
  const metrics = mockSnapshot().tokens;
  const output = renderer.renderTokenSection(metrics);

  const stripped = stripAnsi(output);
  assert.ok(stripped.includes("50.0K"));
  assert.ok(stripped.includes("15.0K"));
  assert.ok(stripped.includes("3.0K"));
  assert.ok(stripped.includes("68.0K"));
  assert.ok(stripped.includes("2.4500"));
  assert.ok(stripped.includes("claude-sonnet"));
  assert.ok(stripped.includes("claude-opus"));
});

test("DashboardRenderer: renderTokenSection handles null metrics", () => {
  const renderer = new DashboardRenderer();
  assert.equal(renderer.renderTokenSection(null), "");
});
