"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { TaskQueue } = require("../../src/scheduler/queue");
const { TaskWorker, TaskWorkerError } = require("../../src/scheduler/worker");

// Helper: executor that returns responses in order.
function makeExecutor(responses) {
  let idx = 0;
  return async (task) => {
    const entry = responses[idx++];
    if (!entry) return { done: true };
    if (entry instanceof Error) throw entry;
    if (typeof entry === "function") return entry(task);
    return entry;
  };
}

// Helper: build a worker with default fast settings for tests.
function makeWorker(opts = {}) {
  return new TaskWorker({
    pollInterval: 2,
    sleepFn: () => Promise.resolve(), // skip retry delays
    ...opts,
  });
}

// Helper: wait until a condition is met (polls on setImmediate).
function until(fn) {
  return new Promise((resolve) => {
    function check() {
      if (fn()) { resolve(); } else { setImmediate(check); }
    }
    check();
  });
}

// ---------------------------------------------------------------------------

test("TaskWorker: constructor throws without queue", () => {
  assert.throws(() => new TaskWorker({ executor: async () => {} }), {
    name: "TaskWorkerError",
    code: "MISSING_QUEUE",
  });
});

test("TaskWorker: constructor throws without executor", () => {
  const q = new TaskQueue();
  assert.throws(() => new TaskWorker({ queue: q }), {
    name: "TaskWorkerError",
    code: "MISSING_EXECUTOR",
  });
});

test("TaskWorker: processes a single task and stops", async () => {
  const q = new TaskQueue();
  q.enqueue({ id: "j1", type: "noop", maxRetries: 0 });

  const responses = [{ result: 42 }];
  const worker = makeWorker({ queue: q, executor: makeExecutor(responses) });

  let completed = false;
  worker.on("task.complete", ({ task, result }) => {
    assert.equal(task.id, "j1");
    assert.deepEqual(result, { result: 42 });
    completed = true;
  });

  worker.start();
  await until(() => completed);
  await worker.stop();
  assert.equal(q.isEmpty(), true);
  assert.equal(q.size(), 0);
});

test("TaskWorker: retry on failure and eventually succeed", async () => {
  const q = new TaskQueue();
  q.enqueue({ id: "retry-me", maxRetries: 2 });

  const responses = [new Error("oops1"), new Error("oops2"), { ok: true }];
  const worker = makeWorker({ queue: q, executor: makeExecutor(responses) });

  let retryCount = 0;
  worker.on("task.retry", () => { retryCount++; });

  let completed = false;
  worker.on("task.complete", ({ task }) => {
    assert.equal(task.id, "retry-me");
    completed = true;
  });

  worker.start();
  await until(() => completed);
  await worker.stop();

  assert.equal(retryCount, 2);
  const stats = worker.getStats();
  assert.equal(stats.completed, 1);
  assert.equal(stats.retried, 2);
  assert.equal(stats.failed, 0);
});

test("TaskWorker: fails after exhausting retries", async () => {
  const q = new TaskQueue();
  q.enqueue({ id: "doomed", maxRetries: 1 });

  const responses = [new Error("fail1"), new Error("fail2")];
  const worker = makeWorker({ queue: q, executor: makeExecutor(responses) });

  let errored = false;
  worker.on("task.error", ({ task, error }) => {
    assert.equal(task.id, "doomed");
    assert.ok(error);
    errored = true;
  });

  worker.start();
  await until(() => errored);
  await worker.stop();

  const stats = worker.getStats();
  assert.equal(stats.completed, 0);
  assert.equal(stats.failed, 1);
});

test("TaskWorker: timeout kills slow executor", async () => {
  const q = new TaskQueue();
  q.enqueue({ id: "slow", maxRetries: 0, timeout: 20 });

  // Executor never resolves.
  const executor = () => new Promise(() => {});
  const worker = makeWorker({ queue: q, executor });

  let errored = false;
  worker.on("task.error", ({ task, error }) => {
    assert.equal(task.id, "slow");
    assert.equal(error.code, "TASK_TIMEOUT");
    errored = true;
  });

  worker.start();
  await until(() => errored);
  await worker.stop();
});

test("TaskWorker: stop waits for in-flight tasks and then resolves", async () => {
  const q = new TaskQueue();
  q.enqueue({ id: "inflight", maxRetries: 0 });

  let executorStarted = false;
  let resolveExecutor;
  const executorPromise = new Promise((r) => { resolveExecutor = r; });

  const executor = async () => {
    executorStarted = true;
    await executorPromise;
    return { done: true };
  };

  const worker = makeWorker({ queue: q, executor });
  worker.start();

  // Wait for the task to be picked up.
  await until(() => executorStarted);

  // Stop before executor resolves — should go into stopped state waiting for in-flight.
  const stopPromise = worker.stop();
  assert.equal(worker.state, "stopped");

  // Now resolve the executor — stop should complete.
  resolveExecutor();
  await stopPromise;

  assert.equal(q.size(), 0);
});

test("TaskWorker: pause prevents new tasks; resume allows them", async () => {
  const q = new TaskQueue();
  q.enqueue({ id: "a", maxRetries: 0 });
  q.enqueue({ id: "b", maxRetries: 0 });

  let completedCount = 0;
  const responses = [{ a: 1 }, { b: 2 }];
  const worker = makeWorker({ queue: q, executor: makeExecutor(responses), concurrency: 1 });

  worker.on("task.complete", () => { completedCount++; });
  worker.start();

  // Wait for first task to complete.
  await until(() => completedCount >= 1);

  // Pause — second task should not be picked up.
  worker.pause();

  // Let some microticks pass; no new completions should happen.
  await new Promise((r) => setImmediate(r));
  assert.equal(completedCount, 1);

  // Resume — second task should now run.
  worker.resume();
  await until(() => completedCount >= 2);

  await worker.stop();
  assert.equal(completedCount, 2);
});

test("TaskWorker: concurrency control limits parallel tasks", async () => {
  const q = new TaskQueue();
  for (let i = 0; i < 5; i++) q.enqueue({ id: `c${i}`, maxRetries: 0 });

  let maxConcurrent = 0;
  let currentConcurrent = 0;
  const doneSignals = [];
  let unblockAll = false;

  const executor = async () => {
    currentConcurrent++;
    if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
    if (!unblockAll) {
      // Block so we can verify concurrency cap.
      await new Promise((r) => doneSignals.push(r));
    }
    currentConcurrent--;
    return { ok: true };
  };

  const worker = makeWorker({ queue: q, executor, concurrency: 2 });
  worker.start();

  // Wait until at least 2 tasks are picked up concurrently.
  await until(() => maxConcurrent >= 2);
  assert.equal(maxConcurrent, 2);

  // Unblock — release current waiters and all subsequent tasks.
  unblockAll = true;
  for (const resolve of doneSignals) resolve();
  doneSignals.length = 0;

  // Wait for the queue to drain completely.
  await until(() => q.isEmpty() && worker.getStats().completed === 5);

  await worker.stop();
  assert.equal(worker.getStats().completed, 5);
});

test("TaskWorker: getStats returns correct default aggregates", () => {
  const q = new TaskQueue();
  const worker = makeWorker({ queue: q, executor: async () => {} });

  const stats = worker.getStats();
  assert.equal(stats.completed, 0);
  assert.equal(stats.failed, 0);
  assert.equal(stats.retried, 0);
  assert.equal(stats.avgDurationMs, 0);
  assert.equal(stats.active, 0);
  assert.equal(stats.state, "idle");
});

test("TaskWorker: task.start event is emitted before processing", async () => {
  const q = new TaskQueue();
  q.enqueue({ id: "emit-test", maxRetries: 0 });

  const worker = makeWorker({ queue: q, executor: makeExecutor([{ ok: true }]) });

  let startFired = false;
  worker.on("task.start", ({ task }) => {
    assert.equal(task.id, "emit-test");
    startFired = true;
  });

  let completed = false;
  worker.on("task.complete", () => { completed = true; });

  worker.start();
  await until(() => completed);
  await worker.stop();

  assert.equal(startFired, true);
});
