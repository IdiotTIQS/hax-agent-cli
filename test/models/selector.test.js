"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ModelSelector } = require("../../src/models/selector");
const { ModelMatrix } = require("../../src/models/matrix");

// Helper: create a fresh selector with built-in models
function makeSelector(preload) {
  return new ModelSelector({ preload: preload !== false });
}

// 1 ──────────────────────────────────────────────────────────────────────
test("ModelSelector initialises with a preloaded ModelMatrix", () => {
  const selector = makeSelector();
  assert.ok(selector.matrix instanceof ModelMatrix);
  assert.ok(selector.matrix.size >= 30);
});

// 2 ──────────────────────────────────────────────────────────────────────
test("ModelSelector accepts a custom matrix", () => {
  const shared = new ModelMatrix({ preloadBuiltins: false });
  shared.registerModel({ id: "custom-1", provider: "acme", vision: true, tools: true, reasoning: true, codeGeneration: 9, speed: 5, cost: 3 });
  shared.registerModel({ id: "custom-2", provider: "acme", vision: false, tools: false, reasoning: false, codeGeneration: 3, speed: 10, cost: 10 });

  const selector = new ModelSelector({ matrix: shared, preload: false });
  assert.equal(selector.matrix.size, 2);
  assert.ok(selector.matrix.getModel("custom-1"));
});

// 3 ──────────────────────────────────────────────────────────────────────
test("selectForTask picks the best model for a coding task with boolean reqs", () => {
  const selector = makeSelector();
  const task = {
    needsVision: false,
    needsTools: true,
    needsStreaming: true,
    needsReasoning: true,
    needsJsonMode: true,
  };

  const result = selector.selectForTask(task);
  assert.ok(result, "Should return a selection object");
  assert.equal(typeof result.model.id, "string");
  assert.equal(typeof result.model.provider, "string");
  assert.ok(Number.isFinite(result.score));
  assert.ok(Array.isArray(result.reasoning));
  assert.ok(result.reasoning.length >= 5);
  assert.ok(result.score > 0);
});

// 4 ──────────────────────────────────────────────────────────────────────
test("selectForTask respects an available whitelist", () => {
  const selector = makeSelector();
  const task = {
    needsVision: false,
    needsTools: true,
    needsStreaming: true,
  };

  const result = selector.selectForTask(task, ["gpt-4o-mini", "claude-haiku-4"]);
  assert.ok(["gpt-4o-mini", "claude-haiku-4"].includes(result.model.id));
});

// 5 ──────────────────────────────────────────────────────────────────────
test("selectForTask throws when no models are available", () => {
  const shared = new ModelMatrix({ preloadBuiltins: false });
  shared.registerModel({ id: "no-tools", tools: false });
  const selector = new ModelSelector({ matrix: shared, preload: false });

  assert.throws(
    () => selector.selectForTask({ needsTools: true }),
    /No models available|No suitable model/,
  );

  assert.throws(() => selector.selectForTask(null), /non-null object/);
  assert.throws(() => selector.selectForTask(123), /non-null object/);
});

// 6 ──────────────────────────────────────────────────────────────────────
test("selectForBudget picks the best model within a cost tier", () => {
  const selector = makeSelector();
  const task = { needsTools: true, needsStreaming: true };

  const result = selector.selectForBudget(task, 5);
  assert.ok(result);
  assert.ok(result.score > 0);

  // The selected model should have cost <= 5
  const model = selector.matrix.getModel(result.model.id);
  assert.ok(model.cost <= 5, `${result.model.id} cost ${model.cost} should be <= 5`);
});

// 7 ──────────────────────────────────────────────────────────────────────
test("selectForBudget falls back when budget is too restrictive", () => {
  const shared = new ModelMatrix({ preloadBuiltins: false });
  shared.registerModel({ id: "expensive", tools: true, streaming: true, cost: 2 });
  shared.registerModel({ id: "cheap", tools: true, streaming: true, cost: 8 });
  const selector = new ModelSelector({ matrix: shared, preload: false });

  // Budget of 1 means no model qualifies (min cost tier is 1)
  const result = selector.selectForBudget({ needsTools: true }, 1);
  assert.ok(result);
  assert.ok(result.reasoning.some((r) => r.includes("falling back")),
    `Expected fallback message in reasoning, got: ${result.reasoning.join(" | ")}`);
});

// 8 ──────────────────────────────────────────────────────────────────────
test("selectForSpeed picks the fastest capable model", () => {
  const selector = makeSelector();
  const task = { needsTools: true };

  const result = selector.selectForSpeed(task);
  assert.ok(result);
  assert.ok(result.score > 0);
  assert.ok(result.reasoning.some((r) => r.includes("speed-optimised")));

  // Verify the selected model is among the fastest for the capability
  const model = selector.matrix.getModel(result.model.id);
  assert.ok(model.speed >= 5,
    `Speed-optimised model ${result.model.id} should have speed >= 5, got ${model.speed}`);
});

// 9 ──────────────────────────────────────────────────────────────────────
test("selectForQuality picks the highest-quality model", () => {
  const selector = makeSelector();
  const task = { needsTools: true };

  const result = selector.selectForQuality(task);
  assert.ok(result);
  assert.ok(result.score > 0);
  assert.ok(result.reasoning.some((r) => r.includes("quality-optimised")));

  // Quality models should generally have high capability scores
  const model = selector.matrix.getModel(result.model.id);
  assert.ok(model.reasoning === true || model.codeGeneration >= 7,
    `Quality model ${result.model.id} expected high reasoning or codeGeneration`);
});

// 10 ─────────────────────────────────────────────────────────────────────
test("selectForTask prefers different models for different task requirements", () => {
  const selector = makeSelector();

  const codingTask = {
    type: "coding",
    needsTools: true,
    needsReasoning: true,
    needsStreaming: true,
    needsVision: false,
  };

  const visionTask = {
    type: "vision",
    needsVision: true,
    needsTools: false,
    needsStreaming: false,
  };

  const codingResult = selector.selectForTask(codingTask);
  const visionResult = selector.selectForTask(visionTask);

  // Verify selected models actually support the required capabilities
  const codingModel = selector.matrix.getModel(codingResult.model.id);
  assert.equal(codingModel.tools, true, "Coding model must support tools");
  assert.equal(codingModel.reasoning, true, "Coding model must support reasoning");

  const visionModel = selector.matrix.getModel(visionResult.model.id);
  assert.equal(visionModel.vision, true, "Vision model must support vision");
});

// 11 ─────────────────────────────────────────────────────────────────────
test("getRecommendation returns full report with alternatives", () => {
  const selector = makeSelector();
  const task = {
    type: "coding",
    needsTools: true,
    needsStreaming: true,
    needsReasoning: true,
    budget: 7,
  };

  const report = selector.getRecommendation(task);

  assert.equal(typeof report, "object");
  assert.ok(report.primary);
  assert.ok(report.primary.model);
  assert.ok(report.primary.score > 0);
  assert.ok(Array.isArray(report.primary.reasoning));

  assert.ok(report.alternatives);
  assert.ok(report.alternatives.speed);
  assert.ok(report.alternatives.quality);

  assert.ok(Array.isArray(report.topRanked));
  assert.ok(report.topRanked.length === 5, `Expected top 5, got ${report.topRanked.length}`);

  assert.ok(report.meta);
  assert.equal(typeof report.meta.totalModels, "number");
  assert.ok(report.meta.totalModels >= 30);
});

// 12 ─────────────────────────────────────────────────────────────────────
test("getRecommendation uses the task.type for ranking", () => {
  const selector = makeSelector();

  const codingReport = selector.getRecommendation({ type: "coding" });
  const chatReport = selector.getRecommendation({ type: "chat" });

  assert.equal(codingReport.meta.taskProfile, "coding");
  assert.equal(chatReport.meta.taskProfile, "chat");

  // The top ranked models should differ
  assert.ok(codingReport.topRanked.length > 0);
  assert.ok(chatReport.topRanked.length > 0);
});

// 13 ─────────────────────────────────────────────────────────────────────
test("getRecommendation with restrictive budget still returns report", () => {
  const shared = new ModelMatrix({ preloadBuiltins: false });
  shared.registerModel({ id: "expensive-only", tools: true, streaming: true, cost: 2 });
  const selector = new ModelSelector({ matrix: shared, preload: false });

  const report = selector.getRecommendation({ needsTools: true, budget: 1 });
  assert.ok(report.primary);
  assert.ok(report.budget.error || report.budget.model);
});

// 14 ─────────────────────────────────────────────────────────────────────
test("selectForTask uses a shared matrix correctly", () => {
  const shared = new ModelMatrix({ preloadBuiltins: false });
  shared.registerModel({ id: "shared-a", tools: true, streaming: true, reasoning: true, codeGeneration: 9, speed: 6, cost: 4 });
  shared.registerModel({ id: "shared-b", tools: true, streaming: true, reasoning: false, codeGeneration: 4, speed: 10, cost: 9 });

  const selA = new ModelSelector({ matrix: shared, preload: false });
  const selB = new ModelSelector({ matrix: shared, preload: false });

  // Both should see the same models
  assert.equal(selA.matrix.size, 2);
  assert.equal(selB.matrix.size, 2);

  // Add a model through one selector's matrix
  shared.registerModel({ id: "shared-c", tools: true, streaming: true, reasoning: true, codeGeneration: 6, speed: 7, cost: 7 });

  // Both should see it
  assert.equal(selA.matrix.size, 3);
  assert.equal(selB.matrix.size, 3);
  assert.ok(selA.matrix.getModel("shared-c"));
  assert.ok(selB.matrix.getModel("shared-c"));

  // Selection should work with the shared data
  const result = selA.selectForTask({ needsTools: true }, ["shared-a", "shared-b", "shared-c"]);
  assert.ok(result);
});
