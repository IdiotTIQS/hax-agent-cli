/**
 * Tests for SimulationMetrics — event tracking, statistics, and comparisons.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { SimulationMetrics } = require("../../src/sim/metrics");

// ── Track events ───────────────────────────────────────

test("track: records a single event with defaults", () => {
  const metrics = new SimulationMetrics();
  const record = metrics.track({
    type: "agent_action",
    agent: "alpha",
    action: "execute",
    outcome: "success",
  });

  assert.equal(record.type, "agent_action");
  assert.equal(record.agent, "alpha");
  assert.equal(record.action, "execute");
  assert.equal(record.outcome, "success");
  assert.equal(record.tokensUsed, 0);
  assert.equal(record.duration, 0);
  assert.ok(record.timestamp);
  assert.ok(record.id > 0);
});

test("track: throws on non-object input", () => {
  const metrics = new SimulationMetrics();
  assert.throws(() => metrics.track(null), { message: /object/ });
  assert.throws(() => metrics.track("string"), { message: /object/ });
});

test("track: records tokensUsed and duration when provided", () => {
  const metrics = new SimulationMetrics();
  const record = metrics.track({
    type: "api_call",
    agent: "beta",
    tokensUsed: 1500,
    duration: 320,
  });

  assert.equal(record.tokensUsed, 1500);
  assert.equal(record.duration, 320);
});

test("track: normalizes negative values to 0", () => {
  const metrics = new SimulationMetrics();
  const record = metrics.track({
    type: "test",
    agent: "gamma",
    tokensUsed: -50,
    duration: -100,
  });

  assert.equal(record.tokensUsed, 0);
  assert.equal(record.duration, 0);
});

test("track: stores metadata when provided", () => {
  const metrics = new SimulationMetrics();
  const record = metrics.track({
    type: "review",
    agent: "delta",
    metadata: { file: "app.js", linesChanged: 42 },
  });

  assert.deepEqual(record.metadata, { file: "app.js", linesChanged: 42 });
});

test("track: auto-assigns sequential ids", () => {
  const metrics = new SimulationMetrics();
  const r1 = metrics.track({ type: "t1", agent: "a" });
  const r2 = metrics.track({ type: "t2", agent: "a" });
  const r3 = metrics.track({ type: "t3", agent: "a" });

  assert.equal(r1.id, 1);
  assert.equal(r2.id, 2);
  assert.equal(r3.id, 3);
});

// ── Tagging ────────────────────────────────────────────

test("tag: sets and retrieves tags via computeStats", () => {
  const metrics = new SimulationMetrics();
  metrics.tag("env", "production");
  metrics.tag("attempt", 3);

  metrics.track({ type: "event", agent: "a" });

  const stats = metrics.computeStats();
  assert.equal(stats.tags.env, "production");
  assert.equal(stats.tags.attempt, 3);
});

// ── computeStats ───────────────────────────────────────

test("computeStats: aggregates by agent, outcome, and action", () => {
  const metrics = new SimulationMetrics();
  metrics.track({ type: "action", agent: "agent_a", action: "execute", outcome: "success", tokensUsed: 100, duration: 50 });
  metrics.track({ type: "action", agent: "agent_a", action: "review", outcome: "failure", tokensUsed: 200, duration: 30 });
  metrics.track({ type: "action", agent: "agent_b", action: "execute", outcome: "success", tokensUsed: 150, duration: 20 });
  metrics.track({ type: "action", agent: "agent_b", action: "communicate", outcome: "needs_input", tokensUsed: 50, duration: 10 });

  const stats = metrics.computeStats();

  assert.equal(stats.total, 4);
  assert.equal(stats.totalTokens, 500);
  assert.equal(stats.totalDuration, 110);
  assert.equal(stats.agentCount, 2);
  assert.equal(stats.byOutcome.success, 2);
  assert.equal(stats.byOutcome.failure, 1);
  assert.equal(stats.byOutcome.needs_input, 1);
  assert.equal(stats.byAction.execute, 2);
  assert.equal(stats.byAction.review, 1);
  assert.equal(stats.byAction.communicate, 1);
});

test("computeStats: computes success rates per agent", () => {
  const metrics = new SimulationMetrics();
  metrics.track({ type: "action", agent: "winner", outcome: "success" });
  metrics.track({ type: "action", agent: "winner", outcome: "success" });
  metrics.track({ type: "action", agent: "winner", outcome: "failure" });
  metrics.track({ type: "action", agent: "loser", outcome: "failure" });
  metrics.track({ type: "action", agent: "loser", outcome: "failure" });

  const stats = metrics.computeStats();

  assert.equal(stats.byAgent.winner.successRate, 2 / 3);
  assert.equal(stats.byAgent.winner.failureRate, 1 / 3);
  assert.equal(stats.byAgent.loser.successRate, 0);
  assert.equal(stats.byAgent.loser.failureRate, 1);
});

test("computeStats: returns empty stats with no events", () => {
  const metrics = new SimulationMetrics();
  const stats = metrics.computeStats();

  assert.equal(stats.total, 0);
  assert.equal(stats.totalTokens, 0);
  assert.equal(stats.agentCount, 0);
  assert.deepEqual(stats.byOutcome, { success: 0, partial_success: 0, failure: 0, needs_input: 0 });
});

// ── efficiency ─────────────────────────────────────────

test("efficiency: computes tokens per success", () => {
  const metrics = new SimulationMetrics();
  metrics.track({ type: "action", agent: "a", outcome: "success", tokensUsed: 500 });
  metrics.track({ type: "action", agent: "a", outcome: "success", tokensUsed: 300 });
  metrics.track({ type: "action", agent: "b", outcome: "failure", tokensUsed: 200 });

  const eff = metrics.efficiency();

  assert.equal(eff.tokensPerSuccess, 500); // 1000 total tokens / 2 successes
  assert.equal(eff.totalTokens, 1000);
  assert.equal(eff.successes, 2);
  assert.equal(eff.isEfficient, true);
});

test("efficiency: returns null tokensPerSuccess with no successes", () => {
  const metrics = new SimulationMetrics();
  metrics.track({ type: "action", agent: "a", outcome: "failure", tokensUsed: 100 });

  const eff = metrics.efficiency();
  assert.equal(eff.tokensPerSuccess, null);
});

// ── qualify ────────────────────────────────────────────

test("quality: returns score between 0 and 1 with perfect data", () => {
  const metrics = new SimulationMetrics();
  metrics.track({ type: "action", agent: "a", action: "execute", outcome: "success" });
  metrics.track({ type: "action", agent: "b", action: "review", outcome: "success" });
  metrics.track({ type: "action", agent: "a", action: "communicate", outcome: "success" });

  const q = metrics.quality();

  assert.ok(q.score >= 0);
  assert.ok(q.score <= 1);
  assert.equal(q.successRate, 1);
  assert.equal(q.failureRate, 0);
});

test("quality: returns low score for failure-heavy data", () => {
  const metrics = new SimulationMetrics();
  for (let i = 0; i < 9; i++) {
    metrics.track({ type: "action", agent: "a", action: "x", outcome: "failure" });
  }
  metrics.track({ type: "action", agent: "a", action: "x", outcome: "success" });

  const q = metrics.quality();
  assert.ok(q.score < 0.5, `Expected score < 0.5, got ${q.score}`);
  assert.equal(q.failureRate, 0.9);
});

test("quality: returns 0 with no events", () => {
  const metrics = new SimulationMetrics();
  const q = metrics.quality();

  assert.equal(q.score, 0);
});

// ── collaboration ─────────────────────────────────────

test("collaboration: high score for balanced participation", () => {
  const metrics = new SimulationMetrics();
  for (let i = 0; i < 10; i++) {
    metrics.track({ type: "action", agent: "alice" });
    metrics.track({ type: "action", agent: "bob" });
  }

  const c = metrics.collaboration();
  assert.equal(c.score, 1); // Perfectly balanced = entropy equals max
  assert.equal(c.dominanceRatio, 1);
});

test("collaboration: low score for one-sided participation", () => {
  const metrics = new SimulationMetrics();
  for (let i = 0; i < 100; i++) {
    metrics.track({ type: "action", agent: "alice" });
  }
  metrics.track({ type: "action", agent: "bob" });

  const c = metrics.collaboration();
  assert.ok(c.score < 0.5, `Expected score < 0.5, got ${c.score}`);
  assert.ok(c.dominanceRatio > 10);
});

test("collaboration: returns score 0 for fewer than 2 agents", () => {
  const metrics = new SimulationMetrics();
  metrics.track({ type: "action", agent: "solo" });
  metrics.track({ type: "action", agent: "solo" });

  const c = metrics.collaboration();
  assert.equal(c.score, 0);
  assert.equal(c.description, "Need at least 2 agents to measure collaboration.");
});

// ── compareScenarios ──────────────────────────────────

test("compareScenarios: produces comparison between two runs", () => {
  const a = new SimulationMetrics();
  a.tag("run", "A");
  a.track({ type: "action", agent: "x", outcome: "success", tokensUsed: 100 });
  a.track({ type: "action", agent: "y", outcome: "success", tokensUsed: 100 });

  const b = new SimulationMetrics();
  b.tag("run", "B");
  b.track({ type: "action", agent: "z", outcome: "failure", tokensUsed: 500 });

  const comparison = a.compareScenarios(b);

  assert.ok(comparison.comparisons.length > 0);
  assert.equal(comparison.selfTags.run, "A");
  assert.equal(comparison.otherTags.run, "B");
  assert.ok(typeof comparison.summary.selfWins === "number");
  assert.ok(typeof comparison.summary.otherWins === "number");
  assert.ok(typeof comparison.summary.ties === "number");
});

test("compareScenarios: throws on non-Metrics input", () => {
  const metrics = new SimulationMetrics();
  assert.throws(() => metrics.compareScenarios({}), {
    message: /SimulationMetrics/,
  });
  assert.throws(() => metrics.compareScenarios(null), {
    message: /SimulationMetrics/,
  });
});

// ── generateReport ─────────────────────────────────────

test("generateReport: returns structured report", () => {
  const metrics = new SimulationMetrics();
  metrics.tag("scenario", "pair_programming");
  metrics.track({ type: "action", agent: "driver", action: "write", outcome: "success", tokensUsed: 200 });
  metrics.track({ type: "action", agent: "navigator", action: "review", outcome: "success", tokensUsed: 150 });

  const report = metrics.generateReport();

  assert.ok(report.summary);
  assert.equal(report.summary.totalEvents, 2);
  assert.equal(report.summary.agentCount, 2);
  assert.equal(report.summary.totalTokens, 350);
  assert.equal(report.summary.tags.scenario, "pair_programming");
  assert.ok(report.quality);
  assert.ok(report.collaboration);
  assert.ok(report.efficiency);
  assert.ok(report.byAgent);
  assert.ok(report.byOutcome);
  assert.ok(report.byAction);
  assert.ok(report.startedAt);
  assert.ok(report.completedAt);
  assert.equal(report.raw, undefined);
});

test("generateReport: includes raw events when requested", () => {
  const metrics = new SimulationMetrics();
  metrics.track({ type: "action", agent: "a" });
  metrics.track({ type: "action", agent: "b" });

  const report = metrics.generateReport({ includeRaw: true });

  assert.ok(Array.isArray(report.raw));
  assert.equal(report.raw.length, 2);
  assert.equal(report.raw[0].agent, "a");
  assert.equal(report.raw[1].agent, "b");
});

// ── importHistory ─────────────────────────────────────

test("importHistory: imports events from a simulation history array", () => {
  const metrics = new SimulationMetrics();
  const history = [
    { event: "simulation_started", data: { scenario: "test" } },
    { event: "agent_action", data: { agent: "alpha", action: "execute", outcome: "success" } },
    { event: "agent_action", data: { agent: "beta", action: "review", outcome: "failure" } },
    { event: "step_executed", data: { step: 1 } },
  ];

  metrics.importHistory(history);

  const stats = metrics.computeStats();
  assert.equal(stats.total, 4);
  assert.equal(stats.byOutcome.success, 1);
  assert.equal(stats.byOutcome.failure, 1);
});

test("importHistory: throws on non-array input", () => {
  const metrics = new SimulationMetrics();
  assert.throws(() => metrics.importHistory("not array"), { message: /array/ });
});

// ── reset ─────────────────────────────────────────────

test("reset: clears all data", () => {
  const metrics = new SimulationMetrics();
  metrics.tag("key", "value");
  metrics.track({ type: "action", agent: "a" });
  metrics.track({ type: "action", agent: "b" });

  assert.equal(metrics.computeStats().total, 2);

  metrics.reset();

  assert.equal(metrics.computeStats().total, 0);
  assert.deepEqual(metrics.computeStats().tags, {});
});
