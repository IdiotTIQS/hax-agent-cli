/**
 * PolicyGradient tests — recordAction, updatePolicy, selectAction,
 * getBestAction, getPolicy, serialisation, edge cases.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { PolicyGradient } = require("../../src/reinforcement/policy");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides = {}) {
  return {
    taskType: "code_review",
    context: "fixing a bug in authentication module",
    availableTools: ["read", "edit", "grep", "bash"],
    complexity: 3,
    ...overrides,
  };
}

const ACTIONS = [
  "tool:read",
  "tool:edit",
  "tool:grep",
  "tool:bash",
  "strategy:retry",
  "strategy:fallback",
  "recovery:circuit_breaker",
];

// ---------------------------------------------------------------------------
// recordAction
// ---------------------------------------------------------------------------

test("recordAction: stores state-action pair with reward", () => {
  const pg = new PolicyGradient();
  const state = makeState();

  const result = pg.recordAction(state, "tool:read", 0.8);
  assert.ok(result);
  assert.equal(result.action, "tool:read");
  assert.equal(result.reward, 0.8);
  assert.ok(result.stateHash);
});

test("recordAction: accumulates multiple rewards for same action", () => {
  const pg = new PolicyGradient();
  const state = makeState();

  pg.recordAction(state, "tool:read", 0.5);
  pg.recordAction(state, "tool:read", 0.7);
  pg.recordAction(state, "tool:read", 0.9);

  const policy = pg.getPolicy(state);
  const readEntry = policy.find((p) => p.action === "tool:read");
  assert.ok(readEntry);
  assert.equal(readEntry.count, 3);
  assert.ok(readEntry.avgReward > 0.5);
});

test("recordAction: handles null state gracefully", () => {
  const pg = new PolicyGradient();

  const result = pg.recordAction(null, "tool:read", 0.5);
  assert.equal(result.stateHash, null);
  assert.ok(result.error);
});

test("recordAction: handles non-numeric reward by coercing to 0", () => {
  const pg = new PolicyGradient();
  const state = makeState();

  const result = pg.recordAction(state, "tool:read", undefined);
  assert.equal(result.reward, 0);
});

test("recordAction: auto-registers unknown actions", () => {
  const pg = new PolicyGradient({ actions: ["tool:read"] });
  const state = makeState();

  pg.recordAction(state, "custom:action", 0.3);

  const summary = pg.getSummary();
  assert.ok(summary.knownActions >= 2); // original + new
});

// ---------------------------------------------------------------------------
// updatePolicy
// ---------------------------------------------------------------------------

test("updatePolicy: returns empty-episode response when no actions recorded", () => {
  const pg = new PolicyGradient();

  const result = pg.updatePolicy();
  assert.equal(result.updated, false);
  assert.equal(result.steps, 0);
  assert.ok(result.reason.includes("empty episode"));
});

test("updatePolicy: processes episode with positive rewards", () => {
  const pg = new PolicyGradient({ learningRate: 0.1, discountFactor: 0.9 });
  const state = makeState();

  // Record a sequence of good actions
  pg.recordAction(state, "tool:read", 0.8);
  pg.recordAction(state, "tool:edit", 0.9);
  pg.recordAction(state, "tool:grep", 0.7);

  const result = pg.updatePolicy();
  assert.equal(result.updated, true);
  assert.equal(result.steps, 3);
  assert.ok(result.updatedActions > 0);
  assert.ok(typeof result.meanReturn === "number");
  assert.ok(typeof result.epsilon === "number");
});

test("updatePolicy: decays epsilon over time", () => {
  const pg = new PolicyGradient({ epsilon: 0.1, epsilonDecay: 0.9, minEpsilon: 0.01 });
  const state = makeState();

  for (let i = 0; i < 10; i++) {
    pg.recordAction(state, "tool:read", 1);
    pg.updatePolicy();
  }

  const summary = pg.getSummary();
  assert.ok(summary.epsilon < 0.1);
  assert.ok(summary.epsilon >= 0.01);
});

test("updatePolicy: handles mixed positive and negative rewards", () => {
  const pg = new PolicyGradient();
  const state = makeState();

  pg.recordAction(state, "tool:read", 1.0);
  pg.recordAction(state, "tool:bash", -0.5);
  pg.recordAction(state, "tool:read", 0.8);

  const result = pg.updatePolicy();
  assert.equal(result.updated, true);
  assert.equal(result.steps, 3);
});

// ---------------------------------------------------------------------------
// selectAction
// ---------------------------------------------------------------------------

test("selectAction: returns null when given null state", () => {
  const pg = new PolicyGradient({ actions: ACTIONS });

  const action = pg.selectAction(null);
  assert.equal(action, null);
});

test("selectAction: returns a valid action for known state", () => {
  const pg = new PolicyGradient({ actions: ACTIONS });
  const state = makeState();

  // Train on one action heavily
  for (let i = 0; i < 20; i++) {
    pg.recordAction(state, "tool:read", 1.0);
  }
  pg.updatePolicy();

  // With epsilon=0.1, we should mostly get tool:read
  let readCount = 0;
  for (let i = 0; i < 50; i++) {
    const action = pg.selectAction(state);
    assert.ok(ACTIONS.includes(action));
    if (action === "tool:read") readCount += 1;
  }

  // Should pick tool:read a significant majority of the time
  assert.ok(readCount >= 25, `Expected >=25 tool:read picks, got ${readCount}`);
});

test("selectAction: respects availableActions restriction", () => {
  const pg = new PolicyGradient({ actions: ACTIONS });
  const state = makeState();

  const restricted = ["tool:bash", "tool:grep"];
  for (let i = 0; i < 50; i++) {
    const action = pg.selectAction(state, { availableActions: restricted });
    assert.ok(restricted.includes(action));
  }
});

// ---------------------------------------------------------------------------
// getBestAction
// ---------------------------------------------------------------------------

test("getBestAction: returns null for null state", () => {
  const pg = new PolicyGradient();

  assert.equal(pg.getBestAction(null), null);
});

test("getBestAction: returns null for untrained state", () => {
  const pg = new PolicyGradient();
  const state = makeState();

  assert.equal(pg.getBestAction(state), null);
});

test("getBestAction: returns highest-logit action after training", () => {
  const pg = new PolicyGradient({ epsilon: 0, discountFactor: 0 });
  const state = makeState();

  // Train over multiple episodes — edit always gets the highest reward
  for (let ep = 0; ep < 3; ep++) {
    pg.recordAction(state, "tool:grep", -0.8);
    pg.recordAction(state, "tool:read", 0.0);
    pg.recordAction(state, "tool:edit", 1.0);
    pg.updatePolicy();
  }

  const best = pg.getBestAction(state);
  assert.equal(best, "tool:edit");
});

// ---------------------------------------------------------------------------
// getPolicy
// ---------------------------------------------------------------------------

test("getPolicy: returns empty array for null state", () => {
  const pg = new PolicyGradient();

  assert.deepEqual(pg.getPolicy(null), []);
});

test("getPolicy: returns probability distribution sorted by logit", () => {
  const pg = new PolicyGradient({ epsilon: 0 });
  const state = makeState();

  pg.recordAction(state, "tool:read", 1.0);
  pg.recordAction(state, "tool:edit", 0.5);
  pg.recordAction(state, "tool:grep", 0.2);
  pg.updatePolicy();

  const policy = pg.getPolicy(state);
  assert.ok(policy.length >= 3);
  // Sorted descending by logit
  for (let i = 1; i < policy.length; i++) {
    assert.ok(policy[i - 1].logit >= policy[i].logit,
      `Expected ${policy[i-1].logit} >= ${policy[i].logit}`);
  }
  // Probabilities should sum close to 1
  const sum = policy.reduce((a, p) => a + p.probability, 0);
  assert.ok(Math.abs(sum - 1) < 0.1, `Probabilities sum to ${sum}`);
});

test("getPolicy: each entry has required fields", () => {
  const pg = new PolicyGradient();
  const state = makeState();

  pg.recordAction(state, "tool:read", 0.5);
  pg.updatePolicy();

  const policy = pg.getPolicy(state);
  for (const entry of policy) {
    assert.ok("action" in entry);
    assert.ok("probability" in entry);
    assert.ok("logit" in entry);
    assert.ok("count" in entry);
    assert.ok("avgReward" in entry);
  }
});

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

test("serialize/deserialize: round-trips policy table", () => {
  const pg = new PolicyGradient({ epsilon: 0.1, epsilonDecay: 1.0, minEpsilon: 0.1 });
  const state = makeState();

  pg.recordAction(state, "tool:read", 1.0);
  pg.recordAction(state, "tool:edit", 0.8);
  pg.updatePolicy();

  const data = pg.serialize();
  assert.ok(data.policy);
  assert.ok(Array.isArray(data.knownActions));
  assert.equal(data.epsilon, 0.1);

  // Create new instance and load
  const pg2 = new PolicyGradient();
  pg2.deserialize(data);

  const summary1 = pg.getSummary();
  const summary2 = pg2.getSummary();
  assert.equal(summary2.states, summary1.states);
  assert.equal(summary2.knownActions, summary1.knownActions);

  const policy1 = pg.getPolicy(state);
  const policy2 = pg2.getPolicy(state);
  assert.equal(policy2.length, policy1.length);
});

// ---------------------------------------------------------------------------
// getSummary & reset
// ---------------------------------------------------------------------------

test("getSummary: returns state counts and configuration", () => {
  const pg = new PolicyGradient({ learningRate: 0.02 });
  const state = makeState();

  pg.recordAction(state, "tool:read", 0.5);
  pg.updatePolicy();

  const summary = pg.getSummary();
  assert.ok(summary.states >= 0);
  assert.ok(summary.knownActions >= 1);
  assert.equal(summary.learningRate, 0.02);
  assert.equal(summary.discountFactor, 0.95);
});

test("reset: clears all policy data", () => {
  const pg = new PolicyGradient();
  const state = makeState();

  pg.recordAction(state, "tool:read", 0.8);
  pg.updatePolicy();
  pg.reset();

  assert.equal(pg.getStateCount(), 0);
  assert.equal(pg.getBestAction(state), null);
  assert.deepEqual(pg.getPolicy(state), []);
});

test("clearEpisode: keeps policy but clears current episode", () => {
  const pg = new PolicyGradient();
  const state = makeState();

  pg.recordAction(state, "tool:read", 0.8);
  assert.equal(pg._episode.length, 1);

  pg.clearEpisode();
  assert.equal(pg._episode.length, 0);

  // Policy still intact
  assert.equal(pg.getStateCount(), 1);
});

// ---------------------------------------------------------------------------
// Multi-state
// ---------------------------------------------------------------------------

test("multi-state: different states have independent policies", () => {
  const pg = new PolicyGradient({ epsilon: 0 });
  const stateA = makeState({ taskType: "code_review" });
  const stateB = makeState({ taskType: "documentation" });

  pg.recordAction(stateA, "tool:read", 1.0);
  pg.recordAction(stateB, "tool:edit", 1.0);
  pg.updatePolicy();

  assert.equal(pg.getBestAction(stateA), "tool:read");
  assert.equal(pg.getBestAction(stateB), "tool:edit");
});
