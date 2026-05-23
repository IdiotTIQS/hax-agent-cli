"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getToolUsageStats,
  getMostUsedTools,
  getErrorProneTools,
  getToolSequencePatterns,
  getToolUsageTimeline,
} = require("../../src/analytics/tool-insights");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function ts(offsetMinutes = 0) {
  const d = new Date("2026-05-20T10:00:00Z");
  d.setMinutes(d.getMinutes() + offsetMinutes);
  return d.toISOString();
}

function userMsg(content, offset = 0) {
  return { timestamp: ts(offset), role: "user", content };
}

function assistantMsg(content, offset = 0, usage) {
  const entry = { timestamp: ts(offset), role: "assistant", content };
  if (usage) entry.usage = usage;
  return entry;
}

function toolMsg(name, offset = 0, opts = {}) {
  const entry = {
    timestamp: ts(offset),
    role: "tool",
    name,
    data: opts.data || {},
  };
  if (opts.isError) entry.isError = true;
  if (opts.duration != null) entry.duration = opts.duration;
  if (opts.durationMs != null) entry.durationMs = opts.durationMs;
  return entry;
}

function buildSession(id, entries) {
  return { id, entries };
}

// ---------------------------------------------------------------------------
// Base data
// ---------------------------------------------------------------------------

const sessionA = buildSession("sess-a", [
  userMsg("Read file", 0),
  assistantMsg("Reading...", 1),
  toolMsg("file.read", 2, { data: { path: "/a.js" } }),
  assistantMsg("Now editing...", 3),
  toolMsg("file.edit", 4, { data: { path: "/a.js" }, duration: 15 }),
  assistantMsg("Now writing...", 5),
  toolMsg("file.write", 6, { data: { path: "/b.js" }, duration: 42 }),
  assistantMsg("Done", 7),
]);

const sessionB = buildSession("sess-b", [
  userMsg("Run shell command", 10),
  assistantMsg("Running...", 11),
  toolMsg("shell.run", 12, { isError: true, duration: 500 }),
  assistantMsg("Retrying...", 13),
  toolMsg("shell.run", 14, { duration: 320 }),
  assistantMsg("Now search", 15),
  toolMsg("web.search", 16, { duration: 1200 }),
  assistantMsg("Done", 17),
]);

const sessionC = buildSession("sess-c", [
  userMsg("Sequence test", 0),
  assistantMsg("Step 1", 1),
  toolMsg("file.read", 2, { duration: 10 }),
  assistantMsg("Step 2", 3),
  toolMsg("file.edit", 4, { duration: 20 }),
  assistantMsg("Step 3", 5),
  toolMsg("file.write", 6, { duration: 30 }),
  assistantMsg("Step 4", 7),
  toolMsg("file.read", 8, { duration: 12 }),
  assistantMsg("Done", 9),
]);

// ---------------------------------------------------------------------------
// getToolUsageStats tests
// ---------------------------------------------------------------------------

test("getToolUsageStats: counts tool usage and success/error counts", () => {
  const stats = getToolUsageStats([sessionA, sessionB]);

  assert.equal(stats["file.read"].count, 1);
  assert.equal(stats["file.read"].successCount, 1);
  assert.equal(stats["file.read"].errorCount, 0);
  assert.equal(stats["file.read"].successRate, 1);

  assert.equal(stats["shell.run"].count, 2);
  assert.equal(stats["shell.run"].successCount, 1);
  assert.equal(stats["shell.run"].errorCount, 1);
  assert.equal(stats["shell.run"].successRate, 0.5);

  assert.equal(stats["web.search"].count, 1);
  assert.equal(stats["web.search"].errorCount, 0);
});

test("getToolUsageStats: captures duration metrics when available", () => {
  const stats = getToolUsageStats([sessionB]);

  assert.ok(stats["shell.run"] !== undefined);
  // Two calls: 500ms (error), 320ms (success)
  assert.equal(stats["shell.run"].avgDurationMs, 410);
  assert.equal(stats["shell.run"].minDurationMs, 320);
  assert.equal(stats["shell.run"].maxDurationMs, 500);

  assert.equal(stats["web.search"].avgDurationMs, 1200);
});

test("getToolUsageStats: handles durationMs field", () => {
  const entries = [
    toolMsg("slow.tool", 0, { durationMs: 1500 }),
    toolMsg("slow.tool", 1, { durationMs: 2500 }),
  ];
  const stats = getToolUsageStats([buildSession("d", entries)]);
  assert.equal(stats["slow.tool"].avgDurationMs, 2000);
});

test("getToolUsageStats: returns null durations when none provided", () => {
  const stats = getToolUsageStats([sessionA]);
  assert.equal(stats["file.read"].avgDurationMs, null);
  assert.equal(stats["file.read"].minDurationMs, null);
  assert.equal(stats["file.read"].maxDurationMs, null);
});

test("getToolUsageStats: handles empty sessions", () => {
  const stats = getToolUsageStats([]);
  assert.deepEqual(stats, {});
});

test("getToolUsageStats: handles null input", () => {
  const stats = getToolUsageStats(null);
  assert.deepEqual(stats, {});
});

// ---------------------------------------------------------------------------
// getMostUsedTools tests
// ---------------------------------------------------------------------------

test("getMostUsedTools: returns top N tools sorted by usage", () => {
  const top = getMostUsedTools([sessionA, sessionB], 3);

  assert.equal(top.length, 3);
  // shell.run has 2 calls, others have 1
  assert.equal(top[0].name, "shell.run");
  assert.equal(top[0].count, 2);

  // Success rate for shell.run (1/2 = 0.5)
  assert.equal(top[0].successRate, 0.5);
});

test("getMostUsedTools: defaults to top 10 when n is not provided", () => {
  const top = getMostUsedTools([sessionA, sessionB]);
  assert.ok(Array.isArray(top));
  assert.ok(top.length <= 10);
});

test("getMostUsedTools: handles empty sessions", () => {
  const top = getMostUsedTools([]);
  assert.deepEqual(top, []);
});

// ---------------------------------------------------------------------------
// getErrorProneTools tests
// ---------------------------------------------------------------------------

test("getErrorProneTools: returns tools with error rate above threshold", () => {
  const errorTools = getErrorProneTools([sessionB], 0.1);

  // shell.run: 1 error out of 2 = 50% > 10%
  const shellRun = errorTools.find((t) => t.name === "shell.run");
  assert.ok(shellRun);
  assert.equal(shellRun.errorCount, 1);
  assert.equal(shellRun.errorRate, 0.5);

  // web.search has 0 errors, should NOT be in the list
  const webSearch = errorTools.find((t) => t.name === "web.search");
  assert.equal(webSearch, undefined);
});

test("getErrorProneTools: default threshold is 0.1", () => {
  // Create a session with 1 error out of 20 calls = 5%, below default threshold
  const entries = [];
  entries.push(toolMsg("fine.tool", 0, { isError: true }));
  for (let i = 1; i < 20; i++) {
    entries.push(toolMsg("fine.tool", i, {}));
  }
  const errorTools = getErrorProneTools([buildSession("low", entries)]);
  assert.ok(errorTools.length === 0);
});

test("getErrorProneTools: returns empty when no errors exist", () => {
  const errorTools = getErrorProneTools([sessionA]);
  assert.deepEqual(errorTools, []);
});

test("getErrorProneTools: handles empty sessions", () => {
  const errorTools = getErrorProneTools([], 0);
  assert.deepEqual(errorTools, []);
});

// ---------------------------------------------------------------------------
// getToolSequencePatterns tests
// ---------------------------------------------------------------------------

test("getToolSequencePatterns: detects bigram tool sequences", () => {
  const patterns = getToolSequencePatterns([sessionC]);

  // sessionC has: file.read -> file.edit -> file.write -> file.read
  // Bigrams: [read,edit], [edit,write], [write,read]
  assert.equal(patterns.length, 3);

  // Verify specific sequences
  const sequences = patterns.map((p) => p.sequence.join(" -> "));
  assert.ok(sequences.includes("file.read -> file.edit"));
  assert.ok(sequences.includes("file.edit -> file.write"));
  assert.ok(sequences.includes("file.write -> file.read"));

  // Each bigram should appear once in sessionC
  assert.equal(patterns[0].count, 1);
});

test("getToolSequencePatterns: counts patterns across multiple sessions", () => {
  // Two sessions both doing read -> write
  const sess1 = buildSession("1", [
    toolMsg("file.read", 0),
    toolMsg("file.write", 1),
  ]);
  const sess2 = buildSession("2", [
    toolMsg("file.read", 0),
    toolMsg("file.write", 1),
  ]);

  const patterns = getToolSequencePatterns([sess1, sess2]);
  const readWrite = patterns.find(
    (p) => p.sequence[0] === "file.read" && p.sequence[1] === "file.write"
  );
  assert.ok(readWrite);
  assert.equal(readWrite.count, 2);
});

test("getToolSequencePatterns: returns empty for single-tool session", () => {
  const sess = buildSession("solo", [toolMsg("file.read", 0)]);
  const patterns = getToolSequencePatterns([sess]);
  assert.deepEqual(patterns, []);
});

test("getToolSequencePatterns: handles empty sessions", () => {
  const patterns = getToolSequencePatterns([]);
  assert.deepEqual(patterns, []);
});

// ---------------------------------------------------------------------------
// getToolUsageTimeline tests
// ---------------------------------------------------------------------------

test("getToolUsageTimeline: returns chronological list of tool calls", () => {
  const timeline = getToolUsageTimeline([sessionA]);

  assert.equal(timeline.length, 3);
  // Verify ordering by timestamp
  for (let i = 1; i < timeline.length; i++) {
    assert.ok(timeline[i].timestampMs >= timeline[i - 1].timestampMs);
  }

  // First tool should be file.read
  assert.equal(timeline[0].toolName, "file.read");
  assert.equal(timeline[0].sessionId, "sess-a");
  assert.equal(timeline[0].isError, false);
});

test("getToolUsageTimeline: interleaves sessions chronologically", () => {
  const timeline = getToolUsageTimeline([sessionA, sessionB]);

  // sessionA tools at offsets 2,4,6; sessionB at 12,14,16
  // So all of A's tools should come before B's
  const aTools = timeline.filter((t) => t.sessionId === "sess-a");
  const bTools = timeline.filter((t) => t.sessionId === "sess-b");

  const lastAIdx = timeline.findIndex((t) => t === aTools[aTools.length - 1]);
  const firstBIdx = timeline.findIndex((t) => t === bTools[0]);

  assert.ok(lastAIdx < firstBIdx);
});

test("getToolUsageTimeline: handles entries without timestamps", () => {
  const sess = buildSession("notime", [
    { role: "tool", name: "no-ts-tool", data: {} },
  ]);
  const timeline = getToolUsageTimeline([sess]);
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].toolName, "no-ts-tool");
  assert.equal(timeline[0].timestamp, null);
});

test("getToolUsageTimeline: handles empty sessions", () => {
  const timeline = getToolUsageTimeline([]);
  assert.deepEqual(timeline, []);
});

test("getToolUsageTimeline: handles sessions passed as raw entries arrays", () => {
  const entries = [
    userMsg("Hi", 0),
    toolMsg("test.tool", 1),
    assistantMsg("Bye", 2),
  ];
  const timeline = getToolUsageTimeline([entries]);
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].toolName, "test.tool");
});
