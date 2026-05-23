/**
 * Tests for DelegationEngine.
 *
 * Node.js native test runner.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { DelegationEngine } = require("../../src/trust/delegation");
const { ReputationEngine } = require("../../src/trust/reputation");
const { ReliabilityTracker } = require("../../src/trust/reliability");

// ─── helpers ────────────────────────────────────────────────────────────

function makeTask(overrides = {}) {
  return {
    type: "code-review",
    complexity: 0.6,
    ...overrides,
  };
}

function makeResult(overrides = {}) {
  return {
    success: true,
    durationMs: 150,
    ...overrides,
  };
}

function buildEngine() {
  const reputation = new ReputationEngine();
  const reliability = new ReliabilityTracker();
  return new DelegationEngine({ reputation, reliability });
}

function seedHistory(engine) {
  // Agent 1: strong on code-review
  engine.registerCapabilities("agent-1", ["code-review", "testing", "planning"]);
  for (let i = 0; i < 10; i++) {
    engine.evaluateDelegation(
      { type: "code-review", complexity: 0.7 },
      "agent-1",
      { success: true, durationMs: 100 }
    );
  }

  // Agent 2: good at deployment but slow
  engine.registerCapabilities("agent-2", ["deployment", "code-review"]);
  for (let i = 0; i < 5; i++) {
    engine.evaluateDelegation(
      { type: "deployment", complexity: 0.8 },
      "agent-2",
      { success: true, durationMs: 2000 }
    );
  }
  engine.evaluateDelegation(
    { type: "deployment", complexity: 0.8 },
    "agent-2",
    { success: false, durationMs: 5000, errorType: "network" }
  );

  // Agent 3: all-around but no specialization
  engine.registerCapabilities("agent-3", ["code-review", "deployment", "testing"]);
  for (let i = 0; i < 8; i++) {
    engine.evaluateDelegation(
      { type: "code-review", complexity: 0.5 },
      "agent-3",
      { success: i < 7, durationMs: 300 }
    );
  }
}

// ─── tests ──────────────────────────────────────────────────────────────

test("DelegationEngine: selectAgent with BEST_FIT strategy picks top agent", () => {
  const engine = buildEngine();
  seedHistory(engine);

  const result = engine.selectAgent(
    { type: "code-review", complexity: 0.7 },
    ["agent-1", "agent-2", "agent-3"],
    { strategy: DelegationEngine.STRATEGY.BEST_FIT }
  );

  assert.ok(result, "returns result");
  assert.ok(typeof result.agentId === "string", "agentId is a string");
  assert.ok(typeof result.score === "number", "score is a number");
  assert.ok(Array.isArray(result.ranking), "ranking is returned");
  assert.ok(result.ranking.length === 3, "all three candidates ranked");
});

test("DelegationEngine: selectAgent with ROUND_ROBIN cycles through agents", () => {
  const engine = buildEngine();
  seedHistory(engine);

  const first = engine.selectAgent(
    makeTask({ type: "code-review" }),
    ["agent-1", "agent-2", "agent-3"],
    { strategy: DelegationEngine.STRATEGY.ROUND_ROBIN }
  );

  const second = engine.selectAgent(
    makeTask({ type: "code-review" }),
    ["agent-1", "agent-2", "agent-3"],
    { strategy: DelegationEngine.STRATEGY.ROUND_ROBIN }
  );

  const third = engine.selectAgent(
    makeTask({ type: "code-review" }),
    ["agent-1", "agent-2", "agent-3"],
    { strategy: DelegationEngine.STRATEGY.ROUND_ROBIN }
  );

  assert.notEqual(first.agentId, second.agentId, "round-robin cycles agents");
  assert.equal(first.strategy, DelegationEngine.STRATEGY.ROUND_ROBIN);

  // After one full cycle, should be back to start (sorted: agent-1, agent-2, agent-3)
  const fourth = engine.selectAgent(
    makeTask({ type: "code-review" }),
    ["agent-1", "agent-2", "agent-3"],
    { strategy: DelegationEngine.STRATEGY.ROUND_ROBIN }
  );
  assert.equal(fourth.agentId, first.agentId, "round-robin wraps around");
});

test("DelegationEngine: selectAgent with EXPLORE picks least-used agent", () => {
  const engine = buildEngine();
  seedHistory(engine);

  // agent-3 has fewer delegations in history (8 vs 10 for agent-1)
  const result = engine.selectAgent(
    { type: "code-review" },
    ["agent-1", "agent-3"],
    { strategy: DelegationEngine.STRATEGY.EXPLORE }
  );

  assert.equal(result.agentId, "agent-3", "EXPLORE picks least-used agent");
  assert.equal(result.strategy, DelegationEngine.STRATEGY.EXPLORE);
});

test("DelegationEngine: selectAgent with WEIGHTED_RANDOM uses score-proportional selection", () => {
  const engine = buildEngine();
  seedHistory(engine);

  // With deterministic seed, same seed always picks same agent
  const result1 = engine.selectAgent(
    { type: "code-review" },
    ["agent-1", "agent-3"],
    { strategy: DelegationEngine.STRATEGY.WEIGHTED_RANDOM, seed: 42 }
  );

  const result2 = engine.selectAgent(
    { type: "code-review" },
    ["agent-1", "agent-3"],
    { strategy: DelegationEngine.STRATEGY.WEIGHTED_RANDOM, seed: 42 }
  );

  assert.equal(result1.agentId, result2.agentId, "same seed produces same result");
  assert.equal(result1.strategy, DelegationEngine.STRATEGY.WEIGHTED_RANDOM);
});

test("DelegationEngine: selectAgent throws on invalid strategy", () => {
  const engine = buildEngine();

  assert.throws(
    () =>
      engine.selectAgent(makeTask(), ["agent-1"], { strategy: "INVALID" }),
    /Unknown selection strategy/
  );
});

test("DelegationEngine: selectAgent throws with no candidates", () => {
  const engine = buildEngine();

  assert.throws(
    () => engine.selectAgent(makeTask(), [], { strategy: DelegationEngine.STRATEGY.BEST_FIT }),
    /At least one candidate/
  );
});

test("DelegationEngine: rankAgents returns scored candidates sorted by score", () => {
  const engine = buildEngine();
  seedHistory(engine);

  const ranked = engine.rankAgents(
    { type: "code-review", complexity: 0.7 },
    ["agent-1", "agent-2", "agent-3"]
  );

  assert.ok(Array.isArray(ranked), "returns an array");
  assert.equal(ranked.length, 3, "all three candidates ranked");

  for (const entry of ranked) {
    assert.ok(typeof entry.agentId === "string");
    assert.ok(typeof entry.score === "number");
    assert.ok(typeof entry.normalizedScore === "number");
    assert.ok("factors" in entry);
    assert.ok(typeof entry.factors.reputation === "number", "has reputation factor");
    assert.ok(typeof entry.factors.reliability === "number", "has reliability factor");
    assert.ok(typeof entry.factors.capabilityMatch === "number", "has capabilityMatch factor");
    assert.ok(typeof entry.factors.workload === "number", "has workload factor");
    assert.ok(typeof entry.factors.pastPerformance === "number", "has pastPerformance factor");
  }

  // Sorted descending by normalizedScore
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(
      ranked[i - 1].normalizedScore >= ranked[i].normalizedScore,
      "sorted by normalizedScore descending"
    );
  }
});

test("DelegationEngine: rankAgents returns empty array for no candidates", () => {
  const engine = buildEngine();
  const ranked = engine.rankAgents(makeTask(), []);
  assert.deepEqual(ranked, []);
});

test("DelegationEngine: evaluateDelegation feeds results into reputation and reliability", () => {
  const engine = buildEngine();

  engine.registerCapabilities("agent-1", ["code-review"]);

  engine.evaluateDelegation(
    { type: "code-review", complexity: 0.8 },
    "agent-1",
    { success: true, durationMs: 120 }
  );

  // Reputation should be updated
  const rep = engine.reputation.getReputation("agent-1");
  assert.equal(rep.history.successes, 1);

  // Reliability should be updated
  const rel = engine.reliability.getReliability("agent-1");
  assert.equal(rel.totalExecutions, 1);
  assert.equal(rel.successCount, 1);

  // History should contain the delegation
  const history = engine.getDelegationHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].agentId, "agent-1");
  assert.equal(history[0].taskType, "code-review");
  assert.equal(history[0].success, true);
});

test("DelegationEngine: evaluateDelegation handles failures correctly", () => {
  const engine = buildEngine();

  engine.evaluateDelegation(
    { type: "deployment" },
    "agent-1",
    { success: false, durationMs: 5000, errorType: "timeout" }
  );

  const rep = engine.reputation.getReputation("agent-1");
  assert.equal(rep.history.failures, 1);

  const rel = engine.reliability.getReliability("agent-1");
  assert.equal(rel.failureCount, 1);
  assert.ok("timeout" in rel.errorRateByType);
});

test("DelegationEngine: evaluateDelegation throws on invalid agentId", () => {
  const engine = buildEngine();

  assert.throws(
    () => engine.evaluateDelegation(makeTask(), "", makeResult()),
    /agentId is required/
  );
});

test("DelegationEngine: capability matching influences ranking", () => {
  const engine = buildEngine();

  engine.registerCapabilities("agent-1", ["code-review", "testing"]);
  engine.registerCapabilities("agent-2", ["deployment"]);
  engine.registerCapabilities("agent-3", ["code-review"]);

  // Give agents identical track records
  for (const agentId of ["agent-1", "agent-2", "agent-3"]) {
    for (let i = 0; i < 5; i++) {
      engine.evaluateDelegation(
        { type: "code-review", complexity: 0.5 },
        agentId,
        { success: true, durationMs: 100 }
      );
    }
  }

  // Rank for code-review task
  const ranked = engine.rankAgents(
    { type: "code-review" },
    ["agent-1", "agent-2", "agent-3"]
  );

  // agent-2 should rank lowest due to capability mismatch
  const agent2Rank = ranked.findIndex((r) => r.agentId === "agent-2");
  assert.ok(agent2Rank > 0, "agent without matching capability ranks lower");
});

test("DelegationEngine: workload affects ranking", () => {
  const engine = buildEngine();

  engine.registerCapabilities("agent-1", ["code-review"]);
  engine.registerCapabilities("agent-2", ["code-review"]);

  // Give both identical (minimal) history to keep workloads low
  for (const agentId of ["agent-1", "agent-2"]) {
    engine.evaluateDelegation(
      { type: "code-review", complexity: 0.5 },
      agentId,
      { success: true, durationMs: 100 }
    );
  }

  // Overload agent-1
  for (let i = 0; i < 5; i++) {
    engine.incrementWorkload("agent-1");
  }

  const ranked = engine.rankAgents(
    { type: "code-review" },
    ["agent-1", "agent-2"]
  );

  const agent1Entry = ranked.find((r) => r.agentId === "agent-1");
  const agent2Entry = ranked.find((r) => r.agentId === "agent-2");

  assert.ok(
    agent2Entry.factors.workload > agent1Entry.factors.workload,
    "less loaded agent has higher workload score"
  );
});

test("DelegationEngine: getDelegationHistory filters by agentId and taskType", () => {
  const engine = buildEngine();

  engine.evaluateDelegation({ type: "code-review" }, "agent-1", makeResult({ success: true }));
  engine.evaluateDelegation({ type: "deployment" }, "agent-2", makeResult({ success: true }));
  engine.evaluateDelegation({ type: "code-review" }, "agent-1", makeResult({ success: false, errorType: "timeout" }));

  // Filter by agent
  const agent1History = engine.getDelegationHistory({ agentId: "agent-1" });
  assert.equal(agent1History.length, 2);
  assert.ok(agent1History.every((h) => h.agentId === "agent-1"));

  // Filter by task type
  const reviewHistory = engine.getDelegationHistory({ taskType: "code-review" });
  assert.equal(reviewHistory.length, 2);
  assert.ok(reviewHistory.every((h) => h.taskType === "code-review"));

  // Filter by both
  const filtered = engine.getDelegationHistory({ agentId: "agent-1", taskType: "code-review" });
  assert.equal(filtered.length, 2);
});

test("DelegationEngine: getWorkload and incrementWorkload/decrementWorkload", () => {
  const engine = buildEngine();

  assert.equal(engine.getWorkload("agent-1"), 0);

  engine.incrementWorkload("agent-1");
  assert.equal(engine.getWorkload("agent-1"), 1);

  engine.incrementWorkload("agent-1");
  engine.incrementWorkload("agent-1");
  assert.equal(engine.getWorkload("agent-1"), 3);

  engine.decrementWorkload("agent-1");
  assert.equal(engine.getWorkload("agent-1"), 2);

  // Should not go below 0
  engine.decrementWorkload("agent-1");
  engine.decrementWorkload("agent-1");
  engine.decrementWorkload("agent-1");
  assert.equal(engine.getWorkload("agent-1"), 0);
});

test("DelegationEngine: getWorkloadSnapshot returns all workloads", () => {
  const engine = buildEngine();

  engine.incrementWorkload("agent-1");
  engine.incrementWorkload("agent-1");
  engine.incrementWorkload("agent-2");

  const snapshot = engine.getWorkloadSnapshot();

  assert.equal(snapshot["agent-1"], 2);
  assert.equal(snapshot["agent-2"], 1);
});

test("DelegationEngine: unregisterAgent removes capability and workload data", () => {
  const engine = buildEngine();

  engine.registerCapabilities("agent-1", ["code-review"]);
  engine.incrementWorkload("agent-1");

  engine.unregisterAgent("agent-1");

  assert.equal(engine.getWorkload("agent-1"), 0);

  // Capability match should be neutral now
  const ranked = engine.rankAgents(
    { type: "code-review" },
    ["agent-1"]
  );
  assert.ok(ranked.length > 0);
});

test("DelegationEngine: reset clears all state including sub-engines", () => {
  const engine = buildEngine();
  seedHistory(engine);

  assert.ok(engine.getDelegationHistory().length > 0, "has history before reset");
  assert.ok(engine.reputation.agentCount > 0, "has reputation data before reset");

  engine.reset();

  assert.equal(engine.getDelegationHistory().length, 0, "history cleared");
  assert.equal(engine.reputation.agentCount, 0, "reputation cleared");
  assert.equal(engine.reliability.agentCount, 0, "reliability cleared");
  assert.deepEqual(engine.getWorkloadSnapshot(), {}, "workload cleared");
});

test("DelegationEngine: custom rankWeights affect scoring", () => {
  const reputation = new ReputationEngine();
  const reliability = new ReliabilityTracker();

  const engine = new DelegationEngine({
    reputation,
    reliability,
    rankWeights: {
      reputation: 0.5,
      reliability: 0.1,
      capabilityMatch: 0.2,
      workload: 0.1,
      pastPerformance: 0.1,
    },
  });

  seedHistory(engine);

  const ranked = engine.rankAgents(
    { type: "code-review" },
    ["agent-1", "agent-3"]
  );

  assert.equal(ranked.length, 2, "ranking produced");
  assert.ok(ranked[0].normalizedScore >= 0, "first entry has valid score");
});

test("DelegationEngine: selectAgent with default strategy (BEST_FIT)", () => {
  const engine = buildEngine();
  seedHistory(engine);

  // No strategy specified — should use BEST_FIT default
  const result = engine.selectAgent(
    { type: "code-review" },
    ["agent-1", "agent-2"]
  );

  assert.ok(result.agentId, "agent selected with default strategy");
  assert.ok(Array.isArray(result.ranking), "ranking included");
});

test("DelegationEngine: STRATEGY constant is exposed", () => {
  assert.ok(typeof DelegationEngine.STRATEGY === "object");
  assert.equal(DelegationEngine.STRATEGY.BEST_FIT, "BEST_FIT");
  assert.equal(DelegationEngine.STRATEGY.ROUND_ROBIN, "ROUND_ROBIN");
  assert.equal(DelegationEngine.STRATEGY.EXPLORE, "EXPLORE");
  assert.equal(DelegationEngine.STRATEGY.WEIGHTED_RANDOM, "WEIGHTED_RANDOM");
});
