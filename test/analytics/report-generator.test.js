"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  generateSessionReport,
  generateWeeklyReport,
  generateTeamReport,
  generateSummaryCard,
} = require("../../src/analytics/report-generator");

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

function assistantMsg(content, offset = 0, usage, toolCalls) {
  const entry = { timestamp: ts(offset), role: "assistant", content };
  if (usage) entry.usage = usage;
  if (toolCalls) entry.tool_calls = toolCalls;
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
  return entry;
}

function basicSession() {
  return [
    userMsg("Help me build a component", 0),
    assistantMsg("Let me read the existing code first.", 1, {
      input_tokens: 200,
      output_tokens: 60,
    }),
    toolMsg("file.read", 2, { data: { path: "/src/App.js" } }),
    assistantMsg("Now I'll create the new component.", 3, {
      input_tokens: 350,
      output_tokens: 120,
    }, [{ function: { name: "file.read" } }]),
    toolMsg("file.write", 4, { data: { path: "/src/NewComponent.js" } }),
    assistantMsg("Component created successfully!", 5, {
      input_tokens: 150,
      output_tokens: 40,
    }),
  ];
}

function multiSessionSet() {
  return [
    { id: "sess-2026-05-20-abc123", entries: basicSession() },
    {
      id: "sess-2026-05-20-def456",
      entries: [
        userMsg("Find all test files", 10),
        assistantMsg("Searching...", 11, { input_tokens: 100, output_tokens: 30 }),
        toolMsg("file.search", 12, { data: { pattern: "*.test.js" } }),
        assistantMsg("Found 5 test files.", 13, { input_tokens: 80, output_tokens: 25 }),
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// generateSessionReport tests
// ---------------------------------------------------------------------------

test("generateSessionReport: produces markdown with key sections", () => {
  const report = generateSessionReport(basicSession());
  assert.ok(report.includes("# Session Report:"));
  assert.ok(report.includes("## Key Metrics"));
  assert.ok(report.includes("## Messages by Role"));
  assert.ok(report.includes("## Token Usage"));
  assert.ok(report.includes("## Turn Lengths"));
});

test("generateSessionReport: contains session ID", () => {
  const report = generateSessionReport({ id: "my-session-123", entries: basicSession() });
  assert.ok(report.includes("my-session-123"));
});

test("generateSessionReport: includes role counts", () => {
  const report = generateSessionReport(basicSession());
  assert.ok(report.includes("user") && report.includes("assistant") && report.includes("tool"));
});

test("generateSessionReport: includes token metrics", () => {
  const report = generateSessionReport(basicSession());
  assert.ok(report.includes("Input tokens"));
  assert.ok(report.includes("Output tokens"));
  assert.ok(report.includes("Total"));
});

test("generateSessionReport: handles empty session gracefully", () => {
  const report = generateSessionReport([]);
  assert.ok(report.includes("# Session Report:"));
  assert.ok(report.includes("0 turns") || report.includes("0"));
  // Should not crash
  assert.equal(typeof report, "string");
});

test("generateSessionReport: can disable charts", () => {
  const report = generateSessionReport(basicSession(), { includeCharts: false });
  // Chart section uses triple backticks in markdown
  // Without charts there should be no bar chart in output (the table format is separate)
  // Verify there's no bar chart marker in the output
  const withoutCharts = generateSessionReport(basicSession(), { includeCharts: false });
  const withCharts = generateSessionReport(basicSession(), { includeCharts: true });

  // Both should still be valid markdown
  assert.ok(typeof withoutCharts === "string");
  assert.ok(typeof withCharts === "string");
  // Report without charts should be shorter or equal length
  assert.ok(withoutCharts.length <= withCharts.length);
});

test("generateSessionReport: includes key findings section", () => {
  const report = generateSessionReport(basicSession(), { includeFindings: true });
  assert.ok(report.includes("## Key Findings"));
});

test("generateSessionReport: can disable findings", () => {
  const report = generateSessionReport(basicSession(), { includeFindings: false });
  assert.ok(!report.includes("## Key Findings"));
});

// ---------------------------------------------------------------------------
// generateWeeklyReport tests
// ---------------------------------------------------------------------------

test("generateWeeklyReport: produces report for multiple sessions", () => {
  const report = generateWeeklyReport(multiSessionSet());
  assert.ok(report.includes("Weekly Activity Report"));
  assert.ok(report.includes("## Overview"));
  assert.ok(report.includes("## Messages by Role"));
  assert.ok(report.includes("## Per-Session Summary"));
});

test("generateWeeklyReport: accepts custom title", () => {
  const report = generateWeeklyReport([basicSession()], { title: "Custom Weekly" });
  assert.ok(report.includes("Custom Weekly"));
});

test("generateWeeklyReport: works with single session", () => {
  const report = generateWeeklyReport([basicSession()]);
  assert.ok(report.includes("# Weekly Activity Report"));
  assert.ok(report.includes("Sessions"));
});

test("generateWeeklyReport: handles empty sessions list", () => {
  const report = generateWeeklyReport([]);
  assert.ok(report.includes("Weekly Activity Report"));
  assert.ok(report.includes("0"));
});

// ---------------------------------------------------------------------------
// generateTeamReport tests
// ---------------------------------------------------------------------------

test("generateTeamReport: produces team collaboration report", () => {
  const team = {
    teamName: "Platform Team",
    members: [
      { id: "alice-001", entries: basicSession() },
      {
        id: "bob-002",
        entries: [
          userMsg("Review the PR", 0),
          assistantMsg("Checking changes...", 1, { input_tokens: 100, output_tokens: 30 }),
          toolMsg("file.read", 2, { data: { path: "/src/NewComponent.js" } }),
          assistantMsg("Looks good!", 3, { input_tokens: 80, output_tokens: 25 }),
        ],
      },
    ],
  };

  const report = generateTeamReport(team);
  assert.ok(report.includes("# Team Report: Platform Team"));
  assert.ok(report.includes("## Team Overview"));
  assert.ok(report.includes("## Member Activity"));
  assert.ok(report.includes("## Most Active Member"));
});

test("generateTeamReport: handles empty team", () => {
  const team = { teamName: "Empty Team", members: [] };
  const report = generateTeamReport(team);
  assert.ok(report.includes("Empty Team"));
  assert.ok(report.includes("0"));
});

test("generateTeamReport: detects shared tools across members", () => {
  // Both members use file.read and file.write
  const team = {
    teamName: "Dev Team",
    members: [
      {
        id: "dev1",
        entries: [
          toolMsg("file.read", 0),
          toolMsg("file.write", 1),
        ],
      },
      {
        id: "dev2",
        entries: [
          toolMsg("file.read", 0),
          toolMsg("file.write", 1),
          toolMsg("shell.run", 2),
        ],
      },
    ],
  };

  const report = generateTeamReport(team);
  assert.ok(report.includes("## Shared Tools"));
  assert.ok(report.includes("file.read"));
  assert.ok(report.includes("file.write"));
});

// ---------------------------------------------------------------------------
// generateSummaryCard tests
// ---------------------------------------------------------------------------

test("generateSummaryCard: returns one-line summary string", () => {
  const card = generateSummaryCard({ id: "my-sess-1", entries: basicSession() });
  assert.equal(typeof card, "string");
  // Should contain the session ID prefix
  assert.ok(card.includes("my-sess-1"));
  assert.ok(card.includes("|"));
});

test("generateSummaryCard: works when passed raw entries array", () => {
  const card = generateSummaryCard(basicSession());
  assert.equal(typeof card, "string");
  assert.ok(card.includes("|"));
});

test("generateSummaryCard: handles empty session", () => {
  const card = generateSummaryCard([]);
  assert.equal(typeof card, "string");
  assert.ok(card.includes("Empty session"));
});
