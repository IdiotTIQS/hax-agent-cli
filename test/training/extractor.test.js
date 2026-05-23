/**
 * Tests for training data extractors.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  extractToolUseExamples,
  extractConversationTurns,
  extractAgentWorkflows,
  extractErrorRecoveryExamples,
  extractDecisionPoints,
} = require("../../src/training/extractor");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(id, entries) {
  return { id, entries: () => entries, updatedAt: new Date().toISOString() };
}

function makeEntry(role, overrides = {}) {
  return { role, timestamp: new Date().toISOString(), ...overrides };
}

// ---------------------------------------------------------------------------
// extractToolUseExamples
// ---------------------------------------------------------------------------

test("extractToolUseExamples: returns empty array for no sessions", () => {
  const result = extractToolUseExamples([]);
  assert.deepEqual(result, []);
});

test("extractToolUseExamples: extracts assistant->tool pair with explicit toolCalls", () => {
  const entries = [
    makeEntry("user", { content: "Read the config file." }),
    makeEntry("assistant", {
      content: "Let me read that.",
      toolCalls: [{ name: "file.read", args: { path: "/config.json" } }],
    }),
    makeEntry("tool", {
      name: "file.read",
      data: '{"debug":true}',
      isError: false,
    }),
  ];

  const result = extractToolUseExamples([makeSession("s1", entries)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "tool_use");
  assert.equal(result[0].sessionId, "s1");
  assert.equal(result[0].toolCall.name, "file.read");
  assert.deepEqual(result[0].toolCall.args, { path: "/config.json" });
});

test("extractToolUseExamples: extracts assistant->tool pair without explicit toolCalls", () => {
  const entries = [
    makeEntry("user", { content: "Search for TODO comments." }),
    makeEntry("assistant", { content: "Searching..." }),
    makeEntry("tool", {
      name: "file.search",
      args: { pattern: "TODO" },
      data: { matches: ["/src/a.js", "/src/b.js"] },
    }),
  ];

  const result = extractToolUseExamples([makeSession("s2", entries)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].toolCall.name, "file.search");
  assert.ok(result[0].toolResult);
  assert.equal(result[0].toolResult.isError, undefined);
});

test("extractToolUseExamples: handles multiple tool calls in one assistant message", () => {
  const entries = [
    makeEntry("user", { content: "Check both files." }),
    makeEntry("assistant", {
      content: "Reading both.",
      toolCalls: [
        { name: "file.read", args: { path: "/a.js" } },
        { name: "file.read", args: { path: "/b.js" } },
      ],
    }),
    makeEntry("tool", { name: "file.read", data: "content A" }),
    makeEntry("tool", { name: "file.read", data: "content B" }),
  ];

  const result = extractToolUseExamples([makeSession("s3", entries)]);
  // Should extract 2 examples: one per tool call
  assert.equal(result.length, 2);
  assert.equal(result[0].toolCall.args.path, "/a.js");
  assert.equal(result[1].toolCall.args.path, "/b.js");
});

test("extractToolUseExamples: skips assistant entries without following tool result", () => {
  const entries = [
    makeEntry("user", { content: "Hello." }),
    makeEntry("assistant", { content: "Hello! How can I help?" }),
    makeEntry("user", { content: "Thanks." }),
  ];

  const result = extractToolUseExamples([makeSession("s4", entries)]);
  assert.deepEqual(result, []);
});

test("extractToolUseExamples: handles tool entries with isError flag", () => {
  const entries = [
    makeEntry("user", { content: "Read missing file." }),
    makeEntry("assistant", {
      content: "Let me try.",
      toolCalls: [{ name: "file.read", args: { path: "/missing.txt" } }],
    }),
    makeEntry("tool", {
      name: "file.read",
      data: { error: "File not found" },
      isError: true,
    }),
  ];

  const result = extractToolUseExamples([makeSession("s5", entries)]);
  assert.equal(result.length, 1);
  assert.ok(result[0].toolResult.isError);
});

test("extractToolUseExamples: handles function-call style toolCalls", () => {
  const entries = [
    makeEntry("user", { content: "Run the build." }),
    makeEntry("assistant", {
      content: "Running build.",
      toolCalls: [
        {
          id: "call_001",
          function: { name: "shell", arguments: '{"command":"npm run build"}' },
        },
      ],
    }),
    makeEntry("tool", {
      name: "shell",
      data: "Build successful.",
    }),
  ];

  const result = extractToolUseExamples([makeSession("s6", entries)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].toolCall.name, "shell");
});

// ---------------------------------------------------------------------------
// extractConversationTurns
// ---------------------------------------------------------------------------

test("extractConversationTurns: extracts user/assistant turn pairs", () => {
  const entries = [
    makeEntry("user", { content: "How do I write a test?" }),
    makeEntry("assistant", { content: "Use a test framework like Jest or Mocha." }),
    makeEntry("user", { content: "Which is better?" }),
    makeEntry("assistant", { content: "Jest is more popular for React; Mocha is more flexible." }),
  ];

  const result = extractConversationTurns([makeSession("s7", entries)]);
  assert.equal(result.length, 2);
  assert.equal(result[0].type, "conversation_turn");
  assert.equal(result[0].turnIndex, 1);
  assert.equal(result[0].userMessage, "How do I write a test?");
  assert.equal(result[0].assistantMessages.length, 1);
  assert.equal(result[1].turnIndex, 2);
  assert.equal(result[1].userMessage, "Which is better?");
});

test("extractConversationTurns: includes tool calls between user and assistant", () => {
  const entries = [
    makeEntry("user", { content: "What's in config.json?" }),
    makeEntry("assistant", { content: "Let me read it.", toolCalls: [{ name: "file.read", args: { path: "/config.json" } }] }),
    makeEntry("tool", { name: "file.read", data: '{"port":3000}' }),
    makeEntry("assistant", { content: "The config sets port to 3000." }),
  ];

  const result = extractConversationTurns([makeSession("s8", entries)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].toolCalls.length, 1);
  assert.equal(result[0].toolCalls[0].name, "file.read");
  assert.equal(result[0].assistantMessages.length, 2);
});

test("extractConversationTurns: skips user messages without content", () => {
  const entries = [
    makeEntry("user", { content: "" }),
    makeEntry("assistant", { content: "I didn't catch that." }),
    makeEntry("user", { content: "Hello." }),
    makeEntry("assistant", { content: "Hi there!" }),
  ];

  const result = extractConversationTurns([makeSession("s9", entries)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].userMessage, "Hello.");
});

// ---------------------------------------------------------------------------
// extractAgentWorkflows
// ---------------------------------------------------------------------------

test("extractAgentWorkflows: extracts multi-step workflows (2+ tool calls)", () => {
  const entries = [
    makeEntry("user", { content: "Find and fix all lint errors in src/" }),
    makeEntry("assistant", { content: "Let me search for lint issues." }),
    makeEntry("tool", { name: "shell", args: { command: "npm run lint" }, data: "3 errors found" }),
    makeEntry("assistant", { content: "Found 3 errors. Let me fix the first one." }),
    makeEntry("tool", { name: "file.edit", args: { path: "/src/a.js" }, data: { success: true } }),
    makeEntry("tool", { name: "file.edit", args: { path: "/src/b.js" }, data: { success: true } }),
    makeEntry("tool", { name: "file.edit", args: { path: "/src/c.js" }, data: { success: true } }),
    makeEntry("assistant", { content: "All lint errors fixed." }),
  ];

  const result = extractAgentWorkflows([makeSession("s10", entries)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "agent_workflow");
  assert.equal(result[0].goal, "Find and fix all lint errors in src/");
  assert.equal(result[0].steps.length, 4);
  assert.equal(result[0].stepCount, 4);
  assert.ok(result[0].finalResponse);
});

test("extractAgentWorkflows: skips single-tool-call turns", () => {
  const entries = [
    makeEntry("user", { content: "Read config." }),
    makeEntry("assistant", { content: "Reading." }),
    makeEntry("tool", { name: "file.read", data: "content" }),
    makeEntry("assistant", { content: "Here's the content." }),
  ];

  const result = extractAgentWorkflows([makeSession("s10b", entries)]);
  // Only 1 tool call, not multi-step — should be empty
  assert.equal(result.length, 0);
});

test("extractAgentWorkflows: marks errored steps", () => {
  const entries = [
    makeEntry("user", { content: "Deploy the app." }),
    makeEntry("tool", { name: "shell", args: { command: "npm run build" }, data: "Build output" }),
    makeEntry("tool", { name: "shell", args: { command: "npm run deploy" }, data: { error: "Deploy failed" }, isError: true }),
    makeEntry("tool", { name: "shell", args: { command: "npm run deploy -- --force" }, data: "Deployed" }),
  ];

  const result = extractAgentWorkflows([makeSession("s11", entries)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].steps.length, 3);
  assert.equal(result[0].steps[1].isError, true);
  assert.equal(result[0].steps[2].isError, false);
});

// ---------------------------------------------------------------------------
// extractErrorRecoveryExamples
// ---------------------------------------------------------------------------

test("extractErrorRecoveryExamples: finds error -> retry -> success patterns", () => {
  const entries = [
    makeEntry("user", { content: "Read the log file." }),
    makeEntry("tool", {
      name: "file.read",
      args: { path: "/logs/error.log" },
      data: { error: "ENOENT: no such file" },
      isError: true,
    }),
    makeEntry("tool", {
      name: "file.glob",
      args: { pattern: "**/*.log" },
      data: ["/var/logs/error.log"],
      isError: false,
    }),
  ];

  const result = extractErrorRecoveryExamples([makeSession("s12", entries)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "error_recovery");
  assert.equal(result[0].errorToolCall.name, "file.read");
  assert.ok(result[0].errorResult.isError);
  assert.equal(result[0].recoveryToolCall.name, "file.glob");
  assert.equal(result[0].recoveryStrategy, "retry_alternative_tool");
});

test("extractErrorRecoveryExamples: detects same-tool retry with different args", () => {
  const entries = [
    makeEntry("user", { content: "Fetch data from API." }),
    makeEntry("tool", {
      name: "web.fetch",
      args: { url: "https://api.example.com" },
      data: { error: "429: Too many requests" },
      isError: true,
    }),
    makeEntry("tool", {
      name: "web.fetch",
      args: { url: "https://api.example.com", retryAfter: 5000 },
      data: { status: 200, data: "success" },
      isError: false,
    }),
  ];

  const result = extractErrorRecoveryExamples([makeSession("s13", entries)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].recoveryStrategy, "retry_same_tool");
  assert.equal(result[0].recoveryToolCall.name, "web.fetch");
});

test("extractErrorRecoveryExamples: handles data.error as error indicator", () => {
  const entries = [
    makeEntry("tool", {
      name: "file.write",
      data: { error: "Permission denied" },
      isError: undefined,
    }),
    makeEntry("tool", {
      name: "file.write",
      args: { path: "/tmp/output.txt" },
      data: "written",
      isError: false,
    }),
  ];

  const result = extractErrorRecoveryExamples([makeSession("s14", entries)]);
  assert.equal(result.length, 1);
});

// ---------------------------------------------------------------------------
// extractDecisionPoints
// ---------------------------------------------------------------------------

test("extractDecisionPoints: detects multiple parallel tool calls", () => {
  const entries = [
    makeEntry("user", { content: "Investigate the performance issue." }),
    makeEntry("assistant", {
      content: "I'll check several things at once.",
      toolCalls: [
        { name: "shell", args: { command: "top -n 1" } },
        { name: "file.read", args: { path: "/logs/performance.log" } },
        { name: "shell", args: { command: "npm run build -- --profile" } },
      ],
    }),
  ];

  const result = extractDecisionPoints([makeSession("s15", entries)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "decision_point");
  assert.equal(result[0].subtype, "parallel_tool_choice");
  assert.equal(result[0].options.length, 3);
  assert.equal(result[0].chosenAction, "all_parallel");
});

test("extractDecisionPoints: detects deliberation text patterns", () => {
  const entries = [
    makeEntry("user", { content: "The build is slow." }),
    makeEntry("assistant", {
      content: "There are two approaches: 1) Add caching to webpack, or 2) split the code into chunks. I could either start with caching since it's less invasive.",
    }),
    makeEntry("tool", { name: "file.edit", args: { path: "/webpack.config.js" } }),
  ];

  const result = extractDecisionPoints([makeSession("s16", entries)]);
  // Should detect deliberation pattern and find next action
  const deliberation = result.filter((r) => r.subtype === "deliberation");
  assert.ok(deliberation.length >= 1);
  assert.ok(deliberation[0].reasoning.includes("two approaches"));
});

test("extractDecisionPoints: detects result-evaluation decisions", () => {
  const entries = [
    makeEntry("user", { content: "Fix the failing test." }),
    makeEntry("tool", { name: "shell", args: { command: "npm test" }, data: "2 failed, 8 passed" }),
    makeEntry("assistant", {
      content: "Two tests failed. The first one is a timeout issue, the second is an assertion error. Let me fix the timeout first since it's likely a configuration problem.",
    }),
    makeEntry("tool", { name: "file.edit", args: { path: "/jest.config.js", oldString: "5000", newString: "15000" } }),
  ];

  const result = extractDecisionPoints([makeSession("s17", entries)]);
  const evaluation = result.filter((r) => r.subtype === "result_evaluation");
  assert.ok(evaluation.length >= 1);
  assert.ok(evaluation[0].reasoning.includes("timeout"));
  assert.ok(evaluation[0].priorResult);
});

// ---------------------------------------------------------------------------
// Additional edge case tests
// ---------------------------------------------------------------------------

test("extractor: handles entries with no role field gracefully", () => {
  const entries = [
    { content: "orphan entry" },
    makeEntry("user", { content: "Valid message." }),
    makeEntry("assistant", { content: "Valid response." }),
  ];

  // Should not throw
  assert.doesNotThrow(() => {
    extractToolUseExamples([makeSession("s18", entries)]);
    extractConversationTurns([makeSession("s18", entries)]);
    extractAgentWorkflows([makeSession("s18", entries)]);
    extractErrorRecoveryExamples([makeSession("s18", entries)]);
    extractDecisionPoints([makeSession("s18", entries)]);
  });
});

test("extractor: handles entries passed as plain array (not lazy function)", () => {
  const session = {
    id: "plain",
    entries: [
      makeEntry("user", { content: "Hello." }),
      makeEntry("assistant", {
        content: "Hi!",
        toolCalls: [{ name: "file.read", args: { path: "/test.txt" } }],
      }),
      makeEntry("tool", { name: "file.read", data: "content" }),
    ],
    updatedAt: new Date().toISOString(),
  };

  const result = extractToolUseExamples([session]);
  assert.equal(result.length, 1);
  assert.equal(result[0].toolCall.name, "file.read");
});

test("extractor: handles large context window correctly", () => {
  const entries = [];
  // Create a long conversation to test context window trimming
  for (let i = 0; i < 50; i++) {
    entries.push(makeEntry("user", { content: `Question ${i}` }));
    entries.push(makeEntry("assistant", { content: `Answer ${i}` }));
  }
  entries.push(makeEntry("assistant", {
    content: "Let me search.",
    toolCalls: [{ name: "file.search", args: { pattern: "test" } }],
  }));
  entries.push(makeEntry("tool", { name: "file.search", data: [] }));

  const result = extractToolUseExamples([makeSession("s19", entries)]);
  assert.equal(result.length, 1);
  // Context should be trimmed (max 10 by default)
  assert.ok(result[0].context.length <= 20);
});
