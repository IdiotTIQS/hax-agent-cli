/**
 * Tests for src/goals/history.js -- GoalHistory
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { GoalHistory } = require("../../src/goals/history");

function createTempPath() {
  return path.join(os.tmpdir(), `hax-gohist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`);
}

// ---- record() ---------------------------------------------------------------

test("GoalHistory: record archives a goal to JSONL file", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  const goal = {
    id: "goal-1",
    title: "Ship v2",
    description: "Release version 2",
    status: "completed",
    priority: "high",
    deadline: "2026-06-15T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-05-15T00:00:00.000Z",
    progress: { total: 5, completed: 5, percent: 100 },
    milestones: [
      { id: "m1", title: "Design", status: "completed" },
      { id: "m2", title: "Build", status: "completed" },
    ],
    subGoals: [{ id: "sg1", title: "Backend" }],
  };

  const record = history.record(goal);

  assert.equal(record.id, "goal-1");
  assert.equal(record.title, "Ship v2");
  assert.equal(record.status, "completed");
  assert.equal(record.priority, "high");
  assert.equal(record.deadlineMet, true);
  assert.equal(record.milestoneCount, 2);
  assert.equal(record.milestonesCompleted, 2);
  assert.equal(record.subGoalCount, 1);
  assert.ok(typeof record.archivedAt === "string");

  // Verify file was written
  const raw = fs.readFileSync(filePath, "utf8");
  assert.ok(raw.includes("Ship v2"));
  assert.ok(raw.includes("goal-1"));

  fs.unlinkSync(filePath);
});

test("GoalHistory: record handles abandoned goal with deadline missed", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  const record = history.record({
    id: "goal-abandoned",
    title: "Lost cause",
    status: "abandoned",
    priority: "low",
    deadline: "2025-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.000Z",
    progress: { total: 10, completed: 2, percent: 20 },
  });

  assert.equal(record.status, "abandoned");
  assert.equal(record.deadlineMet, false);

  fs.unlinkSync(filePath);
});

test("GoalHistory: record throws for invalid goal", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  assert.throws(() => history.record(null), /non-null object/);
  assert.throws(() => history.record({}), /id and title/);
  assert.throws(() => history.record({ id: "x" }), /id and title/);
  assert.throws(() => history.record({ title: "y" }), /id and title/);

  // Cleanup
  try { fs.unlinkSync(filePath); } catch (_) { /* ok */ }
});

test("GoalHistory: record with autoCommit false does not write to disk", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath, autoCommit: false });

  history.record({
    id: "goal-buf",
    title: "Buffered goal",
    status: "completed",
  });

  // File should not exist
  assert.throws(() => fs.accessSync(filePath));
});

// ---- getHistory() -----------------------------------------------------------

test("GoalHistory: getHistory returns records in descending order by default", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  history.record({ id: "g1", title: "First", status: "completed", createdAt: "2025-01-01T00:00:00.000Z" });
  history.record({ id: "g2", title: "Second", status: "completed", createdAt: "2025-02-01T00:00:00.000Z" });

  const results = history.getHistory();
  assert.equal(results.length, 2);
  // Most recently archived first
  assert.equal(results[0].id, "g2");
  assert.equal(results[1].id, "g1");

  fs.unlinkSync(filePath);
});

test("GoalHistory: getHistory with ascending sorts oldest first", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  history.record({ id: "a", title: "A", status: "completed", createdAt: "2025-01-01T00:00:00.000Z" });
  history.record({ id: "b", title: "B", status: "completed", createdAt: "2025-02-01T00:00:00.000Z" });

  const results = history.getHistory({ ascending: true });
  assert.equal(results[0].id, "a");
  assert.equal(results[1].id, "b");

  fs.unlinkSync(filePath);
});

test("GoalHistory: getHistory with status and priority filters", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  history.record({ id: "c1", title: "C1", status: "completed", priority: "high" });
  history.record({ id: "c2", title: "C2", status: "completed", priority: "low" });
  history.record({ id: "a1", title: "A1", status: "abandoned", priority: "high" });

  const completed = history.getHistory({ status: "completed" });
  assert.equal(completed.length, 2);

  const highPriority = history.getHistory({ priority: "high" });
  assert.equal(highPriority.length, 2);

  const both = history.getHistory({ status: "completed", priority: "low" });
  assert.equal(both.length, 1);
  assert.equal(both[0].id, "c2");

  fs.unlinkSync(filePath);
});

test("GoalHistory: getHistory with limit and offset", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  for (let i = 1; i <= 5; i++) {
    history.record({ id: `g${i}`, title: `Goal ${i}`, status: "completed" });
  }

  const page1 = history.getHistory({ limit: 2, offset: 0 });
  assert.equal(page1.length, 2);
  assert.equal(page1[0].id, "g5");

  const page2 = history.getHistory({ limit: 2, offset: 2 });
  assert.equal(page2.length, 2);
  assert.equal(page2[0].id, "g3");

  fs.unlinkSync(filePath);
});

// ---- getStats() -------------------------------------------------------------

test("GoalHistory: getStats returns zeroes for empty history", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  const stats = history.getStats();
  assert.equal(stats.totalGoals, 0);
  assert.equal(stats.completed, 0);
  assert.equal(stats.abandoned, 0);
  assert.equal(stats.completionRate, 0);
  assert.equal(stats.avgCompletionTimeMs, null);
  assert.equal(stats.avgMilestones, 0);
  assert.deepEqual(stats.byPriority, {});
  assert.equal(stats.deadlineMetRate, null);

  try { fs.unlinkSync(filePath); } catch (_) { /* ok */ }
});

test("GoalHistory: getStats computes correct aggregates", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  history.record({
    id: "s1", title: "S1", status: "completed", priority: "high",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-10T00:00:00.000Z",
    deadline: "2026-01-15T00:00:00.000Z",
    milestones: [{}, {}, {}],
  });
  history.record({
    id: "s2", title: "S2", status: "completed", priority: "high",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-05T00:00:00.000Z",
    deadline: "2026-01-03T00:00:00.000Z",
    milestones: [{}, {}],
  });
  history.record({
    id: "s3", title: "S3", status: "abandoned", priority: "low",
    milestones: [{}],
  });

  const stats = history.getStats();
  assert.equal(stats.totalGoals, 3);
  assert.equal(stats.completed, 2);
  assert.equal(stats.abandoned, 1);
  assert.equal(stats.completionRate, 67);

  // avg milestons = (3+2+1)/3 = 2
  assert.equal(stats.avgMilestones, 2);

  // 1 of 2 deadlines met
  assert.equal(stats.deadlineMetRate, 50);

  // Priority breakdown
  assert.equal(stats.byPriority.high.total, 2);
  assert.equal(stats.byPriority.high.completed, 2);
  assert.equal(stats.byPriority.low.total, 1);
  assert.equal(stats.byPriority.low.abandoned, 1);

  fs.unlinkSync(filePath);
});

// ---- getInsights() ----------------------------------------------------------

test("GoalHistory: getInsights returns recommendation for empty history", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  const insights = history.getInsights();
  assert.equal(insights.totalAnalyzed, 0);
  assert.ok(insights.recommendation.includes("Not enough data"));

  try { fs.unlinkSync(filePath); } catch (_) { /* ok */ }
});

test("GoalHistory: getInsights with data returns patterns", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  history.record({
    id: "i1", title: "Add user authentication",
    status: "completed", priority: "high",
    milestones: [{}, {}, {}],
  });
  history.record({
    id: "i2", title: "Fix login bug fix",
    status: "abandoned", priority: "high",
    milestones: [{}, {}, {}, {}, {}],
  });

  const insights = history.getInsights();
  assert.equal(insights.totalAnalyzed, 2);
  assert.ok(insights.successByPriority.high);
  assert.equal(insights.successByPriority.high.rate, 50);
  assert.equal(insights.averageMilestonesForSuccess, 3);
  assert.equal(insights.averageMilestonesForFailure, 5);
  assert.ok(insights.commonPhases.length >= 1);
  assert.ok(insights.recommendation.length > 0);

  fs.unlinkSync(filePath);
});

// ---- getStreak() ------------------------------------------------------------

test("GoalHistory: getStreak with no records returns zeros", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  const streak = history.getStreak();
  assert.equal(streak.current, 0);
  assert.equal(streak.longest, 0);

  try { fs.unlinkSync(filePath); } catch (_) { /* ok */ }
});

test("GoalHistory: getStreak computes current and longest", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  // completed, completed, abandoned, completed, completed, completed
  history.record({ id: "k1", title: "K1", status: "completed" });
  history.record({ id: "k2", title: "K2", status: "completed" });
  history.record({ id: "k3", title: "K3", status: "abandoned" });
  history.record({ id: "k4", title: "K4", status: "completed" });
  history.record({ id: "k5", title: "K5", status: "completed" });
  history.record({ id: "k6", title: "K6", status: "completed" });

  const streak = history.getStreak();
  assert.equal(streak.current, 3);  // k4, k5, k6
  assert.equal(streak.longest, 3);  // also 3

  fs.unlinkSync(filePath);
});

test("GoalHistory: getStreak current is zero when last is abandoned", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  history.record({ id: "x1", title: "X1", status: "completed" });
  history.record({ id: "x2", title: "X2", status: "abandoned" });

  const streak = history.getStreak();
  assert.equal(streak.current, 0);
  assert.equal(streak.longest, 1);

  fs.unlinkSync(filePath);
});

// ---- count / clear ----------------------------------------------------------

test("GoalHistory: count returns number of archived records", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  assert.equal(history.count(), 0);
  history.record({ id: "c1", title: "C1", status: "completed" });
  assert.equal(history.count(), 1);
  history.record({ id: "c2", title: "C2", status: "completed" });
  assert.equal(history.count(), 2);

  fs.unlinkSync(filePath);
});

test("GoalHistory: clear removes all records", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  history.record({ id: "d1", title: "D1", status: "completed" });
  history.record({ id: "d2", title: "D2", status: "completed" });
  assert.equal(history.count(), 2);

  const removed = history.clear();
  assert.equal(removed, 2);
  assert.equal(history.count(), 0);
  assert.throws(() => fs.accessSync(filePath));
});

test("GoalHistory: clear is safe on empty history", () => {
  const filePath = createTempPath();
  const history = new GoalHistory({ filePath });

  const removed = history.clear();
  assert.equal(removed, 0);
});
