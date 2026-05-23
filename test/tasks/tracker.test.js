/**
 * Tests for TaskTracker.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { TaskTracker, STATUS } = require("../../src/tasks/tracker");

test("TaskTracker: initializes with empty state", () => {
  const tracker = new TaskTracker();
  assert.equal(tracker.size, 0);
  const progress = tracker.getProgress();
  assert.equal(progress.total, 0);
  assert.equal(progress.done, 0);
  assert.equal(progress.inProgress, 0);
  assert.equal(progress.blocked, 0);
  assert.equal(progress.failed, 0);
  assert.equal(progress.percent, 0);
});

test("TaskTracker: initializes with pre-registered tasks", () => {
  const tracker = new TaskTracker({
    tasks: [
      { id: "T1", title: "Design" },
      { id: "T2", title: "Implement" },
      { id: "T3", title: "Test" },
    ],
  });
  assert.equal(tracker.size, 3);
  const statuses = tracker.getStatus();
  assert.equal(statuses.length, 3);
  for (const s of statuses) {
    assert.equal(s.status, STATUS.PENDING);
  }
});

test("TaskTracker: start transitions pending task to in_progress", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1", title: "Setup" }],
  });

  const ok = tracker.start("T1");
  assert.equal(ok, true);

  const task = tracker.getTask("T1");
  assert.equal(task.status, STATUS.IN_PROGRESS);
  assert.ok(task.startedAt);
});

test("TaskTracker: start rejects invalid transitions", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }],
  });

  tracker.start("T1");
  // Already started -- should fail
  const ok = tracker.start("T1");
  assert.equal(ok, false);

  // Unknown task
  assert.equal(tracker.start("MISSING"), false);
});

test("TaskTracker: complete transitions in_progress to completed", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }],
  });

  tracker.start("T1");
  const ok = tracker.complete("T1", { output: 42 });
  assert.equal(ok, true);

  const task = tracker.getTask("T1");
  assert.equal(task.status, STATUS.COMPLETED);
  assert.deepEqual(task.result, { output: 42 });
  assert.ok(task.completedAt);

  const progress = tracker.getProgress();
  assert.equal(progress.done, 1);
  assert.equal(progress.percent, 100);
});

test("TaskTracker: complete rejects if not in_progress", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }],
  });

  // Not started yet
  assert.equal(tracker.complete("T1"), false);

  // Already failed
  tracker.start("T1");
  tracker.fail("T1", "error");
  assert.equal(tracker.complete("T1"), false);
});

test("TaskTracker: fail transitions to failed and stores error", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }],
  });

  const ok = tracker.fail("T1", new Error("something broke"));
  assert.equal(ok, true);

  const task = tracker.getTask("T1");
  assert.equal(task.status, STATUS.FAILED);
  assert.ok(task.error);

  const progress = tracker.getProgress();
  assert.equal(progress.failed, 1);
  assert.equal(progress.percent, 100);
});

test("TaskTracker: fail rejects if already completed or failed", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }],
  });

  tracker.start("T1");
  tracker.complete("T1");
  assert.equal(tracker.fail("T1"), false);
});

test("TaskTracker: block marks task as blocked with reason", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }, { id: "T2" }],
  });

  tracker.start("T1");
  const ok = tracker.block("T1", "Waiting for CI");

  assert.equal(ok, true);
  const task = tracker.getTask("T1");
  assert.equal(task.status, STATUS.BLOCKED);
  assert.equal(task.reason, "Waiting for CI");

  // T2 is still pending
  const progress = tracker.getProgress();
  assert.equal(progress.blocked, 1);
  assert.equal(progress.total, 2);
});

test("TaskTracker: block works from pending state too", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }],
  });

  const ok = tracker.block("T1", "No description yet");
  assert.equal(ok, true);

  const task = tracker.getTask("T1");
  assert.equal(task.status, STATUS.BLOCKED);
});

test("TaskTracker: block rejects if already terminal", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }],
  });

  tracker.start("T1");
  tracker.complete("T1");
  assert.equal(tracker.block("T1", "late"), false);
});

test("TaskTracker: getProgress returns correct percentages", () => {
  const tracker = new TaskTracker({
    tasks: [
      { id: "A" },
      { id: "B" },
      { id: "C" },
      { id: "D" },
    ],
  });

  tracker.start("A");
  tracker.start("B");
  tracker.complete("A");
  tracker.block("C", "waiting");

  const progress = tracker.getProgress();
  assert.equal(progress.total, 4);
  assert.equal(progress.done, 1);
  assert.equal(progress.inProgress, 1);
  assert.equal(progress.blocked, 1);
  assert.equal(progress.failed, 0);
  assert.equal(progress.percent, 25); // 1 done of 4
});

test("TaskTracker: getStatus returns all task states", () => {
  const tracker = new TaskTracker({
    tasks: [
      { id: "A", title: "Alpha" },
      { id: "B", title: "Beta" },
    ],
  });

  tracker.start("A");
  tracker.block("B", "blocked");

  const statuses = tracker.getStatus();
  assert.equal(statuses.length, 2);
  assert.equal(statuses[0].title, "Alpha");
  assert.equal(statuses[0].status, STATUS.IN_PROGRESS);
  assert.equal(statuses[1].title, "Beta");
  assert.equal(statuses[1].status, STATUS.BLOCKED);
  assert.equal(statuses[1].reason, "blocked");
});

test("TaskTracker: emits task:start event", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }],
  });

  let emitted = null;
  tracker.on("task:start", (data) => {
    emitted = data;
  });

  tracker.start("T1");
  assert.ok(emitted);
  assert.equal(emitted.id, "T1");
  assert.ok(emitted.progress);
});

test("TaskTracker: emits task:complete event", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }],
  });

  let emitted = null;
  tracker.on("task:complete", (data) => {
    emitted = data;
  });

  tracker.start("T1");
  tracker.complete("T1", "done");

  assert.ok(emitted);
  assert.equal(emitted.id, "T1");
  assert.equal(emitted.result, "done");
});

test("TaskTracker: emits task:fail event", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }],
  });

  let emitted = null;
  tracker.on("task:fail", (data) => {
    emitted = data;
  });

  tracker.fail("T1", "crashed");

  assert.ok(emitted);
  assert.equal(emitted.id, "T1");
  assert.equal(emitted.error, "crashed");
});

test("TaskTracker: emits task:block event", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }],
  });

  let emitted = null;
  tracker.on("task:block", (data) => {
    emitted = data;
  });

  tracker.block("T1", "external dep");

  assert.ok(emitted);
  assert.equal(emitted.id, "T1");
  assert.equal(emitted.reason, "external dep");
});

test("TaskTracker: emits all:complete when all tasks terminal", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }, { id: "T2" }],
  });

  let emitted = null;
  tracker.on("all:complete", (data) => {
    emitted = data;
  });

  tracker.start("T1");
  tracker.complete("T1");
  // Not all done yet
  assert.equal(emitted, null);

  tracker.start("T2");
  tracker.complete("T2");
  // Now all done
  assert.ok(emitted);
  assert.equal(emitted.completedCount, 2);
  assert.equal(emitted.failedCount, 0);
  assert.equal(emitted.progress.percent, 100);
});

test("TaskTracker: emits all:complete with mix of done and failed", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }, { id: "T2" }],
  });

  let emitted = null;
  tracker.on("all:complete", (data) => {
    emitted = data;
  });

  tracker.start("T1");
  tracker.complete("T1");
  tracker.fail("T2", "error");

  assert.ok(emitted);
  assert.equal(emitted.completedCount, 1);
  assert.equal(emitted.failedCount, 1);
});

test("TaskTracker: reset clears all task states back to pending", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }, { id: "T2" }],
  });

  tracker.start("T1");
  tracker.complete("T1", "result");
  tracker.block("T2", "reason");

  tracker.reset();

  const statuses = tracker.getStatus();
  for (const s of statuses) {
    assert.equal(s.status, STATUS.PENDING);
    assert.equal(s.result, undefined);
    assert.equal(s.error, undefined);
    assert.equal(s.reason, undefined);
    assert.equal(s.startedAt, null);
    assert.equal(s.completedAt, null);
  }
});

test("TaskTracker: clear removes all tasks", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1" }, { id: "T2" }],
  });

  assert.equal(tracker.size, 2);
  tracker.clear();
  assert.equal(tracker.size, 0);
  assert.equal(tracker.getStatus().length, 0);
  assert.equal(tracker.getProgress().total, 0);
});

test("TaskTracker: getTask returns individual task state", () => {
  const tracker = new TaskTracker({
    tasks: [{ id: "T1", title: "Test" }],
  });

  tracker.start("T1");
  const task = tracker.getTask("T1");
  assert.equal(task.id, "T1");
  assert.equal(task.title, "Test");
  assert.equal(task.status, STATUS.IN_PROGRESS);
  assert.ok(task.startedAt);
});

test("TaskTracker: getTask returns undefined for unknown id", () => {
  const tracker = new TaskTracker();
  assert.equal(tracker.getTask("nope"), undefined);
});

test("TaskTracker: STATUS export matches expected values", () => {
  assert.equal(STATUS.PENDING, "pending");
  assert.equal(STATUS.IN_PROGRESS, "in_progress");
  assert.equal(STATUS.COMPLETED, "completed");
  assert.equal(STATUS.FAILED, "failed");
  assert.equal(STATUS.BLOCKED, "blocked");
});
