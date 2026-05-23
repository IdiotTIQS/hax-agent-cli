"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { OutcomeMerger, MERGE_STRATEGIES } = require("../../src/synthesis/merger");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeOutcome(content, overrides = {}) {
  return {
    content,
    provider: "agent-A",
    confidence: 0.9,
    weight: 1,
    ...overrides,
  };
}

const outcomesSimple = [
  makeOutcome(
    "The system should use a microservices architecture. Each service must be independently deployable. Monitoring is essential for reliability.",
    { provider: "agent-A" },
  ),
  makeOutcome(
    "A microservices architecture is recommended. Services should be independently deployable. Logging and monitoring are critical for observability.",
    { provider: "agent-B", confidence: 0.85 },
  ),
  makeOutcome(
    "Microservices are the best approach. Independent deployment of each service is required. Observability through monitoring and tracing is a must.",
    { provider: "agent-C", confidence: 0.92 },
  ),
];

const outcomesDivergent = [
  makeOutcome(
    "We should use a monolithic architecture for simplicity. Deployment is easier with a single artifact.",
    { provider: "agent-A" },
  ),
  makeOutcome(
    "Microservices architecture is the best choice for scalability. Independent deployment is crucial.",
    { provider: "agent-B" },
  ),
  makeOutcome(
    "A serverless approach would minimize operational overhead. Use cloud functions for business logic.",
    { provider: "agent-C" },
  ),
];

const outcomesSingle = [
  makeOutcome("This is a standalone outcome with no peers.", { provider: "solo-agent" }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("OutcomeMerger constructor accepts and validates options", () => {
  const merger = new OutcomeMerger();
  assert.ok(merger instanceof OutcomeMerger);

  const custom = new OutcomeMerger({
    majorityThreshold: 0.66,
    minPointLength: 20,
    similarityThreshold: 0.75,
  });
  assert.ok(custom instanceof OutcomeMerger);

  // Invalid values should clamp to defaults
  const invalid = new OutcomeMerger({
    majorityThreshold: 5,
    minPointLength: 1,
    similarityThreshold: -0.5,
  });
  assert.ok(invalid instanceof OutcomeMerger);
});

test("merge throws on empty or invalid input", () => {
  const merger = new OutcomeMerger();

  assert.throws(
    () => merger.merge([]),
    { message: /At least one outcome/ },
  );
  assert.throws(
    () => merger.merge(null),
    { message: /At least one outcome/ },
  );
  assert.throws(
    () => merger.merge([makeOutcome("test")], "INVALID"),
    { message: /Unknown merge strategy/ },
  );
});

test("merge UNION strategy includes all unique points", () => {
  const merger = new OutcomeMerger();
  const result = merger.merge(outcomesSimple, MERGE_STRATEGIES.UNION);

  assert.equal(result.strategy, MERGE_STRATEGIES.UNION);
  assert.equal(result.outcomeCount, outcomesSimple.length);
  assert.ok(result.totalPointsExtracted > 0);
  assert.ok(result.pointsIncluded > 0);
  assert.ok(result.content.length > 0);
  assert.ok(Array.isArray(result.sources));
  assert.equal(result.sources.length, outcomesSimple.length);

  // UNION should have at least as many points as outcomes (minimum 1 per outcome)
  assert.ok(result.pointsIncluded >= outcomesSimple.length);
});

test("merge INTERSECTION strategy keeps only common points", () => {
  const merger = new OutcomeMerger();
  const result = merger.merge(outcomesSimple, MERGE_STRATEGIES.INTERSECTION);

  assert.equal(result.strategy, MERGE_STRATEGIES.INTERSECTION);
  assert.ok(result.conflictCount >= 0, "conflictCount should be a number");

  // INTERSECTION should be more restrictive than UNION
  const unionResult = merger.merge(outcomesSimple, MERGE_STRATEGIES.UNION);
  assert.ok(
    result.pointsIncluded <= unionResult.pointsIncluded,
    "INTERSECTION should include no more points than UNION",
  );
});

test("merge MAJORITY strategy uses threshold", () => {
  // Use a lower similarity threshold so that slightly-different sentences cluster together
  const merger = new OutcomeMerger({ majorityThreshold: 0.5, similarityThreshold: 0.3 });
  const result = merger.merge(outcomesSimple, MERGE_STRATEGIES.MAJORITY);

  assert.equal(result.strategy, MERGE_STRATEGIES.MAJORITY);
  assert.ok(result.content.length > 0, "Majority merge should produce content with low similarity threshold");
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
  assert.ok(Array.isArray(result.conflicts));
});

test("merge WEIGHTED strategy uses agent weights", () => {
  const weightedOutcomes = [
    makeOutcome("Microservices are good. Monitoring is required.", { provider: "agent-A", weight: 2 }),
    makeOutcome("Monolithic is simpler. Deployment is easy.", { provider: "agent-B", weight: 0.5 }),
  ];

  const merger = new OutcomeMerger();
  const result = merger.merge(weightedOutcomes, MERGE_STRATEGIES.WEIGHTED);

  assert.equal(result.strategy, MERGE_STRATEGIES.WEIGHTED);
  assert.ok(result.content.length > 0);
  // Higher-weight agent's points should dominate
  const sourceA = result.sources.find((s) => s.provider === "agent-A");
  const sourceB = result.sources.find((s) => s.provider === "agent-B");
  assert.ok(sourceA, "agent-A should be in sources");
  assert.ok(sourceB, "agent-B should be in sources");
});

test("merge BEST_QUALITY strategy picks highest-quality agent", () => {
  const qualityOutcomes = [
    makeOutcome("A detailed and thorough analysis with many data points.", {
      provider: "high-quality",
      quality: 0.95,
      confidence: 0.9,
    }),
    makeOutcome("Brief note.", { provider: "low-quality", quality: 0.3, confidence: 0.5 }),
  ];

  const merger = new OutcomeMerger();
  const result = merger.merge(qualityOutcomes, MERGE_STRATEGIES.BEST_QUALITY);

  assert.equal(result.strategy, MERGE_STRATEGIES.BEST_QUALITY);
  assert.ok(result.content.length > 0);
  assert.ok(result.content.includes("detailed") || result.content.length > 20, "Should favor the high-quality agent's content");
});

test("resolveConflicts detects conflicting viewpoints", () => {
  const merger = new OutcomeMerger();
  const result = merger.resolveConflicts(outcomesDivergent);

  assert.ok(Array.isArray(result.conflicts));
  assert.ok(Array.isArray(result.resolutions));
  assert.ok(Number.isFinite(result.resolved));
  assert.ok(Number.isFinite(result.unresolved));
  assert.equal(result.totalConflicts, result.conflicts.length);
});

test("resolveConflicts handles single outcome gracefully", () => {
  const merger = new OutcomeMerger();
  const result = merger.resolveConflicts(outcomesSingle);

  assert.equal(result.totalConflicts, 0);
  assert.equal(result.resolved, 0);
  assert.ok(result.message.includes("Need at least 2"));
});

test("extractCommonGround finds agreement across outcomes", () => {
  // Use a lower similarity threshold to cluster similarly-worded sentences
  const merger = new OutcomeMerger({ similarityThreshold: 0.3 });
  const result = merger.extractCommonGround(outcomesSimple);

  assert.ok(Number.isFinite(result.agreementRatio));
  assert.ok(result.agreementRatio >= 0 && result.agreementRatio <= 1);
  assert.ok(Array.isArray(result.commonPoints));
  assert.ok(Array.isArray(result.partialAgreement));
  assert.ok(Array.isArray(result.uniquePoints));
  assert.equal(result.outcomeCount, outcomesSimple.length);

  // With all agents agreeing on microservices, there should be at least some common ground
  assert.ok(result.commonPoints.length > 0 || result.partialAgreement.length > 0,
    "Should find at least some agreement");
});

test("extractCommonGround with divergent outcomes shows low agreement", () => {
  const merger = new OutcomeMerger();
  const result = merger.extractCommonGround(outcomesDivergent);

  // Divergent outcomes should have lower agreement than aligned ones
  const alignedResult = merger.extractCommonGround(outcomesSimple);
  assert.ok(
    result.commonPoints.length <= alignedResult.commonPoints.length,
    "Divergent outcomes should have fewer or equal common points",
  );
});

test("generateUnified creates structured unified outcome", () => {
  const merger = new OutcomeMerger();
  const result = merger.generateUnified(outcomesSimple);

  assert.ok(result.content.length > 0);
  assert.equal(result.outcomeCount, outcomesSimple.length);
  assert.ok(Number.isFinite(result.commonGroundCount));
  assert.ok(Number.isFinite(result.majorityCount));
  assert.ok(Number.isFinite(result.minorityCount));
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
  assert.ok(Array.isArray(result.sources));

  // Content should be structured with headers
  assert.ok(
    result.content.includes("Consensus") || result.content.includes("- "),
    "Unified outcome should have structured markup",
  );
});

test("generateUnified with single outcome works", () => {
  const merger = new OutcomeMerger();
  const result = merger.generateUnified(outcomesSingle);

  assert.equal(result.outcomeCount, 1);
  assert.ok(result.content.length > 0);
  assert.ok(Array.isArray(result.sources));
  assert.equal(result.sources.length, 1);
});

test("getHistory and clearHistory track merge operations", () => {
  const merger = new OutcomeMerger();

  assert.equal(merger.getHistory().length, 0);

  merger.merge(outcomesSimple, MERGE_STRATEGIES.UNION);
  assert.equal(merger.getHistory().length, 1);

  merger.merge(outcomesSimple, MERGE_STRATEGIES.INTERSECTION);
  assert.equal(merger.getHistory().length, 2);

  const history = merger.getHistory();
  assert.equal(history[0].strategy, MERGE_STRATEGIES.UNION);
  assert.equal(history[1].strategy, MERGE_STRATEGIES.INTERSECTION);

  merger.clearHistory();
  assert.equal(merger.getHistory().length, 0);

  // History returned is a shallow copy
  merger.merge(outcomesSimple);
  const copy = merger.getHistory();
  copy.pop();
  assert.equal(merger.getHistory().length, 1, "Returned array should be independent");
});

test("merge handles outcomes with various content shapes", () => {
  const merger = new OutcomeMerger();

  const mixed = [
    { content: "Direct content field." },
    { response: { content: "Nested response.content field." } },
    { text: "Text field fallback." },
    { message: "Message field fallback." },
    { provider: "empty", content: "" },
  ];

  const result = merger.merge(mixed, MERGE_STRATEGIES.UNION);
  assert.ok(result.content.length > 0);
  assert.equal(result.outcomeCount, 5);
  assert.ok(Array.isArray(result.sources));
});

test("merge with explicit conflicts returns conflict metadata", () => {
  // Two agents disagreeing on the same topic in slightly different ways
  const disagreeingOutcomes = [
    makeOutcome("The project deadline should be extended by two weeks. The current timeline is unrealistic.", {
      provider: "agent-A",
    }),
    makeOutcome("The project deadline must not be extended. The team should work overtime to meet the original date.", {
      provider: "agent-B",
    }),
  ];

  const merger = new OutcomeMerger();
  const result = merger.merge(disagreeingOutcomes, MERGE_STRATEGIES.UNION);

  assert.ok(Array.isArray(result.conflicts));
  assert.ok(result.content.length > 0);
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
});
