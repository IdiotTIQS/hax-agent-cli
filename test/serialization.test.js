/**
 * Tests for serialization utils: serializeProvider, serializeError,
 * serializeSkill, serializeProviderIssue, isTerminalToolLimitReason.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  serializeProvider,
  serializeError,
  serializeSkill,
  serializeProviderIssue,
  isTerminalToolLimitReason,
} = require("../src/shared/serialization");

test("serializeProvider: returns null for null/undefined provider", () => {
  assert.equal(serializeProvider(null), null);
  assert.equal(serializeProvider(undefined), null);
});

test("serializeProvider: includes name, model, apiUrl", () => {
  const result = serializeProvider({
    name: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiUrl: "https://api.example.com",
  });
  assert.deepEqual(result, {
    name: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiUrl: "https://api.example.com",
  });
});

test("serializeProvider: handles missing fields gracefully", () => {
  const result = serializeProvider({ name: "mock" });
  assert.equal(result.name, "mock");
  assert.equal(result.model, undefined);
  assert.equal(result.apiUrl, undefined);
});

test("serializeProvider: does not expose extra fields", () => {
  const result = serializeProvider({
    name: "anthropic",
    model: "claude-sonnet",
    apiUrl: "https://api.example.com",
    apiKey: "secret",
    client: {},
    internalState: "exposed",
  });
  assert.equal(result.apiKey, undefined);
  assert.equal(result.client, undefined);
  assert.equal(result.internalState, undefined);
  assert.equal(Object.keys(result).length, 3);
});

test("serializeError: handles null/undefined error", () => {
  const result = serializeError(null);
  assert.equal(result.name, "Error");
  assert.equal(result.code, null);
  assert.equal(result.message, "Unknown error");
  assert.equal(result.stack, null);
});

test("serializeError: handles undefined error", () => {
  const result = serializeError(undefined);
  assert.equal(result.name, "Error");
  assert.equal(result.message, "Unknown error");
});

test("serializeError: serializes standard Error", () => {
  const err = new Error("something went wrong");
  const result = serializeError(err);
  assert.equal(result.name, "Error");
  assert.equal(result.code, null);
  assert.equal(result.message, "something went wrong");
  assert.ok(result.stack);
  assert.ok(result.stack.includes("something went wrong"));
});

test("serializeError: serializes Error with code", () => {
  const err = new Error("not found");
  err.code = "ENOENT";
  const result = serializeError(err);
  assert.equal(result.code, "ENOENT");
  assert.equal(result.message, "not found");
});

test("serializeError: serializes error with custom name", () => {
  class CustomError extends Error {
    constructor(message) {
      super(message);
      this.name = "CustomError";
    }
  }
  const err = new CustomError("custom issue");
  const result = serializeError(err);
  assert.equal(result.name, "CustomError");
});

test("serializeError: serializes error-like object", () => {
  const errorLike = { name: "MyError", code: "CUSTOM_123", message: "custom fail" };
  const result = serializeError(errorLike);
  assert.equal(result.name, "MyError");
  assert.equal(result.code, "CUSTOM_123");
  assert.equal(result.message, "custom fail");
  assert.equal(result.stack, null);
});

test("serializeError: handles non-error primitives", () => {
  assert.equal(serializeError("string error").message, "string error");
  assert.equal(serializeError(42).message, "42");
  assert.equal(serializeError(true).message, "true");
});

test("serializeSkill: returns null for null/undefined input", () => {
  assert.equal(serializeSkill(null), null);
  assert.equal(serializeSkill(undefined), null);
});

test("serializeSkill: serializes minimal skill", () => {
  const result = serializeSkill({ name: "test-skill" });
  assert.deepEqual(result, {
    name: "test-skill",
    displayName: "test-skill",
    description: "",
    source: null,
  });
});

test("serializeSkill: uses displayName when provided", () => {
  const result = serializeSkill({
    name: "internal-name",
    displayName: "Pretty Name",
  });
  assert.equal(result.displayName, "Pretty Name");
});

test("serializeSkill: uses description when provided", () => {
  const result = serializeSkill({
    name: "test",
    description: "A test skill",
  });
  assert.equal(result.description, "A test skill");
});

test("serializeSkill: preserves source field", () => {
  const result = serializeSkill({ name: "test", source: "projectSettings" });
  assert.equal(result.source, "projectSettings");
});

test("serializeProviderIssue: handles empty_tool_preamble", () => {
  const result = serializeProviderIssue({ reason: "empty_tool_preamble" });
  assert.equal(result.name, "ProviderToolUseError");
  assert.equal(result.code, "EMPTY_TOOL_PREAMBLE");
  assert.ok(result.message.includes("did not call an available tool"));
  assert.equal(result.stack, null);
});

test("serializeProviderIssue: handles unknown reason with default", () => {
  const result = serializeProviderIssue({ reason: "some_other" });
  assert.equal(result.name, "ProviderToolUseError");
  assert.equal(result.code, "some_other");
  assert.ok(result.message.includes("provider stopped"));
});

test("serializeProviderIssue: handles missing reason", () => {
  const result = serializeProviderIssue({});
  assert.equal(result.code, "PROVIDER_TOOL_LIMIT");
  assert.ok(result.message.includes("provider stopped"));
});

test("serializeProviderIssue: handles null/undefined", () => {
  const result = serializeProviderIssue(null);
  assert.equal(result.code, "PROVIDER_TOOL_LIMIT");
  assert.equal(result.name, "ProviderToolUseError");
});

test("isTerminalToolLimitReason: returns true for empty_tool_preamble", () => {
  assert.equal(isTerminalToolLimitReason("empty_tool_preamble"), true);
});

test("isTerminalToolLimitReason: returns false for other reasons", () => {
  assert.equal(isTerminalToolLimitReason("max_tool_turns"), false);
  assert.equal(isTerminalToolLimitReason("repeated_invalid_tool_call"), false);
  assert.equal(isTerminalToolLimitReason(""), false);
  assert.equal(isTerminalToolLimitReason(null), false);
  assert.equal(isTerminalToolLimitReason(undefined), false);
});
