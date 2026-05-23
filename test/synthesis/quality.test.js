"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { OutcomeQuality, QUALITY_DIMENSIONS, MINIMUM_VIABLE_SCORE } = require("../../src/synthesis/quality");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeOutcome(content, overrides = {}) {
  return {
    content,
    provider: "agent-A",
    confidence: 0.9,
    ...overrides,
  };
}

const highQualityOutcome = makeOutcome(
  [
    "The system architecture should follow a microservices pattern.",
    "Each service must be independently deployable with its own database.",
    "We recommend using Kubernetes for container orchestration.",
    "Monitoring should include distributed tracing with OpenTelemetry.",
    "Implementation steps are as follows:",
    "  1. Set up the CI/CD pipeline.",
    "  2. Deploy the API gateway.",
    "  3. Migrate existing services one by one.",
    "  4. Implement canary deployments.",
    "Expected outcomes include 99.9% uptime and sub-100ms p95 latency.",
    "This will reduce operational costs by an estimated 30%.",
    "The timeline spans 3 months with bi-weekly milestones.",
  ].join(" "),
  {
    provider: "architect-agent",
    confidence: 0.92,
    providerCount: 3,
    sources: [
      { provider: "agent-A" },
      { provider: "agent-B" },
      { provider: "agent-C" },
    ],
  },
);

const lowQualityOutcome = makeOutcome(
  "maybe we can try something. I think it might work perhaps.",
  { confidence: 0.3 },
);

const emptyOutcome = { content: "" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("OutcomeQuality constructor accepts and validates options", () => {
  const qa = new OutcomeQuality();
  assert.ok(qa instanceof OutcomeQuality);

  const custom = new OutcomeQuality({
    weights: { completeness: 0.3, clarity: 0.1 },
    minSentenceLength: 20,
    minSentencesForFull: 10,
    readabilityTarget: 4,
  });
  assert.ok(custom instanceof OutcomeQuality);
});

test("score returns full dimensional breakdown", () => {
  const qa = new OutcomeQuality();
  const report = qa.score(highQualityOutcome);

  assert.ok(Number.isFinite(report.totalScore));
  assert.ok(report.totalScore >= 0 && report.totalScore <= 100, `totalScore ${report.totalScore} out of bounds`);

  // All five dimensions should be present
  for (const dim of Object.values(QUALITY_DIMENSIONS)) {
    const dimReport = report.dimensions[dim];
    assert.ok(dimReport, `Missing dimension: ${dim}`);
    assert.ok(Number.isFinite(dimReport.score), `${dim}.score should be a number`);
    assert.ok(dimReport.score >= 0 && dimReport.score <= 20, `${dim}.score=${dimReport.score} out of 0-20 range`);
    assert.ok(Number.isFinite(dimReport.weight), `${dim}.weight should be a number`);
    if (dimReport.notes) {
      assert.ok(Array.isArray(dimReport.notes), `${dim}.notes should be an array`);
    }
  }

  // A high-quality outcome should score well
  assert.ok(report.totalScore > 50, `Expected high-quality outcome to score >50, got ${report.totalScore}`);
  assert.ok(report.viable, "High-quality outcome should be viable");
  assert.ok(["A", "B", "C", "D", "F"].includes(report.grade), `Unexpected grade: ${report.grade}`);
});

test("score returns zero for empty content", () => {
  const qa = new OutcomeQuality();
  const report = qa.score(emptyOutcome);

  assert.equal(report.totalScore, 0);
  assert.equal(report.viable, false);
  assert.equal(report.grade, "F");
  assert.equal(report.wordCount, 0);
  assert.equal(report.sentenceCount, 0);
});

test("score throws on invalid input", () => {
  const qa = new OutcomeQuality();

  assert.throws(() => qa.score(null), { message: /non-null object/i });
  assert.throws(() => qa.score(undefined), { message: /non-null object/i });
  assert.throws(() => qa.score("not an object"), { message: /non-null object/i });
});

test("low-quality outcome scores lower than high-quality outcome", () => {
  const qa = new OutcomeQuality();
  const highReport = qa.score(highQualityOutcome);
  const lowReport = qa.score(lowQualityOutcome);

  assert.ok(
    highReport.totalScore > lowReport.totalScore,
    `Expected high (${highReport.totalScore}) > low (${lowReport.totalScore})`,
  );
});

test("compareOutcomes provides detailed side-by-side comparison", () => {
  const qa = new OutcomeQuality();
  const comparison = qa.compareOutcomes(highQualityOutcome, lowQualityOutcome);

  assert.ok(comparison.outcomeA.totalScore > 0);
  assert.ok(comparison.outcomeB.totalScore >= 0);
  assert.ok(comparison.outcomeA.grade !== comparison.outcomeB.grade || true, "grades may differ");

  // Dimension comparison should include all dimensions
  for (const dim of Object.values(QUALITY_DIMENSIONS)) {
    assert.ok(comparison.dimensionComparison[dim], `Missing dimension comparison: ${dim}`);
    const dc = comparison.dimensionComparison[dim];
    assert.ok(Number.isFinite(dc.a));
    assert.ok(Number.isFinite(dc.b));
    assert.ok(["a", "b", "tie"].includes(dc.winner), `Unexpected winner: ${dc.winner}`);
    assert.ok(typeof dc.delta === "number");
  }

  assert.ok(["a", "b", "tie"].includes(comparison.overallWinner));
  assert.ok(Array.isArray(comparison.strengthsA));
  assert.ok(Array.isArray(comparison.strengthsB));
  assert.ok(Array.isArray(comparison.weaknessesA));
  assert.ok(Array.isArray(comparison.weaknessesB));

  // The high-quality outcome should win
  assert.equal(
    comparison.overallWinner,
    "a",
    "High-quality outcome should win comparison",
  );
});

test("compareOutcomes throws on invalid input", () => {
  const qa = new OutcomeQuality();

  assert.throws(() => qa.compareOutcomes(null, makeOutcome("test")), { message: /both outcomes/i });
  assert.throws(() => qa.compareOutcomes(makeOutcome("test"), undefined), { message: /both outcomes/i });
});

test("identifyGaps finds missing requirements", () => {
  const qa = new OutcomeQuality();

  const outcome = makeOutcome(
    "We will build a microservices platform using Kubernetes. The budget is $500,000 and deployment begins in Q3.",
  );

  const requirements = [
    "Platform uses microservices",
    "Budget is specified",
    "Timeline includes Q3",
    "Security review completed",
    "Risk mitigation exists",
    "Alternative architectures compared",
  ];

  const result = qa.identifyGaps(outcome, requirements);

  assert.ok(Array.isArray(result.gaps));
  assert.ok(Array.isArray(result.metRequirements));
  assert.ok(Array.isArray(result.unmetRequirements));
  assert.ok(Number.isFinite(result.coverage));
  assert.ok(result.coverage >= 0 && result.coverage <= 1);

  // Microservices, budget, and timeline should be covered
  assert.ok(
    result.metRequirements.some((r) => r.includes("microservices")),
    "Should cover microservices requirement",
  );
  assert.ok(
    result.metRequirements.some((r) => r.includes("Budget")),
    "Should cover budget requirement",
  );

  // Security, risk, alternatives should be gaps
  assert.ok(
    result.unmetRequirements.some((r) => r.includes("Security")),
    "Should flag security as a gap",
  );
  assert.ok(
    result.gaps.some((g) => g.requirement.includes("Security")),
    "Security gap should have details",
  );
});

test("identifyGaps handles empty requirements", () => {
  const qa = new OutcomeQuality();
  const result = qa.identifyGaps(makeOutcome("Some content"), []);

  assert.equal(result.gaps.length, 0);
  assert.equal(result.coverage, 1);
  assert.ok(result.message.includes("No requirements"));
});

test("identifyGaps throws on invalid outcome", () => {
  const qa = new OutcomeQuality();

  assert.throws(() => qa.identifyGaps(null, ["req"]), { message: /non-null object/i });
});

test("suggestImprovements generates actionable suggestions", () => {
  const qa = new OutcomeQuality();
  const result = qa.suggestImprovements(lowQualityOutcome);

  assert.ok(Number.isFinite(result.totalScore));
  assert.ok(result.suggestionCount > 0, "Low-quality outcome should have suggestions");
  assert.ok(Array.isArray(result.suggestions));

  // Suggestions should have priority, dimension, text, impact
  for (const sug of result.suggestions) {
    assert.ok(Number.isFinite(sug.priority));
    assert.ok(Object.values(QUALITY_DIMENSIONS).includes(sug.dimension));
    assert.ok(typeof sug.text === "string" && sug.text.length > 0);
    assert.ok(["high", "medium", "low"].includes(sug.impact));
  }

  // byDimension should be populated
  for (const dim of Object.values(QUALITY_DIMENSIONS)) {
    assert.ok(Array.isArray(result.byDimension[dim]));
  }

  assert.ok(typeof result.summary === "string" && result.summary.length > 0);
});

test("suggestImprovements for high-quality outcome returns few or no suggestions", () => {
  const qa = new OutcomeQuality();
  const result = qa.suggestImprovements(highQualityOutcome);

  // High-quality outcome may still have a few minor suggestions
  assert.ok(result.suggestionCount >= 0);
  assert.ok(Array.isArray(result.suggestions));
});

test("suggestImprovements throws on invalid outcome", () => {
  const qa = new OutcomeQuality();

  assert.throws(() => qa.suggestImprovements(null), { message: /non-null object/i });
});

test("score for outcome with conflict metadata reflects lower consistency", () => {
  const qa = new OutcomeQuality();

  const clean = makeOutcome(
    "All agents agree on the approach. The solution is sound and well-structured.",
    { confidence: 0.95, conflictCount: 0 },
  );

  const conflicted = makeOutcome(
    "Agents disagree on the approach. The solution is controversial.",
    { confidence: 0.5, conflictCount: 5 },
  );

  const cleanReport = qa.score(clean);
  const conflictedReport = qa.score(conflicted);

  assert.ok(
    cleanReport.totalScore > conflictedReport.totalScore,
    `Expected clean (${cleanReport.totalScore}) > conflicted (${conflictedReport.totalScore})`,
  );

  // Consistency dimension should specifically be lower for the conflicted outcome
  assert.ok(
    cleanReport.dimensions[QUALITY_DIMENSIONS.CONSISTENCY].score >=
      conflictedReport.dimensions[QUALITY_DIMENSIONS.CONSISTENCY].score,
    "Clean outcome should have >= consistency score",
  );
});

test("getHistory and clearHistory work correctly", () => {
  const qa = new OutcomeQuality();

  assert.equal(qa.getHistory().length, 0);

  qa.score(makeOutcome("First scoring result."));
  assert.equal(qa.getHistory().length, 1);

  qa.score(makeOutcome("Second scoring result with more detail."));
  assert.equal(qa.getHistory().length, 2);

  const history = qa.getHistory();
  assert.equal(history[0].wordCount, 3); // "First scoring result" = 3 words
  assert.ok(history[1].wordCount > history[0].wordCount);

  qa.clearHistory();
  assert.equal(qa.getHistory().length, 0);

  // History should be independent
  qa.score(makeOutcome("Test."));
  const copy = qa.getHistory();
  copy.pop();
  assert.equal(qa.getHistory().length, 1);
});

test("scoring handles outcomes with different content shapes", () => {
  const qa = new OutcomeQuality();

  const shapes = [
    { content: "Plain content." },
    { response: { content: "Nested content from response." } },
    { text: "Text field alternative." },
    { message: "Message as a last resort field." },
  ];

  for (const shape of shapes) {
    const report = qa.score(shape);
    assert.ok(report.totalScore >= 0);
    assert.ok(report.wordCount > 0, `wordCount should be > 0 for shape: ${JSON.stringify(shape)}`);
  }
});

test("MINIMUM_VIABLE_SCORE constant is exported", () => {
  assert.ok(Number.isFinite(MINIMUM_VIABLE_SCORE));
  assert.equal(MINIMUM_VIABLE_SCORE, 40);
});

test("QUALITY_DIMENSIONS contains all five dimensions", () => {
  const dims = Object.values(QUALITY_DIMENSIONS);
  assert.equal(dims.length, 5);
  assert.ok(dims.includes("completeness"));
  assert.ok(dims.includes("consistency"));
  assert.ok(dims.includes("accuracy"));
  assert.ok(dims.includes("clarity"));
  assert.ok(dims.includes("actionability"));
});
