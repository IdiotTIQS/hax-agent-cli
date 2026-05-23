/**
 * Tests for TaskResolver.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { TaskResolver } = require("../../src/tasks/resolver");

test("TaskResolver: addTask adds a task with no dependencies", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "T1", title: "Setup" });
  assert.equal(resolver.size, 1);
  const task = resolver.getTask("T1");
  assert.equal(task.title, "Setup");
  assert.equal(task.dependsOn.length, 0);
});

test("TaskResolver: addTask adds a task with dependencies", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "T1", title: "Design" });
  resolver.addTask({ id: "T2", title: "Implement", dependsOn: ["T1"] });
  assert.equal(resolver.size, 2);
  const task = resolver.getTask("T2");
  assert.deepEqual(task.dependsOn, ["T1"]);
});

test("TaskResolver: addTask rejects duplicate ids", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "T1" });
  assert.throws(() => resolver.addTask({ id: "T1" }), /Duplicate task id/);
});

test("TaskResolver: addTask rejects self-dependency", () => {
  const resolver = new TaskResolver();
  assert.throws(() => resolver.addTask({ id: "T1", dependsOn: ["T1"] }), /cannot depend on itself/);
});

test("TaskResolver: addTask rejects empty id", () => {
  const resolver = new TaskResolver();
  assert.throws(() => resolver.addTask({ id: "" }), /must be non-empty/);
  assert.throws(() => resolver.addTask({ id: "   " }), /must be non-empty/);
});

test("TaskResolver: addTask rejects non-object", () => {
  const resolver = new TaskResolver();
  assert.throws(() => resolver.addTask("not-an-object"), /must be an object/);
  assert.throws(() => resolver.addTask(null), /must be an object/);
});

test("TaskResolver: getExecutionOrder returns correct topological order for linear chain", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "T1", title: "Design" });
  resolver.addTask({ id: "T2", title: "Implement", dependsOn: ["T1"] });
  resolver.addTask({ id: "T3", title: "Test", dependsOn: ["T2"] });
  resolver.addTask({ id: "T4", title: "Deploy", dependsOn: ["T3"] });

  const order = resolver.getExecutionOrder();
  const ids = order.map((t) => t.id);
  assert.deepEqual(ids, ["T1", "T2", "T3", "T4"]);
});

test("TaskResolver: getExecutionOrder handles diamond dependency", () => {
  const resolver = new TaskResolver();
  // T2 and T3 both depend on T1; T4 depends on both T2 and T3
  resolver.addTask({ id: "T1", title: "Base" });
  resolver.addTask({ id: "T2", title: "Branch A", dependsOn: ["T1"] });
  resolver.addTask({ id: "T3", title: "Branch B", dependsOn: ["T1"] });
  resolver.addTask({ id: "T4", title: "Merge", dependsOn: ["T2", "T3"] });

  const order = resolver.getExecutionOrder();
  const ids = order.map((t) => t.id);
  assert.equal(ids[0], "T1");
  // T2 and T3 can be in either order
  assert.ok(ids.indexOf("T2") < ids.indexOf("T4"));
  assert.ok(ids.indexOf("T3") < ids.indexOf("T4"));
  assert.equal(ids[ids.length - 1], "T4");
});

test("TaskResolver: getExecutionOrder throws on cycle", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "T1", dependsOn: ["T3"] });
  resolver.addTask({ id: "T2", dependsOn: ["T1"] });
  resolver.addTask({ id: "T3", dependsOn: ["T2"] });

  assert.throws(() => resolver.getExecutionOrder(), /circular dependency/);
});

test("TaskResolver: resolve returns valid for a clean graph", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "T1" });
  resolver.addTask({ id: "T2", dependsOn: ["T1"] });

  const result = resolver.resolve();
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("TaskResolver: resolve flags unknown dependency references", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "T1", dependsOn: ["T_MISSING"] });

  const result = resolver.resolve();
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("T_MISSING")));
});

test("TaskResolver: resolve detects cycles", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "T1", dependsOn: ["T2"] });
  resolver.addTask({ id: "T2", dependsOn: ["T1"] });

  const result = resolver.resolve();
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Circular dependency")));
});

test("TaskResolver: resolve warns about orphan tasks", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "T1" });
  resolver.addTask({ id: "T2" });

  const result = resolver.resolve();
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.includes("orphaned")));
  assert.ok(result.warnings.some((w) => w.includes("T1") || w.includes("T2")));
});

test("TaskResolver: detectCycles finds a simple 2-node cycle", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "A", dependsOn: ["B"] });
  resolver.addTask({ id: "B", dependsOn: ["A"] });

  const cycles = resolver.detectCycles();
  assert.ok(cycles.length > 0);
  // Each cycle should contain both A and B
  const found = cycles.some((c) => c.includes("A") && c.includes("B"));
  assert.equal(found, true);
});

test("TaskResolver: detectCycles returns empty for acyclic graph", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "X" });
  resolver.addTask({ id: "Y", dependsOn: ["X"] });
  resolver.addTask({ id: "Z", dependsOn: ["Y"] });

  const cycles = resolver.detectCycles();
  assert.equal(cycles.length, 0);
});

test("TaskResolver: getCriticalPath returns correct path for linear graph", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "T1" });
  resolver.addTask({ id: "T2", dependsOn: ["T1"] });
  resolver.addTask({ id: "T3", dependsOn: ["T2"] });

  const critical = resolver.getCriticalPath();
  assert.equal(critical.length, 3);
  assert.deepEqual(critical.path.map((t) => t.id), ["T1", "T2", "T3"]);
});

test("TaskResolver: getCriticalPath picks longest branch in diamond graph", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "S", title: "Start" });
  // Left branch: S -> A -> B -> E
  resolver.addTask({ id: "A", dependsOn: ["S"] });
  resolver.addTask({ id: "B", dependsOn: ["A"] });
  // Right branch: S -> C -> E (shorter)
  resolver.addTask({ id: "C", dependsOn: ["S"] });
  resolver.addTask({ id: "E", dependsOn: ["B", "C"] });

  const critical = resolver.getCriticalPath();
  // Critical path: S -> A -> B -> E (length 4)
  assert.equal(critical.length, 4);
  assert.deepEqual(critical.path.map((t) => t.id), ["S", "A", "B", "E"]);
});

test("TaskResolver: getCriticalPath returns empty for empty graph", () => {
  const resolver = new TaskResolver();
  const critical = resolver.getCriticalPath();
  assert.equal(critical.length, 0);
  assert.equal(critical.path.length, 0);
});

test("TaskResolver: getParallelGroups returns independent tasks at same level", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "T1", title: "Setup" });
  resolver.addTask({ id: "T2", title: "Task A", dependsOn: ["T1"] });
  resolver.addTask({ id: "T3", title: "Task B", dependsOn: ["T1"] });
  resolver.addTask({ id: "T4", title: "Merge", dependsOn: ["T2", "T3"] });

  const groups = resolver.getParallelGroups();
  assert.equal(groups.length, 3); // Level 0: T1, Level 1: T2+T3, Level 2: T4

  assert.deepEqual(groups[0].map((t) => t.id), ["T1"]);
  // T2 and T3 are at the same level
  assert.deepEqual(groups[1].map((t) => t.id), ["T2", "T3"]);
  assert.deepEqual(groups[2].map((t) => t.id), ["T4"]);
});

test("TaskResolver: getParallelGroups handles disconnected subgraphs", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "A1" });
  resolver.addTask({ id: "A2", dependsOn: ["A1"] });
  resolver.addTask({ id: "B1" });
  resolver.addTask({ id: "B2", dependsOn: ["B1"] });

  const groups = resolver.getParallelGroups();
  // A1 and B1 at level 0, A2 and B2 at level 1
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].map((t) => t.id), ["A1", "B1"]);
  assert.deepEqual(groups[1].map((t) => t.id), ["A2", "B2"]);
});

test("TaskResolver: optimizeOrder prioritises critical-path tasks", () => {
  const resolver = new TaskResolver();
  // Critical chain: T1 -> T2 -> T4 -> T5 (length 4)
  // Side chain:     T1 -> T3 -> T4 -> T5 (shorter, T3 side)
  resolver.addTask({ id: "T1", title: "Start" });
  resolver.addTask({ id: "T2", title: "Critical first", dependsOn: ["T1"] });
  resolver.addTask({ id: "T3", title: "Side task", dependsOn: ["T1"] });
  resolver.addTask({ id: "T4", title: "Mid", dependsOn: ["T2", "T3"] });
  resolver.addTask({ id: "T5", title: "End", dependsOn: ["T4"] });

  const order = resolver.optimizeOrder();
  const ids = order.map((t) => t.id);

  // T1 must come first
  assert.equal(ids[0], "T1");
  // T2 (critical) should come before T3 (non-critical)
  assert.ok(ids.indexOf("T2") < ids.indexOf("T3"));
  // T4 after both T2 and T3
  assert.ok(ids.indexOf("T2") < ids.indexOf("T4"));
  assert.ok(ids.indexOf("T3") < ids.indexOf("T4"));
  // T5 last
  assert.equal(ids[ids.length - 1], "T5");
});

test("TaskResolver: getAllTasks returns a copy, not a reference", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "T1" });
  resolver.addTask({ id: "T2", dependsOn: ["T1"] });

  const tasks = resolver.getAllTasks();
  tasks[0].id = "MUTATED";

  // Original should be unchanged
  const original = resolver.getTask("T1");
  assert.equal(original.id, "T1");
});

test("TaskResolver: clear removes all tasks", () => {
  const resolver = new TaskResolver();
  resolver.addTask({ id: "T1" });
  resolver.addTask({ id: "T2" });
  assert.equal(resolver.size, 2);

  resolver.clear();
  assert.equal(resolver.size, 0);
  assert.equal(resolver.getAllTasks().length, 0);
  assert.equal(resolver.getCriticalPath().length, 0);
});

test("TaskResolver: getTask returns undefined for missing id", () => {
  const resolver = new TaskResolver();
  assert.equal(resolver.getTask("nonexistent"), undefined);
});

test("TaskResolver: chainable addTask calls", () => {
  const resolver = new TaskResolver();
  resolver
    .addTask({ id: "A" })
    .addTask({ id: "B", dependsOn: ["A"] })
    .addTask({ id: "C", dependsOn: ["B"] });

  assert.equal(resolver.size, 3);
  const order = resolver.getExecutionOrder();
  assert.deepEqual(order.map((t) => t.id), ["A", "B", "C"]);
});

test("TaskResolver: complex graph with multiple parallel branches", () => {
  const resolver = new TaskResolver();
  // Root
  resolver.addTask({ id: "R" });
  // Three independent branches from root
  resolver.addTask({ id: "A1", dependsOn: ["R"] });
  resolver.addTask({ id: "A2" });
  resolver.addTask({ id: "B1", dependsOn: ["R"] });
  resolver.addTask({ id: "B2", dependsOn: ["B1"] });
  resolver.addTask({ id: "C1", dependsOn: ["R"] });
  // Merge
  resolver.addTask({ id: "M", dependsOn: ["A1", "B2", "C1"] });

  const order = resolver.getExecutionOrder();
  const ids = order.map((t) => t.id);

  // R must come first (or A2 since it has no deps -- but R will be first alphabetically)
  // A2 is root-level
  assert.ok(ids.indexOf("R") < ids.indexOf("M") || ids.indexOf("A2") < ids.indexOf("M"));
  assert.ok(ids.indexOf("A1") < ids.indexOf("M"));
  assert.ok(ids.indexOf("B1") < ids.indexOf("B2"));
  assert.ok(ids.indexOf("B2") < ids.indexOf("M"));
  assert.ok(ids.indexOf("C1") < ids.indexOf("M"));
  assert.equal(ids[ids.length - 1], "M");

  const groups = resolver.getParallelGroups();
  // Level 0 should include R and A2 (both independent roots)
  const level0 = groups[0].map((t) => t.id);
  assert.deepEqual(level0, ["A2", "R"]);
});

test("TaskResolver: empty graph yields empty results", () => {
  const resolver = new TaskResolver();
  assert.equal(resolver.size, 0);
  assert.equal(resolver.getExecutionOrder().length, 0);
  assert.equal(resolver.getParallelGroups().length, 0);
  assert.equal(resolver.getAllTasks().length, 0);
  assert.deepEqual(resolver.detectCycles(), []);
});
