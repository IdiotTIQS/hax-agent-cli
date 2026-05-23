"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  estimateTokens,
  estimateMessageTokens,
  estimateConversationTokens,
  countTokensWithTiktoken,
  isApproachingLimit,
  MESSAGE_OVERHEAD_TOKENS,
  CONVERSATION_OVERHEAD_TOKENS,
} = require("../../src/providers/token-counter");

test("estimateTokens returns 0 for empty text", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens(undefined), 0);
});

test("estimateTokens returns 1 for short text", () => {
  const result = estimateTokens("hi");
  assert.equal(result, 1);
});

test("estimateTokens estimates long text", () => {
  const text = "The quick brown fox jumps over the lazy dog";
  const result = estimateTokens(text);
  assert.ok(result > 0);
  assert.equal(result, Math.ceil(text.length / 4));
});

test("estimateTokens handles unicode text correctly", () => {
  const text = "你好世界你好世界";
  const result = estimateTokens(text);
  assert.equal(result, Math.ceil(text.length / 4));
});

test("estimateMessageTokens counts user message with content", () => {
  const message = { role: "user", content: "Hello, how are you?" };
  const tokens = estimateMessageTokens(message);

  assert.equal(tokens, MESSAGE_OVERHEAD_TOKENS + estimateTokens(message.content));
});

test("estimateMessageTokens counts assistant message with name", () => {
  const message = { role: "assistant", content: "I am doing well.", name: "Claude" };
  const tokens = estimateMessageTokens(message);

  assert.equal(tokens, MESSAGE_OVERHEAD_TOKENS + estimateTokens(message.content) + estimateTokens("Claude") + 1);
});

test("estimateMessageTokens counts system message with array content", () => {
  const message = {
    role: "system",
    content: [{ text: "You are helpful." }, { text: "Be concise." }],
  };
  const tokens = estimateMessageTokens(message);

  const expectedContent = "You are helpful.Be concise.";
  assert.equal(tokens, MESSAGE_OVERHEAD_TOKENS + estimateTokens(expectedContent));
});

test("estimateMessageTokens counts tool calls in assistant message", () => {
  const message = {
    role: "assistant",
    content: "Let me read that file.",
    toolCalls: [
      { name: "file.read", arguments: { path: "/tmp/test.txt" } },
    ],
  };
  const tokens = estimateMessageTokens(message);

  const baseTokens = MESSAGE_OVERHEAD_TOKENS + estimateTokens(message.content);
  const toolTokens = estimateTokens("file.read") + 3 + estimateTokens(JSON.stringify({ path: "/tmp/test.txt" }));
  assert.equal(tokens, baseTokens + toolTokens);
});

test("estimateMessageTokens returns 0 for null message", () => {
  assert.equal(estimateMessageTokens(null), 0);
  assert.equal(estimateMessageTokens(undefined), 0);
});

test("estimateConversationTokens returns 0 for empty array", () => {
  assert.equal(estimateConversationTokens([]), 3);
});

test("estimateConversationTokens sums single message plus overhead", () => {
  const messages = [{ role: "user", content: "Hello" }];
  const tokens = estimateConversationTokens(messages);

  assert.equal(tokens, CONVERSATION_OVERHEAD_TOKENS + estimateMessageTokens(messages[0]));
});

test("estimateConversationTokens sums many messages", () => {
  const messages = [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "What is 2+2?" },
    { role: "assistant", content: "The answer is 4." },
    { role: "user", content: "Thanks!" },
    { role: "assistant", content: "You're welcome!" },
  ];

  const tokens = estimateConversationTokens(messages);

  let expected = CONVERSATION_OVERHEAD_TOKENS;
  for (const msg of messages) {
    expected += estimateMessageTokens(msg);
  }
  assert.equal(tokens, expected);
});

test("isApproachingLimit returns false when under threshold", () => {
  assert.equal(isApproachingLimit(50, 100, 0.6), false);
  assert.equal(isApproachingLimit(80, 100), false);
});

test("isApproachingLimit returns true when at threshold", () => {
  assert.equal(isApproachingLimit(85, 100), true);
  assert.equal(isApproachingLimit(85, 100, 0.85), true);
});

test("isApproachingLimit returns true when over threshold", () => {
  assert.equal(isApproachingLimit(90, 100), true);
  assert.equal(isApproachingLimit(95, 100, 0.9), true);
});

test("isApproachingLimit handles zero maxTokens gracefully", () => {
  assert.equal(isApproachingLimit(10, 0), false);
  assert.equal(isApproachingLimit(0, 0), false);
});

test("isApproachingLimit uses default threshold when not provided", () => {
  assert.equal(isApproachingLimit(84, 100), false);
  assert.equal(isApproachingLimit(85, 100), true);
});

test("isApproachingLimit handles negative usedTokens", () => {
  assert.equal(isApproachingLimit(-5, 100), false);
});

test("countTokensWithTiktoken falls back to estimate when tiktoken is not installed", () => {
  const text = "Hello world, this is a test.";
  const result = countTokensWithTiktoken(text, "gpt-4");
  assert.equal(result, estimateTokens(text));
});

test("countTokensWithTiktoken falls back for unknown model", () => {
  const text = "Hello world.";
  const result = countTokensWithTiktoken(text, "unknown-model-xyz");
  assert.equal(result, estimateTokens(text));
});

test("countTokensWithTiktoken returns 0 for empty text", () => {
  assert.equal(countTokensWithTiktoken("", "gpt-4"), 0);
  assert.equal(countTokensWithTiktoken(null, "gpt-4"), 0);
});
