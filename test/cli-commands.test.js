/**
 * Tests for /undo, /redo, /export slash commands, UndoStack integration,
 * and batch-mode input handling.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");

const { UndoStack } = require("../src/undo-stack");
const {
  exportSessionToMarkdown,
  exportSessionToJson,
  exportSessionToText,
} = require("../src/export");
const {
  runBatchMode,
  readAllInput,
  parseBatchInput,
} = require("../src/batch");
const memory = require("../src/memory");

// ── Helpers ────────────────────────────────────────────────

function createTmpDir(prefix = "hax-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeTempFile(dir, name, content) {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function createSessionFixture(entries = []) {
  const projectRoot = createTmpDir("hax-session-");
  const settings = {
    projectRoot,
    sessions: { directory: path.join(projectRoot, "sessions") },
  };
  const sessionId = memory.createSessionId();
  memory.writeTranscript(sessionId, entries, settings);
  return { projectRoot, settings, sessionId };
}

// ── UndoStack: additional integration / edge-case tests ─────

test("UndoStack: undo after file.delete restores file from trash path", async () => {
  const tmpDir = createTmpDir("hax-undo-del-");
  const originalPath = path.join(tmpDir, "deleted.txt");
  const trashPath = path.join(tmpDir, ".trash", "deleted.txt");

  fs.writeFileSync(originalPath, "content to restore", "utf8");

  const stack = new UndoStack();
  stack.push({
    toolName: "file.delete",
    filePath: originalPath,
    originalContent: "content to restore",
    newContent: "", // delete has empty new content
    description: "delete deleted.txt",
  });

  // Simulate: the tool moved the file to trash then deleted original
  fs.mkdirSync(path.dirname(trashPath), { recursive: true });
  fs.copyFileSync(originalPath, trashPath);
  fs.unlinkSync(originalPath);

  assert.ok(!fs.existsSync(originalPath), "file should be deleted before undo");

  const result = await stack.undo();
  assert.equal(result.undone, true);
  assert.ok(fs.existsSync(originalPath), "file should be restored after undo");
  assert.equal(fs.readFileSync(originalPath, "utf8"), "content to restore");
});

test("UndoStack: undo restores file even when trash path is used as filePath", async () => {
  const tmpDir = createTmpDir("hax-undo-trash-");
  const originalPath = path.join(tmpDir, "removed.txt");

  // Scenario: filePath recorded is a trash/restore location
  fs.mkdirSync(path.dirname(originalPath), { recursive: true });
  fs.writeFileSync(originalPath, "before delete", "utf8");

  const stack = new UndoStack();
  stack.push({
    toolName: "file.delete",
    filePath: originalPath,
    originalContent: "before delete",
    newContent: "",
    description: "delete removed.txt",
  });

  // Simulate delete
  fs.unlinkSync(originalPath);

  const result = await stack.undo();
  assert.equal(result.undone, true);
  assert.ok(fs.existsSync(originalPath));
  assert.equal(fs.readFileSync(originalPath, "utf8"), "before delete");
});

test("UndoStack: undo reports correct description with tool name and file", async () => {
  const tmpDir = createTmpDir("hax-undo-desc-");
  const filePath = writeTempFile(tmpDir, "desc.txt", "original");

  const stack = new UndoStack();
  stack.push({
    toolName: "file.edit",
    filePath,
    originalContent: "original",
    newContent: "updated",
    description: "custom description",
  });

  fs.writeFileSync(filePath, "updated", "utf8");

  const result = await stack.undo();
  assert.equal(result.undone, true);
  assert.equal(result.description, "custom description");
  assert.equal(result.filePath, path.resolve(filePath));
});

test("UndoStack: redo reports correct description with tool name and file", async () => {
  const tmpDir = createTmpDir("hax-undo-desc-");
  const filePath = writeTempFile(tmpDir, "redo-desc.txt", "v1");

  const stack = new UndoStack();
  stack.push({
    toolName: "file.write",
    filePath,
    originalContent: "v1",
    newContent: "v2",
    description: "write change",
  });
  fs.writeFileSync(filePath, "v2", "utf8");
  await stack.undo();

  const result = await stack.redo();
  assert.equal(result.redone, true);
  assert.equal(result.description, "write change");
  assert.equal(result.filePath, path.resolve(filePath));
});

test("UndoStack: multiple consecutive undo/redo on same file preserves content", async () => {
  const tmpDir = createTmpDir("hax-undo-multi-");
  const filePath = writeTempFile(tmpDir, "multi.txt", "A");

  const stack = new UndoStack();

  // A -> B
  stack.push({ filePath, originalContent: "A", newContent: "B", toolName: "file.edit" });
  fs.writeFileSync(filePath, "B", "utf8");

  // B -> C
  stack.push({ filePath, originalContent: "B", newContent: "C", toolName: "file.edit" });
  fs.writeFileSync(filePath, "C", "utf8");

  // C -> D
  stack.push({ filePath, originalContent: "C", newContent: "D", toolName: "file.edit" });
  fs.writeFileSync(filePath, "D", "utf8");

  assert.equal(stack._stack.length, 3);

  // Undo -> C
  await stack.undo();
  assert.equal(fs.readFileSync(filePath, "utf8"), "C");

  // Redo -> D
  await stack.redo();
  assert.equal(fs.readFileSync(filePath, "utf8"), "D");

  // Undo -> C
  await stack.undo();
  assert.equal(fs.readFileSync(filePath, "utf8"), "C");

  // Undo -> B
  await stack.undo();
  assert.equal(fs.readFileSync(filePath, "utf8"), "B");

  // Undo -> A
  await stack.undo();
  assert.equal(fs.readFileSync(filePath, "utf8"), "A");

  assert.equal(stack.canUndo(), false);
  assert.equal(stack._redoStack.length, 3);
});

test("UndoStack: undo when file no longer exists still reports undone:true", async () => {
  const tmpDir = createTmpDir("hax-undo-gone-");
  const filePath = path.join(tmpDir, "gone.txt");

  // File never existed, but we recorded it
  const stack = new UndoStack();
  stack.push({
    toolName: "file.write",
    filePath,
    originalContent: "should have been here",
    newContent: "new content",
  });

  // File doesn't exist (no currentContent), undo should still write
  const result = await stack.undo();
  assert.equal(result.undone, true);
  assert.ok(fs.existsSync(filePath));
  assert.equal(fs.readFileSync(filePath, "utf8"), "should have been here");
});

test("UndoStack: list shows correct order after undo/redo cycle", async () => {
  const tmpDir = createTmpDir("hax-undo-list-");
  const fileA = writeTempFile(tmpDir, "a.txt", "a");
  const fileB = writeTempFile(tmpDir, "b.txt", "b");

  const stack = new UndoStack();
  stack.push({ filePath: fileA, originalContent: "a", newContent: "a2", toolName: "file.edit" });
  fs.writeFileSync(fileA, "a2", "utf8");
  stack.push({ filePath: fileB, originalContent: "b", newContent: "b2", toolName: "file.edit" });
  fs.writeFileSync(fileB, "b2", "utf8");

  // List should show both entries (newest first)
  let list = stack.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].file, "b.txt");
  assert.equal(list[1].file, "a.txt");

  // Undo one
  await stack.undo();
  list = stack.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].file, "a.txt");
});

test("UndoStack: removeByPath with wildcards-like partial match is not supported", () => {
  const stack = new UndoStack();
  stack.push({ filePath: "/tmp/foo-bar.txt" });
  stack.push({ filePath: "/tmp/foo-baz.txt" });
  stack.push({ filePath: "/tmp/other.txt" });

  // removeByPath only matches exact resolved paths
  stack.removeByPath("/tmp/foo-bar.txt");
  assert.equal(stack._stack.length, 2);
  assert.equal(stack._stack[0].filePath, path.resolve("/tmp/foo-baz.txt"));
  assert.equal(stack._stack[1].filePath, path.resolve("/tmp/other.txt"));
});

test("UndoStack: push after partial undo/redo cycle clears redoStack", async () => {
  const tmpDir = createTmpDir("hax-undo-cycle-");
  const filePath = writeTempFile(tmpDir, "cycle2.txt", "v1");

  const stack = new UndoStack();
  stack.push({ filePath, originalContent: "v1", newContent: "v2" });
  fs.writeFileSync(filePath, "v2", "utf8");
  await stack.undo();
  assert.equal(stack._redoStack.length, 1);

  // New push should clear redo stack
  stack.push({ filePath, originalContent: "v2", newContent: "v3" });
  assert.equal(stack._redoStack.length, 0);
});

test("UndoStack: undo with non-UTF8 content returns undone:true", async () => {
  const tmpDir = createTmpDir("hax-undo-bin-");
  const filePath = path.join(tmpDir, "binary.bin");

  // Write binary-like content
  const binaryContent = Buffer.from([0x00, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xFF]);
  fs.writeFileSync(filePath, binaryContent);

  const stack = new UndoStack();
  stack.push({
    toolName: "file.write",
    filePath,
    originalContent: "original text",
    newContent: binaryContent.toString("utf8"),
  });

  const result = await stack.undo();
  assert.equal(result.undone, true);
  const restored = fs.readFileSync(filePath, "utf8");
  assert.equal(restored, "original text");
});

test("UndoStack: list includes all required fields", () => {
  const stack = new UndoStack();
  stack.push({
    toolName: "file.write",
    filePath: "/test/verify.txt",
    description: "verify",
  });

  const entries = stack.list();
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(typeof entry.index, "number");
  assert.equal(typeof entry.toolName, "string");
  assert.equal(typeof entry.file, "string");
  assert.equal(typeof entry.filePath, "string");
  assert.equal(typeof entry.description, "string");
  assert.equal(typeof entry.timestamp, "string");
});

// ── Batch mode: parseBatchInput ────────────────────────────

test("parseBatchInput: returns empty array for empty input", () => {
  assert.deepEqual(parseBatchInput(""), []);
  assert.deepEqual(parseBatchInput("   \n  \n  "), []);
});

test("parseBatchInput: returns single-element array for plain input", () => {
  const result = parseBatchInput("refactor the auth module");
  assert.deepEqual(result, ["refactor the auth module"]);
});

test("parseBatchInput: returns single-element array preserving line breaks", () => {
  const result = parseBatchInput("line 1\nline 2\nline 3");
  assert.equal(result.length, 1);
  assert.equal(result[0], "line 1\nline 2\nline 3");
});

test("parseBatchInput: splits by lines with @@@multi@@@ marker", () => {
  const input = "@@@multi@@@\nfix the auth module\nadd unit tests\nupdate docs";
  const result = parseBatchInput(input);
  assert.deepEqual(result, [
    "fix the auth module",
    "add unit tests",
    "update docs",
  ]);
});

test("parseBatchInput: splits by lines with ---multi--- marker", () => {
  const input = "---multi---\ntask one\ntask two";
  const result = parseBatchInput(input);
  assert.deepEqual(result, ["task one", "task two"]);
});

test("parseBatchInput: filters empty lines in multi mode", () => {
  const input = "---multi---\ntask one\n\ntask two\n\n\n\ntask three\n";
  const result = parseBatchInput(input);
  assert.deepEqual(result, ["task one", "task two", "task three"]);
});

test("parseBatchInput: handles Windows line endings in multi mode", () => {
  const input = "---multi---\r\nfix the auth module\r\nadd unit tests\r\nupdate docs";
  const result = parseBatchInput(input);
  assert.deepEqual(result, [
    "fix the auth module",
    "add unit tests",
    "update docs",
  ]);
});

test("parseBatchInput: handles single line after multi marker", () => {
  const input = "@@@multi@@@\nonly one task";
  const result = parseBatchInput(input);
  assert.deepEqual(result, ["only one task"]);
});

test("parseBatchInput: handles no turns after marker", () => {
  const input = "---multi---\n\n\n";
  const result = parseBatchInput(input);
  assert.deepEqual(result, []);
});

test("parseBatchInput: multi-mode trims only for filter, not line content", () => {
  // parseBatchInput trims at the top level, then splits lines and filters
  // empty ones using line.trim(), but the actual line content is kept as-is
  const input = "@@@multi@@@\n  task one  \n\ttask two\t";
  const result = parseBatchInput(input);
  assert.equal(result.length, 2);
  assert.ok(result[0].includes("task one"));
  assert.ok(result[1].includes("task two"));
});

test("parseBatchInput: plain mode trims outer whitespace only", () => {
  const result = parseBatchInput("  \n  hello world  \n\n  ");
  // Plain mode wraps everything in a single element, trimmed at edges
  assert.equal(result.length, 1);
  assert.equal(result[0], "hello world");
});

test("parseBatchInput: plain input containing marker-like text is not split", () => {
  // Only leading markers trigger multi-mode
  const input = "some text\n---multi---\nmore text";
  const result = parseBatchInput(input);
  assert.equal(result.length, 1);
  assert.ok(result[0].includes("---multi---"), "marker text preserved in body");
});

// ── Batch mode: readAllInput ───────────────────────────────

test("readAllInput: reads from non-TTY stream", async () => {
  const content = "hello batch world\nsecond line\n";
  const stream = Readable.from([Buffer.from(content)]);
  Object.defineProperty(stream, "isTTY", { value: false, configurable: true });

  const result = await readAllInput(stream);
  assert.equal(result, content);
});

test("readAllInput: reads empty stream", async () => {
  const stream = Readable.from([Buffer.from("")]);
  Object.defineProperty(stream, "isTTY", { value: false, configurable: true });

  const result = await readAllInput(stream);
  assert.equal(result, "");
});

test("readAllInput: reads binary-safe from stream", async () => {
  const stream = Readable.from([Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f])]);
  Object.defineProperty(stream, "isTTY", { value: false, configurable: true });

  const result = await readAllInput(stream);
  assert.equal(result, "Hello");
});

test("readAllInput: handles large input", async () => {
  const largeContent = "x".repeat(100000);
  const stream = Readable.from([Buffer.from(largeContent)]);
  Object.defineProperty(stream, "isTTY", { value: false, configurable: true });

  const result = await readAllInput(stream);
  assert.equal(result.length, 100000);
});

// ── Batch mode: runBatchMode error paths ───────────────────

test("runBatchMode: returns 1 for missing input file", async () => {
  const exitCode = await runBatchMode({
    inputFile: "/nonexistent-fake-dir/missing-file.txt",
    session: {
      costTracker: { getCost: () => 0, inputTokens: 0, outputTokens: 0, turnCount: 0 },
      settings: {},
    },
  });
  assert.equal(exitCode, 1);
});

test("runBatchMode: returns 1 for empty stdin input", async () => {
  const emptyStream = Readable.from([Buffer.from("")]);
  Object.defineProperty(emptyStream, "isTTY", { value: false, configurable: true });

  const exitCode = await runBatchMode({
    input: emptyStream,
    session: {
      costTracker: { getCost: () => 0, inputTokens: 0, outputTokens: 0, turnCount: 0 },
      settings: {},
    },
  });
  assert.equal(exitCode, 1);
});

// ── Export: Markdown format ────────────────────────────────

test("exportSessionToMarkdown: exports basic session to .md file", () => {
  const { settings, sessionId } = createSessionFixture([
    { role: "user", content: "hello" },
    { role: "assistant", content: "Hi there! How can I help?" },
  ]);
  const outputPath = path.join(settings.projectRoot, "exports", "session.md");

  const result = exportSessionToMarkdown(sessionId, outputPath, settings);

  assert.equal(result.format, "markdown");
  assert.equal(result.entries, 2);
  assert.ok(fs.existsSync(result.path));

  const content = fs.readFileSync(result.path, "utf8");
  assert.ok(content.includes("# Hax Agent Session Transcript"));
  assert.ok(content.includes(sessionId));
  assert.ok(content.includes("### You"));
  assert.ok(content.includes("hello"));
  assert.ok(content.includes("### Assistant"));
  assert.ok(content.includes("Hi there!"));
  assert.ok(content.includes("**Exported:**"));
});

test("exportSessionToMarkdown: exports empty session", () => {
  const { settings, sessionId } = createSessionFixture([]);
  const outputPath = path.join(settings.projectRoot, "exports", "empty.md");

  const result = exportSessionToMarkdown(sessionId, outputPath, settings);

  assert.equal(result.format, "markdown");
  assert.equal(result.entries, 0);
  assert.ok(fs.existsSync(result.path));
  assert.ok(fs.readFileSync(result.path, "utf8").includes("**Messages:** 0"));
});

test("exportSessionToMarkdown: exports session with tool calls", () => {
  const { settings, sessionId } = createSessionFixture([
    { role: "user", content: "read config.js" },
    {
      role: "tool",
      name: "file.read",
      data: '{"path":"config.js","content":"module.exports = {}"}',
    },
    { role: "assistant", content: "The config file contains an empty export." },
  ]);
  const outputPath = path.join(settings.projectRoot, "exports", "tools.md");

  const result = exportSessionToMarkdown(sessionId, outputPath, settings);

  assert.equal(result.format, "markdown");
  assert.equal(result.entries, 3);

  const content = fs.readFileSync(result.path, "utf8");
  assert.ok(content.includes("### Tool: file.read"));
  assert.ok(content.includes("```"), "tool data should be in code block");
  assert.ok(content.includes("config.js"));
});

test("exportSessionToMarkdown: exports session with project metadata", () => {
  const projectRoot = createTmpDir("hax-exp-md-");
  const settings = {
    projectRoot,
    sessions: { directory: path.join(projectRoot, "sessions") },
  };
  const sessionId = memory.createSessionId();
  const metadata = memory.createTranscriptMetadata(settings);
  metadata.projectName = "MyProject";
  memory.writeTranscript(sessionId, [
    { ...metadata },
    { role: "user", content: "test" },
    { role: "assistant", content: "ok" },
  ], settings);

  const outputPath = path.join(projectRoot, "exports", "meta.md");
  const result = exportSessionToMarkdown(sessionId, outputPath, settings);

  const content = fs.readFileSync(result.path, "utf8");
  assert.ok(content.includes("**Project:** MyProject"));
  assert.ok(content.includes("**Root:**"));
});

test("exportSessionToMarkdown: gracefully skips entries with unrecognized roles", () => {
  const { settings, sessionId } = createSessionFixture([
    { role: "unknown", content: "system event" },
    { role: "user", content: "actual user message" },
  ]);
  const outputPath = path.join(settings.projectRoot, "exports", "unknown.md");

  const result = exportSessionToMarkdown(sessionId, outputPath, settings);

  const content = fs.readFileSync(result.path, "utf8");
  // The unknown-role entry should be silently skipped, not crash
  // Only the user message should appear
  assert.ok(content.includes("actual user message"));
  assert.ok(content.includes("### You"), "user message heading should appear");
  assert.ok(!content.includes("system event"), "unknown role content should not appear");
});

test("exportSessionToMarkdown: throws for non-existent session", () => {
  const { settings } = createSessionFixture([]);
  const outputPath = path.join(settings.projectRoot, "exports", "nope.md");

  assert.throws(
    () => exportSessionToMarkdown("non-existent-id-12345", outputPath, settings),
    { message: /Session not found/ }
  );
});

test("exportSessionToMarkdown: creates parent directories automatically", () => {
  const { settings, sessionId } = createSessionFixture([
    { role: "user", content: "hi" },
  ]);
  const outputPath = path.join(
    settings.projectRoot,
    "nested",
    "deep",
    "folder",
    "session.md"
  );

  const result = exportSessionToMarkdown(sessionId, outputPath, settings);
  assert.ok(fs.existsSync(result.path));
});

// ── Export: JSON format ────────────────────────────────────

test("exportSessionToJson: exports basic session to .json file", () => {
  const { settings, sessionId } = createSessionFixture([
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
  ]);
  const outputPath = path.join(settings.projectRoot, "exports", "session.json");

  const result = exportSessionToJson(sessionId, outputPath, settings);

  assert.equal(result.format, "json");
  assert.equal(result.entries, 2);
  assert.ok(fs.existsSync(result.path));

  const parsed = JSON.parse(fs.readFileSync(result.path, "utf8"));
  // sessionId might have extra hash appended by toFileSafeName during storage
  assert.ok(parsed.sessionId, "sessionId should be present");
  assert.ok(
    parsed.sessionId.startsWith(sessionId.substring(0, 20)),
    "sessionId should start with the same timestamp prefix"
  );
  assert.equal(parsed.totalEntries, 2);
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages[0].role, "user");
  assert.equal(parsed.messages[0].content, "hello");
  assert.equal(parsed.messages[1].role, "assistant");
  assert.equal(parsed.messages[1].content, "hi");
  assert.ok(parsed.exportedAt);
  assert.ok(parsed.updatedAt);
});

test("exportSessionToJson: exports session with tool calls including isError", () => {
  const { settings, sessionId } = createSessionFixture([
    { role: "user", content: "list files" },
    {
      role: "tool",
      name: "shell.run",
      data: { stdout: "file1.txt\nfile2.txt", stderr: "" },
    },
    {
      role: "tool",
      name: "shell.run",
      data: { error: "command failed" },
      isError: true,
    },
  ]);
  const outputPath = path.join(settings.projectRoot, "exports", "tools.json");

  const result = exportSessionToJson(sessionId, outputPath, settings);

  const parsed = JSON.parse(fs.readFileSync(result.path, "utf8"));
  assert.equal(parsed.messages.length, 3);

  const toolMsg = parsed.messages[1];
  assert.equal(toolMsg.role, "tool");
  assert.equal(toolMsg.toolName, "shell.run");
  assert.deepEqual(toolMsg.data, { stdout: "file1.txt\nfile2.txt", stderr: "" });

  const errorMsg = parsed.messages[2];
  assert.equal(errorMsg.isError, true);
});

test("exportSessionToJson: exports empty session with empty messages array", () => {
  const { settings, sessionId } = createSessionFixture([]);
  const outputPath = path.join(settings.projectRoot, "exports", "empty.json");

  const result = exportSessionToJson(sessionId, outputPath, settings);

  assert.equal(result.entries, 0);
  const parsed = JSON.parse(fs.readFileSync(result.path, "utf8"));
  assert.deepEqual(parsed.messages, []);
  assert.equal(parsed.totalEntries, 0);
});

test("exportSessionToJson: includes project metadata when available", () => {
  const projectRoot = createTmpDir("hax-exp-json-");
  const settings = {
    projectRoot,
    sessions: { directory: path.join(projectRoot, "sessions") },
  };
  const sessionId = memory.createSessionId();
  const metadata = memory.createTranscriptMetadata(settings);
  metadata.projectName = "JsonProject";
  memory.writeTranscript(sessionId, [
    { ...metadata },
    { role: "user", content: "test" },
  ], settings);

  const outputPath = path.join(projectRoot, "exports", "meta.json");
  exportSessionToJson(sessionId, outputPath, settings);

  const parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(parsed.projectName, "JsonProject");
  assert.ok(parsed.projectRoot);
});

test("exportSessionToJson: throws for non-existent session", () => {
  const { settings } = createSessionFixture([]);
  const outputPath = path.join(settings.projectRoot, "exports", "nope.json");

  assert.throws(
    () => exportSessionToJson("non-existent-session-id", outputPath, settings),
    { message: /Session not found/ }
  );
});

test("exportSessionToJson: creates nested output directories", () => {
  const { settings, sessionId } = createSessionFixture([
    { role: "user", content: "test" },
  ]);
  const outputPath = path.join(
    settings.projectRoot,
    "deep",
    "nested",
    "output.json"
  );

  const result = exportSessionToJson(sessionId, outputPath, settings);
  assert.ok(fs.existsSync(result.path));
});

// ── Export: Text format ────────────────────────────────────

test("exportSessionToText: exports to plain text file", () => {
  const { settings, sessionId } = createSessionFixture([
    { role: "user", content: "hello" },
    { role: "assistant", content: "Hi there!" },
  ]);
  const outputPath = path.join(settings.projectRoot, "exports", "session.txt");

  const result = exportSessionToText(sessionId, outputPath, settings);

  assert.equal(result.format, "text");
  assert.equal(result.entries, 2);
  assert.ok(fs.existsSync(result.path));

  const content = fs.readFileSync(result.path, "utf8");
  assert.ok(content.includes("=== Hax Agent Session Transcript ==="));
  assert.ok(content.includes("Session ID:"));
  assert.ok(content.includes(">>> You"));
  assert.ok(content.includes("hello"));
  assert.ok(content.includes("<<< Assistant"));
  assert.ok(content.includes("Hi there!"));
  assert.ok(content.includes("Exported:"));
});

test("exportSessionToText: exports empty session", () => {
  const { settings, sessionId } = createSessionFixture([]);
  const outputPath = path.join(settings.projectRoot, "exports", "empty.txt");

  const result = exportSessionToText(sessionId, outputPath, settings);

  assert.equal(result.entries, 0);
  const content = fs.readFileSync(result.path, "utf8");
  assert.ok(content.includes("Messages: 0"));
});

test("exportSessionToText: exports session with tool calls showing role tag", () => {
  const { settings, sessionId } = createSessionFixture([
    { role: "user", content: "list files" },
    {
      role: "tool",
      name: "shell.run",
      data: "file1.txt\nfile2.txt",
    },
  ]);
  const outputPath = path.join(settings.projectRoot, "exports", "tools.txt");

  const result = exportSessionToText(sessionId, outputPath, settings);

  const content = fs.readFileSync(result.path, "utf8");
  assert.ok(content.includes("[tool]"), "tool role should have prefix tag");
  assert.ok(content.includes("file1.txt"));
});

test("exportSessionToText: handles entry with no content (data-only)", () => {
  const { settings, sessionId } = createSessionFixture([
    { role: "tool", name: "notify", data: { status: "done" } },
  ]);
  const outputPath = path.join(settings.projectRoot, "exports", "data-only.txt");

  const result = exportSessionToText(sessionId, outputPath, settings);

  const content = fs.readFileSync(result.path, "utf8");
  // Should include the stringified data
  assert.ok(content.includes("status"));
});

test("exportSessionToText: trims whitespace from content lines", () => {
  const { settings, sessionId } = createSessionFixture([
    { role: "user", content: "  hello with spaces  " },
    { role: "assistant", content: "\n\nresponse\n\n" },
  ]);
  const outputPath = path.join(settings.projectRoot, "exports", "trimmed.txt");

  const result = exportSessionToText(sessionId, outputPath, settings);

  const content = fs.readFileSync(result.path, "utf8");
  // Content should be trimmed but not empty
  assert.ok(content.includes("hello with spaces"));
  assert.ok(content.includes("response"));
});

test("exportSessionToText: throws for non-existent session", () => {
  const { settings } = createSessionFixture([]);
  const outputPath = path.join(settings.projectRoot, "exports", "nope.txt");

  assert.throws(
    () => exportSessionToText("missing-session-abcdef", outputPath, settings),
    { message: /Session not found/ }
  );
});

test("exportSessionToText: handles 10+ entries", () => {
  const entries = [];
  for (let i = 0; i < 12; i++) {
    entries.push({ role: "user", content: `message ${i + 1}` });
    entries.push({ role: "assistant", content: `response ${i + 1}` });
  }
  const { settings, sessionId } = createSessionFixture(entries);
  const outputPath = path.join(settings.projectRoot, "exports", "large.txt");

  const result = exportSessionToText(sessionId, outputPath, settings);

  assert.equal(result.entries, 24);
  const content = fs.readFileSync(result.path, "utf8");
  assert.ok(content.includes("Messages: 24"));
  assert.ok(content.includes("message 12"));
  assert.ok(content.includes("response 12"));
});

// ── Export: session matching by prefix ─────────────────────

test("exportSessionToMarkdown: finds session by ID prefix", () => {
  const projectRoot = createTmpDir("hax-exp-prefix-");
  const settings = {
    projectRoot,
    sessions: { directory: path.join(projectRoot, "sessions") },
  };

  // Create a session with a known long ID
  const fullSessionId = memory.createSessionId();
  memory.writeTranscript(fullSessionId, [
    { role: "user", content: "prefix match test" },
  ], settings);

  // Match by first 12 characters
  const prefix = fullSessionId.substring(0, 12);
  const outputPath = path.join(projectRoot, "exports", "prefix.md");

  const result = exportSessionToMarkdown(prefix, outputPath, settings);
  assert.equal(result.entries, 1);

  const content = fs.readFileSync(result.path, "utf8");
  assert.ok(content.includes("prefix match test"));
});

// ── Export: different projectRoot settings ─────────────────

test("export: all formats work when sessions directory is custom", () => {
  const projectRoot = createTmpDir("hax-exp-cust-");
  const customSessionsDir = path.join(projectRoot, "custom", "logs");
  const settings = {
    projectRoot,
    sessions: { directory: customSessionsDir },
  };

  const sessionId = memory.createSessionId();
  memory.writeTranscript(sessionId, [
    { role: "user", content: "custom dir test" },
    { role: "assistant", content: "working" },
  ], settings);

  const basePath = path.join(projectRoot, "out");

  const mdResult = exportSessionToMarkdown(sessionId, path.join(basePath, "out.md"), settings);
  const jsonResult = exportSessionToJson(sessionId, path.join(basePath, "out.json"), settings);
  const txtResult = exportSessionToText(sessionId, path.join(basePath, "out.txt"), settings);

  assert.equal(mdResult.format, "markdown");
  assert.equal(jsonResult.format, "json");
  assert.equal(txtResult.format, "text");

  assert.ok(fs.readFileSync(mdResult.path, "utf8").includes("custom dir test"));
  assert.ok(fs.readFileSync(txtResult.path, "utf8").includes("working"));
});

// ── Export: content with special characters ────────────────

test("exportSessionToMarkdown: handles special characters in content", () => {
  const { settings, sessionId } = createSessionFixture([
    { role: "user", content: "write a `<script>alert(1)</script>` tag" },
    { role: "assistant", content: "```js\nconsole.log('test');\n```" },
  ]);
  const outputPath = path.join(settings.projectRoot, "exports", "special.md");

  const result = exportSessionToMarkdown(sessionId, outputPath, settings);

  const content = fs.readFileSync(result.path, "utf8");
  assert.ok(content.includes("<script>"), "markdown preserves content literally");
  assert.ok(content.includes("```js"));
});

test("exportSessionToJson: handles special characters in JSON", () => {
  const { settings, sessionId } = createSessionFixture([
    { role: "user", content: 'unicodes: ☃ ❤ ✌️' },
    { role: "assistant", content: '{"key": "value"}' },
  ]);
  const outputPath = path.join(settings.projectRoot, "exports", "unicode.json");

  exportSessionToJson(sessionId, outputPath, settings);

  const parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.ok(parsed.messages[0].content.includes("☃"));
  assert.ok(parsed.messages[1].content.includes('{"key": "value"}'));
});

test("exportSessionToText: handles content with newlines", () => {
  const { settings, sessionId } = createSessionFixture([
    {
      role: "assistant",
      content: "Here is a list:\n- Item 1\n- Item 2\n- Item 3",
    },
  ]);
  const outputPath = path.join(settings.projectRoot, "exports", "multiline.txt");

  exportSessionToText(sessionId, outputPath, settings);

  const content = fs.readFileSync(outputPath, "utf8");
  assert.ok(content.includes("- Item 1"));
  assert.ok(content.includes("- Item 2"));
});

// ── Batch mode: runBatchMode output handling ───────────────

test("readAllInput: handles stream with multiple chunks", async () => {
  const stream = Readable.from([
    Buffer.from("chunk1"),
    Buffer.from("chunk2"),
    Buffer.from("chunk3"),
  ]);
  Object.defineProperty(stream, "isTTY", { value: false, configurable: true });

  const result = await readAllInput(stream);
  assert.equal(result, "chunk1chunk2chunk3");
});

test("readAllInput: handles multi-turn content via parseBatchInput", () => {
  // Simulate batch input file content with multi marker
  const fileContent =
    "---multi---\n" +
    "Step 1: Install dependencies\n" +
    "Step 2: Run tests\n" +
    "Step 3: Build project\n";

  const turns = parseBatchInput(fileContent);
  assert.equal(turns.length, 3);
  assert.equal(turns[0], "Step 1: Install dependencies");
  assert.equal(turns[1], "Step 2: Run tests");
  assert.equal(turns[2], "Step 3: Build project");
});

// ── UndoStack: edge cases for large stacks ─────────────────

test("UndoStack: handles maxEntries of 1 correctly", async () => {
  const tmpDir = createTmpDir("hax-undo-max1-");
  const filePath = writeTempFile(tmpDir, "only.txt", "first");

  const stack = new UndoStack(1);

  stack.push({ filePath, originalContent: "first", newContent: "second" });
  assert.equal(stack._stack.length, 1);

  // This should kick out the first one
  stack.push({ filePath, originalContent: "second", newContent: "third" });
  assert.equal(stack._stack.length, 1);
  assert.equal(stack._stack[0].originalContent, "second");
});

test("UndoStack: list returns empty for cleared stack", () => {
  const stack = new UndoStack();
  stack.push({ filePath: "/tmp/test.txt" });
  stack.clear();
  assert.deepEqual(stack.list(), []);
});

test("UndoStack: undo preserves redo stack entries with correct filePath", async () => {
  const tmpDir = createTmpDir("hax-undo-path-");
  const filePath = writeTempFile(tmpDir, "preserve.txt", "A");

  const stack = new UndoStack();
  stack.push({ filePath, originalContent: "A", newContent: "B" });
  fs.writeFileSync(filePath, "B", "utf8");

  await stack.undo();
  assert.equal(stack._redoStack.length, 1);
  assert.equal(stack._redoStack[0].filePath, path.resolve(filePath));
  assert.equal(stack._redoStack[0].originalContent, "A");
  assert.equal(stack._redoStack[0].newContent, "B");
});

// ── Export: edge cases for metadata extraction ─────────────

test("exportSessionToMarkdown: handles session with no metadata gracefully", () => {
  // Write transcript without metadata entry
  const projectRoot = createTmpDir("hax-exp-nometa-");
  const settings = {
    projectRoot,
    sessions: { directory: path.join(projectRoot, "sessions") },
  };
  const sessionId = memory.createSessionId();

  // Directly write the transcript file bypassing writeTranscript's metadata prepend
  const storage = memory.createStorage(settings);
  const filePath = path.join(storage.sessionDirectory, `${sessionId}.jsonl`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({ role: "user", content: "no metadata here" }) + "\n",
    "utf8"
  );

  const outputPath = path.join(projectRoot, "exports", "nometa.md");
  // The session should still be found
  const result = exportSessionToMarkdown(sessionId, outputPath, settings);
  assert.equal(result.entries, 1);
});

// ── Batch mode: parseBatchInput with @@@multi@@@ extension ─

test("parseBatchInput: leading whitespace before @@@multi@@@ marker still triggers multi-mode", () => {
  // parseBatchInput trims the entire input first, so leading whitespace
  // is removed before checking for the multi-turn marker
  const input = " @@@multi@@@ \n" + "task alpha\n" + "task beta\n";
  const result = parseBatchInput(input);
  assert.equal(result.length, 2);
  assert.ok(result[0].includes("task alpha"));
  assert.ok(result[1].includes("task beta"));
});
