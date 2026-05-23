"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const { getPreset, listPresets, applyPreset, PRESETS } = require('../src/config-presets');

test('listPresets returns all 6 presets', () => {
  const presets = listPresets();
  assert.equal(presets.length, 6);
  const names = presets.map(p => p.name).sort();
  assert.deepEqual(names, ['autonomous', 'chat', 'ci', 'coding', 'learn', 'review']);
});

test('each preset has a description', () => {
  for (const preset of listPresets()) {
    assert.ok(preset.description.length > 0, `${preset.name} has description`);
  }
});

test('getPreset returns a copy', () => {
  const coding1 = getPreset('coding');
  const coding2 = getPreset('coding');
  assert.notStrictEqual(coding1, coding2);
  assert.deepEqual(coding1, coding2);
  coding1.agent.maxToolTurns = 999;
  assert.notEqual(coding1.agent.maxToolTurns, coding2.agent.maxToolTurns);
});

test('getPreset returns null for unknown preset', () => {
  assert.equal(getPreset('nonexistent'), null);
});

test('applyPreset merges into empty settings', () => {
  const result = applyPreset({}, 'coding');
  assert.equal(result.agent.maxToolTurns, 25);
  assert.equal(result.context.autoCompact, true);
});

test('applyPreset preserves existing settings', () => {
  const existing = { agent: { model: 'claude-sonnet', apiKey: 'sk-123' } };
  const result = applyPreset(existing, 'chat');
  assert.equal(result.agent.model, 'claude-sonnet');
  assert.equal(result.agent.apiKey, 'sk-123');
  assert.equal(result.agent.maxToolTurns, 5);
});

test('applyPreset returns original for unknown preset', () => {
  const settings = { agent: { model: 'test' } };
  const result = applyPreset(settings, 'unknown');
  assert.strictEqual(result, settings);
});

test('autonomous preset has high maxToolTurns', () => {
  const preset = getPreset('autonomous');
  assert.equal(preset.agent.maxToolTurns, 100);
  assert.equal(preset.permissions.mode, 'auto');
});

test('ci preset uses yolo permissions', () => {
  const preset = getPreset('ci');
  assert.equal(preset.permissions.mode, 'yolo');
  assert.equal(preset.context.autoCompact, true);
});

test('review preset disables shell', () => {
  const preset = getPreset('review');
  assert.equal(preset.tools.shell.enabled, false);
});

test('learn preset has educational system prompt', () => {
  const preset = getPreset('learn');
  assert.ok(preset.agent.systemPrompt.includes('Explain'));
});

test('PRESETS is frozen', () => {
  assert.throws(() => { PRESETS.coding = null; }, /frozen|read.only/i);
});
