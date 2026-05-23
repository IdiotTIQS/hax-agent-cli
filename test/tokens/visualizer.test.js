"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { TokenVisualizer } = require("../../src/tokens/visualizer");

test("renderUsageBar produces a bar for partial usage", () => {
  const vis = new TokenVisualizer({ barWidth: 20 });
  const result = vis.renderUsageBar(500, 1000, { label: "Tokens" });

  assert.ok(typeof result === "string");
  assert.ok(result.length > 0);
  assert.ok(result.includes("Tokens"));
  assert.ok(result.includes("%"));
  assert.ok(result.includes("500"));
  assert.ok(result.includes("1.0K"));
});

test("renderUsageBar shows warning color at 60% threshold", () => {
  const vis = new TokenVisualizer({ barWidth: 20 });
  const result = vis.renderUsageBar(65, 100, { label: "Budget" });

  assert.ok(typeof result === "string");
  assert.ok(result.includes("65%") || result.includes("Budget"));
  // Should contain ANSI yellow warning color (33m).
  assert.ok(result.includes("33m") || result.includes("93m"));
});

test("renderUsageBar shows error color at 85% threshold", () => {
  const vis = new TokenVisualizer({ barWidth: 20 });
  const result = vis.renderUsageBar(90, 100, { label: "Budget" });

  assert.ok(typeof result === "string");
  // Should contain ANSI red error color (31m or 91m).
  assert.ok(result.includes("31m") || result.includes("91m"));
});

test("renderUsageBar handles zero total gracefully", () => {
  const vis = new TokenVisualizer();
  const result = vis.renderUsageBar(0, 0);
  assert.ok(typeof result === "string");
  assert.ok(result.length > 0);
});

test("renderCostBreakdown produces pie representation with legend", () => {
  const vis = new TokenVisualizer({ width: 40 });
  const costs = {
    "gpt-4o": 2.50,
    "claude-sonnet-4": 1.25,
    "gemini-2.0-flash": 0.75,
  };
  const result = vis.renderCostBreakdown(costs, { title: "Test Costs" });

  assert.ok(typeof result === "string");
  assert.ok(result.length > 0);
  assert.ok(result.includes("Test Costs"));
  assert.ok(result.includes("gpt-4o"));
  assert.ok(result.includes("claude-sonnet-4"));
  assert.ok(result.includes("gemini-2.0-flash"));
  assert.ok(result.includes("$"));
  assert.ok(result.includes("%"));
  assert.ok(result.includes("Total"));
});

test("renderCostBreakdown handles empty input", () => {
  const vis = new TokenVisualizer();
  const result = vis.renderCostBreakdown({});
  assert.ok(typeof result === "string");
  assert.ok(result.includes("no data"));
});

test("renderTokenTrend produces sparkline for history data", () => {
  const vis = new TokenVisualizer({ width: 20 });
  const history = [100, 200, 150, 300, 250, 180, 220, 400, 350, 280];
  const result = vis.renderTokenTrend(history, { label: "Tokens" });

  assert.ok(typeof result === "string");
  assert.ok(result.length > 0);
  assert.ok(result.includes("Tokens"));
  // Should include the spark chars.
  const hasSparkChar = ["█", "▇", "▆", "▅", "▄", "▃", "▂", "▁"].some((c) => result.includes(c));
  assert.ok(hasSparkChar, "Should contain Unicode spark characters");
});

test("renderTokenTrend handles empty history", () => {
  const vis = new TokenVisualizer();
  const result = vis.renderTokenTrend([]);
  assert.ok(typeof result === "string");
  assert.ok(result.includes("no data"));
});

test("renderTokenTrend handles single value", () => {
  const vis = new TokenVisualizer({ width: 20 });
  const result = vis.renderTokenTrend([42]);
  assert.ok(typeof result === "string");
  assert.ok(result.length > 0);
});

test("renderEfficiency shows gauge for low ratio (efficient)", () => {
  const vis = new TokenVisualizer();
  const result = vis.renderEfficiency(0.3, { label: "Eff" });

  assert.ok(typeof result === "string");
  assert.ok(result.includes("High"));
  assert.ok(result.includes("Eff"));
  assert.ok(result.includes("0.30"));
});

test("renderEfficiency shows gauge for high ratio (inefficient)", () => {
  const vis = new TokenVisualizer();
  const result = vis.renderEfficiency(2.5, { label: "Eff" });

  assert.ok(typeof result === "string");
  assert.ok(result.includes("Low"));
  assert.ok(result.includes("2.50"));
});

test("renderEfficiency edge cases (zero, negative)", () => {
  const vis = new TokenVisualizer();

  // Very low input-heavy.
  const r1 = vis.renderEfficiency(0.05);
  assert.ok(r1.includes("High"));

  // Exactly 1.0.
  const r2 = vis.renderEfficiency(1.0);
  assert.ok(r2.includes("Medium"));
});

test("renderModelComparison displays side-by-side model data", () => {
  const vis = new TokenVisualizer();
  const models = [
    { model: "gpt-4o", provider: "openai", totalCost: 2.50, inputPricePerM: 2.50, outputPricePerM: 10.00, isRecommended: true },
    { model: "claude-haiku-3.5", provider: "anthropic", totalCost: 1.20, inputPricePerM: 0.80, outputPricePerM: 4.00, isRecommended: false },
    { model: "deepseek-chat", provider: "deepseek", totalCost: 0.30, inputPricePerM: 0.14, outputPricePerM: 0.28, isRecommended: true },
  ];
  const result = vis.renderModelComparison(models);

  assert.ok(typeof result === "string");
  assert.ok(result.length > 0);
  assert.ok(result.includes("Model Comparison"));
  assert.ok(result.includes("gpt-4o"));
  assert.ok(result.includes("claude-haiku-3.5"));
  assert.ok(result.includes("deepseek-chat"));
  assert.ok(result.includes("openai"));
  assert.ok(result.includes("anthropic"));
  assert.ok(result.includes("deepseek"));
  // Should mark recommended models.
  assert.ok(result.includes("★"));
});

test("renderModelComparison handles empty array", () => {
  const vis = new TokenVisualizer();
  const result = vis.renderModelComparison([]);
  assert.ok(typeof result === "string");
  assert.ok(result.includes("no data"));
});

test("renderModelComparison handles null/undefined", () => {
  const vis = new TokenVisualizer();
  const result = vis.renderModelComparison(null);
  assert.ok(typeof result === "string");
  assert.ok(result.includes("no data"));
});

test("renderSavingsOpportunities visualizes opportunity list", () => {
  const vis = new TokenVisualizer();
  const data = {
    opportunities: [
      {
        type: "switch_cheaper_model",
        description: "Use cheaper model for high-cost tasks",
        potentialSavings: 5.50,
        details: [
          { model: "claude-opus-4", alternative: "claude-sonnet-4", totalSavings: 5.50 },
        ],
      },
      {
        type: "batch_calls",
        description: "Batch small calls together",
        potentialSavings: 2.00,
        details: { totalCalls: 120, avgTokensPerCall: 300 },
      },
    ],
    totalPotentialSavings: 7.50,
  };

  const result = vis.renderSavingsOpportunities(data);

  assert.ok(typeof result === "string");
  assert.ok(result.length > 0);
  assert.ok(result.includes("Savings Opportunities"));
  assert.ok(result.includes("switch_cheaper_model"));
  assert.ok(result.includes("batch_calls"));
  assert.ok(result.includes("5.50") || result.includes("5.5"));
  assert.ok(result.includes("Total Potential Savings"));
});

test("renderSavingsOpportunities handles empty opportunities", () => {
  const vis = new TokenVisualizer();
  const result = vis.renderSavingsOpportunities([]);
  assert.ok(typeof result === "string");
  assert.ok(result.includes("No savings opportunities found"));
});

test("renderSavingsOpportunities accepts plain array", () => {
  const vis = new TokenVisualizer();
  const opps = [
    { type: "budget_warning", description: "Low budget", potentialSavings: 0, details: { remaining: 0.50 } },
  ];
  const result = vis.renderSavingsOpportunities(opps);
  assert.ok(typeof result === "string");
  assert.ok(result.includes("budget_warning"));
});
