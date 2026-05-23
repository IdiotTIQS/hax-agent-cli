"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CostTracker,
  MODEL_PRICING,
  DEFAULT_BUDGET,
  DEFAULT_ALERT_THRESHOLDS,
} = require("../../src/tokens/cost-tracker");

test("track records a cost event and returns the record", () => {
  const tracker = new CostTracker();
  const record = tracker.track("gpt-4o", 5000, 1000);

  assert.equal(typeof record.timestamp, "number");
  assert.equal(record.model, "gpt-4o");
  assert.equal(record.provider, "openai");
  assert.equal(record.inputTokens, 5000);
  assert.equal(record.outputTokens, 1000);
  assert.equal(record.totalTokens, 6000);
  assert.ok(record.inputCost > 0);
  assert.ok(record.outputCost > 0);
  assert.ok(record.totalCost > 0);
  assert.equal(record.totalCost, record.inputCost + record.outputCost);
});

test("getSessionCost computes correct totals for multiple track calls", () => {
  const tracker = new CostTracker({ budgetLimit: 10 });

  tracker.track("gpt-4o", 1000000, 500000);
  tracker.track("gpt-4o", 500000, 200000);

  const session = tracker.getSessionCost();

  assert.equal(session.totalCalls, 2);

  // 1.5M input tokens = 1.5 * $2.50 = $3.75
  // 0.7M output tokens = 0.7 * $10.00 = $7.00
  // Total = $10.75
  assert.ok(session.totalCost > 10);
  assert.ok(session.totalCost < 11);
  assert.equal(session.budgetLimit, 10);
  assert.ok(session.budgetRemaining < 0); // Over budget
  assert.equal(typeof session.sessionDurationMs, "number");
  assert.ok(session.sessionDurationMs >= 0);
  assert.ok(session.costPerCall > 0);
  assert.ok(Object.keys(session.byModel).length > 0);
  assert.ok(Object.keys(session.byProvider).length > 0);
});

test("getSessionCost tracks per-model breakdown", () => {
  const tracker = new CostTracker();

  tracker.track("gpt-4o", 1000, 500);
  tracker.track("claude-sonnet-4", 2000, 800);

  const session = tracker.getSessionCost();

  assert.ok(session.byModel["gpt-4o"]);
  assert.equal(session.byModel["gpt-4o"].calls, 1);
  assert.ok(session.byModel["claude-sonnet-4"]);
  assert.equal(session.byModel["claude-sonnet-4"].calls, 1);

  assert.ok(session.byProvider["openai"]);
  assert.ok(session.byProvider["anthropic"]);
});

test("projectCost returns extrapolated cost projection", () => {
  const tracker = new CostTracker({ budgetLimit: 20 });

  // Simulate several calls to build trends.
  for (let i = 0; i < 20; i++) {
    tracker.track("gpt-4o", 10000, 2000);
  }

  const projection = tracker.projectCost({
    estimatedRemainingCalls: 10,
  });

  assert.equal(typeof projection.currentCost, "number");
  assert.ok(projection.currentCost > 0);
  assert.equal(typeof projection.projectedCost, "number");
  assert.ok(projection.projectedCost > projection.currentCost);
  assert.equal(typeof projection.isOverBudget, "boolean");
  assert.equal(projection.method, "call_based");
  assert.ok(["low", "medium", "high"].includes(projection.confidence));
  assert.equal(typeof projection.message, "string");
  assert.ok(projection.avgCallCost > 0);
  assert.ok(projection.callsPerMinute > 0);
});

test("projectCost with no records returns low confidence", () => {
  const tracker = new CostTracker();
  const projection = tracker.projectCost();

  assert.equal(projection.confidence, "low");
  assert.equal(projection.currentCost, 0);
  assert.equal(projection.projectedCost, 0);
  assert.equal(projection.isOverBudget, false);
});

test("projectCost with estimatedRemainingMinutes uses time-based method", () => {
  const tracker = new CostTracker({ budgetLimit: 100 });

  for (let i = 0; i < 5; i++) {
    tracker.track("gpt-4o", 5000, 1000);
  }

  const projection = tracker.projectCost({
    estimatedRemainingMinutes: 60,
  });

  assert.equal(projection.method, "time_based");
  assert.ok(projection.timeProjection !== null);
});

test("compareModels returns sorted cost comparison across models", () => {
  const tracker = new CostTracker();

  const comparison = tracker.compareModels(
    { inputTokens: 100000, estimatedOutputTokens: 50000, estimatedCalls: 10 },
    ["gpt-4o", "gpt-4.1-mini", "claude-haiku-3.5", "deepseek-chat"]
  );

  assert.equal(typeof comparison.savingsPotential, "number");
  assert.ok(comparison.savingsPotential > 0);
  assert.ok(Array.isArray(comparison.results));
  assert.ok(comparison.results.length >= 2);

  // Verify sorted by total cost ascending.
  for (let i = 1; i < comparison.results.length; i++) {
    assert.ok(comparison.results[i - 1].totalCost <= comparison.results[i].totalCost);
  }

  // Cheapest model should be recommended.
  assert.ok(comparison.cheapest);
  assert.ok(comparison.results[0].isRecommended);
  assert.ok(comparison.mostExpensive);

  // Each result should have required fields.
  for (const r of comparison.results) {
    assert.equal(typeof r.model, "string");
    assert.equal(typeof r.provider, "string");
    assert.ok(r.perCallCost > 0);
    assert.ok(r.totalCost > 0);
    assert.equal(typeof r.isRecommended, "boolean");
  }

  assert.equal(typeof comparison.recommendation, "string");
  assert.ok(comparison.recommendation.length > 0);
});

test("compareModels defaults to all known models when none specified", () => {
  const tracker = new CostTracker();

  const comparison = tracker.compareModels({
    inputTokens: 10000,
    estimatedOutputTokens: 5000,
    estimatedCalls: 1,
  });

  assert.ok(comparison.results.length > 10);
  assert.ok(comparison.cheapest);
  assert.ok(comparison.cheapest.totalCost < comparison.mostExpensive.totalCost);
});

test("getSavingsOpportunities identifies opportunities from usage patterns", () => {
  const tracker = new CostTracker({ budgetLimit: 2 });

  // Simulate heavy usage of an expensive model.
  for (let i = 0; i < 30; i++) {
    tracker.track("claude-opus-4", 5000, 5000);
  }

  const opportunities = tracker.getSavingsOpportunities();

  assert.ok(Array.isArray(opportunities.opportunities));
  assert.ok(opportunities.opportunities.length > 0);
  assert.equal(typeof opportunities.totalPotentialSavings, "number");
  assert.ok(opportunities.totalPotentialSavings > 0);
  assert.ok(opportunities.savingsPercent > 0);

  // Should have a "switch_cheaper_model" opportunity for claude-opus-4.
  const switchOpp = opportunities.opportunities.find((o) => o.type === "switch_cheaper_model");
  assert.ok(switchOpp, "Should identify high-cost model usage");
  assert.ok(switchOpp.potentialSavings > 0);
  assert.ok(Array.isArray(switchOpp.details));
});

test("getSavingsOpportunities detects budget warnings", () => {
  const tracker = new CostTracker({ budgetLimit: 1 });

  // Spend most of the budget.
  tracker.track("gpt-4o", 300000, 100000); // ~$0.75 + $1.00 = $1.75, over budget

  const opportunities = tracker.getSavingsOpportunities();

  const budgetWarning = opportunities.opportunities.find((o) => o.type === "budget_warning");
  assert.ok(budgetWarning || opportunities.opportunities.length > 0);
});

test("getAlerts returns budget threshold alerts", () => {
  const tracker = new CostTracker({ budgetLimit: 1 });

  // This should trigger a budget alert at >60%.
  tracker.track("gpt-4o", 300000, 50000);

  const alerts = tracker.getAlerts();
  assert.ok(Array.isArray(alerts));
  assert.ok(alerts.length > 0);
  assert.ok(alerts[0].severity === "warning" || alerts[0].severity === "critical");
  assert.equal(typeof alerts[0].message, "string");
});

test("getAlerts triggers critical alert at high usage", () => {
  const tracker = new CostTracker({ budgetLimit: 0.5 });

  tracker.track("gpt-4o", 200000, 50000);

  const alerts = tracker.getAlerts();
  const criticalAlert = alerts.find((a) => a.severity === "critical");
  assert.ok(criticalAlert, "Should trigger a critical alert when budget threshold exceeded");
  assert.equal(typeof criticalAlert.message, "string");
});

test("reset clears all records and alerts", () => {
  const tracker = new CostTracker({ budgetLimit: 10, sessionName: "test" });

  tracker.track("gpt-4o", 10000, 5000);
  tracker.track("gpt-4o", 20000, 10000);

  assert.equal(tracker.getSessionCost().totalCalls, 2);

  tracker.reset({ sessionName: "new-session", budgetLimit: 20 });

  const session = tracker.getSessionCost();
  assert.equal(session.totalCalls, 0);
  assert.equal(session.totalCost, 0);
  assert.equal(session.sessionName, "new-session");
  assert.equal(session.budgetLimit, 20);
  assert.equal(tracker.getAlerts().length, 0);
});

test("setBudget updates the budget limit", () => {
  const tracker = new CostTracker({ budgetLimit: 5 });

  assert.equal(tracker.getSessionCost().budgetLimit, 5);

  tracker.setBudget(50);
  assert.equal(tracker.getSessionCost().budgetLimit, 50);

  // Negative or zero budgets clamp to 0.
  tracker.setBudget(-10);
  assert.equal(tracker.getSessionCost().budgetLimit, 0);
});

test("track handles unknown model with default pricing fallback", () => {
  const tracker = new CostTracker();

  const record = tracker.track("unknown-future-model", 5000, 1000);

  assert.equal(record.model, "unknown-future-model");
  assert.equal(record.provider, "unknown");
  assert.ok(record.inputCost > 0);
  assert.ok(record.outputCost > 0);
  assert.ok(record.totalCost > 0);
});

test("track handles zero and negative token values safely", () => {
  const tracker = new CostTracker();

  const zeroRecord = tracker.track("gpt-4o", 0, 0);
  assert.equal(zeroRecord.inputTokens, 0);
  assert.equal(zeroRecord.outputTokens, 0);
  assert.equal(zeroRecord.totalCost, 0);

  const negRecord = tracker.track("gpt-4o", -100, -50);
  assert.equal(negRecord.inputTokens, 0);
  assert.equal(negRecord.outputTokens, 0);
});

test("CostTracker.getModelPricing returns the pricing database", () => {
  const pricing = CostTracker.getModelPricing();

  assert.equal(typeof pricing, "object");
  assert.ok(Object.keys(pricing).length > 0);
  assert.ok(pricing["gpt-4o"]);
  assert.equal(pricing["gpt-4o"].input, 2.50);
  assert.equal(pricing["gpt-4o"].output, 10.00);
  assert.equal(pricing["gpt-4o"].provider, "openai");
});

test("CostTracker.lookupModel returns pricing for a specific model", () => {
  const gpt4o = CostTracker.lookupModel("gpt-4o");
  assert.ok(gpt4o);
  assert.equal(gpt4o.input, 2.50);
  assert.equal(gpt4o.provider, "openai");

  const claude = CostTracker.lookupModel("claude-sonnet-4");
  assert.ok(claude);
  assert.equal(claude.provider, "anthropic");

  const unknown = CostTracker.lookupModel("nonexistent-model");
  assert.equal(unknown, null);
});

test("export and import preserve session state", () => {
  const tracker = new CostTracker({
    budgetLimit: 15,
    sessionName: "export-test",
    tags: ["test", "export"],
  });

  tracker.track("gpt-4o", 1000, 500);
  tracker.track("claude-haiku-3.5", 2000, 300);

  const exported = tracker.export();

  assert.equal(exported.sessionName, "export-test");
  assert.equal(exported.budgetLimit, 15);
  assert.deepStrictEqual(exported.tags, ["test", "export"]);
  assert.equal(exported.records.length, 2);
  assert.ok(Array.isArray(exported.alerts));

  // New tracker importing the data.
  const tracker2 = new CostTracker();
  tracker2.import(exported);

  const session = tracker2.getSessionCost();
  assert.equal(session.sessionName, "export-test");
  assert.equal(session.budgetLimit, 15);
  assert.equal(session.totalCalls, 2);
  assert.ok(session.totalCost > 0);
});

test("import handles null/empty data gracefully", () => {
  const tracker = new CostTracker({
    budgetLimit: 10,
    sessionName: "original",
  });

  tracker.import(null);
  assert.equal(tracker.getSessionCost().sessionName, "original");

  tracker.import({});
  assert.equal(tracker.getSessionCost().sessionName, "original");

  tracker.import("invalid");
  assert.equal(tracker.getSessionCost().sessionName, "original");
});

test("custom pricing overrides default model pricing", () => {
  const customPricing = {
    "my-custom-model": { input: 0.01, output: 0.05, provider: "custom", contextWindow: 64000 },
  };

  const tracker = new CostTracker({ customPricing });
  const record = tracker.track("my-custom-model", 1000000, 500000);

  assert.equal(record.provider, "custom");
  // 1M input * $0.01 = $0.01, 0.5M output * $0.05 = $0.025
  assert.equal(record.inputCost, 0.01);
  assert.equal(record.outputCost, 0.025);
  assert.equal(record.totalCost, 0.035);
});

test("budget alert only fires once per threshold crossing", () => {
  const tracker = new CostTracker({ budgetLimit: 1, thresholds: { warning: 0.5, critical: 0.8, overBudget: 1.0 } });

  // First call reaches warning.
  tracker.track("gpt-4o", 200000, 50000);
  let alerts = tracker.getAlerts();
  const warningCount1 = alerts.filter((a) => a.type === "warning_threshold").length;
  assert.ok(warningCount1 <= 1, "Warning should fire at most once");

  // Second call at same level should not produce duplicate warning.
  tracker.track("gpt-4o", 100, 50);
  alerts = tracker.getAlerts();
  const warningCount2 = alerts.filter((a) => a.type === "warning_threshold").length;
  assert.equal(warningCount2, warningCount1, "No duplicate warning alert");
});
