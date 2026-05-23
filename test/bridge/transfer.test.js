"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ContextBridge,
  looksLikeDecision,
  looksLikeQuestion,
  looksLikeTask,
  extractFilePaths,
  resolveModifiedFiles,
  resolveAgentState,
} = require("../../src/bridge/transfer");

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSession(overrides = {}) {
  return {
    id: "session-test-001",
    goal: "Fix the auth module null reference bug",
    messages: [
      { role: "user", content: "I need to fix a critical bug in the auth module." },
      { role: "assistant", content: "Let me analyze the auth module code in src/auth.js." },
      { role: "assistant", content: "I decided to refactor token validation using a guard clause." },
      { role: "user", content: "Sounds good, go ahead." },
      { role: "assistant", content: "I'm working on the fix now. I should also update the tests." },
      { role: "assistant", content: "One question: should the new validator support OAuth as well?" },
    ],
    modifiedFiles: new Set(["src/auth.js", "src/middleware.js"]),
    state: { currentFile: "src/auth.js", cursorLine: 142 },
    contextStats: { inputTokens: 8000, budgetTokens: 200000 },
    shouldExit: false,
    isStreaming: false,
    provider: { name: "anthropic", model: "claude-sonnet-4-20250514" },
    costTracker: { turnCount: 6 },
    startTime: Date.now() - 300000,
    ...overrides,
  };
}

function makeSessionWithMessages(messages) {
  return makeSession({ messages });
}

// ---------------------------------------------------------------------------
// ContextBridge.capture
// ---------------------------------------------------------------------------

test("capture: extracts decisions from assistant messages", () => {
  const bridge = new ContextBridge();
  const session = makeSession();
  const context = bridge.capture(session);

  assert.ok(Array.isArray(context.decisions), "decisions should be an array");
  assert.ok(context.decisions.length > 0, "should have at least one decision");
  assert.ok(
    context.decisions.some((d) => d.includes("decided")),
    "should capture the decision message"
  );
});

test("capture: extracts tasks from messages", () => {
  const bridge = new ContextBridge();
  const session = makeSession();
  const context = bridge.capture(session);

  assert.ok(Array.isArray(context.tasks), "tasks should be an array");
  assert.ok(context.tasks.length > 0, "should have at least one task");
  assert.ok(
    context.tasks.some((t) => t.includes("working")),
    "should capture the task message"
  );
});

test("capture: extracts open questions", () => {
  const bridge = new ContextBridge();
  const session = makeSession();
  const context = bridge.capture(session);

  assert.ok(Array.isArray(context.questions), "questions should be an array");
  assert.ok(context.questions.length > 0, "should have at least one question");
  assert.ok(
    context.questions.some((q) => q.includes("should")),
    "should capture the question message"
  );
});

test("capture: includes modified files", () => {
  const bridge = new ContextBridge();
  const session = makeSession();
  const context = bridge.capture(session);

  assert.ok(Array.isArray(context.modifiedFiles), "modifiedFiles should be an array");
  assert.ok(
    context.modifiedFiles.includes("src/auth.js"),
    "should include files from modifiedFiles Set"
  );
  assert.ok(
    context.modifiedFiles.includes("src/middleware.js"),
    "should include middleware.js"
  );
});

test("capture: includes session metadata", () => {
  const bridge = new ContextBridge();
  const session = makeSession();
  const context = bridge.capture(session);

  assert.equal(context.sessionId, "session-test-001");
  assert.equal(context.goal, "Fix the auth module null reference bug");
  assert.ok(typeof context.capturedAt === "number");
  assert.equal(context.meta.turnCount, 6);
  assert.equal(context.meta.provider, "anthropic");
  assert.equal(context.meta.model, "claude-sonnet-4-20250514");
});

test("capture: includes agent state", () => {
  const bridge = new ContextBridge();
  const session = makeSession();
  const context = bridge.capture(session);

  assert.ok(typeof context.agentState === "object");
  assert.equal(context.agentState.currentFile, "src/auth.js");
  assert.equal(context.agentState.cursorLine, 142);
  assert.equal(context.agentState.shouldExit, false);
  assert.equal(context.agentState.isStreaming, false);
});

test("capture: creates conversation digest", () => {
  const bridge = new ContextBridge();
  const session = makeSession();
  const context = bridge.capture(session);

  assert.ok(typeof context.digest === "object");
  assert.equal(context.digest.messageCount, 6);
  assert.ok(Array.isArray(context.digest.lastMessages));
  assert.ok(context.digest.lastMessages.length > 0);
  assert.ok(context.digest.lastMessages.length <= 6);
});

test("capture: handles empty session gracefully", () => {
  const bridge = new ContextBridge();
  const context = bridge.capture({});

  assert.equal(context.decisions.length, 0);
  assert.equal(context.tasks.length, 0);
  assert.equal(context.questions.length, 0);
  assert.equal(context.modifiedFiles.length, 0);
  assert.equal(context.goal, "");
  assert.equal(context.digest.messageCount, 0);
});

test("capture: stores summary when enableSummaries is true", () => {
  const bridge = new ContextBridge();
  const session = makeSession();
  bridge.capture(session, { enableSummaries: true });

  const summaries = bridge.getStoredSummaries();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].sessionId, "session-test-001");
});

// ---------------------------------------------------------------------------
// ContextBridge.transfer
// ---------------------------------------------------------------------------

test("transfer: transfers context from source to target", () => {
  const bridge = new ContextBridge();
  const source = makeSession();
  const target = {
    id: "target-session",
    goal: "Initial goal",
    messages: [],
    modifiedFiles: new Set(["src/config.js"]),
  };

  bridge.transfer(source, target);

  assert.ok(target.goal.includes("Fix the auth module"));
  assert.ok(target.modifiedFiles.has("src/auth.js"), "should merge modified files");
  assert.ok(target.modifiedFiles.has("src/middleware.js"));
  assert.ok(target.modifiedFiles.has("src/config.js"));
  assert.ok(Array.isArray(target.transferredContext));
  assert.equal(target.transferredContext.length, 1);
  assert.equal(target.transferredContext[0].fromSession, "session-test-001");
});

test("transfer: injects system message with context summary", () => {
  const bridge = new ContextBridge();
  const source = makeSession();
  const target = {
    id: "target-session",
    messages: [{ role: "user", content: "continue from where we left off" }],
  };

  bridge.transfer(source, target);

  assert.ok(target.messages.length >= 2, "should add system message");
  assert.equal(target.messages[0].role, "system");
  assert.ok(
    target.messages[0].content.includes("continues from a previous session"),
    "should mention previous session"
  );
  assert.ok(
    target.messages[0].content.includes("session-test-001"),
    "should include source session id"
  );
});

test("transfer: respects preserveGoal option", () => {
  const bridge = new ContextBridge();
  const source = makeSession();
  const target = { goal: "Keep this goal", messages: [] };

  bridge.transfer(source, target, { preserveGoal: true });

  assert.equal(target.goal, "Keep this goal");
});

test("transfer: respects injectSystemMessage=false", () => {
  const bridge = new ContextBridge();
  const source = makeSession();
  const target = { messages: [{ role: "user", content: "hello" }] };

  bridge.transfer(source, target, { injectSystemMessage: false });

  assert.equal(target.messages.length, 1, "no system message should be added");
});

test("transfer: accepts a pre-captured context as source", () => {
  const bridge = new ContextBridge();
  const preCaptured = {
    sessionId: "pre-captured",
    goal: "Pre-captured goal",
    decisions: ["Decided to use pre-captured data"],
    tasks: [],
    questions: [],
    modifiedFiles: ["src/data.js"],
    agentState: {},
    digest: { messageCount: 0, lastMessages: [] },
    meta: { turnCount: 0 },
    capturedAt: Date.now(),
  };
  const target = { messages: [] };

  bridge.transfer(preCaptured, target);

  assert.ok(
    target.messages.some(
      (m) => m.role === "system" && m.content.includes("pre-captured")
    ),
    "should reference pre-captured session id"
  );
  assert.ok(target.modifiedFiles.has("src/data.js"));
});

// ---------------------------------------------------------------------------
// ContextBridge.merge
// ---------------------------------------------------------------------------

test("merge: combines multiple contexts", () => {
  const bridge = new ContextBridge();
  const ctx1 = {
    sessionId: "s1",
    goal: "Fix auth",
    decisions: ["Used guard clause", "Added fallback"],
    tasks: ["Refactor validator"],
    questions: ["OAuth support?"],
    modifiedFiles: ["src/auth.js"],
    agentState: { cursorLine: 10 },
    digest: { messageCount: 4, lastMessages: [] },
    meta: { turnCount: 2 },
  };
  const ctx2 = {
    sessionId: "s2",
    goal: "Fix auth",
    decisions: ["Used guard clause", "Adopted OAuth"],
    tasks: ["Add e2e tests"],
    questions: ["Performance impact?"],
    modifiedFiles: ["src/auth.js", "test/auth.test.js"],
    agentState: { cursorLine: 200 },
    digest: { messageCount: 6, lastMessages: [] },
    meta: { turnCount: 3 },
  };

  const merged = bridge.merge([ctx1, ctx2]);

  assert.equal(merged.sourceCount, 2);
  assert.equal(merged.sessionIds.length, 2);
  // "Used guard clause" is duplicated, should be deduplicated.
  assert.equal(merged.decisions.length, 3, "should have 3 unique decisions");
  assert.equal(merged.tasks.length, 2);
  assert.equal(merged.questions.length, 2);
  assert.equal(merged.modifiedFiles.length, 2);
  assert.equal(merged.agentState.cursorLine, 200, "later state should override");
  assert.equal(merged.meta.totalMessages, 10);
  assert.equal(merged.meta.totalTurns, 5);
});

test("merge: handles empty array", () => {
  const bridge = new ContextBridge();
  const merged = bridge.merge([]);

  assert.equal(merged.sourceCount, 0);
  assert.equal(merged.decisions.length, 0);
  assert.equal(merged.tasks.length, 0);
  assert.equal(merged.questions.length, 0);
});

test("merge: respects deduplicate=false", () => {
  const bridge = new ContextBridge();
  const ctx1 = { decisions: ["A", "B"], tasks: [], questions: [], modifiedFiles: [], agentState: {}, digest: {}, meta: {} };
  const ctx2 = { decisions: ["A", "C"], tasks: [], questions: [], modifiedFiles: [], agentState: {}, digest: {}, meta: {} };

  const merged = bridge.merge([ctx1, ctx2], { deduplicate: false });

  assert.equal(merged.decisions.length, 4);
  assert.deepEqual(merged.decisions, ["A", "B", "A", "C"]);
});

// ---------------------------------------------------------------------------
// ContextBridge.summarize
// ---------------------------------------------------------------------------

test("summarize: creates compact context summary", () => {
  const bridge = new ContextBridge();
  const context = {
    sessionId: "session-abc",
    goal: "Fix auth bug",
    decisions: ["Used guard clause pattern", "Adopted factory pattern"],
    tasks: ["Refactor token module", "Add unit tests"],
    questions: ["OAuth support needed?"],
    modifiedFiles: ["src/auth.js", "src/token.js"],
    digest: { messageCount: 12, lastMessages: [] },
    meta: { turnCount: 4 },
  };

  const summary = bridge.summarize(context);

  assert.ok(summary.includes("Fix auth bug"));
  assert.ok(summary.includes("session-abc"));
  assert.ok(summary.includes("guard clause") || summary.includes("guard"));
  assert.ok(summary.includes("Refactor"));
  assert.ok(summary.includes("OAuth"));
  assert.ok(summary.includes("src/auth.js"));
});

test("summarize: handles empty context", () => {
  const bridge = new ContextBridge();
  const summary = bridge.summarize({});

  assert.ok(typeof summary === "string");
  assert.ok(summary.length >= 0);
});

test("summarize: truncates to maxLength", () => {
  const bridge = new ContextBridge();
  const context = {
    sessionId: "big-session",
    goal: "A very long goal that goes on and on about many things",
    decisions: Array.from({ length: 20 }, (_, i) => `Decision number ${i + 1}: we decided to do something very specific here`),
    tasks: Array.from({ length: 15 }, (_, i) => `Task number ${i + 1}: we need to accomplish this thing soon`),
    questions: Array.from({ length: 10 }, (_, i) => `Question number ${i + 1}: do we really need to answer this?`),
    modifiedFiles: [],
    agentState: {},
    digest: { messageCount: 99, lastMessages: [] },
    meta: { turnCount: 33 },
  };

  const summary = bridge.summarize(context, { maxLength: 200 });

  assert.ok(summary.length <= 203, `summary length ${summary.length} should be <= ~200`); // allow for ellipsis
});

// ---------------------------------------------------------------------------
// Helper function tests
// ---------------------------------------------------------------------------

test("looksLikeDecision: identifies decision content", () => {
  assert.equal(looksLikeDecision("I decided to use React for the frontend"), true);
  assert.equal(looksLikeDecision("Let me choose the factory pattern"), true);
  assert.equal(looksLikeDecision("Here is the plan for the project"), true);
  assert.equal(looksLikeDecision("The sky is blue today"), false);
  assert.equal(looksLikeDecision("I think that's a good idea"), false);
});

test("looksLikeQuestion: identifies question content", () => {
  assert.equal(looksLikeQuestion("Should we use PostgreSQL or MySQL?"), true);
  assert.equal(looksLikeQuestion("It is unclear whether this approach works"), true);
  assert.equal(looksLikeQuestion("How to implement the caching layer?"), true);
  assert.equal(looksLikeQuestion("The test passes correctly"), false);
  assert.equal(looksLikeQuestion("We will deploy tomorrow"), false);
});

test("looksLikeTask: identifies task content", () => {
  assert.equal(looksLikeTask("I need to refactor the database layer"), true);
  assert.equal(looksLikeTask("Currently working on the error handling"), true);
  assert.equal(looksLikeTask("Next step is to run the integration tests"), true);
  assert.equal(looksLikeTask("This is a finished task"), true);
  assert.equal(looksLikeTask("The solution is deployed"), false);
});

test("extractFilePaths: extracts file paths from text", () => {
  const paths = extractFilePaths("Updated src/auth.js and test/auth.test.js. See /docs/readme.txt.");
  assert.ok(paths.includes("src/auth.js"));
  assert.ok(paths.includes("test/auth.test.js"));
});

test("resolveModifiedFiles: falls back to scanning messages when no Set", () => {
  const session = {
    messages: [
      { role: "assistant", content: "I modified /home/user/project/src/main.js" },
    ],
  };
  const files = resolveModifiedFiles(session);
  assert.ok(files.some((f) => f.includes("main.js")));
});

test("resolveAgentState: returns empty object for empty session", () => {
  const state = resolveAgentState({});
  assert.deepEqual(state, {});
});

test("resolveAgentState: captures boolean flags", () => {
  const state = resolveAgentState({
    shouldExit: true,
    pendingExit: true,
    isStreaming: false,
  });
  assert.equal(state.shouldExit, true);
  assert.equal(state.pendingExit, true);
  assert.equal(state.isStreaming, false);
});

// ---------------------------------------------------------------------------
// ContextBridge.getStoredSummaries & clear
// ---------------------------------------------------------------------------

test("getStoredSummaries: returns summaries newest-first with limit", () => {
  const bridge = new ContextBridge();
  const s1 = makeSession({ id: "s1", goal: "Goal 1" });
  const s2 = makeSession({ id: "s2", goal: "Goal 2" });

  bridge.capture(s1, { enableSummaries: true });
  bridge.capture(s2, { enableSummaries: true });

  const summaries = bridge.getStoredSummaries();
  assert.equal(summaries.length, 2);
  // Most recently stored should be first (newest first).
  assert.equal(summaries[0].sessionId, "s2");
  assert.equal(summaries[1].sessionId, "s1");

  const limited = bridge.getStoredSummaries({ limit: 1 });
  assert.equal(limited.length, 1);
  assert.equal(limited[0].sessionId, "s2");
});

test("clear: removes all stored summaries", () => {
  const bridge = new ContextBridge();
  bridge.capture(makeSession(), { enableSummaries: true });
  assert.equal(bridge.getStoredSummaries().length, 1);

  bridge.clear();
  assert.equal(bridge.getStoredSummaries().length, 0);
});
