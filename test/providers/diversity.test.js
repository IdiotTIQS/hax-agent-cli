"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DiversityChecker } = require("../../src/providers/diversity");

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
// Tests: checkDiversity
// ---------------------------------------------------------------------------

test("checkDiversity returns high diversity for very different responses", () => {
  const checker = new DiversityChecker();
  const responses = [
    mkResponse("anthropic", "We should adopt a microservices architecture with Kubernetes for orchestration and gRPC for communication. This approach maximizes scalability and team autonomy."),
    mkResponse("openai", "The best strategy is to use a monolithic application with PostgreSQL. Simplicity reduces operational overhead and debugging complexity."),
    mkResponse("google", "Consider using serverless functions with event-driven architecture. This eliminates infrastructure management and scales cost-effectively."),
  ];

  const metrics = checker.checkDiversity(responses);

  assert.equal(metrics.providerCount, 3);
  assert.ok(metrics.diversityScore > 0.3, "Very different responses should have noticeable diversity");
  assert.equal(typeof metrics.uniqueWordsRatio, "number");
  assert.equal(typeof metrics.uniquePhrasesRatio, "number");
  assert.equal(typeof metrics.perspectiveCount, "number");
  assert.equal(typeof metrics.structureDiversity, "number");
  assert.equal(typeof metrics.wordOverlap, "number");
  assert.equal(typeof metrics.phraseOverlap, "number");
});

test("checkDiversity returns low diversity for very similar responses", () => {
  const checker = new DiversityChecker();
  const baseContent = "We should implement caching for performance optimization and add retry logic for resilience. Monitoring and alerting are also essential.";
  const responses = [
    mkResponse("anthropic", baseContent),
    mkResponse("openai", "We should implement caching for performance and add retry logic for resilience. Monitoring and alerting are essential too."),
    mkResponse("google", "We should implement caching for performance optimization. Add retry logic for resilience. Monitoring and alerting are essential."),
  ];

  const metrics = checker.checkDiversity(responses);

  assert.equal(metrics.providerCount, 3);
  assert.ok(metrics.diversityScore < 0.7, "Very similar responses should have lower diversity");
  assert.ok(metrics.wordOverlap > 0.2, "Similar responses should have high word overlap");
});

test("checkDiversity returns zero diversity for identical responses", () => {
  const checker = new DiversityChecker();
  const identical = "Caching is essential for performance. Retry logic handles transient failures.";
  const responses = [
    mkResponse("anthropic", identical),
    mkResponse("openai", identical),
  ];

  const metrics = checker.checkDiversity(responses);

  assert.equal(metrics.providerCount, 2);
  assert.ok(metrics.diversityScore < 0.5, "Identical responses should have very low diversity");
  assert.ok(metrics.wordOverlap > 0.5, "Identical responses should have very high word overlap");
  assert.ok(metrics.phraseOverlap > 0.5, "Identical responses should have very high phrase overlap");
});

test("checkDiversity throws on empty array", () => {
  const checker = new DiversityChecker();

  assert.throws(
    () => checker.checkDiversity([]),
    /At least one response is required/,
  );
});

test("checkDiversity with single valid response returns zero diversity", () => {
  const checker = new DiversityChecker();
  const responses = [
    mkResponse("openai", "A single provider response with some content."),
  ];

  const metrics = checker.checkDiversity(responses);

  assert.equal(metrics.providerCount, 1);
  assert.equal(metrics.diversityScore, 0);
  assert.equal(metrics.message, "Need at least 2 valid responses to measure diversity");
});

test("checkDiversity handles mixed successful and failed responses", () => {
  const checker = new DiversityChecker();
  const responses = [
    mkResponse("anthropic", "Response about caching and performance optimization with detailed analysis of latency implications."),
    mkResponse("openai", "Response about caching and performance optimization with detailed analysis of latency implications."),
    { provider: "google", error: "timeout", success: false },
    { provider: "meta", error: "rate limited", success: false },
  ];

  const metrics = checker.checkDiversity(responses);

  assert.equal(metrics.providerCount, 2, "Should only count successful responses");
  assert.ok(metrics.diversityScore < 0.5, "Two identical responses should have very low diversity");
});

// ---------------------------------------------------------------------------
// Tests: getDiversityScore
// ---------------------------------------------------------------------------

test("getDiversityScore reflects the last checkDiversity call", () => {
  const checker = new DiversityChecker();

  assert.equal(checker.getDiversityScore(), 0, "Default score should be 0");

  const diverse = [
    mkResponse("a", "Microservices with Kubernetes and gRPC for inter-service communication."),
    mkResponse("b", "Monolithic architecture with PostgreSQL and REST APIs for simplicity."),
  ];
  checker.checkDiversity(diverse);
  const scoreAfterDiverse = checker.getDiversityScore();
  assert.ok(scoreAfterDiverse > 0.1, "Diverse responses should yield positive score");

  const similar = [
    mkResponse("a", "Caching is important. Retry logic is important. Monitoring is important."),
    mkResponse("b", "Caching is important. Retry logic is important. Monitoring is important."),
  ];
  checker.checkDiversity(similar);
  const scoreAfterSimilar = checker.getDiversityScore();
  assert.ok(scoreAfterSimilar < scoreAfterDiverse, "Similar responses should yield lower score than diverse ones");
});

// ---------------------------------------------------------------------------
// Tests: isEchoChamber
// ---------------------------------------------------------------------------

test("isEchoChamber detects when providers are too aligned", () => {
  const checker = new DiversityChecker({ echoChamberThreshold: 0.5 });
  const identical = "Caching is essential for performance. Retry logic handles transient failures.";
  const responses = [
    mkResponse("anthropic", identical),
    mkResponse("openai", identical),
    mkResponse("google", identical),
  ];

  const result = checker.isEchoChamber(responses);

  assert.equal(result.isEchoChamber, true, "Identical responses should be detected as echo chamber");
  assert.ok(result.similarityScore >= 0.5, "Similarity should be high");
  assert.equal(result.providerCount, 3);
  assert.ok(result.message.includes("Echo chamber"));
});

test("isEchoChamber reports false for diverse responses", () => {
  const checker = new DiversityChecker({ echoChamberThreshold: 0.85 });
  const responses = [
    mkResponse("anthropic", "We should use a microservices architecture with Kubernetes orchestration and event-driven communication patterns for maximum scalability."),
    mkResponse("openai", "A monolithic Rails application is the most productive choice. It simplifies deployment and reduces cognitive overhead for the team."),
    mkResponse("google", "Serverless is the future. Use Cloud Functions with Firestore and eliminate infrastructure management entirely."),
  ];

  const result = checker.isEchoChamber(responses);

  assert.equal(result.isEchoChamber, false, "Diverse responses should not be an echo chamber");
  assert.ok(result.similarityScore < result.echoChamberThreshold);
  assert.ok(result.message.includes("sufficient diversity"));
});

test("isEchoChamber returns false for single provider", () => {
  const checker = new DiversityChecker();
  const responses = [mkResponse("openai", "Only one provider available.")];

  const result = checker.isEchoChamber(responses);

  assert.equal(result.isEchoChamber, false);
  assert.equal(result.similarityScore, 0);
  assert.equal(result.providerCount, 1);
  assert.ok(result.message.includes("Need at least 2"));
});

// ---------------------------------------------------------------------------
// Tests: suggestAlternative
// ---------------------------------------------------------------------------

test("suggestAlternative identifies missing perspectives in homogeneous responses", () => {
  const checker = new DiversityChecker();
  const responses = [
    mkResponse("anthropic", "We should cache all database queries to improve response time. Adding more cache layers will make the system faster."),
    mkResponse("openai", "Implement query caching at every level. The performance gains from aggressive caching will be significant."),
  ];

  const result = checker.suggestAlternative(responses);

  assert.equal(result.providerCount, 2);
  assert.ok(result.alternative.length > 0, "Alternative text should be generated");
  assert.ok(result.missingAngles.length > 0, "Should identify missing angles");
  assert.ok(
    result.missingAngles.some(
      (a) =>
        a.includes("security") ||
        a.includes("cost") ||
        a.includes("risk") ||
        a.includes("user"),
    ),
    "Should find at least one missing perspective category",
  );
});

test("suggestAlternative handles diverse responses gracefully", () => {
  const checker = new DiversityChecker();
  const responses = [
    mkResponse("anthropic", "From a security standpoint, we need encryption at rest, encryption in transit, and role-based access control. The cost implications are significant but necessary for compliance."),
    mkResponse("openai", "For long-term scalability, we should design for horizontal scaling from day one. The user experience should remain consistent as the system grows. Risk assessment shows moderate technical debt risks."),
  ];

  const result = checker.suggestAlternative(responses);

  assert.equal(result.providerCount, 2);
  assert.ok(result.alternative.length > 0);
  // With diverse responses covering many angles, fewer should be missing
  assert.ok(result.missingAngles.length <= 5);
});

test("suggestAlternative throws on empty array", () => {
  const checker = new DiversityChecker();

  assert.throws(
    () => checker.suggestAlternative([]),
    /At least one response is required/,
  );
});

test("suggestAlternative returns graceful result when all responses failed", () => {
  const checker = new DiversityChecker();
  const responses = [
    { provider: "a", error: "timeout", success: false },
    { provider: "b", error: "rate limit", success: false },
  ];

  const result = checker.suggestAlternative(responses);

  assert.equal(result.providerCount, 0);
  assert.equal(result.alternative, "");
  assert.ok(result.reasoning.includes("No valid responses"));
});

// ---------------------------------------------------------------------------
// Tests: configuration
// ---------------------------------------------------------------------------

test("DiversityChecker custom thresholds affect echo chamber detection", () => {
  const baseContent = "Caching is important for performance.";
  const responses = [
    mkResponse("a", baseContent),
    mkResponse("b", baseContent),
  ];

  // With a very low threshold, even modest similarity triggers echo chamber
  const sensitive = new DiversityChecker({ echoChamberThreshold: 0.3 });
  const sensitiveResult = sensitive.isEchoChamber(responses);
  assert.equal(sensitiveResult.isEchoChamber, true);

  // With a very high threshold, only near-identical responses trigger
  const lenient = new DiversityChecker({ echoChamberThreshold: 0.99 });
  const similarResponses = [
    mkResponse("a", "Caching is important for performance and should be used widely."),
    mkResponse("b", "Caching is important for performance but has trade-offs to consider."),
  ];
  const lenientResult = lenient.isEchoChamber(similarResponses);
  assert.equal(lenientResult.isEchoChamber, false);
});

test("checkDiversity scores different structural patterns", () => {
  const checker = new DiversityChecker();
  const responses = [
    mkResponse("detailed", "First, we should consider the system architecture carefully. Second, we need to evaluate the trade-offs between different approaches. Finally, we should make a decision that balances all concerns. This approach ensures thoroughness and reduces risk of oversight."),
    mkResponse("terse", "Use caching. Add retries. Monitor everything."),
  ];

  const metrics = checker.checkDiversity(responses);

  assert.equal(metrics.providerCount, 2);
  assert.ok(metrics.structureDiversity > 0, "Different sentence structures should yield positive structure diversity");
  assert.ok(metrics.diversityScore > 0.2, "Structurally different responses should have meaningful diversity");
});
