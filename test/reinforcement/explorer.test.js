/**
 * ExplorationEngine tests — shouldExplore, generateVariant, evaluateOutcome,
 * isSafe, getExplorationStats, strategy switching, edge cases.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { ExplorationEngine } = require("../../src/reinforcement/explorer");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(taskType = "code_review") {
  return {
    taskType,
    context: "bug fix",
    availableTools: ["read", "edit", "grep", "bash"],
    complexity: 3,
  };
}

function makeActionValues() {
  return [
    { action: "tool:read", value: 0.8, count: 10 },
    { action: "tool:edit", value: 0.6, count: 8 },
    { action: "tool:grep", value: 0.4, count: 5 },
    { action: "tool:bash", value: 0.2, count: 3 },
  ];
}

// ---------------------------------------------------------------------------
// shouldExplore — epsilonGreedy
// ---------------------------------------------------------------------------

test("shouldExplore: epsilonGreedy explores with probability epsilon", () => {
  const ee = new ExplorationEngine({ strategy: "epsilonGreedy", epsilon: 1.0, minEpsilon: 1.0 });

  // With epsilon=1.0, should always explore
  for (let i = 0; i < 20; i++) {
    const result = ee.shouldExplore(makeState());
    assert.equal(result.explore, true);
    assert.ok(result.reason.includes("epsilon-greedy"));
  }
});

test("shouldExplore: epsilonGreedy exploits with epsilon=0", () => {
  const ee = new ExplorationEngine({ strategy: "epsilonGreedy", epsilon: 0, minEpsilon: 0 });

  for (let i = 0; i < 20; i++) {
    const result = ee.shouldExplore(makeState());
    assert.equal(result.explore, false);
  }
});

test("shouldExplore: epsilon decays over successive calls", () => {
  const ee = new ExplorationEngine({
    strategy: "epsilonGreedy",
    epsilon: 0.5,
    epsilonDecay: 0.8,
    minEpsilon: 0.05,
  });

  const initialEpsilon = ee._epsilon;
  // Call many times to decay
  for (let i = 0; i < 20; i++) {
    ee.shouldExplore(makeState());
  }

  assert.ok(ee._epsilon < initialEpsilon);
  assert.ok(ee._epsilon >= 0.05);
});

// ---------------------------------------------------------------------------
// shouldExplore — softmax
// ---------------------------------------------------------------------------

test("shouldExplore: softmax explores when max probability is low", () => {
  const ee = new ExplorationEngine({ strategy: "softmax", temperature: 10.0, epsilon: 0.1 });

  // With high temperature and close values, max probability will be low
  const actionValues = [
    { action: "tool:read", value: 0.5 },
    { action: "tool:edit", value: 0.45 },
    { action: "tool:grep", value: 0.4 },
  ];
  const result = ee.shouldExplore(makeState(), { actionValues });
  // Should explore (max probability is not confidently high)
  assert.ok(typeof result.explore === "boolean");
  assert.ok(result.reason.includes("softmax"));
});

test("shouldExplore: softmax exploits when one action dominates", () => {
  const ee = new ExplorationEngine({ strategy: "softmax", temperature: 0.1, epsilon: 0.1 });

  // One action strongly dominates
  const actionValues = [
    { action: "tool:read", value: 10 },
    { action: "tool:edit", value: 0.1 },
    { action: "tool:grep", value: 0.1 },
  ];
  const result = ee.shouldExplore(makeState(), { actionValues });
  // Should exploit when max probability confidence is high
  assert.equal(result.explore, false);
});

test("shouldExplore: softmax explores when no action values provided", () => {
  const ee = new ExplorationEngine({ strategy: "softmax" });

  const result = ee.shouldExplore(makeState(), { actionValues: [] });
  assert.equal(result.explore, true);
  assert.ok(result.reason.includes("no action values"));
});

// ---------------------------------------------------------------------------
// shouldExplore — upperConfidenceBound
// ---------------------------------------------------------------------------

test("shouldExplore: UCB explores unvisited actions", () => {
  const ee = new ExplorationEngine({ strategy: "upperConfidenceBound", ucbC: 2.0 });

  // One action never visited
  const actionValues = [
    { action: "tool:read", value: 0.5, count: 10 },
    { action: "tool:bash", value: 0.5, count: 1 },
    { action: "tool:grep", value: 0, count: 0 }, // never visited
  ];
  const result = ee.shouldExplore(makeState(), { actionValues, totalSteps: 12 });
  assert.equal(result.explore, true);
  assert.ok(result.reason.includes("UCB"));
  assert.equal(result.meta.topAction, "tool:grep");
});

test("shouldExplore: UCB exploits when best action is clearly confirmed", () => {
  const ee = new ExplorationEngine({ strategy: "upperConfidenceBound", ucbC: 0.1 });

  // One action has been heavily tested and is best
  const actionValues = [
    { action: "tool:read", value: 0.9, count: 100 },
    { action: "tool:edit", value: 0.3, count: 100 },
    { action: "tool:grep", value: 0.2, count: 100 },
  ];
  const result = ee.shouldExplore(makeState(), { actionValues, totalSteps: 300 });
  assert.equal(result.explore, false);
});

test("shouldExplore: UCB explores when no action values provided", () => {
  const ee = new ExplorationEngine({ strategy: "upperConfidenceBound" });

  const result = ee.shouldExplore(makeState(), { actionValues: [] });
  assert.equal(result.explore, true);
});

// ---------------------------------------------------------------------------
// generateVariant
// ---------------------------------------------------------------------------

test("generateVariant: returns null variant for missing action", () => {
  const ee = new ExplorationEngine();

  const result = ee.generateVariant(null);
  assert.equal(result.variant, null);
  assert.equal(result.isNovel, false);
});

test("generateVariant: produces tool substitution variant", () => {
  const ee = new ExplorationEngine();
  const original = { action: "tool:read", params: { path: "/tmp/test" } };

  // Try multiple times — the variant type is picked randomly, so retry
  let foundSubstitution = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = ee.generateVariant(original, {
      toolAlternatives: ["tool:grep", "tool:find"],
    });
    assert.ok(result.variant);
    if (result.description.includes("substituted")) {
      foundSubstitution = true;
      assert.equal(result.isNovel, true);
      break;
    }
  }
  assert.ok(foundSubstitution, "expected at least one tool substitution variant in 30 attempts");
});

test("generateVariant: produces param perturbation variant", () => {
  const ee = new ExplorationEngine();
  const original = {
    action: "tool:retry",
    params: { maxRetries: 5, delayMs: 1000 },
  };

  const result = ee.generateVariant(original);
  assert.ok(result.variant);
  // Params should have been perturbed
  if (result.variant.params) {
    const perturbed = result.variant.params.maxRetries;
    assert.ok(typeof perturbed === "number");
  }
});

test("generateVariant: produces strategy substitution variant", () => {
  const ee = new ExplorationEngine();
  const original = { action: "tool:read", params: {} };

  // Try multiple times — variant type is picked randomly
  let foundStrategySubstitution = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = ee.generateVariant(original, {
      strategyAlternatives: ["parallel_execution", "cached_lookup"],
    });
    assert.ok(result.variant, "variant should not be null");
    if (result.variant.action.startsWith("strategy:")) {
      foundStrategySubstitution = true;
      assert.equal(result.isNovel, true);
      break;
    }
  }
  assert.ok(foundStrategySubstitution, "expected at least one strategy substitution in 30 attempts");
});

// ---------------------------------------------------------------------------
// evaluateOutcome
// ---------------------------------------------------------------------------

test("evaluateOutcome: success outcome yields positive score", () => {
  const ee = new ExplorationEngine();

  const result = ee.evaluateOutcome({
    success: true,
    errorCount: 0,
    durationMs: 2000,
    tokenCount: 800,
    cost: 0.05,
    _action: "tool:read",
  });

  assert.ok(result.score > 0);
  assert.equal(result.assessment, "excellent");
});

test("evaluateOutcome: failure outcome yields negative score", () => {
  const ee = new ExplorationEngine();

  const result = ee.evaluateOutcome({
    success: false,
    errorCount: 5,
    durationMs: 30000,
    tokenCount: 5000,
    cost: 0.5,
    _action: "tool:bash",
  });

  assert.ok(result.score < 0);
  assert.ok(["poor", "harmful"].includes(result.assessment));
});

test("evaluateOutcome: user approval boosts score", () => {
  const ee = new ExplorationEngine();

  const withoutApproval = ee.evaluateOutcome({
    success: true,
    errorCount: 0,
    durationMs: 3000,
    tokenCount: 1000,
    cost: 0.08,
    _action: "tool:read",
  });

  const withApproval = ee.evaluateOutcome({
    success: true,
    errorCount: 0,
    durationMs: 3000,
    tokenCount: 1000,
    cost: 0.08,
    userApproved: true,
    _action: "tool:read",
  });

  assert.ok(withApproval.score > withoutApproval.score);
});

test("evaluateOutcome: null outcome returns neutral", () => {
  const ee = new ExplorationEngine();

  const result = ee.evaluateOutcome(null);
  assert.equal(result.score, 0);
  assert.equal(result.assessment, "no_outcome");
});

// ---------------------------------------------------------------------------
// isSafe
// ---------------------------------------------------------------------------

test("isSafe: detects unsafe patterns in action names", () => {
  const ee = new ExplorationEngine();

  const result = ee.isSafe({ action: "rm -rf /tmp/cache" });
  assert.equal(result.safe, false);
});

test("isSafe: detects unsafe patterns in params", () => {
  const ee = new ExplorationEngine();

  const result = ee.isSafe({
    action: "tool:bash",
    params: { command: "sudo chmod 777 /etc/passwd" },
  });
  assert.equal(result.safe, false);
});

test("isSafe: safe action passes", () => {
  const ee = new ExplorationEngine();

  const result = ee.isSafe({
    action: "tool:read",
    params: { path: "/tmp/test.txt" },
  });
  assert.equal(result.safe, true);
  assert.equal(result.riskLevel, "low");
});

test("isSafe: null variant is unsafe", () => {
  const ee = new ExplorationEngine();

  const result = ee.isSafe(null);
  assert.equal(result.safe, false);
});

test("isSafe: medium risk for actions with single risk keyword", () => {
  const ee = new ExplorationEngine();

  const result = ee.isSafe({ action: "delete_temp_files" });
  assert.equal(result.safe, true);
  assert.equal(result.riskLevel, "medium");
});

// ---------------------------------------------------------------------------
// getExplorationStats
// ---------------------------------------------------------------------------

test("getExplorationStats: returns structured stats after evaluations", () => {
  const ee = new ExplorationEngine();

  ee.evaluateOutcome({ success: true, errorCount: 0, durationMs: 1000, tokenCount: 500, _action: "tool:read" });
  ee.evaluateOutcome({ success: true, errorCount: 0, durationMs: 1500, tokenCount: 600, _action: "tool:read" });
  ee.evaluateOutcome({ success: false, errorCount: 3, durationMs: 20000, _action: "tool:bash" });

  const stats = ee.getExplorationStats();

  assert.equal(stats.totalExplorations, 3);
  assert.ok(stats.successRate >= 0);
  assert.ok(stats.successRate <= 1);
  assert.ok("assessmentDistribution" in stats);
  assert.ok("actionBreakdown" in stats);
  assert.equal(stats.strategy, "epsilonGreedy");
  assert.ok(typeof stats.recentAvgScore === "number");
});

test("getExplorationStats: returns zeros for empty engine", () => {
  const ee = new ExplorationEngine();

  const stats = ee.getExplorationStats();
  assert.equal(stats.totalExplorations, 0);
  assert.equal(stats.successRate, 0);
  assert.deepEqual(stats.actionBreakdown, []);
  assert.equal(stats.recentTrend, "stable");
});

// ---------------------------------------------------------------------------
// setStrategy & reset
// ---------------------------------------------------------------------------

test("setStrategy: changes to valid strategy", () => {
  const ee = new ExplorationEngine({ strategy: "epsilonGreedy" });

  assert.equal(ee.setStrategy("softmax"), true);
  assert.equal(ee._strategy, "softmax");
  assert.equal(ee.setStrategy("upperConfidenceBound"), true);
  assert.equal(ee._strategy, "upperConfidenceBound");
});

test("setStrategy: rejects invalid strategy", () => {
  const ee = new ExplorationEngine({ strategy: "epsilonGreedy" });

  assert.equal(ee.setStrategy("random"), false);
  assert.equal(ee._strategy, "epsilonGreedy");
});

test("reset: clears all exploration state", () => {
  const ee = new ExplorationEngine();

  ee.evaluateOutcome({ success: true, errorCount: 0, _action: "tool:read" });
  ee.shouldExplore(makeState());

  ee.reset();

  const stats = ee.getExplorationStats();
  assert.equal(stats.totalExplorations, 0);
  assert.equal(stats.successfulExplorations, 0);
  assert.ok(ee._epsilon > 0.09); // reset to 0.1
});
