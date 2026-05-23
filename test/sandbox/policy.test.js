'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { SandboxPolicy, ResourceLimits } = require('../../src/sandbox/policy');

// ---------------------------------------------------------------------------
// ResourceLimits
// ---------------------------------------------------------------------------

test('ResourceLimits creates with defaults', () => {
  const limits = new ResourceLimits();
  assert.strictEqual(limits.maxCpu, 5_000);
  assert.strictEqual(limits.maxMemory, 128 * 1024 * 1024);
  assert.strictEqual(limits.maxOutput, 1 * 1024 * 1024);
  assert.strictEqual(limits.maxTime, 30_000);
});

test('ResourceLimits accepts custom values', () => {
  const limits = new ResourceLimits({ maxCpu: 1000, maxMemory: 64 * 1024 * 1024, maxTime: 10_000 });
  assert.strictEqual(limits.maxCpu, 1000);
  assert.strictEqual(limits.maxMemory, 64 * 1024 * 1024);
  assert.strictEqual(limits.maxTime, 10_000);
  // untouched default
  assert.strictEqual(limits.maxOutput, 1 * 1024 * 1024);
});

test('ResourceLimits ignores invalid values', () => {
  const limits = new ResourceLimits({ maxCpu: -1, maxMemory: 0, maxTime: 'abc' });
  assert.strictEqual(limits.maxCpu, 5_000);
  assert.strictEqual(limits.maxMemory, 128 * 1024 * 1024);
  assert.strictEqual(limits.maxTime, 30_000);
});

test('ResourceLimits.merge returns a new frozen instance', () => {
  const base = new ResourceLimits({ maxCpu: 1000 });
  const merged = base.merge({ maxTime: 5000 });
  assert.notStrictEqual(merged, base);
  assert.strictEqual(merged.maxCpu, 1000);
  assert.strictEqual(merged.maxTime, 5000);
  // base unchanged
  assert.strictEqual(base.maxTime, 30_000);
});

// ---------------------------------------------------------------------------
// SandboxPolicy — construction
// ---------------------------------------------------------------------------

test('SandboxPolicy constructor requires a name', () => {
  assert.throws(() => new SandboxPolicy(''), { name: 'TypeError' });
  assert.throws(() => new SandboxPolicy(123), { name: 'TypeError' });
});

test('SandboxPolicy creates with options', () => {
  const policy = new SandboxPolicy('test', {
    allowedModules: ['fs', 'path'],
    deniedModules: ['child_process'],
    allowedCommands: ['ls', 'git'],
    allowedDomains: ['example.com'],
    resourceLimits: { maxTime: 15_000 },
  });

  assert.strictEqual(policy.name, 'test');
  assert.strictEqual(policy.isModuleAllowed('fs'), true);
  assert.strictEqual(policy.isModuleAllowed('path'), true);
  assert.strictEqual(policy.isModuleAllowed('child_process'), false);
  assert.strictEqual(policy.isCommandAllowed('ls'), true);
  assert.strictEqual(policy.isCommandAllowed('git'), true);
  assert.strictEqual(policy.isCommandAllowed('rm'), false);
  assert.strictEqual(policy.isDomainAllowed('example.com'), true);
  assert.strictEqual(policy.isDomainAllowed('evil.com'), false);
  assert.strictEqual(policy.getResourceLimits().maxTime, 15_000);
});

// ---------------------------------------------------------------------------
// SandboxPolicy — modules
// ---------------------------------------------------------------------------

test('allowModule adds to whitelist', () => {
  const policy = new SandboxPolicy('test');
  assert.strictEqual(policy.isModuleAllowed('fs'), false);
  policy.allowModule('fs');
  assert.strictEqual(policy.isModuleAllowed('fs'), true);
});

test('denyModule removes from whitelist and blocks', () => {
  const policy = new SandboxPolicy('test', { allowedModules: ['fs', 'path'] });
  assert.strictEqual(policy.isModuleAllowed('path'), true);
  policy.denyModule('path');
  assert.strictEqual(policy.isModuleAllowed('path'), false);
});

test('allowModule wildcard permits any module', () => {
  const policy = new SandboxPolicy('test');
  policy.allowModule('*');
  assert.strictEqual(policy.isModuleAllowed('fs'), true);
  assert.strictEqual(policy.isModuleAllowed('anything'), true);
  assert.strictEqual(policy.isModuleAllowed('child_process'), true);
});

test('denyModule takes precedence over wildcard', () => {
  const policy = new SandboxPolicy('test');
  policy.allowModule('*');
  policy.denyModule('child_process');
  assert.strictEqual(policy.isModuleAllowed('child_process'), false);
  assert.strictEqual(policy.isModuleAllowed('fs'), true);
});

// ---------------------------------------------------------------------------
// SandboxPolicy — commands
// ---------------------------------------------------------------------------

test('allowCommand / denyCommand with wildcard', () => {
  const policy = new SandboxPolicy('test');
  assert.strictEqual(policy.isCommandAllowed('ls'), false);
  policy.allowCommand('*');
  assert.strictEqual(policy.isCommandAllowed('ls'), true);
  assert.strictEqual(policy.isCommandAllowed('rm'), true);
  policy.denyCommand('rm');
  assert.strictEqual(policy.isCommandAllowed('rm'), false);
});

// ---------------------------------------------------------------------------
// SandboxPolicy — domains
// ---------------------------------------------------------------------------

test('isDomainAllowed respects whitelist', () => {
  const policy = new SandboxPolicy('test');
  assert.strictEqual(policy.isDomainAllowed('api.example.com'), false);
  policy.allowDomain('api.example.com');
  assert.strictEqual(policy.isDomainAllowed('api.example.com'), true);
  assert.strictEqual(policy.isDomainAllowed('other.com'), false);
});

test('isDomainAllowed wildcard', () => {
  const policy = new SandboxPolicy('test');
  policy.allowDomain('*');
  assert.strictEqual(policy.isDomainAllowed('anything.com'), true);
  assert.strictEqual(policy.isDomainAllowed('localhost'), true);
});

// ---------------------------------------------------------------------------
// SandboxPolicy — resource limits
// ---------------------------------------------------------------------------

test('setResourceLimits updates limits incrementally', () => {
  const policy = new SandboxPolicy('test');
  const before = policy.getResourceLimits();
  assert.strictEqual(before.maxTime, 30_000);

  policy.setResourceLimits({ maxTime: 60_000 });
  const after = policy.getResourceLimits();
  assert.strictEqual(after.maxTime, 60_000);
  // other defaults preserved
  assert.strictEqual(after.maxCpu, before.maxCpu);
});

// ---------------------------------------------------------------------------
// Built-in presets
// ---------------------------------------------------------------------------

test('STRICT policy denies everything', () => {
  const policy = SandboxPolicy.STRICT;
  assert.strictEqual(policy.name, 'STRICT');
  assert.strictEqual(policy.isModuleAllowed('fs'), false);
  assert.strictEqual(policy.isModuleAllowed('path'), false);
  assert.strictEqual(policy.isModuleAllowed('child_process'), false);
  assert.strictEqual(policy.isCommandAllowed('ls'), false);
  assert.strictEqual(policy.isCommandAllowed('git'), false);
  assert.strictEqual(policy.isDomainAllowed('example.com'), false);
});

test('READ_ONLY policy allows fs reads but not writes', () => {
  const policy = SandboxPolicy.READ_ONLY;
  assert.strictEqual(policy.name, 'READ_ONLY');
  assert.strictEqual(policy.isModuleAllowed('fs'), true);
  assert.strictEqual(policy.isModuleAllowed('path'), true);
  assert.strictEqual(policy.isModuleAllowed('child_process'), false);
  assert.strictEqual(policy.isCommandAllowed('ls'), true);
  assert.strictEqual(policy.isCommandAllowed('cat'), true);
  assert.strictEqual(policy.isCommandAllowed('rm'), false);
  assert.strictEqual(policy.isDomainAllowed('example.com'), false);
});

test('DEVELOPMENT policy allows common dev modules', () => {
  const policy = SandboxPolicy.DEVELOPMENT;
  assert.strictEqual(policy.name, 'DEVELOPMENT');
  assert.strictEqual(policy.isModuleAllowed('fs'), true);
  assert.strictEqual(policy.isModuleAllowed('crypto'), true);
  assert.strictEqual(policy.isModuleAllowed('net'), false);
  assert.strictEqual(policy.isCommandAllowed('ls'), true);
  assert.strictEqual(policy.isDomainAllowed('github.com'), true);
});

test('UNRESTRICTED policy allows everything', () => {
  const policy = SandboxPolicy.UNRESTRICTED;
  assert.strictEqual(policy.name, 'UNRESTRICTED');
  assert.strictEqual(policy.isModuleAllowed('fs'), true);
  assert.strictEqual(policy.isModuleAllowed('net'), true);
  assert.strictEqual(policy.isModuleAllowed('any-module'), true);
  assert.strictEqual(policy.isCommandAllowed('any-command'), true);
  assert.strictEqual(policy.isDomainAllowed('any-domain.io'), true);
  assert.strictEqual(policy.getResourceLimits().maxTime, 120_000);
});

// ---------------------------------------------------------------------------
// SandboxPolicy — toJSON snapshot
// ---------------------------------------------------------------------------

test('toJSON returns a readable snapshot', () => {
  const policy = new SandboxPolicy('my-policy', {
    allowedModules: ['fs'],
    deniedModules: ['net'],
    allowedCommands: ['ls'],
  });
  const snap = policy.toJSON();
  assert.strictEqual(snap.name, 'my-policy');
  assert.deepStrictEqual(snap.allowedModules, ['fs']);
  assert.deepStrictEqual(snap.deniedModules, ['net']);
  assert.deepStrictEqual(snap.allowedCommands, ['ls']);
  assert.ok(typeof snap.resourceLimits.maxCpu === 'number');
});

// ---------------------------------------------------------------------------
// Case insensitivity
// ---------------------------------------------------------------------------

test('Module and command checks are case-insensitive', () => {
  const policy = new SandboxPolicy('test');
  policy.allowModule('FS');
  assert.strictEqual(policy.isModuleAllowed('fs'), true);
  assert.strictEqual(policy.isModuleAllowed('Fs'), true);
  assert.strictEqual(policy.isModuleAllowed('FS'), true);

  policy.allowCommand('Ls');
  assert.strictEqual(policy.isCommandAllowed('ls'), true);
  assert.strictEqual(policy.isCommandAllowed('LS'), true);
});
