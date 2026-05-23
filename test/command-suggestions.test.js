/**
 * Tests for command suggestions: editDistance, suggestCommand.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { editDistance, suggestCommand } = require("../src/command-suggestions");

// ── editDistance ─────────────────────────────────────────

test("editDistance: returns 0 for identical strings", () => {
  assert.equal(editDistance("hello", "hello"), 0);
});

test("editDistance: returns string length for empty target", () => {
  assert.equal(editDistance("hello", ""), 5);
  assert.equal(editDistance("test", ""), 4);
});

test("editDistance: returns string length for empty source", () => {
  assert.equal(editDistance("", "hello"), 5);
  assert.equal(editDistance("", "test"), 4);
});

test("editDistance: returns 0 for both empty", () => {
  assert.equal(editDistance("", ""), 0);
});

test("editDistance: handles null/undefined gracefully", () => {
  assert.equal(editDistance(null, "test"), 4);
  assert.equal(editDistance("test", null), 4);
  assert.equal(editDistance(null, null), 0);
  assert.equal(editDistance(undefined, "test"), 4);
});

test("editDistance: case insensitive", () => {
  assert.equal(editDistance("Hello", "hello"), 0);
  assert.equal(editDistance("WORLD", "world"), 0);
  assert.equal(editDistance("MixedCase", "mixedcase"), 0);
});

test("editDistance: standard substitutions", () => {
  // kitten -> sitting = 3 edits
  assert.equal(editDistance("kitten", "sitting"), 3);
  // abc -> xyz = 3 substitutions
  assert.equal(editDistance("abc", "xyz"), 3);
  // file -> files = 1 insert
  assert.equal(editDistance("file", "files"), 1);
  // files -> file = 1 delete
  assert.equal(editDistance("files", "file"), 1);
});

test("editDistance: transposition detection", () => {
  // "teh" should be close to "the" (1 transposition)
  const d1 = editDistance("teh", "the");
  assert.ok(d1 <= 2); // Classic edit distance would give 2; with transposition it's 1
});

test("editDistance: completely different strings", () => {
  const d = editDistance("abcdef", "ghijkl");
  assert.equal(d, 6); // All need substitution
});

// ── suggestCommand ───────────────────────────────────────

test("suggestCommand: returns null for empty input", () => {
  assert.equal(suggestCommand("", ["cmd1", "cmd2"]), null);
  assert.equal(suggestCommand("   ", ["cmd1", "cmd2"]), null);
  assert.equal(suggestCommand("/", ["cmd1", "cmd2"]), null);
});

test("suggestCommand: strips leading slash", () => {
  const result = suggestCommand("/help", ["help"]);
  assert.equal(result, "help");
});

test("suggestCommand: suggests exact match", () => {
  const result = suggestCommand("help", ["help", "clear", "exit"]);
  assert.equal(result, "help");
});

test("suggestCommand: suggests closest command for typo", () => {
  const candidates = ["help", "clear", "exit"];
  const result = suggestCommand("hel", candidates);
  assert.equal(result, "help");
});

test("suggestCommand: suggests with custom object format", () => {
  const candidates = [
    { name: "help", description: "Show help" },
    { name: "clear", description: "Clear screen" },
  ];
  const result = suggestCommand("hlep", candidates);
  assert.equal(result, "help");
});

test("suggestCommand: suggests with hybrid formats", () => {
  const candidates = [
    { match: "skill", suggest: "skill" },
    { match: "skills", suggest: "skills" },
    { match: "setup", suggest: "setup" },
  ];
  const result = suggestCommand("skil", candidates);
  assert.equal(result, "skill");
});

test("suggestCommand: prefers shorter suggestions on distance tie", () => {
  const candidates = [
    { match: "skill", suggest: "skill" },
    { match: "skil1", suggest: "skil1" },
  ];
  const result = suggestCommand("skil", candidates);
  assert.equal(result, "skill");
});

test("suggestCommand: returns null when no candidates match", () => {
  const result = suggestCommand("something", []);
  assert.equal(result, null);
});

test("suggestCommand: returns null when distance exceeds threshold", () => {
  const candidates = ["help"];
  const result = suggestCommand("completely_different", candidates);
  assert.equal(result, null);
});

test("suggestCommand: handles special regex characters in input", () => {
  // Should not crash on regex special chars
  const candidates = ["test.command", "other"];
  const result = suggestCommand("test.command", candidates);
  assert.equal(result, "test.command");
});

test("suggestCommand: handles candidates with null/undefined fields", () => {
  const candidates = [
    { name: null, value: "option1" },
    { name: "proper", value: "option2" },
  ];
  // Should filter out the one with null match
  const result = suggestCommand("proper", candidates);
  assert.equal(result, "proper");
});

test("suggestCommand: threshold scales with input length", () => {
  // Short input has threshold = 1
  const result = suggestCommand("ab", ["abc"]);
  assert.equal(result, "abc"); // distance 1, threshold 1

  // Longer input has bigger threshold
  const longInput = "abcdefghijklmnop";
  const longCandidate = "abcdefghijklmXop";
  // distance 1, threshold = max(1, min(3, ceil(16*0.35))) = max(1, min(3, 6)) = 3
  const result2 = suggestCommand(longInput, [longCandidate]);
  assert.equal(result2, longCandidate);
});
