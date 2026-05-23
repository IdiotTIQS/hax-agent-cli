'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  DecisionTracer,
  createTracer,
  DECISION_TYPES,
} = require('../../src/explain/tracer');

// ---------------------------------------------------------------------------
// DecisionTracer construction
// ---------------------------------------------------------------------------

test('DecisionTracer constructs with defaults', () => {
  const tracer = new DecisionTracer();
  assert.strictEqual(tracer.getTotalDecisions(), 0);
  assert.strictEqual(tracer.getSessionCount(), 0);
  assert.deepStrictEqual(tracer.getSessionIds(), []);
});

test('DecisionTracer can be disabled', () => {
  const tracer = new DecisionTracer({ enabled: false });
  const result = tracer.traceDecision('agent-1', { task: 'test' }, {}, 'choice-a');
  assert.strictEqual(result, null);
  assert.strictEqual(tracer.getTotalDecisions(), 0);
});

test('createTracer factory returns DecisionTracer instance', () => {
  const tracer = createTracer({ maxDecisionsPerSession: 500 });
  assert.ok(tracer instanceof DecisionTracer);
});

// ---------------------------------------------------------------------------
// traceDecision — generic decision recording
// ---------------------------------------------------------------------------

test('traceDecision records a generic decision with correct fields', () => {
  const tracer = new DecisionTracer();
  const result = tracer.traceDecision(
    'agent-1',
    { task: 'investigate bug', constraints: ['time < 5min'] },
    {
      sessionId: 'session-A',
      alternatives: [
        { id: 'opt1', description: 'Read file', score: 0.7, pros: ['fast'], cons: ['shallow'] },
        { id: 'opt2', description: 'Run full scan', score: 0.3, pros: ['thorough'], cons: ['slow'] },
      ],
      rationale: 'Reading the file is faster and sufficient for this bug.',
      confidence: 0.8,
      outcome: { chosen: 'opt1', success: true, result: 'Bug found in auth.js' },
      metadata: { priority: 'high' },
    },
    undefined
  );

  assert.ok(result);
  assert.ok(typeof result.id === 'string' && result.id.startsWith('dec_'));
  assert.ok(typeof result.timestamp === 'string');
  assert.strictEqual(result.sessionId, 'session-A');
  assert.strictEqual(result.type, DECISION_TYPES.GENERAL);
  assert.strictEqual(result.agentId, 'agent-1');
  assert.strictEqual(result.alternatives.length, 2);
  assert.strictEqual(result.alternatives[0].id, 'opt1');
  assert.strictEqual(result.alternatives[0].score, 0.7);
  assert.deepStrictEqual(result.alternatives[1].cons, ['slow']);
  assert.ok(result.rationale.includes('Reading the file'));
  assert.strictEqual(result.confidence, 0.8);
  assert.strictEqual(result.confidenceLabel, 'very_high');
  assert.strictEqual(result.outcome.chosen, 'opt1');
  assert.strictEqual(result.outcome.success, true);
  assert.strictEqual(result.outcome.result, 'Bug found in auth.js');
  assert.strictEqual(result.metadata.priority, 'high');
});

test('traceDecision uses decision shorthand for outcome.chosen', () => {
  const tracer = new DecisionTracer();
  const result = tracer.traceDecision(
    'agent-2',
    { task: 'pick' },
    { sessionId: 's1' },
    'my-choice'
  );

  assert.strictEqual(result.outcome.chosen, 'my-choice');
});

test('traceDecision auto-generates sessionId when omitted', () => {
  const tracer = new DecisionTracer();
  const result = tracer.traceDecision('agent-3', {}, {}, 'choice');
  assert.ok(typeof result.sessionId === 'string');
  assert.ok(result.sessionId.startsWith('session_'));
});

// ---------------------------------------------------------------------------
// traceToolSelection
// ---------------------------------------------------------------------------

test('traceToolSelection records tool selection with rationale', () => {
  const tracer = new DecisionTracer();
  const result = tracer.traceToolSelection(
    'agent-4',
    'Find the source of a null pointer',
    ['Read', 'Grep', 'Bash', 'Glob'],
    'Grep',
    {
      sessionId: 'session-B',
      rationale: 'Grep is best for searching patterns across files.',
      confidence: 0.9,
    }
  );

  assert.strictEqual(result.type, DECISION_TYPES.TOOL_SELECTION);
  assert.strictEqual(result.outcome.chosen, 'Grep');
  assert.strictEqual(result.context.task, 'Find the source of a null pointer');
  assert.strictEqual(result.context.availableToolCount, 4);
  assert.strictEqual(result.alternatives.length, 4);
  assert.strictEqual(result.alternatives[1].id, 'Grep');
  assert.strictEqual(result.alternatives[1].score, 0.9);
  assert.strictEqual(result.confidence, 0.9);
});

test('traceToolSelection handles object-style availableTools', () => {
  const tracer = new DecisionTracer();
  const result = tracer.traceToolSelection(
    'agent-5',
    'edit config',
    [
      { name: 'read_file', description: 'Read a file', score: 0.5, pros: ['safe'], cons: ['read-only'] },
      { name: 'edit_file', description: 'Edit a file', score: 0.9, pros: ['powerful'], cons: ['risky'] },
    ],
    'edit_file',
    { sessionId: 'sess-1' }
  );

  assert.strictEqual(result.alternatives.length, 2);
  assert.strictEqual(result.alternatives[1].description, 'Edit a file');
  assert.deepStrictEqual(result.alternatives[1].pros, ['powerful']);
  assert.deepStrictEqual(result.alternatives[1].cons, ['risky']);
});

// ---------------------------------------------------------------------------
// traceResponsePath
// ---------------------------------------------------------------------------

test('traceResponsePath records response path selection', () => {
  const tracer = new DecisionTracer();
  const result = tracer.traceResponsePath(
    'agent-6',
    'How should I fix the memory leak?',
    [
      { id: 'refactor', description: 'Refactor the module', score: 0.8, pros: ['clean'], cons: ['slow'] },
      { id: 'patch', description: 'Apply quick patch', score: 0.6, pros: ['fast'], cons: ['fragile'] },
    ],
    'refactor',
    {
      sessionId: 'session-C',
      rationale: 'Refactoring provides a permanent fix.',
      confidence: 0.75,
    }
  );

  assert.strictEqual(result.type, DECISION_TYPES.RESPONSE_PATH);
  assert.strictEqual(result.context.prompt, 'How should I fix the memory leak?');
  assert.strictEqual(result.alternatives.length, 2);
  assert.strictEqual(result.outcome.chosen, 'refactor');
  assert.strictEqual(result.confidenceLabel, 'high');
});

test('traceResponsePath works with string-only possiblePaths', () => {
  const tracer = new DecisionTracer();
  const result = tracer.traceResponsePath(
    'agent-7',
    'debug issue',
    ['approach-a', 'approach-b', 'approach-c'],
    'approach-b',
    { sessionId: 's2' }
  );

  assert.strictEqual(result.alternatives.length, 3);
  assert.strictEqual(result.outcome.chosen, 'approach-b');
  // The chosen path should have a higher score
  const chosenAlt = result.alternatives.find((a) => a.id === 'approach-b');
  assert.ok(chosenAlt.score > 0.8);
});

// ---------------------------------------------------------------------------
// traceErrorRecovery
// ---------------------------------------------------------------------------

test('traceErrorRecovery records error recovery strategy choice', () => {
  const tracer = new DecisionTracer();
  const result = tracer.traceErrorRecovery(
    'agent-8',
    new Error('Connection refused: port 5432'),
    [
      { id: 'retry', description: 'Retry with backoff', score: 0.95, pros: ['simple'], cons: ['may fail again'] },
      { id: 'skip', description: 'Skip this step', score: 0.3, pros: ['fast'], cons: ['incomplete'] },
      { id: 'ask', description: 'Ask user for help', score: 0.5, pros: ['safe'], cons: ['slow'] },
    ],
    'retry',
    {
      sessionId: 'session-D',
      rationale: 'Connection errors are often transient; retrying with exponential backoff.',
      confidence: 0.85,
      outcome: { success: true, result: 'Connection established on retry 2' },
    }
  );

  assert.strictEqual(result.type, DECISION_TYPES.ERROR_RECOVERY);
  assert.ok(result.context.error.includes('Connection refused'));
  assert.strictEqual(result.context.strategyCount, 3);
  assert.strictEqual(result.alternatives.length, 3);
  assert.strictEqual(result.outcome.chosen, 'retry');
  assert.strictEqual(result.outcome.success, true);
  assert.strictEqual(result.outcome.result, 'Connection established on retry 2');
});

test('traceErrorRecovery handles string error and strategies', () => {
  const tracer = new DecisionTracer();
  const result = tracer.traceErrorRecovery(
    'agent-9',
    'timeout: operation exceeded 30s',
    ['retry', 'fallback', 'abort'],
    'retry',
    { sessionId: 's3' }
  );

  assert.strictEqual(result.alternatives.length, 3);
  assert.strictEqual(result.alternatives[0].id, 'retry');
  assert.strictEqual(result.context.error, 'timeout: operation exceeded 30s');
});

// ---------------------------------------------------------------------------
// getDecisionTree
// ---------------------------------------------------------------------------

test('getDecisionTree returns chronological decision tree', () => {
  const tracer = new DecisionTracer();

  tracer.traceToolSelection('a1', 'task1', ['t1', 't2'], 't1', { sessionId: 'tree-test' });
  tracer.traceResponsePath('a1', 'prompt1', ['p1', 'p2'], 'p1', { sessionId: 'tree-test' });
  tracer.traceErrorRecovery('a1', 'err1', ['r1', 'r2'], 'r1', { sessionId: 'tree-test' });

  const tree = tracer.getDecisionTree('tree-test');

  assert.strictEqual(tree.sessionId, 'tree-test');
  assert.strictEqual(tree.totalDecisions, 3);
  assert.ok(tree.startTime);
  assert.ok(tree.endTime);
  assert.strictEqual(tree.decisions.length, 3);

  // Verify chronological ordering
  const times = tree.decisions.map((d) => new Date(d.timestamp).getTime());
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] >= times[i - 1], 'Decisions should be in chronological order');
  }

  // Verify summary
  assert.ok(tree.summary.typeBreakdown);
  assert.ok('tool_selection' in tree.summary.typeBreakdown);
  assert.ok('response_path' in tree.summary.typeBreakdown);
  assert.ok('error_recovery' in tree.summary.typeBreakdown);
});

test('getDecisionTree returns empty tree for unknown session', () => {
  const tracer = new DecisionTracer();
  const tree = tracer.getDecisionTree('nonexistent');

  assert.strictEqual(tree.sessionId, 'nonexistent');
  assert.strictEqual(tree.totalDecisions, 0);
  assert.strictEqual(tree.startTime, null);
  assert.strictEqual(tree.endTime, null);
  assert.strictEqual(tree.decisions.length, 0);
});

// ---------------------------------------------------------------------------
// getAllDecisions and querying
// ---------------------------------------------------------------------------

test('getAllDecisions filters by type and agentId', () => {
  const tracer = new DecisionTracer();

  tracer.traceToolSelection('agent-A', 't1', ['a', 'b'], 'a', { sessionId: 's1' });
  tracer.traceResponsePath('agent-A', 'p1', ['x', 'y'], 'x', { sessionId: 's1' });
  tracer.traceToolSelection('agent-B', 't2', ['c', 'd'], 'c', { sessionId: 's2' });

  const toolOnly = tracer.getAllDecisions({ type: 'tool_selection', limit: 10 });
  assert.strictEqual(toolOnly.length, 2);
  assert.ok(toolOnly.every((d) => d.type === 'tool_selection'));

  const agentBOnly = tracer.getAllDecisions({ agentId: 'agent-B', limit: 10 });
  assert.strictEqual(agentBOnly.length, 1);
  assert.strictEqual(agentBOnly[0].agentId, 'agent-B');
});

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

test('getSessionIds returns all tracked session IDs', () => {
  const tracer = new DecisionTracer();
  tracer.traceDecision('a', {}, { sessionId: 'alpha' }, 'x');
  tracer.traceDecision('b', {}, { sessionId: 'beta' }, 'y');
  tracer.traceDecision('c', {}, { sessionId: 'alpha' }, 'z');

  const ids = tracer.getSessionIds();
  assert.strictEqual(ids.length, 2);
  assert.ok(ids.includes('alpha'));
  assert.ok(ids.includes('beta'));
});

test('clearSession removes decisions for that session', () => {
  const tracer = new DecisionTracer();
  tracer.traceDecision('a', {}, { sessionId: 'keep' }, 'x');
  tracer.traceDecision('b', {}, { sessionId: 'remove' }, 'y');
  tracer.traceDecision('c', {}, { sessionId: 'remove' }, 'z');

  assert.strictEqual(tracer.getTotalDecisions(), 3);

  tracer.clearSession('remove');

  assert.strictEqual(tracer.getTotalDecisions(), 1);
  assert.strictEqual(tracer.getSessionIds().length, 1);
  assert.ok(tracer.getSessionIds().includes('keep'));
});

test('reset clears all decisions', () => {
  const tracer = new DecisionTracer();
  tracer.traceDecision('a', {}, { sessionId: 's1' }, 'x');
  tracer.traceDecision('b', {}, { sessionId: 's2' }, 'y');

  assert.strictEqual(tracer.getTotalDecisions(), 2);

  tracer.reset();

  assert.strictEqual(tracer.getTotalDecisions(), 0);
  assert.strictEqual(tracer.getSessionCount(), 0);
});

// ---------------------------------------------------------------------------
// Integrity hashes
// ---------------------------------------------------------------------------

test('decisions include integrity hash by default', () => {
  const tracer = new DecisionTracer();
  const result = tracer.traceDecision('agent-h', { task: 'test' }, { sessionId: 'h1' }, 'choice');

  assert.ok(typeof result.hash === 'string');
  assert.strictEqual(result.hash.length, 16);
});

test('integrity hashes can be disabled', () => {
  const tracer = new DecisionTracer({ computeHashes: false });
  const result = tracer.traceDecision('agent-nh', {}, { sessionId: 'nh1' }, 'x');

  assert.strictEqual(result.hash, undefined);
});

// ---------------------------------------------------------------------------
// Confidence edge cases
// ---------------------------------------------------------------------------

test('confidence is clamped to 0-1 range', () => {
  const tracer = new DecisionTracer();

  const high = tracer.traceDecision('a', {}, { sessionId: 'c1', confidence: 2.5 }, 'x');
  assert.strictEqual(high.confidence, 1);

  const low = tracer.traceDecision('b', {}, { sessionId: 'c2', confidence: -0.5 }, 'y');
  assert.strictEqual(low.confidence, 0);

  const nan = tracer.traceDecision('c', {}, { sessionId: 'c3', confidence: NaN }, 'z');
  assert.strictEqual(nan.confidence, 0.5);
});

test('confidenceLabel returns correct levels', () => {
  const tracer = new DecisionTracer();

  const cases = [
    { value: 0.9, label: 'very_high' },
    { value: 0.7, label: 'high' },
    { value: 0.5, label: 'moderate' },
    { value: 0.3, label: 'low' },
    { value: 0.1, label: 'very_low' },
  ];

  for (const c of cases) {
    const r = tracer.traceDecision('a', {}, { sessionId: 'cl', confidence: c.value }, 'x');
    assert.strictEqual(r.confidenceLabel, c.label, `Expected ${c.label} for ${c.value}`);
  }
});
