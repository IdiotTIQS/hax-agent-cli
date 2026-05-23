'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ProtocolCompressor,
  createCompressor,
  estimateTokens,
} = require('../../src/protocol/compressor');

// ---- Helpers ----

function makeMessage(overrides = {}) {
  return {
    id: overrides.id || 'msg-1',
    from: overrides.from || 'architect',
    to: overrides.to || 'reviewer',
    type: overrides.type || 'message',
    taskId: overrides.taskId !== undefined ? overrides.taskId : null,
    subject: overrides.subject !== undefined ? overrides.subject : '',
    body: overrides.body !== undefined ? overrides.body : 'The database schema has been reviewed.',
    createdAt: overrides.createdAt || '2026-05-22T10:00:00.000Z',
    priority: overrides.priority || 'normal',
    priorityLevel: overrides.priorityLevel || 50,
    threadId: overrides.threadId !== undefined ? overrides.threadId : null,
    read: overrides.read !== undefined ? overrides.read : null,
    metadata: overrides.metadata !== undefined ? overrides.metadata : { source: 'hax' },
  };
}

// ---- Tests ----

test('compress abbreviates field names', () => {
  const compressor = new ProtocolCompressor();
  const message = makeMessage({ metadata: {} });
  const compressed = compressor.compress(message);

  // Known field mappings
  assert.ok('f' in compressed, 'from should be abbreviated to f');
  assert.ok('t' in compressed, 'to should be abbreviated to t');
  assert.ok('i' in compressed, 'id should be abbreviated to i');
  assert.ok('b' in compressed, 'body should be abbreviated to b');
  assert.ok('p' in compressed, 'type should be abbreviated to p');
  assert.ok('ts' in compressed, 'createdAt should be abbreviated to ts');

  // Full names should NOT appear
  assert.ok(!('from' in compressed), 'full field name "from" should not exist');
  assert.ok(!('to' in compressed), 'full field name "to" should not exist');
  assert.ok(!('body' in compressed), 'full field name "body" should not exist');
});

test('compress shortens role names in from and to fields', () => {
  const compressor = new ProtocolCompressor();

  const message = makeMessage({ from: 'architect', to: 'security-reviewer' });
  const compressed = compressor.compress(message);

  assert.equal(compressed.f, 'arc', 'architect should shorten to arc');
  assert.equal(compressed.t, 'sec', 'security-reviewer should shorten to sec');
});

test('compress preserves unknown role names as-is', () => {
  const compressor = new ProtocolCompressor();
  const message = makeMessage({ from: 'custom-ai-bot', to: 'orchestrator' });
  const compressed = compressor.compress(message);

  assert.equal(compressed.f, 'custom-ai-bot');
  assert.equal(compressed.t, 'orchestrator');
});

test('compress drops fields with null or empty default values', () => {
  const compressor = new ProtocolCompressor();
  const message = makeMessage({
    taskId: null,
    subject: '',
    threadId: null,
    read: null,
    metadata: {},
  });

  const compressed = compressor.compress(message);

  assert.ok(!('ti' in compressed), 'null taskId should be dropped');
  assert.ok(!('s' in compressed), 'empty subject should be dropped');
  assert.ok(!('th' in compressed), 'null threadId should be dropped');
  assert.ok(!('rd' in compressed), 'null read should be dropped');
  assert.ok(!('m' in compressed), 'empty metadata should be dropped');
});

test('compress deduplicates repeated body text across messages', () => {
  const compressor = new ProtocolCompressor({ dedupWindow: 3 });

  // First message establishes context
  const first = compressor.compress(makeMessage({
    body: 'Team mission: Build a secure authentication system for the HaxAgent platform.',
  }));

  assert.equal(first.b, 'Team mission: Build a secure authentication system for the HaxAgent platform.');

  // Second message repeats the same body
  const second = compressor.compress(makeMessage({
    id: 'msg-2',
    body: 'Team mission: Build a secure authentication system for the HaxAgent platform.',
  }));

  assert.equal(second.b, '[...]', 'exact duplicate body should collapse to [...]');

  // Third message repeats a prefix but adds new content
  const third = compressor.compress(makeMessage({
    id: 'msg-3',
    body: 'Team mission: Build a secure authentication system for the HaxAgent platform. Phase 2 begins now.',
  }));

  assert.ok(
    third.b.startsWith('[...]'),
    'shared prefix should collapse to [...] marker'
  );
  assert.ok(
    third.b.includes('Phase 2 begins now'),
    'new content after shared prefix should be preserved'
  );
});

test('decompress restores a compressed message to its full form', () => {
  const compressor = new ProtocolCompressor();
  const original = makeMessage({
    taskId: 'T1',
    subject: 'Schema Review',
    threadId: 'th-1',
    metadata: { source: 'hax', priority: 'high' },
  });

  const compressed = compressor.compress(original);
  const restored = compressor.decompress(compressed);

  assert.equal(restored.id, original.id);
  assert.equal(restored.from, original.from);
  assert.equal(restored.to, original.to);
  assert.equal(restored.type, original.type);
  assert.equal(restored.taskId, original.taskId);
  assert.equal(restored.subject, original.subject);
  assert.equal(restored.body, original.body);
  assert.equal(restored.createdAt, original.createdAt);
  assert.equal(restored.priority, original.priority);
  assert.equal(restored.priorityLevel, original.priorityLevel);
  assert.equal(restored.threadId, original.threadId);
  assert.deepEqual(restored.metadata, original.metadata);
});

test('decompress expands abbreviated role names', () => {
  const compressor = new ProtocolCompressor();
  const original = makeMessage({ from: 'docs-writer', to: 'test-runner' });
  const compressed = compressor.compress(original);
  const restored = compressor.decompress(compressed);

  assert.equal(restored.from, 'docs-writer');
  assert.equal(restored.to, 'test-runner');
});

test('decompress re-applies default null values for dropped fields', () => {
  const compressor = new ProtocolCompressor();
  const original = makeMessage({
    taskId: null,
    subject: '',
    threadId: null,
    read: null,
    metadata: {},
  });

  const compressed = compressor.compress(original);
  const restored = compressor.decompress(compressed);

  assert.equal(restored.taskId, null);
  assert.equal(restored.subject, '');
  assert.equal(restored.threadId, null);
  assert.equal(restored.read, null);
});

test('decompress throws on non-compressed message or wrong version', () => {
  const compressor = new ProtocolCompressor();

  assert.throws(
    () => compressor.decompress({ from: 'alice' }),
    { message: /Unknown compression version/ }
  );

  assert.throws(
    () => compressor.decompress({ _v: 99 }),
    { message: /Unknown compression version/ }
  );

  assert.throws(
    () => compressor.decompress(null),
    { message: /non-null object/ }
  );
});

test('estimateSavings calculates token savings for a batch of messages', () => {
  const compressor = new ProtocolCompressor();
  const messages = [
    makeMessage({ id: 'msg-1', body: 'Review the authentication module for vulnerabilities.' }),
    makeMessage({ id: 'msg-2', body: 'Implement the OAuth2 flow for the login endpoint.' }),
    makeMessage({ id: 'msg-3', body: 'Write documentation for the new API endpoints.' }),
  ];

  const report = compressor.estimateSavings(messages);

  assert.equal(report.messageCount, 3);
  assert.ok(report.originalTokens > 0, 'original tokens should be positive');
  assert.ok(report.compressedTokens > 0, 'compressed tokens should be positive');
  assert.ok(report.compressedTokens < report.originalTokens, 'compression should save tokens');
  assert.ok(report.totalSaved > 0, 'totalSaved should be positive');
  assert.ok(report.savingsPercent > 0, 'savings percent should be positive');
  assert.ok(report.savingsPercent <= 100, 'savings percent should not exceed 100');
  assert.equal(report.perMessage.length, 3);

  for (const entry of report.perMessage) {
    assert.ok(typeof entry.originalTokens === 'number');
    assert.ok(typeof entry.compressedTokens === 'number');
    assert.ok(typeof entry.saved === 'number');
    assert.ok(typeof entry.savingsPercent === 'number');
    assert.ok(entry.saved >= 0, 'saved tokens should be non-negative');
  }
});

test('estimateSavings throws on non-array input', () => {
  const compressor = new ProtocolCompressor();

  assert.throws(
    () => compressor.estimateSavings('not-an-array'),
    { message: /must be an array/ }
  );

  assert.throws(
    () => compressor.estimateSavings(null),
    { message: /must be an array/ }
  );
});

test('compress adds version marker and tracks compression count', () => {
  const compressor = new ProtocolCompressor();

  assert.equal(compressor.totalMessagesCompressed, 0);

  const compressed1 = compressor.compress(makeMessage({ id: 'msg-1' }));
  assert.equal(compressed1._v, 1, 'version marker should be set to 1');
  assert.equal(compressor.totalMessagesCompressed, 1);

  const compressed2 = compressor.compress(makeMessage({ id: 'msg-2' }));
  assert.equal(compressed2._v, 1);
  assert.equal(compressor.totalMessagesCompressed, 2);
});

test('reset clears internal state counters and dedup window', () => {
  const compressor = new ProtocolCompressor({ dedupWindow: 2 });

  compressor.compress(makeMessage({ id: 'msg-1', body: 'Context prefix: start of the system log.' }));
  compressor.compress(makeMessage({ id: 'msg-2', body: 'Context prefix: start of the system log.' }));

  assert.equal(compressor.totalMessagesCompressed, 2);

  compressor.reset();

  assert.equal(compressor.totalMessagesCompressed, 0);
  assert.equal(compressor.totalSaved, 0);

  // After reset, the same body should NOT be deduplicated because the window is empty
  const afterReset = compressor.compress(makeMessage({
    id: 'msg-3',
    body: 'Context prefix: start of the system log.',
  }));

  assert.equal(
    afterReset.b,
    'Context prefix: start of the system log.',
    'after reset, body should not be deduplicated'
  );
});

test('compress preserves non-defaultable fields even when empty', () => {
  const compressor = new ProtocolCompressor();
  const message = makeMessage({
    from: 'lead',
    to: 'implementer',
    body: '',
  });

  const compressed = compressor.compress(message);

  // from and to should always be present
  assert.ok('f' in compressed);
  assert.ok('t' in compressed);

  // body can be empty string — it's a core field but might be empty
  assert.ok('b' in compressed);
  assert.equal(compressed.b, '');
});

test('estimateTokens counts tokens in various value types', () => {
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens(undefined), 0);
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('hello'), 1, '"hello" is 1 word token');
  assert.equal(estimateTokens('hello world'), 2, '"hello world" is 2 word tokens');
  assert.ok(estimateTokens('Hello, world!') >= 3, 'punctuation creates separate tokens');

  const objTokens = estimateTokens({ a: 1, b: 'test' });
  assert.ok(objTokens > 0, 'object should produce token count');
});

test('createCompressor is a convenience factory', () => {
  const comp = createCompressor({ dedupWindow: 2 });
  assert.ok(comp instanceof ProtocolCompressor);
});
