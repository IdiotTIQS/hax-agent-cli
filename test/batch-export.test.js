"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const test = require("node:test");

const { readAllInput, parseBatchInput } = require("../src/batch");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hax-test-"));
}

function cleanTemp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function createMockSession(id, entries, meta) {
  return {
    id,
    entries: () => entries || [],
    metadata: () => meta || {},
    updatedAt: new Date().toISOString(),
  };
}

function mockListSessions(sessions) {
  return () => sessions;
}

// Lazily load & patch the memory module to inject mock sessions.
function withMockedExport(moduleName, mockFn) {
  const modulePath = require.resolve(moduleName);
  const saved = require.cache[modulePath];
  // Force-load the real module so we have the original exports.
  const real = require(moduleName);
  // Save real exports separately (require.cache[modulePath] already holds the real module).
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: mockFn(real),
  };
  return () => {
    require.cache[modulePath] = saved;
  };
}

// ---------------------------------------------------------------------------
// batch: parseBatchInput additional edge cases
// ---------------------------------------------------------------------------

test("parseBatchInput: single line with only whitespace returns empty", () => {
  const result = parseBatchInput("    ");
  assert.deepEqual(result, []);
});

test("parseBatchInput: preserves internal whitespace in single turn", () => {
  const result = parseBatchInput("Line   with   extra   spaces");
  assert.equal(result.length, 1);
  assert.equal(result[0], "Line   with   extra   spaces");
});

test("parseBatchInput: ---multi--- preserves leading/trailing whitespace in each line", () => {
  // parseBatchInput only strips the overall content whitespace for single-turn.
  // For multi-turn, it only filters empty lines (does NOT trim each line).
  const input = "---multi---\n  spaced task 1  \n  spaced task 2  ";
  const result = parseBatchInput(input);
  assert.equal(result.length, 2);
  // Each line is kept as-is (not trimmed), only empty lines are filtered
  assert.equal(result[0].trim(), "spaced task 1");
  assert.equal(result[1].trim(), "spaced task 2");
});

// ---------------------------------------------------------------------------
// batch: readAllInput additional edge cases
// ---------------------------------------------------------------------------

test("readAllInput: reads large piped input", async () => {
  const { PassThrough } = require("node:stream");
  const stream = new PassThrough();
  stream.isTTY = false;

  const promise = readAllInput(stream);
  const largeText = "x".repeat(100000);
  stream.write(largeText);
  stream.end();

  const result = await promise;
  assert.equal(result.length, 100000);
});

// ---------------------------------------------------------------------------
// export: exportSessionToMarkdown
// ---------------------------------------------------------------------------

test("exportSessionToMarkdown: exports user and assistant messages", () => {
  const sessionId = "test-session-001";
  const entries = [
    { role: "user", content: "Hello, how do I refactor this?", timestamp: "2026-01-01T00:00:00Z" },
    { role: "assistant", content: "I can help you refactor. What file?", timestamp: "2026-01-01T00:00:01Z" },
  ];

  const restore = withMockedExport("../src/memory", (real) => ({
    ...real,
    listSessions: mockListSessions([createMockSession(sessionId, entries)]),
  }));

  // Force reload of export.js so it picks up the mocked memory module
  const exportPath = require.resolve("../src/export");
  delete require.cache[exportPath];
  const { exportSessionToMarkdown } = require("../src/export");

  const dir = tempDir();
  try {
    const outPath = path.join(dir, "output", "export.md");
    const result = exportSessionToMarkdown(sessionId, outPath);

    assert.equal(result.format, "markdown");
    assert.equal(result.entries, 2);

    const content = fs.readFileSync(outPath, "utf8");
    assert.ok(content.includes("# Hax Agent Session Transcript"));
    assert.ok(content.includes("Hello, how do I refactor this?"));
    assert.ok(content.includes("I can help you refactor"));
    assert.ok(content.includes("### You"));
    assert.ok(content.includes("### Assistant"));
  } finally {
    delete require.cache[exportPath];
    restore();
    cleanTemp(dir);
  }
});

test("exportSessionToMarkdown: throws for non-existent session", () => {
  const restore = withMockedExport("../src/memory", (real) => ({
    ...real,
    listSessions: mockListSessions([]),
  }));

  const exportPath = require.resolve("../src/export");
  delete require.cache[exportPath];
  const { exportSessionToMarkdown } = require("../src/export");

  const dir = tempDir();
  try {
    assert.throws(
      () => exportSessionToMarkdown("nonexistent", path.join(dir, "out.md")),
      { message: /Session not found/ }
    );
  } finally {
    delete require.cache[exportPath];
    restore();
    cleanTemp(dir);
  }
});

test("exportSessionToMarkdown: includes session metadata when present", () => {
  const sessionId = "test-session-002";
  const entries = [
    { role: "user", content: "What is the time?", timestamp: "2026-01-01T00:00:00Z" },
  ];
  const meta = { projectName: "MyProject", projectRoot: "/home/user/project" };

  const restore = withMockedExport("../src/memory", (real) => ({
    ...real,
    listSessions: mockListSessions([createMockSession(sessionId, entries, meta)]),
  }));

  const exportPath = require.resolve("../src/export");
  delete require.cache[exportPath];
  const { exportSessionToMarkdown } = require("../src/export");

  const dir = tempDir();
  try {
    const outPath = path.join(dir, "export-meta.md");
    exportSessionToMarkdown(sessionId, outPath);

    const content = fs.readFileSync(outPath, "utf8");
    assert.ok(content.includes("MyProject"));
    assert.ok(content.includes("/home/user/project"));
  } finally {
    delete require.cache[exportPath];
    restore();
    cleanTemp(dir);
  }
});

// ---------------------------------------------------------------------------
// export: exportSessionToJson
// ---------------------------------------------------------------------------

test("exportSessionToJson: exports entries with tool calls", () => {
  const sessionId = "test-session-json";
  const entries = [
    { role: "user", content: "Run tests", timestamp: "2026-01-01T00:00:00Z" },
    { role: "assistant", content: "Running tests now", timestamp: "2026-01-01T00:00:01Z" },
    { role: "tool", name: "shell.run", data: { stdout: "PASS", stderr: "" }, timestamp: "2026-01-01T00:00:02Z" },
  ];

  const restore = withMockedExport("../src/memory", (real) => ({
    ...real,
    listSessions: mockListSessions([createMockSession(sessionId, entries)]),
  }));

  const exportPath = require.resolve("../src/export");
  delete require.cache[exportPath];
  const { exportSessionToJson } = require("../src/export");

  const dir = tempDir();
  try {
    const outPath = path.join(dir, "output", "export.json");
    const result = exportSessionToJson(sessionId, outPath);

    assert.equal(result.format, "json");
    assert.equal(result.entries, 3);

    const raw = fs.readFileSync(outPath, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.sessionId, sessionId);
    assert.equal(parsed.totalEntries, 3);
    assert.equal(parsed.messages.length, 3);
    assert.equal(parsed.messages[2].role, "tool");
    assert.equal(parsed.messages[2].toolName, "shell.run");
  } finally {
    delete require.cache[exportPath];
    restore();
    cleanTemp(dir);
  }
});

test("exportSessionToJson: handles entry with isError flag", () => {
  const sessionId = "test-session-json-err";
  const entries = [
    { role: "tool", name: "file.read", data: null, isError: true, timestamp: "2026-01-01T00:00:00Z" },
  ];

  const restore = withMockedExport("../src/memory", (real) => ({
    ...real,
    listSessions: mockListSessions([createMockSession(sessionId, entries)]),
  }));

  const exportPath = require.resolve("../src/export");
  delete require.cache[exportPath];
  const { exportSessionToJson } = require("../src/export");

  const dir = tempDir();
  try {
    const outPath = path.join(dir, "output", "export-err.json");
    exportSessionToJson(sessionId, outPath);

    const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(parsed.messages[0].isError, true);
  } finally {
    delete require.cache[exportPath];
    restore();
    cleanTemp(dir);
  }
});

// ---------------------------------------------------------------------------
// export: exportSessionToText
// ---------------------------------------------------------------------------

test("exportSessionToText: exports in plain text format", () => {
  const sessionId = "test-session-text";
  const entries = [
    { role: "user", content: "Help me", timestamp: "2026-01-01T00:00:00Z" },
    { role: "assistant", content: "Sure, what do you need?", timestamp: "2026-01-01T00:00:01Z" },
  ];

  const restore = withMockedExport("../src/memory", (real) => ({
    ...real,
    listSessions: mockListSessions([createMockSession(sessionId, entries)]),
  }));

  const exportPath = require.resolve("../src/export");
  delete require.cache[exportPath];
  const { exportSessionToText } = require("../src/export");

  const dir = tempDir();
  try {
    const outPath = path.join(dir, "output", "export.txt");
    const result = exportSessionToText(sessionId, outPath);

    assert.equal(result.format, "text");
    assert.equal(result.entries, 2);

    const content = fs.readFileSync(outPath, "utf8");
    assert.ok(content.includes("=== Hax Agent Session Transcript ==="));
    assert.ok(content.includes("Session ID: test-session-text"));
    assert.ok(content.includes(">>> You"));
    assert.ok(content.includes("<<< Assistant"));
    assert.ok(content.includes("Help me"));
    assert.ok(content.includes("Sure, what do you need?"));
  } finally {
    delete require.cache[exportPath];
    restore();
    cleanTemp(dir);
  }
});

test("exportSessionToText: handles empty content gracefully", () => {
  const sessionId = "test-session-text-empty";
  const entries = [
    { role: "user", content: "", timestamp: "2026-01-01T00:00:00Z" },
    { role: "assistant", content: null, timestamp: "2026-01-01T00:00:01Z" },
  ];

  const restore = withMockedExport("../src/memory", (real) => ({
    ...real,
    listSessions: mockListSessions([createMockSession(sessionId, entries)]),
  }));

  const exportPath = require.resolve("../src/export");
  delete require.cache[exportPath];
  const { exportSessionToText } = require("../src/export");

  const dir = tempDir();
  try {
    const outPath = path.join(dir, "output", "export-empty.txt");
    exportSessionToText(sessionId, outPath);

    const content = fs.readFileSync(outPath, "utf8");
    assert.ok(content.includes(">>> You"));
    assert.ok(content.includes("<<< Assistant"));
  } finally {
    delete require.cache[exportPath];
    restore();
    cleanTemp(dir);
  }
});

// ---------------------------------------------------------------------------
// export: cross-format consistency
// ---------------------------------------------------------------------------

test("export: all three formats contain expected session ID", () => {
  const sessionId = "test-session-consistency";
  const entries = [
    { role: "user", content: "Test message", timestamp: "2026-01-01T00:00:00Z" },
  ];

  const restore = withMockedExport("../src/memory", (real) => ({
    ...real,
    listSessions: mockListSessions([createMockSession(sessionId, entries)]),
  }));

  const exportPath = require.resolve("../src/export");
  delete require.cache[exportPath];
  const { exportSessionToMarkdown, exportSessionToJson, exportSessionToText } = require("../src/export");

  const dir = tempDir();
  try {
    const mdPath = path.join(dir, "export.md");
    const jsonPath = path.join(dir, "export.json");
    const txtPath = path.join(dir, "export.txt");

    exportSessionToMarkdown(sessionId, mdPath);
    exportSessionToJson(sessionId, jsonPath);
    exportSessionToText(sessionId, txtPath);

    const mdContent = fs.readFileSync(mdPath, "utf8");
    const jsonContent = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const txtContent = fs.readFileSync(txtPath, "utf8");

    assert.ok(mdContent.includes(sessionId), "markdown missing session ID");
    assert.equal(jsonContent.sessionId, sessionId, "json wrong session ID");
    assert.ok(txtContent.includes(sessionId), "text missing session ID");
  } finally {
    delete require.cache[exportPath];
    restore();
    cleanTemp(dir);
  }
});
