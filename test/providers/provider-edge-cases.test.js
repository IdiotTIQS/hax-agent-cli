"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createProvider, registerProvider } = require("../../src/providers/factory");
const { normalizeMessages } = require("../../src/providers/messages");
const {
  parsePositiveNumber,
  withRetry,
  createToolResultBlock,
  createToolStartChunk,
  createToolResultChunk,
  createThinkingChunk,
  extractToolError,
  parseToolResultContent,
  stripToolCallMarkup,
  parseDsmlToolCalls,
  splitPotentialDsmlPrefix,
  summarizeToolInput,
  getPermissionLevel,
  formatInputPart,
  joinInputParts,
} = require("../../src/providers/shared");

const {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_MAX_TOOL_TURNS,
  MAX_SAME_TOOL_CALLS,
  MAX_REPEATED_INVALID_TOOL_RESULTS,
} = require("../../src/providers/shared");

// ---------------------------------------------------------------------------
// Provider factory edge cases (beyond providers-factory.test.js)
// ---------------------------------------------------------------------------

test("createProvider: uses nullish delayMs from config (undefined defaults to 0)", () => {
  const provider = createProvider(
    { provider: "mock" },
    {}
  );
  assert.equal(provider.delayMs, 0);
});

test("createProvider: uses delayMs=0 when config.delayMs is null", () => {
  const provider = createProvider(
    { provider: "mock", delayMs: null },
    {}
  );
  assert.equal(provider.delayMs, 0);
});

test("createProvider: resolves apiKey for openai from OPENAI_API_KEY env", () => {
  const provider = createProvider(
    { provider: "openai" },
    { OPENAI_API_KEY: "sk-env-test" }
  );
  assert.equal(provider.apiKey, "sk-env-test");
});

test("createProvider: resolves apiKey for google from GOOGLE_API_KEY env", () => {
  const provider = createProvider(
    { provider: "google" },
    { GOOGLE_API_KEY: "gl-env-test" }
  );
  assert.equal(provider.apiKey, "gl-env-test");
});

test("createProvider: anthropic api url resolves ANTHROPIC_BASE_URL", () => {
  const provider = createProvider(
    { provider: "anthropic", apiKey: "k" },
    { ANTHROPIC_BASE_URL: "https://ant.base.test" }
  );
  assert.equal(provider.apiUrl, "https://ant.base.test");
});

test("createProvider: config.apiKey takes absolute priority over all env vars", () => {
  const provider = createProvider(
    { provider: "openai", apiKey: "config-override-key" },
    { OPENAI_API_KEY: "env-openai-key" }
  );
  assert.equal(provider.apiKey, "config-override-key");
});

test("createProvider: register then create works with registered provider", () => {
  const name = "edge-case-provider-" + Date.now();
  class CustomProv {
    constructor(opts) { this.name = opts.name; this.opts = opts; }
  }
  registerProvider(name, CustomProv);

  const provider = createProvider(
    { provider: name },
    {}
  );
  assert.equal(provider.name, name);
  assert.ok(provider.opts);
});

// ---------------------------------------------------------------------------
// Messages normalization edge cases
// ---------------------------------------------------------------------------

test("normalizeMessages: returns empty array for null input", () => {
  const result = normalizeMessages(null);
  assert.deepEqual(result, []);
});

test("normalizeMessages: returns empty array for undefined input", () => {
  const result = normalizeMessages(undefined);
  assert.deepEqual(result, []);
});

test("normalizeMessages: normalizes a plain string to a user message", () => {
  const result = normalizeMessages("hello world");
  assert.equal(result.length, 1);
  assert.equal(result[0].role, "user");
  assert.equal(result[0].content, "hello world");
  assert.deepEqual(result[0].toolCalls, []);
});

test("normalizeMessages: normalizes single message object", () => {
  const result = normalizeMessages({ role: "assistant", content: "Hi there" });
  assert.equal(result.length, 1);
  assert.equal(result[0].role, "assistant");
  assert.equal(result[0].content, "Hi there");
});

test("normalizeMessages: normalizes invalid role to user", () => {
  const result = normalizeMessages({ role: "INVALID_ROLE", content: "some text" });
  assert.equal(result[0].role, "user");
});

test("normalizeMessages: filters out messages with empty content and no toolCalls", () => {
  const result = normalizeMessages([
    { role: "user", content: "" },
    { role: "assistant", content: "keep me" },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].content, "keep me");
});

test("normalizeMessages: handles array content (concatenates text parts)", () => {
  const result = normalizeMessages({
    role: "user",
    content: [{ text: "Part 1 " }, { text: "Part 2" }],
  });
  assert.equal(result[0].content, "Part 1 Part 2");
});

test("normalizeMessages: handles null content as empty string", () => {
  const result = normalizeMessages({ role: "user", content: null });
  // content is "" so it gets filtered out
  assert.equal(result.length, 0);
});

test("normalizeMessages: normalizes toolCalls with string arguments", () => {
  const result = normalizeMessages({
    role: "assistant",
    content: "calling tool",
    toolCalls: [
      { id: "call_1", name: "file.read", arguments: '{"path":"foo.txt"}' },
    ],
  });
  assert.equal(result[0].toolCalls.length, 1);
  assert.equal(result[0].toolCalls[0].name, "file.read");
  assert.deepEqual(result[0].toolCalls[0].arguments, { path: "foo.txt" });
});

test("normalizeMessages: normalizes toolCalls with function-style naming", () => {
  const result = normalizeMessages({
    role: "assistant",
    content: "ok",
    toolCalls: [
      { id: "call_2", function: { name: "shell.run", arguments: '{"command":"ls"}' } },
    ],
  });
  assert.equal(result[0].toolCalls[0].name, "shell.run");
  assert.deepEqual(result[0].toolCalls[0].arguments, { command: "ls" });
});

test("normalizeMessages: handles nested array of messages", () => {
  const result = normalizeMessages([
    "plain text",
    { role: "assistant", content: "nested answer" },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].role, "user");
  assert.equal(result[1].role, "assistant");
});

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

test("DEFAULT_SYSTEM_PROMPT is a non-empty string", () => {
  assert.ok(typeof DEFAULT_SYSTEM_PROMPT === "string");
  assert.ok(DEFAULT_SYSTEM_PROMPT.length > 0);
});

test("DEFAULT_MAX_TOOL_TURNS is a positive number", () => {
  assert.ok(Number.isFinite(DEFAULT_MAX_TOOL_TURNS));
  assert.ok(DEFAULT_MAX_TOOL_TURNS > 0);
});

test("MAX_SAME_TOOL_CALLS is a positive number", () => {
  assert.ok(Number.isFinite(MAX_SAME_TOOL_CALLS));
  assert.ok(MAX_SAME_TOOL_CALLS > 0);
});

test("parsePositiveNumber: returns fallback for non-positive values", () => {
  assert.equal(parsePositiveNumber(0, 100), 100);
  assert.equal(parsePositiveNumber(-1, 100), 100);
  assert.equal(parsePositiveNumber(NaN, 100), 100);
});

test("parsePositiveNumber: returns Infinity for Infinity", () => {
  assert.equal(parsePositiveNumber(Infinity, 100), Infinity);
});

test("parsePositiveNumber: returns valid positive number", () => {
  assert.equal(parsePositiveNumber(42, 100), 42);
});

test("withRetry: returns result on first success", async () => {
  const fn = async (val) => val * 2;
  const retryFn = withRetry(fn, 3, 10);
  const result = await retryFn(21);
  assert.equal(result, 42);
});

test("withRetry: retries on 429 status and succeeds", async () => {
  let attempts = 0;
  const fn = async () => {
    attempts++;
    if (attempts < 2) {
      const err = new Error("Rate limited");
      err.status = 429;
      throw err;
    }
    return "success";
  };
  const retryFn = withRetry(fn, 3, 10);
  const result = await retryFn();
  assert.equal(result, "success");
  assert.equal(attempts, 2);
});

test("withRetry: does not retry on 400 status", async () => {
  let attempts = 0;
  const fn = async () => {
    attempts++;
    const err = new Error("Bad request");
    err.status = 400;
    throw err;
  };
  const retryFn = withRetry(fn, 3, 10);
  await assert.rejects(() => retryFn(), { message: "Bad request" });
  assert.equal(attempts, 1);
});

test("createToolResultBlock: produces correct shape", () => {
  const block = createToolResultBlock("tool_use_123", { ok: true, data: { result: "done" } });
  assert.equal(block.type, "tool_result");
  assert.equal(block.tool_use_id, "tool_use_123");
  assert.equal(block.is_error, false);
  assert.ok(block.content.includes('"ok"'), `content missing "ok": ${block.content}`);
  assert.ok(block.content.includes('"done"'), `content missing "done": ${block.content}`);
});

test("createToolResultBlock: marks is_error when ok is not true", () => {
  const block = createToolResultBlock("tu_456", { ok: false, error: { message: "fail" } });
  assert.equal(block.is_error, true);
});

test("createToolStartChunk: produces correct shape", () => {
  const chunk = createToolStartChunk("file.read", { path: "test.txt" });
  assert.equal(chunk.type, "tool_start");
  assert.equal(chunk.name, "file.read");
  assert.deepEqual(chunk.input, { path: "test.txt" });
});

test("createToolResultChunk: produces correct shape for success", () => {
  const chunk = createToolResultChunk("file.read", false, null, { duration: 50 });
  assert.equal(chunk.type, "tool_result");
  assert.equal(chunk.name, "file.read");
  assert.equal(chunk.isError, false);
  assert.equal(chunk.duration, 50);
});

test("createToolResultChunk: includes error on failure", () => {
  const chunk = createToolResultChunk("shell.run", true, { code: "EIO", message: "IO error" });
  assert.equal(chunk.type, "tool_result");
  assert.equal(chunk.isError, true);
  assert.deepEqual(chunk.error, { code: "EIO", message: "IO error" });
});

test("createThinkingChunk: produces correct shape", () => {
  const chunk = createThinkingChunk();
  assert.equal(chunk.type, "thinking");
  assert.ok(typeof chunk.summary === "string");
});

test("extractToolError: returns null for successful result", () => {
  const result = extractToolError({ is_error: false });
  assert.equal(result, null);
});

test("extractToolError: returns null for null result", () => {
  const result = extractToolError(null);
  assert.equal(result, null);
});

test("extractToolError: extracts error message from tool result", () => {
  const result = extractToolError({
    is_error: true,
    content: JSON.stringify({ error: { message: "Something went wrong", code: "ERR" } }),
  });
  assert.equal(result, "Something went wrong");
});

test("parseToolResultContent: returns parsed JSON for valid content", () => {
  const parsed = parseToolResultContent({ content: '{"key":"value"}' });
  assert.deepEqual(parsed, { key: "value" });
});

test("parseToolResultContent: returns null for invalid JSON", () => {
  const parsed = parseToolResultContent({ content: "not-json" });
  assert.equal(parsed, null);
});

test("parseToolResultContent: returns null for missing content", () => {
  const parsed = parseToolResultContent({});
  assert.equal(parsed, null);
});

test("stripToolCallMarkup: removes DSML tool call blocks", () => {
  const input = "Before text\n<｜｜DSML｜｜tool_calls><\/｜｜DSML｜｜tool_calls>\nAfter text";
  const result = stripToolCallMarkup(input);
  assert.ok(result.includes("Before text"), `result: "${result}"`);
  assert.ok(result.includes("After text"), `result: "${result}"`);
});

test("parseDsmlToolCalls: parses tool call invocations", () => {
  const input = '<｜｜DSML｜｜invoke name="file.read">' +
    '<｜｜DSML｜｜parameter name="path">test.txt<\/｜｜DSML｜｜parameter>' +
    '<\/｜｜DSML｜｜invoke>';
  const calls = parseDsmlToolCalls(input);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "file.read");
  assert.equal(calls[0].parameters.path, "test.txt");
});

test("parseDsmlToolCalls: returns empty for null input", () => {
  assert.deepEqual(parseDsmlToolCalls(null), []);
  assert.deepEqual(parseDsmlToolCalls(undefined), []);
});

test("splitPotentialDsmlPrefix: splits text containing a partial DSML prefix", () => {
  // If text ends with something that's a prefix of the DSML prefix string
  const result = splitPotentialDsmlPrefix("some text <｜");
  assert.ok(typeof result.emit === "string");
  assert.ok(typeof result.pending === "string");
});

test("summarizeToolInput: handles file.read input", () => {
  const summary = summarizeToolInput("file.read", { path: "/src/index.js", maxBytes: 5000 });
  assert.ok(typeof summary === "string");
  assert.ok(summary.includes("src/index.js"));
});

test("summarizeToolInput: handles shell.run input", () => {
  const summary = summarizeToolInput("shell.run", { command: "npm", args: ["test"] });
  assert.ok(typeof summary === "string");
  assert.ok(summary.includes("npm"));
});

test("summarizeToolInput: handles null/undefined input", () => {
  const result = summarizeToolInput("unknown.tool", null);
  assert.equal(result, "");
});

test("summarizeToolInput: hides sensitive keys", () => {
  const summary = summarizeToolInput("file.write", { path: "file.txt", apiKey: "secret123", content: "hello" });
  assert.ok(!summary.includes("secret123"));
  assert.ok(!summary.includes("hello"));
});

test("getPermissionLevel: returns 'allow' when registry has no getPermissionLevel", () => {
  const result = getPermissionLevel({}, "some.tool");
  assert.equal(result, "allow");
});

test("getPermissionLevel: returns 'allow' for null registry", () => {
  const result = getPermissionLevel(null, "some.tool");
  assert.equal(result, "allow");
});

test("getPermissionLevel: delegates to registry method", () => {
  const registry = { getPermissionLevel: (name) => name === "dangerous" ? "ask" : "allow" };
  assert.equal(getPermissionLevel(registry, "dangerous"), "ask");
  assert.equal(getPermissionLevel(registry, "safe"), "allow");
});

test("formatInputPart: returns null for undefined value", () => {
  assert.equal(formatInputPart("key", undefined), null);
});

test("formatInputPart: returns null for empty string value", () => {
  assert.equal(formatInputPart("key", ""), null);
});

test("formatInputPart: truncates long values", () => {
  const long = "a".repeat(200);
  const result = formatInputPart("key", long);
  assert.ok(result.length <= 90);
  assert.ok(result.endsWith("..."));
});

test("joinInputParts: joins non-null parts with comma separator", () => {
  const result = joinInputParts(["a: 1", null, "b: 2", undefined, "c: 3"]);
  assert.equal(result, "a: 1, b: 2, c: 3");
});
