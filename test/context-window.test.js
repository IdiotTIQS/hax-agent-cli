const assert = require('node:assert/strict');
const test = require('node:test');
const {
  estimateConversationTokens,
  inferModelContextWindowTokens,
  prepareContextWindow,
} = require('../src/context-window');

test('infers large context windows for supported model families', () => {
  assert.equal(inferModelContextWindowTokens('gpt-5.5'), 1_050_000);
  assert.equal(inferModelContextWindowTokens('gpt-5.4'), 1_050_000);
  assert.equal(inferModelContextWindowTokens('gpt-5.4-mini'), 400_000);
  assert.equal(inferModelContextWindowTokens('gpt-5.3-codex'), 400_000);
  assert.equal(inferModelContextWindowTokens('gpt-4.1'), 1_000_000);
  assert.equal(inferModelContextWindowTokens('gpt-4o'), 128_000);
  assert.equal(inferModelContextWindowTokens('gemini-2.5-pro'), 1_000_000);
  assert.equal(inferModelContextWindowTokens('gemini-3-pro-preview'), 1_000_000);
  assert.equal(inferModelContextWindowTokens('deepseek-v4-pro'), 1_000_000);
  assert.equal(inferModelContextWindowTokens('deepseek-chat'), 1_000_000);
  assert.equal(inferModelContextWindowTokens('deepseek-v3'), 128_000);
  assert.equal(inferModelContextWindowTokens('claude-opus-4-7'), 1_000_000);
  assert.equal(inferModelContextWindowTokens('claude-sonnet-4-6-20251101'), 1_000_000);
  assert.equal(inferModelContextWindowTokens('claude-sonnet-4-20250514'), 200_000);
  assert.equal(inferModelContextWindowTokens('qwen3.5-plus'), 1_000_000);
  assert.equal(inferModelContextWindowTokens('qwen3-max'), 262_144);
  assert.equal(inferModelContextWindowTokens('qwen3-coder-next'), 262_144);
  assert.equal(inferModelContextWindowTokens('kimi-k2.5'), 262_144);
  assert.equal(inferModelContextWindowTokens('moonshot-v1-128k'), 128_000);
  assert.equal(inferModelContextWindowTokens('moonshot-v1-32k'), 32_768);
  assert.equal(inferModelContextWindowTokens('glm-4.5'), 128_000);
  assert.equal(inferModelContextWindowTokens('glm-4.7'), 200_000);
  assert.equal(inferModelContextWindowTokens('doubao-seed-code'), 262_144);
  assert.equal(inferModelContextWindowTokens('hunyuan-turbos'), 262_144);
  assert.equal(inferModelContextWindowTokens('minimax-text-01'), 1_000_000);
  assert.equal(inferModelContextWindowTokens('yi-large'), 128_000);
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
