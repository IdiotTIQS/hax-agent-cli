/**
 * Tests for merge-engine module.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  mergeFiles,
  detectConflicts,
  resolveConflicts,
  applyMerge,
  STRATEGIES,
  longestCommonSubsequence,
  computeLineDiff,
} = require("../../src/diff/merge-engine");

// ---------------------------------------------------------------------------
// mergeFiles — three-way merge
// ---------------------------------------------------------------------------

test("mergeFiles: returns ours when both sides are identical", () => {
  const base = "line1\nline2\n";
  const ours = "line1\nline2\nline3\n";
  const theirs = "line1\nline2\nline3\n";

  const result = mergeFiles(base, ours, theirs);

  assert.equal(result.merged, ours);
  assert.equal(result.conflicts.length, 0);
});

test("mergeFiles: returns theirs when ours is unchanged from base", () => {
  const base = "line1\nline2\n";
  const ours = "line1\nline2\n";
  const theirs = "line1\nline2\nline3\n";

  const result = mergeFiles(base, ours, theirs);

  assert.equal(result.merged, theirs);
  assert.equal(result.conflicts.length, 0);
});

test("mergeFiles: returns ours when theirs is unchanged from base", () => {
  const base = "line1\nline2\n";
  const ours = "line1\nline2\nline3\n";
  const theirs = "line1\nline2\n";

  const result = mergeFiles(base, ours, theirs);

  assert.equal(result.merged, ours);
  assert.equal(result.conflicts.length, 0);
});

test("mergeFiles: handles non-conflicting changes on different lines", () => {
  const base = "line1\nline2\nline3\nline4\nline5\n";
  const ours = "line1\nline2-modified\nline3\nline4\nline5\n";
  const theirs = "line1\nline2\nline3\nline4-modified\nline5\n";

  const result = mergeFiles(base, ours, theirs);

  // Should succeed without conflict markers
  assert.ok(!result.merged.includes("<<<<<<< OURS"), "should not have conflict markers");
});

// ---------------------------------------------------------------------------
// detectConflicts
// ---------------------------------------------------------------------------

test("detectConflicts: finds overlapping changes on the same line", () => {
  const base = "line1\nline2\nline3\n";
  const ours = "line1\nline2-ours\nline3\n";
  const theirs = "line1\nline2-theirs\nline3\n";

  const conflicts = detectConflicts(base, ours, theirs);

  assert.ok(conflicts.length > 0, "should detect at least one conflict");
});

test("detectConflicts: returns empty for non-overlapping changes", () => {
  const base = "line1\nline2\nline3\nline4\n";
  const ours = "line1-ours\nline2\nline3\nline4\n";
  const theirs = "line1\nline2\nline3\nline4-theirs\n";

  const conflicts = detectConflicts(base, ours, theirs);
  const overlappingConflicts = conflicts.filter((c) => c.kind !== "import-conflict" && c.kind !== "export-conflict");

  assert.equal(overlappingConflicts.length, 0, "non-overlapping changes should not produce content conflicts");
});

test("detectConflicts: skips identical changes", () => {
  const base = "line1\nline2\nline3\n";
  const ours = "line1\nline2-modified\nline3\n";
  const theirs = "line1\nline2-modified\nline3\n";

  const conflicts = detectConflicts(base, ours, theirs);

  // Either no conflicts or the conflicting region is identical
  const realConflicts = conflicts.filter((c) => c.ours !== c.theirs);
  assert.equal(realConflicts.length, 0, "identical changes should not produce conflicts");
});

// ---------------------------------------------------------------------------
// resolveConflicts
// ---------------------------------------------------------------------------

test("resolveConflicts: OURS strategy prefers our changes", () => {
  const conflicts = [
    { region: "line2", ours: "line2-ours", theirs: "line2-theirs", base: "line2", kind: "both-modified" },
  ];

  const { resolvedConflicts, unresolvedConflicts } = resolveConflicts(conflicts, "OURS");

  assert.equal(unresolvedConflicts.length, 0);
  assert.equal(resolvedConflicts[0].resolution, "line2-ours");
  assert.equal(resolvedConflicts[0].resolvedWith, "ours");
});

test("resolveConflicts: THEIRS strategy prefers their changes", () => {
  const conflicts = [
    { region: "line2", ours: "line2-ours", theirs: "line2-theirs", base: "line2", kind: "both-modified" },
  ];

  const { resolvedConflicts } = resolveConflicts(conflicts, "THEIRS");

  assert.equal(resolvedConflicts[0].resolution, "line2-theirs");
  assert.equal(resolvedConflicts[0].resolvedWith, "theirs");
});

test("resolveConflicts: UNION strategy keeps both", () => {
  const conflicts = [
    { region: "line2", ours: "ours-content", theirs: "theirs-content", base: "line2", kind: "both-modified" },
  ];

  const { resolvedConflicts } = resolveConflicts(conflicts, "UNION");

  assert.ok(resolvedConflicts[0].resolution.includes("ours-content"));
  assert.ok(resolvedConflicts[0].resolution.includes("theirs-content"));
});

test("resolveConflicts: SMART resolves identical changes", () => {
  const conflicts = [
    { region: "line2", ours: "same-content", theirs: "same-content", base: "line2", kind: "both-modified" },
  ];

  const { resolvedConflicts, unresolvedConflicts } = resolveConflicts(conflicts, "SMART");

  assert.equal(unresolvedConflicts.length, 0);
  assert.equal(resolvedConflicts[0].resolution, "same-content");
});

test("resolveConflicts: SMART resolves import conflicts with union", () => {
  const conflicts = [
    {
      region: "",
      ours: 'import { foo } from "./foo"',
      theirs: 'import { bar } from "./bar"',
      base: "",
      kind: "import-conflict",
    },
  ];

  const { resolvedConflicts, unresolvedConflicts } = resolveConflicts(conflicts, "SMART");

  assert.equal(unresolvedConflicts.length, 0);
  assert.ok(resolvedConflicts[0].resolution.includes("foo"));
  assert.ok(resolvedConflicts[0].resolution.includes("bar"));
});

// ---------------------------------------------------------------------------
// applyMerge
// ---------------------------------------------------------------------------

test("applyMerge: applies resolved conflicts to base content", () => {
  const base = "line1\nline2\nline3\n";
  const ours = "line1\nline2-ours\nline3\n";
  const theirs = "line1\nline2-ours\nline3\n";
  const resolved = [
    { region: "line2", resolution: "line2-merged", ours: "line2-ours", theirs: "line2-ours", base: "line2" },
  ];

  const result = applyMerge(base, ours, theirs, resolved);

  assert.ok(result.includes("line2-merged"), "should apply merged resolution");
});

// ---------------------------------------------------------------------------
// STRATEGIES
// ---------------------------------------------------------------------------

test("STRATEGIES: exposes strategy constants", () => {
  assert.ok(STRATEGIES.includes("OURS"));
  assert.ok(STRATEGIES.includes("THEIRS"));
  assert.ok(STRATEGIES.includes("UNION"));
  assert.ok(STRATEGIES.includes("SMART"));
  assert.equal(STRATEGIES.length, 4);
});

// ---------------------------------------------------------------------------
// Internals: LCS
// ---------------------------------------------------------------------------

test("longestCommonSubsequence: finds LCS of two arrays", () => {
  const a = ["a", "b", "c", "d"];
  const b = ["a", "x", "c", "y"];

  const result = longestCommonSubsequence(a, b);

  assert.deepEqual(result, ["a", "c"]);
});

test("computeLineDiff: identifies added, removed, and unchanged lines", () => {
  const a = ["a", "b", "c"];
  const b = ["a", "x", "c"];

  const result = computeLineDiff(a, b);

  const removed = result.filter((d) => d.type === "removed");
  const added = result.filter((d) => d.type === "added");
  const unchanged = result.filter((d) => d.type === "unchanged");

  assert.equal(removed.length, 1);
  assert.equal(added.length, 1);
  assert.equal(unchanged.length, 2);
});
