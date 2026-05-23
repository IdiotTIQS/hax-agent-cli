'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { DecisionTracer, createTracer } = require('../../src/explain/tracer');
const { ExplainabilityReport } = require('../../src/explain/report');

// ---------------------------------------------------------------------------
// Helper: create a tracer with sample decisions
// ---------------------------------------------------------------------------

/**
 * Create a tracer instance pre-populated with diverse decisions.
 * @returns {DecisionTracer}
 */
function seededTracer() {
  const tracer = new DecisionTracer();

  tracer.traceToolSelection('agent-1', 'Find auth bug', ['Read', 'Grep', 'Bash'], 'Grep', {
    sessionId: 'sess-1',
    rationale: 'Grep is fastest for pattern matching across files.',
    confidence: 0.85,
    outcome: { success: true, result: 'Found 3 matches' },
  });

  tracer.traceResponsePath('agent-1', 'How to fix?', [
    { id: 'refactor', description: 'Full refactor', score: 0.8, pros: ['clean'], cons: ['slow'] },
    { id: 'patch', description: 'Quick patch', score: 0.6, pros: ['fast'], cons: ['fragile'] },
  ], 'refactor', {
    sessionId: 'sess-1',
    rationale: 'Permanent fix preferred over quick patch.',
    confidence: 0.7,
    outcome: { success: true, result: 'Refactored auth module' },
  });

  tracer.traceErrorRecovery('agent-1', 'timeout on Bash', ['retry', 'skip', 'abort'], 'retry', {
    sessionId: 'sess-1',
    rationale: 'Transient timeout; retrying.',
    confidence: 0.6,
    outcome: { success: false, result: 'Still timed out' },
  });

  tracer.traceToolSelection('agent-1', 'Read config', ['Read', 'Glob'], 'Read', {
    sessionId: 'sess-1',
    rationale: 'Direct file read is most efficient.',
    confidence: 0.9,
    outcome: { success: true, result: 'Config loaded' },
  });

  tracer.traceToolSelection('agent-2', 'Deploy release', ['Bash', 'Write'], 'Bash', {
    sessionId: 'sess-2',
    rationale: 'Shell commands for deployment scripts.',
    confidence: 0.65,
    outcome: { success: true, result: 'Deployed' },
  });

  tracer.traceResponsePath('agent-2', 'Review strategy?', ['code-review', 'manual-test', 'both'], 'code-review', {
    sessionId: 'sess-2',
    confidence: 0.55,
    outcome: { success: true, result: 'Review complete' },
  });

  return tracer;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

test('ExplainabilityReport constructs with a tracer', () => {
  const tracer = new DecisionTracer();
  const report = new ExplainabilityReport(tracer);
  assert.ok(report instanceof ExplainabilityReport);
});

test('ExplainabilityReport throws without a tracer', () => {
  assert.throws(() => new ExplainabilityReport(null), {
    message: /requires a DecisionTracer instance/,
  });
});

test('ExplainabilityReport throws with invalid tracer', () => {
  assert.throws(() => new ExplainabilityReport({ notATracer: true }), {
    message: /requires a DecisionTracer instance/,
  });
});

test('ExplainabilityReport accepts format option', () => {
  const tracer = new DecisionTracer();
  const report = new ExplainabilityReport(tracer, { defaultFormat: 'markdown' });
  assert.ok(report instanceof ExplainabilityReport);
});

// ---------------------------------------------------------------------------
// generateSessionReport
// ---------------------------------------------------------------------------

test('generateSessionReport produces text report for a session', () => {
  const tracer = seededTracer();
  const report = new ExplainabilityReport(tracer);
  const result = report.generateSessionReport('sess-1');

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('sess-1'));
  assert.ok(result.includes('Total Decisions'));
  assert.ok(result.includes('Decision Timeline'));
  assert.ok(result.includes('Decision Patterns'));
});

test('generateSessionReport handles empty session gracefully', () => {
  const tracer = new DecisionTracer();
  const report = new ExplainabilityReport(tracer);
  const result = report.generateSessionReport('no-such-session');

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('no-such-session'));
  assert.ok(result.includes('No decisions'));
});

test('generateSessionReport json format returns structured object', () => {
  const tracer = seededTracer();
  const report = new ExplainabilityReport(tracer);
  const result = report.generateSessionReport('sess-1', { format: 'json' });

  assert.strictEqual(typeof result, 'object');
  assert.strictEqual(result.sessionId, 'sess-1');
  assert.ok(Array.isArray(result.timeline));
  assert.ok(result.timeline.length >= 4);
  assert.ok(Array.isArray(result.patterns));
});

test('generateSessionReport markdown format includes markdown syntax', () => {
  const tracer = seededTracer();
  const report = new ExplainabilityReport(tracer);
  const result = report.generateSessionReport('sess-1', { format: 'markdown' });

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('# Explainability Report'));
  assert.ok(result.includes('|'));
  assert.ok(result.includes('##'));
});

// ---------------------------------------------------------------------------
// generateDecisionReport
// ---------------------------------------------------------------------------

test('generateDecisionReport provides deep-dive on a single decision', () => {
  const tracer = seededTracer();
  const allDecisions = tracer.getAllDecisions({ limit: 10 });
  const targetId = allDecisions[0].id;

  const report = new ExplainabilityReport(tracer);
  const result = report.generateDecisionReport(targetId);

  assert.ok(typeof result === 'string');
  assert.ok(result.includes(targetId));
  assert.ok(result.includes('Quality Assessment'));
  assert.ok(result.includes('Context'));
});

test('generateDecisionReport handles missing decision', () => {
  const tracer = seededTracer();
  const report = new ExplainabilityReport(tracer);
  const result = report.generateDecisionReport('nonexistent-dec');

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('not found'));
});

test('generateDecisionReport json format includes quality and context', () => {
  const tracer = seededTracer();
  const allDecisions = tracer.getAllDecisions({ limit: 10 });
  const targetId = allDecisions[0].id;

  const report = new ExplainabilityReport(tracer);
  const result = report.generateDecisionReport(targetId, { format: 'json' });

  assert.strictEqual(typeof result, 'object');
  assert.strictEqual(result.decisionId, targetId);
  assert.ok(typeof result.sessionId === 'string');
  assert.ok(result.decision);
  assert.ok(result.quality);
  assert.ok(typeof result.quality.score === 'number');
  assert.ok(typeof result.quality.level === 'string');
  assert.ok(Array.isArray(result.quality.factors));
  assert.ok(result.context);
});

// ---------------------------------------------------------------------------
// generateSummaryReport
// ---------------------------------------------------------------------------

test('generateSummaryReport aggregates across all sessions', () => {
  const tracer = seededTracer();
  const report = new ExplainabilityReport(tracer);
  const result = report.generateSummaryReport(undefined, { format: 'json' });

  assert.strictEqual(typeof result, 'object');
  assert.strictEqual(result.sessionsAnalyzed, 2);
  assert.strictEqual(result.totalDecisions, 6);
  assert.ok(result.overall);
  assert.ok(result.overall.typeBreakdown);
  assert.ok(Array.isArray(result.sessionSummaries));
  assert.strictEqual(result.sessionSummaries.length, 2);
  assert.ok(Array.isArray(result.patterns));
});

test('generateSummaryReport handles specific session list', () => {
  const tracer = seededTracer();
  const report = new ExplainabilityReport(tracer);
  const result = report.generateSummaryReport(['sess-1'], { format: 'json' });

  assert.strictEqual(result.sessionsAnalyzed, 1);
  assert.strictEqual(result.totalDecisions, 4);
});

test('generateSummaryReport handles empty tracer', () => {
  const tracer = new DecisionTracer();
  const report = new ExplainabilityReport(tracer);
  const result = report.generateSummaryReport(undefined, { format: 'json' });

  assert.ok(result.empty);
  assert.ok(result.message.includes('No sessions'));
});

// ---------------------------------------------------------------------------
// identifyDecisionPatterns
// ---------------------------------------------------------------------------

test('identifyDecisionPatterns detects type distribution patterns', () => {
  const tracer = seededTracer();
  const report = new ExplainabilityReport(tracer);
  const patterns = report.identifyDecisionPatterns();

  assert.ok(Array.isArray(patterns));
  assert.ok(patterns.length > 0);

  const typePattern = patterns.find((p) => p.type && p.type.startsWith('decision_type:'));
  assert.ok(typePattern, 'Should detect decision type patterns');
  assert.ok(typeof typePattern.count === 'number');
  assert.ok(typeof typePattern.percentage === 'number');
});

test('identifyDecisionPatterns detects tool sequences', () => {
  const tracer = seededTracer();
  // Add a clear sequential tool pattern
  tracer.traceToolSelection('ag', 'task A', ['Read', 'Edit'], 'Read', { sessionId: 'seq-test' });
  tracer.traceToolSelection('ag', 'task B', ['Edit', 'Write'], 'Edit', { sessionId: 'seq-test' });
  tracer.traceToolSelection('ag', 'task C', ['Read', 'Edit'], 'Read', { sessionId: 'seq-test' });
  tracer.traceToolSelection('ag', 'task D', ['Edit', 'Write'], 'Edit', { sessionId: 'seq-test' });

  const report = new ExplainabilityReport(tracer);
  const patterns = report.identifyDecisionPatterns();

  const seqPattern = patterns.find((p) => p.type === 'tool_sequence');
  assert.ok(seqPattern, 'Should detect tool sequence patterns');
  assert.ok(seqPattern.description.includes('->'));
});

test('identifyDecisionPatterns works with provided decision array', () => {
  const tracer = seededTracer();
  const decisions = tracer.getAllDecisions({ limit: 5 });

  const report = new ExplainabilityReport(tracer);
  const patterns = report.identifyDecisionPatterns(decisions);

  assert.ok(Array.isArray(patterns));
  assert.ok(patterns.length > 0);
});

// ---------------------------------------------------------------------------
// evaluateDecisionQuality
// ---------------------------------------------------------------------------

test('evaluateDecisionQuality returns full assessment for a good decision', () => {
  const tracer = seededTracer();
  const decisions = tracer.getAllDecisions({ limit: 10 });
  // Find a successful tool selection with good rationale
  const goodDecision = decisions.find(
    (d) => d.type === 'tool_selection' && d.outcome && d.outcome.success === true
  );

  const report = new ExplainabilityReport(tracer);
  const quality = report.evaluateDecisionQuality(goodDecision, goodDecision.outcome);

  assert.ok(typeof quality.score === 'number');
  assert.ok(quality.score >= 0 && quality.score <= 1);
  assert.ok(typeof quality.level === 'string');
  assert.ok(quality.factors.length >= 3);
  // A good decision should score well
  assert.ok(quality.score >= 0.5, `Expected score >= 0.5, got ${quality.score}`);
});

test('evaluateDecisionQuality gives lower score for failed decisions with high confidence', () => {
  const report = new ExplainabilityReport(new DecisionTracer());
  const badDecision = {
    id: 'test-bad',
    type: 'error_recovery',
    alternatives: [{ id: 'r1' }, { id: 'r2' }],
    rationale: 'quick fix',
    confidence: 0.95,
    outcome: { success: false },
  };

  const quality = report.evaluateDecisionQuality(badDecision, badDecision.outcome);
  // High confidence + failure should have reduced score due to confidence alignment penalty
  const alignFactor = quality.factors.find((f) => f.factor === 'confidence_alignment');
  assert.ok(alignFactor);
  assert.strictEqual(alignFactor.score, 0, 'Overconfident failure should get 0 on alignment');
});

test('evaluateDecisionQuality handles missing data gracefully', () => {
  const report = new ExplainabilityReport(new DecisionTracer());
  const quality = report.evaluateDecisionQuality(null, null);

  assert.strictEqual(quality.score, 0);
  assert.strictEqual(quality.level, 'unknown');
});

// ---------------------------------------------------------------------------
// Export formats
// ---------------------------------------------------------------------------

test('export method respects format parameter', () => {
  const tracer = seededTracer();
  const report = new ExplainabilityReport(tracer);
  const data = { sessionId: 'test', summary: { totalDecisions: 1 } };

  const textResult = report.export(data, 'text');
  assert.ok(typeof textResult === 'string');

  const mdResult = report.export(data, 'markdown');
  assert.ok(typeof mdResult === 'string');
  assert.ok(mdResult.includes('#'));

  const jsonResult = report.export(data, 'json');
  assert.strictEqual(typeof jsonResult, 'object');
});

test('default format is used when export format not specified', () => {
  const tracer = seededTracer();
  const report = new ExplainabilityReport(tracer, { defaultFormat: 'markdown' });
  const data = { sessionId: 'test', summary: { totalDecisions: 1 } };

  const result = report.export(data);
  assert.ok(typeof result === 'string');
  assert.ok(result.includes('#'));
});
