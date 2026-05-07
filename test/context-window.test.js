const assert = require('node:assert/strict');
const test = require('node:test');
const {
  estimateConversationTokens,
  inferModelContextWindowTokens,
  prepareContextWindow,
} = require('../src/context-window');

test('infers large context windows for supported model families', () => {
  assert.equal(inferModelContextWindowTokens('gpt-4.1'), 1_000_000);
  assert.equal(inferModelContextWindowTokens('gemini-2.5-pro'), 1_000_000);
  assert.equal(inferModelContextWindowTokens('claude-sonnet-4-20250514'), 200_000);
});

test('prepares messages within the configured token budget', () => {
  const settings = {
    context: {
      windowTokens: 120,
      reserveOutputTokens: 20,
      charsPerToken: 4,
    },
  };
  const messages = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${index}: ${'x'.repeat(120)}`,
  }));
  const prepared = prepareContextWindow({
    messages,
    system: 'system prompt',
    settings,
    model: 'mock',
  });

  assert.ok(prepared.messages.length < messages.length);
  assert.equal(prepared.messages.at(-1).content, messages.at(-1).content);
  assert.ok(prepared.stats.droppedMessages > 0);
  assert.ok(estimateConversationTokens(prepared.messages, prepared.system, settings) <= prepared.stats.budgetTokens + prepared.stats.reserveOutputTokens);
});

test('truncates a single oversized latest message instead of dropping the turn', () => {
  const settings = {
    context: {
      windowTokens: 80,
      reserveOutputTokens: 10,
      charsPerToken: 4,
    },
  };
  const prepared = prepareContextWindow({
    messages: [{ role: 'user', content: 'important '.repeat(200) }],
    system: '',
    settings,
    model: 'mock',
  });

  assert.equal(prepared.messages.length, 1);
  assert.match(prepared.messages[0].content, /Context truncated/);
});

test('reserves provider output tokens when larger than the configured reserve', () => {
  const prepared = prepareContextWindow({
    messages: [{ role: 'user', content: 'hello' }],
    settings: {
      context: {
        windowTokens: 1000,
        reserveOutputTokens: 100,
      },
    },
    outputTokens: 300,
    model: 'mock',
  });

  assert.equal(prepared.stats.reserveOutputTokens, 300);
  assert.equal(prepared.stats.budgetTokens, 700);
});
