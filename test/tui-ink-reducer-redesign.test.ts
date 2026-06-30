import assert from "node:assert/strict";
import test from "node:test";
import { reducer } from "../src/tui-ink/reducer.js";
import { createInitialState } from "../src/tui-ink/types.js";

test("turn.failed commits the snapshot and clears the active region", () => {
  let s = createInitialState();
  s = reducer(s, { type: "submit_input", text: "go" });
  s = reducer(s, { type: "turn_start" });
  s = reducer(s, { type: "engine_event", event: { type: "message.delta", delta: "partial" } });
  s = reducer(s, { type: "engine_event", event: { type: "tool.start", name: "shell.run", input: {} } });
  s = reducer(s, { type: "engine_event", event: { type: "turn.failed", error: { message: "boom" } } });
  // Committed once with the error...
  assert.equal(s.committedTurns.length, 1);
  assert.equal(s.committedTurns[0].error, "boom");
  assert.equal(s.committedTurns[0].assistantText, "partial");
  // ...and the active region is cleared so it does not render doubled (I1).
  assert.equal(s.currentTurnText, "");
  assert.equal(s.currentThinking, "");
  assert.equal(s.currentTools.length, 0);
  assert.equal(s.currentError, null);
  assert.equal(s.isStreaming, false);
});

test("commit_turn snapshots active turn into committedTurns", () => {
  let s = createInitialState({ model: "m", permissionMode: "normal" });
  s = reducer(s, { type: "submit_input", text: "hello" });
  s = reducer(s, { type: "turn_start" });
  s = reducer(s, { type: "engine_event", event: { type: "message.delta", delta: "hi" } });
  s = reducer(s, { type: "engine_event", event: { type: "tool.start", name: "file.read", input: {} } });
  s = reducer(s, { type: "engine_event", event: { type: "tool.result", name: "file.read", isError: false, durationMs: 5 } });
  s = reducer(s, { type: "engine_event", event: { type: "turn.completed", text: "hi", usage: null, context: "" } });
  assert.equal(s.committedTurns.length, 1);
  assert.equal(s.committedTurns[0].userText, "hello");
  assert.equal(s.committedTurns[0].assistantText, "hi");
  assert.equal(s.committedTurns[0].tools.length, 1);
  assert.equal(s.committedTurns[0].tools[0].status, "done");
  assert.equal(s.isStreaming, false);
  assert.equal(s.currentTurnText, "");
  assert.equal(s.currentTools.length, 0);
});

test("toggle_detail flips detailMode", () => {
  let s = createInitialState();
  assert.equal(s.detailMode, false);
  s = reducer(s, { type: "toggle_detail" });
  assert.equal(s.detailMode, true);
  s = reducer(s, { type: "toggle_detail" });
  assert.equal(s.detailMode, false);
});

test("palette open/update/close", () => {
  let s = createInitialState();
  assert.equal(s.commandPalette, null);
  s = reducer(s, { type: "open_palette", query: "/mo" });
  assert.equal(s.commandPalette?.open, true);
  assert.equal(s.commandPalette?.query, "/mo");
  s = reducer(s, { type: "update_palette", query: "/mod" });
  assert.equal(s.commandPalette?.query, "/mod");
  s = reducer(s, { type: "close_palette" });
  assert.equal(s.commandPalette, null);
});

test("interrupted turn commits with interrupted flag", () => {
  let s = createInitialState();
  s = reducer(s, { type: "submit_input", text: "go" });
  s = reducer(s, { type: "turn_start" });
  s = reducer(s, { type: "engine_event", event: { type: "message.delta", delta: "partial" } });
  s = reducer(s, { type: "engine_event", event: { type: "turn.interrupted" } });
  assert.equal(s.committedTurns.length, 1);
  assert.equal(s.committedTurns[0].interrupted, true);
  assert.equal(s.committedTurns[0].assistantText, "partial");
});

test("command_output pushes a committed turn with command as userText and output as assistantText", () => {
  let s = createInitialState();
  s = reducer(s, { type: "command_output", command: "/help", output: "Help text here" });
  assert.equal(s.committedTurns.length, 1);
  assert.equal(s.committedTurns[0].userText, "/help");
  assert.equal(s.committedTurns[0].assistantText, "Help text here");
  assert.equal(s.committedTurns[0].thinking, "");
  assert.equal(s.committedTurns[0].tools.length, 0);
  assert.equal(s.committedTurns[0].interrupted, false);
  assert.equal(s.committedTurns[0].error, null);
  // command_output does not mutate other state fields
  assert.equal(s.isStreaming, false);
  assert.equal(s.pendingUserText, "");
});
