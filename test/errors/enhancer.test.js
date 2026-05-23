/**
 * Tests for ErrorEnhancer — error message enrichment, context, suggestions,
 * docs links, debug info, and user-friendly formatting.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { ErrorEnhancer, SUGGESTIONS, enhanceError } = require("../../src/shared/errors/enhancer");
const { ToolExecutionError } = require("../../src/tools/error");

// ── enhance ────────────────────────────────────────────────────────

describe("ErrorEnhancer.enhance", () => {
  it("enriches a ToolExecutionError with code, message, and timestamp", () => {
    const err = new ToolExecutionError("FETCH_FAILED", "Request timed out");
    const result = ErrorEnhancer.enhance(err, { toolName: "web.fetch" });

    assert.strictEqual(result.type, "enhanced_error");
    assert.strictEqual(result.code, "FETCH_FAILED");
    assert.strictEqual(result.message, "Request timed out");
    assert.strictEqual(result.originalName, "ToolExecutionError");
    assert.ok(typeof result.timestamp === "number");
    assert.strictEqual(result.context.toolName, "web.fetch");
  });

  it("enriches a raw Error with TOOL_ERROR fallback code", () => {
    const err = new Error("Something exploded");
    const result = ErrorEnhancer.enhance(err, { phase: "execute" });

    assert.strictEqual(result.code, "TOOL_ERROR");
    assert.strictEqual(result.message, "Something exploded");
    assert.strictEqual(result.originalName, "Error");
    assert.strictEqual(result.context.phase, "execute");
    assert.ok(result._debugStack);
  });

  it("enriches a string error", () => {
    const result = ErrorEnhancer.enhance("plain text failure");
    assert.strictEqual(result.code, "TOOL_ERROR");
    assert.strictEqual(result.message, "plain text failure");
    assert.strictEqual(result.originalName, undefined);
  });

  it("enriches null/undefined gracefully", () => {
    let result = ErrorEnhancer.enhance(null);
    assert.strictEqual(result.code, "TOOL_ERROR");
    assert.strictEqual(result.message, "Unknown error");

    result = ErrorEnhancer.enhance(undefined);
    assert.strictEqual(result.code, "TOOL_ERROR");
  });

  it("carries forward details from ToolExecutionError", () => {
    const err = new ToolExecutionError("HTTP_ERROR", "Bad request", { status: 400, url: "/api" });
    const result = ErrorEnhancer.enhance(err);
    assert.deepEqual(result.details, { status: 400, url: "/api" });
  });

  it("attaches execution context with sanitized args", () => {
    const err = new Error("fail");
    const longStr = "x".repeat(300);
    const result = ErrorEnhancer.enhance(err, {
      toolName: "file.read",
      args: { path: "/some/path", content: longStr, buf: Buffer.from("hello") },
      workspaceRoot: "/home/project",
      phase: "validate",
    });

    assert.strictEqual(result.context.toolName, "file.read");
    assert.strictEqual(result.context.phase, "validate");
    assert.strictEqual(result.context.workspaceRoot, "/home/project");
    assert.strictEqual(result.context.args.path, "/some/path");
    assert.ok(result.context.args.content.endsWith("..."));
    assert.ok(result.context.args.content.length <= 203);
    assert.strictEqual(result.context.args.buf, "[Buffer: 5 bytes]");
  });
});

// ── addSuggestion ──────────────────────────────────────────────────

describe("ErrorEnhancer.addSuggestion", () => {
  it("adds suggestion for FETCH_FAILED", () => {
    const enriched = ErrorEnhancer.enhance(new ToolExecutionError("FETCH_FAILED", "timeout"));
    const result = ErrorEnhancer.addSuggestion(enriched);
    assert.ok(result.suggestion.includes("network request failed"));
  });

  it("adds suggestion for PATH_NOT_FOUND", () => {
    const enriched = ErrorEnhancer.enhance(new ToolExecutionError("PATH_NOT_FOUND", "no such file"));
    const result = ErrorEnhancer.addSuggestion(enriched);
    assert.ok(result.suggestion.includes("does not exist"));
  });

  it("adds suggestion for TOOL_ERROR with generic guidance", () => {
    const enriched = ErrorEnhancer.enhance(new Error("unknown"));
    const result = ErrorEnhancer.addSuggestion(enriched);
    assert.ok(result.suggestion.includes("unexpected tool error"));
  });

  it("handles null input gracefully", () => {
    const result = ErrorEnhancer.addSuggestion(null);
    assert.strictEqual(result, null);
  });
});

// ── addRelatedDocs ─────────────────────────────────────────────────

describe("ErrorEnhancer.addRelatedDocs", () => {
  it("adds docs link for known error code", () => {
    const enriched = ErrorEnhancer.enhance(new ToolExecutionError("TEXT_NOT_FOUND", "not found"));
    const result = ErrorEnhancer.addRelatedDocs(enriched);
    assert.ok(Array.isArray(result.docs));
    assert.strictEqual(result.docs.length, 1);
    assert.ok(result.docs[0].includes("text-not-found"));
  });

  it("adds generic troubleshooting link for unknown code", () => {
    const enriched = ErrorEnhancer.enhance(new Error("mystery"));
    const result = ErrorEnhancer.addRelatedDocs(enriched);
    assert.ok(result.docs[0].includes("troubleshooting"));
  });
});

// ── addDebugInfo ───────────────────────────────────────────────────

describe("ErrorEnhancer.addDebugInfo", () => {
  it("adds stack trace by default", () => {
    const enriched = ErrorEnhancer.enhance(new Error("debug me"));
    const result = ErrorEnhancer.addDebugInfo(enriched);
    assert.ok(result._debug);
    assert.ok(result._debug.stack.includes("Error: debug me"));
  });

  it("omits stack when includeStack is false", () => {
    const enriched = ErrorEnhancer.enhance(new Error("debug me"));
    const result = ErrorEnhancer.addDebugInfo(enriched, { includeStack: false });
    assert.strictEqual(result._debug.stack, undefined);
  });

  it("includes env info when requested", () => {
    const enriched = ErrorEnhancer.enhance(new Error("env info"));
    const result = ErrorEnhancer.addDebugInfo(enriched, { includeEnv: true });
    assert.strictEqual(result._debug.nodeVersion, process.version);
    assert.strictEqual(result._debug.platform, process.platform);
  });
});

// ── addContext ─────────────────────────────────────────────────────

describe("ErrorEnhancer.addContext", () => {
  it("merges context into an enhanced error", () => {
    const enriched = ErrorEnhancer.enhance(new Error("test"), { toolName: "initial" });
    ErrorEnhancer.addContext(enriched, { phase: "execute" });
    assert.strictEqual(enriched.context.toolName, "initial");
    assert.strictEqual(enriched.context.phase, "execute");
  });

  it("handles null error input", () => {
    const result = ErrorEnhancer.addContext(null, { toolName: "x" });
    assert.strictEqual(result, null);
  });
});

// ── formatForUser ──────────────────────────────────────────────────

describe("ErrorEnhancer.formatForUser", () => {
  it("formats enhanced error for user display", () => {
    const err = new ToolExecutionError("PERMISSION_DENIED", "Access denied");
    let enriched = ErrorEnhancer.enhance(err, { toolName: "file.write" });
    enriched = ErrorEnhancer.addSuggestion(enriched);
    enriched = ErrorEnhancer.addRelatedDocs(enriched);

    const display = ErrorEnhancer.formatForUser(enriched);
    assert.strictEqual(display.title, "Error [PERMISSION_DENIED]");
    assert.strictEqual(display.message, "Access denied");
    assert.strictEqual(display.tool, "file.write");
    assert.ok(display.suggestion.includes("Permission denied"));
    assert.ok(Array.isArray(display.relevantDocs));
    assert.ok(typeof display.occurredAt === "string");
  });

  it("formats minimal error without enhancement layers", () => {
    const enriched = ErrorEnhancer.enhance(new Error("raw"));
    const display = ErrorEnhancer.formatForUser(enriched);
    assert.strictEqual(display.title, "Error [TOOL_ERROR]");
    assert.strictEqual(display.message, "raw");
    assert.ok(display.suggestion);
  });

  it("handles null input with fallback message", () => {
    const display = ErrorEnhancer.formatForUser(null);
    assert.strictEqual(display.title, "Error");
    assert.strictEqual(display.message, "Unknown error");
  });
});

// ── full (one-shot) ────────────────────────────────────────────────

describe("ErrorEnhancer.full", () => {
  it("returns fully enriched and formatted error in one call", () => {
    const err = new ToolExecutionError("INVALID_URL", "Bad URL", { url: "ftp://bad" });
    const display = ErrorEnhancer.full(err, { toolName: "web.fetch", phase: "validate" });

    assert.strictEqual(display.title, "Error [INVALID_URL]");
    assert.strictEqual(display.message, "Bad URL");
    assert.strictEqual(display.tool, "web.fetch");
    assert.ok(display.suggestion);
    assert.ok(display.relevantDocs);
    assert.ok(display.occurredAt);
  });
});

// ── enhanceError chainable builder ─────────────────────────────────

describe("enhanceError builder", () => {
  it("chains suggestion, docs, debug, and format", () => {
    const err = new ToolExecutionError("TOOL_NOT_FOUND", "No such tool registered");
    const display = enhanceError(err, { toolName: "unknown.cmd" })
      .suggestion()
      .docs()
      .debug()
      .format();

    assert.strictEqual(display.title, "Error [TOOL_NOT_FOUND]");
    assert.ok(display.suggestion.includes("tool was not found"));
    assert.ok(display.relevantDocs.length > 0);
  });

  it("returns raw state via .get()", () => {
    const err = new Error("raw");
    const state = enhanceError(err).suggestion().docs().get();

    assert.strictEqual(state.code, "TOOL_ERROR");
    assert.ok(state.suggestion);
    assert.ok(state.docs);
  });

  it("supports inline context addition", () => {
    const err = new ToolExecutionError("CONTENT_TOO_LARGE", "File exceeds limit");
    const display = enhanceError(err)
      .context({ phase: "serialize" })
      .suggestion()
      .format();

    assert.ok(display.suggestion);
  });
});

// ── SUGGESTIONS database ───────────────────────────────────────────

describe("SUGGESTIONS database", () => {
  it("has entries for all standard error codes", () => {
    const { ErrorCodes } = require("../../src/tools/error-codes");
    const codes = Object.values(ErrorCodes);
    for (const code of codes) {
      assert.ok(SUGGESTIONS[code], `Missing suggestion for error code: ${code}`);
    }
  });

  it("all suggestion strings are non-empty", () => {
    for (const [code, text] of Object.entries(SUGGESTIONS)) {
      assert.ok(typeof text === "string" && text.length > 0, `Suggestion for ${code} is empty`);
    }
  });
});
