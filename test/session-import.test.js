/**
 * Tests for session-import: importFromJsonl, importFromChatLog, batchImport.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const {
  importFromJsonl,
  importFromChatLog,
  batchImport,
  _detectFormat,
  _extractRoleAndContent,
  _normalizeEntry,
} = require("../src/session-import");

const { readTranscript, listSessions } = require("../src/memory");

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createFixture() {
  const projectRoot = createTempDir("hax-imp-");
  const settings = {
    projectRoot,
    memory: { directory: path.join(projectRoot, "memory") },
    sessions: { directory: path.join(projectRoot, "sessions") },
  };
  return { projectRoot, settings };
}

// ---------------------------------------------------------------------------
// _normalizeEntry
// ---------------------------------------------------------------------------

describe("_normalizeEntry", () => {
  it("normalizes a record with role and content", () => {
    const result = _normalizeEntry(
      { role: "user", content: "hello" },
      "2025-01-01T00:00:00.000Z"
    );

    assert.equal(result.role, "user");
    assert.equal(result.content, "hello");
    assert.equal(result.timestamp, "2025-01-01T00:00:00.000Z");
  });

  it("uses fallback timestamp when record has none", () => {
    const result = _normalizeEntry(
      { role: "assistant", content: "ok" },
      "2025-06-01T00:00:00.000Z"
    );

    assert.equal(result.timestamp, "2025-06-01T00:00:00.000Z");
  });

  it("preserves extra fields like name, data, isError", () => {
    const result = _normalizeEntry(
      {
        role: "tool",
        name: "Read",
        data: "file contents",
        isError: true,
        tool_call_id: "abc123",
      },
      "2025-01-01T00:00:00.000Z"
    );

    assert.equal(result.name, "Read");
    assert.equal(result.data, "file contents");
    assert.equal(result.isError, true);
    assert.equal(result.tool_call_id, "abc123");
  });
});

// ---------------------------------------------------------------------------
// _detectFormat
// ---------------------------------------------------------------------------

describe("_detectFormat", () => {
  it("detects User:/Assistant: format", () => {
    const lines = [
      "User: hello",
      "Assistant: hi there",
      "User: how are you?",
      "Assistant: I'm good!",
    ];

    const format = _detectFormat(lines);

    assert.equal(format.hasPatterns, true);
    assert.ok(format.userMatches > 0);
    assert.ok(format.assistantMatches > 0);
  });

  it("detects >>>/<<< format", () => {
    const lines = [
      ">>> hello",
      "<<< hi there",
    ];

    const format = _detectFormat(lines);

    assert.equal(format.hasPatterns, true);
  });

  it("returns false for unrecognized format", () => {
    const lines = [
      "This is just some text",
      "No recognizable chat patterns here",
      "Just plain content",
    ];

    const format = _detectFormat(lines);

    assert.equal(format.hasPatterns, false);
  });

  it("detects Human:/AI: format", () => {
    const lines = [
      "Human: Can you help?",
      "AI: Of course!",
    ];

    const format = _detectFormat(lines);

    assert.equal(format.hasPatterns, true);
  });
});

// ---------------------------------------------------------------------------
// _extractRoleAndContent
// ---------------------------------------------------------------------------

describe("_extractRoleAndContent", () => {
  it("extracts User: format", () => {
    const result = _extractRoleAndContent("User: hello world");
    assert.equal(result.role, "user");
    assert.equal(result.content, "hello world");
  });

  it("extracts Assistant: format", () => {
    const result = _extractRoleAndContent("Assistant: hi there");
    assert.equal(result.role, "assistant");
    assert.equal(result.content, "hi there");
  });

  it("extracts >>> format", () => {
    const result = _extractRoleAndContent(">>> what is this");
    assert.equal(result.role, "user");
    assert.equal(result.content, "what is this");
  });

  it("extracts <<< format", () => {
    const result = _extractRoleAndContent("<<< this is the response");
    assert.equal(result.role, "assistant");
    assert.equal(result.content, "this is the response");
  });

  it("returns null for unrecognized lines", () => {
    const result = _extractRoleAndContent("just a regular line");
    assert.equal(result, null);
  });

  it("extracts Human: and AI: variants", () => {
    assert.equal(_extractRoleAndContent("Human: query").role, "user");
    assert.equal(_extractRoleAndContent("AI: answer").role, "assistant");
    assert.equal(_extractRoleAndContent("Bot: reply").role, "assistant");
  });
});

// ---------------------------------------------------------------------------
// importFromJsonl
// ---------------------------------------------------------------------------

describe("importFromJsonl", () => {
  it("imports a valid JSONL file", () => {
    const { settings, projectRoot } = createFixture();
    const jsonlPath = path.join(projectRoot, "test.jsonl");
    const content = [
      JSON.stringify({ role: "user", content: "hello" }),
      JSON.stringify({ role: "assistant", content: "hi there" }),
      JSON.stringify({ role: "user", content: "thanks" }),
    ].join("\n");
    fs.writeFileSync(jsonlPath, content, "utf8");

    const result = importFromJsonl(jsonlPath, settings);

    assert.ok(result.sessionId, "should have a session ID");
    assert.ok(result.path, "should have an output path");
    assert.equal(result.imported, 3);
    assert.equal(result.skipped, 0);

    // Verify the transcript was written
    const entries = readTranscript(result.sessionId, settings);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].role, "user");
    assert.equal(entries[0].content, "hello");
    assert.equal(entries[1].role, "assistant");
    assert.equal(entries[1].content, "hi there");
  });

  it("skips invalid JSON lines", () => {
    const { settings, projectRoot } = createFixture();
    const jsonlPath = path.join(projectRoot, "mixed.jsonl");
    const content = [
      JSON.stringify({ role: "user", content: "valid" }),
      "not valid json {{{",
      JSON.stringify({ role: "assistant", content: "also valid" }),
    ].join("\n");
    fs.writeFileSync(jsonlPath, content, "utf8");

    assert.throws(() => {
      importFromJsonl(jsonlPath, settings);
    }, /Invalid JSON/);
  });

  it("skips records without role field", () => {
    const { settings, projectRoot } = createFixture();
    const jsonlPath = path.join(projectRoot, "norole.jsonl");
    const content = [
      JSON.stringify({ role: "user", content: "good" }),
      JSON.stringify({ content: "no role here" }),
    ].join("\n");
    fs.writeFileSync(jsonlPath, content, "utf8");

    const result = importFromJsonl(jsonlPath, settings);

    assert.equal(result.imported, 1);
    assert.equal(result.skipped, 1);
  });

  it("uses custom sessionId when provided", () => {
    const { settings, projectRoot } = createFixture();
    const jsonlPath = path.join(projectRoot, "custom.jsonl");
    fs.writeFileSync(jsonlPath, JSON.stringify({ role: "user", content: "test" }) + "\n", "utf8");

    const customId = "my-custom-session-id";
    const result = importFromJsonl(jsonlPath, { ...settings, sessionId: customId });

    assert.equal(result.sessionId, customId);
  });

  it("throws for non-existent file", () => {
    const { settings } = createFixture();

    assert.throws(() => {
      importFromJsonl("/nonexistent/path/file.jsonl", settings);
    }, /File not found/);
  });

  it("imports JSONL with tool call entries", () => {
    const { settings, projectRoot } = createFixture();
    const jsonlPath = path.join(projectRoot, "tools.jsonl");
    const content = [
      JSON.stringify({ role: "user", content: "read the file" }),
      JSON.stringify({ role: "tool", name: "Read", content: "reading file contents" }),
    ].join("\n");
    fs.writeFileSync(jsonlPath, content, "utf8");

    const result = importFromJsonl(jsonlPath, settings);

    assert.equal(result.imported, 2);

    const entries = readTranscript(result.sessionId, settings);
    assert.equal(entries[1].role, "tool");
    assert.equal(entries[1].name, "Read");
  });
});

// ---------------------------------------------------------------------------
// importFromChatLog
// ---------------------------------------------------------------------------

describe("importFromChatLog", () => {
  it("imports a User:/Assistant: chat log", () => {
    const { settings, projectRoot } = createFixture();
    const logPath = path.join(projectRoot, "chat.txt");
    const content = [
      "User: Hello, how are you?",
      "Assistant: I'm doing well, thanks!",
      "User: Can you help me with something?",
      "Assistant: Of course, what do you need?",
      "User: Great, thanks!",
    ].join("\n");
    fs.writeFileSync(logPath, content, "utf8");

    const result = importFromChatLog(logPath, settings);

    assert.ok(result.sessionId, "should have a session ID");
    assert.equal(result.imported, 5);

    const entries = readTranscript(result.sessionId, settings);
    assert.equal(entries.length, 5);
    assert.equal(entries[0].role, "user");
    assert.equal(entries[0].content, "Hello, how are you?");
    assert.equal(entries[1].role, "assistant");
    assert.equal(entries[1].content, "I'm doing well, thanks!");
  });

  it("imports a >>>/<<< chat log", () => {
    const { settings, projectRoot } = createFixture();
    const logPath = path.join(projectRoot, "arrows.txt");
    const content = [
      ">>> what is the weather",
      "<<< it is sunny today",
      ">>> thanks",
    ].join("\n");
    fs.writeFileSync(logPath, content, "utf8");

    const result = importFromChatLog(logPath, settings);

    assert.equal(result.imported, 3);

    const entries = readTranscript(result.sessionId, settings);
    assert.equal(entries[0].role, "user");
    assert.equal(entries[1].role, "assistant");
    assert.equal(entries[2].role, "user");
  });

  it("throws for unrecognized format", () => {
    const { settings, projectRoot } = createFixture();
    const logPath = path.join(projectRoot, "plain.txt");
    fs.writeFileSync(logPath, "This is just some random text\nwith no chat format\n", "utf8");

    assert.throws(() => {
      importFromChatLog(logPath, settings);
    }, /No recognizable chat format/);
  });

  it("throws for file not found", () => {
    const { settings } = createFixture();

    assert.throws(() => {
      importFromChatLog("/nonexistent/chat.txt", settings);
    }, /File not found/);
  });

  it("handles multi-line messages", () => {
    const { settings, projectRoot } = createFixture();
    const logPath = path.join(projectRoot, "multiline.txt");
    const content = [
      "User: Here is a long message",
      "that spans multiple lines",
      "and has three paragraphs total",
      "",
      "Assistant: I see your multi-line",
      "message and I will respond",
      "across multiple lines as well",
    ].join("\n");
    fs.writeFileSync(logPath, content, "utf8");

    const result = importFromChatLog(logPath, settings);

    assert.equal(result.imported, 2);

    const entries = readTranscript(result.sessionId, settings);
    assert.equal(entries[0].content, "Here is a long message\nthat spans multiple lines\nand has three paragraphs total");
    assert.equal(entries[1].content, "I see your multi-line\nmessage and I will respond\nacross multiple lines as well");
  });
});

// ---------------------------------------------------------------------------
// batchImport
// ---------------------------------------------------------------------------

describe("batchImport", () => {
  it("imports mixed file types from a directory", () => {
    const { settings, projectRoot } = createFixture();

    // Create .jsonl file
    const jsonlPath = path.join(projectRoot, "session1.jsonl");
    fs.writeFileSync(jsonlPath, JSON.stringify({ role: "user", content: "jsonl msg" }) + "\n", "utf8");

    // Create .txt chat log
    const txtPath = path.join(projectRoot, "chat1.txt");
    fs.writeFileSync(txtPath, "User: txt message\nAssistant: txt reply\n", "utf8");

    const results = batchImport(projectRoot, settings);

    assert.equal(results.length, 2);

    const jsonlResult = results.find((r) => r.type === "jsonl");
    const chatlogResult = results.find((r) => r.type === "chatlog");

    assert.ok(jsonlResult, "should have jsonl import result");
    assert.equal(jsonlResult.imported, 1);
    assert.ok(jsonlResult.sessionId);

    assert.ok(chatlogResult, "should have chatlog import result");
    assert.equal(chatlogResult.imported, 2);
  });

  it("handles import errors gracefully", () => {
    const { settings, projectRoot } = createFixture();

    // Create a broken .jsonl file
    const badPath = path.join(projectRoot, "broken.jsonl");
    fs.writeFileSync(badPath, "this is not valid json {{{", "utf8");

    // Create a valid file
    const goodPath = path.join(projectRoot, "good.jsonl");
    fs.writeFileSync(goodPath, JSON.stringify({ role: "user", content: "valid" }) + "\n", "utf8");

    const results = batchImport(projectRoot, settings);

    // Should have results for both, one with error
    assert.equal(results.length, 2);

    const badResult = results.find((r) => r.error);
    assert.ok(badResult, "should have an error result");
    assert.ok(badResult.error.includes("Invalid JSON"));

    const goodResult = results.find((r) => !r.error);
    assert.ok(goodResult, "should have a success result");
    assert.equal(goodResult.imported, 1);
  });

  it("respects the extensions filter", () => {
    const { settings, projectRoot } = createFixture();

    fs.writeFileSync(path.join(projectRoot, "a.jsonl"), JSON.stringify({ role: "user", content: "a" }) + "\n", "utf8");
    fs.writeFileSync(path.join(projectRoot, "b.txt"), "User: b\n", "utf8");
    fs.writeFileSync(path.join(projectRoot, "c.md"), "# Not importable\n", "utf8"); // should be skipped

    const results = batchImport(projectRoot, { ...settings, extensions: [".jsonl"] });

    assert.equal(results.length, 1);
    assert.equal(results[0].type, "jsonl");
  });

  it("throws for non-existent directory", () => {
    assert.throws(() => {
      batchImport("/nonexistent/directory/path");
    }, /Directory not found/);
  });

  it("returns empty array for empty directory", () => {
    const { settings, projectRoot } = createFixture();

    const results = batchImport(projectRoot, settings);

    assert.equal(results.length, 0);
  });
});
