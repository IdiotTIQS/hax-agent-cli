/**
 * Tests for ReplayEngine.
 */
"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');
const { ReplayEngine, SPEED_PRESETS } = require('../../src/replay/engine');

// ── helpers ─────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeEvent(type, data, timestamp) {
  return {
    type,
    timestamp: timestamp || new Date().toISOString(),
    data: data !== undefined ? data : null,
    context: {},
  };
}

function makeSession(events, meta = {}) {
  return {
    version: 1,
    metadata: {
      id: 'test-session-1',
      sessionId: 'sess-1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      recordingStartedAt: new Date().toISOString(),
      ...meta,
    },
    events,
    startTime: events.length > 0 ? events[0].timestamp : null,
    endTime: events.length > 0 ? events[events.length - 1].timestamp : null,
  };
}

// ── SPEED_PRESETS ───────────────────────────────────────────────────────

test('SPEED_PRESETS contains expected values', () => {
  assert.equal(SPEED_PRESETS['1x'], 1);
  assert.equal(SPEED_PRESETS['2x'], 2);
  assert.equal(SPEED_PRESETS['5x'], 5);
  assert.equal(SPEED_PRESETS['10x'], 10);
  assert.equal(SPEED_PRESETS['50x'], 50);
  assert.equal(SPEED_PRESETS['MAX'], Infinity);
});

// ── constructor / initialization ────────────────────────────────────────

test('ReplayEngine: initializes with defaults', () => {
  const engine = new ReplayEngine();
  const pos = engine.getCurrentPosition();
  assert.equal(pos.index, -1);
  assert.equal(pos.total, 0);
  assert.equal(pos.percent, 0);
  assert.equal(pos.event, null);
  assert.equal(pos.speed, 1);
  assert.equal(pos.paused, false);
  assert.equal(engine.hasSession(), false);
  assert.equal(engine.isPaused(), false);
  assert.equal(engine.getSpeed(), 1);
  assert.equal(engine.getAnalysis(), null);
});

// ── load ────────────────────────────────────────────────────────────────

test('ReplayEngine: load sets the session and resets state', () => {
  const engine = new ReplayEngine();
  const session = makeSession([
    makeEvent('user_message', 'hello'),
    makeEvent('assistant_response', 'hi there'),
  ]);

  engine.load(session);

  assert.equal(engine.hasSession(), true);
  const pos = engine.getCurrentPosition();
  assert.equal(pos.index, -1);
  assert.equal(pos.total, 2);
  assert.equal(pos.sessionId, 'test-session-1');
});

test('ReplayEngine: load throws for invalid input', () => {
  const engine = new ReplayEngine();
  assert.throws(() => engine.load(null), /Session must be an object/);
  assert.throws(() => engine.load({}), /must have an "events" array/);
  assert.throws(() => engine.load({ events: 'not-an-array' }), /must have an "events" array/);
});

// ── step ────────────────────────────────────────────────────────────────

test('ReplayEngine: step advances through events', () => {
  const engine = new ReplayEngine();
  const events = [
    makeEvent('user_message', 'hello'),
    makeEvent('assistant_response', 'hi'),
    makeEvent('user_message', 'how are you'),
    makeEvent('assistant_response', 'good'),
  ];
  const session = makeSession(events);
  engine.load(session);

  // Step 1
  let result = engine.step();
  assert.ok(result);
  assert.equal(result.type, 'user_message');
  assert.equal(result.data, 'hello');
  let pos = engine.getCurrentPosition();
  assert.equal(pos.index, 0);
  assert.equal(pos.percent, 25);

  // Step 2
  result = engine.step();
  assert.equal(result.type, 'assistant_response');
  assert.equal(result.data, 'hi');
  pos = engine.getCurrentPosition();
  assert.equal(pos.index, 1);
  assert.equal(pos.percent, 50);

  // Step 3
  result = engine.step();
  assert.equal(result.type, 'user_message');
  assert.equal(result.data, 'how are you');

  // Step 4
  result = engine.step();
  assert.equal(result.type, 'assistant_response');
  assert.equal(result.data, 'good');
  pos = engine.getCurrentPosition();
  assert.equal(pos.percent, 100);

  // At end
  result = engine.step();
  assert.equal(result, null);
});

test('ReplayEngine: step emits step events', (t) => {
  const engine = new ReplayEngine();
  const events = [
    makeEvent('user_message', 'ping'),
    makeEvent('assistant_response', 'pong'),
  ];
  const session = makeSession(events);
  engine.load(session);

  const steps = [];
  engine.on('step', (event, pos) => {
    steps.push({ type: event.type, index: pos.index });
  });

  engine.step();
  engine.step();

  assert.equal(steps.length, 2);
  assert.equal(steps[0].type, 'user_message');
  assert.equal(steps[0].index, 0);
  assert.equal(steps[1].type, 'assistant_response');
  assert.equal(steps[1].index, 1);
});

test('ReplayEngine: step emits end when complete', (t) => {
  const engine = new ReplayEngine();
  const session = makeSession([
    makeEvent('user_message', 'one'),
  ]);
  engine.load(session);

  let endCalled = false;
  engine.on('end', () => { endCalled = true; });

  engine.step(); // moves to index 0, which is the last event
  assert.equal(endCalled, true);
});

test('ReplayEngine: step throws when no session loaded', () => {
  const engine = new ReplayEngine();
  assert.throws(() => engine.step(), /No session loaded/);
});

// ── replay ──────────────────────────────────────────────────────────────

test('ReplayEngine: replay at MAX speed processes all events', (t, done) => {
  const engine = new ReplayEngine();
  const events = [];
  for (let i = 0; i < 5; i++) {
    events.push(makeEvent('user_message', `msg ${i}`, new Date(Date.now() + i * 100).toISOString()));
  }
  const session = makeSession(events);
  engine.load(session);

  const steps = [];
  engine.on('step', (event) => steps.push(event));

  engine.on('end', () => {
    assert.equal(steps.length, 5);
    const pos = engine.getCurrentPosition();
    assert.equal(pos.index, 4);
    assert.equal(pos.percent, 100);
    done();
  });

  engine.replay('MAX');
});

test('ReplayEngine: replay loads session if passed as first arg', (t, done) => {
  const engine = new ReplayEngine();
  const session = makeSession([
    makeEvent('user_message', 'hello'),
  ]);

  engine.on('end', () => {
    const pos = engine.getCurrentPosition();
    assert.equal(pos.index, 0);
    assert.equal(pos.total, 1);
    done();
  });

  engine.replay(session, 'MAX');
});

test('ReplayEngine: replay throws with no session loaded', () => {
  const engine = new ReplayEngine();
  assert.throws(() => engine.replay('2x'), /No session loaded/);
});

// ── fastForward ─────────────────────────────────────────────────────────

test('ReplayEngine: fastForward by index skips ahead', () => {
  const engine = new ReplayEngine();
  const events = [];
  for (let i = 0; i < 10; i++) {
    events.push(makeEvent('user_message', `msg ${i}`, new Date(Date.now() + i * 100).toISOString()));
  }
  const session = makeSession(events);
  engine.load(session);

  // Start at index 0
  engine.step();
  assert.equal(engine.getCurrentPosition().index, 0);

  // Fast-forward to index 7
  const pos = engine.fastForward(7);
  assert.equal(pos.index, 7);
  assert.equal(pos.percent, 80);
});

test('ReplayEngine: fastForward by timestamp seeks to correct position', () => {
  const engine = new ReplayEngine();
  const baseTime = Date.now();
  const events = [
    makeEvent('user_message', 'e0', new Date(baseTime + 0).toISOString()),
    makeEvent('user_message', 'e1', new Date(baseTime + 1000).toISOString()),
    makeEvent('user_message', 'e2', new Date(baseTime + 2000).toISOString()),
    makeEvent('user_message', 'e3', new Date(baseTime + 3000).toISOString()),
    makeEvent('user_message', 'e4', new Date(baseTime + 4000).toISOString()),
  ];
  const session = makeSession(events);
  engine.load(session);

  // Seek to time between e1 and e2
  const pos = engine.fastForward(new Date(baseTime + 2500).toISOString());
  assert.equal(pos.index, 2);
});

test('ReplayEngine: fastForward rejects backwards movement', () => {
  const engine = new ReplayEngine();
  const events = [
    makeEvent('user_message', 'e0'),
    makeEvent('user_message', 'e1'),
    makeEvent('user_message', 'e2'),
  ];
  const session = makeSession(events);
  engine.load(session);

  engine.step();
  engine.step(); // at index 1

  assert.throws(() => engine.fastForward(0), /Cannot fast-forward backwards/);
});

// ── rewind ──────────────────────────────────────────────────────────────

test('ReplayEngine: rewind by index goes back', () => {
  const engine = new ReplayEngine();
  const events = [
    makeEvent('user_message', 'e0'),
    makeEvent('user_message', 'e1'),
    makeEvent('user_message', 'e2'),
    makeEvent('user_message', 'e3'),
    makeEvent('user_message', 'e4'),
  ];
  const session = makeSession(events);
  engine.load(session);

  // Advance to index 3
  engine.fastForward(3);
  assert.equal(engine.getCurrentPosition().index, 3);

  // Rewind to index 0
  const pos = engine.rewind(0);
  assert.equal(pos.index, 0);
  assert.equal(pos.percent, 20);
});

test('ReplayEngine: rewind by timestamp goes back correctly', () => {
  const engine = new ReplayEngine();
  const baseTime = Date.now();
  const events = [
    makeEvent('user_message', 'e0', new Date(baseTime + 0).toISOString()),
    makeEvent('user_message', 'e1', new Date(baseTime + 1000).toISOString()),
    makeEvent('user_message', 'e2', new Date(baseTime + 2000).toISOString()),
    makeEvent('user_message', 'e3', new Date(baseTime + 3000).toISOString()),
    makeEvent('user_message', 'e4', new Date(baseTime + 4000).toISOString()),
  ];
  const session = makeSession(events);
  engine.load(session);

  // Advance to end
  engine.fastForward(4);
  assert.equal(engine.getCurrentPosition().index, 4);

  // Rewind to timestamp around e1
  const pos = engine.rewind(new Date(baseTime + 1500).toISOString());
  assert.equal(pos.index, 1);
});

test('ReplayEngine: rewind rejects forward movement', () => {
  const engine = new ReplayEngine();
  const session = makeSession([
    makeEvent('user_message', 'e0'),
    makeEvent('user_message', 'e1'),
  ]);
  engine.load(session);

  engine.step(); // at index 0

  assert.throws(() => engine.rewind(1), /Cannot rewind forward/);
});

test('ReplayEngine: rewind to -1 resets to start', () => {
  const engine = new ReplayEngine();
  const session = makeSession([
    makeEvent('user_message', 'e0'),
    makeEvent('user_message', 'e1'),
  ]);
  engine.load(session);

  engine.step();
  engine.step(); // at index 1

  const pos = engine.rewind(-1);
  assert.equal(pos.index, -1);
  assert.equal(pos.event, null);
});

// ── pause / resume ──────────────────────────────────────────────────────

test('ReplayEngine: pause and resume work correctly', () => {
  const engine = new ReplayEngine();
  const session = makeSession([
    makeEvent('user_message', 'e0'),
    makeEvent('user_message', 'e1'),
  ]);
  engine.load(session);

  assert.equal(engine.isPaused(), false);
  engine.pause();
  assert.equal(engine.isPaused(), true);
  engine.resume();
  assert.equal(engine.isPaused(), false);
});

// ── getCurrentPosition ──────────────────────────────────────────────────

test('ReplayEngine: getCurrentPosition reflects state accurately', () => {
  const engine = new ReplayEngine();
  const session = makeSession([
    makeEvent('user_message', 'hello'),
    makeEvent('assistant_response', 'world'),
    makeEvent('tool_call', { tool: 'search', input: 'test' }),
  ]);
  engine.load(session);

  // Before any steps
  let pos = engine.getCurrentPosition();
  assert.equal(pos.index, -1);
  assert.equal(pos.total, 3);
  assert.equal(pos.percent, 0);
  assert.equal(pos.remainingCount, 3);
  assert.equal(pos.event, null);

  // After one step
  engine.step();
  pos = engine.getCurrentPosition();
  assert.equal(pos.index, 0);
  assert.equal(pos.percent, 33);
  assert.equal(pos.remainingCount, 2);
  assert.ok(pos.event);
  assert.equal(pos.event.data, 'hello');
});

// ── analyzeReplay ───────────────────────────────────────────────────────

test('ReplayEngine: analyzeReplay extracts insights from session', () => {
  const engine = new ReplayEngine();
  const events = [
    makeEvent('user_message', 'hello'),
    makeEvent('assistant_response', 'hi there'),
    makeEvent('tool_call', { tool: 'search', input: 'query' }),
    makeEvent('tool_result', { result: 'found' }),
    makeEvent('assistant_response', 'I found something'),
    makeEvent('error', { message: 'timeout' }),
  ];
  const session = makeSession(events);
  engine.load(session);

  const analysis = engine.analyzeReplay();

  assert.equal(analysis.totalEvents, 6);
  assert.equal(analysis.countsByType.user_message, 1);
  assert.equal(analysis.countsByType.assistant_response, 2);
  assert.equal(analysis.countsByType.tool_call, 1);
  assert.equal(analysis.countsByType.tool_result, 1);
  assert.equal(analysis.countsByType.error, 1);
  assert.equal(analysis.totalToolCalls, 1);
  assert.equal(analysis.totalErrors, 1);
  assert.deepEqual(analysis.toolNames, ['search']);
  assert.equal(analysis.totalTurns, 1);
  assert.equal(analysis.errorSummary.length, 1);
  assert.equal(analysis.errorSummary[0], 'timeout');
});

test('ReplayEngine: analyzeReplay works on empty session', () => {
  const engine = new ReplayEngine();
  const session = makeSession([]);
  engine.load(session);

  const analysis = engine.analyzeReplay();
  assert.equal(analysis.totalEvents, 0);
  assert.deepEqual(analysis.countsByType, {});
  assert.equal(analysis.totalTurns, 0);
  assert.equal(analysis.totalToolCalls, 0);
  assert.equal(analysis.totalErrors, 0);
  assert.equal(analysis.totalDurationMs, 0);
});

test('ReplayEngine: analyzeReplay accepts external session', () => {
  const engine = new ReplayEngine();
  const session = makeSession([
    makeEvent('user_message', 'test'),
  ]);

  // Don't load — pass directly
  const analysis = engine.analyzeReplay(session);
  assert.equal(analysis.totalEvents, 1);
  assert.equal(analysis.countsByType.user_message, 1);
  // Should not have loaded the session internally
  assert.equal(engine.hasSession(), false);
});

test('ReplayEngine: analyzeReplay throws for invalid input', () => {
  const engine = new ReplayEngine();
  assert.throws(() => engine.analyzeReplay(null), /No valid session/);
  assert.throws(() => engine.analyzeReplay({}), /No valid session/);
});

// ── reset ───────────────────────────────────────────────────────────────

test('ReplayEngine: reset clears state to initial', () => {
  const engine = new ReplayEngine();
  const session = makeSession([
    makeEvent('user_message', 'e0'),
    makeEvent('user_message', 'e1'),
  ]);
  engine.load(session);
  engine.step();
  engine.step();
  engine.analyzeReplay();
  engine.pause();

  engine.reset();

  const pos = engine.getCurrentPosition();
  assert.equal(pos.index, -1);
  assert.equal(pos.paused, false);
  assert.equal(engine.getSpeed(), 1);
  assert.equal(engine.getAnalysis(), null);
  assert.equal(engine.isPaused(), false);
});

// ── onStep / onEnd callbacks ────────────────────────────────────────────

test('ReplayEngine: onStep callback fires on each step', () => {
  const steps = [];
  const engine = new ReplayEngine({
    onStep: (event, pos) => {
      steps.push({ type: event.type, index: pos.index });
    },
  });
  const session = makeSession([
    makeEvent('user_message', 'a'),
    makeEvent('assistant_response', 'b'),
    makeEvent('tool_call', { tool: 'x' }),
  ]);
  engine.load(session);

  engine.step();
  engine.step();
  engine.step();

  assert.equal(steps.length, 3);
  assert.equal(steps[0].type, 'user_message');
  assert.equal(steps[1].type, 'assistant_response');
  assert.equal(steps[2].type, 'tool_call');
});

test('ReplayEngine: onEnd callback fires when session ends', () => {
  let endPos = null;
  const engine = new ReplayEngine({
    onEnd: (pos) => { endPos = pos; },
  });
  const session = makeSession([
    makeEvent('user_message', 'only'),
  ]);
  engine.load(session);

  engine.step();
  assert.ok(endPos);
  assert.equal(endPos.index, 0);
  assert.equal(endPos.percent, 100);
});

// ── speed validation ────────────────────────────────────────────────────

test('ReplayEngine: resolves speed strings correctly', () => {
  const engine = new ReplayEngine();
  const session = makeSession([makeEvent('user_message', 'test')]);
  engine.load(session);

  // Use internal method via replay
  engine.replay('1x');
  assert.equal(engine.getSpeed(), 1);

  engine.reset();
  engine.replay('50x');
  assert.equal(engine.getSpeed(), 50);
});

test('ReplayEngine: rejects invalid speed values', () => {
  const engine = new ReplayEngine();
  const session = makeSession([makeEvent('user_message', 'test')]);
  engine.load(session);

  assert.throws(() => engine.replay('0x'), /Invalid speed/);
  assert.throws(() => engine.replay(-5), /Speed must be a positive number/);
  assert.throws(() => engine.replay('fast'), /Invalid speed/);
});
