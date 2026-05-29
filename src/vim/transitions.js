"use strict";

/**
 * Vim mode — key transition definitions.
 * Ported from OpenHarness vim/transitions.py
 *
 * Provides Vim-like modal editing in the CLI input.
 */

const VimMode = { NORMAL: "normal", INSERT: "insert", VISUAL: "visual", COMMAND: "command" };

const TRANSITIONS = {
  normal: {
    i: VimMode.INSERT,
    I: { mode: VimMode.INSERT, action: "line_begin" },
    a: { mode: VimMode.INSERT, action: "cursor_right" },
    A: { mode: VimMode.INSERT, action: "line_end" },
    o: { mode: VimMode.INSERT, action: "newline_below" },
    O: { mode: VimMode.INSERT, action: "newline_above" },
    v: VimMode.VISUAL,
    V: { mode: VimMode.VISUAL, action: "visual_line" },
    ":": VimMode.COMMAND,
    h: "cursor_left",
    j: "history_next",
    k: "history_prev",
    l: "cursor_right",
    w: "word_forward",
    b: "word_backward",
    "0": "line_begin",
    $: "line_end",
    x: "delete_char",
    dd: "delete_line",
    u: "undo",
    "/": "search_forward",
    "?": "search_backward",
    n: "search_next",
    N: "search_prev",
  },
  insert: {
    escape: VimMode.NORMAL,
    "ctrl+c": VimMode.NORMAL,
  },
  visual: {
    escape: VimMode.NORMAL,
    y: { mode: VimMode.NORMAL, action: "yank" },
    d: { mode: VimMode.NORMAL, action: "delete_selection" },
    c: { mode: VimMode.INSERT, action: "change_selection" },
  },
  command: {
    escape: VimMode.NORMAL,
    enter: { mode: VimMode.NORMAL, action: "execute_command" },
  },
};

function resolveAction(mode, key) {
  const modeTransitions = TRANSITIONS[mode];
  if (!modeTransitions) return null;
  return modeTransitions[key] || null;
}

module.exports = { VimMode, TRANSITIONS, resolveAction };
