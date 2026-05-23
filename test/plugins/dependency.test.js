/**
 * Tests for DependencyGraph: addPlugin, resolve, detectCycles,
 * loadOrder, checkConflicts, and semver satisfies.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { DependencyGraph, satisfies } = require("../../src/plugins/dependency");

// ---------------------------------------------------------------------------
// satisfies
// ---------------------------------------------------------------------------

test("satisfies: exact version match", () => {
  assert.equal(satisfies("1.2.3", "1.2.3"), true);
  assert.equal(satisfies("1.2.4", "1.2.3"), false);
});

test("satisfies: caret range ^1.2.3", () => {
  assert.equal(satisfies("1.2.3", "^1.2.3"), true);
  assert.equal(satisfies("1.9.9", "^1.2.3"), true);
  assert.equal(satisfies("1.2.4", "^1.0.0"), true);
  assert.equal(satisfies("2.0.0", "^1.2.3"), false);
  assert.equal(satisfies("0.9.0", "^1.2.3"), false);
});

test("satisfies: caret range ^0.x.y handles zero-major", () => {
  // ^0.2.3 → >=0.2.3 <0.3.0
  assert.equal(satisfies("0.2.5", "^0.2.3"), true);
  assert.equal(satisfies("0.3.0", "^0.2.3"), false);

  // ^0.0.1 → >=0.0.1 <0.0.2 (first non-zero is patch, pinned tight)
  assert.equal(satisfies("0.0.1", "^0.0.1"), true);
  assert.equal(satisfies("0.0.2", "^0.0.1"), false);
  assert.equal(satisfies("0.1.0", "^0.0.1"), false);
});

test("satisfies: tilde range ~1.2.3", () => {
  assert.equal(satisfies("1.2.3", "~1.2.3"), true);
  assert.equal(satisfies("1.2.9", "~1.2.3"), true);
  assert.equal(satisfies("1.3.0", "~1.2.3"), false);
  assert.equal(satisfies("2.0.0", "~1.2.3"), false);
});

test("satisfies: gte range >=1.2.3", () => {
  assert.equal(satisfies("1.2.3", ">=1.2.3"), true);
  assert.equal(satisfies("2.0.0", ">=1.2.3"), true);
  assert.equal(satisfies("1.2.2", ">=1.2.3"), false);
  assert.equal(satisfies("0.1.0", ">=1.2.3"), false);
});

test("satisfies: lte range <=1.2.3", () => {
  assert.equal(satisfies("1.2.3", "<=1.2.3"), true);
  assert.equal(satisfies("1.0.0", "<=1.2.3"), true);
  assert.equal(satisfies("1.3.0", "<=1.2.3"), false);
  assert.equal(satisfies("2.0.0", "<=1.2.3"), false);
});

test("satisfies: gt range >1.2.3", () => {
  assert.equal(satisfies("1.2.4", ">1.2.3"), true);
  assert.equal(satisfies("2.0.0", ">1.2.3"), true);
  assert.equal(satisfies("1.2.3", ">1.2.3"), false);
  assert.equal(satisfies("1.2.2", ">1.2.3"), false);
});

test("satisfies: lt range <1.2.3", () => {
  assert.equal(satisfies("1.2.2", "<1.2.3"), true);
  assert.equal(satisfies("1.0.0", "<1.2.3"), true);
  assert.equal(satisfies("1.2.3", "<1.2.3"), false);
  assert.equal(satisfies("1.2.4", "<1.2.3"), false);
});

test("satisfies: returns false for invalid version", () => {
  assert.equal(satisfies("not-a-version", "^1.0.0"), false);
  assert.equal(satisfies("", "1.0.0"), false);
  assert.equal(satisfies(null, "1.0.0"), false);
});

// ---------------------------------------------------------------------------
// DependencyGraph: addPlugin
// ---------------------------------------------------------------------------

test("DependencyGraph: addPlugin stores plugin with dependencies", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("a", "1.0.0", { b: "^2.0.0", c: "~1.0.0" });

  const node = graph.get("a");
  assert.equal(node.name, "a");
  assert.equal(node.version, "1.0.0");
  assert.deepEqual(node.dependencies, { b: "^2.0.0", c: "~1.0.0" });
});

test("DependencyGraph: addPlugin rejects empty name or version", () => {
  const graph = new DependencyGraph();
  assert.throws(() => graph.addPlugin("", "1.0.0"), { message: /name is required/ });
  assert.throws(() => graph.addPlugin("a", ""), { message: /version is required/ });
});

test("DependencyGraph: addPlugin allows empty dependencies", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("standalone", "1.0.0");
  assert.deepEqual(graph.get("standalone").dependencies, {});
});

test("DependencyGraph: removePlugin deletes a node", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("a", "1.0.0");
  assert.equal(graph.removePlugin("a"), true);
  assert.equal(graph.get("a"), null);
  assert.equal(graph.removePlugin("a"), false);
});

test("DependencyGraph: get returns null for unknown plugin", () => {
  const graph = new DependencyGraph();
  assert.equal(graph.get("nonexistent"), null);
});

// ---------------------------------------------------------------------------
// DependencyGraph: resolve
// ---------------------------------------------------------------------------

test("DependencyGraph: resolve returns full dependency tree", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("a", "1.0.0", { b: "^2.0.0" });
  graph.addPlugin("b", "2.1.0", { c: "~3.0.0" });
  graph.addPlugin("c", "3.0.0", {});

  const tree = graph.resolve("a");
  assert.equal(tree.length, 3);

  // Order: deps first (c, b, a)
  const names = tree.map((n) => n.name);
  assert.equal(names[0], "c");
  assert.equal(names[1], "b");
  assert.equal(names[2], "a");
});

test("DependencyGraph: resolve throws for unknown dependency", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("a", "1.0.0", { b: "^1.0.0" });

  assert.throws(() => graph.resolve("a"), { message: /Unknown dependency: b/ });
});

test("DependencyGraph: resolve handles shared dependencies (diamond)", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("a", "1.0.0", { b: "^1.0.0", c: "^1.0.0" });
  graph.addPlugin("b", "1.0.0", { d: "^1.0.0" });
  graph.addPlugin("c", "1.0.0", { d: "^1.0.0" });
  graph.addPlugin("d", "1.0.0", {});

  const tree = graph.resolve("a");
  // d should appear only once
  const dCount = tree.filter((n) => n.name === "d").length;
  assert.equal(dCount, 1);
  assert.equal(tree.length, 4);
});

// ---------------------------------------------------------------------------
// DependencyGraph: detectCycles
// ---------------------------------------------------------------------------

test("DependencyGraph: detectCycles returns empty for acyclic graph", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("a", "1.0.0", { b: "^1.0.0" });
  graph.addPlugin("b", "1.0.0", { c: "^1.0.0" });
  graph.addPlugin("c", "1.0.0", {});

  const cycles = graph.detectCycles();
  assert.deepEqual(cycles, []);
});

test("DependencyGraph: detectCycles finds a direct cycle", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("a", "1.0.0", { b: "^1.0.0" });
  graph.addPlugin("b", "1.0.0", { a: "^1.0.0" });

  const cycles = graph.detectCycles();
  assert.equal(cycles.length, 1);
  // Cycle should be [a, b, a] or [b, a, b]
  assert.ok(cycles[0].includes("a"));
  assert.ok(cycles[0].includes("b"));
});

test("DependencyGraph: detectCycles finds a longer cycle", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("a", "1.0.0", { b: "^1.0.0" });
  graph.addPlugin("b", "1.0.0", { c: "^1.0.0" });
  graph.addPlugin("c", "1.0.0", { a: "^1.0.0" });

  const cycles = graph.detectCycles();
  assert.equal(cycles.length, 1);
  assert.ok(cycles[0].includes("a"));
  assert.ok(cycles[0].includes("b"));
  assert.ok(cycles[0].includes("c"));
});

test("DependencyGraph: detectCycles finds a self-cycle", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("a", "1.0.0", { a: "^1.0.0" });

  const cycles = graph.detectCycles();
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ["a", "a"]);
});

// ---------------------------------------------------------------------------
// DependencyGraph: loadOrder
// ---------------------------------------------------------------------------

test("DependencyGraph: loadOrder returns topological sort", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("app", "1.0.0", { lib: "^1.0.0", util: "^1.0.0" });
  graph.addPlugin("lib", "1.0.0", { util: "^1.0.0" });
  graph.addPlugin("util", "1.0.0", {});

  const order = graph.loadOrder();
  assert.deepEqual(order, ["util", "lib", "app"]);
});

test("DependencyGraph: loadOrder handles independent plugins", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("a", "1.0.0", {});
  graph.addPlugin("b", "1.0.0", {});
  graph.addPlugin("c", "1.0.0", {});

  const order = graph.loadOrder();
  assert.equal(order.length, 3);
  // All plugins should appear (order among independents is arbitrary)
  assert.ok(order.includes("a"));
  assert.ok(order.includes("b"));
  assert.ok(order.includes("c"));
});

test("DependencyGraph: loadOrder throws on cycle", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("a", "1.0.0", { b: "^1.0.0" });
  graph.addPlugin("b", "1.0.0", { a: "^1.0.0" });

  assert.throws(() => graph.loadOrder(), {
    message: /circular dependency detected/,
  });
});

test("DependencyGraph: loadOrder empty graph returns empty array", () => {
  const graph = new DependencyGraph();
  assert.deepEqual(graph.loadOrder(), []);
});

// ---------------------------------------------------------------------------
// DependencyGraph: checkConflicts
// ---------------------------------------------------------------------------

test("DependencyGraph: checkConflicts returns empty when no conflicts", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("a", "1.0.0", { x: "^1.0.0" });
  graph.addPlugin("b", "1.0.0", { x: "^1.5.0" });
  graph.addPlugin("x", "1.6.0", {});

  const conflicts = graph.checkConflicts();
  // Both ^1.0.0 and ^1.5.0 are satisfied by 1.6.0
  assert.deepEqual(conflicts, []);
});

test("DependencyGraph: checkConflicts detects incompatible major versions", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("a", "1.0.0", { x: "^1.0.0" });
  graph.addPlugin("b", "1.0.0", { x: "^2.0.0" });

  const conflicts = graph.checkConflicts();
  assert.ok(conflicts.length >= 1);

  const conflict = conflicts.find((c) => c.dependency === "x");
  assert.ok(conflict);
  assert.equal(conflict.versions.length, 2);
});

test("DependencyGraph: checkConflicts returns empty for single requester", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("a", "1.0.0", { x: "^3.0.0" });

  const conflicts = graph.checkConflicts();
  assert.deepEqual(conflicts, []);
});

test("DependencyGraph: checkConflicts with no concrete version flags potential conflict", () => {
  const graph = new DependencyGraph();
  graph.addPlugin("a", "1.0.0", { x: "^1.0.0" });
  graph.addPlugin("b", "1.0.0", { x: "^2.0.0" });

  const conflicts = graph.checkConflicts();
  // Without a concrete x, incompatible ^ ranges cause a conflict
  assert.ok(conflicts.length >= 1);

  const conflict = conflicts.find((c) => c.dependency === "x");
  assert.ok(conflict);
  // Two different major versions requested
  const ranges = conflict.versions.map((v) => v.range);
  assert.ok(ranges.includes("^1.0.0"));
  assert.ok(ranges.includes("^2.0.0"));
});
