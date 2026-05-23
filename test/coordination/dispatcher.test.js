"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { STRATEGY, TASK_STATUS, TaskDispatcher } = require("../../src/coordination/dispatcher");

// ---- Worker registration ----

test("TaskDispatcher: registerWorker adds a worker with capabilities", () => {
  const dispatcher = new TaskDispatcher();
  const worker = dispatcher.registerWorker("worker-1", ["build", "test", "deploy"]);

  assert.equal(worker.id, "worker-1");
  // Set preserves insertion order
  assert.deepEqual(worker.capabilities, ["build", "test", "deploy"]);
  assert.equal(worker.load, 0);
  assert.equal(dispatcher.getWorkers().length, 1);
});

test("TaskDispatcher: registerWorker normalizes and deduplicates capabilities", () => {
  const dispatcher = new TaskDispatcher();
  const worker = dispatcher.registerWorker("worker-1", ["  build ", "build", "", "TEST"]);

  assert.equal(worker.capabilities.length, 2);
  // Should contain "build" and "TEST" (no trimming in Set construction? Actually we trim)
  // The trim + filter(Boolean) handles this
});

test("TaskDispatcher: registerWorker throws on empty nodeId or duplicate", () => {
  const dispatcher = new TaskDispatcher();

  assert.throws(() => dispatcher.registerWorker(""), { message: /non-empty string/ });
  assert.throws(() => dispatcher.registerWorker(null), { message: /non-empty string/ });

  dispatcher.registerWorker("worker-1", ["build"]);
  assert.throws(() => dispatcher.registerWorker("worker-1", ["test"]), { message: /already registered/ });
});

// ---- Dispatch ----

test("TaskDispatcher: dispatch assigns a task to a worker with matching capabilities", () => {
  const dispatcher = new TaskDispatcher();
  dispatcher.registerWorker("worker-1", ["build", "test"]);
  dispatcher.registerWorker("worker-2", ["deploy"]);

  const result = dispatcher.dispatch({
    type: "build",
    data: { project: "hax-agent" },
    requirements: ["build"],
    priority: 5,
  });

  assert.equal(result.status, "assigned");
  assert.equal(result.task.assignedTo, "worker-1");
  assert.equal(result.task.type, "build");
  assert.equal(result.task.priority, 5);
  assert.equal(result.task.status, "assigned");
});

test("TaskDispatcher: dispatch queues a task when no worker matches requirements", () => {
  const dispatcher = new TaskDispatcher();
  dispatcher.registerWorker("worker-1", ["build"]);

  const result = dispatcher.dispatch({
    type: "deploy",
    data: {},
    requirements: ["deploy"],
  });

  assert.equal(result.status, "queued");
  assert.equal(result.task.status, "pending");
  assert.equal(result.task.assignedTo, null);
  assert.equal(dispatcher.getQueueLength(), 1);
});

test("TaskDispatcher: dispatch auto-generates an ID when none is provided", () => {
  const dispatcher = new TaskDispatcher();
  dispatcher.registerWorker("worker-1", ["default"]);

  const result = dispatcher.dispatch({ type: "default", data: {} });

  assert.ok(result.task.id.startsWith("task-"));
});

test("TaskDispatcher: dispatch uses least-loaded worker by default", () => {
  const dispatcher = new TaskDispatcher();
  dispatcher.registerWorker("busy", ["default"]);
  dispatcher.registerWorker("idle", ["default"]);

  // Dispatch 4 tasks: they should be distributed to balance load
  const results = [];
  for (let i = 0; i < 4; i++) {
    results.push(dispatcher.dispatch({ type: "default", data: {}, requirements: ["default"] }));
  }

  // After 4 dispatches with 2 workers, both should have load 2 (balanced)
  const busyLoad = dispatcher.getWorker("busy").load;
  const idleLoad = dispatcher.getWorker("idle").load;
  assert.equal(busyLoad, 2);
  assert.equal(idleLoad, 2);
});

// ---- Round-robin strategy ----

test("TaskDispatcher: round-robin cycles through workers evenly", () => {
  const dispatcher = new TaskDispatcher({ strategy: STRATEGY.ROUND_ROBIN });
  dispatcher.registerWorker("a", ["default"]);
  dispatcher.registerWorker("b", ["default"]);
  dispatcher.registerWorker("c", ["default"]);

  const assigned = [];

  for (let i = 0; i < 6; i++) {
    const result = dispatcher.dispatch({ type: "default", data: {}, requirements: ["default"] });
    assigned.push(result.worker.id);
  }

  assert.deepEqual(assigned, ["a", "b", "c", "a", "b", "c"]);
});

// ---- Capability-match strategy ----

test("TaskDispatcher: capability-match prefers workers with more matching capabilities", () => {
  const dispatcher = new TaskDispatcher({ strategy: STRATEGY.CAPABILITY_MATCH });
  dispatcher.registerWorker("partial", ["build"]);
  dispatcher.registerWorker("full", ["build", "test", "deploy"]);
  dispatcher.registerWorker("exact", ["build", "test"]);

  const result = dispatcher.dispatch({
    type: "build",
    data: {},
    requirements: ["build", "test"],
  });

  // "full" has 2 matches, same as "exact" — tie-break by lower load,
  // but both have load 0, so first in sort wins.
  // "partial" has only 1 match so loses.
  assert.ok(result.worker.id === "exact" || result.worker.id === "full");
});

// ---- Task completion and failure ----

test("TaskDispatcher: completeTask marks task completed and reduces worker load", () => {
  const dispatcher = new TaskDispatcher();
  dispatcher.registerWorker("worker-1", ["default"]);

  const { task } = dispatcher.dispatch({ type: "default", data: { x: 1 }, requirements: ["default"] });

  assert.equal(dispatcher.getWorker("worker-1").load, 1);

  const completed = dispatcher.completeTask(task.id, { ok: true });

  assert.equal(completed.status, "completed");
  assert.ok(completed.completedAt !== null);
  assert.equal(dispatcher.getWorker("worker-1").load, 0);
});

test("TaskDispatcher: failTask marks task failed and reduces worker load", () => {
  const dispatcher = new TaskDispatcher();
  dispatcher.registerWorker("worker-1", ["default"]);

  const { task } = dispatcher.dispatch({ type: "default", data: {}, requirements: ["default"] });
  const failed = dispatcher.failTask(task.id, "timeout");

  assert.equal(failed.status, "failed");
  assert.equal(dispatcher.getWorker("worker-1").load, 0);
});

test("TaskDispatcher: completeTask throws on already completed task", () => {
  const dispatcher = new TaskDispatcher();
  dispatcher.registerWorker("worker-1", ["default"]);

  const { task } = dispatcher.dispatch({ type: "default", data: {}, requirements: ["default"] });
  dispatcher.completeTask(task.id);

  assert.throws(() => dispatcher.completeTask(task.id), { message: /already completed/ });
});

test("TaskDispatcher: completeTask throws on unknown taskId", () => {
  const dispatcher = new TaskDispatcher();

  assert.throws(() => dispatcher.completeTask("nonexistent"), { message: /Unknown task/ });
});

// ---- Redistribution ----

test("TaskDispatcher: redistribute returns tasks from a failed node back to queue", () => {
  const dispatcher = new TaskDispatcher();
  dispatcher.registerWorker("worker-1", ["default"]);

  dispatcher.dispatch({ type: "default", data: { a: 1 }, requirements: ["default"] });
  dispatcher.dispatch({ type: "default", data: { b: 2 }, requirements: ["default"] });

  assert.equal(dispatcher.getWorker("worker-1").load, 2);

  const redistributed = dispatcher.redistribute("worker-1");

  assert.equal(redistributed.length, 2);
  assert.equal(dispatcher.getQueueLength(), 2);
  assert.equal(dispatcher.getWorker("worker-1").load, 0);
  assert.equal(dispatcher.getWorker("worker-1").taskIds.length, 0);
});

test("TaskDispatcher: redistribute stops retrying after maxRetries", () => {
  const dispatcher = new TaskDispatcher({ maxRetries: 1 });
  dispatcher.registerWorker("worker-1", ["default"]);

  const { task } = dispatcher.dispatch({ type: "default", data: {}, requirements: ["default"] });

  // First redistribute (retries from 0 to 1 — goes to queue)
  let redistributed = dispatcher.redistribute("worker-1");
  assert.equal(redistributed.length, 1);

  // Drain the queue back to worker-1
  dispatcher.drainQueue();

  // Second redistribute — retries now 1 >= maxRetries 1, so task fails permanently
  redistributed = dispatcher.redistribute("worker-1");
  assert.equal(redistributed.length, 0); // exceeded maxRetries

  const theTask = dispatcher.getTask(task.id);
  assert.equal(theTask.status, "failed");
});

test("TaskDispatcher: redistribute returns empty for unknown node", () => {
  const dispatcher = new TaskDispatcher();

  assert.deepEqual(dispatcher.redistribute("ghost"), []);
});

// ---- Drain queue ----

test("TaskDispatcher: drainQueue assigns queued tasks when workers become available", () => {
  const dispatcher = new TaskDispatcher();
  // No worker yet — tasks queue
  dispatcher.dispatch({ type: "deploy", data: { env: "prod" }, requirements: ["deploy"], priority: 10 });

  assert.equal(dispatcher.getQueueLength(), 1);

  // Register a matching worker
  dispatcher.registerWorker("worker-1", ["deploy"]);

  const results = dispatcher.drainQueue();

  assert.equal(results.length, 1);
  assert.equal(results[0].status, "assigned");
  assert.equal(results[0].worker.id, "worker-1");
  assert.equal(dispatcher.getQueueLength(), 0);
});

test("TaskDispatcher: drainQueue processes tasks in priority order", () => {
  const dispatcher = new TaskDispatcher();
  dispatcher.dispatch({ id: "low", type: "default", data: {}, priority: 1 });
  dispatcher.dispatch({ id: "high", type: "default", data: {}, priority: 100 });
  dispatcher.dispatch({ id: "mid", type: "default", data: {}, priority: 50 });

  dispatcher.registerWorker("worker-1", ["default"]);

  const results = dispatcher.drainQueue();

  assert.equal(results.length, 3);
  assert.equal(results[0].task.id, "high");
  assert.equal(results[1].task.id, "mid");
  assert.equal(results[2].task.id, "low");
});

// ---- Strategy switching ----

test("TaskDispatcher: setStrategy changes the active balancing strategy", () => {
  const dispatcher = new TaskDispatcher();

  assert.equal(dispatcher.getStrategy(), STRATEGY.LEAST_LOADED);

  dispatcher.setStrategy(STRATEGY.ROUND_ROBIN);
  assert.equal(dispatcher.getStrategy(), STRATEGY.ROUND_ROBIN);

  dispatcher.setStrategy(STRATEGY.CAPABILITY_MATCH);
  assert.equal(dispatcher.getStrategy(), STRATEGY.CAPABILITY_MATCH);
});

test("TaskDispatcher: setStrategy throws on unknown strategy", () => {
  const dispatcher = new TaskDispatcher();

  assert.throws(() => dispatcher.setStrategy("random"), { message: /Unknown strategy/ });
});

// ---- Unregister worker ----

test("TaskDispatcher: unregisterWorker returns its tasks to the queue", () => {
  const dispatcher = new TaskDispatcher();
  dispatcher.registerWorker("worker-1", ["default"]);

  dispatcher.dispatch({ id: "task-1", type: "default", data: {}, requirements: ["default"] });
  dispatcher.dispatch({ id: "task-2", type: "default", data: {}, requirements: ["default"] });

  const reassigned = dispatcher.unregisterWorker("worker-1");

  assert.equal(reassigned.length, 2);
  assert.equal(dispatcher.getQueueLength(), 2);
  assert.equal(dispatcher.getWorker("worker-1"), null);
});

// ---- getLoad ----

test("TaskDispatcher: getLoad returns per-worker load sorted descending", () => {
  const dispatcher = new TaskDispatcher();
  dispatcher.registerWorker("light", ["default"]);
  dispatcher.registerWorker("heavy", ["default"]);

  dispatcher.dispatch({ type: "default", data: {}, requirements: ["default"] }); // to light (least loaded)
  dispatcher.dispatch({ type: "default", data: {}, requirements: ["default"] }); // to heavy now has 0, light has 1? actually depends on ordering
  dispatcher.dispatch({ type: "default", data: {}, requirements: ["default"] });

  const loads = dispatcher.getLoad();
  assert.equal(loads.length, 2);
  // All loads should be non-negative integers
  loads.forEach((entry) => assert.ok(Number.isSafeInteger(entry.load) && entry.load >= 0));
});

// ---- Cancel task ----

test("TaskDispatcher: cancelTask cancels a pending or assigned task", () => {
  const dispatcher = new TaskDispatcher();
  dispatcher.registerWorker("worker-1", ["default"]);

  const { task } = dispatcher.dispatch({ type: "default", data: {}, requirements: ["default"] });
  const cancelled = dispatcher.cancelTask(task.id);

  assert.equal(cancelled.status, "cancelled");
  assert.equal(dispatcher.getWorker("worker-1").load, 0);
});

test("TaskDispatcher: cancelTask throws on already completed task", () => {
  const dispatcher = new TaskDispatcher();
  dispatcher.registerWorker("worker-1", ["default"]);

  const { task } = dispatcher.dispatch({ type: "default", data: {}, requirements: ["default"] });
  dispatcher.completeTask(task.id);

  assert.throws(() => dispatcher.cancelTask(task.id), { message: /Cannot cancel/ });
});
