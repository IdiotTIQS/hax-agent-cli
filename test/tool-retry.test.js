/**
 * Tests for tool retry wrapper.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createRetryableTool,
  makeToolRetryable,
  fileRetryPolicy,
  networkRetryPolicy,
  shouldRetry,
} = require("../src/tool-retry");

test("createRetryableTool: succeeds on first attempt", async () => {
  const execute = async (args) => ({ result: args.value * 2 });
  const retryable = createRetryableTool({ toolName: "test", execute, maxRetries: 3 });
  const result = await retryable({ value: 5 }, {});
  assert.deepEqual(result, { result: 10 });
});

test("createRetryableTool: retries on failure and succeeds", async () => {
  let calls = 0;
  const execute = async () => {
    calls += 1;
    if (calls < 3) throw new Error("Transient error");
    return { success: true };
  };
  const retryable = createRetryableTool({
    toolName: "test",
    execute,
    maxRetries: 3,
    baseDelayMs: 10,
  });
  const result = await retryable({}, {});
  assert.equal(calls, 3);
  assert.deepEqual(result, { success: true });
});

test("createRetryableTool: gives up after maxRetries", async () => {
  let calls = 0;
  const execute = async () => {
    calls += 1;
    throw new Error("Persistent error");
  };
  const retryable = createRetryableTool({
    toolName: "test",
    execute,
    maxRetries: 2,
    baseDelayMs: 10,
  });
  try {
    await retryable({}, {});
    assert.fail("Should have thrown");
  } catch (error) {
    assert.match(error.message, /Persistent error/);
    assert.equal(calls, 2);
  }
});

test("createRetryableTool: does not retry when retryOn filters out the error", async () => {
  let calls = 0;
  const execute = async () => {
    calls += 1;
    const err = new Error("PERMISSION_DENIED");
    err.code = "PERMISSION_DENIED";
    throw err;
  };
  const retryable = createRetryableTool({
    toolName: "test",
    execute,
    maxRetries: 3,
    baseDelayMs: 10,
    retryOn: [/EBUSY/, /EAGAIN/], // only retry on I/O errors
  });
  try {
    await retryable({}, {});
    assert.fail("Should have thrown");
  } catch (error) {
    assert.match(error.message, /PERMISSION_DENIED/);
    assert.equal(calls, 1); // no retries
  }
});

test("createRetryableTool: retries on matching condition", async () => {
  let calls = 0;
  const execute = async () => {
    calls += 1;
    if (calls < 2) {
      const err = new Error("EBUSY: resource busy");
      err.code = "EBUSY";
      throw err;
    }
    return { success: true };
  };
  const retryable = createRetryableTool({
    toolName: "test",
    execute,
    maxRetries: 3,
    baseDelayMs: 10,
    retryOn: fileRetryPolicy(),
  });
  const result = await retryable({}, {});
  assert.equal(calls, 2);
  assert.deepEqual(result, { success: true });
});

test("makeToolRetryable: preserves tool metadata", () => {
  const tool = {
    name: "test.tool",
    description: "A test tool",
    inputSchema: { type: "object", properties: { x: { type: "number" } } },
    execute: async () => "ok",
  };
  const retryable = makeToolRetryable(tool, { maxRetries: 2, baseDelayMs: 10 });
  assert.equal(retryable.name, "test.tool");
  assert.equal(retryable.description, "A test tool");
  assert.deepEqual(retryable.inputSchema, tool.inputSchema);
  assert.ok(typeof retryable.execute === "function");
  assert.notEqual(retryable.execute, tool.execute);
});

test("fileRetryPolicy: matches I/O errors", () => {
  const policy = fileRetryPolicy();
  assert.equal(shouldRetry(new Error("EBUSY"), policy), true);
  assert.equal(shouldRetry({ code: "EAGAIN", message: "" }, policy), true);
  assert.equal(shouldRetry({ code: "ETIMEDOUT", message: "" }, policy), true);
  assert.equal(shouldRetry(new Error("PERMISSION_DENIED"), policy), false);
});

test("networkRetryPolicy: matches network errors", () => {
  const policy = networkRetryPolicy();
  assert.equal(shouldRetry(new Error("ECONNRESET"), policy), true);
  assert.equal(shouldRetry(new Error("429 Too Many Requests"), policy), true);
  assert.equal(shouldRetry({ status: 503, message: "Service Unavailable" }, policy), true);
  assert.equal(shouldRetry(new Error("400 Bad Request"), policy), false);
});

test("shouldRetry: retries all errors when no filter", () => {
  assert.equal(shouldRetry(new Error("anything"), []), true);
});

test("shouldRetry: matches string conditions case-insensitively", () => {
  assert.equal(shouldRetry(new Error("RATE LIMIT exceeded"), ["rate limit"]), true);
});

test("shouldRetry: matches function conditions", () => {
  const condition = (error) => error.retryable === true;
  assert.equal(shouldRetry({ retryable: true, message: "" }, [condition]), true);
  assert.equal(shouldRetry({ retryable: false, message: "" }, [condition]), false);
});
