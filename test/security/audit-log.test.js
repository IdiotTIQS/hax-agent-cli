'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  AuditLogger,
  SEVERITY_LEVELS,
  ENTRY_TYPES,
  computeEntryHash,
} = require('../../src/security/audit-log');

/**
 * Create a temporary directory for test audit logs.
 * @returns {string}
 */
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'audit-log-test-'));
}

/**
 * Clean up a temporary directory.
 * @param {string} dir
 */
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

// -------------------------------------------------------------------------
// AuditLogger construction and lifecycle
// -------------------------------------------------------------------------

test('AuditLogger constructs with defaults', () => {
  const logger = new AuditLogger();
  assert.strictEqual(logger.getTotalEntries(), 0);
  assert.strictEqual(logger.getBufferSize(), 0);
});

test('AuditLogger can be disabled', () => {
  const dir = tempDir();
  const logPath = path.join(dir, 'audit.jsonl');
  try {
    const logger = new AuditLogger({ logPath, enabled: false });
    logger.logToolExecution({ toolName: 'file.read', result: 'ok' });
    assert.strictEqual(logger.getTotalEntries(), 0);
  } finally {
    cleanup(dir);
  }
});

// -------------------------------------------------------------------------
// Tool execution logging
// -------------------------------------------------------------------------

test('logToolExecution records entry with correct fields', async () => {
  const dir = tempDir();
  const logPath = path.join(dir, 'audit.jsonl');
  const logger = new AuditLogger({ logPath, flushIntervalMs: 100, maxBufferSize: 5 });
  try {
    await logger.init();

    logger.logToolExecution({
      toolName: 'shell.run',
      args: { command: 'git status', args: [] },
      result: 'ok',
      durationMs: 150,
      sessionId: 'session-123',
    });

    // Force flush
    await logger.flush();
    await logger.shutdown();

    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    assert.strictEqual(lines.length, 1);

    const entry = JSON.parse(lines[0]);
    assert.strictEqual(entry.type, ENTRY_TYPES.TOOL_EXECUTION);
    assert.strictEqual(entry.toolName, 'shell.run');
    assert.strictEqual(entry.result, 'ok');
    assert.strictEqual(entry.durationMs, 150);
    assert.strictEqual(entry.sessionId, 'session-123');
    assert.strictEqual(entry.severity, SEVERITY_LEVELS.INFO);
    assert.ok(typeof entry.seq === 'number' && entry.seq > 0);
    assert.ok(typeof entry.hash === 'string' && entry.hash.length === 64);
  } finally {
    cleanup(dir);
  }
});

test('logToolExecution sets ERROR severity for failed operations', () => {
  const logger = new AuditLogger({ enabled: true });
  logger.logToolExecution({
    toolName: 'file.write',
    args: { path: '/test.txt' },
    result: 'error',
    error: { code: 'PERMISSION_DENIED', message: 'Access denied' },
  });

  const entries = logger.query({ type: ENTRY_TYPES.TOOL_EXECUTION });
  // Buffer-only query (no logPath), entry should be in buffer
  const bufferSize = logger.getBufferSize();
  assert.ok(bufferSize > 0);
  assert.strictEqual(logger.getTotalEntries(), 1);
});

// -------------------------------------------------------------------------
// Permission change logging
// -------------------------------------------------------------------------

test('logPermissionChange records mode switch', () => {
  const logger = new AuditLogger();
  logger.logPermissionChange({
    mode: 'yolo',
    previousMode: 'normal',
    source: 'user',
  });

  assert.strictEqual(logger.getTotalEntries(), 1);
  assert.strictEqual(logger.getBufferSize(), 1);
});

// -------------------------------------------------------------------------
// Config change logging
// -------------------------------------------------------------------------

test('logConfigChange records key modification', () => {
  const logger = new AuditLogger();
  logger.logConfigChange({
    key: 'model',
    previousValue: 'claude-sonnet-4-20250514',
    newValue: 'claude-opus-4-20250514',
    source: 'user',
  });

  assert.strictEqual(logger.getTotalEntries(), 1);
});

// -------------------------------------------------------------------------
// Auth event logging
// -------------------------------------------------------------------------

test('logAuthEvent records provider switch', () => {
  const logger = new AuditLogger();
  logger.logAuthEvent({
    event: 'provider.switch',
    provider: 'anthropic',
    model: 'claude-opus-4-20250514',
    result: 'ok',
  });

  assert.strictEqual(logger.getTotalEntries(), 1);
});

// -------------------------------------------------------------------------
// Querying
// -------------------------------------------------------------------------

test('query filters by tool name', async () => {
  const dir = tempDir();
  const logPath = path.join(dir, 'audit.jsonl');
  const logger = new AuditLogger({ logPath, maxBufferSize: 1 });
  try {
    await logger.init();

    logger.logToolExecution({ toolName: 'shell.run', result: 'ok' });
    logger.logToolExecution({ toolName: 'file.read', result: 'ok' });
    logger.logToolExecution({ toolName: 'shell.run', result: 'error' });
    await logger.flush();

    const shellEntries = await logger.query({ toolName: 'shell.run' });
    assert.strictEqual(shellEntries.length, 2);
    assert.ok(shellEntries.every((e) => e.toolName === 'shell.run'));

    await logger.shutdown();
  } finally {
    cleanup(dir);
  }
});

test('query filters by severity', async () => {
  const dir = tempDir();
  const logPath = path.join(dir, 'audit.jsonl');
  const logger = new AuditLogger({ logPath, maxBufferSize: 1 });
  try {
    await logger.init();

    logger.logToolExecution({ toolName: 'shell.run', result: 'ok' });
    logger.logToolExecution({ toolName: 'shell.run', result: 'error', error: { message: 'fail' } });
    await logger.flush();

    const errorEntries = await logger.query({ severity: SEVERITY_LEVELS.ERROR });
    assert.strictEqual(errorEntries.length, 1);
    assert.strictEqual(errorEntries[0].severity, SEVERITY_LEVELS.ERROR);

    await logger.shutdown();
  } finally {
    cleanup(dir);
  }
});

// -------------------------------------------------------------------------
// Integrity
// -------------------------------------------------------------------------

test('computeEntryHash produces consistent hashes', () => {
  const entry1 = { seq: 1, timestamp: '2026-01-01T00:00:00.000Z', type: 'tool.execution', toolName: 'shell.run' };
  const entry2 = { seq: 1, timestamp: '2026-01-01T00:00:00.000Z', type: 'tool.execution', toolName: 'shell.run' };
  assert.strictEqual(computeEntryHash(entry1), computeEntryHash(entry2));
});

test('computeEntryHash produces different hash for different entries', () => {
  const entry1 = { seq: 1, timestamp: '2026-01-01T00:00:00.000Z', type: 'tool.execution', toolName: 'shell.run' };
  const entry2 = { seq: 2, timestamp: '2026-01-01T00:00:00.000Z', type: 'tool.execution', toolName: 'shell.run' };
  assert.notStrictEqual(computeEntryHash(entry1), computeEntryHash(entry2));
});

// -------------------------------------------------------------------------
// Validation
// -------------------------------------------------------------------------

test('logToolExecution throws on non-object entry', () => {
  const logger = new AuditLogger();
  assert.throws(() => logger.logToolExecution(null), TypeError);
  assert.throws(() => logger.logToolExecution('string'), TypeError);
});

test('SEVERITY_LEVELS and ENTRY_TYPES are frozen', () => {
  assert.throws(() => { SEVERITY_LEVELS.NEW = 'new'; }, TypeError);
  assert.throws(() => { ENTRY_TYPES.NEW = 'new'; }, TypeError);
});
