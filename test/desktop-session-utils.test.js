const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

async function loadSessionUtils() {
  return import(pathToFileURL(path.join(__dirname, '..', 'desktop', 'renderer', 'src', 'session-utils.mjs')).href);
}

test('session utilities extract settings patches from resolved settings', async () => {
  const { extractSettingsPatch } = await loadSessionUtils();

  assert.deepEqual(extractSettingsPatch({
    settings: {
      agent: { provider: 'openai', model: 'gpt-4.1', temperature: 0.2 },
      desktop: { workspace: 'E:\\HaxAgent' },
      ui: { locale: 'zh-CN' },
    },
  }), {
    provider: 'openai',
    model: 'gpt-4.1',
    temperature: 0.2,
    workspace: 'E:\\HaxAgent',
    locale: 'zh-CN',
  });
});

test('session utilities restore message state from session records', async () => {
  const { createMessagesFromSession } = await loadSessionUtils();
  let id = 0;
  const restored = createMessagesFromSession({
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'again' },
    ],
  }, {
    idFactory: () => `id-${id++}`,
    nowFactory: () => new Date('2026-05-16T00:00:00.000Z'),
  });

  assert.deepEqual(restored.messages.map((message) => [message.id, message.role, message.content, message.turn]), [
    ['id-0', 'user', 'hello', 0],
    ['id-1', 'assistant', 'hi', 0],
    ['id-2', 'user', 'again', 1],
  ]);
  assert.equal(restored.currentTurn, 2);
});

test('session utilities extract status metrics', async () => {
  const { extractSessionStats, serializeSessionId } = await loadSessionUtils();

  assert.equal(serializeSessionId({ id: 'abc' }), 'abc');
  assert.equal(serializeSessionId({ sessionId: 'def' }), 'def');
  assert.deepEqual(extractSessionStats({
    provider: { model: 'claude-sonnet-4-6' },
    status: { inputTokens: 10, outputTokens: 15, cost: 0.12345, elapsed: '4s' },
  }), {
    tokens: 25,
    cost: '$0.1235',
    elapsed: '4s',
    model: 'claude-sonnet-4-6',
  });
});
