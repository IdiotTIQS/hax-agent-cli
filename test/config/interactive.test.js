"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const { ConfigEditor } = require('../../src/config/interactive');

// Helper: build a representative config
function sampleConfig() {
  return {
    agent: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      maxToolTurns: 20,
      maxTokens: 8192,
      temperature: 0.2,
    },
    tools: {
      shell: { enabled: true, timeoutMs: 10000, maxBuffer: 52428800, allowedCommands: ['*'] },
      file: { maxBytes: 512000, allowedPaths: ['*'] },
    },
    ui: { theme: 'dark', locale: 'en', vim: false },
    memory: { enabled: true, maxEntries: 20, evictionPolicy: 'lru' },
    context: { enabled: true, autoCompact: true, threshold: 0.8, reserveOutputTokens: 8192 },
    permissions: { mode: 'normal' },
  };
}

// -----------------------------------------------------------------------
// ConfigEditor.edit
// -----------------------------------------------------------------------

test('edit returns prompt descriptors for valid section', () => {
  const editor = new ConfigEditor(sampleConfig());
  const prompts = editor.edit('agent');

  assert.ok(Array.isArray(prompts));
  assert.ok(prompts.length > 0);

  const modelPrompt = prompts.find((p) => p.key === 'model');
  assert.ok(modelPrompt);
  assert.equal(modelPrompt.type, 'string');
  assert.equal(modelPrompt.currentValue, 'claude-sonnet-4-20250514');
  assert.equal(modelPrompt.default, 'claude-sonnet-4-20250514');
  assert.ok(typeof modelPrompt.description === 'string');
});

test('edit returns current values from config', () => {
  const editor = new ConfigEditor(sampleConfig());
  const prompts = editor.edit('memory');

  const enabled = prompts.find((p) => p.key === 'enabled');
  assert.equal(enabled.currentValue, true);

  const maxEntries = prompts.find((p) => p.key === 'maxEntries');
  assert.equal(maxEntries.currentValue, 20);

  const eviction = prompts.find((p) => p.key === 'evictionPolicy');
  assert.equal(eviction.currentValue, 'lru');
  assert.deepEqual(eviction.choices, ['lru', 'fifo', 'temporal', 'score']);
});

test('edit returns empty array for unknown section', () => {
  const editor = new ConfigEditor();
  assert.deepEqual(editor.edit('nonexistent'), []);
});

test('edit returns descriptors with choices for constrained fields', () => {
  const editor = new ConfigEditor(sampleConfig());
  const prompts = editor.edit('permissions');

  const mode = prompts.find((p) => p.key === 'mode');
  assert.ok(mode);
  assert.deepEqual(mode.choices, ['normal', 'ask', 'auto', 'yolo']);
});

// -----------------------------------------------------------------------
// ConfigEditor.diff
// -----------------------------------------------------------------------

test('diff detects added, removed, and changed values', () => {
  const oldConfig = { agent: { model: 'old-model' } };
  const newConfig = { agent: { model: 'new-model' } };
  const editor = new ConfigEditor(oldConfig);
  const changes = editor.diff(oldConfig, newConfig);

  const modelChange = changes.find((c) => c.path === 'agent.model');
  assert.ok(modelChange);
  assert.equal(modelChange.kind, 'changed');
  assert.equal(modelChange.oldValue, 'old-model');
  assert.equal(modelChange.newValue, 'new-model');
});

test('diff returns empty array for identical configs', () => {
  const config = sampleConfig();
  const editor = new ConfigEditor(config);
  const changes = editor.diff(config, config);
  assert.deepEqual(changes, []);
});

test('diff surfaces unknown keys for forward-compat', () => {
  const oldConfig = { agent: {}, pluginConfig: { foo: 1 } };
  const newConfig = { agent: {}, pluginConfig: { foo: 2 } };
  const editor = new ConfigEditor(oldConfig);
  const changes = editor.diff(oldConfig, newConfig);

  const unknownChange = changes.find((c) => c.path === 'pluginConfig.foo');
  assert.ok(unknownChange);
  assert.equal(unknownChange.kind, 'changed');
  assert.equal(unknownChange.oldValue, 1);
  assert.equal(unknownChange.newValue, 2);
});

// -----------------------------------------------------------------------
// ConfigEditor.explain
// -----------------------------------------------------------------------

test('explain returns details for a known setting', () => {
  const editor = new ConfigEditor(sampleConfig());
  const info = editor.explain('agent.model');

  assert.ok(info);
  assert.equal(info.key, 'agent.model');
  assert.equal(info.type, 'string');
  assert.equal(info.default, 'claude-sonnet-4-20250514');
  assert.ok(info.description.length > 0);
});

test('explain returns null for unknown setting', () => {
  const editor = new ConfigEditor();
  assert.equal(editor.explain('nonexistent.field'), null);
});

test('explain includes current value from constructor config', () => {
  const editor = new ConfigEditor({ agent: { provider: 'openai' } });
  const info = editor.explain('agent.provider');
  assert.equal(info.currentValue, 'openai');
});

// -----------------------------------------------------------------------
// ConfigEditor.validateFull
// -----------------------------------------------------------------------

test('validateFull returns no errors for valid config', () => {
  const editor = new ConfigEditor();
  const config = sampleConfig();
  const errors = editor.validateFull(config);
  assert.deepEqual(errors, []);
});

test('validateFull catches wrong type', () => {
  const editor = new ConfigEditor();
  const config = { agent: { model: 123 } };
  const errors = editor.validateFull(config);
  const modelError = errors.find((e) => e.path === 'agent.model');
  assert.ok(modelError);
  assert.ok(modelError.message.includes('string'));
});

test('validateFull catches out-of-range values', () => {
  const editor = new ConfigEditor();
  const config = { agent: { maxToolTurns: 500 } };
  const errors = editor.validateFull(config);
  const err = errors.find((e) => e.path === 'agent.maxToolTurns');
  assert.ok(err);
  assert.ok(err.message.includes('<= 200'));
});

test('validateFull catches invalid choices', () => {
  const editor = new ConfigEditor();
  const config = { permissions: { mode: 'dangerous' } };
  const errors = editor.validateFull(config);
  const err = errors.find((e) => e.path === 'permissions.mode');
  assert.ok(err);
  assert.ok(err.message.includes('one of'));
});

// -----------------------------------------------------------------------
// ConfigEditor.suggestFixes
// -----------------------------------------------------------------------

test('suggestFixes warns about missing API key', () => {
  const editor = new ConfigEditor();
  const suggestions = editor.suggestFixes({});
  const apiKeyFix = suggestions.find((s) => s.path === 'agent.apiKey');
  assert.ok(apiKeyFix);
  assert.equal(apiKeyFix.severity, 'error');
});

test('suggestFixes warns about yolo mode', () => {
  const editor = new ConfigEditor();
  const suggestions = editor.suggestFixes({ permissions: { mode: 'yolo' } });
  const yoloFix = suggestions.find((s) => s.path === 'permissions.mode');
  assert.ok(yoloFix);
  assert.equal(yoloFix.severity, 'warn');
});

test('suggestFixes warns about high maxToolTurns', () => {
  const editor = new ConfigEditor();
  const suggestions = editor.suggestFixes({ agent: { maxToolTurns: 100 } });
  const highTurns = suggestions.find((s) => s.path === 'agent.maxToolTurns');
  assert.ok(highTurns);
  assert.equal(highTurns.severity, 'warn');
});

test('suggestFixes does not warn for reasonable maxToolTurns', () => {
  const editor = new ConfigEditor();
  const suggestions = editor.suggestFixes({ agent: { maxToolTurns: 25 } });
  const highTurns = suggestions.find((s) => s.path === 'agent.maxToolTurns');
  assert.equal(highTurns, undefined);
});

test('suggestFixes returns empty for a valid config with API key', () => {
  const editor = new ConfigEditor();
  const config = { agent: { apiKey: 'sk-test', maxToolTurns: 25 }, permissions: { mode: 'normal' } };
  const suggestions = editor.suggestFixes(config);
  // Only check that no error-level suggestions exist
  const errors = suggestions.filter((s) => s.severity === 'error');
  assert.deepEqual(errors, []);
});

// -----------------------------------------------------------------------
// ConfigEditor.exportEnvVars
// -----------------------------------------------------------------------

test('exportEnvVars produces shell export lines', () => {
  const editor = new ConfigEditor();
  const config = { agent: { model: 'custom-model' }, memory: { enabled: true } };
  const output = editor.exportEnvVars(config);
  assert.ok(output.includes('export HAX_AGENT_MODEL='));
  assert.ok(output.includes('custom-model'));
  assert.ok(output.includes('export HAX_AGENT_MEMORY_ENABLED='));
});

test('exportEnvVars handles boolean values', () => {
  const editor = new ConfigEditor();
  const config = { memory: { enabled: true } };
  const output = editor.exportEnvVars(config);
  assert.ok(output.includes('1'));
});

test('exportEnvVars skips undefined values', () => {
  const editor = new ConfigEditor();
  const config = { agent: { model: undefined } };
  const output = editor.exportEnvVars(config);
  assert.ok(!output.includes('HAX_AGENT_MODEL'));
});

test('exportEnvVars skips entries without env var mapping', () => {
  const editor = new ConfigEditor();
  const config = { context: { autoCompact: true } };
  const output = editor.exportEnvVars(config);
  // autoCompact has no envVar defined in the schema
  assert.ok(!output.includes('autoCompact'));
});
