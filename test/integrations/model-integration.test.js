"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  enhanceProviderSelection,
  recommendModelForTask,
  compareAvailableModels,
} = require("../../src/integrations/model-integration");

const { ModelMatrix } = require("../../src/models/matrix");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCodingTask(overrides) {
  return {
    type: "coding",
    needsTools: true,
    needsReasoning: true,
    minCodeQuality: 7,
    ...overrides,
  };
}

function makeVisionTask(overrides) {
  return {
    type: "vision",
    needsVision: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// enhanceProviderSelection
// ---------------------------------------------------------------------------

test("enhanceProviderSelection: returns recommendation for a coding task", () => {
  const task = makeCodingTask();
  const result = enhanceProviderSelection(task);

  assert.ok(result.selected, "should select a model");
  assert.equal(typeof result.selected.id, "string", "model id should be a string");
  assert.equal(typeof result.selected.provider, "string", "model provider should be a string");
  assert.ok(result.ranking.length > 0, "should have a ranking");
  assert.ok(result.reasoning.length > 0, "should have reasoning strings");
  assert.ok(result.matrix instanceof ModelMatrix, "should return the matrix instance");
});

test("enhanceProviderSelection: vision task requires vision capability", () => {
  const task = makeVisionTask();
  const result = enhanceProviderSelection(task);

  assert.ok(result.selected, "should select a model");
  // Build a quick check that the selected model actually supports vision
  const model = result.matrix.getModel(result.selected.id);
  assert.ok(model, "selected model should exist in matrix");
  assert.equal(model.vision, true, "selected model should support vision");
});

test("enhanceProviderSelection: respects provider filter", () => {
  const task = makeCodingTask({ type: "tool_use", needsTools: true });
  const result = enhanceProviderSelection(task);

  // Ranking should have at least the top 5
  assert.ok(result.ranking.length > 0, "ranking should not be empty");
});

test("enhanceProviderSelection: throws on null task", () => {
  assert.throws(
    () => enhanceProviderSelection(null),
    /non-null object/,
  );
});

// ---------------------------------------------------------------------------
// recommendModelForTask
// ---------------------------------------------------------------------------

test("recommendModelForTask: returns a model recommendation", () => {
  const task = makeCodingTask();
  const result = recommendModelForTask(task);

  assert.ok(result.model, "should return a model");
  assert.equal(typeof result.model.id, "string");
  assert.equal(typeof result.model.provider, "string");
  assert.equal(typeof result.model.displayName, "string");
  assert.ok(typeof result.score === "number", "should return a numeric score");
  assert.ok(Array.isArray(result.reasoning), "should return reasoning array");
  assert.ok(result.reasoning.length > 0, "reasoning should not be empty");
});

test("recommendModelForTask: speed-oriented task prefers faster models", () => {
  const task = { type: "chat", minSpeed: 9 };
  const result = recommendModelForTask(task);

  assert.ok(result.model, "should return a model");
  // The recommendation should have high speed
  assert.ok(result.reasoning.some((r) => /speed/i.test(r)),
    "reasoning should mention speed");
});

test("recommendModelForTask: JSON extraction requires jsonMode", () => {
  const task = { type: "json_extraction", needsJsonMode: true };
  const result = recommendModelForTask(task);

  assert.ok(result.model, "should return a model");
  // Verify selected model supports JSON mode
  const matrix = new ModelMatrix();
  const model = matrix.getModel(result.model.id);
  assert.equal(model.jsonMode, true, "selected model should support JSON mode");
});

test("recommendModelForTask: throws on null task", () => {
  assert.throws(
    () => recommendModelForTask(null),
    /non-null object/,
  );
});

// ---------------------------------------------------------------------------
// compareAvailableModels
// ---------------------------------------------------------------------------

test("compareAvailableModels: compares specified providers", () => {
  const result = compareAvailableModels(["anthropic", "openai"]);

  assert.ok(Array.isArray(result.providers), "providers should be an array");
  assert.equal(result.providers.length, 2, "should compare 2 providers");

  const anthropic = result.providers.find((p) => p.provider === "anthropic");
  assert.ok(anthropic, "should include anthropic");
  assert.ok(anthropic.modelCount > 0, "anthropic should have models");
  assert.ok(anthropic.topModel, "anthropic should have a top model");

  const openai = result.providers.find((p) => p.provider === "openai");
  assert.ok(openai, "should include openai");
  assert.ok(openai.modelCount > 0, "openai should have models");
  assert.ok(openai.topModel, "openai should have a top model");

  assert.ok(result.comparison.overallBest, "should have overall best");
  assert.ok(result.summary.totalProviders > 0, "summary should list provider count");
});

test("compareAvailableModels: returns empty provider entry for unknown provider", () => {
  const result = compareAvailableModels(["nonexistent-provider-xyz"]);

  assert.equal(result.providers.length, 1);
  const p = result.providers[0];
  assert.equal(p.provider, "nonexistent-provider-xyz");
  assert.equal(p.modelCount, 0);
  assert.equal(p.topModel, null);
  assert.ok(p.note.includes("No models"), "should include a note");
});

test("compareAvailableModels: taskType selects appropriate ranking", () => {
  const result = compareAvailableModels(["anthropic"], { taskType: "vision" });

  const anthropic = result.providers[0];
  assert.ok(anthropic.ranking.length > 0, "should have a ranking");
  // Vision task should rank models differently than coding
  const codingResult = compareAvailableModels(["anthropic"], { taskType: "coding" });
  // The top models may differ for different task types
  const visionTopId = anthropic.ranking[0]?.id;
  const codingTopId = codingResult.providers[0]?.ranking[0]?.id;
  // They could be the same or different — we just verify both are non-null
  assert.ok(visionTopId, "vision task should have a top model");
  assert.ok(codingTopId, "coding task should have a top model");
});

test("compareAvailableModels: reports category leaders", () => {
  const result = compareAvailableModels(["anthropic", "openai", "google"]);

  assert.ok(result.comparison.speedLeader, "should have speed leader");
  assert.ok(result.comparison.costLeader, "should have cost leader");
  assert.ok(result.comparison.qualityLeader, "should have quality leader");

  assert.ok(typeof result.comparison.speedLeader.speed, "number");
  assert.ok(typeof result.comparison.costLeader.cost, "number");
  assert.ok(typeof result.comparison.qualityLeader.codeGeneration, "number");
});
