const { test } = require('node:test');
const assert = require('node:assert');
const {
  PermissionLevel,
  PermissionManager,
  TOOL_PERMISSIONS,
  getToolPermission,
  getShellCommandPermission,
  getWebFetchPermission,
  isPrivateOrLocalHost,
  formatToolDescription,
} = require('../src/permissions');

test('PermissionLevel values', () => {
  assert.strictEqual(PermissionLevel.AUTO, 'auto');
  assert.strictEqual(PermissionLevel.ASK, 'ask');
  assert.strictEqual(PermissionLevel.DANGEROUS, 'dangerous');
});

test('TOOL_PERMISSIONS mappings', () => {
  assert.strictEqual(TOOL_PERMISSIONS['file.read'], PermissionLevel.AUTO);
  assert.strictEqual(TOOL_PERMISSIONS['file.write'], PermissionLevel.ASK);
  assert.strictEqual(TOOL_PERMISSIONS['file.edit'], PermissionLevel.ASK);
  assert.strictEqual(TOOL_PERMISSIONS['file.delete'], PermissionLevel.DANGEROUS);
  assert.strictEqual(TOOL_PERMISSIONS['web.fetch'], null);
  assert.strictEqual(TOOL_PERMISSIONS['shell.run'], null);
});

test('getToolPermission returns correct levels', () => {
  assert.strictEqual(getToolPermission('file.read', {}), PermissionLevel.AUTO);
  assert.strictEqual(getToolPermission('file.write', {}), PermissionLevel.ASK);
  assert.strictEqual(getToolPermission('file.delete', {}), PermissionLevel.DANGEROUS);
  assert.strictEqual(getToolPermission('shell.run', { command: 'rm -rf' }), PermissionLevel.DANGEROUS);
  assert.strictEqual(getToolPermission('shell.run', { command: 'ls' }), PermissionLevel.AUTO);
  assert.strictEqual(getToolPermission('shell.run', { command: 'git status' }), PermissionLevel.AUTO);
  assert.strictEqual(getToolPermission('shell.run', { command: 'curl' }), PermissionLevel.DANGEROUS);
  assert.strictEqual(getToolPermission('shell.run', { command: 'node -e 1' }), PermissionLevel.AUTO);
  assert.strictEqual(getToolPermission('shell.run', { command: 'unknown_command' }), PermissionLevel.ASK);
  assert.strictEqual(getToolPermission('web.fetch', { url: 'https://example.com' }), PermissionLevel.AUTO);
  assert.strictEqual(getToolPermission('web.fetch', { url: 'http://127.0.0.1:3000' }), PermissionLevel.ASK);
});

test('getShellCommandPermission', () => {
  assert.strictEqual(getShellCommandPermission('git'), PermissionLevel.AUTO);
  assert.strictEqual(getShellCommandPermission('ls'), PermissionLevel.AUTO);
  assert.strictEqual(getShellCommandPermission('which'), PermissionLevel.AUTO);
  assert.strictEqual(getShellCommandPermission('rm'), PermissionLevel.DANGEROUS);
  assert.strictEqual(getShellCommandPermission('curl'), PermissionLevel.DANGEROUS);
});

test('getWebFetchPermission flags private and local addresses', () => {
  assert.strictEqual(getWebFetchPermission('https://example.com'), PermissionLevel.AUTO);
  assert.strictEqual(getWebFetchPermission('http://localhost:3000'), PermissionLevel.ASK);
  assert.strictEqual(getWebFetchPermission('http://127.0.0.1:3000'), PermissionLevel.ASK);
  assert.strictEqual(getWebFetchPermission('http://10.0.0.2'), PermissionLevel.ASK);
  assert.strictEqual(getWebFetchPermission('http://192.168.1.2'), PermissionLevel.ASK);
  assert.strictEqual(getWebFetchPermission('http://169.254.1.2'), PermissionLevel.ASK);
  assert.strictEqual(getWebFetchPermission('http://[::1]/'), PermissionLevel.ASK);
  assert.strictEqual(getWebFetchPermission('http://[fd00::1]/'), PermissionLevel.ASK);
  assert.strictEqual(isPrivateOrLocalHost('172.16.0.1'), true);
  assert.strictEqual(isPrivateOrLocalHost('8.8.8.8'), false);
});

test('PermissionManager keys private web fetch approvals by host', () => {
  const pm = new PermissionManager({ mode: 'normal' });

  assert.strictEqual(pm.getToolKey('web.fetch', { url: 'http://127.0.0.1:3000/a' }), 'web.fetch:127.0.0.1');
  assert.strictEqual(pm.getToolKey('web.fetch', { url: 'https://example.com/a' }), 'web.fetch');
});

test('PermissionManager with no callback auto-approves', async () => {
  const pm = new PermissionManager({ mode: 'normal' });
  const result = await pm.checkPermission('file.write', { path: 'test.txt', content: 'x' }, null);
  assert.strictEqual(result.approved, true);
  assert.strictEqual(result.reason, 'non-interactive environment, auto-approved');
});

test('PermissionManager yolo mode auto-approves', async () => {
  const pm = new PermissionManager({ mode: 'yolo' });
  const result = await pm.checkPermission('file.write', { path: 'test.txt', content: 'x' }, null);
  assert.strictEqual(result.approved, true);
  assert.strictEqual(result.level, PermissionLevel.AUTO);
  assert.strictEqual(result.reason, 'yolo mode');
});

test('PermissionManager always_allow', async () => {
  const pm = new PermissionManager({ mode: 'normal' });
  const toolKey = 'file.write';
  pm.setAlwaysAllow(toolKey);

  const result = await pm.checkPermission('file.write', { path: 'test.txt' }, null);
  assert.strictEqual(result.approved, true);
  assert.strictEqual(result.reason, 'permanently allowed by user');
});

test('PermissionManager always_deny', () => {
  const pm = new PermissionManager({ mode: 'normal' });
  const toolKey = 'shell.run:rm';
  pm.setAlwaysDeny(toolKey);

  return pm.checkPermission('shell.run', { command: 'rm' }, null).then((result) => {
    assert.strictEqual(result.approved, false);
    assert.strictEqual(result.reason, 'permanently denied by user');
  });
});

test('PermissionManager resetOverrides', () => {
  const pm = new PermissionManager({ mode: 'normal' });
  pm.setAlwaysAllow('file.write');
  pm.setAlwaysDeny('shell.run:rm');
  pm.resetOverrides();

  assert.strictEqual(pm._alwaysAllow.size, 0);
  assert.strictEqual(pm._alwaysDeny.size, 0);
});

test('formatToolDescription for file.write', () => {
  const desc = formatToolDescription('file.write', { path: 'src/index.js', content: 'hello world' });
  assert.ok(desc.includes('src/index.js'));
});

test('formatToolDescription for file.delete', () => {
  const desc = formatToolDescription('file.delete', { path: 'config.json' });
  assert.ok(desc.includes('config.json'));
  assert.ok(desc.includes('Delete'));
});

test('formatToolDescription for shell.run', () => {
  const desc = formatToolDescription('shell.run', { command: 'git', args: ['push'] });
  assert.ok(desc.includes('push'));
  assert.ok(desc.includes('Working directory'));
});

test('formatToolDescription supports Chinese locale', () => {
  const desc = formatToolDescription('file.delete', { path: 'config.json' }, 'zh-CN');
  assert.ok(desc.includes('删除'));
});
