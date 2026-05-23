'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  createWebFetchPolicy,
  createShellPolicy,
  createFilePolicy,
  evaluateWebFetch,
  evaluateShell,
  evaluateFile,
  PolicyEngine,
  evaluateToolCall,
  checkPathAccess,
  checkExtension,
} = require('../../src/security/content-policy');

// -------------------------------------------------------------------------
// Web Fetch Policy
// -------------------------------------------------------------------------

test('createWebFetchPolicy builds with defaults', () => {
  const policy = createWebFetchPolicy();
  assert.strictEqual(policy.type, 'webFetch');
  assert.strictEqual(policy.enabled, true);
  assert.deepStrictEqual(policy.allowedDomains, []);
  assert.deepStrictEqual(policy.allowedPorts, [80, 443]);
  assert.strictEqual(policy.maxResponseBytes, 5 * 1024 * 1024);
  assert.strictEqual(policy.allowPrivateIps, false);
});

test('createWebFetchPolicy accepts options', () => {
  const policy = createWebFetchPolicy({
    allowedDomains: ['example.com'],
    blockedDomains: ['evil.com'],
    allowedPorts: [443],
    allowPrivateIps: true,
  });
  assert.deepStrictEqual(policy.allowedDomains, ['example.com']);
  assert.deepStrictEqual(policy.blockedDomains, ['evil.com']);
  assert.deepStrictEqual(policy.allowedPorts, [443]);
  assert.strictEqual(policy.allowPrivateIps, true);
});

test('evaluateWebFetch allows valid public URL', () => {
  const policy = createWebFetchPolicy();
  const result = evaluateWebFetch(policy, { url: 'https://example.com/api' });
  assert.strictEqual(result.allowed, true);
});

test('evaluateWebFetch blocks private IPs by default', () => {
  const policy = createWebFetchPolicy();
  const result = evaluateWebFetch(policy, { url: 'http://localhost/' });
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('private'));
});

test('evaluateWebFetch allows private IPs when configured', () => {
  const policy = createWebFetchPolicy({ allowPrivateIps: true });
  const result = evaluateWebFetch(policy, { url: 'http://127.0.0.1/' });
  assert.strictEqual(result.allowed, true);
});

test('evaluateWebFetch blocks disallowed domains', () => {
  const policy = createWebFetchPolicy({ allowedDomains: ['example.com'] });
  const denied = evaluateWebFetch(policy, { url: 'https://evil.com' });
  assert.strictEqual(denied.allowed, false);

  const allowed = evaluateWebFetch(policy, { url: 'https://example.com' });
  assert.strictEqual(allowed.allowed, true);
});

test('evaluateWebFetch blocks blocked domains even if allowed', () => {
  const policy = createWebFetchPolicy({
    allowedDomains: ['example.com'],
    blockedDomains: ['evil.example.com'],
  });
  const result = evaluateWebFetch(policy, { url: 'https://evil.example.com' });
  assert.strictEqual(result.allowed, false);
});

test('evaluateWebFetch blocks non-allowed ports', () => {
  const policy = createWebFetchPolicy({ allowedPorts: [443] });
  const result = evaluateWebFetch(policy, { url: 'http://example.com:8080' });
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('8080'));
});

// -------------------------------------------------------------------------
// Shell Policy
// -------------------------------------------------------------------------

test('createShellPolicy builds with defaults', () => {
  const policy = createShellPolicy();
  assert.strictEqual(policy.type, 'shell');
  assert.strictEqual(policy.enabled, true);
  assert.strictEqual(policy.maxArgs, 50);
  assert.strictEqual(policy.maxArgLength, 4096);
  assert.strictEqual(policy.allowPipes, false);
});

test('evaluateShell allows whitelisted commands', () => {
  const policy = createShellPolicy({ allowedCommands: ['git', 'npm'] });
  assert.strictEqual(evaluateShell(policy, { command: 'git status' }).allowed, true);
  assert.strictEqual(evaluateShell(policy, { command: 'npm install' }).allowed, true);
  assert.strictEqual(evaluateShell(policy, { command: 'rm -rf /' }).allowed, false);
});

test('evaluateShell blocks blacklisted commands', () => {
  const policy = createShellPolicy({ blockedCommands: ['rm', 'curl'] });
  const result = evaluateShell(policy, { command: 'rm -rf /' });
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('blocked'));
});

test('evaluateShell blocks pipes by default', () => {
  const policy = createShellPolicy();
  const result = evaluateShell(policy, { command: 'cat file.txt | grep foo' });
  assert.strictEqual(result.allowed, false);
});

test('evaluateShell allows pipes when configured', () => {
  const policy = createShellPolicy({ allowPipes: true });
  const result = evaluateShell(policy, { command: 'cat file.txt | grep foo' });
  assert.strictEqual(result.allowed, true);
});

// -------------------------------------------------------------------------
// File Policy
// -------------------------------------------------------------------------

test('createFilePolicy builds with defaults', () => {
  const policy = createFilePolicy();
  assert.strictEqual(policy.type, 'file');
  assert.strictEqual(policy.enabled, true);
  assert.strictEqual(policy.allowDelete, false);
  assert.strictEqual(policy.maxFileSizeBytes, 50 * 1024 * 1024);
});

test('evaluateFile blocks deletion by default', () => {
  const policy = createFilePolicy();
  const result = evaluateFile(policy, 'file.delete', { path: '/tmp/test.txt' });
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.includes('deletion'));
});

test('evaluateFile allows deletion when configured', () => {
  const policy = createFilePolicy({ allowDelete: true });
  const result = evaluateFile(policy, 'file.delete', { path: '/tmp/test.txt' });
  assert.strictEqual(result.allowed, true);
});

test('evaluateFile enforces allowed operations list', () => {
  const policy = createFilePolicy({ allowedOperations: ['file.read', 'file.glob'] });
  assert.strictEqual(evaluateFile(policy, 'file.read', { path: '/test.txt' }).allowed, true);
  assert.strictEqual(evaluateFile(policy, 'file.write', { path: '/test.txt' }).allowed, false);
});

// -------------------------------------------------------------------------
// Policy Engine
// -------------------------------------------------------------------------

test('PolicyEngine evaluates tool calls against all policies', () => {
  const engine = new PolicyEngine();
  engine.addPolicy(createWebFetchPolicy({ allowedDomains: ['example.com'] }));
  engine.addPolicy(createShellPolicy({ allowedCommands: ['git'] }));

  // Allowed operations
  assert.strictEqual(engine.evaluate('web.fetch', { url: 'https://example.com' }).allowed, true);
  assert.strictEqual(engine.evaluate('shell.run', { command: 'git status' }).allowed, true);

  // Denied operations
  assert.strictEqual(engine.evaluate('web.fetch', { url: 'https://evil.com' }).allowed, false);
  assert.strictEqual(engine.evaluate('shell.run', { command: 'rm -rf /' }).allowed, false);
});

test('PolicyEngine returns first denial reason', () => {
  const engine = new PolicyEngine();
  engine.addPolicy(createWebFetchPolicy({ allowedDomains: ['example.com'] }));
  const result = engine.evaluate('web.fetch', { url: 'https://evil.com' });
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason.length > 0);
  assert.ok(result.checkedPolicies >= 1);
});

test('PolicyEngine can add and remove policies', () => {
  const engine = new PolicyEngine();
  const policy = createShellPolicy({ allowedCommands: ['git'] });
  engine.addPolicy(policy);
  assert.strictEqual(engine.getPolicies().length, 1);

  engine.removePolicy(policy);
  assert.strictEqual(engine.getPolicies().length, 0);
});

test('evaluateToolCall standalone function works', () => {
  const policies = [
    createShellPolicy({ allowedCommands: ['git', 'npm'] }),
  ];
  assert.strictEqual(evaluateToolCall('shell.run', { command: 'git status' }, policies).allowed, true);
  assert.strictEqual(evaluateToolCall('shell.run', { command: 'rm -rf /' }, policies).allowed, false);
});

test('checkPathAccess validates against allowed and blocked paths', () => {
  const allowed = checkPathAccess(['/home/user/project'], [], '/home/user/project/src/file.js');
  assert.strictEqual(allowed.allowed, true);

  const blocked = checkPathAccess([], ['/etc'], '/etc/passwd');
  assert.strictEqual(blocked.allowed, false);
});

test('checkExtension validates against allowed and blocked extensions', () => {
  assert.strictEqual(checkExtension(['js', 'ts'], [], 'file.js').allowed, true);
  assert.strictEqual(checkExtension(['js', 'ts'], [], 'file.py').allowed, false);
  assert.strictEqual(checkExtension([], ['exe', 'bat'], 'malware.exe').allowed, false);
});
