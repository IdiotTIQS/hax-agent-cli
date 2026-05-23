/**
 * Tests for HTML export formats.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  exportAsHtml,
  exportAsHtmlFragment,
  exportAsInteractiveHtml,
  _escapeHtml,
  _highlightCodeToHtml,
} = require("../../../src/export/formats/html");

// ── helper: build a mock session ─────────────────────────────────────────

function makeSession(overrides = {}) {
  const entries = overrides.entries || [];
  const metadata = overrides.metadata || {};
  return {
    id: overrides.id || "test-session-123",
    updatedAt: overrides.updatedAt || "2025-01-15T10:30:00.000Z",
    entries: () => entries,
    metadata: () => metadata,
  };
}

// ── escapeHtml ───────────────────────────────────────────────────────────

test("escapeHtml: escapes HTML special characters", () => {
  const input = '<script>alert("xss");</script>';
  const output = _escapeHtml(input);
  assert.ok(!output.includes("<script>"), "should not contain raw script tag");
  assert.ok(output.includes("&lt;"), "should contain &lt;");
  assert.ok(output.includes("&gt;"), "should contain &gt;");
  assert.ok(output.includes("&quot;"), "should contain &quot;");
});

test("escapeHtml: returns empty string for non-string input", () => {
  assert.equal(_escapeHtml(null), "");
  assert.equal(_escapeHtml(undefined), "");
  // Numbers are not strings, so they return "" per the typeof guard
  assert.equal(_escapeHtml(42), "");
});

test("escapeHtml: preserves normal text", () => {
  assert.equal(_escapeHtml("Hello World"), "Hello World");
  assert.equal(_escapeHtml("abc 123"), "abc 123");
});

// ── exportAsHtml ─────────────────────────────────────────────────────────

test("exportAsHtml: produces valid HTML document with DOCTYPE", () => {
  const session = makeSession({
    entries: [
      { role: "user", content: "Hello", timestamp: "2025-01-15T10:00:00Z" },
      { role: "assistant", content: "Hi there!", timestamp: "2025-01-15T10:01:00Z" },
    ],
  });

  const html = exportAsHtml(session, { title: "Test Session" });

  assert.ok(html.startsWith("<!DOCTYPE html>"), "should start with DOCTYPE");
  assert.ok(html.includes("<title>Test Session</title>"), "should include title");
  assert.ok(html.includes('<meta charset="UTF-8">'), "should include charset meta");
  assert.ok(html.includes("</html>"), "should close html tag");
  assert.ok(html.includes("Hello"), "should include user message content");
  assert.ok(html.includes("Hi there!"), "should include assistant message content");
});

test("exportAsHtml: includes session metadata in header", () => {
  const session = makeSession({
    id: "abc-123",
    updatedAt: "2025-03-10T14:00:00Z",
    metadata: { projectName: "MyProject" },
    entries: [{ role: "user", content: "msg" }],
  });

  const html = exportAsHtml(session, {});

  assert.ok(html.includes("abc-123"), "should include session id");
  assert.ok(html.includes("MyProject"), "should include project name");
  assert.ok(html.includes("Messages: 1"), "should include message count");
});

test("exportAsHtml: renders tool entries with data", () => {
  const session = makeSession({
    entries: [
      {
        role: "tool",
        name: "read_file",
        content: "file content here",
        data: '{"result": "ok"}',
        timestamp: "2025-01-15T10:00:00Z",
      },
    ],
  });

  const html = exportAsHtml(session, { title: "Tools" });

  assert.ok(html.includes("read_file"), "should include tool name");
  assert.ok(html.includes("msg-tool"), "should have tool CSS class");
});

test("exportAsHtml: renders error flag on error entries", () => {
  const session = makeSession({
    entries: [
      {
        role: "tool",
        name: "bad_tool",
        content: "oops",
        isError: true,
        timestamp: "2025-01-15T10:00:00Z",
      },
    ],
  });

  const html = exportAsHtml(session, { title: "Error Test" });

  assert.ok(html.includes("msg-error-banner"), "should include error banner class");
});

test("exportAsHtml: handles entries with code blocks in content", () => {
  const session = makeSession({
    entries: [
      {
        role: "assistant",
        content: 'Here is some code:\n```javascript\nconst x = 1;\n```\nDone.',
        timestamp: "2025-01-15T10:00:00Z",
      },
    ],
  });

  const html = exportAsHtml(session, { title: "Code" });

  assert.ok(html.includes("code-block"), "should include code block class");
  // Tokens are wrapped in <span> elements, so the raw substring won't match
  assert.ok(html.includes("hl-keyword"), "should have keyword highlighting");
  assert.ok(html.includes("hl-number"), "should have number highlighting");
});

// ── exportAsHtmlFragment ─────────────────────────────────────────────────

test("exportAsHtmlFragment: produces fragment without html/head/body", () => {
  const session = makeSession({
    entries: [
      { role: "user", content: "Test message", timestamp: "2025-01-15T10:00:00Z" },
    ],
  });

  const fragment = exportAsHtmlFragment(session);

  assert.ok(!fragment.includes("<!DOCTYPE html>"), "should not include DOCTYPE");
  assert.ok(!fragment.includes("<html"), "should not include html tag");
  assert.ok(fragment.includes("hax-conversation"), "should include wrapper div");
  assert.ok(fragment.includes("Test message"), "should include message content");
});

test("exportAsHtmlFragment: renders multiple messages correctly", () => {
  const session = makeSession({
    entries: [
      { role: "user", content: "Q1", timestamp: "2025-01-15T10:00:00Z" },
      { role: "assistant", content: "A1", timestamp: "2025-01-15T10:01:00Z" },
      { role: "user", content: "Q2", timestamp: "2025-01-15T10:02:00Z" },
    ],
  });

  const fragment = exportAsHtmlFragment(session);

  // Count data-role attributes in message divs (CSS classes also appear in stylesheet)
  const userMessages = (fragment.match(/data-role="user"/g) || []).length;
  const assistantMessages = (fragment.match(/data-role="assistant"/g) || []).length;

  assert.equal(userMessages, 2, "should have 2 user messages");
  assert.equal(assistantMessages, 1, "should have 1 assistant message");
});

// ── exportAsInteractiveHtml ──────────────────────────────────────────────

test("exportAsInteractiveHtml: includes search bar and script", () => {
  const session = makeSession({
    entries: [
      { role: "user", content: "Hello", timestamp: "2025-01-15T10:00:00Z" },
    ],
  });

  const html = exportAsInteractiveHtml(session, { title: "Interactive" });

  assert.ok(html.includes("search-bar"), "should include search bar");
  assert.ok(html.includes("searchInput"), "should have search input");
  assert.ok(html.includes("Expand All"), "should have expand all button");
  assert.ok(html.includes("Collapse All"), "should have collapse all button");
  assert.ok(html.includes("<script>"), "should include inline script");
  assert.ok(html.includes("doSearch"), "should have search function");
  assert.ok(html.includes("expandAll"), "should have expandAll function");
  assert.ok(html.includes("collapseAll"), "should have collapseAll function");
});

test("exportAsInteractiveHtml: includes collapse buttons on messages", () => {
  const session = makeSession({
    entries: [
      { role: "user", content: "msg1", timestamp: "2025-01-15T10:00:00Z" },
      { role: "assistant", content: "msg2", timestamp: "2025-01-15T10:01:00Z" },
    ],
  });

  const html = exportAsInteractiveHtml(session);

  // Each message should have a collapse button (count in HTML body, not CSS)
  const collapseBtns = (html.match(/class="msg-collapse-btn"/g) || []).length;
  assert.equal(collapseBtns, 2, "should have 2 collapse buttons");
});

// ── highlightCodeToHtml ──────────────────────────────────────────────────

test("_highlightCodeToHtml: highlights JavaScript keywords", () => {
  const result = _highlightCodeToHtml('const x = function() { return true; }', "javascript");
  assert.ok(result.includes("hl-keyword"), "should use keyword class");
  assert.ok(result.includes("hl-string") === false, "should not have string highlight here");
});

test("_highlightCodeToHtml: highlights JSON", () => {
  const result = _highlightCodeToHtml('{"key": "value", "count": 42}', "json");
  assert.ok(result.includes("hl-builtin"), "JSON keys should use builtin class");
  assert.ok(result.includes("hl-string"), "JSON string values should use string class");
  assert.ok(result.includes("hl-number"), "JSON numbers should use number class");
});

test("_highlightCodeToHtml: auto-detects JSON from content", () => {
  // When no language is specified but content looks like JSON
  const result = _highlightCodeToHtml('{"name": "test", "count": 5}', "");
  assert.ok(result.includes("hl-string"), "should highlight as JSON");
});

test("_highlightCodeToHtml: highlights shell commands", () => {
  const result = _highlightCodeToHtml("npm install --save express", "bash");
  assert.ok(result.includes("hl-keyword"), "should highlight npm as keyword");
  assert.ok(result.includes("hl-attribute"), "should highlight --save flag");
});

test("_highlightCodeToHtml: highlights diff output", () => {
  const result = _highlightCodeToHtml("+added line\n-removed line\n@@ -1,3 +1,3 @@", "diff");
  assert.ok(result.includes("hl-diff-add"), "should highlight added lines");
  assert.ok(result.includes("hl-diff-remove"), "should highlight removed lines");
  assert.ok(result.includes("hl-diff-header"), "should highlight hunk headers");
});

test("_highlightCodeToHtml: handles empty input", () => {
  assert.equal(_highlightCodeToHtml("", "javascript"), "");
  assert.equal(_highlightCodeToHtml(null, "javascript"), "");
});
