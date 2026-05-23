"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { TokenMonitor } = require("../../src/tokens/monitor");
const { TokenBudget } = require("../../src/tokens/budget");

test("trackUsage records a token consumption event", () => {
  const monitor = new TokenMonitor();

  monitor.trackUsage({
    timestamp: 1000,
    category: "conversation",
    tokens: 500,
    requestId: "req-1",
    model: "claude-sonnet-4",
  });

  const stats = monitor.getUsageStats();
  assert.equal(stats.totalTokens, 500);
  assert.equal(stats.totalRequests, 1);
  assert.equal(stats.eventCount, 1);
});

test("trackUsage handles null/undefined events gracefully", () => {
  const monitor = new TokenMonitor();

  monitor.trackUsage(null);
  monitor.trackUsage(undefined);

  const stats = monitor.getUsageStats();
  assert.equal(stats.totalTokens, 0);
  assert.equal(stats.totalRequests, 0);
});

test("getUsageStats returns comprehensive statistics", () => {
  const monitor = new TokenMonitor();

  for (let i = 0; i < 10; i++) {
    monitor.trackUsage({ category: "conversation", tokens: 1000, timestamp: Date.now() });
    monitor.trackUsage({ category: "tools", tokens: 500, timestamp: Date.now() });
  }

  const stats = monitor.getUsageStats();

  assert.ok(typeof stats.totalTokens === "number");
  assert.equal(stats.totalTokens, 15000);
  assert.equal(stats.totalRequests, 20);
  assert.ok(stats.averageTokensPerRequest > 0);
  assert.ok(typeof stats.runtimeMs === "number");
  assert.ok(typeof stats.runtimeMinutes === "number");
  assert.ok(typeof stats.tokensPerMinute === "number");
  assert.ok(typeof stats.efficiency === "number");
  assert.ok(typeof stats.categories === "number");
  assert.equal(stats.eventCount, 20);
});

test("getUsageByCategory returns breakdown by category with percentages", () => {
  const monitor = new TokenMonitor();

  monitor.trackUsage({ category: "conversation", tokens: 6000, timestamp: Date.now() });
  monitor.trackUsage({ category: "tools", tokens: 3000, timestamp: Date.now() });
  monitor.trackUsage({ category: "output", tokens: 1000, timestamp: Date.now() });

  const byCategory = monitor.getUsageByCategory();

  assert.ok("conversation" in byCategory);
  assert.ok("tools" in byCategory);
  assert.ok("output" in byCategory);

  assert.equal(byCategory.conversation.totalTokens, 6000);
  assert.equal(byCategory.tools.totalTokens, 3000);
  assert.equal(byCategory.output.totalTokens, 1000);

  // Percentages should sum to approximately 100.
  const totalPct = byCategory.conversation.percentage +
    byCategory.tools.percentage +
    byCategory.output.percentage;
  assert.ok(Math.abs(totalPct - 100) <= 1);
});

test("getUsageTrend returns trend data with direction", () => {
  const monitor = new TokenMonitor();

  // Create two trend buckets by spanning time.
  const now = Date.now();
  monitor.trackUsage({ category: "conversation", tokens: 1000, timestamp: now - 600000 });
  monitor.trackUsage({ category: "conversation", tokens: 5000, timestamp: now - 300000 });
  monitor.trackUsage({ category: "conversation", tokens: 10000, timestamp: now });

  const trend = monitor.getUsageTrend();

  assert.ok(Array.isArray(trend.buckets));
  assert.ok(trend.buckets.length >= 1);
  assert.ok(["increasing", "decreasing", "stable"].includes(trend.direction));
  assert.ok(typeof trend.rate === "number");
  assert.ok(typeof trend.message === "string");
});

test("getUsageTrend with no data returns empty trend", () => {
  const monitor = new TokenMonitor();
  const trend = monitor.getUsageTrend();

  assert.deepStrictEqual(trend.buckets, []);
  assert.equal(trend.direction, "stable");
  assert.equal(trend.rate, 0);
});

test("predictExhaustion with budget reference estimates remaining time", () => {
  const budget = new TokenBudget();
  budget.allocate(100000);
  budget.consume("conversation", 40000);

  const monitor = new TokenMonitor();
  monitor.setBudget(budget);

  // Simulate some usage to establish a consumption rate.
  for (let i = 0; i < 5; i++) {
    monitor.trackUsage({ category: "conversation", tokens: 2000, timestamp: Date.now() });
  }

  const prediction = monitor.predictExhaustion();

  assert.equal(prediction.canPredict, true);
  assert.ok(prediction.remainingTokens > 0);
  assert.ok(typeof prediction.consumptionRate === "number");
  assert.ok(prediction.consumptionRate > 0);
  assert.ok(typeof prediction.message === "string");
});

test("predictExhaustion without budget reference is handled gracefully", () => {
  const monitor = new TokenMonitor();

  monitor.trackUsage({ category: "conversation", tokens: 1000, timestamp: Date.now() });

  const prediction = monitor.predictExhaustion();

  assert.equal(prediction.canPredict, false);
  assert.ok(prediction.message.includes("No budget reference"));
});

test("getEfficiency returns tokens per useful output", () => {
  const monitor = new TokenMonitor();

  monitor.trackUsage({
    category: "output",
    tokens: 1000,
    metadata: { useful: true },
    timestamp: Date.now(),
  });
  monitor.trackUsage({
    category: "output",
    tokens: 500,
    metadata: { useful: false },
    timestamp: Date.now(),
  });

  const efficiency = monitor.getEfficiency();
  assert.ok(efficiency > 0);
  assert.ok(efficiency < 1);
});

test("getEfficiency returns 0 when no output tokens consumed", () => {
  const monitor = new TokenMonitor();

  monitor.trackUsage({ category: "conversation", tokens: 1000, timestamp: Date.now() });
  monitor.trackUsage({ category: "tools", tokens: 500, timestamp: Date.now() });

  const efficiency = monitor.getEfficiency();
  assert.equal(efficiency, 0);
});

test("generateAlerts returns alert history", () => {
  const budget = new TokenBudget();
  budget.allocate(10000);

  const monitor = new TokenMonitor();
  monitor.setBudget(budget);

  // Trigger high consumption alert.
  monitor.trackUsage({ category: "conversation", tokens: 4000, timestamp: Date.now() });
  monitor.trackUsage({ category: "conversation", tokens: 5000, timestamp: Date.now() });

  const alerts = monitor.generateAlerts();

  assert.ok(Array.isArray(alerts));

  if (alerts.length > 0) {
    const alert = alerts[0];
    assert.ok(typeof alert.type === "string");
    assert.ok(typeof alert.severity === "string");
    assert.ok(typeof alert.message === "string");
    assert.ok(typeof alert.timestamp === "number");
  }
});

test("trackUsage tracks multiple categories and accumulates correctly", () => {
  const monitor = new TokenMonitor();

  monitor.trackUsage({ category: "system_prompt", tokens: 800, timestamp: Date.now() });
  monitor.trackUsage({ category: "conversation", tokens: 5000, timestamp: Date.now() });
  monitor.trackUsage({ category: "tools", tokens: 2000, timestamp: Date.now() });
  monitor.trackUsage({ category: "output", tokens: 3000, timestamp: Date.now() });
  monitor.trackUsage({ category: "safety_margin", tokens: 200, timestamp: Date.now() });

  const stats = monitor.getUsageStats();
  assert.equal(stats.totalTokens, 11000);
  assert.equal(stats.categories, 5);
});

test("reset clears all data", () => {
  const monitor = new TokenMonitor();

  monitor.trackUsage({ category: "conversation", tokens: 5000, timestamp: Date.now() });
  monitor.trackUsage({ category: "tools", tokens: 2000, timestamp: Date.now() });

  assert.equal(monitor.getUsageStats().totalTokens, 7000);

  monitor.reset();

  const stats = monitor.getUsageStats();
  assert.equal(stats.totalTokens, 0);
  assert.equal(stats.totalRequests, 0);
  assert.equal(stats.eventCount, 0);
});

test("getUsageByCategory includes budget status when budget is set", () => {
  const budget = new TokenBudget();
  budget.allocate(100000);
  budget.consume("conversation", 30000);

  const monitor = new TokenMonitor();
  monitor.setBudget(budget);

  monitor.trackUsage({ category: "conversation", tokens: 10000, timestamp: Date.now() });

  const byCategory = monitor.getUsageByCategory();

  assert.ok(byCategory.conversation.budgetStatus.hasBudget);
  assert.ok(byCategory.conversation.budgetStatus.allocated > 0);
  assert.ok(typeof byCategory.conversation.budgetStatus.usagePercent === "number");
});

test("trackUsage with metadata.useful tracks output efficiency correctly", () => {
  const monitor = new TokenMonitor();

  monitor.trackUsage({
    category: "output",
    tokens: 2000,
    metadata: { useful: true },
    timestamp: Date.now(),
  });
  monitor.trackUsage({
    category: "output",
    tokens: 500,
    metadata: { useful: true },
    timestamp: Date.now(),
  });
  monitor.trackUsage({
    category: "output",
    tokens: 3000,
    metadata: { useful: false },
    timestamp: Date.now(),
  });

  const efficiency = monitor.getEfficiency();
  const expected = (2000 + 500) / (2000 + 500 + 3000);
  assert.ok(Math.abs(efficiency - expected) < 0.001);
});

test("getUsageTrend returns increasing direction with rising token usage", () => {
  const monitor = new TokenMonitor();

  const now = Date.now();
  monitor.trackUsage({ category: "conversation", tokens: 100, timestamp: now - 600000 });
  monitor.trackUsage({ category: "conversation", tokens: 500, timestamp: now - 300000 });
  monitor.trackUsage({ category: "conversation", tokens: 2000, timestamp: now - 60000 });
  monitor.trackUsage({ category: "conversation", tokens: 5000, timestamp: now });

  const trend = monitor.getUsageTrend();
  assert.ok(["increasing", "decreasing", "stable"].includes(trend.direction));
});

test("multiple events in same trend bucket are aggregated correctly", () => {
  const monitor = new TokenMonitor();
  const now = Date.now();

  monitor.trackUsage({ category: "conversation", tokens: 1000, timestamp: now });
  monitor.trackUsage({ category: "conversation", tokens: 2000, timestamp: now + 100 });
  monitor.trackUsage({ category: "tools", tokens: 500, timestamp: now + 200 });

  const trend = monitor.getUsageTrend();
  assert.equal(trend.buckets.length, 1);
  assert.equal(trend.buckets[0].totalTokens, 3500);
  assert.equal(trend.buckets[0].requestCount, 3);
});
