/**
 * Tests for ReplayDiffAnalyzer.
 */
"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');
const { ReplayDiffAnalyzer } = require('../../src/replay/diff-analyzer');

// ── helpers ─────────────────────────────────────────────────────────────

function makeEvent(type, data, timestamp) {
  return {
    type,
    timestamp: timestamp || new Date(Date.now() + Math.random() * 1000).toISOString(),
    data: data !== undefined ? data : null,
    context: {},
  };
}

function makeSession(events, meta = {}) {
  return {
    version: 1,
    metadata: {
      id: meta.id || 'session-test',
      sessionId: meta.sessionId || 'sess-1',
      provider: meta.provider || 'anthropic',
      model: meta.model || 'claude-sonnet-4-20250514',
      recordingStartedAt: new Date().toISOString(),
      ...meta,
    },
    events,
    startTime: events.length > 0 ? events[0].timestamp : null,
    endTime: events.length > 0 ? events[events.length - 1].timestamp : null,
  };
}

// ── constructor ─────────────────────────────────────────────────────────

test('ReplayDiffAnalyzer: constructs with options', () => {
  const analyzer = new ReplayDiffAnalyzer({ verbose: true });
  assert.ok(analyzer instanceof ReplayDiffAnalyzer);
});

test('ReplayDiffAnalyzer: constructs with no options', () => {
  const analyzer = new ReplayDiffAnalyzer();
  assert.ok(analyzer instanceof ReplayDiffAnalyzer);
});

// ── compareSessions ─────────────────────────────────────────────────────

test('ReplayDiffAnalyzer: compareSessions handles identical sessions', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const events = [
    makeEvent('user_message', 'hello'),
    makeEvent('assistant_response', 'hi'),
    makeEvent('tool_call', { tool: 'search', input: 'q' }),
  ];
  const a = makeSession(events);
  const b = makeSession([...events]);

  const result = analyzer.compareSessions(a, b);

  assert.equal(result.totalEvents.a, 3);
  assert.equal(result.totalEvents.b, 3);
  assert.equal(result.totalEvents.delta, 0);
  assert.equal(result.similarity.score, 100);
  assert.equal(result.similarity.description, 'nearly identical');
  assert.equal(result.errorCount.a, 0);
  assert.equal(result.errorCount.b, 0);
  assert.deepEqual(result.toolUsage.common, ['search']);
  assert.equal(result.toolUsage.onlyInA.length, 0);
  assert.equal(result.toolUsage.onlyInB.length, 0);
});

test('ReplayDiffAnalyzer: compareSessions detects type count differences', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const a = makeSession([
    makeEvent('user_message', 'q1'),
    makeEvent('assistant_response', 'a1'),
  ]);
  const b = makeSession([
    makeEvent('user_message', 'q1'),
    makeEvent('assistant_response', 'a1'),
    makeEvent('tool_call', { tool: 'search' }),
    makeEvent('tool_result', { result: 'x' }),
  ]);

  const result = analyzer.compareSessions(a, b);

  assert.equal(result.totalEvents.a, 2);
  assert.equal(result.totalEvents.b, 4);
  assert.equal(result.totalEvents.delta, 2);
  assert.equal(result.typeDiffs.tool_call.a, 0);
  assert.equal(result.typeDiffs.tool_call.b, 1);
  assert.equal(result.typeDiffs.tool_call.delta, 1);
});

test('ReplayDiffAnalyzer: compareSessions compares metadata', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const a = makeSession([], { provider: 'anthropic', model: 'claude-sonnet-4' });
  const b = makeSession([], { provider: 'openai', model: 'gpt-4' });

  const result = analyzer.compareSessions(a, b);

  assert.equal(result.metadataDiff.sameProvider, false);
  assert.equal(result.metadataDiff.sameModel, false);
  assert.equal(result.metadataDiff.providerA, 'anthropic');
  assert.equal(result.metadataDiff.providerB, 'openai');
  assert.equal(result.metadataDiff.modelA, 'claude-sonnet-4');
  assert.equal(result.metadataDiff.modelB, 'gpt-4');
});

test('ReplayDiffAnalyzer: compareSessions tracks tool usage differences', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const a = makeSession([
    makeEvent('tool_call', { tool: 'search' }),
    makeEvent('tool_call', { tool: 'file_edit' }),
  ]);
  const b = makeSession([
    makeEvent('tool_call', { tool: 'search' }),
    makeEvent('tool_call', { tool: 'file_write' }),
    makeEvent('tool_call', { tool: 'file_delete' }),
  ]);

  const result = analyzer.compareSessions(a, b);

  assert.deepEqual(result.toolUsage.common, ['search']);
  assert.deepEqual(result.toolUsage.onlyInA, ['file_edit']);
  assert.deepEqual(result.toolUsage.onlyInB, ['file_write', 'file_delete']);
  assert.equal(result.toolUsage.totalCallsA, 2);
  assert.equal(result.toolUsage.totalCallsB, 3);
});

test('ReplayDiffAnalyzer: compareSessions handles empty sessions', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const a = makeSession([]);
  const b = makeSession([]);

  const result = analyzer.compareSessions(a, b);
  assert.equal(result.totalEvents.a, 0);
  assert.equal(result.totalEvents.b, 0);
  assert.equal(result.similarity.score, 100);
  assert.equal(result.similarity.description, 'identical (both empty)');
  assert.equal(result.turns.countA, 0);
  assert.equal(result.turns.countB, 0);
});

test('ReplayDiffAnalyzer: compareSessions throws for invalid inputs', () => {
  const analyzer = new ReplayDiffAnalyzer();
  assert.throws(() => analyzer.compareSessions(null, {}), /sessionA must be an object/);
  assert.throws(() => analyzer.compareSessions({ events: [] }, null), /sessionB must be an object/);
  assert.throws(() => analyzer.compareSessions({ events: 'bad' }, { events: [] }), /sessionA must be an object/);
});

// ── findDivergencePoints ────────────────────────────────────────────────

test('ReplayDiffAnalyzer: findDivergencePoints detects type mismatch', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const a = makeSession([
    makeEvent('user_message', 'hello'),
    makeEvent('assistant_response', 'hi'),
    makeEvent('tool_call', { tool: 'search' }),
  ]);
  const b = makeSession([
    makeEvent('user_message', 'hello'),
    makeEvent('assistant_response', 'hi'),
    makeEvent('error', { message: 'crash' }),
  ]);

  const result = analyzer.findDivergencePoints(a, b);

  assert.equal(result.sessionsIdentical, false);
  assert.equal(result.totalDivergences, 1);
  assert.equal(result.firstDivergence.index, 2);
  assert.equal(result.firstDivergence.type, 'type_mismatch');
  assert.equal(result.firstDivergence.typeA, 'tool_call');
  assert.equal(result.firstDivergence.typeB, 'error');
  assert.equal(result.commonPrefixLength, 2);
});

test('ReplayDiffAnalyzer: findDivergencePoints detects data divergence', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const a = makeSession([
    makeEvent('user_message', 'question A'),
    makeEvent('assistant_response', 'answer A'),
  ]);
  const b = makeSession([
    makeEvent('user_message', 'question A'),
    makeEvent('assistant_response', 'answer DIFFERENT'),
  ]);

  const result = analyzer.findDivergencePoints(a, b);

  assert.equal(result.sessionsIdentical, false);
  assert.equal(result.totalDivergences, 1);
  assert.equal(result.firstDivergence.type, 'data_divergence');
  assert.equal(result.firstDivergence.index, 1);
  assert.equal(result.commonPrefixLength, 1);
});

test('ReplayDiffAnalyzer: findDivergencePoints detects length differences', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const a = makeSession([
    makeEvent('user_message', 'q'),
    makeEvent('assistant_response', 'a'),
  ]);
  const b = makeSession([
    makeEvent('user_message', 'q'),
    makeEvent('assistant_response', 'a'),
    makeEvent('user_message', 'q2'),
    makeEvent('assistant_response', 'a2'),
  ]);

  const result = analyzer.findDivergencePoints(a, b);

  assert.equal(result.sessionsIdentical, false);
  assert.equal(result.lengthDiff.type, 'length_difference');
  assert.equal(result.lengthDiff.aLength, 2);
  assert.equal(result.lengthDiff.bLength, 4);
  assert.equal(result.lengthDiff.delta, 2);
  assert.equal(result.lengthDiff.extraEventsIn, 'B');
  assert.equal(result.lengthDiff.extraCount, 2);
  assert.equal(result.totalDivergences, 0); // No type/data divergence within common prefix
});

test('ReplayDiffAnalyzer: findDivergencePoints returns identical for same sessions', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const events = [
    makeEvent('user_message', 'hello'),
    makeEvent('assistant_response', 'world'),
  ];
  const a = makeSession(events);
  const b = makeSession([...events]);

  const result = analyzer.findDivergencePoints(a, b);

  assert.equal(result.sessionsIdentical, true);
  assert.equal(result.totalDivergences, 0);
  assert.equal(result.commonPrefixLength, 2);
  assert.equal(result.lengthDiff, null);
});

test('ReplayDiffAnalyzer: findDivergencePoints finds multiple divergences', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const a = makeSession([
    makeEvent('user_message', 'q1'),
    makeEvent('assistant_response', 'a1'),
    makeEvent('user_message', 'q2'),
    makeEvent('assistant_response', 'a2'),
  ]);
  const b = makeSession([
    makeEvent('user_message', 'q1'),
    makeEvent('assistant_response', 'wrong'),
    makeEvent('tool_call', { tool: 'search' }),
    makeEvent('tool_result', { result: 'x' }),
  ]);

  const result = analyzer.findDivergencePoints(a, b);

  assert.equal(result.totalDivergences, 3);
  // First: index 1 data divergence (a1 vs wrong)
  assert.equal(result.firstDivergence.index, 1);
  // Second: index 2 type_mismatch (user_message vs tool_call)
  // Third: index 3 type_mismatch (assistant_response vs tool_result)
});

// ── analyzeAlternatePath ────────────────────────────────────────────────

test('ReplayDiffAnalyzer: analyzeAlternatePath builds a hypothetical branch', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const session = makeSession([
    makeEvent('user_message', 'search for cats'),
    makeEvent('tool_call', { tool: 'search', input: 'cats' }),
    makeEvent('tool_result', { result: 'found' }),
    makeEvent('assistant_response', 'Found cats'),
  ]);

  const result = analyzer.analyzeAlternatePath(session, 1, {
    type: 'tool_call',
    data: { tool: 'web_search', input: 'cats' },
  });

  assert.equal(result.forkPoint, 1);
  assert.equal(result.forkEvent.type, 'tool_call');
  assert.equal(result.forkEvent.data.tool, 'search');
  assert.equal(result.alternateEvent.type, 'tool_call');
  assert.equal(result.alternateEvent.data.tool, 'web_search');
  assert.equal(result.summary.originalRemainingEvents, 3); // idx 1,2,3
  assert.equal(result.summary.alternateRemainingEvents, 1);
  assert.equal(result.summary.eventsChanged, true);
  assert.equal(result.summary.typeChanged, false); // both tool_call
  assert.equal(result.alternatePath.events.length, 2); // prefix 0..0 + alternate
});

test('ReplayDiffAnalyzer: analyzeAlternatePath marks type change when different', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const session = makeSession([
    makeEvent('user_message', 'hello'),
    makeEvent('assistant_response', 'hi there'),
    makeEvent('tool_call', { tool: 'search' }),
  ]);

  const result = analyzer.analyzeAlternatePath(session, 1, {
    type: 'error',
    data: { message: 'timeout' },
  });

  assert.equal(result.summary.typeChanged, true);
  assert.equal(result.forkEvent.type, 'assistant_response');
  assert.equal(result.alternateEvent.type, 'error');
});

test('ReplayDiffAnalyzer: analyzeAlternatePath throws for invalid forkPoint', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const session = makeSession([
    makeEvent('user_message', 'test'),
  ]);

  assert.throws(
    () => analyzer.analyzeAlternatePath(session, -1, { type: 'user_message', data: 'bad' }),
    /forkPoint must be a valid event index/
  );
  assert.throws(
    () => analyzer.analyzeAlternatePath(session, 5, { type: 'user_message', data: 'bad' }),
    /forkPoint must be a valid event index/
  );
});

test('ReplayDiffAnalyzer: analyzeAlternatePath throws for invalid alternateAction', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const session = makeSession([
    makeEvent('user_message', 'test'),
  ]);

  assert.throws(
    () => analyzer.analyzeAlternatePath(session, 0, null),
    /alternateAction must be an object/
  );
  assert.throws(
    () => analyzer.analyzeAlternatePath(session, 0, { data: 'no-type' }),
    /alternateAction must be an object with a "type" field/
  );
});

test('ReplayDiffAnalyzer: analyzeAlternatePath forks at beginning', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const session = makeSession([
    makeEvent('user_message', 'original question'),
    makeEvent('assistant_response', 'original answer'),
  ]);

  const result = analyzer.analyzeAlternatePath(session, 0, {
    type: 'user_message',
    data: 'alternate question',
  });

  assert.equal(result.forkPoint, 0);
  assert.equal(result.alternatePath.events.length, 1);
  assert.equal(result.alternatePath.events[0].data, 'alternate question');
  assert.equal(result.summary.originalRemainingEvents, 2);
  assert.equal(result.summary.alternateRemainingEvents, 1);
});

// ── getDecisionImpact ───────────────────────────────────────────────────

test('ReplayDiffAnalyzer: getDecisionImpact scores critical impact', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const decision = {
    type: 'tool_call',
    data: { tool: 'file_delete', input: '/important.txt' },
    index: 5,
  };
  const outcome = {
    eventsAfter: [
      makeEvent('error', { message: 'file not found' }),
      makeEvent('error', { message: 'permission denied' }),
      makeEvent('error', { message: 'system crash' }),
      makeEvent('tool_call', { tool: 'recover' }),
      makeEvent('tool_call', { tool: 'rollback' }),
      makeEvent('tool_call', { tool: 'alert' }),
      makeEvent('assistant_response', 'recovery attempted'),
    ],
    stateAfter: {
      fileSystem: 'corrupted',
      sessionStatus: 'error',
      retriesExhausted: true,
      alertSent: true,
    },
    metrics: { tokensUsed: 500 },
  };

  const result = analyzer.getDecisionImpact(decision, outcome);

  assert.equal(result.decision.type, 'tool_call');
  assert.equal(result.decision.index, 5);
  assert.equal(result.outcome.totalEventsAfter, 7);
  assert.equal(result.outcome.errorsCount, 3);
  assert.equal(result.outcome.toolCallsCount, 3);
  assert.deepEqual(result.outcome.stateChanges, ['fileSystem', 'sessionStatus', 'retriesExhausted', 'alertSent']);
  assert.equal(result.impact.level, 'critical');
  assert.ok(result.impact.score >= 75);
  assert.equal(result.impact.hasErrors, true);
  assert.equal(result.impact.causedToolCalls, true);
  assert.equal(result.impact.causedStateChanges, true);
});

test('ReplayDiffAnalyzer: getDecisionImpact scores low impact', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const decision = {
    type: 'user_message',
    data: 'hello',
    index: 0,
  };
  const outcome = {
    eventsAfter: [
      makeEvent('assistant_response', 'hi'),
    ],
    stateAfter: {},
  };

  const result = analyzer.getDecisionImpact(decision, outcome);

  assert.equal(result.outcome.totalEventsAfter, 1);
  assert.equal(result.outcome.errorsCount, 0);
  assert.equal(result.impact.level, 'low');
  assert.equal(result.impact.hasErrors, false);
  assert.equal(result.impact.causedToolCalls, false);
  assert.equal(result.impact.causedStateChanges, false);
});

test('ReplayDiffAnalyzer: getDecisionImpact calculates impact score correctly', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const decision = { type: 'tool_call', data: { tool: 'search' }, index: 3 };
  const outcome = {
    eventsAfter: [
      makeEvent('tool_call', { tool: 'a' }),
      makeEvent('tool_call', { tool: 'b' }),
      makeEvent('tool_result', {}),
      makeEvent('assistant_response', 'found'),
    ],
    stateAfter: { lastQuery: 'test', resultCount: 5 },
    metrics: { tokens: 200 },
  };

  const result = analyzer.getDecisionImpact(decision, outcome);

  // 4 events * 5 = 20, 2 tool calls * 10 = 20, 2 state * 5 = 10, 0 errors
  // total = 50 → moderate or high
  assert.ok(result.impact.score >= 45 && result.impact.score <= 55);
  assert.equal(result.impact.level, 'high'); // or moderate depending on rounding
  assert.equal(result.impact.hasErrors, false);
  assert.equal(result.impact.causedToolCalls, true);
});

test('ReplayDiffAnalyzer: getDecisionImpact throws for invalid input', () => {
  const analyzer = new ReplayDiffAnalyzer();
  assert.throws(() => analyzer.getDecisionImpact(null, {}), /decision must be an object/);
  assert.throws(() => analyzer.getDecisionImpact({}, null), /outcome must be an object/);
});

test('ReplayDiffAnalyzer: getDecisionImpact handles missing optional fields', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const result = analyzer.getDecisionImpact(
    { type: 'unknown' },
    { eventsAfter: [], stateAfter: {} }
  );

  assert.equal(result.decision.index, null);
  assert.equal(result.outcome.totalEventsAfter, 0);
  assert.equal(result.impact.level, 'low');
  assert.equal(result.impact.score, 0);
  assert.deepEqual(result.outcome.stateChanges, []);
});

// ── end-to-end multi-session comparison ─────────────────────────────────

test('ReplayDiffAnalyzer: full comparison of complex sessions', () => {
  const analyzer = new ReplayDiffAnalyzer();
  const baseTime = Date.now();

  const sessionA = makeSession([
    makeEvent('user_message', 'find me docs on API', new Date(baseTime + 0).toISOString()),
    makeEvent('assistant_response', 'Let me search', new Date(baseTime + 500).toISOString()),
    makeEvent('tool_call', { tool: 'search', input: 'API docs' }, new Date(baseTime + 600).toISOString()),
    makeEvent('tool_result', { result: '3 results' }, new Date(baseTime + 2000).toISOString()),
    makeEvent('assistant_response', 'Here are the docs...', new Date(baseTime + 2500).toISOString()),
  ], { id: 'session-a', provider: 'anthropic', model: 'claude-sonnet' });

  const sessionB = makeSession([
    makeEvent('user_message', 'find me docs on API', new Date(baseTime + 0).toISOString()),
    makeEvent('assistant_response', 'Let me check', new Date(baseTime + 400).toISOString()),
    makeEvent('tool_call', { tool: 'search', input: 'API docs' }, new Date(baseTime + 500).toISOString()),
    makeEvent('tool_result', { result: '5 results' }, new Date(baseTime + 1500).toISOString()),
    makeEvent('assistant_response', 'Found these docs...', new Date(baseTime + 2000).toISOString()),
    makeEvent('tool_call', { tool: 'file_write', input: 'save results' }, new Date(baseTime + 2100).toISOString()),
    makeEvent('tool_result', { result: 'saved' }, new Date(baseTime + 2500).toISOString()),
  ], { id: 'session-b', provider: 'anthropic', model: 'claude-sonnet' });

  const comparison = analyzer.compareSessions(sessionA, sessionB);
  const divergence = analyzer.findDivergencePoints(sessionA, sessionB);

  // Comparison checks
  assert.equal(comparison.totalEvents.a, 5);
  assert.equal(comparison.totalEvents.b, 7);
  assert.equal(comparison.metadataDiff.sameProvider, true);
  assert.equal(comparison.metadataDiff.sameModel, true);
  assert.equal(comparison.toolUsage.totalCallsA, 1);
  assert.equal(comparison.toolUsage.totalCallsB, 2);

  // Divergence checks
  assert.equal(divergence.sessionsIdentical, false);
  assert.ok(divergence.lengthDiff);
  assert.equal(divergence.lengthDiff.extraCount, 2);
});
