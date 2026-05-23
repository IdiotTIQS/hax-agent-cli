'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Readable } = require('node:stream');
const {
  LogAggregator,
  FileSource,
  MemorySource,
  StreamSource,
  LOG_LEVELS,
  LEVEL_WEIGHT,
  toEpoch,
  matchesKeyword,
  normalizeEntry,
} = require('../../src/logs/aggregator');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hax-agg-'));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

function writeJsonlFile(filePath, entries) {
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(filePath, lines, 'utf8');
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

test('toEpoch returns numeric timestamp from ISO string', () => {
  const ts = '2026-01-15T10:30:00.000Z';
  const epoch = toEpoch(ts);
  assert.ok(Number.isFinite(epoch));
  assert.ok(epoch > 0);
});

test('toEpoch returns the number unchanged if already numeric', () => {
  assert.strictEqual(toEpoch(1700000000000), 1700000000000);
});

test('toEpoch returns null for null/undefined', () => {
  assert.strictEqual(toEpoch(null), null);
  assert.strictEqual(toEpoch(undefined), null);
});

test('matchesKeyword finds text in entry values', () => {
  const entry = { message: 'failed to connect to database', level: 'error', toolName: 'db.query' };
  assert.ok(matchesKeyword(entry, 'database'));
  assert.ok(matchesKeyword(entry, 'FAILED'));
  assert.ok(!matchesKeyword(entry, 'success'));
});

test('matchesKeyword searches nested objects via JSON.stringify', () => {
  const entry = { message: 'ok', error: { code: 'ECONNREFUSED', message: 'Connection refused' } };
  assert.ok(matchesKeyword(entry, 'ECONNREFUSED'));
  assert.ok(!matchesKeyword(entry, 'nonexistent'));
});

test('normalizeEntry produces a standard structure', () => {
  const raw = { timestamp: '2026-01-01T00:00:00Z', level: 'error', message: 'test', sessionId: 's1', toolName: 'shell.run' };
  const normalized = normalizeEntry(raw, 'test-source');
  assert.strictEqual(normalized.timestamp, '2026-01-01T00:00:00Z');
  assert.strictEqual(normalized.level, 'error');
  assert.strictEqual(normalized.message, 'test');
  assert.strictEqual(normalized.source, 'test-source');
  assert.strictEqual(normalized.sessionId, 's1');
  assert.strictEqual(normalized.toolName, 'shell.run');
  assert.ok(normalized.raw === raw);
});

test('normalizeEntry falls back to alternate field names', () => {
  const raw = { ts: '2026-01-01T00:00:00Z', severity: 'warn', msg: 'hello' };
  const normalized = normalizeEntry(raw, 'alt');
  assert.strictEqual(normalized.timestamp, '2026-01-01T00:00:00Z');
  assert.strictEqual(normalized.level, 'warn');
  assert.strictEqual(normalized.message, 'hello');
});

// ---------------------------------------------------------------------------
// LogAggregator construction
// ---------------------------------------------------------------------------

test('LogAggregator constructs with defaults', () => {
  const agg = new LogAggregator();
  assert.strictEqual(agg.sourceCount, 0);
});

test('LogAggregator accepts maxEntries option', () => {
  const agg = new LogAggregator({ maxEntries: 500 });
  assert.notStrictEqual(agg._maxEntries, undefined);
});

// ---------------------------------------------------------------------------
// addSource / removeSource
// ---------------------------------------------------------------------------

test('LogAggregator addSource registers a source', () => {
  const agg = new LogAggregator();
  const mem = new MemorySource([], 'test-mem');
  agg.addSource('memory-1', mem);
  assert.strictEqual(agg.sourceCount, 1);
});

test('LogAggregator addSource throws on invalid name', () => {
  const agg = new LogAggregator();
  const mem = new MemorySource();
  assert.throws(() => agg.addSource('', mem), TypeError);
  assert.throws(() => agg.addSource(null, mem), TypeError);
});

test('LogAggregator addSource throws on source without read()', () => {
  const agg = new LogAggregator();
  assert.throws(() => agg.addSource('bad', {}), TypeError);
});

test('LogAggregator removeSource removes registered source', () => {
  const agg = new LogAggregator();
  const mem = new MemorySource();
  agg.addSource('src', mem);
  assert.ok(agg.removeSource('src'));
  assert.strictEqual(agg.sourceCount, 0);
  assert.ok(!agg.removeSource('nonexistent'));
});

test('LogAggregator clear removes all sources', () => {
  const agg = new LogAggregator();
  agg.addSource('a', new MemorySource());
  agg.addSource('b', new MemorySource());
  agg.clear();
  assert.strictEqual(agg.sourceCount, 0);
});

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

test('LogAggregator collect merges entries from multiple MemorySources', async () => {
  const agg = new LogAggregator();

  const src1 = new MemorySource([
    { timestamp: '2026-05-01T10:00:00Z', level: 'info', message: 'one' },
  ], 'src1');

  const src2 = new MemorySource([
    { timestamp: '2026-05-01T11:00:00Z', level: 'error', message: 'two' },
  ], 'src2');

  agg.addSource('src1', src1);
  agg.addSource('src2', src2);

  const entries = await agg.collect();
  assert.ok(entries.length >= 2);
  // Newest first
  assert.strictEqual(entries[0].source, 'src2');
  assert.strictEqual(entries[1].source, 'src1');
});

test('LogAggregator collect respects sources filter option', async () => {
  const agg = new LogAggregator();
  agg.addSource('a', new MemorySource([{ message: 'A' }], 'a'));
  agg.addSource('b', new MemorySource([{ message: 'B' }], 'b'));

  const entries = await agg.collect({ sources: ['a'] });
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].source, 'a');
});

// ---------------------------------------------------------------------------
// filter
// ---------------------------------------------------------------------------

test('LogAggregator filter filters by level', async () => {
  const agg = new LogAggregator();
  const mem = new MemorySource([
    { timestamp: '2026-01-01T00:00:00Z', level: 'info', message: 'startup' },
    { timestamp: '2026-01-01T00:01:00Z', level: 'error', message: 'crash' },
    { timestamp: '2026-01-01T00:02:00Z', level: 'error', message: 'retry fail' },
  ], 'app');
  agg.addSource('app', mem);

  const errors = await agg.filter({ level: 'error' });
  assert.strictEqual(errors.length, 2);
  assert.ok(errors.every((e) => e.level === 'error'));
});

test('LogAggregator filter filters by source', async () => {
  const agg = new LogAggregator();
  agg.addSource('alpha', new MemorySource([{ message: 'a', level: 'info' }], 'alpha'));
  agg.addSource('beta', new MemorySource([{ message: 'b', level: 'info' }], 'beta'));

  const results = await agg.filter({ source: 'alpha' });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].message, 'a');
});

test('LogAggregator filter filters by timeRange', async () => {
  const agg = new LogAggregator();
  const mem = new MemorySource([
    { timestamp: '2026-05-01T08:00:00Z', level: 'info', message: 'early' },
    { timestamp: '2026-05-01T12:00:00Z', level: 'info', message: 'mid' },
    { timestamp: '2026-05-01T18:00:00Z', level: 'info', message: 'late' },
  ], 'app');
  agg.addSource('app', mem);

  const mid = await agg.filter({
    timeRange: { start: '2026-05-01T10:00:00Z', end: '2026-05-01T14:00:00Z' },
  });
  assert.strictEqual(mid.length, 1);
  assert.strictEqual(mid[0].message, 'mid');
});

test('LogAggregator filter filters by sessionId', async () => {
  const agg = new LogAggregator();
  const mem = new MemorySource([
    { sessionId: 's1', level: 'info', message: 'a' },
    { sessionId: 's2', level: 'info', message: 'b' },
  ], 'app');
  agg.addSource('app', mem);

  const results = await agg.filter({ sessionId: 's1' });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].sessionId, 's1');
});

test('LogAggregator filter supports limit and offset', async () => {
  const entries = [];
  for (let i = 0; i < 10; i++) {
    entries.push({ timestamp: `2026-01-01T0${i}:00:00Z`, level: 'info', message: `msg-${i}` });
  }
  const agg = new LogAggregator();
  agg.addSource('src', new MemorySource(entries, 'src'));

  const page = await agg.filter({ limit: 3, offset: 2 });
  assert.strictEqual(page.length, 3);
});

test('LogAggregator filter supports multiple levels', async () => {
  const agg = new LogAggregator();
  const mem = new MemorySource([
    { timestamp: '2026-01-01T00:00:00Z', level: 'debug', message: 'd' },
    { timestamp: '2026-01-01T00:01:00Z', level: 'info', message: 'i' },
    { timestamp: '2026-01-01T00:02:00Z', level: 'warn', message: 'w' },
    { timestamp: '2026-01-01T00:03:00Z', level: 'error', message: 'e' },
  ], 'app');
  agg.addSource('app', mem);

  const results = await agg.filter({ level: ['error', 'warn'] });
  assert.strictEqual(results.length, 2);
  assert.ok(results.every((e) => e.level === 'error' || e.level === 'warn'));
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

test('LogAggregator search performs full-text search', async () => {
  const agg = new LogAggregator();
  const mem = new MemorySource([
    { timestamp: '2026-01-01T00:00:00Z', level: 'info', message: 'user login' },
    { timestamp: '2026-01-01T00:01:00Z', level: 'error', message: 'database connection timeout' },
    { timestamp: '2026-01-01T00:02:00Z', level: 'info', message: 'file saved' },
  ], 'app');
  agg.addSource('app', mem);

  const results = await agg.search('database');
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].message, 'database connection timeout');
});

test('LogAggregator search returns empty for empty query', async () => {
  const agg = new LogAggregator();
  agg.addSource('app', new MemorySource([{ message: 'test' }], 'app'));

  const results = await agg.search('');
  assert.strictEqual(results.length, 0);
});

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

test('LogAggregator merge returns chronological timeline', async () => {
  const agg = new LogAggregator();
  agg.addSource('s1', new MemorySource([
    { timestamp: '2026-05-01T12:00:00Z', level: 'info', message: 'second' },
  ], 's1'));
  agg.addSource('s2', new MemorySource([
    { timestamp: '2026-05-01T10:00:00Z', level: 'info', message: 'first' },
  ], 's2'));

  const timeline = await agg.merge();
  // Oldest first
  assert.strictEqual(timeline[0].message, 'first');
  assert.strictEqual(timeline[1].message, 'second');
});

// ---------------------------------------------------------------------------
// getSources
// ---------------------------------------------------------------------------

test('LogAggregator getSources lists sources with stats', async () => {
  const agg = new LogAggregator();
  agg.addSource('memory', new MemorySource([{ message: 'test' }], 'memory'));

  const sources = await agg.getSources();
  assert.strictEqual(sources.length, 1);
  assert.strictEqual(sources[0].name, 'memory');
  assert.ok(typeof sources[0].stats === 'object');
});

// ---------------------------------------------------------------------------
// FileSource
// ---------------------------------------------------------------------------

test('FileSource reads JSONL file', async () => {
  const dir = tempDir();
  const filePath = path.join(dir, 'test.jsonl');
  try {
    writeJsonlFile(filePath, [
      { timestamp: '2026-01-01T00:00:00Z', level: 'info', message: 'line1' },
      { timestamp: '2026-01-01T00:01:00Z', level: 'error', message: 'line2' },
    ]);

    const source = new FileSource(filePath, 'jsonl');
    assert.strictEqual(source.name, 'test.jsonl');

    const entries = await source.read();
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].message, 'line1');
    assert.strictEqual(entries[1].level, 'error');
  } finally {
    cleanup(dir);
  }
});

test('FileSource returns empty array for missing file', async () => {
  const source = new FileSource('/nonexistent/path/file.jsonl');
  const entries = await source.read();
  assert.strictEqual(entries.length, 0);
});

test('FileSource readRange filters by time', async () => {
  const dir = tempDir();
  const filePath = path.join(dir, 'range.jsonl');
  try {
    writeJsonlFile(filePath, [
      { timestamp: '2026-01-01T08:00:00Z', level: 'info', message: 'morning' },
      { timestamp: '2026-01-01T12:00:00Z', level: 'info', message: 'noon' },
      { timestamp: '2026-01-01T18:00:00Z', level: 'info', message: 'evening' },
    ]);

    const source = new FileSource(filePath);
    const results = await source.readRange({
      startTime: '2026-01-01T10:00:00Z',
      endTime: '2026-01-01T14:00:00Z',
    });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].message, 'noon');
  } finally {
    cleanup(dir);
  }
});

test('FileSource stats returns file information', async () => {
  const dir = tempDir();
  const filePath = path.join(dir, 'stats.jsonl');
  try {
    writeJsonlFile(filePath, [
      { level: 'info', message: 'one' },
      { level: 'info', message: 'two' },
    ]);

    const source = new FileSource(filePath);
    const stats = await source.stats();
    assert.ok(stats.size > 0);
    assert.ok(stats.modifiedAt instanceof Date);
    assert.strictEqual(stats.lineCount, 2);
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// MemorySource
// ---------------------------------------------------------------------------

test('MemorySource read returns all entries', () => {
  const source = new MemorySource([{ a: 1 }, { b: 2 }], 'test');
  const entries = source.read();
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(source.length, 2);
});

test('MemorySource push adds an entry', () => {
  const source = new MemorySource([], 'test');
  source.push({ message: 'new' });
  assert.strictEqual(source.length, 1);
  assert.strictEqual(source.read()[0].message, 'new');
});

// ---------------------------------------------------------------------------
// StreamSource
// ---------------------------------------------------------------------------

test('StreamSource reads JSONL from a readable stream', async () => {
  const jsonl = [
    JSON.stringify({ level: 'info', message: 's1' }),
    JSON.stringify({ level: 'warn', message: 's2' }),
  ].join('\n');

  const stream = Readable.from([jsonl]);
  const source = new StreamSource(stream, 'test-stream');
  const entries = await source.read();

  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].message, 's1');
  assert.strictEqual(entries[1].level, 'warn');
});

test('StreamSource handles plain text lines', async () => {
  const text = 'plain line 1\nplain line 2\n';
  const stream = Readable.from([text]);
  const source = new StreamSource(stream, 'plain-stream');
  const entries = await source.read();

  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].message, 'plain line 1');
  assert.strictEqual(entries[1].message, 'plain line 2');
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test('LOG_LEVELS contains expected levels', () => {
  assert.strictEqual(LOG_LEVELS.DEBUG, 'debug');
  assert.strictEqual(LOG_LEVELS.INFO, 'info');
  assert.strictEqual(LOG_LEVELS.WARN, 'warn');
  assert.strictEqual(LOG_LEVELS.ERROR, 'error');
  assert.strictEqual(LOG_LEVELS.CRITICAL, 'critical');
});

test('LEVEL_WEIGHT is increasing by severity', () => {
  assert.ok(LEVEL_WEIGHT.debug < LEVEL_WEIGHT.info);
  assert.ok(LEVEL_WEIGHT.info < LEVEL_WEIGHT.warn);
  assert.ok(LEVEL_WEIGHT.warn < LEVEL_WEIGHT.error);
  assert.ok(LEVEL_WEIGHT.error < LEVEL_WEIGHT.critical);
});
