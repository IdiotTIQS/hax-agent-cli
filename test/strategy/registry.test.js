"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  StrategyRegistry,
  STRATEGY_CATEGORIES,
  DEFAULT_STRATEGIES,
} = require("../../src/strategy/registry");

function createMockStrategy(overrides = {}) {
  return {
    type: overrides.type || "toolSelection",
    description: overrides.description || "Mock strategy for testing",
    defaultConfig: overrides.defaultConfig || { maxChanges: 5, riskTolerance: 0.5 },
    factory: overrides.factory || null,
    ...overrides,
  };
}

// ── define ────────────────────────────────────────────────────

test("StrategyRegistry define registers a valid strategy", () => {
  const registry = new StrategyRegistry();
  registry.define("leastCost", createMockStrategy({ type: "toolSelection" }));

  assert.equal(registry.size, 1);
  assert.ok(registry.has("leastCost"));
});

test("StrategyRegistry define throws on empty name", () => {
  const registry = new StrategyRegistry();
  assert.throws(
    () => registry.define("", createMockStrategy()),
    /Strategy name must be a non-empty string/
  );
});

test("StrategyRegistry define throws on invalid type", () => {
  const registry = new StrategyRegistry();
  assert.throws(
    () => registry.define("badStrategy", createMockStrategy({ type: "invalidType" })),
    /Unknown strategy type/
  );
});

test("StrategyRegistry define throws on null strategy object", () => {
  const registry = new StrategyRegistry();
  assert.throws(
    () => registry.define("test", null),
    /Strategy definition must be a non-null object/
  );
});

// ── select ────────────────────────────────────────────────────

test("StrategyRegistry select returns a strategy with merged config", () => {
  const registry = new StrategyRegistry();
  registry.define("leastCost", createMockStrategy({
    type: "toolSelection",
    defaultConfig: { maxChanges: 3, riskTolerance: 0.2 },
  }));

  const instance = registry.select("leastCost", { maxChanges: 10 });
  assert.equal(instance.name, "leastCost");
  assert.equal(instance.type, "toolSelection");
  assert.equal(instance.config.maxChanges, 10);
  assert.equal(instance.config.riskTolerance, 0.2);
});

test("StrategyRegistry select throws on unknown strategy", () => {
  const registry = new StrategyRegistry();
  assert.throws(
    () => registry.select("nonexistent"),
    /Unknown strategy: "nonexistent"/
  );
});

test("StrategyRegistry select calls factory when provided", () => {
  const registry = new StrategyRegistry();
  let factoryCalled = false;

  registry.define("custom", createMockStrategy({
    type: "taskPlanning",
    factory(config) {
      factoryCalled = true;
      return {
        name: "custom",
        type: "taskPlanning",
        config: { ...config },
        extra: "from-factory",
      };
    },
  }));

  const instance = registry.select("custom", { steps: 5 });
  assert.ok(factoryCalled);
  assert.equal(instance.extra, "from-factory");
  assert.equal(instance.config.steps, 5);
});

// ── list ──────────────────────────────────────────────────────

test("StrategyRegistry list returns all registered strategies", () => {
  const registry = new StrategyRegistry();
  registry.define("a", createMockStrategy({ type: "toolSelection", description: "Alpha" }));
  registry.define("b", createMockStrategy({ type: "taskPlanning", description: "Beta" }));
  registry.define("c", createMockStrategy({ type: "errorRecovery", description: "Gamma" }));

  const list = registry.list();
  assert.equal(list.length, 3);
  assert.equal(list[0].name, "a");
  assert.equal(list[1].name, "b");
  assert.equal(list[2].name, "c");
});

test("StrategyRegistry list filters by type", () => {
  const registry = new StrategyRegistry();
  registry.define("a", createMockStrategy({ type: "toolSelection" }));
  registry.define("b", createMockStrategy({ type: "taskPlanning" }));
  registry.define("c", createMockStrategy({ type: "taskPlanning" }));

  const filtered = registry.list({ type: "taskPlanning" });
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].name, "b");
  assert.equal(filtered[1].name, "c");
});

test("StrategyRegistry list filters by search term", () => {
  const registry = new StrategyRegistry();
  registry.define("leastCost", createMockStrategy({ description: "Select cheapest model" }));
  registry.define("highestCapability", createMockStrategy({ description: "Most powerful model" }));
  registry.define("roundRobin", createMockStrategy({ description: "Rotate evenly" }));

  const results = registry.list({ search: "cost" });
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "leastCost");
});

test("StrategyRegistry list returns empty array when no match", () => {
  const registry = new StrategyRegistry();
  registry.define("a", createMockStrategy());
  const results = registry.list({ search: "zzz" });
  assert.equal(results.length, 0);
});

// ── getDefault / setDefault ───────────────────────────────────

test("StrategyRegistry getDefault returns seeded defaults", () => {
  const registry = new StrategyRegistry();
  assert.equal(registry.getDefault("toolSelection"), "leastCost");
  assert.equal(registry.getDefault("taskPlanning"), "incremental");
  assert.equal(registry.getDefault("errorRecovery"), "fallbackChain");
});

test("StrategyRegistry setDefault overrides the default for a category", () => {
  const registry = new StrategyRegistry();
  registry.define("myToolPicker", createMockStrategy({ type: "toolSelection" }));
  registry.setDefault("toolSelection", "myToolPicker");
  assert.equal(registry.getDefault("toolSelection"), "myToolPicker");
});

test("StrategyRegistry setDefault throws on unknown strategy", () => {
  const registry = new StrategyRegistry();
  assert.throws(
    () => registry.setDefault("toolSelection", "nonexistent"),
    /Unknown strategy: "nonexistent"/
  );
});

// ── remove ────────────────────────────────────────────────────

test("StrategyRegistry remove deletes a strategy", () => {
  const registry = new StrategyRegistry();
  registry.define("temp", createMockStrategy());
  assert.equal(registry.size, 1);
  assert.ok(registry.remove("temp"));
  assert.equal(registry.size, 0);
  assert.ok(!registry.has("temp"));
});

// ── STRATEGY_CATEGORIES ───────────────────────────────────────

test("STRATEGY_CATEGORIES is frozen and contains all five types", () => {
  assert.ok(Object.isFrozen(STRATEGY_CATEGORIES));
  assert.equal(STRATEGY_CATEGORIES.length, 5);
  assert.ok(STRATEGY_CATEGORIES.includes("toolSelection"));
  assert.ok(STRATEGY_CATEGORIES.includes("taskPlanning"));
  assert.ok(STRATEGY_CATEGORIES.includes("errorRecovery"));
  assert.ok(STRATEGY_CATEGORIES.includes("contextManagement"));
  assert.ok(STRATEGY_CATEGORIES.includes("responseFormatting"));
});

// ── DEFAULT_STRATEGIES ────────────────────────────────────────

test("DEFAULT_STRATEGIES maps each category to a default", () => {
  assert.ok(Object.isFrozen(DEFAULT_STRATEGIES));
  for (const category of STRATEGY_CATEGORIES) {
    assert.ok(typeof DEFAULT_STRATEGIES[category] === "string");
  }
});
