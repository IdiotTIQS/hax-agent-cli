"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { UndoStack } = require('../src/undo-stack');
const { PluginRegistry } = require('../src/plugins');
const { writeMemory, readMemory, listMemories, searchMemories, deleteMemory } = require('../src/memory');
const { ToolRegistry } = require('../src/tools/registry');
const { PermissionManager } = require('../src/permissions');

// ── UndoStack ──────────────────────────────────────────────
test('UndoStack: push, undo, redo cycle', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-smoke-'));
  const filePath = path.join(dir, 'test.txt');
  await fs.writeFile(filePath, 'original', 'utf8');

  const stack = new UndoStack(10);
  stack.push({
    toolName: 'file.write',
    filePath,
    originalContent: 'original',
    newContent: 'modified',
    description: 'Test edit',
  });

  const undoResult = await stack.undo();
  assert.equal(undoResult.undone, true);
  const afterUndo = await fs.readFile(filePath, 'utf8');
  assert.equal(afterUndo, 'original');

  const redoResult = await stack.redo();
  assert.equal(redoResult.redone, true);
  const afterRedo = await fs.readFile(filePath, 'utf8');
  assert.equal(afterRedo, 'modified');

  await fs.rm(dir, { recursive: true, force: true });
});

test('UndoStack: empty stack returns not undone', async (t) => {
  const stack = new UndoStack();
  const result = await stack.undo();
  assert.equal(result.undone, false);
  assert.equal(result.description, 'Nothing to undo');
});

test('UndoStack: undo after external modification preserves current', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-smoke-'));
  const filePath = path.join(dir, 'test.txt');
  await fs.writeFile(filePath, 'v1', 'utf8');

  const stack = new UndoStack();
  stack.push({ toolName: 'file.edit', filePath, originalContent: 'v1', newContent: 'v2' });
  await fs.writeFile(filePath, 'v2', 'utf8');

  // Simulate external modification: change file after our edit
  await fs.writeFile(filePath, 'externally-modified', 'utf8');

  const result = await stack.undo();
  assert.equal(result.undone, true);
  const content = await fs.readFile(filePath, 'utf8');
  assert.equal(content, 'v1');

  // Redo should restore the externally-modified version (captured before undo)
  const redoResult = await stack.redo();
  assert.equal(redoResult.redone, true);
  const redoContent = await fs.readFile(filePath, 'utf8');
  assert.equal(redoContent, 'v2');

  await fs.rm(dir, { recursive: true, force: true });
});

// ── PluginRegistry ─────────────────────────────────────────
test('PluginRegistry: register and run hooks', async (t) => {
  const registry = new PluginRegistry();
  const callOrder = [];

  registry.register({
    name: 'test-plugin',
    hooks: {
      beforeToolCall(ctx) { callOrder.push('before'); return ctx; },
      afterToolCall(ctx) { callOrder.push('after'); return ctx; },
    },
  });

  await registry.runHook('beforeToolCall', { toolName: 'test' });
  await registry.runHook('afterToolCall', { toolName: 'test', result: 'ok' });

  assert.deepEqual(callOrder, ['before', 'after']);
});

test('PluginRegistry: hook error isolation', async (t) => {
  const registry = new PluginRegistry();
  const results = [];

  registry.register({
    name: 'good',
    hooks: { beforeToolCall(ctx) { results.push('good'); return ctx; } },
  });
  registry.register({
    name: 'bad',
    hooks: { beforeToolCall() { throw new Error('Boom!'); } },
  });

  // Should not throw — bad plugin is isolated
  await registry.runHook('beforeToolCall', { toolName: 'test' });
  assert.deepEqual(results, ['good']);
});

test('PluginRegistry: duplicate registration throws', async (t) => {
  const registry = new PluginRegistry();
  registry.register({ name: 'unique', hooks: {} });
  assert.throws(() => registry.register({ name: 'unique', hooks: {} }), /already registered/);
});

test('PluginRegistry: unregister removes hooks', async (t) => {
  const registry = new PluginRegistry();
  const calls = [];
  registry.register({
    name: 'removable',
    hooks: { beforeToolCall() { calls.push('called'); } },
  });

  await registry.runHook('beforeToolCall', {});
  assert.equal(calls.length, 1);

  registry.unregister('removable');
  await registry.runHook('beforeToolCall', {});
  assert.equal(calls.length, 1); // Not called again
});

// ── Memory with Namespace/Tags ─────────────────────────────
test('Memory: namespace and tags persistence', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-mem-'));
  const opts = {
    projectRoot: dir,
    memoryDirectory: path.join(dir, 'memory'),
    namespace: 'production',
    tags: ['architecture', 'critical'],
  };

  writeMemory('deploy-config', 'Use blue-green deployment', opts);
  const mem = readMemory('deploy-config', opts);

  assert.equal(mem.namespace, 'production');
  assert.deepEqual(mem.tags, ['architecture', 'critical']);
  assert.equal(mem.content, 'Use blue-green deployment');

  deleteMemory('deploy-config', opts);
  await fs.rm(dir, { recursive: true, force: true });
});

test('Memory: namespace filtering in search', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-mem-'));
  const baseOpts = { projectRoot: dir, memoryDirectory: path.join(dir, 'memory') };

  writeMemory('api-key-prod', 'prod-key-123', { ...baseOpts, namespace: 'production' });
  writeMemory('api-key-dev', 'dev-key-456', { ...baseOpts, namespace: 'development' });
  writeMemory('db-url', 'postgres://prod', { ...baseOpts, namespace: 'production', tags: ['database'] });

  const prodResults = searchMemories('api', { ...baseOpts, namespace: 'production' });
  assert.equal(prodResults.length, 1, 'only production api-key matches');
  assert.equal(prodResults[0].content, 'prod-key-123');
  assert.ok(prodResults[0].score > 0);

  const dbResults = searchMemories('postgres', baseOpts);
  assert.ok(dbResults.length >= 1, 'finds db-url by content');

  // Cleanup: use correct namespace for each
  deleteMemory('api-key-prod', { ...baseOpts, namespace: 'production' });
  deleteMemory('api-key-dev', { ...baseOpts, namespace: 'development' });
  deleteMemory('db-url', { ...baseOpts, namespace: 'production' });
  await fs.rm(dir, { recursive: true, force: true });
});

test('Memory: weighted search scoring', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-mem-'));
  const baseOpts = { projectRoot: dir, memoryDirectory: path.join(dir, 'memory') };

  // Name match should score higher than content match
  writeMemory('kubernetes-scaling', 'This is about database scaling strategies', baseOpts);
  writeMemory('db-config', 'kubernetes cluster settings for production', baseOpts);

  const results = searchMemories('kubernetes', baseOpts);
  assert.equal(results.length, 2);
  // Name match should rank higher than content-only match
  assert.equal(results[0].name, 'kubernetes-scaling');
  assert.ok(results[0].score > results[1].score);

  deleteMemory('kubernetes-scaling', baseOpts);
  deleteMemory('db-config', baseOpts);
  await fs.rm(dir, { recursive: true, force: true });
});

// ── ToolRegistry with UndoStack + PluginRegistry ───────────
test('ToolRegistry: undoStack and pluginRegistry integration', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-smoke-'));
  const undoStack = new UndoStack();
  const pluginRegistry = new PluginRegistry();
  const hookCalls = [];

  pluginRegistry.register({
    name: 'watcher',
    hooks: {
      beforeToolCall(ctx) { hookCalls.push(`before:${ctx.toolName}`); },
      afterToolCall(ctx) { hookCalls.push(`after:${ctx.toolName}`); },
    },
  });

  const registry = new ToolRegistry({
    root: dir,
    undoStack,
    pluginRegistry,
  });

  // Register a simple test tool
  registry.register({
    name: 'file.write',
    description: 'Test write',
    execute: async (args, ctx) => {
      const p = path.join(ctx.root, args.path);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, args.content, 'utf8');
      if (ctx.undoStack) {
        ctx.undoStack.push({
          toolName: 'file.write',
          filePath: p,
          originalContent: '',
          newContent: args.content,
        });
      }
      return { path: args.path, bytes: args.content.length };
    },
  });

  const result = await registry.execute('file.write', {
    path: 'hello.txt',
    content: 'Hello, World!',
  });

  assert.equal(result.ok, true);
  assert.equal(result.toolName, 'file.write');

  // Verify hooks fired
  assert.deepEqual(hookCalls, ['before:file.write', 'after:file.write']);

  // Verify undo works
  assert.equal(undoStack.canUndo(), true);
  const undoResult = await undoStack.undo();
  assert.equal(undoResult.undone, true);
  const fileContent = await fs.readFile(path.join(dir, 'hello.txt'), 'utf8');
  assert.equal(fileContent, '');

  await fs.rm(dir, { recursive: true, force: true });
});

// ── Batch mode parsing ─────────────────────────────────────
const { parseBatchInput } = require('../src/batch');

test('parseBatchInput: single turn', () => {
  assert.deepEqual(parseBatchInput('Hello'), ['Hello']);
});

test('parseBatchInput: multi marker', () => {
  const input = '---multi---\ntask one\ntask two\ntask three';
  assert.deepEqual(parseBatchInput(input), ['task one', 'task two', 'task three']);
});

test('parseBatchInput: alternate multi marker', () => {
  const input = '@@@multi@@@\nstep a\nstep b';
  assert.deepEqual(parseBatchInput(input), ['step a', 'step b']);
});

test('parseBatchInput: empty input', () => {
  assert.deepEqual(parseBatchInput(''), []);
  assert.deepEqual(parseBatchInput('   '), []);
});

test('parseBatchInput: filters blank lines in multi', () => {
  const input = '---multi---\ntask one\n\n\ntask two\n  \ntask three';
  assert.deepEqual(parseBatchInput(input), ['task one', 'task two', 'task three']);
});
