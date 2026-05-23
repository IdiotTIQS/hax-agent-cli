/**
 * Tests for plugin validator.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertValidPlugin,
  formatPluginValidationResult,
  validatePlugin,
} = require("../src/plugin-validator");

test("validatePlugin: accepts valid plugin", () => {
  const plugin = {
    name: "my-plugin",
    version: "1.0.0",
    hooks: {
      beforeChat: (ctx) => ctx,
      afterChat: (ctx) => ctx,
    },
    description: "A test plugin",
  };
  const result = validatePlugin(plugin);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validatePlugin: rejects non-object", () => {
  const result = validatePlugin("not-an-object");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes("must be an object")));
});

test("validatePlugin: rejects array", () => {
  const result = validatePlugin([]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes("not an array")));
});

test("validatePlugin: rejects missing name", () => {
  const result = validatePlugin({ version: "1.0.0", hooks: {} });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "name"));
});

test("validatePlugin: rejects empty name", () => {
  const result = validatePlugin({ name: "   ", hooks: {} });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "name"));
});

test("validatePlugin: warns on non-semver version", () => {
  const plugin = { name: "test", version: "alpha" };
  const result = validatePlugin(plugin);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.path === "version"));
});

test("validatePlugin: rejects non-function hooks", () => {
  const plugin = {
    name: "test",
    hooks: {
      beforeChat: "not-a-function",
    },
  };
  const result = validatePlugin(plugin);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "hooks.beforeChat" && e.message.includes("must be a function")));
});

test("validatePlugin: complains about unknown hook names", () => {
  const plugin = {
    name: "test",
    hooks: {
      beforeBanana: (ctx) => ctx,
    },
  };
  const result = validatePlugin(plugin);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path.includes("beforeBanana")));
});

test("validatePlugin: warns on hook with zero params", () => {
  const plugin = {
    name: "test",
    hooks: {
      beforeChat: () => {},
    },
  };
  const result = validatePlugin(plugin);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.path === "hooks.beforeChat" && w.message.includes("expects no parameters")));
});

test("validatePlugin: validates all built-in hook names", () => {
  const plugin = {
    name: "full-plugin",
    version: "1.0.0",
    hooks: {
      beforeToolCall: (ctx) => ctx,
      afterToolCall: (ctx) => ctx,
      onError: (ctx) => ctx,
      beforeChat: (ctx) => ctx,
      afterChat: (ctx) => ctx,
      onSessionStart: (ctx) => ctx,
      onSessionEnd: (ctx) => ctx,
    },
  };
  const result = validatePlugin(plugin);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validatePlugin: warns about description not being a string", () => {
  const plugin = { name: "test", description: 123 };
  const result = validatePlugin(plugin);
  assert.ok(result.warnings.some((w) => w.path === "description"));
});

test("assertValidPlugin: throws on invalid plugin", () => {
  assert.throws(
    () => assertValidPlugin({ hooks: {} }),
    { message: /Plugin validation failed/ }
  );
});

test("assertValidPlugin: does not throw for valid plugin", () => {
  assertValidPlugin({
    name: "ok",
    hooks: { beforeChat: (ctx) => ctx },
  });
});

test("formatPluginValidationResult: formats errors", () => {
  const result = { errors: [{ path: "name", message: "Required" }], warnings: [] };
  const formatted = formatPluginValidationResult(result);
  assert.ok(formatted.includes("Errors"));
  assert.ok(formatted.includes("Required"));
});

test("formatPluginValidationResult: formats warnings", () => {
  const result = { errors: [], warnings: [{ path: "version", message: "Not semver" }] };
  const formatted = formatPluginValidationResult(result);
  assert.ok(formatted.includes("Warnings"));
  assert.ok(formatted.includes("Not semver"));
});

test("formatPluginValidationResult: success message for no issues", () => {
  const result = { errors: [], warnings: [] };
  const formatted = formatPluginValidationResult(result);
  assert.ok(formatted.includes("valid"));
});
