"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ModelMatrix, BUILTIN_MODELS, TASK_PROFILES } = require("../../src/models/matrix");

// 1 ──────────────────────────────────────────────────────────────────────
test("ModelMatrix preloads 34 built-in models by default", () => {
  const matrix = new ModelMatrix();
  assert.ok(matrix.size >= 30, `Expected at least 30 models, got ${matrix.size}`);
  assert.equal(matrix.size, BUILTIN_MODELS.length);
});

// 2 ──────────────────────────────────────────────────────────────────────
test("ModelMatrix can be created without preloaded models", () => {
  const matrix = new ModelMatrix({ preloadBuiltins: false });
  assert.equal(matrix.size, 0);
});

// 3 ──────────────────────────────────────────────────────────────────────
test("registerModel adds a model and normalizes capabilities", () => {
  const matrix = new ModelMatrix({ preloadBuiltins: false });
  matrix.registerModel({
    id: "test-model",
    provider: "acme",
    vision: true,
    tools: false,
    codeGeneration: 8,
    speed: 9,
  });

  const model = matrix.getModel("test-model");
  assert.ok(model);
  assert.equal(model.id, "test-model");
  assert.equal(model.provider, "acme");
  assert.equal(model.vision, true);
  assert.equal(model.tools, false);
  assert.equal(model.codeGeneration, 8);
  assert.equal(model.speed, 9);
  // Defaults
  assert.equal(model.streaming, false);
  assert.equal(model.caching, false);
  assert.equal(model.maxTokens, 4096);
  assert.equal(model.cost, 5);
});

// 4 ──────────────────────────────────────────────────────────────────────
test("registerModel clamps numeric capabilities to 1–10", () => {
  const matrix = new ModelMatrix({ preloadBuiltins: false });

  matrix.registerModel({ id: "low", codeGeneration: -5, speed: 0 });
  assert.equal(matrix.getModel("low").codeGeneration, 1);
  assert.equal(matrix.getModel("low").speed, 1);

  matrix.registerModel({ id: "high", codeGeneration: 999, multilingual: 50 });
  assert.equal(matrix.getModel("high").codeGeneration, 10);
  assert.equal(matrix.getModel("high").multilingual, 10);
});

// 5 ──────────────────────────────────────────────────────────────────────
test("registerModel throws on invalid input", () => {
  const matrix = new ModelMatrix({ preloadBuiltins: false });

  assert.throws(() => matrix.registerModel(null), /non-null object/);
  assert.throws(() => matrix.registerModel(42), /non-null object/);
  assert.throws(() => matrix.registerModel({}), /non-empty string id/);
  assert.throws(() => matrix.registerModel({ id: "" }), /non-empty string id/);
});

// 6 ──────────────────────────────────────────────────────────────────────
test("bulkRegister registers multiple models at once", () => {
  const matrix = new ModelMatrix({ preloadBuiltins: false });
  matrix.bulkRegister([
    { id: "a", provider: "x" },
    { id: "b", provider: "y" },
    { id: "c", provider: "z" },
  ]);
  assert.equal(matrix.size, 3);
  assert.ok(matrix.getModel("a"));
  assert.ok(matrix.getModel("b"));
  assert.ok(matrix.getModel("c"));
});

test("bulkRegister throws on non-array", () => {
  const matrix = new ModelMatrix({ preloadBuiltins: false });
  assert.throws(() => matrix.bulkRegister("not-array"), /expects an array/);
});

// 7 ──────────────────────────────────────────────────────────────────────
test("getModel is case-insensitive and returns null for missing", () => {
  const matrix = new ModelMatrix({ preloadBuiltins: false });
  matrix.registerModel({ id: "Case-Sensitive", provider: "test" });

  assert.ok(matrix.getModel("case-sensitive"));
  assert.ok(matrix.getModel("CASE-SENSITIVE"));
  assert.ok(matrix.getModel("Case-Sensitive"));
  assert.equal(matrix.getModel("nonexistent"), null);
  assert.equal(matrix.getModel(""), null);
  assert.equal(matrix.getModel(null), null);
});

// 8 ──────────────────────────────────────────────────────────────────────
test("removeModel deletes by id and is case-insensitive", () => {
  const matrix = new ModelMatrix({ preloadBuiltins: false });
  matrix.registerModel({ id: "ToRemove", provider: "test" });
  assert.equal(matrix.size, 1);

  assert.equal(matrix.removeModel("toremove"), true);
  assert.equal(matrix.size, 0);
  assert.equal(matrix.removeModel("toremove"), false);
  assert.equal(matrix.removeModel(""), false);
});

// 9 ──────────────────────────────────────────────────────────────────────
test("listAll returns all registered models", () => {
  const matrix = new ModelMatrix({ preloadBuiltins: false });
  matrix.bulkRegister([
    { id: "m1" }, { id: "m2" }, { id: "m3" },
  ]);
  const all = matrix.listAll();
  assert.ok(Array.isArray(all));
  assert.equal(all.length, 3);
  const ids = all.map((m) => m.id).sort();
  assert.deepEqual(ids, ["m1", "m2", "m3"]);
});

// 10 ─────────────────────────────────────────────────────────────────────
test("query filters by boolean capabilities", () => {
  const matrix = new ModelMatrix();

  const visionModels = matrix.query({ vision: true });
  assert.ok(visionModels.length > 5, `Expected >5 vision models, got ${visionModels.length}`);
  for (const m of visionModels) {
    assert.equal(m.vision, true, `${m.id} should have vision`);
  }

  // query treats `false` as "don't care", so all models pass
  const noVision = matrix.query({ vision: false });
  assert.equal(noVision.length, matrix.size, "query with false boolean capability skips the filter");
});

// 11 ─────────────────────────────────────────────────────────────────────
test("query filters by provider", () => {
  const matrix = new ModelMatrix();

  const openai = matrix.query({ provider: "openai" });
  assert.ok(openai.length > 0);
  for (const m of openai) {
    assert.equal(m.provider, "openai");
  }

  const nonexistent = matrix.query({ provider: "nonexistent-corp" });
  assert.equal(nonexistent.length, 0);
});

// 12 ─────────────────────────────────────────────────────────────────────
test("query filters by numeric minimum thresholds", () => {
  const matrix = new ModelMatrix();

  const fast = matrix.query({ minSpeed: 8 });
  assert.ok(fast.length > 0);
  for (const m of fast) {
    assert.ok(m.speed >= 8, `${m.id} speed ${m.speed} should be >= 8`);
  }

  const cheap = matrix.query({ maxCost: 3 });
  assert.ok(cheap.length > 0);
  for (const m of cheap) {
    assert.ok(m.cost <= 3, `${m.id} cost ${m.cost} should be <= 3`);
  }

  const codeGen = matrix.query({ minCodeGeneration: 8 });
  assert.ok(codeGen.length > 0);
  for (const m of codeGen) {
    assert.ok(m.codeGeneration >= 8, `${m.id} codeGen ${m.codeGeneration} should be >= 8`);
  }
});

// 13 ─────────────────────────────────────────────────────────────────────
test("query respects exclusion list", () => {
  const matrix = new ModelMatrix();
  const all = matrix.listAll();
  const firstId = all[0].id;

  const filtered = matrix.query({ exclude: [firstId] });
  assert.ok(filtered.length > 0);
  assert.equal(filtered.find((m) => m.id === firstId), undefined);
});

// 14 ─────────────────────────────────────────────────────────────────────
test("query with multiple combined filters", () => {
  const matrix = new ModelMatrix();
  const results = matrix.query({
    vision: true,
    tools: true,
    streaming: true,
    minSpeed: 5,
    provider: "anthropic",
  });
  assert.ok(results.length > 0);
  assert.ok(results.length <= 10, "Combined filter should narrow results significantly");
  for (const m of results) {
    assert.equal(m.vision, true);
    assert.equal(m.tools, true);
    assert.equal(m.streaming, true);
    assert.ok(m.speed >= 5);
    assert.equal(m.provider, "anthropic");
  }
});

// 15 ─────────────────────────────────────────────────────────────────────
test("getCapabilities returns detailed breakdown", () => {
  const matrix = new ModelMatrix();
  const caps = matrix.getCapabilities("claude-sonnet-4");

  assert.ok(caps, "Should return capabilities for known model");
  assert.equal(caps.id, "claude-sonnet-4");
  assert.equal(caps.provider, "anthropic");
  assert.equal(typeof caps.displayName, "string");
  assert.equal(typeof caps.boolean, "object");
  assert.equal(typeof caps.numeric, "object");
  assert.equal(typeof caps.boolean.vision, "boolean");
  assert.ok(Number.isFinite(caps.numeric.maxTokens));
  assert.ok(Number.isFinite(caps.numeric.codeGeneration));
  assert.ok(Number.isFinite(caps.numeric.speed));
  assert.ok(Number.isFinite(caps.numeric.cost));

  assert.equal(matrix.getCapabilities("nonexistent"), null);
});

// 16 ─────────────────────────────────────────────────────────────────────
test("compare returns detailed comparison between two models", () => {
  const matrix = new ModelMatrix();
  const result = matrix.compare("claude-sonnet-4", "gpt-4o-mini");

  assert.ok(result);
  assert.equal(result.modelA.id, "claude-sonnet-4");
  assert.equal(result.modelB.id, "gpt-4o-mini");
  assert.ok(Array.isArray(result.booleanDifferences));
  assert.ok(result.booleanDifferences.length >= 7);
  assert.ok(Array.isArray(result.numericDifferences));
  assert.ok(result.numericDifferences.length >= 5);
  assert.equal(typeof result.summary.aWins, "number");
  assert.equal(typeof result.summary.bWins, "number");
  assert.equal(typeof result.summary.ties, "number");
  assert.ok(["A", "B", "tie"].includes(result.summary.betterForCoding));
  assert.ok(["A", "B", "tie"].includes(result.summary.betterForSpeed));
  assert.ok(["A", "B", "tie"].includes(result.summary.betterForCost));
});

// 17 ─────────────────────────────────────────────────────────────────────
test("compare throws for missing models", () => {
  const matrix = new ModelMatrix();
  assert.throws(() => matrix.compare("nonexistent-a", "claude-sonnet-4"), /Model not found/);
  assert.throws(() => matrix.compare("claude-sonnet-4", "nonexistent-b"), /Model not found/);
  assert.throws(() => matrix.compare("nonexistent-a", "nonexistent-b"), /Neither model found/);
});

// 18 ─────────────────────────────────────────────────────────────────────
test("rank returns models ordered by fitness for a valid task type", () => {
  const matrix = new ModelMatrix();
  const ranked = matrix.rank("coding");

  assert.ok(Array.isArray(ranked));
  assert.ok(ranked.length >= 10);
  // Verify descending order
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].score >= ranked[i].score,
      `Rank ${i - 1} (${ranked[i - 1].score}) should be >= rank ${i} (${ranked[i].score})`);
  }
  for (const entry of ranked) {
    assert.equal(typeof entry.id, "string");
    assert.ok(Number.isFinite(entry.score));
  }
});

// 19 ─────────────────────────────────────────────────────────────────────
test("rank works with a custom model list", () => {
  const matrix = new ModelMatrix();
  const subset = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4"];
  const ranked = matrix.rank("chat", subset);

  assert.equal(ranked.length, 3);
  const ids = ranked.map((r) => r.id).sort();
  assert.deepEqual(ids, ["claude-sonnet-4", "gpt-4o", "gpt-4o-mini"].sort());
});

// 20 ─────────────────────────────────────────────────────────────────────
test("rank throws for unknown task type", () => {
  const matrix = new ModelMatrix();
  assert.throws(() => matrix.rank("unknown_task_xyz"), /Unknown task type/);
});

// 21 ─────────────────────────────────────────────────────────────────────
test("getProviderBreakdown groups models by provider", () => {
  const matrix = new ModelMatrix();
  const breakdown = matrix.getProviderBreakdown();

  assert.equal(typeof breakdown, "object");
  const providers = Object.keys(breakdown);
  assert.ok(providers.includes("anthropic"));
  assert.ok(providers.includes("openai"));
  assert.ok(providers.includes("google"));
  assert.ok(breakdown.anthropic.length >= 4);

  // Every provider should have at least 1 model
  for (const p of providers) {
    assert.ok(breakdown[p].length >= 1, `Provider ${p} has no models`);
  }
});

// 22 ─────────────────────────────────────────────────────────────────────
test("getModelsByProvider returns only matching models", () => {
  const matrix = new ModelMatrix();
  const anthropic = matrix.getModelsByProvider("anthropic");
  assert.ok(anthropic.length >= 4);
  for (const m of anthropic) {
    assert.equal(m.provider, "anthropic");
  }

  const google = matrix.getModelsByProvider("google");
  assert.ok(google.length >= 2);
  for (const m of google) {
    assert.equal(m.provider, "google");
  }

  assert.equal(matrix.getModelsByProvider("").length, 0);
});

// 23 ─────────────────────────────────────────────────────────────────────
test("findCheapest / findFastest / findHighestCapability work correctly", () => {
  const matrix = new ModelMatrix();

  const cheapest = matrix.findCheapest({ vision: true });
  assert.ok(cheapest);
  const allVision = matrix.query({ vision: true });
  const maxCostAmongVision = Math.max(...allVision.map((m) => m.cost));
  assert.equal(cheapest.cost, maxCostAmongVision);

  const fastest = matrix.findFastest({ vision: true });
  assert.ok(fastest);
  const maxSpeedAmongVision = Math.max(...allVision.map((m) => m.speed));
  assert.equal(fastest.speed, maxSpeedAmongVision);

  const best = matrix.findHighestCapability({});
  assert.ok(best);

  assert.equal(matrix.findCheapest({ provider: "nonexistent" }), null);
  assert.equal(matrix.findFastest({ provider: "nonexistent" }), null);
});

// 24 ─────────────────────────────────────────────────────────────────────
test("TASK_PROFILES contains expected task types", () => {
  const expected = ["coding", "chat", "vision", "reasoning", "translation",
    "summarization", "json_extraction", "tool_use", "creative_writing", "code_review"];
  for (const t of expected) {
    assert.ok(TASK_PROFILES[t], `Missing task profile: ${t}`);
  }
});
