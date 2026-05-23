"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MetricsCollector } = require("../../src/dashboard/collector");

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockToolSource() {
  return {
    tools: {
      "file.read": 150,
      "file.edit": 80,
      "shell.run": 45,
      "file.write": 30,
      "web.search": 20,
    },
    totalExecutions: 325,
    totalErrors: 12,
    durations: [120, 340, 90, 560, 210, 75, 890, 150, 300, 95, 410],
  };
}

function mockSessionSource() {
  const now = Date.now();
  return {
    sessions: [
      { timestamp: new Date(now - 7 * 86400000).toISOString(), turns: 5, cost: 0.15, totalTokens: 4500 },
      { timestamp: new Date(now - 6 * 86400000).toISOString(), turns: 8, cost: 0.28, totalTokens: 8200 },
      { timestamp: new Date(now - 5 * 86400000).toISOString(), turns: 3, cost: 0.09, totalTokens: 2800 },
      { timestamp: new Date(now - 4 * 86400000).toISOString(), turns: 12, cost: 0.42, totalTokens: 12300 },
      { timestamp: new Date(now - 3 * 86400000).toISOString(), turns: 6, cost: 0.2, totalTokens: 6100 },
      { timestamp: new Date(now - 2 * 86400000).toISOString(), turns: 10, cost: 0.35, totalTokens: 10100 },
      { timestamp: new Date(now - 1 * 86400000).toISOString(), turns: 4, cost: 0.12, totalTokens: 3700 },
    ],
  };
}

function mockSystemSource() {
  return {
    uptimeMs: 3600000, // 1 hour
    memory: { usedMB: 512, totalMB: 1024, usagePercent: 50 },
    cpu: { usagePercent: 35, loadAvg1m: 1.2, loadAvg5m: 0.9, loadAvg15m: 0.7 },
    timestamp: new Date().toISOString(),
  };
}

function mockTokenSource() {
  return {
    totalInputTokens: 50000,
    totalOutputTokens: 15000,
    totalCacheCreationTokens: 3000,
    totalCacheReadTokens: 12000,
    avgTokensPerTurn: 2500,
    costEstimate: {
      total: 2.45,
      breakdown: { "claude-sonnet": 1.8, "claude-opus": 0.65 },
    },
  };
}

function mockAgentSource() {
  return {
    totalTurns: 48,
    avgResponseTimeMs: 3200,
    errorRate: 0.02,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("MetricsCollector: registers a source by name", () => {
  const mc = new MetricsCollector();
  const src = mockToolSource();
  mc.registerSource("toolMetrics", src);
  // No error thrown — registration succeeded
  assert.ok(true);
});

test("MetricsCollector: throws on invalid source name", () => {
  const mc = new MetricsCollector();
  assert.throws(() => mc.registerSource("", { data: 1 }), TypeError);
  assert.throws(() => mc.registerSource(null, { data: 1 }), TypeError);
});

test("MetricsCollector: throws on null/undefined source", () => {
  const mc = new MetricsCollector();
  assert.throws(() => mc.registerSource("test", null), TypeError);
  assert.throws(() => mc.registerSource("test", undefined), TypeError);
});

test("MetricsCollector: collect() returns data from all registered sources", () => {
  const mc = new MetricsCollector();
  mc.registerSource("toolMetrics", mockToolSource());
  mc.registerSource("systemMetrics", mockSystemSource());

  const result = mc.collect();
  assert.ok(result.toolMetrics);
  assert.ok(result.systemMetrics);
  assert.equal(result.toolMetrics.totalExecutions, 325);
  assert.equal(result.systemMetrics.uptimeMs, 3600000);
});

test("MetricsCollector: collect() handles source errors gracefully", () => {
  const mc = new MetricsCollector();
  const badSource = {
    collect() {
      throw new Error("Source unavailable");
    },
  };
  mc.registerSource("badSource", badSource);
  mc.registerSource("goodSource", { value: 42 });

  const result = mc.collect();
  assert.ok(result.badSource.error);
  assert.ok(result.badSource.error.includes("Source unavailable"));
  assert.equal(result.goodSource.value, 42);
});

test("MetricsCollector: getSnapshot() returns full aggregated snapshot", () => {
  const mc = new MetricsCollector();
  mc.registerSource("toolMetrics", mockToolSource());
  mc.registerSource("sessionMetrics", mockSessionSource());
  mc.registerSource("systemMetrics", mockSystemSource());
  mc.registerSource("tokenMetrics", mockTokenSource());
  mc.registerSource("agentMetrics", mockAgentSource());

  const snap = mc.getSnapshot();

  // Top-level keys
  assert.ok(snap.timestamp);
  assert.ok(snap.health);
  assert.ok(snap.tools);
  assert.ok(snap.sessions);
  assert.ok(snap.system);
  assert.ok(snap.tokens);
  assert.ok(snap.agent);

  // Health
  assert.ok(snap.health.overall);
  assert.ok(Array.isArray(snap.health.checks));
  assert.ok(snap.health.checks.length >= 4);
});

test("MetricsCollector: getSnapshot() health is 'pass' when all checks OK", () => {
  const mc = new MetricsCollector();
  mc.registerSource("toolMetrics", {
    tools: { "file.read": 100 },
    totalExecutions: 100,
    totalErrors: 0,
    durations: [100],
  });
  mc.registerSource("systemMetrics", {
    uptimeMs: 3600000,
    memory: { usedMB: 100, totalMB: 1024, usagePercent: 10 },
    cpu: { usagePercent: 10, loadAvg1m: 0.1, loadAvg5m: 0.1, loadAvg15m: 0.1 },
  });

  const snap = mc.getSnapshot();
  assert.equal(snap.health.overall, "pass");
});

test("MetricsCollector: getSnapshot() health is 'fail' when critical checks fail", () => {
  const mc = new MetricsCollector();
  mc.registerSource("toolMetrics", {
    tools: { "file.read": 10 },
    totalExecutions: 100,
    totalErrors: 85,
    durations: [100],
  });
  mc.registerSource("systemMetrics", {
    uptimeMs: 0,
    memory: { usedMB: 1000, totalMB: 1024, usagePercent: 97 },
    cpu: { usagePercent: 95, loadAvg1m: 5, loadAvg5m: 4, loadAvg15m: 3 },
  });

  const snap = mc.getSnapshot();
  assert.equal(snap.health.overall, "fail");
});

test("MetricsCollector: collectToolMetrics computes success rate and duration stats", () => {
  const mc = new MetricsCollector();
  const toolMetrics = mockToolSource();
  const result = mc.collectToolMetrics(toolMetrics);

  assert.equal(result.totalExecutions, 325);
  assert.equal(result.totalErrors, 12);
  assert.equal(result.successCount, 313);
  assert.ok(result.successRate > 95);
  assert.ok(result.errorRate < 5);
  assert.ok(result.avgDurationMs > 0);
  assert.ok(result.minDurationMs > 0);
  assert.ok(result.maxDurationMs > result.minDurationMs);
  assert.equal(result.topTools.length, 5); // Only 5 tools in mock, all in top 10
  assert.equal(result.topTools[0].name, "file.read");
});

test("MetricsCollector: collectSessionMetrics computes sessions per day", () => {
  const mc = new MetricsCollector();
  const sessionMetrics = mockSessionSource();
  const result = mc.collectSessionMetrics(sessionMetrics);

  assert.equal(result.totalSessions, 7);
  assert.ok(result.sessionsPerDay > 0, `Expected sessionsPerDay > 0, got ${result.sessionsPerDay}`);
  assert.ok(result.avgTurnsPerSession > 0);
  assert.ok(result.maxTurns > 0);
  assert.ok(result.avgCostPerSession > 0);
  assert.ok(result.totalCost > 0);
  assert.ok(result.totalTokens > 0);
});

test("MetricsCollector: collectSystemMetrics handles uptime normalization", () => {
  const mc = new MetricsCollector();
  const result = mc.collectSystemMetrics(mockSystemSource());

  assert.equal(result.uptimeMs, 3600000);
  assert.equal(result.uptimeHours, 1);
  assert.equal(result.memory.usedMB, 512);
  assert.equal(result.memory.usagePercent, 50);
  assert.equal(result.cpu.usagePercent, 35);
});

test("MetricsCollector: collectSystemMetrics handles alternative field names", () => {
  const mc = new MetricsCollector();
  const result = mc.collectSystemMetrics({
    uptime: 10, // in seconds
    memory: { rss: 256, heapTotal: 512 },
    cpu: { utilization: 20 },
  });

  assert.equal(result.uptimeMs, 10000);
  assert.equal(result.memory.usedMB, 256);
  assert.equal(result.memory.totalMB, 512);
  assert.equal(result.cpu.usagePercent, 20);
});

test("MetricsCollector: getSnapshot handles missing sources", () => {
  const mc = new MetricsCollector();
  // Register nothing
  const snap = mc.getSnapshot();

  assert.equal(snap.tools.totalExecutions, 0);
  assert.equal(snap.sessions.totalSessions, 0);
  assert.equal(snap.system.uptimeMs, 0);
  assert.equal(snap.tokens.totalTokens, 0);
  assert.ok(snap.health.overall); // Should still compute
});

test("MetricsCollector: registerSource replaces existing source with same name", () => {
  const mc = new MetricsCollector();
  mc.registerSource("toolMetrics", { tools: { a: 1 } });
  mc.registerSource("toolMetrics", { tools: { b: 2 }, totalExecutions: 42 });

  const result = mc.collect();
  assert.equal(result.toolMetrics.totalExecutions, 42);
  assert.equal(result.toolMetrics.tools.b, 2);
  assert.strictEqual(result.toolMetrics.tools.a, undefined);
});

test("MetricsCollector: getSnapshot uses source.collect() when available", () => {
  const mc = new MetricsCollector();
  mc.registerSource("dynamicSource", {
    _counter: 0,
    collect() {
      this._counter += 1;
      return { counter: this._counter };
    },
  });

  const snap1 = mc.collect();
  assert.equal(snap1.dynamicSource.counter, 1);

  const snap2 = mc.collect();
  assert.equal(snap2.dynamicSource.counter, 2);
});
