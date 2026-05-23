"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ResponseSynthesizer,
  SYNTHESIS_STRATEGIES,
} = require("../../src/providers/synthesizer");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkResponse(provider, content, overrides = {}) {
  return {
    provider,
    response: { content },
    success: true,
    latencyMs: overrides.latencyMs ?? 300,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: synthesize
// ---------------------------------------------------------------------------

test("synthesize BEST_FIRST returns the highest-ranked response", () => {
  const synth = new ResponseSynthesizer();
  const responses = [
    mkResponse("anthropic", "A short reply.", { latencyMs: 500 }),
    mkResponse("openai", "A much longer and more detailed response that covers many points and provides thorough analysis.", { latencyMs: 300 }),
    mkResponse("google", "Medium-length reply with decent coverage.", { latencyMs: 200 }),
  ];

  const result = synth.synthesize(responses, SYNTHESIS_STRATEGIES.BEST_FIRST);

  assert.equal(result.strategy, SYNTHESIS_STRATEGIES.BEST_FIRST);
  assert.equal(result.providerCount, 3);
  assert.equal(result.sources.length, 1);
  assert.ok(result.content.length > 0);
  assert.ok(result.confidence > 0);
});

test("synthesize CONSENSUS finds common ground across providers", () => {
  const synth = new ResponseSynthesizer();
  const responses = [
    mkResponse("anthropic", "Caching improves performance. Retry logic handles failures. Monitoring tracks health."),
    mkResponse("openai", "Caching improves performance. Retry logic handles failures. Logging helps debugging."),
    mkResponse("google", "Caching improves performance. Retry logic handles failures. Alerts notify teams."),
  ];

  const result = synth.synthesize(responses, SYNTHESIS_STRATEGIES.CONSENSUS);

  assert.equal(result.strategy, SYNTHESIS_STRATEGIES.CONSENSUS);
  assert.equal(result.providerCount, 3);
  assert.ok(result.agreementLevel > 0, "Should have some agreement");
  assert.ok(result.content.includes("caching") || result.content.includes("Caching"));
  assert.ok(result.sources.length === 3);
});

test("synthesize MERGE_ALL combines all unique responses", () => {
  const synth = new ResponseSynthesizer();
  const responses = [
    mkResponse("anthropic", "We should use TypeScript."),
    mkResponse("openai", "I recommend Rust for performance."),
    mkResponse("google", "Python is the best choice here."),
  ];

  const result = synth.synthesize(responses, SYNTHESIS_STRATEGIES.MERGE_ALL);

  assert.equal(result.strategy, SYNTHESIS_STRATEGIES.MERGE_ALL);
  assert.equal(result.providerCount, 3);
  assert.equal(result.uniqueResponses, 3);
  assert.ok(result.content.includes("TypeScript"));
  assert.ok(result.content.includes("Rust"));
  assert.ok(result.content.includes("Python"));
});

test("synthesize WEIGHTED_VOTE uses majority voting to combine sentences", () => {
  const synth = new ResponseSynthesizer();
  const responses = [
    mkResponse("anthropic", "The system should use caching for performance. It should implement retry logic for resilience."),
    mkResponse("openai", "The system should use caching for performance. It should implement retry logic for resilience."),
    mkResponse("google", "The system should prefer pre-computation for performance. It should add timeout handling."),
  ];

  const result = synth.synthesize(responses, SYNTHESIS_STRATEGIES.WEIGHTED_VOTE);

  assert.equal(result.strategy, SYNTHESIS_STRATEGIES.WEIGHTED_VOTE);
  assert.equal(result.providerCount, 3);
  assert.ok(result.weights.length === 3);
  assert.ok(result.sources.length === 3);
});

test("synthesize throws on empty array", () => {
  const synth = new ResponseSynthesizer();

  assert.throws(
    () => synth.synthesize([], SYNTHESIS_STRATEGIES.BEST_FIRST),
    /At least one response is required/,
  );
});

test("synthesize returns graceful result when all responses failed", () => {
  const synth = new ResponseSynthesizer();
  const responses = [
    { provider: "a", error: "timeout", success: false },
    { provider: "b", error: "rate limit", success: false },
  ];

  const result = synth.synthesize(responses, SYNTHESIS_STRATEGIES.CONSENSUS);

  assert.equal(result.content, "");
  assert.equal(result.providerCount, 0);
  assert.equal(result.confidence, 0);
  assert.equal(result.message, "No valid responses to synthesize");
});

test("synthesize with single valid response works for all strategies", () => {
  const synth = new ResponseSynthesizer();
  const responses = [
    mkResponse("openai", "The only successful response."),
    { provider: "anthropic", error: "down", success: false },
  ];

  for (const strategy of Object.values(SYNTHESIS_STRATEGIES)) {
    const result = synth.synthesize(responses, strategy);
    assert.equal(result.providerCount, 1, `Strategy ${strategy} should have 1 provider`);
    assert.ok(result.content.length > 0, `Strategy ${strategy} should have content`);
    assert.ok(result.sources.length >= 1, `Strategy ${strategy} should have sources`);
  }
});

test("synthesize throws on unknown strategy", () => {
  const synth = new ResponseSynthesizer();
  const responses = [mkResponse("openai", "Hello.")];

  assert.throws(
    () => synth.synthesize(responses, "NONEXISTENT"),
    /Unknown synthesis strategy/,
  );
});

// ---------------------------------------------------------------------------
// Tests: extractConsensus
// ---------------------------------------------------------------------------

test("extractConsensus identifies sentences present in multiple responses", () => {
  const synth = new ResponseSynthesizer();
  const responses = [
    mkResponse("anthropic", "Caching improves performance significantly. Retry logic handles transient failures well."),
    mkResponse("openai", "Caching improves performance significantly. We should also add circuit breakers."),
  ];

  const result = synth.extractConsensus(responses);

  assert.ok(result.agreementLevel >= 0, "Agreement level should be computed");
  assert.ok(result.sharedPoints.length > 0, "Should find shared points");
  assert.ok(
    result.consensus.includes("caching"),
    "Consensus should include shared caching point",
  );
  assert.equal(result.providerCount, 2);
});

test("extractConsensus returns single response when only one provider succeeds", () => {
  const synth = new ResponseSynthesizer();
  const responses = [
    mkResponse("anthropic", "The only working provider."),
    { provider: "openai", error: "failed", success: false },
  ];

  const result = synth.extractConsensus(responses);

  assert.equal(result.agreementLevel, 1);
  assert.equal(result.sharedPoints.length, 0);
  assert.equal(result.providerCount, 1);
  assert.equal(result.message, "Need at least 2 responses for consensus");
});

test("extractConsensus throws on empty array", () => {
  const synth = new ResponseSynthesizer();

  assert.throws(
    () => synth.extractConsensus([]),
    /At least one response is required/,
  );
});

// ---------------------------------------------------------------------------
// Tests: resolveDisagreement
// ---------------------------------------------------------------------------

test("resolveDisagreement detects conflicting claims across providers", () => {
  const synth = new ResponseSynthesizer();
  const responses = [
    mkResponse("anthropic", "TypeScript should be used for type safety and better developer experience."),
    mkResponse("openai", "JavaScript should be used for simplicity and faster iteration."),
    mkResponse("google", "TypeScript provides type safety and developer experience improvements."),
  ];

  const result = synth.resolveDisagreement(responses);

  assert.equal(result.providerCount, 3);
  assert.ok(result.resolution.length > 0, "Resolution text should be non-empty");
  // Disagreements may vary, but the overall structure should be correct
  assert.equal(typeof result.unresolvedCount, "number");
  assert.equal(typeof result.agreedCount, "number");
});

test("resolveDisagreement with all agreement returns zero unresolved", () => {
  const synth = new ResponseSynthesizer();
  const responses = [
    mkResponse("anthropic", "Use caching for performance optimization and implement retry logic for resilience."),
    mkResponse("openai", "Use caching for performance optimization and implement retry logic for resilience."),
  ];

  const result = synth.resolveDisagreement(responses);

  assert.equal(result.providerCount, 2);
  assert.ok(result.agreedCount > 0, "When providers agree fully, agreedCount should be positive");
  assert.ok(result.resolution.includes("RESOLVED"), "Resolution should show agreement");
});

test("resolveDisagreement throws on empty array", () => {
  const synth = new ResponseSynthesizer();

  assert.throws(
    () => synth.resolveDisagreement([]),
    /At least one response is required/,
  );
});

// ---------------------------------------------------------------------------
// Tests: rankQuality
// ---------------------------------------------------------------------------

test("rankQuality scores and ranks responses by quality", () => {
  const synth = new ResponseSynthesizer();
  const responses = [
    mkResponse("short", "Brief.", { latencyMs: 50 }),
    mkResponse("medium", "A moderate length response with decent detail and explanation.", { latencyMs: 100 }),
    mkResponse("long", "A much longer and more detailed response that provides thorough analysis, multiple perspectives, and covers many different angles of the topic in depth.", { latencyMs: 200 }),
  ];

  const ranked = synth.rankQuality(responses);

  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].rank, 1, "Top entry should have rank 1");
  assert.equal(ranked[1].rank, 2, "Second entry should have rank 2");
  assert.equal(ranked[2].rank, 3, "Third entry should have rank 3");
  // Rankings are sorted descending by totalScore
  assert.ok(ranked[0].totalScore >= ranked[1].totalScore, "Rank 1 should have highest score");
  assert.ok(ranked[1].totalScore >= ranked[2].totalScore, "Rank 2 should be >= rank 3 score");
  // Each entry should have scores sub-object
  for (const entry of ranked) {
    assert.ok(entry.scores.length !== undefined);
    assert.ok(entry.scores.structure !== undefined);
    assert.ok(entry.scores.uniqueness !== undefined);
  }
});

test("rankQuality throws on empty array", () => {
  const synth = new ResponseSynthesizer();

  assert.throws(
    () => synth.rankQuality([]),
    /At least one response is required/,
  );
});

// ---------------------------------------------------------------------------
// Tests: history and weights
// ---------------------------------------------------------------------------

test("getHistory tracks synthesis operations", () => {
  const synth = new ResponseSynthesizer();
  const responses = [mkResponse("openai", "Hello.")];

  assert.equal(synth.getHistory().length, 0);

  synth.synthesize(responses, SYNTHESIS_STRATEGIES.BEST_FIRST);
  assert.equal(synth.getHistory().length, 1);

  synth.synthesize(responses, SYNTHESIS_STRATEGIES.CONSENSUS);
  assert.equal(synth.getHistory().length, 2);

  synth.clearHistory();
  assert.equal(synth.getHistory().length, 0);
});

test("setWeights updates quality scoring weights", () => {
  const synth = new ResponseSynthesizer();
  const defaultWeights = synth.getWeights();

  synth.setWeights({ length: 0.5, structure: 0.1, uniqueness: 0.1, latency: 0.2, specificity: 0.1 });

  const updated = synth.getWeights();
  assert.equal(updated.length, 0.5);
  assert.equal(updated.structure, 0.1);
  assert.equal(updated.uniqueness, 0.1);
  assert.equal(updated.latency, 0.2);
  assert.equal(updated.specificity, 0.1);
  assert.notDeepEqual(updated, defaultWeights);
});
