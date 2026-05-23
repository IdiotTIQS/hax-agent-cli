/**
 * Tests for ReputationEngine.
 *
 * Node.js native test runner.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { ReputationEngine } = require("../../src/trust/reputation");

// ─── helpers ────────────────────────────────────────────────────────────

function makeTask(overrides = {}) {
  return {
    type: "code-review",
    complexity: 0.5,
    ...overrides,
  };
}

function makeResult(overrides = {}) {
  return {
    durationMs: 200,
    collaborative: false,
    ...overrides,
  };
}

// ─── tests ──────────────────────────────────────────────────────────────

test("ReputationEngine: initializes with default score for unknown agent", () => {
  const engine = new ReputationEngine();
  const rep = engine.getReputation("unknown-agent");

  assert.equal(rep.score, ReputationEngine.DEFAULT_SCORE);
  assert.equal(rep.history.total, 0);
  assert.equal(rep.history.successRate, 0.5);
  assert.ok(typeof rep.breakdown === "object");
  assert.ok("successRate" in rep.breakdown);
  assert.ok("taskComplexity" in rep.breakdown);
  assert.ok("timeliness" in rep.breakdown);
  assert.ok("collaboration" in rep.breakdown);
  assert.ok("consistency" in rep.breakdown);
});

test("ReputationEngine: recordSuccess updates reputation", () => {
  const engine = new ReputationEngine();

  engine.recordSuccess("agent-1", makeTask(), makeResult());
  const rep = engine.getReputation("agent-1");

  assert.ok(rep.score > ReputationEngine.DEFAULT_SCORE, "score should increase above default");
  assert.equal(rep.history.successes, 1);
  assert.equal(rep.history.failures, 0);
  assert.equal(rep.history.total, 1);
  assert.equal(rep.history.successRate, 1);
});

test("ReputationEngine: recordFailure degrades reputation", () => {
  const engine = new ReputationEngine();

  engine.recordSuccess("agent-1", makeTask(), makeResult());
  engine.recordSuccess("agent-1", makeTask(), makeResult());
  engine.recordFailure("agent-1", makeTask(), { type: "timeout" });

  const rep = engine.getReputation("agent-1");

  assert.equal(rep.history.successes, 2);
  assert.equal(rep.history.failures, 1);
  assert.equal(rep.history.successRate, 2 / 3);
  assert.ok(rep.score < 100, "score should reflect failures");
});

test("ReputationEngine: score stays within 0-100 range", () => {
  const engine = new ReputationEngine();

  // Many successes
  for (let i = 0; i < 50; i++) {
    engine.recordSuccess("agent-1", makeTask({ complexity: 1 }), makeResult({ durationMs: 10 }));
  }

  const rep = engine.getReputation("agent-1");
  assert.ok(rep.score >= 0, "score >= 0");
  assert.ok(rep.score <= 100, "score <= 100");
  assert.ok(rep.score >= 80, "consistent success should produce high score");

  // Many failures
  for (let i = 0; i < 50; i++) {
    engine.recordFailure("agent-2", makeTask(), { type: "error" });
  }

  const rep2 = engine.getReputation("agent-2");
  assert.ok(rep2.score >= 0, "score >= 0");
  assert.ok(rep2.score <= 100, "score <= 100");
});

test("ReputationEngine: collaboration score increases with collaborative tasks", () => {
  const engine = new ReputationEngine();

  // Non-collaborative tasks
  engine.recordSuccess("agent-1", makeTask(), makeResult({ collaborative: false }));
  const rep1 = engine.getReputation("agent-1");

  // Collaborative tasks
  for (let i = 0; i < 10; i++) {
    engine.recordSuccess("agent-2", makeTask(), makeResult({ collaborative: true }));
  }
  const rep2 = engine.getReputation("agent-2");

  assert.ok(
    rep2.breakdown.collaboration > rep1.breakdown.collaboration,
    "collaborative agent should have higher collaboration score"
  );
});

test("ReputationEngine: getLeaderboard returns ranked agents", () => {
  const engine = new ReputationEngine();

  // Agent 1: moderate
  for (let i = 0; i < 5; i++) {
    engine.recordSuccess("agent-1", makeTask({ complexity: 0.4 }), makeResult({ durationMs: 500 }));
  }
  engine.recordFailure("agent-1", makeTask(), { type: "error" });

  // Agent 2: strong
  for (let i = 0; i < 10; i++) {
    engine.recordSuccess("agent-2", makeTask({ complexity: 0.9 }), makeResult({ durationMs: 100 }));
  }

  // Agent 3: weak
  for (let i = 0; i < 3; i++) {
    engine.recordFailure("agent-3", makeTask(), { type: "timeout" });
  }

  const leaderboard = engine.getLeaderboard({ limit: 5 });

  assert.ok(Array.isArray(leaderboard), "leaderboard is an array");
  assert.ok(leaderboard.length > 0, "leaderboard is not empty");

  // Should be sorted by score descending
  for (let i = 1; i < leaderboard.length; i++) {
    assert.ok(
      leaderboard[i - 1].score >= leaderboard[i].score,
      "leaderboard is sorted descending by score"
    );
  }
});

test("ReputationEngine: getLeaderboard respects minTasks filter", () => {
  const engine = new ReputationEngine();

  engine.recordSuccess("agent-1", makeTask(), makeResult()); // 1 task
  for (let i = 0; i < 10; i++) {
    engine.recordSuccess("agent-2", makeTask(), makeResult()); // 10 tasks
  }

  const board = engine.getLeaderboard({ limit: 10, minTasks: 5 });

  const ids = board.map((e) => e.agentId);
  assert.ok(!ids.includes("agent-1"), "agent with too few tasks excluded");
  assert.ok(ids.includes("agent-2"), "agent with enough tasks included");
});

test("ReputationEngine: getLeaderboard respects minSuccessRate filter", () => {
  const engine = new ReputationEngine();

  for (let i = 0; i < 5; i++) {
    engine.recordSuccess("agent-1", makeTask(), makeResult());
  }

  for (let i = 0; i < 5; i++) {
    engine.recordFailure("agent-2", makeTask(), { type: "error" });
  }

  const board = engine.getLeaderboard({ limit: 10, minSuccessRate: 0.5 });

  const ids = board.map((e) => e.agentId);
  assert.ok(ids.includes("agent-1"), "high success rate agent included");
  assert.ok(!ids.includes("agent-2"), "low success rate agent excluded");
});

test("ReputationEngine: decayReputation reduces old scores", () => {
  const engine = new ReputationEngine();

  // Build up strong reputation
  for (let i = 0; i < 20; i++) {
    engine.recordSuccess("agent-1", makeTask({ complexity: 1 }), makeResult({ durationMs: 10 }));
  }

  const beforeRep = engine.getReputation("agent-1");
  const beforeData = engine.getAgentData("agent-1");

  // Age the data: manually set lastUpdated far in the past
  const oldData = engine._agents.get("agent-1");
  oldData.lastUpdated = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60 days ago

  engine.decayReputation();

  const afterRep = engine.getReputation("agent-1");
  const afterData = engine.getAgentData("agent-1");

  assert.ok(afterRep.score <= beforeRep.score, "decay should reduce or maintain score");
  assert.ok(afterData.decayedAt !== null, "decayedAt should be set");
});

test("ReputationEngine: getAgentData returns raw agent metrics", () => {
  const engine = new ReputationEngine();

  engine.recordSuccess("agent-1", makeTask({ complexity: 0.7 }), makeResult({ durationMs: 300 }));
  engine.recordFailure("agent-1", makeTask(), { type: "timeout", name: "TimeoutError" });

  const data = engine.getAgentData("agent-1");

  assert.ok(data !== null, "data is not null");
  assert.equal(data.successes, 1);
  assert.equal(data.failures, 1);
  assert.equal(data.totalDurationMs, 300);
  assert.equal(data.totalComplexity, 0.7);
  assert.ok("timeout" in data.errorCounts || "TimeoutError" in data.errorCounts);
  assert.equal(data.scoreCount, 1);
  assert.ok(typeof data.lastUpdated === "number");
});

test("ReputationEngine: resetAgent removes agent data", () => {
  const engine = new ReputationEngine();

  engine.recordSuccess("agent-1", makeTask(), makeResult());
  engine.recordSuccess("agent-1", makeTask(), makeResult());

  assert.ok(engine.getReputation("agent-1").history.total > 0);

  const removed = engine.resetAgent("agent-1");
  assert.equal(removed, true);

  const rep = engine.getReputation("agent-1");
  assert.equal(rep.history.total, 0);
  assert.equal(rep.score, ReputationEngine.DEFAULT_SCORE);
});

test("ReputationEngine: reset clears all agents", () => {
  const engine = new ReputationEngine();

  engine.recordSuccess("agent-1", makeTask(), makeResult());
  engine.recordSuccess("agent-2", makeTask(), makeResult());

  assert.equal(engine.agentCount, 2);

  engine.reset();

  assert.equal(engine.agentCount, 0);
});

test("ReputationEngine: agentCount tracks registered agents", () => {
  const engine = new ReputationEngine();

  assert.equal(engine.agentCount, 0);

  engine.recordSuccess("agent-1", makeTask(), makeResult());
  assert.equal(engine.agentCount, 1);

  engine.recordFailure("agent-1", makeTask(), { type: "error" });
  assert.equal(engine.agentCount, 1); // same agent

  engine.recordSuccess("agent-2", makeTask(), makeResult());
  assert.equal(engine.agentCount, 2);
});

test("ReputationEngine: custom decayHalfLifeDays and decayFloor", () => {
  const engine = new ReputationEngine({
    decayHalfLifeDays: 7,
    decayFloor: 20,
  });

  for (let i = 0; i < 10; i++) {
    engine.recordSuccess("agent-1", makeTask({ complexity: 0.8 }), makeResult({ durationMs: 100 }));
  }

  const before = engine.getReputation("agent-1");

  // Manually age to trigger decay
  const agentData = engine._agents.get("agent-1");
  agentData.lastUpdated = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days

  engine.decayReputation();

  const after = engine.getReputation("agent-1");

  assert.ok(after.score <= before.score, "custom decay should reduce score");
  assert.ok(after.score >= 20, "score should not go below custom decay floor");
});

test("ReputationEngine: recordSuccess throws on invalid agentId", () => {
  const engine = new ReputationEngine();

  assert.throws(
    () => engine.recordSuccess("", makeTask(), makeResult()),
    /agentId is required/
  );

  assert.throws(
    () => engine.recordSuccess("  ", makeTask(), makeResult()),
    /agentId is required/
  );
});

test("ReputationEngine: static constants are exposed", () => {
  assert.equal(ReputationEngine.MIN_SCORE, 0);
  assert.equal(ReputationEngine.MAX_SCORE, 100);
  assert.equal(ReputationEngine.DEFAULT_SCORE, 50);
  assert.ok(typeof ReputationEngine.FACTOR_WEIGHTS === "object");
  assert.ok("successRate" in ReputationEngine.FACTOR_WEIGHTS);
});
