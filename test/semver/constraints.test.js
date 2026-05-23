/**
 * Tests for ConstraintSolver: resolve, findSatisfying, isConflicting,
 * suggestResolution, optimizeRange.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ConstraintSolver,
  parseConstraint,
  constraintLowerBound,
  constraintUpperBound,
  ConstraintType,
} = require("../../src/semver/constraints");

// ---------------------------------------------------------------------------
// parseConstraint
// ---------------------------------------------------------------------------

test("parseConstraint: parses caret ranges", () => {
  const result = parseConstraint("^1.2.3");
  assert.equal(result.type, ConstraintType.CARET);
  assert.equal(result.version, "1.2.3");
});

test("parseConstraint: parses tilde ranges", () => {
  const result = parseConstraint("~1.2.3");
  assert.equal(result.type, ConstraintType.TILDE);
  assert.equal(result.version, "1.2.3");
});

test("parseConstraint: parses greater/less operators", () => {
  assert.equal(parseConstraint(">=2.0.0").type, ConstraintType.GREATER_EQ);
  assert.equal(parseConstraint("<=2.0.0").type, ConstraintType.LESS_EQ);
  assert.equal(parseConstraint(">1.0.0").type, ConstraintType.GREATER);
  assert.equal(parseConstraint("<3.0.0").type, ConstraintType.LESS);
});

test("parseConstraint: parses wildcard and any", () => {
  assert.equal(parseConstraint("1.x").type, ConstraintType.WILDCARD);
  assert.equal(parseConstraint("2.5.x").type, ConstraintType.WILDCARD);
  assert.equal(parseConstraint("*").type, ConstraintType.ANY);
  assert.equal(parseConstraint("latest").type, ConstraintType.ANY);
});

test("parseConstraint: parses exact versions", () => {
  assert.equal(parseConstraint("1.2.3").type, ConstraintType.EXACT);
  assert.equal(parseConstraint("=1.2.3").type, ConstraintType.EXACT);
  assert.equal(parseConstraint("v1.2.3").type, ConstraintType.EXACT);
});

test("parseConstraint: returns null for invalid input", () => {
  assert.equal(parseConstraint(""), null);
  assert.equal(parseConstraint(null), null);
  assert.equal(parseConstraint(undefined), null);
});

// ---------------------------------------------------------------------------
// constraintLowerBound / constraintUpperBound
// ---------------------------------------------------------------------------

test("constraintLowerBound: returns version for exact", () => {
  const parsed = parseConstraint("1.2.3");
  assert.equal(constraintLowerBound(parsed), "1.2.3");
});

test("constraintLowerBound: returns version for caret", () => {
  const parsed = parseConstraint("^1.2.3");
  assert.equal(constraintLowerBound(parsed), "1.2.3");
});

test("constraintLowerBound: returns 0.0.0 for less-than constraints", () => {
  const parsed = parseConstraint("<2.0.0");
  assert.equal(constraintLowerBound(parsed), "0.0.0");
});

test("constraintUpperBound: returns correct upper for caret", () => {
  const parsed = parseConstraint("^1.2.3");
  assert.equal(constraintUpperBound(parsed), "2.0.0");
});

test("constraintUpperBound: returns correct upper for tilde", () => {
  const parsed = parseConstraint("~1.2.3");
  assert.equal(constraintUpperBound(parsed), "1.3.0");
});

test("constraintUpperBound: returns null for unbounded constraints", () => {
  assert.equal(constraintUpperBound(parseConstraint(">=1.0.0")), null);
  assert.equal(constraintUpperBound(parseConstraint("*")), null);
});

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

test("resolve: resolves a single constraint", () => {
  const solver = new ConstraintSolver();
  const result = solver.resolve(["^1.2.3"]);

  assert.equal(result.lower, "1.2.3");
  assert.equal(result.upper, "2.0.0");
  assert.equal(result.allSatisfied, true);
  assert.equal(result.anySatisfying, "1.2.3");
});

test("resolve: resolves AND constraints (intersection)", () => {
  const solver = new ConstraintSolver();
  const result = solver.resolve([">=1.2.0", "<1.5.0"]);

  assert.equal(result.lower, "1.2.0");
  assert.equal(result.upper, "1.5.0");
  assert.equal(result.allSatisfied, true);
});

test("resolve: resolves multiple compatible constraints", () => {
  const solver = new ConstraintSolver();
  const result = solver.resolve([">=1.0.0", "<2.0.0", "^1.2.3"]);

  assert.equal(result.lower, "1.2.3");
  assert.equal(result.upper, "2.0.0");
  assert.equal(result.allSatisfied, true);
});

test("resolve: returns allSatisfied=false for impossible constraints", () => {
  const solver = new ConstraintSolver();
  const result = solver.resolve([">=3.0.0", "<2.0.0"]);

  assert.equal(result.allSatisfied, false);
  assert.equal(result.anySatisfying, null);
  assert.ok(result.conflicts.length > 0);
});

test("resolve: handles empty constraints array", () => {
  const solver = new ConstraintSolver();
  const result = solver.resolve([]);

  assert.equal(result.allSatisfied, false);
  assert.ok(result.conflicts.length > 0);
});

// ---------------------------------------------------------------------------
// findSatisfying
// ---------------------------------------------------------------------------

test("findSatisfying: finds versions that satisfy a constraint", () => {
  const solver = new ConstraintSolver();
  const versions = ["1.0.0", "1.1.0", "1.5.0", "2.0.0", "2.1.0"];
  const result = solver.findSatisfying("^1.0.0", versions);

  assert.equal(result.count, 3);
  assert.deepEqual(result.satisfying, ["1.0.0", "1.1.0", "1.5.0"]);
});

test("findSatisfying: returns satisfying versions sorted", () => {
  const solver = new ConstraintSolver();
  const versions = ["2.5.0", "2.0.0", "2.9.9", "2.1.0"];
  const result = solver.findSatisfying("^2.0.0", versions);

  assert.equal(result.count, 4);
  assert.deepEqual(result.satisfying, ["2.0.0", "2.1.0", "2.5.0", "2.9.9"]);
});

test("findSatisfying: returns empty for no matches", () => {
  const solver = new ConstraintSolver();
  const versions = ["3.0.0", "3.1.0", "4.0.0"];
  const result = solver.findSatisfying("^1.0.0", versions);

  assert.equal(result.count, 0);
  assert.deepEqual(result.satisfying, []);
});

test("findSatisfying: handles non-array input", () => {
  const solver = new ConstraintSolver();
  const result = solver.findSatisfying("^1.0.0", null);

  assert.equal(result.count, 0);
  assert.deepEqual(result.satisfying, []);
});

// ---------------------------------------------------------------------------
// isConflicting
// ---------------------------------------------------------------------------

test("isConflicting: returns false for compatible constraints", () => {
  const solver = new ConstraintSolver();
  const result = solver.isConflicting(["^1.0.0", ">=1.0.0"]);

  assert.equal(result.conflicting, false);
  assert.equal(result.conflicts.length, 0);
});

test("isConflicting: returns false for single constraint", () => {
  const solver = new ConstraintSolver();
  const result = solver.isConflicting(["^1.0.0"]);

  assert.equal(result.conflicting, false);
});

test("isConflicting: returns true for non-overlapping constraints", () => {
  const solver = new ConstraintSolver();
  const result = solver.isConflicting(["^1.0.0", "^2.0.0"]);

  assert.equal(result.conflicting, true);
  assert.ok(result.conflicts.length > 0);
});

test("isConflicting: detects conflict when upper of A is below lower of B", () => {
  const solver = new ConstraintSolver();
  const result = solver.isConflicting(["<1.0.0", ">=2.0.0"]);

  assert.equal(result.conflicting, true);
  assert.ok(result.conflicts[0].message.includes("No overlap"));
});

test("isConflicting: handles empty array", () => {
  const solver = new ConstraintSolver();
  const result = solver.isConflicting([]);

  assert.equal(result.conflicting, false);
});

// ---------------------------------------------------------------------------
// suggestResolution
// ---------------------------------------------------------------------------

test("suggestResolution: suggests widening for conflicting exact versions", () => {
  const solver = new ConstraintSolver();
  const suggestions = solver.suggestResolution([
    { constraints: ["=1.0.0", "=2.0.0"], message: "Test conflict" },
  ]);

  assert.ok(suggestions.length > 0);
  assert.ok(suggestions[0].action === "widen" || suggestions[0].action === "relax" || suggestions[0].action === "upgrade");
});

test("suggestResolution: returns empty for no conflicts", () => {
  const solver = new ConstraintSolver();
  const suggestions = solver.suggestResolution([]);

  assert.deepEqual(suggestions, []);
});

test("suggestResolution: handles null input", () => {
  const solver = new ConstraintSolver();
  const suggestions = solver.suggestResolution(null);

  assert.deepEqual(suggestions, []);
});

// ---------------------------------------------------------------------------
// optimizeRange
// ---------------------------------------------------------------------------

test("optimizeRange: returns exact for single version", () => {
  const solver = new ConstraintSolver();
  const result = solver.optimizeRange(["1.2.3"]);

  assert.equal(result.range, "1.2.3");
  assert.equal(result.type, "exact");
});

test("optimizeRange: returns caret when all share major", () => {
  const solver = new ConstraintSolver();
  const result = solver.optimizeRange(["1.0.0", "1.1.0", "1.5.0", "1.9.9"]);

  assert.equal(result.range, "^1.0.0");
  assert.equal(result.type, "caret");
});

test("optimizeRange: returns tilde when all share major.minor", () => {
  const solver = new ConstraintSolver();
  const result = solver.optimizeRange(["2.3.0", "2.3.1", "2.3.5"]);

  assert.equal(result.range, "~2.3.0");
  assert.equal(result.type, "tilde");
});

test("optimizeRange: returns tilde for versions in same minor range", () => {
  const solver = new ConstraintSolver();
  const result = solver.optimizeRange(["1.2.0", "1.2.5", "1.2.9"]);

  assert.equal(result.type, "tilde");
  assert.equal(result.range, "~1.2.0");
});

test("optimizeRange: returns caret for versions in same major", () => {
  const solver = new ConstraintSolver();
  // Versions across different minors but same major
  const result = solver.optimizeRange(["2.0.0", "2.1.0", "2.5.0", "2.9.0"]);

  assert.equal(result.type, "caret");
  assert.equal(result.range, "^2.0.0");
});

test("optimizeRange: falls back to range expression for multiple majors", () => {
  const solver = new ConstraintSolver();
  const result = solver.optimizeRange(["1.0.0", "2.0.0", "3.0.0"]);

  assert.equal(result.type, "range");
  assert.ok(result.range.startsWith(">="));
  assert.ok(result.range.includes("<"));
});

test("optimizeRange: handles empty array", () => {
  const solver = new ConstraintSolver();
  const result = solver.optimizeRange([]);

  assert.equal(result.range, null);
  assert.equal(result.type, "empty");
  assert.equal(result.versions, 0);
});

test("optimizeRange: filters out invalid versions", () => {
  const solver = new ConstraintSolver();
  const result = solver.optimizeRange(["1.0.0", "invalid", "1.1.0", "not-semver"]);

  assert.ok(result.versions >= 2);
  assert.ok(result.range !== null);
});
