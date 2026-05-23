"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ResponseComparator, DEFAULT_CRITERIA, DEFAULT_WEIGHTS } = require("../../src/providers/comparator");

function makeResponse(provider, overrides = {}) {
  return {
    provider,
    response: {
      id: `resp-${Date.now()}`,
      content: overrides.content ?? "Default response content with multiple words to test quality evaluation.",
      model: overrides.model || "test-model",
      usage: overrides.usage ?? { inputTokens: 100, outputTokens: 200 },
    },
    latencyMs: overrides.latencyMs ?? 500,
    success: overrides.success !== false,
    cost: overrides.cost ?? undefined,
    toolCalls: overrides.toolCalls ?? [],
    ...overrides,
  };
}

test("ResponseComparator compare produces comprehensive comparison between two responses", () => {
  const comparator = new ResponseComparator();

  const a = makeResponse("anthropic", {
    content: "A detailed and thorough response containing specific recommendations and actionable advice for improving system performance.",
    latencyMs: 800,
    cost: 0.005,
  });
  const b = makeResponse("openai", {
    content: "Short answer.",
    latencyMs: 200,
    cost: 0.002,
  });

  const result = comparator.compare(a, b);

  assert.ok(result.dimensions.quality, "Should have quality dimension");
  assert.ok(result.dimensions.latency, "Should have latency dimension");
  assert.ok(result.dimensions.cost, "Should have cost dimension");
  assert.ok(result.dimensions.toolUse, "Should have toolUse dimension");
  assert.ok(typeof result.overallScore === "number");
  assert.ok(typeof result.confidence === "string");
  assert.equal(typeof result.winner === "string" || result.winner === null, true);
});

test("ResponseComparator compare throws with missing responses", () => {
  const comparator = new ResponseComparator();

  assert.throws(
    () => comparator.compare(null, makeResponse("a")),
    /Both responses are required/,
  );

  assert.throws(
    () => comparator.compare(makeResponse("a"), null),
    /Both responses are required/,
  );
});

test("ResponseComparator compareQuality evaluates content quality metrics", () => {
  const comparator = new ResponseComparator();

  const a = makeResponse("anthropic", {
    content: "The best approach is to implement a caching layer. This layer should use Redis for distributed caching. Additionally, implement retry logic with exponential backoff for handling transient failures. Consider using a circuit breaker pattern for external service calls.",
  });
  const b = makeResponse("openai", {
    content: "Use a cache.",
  });

  const result = comparator.compareQuality(a, b);

  assert.ok(result.a > 0, "Quality score for a should be positive");
  assert.ok(result.b > 0, "Quality score for b should be positive");
  assert.ok(result.a > result.b, "Longer, more structured response should score higher");
  assert.ok(result.details.a.length > result.details.b.length);
  assert.ok(result.details.a.wordCount > result.details.b.wordCount);
});

test("ResponseComparator compareLatency compares response times", () => {
  const comparator = new ResponseComparator();

  const fast = makeResponse("fast", { latencyMs: 100 });
  const slow = makeResponse("slow", { latencyMs: 5000 });

  const result = comparator.compareLatency(fast, slow);

  assert.equal(result.a, 100);
  assert.equal(result.b, 5000);
  assert.equal(result.differenceMs, -4900);
  assert.equal(result.winner, "a");
  assert.ok(result.fasterByPercent > 0);
});

test("ResponseComparator compareCost compares cost efficiency", () => {
  const comparator = new ResponseComparator();

  const cheap = makeResponse("cheap", { cost: 0.001 });
  const expensive = makeResponse("expensive", { cost: 0.05 });

  const result = comparator.compareCost(cheap, expensive);

  assert.ok(result.a < result.b);
  assert.equal(result.winner, "a");
  assert.ok(result.cheaperByPercent > 0);
});

test("ResponseComparator compareToolUse evaluates tool usage effectiveness", () => {
  const comparator = new ResponseComparator();

  const effective = makeResponse("effective", {
    toolCalls: [
      { name: "file.read", isError: false },
      { name: "file.write", isError: false },
      { name: "file.glob", isError: false },
      { name: "shell.run", isError: false },
    ],
  });
  const errorProne = makeResponse("error-prone", {
    toolCalls: [
      { name: "file.read", isError: true },
      { name: "file.read", isError: true },
      { name: "file.write", isError: false },
    ],
  });

  const result = comparator.compareToolUse(effective, errorProne);

  assert.equal(result.winner, "a");
  assert.equal(result.a.count, 4);
  assert.equal(result.b.count, 3);
  assert.ok(result.a.score > result.b.score);
  assert.ok(result.a.errorRate < result.b.errorRate);
});

test("ResponseComparator rankResponses produces multi-criteria ranked list", () => {
  const comparator = new ResponseComparator();

  const responses = [
    makeResponse("slow-quality", {
      content: "A very thorough and detailed analysis of the system architecture including multiple components and strategies.",
      latencyMs: 8000,
      cost: 0.01,
    }),
    makeResponse("fast-ok", {
      content: "Reasonable answer.",
      latencyMs: 150,
      cost: 0.002,
    }),
    makeResponse("balanced", {
      content: "A comprehensive analysis with good structure and actionable recommendations.",
      latencyMs: 600,
      cost: 0.005,
    }),
  ];

  const ranked = comparator.rankResponses(responses, ["quality", "latency", "cost"]);

  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 2);
  assert.equal(ranked[2].rank, 3);
  assert.ok(ranked[0].totalScore >= ranked[1].totalScore);
  assert.ok(ranked[1].totalScore >= ranked[2].totalScore);

  for (const entry of ranked) {
    assert.ok(typeof entry.scores.quality === "number");
    assert.ok(typeof entry.scores.latency === "number");
    assert.ok(typeof entry.scores.cost === "number");
  }
});

test("ResponseComparator rankResponses uses default criteria when none provided", () => {
  const comparator = new ResponseComparator();

  const responses = [
    makeResponse("a"),
    makeResponse("b"),
  ];

  const ranked = comparator.rankResponses(responses);

  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 2);
});

test("ResponseComparator rankResponses throws on empty array", () => {
  const comparator = new ResponseComparator();

  assert.throws(
    () => comparator.rankResponses([]),
    /At least one response is required/,
  );
});

test("ResponseComparator selectBest picks the highest-scoring response", () => {
  const comparator = new ResponseComparator();

  const responses = [
    makeResponse("poor", {
      content: "OK.",
      latencyMs: 10000,
      cost: 0.05,
      toolCalls: [{ name: "file.read", isError: true }],
    }),
    makeResponse("excellent", {
      content: "Detailed, thorough, and well-structured response covering all aspects of the query.",
      latencyMs: 300,
      cost: 0.002,
      toolCalls: [
        { name: "file.read", isError: false },
        { name: "file.write", isError: false },
      ],
    }),
    makeResponse("mediocre", {
      content: "A decent but not great answer.",
      latencyMs: 800,
      cost: 0.008,
    }),
  ];

  const best = comparator.selectBest(responses);

  assert.equal(best.rank, 1);
  assert.ok(best.totalScore > 0);
  assert.ok(typeof best.confidence === "number");
});

test("ResponseComparator selectBest with single response returns it", () => {
  const comparator = new ResponseComparator();

  const single = makeResponse("only");
  const best = comparator.selectBest([single]);

  assert.equal(best.rank, 1);
  assert.equal(best.provider, "only");
});

test("ResponseComparator selectBest throws on empty array", () => {
  const comparator = new ResponseComparator();

  assert.throws(
    () => comparator.selectBest([]),
    /At least one response is required/,
  );
});

test("ResponseComparator getHistory tracks all comparisons", () => {
  const comparator = new ResponseComparator();

  comparator.compare(makeResponse("a"), makeResponse("b"));
  comparator.compare(makeResponse("b"), makeResponse("a"));

  const history = comparator.getHistory();
  assert.equal(history.length, 2);
});

test("ResponseComparator clearHistory removes all comparisons", () => {
  const comparator = new ResponseComparator();

  comparator.compare(makeResponse("a"), makeResponse("b"));

  assert.equal(comparator.getHistory().length, 1);

  comparator.clearHistory();

  assert.equal(comparator.getHistory().length, 0);
});

test("ResponseComparator setWeights and getWeights manage scoring weights", () => {
  const comparator = new ResponseComparator();

  const initialWeights = comparator.getWeights();

  assert.ok(initialWeights.quality > 0);
  assert.ok(initialWeights.latency > 0);

  comparator.setWeights({ quality: 0.6, latency: 0.1, cost: 0.2, toolUse: 0.1 });

  const updatedWeights = comparator.getWeights();
  assert.equal(updatedWeights.quality, 0.6);
  assert.equal(updatedWeights.latency, 0.1);
  assert.equal(updatedWeights.cost, 0.2);
  assert.equal(updatedWeights.toolUse, 0.1);
});

test("ResponseComparator handles responses with missing optional fields gracefully", () => {
  const comparator = new ResponseComparator();

  const minimal = {
    provider: "minimal",
    content: "Just content, no extras.",
  };

  const results = comparator.rankResponses([minimal, makeResponse("full")]);

  assert.equal(results.length, 2);
  assert.ok(results.every((r) => typeof r.totalScore === "number"));
});

test("DEFAULT_CRITERIA exports expected values", () => {
  assert.deepEqual(DEFAULT_CRITERIA, ["quality", "latency", "cost", "toolUse"]);
});

test("DEFAULT_WEIGHTS exports expected structure", () => {
  assert.ok(DEFAULT_WEIGHTS.quality > 0);
  assert.ok(DEFAULT_WEIGHTS.latency > 0);
  assert.ok(DEFAULT_WEIGHTS.cost > 0);
  assert.ok(DEFAULT_WEIGHTS.toolUse > 0);
});
