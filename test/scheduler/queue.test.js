"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { TaskQueue, PriorityQueue, normalizeTask, isTaskReady } = require("../../src/scheduler/queue");

// ---------------------------------------------------------------------------
// PriorityQueue
// ---------------------------------------------------------------------------

test("PriorityQueue: pop returns items in priority order", () => {
  const pq = new PriorityQueue();
  pq.push({ priority: 5, createdAt: 100, task: { id: "a" } });
  pq.push({ priority: 1, createdAt: 200, task: { id: "b" } });
  pq.push({ priority: 5, createdAt: 50, task: { id: "c" } });

  assert.equal(pq.pop().task.id, "b"); // priority 1
  assert.equal(pq.pop().task.id, "c"); // priority 5, older
  assert.equal(pq.pop().task.id, "a"); // priority 5, newer
  assert.equal(pq.pop(), null);
});

test("PriorityQueue: peek does not remove items", () => {
  const pq = new PriorityQueue();
  pq.push({ priority: 1, createdAt: 100, task: { id: "x" } });
  pq.push({ priority: 9, createdAt: 200, task: { id: "y" } });

  assert.equal(pq.peek().task.id, "x");
  assert.equal(pq.size, 2);
  assert.equal(pq.peek().task.id, "x");
});

test("PriorityQueue: remove by task id", () => {
  const pq = new PriorityQueue();
  pq.push({ priority: 3, createdAt: 100, task: { id: "t1" } });
  pq.push({ priority: 7, createdAt: 200, task: { id: "t2" } });
  pq.push({ priority: 2, createdAt: 300, task: { id: "t3" } });

  assert.equal(pq.size, 3);
  pq.remove("t2");
  assert.equal(pq.size, 2);

  assert.equal(pq.pop().task.id, "t3");
  assert.equal(pq.pop().task.id, "t1");
});

test("PriorityQueue: clear empties the heap", () => {
  const pq = new PriorityQueue();
  pq.push({ priority: 1, createdAt: 100, task: { id: "a" } });
  pq.push({ priority: 2, createdAt: 200, task: { id: "b" } });
  pq.clear();
  assert.equal(pq.size, 0);
  assert.equal(pq.peek(), null);
});

// ---------------------------------------------------------------------------
// normalizeTask
// ---------------------------------------------------------------------------

test("normalizeTask: generates id and applies defaults", () => {
  const task = normalizeTask({ type: "agent-run" });
  assert.ok(task.id);
  assert.ok(task.id.startsWith("task-"));
  assert.equal(task.type, "agent-run");
  assert.equal(task.priority, 5);
  assert.equal(task.maxRetries, 3);
  assert.equal(task.timeout, 30_000);
  assert.deepEqual(task.dependencies, []);
  assert.equal(task.delay, 0);
});

test("normalizeTask: clamps priority to 1-10", () => {
  const high = normalizeTask({ priority: -5 });
  assert.equal(high.priority, 1);

  const low = normalizeTask({ priority: 999 });
  assert.equal(low.priority, 10);
});

// ---------------------------------------------------------------------------
// TaskQueue
// ---------------------------------------------------------------------------

test("TaskQueue: enqueue and dequeue in priority order", () => {
  const q = new TaskQueue();
  q.enqueue({ id: "low", priority: 10 });
  q.enqueue({ id: "mid", priority: 5 });
  q.enqueue({ id: "high", priority: 1 });

  assert.equal(q.size(), 3);
  assert.equal(q.dequeue().id, "high");
  assert.equal(q.dequeue().id, "mid");
  assert.equal(q.dequeue().id, "low");
  assert.equal(q.dequeue(), null);
});

test("TaskQueue: dequeue respects delay (future task not ready)", () => {
  const q = new TaskQueue();
  q.enqueue({ id: "delayed", delay: 10_000 });

  // dequeue with "now" before the delay should return null
  const result = q.dequeue(Date.now());
  assert.equal(result, null);

  // dequeue with "now" after the delay should succeed
  const future = q.dequeue(Date.now() + 10_001);
  assert.equal(future.id, "delayed");
});

test("TaskQueue: dequeue respects dependencies", () => {
  const q = new TaskQueue();
  q.enqueue({ id: "dep-a", priority: 5 });
  q.enqueue({ id: "dep-b", priority: 5, dependencies: ["dep-a"] });

  // dep-b should not dequeue because dep-a is not completed
  const first = q.dequeue();
  assert.equal(first.id, "dep-a");

  assert.equal(q.size(), 1); // dep-b still in queue
  const blocked = q.dequeue();
  assert.equal(blocked, null); // dep-b blocked

  // Mark dep-a complete — now dep-b should be ready
  q.markCompleted("dep-a");
  const second = q.dequeue();
  assert.equal(second.id, "dep-b");
});

test("TaskQueue: peek returns next ready task without removing", () => {
  const q = new TaskQueue();
  q.enqueue({ id: "a", priority: 5 });
  q.enqueue({ id: "b", priority: 3 });

  const peeked = q.peek();
  assert.equal(peeked.id, "b");
  assert.equal(q.size(), 2); // unchanged
});

test("TaskQueue: isEmpty and size", () => {
  const q = new TaskQueue();
  assert.equal(q.isEmpty(), true);
  assert.equal(q.size(), 0);

  q.enqueue({ id: "x" });
  assert.equal(q.isEmpty(), false);
  assert.equal(q.size(), 1);

  q.dequeue();
  assert.equal(q.isEmpty(), true);
});

test("TaskQueue: remove specific task", () => {
  const q = new TaskQueue();
  q.enqueue({ id: "keep" });
  q.enqueue({ id: "drop" });

  assert.equal(q.remove("drop"), true);
  assert.equal(q.size(), 1);
  assert.equal(q.remove("nonexistent"), false);

  const task = q.dequeue();
  assert.equal(task.id, "keep");
});

test("TaskQueue: clear removes all tasks", () => {
  const q = new TaskQueue();
  q.enqueue({ id: "a" });
  q.enqueue({ id: "b" });
  q.enqueue({ id: "c" });
  q.clear();
  assert.equal(q.size(), 0);
  assert.equal(q.dequeue(), null);
});

test("TaskQueue: throws on duplicate id", () => {
  const q = new TaskQueue();
  q.enqueue({ id: "dup" });
  assert.throws(() => q.enqueue({ id: "dup" }), { message: /Duplicate/ });
});

test("TaskQueue: throws at capacity", () => {
  const q = new TaskQueue({ maxSize: 2 });
  q.enqueue({ id: "a" });
  q.enqueue({ id: "b" });
  assert.throws(() => q.enqueue({ id: "c" }), { message: /capacity/ });
});

test("TaskQueue: toArray returns snapshot with ready flag", () => {
  const q = new TaskQueue();
  q.enqueue({ id: "ready", priority: 1 });
  q.enqueue({ id: "blocked", dependencies: ["ready"] });

  const snapshot = q.toArray();
  assert.equal(snapshot.length, 2);

  const r = snapshot.find((t) => t.id === "ready");
  const b = snapshot.find((t) => t.id === "blocked");
  assert.equal(r.ready, true);
  assert.equal(b.ready, false);
});

test("TaskQueue: readyCount reflects eligible tasks", () => {
  const q = new TaskQueue();
  q.enqueue({ id: "a", priority: 2 });
  q.enqueue({ id: "b", delay: 60_000 });

  // a is ready, b is delayed
  assert.equal(q.readyCount(), 1);

  // Dequeue a and mark it completed; now only b remains.
  const a = q.dequeue();
  assert.equal(a.id, "a");
  q.markCompleted("a");

  // b is still delayed and thus not ready.
  assert.equal(q.readyCount(), 0);
});

test("TaskQueue: waitForDependency resolves when dependency completes", async () => {
  const q = new TaskQueue();
  const depId = "dep-x";

  const promise = q.waitForDependency(depId);
  assert.equal(q.size(), 0); // dependency not yet queued

  // Without marking complete, resolution would hang; but in test we mark it immediately.
  q.markCompleted(depId);
  await promise; // should resolve without throwing

  // Second call resolves instantly.
  await q.waitForDependency(depId);
});

test("isTaskReady: false when delay not elapsed", () => {
  const task = normalizeTask({ id: "t", delay: 5000 });
  const now = task.createdAt + 1000;
  assert.equal(isTaskReady(task, now), false);
  assert.equal(isTaskReady(task, now + 4000), true);
});
