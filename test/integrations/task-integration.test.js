"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createTeamTasks,
  trackTeamProgress,
  exportTaskStatus,
} = require("../../src/integrations/task-integration");

const { TaskTracker } = require("../../src/tasks/tracker");
const { TeamRuntime } = require("../../src/teams/runtime");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSamplePlan(name, overrides) {
  return {
    name: name || "test-team",
    mission: "Test mission",
    members: [],
    tasks: [
      { id: "T1", title: "Explore repo", dependsOn: [] },
      { id: "T2", title: "Plan approach", dependsOn: ["T1"] },
      { id: "T3", title: "Implement feature", dependsOn: ["T2"] },
      { id: "T4", title: "Write tests", dependsOn: ["T3"] },
      { id: "T5", title: "Review changes", dependsOn: ["T3"] },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createTeamTasks
// ---------------------------------------------------------------------------

test("createTeamTasks: builds resolver and tracker from a plan", () => {
  const plan = buildSamplePlan();
  const result = createTeamTasks({ plan });

  assert.ok(result.resolver, "should return a resolver");
  assert.ok(result.tracker, "should return a tracker");
  assert.equal(result.resolver.size, 5, "resolver should have 5 tasks");
  assert.equal(result.tracker.size, 5, "tracker should have 5 tasks");
  assert.ok(result.graph.valid, "graph should be valid (no cycles)");
  assert.equal(result.graph.errors.length, 0, "no errors expected");
  assert.deepEqual(
    result.graph.executionOrder,
    ["T1", "T2", "T3", "T4", "T5"],
    "execution order should respect dependencies",
  );
});

test("createTeamTasks: throws when plan is missing", () => {
  assert.throws(
    () => createTeamTasks({}),
    /plan is required/,
    "should throw on missing plan",
  );
  assert.throws(
    () => createTeamTasks(null),
    /plan is required/,
    "should throw on null input",
  );
});

test("createTeamTasks: throws when plan has no tasks", () => {
  assert.throws(
    () => createTeamTasks({ plan: { name: "empty", tasks: [] } }),
    /no tasks/,
    "should throw on empty task list",
  );
});

test("createTeamTasks: reports parallel groups correctly", () => {
  const plan = buildSamplePlan("parallel-test");
  const result = createTeamTasks({ plan });

  const groups = result.graph.parallelGroups;
  assert.ok(groups.length >= 4, "should have at least 4 parallel levels");

  // T1 alone at level 0
  const level0 = groups[0];
  assert.ok(level0.includes("T1"), "level 0 should include T1");
  assert.equal(level0.length, 1, "level 0 should have only T1");

  // T4 and T5 should be at the same level (both depend on T3)
  const lastGroup = groups[groups.length - 1];
  assert.ok(lastGroup.includes("T4") && lastGroup.includes("T5"),
    "T4 and T5 should be in the same parallel group");
});

test("createTeamTasks: reports critical path", () => {
  const plan = buildSamplePlan("critical-path-test");
  const result = createTeamTasks({ plan });

  const cp = result.graph.criticalPath;
  assert.ok(cp.length > 0, "critical path should not be empty");
  // Longest chain: T1 -> T2 -> T3 -> T4 (or T5), length 4
  assert.equal(cp.length, 4, "critical path should have 4 tasks");
});

test("createTeamTasks: detects cycles", () => {
  const plan = buildSamplePlan("cycle-test", {
    tasks: [
      { id: "A", title: "A", dependsOn: ["B"] },
      { id: "B", title: "B", dependsOn: ["C"] },
      { id: "C", title: "C", dependsOn: ["A"] },
    ],
  });

  const result = createTeamTasks({ plan });
  assert.equal(result.graph.valid, false, "graph should be invalid (has cycle)");
  assert.ok(result.graph.errors.some((e) => /circular/i.test(e)),
    "errors should mention circular dependency");
});

// ---------------------------------------------------------------------------
// exportTaskStatus
// ---------------------------------------------------------------------------

test("exportTaskStatus: exports display-ready format", () => {
  const tracker = new TaskTracker({
    tasks: [
      { id: "t1", title: "Task One" },
      { id: "t2", title: "Task Two" },
    ],
  });

  tracker.start("t1");
  tracker.complete("t1", "done");

  const exported = exportTaskStatus(tracker);

  assert.equal(exported.tasks.length, 2, "should export 2 tasks");
  assert.equal(exported.progress.total, 2, "progress total should be 2");
  assert.equal(exported.progress.done, 1, "progress done should be 1");
  assert.ok(typeof exported.summary === "string", "summary should be a string");
  assert.ok(
    exported.summary.includes("1/2"),
    "summary should mention completion count",
  );

  // Check task-level fields
  const t1 = exported.tasks.find((t) => t.id === "t1");
  assert.equal(t1.status, "completed");
  assert.equal(t1.statusLabel, "Completed");
  assert.equal(t1.result, "done");

  const t2 = exported.tasks.find((t) => t.id === "t2");
  assert.equal(t2.status, "pending");
  assert.equal(t2.statusLabel, "Pending");
});

test("exportTaskStatus: throws on invalid tracker", () => {
  assert.throws(() => exportTaskStatus(null), /TaskTracker/);
  assert.throws(() => exportTaskStatus({}), /TaskTracker/);
});

// ---------------------------------------------------------------------------
// trackTeamProgress
// ---------------------------------------------------------------------------

test("trackTeamProgress: returns stop function", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "t1" }, { id: "t2" }],
  });

  // We don't have a real TeamRuntime here without a file system fixture,
  // but we can test the API surface.
  const mockRuntime = {
    snapshot() {
      return {
        tasks: [
          { id: "t1", status: "pending", dependsOn: [] },
          { id: "t2", status: "pending", dependsOn: [] },
        ],
      };
    },
    getProgress() {
      return { total: 2, completed: 0, failed: 0, active: 0, pending: 2, percentComplete: 0, counts: {} };
    },
  };

  const result = trackTeamProgress(mockRuntime, tracker, { autoStart: false });
  assert.equal(typeof result.stop, "function", "should return a stop function");
  assert.strictEqual(result.tracker, tracker, "should return the same tracker");
});

test("trackTeamProgress: throws on invalid inputs", () => {
  const tracker = new TaskTracker();
  assert.throws(
    () => trackTeamProgress(null, tracker),
    /TeamRuntime/,
    "should throw on null runtime",
  );
  assert.throws(
    () => trackTeamProgress({ snapshot: () => {} }, null),
    /TaskTracker/,
    "should throw on null tracker",
  );
});
