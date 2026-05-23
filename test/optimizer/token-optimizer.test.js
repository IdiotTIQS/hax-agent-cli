"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { TokenOptimizer, Strategy, estimateTokens } = require("../../src/optimizer/token-optimizer");

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

test("estimateTokens: returns 0 for empty input", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("   "), 0);
  assert.equal(estimateTokens(null), 0);
});

test("estimateTokens: estimates based on char count with default ratio", () => {
  // 34 chars / 4 = 8.5 -> ceil = 9 tokens
  assert.equal(estimateTokens("hello world this is a test message"), 9);
});

test("estimateTokens: uses provided charsPerToken", () => {
  // 100 chars / 2 = 50 tokens
  assert.equal(estimateTokens("x".repeat(100), 2), 50);
});

// ---------------------------------------------------------------------------
// TokenOptimizer: optimize
// ---------------------------------------------------------------------------

test("optimize: returns original text unchanged with conservative strategy", () => {
  const opt = new TokenOptimizer({ strategy: Strategy.CONSERVATIVE });
  const result = opt.optimize({
    content: "In order to proceed, it is important to note that this is a test.",
  });

  assert.ok(result.optimized.includes("In order to"));
  assert.ok(result.savedTokens >= 0);
  assert.equal(result.steps.length, 0, "conservative should apply no steps");
});

test("optimize: trims redundancy with moderate strategy", () => {
  const opt = new TokenOptimizer({ strategy: Strategy.MODERATE });
  const result = opt.optimize({
    content: "In order to execute the command, please note that you should be careful.",
  });

  // "in order to" and "please note that" should be removed
  assert.ok(!result.optimized.toLowerCase().includes("in order to"),
    "should have removed 'in order to'");
  assert.ok(result.savedTokens > 0);
  assert.ok(result.steps.includes("trimRedundancy"));
});

test("optimize: compresses instructions when instructions option is true", () => {
  const opt = new TokenOptimizer({ strategy: Strategy.MODERATE });
  const result = opt.optimize(
    "Please make sure that you follow the steps as follows:",
    { instructions: true },
  );

  // "make sure that" -> "ensure", "as follows:" -> ":"
  const lower = result.optimized.toLowerCase();
  assert.ok(lower.includes("ensure"), "should have 'ensure' from compression");
  assert.ok(result.steps.includes("compressInstructions"));
});

test("optimize: prioritizes content when a token budget is provided", () => {
  const opt = new TokenOptimizer({ strategy: Strategy.MODERATE });
  const sections = [
    { heading: "Critical", content: "This is critical information that must be kept.", priority: 1 },
    { heading: "Optional", content: "This is optional background that is less important.", priority: 100 },
  ];

  const result = opt.optimize({ content: "x" }, {
    tokenBudget: 8,
    sections,
  });

  assert.ok(result.optimized.includes("Critical"), "should include critical section");
  assert.ok(result.steps.includes("prioritizeContent"));
});

test("optimize: uses aggressive strategy to remove more filler", () => {
  const mod = new TokenOptimizer({ strategy: Strategy.MODERATE });
  const agg = new TokenOptimizer({ strategy: Strategy.AGGRESSIVE });

  const text = "I think that basically we should probably just actually do it, to be honest.";

  const modResult = mod.optimize(text);
  const aggResult = agg.optimize(text);

  // Aggressive should save more tokens than moderate.
  assert.ok(aggResult.savedTokens > modResult.savedTokens,
    `aggressive(${aggResult.savedTokens}) should save more than moderate(${modResult.savedTokens})`);
});

// ---------------------------------------------------------------------------
// TokenOptimizer: trimRedundancy
// ---------------------------------------------------------------------------

test("trimRedundancy: replaces verbose phrases with concise alternatives", () => {
  const opt = new TokenOptimizer({ strategy: Strategy.MODERATE });
  const result = opt.trimRedundancy(
    "In order to proceed, due to the fact that the system is offline, " +
    "with regard to the deployment we must wait."
  );

  assert.ok(result.toLowerCase().includes("because"));
  assert.ok(result.toLowerCase().includes("about"));
  assert.ok(!result.toLowerCase().includes("due to the fact that"));
});

test("trimRedundancy: collapses excess whitespace", () => {
  const opt = new TokenOptimizer({ strategy: Strategy.AGGRESSIVE });
  const result = opt.trimRedundancy("hello    world\n\n\n\n\ntest");

  assert.ok(!result.includes("    "), "should not have multiple spaces");
  assert.ok(!result.includes("\n\n\n"), "should not have triple newlines");
});

test("trimRedundancy: handles empty and null input safely", () => {
  const opt = new TokenOptimizer();
  assert.equal(opt.trimRedundancy(""), "");
  assert.equal(opt.trimRedundancy(null), "");
  assert.equal(opt.trimRedundancy(undefined), "");
});

// ---------------------------------------------------------------------------
// TokenOptimizer: compressInstructions
// ---------------------------------------------------------------------------

test("compressInstructions: contracts verbose instruction patterns", () => {
  const opt = new TokenOptimizer({ strategy: Strategy.MODERATE });
  const result = opt.compressInstructions(
    "You should make sure that the following steps are taken: you need to configure the server."
  );

  const lower = result.toLowerCase();
  assert.ok(!lower.includes("you should "), "should remove 'you should'");
  assert.ok(!lower.includes("make sure that"), "should remove 'make sure that'");
  assert.ok(!lower.includes("the following steps"), "should remove 'the following steps'");
});

test("compressInstructions: applies contractions with aggressive strategy", () => {
  const mod = new TokenOptimizer({ strategy: Strategy.MODERATE });
  const agg = new TokenOptimizer({ strategy: Strategy.AGGRESSIVE });

  const text = "Do not enter. It is not safe. You will not return.";

  const aggResult = agg.compressInstructions(text);
  assert.ok(aggResult.toLowerCase().includes("don't"), "aggressive should contract 'do not'");
  assert.ok(aggResult.toLowerCase().includes("isn't"), "aggressive should contract 'is not'");
  assert.ok(aggResult.toLowerCase().includes("won't"), "aggressive should contract 'will not'");
});

// ---------------------------------------------------------------------------
// TokenOptimizer: prioritizeContent
// ---------------------------------------------------------------------------

test("prioritizeContent: selects high-priority sections within budget", () => {
  const opt = new TokenOptimizer();
  const sections = [
    { heading: "A", content: "aaa", priority: 1 },
    { heading: "B", content: "bbb", priority: 10 },
    { heading: "C", content: "ccc", priority: 5 },
  ];

  // Budget very small — only fits the highest priority section.
  const result = opt.prioritizeContent(sections, 3);
  assert.ok(result.includes("A"), "should include top-priority section");
  assert.ok(!result.includes("B"), "should exclude lowest-priority section");
});

test("prioritizeContent: returns empty string for empty sections array", () => {
  const opt = new TokenOptimizer();
  assert.equal(opt.prioritizeContent([], 100), "");
  assert.equal(opt.prioritizeContent(null, 100), "");
});

// ---------------------------------------------------------------------------
// TokenOptimizer: estimateSavings
// ---------------------------------------------------------------------------

test("estimateSavings: computes accurate savings", () => {
  const opt = new TokenOptimizer();
  const result = opt.estimateSavings(
    "This is a very long sentence with many extra words.",
    "Short sentence.",
  );

  assert.ok(result.savedTokens > 0);
  assert.ok(result.savingsPercent > 0);
  assert.equal(result.originalTokens, estimateTokens("This is a very long sentence with many extra words."));
  assert.equal(result.optimizedTokens, estimateTokens("Short sentence."));
});

test("estimateSavings: returns zero savings for identical texts", () => {
  const opt = new TokenOptimizer();
  const result = opt.estimateSavings("same text", "same text");

  assert.equal(result.savedTokens, 0);
  assert.equal(result.savingsPercent, 0);
});
