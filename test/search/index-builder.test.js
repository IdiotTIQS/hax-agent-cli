/**
 * Tests for index-builder module (index-builder.js).
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const {
  CodeIndex,
  tokenize,
  tokenizeSimple,
  splitIdentifier,
} = require("../../src/search/index-builder");

// -----------------------------------------------------------------------
// splitIdentifier
// -----------------------------------------------------------------------

test("splitIdentifier: splits camelCase", () => {
  const parts = splitIdentifier("fooBarBaz");
  assert.deepEqual(parts, ["foo", "bar", "baz"]);
});

test("splitIdentifier: splits PascalCase", () => {
  const parts = splitIdentifier("HTMLElement");
  assert.deepEqual(parts, ["html", "element"]);
});

test("splitIdentifier: splits snake_case", () => {
  const parts = splitIdentifier("my_var_name");
  assert.deepEqual(parts, ["my", "var", "name"]);
});

test("splitIdentifier: handles mixed casing", () => {
  const parts = splitIdentifier("MAX_RETRY_COUNT");
  assert.deepEqual(parts, ["max", "retry", "count"]);
});

// -----------------------------------------------------------------------
// tokenize
// -----------------------------------------------------------------------

test("tokenize: extracts identifiers with positions", () => {
  const code = "const fooBar = 1;\nlet baz = fooBar + 2;";
  const tokens = tokenize(code);
  const tokenNames = tokens.map((t) => t.token);
  assert.ok(tokenNames.includes("foo"), "should include 'foo' from 'fooBar'");
  assert.ok(tokenNames.includes("bar"), "should include 'bar' from 'fooBar'");
  assert.ok(tokenNames.includes("baz"), "should include 'baz'");
});

test("tokenize: reports correct line numbers", () => {
  const code = "line1\nline2\nconst value = 42;";
  const tokens = tokenize(code);
  const valueTokens = tokens.filter((t) => t.token === "value");
  assert.ok(valueTokens.length >= 1);
  assert.equal(valueTokens[0].line, 3, "'value' should be on line 3");
});

// -----------------------------------------------------------------------
// CodeIndex: indexFile & search
// -----------------------------------------------------------------------

test("CodeIndex.indexFile: indexes a file and returns token count", () => {
  const idx = new CodeIndex();
  const stats = idx.indexFile("test.js", "const foo = 1;\nlet bar = foo + 2;");
  assert.ok(stats.tokens > 0, "should index tokens");
  assert.equal(idx.documentCount, 1);
});

test("CodeIndex.search: finds indexed code by token", () => {
  const idx = new CodeIndex();
  idx.indexFile("a.js", "function createApp() {\n  const config = loadConfig();\n  return app;\n}");
  const results = idx.search("createApp");
  assert.ok(results.length > 0, "should find createApp");
  assert.equal(results[0].file, "a.js");
});

test("CodeIndex.search: returns scored results sorted by relevance", () => {
  const idx = new CodeIndex();
  idx.indexFile("main.js", "const server = createServer();\nserver.listen(3000);\nserver.on('request', handler);");
  idx.indexFile("lib.js", "function createServer() {\n  return new Server();\n}");
  const results = idx.search("server");
  assert.ok(results.length > 0);
  // Scores should be descending
  for (let i = 1; i < results.length; i += 1) {
    assert.ok(results[i - 1].score >= results[i].score, "scores should be non-increasing");
  }
});

test("CodeIndex.search: respects maxResults option", () => {
  const idx = new CodeIndex();
  idx.indexFile("f.js", "a\na\na\na\na\na\na\na\na\na\n"); // many 'a' tokens
  const results = idx.search("a", { maxResults: 3 });
  assert.ok(results.length <= 3, "should respect maxResults");
});

test("CodeIndex.search: includes context when requested", () => {
  const idx = new CodeIndex();
  idx.indexFile("c.js", "// line 1\n// line 2\nconst target = 42;\n// line 4\n// line 5");
  const results = idx.search("target", { context: true });
  assert.ok(results.length > 0);
  assert.ok(typeof results[0].context === "string", "should include context string");
  assert.ok(results[0].context.length > 0, "context should not be empty");
});

// -----------------------------------------------------------------------
// CodeIndex: update & remove
// -----------------------------------------------------------------------

test("CodeIndex.update: replaces old content with new", () => {
  const idx = new CodeIndex();
  idx.indexFile("mod.js", "const old = true;");
  idx.update("mod.js", "const fresh = true;");
  // Should find "fresh" but not "old"
  const freshResults = idx.search("fresh");
  const oldResults = idx.search("old");
  assert.ok(freshResults.length > 0, "should find new tokens");
  assert.equal(oldResults.length, 0, "should not find old tokens");
});

test("CodeIndex.remove: removes file from index completely", () => {
  const idx = new CodeIndex();
  idx.indexFile("remove.js", "const gone = 'bye';");
  assert.equal(idx.documentCount, 1);
  idx.remove("remove.js");
  assert.equal(idx.documentCount, 0);
  const results = idx.search("gone");
  assert.equal(results.length, 0, "removed file should not appear in search");
});

// -----------------------------------------------------------------------
// CodeIndex: save & load
// -----------------------------------------------------------------------

test("CodeIndex.save and load: round-trips index state", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hax-index-"));
  const indexPath = path.join(tmpDir, "index.json");

  try {
    const idx = new CodeIndex();
    idx.indexFile("roundtrip.js", "function hello() { return 'world'; }");
    await idx.save(indexPath);

    const loaded = new CodeIndex();
    await loaded.load(indexPath);
    assert.equal(loaded.documentCount, 1);
    const results = loaded.search("hello");
    assert.ok(results.length > 0);
    assert.equal(results[0].file, "roundtrip.js");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------
// CodeIndex: indexDirectory
// -----------------------------------------------------------------------

test("CodeIndex.indexDirectory: indexes files in a directory", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hax-idxdir-"));
  try {
    // Create a small project tree
    await fs.writeFile(path.join(tmpDir, "app.js"), "function main() {\n  init();\n}", "utf-8");
    await fs.writeFile(path.join(tmpDir, "util.js"), "function init() {\n  console.log('ready');\n}", "utf-8");
    // A file that should be skipped by extension
    await fs.writeFile(path.join(tmpDir, "readme.txt"), "Project docs", "utf-8");

    const idx = new CodeIndex();
    const stats = await idx.indexDirectory(tmpDir, { extensions: [".js"] });
    assert.equal(stats.indexed, 2);
    assert.ok(stats.totalTokens > 0);

    // Should find token from both files
    const results = idx.search("init");
    assert.ok(results.length >= 2, "init should be found in both files");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------
// tokenizeSimple
// -----------------------------------------------------------------------

test("tokenizeSimple: tokenizes query strings", () => {
  const tokens = tokenizeSimple("HelloWorld getConfig");
  assert.deepEqual(tokens, ["hello", "world", "get", "config"]);
});

test("tokenizeSimple: handles snake_case queries", () => {
  const tokens = tokenizeSimple("max_retry_count");
  assert.deepEqual(tokens, ["max", "retry", "count"]);
});
