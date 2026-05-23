/**
 * Tests for results-formatter module (results-formatter.js).
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ResultsFormatter,
  extractQueryTerms,
} = require("../../src/search/results-formatter");

// -----------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------

const SAMPLE_RESULTS = [
  {
    file: "src/app.js",
    line: 12,
    column: 5,
    match: "createServer",
    score: 8.5,
    context: "function createServer(opts) {\n  const srv = new Server(opts);\n  return srv;",
  },
  {
    file: "src/app.js",
    line: 25,
    column: 3,
    match: "createServer",
    score: 5.2,
    context: "  const app = createServer({ port: 3000 });\n  app.start();",
  },
  {
    file: "src/lib/util.js",
    line: 44,
    column: 10,
    match: "handleError",
    score: 3.1,
    context: "function handleError(err) {\n  console.error(err.message);\n}",
    kind: "function",
  },
];

const EMPTY_RESULTS = [];

// -----------------------------------------------------------------------
// formatBrief
// -----------------------------------------------------------------------

test("formatBrief: renders each result on a single line", () => {
  const fmt = new ResultsFormatter({ useColor: false });
  const output = fmt.formatBrief(SAMPLE_RESULTS);
  const lines = output.split("\n");
  assert.equal(lines.length, SAMPLE_RESULTS.length);
  // Each line should include file path
  for (const r of SAMPLE_RESULTS) {
    assert.ok(output.includes(r.file), `should mention ${r.file}`);
  }
});

test("formatBrief: shows placeholder for empty results", () => {
  const fmt = new ResultsFormatter({ useColor: false });
  const output = fmt.formatBrief(EMPTY_RESULTS);
  assert.ok(output.toLowerCase().includes("no result"), "should indicate no results");
});

test("formatBrief: includes scores when showScores is enabled", () => {
  const fmt = new ResultsFormatter({ useColor: false, showScores: true });
  const output = fmt.formatBrief(SAMPLE_RESULTS);
  assert.ok(output.includes("8.5"), "should show score 8.5");
});

// -----------------------------------------------------------------------
// formatDetailed
// -----------------------------------------------------------------------

test("formatDetailed: includes context snippets", () => {
  const fmt = new ResultsFormatter({ useColor: false });
  const output = fmt.formatDetailed(SAMPLE_RESULTS);
  assert.ok(output.includes("function createServer"), "should include context text");
  assert.ok(output.includes("Server(opts)"), "should include surrounding context");
});

test("formatDetailed: shows match text", () => {
  const fmt = new ResultsFormatter({ useColor: false });
  const output = fmt.formatDetailed(SAMPLE_RESULTS);
  assert.ok(output.includes("createServer"), "should show match value");
});

test("formatDetailed: handles empty results gracefully", () => {
  const fmt = new ResultsFormatter({ useColor: false });
  const output = fmt.formatDetailed(EMPTY_RESULTS);
  assert.ok(output.length > 0);
});

// -----------------------------------------------------------------------
// formatGrouped
// -----------------------------------------------------------------------

test("formatGrouped: groups results by file", () => {
  const fmt = new ResultsFormatter({ useColor: false });
  const output = fmt.formatGrouped(SAMPLE_RESULTS);
  // src/app.js should appear as a group header
  assert.ok(output.includes("src/app.js"), "should show file name");
  // Should show match count
  assert.ok(output.includes("2 match"), "should show match count for app.js");
});

test("formatGrouped: handles empty results", () => {
  const fmt = new ResultsFormatter({ useColor: false });
  const output = fmt.formatGrouped(EMPTY_RESULTS);
  assert.ok(output.length > 0);
});

// -----------------------------------------------------------------------
// formatSummary
// -----------------------------------------------------------------------

test("formatSummary: includes counts and statistics", () => {
  const fmt = new ResultsFormatter({ useColor: false });
  const output = fmt.formatSummary(SAMPLE_RESULTS);
  assert.ok(output.includes("Total matches"), "should show total matches");
  assert.ok(output.includes("3"), "should show count of 3");
  assert.ok(output.includes("Unique files"), "should show unique file count");
  assert.ok(output.includes("2"), "should show 2 unique files");
  assert.ok(output.includes("Avg score"), "should show average score");
});

test("formatSummary: handles empty results", () => {
  const fmt = new ResultsFormatter({ useColor: false });
  const output = fmt.formatSummary(EMPTY_RESULTS);
  assert.ok(output.toLowerCase().includes("no result") || output.toLowerCase().includes("nothing"), "should indicate no results");
});

// -----------------------------------------------------------------------
// highlightMatches
// -----------------------------------------------------------------------

test("highlightMatches: wraps matched terms in ANSI codes", () => {
  const fmt = new ResultsFormatter({ useColor: true });
  const text = "function createServer() { return new Server(); }";
  const result = fmt.highlightMatches(text, "createServer");
  assert.ok(result.includes("\x1b[33m"), "should contain yellow ANSI code");
  assert.ok(result.includes("createServer"), "should still contain the matched text");
  assert.ok(result.includes("\x1b[0m"), "should contain reset code");
});

test("highlightMatches: strips ANSI when useColor is false", () => {
  const fmt = new ResultsFormatter({ useColor: false });
  const text = "function createServer() {}";
  const result = fmt.highlightMatches(text, "createServer");
  assert.equal(result, text, "should return original text unchanged");
});

test("highlightMatches: returns original text for empty query", () => {
  const fmt = new ResultsFormatter({ useColor: true });
  const text = "some text here";
  const result = fmt.highlightMatches(text, "");
  assert.equal(result, text);
});

test("highlightMatches: highlights multiple query terms", () => {
  const fmt = new ResultsFormatter({ useColor: true });
  const text = "const server = createServer(); server.start();";
  const result = fmt.highlightMatches(text, "server createServer");
  // Both terms should be highlighted (check yellow codes appear for both)
  const yellowCount = (result.match(/\x1b\[33m/g) || []).length;
  assert.ok(yellowCount >= 2, `should have at least 2 highlights, got ${yellowCount}`);
});

// -----------------------------------------------------------------------
// extractQueryTerms
// -----------------------------------------------------------------------

test("extractQueryTerms: extracts plain words, ignoring filter syntax", () => {
  const terms = extractQueryTerms("hello func:world file:*.js -exclude:test");
  assert.ok(terms.includes("hello"), "should include 'hello'");
  assert.ok(!terms.includes("world"), "should NOT include filter value 'world'");
  assert.ok(!terms.includes("func"), "should NOT include filter key 'func'");
});

test("extractQueryTerms: extracts terms from quoted strings", () => {
  const terms = extractQueryTerms('"hello world" plain');
  assert.ok(terms.includes("hello world"), "should include quoted phrase");
  assert.ok(terms.includes("plain"), "should include unquoted word");
});

test("extractQueryTerms: deduplicates case-insensitively", () => {
  const terms = extractQueryTerms("Hello hello HELLO");
  const lowerTerms = terms.map((t) => t.toLowerCase());
  const helloCount = lowerTerms.filter((t) => t === "hello").length;
  assert.equal(helloCount, 1, "should deduplicate 'hello'");
});
