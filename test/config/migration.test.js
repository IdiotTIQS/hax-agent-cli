"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LATEST_CONFIG_VERSION,
  MIGRATIONS,
  detectConfigVersion,
  needsMigration,
  migrateConfig,
} = require('../../src/config/migration');

// -----------------------------------------------------------------------
// detectConfigVersion
// -----------------------------------------------------------------------

test('detectConfigVersion returns 0 for empty object', () => {
  assert.equal(detectConfigVersion({}), 0);
});

test('detectConfigVersion returns 0 for null/undefined', () => {
  assert.equal(detectConfigVersion(null), 0);
  assert.equal(detectConfigVersion(undefined), 0);
});

test('detectConfigVersion returns 4 for v4 shape', () => {
  const v4 = {
    agent: { model: 'x', maxToolTurns: 20 },
    context: { autoCompact: true },
    tools: {
      shell: { enabled: true, timeoutMs: 10000, maxBuffer: 52428800 },
      file: { maxBytes: 512000, allowedPaths: ['*'] },
    },
  };
  assert.equal(detectConfigVersion(v4), 4);
});

test('detectConfigVersion returns 3 for v3 shape', () => {
  const v3 = {
    agent: { model: 'x', maxToolTurns: 20 },
    context: { windowTokens: 100000 },
    tools: {
      shell: { enabled: true, timeoutMs: 10000, maxBuffer: 52428800 },
    },
  };
  assert.equal(detectConfigVersion(v3), 3);
});

test('detectConfigVersion returns 2 for v2 shape (legacy maxTurns)', () => {
  const v2 = {
    agent: { model: 'x', maxTurns: 20 },
    context: { windowTokens: 100000 },
    tools: { enabled: true },
  };
  assert.equal(detectConfigVersion(v2), 2);
});

test('detectConfigVersion returns 1 for v1 shape (model only)', () => {
  const v1 = {
    agent: { model: 'claude-sonnet' },
  };
  assert.equal(detectConfigVersion(v1), 1);
});

// -----------------------------------------------------------------------
// needsMigration
// -----------------------------------------------------------------------

test('needsMigration returns true for old config', () => {
  assert.equal(needsMigration({ agent: { model: 'x' } }), true);
});

test('needsMigration returns false for latest config', () => {
  const v4 = {
    agent: { model: 'x', maxToolTurns: 20 },
    context: { autoCompact: true },
    tools: {
      shell: { enabled: true, timeoutMs: 10000, maxBuffer: 52428800 },
      file: { maxBytes: 512000, allowedPaths: ['*'] },
    },
  };
  assert.equal(needsMigration(v4), false);
});

test('needsMigration returns true for empty config', () => {
  assert.equal(needsMigration({}), true);
});

// -----------------------------------------------------------------------
// migrateConfig
// -----------------------------------------------------------------------

test('migrateConfig v0 to latest produces v4 shape', () => {
  const result = migrateConfig({});
  assert.equal(result.applied.length, 4);
  assert.ok(result.config.agent);
  assert.ok(result.config.agent.model);
  assert.ok(result.config.agent.maxToolTurns);
  assert.ok(result.config.tools.shell);
  assert.ok('maxBuffer' in result.config.tools.shell);
  assert.ok(result.config.tools.file);
  assert.ok('maxBytes' in result.config.tools.file);
  assert.ok(result.config.context);
  assert.ok('autoCompact' in result.config.context);
  assert.ok(result.config.permissions);
  assert.ok('persistPath' in result.config.permissions);
});

test('migrateConfig v1 to v2 renames maxTurns to maxToolTurns', () => {
  const config = { agent: { model: 'x', maxTurns: 30 } };
  const result = migrateConfig(config, 1, 2);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].from, 1);
  assert.equal(result.applied[0].to, 2);
  assert.ok(!('maxTurns' in result.config.agent));
  assert.equal(result.config.agent.maxToolTurns, 30);
});

test('migrateConfig preserves unknown keys', () => {
  const config = {
    agent: { model: 'x', maxTurns: 15, customField: 'keep-me' },
    myPlugin: { version: 2 },
  };
  const result = migrateConfig(config);
  assert.equal(result.config.agent.customField, 'keep-me');
  assert.deepEqual(result.config.myPlugin, { version: 2 });
});

test('migrateConfig does not mutate original', () => {
  const original = { agent: { model: 'x', maxTurns: 15 } };
  const result = migrateConfig(original, 1, 2);
  assert.ok('maxTurns' in original.agent);
  assert.equal(original.agent.maxTurns, 15);
  assert.ok(!('maxTurns' in result.config.agent));
});

test('migrateConfig from v2 to v3 creates tools.shell', () => {
  const config = {
    agent: { model: 'x', maxToolTurns: 20 },
    tools: { enabled: false, timeoutMs: 5000 },
  };
  const result = migrateConfig(config, 2, 3);
  assert.equal(result.applied.length, 1);
  assert.equal(result.config.tools.shell.enabled, false);
  assert.equal(result.config.tools.shell.timeoutMs, 5000);
  assert.equal(result.config.tools.shell.maxBuffer, 52428800);
});

test('migrateConfig from v3 to v4 adds tools.file', () => {
  const config = {
    agent: { model: 'x', maxToolTurns: 20 },
    context: { windowTokens: 100000 },
    tools: { shell: { enabled: true, timeoutMs: 10000, maxBuffer: 52428800 } },
  };
  const result = migrateConfig(config, 3, 4);
  assert.equal(result.applied.length, 1);
  assert.ok(result.config.tools.file);
  assert.equal(result.config.tools.file.maxBytes, 512000);
  assert.deepEqual(result.config.tools.file.allowedPaths, ['*']);
  assert.equal(result.config.context.autoCompact, false);
});

test('migrateConfig same version returns no migrations', () => {
  const config = {};
  const result = migrateConfig(config, 0, 0);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.config, config);
});

test('migrateConfig throws for invalid range', () => {
  assert.throws(() => {
    migrateConfig({}, -1);
  }, /Invalid migration range/);
  assert.throws(() => {
    migrateConfig({}, 0, 999);
  }, /Invalid migration range/);
});

// -----------------------------------------------------------------------
// MIGRATIONS registry
// -----------------------------------------------------------------------

test('MIGRATIONS is ordered and complete', () => {
  for (let i = 0; i < MIGRATIONS.length; i++) {
    assert.equal(MIGRATIONS[i].from, i);
    assert.equal(MIGRATIONS[i].to, i + 1);
    assert.ok(typeof MIGRATIONS[i].description === 'string');
    assert.ok(typeof MIGRATIONS[i].fn === 'function');
  }
  assert.equal(MIGRATIONS[MIGRATIONS.length - 1].to, LATEST_CONFIG_VERSION);
});
