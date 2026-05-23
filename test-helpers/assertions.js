/**
 * Shared assertion helpers for HaxAgent tests.
 *
 * Each function wraps node:assert/strict assertions to provide higher-level
 * checks that are more descriptive and self-documenting in test output.
 * All functions throw AssertionError on failure (via node:assert).
 */
"use strict";

const assert = require("node:assert/strict");

// ---------------------------------------------------------------------------
// assertIsError
// ---------------------------------------------------------------------------

/**
 * Assert that an error has the expected code and message pattern.
 *
 * Wraps a block that is expected to throw, or checks an already-caught error.
 *
 * @param {Error} error - the error to inspect (or pass `fn` instead)
 * @param {string} [code] - expected error code (checked via error.code or error.code)
 * @param {string|RegExp} [messagePattern] - expected substring or regex match in error.message
 * @param {Function} [fn] - if provided, calls fn() and asserts it throws matching error
 * @returns {void}
 *
 * @example
 *   // Check a caught error
 *   try { doThing(); } catch (e) { assertIsError(e, "INVALID_INPUT", /required/); }
 *
 *   // Wrapped form (auto-catches)
 *   assertIsError(null, "INVALID_INPUT", /required/, () => doThing());
 */
function assertIsError(error, code, messagePattern, fn) {
  // Wrapped form: user passed fn as 4th arg
  if (typeof fn === "function") {
    assert.throws(fn, (err) => {
      assertIsError(err, code, messagePattern);
      return true;
    });
    return;
  }

  // Wrapped form: user passed fn as 3rd arg (messagePattern omitted)
  if (typeof messagePattern === "function") {
    assert.throws(messagePattern, (err) => {
      assertIsError(err, code);
      return true;
    });
    return;
  }

  // Direct form: error is the object to check
  assert.ok(error instanceof Error, `Expected an Error but got ${typeof error}: ${String(error)}`);

  if (code !== undefined && code !== null) {
    assert.equal(
      error.code || error.code,
      code,
      `Expected error code "${code}" but got "${error.code || error.code}" (message: ${error.message})`
    );
  }

  if (messagePattern !== undefined && messagePattern !== null) {
    if (messagePattern instanceof RegExp) {
      assert.ok(
        messagePattern.test(error.message),
        `Expected error message to match ${messagePattern.toString()} but got: "${error.message}"`
      );
    } else {
      assert.ok(
        error.message.includes(messagePattern),
        `Expected error message to include "${messagePattern}" but got: "${error.message}"`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// assertValidSession
// ---------------------------------------------------------------------------

/**
 * Assert that a session object has all required properties with valid types.
 *
 * @param {object} session - the session to validate
 * @param {object} [options]
 * @param {boolean} [options.requireMessages=false] - require at least one message
 * @param {boolean} [options.requireSettings=false] - require settings object
 * @returns {void}
 */
function assertValidSession(session, options = {}) {
  assert.ok(session, "session must exist");
  assert.ok(typeof session.id === "string" && session.id.length > 0, "session.id must be a non-empty string");
  assert.ok(typeof session.createdAt === "string", "session.createdAt must be a string (ISO date)");

  // updatedAt
  assert.ok(typeof session.updatedAt === "string", "session.updatedAt must be a string (ISO date)");
  assert.ok(new Date(session.updatedAt).getTime() >= new Date(session.createdAt).getTime(), "session.updatedAt must be >= createdAt");

  // cwd
  assert.ok(typeof session.cwd === "string", "session.cwd must be a string");

  // messages
  assert.ok(Array.isArray(session.messages), "session.messages must be an array");
  if (options.requireMessages) {
    assert.ok(session.messages.length > 0, "session.messages must have at least one entry");
  }
  for (const msg of session.messages) {
    assert.ok(typeof msg.role === "string", "each message must have a string role");
    assert.ok(typeof msg.content === "string", "each message must have a string content");
  }

  // metadata
  assert.ok(session.metadata !== undefined && session.metadata !== null, "session.metadata must exist");
  assert.ok(typeof session.metadata === "object", "session.metadata must be an object");

  // methods
  assert.ok(typeof session.addMessage === "function", "session.addMessage must be a function");
  assert.ok(typeof session.getTranscript === "function", "session.getTranscript must be a function");
  assert.ok(typeof session.snapshot === "function", "session.snapshot must be a function");

  // settings (optional)
  if (options.requireSettings) {
    assert.ok(session.settings && typeof session.settings === "object", "session.settings must be an object");
  }
}

// ---------------------------------------------------------------------------
// assertValidToolResult
// ---------------------------------------------------------------------------

/**
 * Assert that an object matches the tool result structure.
 *
 * @param {object} result - the result to validate
 * @param {object} [options]
 * @param {boolean} [options.expectOk=true] - whether result.ok should be true
 * @param {string} [options.expectedToolName] - specific tool name to expect
 * @returns {void}
 */
function assertValidToolResult(result, options = {}) {
  const expectOk = options.expectOk !== false;

  assert.ok(result, "tool result must exist");
  assert.ok(typeof result.toolName === "string" && result.toolName.length > 0, "tool result must have a non-empty toolName");
  assert.ok(typeof result.ok === "boolean", "tool result must have a boolean ok field");
  assert.ok(typeof result.durationMs === "number" && result.durationMs >= 0, "tool result must have a non-negative durationMs");

  if (expectOk) {
    assert.equal(result.ok, true, `tool result for "${result.toolName}" should be ok`);
    assert.ok("data" in result, "successful tool result must have data field");
  } else {
    assert.equal(result.ok, false, `tool result for "${result.toolName}" should not be ok`);
  }

  if (options.expectedToolName) {
    assert.equal(result.toolName, options.expectedToolName, `tool result toolName should be "${options.expectedToolName}"`);
  }
}

// ---------------------------------------------------------------------------
// assertValidMemoryEntry
// ---------------------------------------------------------------------------

/**
 * Assert that an object matches the memory entry structure.
 *
 * @param {object} entry - the memory entry to validate
 * @param {object} [options]
 * @param {string} [options.expectedName] - specific name to expect
 * @param {string} [options.expectedNamespace] - specific namespace to expect
 * @param {boolean} [options.requireTags=true] - check that tags is an array
 * @returns {void}
 */
function assertValidMemoryEntry(entry, options = {}) {
  assert.ok(entry, "memory entry must exist");
  assert.ok(typeof entry.name === "string" && entry.name.length > 0, "memory entry must have a non-empty name");
  assert.ok(typeof entry.content === "string", "memory entry must have string content");
  assert.ok(typeof entry.namespace === "string", "memory entry must have string namespace");
  assert.ok(typeof entry.createdAt === "string", "memory entry must have string createdAt");
  assert.ok(typeof entry.updatedAt === "string", "memory entry must have string updatedAt");
  assert.ok(new Date(entry.updatedAt).getTime() >= new Date(entry.createdAt).getTime(), "updatedAt must be >= createdAt");

  if (options.requireTags !== false) {
    assert.ok(Array.isArray(entry.tags), "memory entry must have tags array");
    for (const tag of entry.tags) {
      assert.ok(typeof tag === "string", "each tag must be a string");
    }
  }

  if (options.expectedName) {
    assert.equal(entry.name, options.expectedName);
  }

  if (options.expectedNamespace) {
    assert.equal(entry.namespace, options.expectedNamespace);
  }
}

// ---------------------------------------------------------------------------
// assertDeepContains
// ---------------------------------------------------------------------------

/**
 * Assert that `actual` contains all properties from `expected` (deep partial match).
 *
 * For nested objects, only the keys in `expected` are checked. Arrays are
 * compared element-by-element for the length of the expected array.
 *
 * @param {object} actual - the object to check
 * @param {object} expected - the properties it must contain
 * @param {string} [path="root"] - path prefix for error messages (used recursively)
 * @returns {void}
 *
 * @example
 *   assertDeepContains({ a: 1, b: 2, c: { d: 3 } }, { a: 1, c: {} });
 *   // passes: actual has a=1 and c is an object
 *
 *   assertDeepContains({ x: 10 }, { y: 20 });
 *   // fails: actual is missing property y
 */
function assertDeepContains(actual, expected, path = "root") {
  if (expected === null || expected === undefined) {
    assert.equal(actual, expected, `at "${path}": expected ${expected}, got ${actual}`);
    return;
  }

  assert.ok(actual !== null && actual !== undefined, `at "${path}": expected non-null value, got ${actual}`);

  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `at "${path}": expected array, got ${typeof actual}`);
    assert.ok(actual.length >= expected.length, `at "${path}": expected array length >= ${expected.length}, got ${actual.length}`);
    for (let i = 0; i < expected.length; i += 1) {
      assertDeepContains(actual[i], expected[i], `${path}[${i}]`);
    }
    return;
  }

  if (typeof expected === "object") {
    assert.ok(typeof actual === "object" && !Array.isArray(actual), `at "${path}": expected object, got ${typeof actual}`);
    for (const key of Object.keys(expected)) {
      const subPath = `${path}.${key}`;
      assert.ok(key in actual, `at "${subPath}": property is missing`);
      assertDeepContains(actual[key], expected[key], subPath);
    }
    return;
  }

  // Primitive comparison
  if (expected !== expected) {
    // NaN check
    assert.ok(actual !== actual, `at "${path}": expected NaN, got ${actual}`);
  } else {
    assert.equal(actual, expected, `at "${path}": expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// assertValidProviderResponse (bonus utility)
// ---------------------------------------------------------------------------

/**
 * Assert that an object matches the ChatProvider response structure.
 *
 * @param {object} response - the response to validate
 * @returns {void}
 */
function assertValidProviderResponse(response) {
  assert.ok(response, "provider response must exist");
  assert.ok(typeof response.id === "string", "response.id must be a string");
  assert.ok(typeof response.provider === "string", "response.provider must be a string");
  assert.ok(typeof response.model === "string", "response.model must be a string");
  assert.equal(response.role, "assistant", "response.role must be 'assistant'");
  assert.ok(typeof response.content === "string", "response.content must be a string");
  assert.ok(response.usage && typeof response.usage === "object", "response.usage must be an object");
  assert.ok(typeof response.usage.inputTokens === "number", "response.usage.inputTokens must be a number");
  assert.ok(typeof response.usage.outputTokens === "number", "response.usage.outputTokens must be a number");
}

// ---------------------------------------------------------------------------
// assertValidTranscriptEntry (bonus utility)
// ---------------------------------------------------------------------------

/**
 * Assert that an object matches a transcript entry structure.
 *
 * @param {object} entry - the transcript entry to validate
 * @returns {void}
 */
function assertValidTranscriptEntry(entry) {
  assert.ok(entry, "transcript entry must exist");
  assert.ok(typeof entry.type === "string" && entry.type.length > 0, "transcript entry must have a non-empty type");
  assert.ok(typeof entry.timestamp === "string", "transcript entry must have string timestamp");
  assert.ok(!Number.isNaN(new Date(entry.timestamp).getTime()), "transcript timestamp must be a valid date");
}

// ---------------------------------------------------------------------------
// assertMockCallCount (bonus utility)
// ---------------------------------------------------------------------------

/**
 * Assert that a mock object's call counter matches expectations.
 *
 * @param {object} mock - an object with *CallCount properties
 * @param {object} expected - e.g. { chatCallCount: 2, executeCallCount: 1 }
 * @returns {void}
 */
function assertMockCallCount(mock, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(mock[key], value, `mock.${key}: expected ${value}, got ${mock[key]}`);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  assertIsError,
  assertValidSession,
  assertValidToolResult,
  assertValidMemoryEntry,
  assertDeepContains,
  assertValidProviderResponse,
  assertValidTranscriptEntry,
  assertMockCallCount,
};
