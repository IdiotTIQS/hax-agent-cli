/**
 * Tests for patch module.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createPatch,
  applyPatch,
  reversePatch,
  validatePatch,
  combinePatches,
  summarizePatch,
  parsePatch,
  computeHunks,
  coalesceHunks,
} = require("../../src/diff/patch");

// ---------------------------------------------------------------------------
// createPatch
// ---------------------------------------------------------------------------

test("createPatch: produces unified diff header", () => {
  const oldC = "line1\nline2\n";
  const newC = "line1\nline2\n";

  const patch = createPatch(oldC, newC);

  assert.ok(patch.startsWith("--- "), "patch should start with --- header");
  assert.ok(patch.includes("+++ "), "patch should include +++ header");
});

test("createPatch: produces empty hunk body when identical", () => {
  const oldC = "line1\nline2\n";
  const newC = "line1\nline2\n";

  const patch = createPatch(oldC, newC);

  // Should only have header, no @@ lines
  const lines = patch.split("\n").filter(Boolean);
  assert.equal(lines.length, 2, "identical files should only produce 2 header lines");
});

test("createPatch: uses custom labels", () => {
  const oldC = "a\n";
  const newC = "b\n";

  const patch = createPatch(oldC, newC, { oldLabel: "old.js", newLabel: "new.js" });

  assert.ok(patch.includes("--- old.js"));
  assert.ok(patch.includes("+++ new.js"));
});

// ---------------------------------------------------------------------------
// applyPatch
// ---------------------------------------------------------------------------

test("applyPatch: applies added lines", () => {
  const oldC = "line1\nline2\n";
  const newC = "line1\nline1.5\nline2\n";
  const patch = createPatch(oldC, newC);

  const result = applyPatch(oldC, patch);

  assert.equal(result, newC);
});

test("applyPatch: applies removed lines", () => {
  const oldC = "line1\nline2\nline3\n";
  const newC = "line1\nline3\n";
  const patch = createPatch(oldC, newC);

  const result = applyPatch(oldC, patch);

  assert.equal(result, newC);
});

test("applyPatch: applies modified lines", () => {
  const oldC = "line1\nold-line\nline3\n";
  const newC = "line1\nnew-line\nline3\n";
  const patch = createPatch(oldC, newC);

  const result = applyPatch(oldC, patch);

  assert.equal(result, newC);
});

test("applyPatch: round-trip createPatch → applyPatch", () => {
  const oldC = "function foo() {\n  return 1;\n}\n\nfunction bar() {\n  return 2;\n}\n";
  const newC = "function foo() {\n  return 10;\n}\n\nfunction bar() {\n  return 20;\n}\n\nfunction baz() {\n  return 3;\n}\n";

  const patch = createPatch(oldC, newC);
  const result = applyPatch(oldC, patch);

  assert.equal(result, newC, "round-trip should preserve exact content");
});

// ---------------------------------------------------------------------------
// reversePatch
// ---------------------------------------------------------------------------

test("reversePatch: creates inverse of a patch", () => {
  const oldC = "line1\nline2\n";
  const newC = "line1\nline3\n";
  const forward = createPatch(oldC, newC);
  const backward = reversePatch(forward);

  // Applying backward patch should get us back to oldC
  const result = applyPatch(newC, backward);

  assert.equal(result, oldC);
});

test("reversePatch: round-trip forward → reverse", () => {
  const oldC = "a\nb\nc\nd\ne\n";
  const newC = "a\nx\nc\ny\ne\n";

  const forward = createPatch(oldC, newC);
  const backward = reversePatch(forward);

  const backToOld = applyPatch(newC, backward);

  assert.equal(backToOld, oldC);
});

// ---------------------------------------------------------------------------
// validatePatch
// ---------------------------------------------------------------------------

test("validatePatch: accepts valid patch", () => {
  const oldC = "line1\nline2\n";
  const newC = "line1\nmodified\n";
  const patch = createPatch(oldC, newC);

  const result = validatePatch(patch);

  assert.equal(result.valid, true, `expected valid patch, got errors: ${result.errors.join(", ")}`);
});

test("validatePatch: rejects empty patch", () => {
  const result = validatePatch("");

  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test("validatePatch: rejects patch with bad header", () => {
  const result = validatePatch("not a patch\n@@ -1,1 +1,1 @@\n");

  assert.equal(result.valid, false);
});

// ---------------------------------------------------------------------------
// combinePatches
// ---------------------------------------------------------------------------

test("combinePatches: returns empty for empty array", () => {
  const result = combinePatches([]);

  assert.equal(result, "");
});

test("combinePatches: returns single patch unchanged", () => {
  const oldC = "a\n";
  const newC = "b\n";
  const patch = createPatch(oldC, newC);

  const result = combinePatches([patch]);

  assert.equal(result, patch);
});

test("combinePatches: combines two sequential patches", () => {
  const v1 = "line1\nline2\nline3\n";
  const v2 = "line1\nline2-modified\nline3\n";
  const v3 = "line1\nline2-modified\nline3\nline4\n";

  const patch1 = createPatch(v1, v2);
  const patch2 = createPatch(v2, v3);

  const combined = combinePatches([patch1, patch2]);

  // Combined patch should transform v1 to v3
  assert.ok(combined.startsWith("--- "));
  assert.ok(combined.includes("+++ "));
  assert.ok(combined.length > 0, "combined patch should not be empty");
});

// ---------------------------------------------------------------------------
// summarizePatch
// ---------------------------------------------------------------------------

test("summarizePatch: counts added and removed lines", () => {
  const oldC = "line1\nline2\nline3\n";
  const newC = "line1\nline2-modified\nline3\nline4\n";
  const patch = createPatch(oldC, newC);

  const summary = summarizePatch(patch);

  assert.equal(summary.files, 1);
  assert.ok(summary.addedLines > 0, "should count added lines");
  assert.ok(summary.removedLines > 0, "should count removed lines");
  assert.ok(summary.hunks > 0, "should count hunks");
  assert.ok(typeof summary.summary === "string", "should have a summary string");
});

test("summarizePatch: reports no changes for identical content", () => {
  const content = "same\n";
  const patch = createPatch(content, content);

  const summary = summarizePatch(patch);

  assert.equal(summary.addedLines, 0);
  assert.equal(summary.removedLines, 0);
  assert.equal(summary.summary, "No changes");
});

// ---------------------------------------------------------------------------
// Internals: parsePatch
// ---------------------------------------------------------------------------

test("parsePatch: extracts hunks from a patch", () => {
  const oldC = "line1\nline2\nline3\n";
  const newC = "line1\nmodified\nline3\n";
  const patch = createPatch(oldC, newC);

  const hunks = parsePatch(patch);

  assert.ok(hunks.length > 0, "should parse at least one hunk");
  assert.ok(hunks[0].newLines.includes("modified"), "should include the modified line");
});

// ---------------------------------------------------------------------------
// Internals: coalesceHunks
// ---------------------------------------------------------------------------

test("coalesceHunks: merges adjacent hunks", () => {
  const hunks = [
    { oldStart: 1, oldCount: 2, newStart: 1, newCount: 2, newLines: ["a", "b"] },
    { oldStart: 4, oldCount: 2, newStart: 4, newCount: 2, newLines: ["c", "d"] },
  ];

  const result = coalesceHunks(hunks);

  assert.equal(result.length, 1, "adjacent hunks should be coalesced into one");
});

test("coalesceHunks: keeps distant hunks separate", () => {
  const hunks = [
    { oldStart: 1, oldCount: 2, newStart: 1, newCount: 2, newLines: ["a", "b"] },
    { oldStart: 100, oldCount: 2, newStart: 100, newCount: 2, newLines: ["c", "d"] },
  ];

  const result = coalesceHunks(hunks);

  assert.equal(result.length, 2, "distant hunks should stay separate");
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("createPatch: handles empty old content", () => {
  const oldC = "";
  const newC = "new file content\n";

  const patch = createPatch(oldC, newC);

  assert.ok(patch.includes("--- "));
  assert.ok(patch.includes("+++ "));
});

test("createPatch: handles empty new content", () => {
  const oldC = "old content\n";
  const newC = "";

  const patch = createPatch(oldC, newC);

  assert.ok(patch.includes("--- "));
  assert.ok(patch.includes("+++ "));
});

test("applyPatch: handles patch with multiple hunks", () => {
  const oldC = "a\nb\nc\nd\ne\nf\ng\nh\n";
  const newC = "a\nB\nc\nD\ne\nf\nG\nh\n";

  const patch = createPatch(oldC, newC);
  const result = applyPatch(oldC, patch);

  assert.equal(result, newC);
});
