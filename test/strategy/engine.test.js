"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  StrategyEngine,
  SCORE_THRESHOLD,
  MEASURE_WEIGHTS,
} = require("../../src/strategy/engine");

function createMockStrategy(overrides = {}) {
  return {
    name: overrides.name || "mock-strategy",
    type: overrides.type || "toolSelection",
    config: Object.freeze({ ...(overrides.config || { maxChanges: 5 }) }),
    execute: overrides.execute !== undefined ? overrides.execute : async () => ({ done: true }),
    evaluate: overrides.evaluate !== undefined ? overrides.evaluate : () => 0.8,
    ...overrides._extra,
  };
}

// ── execute ───────────────────────────────────────────────────

test("StrategyEngine execute runs a strategy and returns result", async () => {
  const engine = new StrategyEngine();
  const strategy = createMockStrategy({
    execute: async (ctx) => ({ value: ctx.input * 2 }),
  });

  const result = await engine.execute(strategy, { input: 21 });
  assert.equal(result.value, 42);
});

test("StrategyEngine execute throws when strategy has no execute", async () => {
  const engine = new StrategyEngine();
  const strategy = { name: "bad", type: "toolSelection", config: {} };

  await assert.rejects(
    () => engine.execute(strategy, {}),
    /has no execute\(\) method/
  );
});

test("StrategyEngine execute logs execution history", async () => {
  const engine = new StrategyEngine();
  const strategy = createMockStrategy({ name: "logger" });

  await engine.execute(strategy, { key: "val" });
  const log = engine.getExecutionLog();

  assert.equal(log.length, 1);
  assert.equal(log[0].strategyName, "logger");
  assert.ok(log[0].success);
  assert.ok(log[0].durationMs >= 0);
  assert.deepEqual(log[0].contextKeys, ["key"]);
});

test("StrategyEngine execute records failures in log", async () => {
  const engine = new StrategyEngine();
  const strategy = createMockStrategy({
    name: "failer",
    execute: async () => { throw new Error("boom"); },
  });

  try {
    await engine.execute(strategy, {});
  } catch (_) {
    // expected
  }

  const log = engine.getExecutionLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].strategyName, "failer");
  assert.equal(log[0].success, false);
  assert.equal(log[0].error, "boom");
});

// ── evaluate ──────────────────────────────────────────────────

test("StrategyEngine evaluate picks highest-scoring strategy", async () => {
  const engine = new StrategyEngine();
  const low = createMockStrategy({ name: "low", evaluate: () => 0.2 });
  const mid = createMockStrategy({ name: "mid", evaluate: () => 0.5 });
  const high = createMockStrategy({ name: "high", evaluate: () => 0.9 });

  const result = await engine.evaluate([low, mid, high], { task: "test" });

  assert.ok(result.selected);
  assert.equal(result.selected.name, "high");
  assert.equal(result.scores.length, 3);
  assert.ok(result.bestScore >= 0.5);
});

test("StrategyEngine evaluate returns null selected when all below threshold", async () => {
  const engine = new StrategyEngine({ scoreThreshold: 0.8 });
  const low = createMockStrategy({ name: "low", evaluate: () => 0.1 });
  const mid = createMockStrategy({ name: "mid", evaluate: () => 0.2 });

  const result = await engine.evaluate([low, mid], {});
  assert.equal(result.selected, null);
});

test("StrategyEngine evaluate uses neutral score for strategies without evaluate", async () => {
  const engine = new StrategyEngine();
  // Create strategy manually — no evaluate function at all
  const plain = {
    name: "naked",
    type: "taskPlanning",
    config: Object.freeze({}),
  };

  const result = await engine.evaluate([plain], {});
  // without evaluate, default score is 0.5; feedback is 0.5 for unknown
  // adjusted: 0.5 * 0.7 + 0.5 * 0.3 = 0.5
  assert.ok(result.bestScore >= 0.4 && result.bestScore <= 0.6);
});

test("StrategyEngine evaluate throws on empty array", async () => {
  const engine = new StrategyEngine();
  await assert.rejects(
    () => engine.evaluate([], {}),
    /non-empty array/
  );
});

// ── adapt ─────────────────────────────────────────────────────

test("StrategyEngine adapt modifies config based on failure feedback", () => {
  const engine = new StrategyEngine();
  const strategy = createMockStrategy({ name: "test", config: { maxChanges: 5 } });

  const adapted = engine.adapt(strategy, {
    success: false,
    latencyMs: 200,
    error: new Error("timeout"),
  });

  assert.ok(adapted.config._adaptSafeMode);
  assert.ok(adapted.config._adaptReason.includes("Low success rate"));
});

test("StrategyEngine adapt modifies config based on high latency", () => {
  const engine = new StrategyEngine();
  const strategy = createMockStrategy({ name: "slow", config: { maxChanges: 5 } });

  // feed many successes with very high latency to overcome decay
  for (let i = 0; i < 20; i += 1) {
    engine.adapt(strategy, { success: true, latencyMs: 15000 });
  }

  const latest = engine.adapt(strategy, { success: true, latencyMs: 15000 });
  assert.ok(latest.config._adaptReduceComplexity);
});

test("StrategyEngine adapt accumulates feedback history", () => {
  const engine = new StrategyEngine();

  // first success
  engine.adapt(createMockStrategy({ name: "learner" }), { success: true, latencyMs: 100 });
  const fb1 = engine.getFeedback("learner");
  assert.ok(fb1);
  assert.equal(fb1.successes, 1);
  assert.equal(fb1.failures, 0);

  // then failure
  engine.adapt(createMockStrategy({ name: "learner" }), { success: false, latencyMs: 200, error: new Error("fail") });
  const fb2 = engine.getFeedback("learner");
  // after decay on count > 1: successes * 0.85 = 0.85 -> Math.round = 1, +0 = 1
  // failures * 0.85 = 0 -> Math.round = 0, +1 = 1
  assert.equal(fb2.successes, 1);
  assert.equal(fb2.failures, 1);
});

test("StrategyEngine adapt throws on invalid input", () => {
  const engine = new StrategyEngine();
  assert.throws(() => engine.adapt(null, {}), /Strategy must be a non-null object/);
  assert.throws(() => engine.adapt(createMockStrategy(), null), /Feedback must be a non-null object/);
});

// ── compose ───────────────────────────────────────────────────

test("StrategyEngine compose creates a fallback composite from multiple strategies", () => {
  const engine = new StrategyEngine();
  const a = createMockStrategy({ name: "a", execute: async () => ({ from: "a" }) });
  const b = createMockStrategy({ name: "b", execute: async () => ({ from: "b" }) });

  const composite = engine.compose([a, b]);
  assert.equal(composite.config.mode, "fallback");
  assert.equal(composite.config.count, 2);
  assert.deepEqual(composite.config.members, ["a", "b"]);
});

test("StrategyEngine compose executes first successful strategy in fallback", async () => {
  const engine = new StrategyEngine();
  const fail = createMockStrategy({ name: "fail", execute: async () => { throw new Error("nope"); } });
  const win = createMockStrategy({ name: "win", execute: async () => ({ value: "recovered" }) });

  const composite = engine.compose([fail, win]);
  const result = await engine.execute(composite, {});
  assert.equal(result.value, "recovered");
});

test("StrategyEngine compose throws when all strategies fail", async () => {
  const engine = new StrategyEngine();
  const a = createMockStrategy({ name: "fail-a", execute: async () => { throw new Error("error-a"); } });
  const b = createMockStrategy({ name: "fail-b", execute: async () => { throw new Error("error-b"); } });

  const composite = engine.compose([a, b]);
  await assert.rejects(
    () => engine.execute(composite, {}),
    /All composed strategies failed/
  );
});

// ── measure ───────────────────────────────────────────────────

test("StrategyEngine measure returns effectiveness for successful execution", () => {
  const engine = new StrategyEngine();
  const strategy = createMockStrategy({ name: "fast" });

  const m = engine.measure(strategy, { task: "test" }, {
    success: true,
    latencyMs: 100,
    resourceUsed: 10,
  });

  assert.ok(m.effectiveness >= 0.8);
  assert.equal(m.scores.success, true);
  assert.equal(m.recommendation, "maintain");
});

test("StrategyEngine measure returns low effectiveness for failed execution", () => {
  const engine = new StrategyEngine();
  const strategy = createMockStrategy({ name: "failing" });

  const m = engine.measure(strategy, {}, {
    success: false,
    latencyMs: 5000,
    resourceUsed: 500,
    error: new Error("critical failure"),
  });

  assert.ok(m.effectiveness < 0.5);
  assert.equal(m.scores.success, false);
});

test("StrategyEngine measure throws on null result", () => {
  const engine = new StrategyEngine();
  assert.throws(
    () => engine.measure(createMockStrategy(), {}, null),
    /Result must be a non-null object/
  );
});

// ── reset ─────────────────────────────────────────────────────

test("StrategyEngine reset clears all history", async () => {
  const engine = new StrategyEngine();
  const strategy = createMockStrategy({ name: "temp" });

  await engine.execute(strategy, {});
  engine.adapt(strategy, { success: true, latencyMs: 100 });

  assert.equal(engine.getExecutionLog().length, 1);
  assert.ok(engine.getFeedback("temp"));

  engine.reset();
  assert.equal(engine.getExecutionLog().length, 0);
  assert.equal(engine.getFeedback("temp"), null);
});

// ── constants ─────────────────────────────────────────────────

test("constants are frozen and have expected values", () => {
  assert.ok(Object.isFrozen(MEASURE_WEIGHTS));
  assert.ok(SCORE_THRESHOLD > 0 && SCORE_THRESHOLD < 1);
  assert.equal(MEASURE_WEIGHTS.success, 1.0);
  assert.equal(MEASURE_WEIGHTS.errorPenalty, 1.5);
});
