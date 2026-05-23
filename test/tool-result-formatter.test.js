/**
 * Tests for tool result formatter.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  formatToolResult,
  formatContent,
  truncateString,
  summarizeToolCall,
  formatDuration,
  formatBytes,
} = require("../src/tool-result-formatter");

// ---------------------------------------------------------------------------
// formatToolResult
// ---------------------------------------------------------------------------

test("formatToolResult: formats success result", () => {
  const result = formatToolResult({
    type: "tool_result",
    toolName: "file.read",
    ok: true,
    data: "Hello World",
    durationMs: 150,
  });
  assert.match(result, /file\.read/);
  assert.match(result, /OK/);
  assert.match(result, /Hello World/);
  assert.match(result, /150ms/);
});

test("formatToolResult: formats error result", () => {
  const result = formatToolResult({
    type: "tool_result",
    toolName: "web.fetch",
    ok: false,
    error: { code: "NETWORK_ERROR", message: "Connection refused" },
    durationMs: 2300,
  });
  assert.match(result, /web\.fetch/);
  assert.match(result, /FAILED/);
  assert.match(result, /NETWORK_ERROR/);
  assert.match(result, /Connection refused/);
  assert.match(result, /2\.3s/);
});

test("formatToolResult: formats timeout result", () => {
  const result = formatToolResult({
    type: "tool_result",
    toolName: "shell",
    ok: false,
    error: { code: "TOOL_TIMEOUT", message: "Operation timed out after 30000ms" },
    durationMs: 30012,
  });
  assert.match(result, /shell/);
  assert.match(result, /FAILED/);
  assert.match(result, /TOOL_TIMEOUT/);
  assert.match(result, /30s/);
});

test("formatToolResult: handles missing toolName", () => {
  const result = formatToolResult({
    type: "tool_result",
    ok: true,
    data: "test",
  });
  assert.match(result, /unknown/);
});

test("formatToolResult: handles repeated single call (cached)", () => {
  const result = formatToolResult({
    type: "tool_result",
    toolName: "web.fetch",
    ok: true,
    data: { title: "Example" },
    repeatedSingleCall: true,
    durationMs: 0,
  });
  assert.match(result, /Cached/);
});

// ---------------------------------------------------------------------------
// formatContent and truncation
// ---------------------------------------------------------------------------

test("formatToolResult: truncates long content", () => {
  const longString = "x".repeat(3000);
  const result = formatToolResult({
    type: "tool_result",
    toolName: "file.read",
    ok: true,
    data: longString,
  });
  // Should have been truncated (default 2000 bytes)
  assert.ok(result.length < 2500, `Expected <2500 chars, got ${result.length}`);
  assert.match(result, /…/);
});

test("truncateString: returns short strings unchanged", () => {
  const result = truncateString("Hello", 100);
  assert.equal(result, "Hello");
});

test("truncateString: truncates long strings with byte-aware cutoff", () => {
  const longStr = "a".repeat(500) + "Z".repeat(500);
  const result = truncateString(longStr, 100);
  assert.ok(result.length <= 110); // some wiggle room for ellipsis
  assert.ok(result.endsWith("…"));
});

// ---------------------------------------------------------------------------
// summarizeToolCall
// ---------------------------------------------------------------------------

test("summarizeToolCall: file.read", () => {
  assert.match(
    summarizeToolCall("file.read", { file_path: "/project/src/index.js" }),
    /Read.*index\.js/,
  );
});

test("summarizeToolCall: file.read with offset and limit", () => {
  const summary = summarizeToolCall("file.read", {
    file_path: "/app/config.json",
    offset: 10,
    limit: 20,
  });
  assert.match(summary, /Read.*config\.json/);
  assert.match(summary, /10-30/);
});

test("summarizeToolCall: file.write", () => {
  const summary = summarizeToolCall("file.write", {
    file_path: "/out/result.txt",
    content: "Hello World",
  });
  assert.match(summary, /Write.*result\.txt/);
  assert.match(summary, /11 B/);
});

test("summarizeToolCall: shell", () => {
  const summary = summarizeToolCall("shell", {
    command: "git log --oneline -10",
  });
  assert.match(summary, /Shell:/);
  assert.match(summary, /git log/);
});

test("summarizeToolCall: web.fetch", () => {
  const summary = summarizeToolCall("web.fetch", {
    url: "https://api.example.com/v1/data",
    maxLength: 1024,
  });
  assert.match(summary, /Fetch/);
  assert.match(summary, /api\.example\.com/);
  assert.match(summary, /1\.0 KB/);
});

test("summarizeToolCall: web.search", () => {
  const summary = summarizeToolCall("web.search", {
    query: "latest node.js security updates",
  });
  assert.match(summary, /Search web/);
  assert.match(summary, /latest node/);
});

test("summarizeToolCall: unknown/plugin tool falls back to generic", () => {
  const summary = summarizeToolCall("plugin.custom.action", {
    targetId: "abc123",
    payload: { x: 1 },
  });
  assert.match(summary, /plugin\.custom\.action/);
  assert.match(summary, /abc123/);
});

test("summarizeToolCall: empty args shows just tool name", () => {
  const summary = summarizeToolCall("file.glob", {});
  assert.match(summary, /Glob/);
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

test("formatDuration: sub-millisecond", () => {
  assert.equal(formatDuration(0.5), "<1ms");
  assert.equal(formatDuration(0), "<1ms");
});

test("formatDuration: milliseconds", () => {
  assert.equal(formatDuration(1), "1ms");
  assert.equal(formatDuration(500), "500ms");
  assert.equal(formatDuration(999), "999ms");
});

test("formatDuration: seconds", () => {
  assert.equal(formatDuration(1000), "1s");
  assert.equal(formatDuration(1200), "1.2s");
  assert.equal(formatDuration(5500), "5.5s");
  assert.equal(formatDuration(59900), "59.9s");
});

test("formatDuration: minutes", () => {
  assert.equal(formatDuration(60000), "1m");
  assert.equal(formatDuration(65000), "1m 5s");
  assert.equal(formatDuration(180000), "3m");
  assert.equal(formatDuration(185000), "3m 5s");
});

test("formatDuration: hours", () => {
  assert.equal(formatDuration(3600000), "1h");
  assert.equal(formatDuration(3660000), "1h 1m");
  assert.equal(formatDuration(3661000), "1h 1m 1s");
  assert.equal(formatDuration(7200000), "2h");
});

test("formatDuration: invalid input", () => {
  assert.equal(formatDuration(NaN), "?");
  assert.equal(formatDuration(undefined), "?");
  assert.equal(formatDuration(null), "?");
});

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

test("formatBytes: B range", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1023), "1023 B");
});

test("formatBytes: KB range", () => {
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1048575), "1024 KB");
});

test("formatBytes: MB range", () => {
  assert.equal(formatBytes(1048576), "1.0 MB");
  assert.equal(formatBytes(5242880), "5.0 MB");
});

test("formatBytes: handles negative and non-finite", () => {
  assert.equal(formatBytes(-1), "0 B");
  assert.equal(formatBytes(NaN), "0 B");
});
