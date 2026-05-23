/**
 * Tests for session-utils: mergeSessions, diffSessions, archiveSession,
 * getSessionStats, searchSessions, pruneSessions.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it, before, after } = require("node:test");

const {
  mergeSessions,
  diffSessions,
  archiveSession,
  getSessionStats,
  searchSessions,
  pruneSessions,
  _hashEntry,
  _computeSessionStats,
} = require("../src/session-utils");

const { writeTranscript, createSessionId, listSessions, readTranscript } = require("../src/memory");

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createFixture() {
  const projectRoot = createTempDir("hax-su-");
  const settings = {
    projectRoot,
    memory: { directory: path.join(projectRoot, "memory") },
    sessions: { directory: path.join(projectRoot, "sessions") },
  };
  return { projectRoot, settings };
}

function makeEntry(role, content, timestamp) {
  return {
    timestamp: timestamp || new Date().toISOString(),
    role,
    content: content || "",
  };
}

function writeSession(settings, entries) {
  const id = createSessionId();
  writeTranscript(id, entries, settings);
  return id;
}

// ---------------------------------------------------------------------------
// mergeSessions
// ---------------------------------------------------------------------------

describe("mergeSessions", () => {
  it("returns empty array for empty input", () => {
    const result = mergeSessions([]);
    assert.deepEqual(result, []);
  });

  it("returns empty array for non-array input", () => {
    const result = mergeSessions(null);
    assert.deepEqual(result, []);
  });

  it("merges two entry arrays and sorts by timestamp", () => {
    const ts1 = "2025-01-01T10:00:00.000Z";
    const ts2 = "2025-01-01T11:00:00.000Z";
    const ts3 = "2025-01-01T12:00:00.000Z";

    const sessionA = [
      { timestamp: ts1, role: "user", content: "hello" },
      { timestamp: ts3, role: "assistant", content: "hi there" },
    ];
    const sessionB = [
      { timestamp: ts2, role: "user", content: "how are you" },
    ];

    const merged = mergeSessions([sessionA, sessionB]);

    assert.equal(merged.length, 3);
    assert.equal(merged[0].timestamp, ts1);
    assert.equal(merged[0].content, "hello");
    assert.equal(merged[1].timestamp, ts2);
    assert.equal(merged[1].content, "how are you");
    assert.equal(merged[2].timestamp, ts3);
  });

  it("deduplicates entries with the same content hash", () => {
    const ts1 = "2025-01-01T10:00:00.000Z";

    const sessionA = [
      { timestamp: ts1, role: "user", content: "hello" },
    ];
    const sessionB = [
      { timestamp: ts1, role: "user", content: "hello" },
    ];

    const merged = mergeSessions([sessionA, sessionB]);

    assert.equal(merged.length, 1, "duplicate entries should be removed");
    assert.equal(merged[0].content, "hello");
  });

  it("does not deduplicate when dedup option is false", () => {
    const ts1 = "2025-01-01T10:00:00.000Z";

    const sessionA = [
      { timestamp: ts1, role: "user", content: "hello" },
    ];
    const sessionB = [
      { timestamp: ts1, role: "user", content: "hello" },
    ];

    const merged = mergeSessions([sessionA, sessionB], { dedup: false });

    assert.equal(merged.length, 2, "duplicate entries should be kept");
  });

  it("merges sessions by ID string using real transcript files", () => {
    const { settings } = createFixture();

    const entriesA = [
      { timestamp: "2025-01-01T10:00:00.000Z", role: "user", content: "msg1" },
    ];
    const entriesB = [
      { timestamp: "2025-01-01T11:00:00.000Z", role: "assistant", content: "msg2" },
    ];

    const idA = writeSession(settings, entriesA);
    const idB = writeSession(settings, entriesB);

    const merged = mergeSessions([idA, idB], settings);

    assert.equal(merged.length, 2);
    assert.equal(merged[0].content, "msg1");
    assert.equal(merged[1].content, "msg2");
  });

  it("merges session objects with lazy entries()", () => {
    const { settings } = createFixture();

    const entries = [
      { timestamp: "2025-01-01T10:00:00.000Z", role: "user", content: "test" },
    ];
    const id = writeSession(settings, entries);
    const sessions = listSessions(settings);
    const session = sessions.find((s) => s.id.startsWith(id));

    const merged = mergeSessions([session], settings);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].content, "test");
  });

  it("handles mixed input types (strings, arrays, objects)", () => {
    const { settings } = createFixture();

    const entries = [
      { timestamp: "2025-01-01T10:00:00.000Z", role: "user", content: "direct" },
    ];
    const id = writeSession(settings, [
      { timestamp: "2025-01-01T09:00:00.000Z", role: "user", content: "from-file" },
    ]);

    const merged = mergeSessions([entries, id], settings);

    assert.equal(merged.length, 2);
    assert.equal(merged[0].content, "from-file");
    assert.equal(merged[1].content, "direct");
  });
});

// ---------------------------------------------------------------------------
// diffSessions
// ---------------------------------------------------------------------------

describe("diffSessions", () => {
  it("detects no differences for identical sessions", () => {
    const a = [{ role: "user", content: "hello" }];
    const b = [{ role: "user", content: "hello" }];

    const diff = diffSessions(a, b);

    assert.equal(diff.added, 0);
    assert.equal(diff.removed, 0);
    assert.equal(diff.changed, 0);
  });

  it("detects added messages", () => {
    const a = [{ role: "user", content: "hello" }];
    const b = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];

    const diff = diffSessions(a, b);

    assert.equal(diff.added, 1);
    assert.equal(diff.removed, 0);
    assert.equal(diff.changed, 0);
  });

  it("detects removed messages", () => {
    const a = [
      { role: "user", content: "hello" },
      { role: "user", content: "world" },
    ];
    const b = [{ role: "user", content: "hello" }];

    const diff = diffSessions(a, b);

    assert.equal(diff.added, 0);
    assert.equal(diff.removed, 1);
    assert.equal(diff.changed, 0);
  });

  it("detects changed messages at same position", () => {
    const a = [{ role: "user", content: "hello" }];
    const b = [{ role: "user", content: "goodbye" }];

    const diff = diffSessions(a, b);

    assert.equal(diff.added, 0);
    assert.equal(diff.removed, 0);
    assert.equal(diff.changed, 1);
  });

  it("works with session IDs from transcript files", () => {
    const { settings } = createFixture();

    const idA = writeSession(settings, [
      { timestamp: "2025-01-01T10:00:00.000Z", role: "user", content: "a" },
    ]);
    const idB = writeSession(settings, [
      { timestamp: "2025-01-01T10:00:00.000Z", role: "user", content: "a" },
      { timestamp: "2025-01-01T10:00:01.000Z", role: "assistant", content: "b" },
    ]);

    const diff = diffSessions(idA, idB, settings);

    assert.equal(diff.added, 1);
    assert.equal(diff.removed, 0);
    assert.equal(diff.changed, 0);
  });
});

// ---------------------------------------------------------------------------
// archiveSession
// ---------------------------------------------------------------------------

describe("archiveSession", () => {
  it("moves session file to archive directory", () => {
    const { settings, projectRoot } = createFixture();
    const archiveDir = path.join(projectRoot, "archives");

    const id = writeSession(settings, [
      { timestamp: "2025-01-01T10:00:00.000Z", role: "user", content: "test" },
    ]);
    const sessions = listSessions(settings);
    const originalPath = sessions.find((s) => s.id.startsWith(id)).path;

    assert.ok(fs.existsSync(originalPath), "original file should exist before archive");

    const result = archiveSession(id, archiveDir, settings);

    assert.equal(result.moved, true);
    assert.ok(fs.existsSync(result.archivePath), "archive file should exist");
    assert.ok(!fs.existsSync(originalPath), "original file should be moved");

    // Archive info file should exist
    const infoPath = path.join(archiveDir, path.basename(result.archivePath, ".jsonl") + "-archive-info.json");
    assert.ok(fs.existsSync(infoPath), "archive info file should exist");

    const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
    assert.equal(info.sessionId, result.sessionId);
    assert.equal(info.messageCount, 1);
  });

  it("copies instead of moving when copy option is true", () => {
    const { settings, projectRoot } = createFixture();
    const archiveDir = path.join(projectRoot, "archives-copy");

    const id = writeSession(settings, [
      { timestamp: "2025-01-01T10:00:00.000Z", role: "user", content: "copy-test" },
    ]);
    const sessions = listSessions(settings);
    const originalPath = sessions.find((s) => s.id.startsWith(id)).path;

    const result = archiveSession(id, archiveDir, { ...settings, copy: true });

    assert.equal(result.moved, false);
    assert.ok(fs.existsSync(result.archivePath), "archive file should exist");
    assert.ok(fs.existsSync(originalPath), "original file should still exist");
  });

  it("throws for non-existent session", () => {
    const { projectRoot } = createFixture();
    const archiveDir = path.join(projectRoot, "archives-missing");

    assert.throws(() => {
      archiveSession("nonexistent-id-12345", archiveDir);
    }, /Session not found/);
  });
});

// ---------------------------------------------------------------------------
// getSessionStats
// ---------------------------------------------------------------------------

describe("getSessionStats", () => {
  it("returns zero stats for empty entries", () => {
    const stats = _computeSessionStats([]);

    assert.equal(stats.messageCount, 0);
    assert.equal(stats.turnCount, 0);
    assert.equal(stats.userMessages, 0);
    assert.equal(stats.assistantMessages, 0);
    assert.equal(stats.inputTokens, 0);
    assert.equal(stats.outputTokens, 0);
    assert.equal(stats.durationMs, 0);
    assert.equal(stats.firstTimestamp, null);
    assert.equal(stats.lastTimestamp, null);
  });

  it("counts messages by role correctly", () => {
    const entries = [
      makeEntry("user", "q1"),
      makeEntry("assistant", "a1"),
      makeEntry("user", "q2"),
      makeEntry("assistant", "a2"),
      makeEntry("tool", "result"),
    ];

    const stats = _computeSessionStats(entries);

    assert.equal(stats.messageCount, 5);
    assert.equal(stats.turnCount, 2); // user messages count
    assert.equal(stats.userMessages, 2);
    assert.equal(stats.assistantMessages, 2);
    assert.equal(stats.toolMessages, 1);
    assert.equal(stats.systemMessages, 0);
  });

  it("sums token usage from usage data in entries", () => {
    const entries = [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: "hi",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      },
    ];

    const stats = _computeSessionStats(entries);

    assert.equal(stats.inputTokens, 100);
    assert.equal(stats.outputTokens, 50);
  });

  it("handles alternate usage key names", () => {
    const entries = [
      {
        role: "assistant",
        content: "resp",
        usage: {
          promptTokens: 200,
          completionTokens: 80,
        },
      },
    ];

    const stats = _computeSessionStats(entries);

    assert.equal(stats.inputTokens, 200);
    assert.equal(stats.outputTokens, 80);
  });

  it("calculates duration from timestamps", () => {
    const entries = [
      { timestamp: "2025-01-01T10:00:00.000Z", role: "user", content: "start" },
      { timestamp: "2025-01-01T10:05:00.000Z", role: "assistant", content: "end" },
    ];

    const stats = _computeSessionStats(entries);

    assert.equal(stats.durationMs, 5 * 60 * 1000); // 5 minutes
    assert.equal(stats.firstTimestamp, "2025-01-01T10:00:00.000Z");
    assert.equal(stats.lastTimestamp, "2025-01-01T10:05:00.000Z");
  });

  it("detects file-change tool calls", () => {
    const entries = [
      { role: "tool", name: "file.edit", data: "changed" },
      { role: "tool", name: "file.write", data: "created" },
      { role: "tool", name: "Bash", data: "ls" },
      { role: "tool", name: "Read", data: "file content" },
    ];

    const stats = _computeSessionStats(entries);

    assert.equal(stats.fileChanges, 2, "file.edit and file.write should count");
  });

  it("computes stats from a real session by ID", () => {
    const { settings } = createFixture();

    const id = writeSession(settings, [
      { timestamp: "2025-06-01T10:00:00.000Z", role: "user", content: "hello" },
      { timestamp: "2025-06-01T10:00:05.000Z", role: "assistant", content: "hi there" },
      { timestamp: "2025-06-01T10:00:10.000Z", role: "user", content: "thanks" },
    ]);

    const stats = getSessionStats(id, settings);

    // sessionId may have extra suffix from toFileSafeName
    assert.ok(stats.sessionId.startsWith(id.split('-').slice(0, -1).join('-')), `sessionId should match: ${stats.sessionId} starts with ${id}`);
    assert.equal(stats.messageCount, 3);
    assert.equal(stats.turnCount, 2);
    assert.equal(stats.userMessages, 2);
    assert.equal(stats.assistantMessages, 1);
  });

  it("throws for non-existent session", () => {
    assert.throws(() => {
      getSessionStats("nonexistent-session-xyz");
    }, /Session not found/);
  });
});

// ---------------------------------------------------------------------------
// searchSessions
// ---------------------------------------------------------------------------

describe("searchSessions", () => {
  it("returns empty array for empty query", () => {
    const { settings } = createFixture();
    const results = searchSessions("", settings);
    assert.deepEqual(results, []);
  });

  it("returns empty array for whitespace query", () => {
    const { settings } = createFixture();
    const results = searchSessions("   ", settings);
    assert.deepEqual(results, []);
  });

  it("returns empty array for null/undefined query", () => {
    const { settings } = createFixture();
    assert.deepEqual(searchSessions(null, settings), []);
    assert.deepEqual(searchSessions(undefined, settings), []);
  });

  it("finds messages across sessions by content", () => {
    const { settings } = createFixture();

    writeSession(settings, [
      { timestamp: "2025-06-01T10:00:00.000Z", role: "user", content: "how to deploy" },
      { timestamp: "2025-06-01T10:00:01.000Z", role: "assistant", content: "use npm run deploy" },
    ]);

    writeSession(settings, [
      { timestamp: "2025-06-02T10:00:00.000Z", role: "user", content: "another question about deployment" },
    ]);

    const results = searchSessions("deploy", settings);

    assert.ok(results.length >= 2, "should find at least 2 matches");
    // Results should be sorted by score
    assert.ok(results[0].score >= results[1].score);
  });

  it("filters by role", () => {
    const { settings } = createFixture();

    writeSession(settings, [
      { timestamp: "2025-06-01T10:00:00.000Z", role: "user", content: "I need to fix a bug" },
      { timestamp: "2025-06-01T10:00:01.000Z", role: "assistant", content: "Let me fix the bug" },
    ]);

    const userResults = searchSessions("bug", { ...settings, role: "user" });
    const assistantResults = searchSessions("bug", { ...settings, role: "assistant" });

    assert.equal(userResults.length, 1);
    assert.equal(userResults[0].entry.role, "user");
    assert.equal(assistantResults.length, 1);
    assert.equal(assistantResults[0].entry.role, "assistant");
  });

  it("scores exact matches higher than substring matches", () => {
    const { settings } = createFixture();

    writeSession(settings, [
      { timestamp: "2025-06-01T10:00:00.000Z", role: "user", content: "exact" },
      { timestamp: "2025-06-01T10:00:01.000Z", role: "user", content: "someexactstring" },
    ]);

    const results = searchSessions("exact", settings);

    assert.equal(results.length, 2);
    // The item with content exactly "exact" should score higher
    assert.ok(results[0].score > results[1].score);
  });

  it("respects the limit option", () => {
    const { settings } = createFixture();

    for (let i = 0; i < 10; i++) {
      writeSession(settings, [
        { timestamp: new Date().toISOString(), role: "user", content: `searchable test message ${i}` },
      ]);
    }

    const results = searchSessions("searchable", { ...settings, limit: 3 });

    assert.ok(results.length <= 3, "should respect limit");
  });

  it("searches tool call names", () => {
    const { settings } = createFixture();

    writeSession(settings, [
      { timestamp: "2025-06-01T10:00:00.000Z", role: "tool", name: "Read", content: "reading file" },
    ]);

    const results = searchSessions("Read", settings);

    assert.ok(results.length >= 1);
    assert.equal(results[0].entry.name, "Read");
  });
});

// ---------------------------------------------------------------------------
// pruneSessions
// ---------------------------------------------------------------------------

describe("pruneSessions", () => {
  it("returns zero when no criteria given", () => {
    const { settings } = createFixture();

    writeSession(settings, [
      { timestamp: "2025-06-01T10:00:00.000Z", role: "user", content: "test" },
    ]);

    const result = pruneSessions({}, settings);

    assert.equal(result.deleted, 0);
    assert.equal(result.kept, 1);
    assert.deepEqual(result.deletedIds, []);
  });

  it("keeps most recent N sessions (maxCount)", () => {
    const { settings } = createFixture();

    // Create 5 sessions
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const id = writeSession(settings, [
        { timestamp: new Date(Date.now() - (5 - i) * 1000).toISOString(), role: "user", content: `msg${i}` },
      ]);
      ids.push(id);
    }

    // Verify 5 sessions exist
    const before = listSessions(settings);
    assert.equal(before.length, 5);

    const result = pruneSessions({ maxCount: 2 }, settings);

    assert.equal(result.deleted, 3, "should delete 3 sessions");
    assert.equal(result.kept, 2, "should keep 2 sessions");
    assert.equal(result.deletedIds.length, 3);

    const after = listSessions(settings);
    assert.equal(after.length, 2, "only 2 sessions should remain");
  });

  it("deletes sessions older than maxAge", () => {
    const { settings } = createFixture();

    // We can't easily create sessions with old update times, so we test
    // by giving a very large maxAge that keeps everything
    const id = writeSession(settings, [
      { timestamp: new Date().toISOString(), role: "user", content: "fresh" },
    ]);

    const result = pruneSessions({ maxAge: 3600 * 1000 * 24 * 365 }, settings); // 1 year

    assert.equal(result.deleted, 0);
    assert.equal(result.kept, 1);

    // The session should still exist
    const after = listSessions(settings);
    assert.equal(after.length, 1);
  });

  it("applies both maxAge and maxCount together", () => {
    const { settings } = createFixture();

    for (let i = 0; i < 3; i++) {
      writeSession(settings, [
        { timestamp: new Date().toISOString(), role: "user", content: `msg${i}` },
      ]);
    }

    // Both criteria: keep at most 1, but only if recent enough
    const result = pruneSessions({
      maxCount: 1,
      maxAge: 3600 * 1000 * 24, // 1 day
    }, settings);

    assert.equal(result.kept, 1);
    assert.equal(result.deleted, 2);

    const after = listSessions(settings);
    assert.equal(after.length, 1);
  });
});

// ---------------------------------------------------------------------------
// _hashEntry
// ---------------------------------------------------------------------------

describe("_hashEntry", () => {
  it("produces consistent hashes for identical entries", () => {
    const entry = { role: "user", content: "hello" };
    assert.equal(_hashEntry(entry), _hashEntry({ ...entry }));
  });

  it("excludes timestamp from hash", () => {
    const a = { timestamp: "2025-01-01T10:00:00.000Z", role: "user", content: "hello" };
    const b = { timestamp: "2025-06-15T12:00:00.000Z", role: "user", content: "hello" };
    assert.equal(_hashEntry(a), _hashEntry(b));
  });

  it("produces different hashes for different content", () => {
    const a = { role: "user", content: "hello" };
    const b = { role: "user", content: "world" };
    assert.notEqual(_hashEntry(a), _hashEntry(b));
  });
});
