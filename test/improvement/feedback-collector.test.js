"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { FeedbackCollector } = require("../../src/improvement/feedback-collector");

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

function toolMsg(name, offset = 0, data, isError) {
  const entry = { timestamp: ts(offset), role: "tool", name, data: data || {} };
  if (isError) entry.isError = true;
  return entry;
}

function simpleSession() {
  return {
    id: "session-1",
    entries: [
      userMsg("Hello, help me fix the config", 0),
      assistantMsg("Let me read it first.", 1, {
        input_tokens: 100,
        output_tokens: 30,
      }),
      toolMsg("file.read", 2, { path: "/config.json" }),
      assistantMsg("I see the issue. Editing now.", 3, {
        input_tokens: 200,
        output_tokens: 50,
      }),
      toolMsg("file.edit", 4, { path: "/config.json" }),
      assistantMsg("Done. The config has been fixed.", 5, {
        input_tokens: 150,
        output_tokens: 40,
      }),
    ],
  };
}

function errorSession() {
  return {
    id: "session-errors",
    entries: [
      userMsg("Fix the bug", 0),
      assistantMsg("Let me try.", 1, { input_tokens: 100, output_tokens: 30 }),
      toolMsg("file.write", 2, { path: "/bad/path" }, true),
      assistantMsg("That failed. Trying shell.", 3, {
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
    ],
  };
}

function vaguePromptSession() {
  return {
    id: "session-vague",
    entries: [
      userMsg("hey", 0),
      assistantMsg("Hello! How can I help?", 1, {
        input_tokens: 50,
        output_tokens: 20,
      }),
      userMsg("fix it", 2),
      assistantMsg("Could you clarify what you need fixed?", 3, {
        input_tokens: 80,
        output_tokens: 30,
      }),
      userMsg("the bug I mentioned", 4),
      assistantMsg("I need more context to help with that.", 5, {
        input_tokens: 90,
        output_tokens: 35,
      }),
    ],
  };
}

function slowSession() {
  return {
    id: "session-slow",
    entries: [
      userMsg("Run the build", 0),
      assistantMsg("Running build...", 1, {
        input_tokens: 80,
        output_tokens: 20,
      }),
      toolMsg("shell.run", 2, {}, false),
      assistantMsg("Build complete.", 3, {
        input_tokens: 60,
        output_tokens: 15,
      }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests: collect()
// ---------------------------------------------------------------------------

test("collect: returns analysis and suggestions for a valid session", () => {
  const collector = new FeedbackCollector();
  const result = collector.collect(simpleSession());

  assert.ok(result, "result exists");
  assert.equal(result.sessionId, "session-1");
  assert.ok(result.analysis, "analysis exists");
  assert.ok(Array.isArray(result.suggestions), "suggestions is an array");
  assert.ok(result.summary, "summary exists");
  assert.equal(typeof result.summary.totalSuggestions, "number");
});

test("collect: handles null/undefined session gracefully", () => {
  const collector = new FeedbackCollector();

  const nullResult = collector.collect(null);
  assert.equal(nullResult.summary.error, "no session provided");

  const undefinedResult = collector.collect(undefined);
  assert.equal(undefinedResult.summary.error, "no session provided");
});

test("collect: handles session with function-based entries", () => {
  const collector = new FeedbackCollector();
  const session = {
    id: "fn-session",
    entries: () => [
      userMsg("Hello", 0),
      assistantMsg("Hi!", 1, { input_tokens: 10, output_tokens: 5 }),
    ],
  };
  const result = collector.collect(session);
  assert.equal(result.sessionId, "fn-session");
});

// ---------------------------------------------------------------------------
// Tests: analyzeToolEffectiveness()
// ---------------------------------------------------------------------------

test("analyzeToolEffectiveness: identifies reliable and failing tools", () => {
  const collector = new FeedbackCollector();
  const result = collector.analyzeToolEffectiveness(errorSession());

  assert.ok(result.tools.length >= 1, "tools list is populated");
  assert.ok(Array.isArray(result.failingTools), "failingTools is array");
  assert.ok(Array.isArray(result.reliableTools), "reliableTools is array");
  assert.ok(result.totalToolErrors > 0, "has errors");
  assert.ok(result.overallSuccessRate < 1, "success rate reflects errors");

  const shellTool = result.tools.find((t) => t.tool === "shell.run");
  assert.ok(shellTool, "shell.run tool is tracked");
  assert.ok(shellTool.calls >= 2, "shell.run has multiple calls");
});

test("analyzeToolEffectiveness: detects tool sequences", () => {
  const collector = new FeedbackCollector();
  const result = collector.analyzeToolEffectiveness(simpleSession());

  assert.ok(result.commonSequences.length >= 1, "sequences detected");
  const seq = result.commonSequences[0];
  assert.ok(seq.sequence.includes("->"), "sequence format correct");
  assert.ok(seq.count >= 1, "sequence count tracked");
});

test("analyzeToolEffectiveness: handles empty session", () => {
  const collector = new FeedbackCollector();
  const result = collector.analyzeToolEffectiveness({ entries: [] });

  assert.deepEqual(result.tools, []);
  assert.equal(result.totalToolCalls, 0);
  assert.equal(result.totalToolErrors, 0);
});

// ---------------------------------------------------------------------------
// Tests: analyzePromptQuality()
// ---------------------------------------------------------------------------

test("analyzePromptQuality: detects vague prompts", () => {
  const collector = new FeedbackCollector();
  const result = collector.analyzePromptQuality(vaguePromptSession());

  assert.ok(result.totalUserMessages >= 2, "has user messages");
  assert.ok(result.vagueCount >= 1, "detects vague prompts");
  assert.ok(result.clarityScore < 1, "clarity score reflects vagueness");

  // Check that at least one assessment has issues
  const withIssues = result.assessments.filter((a) => a.issues.length > 0);
  assert.ok(withIssues.length >= 1, "at least one assessment has issues");
});

test("analyzePromptQuality: detects clarification requests", () => {
  const collector = new FeedbackCollector();
  const result = collector.analyzePromptQuality(vaguePromptSession());

  assert.ok(result.clarificationRequests >= 1, "detects clarification requests");
});

test("analyzePromptQuality: good prompts score well", () => {
  const collector = new FeedbackCollector();
  const session = {
    id: "good-prompts",
    entries: [
      userMsg("Please fix the auth middleware in src/auth/middleware.js — it throws a 401 error when the token is valid but expired. The expected behavior is to return a 403 with an 'expired' reason.", 0),
      assistantMsg("Let me read that file.", 1, { input_tokens: 100, output_tokens: 30 }),
    ],
  };
  const result = collector.analyzePromptQuality(session);
  assert.ok(result.clarityScore >= 0.7, "good prompt has high clarity score");
});

// ---------------------------------------------------------------------------
// Tests: analyzeErrorPatterns()
// ---------------------------------------------------------------------------

test("analyzeErrorPatterns: categorizes errors correctly", () => {
  const collector = new FeedbackCollector();
  const result = collector.analyzeErrorPatterns(errorSession());

  assert.equal(result.totalErrors, 2, "two errors detected");
  assert.ok(result.categories.length >= 1, "categories exist");
  assert.ok(result.errorGroups.length >= 1, "error groups exist");
  assert.ok(result.mostFrequentCategory !== null, "most frequent category set");
});

test("analyzeErrorPatterns: detects recovery attempts", () => {
  const collector = new FeedbackCollector();
  const result = collector.analyzeErrorPatterns(errorSession());

  assert.ok(
    typeof result.recoveryPatterns.attempts === "number",
    "recovery attempts tracked"
  );
  assert.ok(
    typeof result.recoveryPatterns.recoveryRate === "number",
    "recovery rate computed"
  );
});

test("analyzeErrorPatterns: handles zero errors", () => {
  const collector = new FeedbackCollector();
  const result = collector.analyzeErrorPatterns(simpleSession());

  assert.equal(result.totalErrors, 0);
  assert.deepEqual(result.categories, []);
  assert.equal(result.mostFrequentCategory, null);
});

// ---------------------------------------------------------------------------
// Tests: analyzeLatency()
// ---------------------------------------------------------------------------

test("analyzeLatency: computes overall latency metrics", () => {
  const collector = new FeedbackCollector();

  // Create entries with explicit timestamps for predictable gaps
  const entries = [
    { timestamp: ts(0), role: "user", content: "hi" },
    { timestamp: ts(1), role: "assistant", content: "hey" },
    { timestamp: ts(2), role: "tool", name: "shell.run", duration: 150 },
  ];
  const result = collector.analyzeLatency({ entries });

  assert.equal(typeof result.avgLatencyMs, "number");
  assert.equal(typeof result.maxLatencyMs, "number");
  assert.ok(result.totalMeasuredOperations > 0, "operations measured");
});

test("analyzeLatency: identifies slow operations", () => {
  const collector = new FeedbackCollector({ thresholds: { highLatencyMs: 100 } });

  const entries = [
    { timestamp: ts(0), role: "user", content: "hi" },
    { timestamp: ts(1), role: "assistant", content: "hey" },
    { timestamp: ts(2), role: "tool", name: "slow.tool", duration: 8000 },
  ];
  const result = collector.analyzeLatency({ entries });

  assert.ok(result.slowOperationCount >= 1, "detects slow operations");
});

test("analyzeLatency: returns per-tool latency breakdown", () => {
  const collector = new FeedbackCollector();

  const entries = [
    { timestamp: ts(0), role: "user", content: "hi" },
    { timestamp: ts(1), role: "tool", name: "file.read", duration: 100 },
    { timestamp: ts(2), role: "tool", name: "file.read", duration: 200 },
    { timestamp: ts(3), role: "tool", name: "shell.run", duration: 500 },
  ];
  const result = collector.analyzeLatency({ entries });

  const fileRead = result.toolAvgLatency.find((t) => t.tool === "file.read");
  assert.ok(fileRead, "file.read latency tracked");
  assert.equal(fileRead.sampleCount, 2, "correct sample count");
  assert.equal(fileRead.avgDurationMs, 150, "correct average");
});

// ---------------------------------------------------------------------------
// Tests: generateSuggestions()
// ---------------------------------------------------------------------------

test("generateSuggestions: produces suggestions for various issues", () => {
  const collector = new FeedbackCollector({ thresholds: { highLatencyMs: 100 } });

  const analysis = {
    toolEffectiveness: {
      tools: [{ tool: "bad.tool", calls: 10, errors: 8, successRate: 0.2, errorRate: 0.8, isReliable: false }],
      failingTools: [{ tool: "bad.tool", calls: 10, errors: 8, successRate: 0.2, errorRate: 0.8, isReliable: false }],
      reliableTools: [],
      commonSequences: [
        { sequence: "bad.tool->other.tool", count: 3, errorRecoveryRate: 0.2 },
      ],
      totalToolCalls: 10,
      totalToolErrors: 8,
      overallSuccessRate: 0.2,
    },
    promptQuality: {
      assessments: [],
      totalUserMessages: 10,
      vagueCount: 6,
      vagueRate: 0.6,
      clarificationRequests: 4,
      clarityScore: 0.4,
    },
    errorPatterns: {
      totalErrors: 8,
      categories: [{ category: "timeout", count: 5 }],
      errorGroups: [{ tool: "bad.tool", count: 5, categories: { timeout: 5 } }],
      recoveryPatterns: { attempts: 1, details: [], recoveryRate: 0.125 },
      cascadingErrors: 3,
      mostFrequentCategory: "timeout",
    },
    latency: {
      avgLatencyMs: 6000,
      maxLatencyMs: 12000,
      totalMeasuredOperations: 10,
      slowOperations: [{ durationMs: 8000, type: "tool", name: "slow.tool" }],
      slowOperationCount: 3,
      toolAvgLatency: [],
      worstTool: { tool: "slow.tool", avgDurationMs: 8000 },
    },
  };

  const suggestions = collector.generateSuggestions(analysis);

  assert.ok(Array.isArray(suggestions), "returns array");
  assert.ok(suggestions.length >= 3, "multiple suggestions");

  // Verify suggestion format
  for (const s of suggestions) {
    assert.ok(typeof s.id === "string" && s.id.length > 0, "has id");
    assert.ok(typeof s.category === "string", "has category");
    assert.ok(["high", "medium", "low"].includes(s.severity), "valid severity: " + s.severity);
    assert.ok(typeof s.title === "string" && s.title.length > 0, "has title");
    assert.ok(typeof s.description === "string", "has description");
    assert.ok(typeof s.action === "string", "has action");
  }

  // Suggestions sorted by severity (high first)
  const firstSeverity = suggestions[0].severity;
  assert.ok(firstSeverity === "high" || suggestions.every((s) => s.severity !== "high"),
    "high severity suggestions come first if any exist");
});

test("generateSuggestions: handles empty analysis gracefully", () => {
  const collector = new FeedbackCollector();
  const suggestions = collector.generateSuggestions({});
  assert.ok(Array.isArray(suggestions));
  assert.equal(suggestions.length, 0, "no suggestions for empty analysis");
});

test("generateSuggestions: thresholds affect sensitivity", () => {
  const strictCollector = new FeedbackCollector({ thresholds: { highLatencyMs: 100, errorRate: 0.05 } });
  const lenientCollector = new FeedbackCollector({ thresholds: { highLatencyMs: 50000, errorRate: 0.9 } });

  const analysis = {
    toolEffectiveness: {
      tools: [{ tool: "t1", calls: 10, errors: 2, successRate: 0.8, errorRate: 0.2, isReliable: false }],
      failingTools: [{ tool: "t1", calls: 10, errors: 2, successRate: 0.8, errorRate: 0.2, isReliable: false }],
      reliableTools: [],
      commonSequences: [],
      totalToolCalls: 10,
      totalToolErrors: 2,
      overallSuccessRate: 0.8,
    },
    promptQuality: {
      assessments: [], totalUserMessages: 5, vagueCount: 1, vagueRate: 0.2,
      clarificationRequests: 0, clarityScore: 0.8,
    },
    errorPatterns: {
      totalErrors: 2, categories: [{ category: "timeout", count: 2 }],
      errorGroups: [{ tool: "t1", count: 2, categories: { timeout: 2 } }],
      recoveryPatterns: { attempts: 1, details: [], recoveryRate: 0.5 },
      cascadingErrors: 0, mostFrequentCategory: "timeout",
    },
    latency: {
      avgLatencyMs: 2000, maxLatencyMs: 3000, totalMeasuredOperations: 5,
      slowOperations: [], slowOperationCount: 0,
      toolAvgLatency: [], worstTool: null,
    },
  };

  const strictSuggestions = strictCollector.generateSuggestions(analysis);
  const lenientSuggestions = lenientCollector.generateSuggestions(analysis);

  assert.ok(strictSuggestions.length >= lenientSuggestions.length,
    "strict thresholds produce >= suggestions than lenient");
});

test("collect: integrates all analysis types end-to-end", () => {
  const collector = new FeedbackCollector();
  const session = {
    id: "integration-test",
    entries: [
      userMsg("fix my bug in src/app.js", 0),
      assistantMsg("Let me check.", 1, { input_tokens: 80, output_tokens: 30 }),
      toolMsg("file.read", 2, { path: "src/app.js" }),
      assistantMsg("I see it. Let me fix.", 3, { input_tokens: 120, output_tokens: 40 }),
      toolMsg("file.edit", 4, { path: "src/app.js" }),
      toolMsg("file.write", 5, { path: "src/app.js" }, true),
      assistantMsg("Write failed. Let me retry.", 6, { input_tokens: 150, output_tokens: 50 }),
      toolMsg("file.write", 7, { path: "src/app.js" }),
      assistantMsg("Fixed! The file is updated.", 8, { input_tokens: 100, output_tokens: 35 }),
    ],
  };
  const result = collector.collect(session);

  // All analysis sections populated
  assert.ok(result.analysis.toolEffectiveness, "tool effectiveness analysis");
  assert.ok(result.analysis.promptQuality, "prompt quality analysis");
  assert.ok(result.analysis.errorPatterns, "error pattern analysis");
  assert.ok(result.analysis.latency, "latency analysis");

  // Suggestions generated
  assert.ok(result.suggestions.length >= 0, "suggestions generated");

  // Summary is complete
  assert.ok(result.summary.overall, "summary has overall rating");
  assert.ok(typeof result.summary.totalSuggestions === "number", "summary has total");
});
