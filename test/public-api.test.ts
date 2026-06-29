import assert from 'node:assert/strict';
import test from 'node:test';

import api from '../src/index.js';

test('public API exposes core namespaces', () => {
  for (const ns of ['engine', 'tools', 'api', 'config', 'skills', 'memory', 'tui', 'commands']) {
    assert.equal(typeof api[ns], 'object', ns + ' should be object');
  }
});

test('public API exposes OpenHarness parity namespaces', () => {
  for (const ns of ['state', 'platforms', 'paths', 'swarm', 'tasks', 'sandbox', 'keybindings', 'vim', 'utils']) {
    assert.equal(typeof api[ns], 'object', ns + ' should be object');
  }
});

test('engine exports Session, AgentEngine, HookExecutor', () => {
  assert.equal(typeof api.engine.Session, 'function');
  assert.equal(typeof api.engine.AgentEngine, 'function');
  assert.equal(typeof api.engine.HookExecutor, 'function');
});

test('tools exports ToolRegistry factory', () => {
  assert.equal(typeof api.tools.ToolRegistry, 'function');
  assert.equal(typeof api.tools.createDefaultRegistry, 'function');
});
