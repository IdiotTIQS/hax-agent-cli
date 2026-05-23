/**
 * Tests for query-parser module (query-parser.js).
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { QueryParser, tokenizeQuery, splitOr } = require("../../src/search/query-parser");

// -----------------------------------------------------------------------
// QueryParser: parse
// -----------------------------------------------------------------------

test("parse: returns empty groups for empty query", () => {
  const parser = new QueryParser();
  const ast = parser.parse("");
  assert.equal(ast.groups.length, 0);
  assert.equal(ast.operator, "and");
});

test("parse: parses a single filter key:value", () => {
  const parser = new QueryParser();
  const ast = parser.parse("func:createServer");
  assert.equal(ast.groups.length, 1);
  assert.equal(ast.groups[0].filters.length, 1);
  assert.equal(ast.groups[0].filters[0].key, "func");
  assert.equal(ast.groups[0].filters[0].value, "createServer");
  assert.equal(ast.groups[0].filters[0].negate, false);
  assert.equal(ast.operator, "and");
});

test("parse: parses negated filter with - prefix", () => {
  const parser = new QueryParser();
  const ast = parser.parse("-exclude:node_modules");
  assert.equal(ast.groups.length, 1);
  assert.equal(ast.groups[0].filters[0].key, "exclude");
  assert.equal(ast.groups[0].filters[0].value, "node_modules");
  assert.equal(ast.groups[0].filters[0].negate, true);
});

test("parse: parses multiple filters as AND group", () => {
  const parser = new QueryParser();
  const ast = parser.parse("func:init file:*.js class:App");
  assert.equal(ast.groups.length, 1);
  assert.equal(ast.operator, "and");
  const keys = ast.groups[0].filters.map((f) => f.key);
  assert.deepEqual(keys, ["func", "file", "class"]);
});

test("parse: splits on OR into multiple groups", () => {
  const parser = new QueryParser();
  const ast = parser.parse("func:foo OR class:Bar");
  assert.equal(ast.groups.length, 2);
  assert.equal(ast.operator, "or");
  assert.equal(ast.groups[0].filters[0].key, "func");
  assert.equal(ast.groups[1].filters[0].key, "class");
});

test("parse: free text is captured in freeText property", () => {
  const parser = new QueryParser();
  const ast = parser.parse("hello world func:main");
  assert.equal(ast.groups.length, 1);
  assert.equal(ast.groups[0].freeText, "hello world");
  assert.equal(ast.groups[0].filters.length, 1);
  assert.equal(ast.groups[0].filters[0].key, "func");
});

test("parse: OR inside quoted strings is treated as literal text", () => {
  const parser = new QueryParser();
  const ast = parser.parse('content:"pass OR fail"');
  assert.equal(ast.groups.length, 1, "OR inside quotes should not split groups");
  assert.equal(ast.groups[0].filters[0].value, "pass OR fail");
});

test("parse: alias keys are canonicalised", () => {
  const parser = new QueryParser();
  // "fn" is an alias for "func"
  const ast = parser.parse("fn:doWork");
  assert.equal(ast.groups[0].filters[0].key, "func");
  assert.equal(ast.groups[0].filters[0].rawKey, "fn");
});

// -----------------------------------------------------------------------
// QueryParser: explain
// -----------------------------------------------------------------------

test("explain: produces human-readable output for a single filter", () => {
  const parser = new QueryParser();
  const explanation = parser.explain("func:init");
  assert.ok(explanation.includes("function name"));
  assert.ok(explanation.includes("init"));
  assert.ok(!explanation.includes("OR"));
});

test("explain: shows OR between groups", () => {
  const parser = new QueryParser();
  const explanation = parser.explain("func:foo OR class:Bar");
  assert.ok(explanation.includes("OR"));
  assert.ok(explanation.includes("function name"));
  assert.ok(explanation.includes("class name"));
});

test("explain: handles empty query gracefully", () => {
  const parser = new QueryParser();
  const explanation = parser.explain("");
  assert.ok(explanation.length > 0);
  assert.ok(explanation.toLowerCase().includes("empty") || explanation.toLowerCase().includes("nothing"));
});

// -----------------------------------------------------------------------
// QueryParser: suggest
// -----------------------------------------------------------------------

test("suggest: returns general hints for empty query", () => {
  const parser = new QueryParser();
  const result = parser.suggest("");
  assert.ok(result.suggestions.length > 0);
  assert.ok(result.hint.length > 0);
});

test("suggest: completes partial filter keys", () => {
  const parser = new QueryParser();
  const result = parser.suggest("fu");
  // "fu" should match "func"
  const hasFuncCompletion = result.suggestions.some((s) => s.includes("func:"));
  assert.ok(hasFuncCompletion, "should suggest func: completion");
});

test("suggest: respects negation prefix on partial key", () => {
  const parser = new QueryParser();
  const result = parser.suggest("-ex");
  // "-ex" should match "-exclude:"
  const hasExclude = result.suggestions.some((s) => s.startsWith("-exclude:"));
  assert.ok(hasExclude, "should suggest -exclude: with negation preserved");
});

// -----------------------------------------------------------------------
// splitOr
// -----------------------------------------------------------------------

test("splitOr: returns single element when no OR present", () => {
  const parts = splitOr("func:foo file:*.js");
  assert.equal(parts.length, 1);
  assert.equal(parts[0], "func:foo file:*.js");
});

test("splitOr: splits on OR with word boundaries", () => {
  const parts = splitOr("func:foo OR class:Bar");
  assert.equal(parts.length, 2);
  assert.equal(parts[0], "func:foo");
  assert.equal(parts[1], "class:Bar");
});

test("splitOr: does not split on 'OR' inside words like 'SORT'", () => {
  const parts = splitOr("SORT func:main");
  assert.equal(parts.length, 1, "SORT should not be split");
});

// -----------------------------------------------------------------------
// tokenizeQuery
// -----------------------------------------------------------------------

test("tokenizeQuery: extracts filter tokens and free text", () => {
  const tokens = tokenizeQuery("hello func:doIt");
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0].type, "text");
  assert.equal(tokens[0].value, "hello");
  assert.equal(tokens[1].type, "filter");
  assert.equal(tokens[1].key, "func");
  assert.equal(tokens[1].value, "doIt");
});

test("tokenizeQuery: handles quoted values in filters", () => {
  const tokens = tokenizeQuery('file:"my test file.js"');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].type, "filter");
  assert.equal(tokens[0].value, "my test file.js");
});
