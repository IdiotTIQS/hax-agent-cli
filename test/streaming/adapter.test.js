"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  StreamAdapter,
  adaptStream,
  FORMAT_ANTHROPIC,
  FORMAT_OPENAI,
  FORMAT_GOOGLE,
  FORMAT_STANDARD,
  CHUNK_TYPE_TEXT_DELTA,
  CHUNK_TYPE_TOOL_CALL,
  CHUNK_TYPE_THINKING,
  CHUNK_TYPE_ERROR,
  CHUNK_TYPE_METADATA,
} = require("../../src/streaming/adapter");

function makeStream(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

async function collect(stream) {
  const result = [];
  for await (const c of stream) result.push(c);
  return result;
}

// --- detectFormat ---

test("detectFormat recognizes Anthropic content_block_delta", () => {
  const adapter = new StreamAdapter();
  const chunk = { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } };
  assert.equal(adapter.detectFormat(chunk), FORMAT_ANTHROPIC);
});

test("detectFormat recognizes Anthropic content_block_start", () => {
  const adapter = new StreamAdapter();
  const chunk = { type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "read", id: "abc" } };
  assert.equal(adapter.detectFormat(chunk), FORMAT_ANTHROPIC);
});

test("detectFormat recognizes Anthropic error event", () => {
  const adapter = new StreamAdapter();
  const chunk = { type: "error", error: { type: "overloaded_error", message: "overloaded" } };
  assert.equal(adapter.detectFormat(chunk), FORMAT_ANTHROPIC);
});

test("detectFormat recognizes Anthropic message_start", () => {
  const adapter = new StreamAdapter();
  const chunk = { type: "message_start", message: { model: "claude-sonnet-4-20250514" } };
  assert.equal(adapter.detectFormat(chunk), FORMAT_ANTHROPIC);
});

test("detectFormat recognizes OpenAI chunks by choices array", () => {
  const adapter = new StreamAdapter();
  const chunk = {
    id: "chatcmpl-123",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content: "Hello" } }],
  };
  assert.equal(adapter.detectFormat(chunk), FORMAT_OPENAI);
});

test("detectFormat recognizes OpenAI chunks by object type", () => {
  const adapter = new StreamAdapter();
  const chunk = {
    id: "chatcmpl-123",
    object: "chat.completion",
    choices: [{ message: { role: "assistant", content: "Hi" } }],
  };
  assert.equal(adapter.detectFormat(chunk), FORMAT_OPENAI);
});

test("detectFormat recognizes Google chunks by candidates array", () => {
  const adapter = new StreamAdapter();
  const chunk = {
    candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] } }],
  };
  assert.equal(adapter.detectFormat(chunk), FORMAT_GOOGLE);
});

test("detectFormat recognizes Google chunks by usageMetadata", () => {
  const adapter = new StreamAdapter();
  const chunk = { usageMetadata: { totalTokenCount: 100 }, modelVersion: "gemini-2.5" };
  assert.equal(adapter.detectFormat(chunk), FORMAT_GOOGLE);
});

test("detectFormat recognizes standard format by chunk type", () => {
  const adapter = new StreamAdapter();
  assert.equal(adapter.detectFormat({ type: "text_delta", text: "hi" }), FORMAT_STANDARD);
  assert.equal(adapter.detectFormat({ type: "tool_call", name: "read" }), FORMAT_STANDARD);
  assert.equal(adapter.detectFormat({ type: "thinking", summary: "..." }), FORMAT_STANDARD);
  assert.equal(adapter.detectFormat({ type: "error", message: "err" }), FORMAT_STANDARD);
  assert.equal(adapter.detectFormat({ type: "metadata", data: {} }), FORMAT_STANDARD);
});

test("detectFormat defaults to standard for unrecognized chunks", () => {
  const adapter = new StreamAdapter();
  assert.equal(adapter.detectFormat({ foo: "bar" }), FORMAT_STANDARD);
  assert.equal(adapter.detectFormat("plain string"), FORMAT_STANDARD);
  assert.equal(adapter.detectFormat(null), FORMAT_STANDARD);
});

// --- normalize: anthropic -> standard ---

test("normalize converts Anthropic text_delta to standard", () => {
  const adapter = new StreamAdapter();
  const chunk = { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello world" } };
  const result = adapter.normalize(chunk);

  assert.equal(result.type, CHUNK_TYPE_TEXT_DELTA);
  assert.equal(result.text, "Hello world");
  assert.equal(result.index, 0);
  assert.deepEqual(result.raw, chunk);
});

test("normalize converts Anthropic tool_use start to standard", () => {
  const adapter = new StreamAdapter();
  const chunk = {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", name: "file.read", id: "toolu_001", input: { path: "/tmp/x" } },
  };
  const result = adapter.normalize(chunk);

  assert.equal(result.type, CHUNK_TYPE_TOOL_CALL);
  assert.equal(result.name, "file.read");
  assert.equal(result.id, "toolu_001");
  assert.deepEqual(result.input, { path: "/tmp/x" });
});

test("normalize converts Anthropic thinking to standard", () => {
  const adapter = new StreamAdapter();
  const chunk = {
    type: "content_block_start",
    index: 0,
    content_block: { type: "thinking", thinking: "Let me analyze..." },
  };
  const result = adapter.normalize(chunk);

  assert.equal(result.type, CHUNK_TYPE_THINKING);
  assert.equal(result.summary, "Let me analyze...");
});

test("normalize converts Anthropic error to standard", () => {
  const adapter = new StreamAdapter();
  const chunk = { type: "error", error: { type: "rate_limit_error", message: "Too many requests" } };
  const result = adapter.normalize(chunk);

  assert.equal(result.type, CHUNK_TYPE_ERROR);
  assert.equal(result.message, "Too many requests");
  assert.equal(result.code, "rate_limit_error");
});

test("normalize converts Anthropic message_start to standard metadata", () => {
  const adapter = new StreamAdapter();
  const chunk = {
    type: "message_start",
    message: { model: "claude-sonnet-4-20250514", usage: { input_tokens: 10 } },
  };
  const result = adapter.normalize(chunk);

  assert.equal(result.type, CHUNK_TYPE_METADATA);
  assert.equal(result.data.model, "claude-sonnet-4-20250514");
  assert.equal(result.data.usage.input_tokens, 10);
});

// --- normalize: openai -> standard ---

test("normalize converts OpenAI text delta to standard", () => {
  const adapter = new StreamAdapter();
  const chunk = {
    id: "chatcmpl-123",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
  };
  const result = adapter.normalize(chunk);

  assert.equal(result.type, CHUNK_TYPE_TEXT_DELTA);
  assert.equal(result.text, "Hello");
});

test("normalize converts OpenAI tool_call to standard", () => {
  const adapter = new StreamAdapter();
  const chunk = {
    id: "chatcmpl-123",
    object: "chat.completion.chunk",
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          id: "call_001",
          index: 0,
          function: { name: "file.read", arguments: '{"path":"/x"}' },
        }],
      },
    }],
  };
  const result = adapter.normalize(chunk);

  assert.equal(result.type, CHUNK_TYPE_TOOL_CALL);
  assert.equal(result.name, "file.read");
  assert.equal(result.id, "call_001");
  assert.equal(result.arguments, '{"path":"/x"}');
});

test("normalize converts OpenAI reasoning_content to thinking", () => {
  const adapter = new StreamAdapter();
  const chunk = {
    id: "c1",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { reasoning_content: "Let me think..." } }],
  };
  const result = adapter.normalize(chunk);

  assert.equal(result.type, CHUNK_TYPE_THINKING);
  assert.equal(result.summary, "Let me think...");
});

// --- normalize: google -> standard ---

test("normalize converts Google text to standard", () => {
  const adapter = new StreamAdapter();
  const chunk = {
    candidates: [{ content: { role: "model", parts: [{ text: "Hello from Gemini" }] } }],
  };
  const result = adapter.normalize(chunk);

  assert.equal(result.type, CHUNK_TYPE_TEXT_DELTA);
  assert.equal(result.text, "Hello from Gemini");
});

test("normalize converts Google functionCall to tool_call", () => {
  const adapter = new StreamAdapter();
  const chunk = {
    candidates: [{
      content: {
        role: "model",
        parts: [{ functionCall: { name: "shell.run", args: { command: "ls" } } }],
      },
    }],
  };
  const result = adapter.normalize(chunk);

  assert.equal(result.type, CHUNK_TYPE_TOOL_CALL);
  assert.equal(result.name, "shell.run");
  assert.deepEqual(result.input, { command: "ls" });
});

test("normalize converts Google thought chunk to thinking", () => {
  const adapter = new StreamAdapter();
  const chunk = {
    candidates: [{ content: { role: "model", parts: [{ text: "", thought: true }] } }],
  };
  const result = adapter.normalize(chunk);

  assert.equal(result.type, CHUNK_TYPE_THINKING);
  assert.equal(result.summary, "Thinking...");
});

// --- adapt: full stream adaptation ---

test("adapt converts an Anthropic stream to standard format", async () => {
  const adapter = new StreamAdapter();
  const chunks = [
    { type: "message_start", message: { model: "claude" } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
    { type: "message_stop" },
  ];
  const stream = makeStream(chunks);
  const result = await collect(adapter.adapt(stream, FORMAT_STANDARD));

  const types = result.map((c) => c.type);
  assert.ok(types.includes(CHUNK_TYPE_TEXT_DELTA));
  assert.ok(types.includes(CHUNK_TYPE_METADATA));

  const textChunks = result.filter((c) => c.type === CHUNK_TYPE_TEXT_DELTA);
  // content_block_start with text produces a text_delta (possibly empty),
  // followed by two content_block_delta chunks
  assert.equal(textChunks.length, 3);
  // The first content_block_start text chunk may be empty
  assert.equal(textChunks[1].text, "Hello");
  assert.equal(textChunks[2].text, " world");
});

test("adapt converts an OpenAI stream to standard format", async () => {
  const adapter = new StreamAdapter();
  const chunks = [
    { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Part 1" } }] },
    { id: "c2", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Part 2" } }] },
  ];
  const stream = makeStream(chunks);
  const result = await collect(adapter.adapt(stream, FORMAT_STANDARD));

  assert.equal(result.length, 2);
  assert.equal(result[0].type, CHUNK_TYPE_TEXT_DELTA);
  assert.equal(result[0].text, "Part 1");
  assert.equal(result[1].text, "Part 2");
});

test("adapt converts a Google stream to standard format", async () => {
  const adapter = new StreamAdapter();
  const chunks = [
    { candidates: [{ content: { role: "model", parts: [{ text: "Gemini" }] } }] },
    { candidates: [{ content: { role: "model", parts: [{ text: " response" }] } }] },
  ];
  const stream = makeStream(chunks);
  const result = await collect(adapter.adapt(stream, FORMAT_STANDARD));

  assert.equal(result.length, 2);
  assert.equal(result[0].type, CHUNK_TYPE_TEXT_DELTA);
  assert.equal(result[1].type, CHUNK_TYPE_TEXT_DELTA);
});

// --- adapt to non-standard target ---

test("adapt can target Anthropic format from standard input", async () => {
  const adapter = new StreamAdapter();
  const chunks = [
    { type: "text_delta", text: "Hi" },
    { type: "tool_call", name: "read", id: "abc", input: {} },
  ];
  const stream = makeStream(chunks);
  const result = await collect(adapter.adapt(stream, FORMAT_ANTHROPIC));

  assert.equal(result.length, 2);
  assert.equal(result[0].type, "content_block_delta");
  assert.equal(result[1].type, "content_block_start");
});

test("adapt can target OpenAI format from standard input", async () => {
  const adapter = new StreamAdapter();
  const chunks = [{ type: "text_delta", text: "Hello" }];
  const stream = makeStream(chunks);
  const result = await collect(adapter.adapt(stream, FORMAT_OPENAI));

  assert.equal(result.length, 1);
  assert.equal(result[0].object, "chat.completion.chunk");
  assert.equal(result[0].choices[0].delta.content, "Hello");
});

test("adapt can target Google format from standard input", async () => {
  const adapter = new StreamAdapter();
  const chunks = [{ type: "text_delta", text: "Hi" }];
  const stream = makeStream(chunks);
  const result = await collect(adapter.adapt(stream, FORMAT_GOOGLE));

  assert.equal(result.length, 1);
  assert.equal(result[0].candidates[0].content.parts[0].text, "Hi");
});

// --- adaptStream convenience function ---

test("adaptStream convenience function works", async () => {
  const chunks = [
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "quick" } },
  ];
  const stream = makeStream(chunks);
  const result = await collect(adaptStream(stream, { targetFormat: FORMAT_STANDARD }));

  assert.equal(result.length, 1);
  assert.equal(result[0].type, CHUNK_TYPE_TEXT_DELTA);
  assert.equal(result[0].text, "quick");
});

// --- error handling ---

test("adapt throws for null stream", async () => {
  const adapter = new StreamAdapter();
  const gen = adapter.adapt(null);
  await assert.rejects(
    () => gen.next(),
    /Provider stream is required/,
  );
});

test("normalize returns null for null chunk", () => {
  const adapter = new StreamAdapter();
  assert.equal(adapter.normalize(null), null);
  assert.equal(adapter.normalize(undefined), null);
});

test("normalize passes through already-standard chunks", () => {
  const adapter = new StreamAdapter();
  const chunk = { type: "text_delta", text: "unchanged" };
  const result = adapter.normalize(chunk);
  assert.deepEqual(result, chunk);
});

// --- Google edge cases ---

test("normalize handles Google with usage metadata (no candidates)", () => {
  const adapter = new StreamAdapter();
  const chunk = { usageMetadata: { totalTokenCount: 42 }, modelVersion: "gemini-2.5-pro" };
  const result = adapter.normalize(chunk);

  assert.equal(result.type, CHUNK_TYPE_METADATA);
  assert.equal(result.data.usage.totalTokenCount, 42);
  assert.equal(result.data.model, "gemini-2.5-pro");
});

test("normalize handles Google candidate with finishReason and no content", () => {
  const adapter = new StreamAdapter();
  const chunk = { candidates: [{ finishReason: "STOP", safetyRatings: [] }] };
  const result = adapter.normalize(chunk);

  assert.equal(result.type, CHUNK_TYPE_METADATA);
  assert.equal(result.data.finishReason, "STOP");
});
