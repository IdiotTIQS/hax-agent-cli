/**
 * Tests for renderer pure utility functions: formatBytes, formatDuration,
 * formatDisplayPath, pluralize, toToolLabel, isDisplayableInput,
 * formatProviderError, stripAnsi, styled, formatChangeSummary,
 * formatToolInputSummary, formatToolStart.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  formatBytes,
  formatDuration,
  formatDisplayPath,
  pluralize,
  toToolLabel,
  isDisplayableInput,
  formatProviderError,
  stripAnsi,
  styled,
  formatChangeSummary,
  formatToolInputSummary,
  formatToolStart,
} = require("../src/renderer");

// ── formatBytes ──────────────────────────────────────────

test("formatBytes: returns '0 B' for zero", () => {
  assert.equal(formatBytes(0), "0 B");
});

test("formatBytes: returns '0 B' for null/undefined/NaN", () => {
  assert.equal(formatBytes(null), "0 B");
  assert.equal(formatBytes(undefined), "0 B");
  assert.equal(formatBytes(NaN), "0 B");
  assert.equal(formatBytes(Infinity), "0 B");
});

test("formatBytes: formats bytes", () => {
  assert.equal(formatBytes(500), "500 B");
});

test("formatBytes: formats KB", () => {
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
});

test("formatBytes: formats MB", () => {
  assert.equal(formatBytes(1048576), "1.0 MB");
  assert.equal(formatBytes(5242880), "5.0 MB");
});

test("formatBytes: formats GB", () => {
  assert.equal(formatBytes(1073741824), "1.0 GB");
});

// ── formatDuration ───────────────────────────────────────

test("formatDuration: returns empty for null/undefined/NaN", () => {
  assert.equal(formatDuration(null), "");
  assert.equal(formatDuration(undefined), "");
  assert.equal(formatDuration(NaN), "");
  assert.equal(formatDuration("not-a-number"), "");
});

test("formatDuration: formats valid duration", () => {
  assert.equal(formatDuration(42), " in 42ms");
  assert.equal(formatDuration(1000), " in 1000ms");
  assert.equal(formatDuration(0), " in 0ms");
});

// ── formatDisplayPath ────────────────────────────────────

test("formatDisplayPath: converts slashes to backslashes", () => {
  assert.equal(formatDisplayPath("src/index.js"), "src\\index.js");
  assert.equal(formatDisplayPath("/absolute/path/file.txt"), "\\absolute\\path\\file.txt");
});

test("formatDisplayPath: handles no slashes", () => {
  assert.equal(formatDisplayPath("file.txt"), "file.txt");
});

test("formatDisplayPath: handles null/undefined", () => {
  assert.equal(formatDisplayPath(null), "null");
  assert.equal(formatDisplayPath(undefined), "undefined");
});

// ── pluralize ────────────────────────────────────────────

test("pluralize: returns singular for count 1", () => {
  assert.equal(pluralize("file", 1), "file");
  assert.equal(pluralize("match", 1), "match");
  assert.equal(pluralize("line", 1), "line");
});

test("pluralize: returns plural for count other than 1", () => {
  assert.equal(pluralize("file", 0), "files");
  assert.equal(pluralize("file", 2), "files");
  assert.equal(pluralize("file", 100), "files");
  assert.equal(pluralize("match", 3), "matchs"); // Simple +s suffix
});

// ── toToolLabel ──────────────────────────────────────────

test("toToolLabel: converts dotted name to spaced title case", () => {
  assert.equal(toToolLabel("file.read"), "File Read");
  assert.equal(toToolLabel("shell.run"), "Shell Run");
  assert.equal(toToolLabel("web.fetch"), "Web Fetch");
  assert.equal(toToolLabel("stock.quote"), "Stock Quote");
});

test("toToolLabel: handles single word", () => {
  assert.equal(toToolLabel("help"), "Help");
});

test("toToolLabel: handles null/undefined", () => {
  assert.equal(toToolLabel(null), "Tool");
  assert.equal(toToolLabel(undefined), "Tool");
  assert.equal(toToolLabel(""), "Tool");
});

test("toToolLabel: handles empty segments in dotted names", () => {
  // If there are consecutive dots or leading/trailing dots
  const result = toToolLabel(".file.read.");
  assert.ok(result.length > 0);
});

// ── isDisplayableInput ───────────────────────────────────

test("isDisplayableInput: filters out sensitive key names", () => {
  assert.equal(isDisplayableInput("apiKey", "value"), false);
  assert.equal(isDisplayableInput("token", "value"), false);
  assert.equal(isDisplayableInput("secret", "value"), false);
  assert.equal(isDisplayableInput("password", "value"), false);
  assert.equal(isDisplayableInput("CONTENT", "value"), false);
  assert.equal(isDisplayableInput("env", "value"), false);
});

test("isDisplayableInput: filters case-insensitively", () => {
  assert.equal(isDisplayableInput("API_KEY", "value"), false);
  assert.equal(isDisplayableInput("Secret", "value"), false);
  assert.equal(isDisplayableInput("Token", "value"), false);
});

test("isDisplayableInput: allows non-sensitive string keys", () => {
  assert.equal(isDisplayableInput("path", "src/index.js"), true);
  assert.equal(isDisplayableInput("query", "search text"), true);
  assert.equal(isDisplayableInput("command", "git status"), true);
});

test("isDisplayableInput: allows numbers", () => {
  assert.equal(isDisplayableInput("limit", 10), true);
  assert.equal(isDisplayableInput("offset", 0), true);
});

test("isDisplayableInput: allows booleans", () => {
  assert.equal(isDisplayableInput("verbose", true), true);
  assert.equal(isDisplayableInput("silent", false), true);
});

test("isDisplayableInput: rejects objects and arrays", () => {
  assert.equal(isDisplayableInput("config", {}), false);
  assert.equal(isDisplayableInput("items", []), false);
  assert.equal(isDisplayableInput("data", null), false);
});

// ── stripAnsi ────────────────────────────────────────────

test("stripAnsi: removes ANSI escape codes", () => {
  const input = "\x1B[31mred text\x1B[0m normal";
  const result = stripAnsi(input);
  assert.equal(result, "red text normal");
});

test("stripAnsi: handles text without ANSI codes", () => {
  assert.equal(stripAnsi("plain text"), "plain text");
});

test("stripAnsi: handles empty string", () => {
  assert.equal(stripAnsi(""), "");
});

// ── styled ───────────────────────────────────────────────

test("styled: wraps text with color and reset", () => {
  const result = styled("\x1B[31m", "error");
  assert.equal(result, "\x1B[31merror\x1B[0m");
});

test("styled: handles empty text", () => {
  const result = styled("\x1B[31m", "");
  assert.equal(result, "\x1B[31m\x1B[0m");
});

// ── formatChangeSummary ──────────────────────────────────

test("formatChangeSummary: shows added and removed lines", () => {
  const change = { added: 5, removed: 3, changed: 8 };
  const result = formatChangeSummary(change);
  assert.ok(result.includes("Added 5 lines"));
  assert.ok(result.includes("Removed 3 lines"));
});

test("formatChangeSummary: shows only added when no removed", () => {
  const change = { added: 10, removed: 0, changed: 10 };
  const result = formatChangeSummary(change);
  assert.ok(result.includes("Added 10 lines"));
  assert.ok(!result.includes("Removed"));
});

test("formatChangeSummary: falls back to 'Modified N lines' when no added/removed", () => {
  const change = { added: 0, removed: 0, changed: 3 };
  const result = formatChangeSummary(change);
  assert.ok(result.includes("Modified 3 lines"));
  assert.ok(!result.includes("Added"));
  assert.ok(!result.includes("Removed"));
});

test("formatChangeSummary: defaults to 1 changed when changed is 0", () => {
  const change = { added: 0, removed: 0, changed: 0 };
  const result = formatChangeSummary(change);
  assert.ok(result.includes("Modified 1 line"));
});

// ── formatProviderError ──────────────────────────────────

test("formatProviderError: returns empty_tool_preamble message with guidance", () => {
  const err = { code: "EMPTY_TOOL_PREAMBLE", message: "Model did not call tool" };
  const result = formatProviderError(err);
  assert.ok(result.includes("planning text instead of a tool call"));
  assert.ok(result.includes("switch to a model"));
});

test("formatProviderError: appends API key guidance for 401 errors", () => {
  const err = { message: "401 Unauthorized" };
  const result = formatProviderError(err);
  assert.ok(result.includes("API key may be invalid"));
  assert.ok(result.includes("/api-key"));
});

test("formatProviderError: appends rate limit guidance for 429", () => {
  const err = { message: "429 Too Many Requests" };
  const result = formatProviderError(err);
  assert.ok(result.includes("Rate limited"));
  assert.ok(result.includes("/provider"));
});

test("formatProviderError: appends billing guidance", () => {
  const err = { message: "insufficient quota" };
  const result = formatProviderError(err);
  assert.ok(result.includes("quota"));
  assert.ok(result.includes("/provider"));
});

test("formatProviderError: appends network guidance", () => {
  const err = { message: "fetch failed ETIMEDOUT" };
  const result = formatProviderError(err);
  assert.ok(result.includes("Network error"));
});

test("formatProviderError: anthropic provider with non-auth error returns raw message", () => {
  // The anthropic-specific handler in the code only applies to 401/403 codes,
  // but those are caught by the earlier auth check. Non-auth messages return raw.
  const err = { message: "an unknown anthropic error occurred" };
  const provider = { name: "anthropic" };
  const result = formatProviderError(err, provider);
  assert.equal(result, "an unknown anthropic error occurred");
});

test("formatProviderError: returns raw message for unrecognized errors", () => {
  const result = formatProviderError(
    { message: "something unexpected" },
    { name: "mock" }
  );
  assert.equal(result, "something unexpected");
});

test("formatProviderError: handles null/undefined error", () => {
  const result = formatProviderError(null);
  assert.equal(result, "null");
});

test("formatProviderError: handles string error", () => {
  // Uses the string as the message
  const result = formatProviderError("direct string error");
  assert.equal(result, "direct string error");
});

// ── formatToolInputSummary ───────────────────────────────

test("formatToolInputSummary: returns empty for null/undefined input", () => {
  assert.equal(formatToolInputSummary("file.read", null), "");
  assert.equal(formatToolInputSummary("file.read", undefined), "");
});

test("formatToolInputSummary: returns empty when input is not an object", () => {
  assert.equal(formatToolInputSummary("file.read", "string"), "");
});

test("formatToolInputSummary: formats file.read with path", () => {
  const result = formatToolInputSummary("file.read", { path: "src/index.js" });
  assert.ok(result.includes("src\\index.js"));
});

test("formatToolInputSummary: formats shell.run with command", () => {
  const result = formatToolInputSummary("shell.run", {
    command: "git",
    args: ["status"],
  });
  assert.ok(result.includes("git status"));
});

test("formatToolInputSummary: formats file.glob with pattern and cwd", () => {
  const result = formatToolInputSummary("file.glob", {
    pattern: "**/*.js",
    cwd: "src",
  });
  assert.ok(result.includes("**/*.js"));
  assert.ok(result.includes("src"));
});

test("formatToolInputSummary: formats file.search with query", () => {
  const result = formatToolInputSummary("file.search", {
    query: "function",
    path: "src",
  });
  assert.ok(result.includes("function"));
  assert.ok(result.includes("src"));
});

test("formatToolInputSummary: falls back to generic display for unknown tool", () => {
  const result = formatToolInputSummary("unknown.tool", {
    name: "long-name-that-should-be-truncated-if-too-long",
    count: 42,
  });
  assert.ok(result.length > 0);
});

test("formatToolInputSummary: truncates long values", () => {
  const result = formatToolInputSummary("unknown.tool", {
    description: "a".repeat(100),
  });
  // Should be truncated to ~40 chars
  assert.ok(!result.includes("a".repeat(100)));
});

test("formatToolInputSummary: filters sensitive keys from generic display", () => {
  const result = formatToolInputSummary("unknown.tool", {
    apiKey: "secret-value",
    path: "visible",
  });
  assert.ok(result.includes("path"));
  assert.ok(!result.includes("secret-value"));
  assert.ok(!result.includes("apiKey"));
});

// ── formatToolStart ──────────────────────────────────────

test("formatToolStart: formats basic tool with name", () => {
  const result = formatToolStart({ name: "file.read", input: { path: "test.txt" } });
  assert.ok(result.includes("File Read"));
  assert.ok(result.includes("test.txt"));
});

test("formatToolStart: includes attempt label when > 1", () => {
  const result = formatToolStart({
    name: "file.read",
    input: { path: "test.txt" },
    attempt: 2,
  });
  assert.ok(result.includes("attempt 2"));
});

test("formatToolStart: no attempt label for first attempt", () => {
  const result = formatToolStart({
    name: "file.read",
    input: { path: "test.txt" },
    attempt: 1,
  });
  assert.ok(!result.includes("attempt 1"));
});

test("formatToolStart: no attempt label when attempt not set", () => {
  const result = formatToolStart({ name: "file.read", input: {} });
  assert.ok(!result.includes("attempt"));
});
