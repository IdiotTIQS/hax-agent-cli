/**
 * Tests for training data formatters.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  toOpenAIChatFormat,
  toAnthropicMessagesFormat,
  toCompletionFormat,
  toJsonl,
  splitTrainValTest,
  validateExamples,
} = require("../../src/training/formatter");

// ---------------------------------------------------------------------------
// Sample examples
// ---------------------------------------------------------------------------

const sampleConversationTurn = {
  type: "conversation_turn",
  sessionId: "s1",
  turnIndex: 1,
  userMessage: "How do I write a test?",
  assistantMessages: [
    {
      role: "assistant",
      content: "Use a test framework like Jest or Mocha. Here's an example:\n\n```js\ntest('adds 1 + 2', () => {\n  expect(1 + 2).toBe(3);\n});\n```",
    },
  ],
  toolCalls: [],
  timestamp: "2024-01-15T10:00:00Z",
};

const sampleToolUse = {
  type: "tool_use",
  sessionId: "s2",
  context: [
    { role: "user", content: "Read the config file." },
  ],
  assistantMessage: { role: "assistant", content: "Let me read that for you." },
  toolCall: { name: "file.read", args: { path: "/config/settings.json" } },
  toolResult: { role: "tool", name: "file.read", data: '{"debug":true,"port":3000}', isError: false },
  timestamp: "2024-01-15T10:01:00Z",
};

const sampleAgentWorkflow = {
  type: "agent_workflow",
  sessionId: "s3",
  goal: "Add validation to the register endpoint.",
  steps: [
    { toolName: "file.search", toolArgs: { pattern: "register" }, result: { matches: ["/src/auth.js"] }, isError: false },
    { toolName: "file.read", toolArgs: { path: "/src/auth.js" }, result: "function register() {}", isError: false },
    { toolName: "file.edit", toolArgs: { path: "/src/auth.js", oldString: "register() {}", newString: "register() { validate(); }" }, result: { success: true }, isError: false },
  ],
  finalResponse: { role: "assistant", content: "Validation added." },
  stepCount: 3,
};

const sampleErrorRecovery = {
  type: "error_recovery",
  sessionId: "s4",
  errorToolCall: { name: "file.read", args: { path: "/missing.txt" } },
  errorResult: { data: { error: "ENOENT: no such file" }, isError: true },
  recoveryToolCall: { name: "file.glob", args: { pattern: "**/*.txt" } },
  recoveryResult: { data: ["/actual.txt"], isError: false },
  recoveryStrategy: "retry_alternative_tool",
  context: [{ role: "user", content: "Find and read text files." }],
};

const sampleDecisionPoint = {
  type: "decision_point",
  subtype: "deliberation",
  sessionId: "s5",
  context: [{ role: "user", content: "The build is slow." }],
  reasoning: "I could either add caching or split the bundle. I'll start with caching.",
  options: ["Add caching", "Split bundle"],
  chosenAction: { toolName: "file.edit", args: { path: "/webpack.config.js" } },
};

// ---------------------------------------------------------------------------
// toOpenAIChatFormat
// ---------------------------------------------------------------------------

test("toOpenAIChatFormat: formats conversation_turn with messages array", () => {
  const result = toOpenAIChatFormat([sampleConversationTurn]);
  assert.equal(result.length, 1);
  assert.ok(Array.isArray(result[0].messages));
  assert.ok(result[0].messages.length >= 2);

  const userMsg = result[0].messages.find((m) => m.role === "user");
  assert.ok(userMsg);
  assert.equal(userMsg.content, "How do I write a test?");

  const asstMsg = result[0].messages.find((m) => m.role === "assistant");
  assert.ok(asstMsg);
  assert.ok(asstMsg.content.includes("Jest"));
});

test("toOpenAIChatFormat: formats tool_use with tool_calls structure", () => {
  const result = toOpenAIChatFormat([sampleToolUse]);
  assert.equal(result.length, 1);

  const asstMsg = result[0].messages.find((m) => m.role === "assistant" && m.tool_calls);
  assert.ok(asstMsg);
  assert.equal(asstMsg.tool_calls.length, 1);
  assert.equal(asstMsg.tool_calls[0].type, "function");
  assert.equal(asstMsg.tool_calls[0].function.name, "file.read");

  const toolMsg = result[0].messages.find((m) => m.role === "tool");
  assert.ok(toolMsg);
  assert.ok(toolMsg.content.includes("debug"));
});

test("toOpenAIChatFormat: formats agent_workflow with step-by-step messages", () => {
  const result = toOpenAIChatFormat([sampleAgentWorkflow]);
  assert.equal(result.length, 1);
  assert.ok(result[0].messages.length >= 7);

  const userMsg = result[0].messages.find((m) => m.role === "user");
  assert.equal(userMsg.content, sampleAgentWorkflow.goal);

  // Should have 3 pairs of assistant (tool_use) + tool messages
  const toolCallMsgs = result[0].messages.filter((m) => m.role === "assistant" && m.tool_calls);
  assert.equal(toolCallMsgs.length, 3);
});

test("toOpenAIChatFormat: formats error_recovery with error and retry", () => {
  const result = toOpenAIChatFormat([sampleErrorRecovery]);
  assert.equal(result.length, 1);

  const toolMsgs = result[0].messages.filter((m) => m.role === "tool");
  assert.ok(toolMsgs.length >= 2);

  // First tool message should contain error info
  const errorToolMsg = toolMsgs[0];
  assert.ok(errorToolMsg.content.includes("error") || errorToolMsg.content.includes("ENOENT"));
});

test("toOpenAIChatFormat: formats decision_point", () => {
  const result = toOpenAIChatFormat([sampleDecisionPoint]);
  assert.equal(result.length, 1);
  const asstMsg = result[0].messages.find((m) => m.role === "assistant");
  assert.ok(asstMsg);
  assert.ok(asstMsg.content.includes("caching"));
});

test("toOpenAIChatFormat: returns empty array for empty input", () => {
  const result = toOpenAIChatFormat([]);
  assert.deepEqual(result, []);
});

// ---------------------------------------------------------------------------
// toAnthropicMessagesFormat
// ---------------------------------------------------------------------------

test("toAnthropicMessagesFormat: produces content arrays with type fields", () => {
  const result = toAnthropicMessagesFormat([sampleToolUse]);
  assert.equal(result.length, 1);

  const asstMsg = result[0].messages.find((m) => m.role === "assistant");
  assert.ok(asstMsg);
  assert.ok(Array.isArray(asstMsg.content));

  const toolUse = asstMsg.content.find((c) => c.type === "tool_use");
  assert.ok(toolUse);
  assert.equal(toolUse.name, "file.read");
});

test("toAnthropicMessagesFormat: includes tool_result blocks", () => {
  const result = toAnthropicMessagesFormat([sampleToolUse]);
  const userMsg = result[0].messages.filter((m) => m.role === "user");

  // One of the user messages should contain tool_result
  const hasToolResult = userMsg.some((m) =>
    Array.isArray(m.content) && m.content.some((c) => c.type === "tool_result")
  );
  assert.ok(hasToolResult);
});

// ---------------------------------------------------------------------------
// toCompletionFormat
// ---------------------------------------------------------------------------

test("toCompletionFormat: produces prompt/completion pairs", () => {
  const result = toCompletionFormat([sampleConversationTurn]);
  assert.equal(result.length, 1);
  assert.ok(typeof result[0].prompt === "string");
  assert.ok(typeof result[0].completion === "string");
  assert.ok(result[0].prompt.includes("How do I write a test?"));
  assert.ok(result[0].completion.includes("Jest"));
});

test("toCompletionFormat: agent_workflow includes step markers", () => {
  const result = toCompletionFormat([sampleAgentWorkflow]);
  assert.equal(result.length, 1);
  assert.ok(result[0].prompt.includes(sampleAgentWorkflow.goal));
  assert.ok(result[0].completion.includes("Step 1"));
});

test("toCompletionFormat: error_recovery shows error and retry", () => {
  const result = toCompletionFormat([sampleErrorRecovery]);
  assert.equal(result.length, 1);
  assert.ok(result[0].prompt.includes("ENOENT"));
  assert.ok(result[0].completion.includes("Retrying"));
});

// ---------------------------------------------------------------------------
// toJsonl
// ---------------------------------------------------------------------------

test("toJsonl: produces newline-delimited JSON", () => {
  const examples = [sampleConversationTurn, sampleToolUse];
  const result = toJsonl(examples);

  const lines = result.trim().split("\n");
  assert.equal(lines.length, 2);

  // Each line should be valid JSON
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line));
  }
});

test("toJsonl: handles single example", () => {
  const result = toJsonl([sampleConversationTurn]);
  const lines = result.trim().split("\n");
  assert.equal(lines.length, 1);
});

test("toJsonl: handles empty array", () => {
  const result = toJsonl([]);
  assert.equal(result, "");
});

test("toJsonl: pretty option produces indented JSON", () => {
  const result = toJsonl([sampleConversationTurn], { pretty: true });
  assert.ok(result.includes("\n  "));
});

// ---------------------------------------------------------------------------
// splitTrainValTest
// ---------------------------------------------------------------------------

test("splitTrainValTest: splits with default ratios (0.8/0.1/0.1)", () => {
  const examples = Array.from({ length: 100 }, (_, i) => ({ id: i, type: "test" }));
  const { train, val, test: testSet } = splitTrainValTest(examples);

  assert.equal(train.length, 80);
  assert.equal(val.length, 10);
  assert.equal(testSet.length, 10);
  // Total should equal input
  assert.equal(train.length + val.length + testSet.length, 100);
});

test("splitTrainValTest: splits with custom ratios", () => {
  const examples = Array.from({ length: 100 }, (_, i) => ({ id: i, type: "test" }));
  const { train, val, test: testSet } = splitTrainValTest(examples, { train: 0.7, val: 0.15, test: 0.15 });

  assert.equal(train.length, 70);
  assert.equal(val.length, 15);
  assert.equal(testSet.length, 15);
});

test("splitTrainValTest: handles small arrays", () => {
  const examples = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const { train, val, test: testSet } = splitTrainValTest(examples, { train: 0.6, val: 0.2, test: 0.2 });

  // 3 * 0.6 = 1.8 -> 2, 3 * 0.8 = 2.4 -> 2
  assert.equal(train.length + val.length + testSet.length, 3);
});

test("splitTrainValTest: throws on invalid ratio sum", () => {
  const examples = [{ id: 1 }];
  assert.throws(
    () => splitTrainValTest(examples, { train: 0.9, val: 0.5, test: 0.5 }),
    { message: /Ratios must sum/ }
  );
});

test("splitTrainValTest: returns empty arrays for empty input", () => {
  const { train, val, test: testSet } = splitTrainValTest([]);
  assert.deepEqual(train, []);
  assert.deepEqual(val, []);
  assert.deepEqual(testSet, []);
});

test("splitTrainValTest: is reproducible with same input", () => {
  const examples = Array.from({ length: 20 }, (_, i) => ({ id: i, type: "test" }));
  const first = splitTrainValTest(examples);
  const second = splitTrainValTest(examples);

  // Same seed-based shuffle should produce same split
  assert.deepEqual(first.train.map((e) => e.id), second.train.map((e) => e.id));
  assert.deepEqual(first.val.map((e) => e.id), second.val.map((e) => e.id));
  assert.deepEqual(first.test.map((e) => e.id), second.test.map((e) => e.id));
});

// ---------------------------------------------------------------------------
// validateExamples
// ---------------------------------------------------------------------------

test("validateExamples: passes valid examples", () => {
  const examples = [sampleConversationTurn, sampleToolUse, sampleAgentWorkflow];
  const result = validateExamples(examples);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validateExamples: detects missing type field", () => {
  const result = validateExamples([{ userMessage: "test" }]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes('missing required field "type"')));
});

test("validateExamples: detects missing required fields by type", () => {
  const result = validateExamples([{ type: "conversation_turn", sessionId: "s1" }]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes("missing required field")));
});

test("validateExamples: validates agent_workflow step count", () => {
  const badWorkflow = { type: "agent_workflow", goal: "test", steps: [{ single: true }] };
  const result = validateExamples([badWorkflow]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes("at least 2 steps")));
});

test("validateExamples: validates error_recovery has isError", () => {
  const badRecovery = {
    type: "error_recovery",
    errorToolCall: { name: "test" },
    errorResult: { data: "err", isError: false },
    recoveryToolCall: { name: "test" },
    recoveryResult: { data: "ok", isError: false },
  };
  const result = validateExamples([badRecovery]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes("isError=true")));
});

test("validateExamples: non-array input returns invalid", () => {
  const result = validateExamples(null);
  assert.equal(result.valid, false);
});

test("validateExamples: warns on large token estimates", () => {
  // Create an example with very large content
  const large = {
    type: "conversation_turn",
    userMessage: "x".repeat(50000),
    assistantMessages: [{ role: "assistant", content: "y".repeat(50000) }],
  };
  const result = validateExamples([large], { maxTokens: 500 });
  assert.ok(result.warnings.length > 0);
  assert.ok(result.warnings.some((w) => w.message.includes("exceeds limit")));
});

test("validateExamples: strict mode stops on first error", () => {
  const examples = [
    { bad: true },
    { alsoBad: true },
    sampleConversationTurn,
  ];
  const result = validateExamples(examples, { strict: true });
  assert.equal(result.valid, false);
  // Should only have 1 error because strict mode stops early
  assert.ok(result.errors.length <= 1);
});
