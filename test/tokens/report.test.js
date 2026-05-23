"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { TokenReport } = require("../../src/tokens/report");

// ---- helpers ----
function makeSession(overrides = {}) {
  return {
    sessionName: "test-session",
    totalCost: 3.5,
    totalInputCost: 2.0,
    totalOutputCost: 1.5,
    totalTokens: 15000,
    totalInputTokens: 10000,
    totalOutputTokens: 5000,
    totalCalls: 8,
    budgetLimit: 10,
    budgetRemaining: 6.5,
    budgetUsedPercent: 35,
    sessionDurationMs: 600000,
    sessionDurationMinutes: 10,
    costPerMinute: 0.35,
    costPerCall: 0.4375,
    alerts: 0,
    byModel: {
      "gpt-4o": { model: "gpt-4o", provider: "openai", calls: 5, totalTokens: 10000, totalCost: 2.5 },
      "claude-haiku-3.5": { model: "claude-haiku-3.5", provider: "anthropic", calls: 3, totalTokens: 5000, totalCost: 1.0 },
    },
    byProvider: {
      openai: { provider: "openai", calls: 5, totalTokens: 10000, totalCost: 2.5 },
      anthropic: { provider: "anthropic", calls: 3, totalTokens: 5000, totalCost: 1.0 },
    },
    ...overrides,
  };
}

function makeHistory(size, baseCost) {
  const history = [];
  for (let i = 0; i < size; i++) {
    history.push({
      date: `2026-05-${String(i + 1).padStart(2, "0")}`,
      cost: (baseCost || 5) + i * 0.1,
      tokens: 5000 + i * 100,
      calls: 10 + i,
    });
  }
  return history;
}

// ---------------------------------------------------------------------------
// generateUsageReport
// ---------------------------------------------------------------------------

test("generateUsageReport produces text, markdown, and json exports", () => {
  const report = new TokenReport();
  const session = makeSession();
  const result = report.generateUsageReport(session);

  assert.ok(typeof result.text === "string");
  assert.ok(typeof result.markdown === "string");
  assert.ok(typeof result.json === "string");

  // Text should contain key fields.
  assert.ok(result.text.includes("test-session"));
  assert.ok(result.text.includes("$3.5000"));
  assert.ok(result.text.includes("15.0K"));
  assert.ok(result.text.includes("10.0 min"));

  // Markdown should contain markdown formatting.
  assert.ok(result.markdown.includes("## Per-Session Usage Report"));
  assert.ok(result.markdown.includes("**Session:**"));
  assert.ok(result.markdown.includes("| Model |"));

  // JSON should be parseable.
  const parsed = JSON.parse(result.json);
  assert.equal(parsed.sessionName, "test-session");
  assert.equal(parsed.totalCost, 3.5);
});

test("generateUsageReport handles empty/minimal session", () => {
  const report = new TokenReport();
  const result = report.generateUsageReport(null);

  assert.ok(typeof result.text === "string");
  assert.ok(result.text.length > 0);
  assert.ok(typeof result.markdown === "string");
  assert.ok(typeof result.json === "string");
});

test("generateUsageReport includes model breakdown table when models present", () => {
  const report = new TokenReport();
  const session = makeSession();
  const result = report.generateUsageReport(session);

  assert.ok(result.text.includes("gpt-4o"));
  assert.ok(result.text.includes("claude-haiku-3.5"));
  assert.ok(result.text.includes("Model"));
  assert.ok(result.text.includes("Provider"));
  assert.ok(result.text.includes("Calls"));
});

// ---------------------------------------------------------------------------
// generateCostReport
// ---------------------------------------------------------------------------

test("generateCostReport aggregates across multiple sessions", () => {
  const report = new TokenReport();
  const sessions = [
    makeSession({ sessionName: "s1", totalCost: 3.5, totalTokens: 15000, totalCalls: 8 }),
    makeSession({ sessionName: "s2", totalCost: 5.0, totalTokens: 25000, totalCalls: 12 }),
    makeSession({ sessionName: "s3", totalCost: 1.5, totalTokens: 8000, totalCalls: 5 }),
  ];

  const result = report.generateCostReport(sessions);

  assert.ok(typeof result.text === "string");
  assert.ok(typeof result.markdown === "string");
  assert.ok(typeof result.json === "string");

  // Summary fields.
  assert.ok(result.summary);
  assert.equal(result.summary.sessionCount, 3);
  assert.equal(result.summary.totalCost, 10.0);
  assert.equal(result.summary.totalTokens, 48000);
  assert.equal(result.summary.totalCalls, 25);

  // Text contains session breakdown.
  assert.ok(result.text.includes("s1"));
  assert.ok(result.text.includes("s2"));
  assert.ok(result.text.includes("s3"));
  assert.ok(result.text.includes("Total Cost"));
  assert.ok(result.text.includes("$10.0000"));

  // Markdown has tables.
  assert.ok(result.markdown.includes("## Session Breakdown"));
  assert.ok(result.markdown.includes("## Model Breakdown"));
  assert.ok(result.markdown.includes("## Provider Breakdown"));
});

test("generateCostReport handles empty sessions array", () => {
  const report = new TokenReport();
  const result = report.generateCostReport([]);

  assert.ok(typeof result.text === "string");
  assert.ok(result.text.includes("No session data"));
  assert.equal(result.summary, null);
});

test("generateCostReport handles null/undefined input", () => {
  const report = new TokenReport();
  const result = report.generateCostReport(null);

  assert.ok(typeof result.text === "string");
  assert.ok(result.text.includes("No session data"));
});

// ---------------------------------------------------------------------------
// generateEfficiencyReport
// ---------------------------------------------------------------------------

test("generateEfficiencyReport computes efficiency metrics", () => {
  const report = new TokenReport();
  const sessions = [
    makeSession({ sessionName: "efficient-session", totalInputTokens: 10000, totalOutputTokens: 3000 }),
    makeSession({ sessionName: "inefficient-session", totalInputTokens: 5000, totalOutputTokens: 10000 }),
  ];

  const result = report.generateEfficiencyReport(sessions);

  assert.ok(result.summary);
  assert.ok(typeof result.summary.avgOutputInputRatio === "number");
  assert.ok(typeof result.summary.efficiencyScore === "string");
  assert.ok(result.summary.inefficientCount >= 0);
  assert.ok(result.summary.efficientCount >= 0);

  // Text should highlight inefficient and efficient sessions.
  assert.ok(result.text.includes("Efficiency"));
  assert.ok(result.text.includes("O/I Ratio"));

  // Markdown formatting.
  assert.ok(result.markdown.includes("## Efficiency Analysis Report"));
});

test("generateEfficiencyReport handles empty input", () => {
  const report = new TokenReport();
  const result = report.generateEfficiencyReport([]);

  assert.ok(result.text.includes("No session data"));
  assert.equal(result.summary, null);
});

test("generateEfficiencyReport efficiency score reflects ratio", () => {
  const report = new TokenReport();

  // All output-heavy sessions (poor).
  const poor = [
    makeSession({ sessionName: "a", totalInputTokens: 1000, totalOutputTokens: 3000 }),
    makeSession({ sessionName: "b", totalInputTokens: 1000, totalOutputTokens: 2500 }),
  ];
  const r1 = report.generateEfficiencyReport(poor);
  assert.ok(r1.summary.efficiencyScore === "Poor" || r1.summary.efficiencyScore === "Needs Improvement");

  // All input-heavy sessions (good).
  const good = [
    makeSession({ sessionName: "a", totalInputTokens: 5000, totalOutputTokens: 1000 }),
    makeSession({ sessionName: "b", totalInputTokens: 5000, totalOutputTokens: 500 }),
  ];
  const r2 = report.generateEfficiencyReport(good);
  assert.ok(r2.summary.efficiencyScore === "Good" || r2.summary.efficiencyScore === "Fair");
});

// ---------------------------------------------------------------------------
// generateForecast
// ---------------------------------------------------------------------------

test("generateForecast projects cost and usage forward", () => {
  const report = new TokenReport();
  const history = makeHistory(14, 2.0); // 14 days, starting at $2/day
  const result = report.generateForecast(history, 30);

  assert.ok(result.summary);
  assert.equal(result.summary.historyDays, 14);
  assert.equal(result.summary.forecastDays, 30);
  assert.ok(typeof result.summary.avgDailyCost === "number");
  assert.ok(result.summary.avgDailyCost > 0);
  assert.ok(typeof result.summary.projectedCost === "number");
  assert.ok(result.summary.projectedCost > result.summary.avgDailyCost);
  assert.equal(typeof result.summary.costTrend, "string");
  assert.ok(["increasing", "decreasing", "stable"].includes(result.summary.costTrend));

  // Text should have forecast table.
  assert.ok(result.text.includes("Forecast"));
  assert.ok(result.text.includes("Projected Cost"));

  // Markdown should have headings.
  assert.ok(result.markdown.includes("## Cost & Usage Forecast"));
});

test("generateForecast handles flat history (no trend)", () => {
  const report = new TokenReport();
  const history = [];
  for (let i = 0; i < 7; i++) {
    history.push({ date: `2026-05-${String(i + 1).padStart(2, "0")}`, cost: 5.0, tokens: 10000, calls: 10 });
  }
  const result = report.generateForecast(history, 30);

  assert.equal(result.summary.costTrend, "stable");
  // Flat cost should result in projected = avg * days.
  assert.ok(Math.abs(result.summary.projectedCost - 150.0) < 1);
});

test("generateForecast handles small forecast window", () => {
  const report = new TokenReport();
  const history = makeHistory(10, 3.0);
  const result = report.generateForecast(history, 1);

  assert.equal(result.summary.forecastDays, 1);
  assert.ok(result.summary.projectedCost > 0);
});

test("generateForecast handles empty history", () => {
  const report = new TokenReport();
  const result = report.generateForecast([], 30);

  assert.ok(result.text.includes("No history data"));
  assert.equal(result.summary, null);
});

test("generateForecast handles null/undefined history", () => {
  const report = new TokenReport();
  const result = report.generateForecast(null, 30);

  assert.ok(result.text.includes("No history data"));
});

test("generateForecast handles non-numeric days parameter", () => {
  const report = new TokenReport();
  const history = makeHistory(5, 1.0);
  const result = report.generateForecast(history, "invalid");
  // Should default to 30 days.
  assert.equal(result.summary.forecastDays, 30);
});

test("generateForecast csv/json/text export consistency", () => {
  const report = new TokenReport();
  const history = makeHistory(5, 1.0);
  const result = report.generateForecast(history, 7);

  // JSON parseable.
  const json = JSON.parse(result.json);
  assert.equal(json.historyDays, 5);
  assert.equal(json.forecastDays, 7);
  assert.ok(typeof json.projectedCost === "number");

  // Text and markdown are distinct.
  assert.notEqual(result.text, result.markdown);
  assert.ok(result.markdown.includes("|"));
});
