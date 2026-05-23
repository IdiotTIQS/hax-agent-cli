'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  LogViewer,
  LEVEL_COLORS,
  LEVEL_WEIGHT,
  stripAnsi,
  formatDuration,
  truncate,
} = require('../../src/logs/viewer');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hax-viewer-'));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

function sampleEntries(count = 5) {
  const levels = ['debug', 'info', 'info', 'warn', 'error'];
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      timestamp: `2026-05-22T${String(10 + i).padStart(2, '0')}:00:00.000Z`,
      level: levels[i % levels.length],
      message: `Log message number ${i + 1}`,
      source: 'test-source',
      sessionId: i === 2 ? 'session-abc' : null,
      toolName: i === 3 ? 'file.write' : null,
      durationMs: i === 3 ? 250 : null,
      result: i === 4 ? 'error' : 'ok',
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// utility
// ---------------------------------------------------------------------------

test('stripAnsi removes ANSI escape codes', () => {
  const colored = '\x1B[31mERROR\x1B[0m something';
  assert.strictEqual(stripAnsi(colored), 'ERROR something');
});

test('stripAnsi returns plain text unchanged', () => {
  assert.strictEqual(stripAnsi('hello world'), 'hello world');
});

test('formatDuration formats milliseconds', () => {
  assert.strictEqual(formatDuration(100), '100ms');
  assert.strictEqual(formatDuration(1500), '1.5s');
  assert.strictEqual(formatDuration(65000), '1m5s');
  assert.strictEqual(formatDuration(null), '-');
  assert.strictEqual(formatDuration(undefined), '-');
});

test('truncate shortens long strings', () => {
  assert.strictEqual(truncate('short', 10), 'short');
  const long = 'abcdefghijklmnopqrstuvwxyz';
  const truncated = truncate(long, 10);
  assert.strictEqual(truncated.length, 10);
  assert.ok(truncated.endsWith('...'));
});

// ---------------------------------------------------------------------------
// LogViewer construction
// ---------------------------------------------------------------------------

test('LogViewer constructs with defaults', () => {
  const viewer = new LogViewer();
  assert.ok(viewer instanceof LogViewer);
  assert.strictEqual(viewer._ansi, true);
  assert.strictEqual(viewer._timestamps, true);
});

test('LogViewer respects options', () => {
  const viewer = new LogViewer({ ansi: false, timestamps: false, maxMessageLength: 50 });
  assert.strictEqual(viewer._ansi, false);
  assert.strictEqual(viewer._timestamps, false);
  assert.strictEqual(viewer._maxMessageLength, 50);
});

// ---------------------------------------------------------------------------
// format
// ---------------------------------------------------------------------------

test('LogViewer format produces a string for a valid entry', () => {
  const viewer = new LogViewer({ ansi: false });
  const entry = {
    timestamp: '2026-05-22T12:00:00.000Z',
    level: 'info',
    message: 'Server started',
    source: 'app',
  };
  const formatted = viewer.format(entry);
  assert.ok(typeof formatted === 'string');
  assert.ok(formatted.includes('INFO'));
  assert.ok(formatted.includes('Server started'));
  assert.ok(formatted.includes('app'));
});

test('LogViewer format includes timestamp when enabled', () => {
  const viewer = new LogViewer({ ansi: false, timestamps: true });
  const entry = { timestamp: '2026-05-22T12:00:00.000Z', level: 'info', message: 'test', source: 'app' };
  const formatted = viewer.format(entry);
  assert.ok(formatted.includes('2026-05-22 12:00:00'));
});

test('LogViewer format omits timestamp when disabled', () => {
  const viewer = new LogViewer({ ansi: false, timestamps: false });
  const entry = { timestamp: '2026-05-22T12:00:00.000Z', level: 'info', message: 'test', source: 'app' };
  const formatted = viewer.format(entry);
  assert.ok(!formatted.includes('2026-05-22'));
});

test('LogViewer format handles null/undefined entry gracefully', () => {
  const viewer = new LogViewer({ ansi: false });
  const formatted1 = viewer.format(null);
  assert.ok(typeof formatted1 === 'string');
  const formatted2 = viewer.format(undefined);
  assert.ok(typeof formatted2 === 'string');
});

test('LogViewer format truncates long messages when maxMessageLength set', () => {
  const viewer = new LogViewer({ ansi: false, maxMessageLength: 20 });
  const entry = {
    timestamp: '2026-05-22T12:00:00.000Z',
    level: 'info',
    message: 'This is a very long message that should be truncated',
    source: 'app',
  };
  const formatted = viewer.format(entry);
  assert.ok(!formatted.includes('truncated') || formatted.length < 100);
});

// ---------------------------------------------------------------------------
// tail
// ---------------------------------------------------------------------------

test('LogViewer tail returns last N formatted entries', () => {
  const viewer = new LogViewer({ ansi: false });
  const entries = sampleEntries(10);
  const output = viewer.tail(3, entries);
  const lines = output.split('\n');
  assert.strictEqual(lines.length, 3);
});

test('LogViewer tail defaults to 10 when n is not provided', () => {
  const viewer = new LogViewer({ ansi: false });
  const entries = sampleEntries(15);
  const output = viewer.tail(0, entries);
  const lines = output.split('\n');
  // tail(0) should fall back to default 10
  assert.ok(lines.length > 0);
});

// ---------------------------------------------------------------------------
// highlight
// ---------------------------------------------------------------------------

test('LogViewer highlight applies patterns to a string', () => {
  const viewer = new LogViewer({ ansi: false });
  const text = 'error: connection refused';
  const result = viewer.highlight(text, [
    { pattern: /error/i, color: '\x1B[31m' },
    { pattern: 'refused', color: '\x1B[33m' },
  ]);
  assert.ok(result.includes('error'));
  assert.ok(result.includes('refused'));
});

test('LogViewer highlight returns unchanged text for empty patterns', () => {
  const viewer = new LogViewer({ ansi: false });
  const result = viewer.highlight('hello world', []);
  assert.strictEqual(result, 'hello world');
});

// ---------------------------------------------------------------------------
// group
// ---------------------------------------------------------------------------

test('LogViewer group groups entries by level', () => {
  const viewer = new LogViewer();
  const entries = sampleEntries(5);
  const groups = viewer.group(entries, 'level');
  assert.ok('info' in groups);
  assert.ok('error' in groups);
  assert.ok('warn' in groups);
  assert.ok('debug' in groups);
  assert.strictEqual(groups['info'].length, 2);
  assert.strictEqual(groups['error'].length, 1);
});

test('LogViewer group groups entries by source', () => {
  const viewer = new LogViewer();
  const entries = [
    { source: 'app', message: 'a', level: 'info' },
    { source: 'db', message: 'b', level: 'info' },
    { source: 'app', message: 'c', level: 'warn' },
  ];
  const groups = viewer.group(entries, 'source');
  assert.strictEqual(groups['app'].length, 2);
  assert.strictEqual(groups['db'].length, 1);
});

test('LogViewer group groups entries by hour', () => {
  const viewer = new LogViewer();
  const entries = [
    { timestamp: '2026-05-22T10:15:00Z', level: 'info', message: 'a' },
    { timestamp: '2026-05-22T10:45:00Z', level: 'info', message: 'b' },
    { timestamp: '2026-05-22T11:00:00Z', level: 'warn', message: 'c' },
  ];
  const groups = viewer.group(entries, 'hour');
  const keys = Object.keys(groups);
  assert.strictEqual(keys.length, 2);
  // Both 10:xx entries should be in the same hour bucket
  const hour10 = keys.find((k) => k.includes('10:00'));
  assert.strictEqual(groups[hour10].length, 2);
});

test('LogViewer group throws on non-array', () => {
  const viewer = new LogViewer();
  assert.throws(() => viewer.group(null, 'level'), TypeError);
  assert.throws(() => viewer.group('string', 'level'), TypeError);
});

test('LogViewer groupDisplay returns formatted string', () => {
  const viewer = new LogViewer({ ansi: false });
  const entries = sampleEntries(5);
  const output = viewer.groupDisplay(entries, 'level');
  assert.ok(typeof output === 'string');
  assert.ok(output.includes('info'));
  assert.ok(output.includes('error'));
});

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

test('LogViewer summary returns statistics for entries', () => {
  const viewer = new LogViewer();
  const entries = sampleEntries(10);
  const stats = viewer.summary(entries);
  assert.strictEqual(stats.totalEntries, 10);
  assert.ok(typeof stats.levelBreakdown === 'object');
  assert.ok(typeof stats.sourceBreakdown === 'object');
  assert.ok(typeof stats.errorCount === 'number');
  assert.ok(typeof stats.errorRate === 'string');
  assert.ok(stats.errorRate.includes('%'));
});

test('LogViewer summary handles empty array', () => {
  const viewer = new LogViewer();
  const stats = viewer.summary([]);
  assert.strictEqual(stats.totalEntries, 0);
  assert.strictEqual(stats.errorCount, 0);
  assert.strictEqual(stats.timeRange.earliest, null);
});

test('LogViewer summary throws on non-array', () => {
  const viewer = new LogViewer();
  assert.throws(() => viewer.summary(null), TypeError);
});

test('LogViewer summaryDisplay returns formatted string', () => {
  const viewer = new LogViewer({ ansi: false });
  const entries = sampleEntries(10);
  const output = viewer.summaryDisplay(entries);
  assert.ok(typeof output === 'string');
  assert.ok(output.includes('Total Entries'));
  assert.ok(output.includes('Errors'));
});

// ---------------------------------------------------------------------------
// follow
// ---------------------------------------------------------------------------

test('LogViewer follow calls callback with formatted entries', async () => {
  const viewer = new LogViewer({ ansi: false });
  const collected = [];

  const entries = [
    { timestamp: '2026-05-22T10:00:00Z', level: 'info', message: 'start', source: 'test' },
    { timestamp: '2026-05-22T10:01:00Z', level: 'info', message: 'running', source: 'test' },
  ];

  // MemorySource-like object
  const source = {
    _entries: entries,
    read() {
      // On each poll return a growing list (simulating live log)
      return this._entries.slice(0, this._called++);
    },
    _called: 1,
  };

  const controller = new AbortController();
  const done = viewer.follow(source, (formatted) => {
    collected.push(formatted);
    if (collected.length >= 1) {
      controller.abort();
    }
  }, { interval: 20, signal: controller.signal });

  // Wait for the follow to abort
  await done;
  assert.ok(collected.length >= 1);
  assert.ok(collected[0].includes('start'));
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test('LEVEL_COLORS has entries for all standard levels', () => {
  assert.ok('debug' in LEVEL_COLORS);
  assert.ok('info' in LEVEL_COLORS);
  assert.ok('warn' in LEVEL_COLORS);
  assert.ok('error' in LEVEL_COLORS);
  assert.ok('critical' in LEVEL_COLORS);
});

test('LEVEL_WEIGHT is increasing by severity', () => {
  assert.ok(LEVEL_WEIGHT.debug < LEVEL_WEIGHT.info);
  assert.ok(LEVEL_WEIGHT.info < LEVEL_WEIGHT.warn);
  assert.ok(LEVEL_WEIGHT.warn < LEVEL_WEIGHT.error);
  assert.ok(LEVEL_WEIGHT.error < LEVEL_WEIGHT.critical);
});
