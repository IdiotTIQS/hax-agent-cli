"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { analyzeSession, analyzeSessions, getUsageTrends } = require("../../src/analytics/conversation-stats");

// ---------------------------------------------------------------------------
// Test helpers — build realistic mock transcript entries
// ---------------------------------------------------------------------------

function ts(offsetMinutes = 0) {
  const d = new Date("2026-05-20T10:00:00Z");
  d.setMinutes(d.getMinutes() + offsetMinutes);
  return d.toISOString();
}

function userMsg(content, offset = 0) {
  return { timestamp: ts(offset), role: "user", content };
}

function assistantMsg(content, offset = 0, usage, toolCalls) {
  const entry = { timestamp: ts(offset), role: "assistant", content };
  if (usage) entry.usage = usage;
  if (toolCalls) entry.tool_calls = toolCalls;
  return entry;
}

function toolMsg(name, offset = 0, data, isError) {
  const entry = { timestamp: ts(offset), role: "tool", name, data: data || {} };
  if (isError) entry.isError = true;
  return entry;
}

function simpleSession() {
  return [
    userMsg("Hello, can you help me?", 0),
    assistantMsg("Of course! Let me read the file first.", 1, {
      input_tokens: 120,
      output_tokens: 50,
    }),
    toolMsg("file.read", 2, { path: "/src/index.js" }),
    assistantMsg("I read the file. Now let me edit it.", 3, {
      input_tokens: 200,
      output_tokens: 80,
    }, [{ function: { name: "file.read" } }]),
    toolMsg("file.edit", 4, { path: "/src/index.js" }),
    assistantMsg("Done editing. Files modified: 1", 5, {
      input_tokens: 150,
      output_tokens: 40,
    }),
  ];
}

function sessionWithErrors() {
  return [
    userMsg("Fix the bug", 0),
    assistantMsg("Let me try.", 1, { input_tokens: 100, output_tokens: 30 }),
    toolMsg("file.write", 2, { path: "/bad/path" }, true),
    assistantMsg("That failed. Trying shell command.", 3, {
      input_tokens: 180,
      output_tokens: 60,
    }),
    toolMsg("shell.run", 4, { exitCode: 1 }, true),
    assistantMsg("Still failing.", 5, {
      input_tokens: 250,
      output_tokens: 45,
    }),
    toolMsg("shell.run", 6, { exitCode: 0 }),
    assistantMsg("Fixed!", 7, { input_tokens: 120, output_tokens: 25 }),
  ];
}

// ---------------------------------------------------------------------------
// analyzeSession tests
// ---------------------------------------------------------------------------

test("analyzeSession: counts messages by role", () => {
  const result = analyzeSession(simpleSession());
  assert.equal(result.roles.user, 1);
  assert.equal(result.roles.assistant, 3);
  assert.equal(result.roles.tool, 2);
  assert.equal(result.totalEntries, 6);
});

test("analyzeSession: computes turn lengths (avg/max/min)", () => {
  const result = analyzeSession(simpleSession());
  assert.ok(result.turnLengths.avg > 0);
  assert.ok(result.turnLengths.max >= result.turnLengths.min);
  assert.ok(result.turnLengths.min <= result.turnLengths.avg);
});

test("analyzeSession: returns per-role turn lengths", () => {
  const result = analyzeSession(simpleSession());
  assert.ok(result.roleTurnLengths.user);
  assert.ok(result.roleTurnLengths.assistant);
  assert.ok(result.roleTurnLengths.tool);
  // User has 1 message, avg equals its length
  assert.equal(result.roleTurnLengths.user.avg, 23);
});

test("analyzeSession: tracks tool usage breakdown", () => {
  const result = analyzeSession(simpleSession());
  assert.equal(result.toolUsage["file.read"], 1);
  assert.equal(result.toolUsage["file.edit"], 1);
});

test("analyzeSession: tracks files modified from tool data", () => {
  const result = analyzeSession(simpleSession());
  assert.ok(result.filesModified.includes("/src/index.js"));
});

test("analyzeSession: calculates error rate", () => {
  const result = analyzeSession(sessionWithErrors());
  assert.ok(result.errorCount >= 2);
  assert.ok(result.errorRate > 0);
});

test("analyzeSession: extracts token usage totals", () => {
  const result = analyzeSession(simpleSession());
  assert.ok(result.totalTokens.input > 0);
  assert.ok(result.totalTokens.output > 0);
  assert.equal(result.totalTokens.input, 470);
  assert.equal(result.totalTokens.output, 170);
});

test("analyzeSession: returns response latency when includeLatency is true", () => {
  const result = analyzeSession(sessionWithErrors(), { includeLatency: true });
  assert.ok(result.responseLatency !== undefined);
  assert.ok(result.responseLatency.avg !== null);
  assert.ok(result.responseLatency.avg > 0);
});

test("analyzeSession: computes session duration", () => {
  const result = analyzeSession(simpleSession());
  assert.ok(result.durationMs > 0);
  // 6 entries spanning 5 minutes between timestamp offsets
  assert.equal(result.durationMs, 5 * 60 * 1000);
});

test("analyzeSession: handles empty entries array gracefully", () => {
  const result = analyzeSession([]);
  assert.equal(result.totalEntries, 0);
  assert.equal(result.turns, 0);
  assert.equal(result.errorRate, 0);
  assert.deepEqual(result.roles, { user: 0, assistant: 0, tool: 0, system: 0 });
});

test("analyzeSession: includes token usage trends when includeTokenDetails is true", () => {
  const result = analyzeSession(simpleSession(), { includeTokenDetails: true });
  assert.ok(Array.isArray(result.tokenUsageTrends));
  assert.ok(result.tokenUsageTrends.length >= 3);
  // First trend item should include turn and tokens
  const first = result.tokenUsageTrends[0];
  assert.ok(first.turn >= 1);
  assert.ok(first.inputTokens > 0);
});

test("analyzeSession: handles null/undefined entries", () => {
  const result = analyzeSession(null);
  assert.equal(result.totalEntries, 0);
  assert.equal(result.turns, 0);
});

// ---------------------------------------------------------------------------
// analyzeSessions tests
// ---------------------------------------------------------------------------

test("analyzeSessions: aggregates stats across multiple sessions", () => {
  const sessions = [
    { id: "a", entries: simpleSession() },
    { id: "b", entries: sessionWithErrors() },
  ];

  const result = analyzeSessions(sessions);
  assert.equal(result.sessionCount, 2);
  assert.ok(result.totalEntries > 0);
  assert.equal(result.perSession.length, 2);

  // Should have aggregate role counts
  assert.ok(result.aggregateRoles.user >= 2);
  assert.ok(result.aggregateRoles.assistant >= 4);

  // Should have top tools
  assert.ok(result.topTools.length > 0);

  // Should have per-session stats
  assert.equal(result.perSession[0].id, "a");
  assert.equal(result.perSession[1].id, "b");
});

test("analyzeSessions: handles empty sessions list", () => {
  const result = analyzeSessions([]);
  assert.equal(result.sessionCount, 0);
  assert.equal(result.totalEntries, 0);
  assert.equal(result.avgEntriesPerSession, 0);
});

test("analyzeSessions: handles null input", () => {
  const result = analyzeSessions(null);
  assert.equal(result.sessionCount, 0);
  assert.equal(result.totalEntries, 0);
});

test("analyzeSessions: computes average entries and turns per session", () => {
  const sessions = [
    { id: "a", entries: simpleSession() }, // 6 entries, 1 turn
    { id: "b", entries: sessionWithErrors() }, // 8 entries, 1 turn
  ];
  const result = analyzeSessions(sessions);
  assert.equal(result.avgEntriesPerSession, 7);
  assert.equal(result.avgTurnsPerSession, 1);
});

// ---------------------------------------------------------------------------
// getUsageTrends tests
// ---------------------------------------------------------------------------

test("getUsageTrends: groups messages by day", () => {
  const entries = [
    userMsg("Day 1 msg", 0),
    assistantMsg("Day 1 reply", 1, { input_tokens: 100, output_tokens: 50 }),
    toolMsg("file.read", 2),
  ];

  // Add a next-day entry (offset 1440 minutes = 1 day)
  const nextDay = userMsg("Day 2 msg", 24 * 60);
  const nextDayAsst = assistantMsg("Day 2 reply", 24 * 60 + 1, { input_tokens: 200, output_tokens: 80 });

  const sessions = [{ id: "s1", entries: [...entries, nextDay, nextDayAsst] }];

  const trends = getUsageTrends(sessions, { groupBy: "day" });
  assert.equal(trends.messagesPerPeriod.length, 2);
  assert.ok(trends.toolsPerPeriod.length >= 1);
  assert.ok(Array.isArray(trends.tokensPerTurnOverTime));
});

test("getUsageTrends: groups by week", () => {
  const sessions = [{ id: "w1", entries: simpleSession() }];
  const trends = getUsageTrends(sessions, { groupBy: "week" });
  assert.ok(Array.isArray(trends.messagesPerPeriod));
  assert.ok(trends.messagesPerPeriod.length >= 1);
});

test("getUsageTrends: handles empty sessions", () => {
  const trends = getUsageTrends([]);
  assert.deepEqual(trends.messagesPerPeriod, []);
  assert.deepEqual(trends.toolsPerPeriod, []);
  assert.deepEqual(trends.tokensPerTurnOverTime, []);
  assert.equal(trends.totalTimeRange.first, null);
  assert.equal(trends.totalTimeRange.last, null);
});

test("getUsageTrends: handles null input", () => {
  const trends = getUsageTrends(null);
  assert.deepEqual(trends.messagesPerPeriod, []);
});

test("getUsageTrends: includes per-session tool counts", () => {
  const sessions = [
    { id: "a", entries: simpleSession() },
    { id: "b", entries: sessionWithErrors() },
  ];
  const trends = getUsageTrends(sessions);
  assert.equal(trends.toolsPerSession.length, 2);
  assert.ok(trends.toolsPerSession[0].toolCount >= 0);
  assert.ok(trends.toolsPerSession[1].toolCount >= 0);
});
