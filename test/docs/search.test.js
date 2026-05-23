/**
 * Tests for doc search engine: buildSearchIndex, search, fuzzyMatch, getSuggestions.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSearchIndex,
  search,
  fuzzyMatch,
  getSuggestions,
  tokenize,
  levenshteinDistance,
} = require("../../src/docs/search");

const SAMPLE_DOCS = [
  { id: "doc-1", title: "File Read Tool", description: "Read files from disk", usage: "file.read(path)", examples: [] },
  { id: "doc-2", title: "File Write Tool", description: "Write files to disk", usage: "file.write(path, content)", examples: [] },
  { id: "doc-3", title: "Plugin System", description: "Hook-based plugin architecture", usage: "registry.register(plugin)", examples: ["Example: registry.register()"] },
  { id: "doc-4", title: "Configuration", description: "Settings and configuration files", usage: "loadSettings()", examples: ["Example: loadSettings()"] },
  { id: "doc-5", title: "Search Command", description: "Search documentation topics", usage: "/search query", examples: ["Example: /search api"] },
  { id: "doc-6", title: "Memory Manager", description: "Persistent key-value memory storage across sessions", usage: "setMemory(key, value)", examples: [] },
  { id: "doc-7", title: "Context Window", description: "Manage token context window", usage: "/context status", examples: [] },
  { id: "doc-8", title: "Shell Execution", description: "Run shell commands safely", usage: "shell.run(command)", examples: ["Example: shell.run('npm test')"] },
];

let index;
test("buildSearchIndex: creates index from docs", { concurrency: false }, () => {
  index = buildSearchIndex(SAMPLE_DOCS);
  assert.ok(index, "index should be created");
  assert.ok(Array.isArray(index.entries), "entries should be an array");
  assert.equal(index.entries.length, 8, "should have 8 entries");
  assert.ok(index.tokens instanceof Map, "tokens should be a Map");
  assert.ok(index.tokens.size > 0, "tokens should have entries");
});

test("buildSearchIndex: entries preserve all fields", () => {
  const entry = index.entries[0];
  assert.equal(typeof entry.id, "string");
  assert.equal(typeof entry.title, "string");
  assert.equal(typeof entry.description, "string");
  assert.ok(Array.isArray(entry.examples));
  assert.ok(Array.isArray(entry.seeAlso));
});

test("buildSearchIndex: common words are indexed", () => {
  // "file" should be indexed from doc-1 and doc-2
  const postings = index.tokens.get("file");
  assert.ok(postings, '"file" should be indexed');
  assert.ok(postings.length >= 2, '"file" should appear in at least 2 docs');
});

test("search: returns ranked results for exact query", () => {
  const results = search("file", index, { limit: 10 });
  assert.ok(results.length > 0, "should find results for 'file'");
  // doc-1 and doc-2 should be top results (title matches have highest weight)
  assert.equal(results[0].entry.title, "File Read Tool");
  assert.ok(results[0].score > 0, "results should have positive scores");
});

test("search: returns results for multi-word query", () => {
  const results = search("plugin system", index, { limit: 10 });
  assert.ok(results.length > 0, "should find results for 'plugin system'");
  assert.equal(results[0].entry.title, "Plugin System");
});

test("search: respects limit option", () => {
  const results = search("file", index, { limit: 2 });
  assert.ok(results.length <= 2, "should respect limit");
});

test("search: returns empty for empty query", () => {
  const results = search("", index);
  assert.deepEqual(results, []);
});

test("search: returns empty for query with no matches", () => {
  const results = search("nonexistenttermzzz", index);
  assert.deepEqual(results, []);
});

test("search: prefix matching finds partial words", () => {
  const results = search("she", index, { limit: 10 });
  const titles = results.map((r) => r.entry.title);
  assert.ok(titles.some((t) => t.includes("Shell")), "should find shell via prefix match");
});

test("search: matchedTerms tracks which query words matched", () => {
  const results = search("file read", index, { limit: 10 });
  assert.ok(results.length > 0, "should find results");
  // At least one result should have matchedTerms
  const hasMatchedTerms = results.some((r) => r.matchedTerms.length > 0);
  assert.ok(hasMatchedTerms, "at least one result should have matchedTerms");
});

test("fuzzyMatch: finds close matches for slight typos", () => {
  const candidates = ["file", "files", "filter", "profile", "while", "smile", "mile"];
  const results = fuzzyMatch("file", candidates, { threshold: 2, limit: 5 });
  assert.ok(results.length > 0, "should find matches");
  assert.equal(results[0].candidate, "file", "exact match should be first");
});

test("fuzzyMatch: returns reasonable matches with threshold", () => {
  const candidates = ["config", "context", "content", "connect", "console"];
  const results = fuzzyMatch("confi", candidates, { threshold: 2, limit: 5 });
  assert.ok(results.length > 0, "should find matches");
  // "config" should be closest
  assert.equal(results[0].candidate, "config");
});

test("fuzzyMatch: returns empty for empty query", () => {
  const results = fuzzyMatch("", ["a", "b", "c"]);
  assert.deepEqual(results, []);
});

test("fuzzyMatch: returns empty for empty candidates", () => {
  const results = fuzzyMatch("query", []);
  assert.deepEqual(results, []);
});

test("fuzzyMatch: includes substring matches even with distance > threshold", () => {
  const candidates = ["abcdefghij", "klmnop"];
  const results = fuzzyMatch("abc", candidates, { threshold: 2, limit: 5 });
  // "abc" is substring of "abcdefghij" so should match even if distance is large
  const hasAbc = results.some((r) => r.candidate === "abcdefghij");
  assert.ok(hasAbc || results.length > 0, "substring matches should be found");
});

test("getSuggestions: returns title prefix matches first", () => {
  const suggestions = getSuggestions("file", index, { limit: 5 });
  assert.ok(suggestions.length > 0, "should have suggestions");
  // First suggestions should have reason "title" (starts with query)
  assert.ok(suggestions[0].reason === "title" || suggestions[0].reason === "title-contains");
});

test("getSuggestions: returns empty for empty query", () => {
  const suggestions = getSuggestions("", index);
  assert.deepEqual(suggestions, []);
});

test("getSuggestions: respects limit option", () => {
  const suggestions = getSuggestions("f", index, { limit: 2 });
  assert.ok(suggestions.length <= 2, "should respect limit");
});

test("getSuggestions: returns results for description matches", () => {
  const suggestions = getSuggestions("storage", index, { limit: 5 });
  assert.ok(suggestions.length > 0, '"storage" should match Memory Manager description');
});

test("tokenize: lowercases and splits text", () => {
  const tokens = tokenize("File.Read (path)");
  assert.deepEqual(tokens, ["file", "read", "path"]);
});

test("tokenize: handles empty and non-string input", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(undefined), []);
});

test("tokenize: handles punctuation and special chars", () => {
  const tokens = tokenize("api-key_123");
  assert.deepEqual(tokens, ["api-key_123"]);
});

test("levenshteinDistance: identical strings have distance 0", () => {
  assert.equal(levenshteinDistance("hello", "hello"), 0);
  assert.equal(levenshteinDistance("", ""), 0);
});

test("levenshteinDistance: calculates correct distance", () => {
  assert.equal(levenshteinDistance("kitten", "sitting"), 3);
  assert.equal(levenshteinDistance("flaw", "lawn"), 2);
  assert.equal(levenshteinDistance("abc", ""), 3);
  assert.equal(levenshteinDistance("", "abc"), 3);
});

test("levenshteinDistance: single char difference", () => {
  assert.equal(levenshteinDistance("a", "b"), 1);
  assert.equal(levenshteinDistance("ab", "ac"), 1);
  assert.equal(levenshteinDistance("file", "fils"), 1);
});

test("getSuggestions: deduplicates results by id", () => {
  const suggestions = getSuggestions("file", index, { limit: 10 });
  const ids = suggestions.map((s) => s.id);
  const uniqueIds = new Set(ids);
  assert.equal(ids.length, uniqueIds.size, "suggestions should not have duplicate IDs");
});

test("search: results are sorted by relevance score descending", () => {
  const results = search("file write", index, { limit: 10 });
  for (let i = 1; i < results.length; i++) {
    assert.ok(
      results[i - 1].score >= results[i].score,
      `Result ${i - 1} (${results[i - 1].entry.title}, score ${results[i - 1].score}) ` +
        `should not score lower than result ${i} (${results[i].entry.title}, score ${results[i].score})`,
    );
  }
});
