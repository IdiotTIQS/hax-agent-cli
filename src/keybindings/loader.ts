/**
 * Keyboard shortcut system.
 * Ported from OpenHarness keybindings/ directory.
 */

import fs from "fs";
import path from "path";
import os from "os";

const DEFAULT_BINDINGS = {
  "ctrl+c": "interrupt",
  "ctrl+d": "exit",
  "ctrl+l": "clear_screen",
  "ctrl+r": "history_search",
  "ctrl+u": "clear_line",
  "ctrl+w": "delete_word_backward",
  "ctrl+a": "line_begin",
  "ctrl+e": "line_end",
  "ctrl+k": "kill_line",
  "up": "history_prev",
  "down": "history_next",
  "tab": "autocomplete",
};

function loadKeybindings(configDir) {
  const dir = configDir || path.join(os.homedir(), ".haxagent");
  const filePath = path.join(dir, "keybindings.json");
  if (!fs.existsSync(filePath)) return { ...DEFAULT_BINDINGS };
  try {
    const userBindings = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return { ...DEFAULT_BINDINGS, ...userBindings };
  } catch (_) { return { ...DEFAULT_BINDINGS }; }
}

function saveKeybindings(bindings, configDir) {
  const dir = configDir || path.join(os.homedir(), ".haxagent");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "keybindings.json");
  fs.writeFileSync(filePath, JSON.stringify(bindings, null, 2));
}

export { DEFAULT_BINDINGS, loadKeybindings, saveKeybindings };
