"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AGENT_SCHEMA,
  TOOLS_SCHEMA,
  UI_SCHEMA,
  MEMORY_SCHEMA,
  CONTEXT_SCHEMA,
  PERMISSIONS_SCHEMA,
  ALL_SECTIONS,
  lookupEntry,
  flattenSchema,
  schemaDefaults,
  validateEntry,
} = require('../../src/config/schema');

// -----------------------------------------------------------------------
// schema structure
// -----------------------------------------------------------------------

test('AGENT_SCHEMA has all required entries', () => {
  const keys = AGENT_SCHEMA.map((e) => e.key);
  assert.ok(keys.includes('provider'));
  assert.ok(keys.includes('model'));
  assert.ok(keys.includes('apiKey'));
  assert.ok(keys.includes('apiUrl'));
  assert.ok(keys.includes('maxToolTurns'));
  assert.ok(keys.includes('maxTokens'));
  assert.ok(keys.includes('temperature'));
  assert.ok(keys.includes('systemPrompt'));
});

test('every schema entry has key, type, description, and default field', () => {
  for (const entry of flattenSchema()) {
    assert.ok(typeof entry.key === 'string', `${entry.path}: missing key`);
    assert.ok(typeof entry.type === 'string', `${entry.path}: missing type`);
    assert.ok(typeof entry.description === 'string', `${entry.path}: missing description`);
    assert.ok('default' in entry, `${entry.path}: missing default`);
  }
});

test('TOOLS_SCHEMA splits shell and file settings', () => {
  const keys = TOOLS_SCHEMA.map((e) => e.key);
  assert.ok(keys.includes('shell.enabled'));
  assert.ok(keys.includes('shell.timeoutMs'));
  assert.ok(keys.includes('shell.maxBuffer'));
  assert.ok(keys.includes('shell.allowedCommands'));
  assert.ok(keys.includes('file.maxBytes'));
  assert.ok(keys.includes('file.allowedPaths'));
});

test('UI_SCHEMA includes theme, locale, color, vim', () => {
  const keys = UI_SCHEMA.map((e) => e.key);
  assert.ok(keys.includes('theme'));
  assert.ok(keys.includes('locale'));
  assert.ok(keys.includes('color'));
  assert.ok(keys.includes('vim'));
});

test('PERMISSIONS_SCHEMA choices match expected modes', () => {
  const modeEntry = PERMISSIONS_SCHEMA.find((e) => e.key === 'mode');
  assert.ok(modeEntry);
  assert.deepEqual(modeEntry.choices, ['normal', 'ask', 'auto', 'yolo']);
  assert.equal(modeEntry.default, 'normal');
});

test('MEMORY_SCHEMA has evictionPolicy with choices', () => {
  const evictionEntry = MEMORY_SCHEMA.find((e) => e.key === 'evictionPolicy');
  assert.ok(evictionEntry);
  assert.deepEqual(evictionEntry.choices, ['lru', 'fifo', 'temporal', 'score']);
});

// -----------------------------------------------------------------------
// lookupEntry
// -----------------------------------------------------------------------

test('lookupEntry resolves dotted paths', () => {
  const entry = lookupEntry('agent.model');
  assert.ok(entry);
  assert.equal(entry.key, 'model');
  assert.equal(entry.type, 'string');
  assert.equal(entry.default, 'claude-sonnet-4-20250514');
});

test('lookupEntry returns null for unknown paths', () => {
  assert.equal(lookupEntry('nonexistent.field'), null);
  assert.equal(lookupEntry('agent.nonexistent'), null);
});

test('lookupEntry resolves nested tool paths', () => {
  const entry = lookupEntry('tools.shell.enabled');
  assert.ok(entry);
  assert.equal(entry.key, 'shell.enabled');
  assert.equal(entry.type, 'boolean');
});

// -----------------------------------------------------------------------
// flattenSchema
// -----------------------------------------------------------------------

test('flattenSchema returns all entries with path property', () => {
  const flat = flattenSchema();
  assert.ok(flat.length > 20);
  for (const entry of flat) {
    assert.ok(typeof entry.path === 'string', 'each flat entry has a path');
    assert.ok(entry.path.includes('.'), 'path is dotted');
  }
});

// -----------------------------------------------------------------------
// schemaDefaults
// -----------------------------------------------------------------------

test('schemaDefaults returns a complete default config object', () => {
  const defaults = schemaDefaults();
  assert.equal(defaults.agent.provider, 'anthropic');
  assert.equal(defaults.agent.model, 'claude-sonnet-4-20250514');
  assert.equal(defaults.agent.maxToolTurns, 20);
  assert.equal(defaults.ui.theme, 'dark');
  assert.equal(defaults.ui.locale, 'en');
  assert.equal(defaults.memory.enabled, true);
  assert.equal(defaults.memory.evictionPolicy, 'lru');
  assert.equal(defaults.context.autoCompact, true);
  assert.equal(defaults.context.threshold, 0.8);
  assert.equal(defaults.permissions.mode, 'normal');
  assert.ok(defaults.tools.shell);
  assert.ok(defaults.tools.file);
});

// -----------------------------------------------------------------------
// validateEntry
// -----------------------------------------------------------------------

test('validateEntry accepts valid values', () => {
  const entry = lookupEntry('agent.maxToolTurns');
  assert.equal(validateEntry(entry, 20), null);
  assert.equal(validateEntry(entry, 1), null);
  assert.equal(validateEntry(entry, 200), null);
});

test('validateEntry rejects value below min', () => {
  const entry = lookupEntry('agent.maxToolTurns');
  const err = validateEntry(entry, 0);
  assert.ok(err);
  assert.ok(err.includes('>= 1'));
});

test('validateEntry rejects value above max', () => {
  const entry = lookupEntry('agent.maxToolTurns');
  const err = validateEntry(entry, 201);
  assert.ok(err);
  assert.ok(err.includes('<= 200'));
});

test('validateEntry rejects value not in choices', () => {
  const entry = lookupEntry('permissions.mode');
  const err = validateEntry(entry, 'unknown-mode');
  assert.ok(err);
  assert.ok(err.includes('one of'));
});

test('validateEntry rejects wrong type', () => {
  const entry = lookupEntry('agent.model');
  const err = validateEntry(entry, 123);
  assert.ok(err);
  assert.ok(err.includes('string'));
});

test('validateEntry passes undefined values (absent keys)', () => {
  const entry = lookupEntry('agent.model');
  assert.equal(validateEntry(entry, undefined), null);
});

test('validateEntry runs custom validate function', () => {
  const entry = lookupEntry('ui.color');
  const err = validateEntry(entry, 'not-a-color');
  assert.ok(err);
  assert.ok(err.includes('custom validation'));

  assert.equal(validateEntry(entry, '#ff6600'), null);
  assert.equal(validateEntry(entry, undefined), null);
});

// -----------------------------------------------------------------------
// all sections present
// -----------------------------------------------------------------------

test('ALL_SECTIONS contains all expected section names', () => {
  const names = Object.keys(ALL_SECTIONS).sort();
  assert.deepEqual(names, [
    'agent', 'context', 'desktop', 'fileContext',
    'memory', 'permissions', 'prompts', 'sessions',
    'tools', 'ui', 'updates',
  ]);
});

test('all schemas are frozen', () => {
  for (const schema of [AGENT_SCHEMA, TOOLS_SCHEMA, UI_SCHEMA, MEMORY_SCHEMA, CONTEXT_SCHEMA, PERMISSIONS_SCHEMA]) {
    assert.throws(() => { schema.push({}); }, /frozen|read.only|not extensible/i);
  }
});
