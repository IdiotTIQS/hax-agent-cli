/**
 * Tests for tool error handling — serialization, error codes, registry, and tool throws.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { ToolExecutionError } = require("../src/tools/error");
const { ErrorCodes } = require("../src/tools/error-codes");
const {
  serializeError,
  serializeToolResult,
  toJsonSafe,
} = require("../src/tools/utils");
const { ToolRegistry } = require("../src/tools/registry");

// ── serializeError ──────────────────────────────────────

describe("serializeError", () => {
  it("handles ToolExecutionError with code and message", () => {
    const err = new ToolExecutionError("STOCK_TIMEOUT", "Request timed out");
    const result = serializeError(err);
    assert.strictEqual(result.code, "STOCK_TIMEOUT");
    assert.strictEqual(result.message, "Request timed out");
  });

  it("handles ToolExecutionError with details", () => {
    const err = new ToolExecutionError("HTTP_ERROR", "HTTP 500", { status: 500 });
    const result = serializeError(err);
    assert.strictEqual(result.code, "HTTP_ERROR");
    assert.strictEqual(result.details.status, 500);
  });

  it("falls back to TOOL_ERROR for raw Error without code", () => {
    const err = new Error("Something broke");
    const result = serializeError(err);
    assert.strictEqual(result.code, "TOOL_ERROR");
    assert.strictEqual(result.message, "Something broke");
  });

  it("inherits Node.js syscall error.code (defensive)", () => {
    const err = new Error("ENOENT: no such file");
    err.code = "ENOENT";
    const result = serializeError(err);
    // Node.js errors have .code set by the runtime — we don't strip it
    // but the error originates from a raw throw, so code is ENOENT
    assert.strictEqual(result.code, "ENOENT");
  });

  it("handles null/undefined", () => {
    assert.strictEqual(serializeError(null).code, "TOOL_ERROR");
    assert.strictEqual(serializeError(undefined).code, "TOOL_ERROR");
  });

  it("handles string error", () => {
    const result = serializeError("plain text error");
    assert.strictEqual(result.code, "TOOL_ERROR");
    assert.strictEqual(result.message, "plain text error");
  });

  it("handles error-like object with no code", () => {
    const result = serializeError({ message: "custom obj", name: "CustomError" });
    assert.strictEqual(result.code, "TOOL_ERROR");
    assert.strictEqual(result.message, "custom obj");
  });
});

// ── serializeToolResult ─────────────────────────────────

describe("serializeToolResult", () => {
  it("serializes successful result", () => {
    const result = serializeToolResult({
      toolName: "file.read",
      ok: true,
      data: { path: "test.js", bytes: 100 },
      durationMs: 42,
    });
    assert.strictEqual(result.type, "tool_result");
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.path, "test.js");
    assert.strictEqual(result.durationMs, 42);
  });

  it("serializes error result", () => {
    const err = new ToolExecutionError("PATH_NOT_FOUND", "No such file");
    const result = serializeToolResult({
      toolName: "file.read",
      ok: false,
      error: err,
      durationMs: 5,
    });
    assert.strictEqual(result.type, "tool_result");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "PATH_NOT_FOUND");
    assert.strictEqual(result.error.message, "No such file");
  });

  it("serializes raw Error result", () => {
    const result = serializeToolResult({
      toolName: "shell.run",
      ok: false,
      error: new Error("spawn ENOENT"),
      durationMs: 10,
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "TOOL_ERROR");
    assert.strictEqual(result.error.message, "spawn ENOENT");
  });
});

// ── toJsonSafe ──────────────────────────────────────────

describe("toJsonSafe", () => {
  it("returns null for undefined", () => {
    assert.strictEqual(toJsonSafe(undefined), null);
  });

  it("handles Buffer", () => {
    assert.strictEqual(toJsonSafe(Buffer.from("hello")), "hello");
  });

  it("handles Error as nested value", () => {
    const err = new ToolExecutionError("FETCH_FAILED", "timeout");
    const result = toJsonSafe({ nested: err });
    assert.strictEqual(result.nested.code, "FETCH_FAILED");
  });

  it("handles circular reference", () => {
    const obj = { a: 1 };
    obj.self = obj;
    const result = toJsonSafe(obj);
    assert.strictEqual(result.self, "[Circular]");
    assert.strictEqual(result.a, 1);
  });
});

// ── ToolExecutionError ──────────────────────────────────

describe("ToolExecutionError", () => {
  it("sets correct name and properties", () => {
    const err = new ToolExecutionError("SEARCH_FAILED", "All sources failed", { sources: 2 });
    assert.strictEqual(err.name, "ToolExecutionError");
    assert.strictEqual(err.code, "SEARCH_FAILED");
    assert.strictEqual(err.message, "All sources failed");
    assert.strictEqual(err.details.sources, 2);
  });

  it("is instanceof Error", () => {
    const err = new ToolExecutionError("TEST", "test");
    assert.ok(err instanceof Error);
  });
});

// ── ErrorCodes ──────────────────────────────────────────

describe("ErrorCodes", () => {
  it("has all required categories", () => {
    // Validation
    assert.strictEqual(ErrorCodes.INVALID_ARGUMENT, "INVALID_ARGUMENT");
    assert.strictEqual(ErrorCodes.INVALID_ENCODING, "INVALID_ENCODING");
    assert.strictEqual(ErrorCodes.INVALID_LIMIT, "INVALID_LIMIT");

    // File-System
    assert.strictEqual(ErrorCodes.PATH_NOT_FOUND, "PATH_NOT_FOUND");
    assert.strictEqual(ErrorCodes.NOT_A_FILE, "NOT_A_FILE");
    assert.strictEqual(ErrorCodes.NOT_A_DIRECTORY, "NOT_A_DIRECTORY");
    assert.strictEqual(ErrorCodes.FILE_STAT_ERROR, "FILE_STAT_ERROR");
    assert.strictEqual(ErrorCodes.FILE_READ_ERROR, "FILE_READ_ERROR");

    // File-Edit
    assert.strictEqual(ErrorCodes.TEXT_NOT_FOUND, "TEXT_NOT_FOUND");
    assert.strictEqual(ErrorCodes.AMBIGUOUS_TEXT, "AMBIGUOUS_TEXT");

    // Shell
    assert.strictEqual(ErrorCodes.SHELL_DISABLED, "SHELL_DISABLED");
    assert.strictEqual(ErrorCodes.SHELL_SPAWN_ERROR, "SHELL_SPAWN_ERROR");

    // Web
    assert.strictEqual(ErrorCodes.HTTP_ERROR, "HTTP_ERROR");
    assert.strictEqual(ErrorCodes.FETCH_FAILED, "FETCH_FAILED");
    assert.strictEqual(ErrorCodes.SEARCH_FAILED, "SEARCH_FAILED");

    // Stock
    assert.strictEqual(ErrorCodes.STOCK_PARSE_ERROR, "STOCK_PARSE_ERROR");
    assert.strictEqual(ErrorCodes.STOCK_TIMEOUT, "STOCK_TIMEOUT");
    assert.strictEqual(ErrorCodes.STOCK_NO_DATA, "STOCK_NO_DATA");
    assert.strictEqual(ErrorCodes.STOCK_FETCH_ERROR, "STOCK_FETCH_ERROR");

    // Registry
    assert.strictEqual(ErrorCodes.TOOL_NOT_FOUND, "TOOL_NOT_FOUND");
    assert.strictEqual(ErrorCodes.PERMISSION_DENIED, "PERMISSION_DENIED");

    // Fallback
    assert.strictEqual(ErrorCodes.TOOL_ERROR, "TOOL_ERROR");
  });

  it("has no duplicate values (all codes unique)", () => {
    const values = Object.values(ErrorCodes);
    const unique = new Set(values);
    assert.strictEqual(unique.size, values.length);
  });
});

// ── Registry error handling ─────────────────────────────

describe("ToolRegistry error paths", () => {
  it("executes a working tool", async () => {
    const registry = new ToolRegistry({ root: process.cwd() });
    registry.register({
      name: "test.hello",
      description: "test",
      async execute() { return { hello: "world" }; },
    });
    const result = await registry.execute("test.hello", {});
    assert.strictEqual(result.type, "tool_result");
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.hello, "world");
  });

  it("returns ok:false when tool throws ToolExecutionError", async () => {
    const registry = new ToolRegistry({ root: process.cwd() });
    registry.register({
      name: "test.fail",
      description: "test",
      async execute() {
        throw new ToolExecutionError("TEST_ERROR", "intentional failure");
      },
    });
    const result = await registry.execute("test.fail", {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "TEST_ERROR");
    assert.strictEqual(result.error.message, "intentional failure");
  });

  it("returns ok:false when tool throws raw Error", async () => {
    const registry = new ToolRegistry({ root: process.cwd() });
    registry.register({
      name: "test.rawfail",
      description: "test",
      async execute() {
        throw new Error("raw explosion");
      },
    });
    const result = await registry.execute("test.rawfail", {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "TOOL_ERROR");
    assert.strictEqual(result.error.message, "raw explosion");
  });

  it("returns TOOL_NOT_FOUND for unknown tool", async () => {
    const registry = new ToolRegistry({ root: process.cwd() });
    const result = await registry.execute("nonexistent.tool", {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "TOOL_NOT_FOUND");
  });

  it("returns INVALID_TOOL_NAME for empty name", async () => {
    const registry = new ToolRegistry({ root: process.cwd() });
    const result = await registry.execute("", {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "INVALID_TOOL_NAME");
  });
});

// ── utils error helpers ─────────────────────────────────

describe("requireString", () => {
  const { requireString } = require("../src/tools/utils");

  it("returns non-empty string", () => {
    assert.strictEqual(requireString("hello", "test"), "hello");
  });

  it("throws for empty string", () => {
    assert.throws(
      () => requireString("", "test"),
      (err) => err.code === "INVALID_ARGUMENT"
    );
  });

  it("throws for undefined", () => {
    assert.throws(
      () => requireString(undefined, "test"),
      (err) => err.code === "INVALID_ARGUMENT"
    );
  });
});

describe("resolveWithinRoot", () => {
  const { resolveWithinRoot } = require("../src/tools/utils");

  it("resolves path inside root", () => {
    const root = process.cwd();
    const result = resolveWithinRoot(root, "package.json");
    assert.ok(result.startsWith(root));
  });

  it("throws for path outside root", () => {
    const root = process.cwd();
    assert.throws(
      () => resolveWithinRoot(root, `..${path.sep}..${path.sep}Windows${path.sep}System32`),
      (err) => err.code === "PATH_OUTSIDE_ROOT"
    );
  });
});
