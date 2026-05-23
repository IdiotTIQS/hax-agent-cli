/**
 * Tests for FlowRenderer: message flow, tool sequence, handoff, error path, and token flow.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { FlowRenderer } = require("../../src/visualize/flow");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a session object that FlowRenderer methods expect.
 */
function makeSession() {
  return {
    id: "session-abc-123",
    messages: [
      {
        role: "user",
        content: "Fix the authentication bug in login.ts",
        timestamp: "2025-02-10T08:00:00.000Z",
        agentId: null,
      },
      {
        role: "assistant",
        content: "I will analyze the login module and identify the root cause.",
        timestamp: "2025-02-10T08:00:05.000Z",
        agentId: "agent-1",
        toolCalls: [
          { name: "read", args: { path: "src/login.ts" }, result: "file content here..." },
          { name: "grep", args: { pattern: "authenticate", path: "src/" } },
        ],
      },
      {
        role: "tool",
        content: "Found 3 references to authenticate.",
        timestamp: "2025-02-10T08:00:08.000Z",
        agentId: null,
      },
      {
        role: "assistant",
        content: "I found the issue: the password hash comparison is using == instead of ===",
        timestamp: "2025-02-10T08:00:12.000Z",
        agentId: "agent-1",
        toolCalls: [
          { name: "edit", args: { path: "src/login.ts", old: "==", new: "===" }, result: "edited" },
        ],
      },
      {
        role: "user",
        content: "Great, also check if there are similar issues elsewhere.",
        timestamp: "2025-02-10T08:00:20.000Z",
        agentId: null,
      },
      {
        role: "assistant",
        content: "Searching for similar patterns...",
        timestamp: "2025-02-10T08:00:22.000Z",
        agentId: "agent-2",
        toolCalls: [
          { name: "grep", args: { pattern: "== (?!=)" }, result: "3 matches found" },
        ],
      },
    ],
    tokens: [
      { input: 120, output: 80, timestamp: "2025-02-10T08:00:05.000Z" },
      { input: 200, output: 150, timestamp: "2025-02-10T08:00:12.000Z" },
      { input: 90, output: 45, timestamp: "2025-02-10T08:00:22.000Z" },
    ],
  };
}

/**
 * Build a session with error messages.
 */
function makeErrorSession() {
  return {
    id: "session-err-456",
    messages: [
      {
        role: "user",
        content: "Deploy to production",
        timestamp: "2025-02-10T09:00:00.000Z",
      },
      {
        role: "assistant",
        content: "Attempting deployment...",
        timestamp: "2025-02-10T09:00:02.000Z",
        agentId: "agent-1",
        toolCalls: [
          { name: "bash", args: { cmd: "deploy.sh" }, error: "Connection refused" },
        ],
        error: null,
      },
      {
        role: "assistant",
        content: "Deployment failed with an error.",
        timestamp: "2025-02-10T09:00:05.000Z",
        agentId: "agent-1",
        error: { message: "Deploy script returned exit code 1", stack: "Error: ...\n  at deploy.js:42" },
      },
      {
        role: "assistant",
        content: "Trying fallback deployment method.",
        timestamp: "2025-02-10T09:00:08.000Z",
        agentId: "agent-1",
        toolCalls: [
          { name: "bash", args: { cmd: "fallback-deploy.sh" }, result: "success" },
        ],
      },
    ],
  };
}

/**
 * Build a team session for agent handoff tests.
 */
function makeTeamSession() {
  return {
    id: "team-session-789",
    agents: [
      { id: "planner", name: "Planner Agent", role: "Task Planning" },
      { id: "coder", name: "Coder Agent", role: "Code Implementation" },
      { id: "reviewer", name: "Reviewer Agent", role: "Code Review" },
    ],
    handoffs: [
      {
        from: "planner",
        to: "coder",
        timestamp: "2025-02-10T10:00:10.000Z",
        context: "Implement user auth module",
        reason: "Plan complete, hand off to implementation",
      },
      {
        from: "coder",
        to: "reviewer",
        timestamp: "2025-02-10T10:05:30.000Z",
        context: "Code ready for review",
        reason: "Implementation complete",
      },
      {
        from: "reviewer",
        to: "coder",
        timestamp: "2025-02-10T10:08:00.000Z",
        context: "Fix noted issues in auth.ts",
        reason: "Found 2 issues requiring fixes",
      },
      {
        from: "coder",
        to: "reviewer",
        timestamp: "2025-02-10T10:12:00.000Z",
        context: "Fixes applied, re-review",
        reason: "Issues resolved",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("FlowRenderer: constructor defaults", () => {
  const renderer = new FlowRenderer();
  assert.equal(renderer._useAnsi, true);
  assert.equal(renderer._maxWidth, 100);
  assert.equal(renderer._maxMessages, 50);
  assert.equal(renderer._compact, false);
});

test("FlowRenderer: constructor with custom options", () => {
  const renderer = new FlowRenderer({
    useAnsi: false,
    maxWidth: 80,
    maxMessages: 10,
    compact: true,
  });
  assert.equal(renderer._useAnsi, false);
  assert.equal(renderer._maxWidth, 80);
  assert.equal(renderer._maxMessages, 10);
  assert.equal(renderer._compact, true);
});

test("renderMessageFlow: renders session message flow with tree connectors", () => {
  const renderer = new FlowRenderer({ useAnsi: false });
  const session = makeSession();
  const output = renderer.renderMessageFlow(session, { title: "Message Flow" });

  assert.ok(typeof output === "string");
  assert.ok(output.length > 0);
  assert.ok(output.includes("Message Flow"), "should include title");
  assert.ok(output.includes("session-abc-123"), "should include session ID");

  // Should show roles
  assert.ok(output.includes("USER"), "should display USER role");
  assert.ok(output.includes("ASSISTANT"), "should display ASSISTANT role");
  assert.ok(output.includes("TOOL"), "should display TOOL role");

  // Should show content previews
  assert.ok(output.includes("authentication bug"), "should include user message content");

  // Should mention tool calls
  assert.ok(output.includes("read"), "should show read tool");
  assert.ok(output.includes("grep"), "should show grep tool");
  assert.ok(output.includes("edit"), "should show edit tool");

  // Should use tree connectors
  assert.ok(output.includes("├") || output.includes("└"), "should use box-drawing chars");
});

test("renderMessageFlow: handles empty session gracefully", () => {
  const renderer = new FlowRenderer({ useAnsi: false });
  const output = renderer.renderMessageFlow({ id: "empty", messages: [] }, { title: "Empty Flow" });
  assert.ok(output.includes("Empty Flow"));
  assert.ok(output.includes("no messages"));
});

test("renderMessageFlow: handles null/undefined session", () => {
  const renderer = new FlowRenderer({ useAnsi: false });
  const output = renderer.renderMessageFlow(null);
  assert.ok(output.includes("no messages"));
});

test("renderToolSequence: renders tool call sequence diagram", () => {
  const renderer = new FlowRenderer({ useAnsi: false });
  const session = makeSession();
  const output = renderer.renderToolSequence(session, { title: "Tool Sequence" });

  assert.ok(typeof output === "string");
  assert.ok(output.includes("Tool Sequence"), "should include title");
  assert.ok(output.includes("session-abc-123"), "should include session ID");

  // Should list each tool call
  assert.ok(output.includes("#01"), "should number calls");
  assert.ok(output.includes("read"), "should show read tool");
  assert.ok(output.includes("grep"), "should show grep tool");
  assert.ok(output.includes("edit"), "should show edit tool");

  // Should show args when enabled
  assert.ok(output.includes("path"), "should show tool args");

  // Should have box borders for cards
  assert.ok(output.includes("┌") || output.includes("╭"), "should use box-drawing chars");
});

test("renderToolSequence: handles session with no tool calls", () => {
  const renderer = new FlowRenderer({ useAnsi: false });
  const session = {
    id: "no-tools",
    messages: [
      { role: "user", content: "Hello", timestamp: "2025-01-01T00:00:00.000Z" },
      { role: "assistant", content: "Hi there!", timestamp: "2025-01-01T00:00:01.000Z" },
    ],
  };
  const output = renderer.renderToolSequence(session);
  assert.ok(output.includes("no tool calls"));
});

test("renderAgentHandoff: renders team agent handoff diagram", () => {
  const renderer = new FlowRenderer({ useAnsi: false });
  const teamSession = makeTeamSession();
  const output = renderer.renderAgentHandoff(teamSession, { title: "Agent Handoff" });

  assert.ok(typeof output === "string");
  assert.ok(output.includes("Agent Handoff"), "should include title");
  assert.ok(output.includes("team-session-789"), "should include team session ID");

  // Should list all agents
  assert.ok(output.includes("Planner Agent"), "should show Planner Agent");
  assert.ok(output.includes("Coder Agent"), "should show Coder Agent");
  assert.ok(output.includes("Reviewer Agent"), "should show Reviewer Agent");

  // Should show handoff sequence
  assert.ok(output.includes("planner"), "should mention planner in flow");

  // Should show handoff summary
  assert.ok(output.includes("Handoff Summary"), "should have summary section");

  // Should show direction arrows
  assert.ok(output.includes("→"), "should show direction arrows");
});

test("renderAgentHandoff: handles missing agents gracefully", () => {
  const renderer = new FlowRenderer({ useAnsi: false });
  const session = { id: "solo", agents: [], handoffs: [] };
  const output = renderer.renderAgentHandoff(session, { title: "Solo" });
  assert.ok(output.includes("Solo"));
  assert.ok(output.includes("Agents: 0"));
});

test("renderAgentHandoff: handles null session", () => {
  const renderer = new FlowRenderer({ useAnsi: false });
  const output = renderer.renderAgentHandoff(null);
  assert.ok(output.includes("no session"));
});

test("renderErrorPath: highlights error messages in flow", () => {
  const renderer = new FlowRenderer({ useAnsi: false });
  const session = makeErrorSession();
  const output = renderer.renderErrorPath(session, { title: "Error Path" });

  assert.ok(typeof output === "string");
  assert.ok(output.includes("Error Path"), "should include title");
  assert.ok(output.includes("ERROR PATH ANALYSIS"), "should show error header");
  assert.ok(output.includes("session-err-456"), "should include session ID");

  // Should flag the error message
  assert.ok(output.includes("ERROR") || output.includes("ERR"), "should indicate errors");

  // Should mention the error details
  assert.ok(output.includes("Connection refused") || output.includes("error"), "should describe error");

  // Should show error type breakdown
  assert.ok(output.includes("Error Type Breakdown"), "should have breakdown section");
});

test("renderErrorPath: shows success message when no errors", () => {
  const renderer = new FlowRenderer({ useAnsi: false });
  const session = makeSession(); // clean session
  const output = renderer.renderErrorPath(session);
  assert.ok(output.includes("No errors detected"), "should report clean session");
});

test("renderErrorPath: handles empty session", () => {
  const renderer = new FlowRenderer({ useAnsi: false });
  const output = renderer.renderErrorPath({ id: "empty", messages: [] });
  assert.ok(output.includes("no messages"));
});

test("renderTokenFlow: renders token usage chart and sparkline", () => {
  const renderer = new FlowRenderer({ useAnsi: false });
  const session = makeSession();
  const output = renderer.renderTokenFlow(session, { title: "Token Usage" });

  assert.ok(typeof output === "string");
  assert.ok(output.includes("Token Usage"), "should include title");
  assert.ok(output.includes("session-abc-123"), "should include session ID");

  // Summary stats
  assert.ok(output.includes("Total Tokens"), "should have total tokens section");
  assert.ok(output.includes("Input"), "should show input tokens");
  assert.ok(output.includes("Output"), "should show output tokens");

  // Ratio comparison
  assert.ok(output.includes("Input vs Output Ratio"), "should have ratio section");

  // Sparkline
  assert.ok(output.includes("Token Usage Over Time"), "should have sparkline section");
  assert.ok(output.includes("In:"), "should have input sparkline");
  assert.ok(output.includes("Out:"), "should have output sparkline");

  // Cost estimate
  assert.ok(output.includes("Cost Estimate"), "should have cost section");
  assert.ok(output.includes("Estimated"), "should show estimate");
});

test("renderTokenFlow: handles missing token data gracefully", () => {
  const renderer = new FlowRenderer({ useAnsi: false });
  const session = {
    id: "no-tokens",
    messages: [{ role: "user", content: "hello" }],
  };
  // No tokens array, but we have content — should estimate from content length
  const output = renderer.renderTokenFlow(session, { title: "Token Flow" });
  assert.ok(output.includes("Token Flow"));
  // Should still produce charts from the estimated data
  assert.ok(output.includes("Estimated") || output.includes("Input"));
});

test("renderTokenFlow: handles null session", () => {
  const renderer = new FlowRenderer({ useAnsi: false });
  const output = renderer.renderTokenFlow(null, { title: "Tokens" });
  assert.ok(output.includes("no session data"));
});

test("FlowRenderer: ANSI mode produces escape codes", () => {
  const renderer = new FlowRenderer({ useAnsi: true });
  const session = makeSession();
  const output = renderer.renderMessageFlow(session);
  assert.ok(output.includes("\x1b["), "should contain ANSI escape sequences");
});

test("FlowRenderer: no-ANSI mode has no escape codes", () => {
  const renderer = new FlowRenderer({ useAnsi: false });
  const session = makeSession();
  const output = renderer.renderMessageFlow(session);
  assert.ok(!output.includes("\x1b["), "should NOT contain ANSI escape sequences");
});
