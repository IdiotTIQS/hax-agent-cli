/**
 * Edge-case tests for orchestration classes: TaskBoard, AgentRegistry,
 * MessageRouter, executeParallel, executeReadyTasks.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AgentRegistry,
  AgentStatus,
  MessageRouter,
  TaskBoard,
  TaskStatus,
  createAgentTeam,
  createProgressState,
  createSubagent,
  createTask,
  executeParallel,
  executeReadyTasks,
} = require("../src/orchestration");

// ── TaskBoard edge cases ─────────────────────────────────

test("TaskBoard: throws on duplicate task id", () => {
  const board = new TaskBoard();
  board.addTask({ id: "A1", title: "First" });
  assert.throws(() => board.addTask({ id: "A1", title: "Duplicate" }), {
    message: /Duplicate task id/,
  });
});

test("TaskBoard: getTask throws for unknown task", () => {
  const board = new TaskBoard();
  assert.throws(() => board.getTask("nonexistent"), {
    message: /Unknown task/,
  });
});

test("TaskBoard: startTask throws if not pending", () => {
  const board = new TaskBoard([{ id: "A1", title: "Test" }]);
  board.startTask("A1", "agent");
  board.completeTask("A1", "done");
  assert.throws(() => board.startTask("A1", "agent"), {
    message: /cannot start from completed/,
  });
});

test("TaskBoard: startTask throws when deps incomplete", () => {
  const board = new TaskBoard([
    { id: "A1", title: "First" },
    { id: "A2", title: "Second", dependsOn: ["A1"] },
  ]);
  assert.throws(() => board.startTask("A2", "agent"), {
    message: /incomplete dependencies/,
  });
});

test("TaskBoard: completeTask throws if not in progress", () => {
  const board = new TaskBoard([{ id: "A1", title: "Test" }]);
  assert.throws(() => board.completeTask("A1", "result"), {
    message: /cannot complete from pending/,
  });
});

test("TaskBoard: failTask throws if not in progress", () => {
  const board = new TaskBoard([{ id: "A1", title: "Test" }]);
  assert.throws(() => board.failTask("A1", "error"), {
    message: /cannot fail from pending/,
  });
});

test("TaskBoard: failTask stores normalized error", () => {
  const board = new TaskBoard([{ id: "A1", title: "Test" }]);
  board.startTask("A1", "agent");
  const failed = board.failTask("A1", new Error("boom"));
  assert.equal(failed.status, TaskStatus.failed);
  assert.equal(failed.error.message, "boom");
  assert.equal(failed.error.name, "Error");
});

test("TaskBoard: failTask stores non-Error error as-is", () => {
  const board = new TaskBoard([{ id: "A1", title: "Test" }]);
  board.startTask("A1", "agent");
  const failed = board.failTask("A1", "plain string error");
  assert.equal(failed.status, TaskStatus.failed);
  assert.equal(failed.error, "plain string error");
});

test("TaskBoard: startTask clears previous error", () => {
  const board = new TaskBoard([{ id: "A1", title: "Test" }]);
  board.startTask("A1", "agent");
  board.failTask("A1", new Error("first fail"));

  // Re-add and retry the task
  board.addTask({ id: "A2", title: "Retry" });
  board.startTask("A2", "agent");
  const task = board.getTask("A2");
  assert.equal(task.error, null);
});

test("TaskBoard: getReadyTasks returns [] when all complete", () => {
  const board = new TaskBoard([{ id: "A1", title: "Test" }]);
  board.startTask("A1", "agent");
  board.completeTask("A1", "done");
  assert.deepEqual(board.getReadyTasks(), []);
});

test("TaskBoard: getBlockedTasks returns [] when all ready", () => {
  const board = new TaskBoard([{ id: "A1", title: "Test" }]);
  assert.deepEqual(board.getBlockedTasks(), []);
});

test("TaskBoard: dependenciesComplete returns true when dep list is empty", () => {
  const board = new TaskBoard([{ id: "A1", title: "Test" }]);
  const task = board.getTask("A1");
  assert.equal(board.dependenciesComplete(task), true);
});

test("TaskBoard: constructor with no args works", () => {
  const board = new TaskBoard();
  assert.deepEqual(board.listTasks(), []);
});

test("TaskBoard: getProgress for empty board", () => {
  const board = new TaskBoard();
  const progress = board.getProgress();
  assert.equal(progress.total, 0);
  assert.equal(progress.percentComplete, 100);
  assert.equal(progress.completed, 0);
  assert.equal(progress.failed, 0);
});

// ── AgentRegistry edge cases ─────────────────────────────

test("AgentRegistry: throws on duplicate agent", () => {
  const registry = new AgentRegistry();
  registry.addAgent({ name: "architect", role: "Plans" });
  assert.throws(() => registry.addAgent({ name: "architect", role: "Also" }), {
    message: /Duplicate agent/,
  });
});

test("AgentRegistry: getAgent throws for unknown agent", () => {
  const registry = new AgentRegistry();
  assert.throws(() => registry.getAgent("ghost"), {
    message: /Unknown agent/,
  });
});

test("AgentRegistry: assignTask throws if agent is busy", () => {
  const registry = new AgentRegistry([{ name: "architect", role: "Plans" }]);
  registry.assignTask("architect", "A1");
  assert.throws(() => registry.assignTask("architect", "A2"), {
    message: /is busy/,
  });
});

test("AgentRegistry: assignTask throws if agent is offline", () => {
  const registry = new AgentRegistry([{ name: "architect", role: "Plans" }]);
  registry.setOffline("architect");
  assert.throws(() => registry.assignTask("architect", "A1"), {
    message: /is offline/,
  });
});

test("AgentRegistry: setOffline on unknown agent throws", () => {
  const registry = new AgentRegistry();
  assert.throws(() => registry.setOffline("ghost"), {
    message: /Unknown agent/,
  });
});

test("AgentRegistry: getAvailableAgents filters idle only", () => {
  const registry = new AgentRegistry([
    { name: "a1", role: "Plans" },
    { name: "a2", role: "Builds" },
    { name: "a3", role: "Tests" },
  ]);
  registry.assignTask("a1", "T1");
  registry.setOffline("a3");
  const available = registry.getAvailableAgents();
  assert.deepEqual(available.map((a) => a.name), ["a2"]);
});

test("AgentRegistry: releaseAgent clears currentTaskId", () => {
  const registry = new AgentRegistry([{ name: "architect", role: "Plans" }]);
  registry.assignTask("architect", "A1");
  const released = registry.releaseAgent("architect");
  assert.equal(released.status, AgentStatus.idle);
  assert.equal(released.currentTaskId, null);
});

test("AgentRegistry: constructor with no args works", () => {
  const registry = new AgentRegistry();
  assert.deepEqual(registry.listAgents(), []);
});

// ── MessageRouter edge cases ─────────────────────────────

test("MessageRouter: send with invalid names throws", () => {
  const router = new MessageRouter();
  assert.throws(() => router.send({ from: "", to: "agent" }), {
    message: /must be a non-empty string/,
  });
  assert.throws(() => router.send({ from: "agent", to: "" }), {
    message: /must be a non-empty string/,
  });
});

test("MessageRouter: drain returns empty array for unknown agent", () => {
  const router = new MessageRouter();
  assert.deepEqual(router.drain("ghost"), []);
});

test("MessageRouter: drain clears inbox", () => {
  const router = new MessageRouter();
  router.send({ from: "a1", to: "a2", body: "msg" });
  const first = router.drain("a2");
  assert.equal(first.length, 1);
  const second = router.drain("a2");
  assert.equal(second.length, 0);
});

test("MessageRouter: history with no filter returns all", () => {
  const router = new MessageRouter(["a1", "a2"]);
  router.send({ from: "a1", to: "a2", body: "m1" });
  router.send({ from: "a2", to: "a1", body: "m2" });
  assert.equal(router.history().length, 2);
});

test("MessageRouter: history filters by agent (from or to)", () => {
  const router = new MessageRouter(["a1", "a2", "a3"]);
  router.send({ from: "a1", to: "a2", body: "m1" });
  router.send({ from: "a2", to: "a3", body: "m2" });
  router.send({ from: "a3", to: "a2", body: "m3" });
  const a2History = router.history({ agent: "a2" });
  assert.equal(a2History.length, 3);
});

test("MessageRouter: registerAgent is idempotent", () => {
  const router = new MessageRouter();
  router.registerAgent("test");
  router.registerAgent("test");
  router.send({ from: "test", to: "test", body: "m" });
  assert.equal(router.drain("test").length, 1);
});

test("MessageRouter: constructor with no args works", () => {
  const router = new MessageRouter();
  assert.deepEqual(router.history(), []);
});

test("MessageRouter: send defaults type and body", () => {
  const router = new MessageRouter();
  const msg = router.send({ from: "a", to: "b" });
  assert.equal(msg.type, "message");
  assert.equal(msg.body, "");
  assert.equal(msg.taskId, null);
});

test("MessageRouter: broadcast with empty to array returns empty", () => {
  const router = new MessageRouter(["a1"]);
  const results = router.broadcast({ from: "a1", to: [] });
  assert.deepEqual(results, []);
});

// ── createAgentTeam ──────────────────────────────────────

test("createAgentTeam throws for empty team name", () => {
  assert.throws(() => createAgentTeam({ name: "" }), {
    message: /must be a non-empty string/,
  });
});

test("createAgentTeam creates board and registry from agents/tasks", () => {
  const team = createAgentTeam({
    name: "test",
    agents: [{ name: "a1", role: "test" }],
    tasks: [{ id: "T1", title: "Test" }],
  });

  assert.equal(team.name, "test");
  assert.equal(team.board.listTasks().length, 1);
  assert.equal(team.registry.listAgents().length, 1);
  assert.equal(team.router.history().length, 0);
});

// ── createSubagent / createTask ──────────────────────────

test("createSubagent: defaults status to idle", () => {
  const agent = createSubagent({ name: "test", role: "tester" });
  assert.equal(agent.status, AgentStatus.idle);
  assert.equal(agent.currentTaskId, null);
  assert.deepEqual(agent.capabilities, []);
});

test("createSubagent: preserves provided status", () => {
  const agent = createSubagent({
    name: "test",
    role: "tester",
    status: AgentStatus.offline,
  });
  assert.equal(agent.status, AgentStatus.offline);
});

test("createSubagent: requires name and role", () => {
  assert.throws(() => createSubagent({ name: "", role: "x" }), {
    message: /must be a non-empty string/,
  });
  assert.throws(() => createSubagent({ name: "x", role: "" }), {
    message: /must be a non-empty string/,
  });
});

test("createTask: defaults status to pending", () => {
  const task = createTask({ id: "T1", title: "Test" });
  assert.equal(task.status, TaskStatus.pending);
  assert.equal(task.parallel, true);
  assert.deepEqual(task.dependsOn, []);
  assert.equal(task.deliverable, "");
});

test("createTask: respects parallel:false", () => {
  const task = createTask({ id: "T1", title: "Test", parallel: false });
  assert.equal(task.parallel, false);
});

test("createTask: requires id and title", () => {
  assert.throws(() => createTask({ id: "", title: "x" }), {
    message: /must be a non-empty string/,
  });
  assert.throws(() => createTask({ id: "x", title: "" }), {
    message: /must be a non-empty string/,
  });
});

// ── executeParallel edge cases ───────────────────────────

test("executeParallel: throws if worker is not a function", async () => {
  await assert.rejects(
    () => executeParallel([1], "not-a-function"),
    { message: /worker must be a function/ }
  );
});

test("executeParallel: handles empty items array", async () => {
  const results = await executeParallel([], async (x) => x);
  assert.deepEqual(results, []);
});

test("executeParallel: concurrency defaults to array length", async () => {
  let maxConcurrent = 0;
  let running = 0;
  const results = await executeParallel(
    [1, 2, 3],
    async (x) => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      running--;
      return x * 2;
    }
  );
  assert.equal(results.length, 3);
});

test("executeParallel: concurrency of 1 processes sequentially", async () => {
  const order = [];
  await executeParallel(
    [1, 2, 3],
    async (x) => {
      order.push(x);
      return x;
    },
    { concurrency: 1 }
  );
  assert.deepEqual(order, [1, 2, 3]);
});

test("executeParallel: all rejections produce rejected status", async () => {
  const results = await executeParallel(
    [1, 2, 3],
    async () => {
      throw new Error("fail");
    }
  );
  assert.deepEqual(
    results.map((r) => r.status),
    ["rejected", "rejected", "rejected"]
  );
});

// ── executeReadyTasks edge cases ─────────────────────────

test("executeReadyTasks: throws when no worker for owner", async () => {
  const board = new TaskBoard([{ id: "A1", title: "Test", owner: "architect" }]);
  const registry = new AgentRegistry([{ name: "architect", role: "Plans" }]);

  const results = await executeReadyTasks(board, registry, {});
  assert.equal(results[0].status, "rejected");
  assert.match(results[0].reason.message, /No worker registered/);
});

test("executeReadyTasks: handles empty ready tasks", async () => {
  const board = new TaskBoard();
  const registry = new AgentRegistry();
  const results = await executeReadyTasks(board, registry, {});
  assert.deepEqual(results, []);
});

// ── createProgressState ──────────────────────────────────

test("createProgressState: empty tasks returns 100%", () => {
  const state = createProgressState([]);
  assert.equal(state.total, 0);
  assert.equal(state.percentComplete, 100);
  assert.equal(state.completed, 0);
  assert.equal(state.failed, 0);
  assert.equal(state.active, 0);
  assert.equal(state.pending, 0);
});

test("createProgressState: all tasks completed", () => {
  const tasks = [
    { id: "A1", status: TaskStatus.completed },
    { id: "A2", status: TaskStatus.completed },
  ];
  const state = createProgressState(tasks);
  assert.equal(state.total, 2);
  assert.equal(state.completed, 2);
  assert.equal(state.percentComplete, 100);
});

test("createProgressState: mixed states", () => {
  const tasks = [
    { id: "A1", status: TaskStatus.completed },
    { id: "A2", status: TaskStatus.inProgress },
    { id: "A3", status: TaskStatus.pending },
    { id: "A4", status: TaskStatus.failed },
  ];
  const state = createProgressState(tasks);
  assert.equal(state.total, 4);
  assert.equal(state.completed, 1);
  assert.equal(state.failed, 1);
  assert.equal(state.active, 1);
  assert.equal(state.pending, 1);
  assert.equal(state.percentComplete, 25);
});

// ── TaskBoard: chained dependency resolution ─────────────

test("TaskBoard: chained dependencies resolve sequentially", () => {
  const board = new TaskBoard([
    { id: "A1", title: "First" },
    { id: "A2", title: "Second", dependsOn: ["A1"] },
    { id: "A3", title: "Third", dependsOn: ["A2"] },
  ]);

  assert.deepEqual(board.getReadyTasks().map((t) => t.id), ["A1"]);
  board.startTask("A1", "agent");
  board.completeTask("A1", "done");

  assert.deepEqual(board.getReadyTasks().map((t) => t.id), ["A2"]);
  board.startTask("A2", "agent");
  board.completeTask("A2", "done");

  assert.deepEqual(board.getReadyTasks().map((t) => t.id), ["A3"]);
});
