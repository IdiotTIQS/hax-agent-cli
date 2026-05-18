const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

async function loadUiStateUtils() {
  return import(pathToFileURL(path.join(__dirname, '..', 'desktop', 'renderer', 'src', 'ui-state-utils.mjs')).href);
}

test('ui state utilities format elapsed time and permission mode', async () => {
  const { formatElapsed, toBackendPermissionMode } = await loadUiStateUtils();

  assert.equal(formatElapsed(4000), '4s');
  assert.equal(formatElapsed(65000), '1m 5s');
  assert.equal(toBackendPermissionMode('full'), 'yolo');
  assert.equal(toBackendPermissionMode('normal'), 'normal');
});

test('ui state utilities create normalized run states', async () => {
  const { createRunState } = await loadUiStateUtils();

  assert.deepEqual(createRunState('thinking'), {
    isBusy: true,
    isThinking: true,
    isStreaming: false,
    activeAssistantId: '',
    statusState: 'thinking',
  });
  assert.deepEqual(createRunState('running', { activeAssistantId: 'assistant-1' }), {
    isBusy: true,
    isThinking: false,
    isStreaming: true,
    statusState: 'running',
    activeAssistantId: 'assistant-1',
  });
  assert.deepEqual(createRunState('idle'), {
    isBusy: false,
    isThinking: false,
    isStreaming: false,
    activeAssistantId: '',
    statusState: 'idle',
  });
});

test('ui state utilities accumulate token usage safely', async () => {
  const { accumulateTokenUsage } = await loadUiStateUtils();

  assert.equal(accumulateTokenUsage(10, { inputTokens: 2, outputTokens: 3 }), 15);
  assert.equal(accumulateTokenUsage(undefined, { inputTokens: 7 }), 7);
  assert.equal(accumulateTokenUsage(4, { status: 'done' }), 4);
});

test('ui state utilities create log entries and bounded lists', async () => {
  const { createLogEntry, prependLimited } = await loadUiStateUtils();
  const log = createLogEntry('Ready', 'done', {
    idFactory: () => 'log-1',
    nowFactory: () => new Date('2026-05-16T00:00:00.000Z'),
  });

  assert.deepEqual(log, {
    id: 'log-1',
    label: 'Ready',
    time: new Date('2026-05-16T00:00:00.000Z'),
    type: 'done',
  });
  assert.deepEqual(prependLimited(['b', 'c'], 'a', 2), ['a', 'b']);
});

test('ui state utilities create chat messages', async () => {
  const { createChatMessage } = await loadUiStateUtils();

  assert.deepEqual(createChatMessage('assistant', 42, {
    idFactory: () => 'msg-1',
    nowFactory: () => new Date('2026-05-16T00:00:00.000Z'),
    turn: 3,
    extra: { tone: 'info' },
  }), {
    id: 'msg-1',
    role: 'assistant',
    content: '42',
    createdAt: new Date('2026-05-16T00:00:00.000Z'),
    turn: 3,
    tone: 'info',
  });
});
