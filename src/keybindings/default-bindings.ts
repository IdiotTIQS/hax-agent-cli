/** Default keybinding definitions. Ported from OpenHarness keybindings/default_bindings.py */

const CHORD_BINDINGS: Record<string, string> = {
  "ctrl+c": "interrupt", "ctrl+d": "exit", "ctrl+l": "clear_screen",
  "ctrl+r": "history_search", "ctrl+u": "clear_line", "ctrl+w": "delete_word_backward",
  "ctrl+a": "line_begin", "ctrl+e": "line_end", "ctrl+k": "kill_line",
  "ctrl+n": "history_next", "ctrl+p": "history_prev",
  "ctrl+t": "swap_chars", "ctrl+y": "yank",
  "alt+b": "word_backward", "alt+f": "word_forward",
  "alt+d": "delete_word_forward", "alt+backspace": "delete_word_backward",
  "up": "history_prev", "down": "history_next",
  "left": "cursor_left", "right": "cursor_right",
  "home": "line_begin", "end": "line_end",
  "tab": "autocomplete", "shift+tab": "autocomplete_reverse",
  "enter": "submit", "escape": "cancel",
  "ctrl+shift+c": "copy_selection", "ctrl+shift+v": "paste",
};

const VIM_NORMAL_BINDINGS: Record<string, string> = {
  "h": "cursor_left", "j": "history_next", "k": "history_prev", "l": "cursor_right",
  "w": "word_forward", "b": "word_backward", "0": "line_begin", "$": "line_end",
  "i": "vim_insert", "a": "vim_append", "o": "vim_newline_below", "O": "vim_newline_above",
  "x": "delete_char", "dd": "delete_line", "u": "undo", "/": "search_forward", "n": "search_next",
  "v": "vim_visual", "V": "vim_visual_line", ":": "vim_command",
};

function getDefaultBindings(vimMode: boolean = false): Record<string, string> { return vimMode ? { ...CHORD_BINDINGS, ...VIM_NORMAL_BINDINGS } : { ...CHORD_BINDINGS }; }

export { CHORD_BINDINGS, VIM_NORMAL_BINDINGS, getDefaultBindings };
