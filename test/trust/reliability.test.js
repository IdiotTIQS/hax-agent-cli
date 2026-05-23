/**
 * Tests for ReliabilityTracker.
 *
 * Node.js native test runner.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { ReliabilityTracker } = require("../../src/trust/reliability");

// ─── helpers ────────────────────────────────────────────────────────────

function makeExecution(overrides = {}) {
  return {
    success: true,
    taskType: "code-review",
    durationMs: 200,
    ...overrides,
  };
}

// ─── tests ──────────────────────────────────────────────────────────────

test("ReliabilityTracker: initializes with empty metrics for unknown agent", () => {
  const tracker = new ReliabilityTracker();
  const rel = tracker.getReliability("unknown-agent");

  assert.equal(rel.totalExecutions, 0);
  assert.equal(rel.successCount, 0);
  assert.equal(rel.failureCount, 0);
  assert.equal(rel.successRate, 0);
  assert.equal(rel.mtbfMs, null);
  assert.equal(rel.avgRecoveryRate, 0);
  assert.equal(rel.consistencyScore, 0);
  assert.deepEqual(rel.errorRateByType, {});
  assert.equal(rel.avgDurationMs, 0);
  assert.equal(rel.medianDurationMs, 0);
});

test("ReliabilityTracker: trackExecution records successful execution", () => {
  const tracker = new ReliabilityTracker();

  tracker.trackExecution("agent-1", makeExecution());

  const rel = tracker.getReliability("agent-1");

  assert.equal(rel.totalExecutions, 1);
  assert.equal(rel.successCount, 1);
  assert.equal(rel.failureCount, 0);
  assert.equal(rel.successRate, 1);
  assert.equal(rel.avgDurationMs, 200);
});

test("ReliabilityTracker: trackExecution records failure with error type", () => {
  const tracker = new ReliabilityTracker();

  tracker.trackExecution("agent-1", makeExecution({ success: false, errorType: "timeout", durationMs: 5000 }));

  const rel = tracker.getReliability("agent-1");

  assert.equal(rel.totalExecutions, 1);
  assert.equal(rel.successCount, 0);
  assert.equal(rel.failureCount, 1);
  assert.equal(rel.successRate, 0);
  assert.ok("timeout" in rel.errorRateByType);
  assert.equal(rel.errorRateByType.timeout.count, 1);
  assert.equal(rel.errorRateByType.timeout.rate, 1);
});

test("ReliabilityTracker: computes MTBF from multiple failures", () => {
  const tracker = new ReliabilityTracker();

  const baseTime = Date.now();

  // Mix of successes and timed failures
  tracker.trackExecution("agent-1", { success: true, taskType: "test", durationMs: 100, timestamp: baseTime });
  tracker.trackExecution("agent-1", { success: false, taskType: "test", errorType: "crash", durationMs: 0, timestamp: baseTime + 60000 });
  tracker.trackExecution("agent-1", { success: true, taskType: "test", durationMs: 100, timestamp: baseTime + 120000 });
  tracker.trackExecution("agent-1", { success: false, taskType: "test", errorType: "crash", durationMs: 0, timestamp: baseTime + 240000 });

  const rel = tracker.getReliability("agent-1");

  assert.ok(rel.mtbfMs !== null, "MTBF should be computable with 2+ failures");
  assert.ok(rel.mtbfMs > 0, "MTBF should be positive");
});

test("ReliabilityTracker: predictSuccess returns probability with confidence", () => {
  const tracker = new ReliabilityTracker();

  // Build history: mostly successful on code-review
  for (let i = 0; i < 20; i++) {
    tracker.trackExecution("agent-1", makeExecution({ taskType: "code-review" }));
  }
  // A few failures on deployment
  for (let i = 0; i < 3; i++) {
    tracker.trackExecution("agent-1", makeExecution({ success: false, taskType: "deployment", errorType: "network" }));
  }

  // Predict for known good task type
  const goodPrediction = tracker.predictSuccess("agent-1", { type: "code-review" });
  assert.ok(goodPrediction.probability > 0.5, "high probability for known good task type");
  assert.ok(goodPrediction.confidence > 0, "confidence based on data volume");
  assert.ok(goodPrediction.factors.overallSuccessRate !== null);

  // Predict for known bad task type
  const badPrediction = tracker.predictSuccess("agent-1", { type: "deployment" });
  assert.ok(badPrediction.factors.taskTypeSuccessRate !== null);

  // Predict for unknown agent
  const unknownPrediction = tracker.predictSuccess("unknown", { type: "code-review" });
  assert.equal(unknownPrediction.probability, 0.5);
  assert.equal(unknownPrediction.confidence, 0);
});

test("ReliabilityTracker: getWeaknesses identifies underperforming task types", () => {
  const tracker = new ReliabilityTracker();

  // Good at code-review
  for (let i = 0; i < 10; i++) {
    tracker.trackExecution("agent-1", makeExecution({ taskType: "code-review" }));
  }

  // Bad at deployment (50% failure)
  for (let i = 0; i < 4; i++) {
    tracker.trackExecution("agent-1", makeExecution({ taskType: "deployment" }));
    tracker.trackExecution("agent-1", makeExecution({ success: false, taskType: "deployment", errorType: "timeout" }));
  }

  // Bad at security-audit (100% failure)
  tracker.trackExecution("agent-1", makeExecution({ success: false, taskType: "security-audit", errorType: "permission" }));
  tracker.trackExecution("agent-1", makeExecution({ success: false, taskType: "security-audit", errorType: "permission" }));

  const weaknesses = tracker.getWeaknesses("agent-1");

  assert.ok(weaknesses.length > 0, "should have weaknesses");
  assert.ok(weaknesses[0].errorRate >= weaknesses[weaknesses.length - 1].errorRate,
    "sorted by error rate descending");

  // code-review should NOT be a weakness (0% error rate)
  const weakTypes = weaknesses.map((w) => w.taskType);
  assert.ok(!weakTypes.includes("code-review"), "code-review should not appear as weakness");
});

test("ReliabilityTracker: getStrengths identifies high-performing task types", () => {
  const tracker = new ReliabilityTracker();

  // Excellent at code-review
  for (let i = 0; i < 15; i++) {
    tracker.trackExecution("agent-1", makeExecution({ taskType: "code-review", durationMs: 50 }));
  }

  // OK at testing (85%)
  for (let i = 0; i < 10; i++) {
    tracker.trackExecution("agent-1", makeExecution({ taskType: "testing" }));
  }
  for (let i = 0; i < 2; i++) {
    tracker.trackExecution("agent-1", makeExecution({ success: false, taskType: "testing", errorType: "assertion" }));
  }

  const strengths = tracker.getStrengths("agent-1");

  assert.ok(strengths.length > 0, "should have strengths");
  assert.ok(strengths[0].successRate >= 0.8, "strengths should have high success rate");

  const strongTypes = strengths.map((s) => s.taskType);
  assert.ok(strongTypes.includes("code-review"), "code-review is a strength");
});

test("ReliabilityTracker: getHistory returns executions newest first", () => {
  const tracker = new ReliabilityTracker();

  tracker.trackExecution("agent-1", { success: true, taskType: "task-a", durationMs: 100 });
  tracker.trackExecution("agent-1", { success: false, taskType: "task-b", durationMs: 200, errorType: "crash" });
  tracker.trackExecution("agent-1", { success: true, taskType: "task-c", durationMs: 300 });

  const history = tracker.getHistory("agent-1");

  assert.equal(history.length, 3);
  assert.equal(history[0].taskType, "task-c"); // newest first
  assert.equal(history[1].taskType, "task-b");
  assert.equal(history[2].taskType, "task-a");
});

test("ReliabilityTracker: getHistory supports limit", () => {
  const tracker = new ReliabilityTracker();

  for (let i = 0; i < 10; i++) {
    tracker.trackExecution("agent-1", { success: true, taskType: "task", durationMs: 100 });
  }

  const history = tracker.getHistory("agent-1", { limit: 3 });

  assert.equal(history.length, 3);
});

test("ReliabilityTracker: recovery tracking works", () => {
  const tracker = new ReliabilityTracker();

  tracker.trackExecution("agent-1", { success: false, taskType: "deploy", errorType: "network" });
  tracker.trackExecution("agent-1", { success: true, taskType: "deploy", recovered: true });
  tracker.trackExecution("agent-1", { success: false, taskType: "deploy", errorType: "timeout" });
  tracker.trackExecution("agent-1", { success: true, taskType: "deploy", recovered: true });

  const rel = tracker.getReliability("agent-1");

  assert.equal(rel.avgRecoveryRate, 1); // all failures recovered
});

test("ReliabilityTracker: consistency score reflects execution pattern stability", () => {
  const tracker = new ReliabilityTracker();

  // Stable pattern: all successes
  for (let i = 0; i < 20; i++) {
    tracker.trackExecution("agent-stable", makeExecution({ taskType: "task" }));
  }

  // Unstable pattern: alternating success/failure
  for (let i = 0; i < 20; i++) {
    tracker.trackExecution("agent-unstable", { success: i % 2 === 0, taskType: "task", durationMs: 100 });
  }

  const stableRel = tracker.getReliability("agent-stable");
  const unstableRel = tracker.getReliability("agent-unstable");

  assert.ok(
    stableRel.consistencyScore > unstableRel.consistencyScore,
    "stable agent has higher consistency score"
  );
});

test("ReliabilityTracker: getAgentIds returns tracked agents", () => {
  const tracker = new ReliabilityTracker();

  tracker.trackExecution("agent-1", makeExecution());
  tracker.trackExecution("agent-2", makeExecution());

  const ids = tracker.getAgentIds();

  assert.ok(ids.includes("agent-1"));
  assert.ok(ids.includes("agent-2"));
  assert.equal(ids.length, 2);
});

test("ReliabilityTracker: resetAgent removes agent data", () => {
  const tracker = new ReliabilityTracker();

  tracker.trackExecution("agent-1", makeExecution());
  tracker.trackExecution("agent-1", makeExecution());

  assert.equal(tracker.getReliability("agent-1").totalExecutions, 2);

  const removed = tracker.resetAgent("agent-1");
  assert.equal(removed, true);

  assert.equal(tracker.getReliability("agent-1").totalExecutions, 0);
});

test("ReliabilityTracker: reset clears all data", () => {
  const tracker = new ReliabilityTracker();

  tracker.trackExecution("agent-1", makeExecution());
  tracker.trackExecution("agent-2", makeExecution());

  assert.equal(tracker.agentCount, 2);

  tracker.reset();

  assert.equal(tracker.agentCount, 0);
});

test("ReliabilityTracker: agentCount property works", () => {
  const tracker = new ReliabilityTracker();

  assert.equal(tracker.agentCount, 0);

  tracker.trackExecution("agent-1", makeExecution());
  assert.equal(tracker.agentCount, 1);

  tracker.trackExecution("agent-1", makeExecution()); // same agent
  assert.equal(tracker.agentCount, 1);

  tracker.trackExecution("agent-2", makeExecution());
  assert.equal(tracker.agentCount, 2);
});

test("ReliabilityTracker: custom windowSize restricts execution history", () => {
  const tracker = new ReliabilityTracker({ windowSize: 5 });

  for (let i = 0; i < 10; i++) {
    tracker.trackExecution("agent-1", { success: true, taskType: "task", durationMs: 100 });
  }

  const history = tracker.getHistory("agent-1");
  assert.ok(history.length <= 5, "history should be capped at window size");

  const rel = tracker.getReliability("agent-1");
  assert.equal(rel.totalExecutions, 5, "total executions capped at window size");
});

test("ReliabilityTracker: trackExecution throws on invalid agentId", () => {
  const tracker = new ReliabilityTracker();

  assert.throws(
    () => tracker.trackExecution("", makeExecution()),
    /agentId is required/
  );

  assert.throws(
    () => tracker.trackExecution("   ", makeExecution()),
    /agentId is required/
  );
});
