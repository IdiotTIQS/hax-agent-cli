'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { DecisionTracer } = require('../../src/explain/tracer');
const { CounterfactualEngine } = require('../../src/explain/counterfactual');

// ---------------------------------------------------------------------------
// Helper: create a tracer with sample decisions
// ---------------------------------------------------------------------------

/**
 * Create a tracer with varied decisions for counterfactual analysis.
 * @returns {DecisionTracer}
 */
function seededTracer() {
  const tracer = new DecisionTracer();

  // Decision 1: Good tool selection with alternatives
  tracer.traceToolSelection('agent-1', 'Find auth bug', [
    { name: 'Read', description: 'Read file directly', score: 0.5, pros: ['fast'], cons: ['manual search'] },
    { name: 'Grep', description: 'Search with patterns', score: 0.9, pros: ['fast', 'comprehensive'], cons: ['needs pattern'] },
    { name: 'Bash', description: 'Run shell commands', score: 0.3, pros: ['flexible'], cons: ['risky', 'slow'] },
  ], 'Grep', {
    sessionId: 'sess-main',
    rationale: 'Grep is the most efficient for pattern-based search across files.',
    confidence: 0.85,
    outcome: { success: true, result: 'Found 3 matches in auth.js' },
  });

  // Decision 2: Failed error recovery
  tracer.traceErrorRecovery('agent-1', 'ETIMEDOUT: Operation timed out', [
    { id: 'retry', description: 'Retry with backoff', score: 0.7, pros: ['simple'], cons: ['may fail again'] },
    { id: 'skip', description: 'Skip the failing operation', score: 0.3, pros: ['fast'], cons: ['incomplete'] },
    { id: 'ask', description: 'Ask user for guidance', score: 0.5, pros: ['safe'], cons: ['interrupts flow'] },
  ], 'retry', {
    sessionId: 'sess-main',
    rationale: 'Timeouts are usually transient; retrying is the standard approach.',
    confidence: 0.7,
    outcome: { success: false, result: 'Still timed out after 3 retries' },
  });

  // Decision 3: Response path with many alternatives
  tracer.traceResponsePath('agent-1', 'How to implement caching?', [
    { id: 'in-memory', description: 'Simple in-memory LRU cache', score: 0.9, pros: ['fast', 'simple'], cons: ['no persistence'] },
    { id: 'redis', description: 'Redis-backed cache', score: 0.7, pros: ['shared', 'persistent'], cons: ['complex', 'dep'] },
    { id: 'file', description: 'File-based cache', score: 0.4, pros: ['persistent'], cons: ['slow', 'lock issues'] },
    { id: 'none', description: 'Skip caching entirely', score: 0.1, pros: ['no complexity'], cons: ['slow queries'] },
  ], 'in-memory', {
    sessionId: 'sess-main',
    rationale: 'In-memory LRU is sufficient for single-process use and trivial to implement.',
    confidence: 0.9,
    outcome: { success: true, result: 'Cache improved response time by 80%' },
  });

  // Second session for cross-session analysis
  tracer.traceToolSelection('agent-2', 'Deploy release', [
    { name: 'Bash', description: 'Shell deployment', score: 0.8, pros: ['direct'], cons: ['manual'] },
    { name: 'Write', description: 'Write deploy script', score: 0.6, pros: ['automated'], cons: ['slower setup'] },
  ], 'Bash', {
    sessionId: 'sess-2',
    confidence: 0.65,
    outcome: { success: true, result: 'Deployed successfully' },
  });

  return tracer;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test('CounterfactualEngine constructs with a tracer', () => {
  const tracer = new DecisionTracer();
  const engine = new CounterfactualEngine(tracer);
  assert.ok(engine instanceof CounterfactualEngine);
});

test('CounterfactualEngine throws without a tracer', () => {
  assert.throws(() => new CounterfactualEngine(null), {
    message: /requires a DecisionTracer instance/,
  });
});

test('CounterfactualEngine can be disabled', () => {
  const tracer = seededTracer();
  const engine = new CounterfactualEngine(tracer, { enabled: false });
  const result = engine.whatIf({ id: 'd1' }, 'alt');
  assert.ok(result.error);
  assert.ok(result.error.includes('disabled'));
});

// ---------------------------------------------------------------------------
// whatIf analysis
// ---------------------------------------------------------------------------

test('whatIf explores an alternative path for a decision', () => {
  const tracer = seededTracer();
  const decisions = tracer.getAllDecisions({ limit: 10 });
  const grepDecision = decisions.find((d) => d.type === 'tool_selection');

  const engine = new CounterfactualEngine(tracer);
  const result = engine.whatIf(grepDecision, 'Bash');

  assert.strictEqual(result.analysisType, 'what_if');
  assert.strictEqual(result.decisionId, grepDecision.id);
  assert.strictEqual(result.originalChoice.id, 'Grep');
  assert.strictEqual(result.alternativeChoice.id, 'Bash');
  assert.ok(typeof result.comparison.estimatedImprovement === 'string');
  assert.ok(typeof result.comparison.riskLevel === 'string');
});

test('whatIf handles selecting the same alternative', () => {
  const tracer = seededTracer();
  const decisions = tracer.getAllDecisions({ limit: 10 });
  const grepDecision = decisions.find((d) => d.type === 'tool_selection');

  const engine = new CounterfactualEngine(tracer);
  const result = engine.whatIf(grepDecision, 'Grep');

  assert.strictEqual(result.isSameChoice, true);
  assert.ok(result.note);
});

test('whatIf returns error for disabled engine', () => {
  const tracer = new DecisionTracer();
  const engine = new CounterfactualEngine(tracer, { enabled: false });
  const result = engine.whatIf({ id: 'test' }, 'alt');
  assert.ok(result.error);
});

// ---------------------------------------------------------------------------
// compareOutcomes
// ---------------------------------------------------------------------------

test('compareOutcomes ranks all alternatives against actual choice', () => {
  const tracer = seededTracer();
  const decisions = tracer.getAllDecisions({ limit: 10 });
  const cacheDecision = decisions.find(
    (d) => d.type === 'response_path' && d.outcome && d.outcome.chosen === 'in-memory'
  );

  const engine = new CounterfactualEngine(tracer);
  const result = engine.compareOutcomes(cacheDecision);

  assert.strictEqual(result.analysisType, 'comparison');
  assert.strictEqual(result.decisionId, cacheDecision.id);
  assert.ok(Array.isArray(result.rankings));
  assert.ok(result.rankings.length >= 4);
  assert.ok(result.summary);
  assert.ok(Array.isArray(result.summary.missedOpportunities));
  assert.ok(Array.isArray(result.summary.correctlyAvoided));

  // The actual choice should be marked as such
  const actualEntry = result.rankings.find((r) => r.isActualChoice);
  assert.ok(actualEntry);
  assert.strictEqual(actualEntry.rank, 'best_choice');
});

test('compareOutcomes uses provided alternatives array', () => {
  const tracer = seededTracer();
  const decisions = tracer.getAllDecisions({ limit: 10 });
  const grepDecision = decisions.find((d) => d.outcome && d.outcome.chosen === 'Grep');

  const engine = new CounterfactualEngine(tracer);
  const result = engine.compareOutcomes(grepDecision, [
    { id: 'custom-1', description: 'Custom approach 1' },
    { id: 'custom-2', description: 'Custom approach 2' },
  ]);

  assert.strictEqual(result.comparisonCount, 2);
  assert.ok(result.rankings.some((r) => r.alternativeId === 'custom-1'));
});

test('compareOutcomes handles decisions with no alternatives', () => {
  const tracer = new DecisionTracer();
  const emptyDecision = { id: 'empty', alternatives: [], outcome: {} };

  const engine = new CounterfactualEngine(tracer);
  const result = engine.compareOutcomes(emptyDecision);

  assert.strictEqual(result.comparisonCount, 0);
  assert.ok(result.note);
  assert.strictEqual(result.rankings.length, 0);
});

// ---------------------------------------------------------------------------
// estimateImpact
// ---------------------------------------------------------------------------

test('estimateImpact returns high impact for failed error recovery', () => {
  const tracer = seededTracer();
  const decisions = tracer.getAllDecisions({ limit: 10 });
  const failedRecovery = decisions.find(
    (d) => d.type === 'error_recovery' && d.outcome && d.outcome.success === false
  );

  const engine = new CounterfactualEngine(tracer);
  const result = engine.estimateImpact(failedRecovery, failedRecovery.outcome);

  assert.strictEqual(result.decisionId, failedRecovery.id);
  assert.ok(result.impactScore > 0, `Expected impact score > 0, got ${result.impactScore}`);
  assert.ok(typeof result.impactLevel === 'string');
  assert.ok(typeof result.description === 'string');
  assert.ok(result.factors);
  assert.strictEqual(result.factors.wasErrorRecovery, true);
  assert.strictEqual(result.factors.wasFailure, true);
});

test('estimateImpact assigns lower impact to routine decisions', () => {
  const tracer = new DecisionTracer();
  tracer.traceToolSelection('agent', 'simple task', ['Read'], 'Read', {
    sessionId: 's',
    confidence: 0.9,
    outcome: { success: true },
  });

  const decisions = tracer.getAllDecisions({ limit: 10 });
  const engine = new CounterfactualEngine(tracer);
  const result = engine.estimateImpact(decisions[0], decisions[0].outcome);

  // A single-alternative, successful, non-recovery decision should have low impact
  assert.ok(result.impactScore < 0.5, `Expected impact < 0.5 for trivial decision, got ${result.impactScore}`);
  assert.ok(result.factors.alternativeCount <= 1);
});

// ---------------------------------------------------------------------------
// findPivotalDecision
// ---------------------------------------------------------------------------

test('findPivotalDecision identifies the most impactful decision in a session', () => {
  const tracer = seededTracer();
  const engine = new CounterfactualEngine(tracer);
  const result = engine.findPivotalDecision('sess-main');

  assert.strictEqual(result.sessionId, 'sess-main');
  assert.strictEqual(result.totalDecisions, 3);
  assert.ok(result.pivotalDecision);
  assert.ok(typeof result.pivotalDecision.pivotalScore === 'number');
  assert.ok(result.pivotalDecision.pivotalScore > 0);
  assert.ok(typeof result.pivotalDecision.description === 'string');
  assert.ok(result.runnerUp);
  assert.ok(result.runnerUp.pivotalScore <= result.pivotalDecision.pivotalScore);
  assert.ok(Array.isArray(result.allScores));
  assert.strictEqual(result.allScores.length, 3);
});

test('findPivotalDecision handles session with no decisions', () => {
  const tracer = new DecisionTracer();
  const engine = new CounterfactualEngine(tracer);
  const result = engine.findPivotalDecision('empty-session');

  assert.strictEqual(result.totalDecisions, 0);
  assert.strictEqual(result.pivotalDecision, null);
  assert.ok(result.note);
});

test('findPivotalDecision accepts a decision array directly', () => {
  const tracer = seededTracer();
  const tree = tracer.getDecisionTree('sess-main');
  const engine = new CounterfactualEngine(tracer);
  const result = engine.findPivotalDecision(tree.decisions);

  assert.strictEqual(result.sessionId, 'unknown');
  assert.strictEqual(result.totalDecisions, 3);
  assert.ok(result.pivotalDecision);
});

test('findPivotalDecision ranks error recoveries as more pivotal', () => {
  const tracer = new DecisionTracer();

  // Add a regular tool selection
  tracer.traceToolSelection('agent', 'simple task', ['Read', 'Write'], 'Read', {
    sessionId: 'pivot-test',
    confidence: 0.9,
    outcome: { success: true },
  });

  // Add a failed error recovery (should be more pivotal)
  tracer.traceErrorRecovery('agent', 'critical failure', ['retry', 'abort'], 'retry', {
    sessionId: 'pivot-test',
    confidence: 0.8,
    outcome: { success: false, result: 'Retry failed' },
  });

  const engine = new CounterfactualEngine(tracer);
  const result = engine.findPivotalDecision('pivot-test');

  assert.strictEqual(result.pivotalDecision.type, 'error_recovery');
});

// ---------------------------------------------------------------------------
// generateWhatIfReport
// ---------------------------------------------------------------------------

test('generateWhatIfReport produces comprehensive analysis report', () => {
  const tracer = seededTracer();
  const decisions = tracer.getAllDecisions({ limit: 10 });
  const grepDecision = decisions.find((d) => d.outcome && d.outcome.chosen === 'Grep');

  const engine = new CounterfactualEngine(tracer);
  const result = engine.generateWhatIfReport(grepDecision);

  assert.ok(result.reportId);
  assert.ok(typeof result.reportId === 'string');
  assert.ok(result.generatedAt);
  assert.strictEqual(result.decision.id, grepDecision.id);
  assert.ok(result.actualOutcome);
  assert.ok(result.impact);
  assert.ok(Array.isArray(result.whatIfScenarios));
  assert.ok(result.comparison);
  assert.ok(result.recommendations);

  // Should have what-if scenarios for alternatives that weren't chosen
  const nonChosenAlts = grepDecision.alternatives.filter(
    (a) => a.id !== (grepDecision.outcome && grepDecision.outcome.chosen)
  );
  assert.strictEqual(result.whatIfScenarios.length, nonChosenAlts.length);
});

test('generateWhatIfReport identifies best missed opportunity', () => {
  const tracer = seededTracer();
  const decisions = tracer.getAllDecisions({ limit: 10 });
  const cacheDecision = decisions.find(
    (d) => d.type === 'response_path' && d.outcome && d.outcome.chosen === 'in-memory'
  );

  const engine = new CounterfactualEngine(tracer);
  const result = engine.generateWhatIfReport(cacheDecision);

  // "redis" scored 0.7 which may be identified as a missed opportunity
  assert.ok(result.recommendations.bestMissedOpportunity !== null ||
    result.recommendations.bestRiskAvoided !== null);

  // The "none" alternative (score 0.1) should be a correctly avoided risk
  const avoided = result.comparison.summary.correctlyAvoided;
  assert.ok(avoided.length > 0, 'Low-scored alternatives should be marked as avoided');
});

test('generateWhatIfReport handles decisions with no alternatives', () => {
  const tracer = new DecisionTracer();
  tracer.traceDecision('agent', { task: 'simple' }, {
    sessionId: 's',
    alternatives: [],
    outcome: { chosen: 'only-option' },
  }, 'only-option');

  const decisions = tracer.getAllDecisions({ limit: 1 });
  const engine = new CounterfactualEngine(tracer);
  const result = engine.generateWhatIfReport(decisions[0]);

  assert.strictEqual(result.whatIfScenarios.length, 0);
  assert.strictEqual(result.recommendations.bestMissedOpportunity, null);
  assert.strictEqual(result.recommendations.bestRiskAvoided, null);
});

// ---------------------------------------------------------------------------
// getAnalysis
// ---------------------------------------------------------------------------

test('getAnalysis retrieves cached analysis by ID', () => {
  const tracer = seededTracer();
  const decisions = tracer.getAllDecisions({ limit: 10 });
  const grepDecision = decisions.find((d) => d.outcome && d.outcome.chosen === 'Grep');

  const engine = new CounterfactualEngine(tracer);
  const report = engine.generateWhatIfReport(grepDecision);

  const retrieved = engine.getAnalysis(report.reportId);
  assert.ok(retrieved);
  assert.strictEqual(retrieved.reportId, report.reportId);
});

test('getAnalysis returns undefined for unknown ID', () => {
  const tracer = new DecisionTracer();
  const engine = new CounterfactualEngine(tracer);

  const result = engine.getAnalysis('nonexistent-id');
  assert.strictEqual(result, undefined);
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

test('reset clears all cached analyses', () => {
  const tracer = seededTracer();
  const decisions = tracer.getAllDecisions({ limit: 10 });
  const grepDecision = decisions.find((d) => d.outcome && d.outcome.chosen === 'Grep');

  const engine = new CounterfactualEngine(tracer);
  const report = engine.generateWhatIfReport(grepDecision);

  assert.ok(engine.getAnalysis(report.reportId));

  engine.reset();

  assert.strictEqual(engine.getAnalysis(report.reportId), undefined);
});

// ---------------------------------------------------------------------------
// Multi-session pivotal decision
// ---------------------------------------------------------------------------

test('findPivotalDecision works across sessions with different characteristics', () => {
  const tracer = seededTracer();
  const engine = new CounterfactualEngine(tracer);

  const result1 = engine.findPivotalDecision('sess-main');
  const result2 = engine.findPivotalDecision('sess-2');

  assert.ok(result1.totalDecisions > 0);
  assert.ok(result2.totalDecisions > 0);
  // sess-main has more decisions with higher variety, so pivotal score should differ
  assert.ok(
    typeof result1.pivotalDecision.pivotalScore === 'number' &&
    typeof result2.pivotalDecision.pivotalScore === 'number'
  );
});
