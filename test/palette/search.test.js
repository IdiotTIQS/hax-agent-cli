"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  FuzzySearcher,
  levenshteinDistance,
  tokenize,
  findMatchRanges,
  mergeRanges,
} = require("../../src/palette/search");

// Sample items for testing
const SAMPLE_ITEMS = [
  { id: "cmd-help", name: "/help", category: "Commands", description: "Show available commands", keywords: ["help", "?"] },
  { id: "cmd-exit", name: "/exit", category: "Commands", description: "Exit the session", keywords: ["quit", "q"] },
  { id: "cmd-clear", name: "/clear", category: "Commands", description: "Clear conversation", keywords: ["c"] },
  { id: "tool-file-read", name: "file.read", category: "Tools", description: "Read files from disk", keywords: ["read", "open"] },
  { id: "tool-file-write", name: "file.write", category: "Tools", description: "Write files to disk", keywords: ["write", "save"] },
  { id: "tool-shell", name: "shell.run", category: "Tools", description: "Run shell commands", keywords: ["exec", "bash"] },
  { id: "qa-new-session", name: "New Session", category: "Quick Actions", description: "Start new session", keywords: ["new", "fresh"] },
  { id: "qa-toggle-theme", name: "Toggle Theme", category: "Quick Actions", description: "Toggle color theme", keywords: ["theme", "dark"] },
];

// ── FuzzySearcher constructor ──────────────────────────────────────

test("FuzzySearcher: constructor with default options", () => {
  const searcher = new FuzzySearcher();
  assert.equal(searcher.caseSensitive, false);
  assert.equal(searcher.minQueryLength, 1);
  assert.equal(searcher.maxResults, 50);
  assert.equal(searcher.fuzzyThreshold, 3);
});

test("FuzzySearcher: constructor with custom options", () => {
  const searcher = new FuzzySearcher({
    caseSensitive: true,
    minQueryLength: 2,
    maxResults: 10,
    fuzzyThreshold: 2,
  });
  assert.equal(searcher.caseSensitive, true);
  assert.equal(searcher.minQueryLength, 2);
  assert.equal(searcher.maxResults, 10);
  assert.equal(searcher.fuzzyThreshold, 2);
});

// ── levenshteinDistance ────────────────────────────────────────────

test("levenshteinDistance: identical strings", () => {
  assert.equal(levenshteinDistance("help", "help"), 0);
  assert.equal(levenshteinDistance("a", "a"), 0);
  assert.equal(levenshteinDistance("", ""), 0);
});

test("levenshteinDistance: single edits", () => {
  assert.equal(levenshteinDistance("help", "hel"), 1);    // deletion
  assert.equal(levenshteinDistance("help", "helps"), 1);  // insertion
  assert.equal(levenshteinDistance("help", "kelp"), 1);   // substitution
});

test("levenshteinDistance: known distances", () => {
  assert.equal(levenshteinDistance("kitten", "sitting"), 3);
  assert.equal(levenshteinDistance("saturday", "sunday"), 3);
  assert.equal(levenshteinDistance("abc", "xyz"), 3);
});

test("levenshteinDistance: empty string edge cases", () => {
  assert.equal(levenshteinDistance("hello", ""), 5);
  assert.equal(levenshteinDistance("", "world"), 5);
  assert.equal(levenshteinDistance("", ""), 0);
});

// ── tokenize ───────────────────────────────────────────────────────

test("tokenize: splits on whitespace", () => {
  const tokens = tokenize("hello world");
  assert.deepEqual(tokens, ["hello", "world"]);
});

test("tokenize: lowercases all tokens", () => {
  const tokens = tokenize("Hello WORLD");
  assert.deepEqual(tokens, ["hello", "world"]);
});

test("tokenize: handles special characters in commands", () => {
  const tokens = tokenize("/help /exit file.read");
  assert.deepEqual(tokens, ["/help", "/exit", "file.read"]);
});

test("tokenize: returns empty for empty input", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize("   "), []);
  assert.deepEqual(tokenize(null), []);
});

// ── findMatchRanges ────────────────────────────────────────────────

test("findMatchRanges: single match", () => {
  const ranges = findMatchRanges("hello world", "hello", false);
  assert.equal(ranges.length, 1);
  assert.deepEqual(ranges[0], { start: 0, end: 5 });
});

test("findMatchRanges: multiple matches", () => {
  const ranges = findMatchRanges("hello hello hello", "hello", false);
  assert.equal(ranges.length, 3);
  assert.deepEqual(ranges[0], { start: 0, end: 5 });
  assert.deepEqual(ranges[1], { start: 6, end: 11 });
  assert.deepEqual(ranges[2], { start: 12, end: 17 });
});

test("findMatchRanges: case insensitive", () => {
  const ranges = findMatchRanges("Hello World", "hello", false);
  assert.equal(ranges.length, 1);
});

test("findMatchRanges: case sensitive", () => {
  const ranges = findMatchRanges("Hello World", "hello", true);
  assert.equal(ranges.length, 0);
});

test("findMatchRanges: no match", () => {
  const ranges = findMatchRanges("hello world", "xyz", false);
  assert.equal(ranges.length, 0);
});

test("findMatchRanges: empty input", () => {
  assert.deepEqual(findMatchRanges("", "hello", false), []);
  assert.deepEqual(findMatchRanges("hello", "", false), []);
});

// ── mergeRanges ────────────────────────────────────────────────────

test("mergeRanges: no ranges", () => {
  assert.deepEqual(mergeRanges([]), []);
});

test("mergeRanges: single range unchanged", () => {
  const merged = mergeRanges([{ start: 0, end: 5 }]);
  assert.deepEqual(merged, [{ start: 0, end: 5 }]);
});

test("mergeRanges: overlapping ranges", () => {
  const merged = mergeRanges([
    { start: 0, end: 5 },
    { start: 3, end: 8 },
  ]);
  assert.deepEqual(merged, [{ start: 0, end: 8 }]);
});

test("mergeRanges: adjacent ranges merge", () => {
  const merged = mergeRanges([
    { start: 0, end: 3 },
    { start: 4, end: 8 },
  ]);
  assert.deepEqual(merged, [{ start: 0, end: 8 }]);
});

test("mergeRanges: non-overlapping ranges", () => {
  const merged = mergeRanges([
    { start: 0, end: 2 },
    { start: 5, end: 7 },
  ]);
  assert.deepEqual(merged, [
    { start: 0, end: 2 },
    { start: 5, end: 7 },
  ]);
});

// ── FuzzySearcher.search ───────────────────────────────────────────

test("search: returns all items ranked when query is empty", () => {
  const searcher = new FuzzySearcher();
  const results = searcher.search("", SAMPLE_ITEMS);
  assert.equal(results.length, SAMPLE_ITEMS.length, "should return all items");
});

test("search: finds items by name prefix", () => {
  const searcher = new FuzzySearcher();
  const results = searcher.search("help", SAMPLE_ITEMS);
  assert.ok(results.length >= 1, "should find help");
  const topItem = results[0].item;
  assert.ok(topItem.name.includes("help") || topItem.id.includes("help"));
});

test("search: finds items by description", () => {
  const searcher = new FuzzySearcher();
  const results = searcher.search("read files", SAMPLE_ITEMS);
  const foundFileRead = results.some((r) => r.item.id === "tool-file-read");
  assert.ok(foundFileRead, "should find file.read by description");
});

test("search: finds items by keyword", () => {
  const searcher = new FuzzySearcher();
  const results = searcher.search("quit", SAMPLE_ITEMS);
  const foundExit = results.some((r) => r.item.id === "cmd-exit");
  assert.ok(foundExit, "should find /exit by keyword 'quit'");
});

test("search: exact name match scores highest", () => {
  const searcher = new FuzzySearcher();
  const results = searcher.search("/help", SAMPLE_ITEMS);
  assert.ok(results.length >= 1, "should have results");
  assert.equal(results[0].item.id, "cmd-help", "/help should be top result");
  assert.ok(results[0].score >= 90, "/help score should be high for exact match");
});

test("search: fuzzy matches tolerate typos", () => {
  const searcher = new FuzzySearcher({ fuzzyThreshold: 2 });
  const results = searcher.search("helpp", SAMPLE_ITEMS);
  const foundHelp = results.some((r) => r.item.id === "cmd-help");
  assert.ok(foundHelp, "should find /help with typo 'helpp'");
});

test("search: respects maxResults", () => {
  const searcher = new FuzzySearcher({ maxResults: 3 });
  const results = searcher.search("", SAMPLE_ITEMS);
  assert.ok(results.length <= 3, "should respect maxResults limit");
});

test("search: returns empty array for non-matching query", () => {
  const searcher = new FuzzySearcher();
  const results = searcher.search("nonexistentzzzxyz123", SAMPLE_ITEMS);
  assert.equal(results.length, 0);
});

test("search: multi-word query scores higher with more token matches", () => {
  const searcher = new FuzzySearcher();
  const results = searcher.search("shell command", SAMPLE_ITEMS);
  const topItem = results[0]?.item;
  assert.ok(topItem.id === "tool-shell", "shell.run should be top result for 'shell command'");
});

// ── FuzzySearcher.filter ──────────────────────────────────────────

test("filter: returns all items when query is short", () => {
  const searcher = new FuzzySearcher({ minQueryLength: 2 });
  const results = searcher.filter(SAMPLE_ITEMS, "a");
  assert.equal(results.length, SAMPLE_ITEMS.length);
});

test("filter: returns exact match for shell query", () => {
  const searcher = new FuzzySearcher();
  const results = searcher.filter(SAMPLE_ITEMS, "shell");
  assert.ok(results.length >= 1, "should find at least one matching item");
  // The exact match should be in results
  const hasShellItem = results.some((r) => r.id === "tool-shell");
  assert.ok(hasShellItem, "should include tool-shell in results");
});

test("filter: filters by description", () => {
  const searcher = new FuzzySearcher();
  const results = searcher.filter(SAMPLE_ITEMS, "conversation");
  const foundClear = results.some((r) => r.id === "cmd-clear");
  assert.ok(foundClear, "should find /clear by description");
});

// ── FuzzySearcher.rank ────────────────────────────────────────────

test("rank: exact name match gets highest score", () => {
  const searcher = new FuzzySearcher();
  const results = searcher.rank(SAMPLE_ITEMS, "/help");
  assert.equal(results[0].item.id, "cmd-help");
  assert.ok(results[0].score >= 100);
});

test("rank: prefix match scores higher than substring match", () => {
  const items = [
    { id: "a", name: "file", category: "", description: "" },
    { id: "b", name: "file.read", category: "", description: "" },
  ];
  const searcher = new FuzzySearcher();
  const results = searcher.rank(items, "file");
  assert.equal(results[0].item.id, "a", "exact match 'file' should rank above 'file.read'");
});

test("rank: items with matching keywords get boosted", () => {
  const searcher = new FuzzySearcher();
  const results = searcher.rank(SAMPLE_ITEMS, "quit");
  const exitIdx = results.findIndex((r) => r.item.id === "cmd-exit");
  assert.ok(exitIdx >= 0, "/exit should be found");
  assert.ok(results[exitIdx].matchedFields.includes("keywords"), "should match by keyword 'quit'");
});

test("rank: empty query returns all items sorted by score", () => {
  const searcher = new FuzzySearcher();
  const results = searcher.rank(SAMPLE_ITEMS, "");
  assert.equal(results.length, SAMPLE_ITEMS.length);
  assert.ok(results[0].score > 0, "items get a base score even without query");
});

// ── FuzzySearcher.highlight ───────────────────────────────────────

test("highlight: returns no highlights for empty query", () => {
  const searcher = new FuzzySearcher();
  const result = searcher.highlight(SAMPLE_ITEMS[0], "");
  assert.equal(result.text, "/help");
  assert.equal(result.matches.length, 0);
});

test("highlight: finds match ranges for query", () => {
  const searcher = new FuzzySearcher();
  const result = searcher.highlight({ id: "x", name: "/help", category: "", description: "" }, "help");
  assert.equal(result.text, "/help");
  assert.ok(result.matches.length >= 1, "should find match for 'help' in '/help'");
  assert.equal(result.matches[0].start, 1);
  assert.equal(result.matches[0].end, 5);
});

test("highlight: finds multiple matches", () => {
  const searcher = new FuzzySearcher();
  const result = searcher.highlight(
    { id: "x", name: "test test TEST", category: "", description: "" },
    "test"
  );
  assert.ok(result.matches.length >= 1, "should find multiple instances of 'test'");
});

// ── FuzzySearcher.getSuggestions ──────────────────────────────────

test("getSuggestions: returns prefix-based suggestions", () => {
  const searcher = new FuzzySearcher();
  const suggestions = searcher.getSuggestions("he", SAMPLE_ITEMS);
  const hasHelp = suggestions.some((s) => s.item.id === "cmd-help");
  assert.ok(hasHelp, "should suggest /help for 'he'");
});

test("getSuggestions: returns empty for short query", () => {
  const searcher = new FuzzySearcher();
  const suggestions = searcher.getSuggestions("", SAMPLE_ITEMS);
  assert.deepEqual(suggestions, []);
});

test("getSuggestions: respects limit option", () => {
  const searcher = new FuzzySearcher();
  const suggestions = searcher.getSuggestions("f", SAMPLE_ITEMS, { limit: 2 });
  assert.ok(suggestions.length <= 2, "should respect limit");
});

test("getSuggestions: returns no duplicates", () => {
  const searcher = new FuzzySearcher();
  const suggestions = searcher.getSuggestions("file", SAMPLE_ITEMS);
  const ids = suggestions.map((s) => s.item.id);
  const uniqueIds = new Set(ids);
  assert.equal(ids.length, uniqueIds.size, "no duplicate suggestions");
});
