/**
 * test/tui-ink-reducer.test.ts
 *
 * Unit tests for src/tui-ink/reducer.ts.
 *
 * Tests the pure reducer in isolation — no React, no engine, no I/O.
 * Covers:
 *  - A complete happy-path turn: turn_start → turn.started → message.delta×2
 *    → tool.start → tool.result → turn.completed
 *  - Error turn: turn_start → turn.started → turn.failed
 *  - Interrupt turn: turn_start → turn.started → message.delta → turn.interrupted
 *  - Tool limit event
 *  - Approval bridge: set_approval → clear
 *  - Mode cycling: set_mode
 *  - Clear action
 *  - update_meta action
 *  - Thinking event accumulation
 *  - Usage event
 *  - Status event
 *  - Permission-denied tool result (PERMISSION_DENIED error code → status "error")
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { reducer } from "../src/tui-ink/reducer.ts";
import { createInitialState } from "../src/tui-ink/types.ts";
import type { AppState, AppAction } from "../src/tui-ink/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Apply a sequence of actions to an initial state and return the result. */
function applyActions(actions: AppAction[], initial?: AppState): AppState {
  return actions.reduce(
    (state, action) => reducer(state, action),
    initial ?? createInitialState(),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reducer — happy-path turn", () => {
  it("dispatches a full turn correctly", () => {
    const final = applyActions([
      // User submits text
      { type: "submit_input", text: "Hello" },
      // UI shows spinner immediately
      { type: "turn_start" },
      // Engine events
      { type: "engine_event", event: { type: "turn.started", sessionId: "s1" } },
      { type: "engine_event", event: { type: "message.delta", delta: "Hi " } },
      { type: "engine_event", event: { type: "message.delta", delta: "there!" } },
      {
        type: "engine_event",
        event: { type: "tool.start", name: "shell.run", input: { command: "ls" } },
      },
      {
        type: "engine_event",
        event: {
          type: "tool.result",
          name: "shell.run",
          isError: false,
          data: { content: "file.txt\n" },
          durationMs: 42,
        },
      },
      {
        type: "engine_event",
        event: {
          type: "turn.completed",
          text: "Hi there!",
          usage: { inputTokens: 10, outputTokens: 20 },
          context: "",
        },
      },
    ]);

    // Messages: user + assistant committed
    assert.equal(final.messages.length, 2, "should have 2 committed messages");
    assert.equal(final.messages[0].role, "user");
    assert.equal(final.messages[0].text, "Hello");
    assert.equal(final.messages[1].role, "assistant");
    // The assistant text was accumulated in currentTurnText and committed on turn.completed
    assert.equal(final.messages[1].text, "Hi there!");

    // Streaming state cleared
    assert.equal(final.isStreaming, false);
    assert.equal(final.isWaiting, false);
    assert.equal(final.currentTurnText, "");
    assert.equal(final.currentThinking, "");
    assert.deepEqual(final.currentTools, []);

    // Counters
    assert.equal(final.turnCount, 1);
    assert.equal(final.toolCallCount, 1);

    // Tokens from turn.completed usage
    assert.equal(final.inputTokens, 10);
    assert.equal(final.outputTokens, 20);

    // Error / interrupted cleared
    assert.equal(final.currentError, null);
    assert.equal(final.isInterrupted, false);

    // Status cleared
    assert.equal(final.statusMessage, null);
  });

  it("accumulates deltas correctly", () => {
    const s = applyActions([
      { type: "turn_start" },
      { type: "engine_event", event: { type: "message.delta", delta: "A" } },
      { type: "engine_event", event: { type: "message.delta", delta: "B" } },
      { type: "engine_event", event: { type: "message.delta", delta: "C" } },
    ]);
    assert.equal(s.currentTurnText, "ABC");
    assert.equal(s.isWaiting, false);
  });

  it("resolves tool to done status", () => {
    const s = applyActions([
      { type: "turn_start" },
      {
        type: "engine_event",
        event: { type: "tool.start", name: "file.read", input: { path: "/foo" } },
      },
      {
        type: "engine_event",
        event: {
          type: "tool.result",
          name: "file.read",
          isError: false,
          data: { content: "hello" },
          durationMs: 5,
        },
      },
    ]);
    assert.equal(s.currentTools.length, 1);
    assert.equal(s.currentTools[0].status, "done");
    assert.equal(s.currentTools[0].durationMs, 5);
  });
});

describe("reducer — error turn", () => {
  it("commits the failed turn with its error and clears the active region", () => {
    const s = applyActions([
      { type: "turn_start" },
      { type: "engine_event", event: { type: "turn.started", sessionId: "s2" } },
      {
        type: "engine_event",
        event: { type: "turn.failed", error: { message: "API error" } },
      },
    ]);
    // Post-redesign (I1): the error is carried by the committed turn, and the
    // active region is cleared so the failed turn does not render doubled.
    assert.equal(s.committedTurns[s.committedTurns.length - 1].error, "API error");
    assert.equal(s.currentError, null);
    assert.equal(s.isStreaming, false);
    assert.equal(s.isWaiting, false);
  });
});

describe("reducer — interrupted turn", () => {
  it("commits partial text and sets isInterrupted", () => {
    const s = applyActions([
      { type: "submit_input", text: "Hey" },
      { type: "turn_start" },
      { type: "engine_event", event: { type: "message.delta", delta: "Partial" } },
      { type: "engine_event", event: { type: "turn.interrupted" } },
    ]);
    assert.equal(s.isInterrupted, true);
    assert.equal(s.isStreaming, false);
    assert.equal(s.isWaiting, false);
    // Partial text committed
    assert.equal(s.messages.length, 2);
    assert.equal(s.messages[1].role, "assistant");
    assert.equal(s.messages[1].text, "Partial");
    assert.equal(s.currentTurnText, "");
  });
});

describe("reducer — tool limit", () => {
  it("sets statusMessage on tool.limit", () => {
    const s = applyActions([
      {
        type: "engine_event",
        event: { type: "tool.limit", maxToolTurns: 200 },
      },
    ]);
    assert.equal(s.statusMessage, "Tool limit reached");
  });
});

describe("reducer — approval bridge", () => {
  it("sets and clears pendingApproval", () => {
    const resolve = () => {};
    const approval = { toolName: "shell.run", toolInput: { command: "rm -rf /" }, resolve };

    const s1 = reducer(createInitialState(), { type: "set_approval", approval });
    assert.deepEqual(s1.pendingApproval?.toolName, "shell.run");

    const s2 = reducer(s1, { type: "set_approval", approval: null });
    assert.equal(s2.pendingApproval, null);
  });
});

describe("reducer — set_mode", () => {
  it("updates permissionMode", () => {
    const s = reducer(createInitialState(), { type: "set_mode", mode: "yolo" });
    assert.equal(s.permissionMode, "yolo");
  });
});

describe("reducer — clear", () => {
  it("resets messages and current turn state, keeps meta", () => {
    const loaded = applyActions([
      { type: "submit_input", text: "Hi" },
      { type: "turn_start" },
      { type: "engine_event", event: { type: "message.delta", delta: "Hello" } },
      { type: "set_mode", mode: "yolo" },
    ]);
    const cleared = reducer(loaded, { type: "clear" });
    assert.deepEqual(cleared.messages, []);
    assert.equal(cleared.currentTurnText, "");
    assert.equal(cleared.isStreaming, false);
    // Mode retained
    assert.equal(cleared.permissionMode, "yolo");
  });
});

describe("reducer — update_meta", () => {
  it("merges model and providerName", () => {
    const s = reducer(
      createInitialState(),
      { type: "update_meta", model: "claude-3-5-sonnet", providerName: "anthropic" },
    );
    assert.equal(s.model, "claude-3-5-sonnet");
    assert.equal(s.providerName, "anthropic");
  });

  it("does not overwrite unspecified fields", () => {
    const initial = createInitialState({ model: "original", permissionMode: "yolo" });
    const s = reducer(initial, { type: "update_meta", providerName: "openai" });
    assert.equal(s.model, "original");
    assert.equal(s.permissionMode, "yolo");
    assert.equal(s.providerName, "openai");
  });
});

describe("reducer — thinking accumulation", () => {
  it("accumulates thinking deltas", () => {
    const s = applyActions([
      { type: "engine_event", event: { type: "thinking", delta: "Step 1. " } },
      { type: "engine_event", event: { type: "thinking", delta: "Step 2." } },
    ]);
    assert.equal(s.currentThinking, "Step 1. Step 2.");
  });

  it("handles missing delta gracefully", () => {
    const s = reducer(
      createInitialState(),
      { type: "engine_event", event: { type: "thinking" } },
    );
    assert.equal(s.currentThinking, "");
  });
});

describe("reducer — usage event", () => {
  it("sets token counts from usage event", () => {
    const s = applyActions([
      {
        type: "engine_event",
        event: { type: "usage", inputTokens: 100, outputTokens: 50 },
      },
    ]);
    assert.equal(s.inputTokens, 100);
    assert.equal(s.outputTokens, 50);
  });
});

describe("reducer — status event", () => {
  it("sets statusMessage", () => {
    const s = reducer(
      createInitialState(),
      { type: "engine_event", event: { type: "status", message: "Compacting…" } },
    );
    assert.equal(s.statusMessage, "Compacting…");
  });
});

describe("reducer — PERMISSION_DENIED tool result", () => {
  it("maps to error status", () => {
    const s = applyActions([
      {
        type: "engine_event",
        event: { type: "tool.start", name: "shell.run", input: { command: "rm" } },
      },
      {
        type: "engine_event",
        event: {
          type: "tool.result",
          name: "shell.run",
          isError: true,
          error: { code: "PERMISSION_DENIED", message: "denied" },
        },
      },
    ]);
    assert.equal(s.currentTools[0].status, "error");
    assert.equal(s.currentTools[0].error?.code, "PERMISSION_DENIED");
  });
});

describe("reducer — turn_start clears previous errors", () => {
  it("resets error and interrupted flags", () => {
    const initial = createInitialState({ currentError: "prev error", isInterrupted: true });
    const s = reducer(initial, { type: "turn_start" });
    assert.equal(s.currentError, null);
    assert.equal(s.isInterrupted, false);
    assert.equal(s.isStreaming, true);
    assert.equal(s.isWaiting, true);
  });
});

describe("reducer — multiple tool calls in one turn", () => {
  it("resolves the last matching running tool", () => {
    const s = applyActions([
      { type: "turn_start" },
      {
        type: "engine_event",
        event: { type: "tool.start", name: "file.read", input: { path: "/a" } },
      },
      {
        type: "engine_event",
        event: { type: "tool.start", name: "file.read", input: { path: "/b" } },
      },
      {
        type: "engine_event",
        event: {
          type: "tool.result",
          name: "file.read",
          isError: false,
          data: { content: "b content" },
          durationMs: 10,
        },
      },
    ]);
    // 2 tools; first still running, second resolved
    assert.equal(s.currentTools.length, 2);
    assert.equal(s.currentTools[0].status, "running");
    assert.equal(s.currentTools[1].status, "done");
    assert.equal(s.toolCallCount, 2);
  });
});
