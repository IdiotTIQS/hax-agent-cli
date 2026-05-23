/**
 * Tests for paste utilities: shouldRunPasteAsCommandBatch,
 * formatPastedInputSummary, formatPastedInputBadge.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  shouldRunPasteAsCommandBatch,
  formatPastedInputSummary,
  formatPastedInputBadge,
} = require("../src/paste-utils");

// ── shouldRunPasteAsCommandBatch ─────────────────────────

test("shouldRunPasteAsCommandBatch: returns false for empty input", () => {
  assert.equal(shouldRunPasteAsCommandBatch(""), false);
  assert.equal(shouldRunPasteAsCommandBatch(null), false);
  assert.equal(shouldRunPasteAsCommandBatch(undefined), false);
});

test("shouldRunPasteAsCommandBatch: returns false for single line", () => {
  assert.equal(shouldRunPasteAsCommandBatch("/help"), false);
  assert.equal(shouldRunPasteAsCommandBatch("just one line"), false);
});

test("shouldRunPasteAsCommandBatch: returns false for non-command lines", () => {
  assert.equal(
    shouldRunPasteAsCommandBatch("line one\nline two\nline three"),
    false
  );
});

test("shouldRunPasteAsCommandBatch: returns true when all lines start with /", () => {
  const input = "/help\n/clear\n/status\n/memory";
  assert.equal(shouldRunPasteAsCommandBatch(input), true);
});

test("shouldRunPasteAsCommandBatch: returns true when all lines start with !", () => {
  const input = "!echo hello\n!dir\n!git status";
  assert.equal(shouldRunPasteAsCommandBatch(input), true);
});

test("shouldRunPasteAsCommandBatch: returns true for mixed / and ! prefixes", () => {
  const input = "/help\n!git status\n/clear";
  assert.equal(shouldRunPasteAsCommandBatch(input), true);
});

test("shouldRunPasteAsCommandBatch: returns false if any line is not a command", () => {
  const input = "/help\nsomething else\n/clear";
  assert.equal(shouldRunPasteAsCommandBatch(input), false);
});

test("shouldRunPasteAsCommandBatch: ignores blank lines", () => {
  const input = "/help\n\n/clear\n  \n/status";
  assert.equal(shouldRunPasteAsCommandBatch(input), true);
});

test("shouldRunPasteAsCommandBatch: handles Windows line endings", () => {
  const input = "/help\r\n/clear\r\n/status";
  assert.equal(shouldRunPasteAsCommandBatch(input), true);
});

test("shouldRunPasteAsCommandBatch: handles only whitespace lines", () => {
  const input = "  \n\t\n\n";
  assert.equal(shouldRunPasteAsCommandBatch(input), false);
});

// ── formatPastedInputSummary ─────────────────────────────

test("formatPastedInputSummary: handles empty input", () => {
  const result = formatPastedInputSummary("");
  assert.equal(result, "Pasted 0 lines, 0 chars");
});

test("formatPastedInputSummary: handles null/undefined", () => {
  assert.equal(formatPastedInputSummary(null), "Pasted 0 lines, 0 chars");
  assert.equal(formatPastedInputSummary(undefined), "Pasted 0 lines, 0 chars");
});

test("formatPastedInputSummary: reports single line", () => {
  const result = formatPastedInputSummary("/help");
  assert.equal(result, "Pasted 1 line, 5 chars");
});

test("formatPastedInputSummary: reports multiple lines", () => {
  const result = formatPastedInputSummary("/help\n/clear\n/status");
  assert.match(result, /Pasted 3 lines/);
});

test("formatPastedInputSummary: includes formatted numbers", () => {
  const result = formatPastedInputSummary("x".repeat(1500));
  assert.ok(result.includes("1,500 chars"));
});

// ── formatPastedInputBadge ───────────────────────────────

test("formatPastedInputBadge: contains ANSI codes", () => {
  const result = formatPastedInputBadge("test");
  assert.ok(result.includes("\x1B"));
  assert.ok(result.includes("line"));
  assert.ok(result.includes("4 chars"));
});

test("formatPastedInputBadge: handles empty input", () => {
  const result = formatPastedInputBadge("");
  assert.ok(result.includes("0 lines"));
  assert.ok(result.includes("\x1B"));
});
