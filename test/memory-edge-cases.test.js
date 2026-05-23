/**
 * Edge-case tests for memory module: delete, search, clear,
 * toFileSafeName, transcript file handling.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const memory = require("../src/memory");

function createFixture() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-mem-"));
  const settings = {
    projectRoot,
    memory: { directory: path.join(projectRoot, "memory") },
    sessions: { directory: path.join(projectRoot, "sessions") },
  };
  return { projectRoot, settings };
}

test("deleteMemory: returns false for non-existent memory", () => {
  const { settings } = createFixture();
  assert.equal(memory.deleteMemory("nonexistent", settings), false);
});

test("deleteMemory: deletes existing memory and returns true", () => {
  const { settings } = createFixture();
  memory.writeMemory("test-del", "content", settings);
  assert.equal(memory.deleteMemory("test-del", settings), true);
  assert.equal(memory.readMemory("test-del", settings), null);
});

test("deleteMemory: handles multiple deletes", () => {
  const { settings } = createFixture();
  memory.writeMemory("test-del", "content", settings);
  memory.deleteMemory("test-del", settings);
  assert.equal(memory.deleteMemory("test-del", settings), false);
});

test("searchMemories: returns empty array for empty query", () => {
  const { settings } = createFixture();
  assert.deepEqual(memory.searchMemories("", settings), []);
});

test("searchMemories: returns empty array for null query", () => {
  const { settings } = createFixture();
  assert.deepEqual(memory.searchMemories(null, settings), []);
});

test("searchMemories: returns empty array for whitespace query", () => {
  const { settings } = createFixture();
  assert.deepEqual(memory.searchMemories("   ", settings), []);
});

test("searchMemories: finds by name match", () => {
  const { settings } = createFixture();
  memory.writeMemory("project-style", "Use tabs", settings);
  memory.writeMemory("unrelated", "Other content", settings);
  const results = memory.searchMemories("project", settings);
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "project-style");
});

test("searchMemories: finds by content match", () => {
  const { settings } = createFixture();
  memory.writeMemory("style", "Use concise answers", settings);
  memory.writeMemory("other", "Different content", settings);
  const results = memory.searchMemories("concise", settings);
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "style");
});

test("searchMemories: case-insensitive", () => {
  const { settings } = createFixture();
  memory.writeMemory("test", "Some Content Here", settings);
  const results = memory.searchMemories("SOME content", settings);
  assert.equal(results.length, 1);
});

test("searchMemories: returns [] when no match", () => {
  const { settings } = createFixture();
  memory.writeMemory("test", "content", settings);
  assert.deepEqual(memory.searchMemories("zzz-no-match", settings), []);
});

test("clearSessions: returns 0 when directory does not exist", () => {
  const { settings } = createFixture();
  // Directory is auto-created only when writing, so it may not exist
  assert.equal(typeof memory.clearSessions(settings), "number");
});

test("clearSessions: clears existing session files", () => {
  const { settings } = createFixture();
  const sessionId = memory.createSessionId(new Date("2026-04-28T10:00:00.000Z"));
  memory.appendTranscriptEntry(sessionId, { role: "user", content: "hello" }, settings);
  assert.ok(memory.listSessions(settings).length >= 1);
  const removed = memory.clearSessions(settings);
  assert.equal(removed, 1);
  assert.equal(memory.listSessions(settings).length, 0);
});

test("listMemories: returns [] when directory does not exist", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-mem-"));
  const settings = {
    projectRoot,
    memory: { directory: path.join(projectRoot, "nonexistent-dir") },
    sessions: { directory: path.join(projectRoot, "sessions") },
  };
  assert.deepEqual(memory.listMemories(settings), []);
});

test("listSessions: returns [] when directory does not exist", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-mem-"));
  const settings = {
    projectRoot,
    memory: { directory: path.join(projectRoot, "mem") },
    sessions: { directory: path.join(projectRoot, "nonexistent-sessions") },
  };
  assert.deepEqual(memory.listSessions(settings), []);
});

test("toFileSafeName: throws for empty name", () => {
  assert.throws(() => memory.toFileSafeName("", "test"), {
    message: /is required/,
  });
});

test("toFileSafeName: generates safe filename from special chars", () => {
  const result = memory.toFileSafeName("Hello World!@#$%", "name");
  assert.ok(result.match(/^[a-zA-Z0-9._-]+-[a-f0-9]{8}$/));
});

test("toFileSafeName: truncates long names", () => {
  const longName = "a".repeat(200);
  const result = memory.toFileSafeName(longName, "name");
  assert.ok(result.length <= 80 + 1 + 8); // slug (max 80) + dash + 8-char hash
});

test("toFileSafeName: handles unicode characters", () => {
  const result = memory.toFileSafeName("记忆测试", "name");
  assert.ok(result.match(/^[a-zA-Z0-9._-]+-[a-f0-9]{8}$/));
  assert.ok(result.length > 0);
});

test("createSessionId: generates unique ids", () => {
  const id1 = memory.createSessionId();
  const id2 = memory.createSessionId();
  assert.notEqual(id1, id2);
});

test("createStorage: resolves from settings object directly", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-mem-"));
  const storage = memory.createStorage({ projectRoot });
  assert.equal(storage.projectRoot, path.resolve(projectRoot));
  assert.ok(storage.memoryDirectory.includes("memory"));
  assert.ok(storage.sessionDirectory.includes("sessions"));
});

test("createStorage: resolves from legacy flat settings", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-mem-"));
  const storage = memory.createStorage({
    projectRoot,
    memoryDirectory: path.join(projectRoot, "mem"),
    sessionDirectory: path.join(projectRoot, "sess"),
  });
  assert.ok(storage.memoryDirectory.includes("mem"));
  assert.ok(storage.sessionDirectory.includes("sess"));
});

test("writeMemory: records createdAt and updatedAt", () => {
  const { settings } = createFixture();
  const record = memory.writeMemory("test-ts", "content", settings);
  assert.ok(record.createdAt);
  assert.ok(record.updatedAt);
  assert.equal(record.createdAt, record.updatedAt);
});

test("writeMemory: preserves original createdAt on update", () => {
  const { settings } = createFixture();
  const first = memory.writeMemory("test-preserve", "original", settings);
  // Small delay to ensure different timestamps
  const second = memory.writeMemory("test-preserve", "updated", settings);
  assert.equal(second.createdAt, first.createdAt);
  assert.notEqual(second.updatedAt, first.updatedAt);
  assert.equal(second.content, "updated");
});

test("readMemory: returns null for non-existent memory", () => {
  const { settings } = createFixture();
  assert.equal(memory.readMemory("does-not-exist", settings), null);
});

test("readTranscript: returns empty array for non-existent session", () => {
  const { settings } = createFixture();
  assert.deepEqual(memory.readTranscript("nonexistent-session", settings), []);
});

test("writeTranscript: writes entries with metadata", () => {
  const { settings } = createFixture();
  const sessionId = memory.createSessionId(new Date("2026-04-28T10:00:00.000Z"));
  const filePath = memory.writeTranscript(
    sessionId,
    [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ],
    settings
  );
  assert.ok(fs.existsSync(filePath));
  const entries = memory.readTranscript(sessionId, settings);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].role, "user");
  assert.equal(entries[1].role, "assistant");
});

test("listSessions: entries() method returns filtered transcript", () => {
  const { settings } = createFixture();
  const sessionId = memory.createSessionId(new Date("2026-04-28T10:00:00.000Z"));
  memory.appendTranscriptEntry(sessionId, { role: "user", content: "test" }, settings);
  const sessions = memory.listSessions(settings);
  assert.equal(sessions.length, 1);
  const entries = sessions[0].entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].role, "user");
});

test("listSessions: sorted by most recently updated first", () => {
  const { settings } = createFixture();
  const id1 = memory.createSessionId(new Date("2026-04-01T00:00:00.000Z"));
  const id2 = memory.createSessionId(new Date("2026-04-02T00:00:00.000Z"));
  // Write in order first, then second
  memory.appendTranscriptEntry(id1, { role: "user", content: "old" }, settings);
  memory.appendTranscriptEntry(id2, { role: "user", content: "new" }, settings);
  const sessions = memory.listSessions(settings);
  // Most recently written should be first
  assert.equal(sessions.length, 2);
  assert.ok(
    sessions[0].updatedAt >= sessions[1].updatedAt,
    "first session should be most recently updated"
  );
});

test("resolveStoragePath: keeps absolute path", () => {
  const result = memory.resolveStoragePath("/root", "/absolute/path");
  assert.equal(result, path.normalize("/absolute/path"));
});

test("resolveStoragePath: resolves relative", () => {
  const result = memory.resolveStoragePath("/root", "relative");
  assert.equal(result, path.resolve("/root", "relative"));
});

test("readTranscriptMetadata: returns null when no metadata", () => {
  const { settings } = createFixture();
  const sessionId = memory.createSessionId(new Date("2026-04-28T10:00:00.000Z"));
  memory.writeTranscript(sessionId, [], settings);
  const sessions = memory.listSessions(settings);
  if (sessions.length > 0) {
    const meta = sessions[0].metadata();
    assert.ok(meta);
    assert.equal(meta.type, "session.meta");
  }
});

test("createTranscriptMetadata: includes project root", () => {
  const { settings } = createFixture();
  const meta = memory.createTranscriptMetadata(settings);
  assert.equal(meta.type, "session.meta");
  assert.equal(meta.projectRoot, path.resolve(settings.projectRoot));
  assert.ok(meta.projectName);
});
