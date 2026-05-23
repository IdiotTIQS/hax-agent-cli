"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  STRATEGY_LIBRARY,
  getStrategy,
  getStrategiesByType,
  getStrategyNames,
} = require("../../src/strategy/library");

// ── STRATEGY_LIBRARY ──────────────────────────────────────────

test("STRATEGY_LIBRARY is frozen and contains all 7 strategies", () => {
  assert.ok(Object.isFrozen(STRATEGY_LIBRARY));
  assert.equal(STRATEGY_LIBRARY.length, 7);

  const names = STRATEGY_LIBRARY.map((s) => s.name);
  assert.ok(names.includes("ConservativeRepair"));
  assert.ok(names.includes("AggressiveOptimize"));
  assert.ok(names.includes("ExploreFirst"));
  assert.ok(names.includes("IncrementalDelivery"));
  assert.ok(names.includes("ParallelInvestigate"));
  assert.ok(names.includes("FallbackChain"));
  assert.ok(names.includes("MajorityVote"));
});

test("Every strategy has required fields: name, type, config, evaluate, execute", () => {
  for (const strategy of STRATEGY_LIBRARY) {
    assert.ok(typeof strategy.name === "string" && strategy.name.length > 0,
      `${strategy.name}: missing name`);
    assert.ok(typeof strategy.type === "string" && strategy.type.length > 0,
      `${strategy.name}: missing type`);
    assert.ok(typeof strategy.config === "object" && strategy.config !== null,
      `${strategy.name}: missing config`);
    assert.ok(Object.isFrozen(strategy.config),
      `${strategy.name}: config is not frozen`);
    assert.ok(typeof strategy.evaluate === "function",
      `${strategy.name}: missing evaluate`);
    assert.ok(typeof strategy.execute === "function",
      `${strategy.name}: missing execute`);
  }
});

// ── getStrategy ───────────────────────────────────────────────

test("getStrategy returns a strategy by name", () => {
  const s = getStrategy("ConservativeRepair");
  assert.ok(s);
  assert.equal(s.name, "ConservativeRepair");
  assert.equal(s.type, "toolSelection");
});

test("getStrategy returns null for unknown name", () => {
  assert.equal(getStrategy("NonExistent"), null);
  assert.equal(getStrategy(""), null);
});

// ── getStrategiesByType ───────────────────────────────────────

test("getStrategiesByType filters by type", () => {
  const planning = getStrategiesByType("taskPlanning");
  assert.equal(planning.length, 4); // ExploreFirst, IncrementalDelivery, AggressiveOptimize, ParallelInvestigate
  for (const s of planning) {
    assert.equal(s.type, "taskPlanning");
  }
});

test("getStrategiesByType returns empty array for unknown type", () => {
  assert.deepEqual(getStrategiesByType("nonexistent"), []);
});

// ── getStrategyNames ──────────────────────────────────────────

test("getStrategyNames returns all 7 names", () => {
  const names = getStrategyNames();
  assert.equal(names.length, 7);
  assert.ok(Array.isArray(names));
});

// ── ConservativeRepair ────────────────────────────────────────

test("ConservativeRepair evaluate returns higher score for low-risk contexts", () => {
  const s = getStrategy("ConservativeRepair");
  const lowRiskScore = s.evaluate({ riskLevel: "low", needsAudit: true });
  const highRiskScore = s.evaluate({ riskLevel: "high", preferSpeed: true });
  assert.ok(lowRiskScore > highRiskScore,
    `lowRisk=${lowRiskScore} should be > highRisk=${highRiskScore}`);
});

test("ConservativeRepair execute returns safe tools only", async () => {
  const s = getStrategy("ConservativeRepair");
  const result = await s.execute({
    availableTools: ["read", "write", "delete", "grep", "execute", "list"],
  });

  assert.equal(result.strategy, "ConservativeRepair");
  for (const tool of result.tools) {
    assert.ok(!["write", "delete", "execute"].includes(tool),
      `Tool "${tool}" should not be in safe set`);
  }
  assert.ok(result.tools.includes("read"));
  assert.ok(result.tools.includes("grep"));
});

// ── ExploreFirst ──────────────────────────────────────────────

test("ExploreFirst evaluate returns higher score for unfamiliar codebase", () => {
  const s = getStrategy("ExploreFirst");
  const unfamiliarScore = s.evaluate({ complexDomain: true, unfamiliarCodebase: true });
  const simpleScore = s.evaluate({ simpleTask: true, preferSpeed: true });
  assert.ok(unfamiliarScore > simpleScore,
    `unfamiliar=${unfamiliarScore} should be > simple=${simpleScore}`);
});

test("ExploreFirst execute produces a phased exploration plan", async () => {
  const s = getStrategy("ExploreFirst");
  const result = await s.execute({ task: "auth-module" });

  assert.equal(result.strategy, "ExploreFirst");
  assert.equal(result.approach, "understand_deeply_before_acting");
  assert.ok(Array.isArray(result.explorationPlan));
  assert.ok(result.explorationPlan.length >= 4);
  assert.equal(result.explorationPlan[0].phase, "map");
  assert.equal(result.explorationPlan[1].phase, "trace");
  assert.equal(result.explorationPlan[2].phase, "understand");
  assert.equal(result.explorationPlan[3].phase, "act");
});

// ── AggressiveOptimize ────────────────────────────────────────

test("AggressiveOptimize evaluate returns higher score for speed-priority contexts", () => {
  const s = getStrategy("AggressiveOptimize");
  const speedScore = s.evaluate({ preferSpeed: true, largeScope: true });
  const auditScore = s.evaluate({ needsAudit: true, riskLevel: "high" });
  assert.ok(speedScore > auditScore,
    `speed=${speedScore} should be > audit=${auditScore}`);
});

test("AggressiveOptimize execute generates bold refactoring steps", async () => {
  const s = getStrategy("AggressiveOptimize");
  const result = await s.execute({ task: "config-loader" });

  assert.equal(result.strategy, "AggressiveOptimize");
  assert.equal(result.approach, "bold_refactoring_accept_risk");
  assert.ok(Array.isArray(result.steps));
  assert.ok(result.steps.length > 0);
});

// ── IncrementalDelivery ───────────────────────────────────────

test("IncrementalDelivery evaluate favors production environments", () => {
  const s = getStrategy("IncrementalDelivery");
  const prodScore = s.evaluate({ productionEnvironment: true, needsAudit: true });
  const speedScore = s.evaluate({ preferSpeed: true });
  assert.ok(prodScore > speedScore,
    `prod=${prodScore} should be > speed=${speedScore}`);
});

test("IncrementalDelivery execute decomposes task into slices", async () => {
  const s = getStrategy("IncrementalDelivery");
  const result = await s.execute({ task: "user-auth" });

  assert.equal(result.strategy, "IncrementalDelivery");
  assert.ok(Array.isArray(result.slices));
  assert.equal(result.slices.length, 4);
  assert.equal(result.slices[0].status, "pending");
});

// ── FallbackChain ─────────────────────────────────────────────

test("FallbackChain evaluate returns higher score for critical operations", () => {
  const s = getStrategy("FallbackChain");
  const criticalScore = s.evaluate({ criticalOperation: true, hasFallbacks: true });
  const normalScore = s.evaluate({});
  assert.ok(criticalScore > normalScore,
    `critical=${criticalScore} should be > normal=${normalScore}`);
});

test("FallbackChain execute resolves on secondary step", async () => {
  const s = getStrategy("FallbackChain");
  const result = await s.execute({});

  assert.equal(result.strategy, "FallbackChain");
  assert.equal(result.resolvedBy, "secondary");
  assert.equal(result.approach, "try_a_if_fail_try_b_if_fail_try_c");
  assert.ok(Array.isArray(result.chain));
});

// ── MajorityVote ──────────────────────────────────────────────

test("MajorityVote evaluate returns higher score when consensus is needed", () => {
  const s = getStrategy("MajorityVote");
  const consensusScore = s.evaluate({ needsConsensus: true, highStakes: true });
  const speedScore = s.evaluate({ preferSpeed: true });
  assert.ok(consensusScore > speedScore,
    `consensus=${consensusScore} should be > speed=${speedScore}`);
});

test("MajorityVote execute collects votes and tallies results", async () => {
  const s = getStrategy("MajorityVote");
  const result = await s.execute({ options: ["alpha", "beta", "gamma"] });

  assert.equal(result.strategy, "MajorityVote");
  assert.ok(Array.isArray(result.votes));
  assert.equal(result.votes.length, 3);
  assert.ok(typeof result.tally === "object");
  assert.ok(typeof result.winner === "string");
  assert.ok(typeof result.consensus === "boolean");
});

// ── ParallelInvestigate ───────────────────────────────────────

test("ParallelInvestigate evaluate returns higher score for wide search spaces", () => {
  const s = getStrategy("ParallelInvestigate");
  const wideScore = s.evaluate({ searchSpaceWide: true, canParallelize: true });
  const linearScore = s.evaluate({ linearDependency: true });
  assert.ok(wideScore > linearScore,
    `wide=${wideScore} should be > linear=${linearScore}`);
});

test("ParallelInvestigate execute forks into branches", async () => {
  const s = getStrategy("ParallelInvestigate");
  const result = await s.execute({ branchCount: 3 });

  assert.equal(result.strategy, "ParallelInvestigate");
  assert.ok(Array.isArray(result.branches));
  assert.equal(result.branches.length, 3);
  for (const branch of result.branches) {
    assert.ok(branch.branch.startsWith("branch-"));
    assert.ok(typeof branch.confidence === "number");
  }
});

// ── Config immutability ───────────────────────────────────────

test("Strategy configs are frozen and cannot be mutated", () => {
  const s = getStrategy("ConservativeRepair");
  assert.throws(
    () => { s.config.maxChanges = 999; },
    /Cannot assign to read only property|object is not extensible/
  );
});
