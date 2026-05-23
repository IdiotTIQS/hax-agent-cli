/**
 * Tests for ContextSelector: relevance-based context selection with budget
 * constraints, diversification, and priority ordering.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { ContextSelector, CONTEXT_SOURCES, RELEVANCE_WEIGHTS } = require("../../src/context/selector");

// ── selectContext ────────────────────────────────────────────

test("selectContext: returns selected items sorted by relevance", () => {
  const selector = new ContextSelector();
  const available = [
    { id: "1", label: "User auth module", content: "JWT authentication token handler", source: "files" },
    { id: "2", label: "Token middleware", content: "Handles JWT token validation and refresh", source: "files" },
    { id: "3", label: "Auth config", content: "Authentication configuration settings", source: "project" },
  ];
  const result = selector.selectContext("authentication jwt token", available);
  assert.equal(result.selected.length, 3);
  assert.equal(result.selected[0].id, "1"); // Most relevant to auth query
  assert.equal(result.reason, "scored_and_selected");
});

test("selectContext: respects maxResults option", () => {
  const selector = new ContextSelector();
  const available = [
    { id: "a", label: "Alpha", content: "First item" },
    { id: "b", label: "Beta", content: "Second item" },
    { id: "c", label: "Gamma", content: "Third item" },
    { id: "d", label: "Delta", content: "Fourth item" },
  ];
  const result = selector.selectContext("alpha beta gamma", available, { maxResults: 2 });
  assert.equal(result.selected.length, 2);
});

test("selectContext: returns empty when no available context", () => {
  const selector = new ContextSelector();
  const result = selector.selectContext("query", []);
  assert.equal(result.selected.length, 0);
  assert.equal(result.reason, "no_available_context");
});

test("selectContext: falls back to priority order for empty query", () => {
  const selector = new ContextSelector();
  const available = [
    { label: "Low", content: "low", priority: 1 },
    { label: "High", content: "high", priority: 100 },
  ];
  const result = selector.selectContext("", available);
  assert.equal(result.reason, "no_query_fallback");
  // Items returned by priority order (no query to score against)
  assert.ok(result.selected.length > 0);
});

// ── scoreRelevance ───────────────────────────────────────────

test("scoreRelevance: scores higher for label matches", () => {
  const selector = new ContextSelector();
  const direct = { label: "authentication middleware", content: "Handles auth" };
  const unrelated = { label: "css styles", content: "Color definitions" };

  const scoreDirect = selector.scoreRelevance(direct, "authentication jwt token");
  const scoreUnrelated = selector.scoreRelevance(unrelated, "authentication jwt token");

  assert.ok(scoreDirect > scoreUnrelated);
  assert.ok(scoreDirect > 0);
});

test("scoreRelevance: exact phrase match gives bonus", () => {
  const selector = new ContextSelector();
  const exact = { label: "File Upload Handler", content: "Handles multipart uploads" };
  const partial = { label: "File System Utils", content: "File I/O operations" };

  const scoreExact = selector.scoreRelevance(exact, "upload handler");
  const scorePartial = selector.scoreRelevance(partial, "upload handler");

  assert.ok(scoreExact > scorePartial, `expected ${scoreExact} > ${scorePartial}`);
});

test("scoreRelevance: source-based scoring favors matching queries", () => {
  const selector = new ContextSelector();
  const gitCtx = { label: "Recent Changes", content: "diff content", source: "git" };
  const fileCtx = { label: "Source Files", content: "code content", source: "files" };

  const scoreGit = selector.scoreRelevance(gitCtx, "show me the git diff and commits");
  const scoreFile = selector.scoreRelevance(fileCtx, "show me the git diff and commits");

  assert.ok(scoreGit > scoreFile, `Git score ${scoreGit} should exceed file score ${scoreFile}`);
});

test("scoreRelevance: returns 0 for null/undefined context", () => {
  const selector = new ContextSelector();
  assert.equal(selector.scoreRelevance(null, "query"), 0);
  assert.equal(selector.scoreRelevance(undefined, "query"), 0);
  assert.equal(selector.scoreRelevance({ label: "", content: "" }, "query"), 0);
});

// ── filterByBudget ───────────────────────────────────────────

test("filterByBudget: includes items that fit within budget", () => {
  const selector = new ContextSelector();
  const contexts = [
    { content: "short", score: 10 },
    { content: "also short", score: 8 },
    { content: "A".repeat(2000), score: 5 },
  ];
  const result = selector.filterByBudget(contexts, 50); // ~50 tokens budget
  // "short" is 5 chars = ~2 tokens, "also short" is 10 chars = ~3 tokens
  assert.ok(result.length >= 1);
});

test("filterByBudget: returns empty for empty contexts", () => {
  const selector = new ContextSelector();
  assert.equal(selector.filterByBudget([], 100).length, 0);
});

test("filterByBudget: returns all items for infinite budget", () => {
  const selector = new ContextSelector();
  const contexts = [
    { content: "a", score: 10 },
    { content: "b", score: 5 },
  ];
  const result = selector.filterByBudget(contexts, Infinity);
  assert.equal(result.length, 2);
});

// ── diversifyContexts ────────────────────────────────────────

test("diversifyContexts: spreads items across sources", () => {
  const selector = new ContextSelector({ maxPerSource: 2 });
  const contexts = [
    { label: "f1", content: "file one", source: "files", score: 50 },
    { label: "f2", content: "file two", source: "files", score: 40 },
    { label: "f3", content: "file three", source: "files", score: 30 },
    { label: "g1", content: "git one", source: "git", score: 45 },
    { label: "g2", content: "git two", source: "git", score: 35 },
  ];
  const result = selector.diversifyContexts(contexts);

  // After diversification, the first few items should alternate sources
  const firstThreeSources = result.slice(0, 3).map(c => c.source);
  const uniqueSources = new Set(firstThreeSources);
  assert.ok(uniqueSources.size > 1, "Sources should be interleaved, got: " + firstThreeSources.join(", "));
});

test("diversifyContexts: returns empty for empty input", () => {
  const selector = new ContextSelector();
  assert.equal(selector.diversifyContexts([]).length, 0);
  assert.equal(selector.diversifyContexts(null).length, 0);
});

// ── prioritizeContexts ───────────────────────────────────────

test("prioritizeContexts: blends explicit priority with relevance", () => {
  const selector = new ContextSelector();
  const contexts = [
    { label: "Backup", content: "Nightly backup routine for database dumps", priority: 10 },
    { label: "Auth Service", content: "JWT authentication token service with refresh handling", priority: 5 },
  ];
  const result = selector.prioritizeContexts(contexts, "jwt authentication token validator");

  // "Auth Service" should come first: explicit priority is similar but relevance is much higher
  const authFirst = result[0].label === "Auth Service";
  assert.ok(authFirst, `Expected Auth Service first, got ${result[0].label} (combined: ${result[0]._combined})`);
});

test("prioritizeContexts: returns empty for non-array input", () => {
  const selector = new ContextSelector();
  assert.equal(selector.prioritizeContexts(null, "query").length, 0);
  assert.equal(selector.prioritizeContexts(undefined, "query").length, 0);
});

// ── CONTEXT_SOURCES ──────────────────────────────────────────

test("CONTEXT_SOURCES: contains expected source types", () => {
  assert.ok(CONTEXT_SOURCES.includes("files"));
  assert.ok(CONTEXT_SOURCES.includes("git"));
  assert.ok(CONTEXT_SOURCES.includes("deps"));
  assert.ok(CONTEXT_SOURCES.includes("history"));
  assert.ok(CONTEXT_SOURCES.includes("project"));
  assert.ok(CONTEXT_SOURCES.includes("errors"));
  assert.ok(CONTEXT_SOURCES.includes("decisions"));
  assert.equal(CONTEXT_SOURCES.length, 7);
});

// ── RELEVANCE_WEIGHTS ────────────────────────────────────────

test("RELEVANCE_WEIGHTS: all weights are positive", () => {
  for (const [key, value] of Object.entries(RELEVANCE_WEIGHTS)) {
    assert.ok(value > 0, `Weight ${key} should be positive, got ${value}`);
  }
});
