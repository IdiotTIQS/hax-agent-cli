/**
 * Tests for src/goals/tracker.js -- GoalTracker
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  GoalTracker,
  VALID_GOAL_STATUSES,
  VALID_PRIORITIES,
  VALID_MILESTONE_STATUSES,
} = require("../../src/goals/tracker");

// ---- Goal creation ----------------------------------------------------------

test("GoalTracker: setGoal creates a goal with defaults", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({ title: "Ship v2.0" });

  assert.ok(typeof goal.id === "string");
  assert.ok(goal.id.startsWith("goal-"));
  assert.equal(goal.title, "Ship v2.0");
  assert.equal(goal.description, "");
  assert.deepEqual(goal.milestones, []);
  assert.deepEqual(goal.subGoals, []);
  assert.equal(goal.status, "active");
  assert.equal(goal.priority, "medium");
  assert.equal(goal.deadline, null);
  assert.equal(goal.manualProgress, null);
  assert.ok(typeof goal.createdAt === "string");
  assert.ok(typeof goal.updatedAt === "string");
  assert.equal(goal.completedAt, null);
});

test("GoalTracker: setGoal with all fields populated", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({
    title: "Full Goal",
    description: "A fully specified goal",
    status: "paused",
    priority: "critical",
    deadline: "2026-12-31T23:59:59.000Z",
    milestones: [
      { title: "ms-1" },
      { title: "ms-2", status: "inProgress" },
    ],
    subGoals: [{ title: "sg-1" }],
  });

  assert.equal(goal.title, "Full Goal");
  assert.equal(goal.description, "A fully specified goal");
  assert.equal(goal.status, "paused");
  assert.equal(goal.priority, "critical");
  assert.equal(goal.deadline, "2026-12-31T23:59:59.000Z");
  assert.equal(goal.milestones.length, 2);
  assert.equal(goal.milestones[0].title, "ms-1");
  assert.equal(goal.milestones[1].status, "inProgress");
  assert.equal(goal.subGoals.length, 1);
  assert.equal(goal.subGoals[0].title, "sg-1");
});

test("GoalTracker: setGoal throws for missing title", () => {
  const tracker = new GoalTracker();
  assert.throws(() => tracker.setGoal({ description: "no title" }), /title/);
  assert.throws(() => tracker.setGoal({ title: "" }), /title/);
  assert.throws(() => tracker.setGoal({ title: "  " }), /title/);
  assert.throws(() => tracker.setGoal(null), /object/);
});

test("GoalTracker: setGoal throws for duplicate ID", () => {
  const tracker = new GoalTracker();
  const id = "my-custom-id";
  tracker.setGoal({ id, title: "First" });
  assert.throws(() => tracker.setGoal({ id, title: "Second" }), /already exists/);
});

// ---- Milestones -------------------------------------------------------------

test("GoalTracker: addMilestone appends to existing goal", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({ title: "Milestone Test" });

  const updated = tracker.addMilestone(goal.id, { title: "Design API" });
  assert.equal(updated.milestones.length, 1);
  assert.equal(updated.milestones[0].title, "Design API");
  assert.equal(updated.milestones[0].status, "pending");
  assert.ok(typeof updated.milestones[0].id === "string");
});

test("GoalTracker: markMilestone transitions through statuses", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({ title: "Status Flow", milestones: [{ title: "Step 1" }] });
  const msId = goal.milestones[0].id;

  // pending -> inProgress
  let updated = tracker.markMilestone(goal.id, msId, "inProgress");
  assert.equal(updated.milestones[0].status, "inProgress");
  assert.ok(typeof updated.milestones[0].startedAt === "string");

  // inProgress -> completed
  updated = tracker.markMilestone(goal.id, msId, "completed");
  assert.equal(updated.milestones[0].status, "completed");
  assert.ok(typeof updated.milestones[0].completedAt === "string");
});

test("GoalTracker: markMilestone throws for invalid status", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({ title: "Bad Status", milestones: [{ title: "Step" }] });
  assert.throws(
    () => tracker.markMilestone(goal.id, goal.milestones[0].id, "nonsense"),
    /Invalid milestone status/,
  );
});

test("GoalTracker: markMilestone throws for unknown milestone", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({ title: "Unknown Milestone" });
  assert.throws(
    () => tracker.markMilestone(goal.id, "nonexistent", "completed"),
    /not found/,
  );
});

// ---- Sub-goals --------------------------------------------------------------

test("GoalTracker: addSubGoal adds a sub-goal", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({ title: "Big Goal" });

  const updated = tracker.addSubGoal(goal.id, { title: "Sub-task A", description: "Do part A" });
  assert.equal(updated.subGoals.length, 1);
  assert.equal(updated.subGoals[0].title, "Sub-task A");
  assert.equal(updated.subGoals[0].description, "Do part A");
  assert.equal(updated.subGoals[0].status, "active");
});

test("GoalTracker: addSubGoal throws for missing title", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({ title: "No Sub" });
  assert.throws(() => tracker.addSubGoal(goal.id, { description: "no title" }), /title/);
  assert.throws(() => tracker.addSubGoal(goal.id, null), /title/);
});

// ---- Progress ---------------------------------------------------------------

test("GoalTracker: getProgress computes from milestones", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({
    title: "Progress Check",
    milestones: [
      { title: "A", status: "completed" },
      { title: "B", status: "completed" },
      { title: "C", status: "pending" },
    ],
  });

  const progress = tracker.getProgress(goal.id);
  assert.equal(progress.total, 3);
  assert.equal(progress.completed, 2);
  assert.equal(progress.percent, 67); // 2/3 rounded
  assert.equal(progress.currentPhase, "C");
});

test("GoalTracker: getProgress returns 0 when no milestones", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({ title: "No Milestones" });
  const progress = tracker.getProgress(goal.id);
  assert.equal(progress.total, 0);
  assert.equal(progress.completed, 0);
  assert.equal(progress.percent, 0);
  assert.equal(progress.currentPhase, null);
});

test("GoalTracker: updateProgress sets manual override", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({
    title: "Manual Progress",
    milestones: [{ title: "Step", status: "pending" }],
  });

  let updated = tracker.updateProgress(goal.id, 42);
  assert.equal(updated.manualProgress, 42);

  const progress = tracker.getProgress(goal.id);
  assert.equal(progress.percent, 42);
  assert.equal(progress.total, 100);
});

test("GoalTracker: updateProgress to 100 auto-completes goal", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({ title: "Auto Complete" });

  const updated = tracker.updateProgress(goal.id, 100);
  assert.equal(updated.status, "completed");
  assert.notEqual(updated.completedAt, null);
});

test("GoalTracker: updateProgress throws for invalid values", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({ title: "Bad Progress" });
  assert.throws(() => tracker.updateProgress(goal.id, -1), /between 0 and 100/);
  assert.throws(() => tracker.updateProgress(goal.id, 101), /between 0 and 100/);
  assert.throws(() => tracker.updateProgress(goal.id, NaN), /between 0 and 100/);
  assert.throws(() => tracker.updateProgress(goal.id, "fifty"), /between 0 and 100/);
});

// ---- Completion check -------------------------------------------------------

test("GoalTracker: isComplete returns true when all milestones done", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({
    title: "Done",
    milestones: [
      { title: "A", status: "completed" },
      { title: "B", status: "skipped" },
    ],
  });

  assert.equal(tracker.isComplete(goal.id), true);
});

test("GoalTracker: isComplete returns false when some pending", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({
    title: "Not Done",
    milestones: [
      { title: "A", status: "completed" },
      { title: "B", status: "pending" },
    ],
  });

  assert.equal(tracker.isComplete(goal.id), false);
});

test("GoalTracker: isComplete returns false when no milestones", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({ title: "Empty" });
  assert.equal(tracker.isComplete(goal.id), false);
});

test("GoalTracker: isComplete respects manual progress 100", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({ title: "Manual Done" });
  tracker.updateProgress(goal.id, 100);
  assert.equal(tracker.isComplete(goal.id), true);
});

// ---- Lifecycle events -------------------------------------------------------

test("GoalTracker: emits goal.created on setGoal", (_, done) => {
  const tracker = new GoalTracker();
  tracker.once("goal.created", (evt) => {
    assert.equal(evt.title, "Event Test");
    assert.equal(evt.priority, "medium");
    done();
  });
  tracker.setGoal({ title: "Event Test" });
});

test("GoalTracker: emits goal.completed when all milestones transition", (_, done) => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({
    title: "Completed Event",
    milestones: [{ title: "Only step" }],
  });

  tracker.once("goal.completed", (evt) => {
    assert.equal(evt.goalId, goal.id);
    assert.equal(evt.title, "Completed Event");
    done();
  });

  tracker.markMilestone(goal.id, goal.milestones[0].id, "completed");
});

test("GoalTracker: emits milestone.updated on status change", (_, done) => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({
    title: "Milestone Event",
    milestones: [{ title: "Step" }],
  });

  tracker.once("milestone.updated", (evt) => {
    assert.equal(evt.goalId, goal.id);
    assert.equal(evt.status, "completed");
    done();
  });

  tracker.markMilestone(goal.id, goal.milestones[0].id, "completed");
});

// ---- Listing and removal ----------------------------------------------------

test("GoalTracker: listGoals returns all goal IDs", () => {
  const tracker = new GoalTracker();
  const a = tracker.setGoal({ title: "A" });
  const b = tracker.setGoal({ title: "B" });
  const ids = tracker.listGoals();

  assert.deepStrictEqual(ids.sort(), [a.id, b.id].sort());
});

test("GoalTracker: listGoalSummaries with status filter", () => {
  const tracker = new GoalTracker();
  const a = tracker.setGoal({ title: "Active", status: "active" });
  const b = tracker.setGoal({ title: "Paused", status: "paused" });

  const actives = tracker.listGoalSummaries("active");
  assert.equal(actives.length, 1);
  assert.equal(actives[0].id, a.id);

  const all = tracker.listGoalSummaries();
  assert.equal(all.length, 2);
});

test("GoalTracker: setStatus changes goal status", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({ title: "Pause Me" });

  const updated = tracker.setStatus(goal.id, "paused");
  assert.equal(updated.status, "paused");

  tracker.setStatus(goal.id, "abandoned");
  const abandoned = tracker.getGoal(goal.id);
  assert.equal(abandoned.status, "abandoned");
});

test("GoalTracker: setStatus throws for invalid status", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({ title: "Bad" });
  assert.throws(() => tracker.setStatus(goal.id, "invalid"), /Invalid status/);
});

test("GoalTracker: removeGoal deletes and returns boolean", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({ title: "Remove Me" });

  assert.equal(tracker.removeGoal(goal.id), true);
  assert.equal(tracker.listGoals().length, 0);
  assert.equal(tracker.removeGoal("nonexistent"), false);
});

test("GoalTracker: getGoal throws for unknown ID", () => {
  const tracker = new GoalTracker();
  assert.throws(() => tracker.getGoal("nonexistent"), /not found/);
});

// ---- Sub-goal auto-completion -----------------------------------------------

test("GoalTracker: sub-goal auto-completes when all its milestones done", () => {
  const tracker = new GoalTracker();
  const sgId = "sg-fixed";
  const goal = tracker.setGoal({
    title: "Auto Sub-goal",
    subGoals: [{ id: sgId, title: "Sub A" }],
    milestones: [
      { title: "M1", subGoalId: sgId, status: "pending" },
      { title: "M2", subGoalId: sgId, status: "pending" },
    ],
  });

  tracker.markMilestone(goal.id, goal.milestones[0].id, "completed");
  tracker.markMilestone(goal.id, goal.milestones[1].id, "completed");

  const updated = tracker.getGoal(goal.id);
  assert.equal(updated.subGoals[0].status, "completed");
  assert.equal(updated.status, "completed");
});

// ---- currentPhase -----------------------------------------------------------

test("GoalTracker: currentPhase shows in-progress milestone", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({
    title: "Phases",
    milestones: [
      { title: "Setup", status: "completed" },
      { title: "Build", status: "inProgress" },
      { title: "Deploy", status: "pending" },
    ],
  });

  const progress = tracker.getProgress(goal.id);
  assert.equal(progress.currentPhase, "Build");
});

test("GoalTracker: currentPhase shows first pending when none in-progress", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({
    title: "Pending Phase",
    milestones: [
      { title: "Step 1", status: "completed" },
      { title: "Step 2", status: "pending" },
    ],
  });

  const progress = tracker.getProgress(goal.id);
  assert.equal(progress.currentPhase, "Step 2");
});

test("GoalTracker: currentPhase says 'all complete' when everything done", () => {
  const tracker = new GoalTracker();
  const goal = tracker.setGoal({
    title: "All Done",
    milestones: [{ title: "Step", status: "completed" }],
  });

  const progress = tracker.getProgress(goal.id);
  assert.equal(progress.currentPhase, "all complete");
});

// ---- Exported constants -----------------------------------------------------

test("GoalTracker: exported constant sets match expected values", () => {
  assert.ok(VALID_GOAL_STATUSES.has("active"));
  assert.ok(VALID_GOAL_STATUSES.has("completed"));
  assert.ok(VALID_GOAL_STATUSES.has("abandoned"));
  assert.ok(VALID_GOAL_STATUSES.has("paused"));

  assert.ok(VALID_PRIORITIES.has("low"));
  assert.ok(VALID_PRIORITIES.has("medium"));
  assert.ok(VALID_PRIORITIES.has("high"));
  assert.ok(VALID_PRIORITIES.has("critical"));

  assert.ok(VALID_MILESTONE_STATUSES.has("pending"));
  assert.ok(VALID_MILESTONE_STATUSES.has("inProgress"));
  assert.ok(VALID_MILESTONE_STATUSES.has("completed"));
  assert.ok(VALID_MILESTONE_STATUSES.has("blocked"));
  assert.ok(VALID_MILESTONE_STATUSES.has("skipped"));
});
