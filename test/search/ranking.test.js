/**
 * Tests for ranking module (ranking.js).
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Ranker } = require("../../src/search/ranking");

// -----------------------------------------------------------------------
// Ranker: score
// -----------------------------------------------------------------------

test("Ranker.score: gives higher score for exact match", () => {
  const ranker = new Ranker();
  const matchExact = {
    match: "createServer",
    line: 1,
    column: 10,
    context: "function createServer(port) {",
  };
  const matchPartial = {
    match: "Server",
    line: 1,
    column: 10,
    context: "function createServer(port) {",
  };
  const scoreExact = ranker.score(matchExact, "createServer");
  const scorePartial = ranker.score(matchPartial, "createServer");
  assert.ok(scoreExact > scorePartial, "exact name match should score higher");
});

test("Ranker.score: gives higher score for earlier lines", () => {
  const ranker = new Ranker();
  const early = { match: "init", line: 1, column: 1, context: "function init() {" };
  const late = { match: "init", line: 500, column: 1, context: "// init placeholder" };
  const scoreEarly = ranker.score(early, "init");
  const scoreLate = ranker.score(late, "init");
  assert.ok(scoreEarly > scoreLate, "earlier line should score higher");
});

test("Ranker.score: gives higher score for richer context", () => {
  const ranker = new Ranker();
  const richCtx = {
    match: "handler",
    line: 10,
    column: 5,
    context: "async function handler(req, res) {\n  try {\n    return await process(req);\n  } catch (err) {\n    return null;\n  }\n}",
  };
  const poorCtx = {
    match: "handler",
    line: 10,
    column: 5,
    context: "x = handler;",
  };
  const scoreRich = ranker.score(richCtx, "handler");
  const scorePoor = ranker.score(poorCtx, "handler");
  assert.ok(scoreRich > scorePoor, "richer context should score higher");
});

test("Ranker.score: factors in frequency count", () => {
  const ranker = new Ranker();
  const frequent = { match: "log", line: 20, column: 1, context: "log('a');", count: 100 };
  const rare = { match: "log", line: 20, column: 1, context: "log('a');", count: 1 };
  const scoreFrequent = ranker.score(frequent, "log");
  const scoreRare = ranker.score(rare, "log");
  assert.ok(scoreFrequent > scoreRare, "higher frequency should score higher");
});

// -----------------------------------------------------------------------
// Ranker: rank
// -----------------------------------------------------------------------

test("Ranker.rank: sorts by descending _score", () => {
  const ranker = new Ranker();
  const results = [
    { _score: 1, name: "low" },
    { _score: 10, name: "high" },
    { _score: 5, name: "mid" },
    { _score: 0, name: "zero" },
  ];
  const sorted = ranker.rank(results);
  assert.equal(sorted[0].name, "high");
  assert.equal(sorted[1].name, "mid");
  assert.equal(sorted[2].name, "low");
  assert.equal(sorted[3].name, "zero");
});

test("Ranker.rank: does not mutate original array", () => {
  const ranker = new Ranker();
  const results = [
    { _score: 3, name: "b" },
    { _score: 5, name: "a" },
  ];
  const original = results.slice();
  ranker.rank(results);
  assert.deepEqual(results, original, "original array should not be mutated");
});

// -----------------------------------------------------------------------
// Ranker: boost
// -----------------------------------------------------------------------

test("Ranker.boost: multiplies scores for matching field", () => {
  const ranker = new Ranker();
  const results = [
    { _score: 2, file: "src/main.js" },
    { _score: 3, file: "test/main.test.js" },
  ];
  ranker.boost(results, "file", 2, /\.test\.js$/);
  assert.equal(results[0]._score, 2, "non-test file unchanged");
  assert.equal(results[1]._score, 6, "test file score doubled");
});

test("Ranker.boost: boosts by string value match", () => {
  const ranker = new Ranker();
  const results = [
    { _score: 5, type: "function" },
    { _score: 4, type: "variable" },
  ];
  ranker.boost(results, "type", 3, "function");
  assert.equal(results[0]._score, 15, "function result tripled");
  assert.equal(results[1]._score, 4, "variable result unchanged");
});

// -----------------------------------------------------------------------
// Ranker: diversify
// -----------------------------------------------------------------------

test("Ranker.diversify: interleaves results from different files", () => {
  const ranker = new Ranker();
  const results = [
    { _score: 10, file: "a.js", name: "a1" },
    { _score: 9, file: "a.js", name: "a2" },
    { _score: 8, file: "b.js", name: "b1" },
    { _score: 7, file: "b.js", name: "b2" },
    { _score: 6, file: "a.js", name: "a3" },
  ];
  const div = ranker.diversify(results);
  // Should alternate: a.js, b.js, a.js, b.js, a.js
  assert.equal(div[0].file, "a.js");
  assert.equal(div[1].file, "b.js");
  assert.equal(div[2].file, "a.js");
  assert.equal(div[3].file, "b.js");
  assert.equal(div[4].file, "a.js");
});

test("Ranker.diversify: handles single-result case", () => {
  const ranker = new Ranker();
  const results = [{ _score: 1, file: "only.js" }];
  const div = ranker.diversify(results);
  assert.deepEqual(div, results);
});

// -----------------------------------------------------------------------
// Ranker: custom weights
// -----------------------------------------------------------------------

test("Ranker: custom weights affect scoring", () => {
  const lowWeight = new Ranker({ exactMatchWeight: 1 });
  const highWeight = new Ranker({ exactMatchWeight: 100 });
  const match = { match: "target", line: 5, column: 1, context: "target" };
  const scoreLow = lowWeight.score(match, "target");
  const scoreHigh = highWeight.score(match, "target");
  assert.ok(scoreHigh > scoreLow, "higher weight should produce higher score");
});

test("Ranker: handles missing optional fields gracefully", () => {
  const ranker = new Ranker();
  // No context, no count
  const match = { match: "bare", line: 50, column: 1 };
  const score = ranker.score(match, "bare");
  assert.ok(typeof score === "number" && !Number.isNaN(score), "score should be a valid number");
});
