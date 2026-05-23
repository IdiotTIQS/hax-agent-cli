'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const fsp = require('node:fs/promises');
const {
  exportAsJson,
  exportAsCsv,
  exportAsText,
  exportAsHtml,
  exportFiltered,
  rotateExport,
  csvEscape,
  inferCsvColumns,
  formatTs,
} = require('../../src/logs/export');
const { LogAggregator, MemorySource } = require('../../src/logs/aggregator');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hax-export-'));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

function sampleLogs(count = 5) {
  const levels = ['debug', 'info', 'warn', 'error', 'info'];
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      timestamp: `2026-05-22T${String(10 + i).padStart(2, '0')}:00:00.000Z`,
      level: levels[i % levels.length],
      message: `Log entry number ${i + 1}`,
      source: 'test-app',
      sessionId: i === 2 ? 'sess-123' : null,
      toolName: i === 3 ? 'file.write' : null,
      durationMs: i === 3 ? 150 : null,
      result: i === 4 ? 'error' : 'ok',
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

test('csvEscape wraps values with commas in quotes', () => {
  assert.strictEqual(csvEscape('hello,world'), '"hello,world"');
});

test('csvEscape escapes double quotes', () => {
  assert.strictEqual(csvEscape('say "hi"'), '"say ""hi"""');
});

test('csvEscape returns empty string for null/undefined', () => {
  assert.strictEqual(csvEscape(null), '');
  assert.strictEqual(csvEscape(undefined), '');
});

test('inferCsvColumns extracts columns from entries', () => {
  const entries = [
    { timestamp: '2026-01-01', level: 'info', message: 'm1', extra: 'x' },
    { timestamp: '2026-01-02', level: 'warn', message: 'm2', raw: {} },
  ];
  const cols = inferCsvColumns(entries);
  assert.ok(cols.includes('timestamp'));
  assert.ok(cols.includes('level'));
  assert.ok(cols.includes('message'));
  assert.ok(cols.includes('extra'));
  // Priority fields come first
  assert.strictEqual(cols[0], 'timestamp');
  assert.strictEqual(cols[1], 'level');
  assert.strictEqual(cols[2], 'message');
});

test('formatTs formats timestamps', () => {
  assert.strictEqual(formatTs(null), '-------------------');
  assert.ok(formatTs('2026-05-22T12:30:00.000Z').includes('2026-05-22 12:30:00'));
});

// ---------------------------------------------------------------------------
// exportAsJson
// ---------------------------------------------------------------------------

test('exportAsJson writes pretty JSON to file', async () => {
  const dir = tempDir();
  const filePath = path.join(dir, 'logs.json');
  try {
    const logs = sampleLogs(3);
    const result = await exportAsJson(logs, filePath);

    assert.strictEqual(result.path, filePath);
    assert.strictEqual(result.count, 3);
    assert.ok(result.size > 0);

    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.length, 3);
    assert.strictEqual(parsed[0].message, 'Log entry number 1');
  } finally {
    cleanup(dir);
  }
});

test('exportAsJson supports compact output', async () => {
  const dir = tempDir();
  const filePath = path.join(dir, 'compact.json');
  try {
    const logs = sampleLogs(2);
    const result = await exportAsJson(logs, filePath, { pretty: false });

    const content = fs.readFileSync(filePath, 'utf8');
    // Compact JSON: no newlines between entries
    assert.ok(!content.includes('\n  '));
    assert.strictEqual(result.count, 2);
  } finally {
    cleanup(dir);
  }
});

test('exportAsJson throws on non-array input', async () => {
  await assert.rejects(() => exportAsJson('not-array', '/tmp/test.json'), TypeError);
});

// ---------------------------------------------------------------------------
// exportAsCsv
// ---------------------------------------------------------------------------

test('exportAsCsv writes CSV with header', async () => {
  const dir = tempDir();
  const filePath = path.join(dir, 'logs.csv');
  try {
    const logs = sampleLogs(3);
    const result = await exportAsCsv(logs, filePath);

    assert.strictEqual(result.count, 3);
    assert.ok(result.size > 0);

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    assert.strictEqual(lines.length, 4); // header + 3 data rows
    assert.ok(lines[0].startsWith('timestamp')); // header
  } finally {
    cleanup(dir);
  }
});

test('exportAsCsv supports explicit column order', async () => {
  const dir = tempDir();
  const filePath = path.join(dir, 'ordered.csv');
  try {
    const logs = [{ message: 'm', level: 'info', timestamp: '2026-01-01' }];
    const result = await exportAsCsv(logs, filePath, {
      columns: ['level', 'message', 'timestamp'],
    });
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.startsWith('level,message,timestamp'));
  } finally {
    cleanup(dir);
  }
});

test('exportAsCsv throws on non-array input', async () => {
  await assert.rejects(() => exportAsCsv(null, '/tmp/test.csv'), TypeError);
});

// ---------------------------------------------------------------------------
// exportAsText
// ---------------------------------------------------------------------------

test('exportAsText writes human-readable text', async () => {
  const dir = tempDir();
  const filePath = path.join(dir, 'logs.txt');
  try {
    const logs = sampleLogs(3);
    const result = await exportAsText(logs, filePath);

    assert.strictEqual(result.count, 3);
    assert.ok(result.size > 0);

    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('HaxAgent Log Export'));
    assert.ok(content.includes('Log entry number 1'));
    assert.ok(content.includes('Log entry number 3'));
  } finally {
    cleanup(dir);
  }
});

test('exportAsText throws on non-array input', async () => {
  await assert.rejects(() => exportAsText(123, '/tmp/test.txt'), TypeError);
});

// ---------------------------------------------------------------------------
// exportAsHtml
// ---------------------------------------------------------------------------

test('exportAsHtml writes styled HTML document', async () => {
  const dir = tempDir();
  const filePath = path.join(dir, 'logs.html');
  try {
    const logs = sampleLogs(3);
    const result = await exportAsHtml(logs, filePath);

    assert.strictEqual(result.count, 3);
    assert.ok(result.size > 0);

    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('<!DOCTYPE html>'));
    assert.ok(content.includes('<title>HaxAgent Log Export'));
    assert.ok(content.includes('Log entry number 1'));
    assert.ok(content.includes('level-error'));
  } finally {
    cleanup(dir);
  }
});

test('exportAsHtml throws on non-array input', async () => {
  await assert.rejects(() => exportAsHtml('bad', '/tmp/test.html'), TypeError);
});

// ---------------------------------------------------------------------------
// exportFiltered
// ---------------------------------------------------------------------------

test('exportFiltered filters and exports in one step (JSON)', async () => {
  const dir = tempDir();
  const filePath = path.join(dir, 'filtered.json');
  try {
    const agg = new LogAggregator();
    const mem = new MemorySource([
      { timestamp: '2026-01-01T00:00:00Z', level: 'info', message: 'ok' },
      { timestamp: '2026-01-01T00:01:00Z', level: 'error', message: 'fail' },
      { timestamp: '2026-01-01T00:02:00Z', level: 'error', message: 'fail again' },
    ], 'app');
    agg.addSource('app', mem);

    const result = await exportFiltered(agg, { level: 'error' }, 'json', filePath);
    assert.strictEqual(result.count, 2);

    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.strictEqual(content.length, 2);
    assert.ok(content.every((e) => e.level === 'error'));
  } finally {
    cleanup(dir);
  }
});

test('exportFiltered supports CSV format', async () => {
  const dir = tempDir();
  const filePath = path.join(dir, 'filtered.csv');
  try {
    const agg = new LogAggregator();
    agg.addSource('app', new MemorySource([
      { timestamp: '2026-01-01', level: 'info', message: 'm1' },
    ], 'app'));

    const result = await exportFiltered(agg, {}, 'csv', filePath);
    assert.strictEqual(result.count, 1);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('timestamp'));
  } finally {
    cleanup(dir);
  }
});

test('exportFiltered throws on invalid format', async () => {
  const agg = new LogAggregator();
  agg.addSource('app', new MemorySource([], 'app'));
  await assert.rejects(
    () => exportFiltered(agg, {}, 'xml', '/tmp/test.xml'),
    TypeError,
  );
});

// ---------------------------------------------------------------------------
// rotateExport
// ---------------------------------------------------------------------------

test('rotateExport removes old files keeping only N most recent', async () => {
  const dir = tempDir();
  try {
    // Create 5 export files
    const files = [];
    for (let i = 1; i <= 5; i++) {
      const name = `log-export-${String(i).padStart(3, '0')}.json`;
      const p = path.join(dir, name);
      files.push(p);
      await fsp.writeFile(p, `data-${i}`, 'utf8');
      // Stagger timestamps by small delay to ensure distinct mtimes
      await new Promise((r) => setTimeout(r, 5));
    }

    const result = await rotateExport(dir, 3, { prefix: 'log-export-' });
    assert.strictEqual(result.deleted.length, 2);
    assert.strictEqual(result.retained.length, 3);

    // Check that oldest files were deleted
    for (const del of result.deleted) {
      assert.ok(!fs.existsSync(del));
    }
    for (const keep of result.retained) {
      assert.ok(fs.existsSync(keep));
    }
  } finally {
    cleanup(dir);
  }
});

test('rotateExport handles non-existent directory gracefully', async () => {
  const result = await rotateExport('/nonexistent/export/dir', 5);
  assert.strictEqual(result.deleted.length, 0);
  assert.strictEqual(result.retained.length, 0);
});

test('rotateExport uses default prefix when not specified', async () => {
  const dir = tempDir();
  try {
    await fsp.writeFile(path.join(dir, 'log-export-test.json'), 'data');
    const result = await rotateExport(dir, 10);
    assert.strictEqual(result.retained.length, 1);
  } finally {
    cleanup(dir);
  }
});
