"use strict";

/**
 * Keybinding parser — parses keybinding expressions.
 * Ported from OpenHarness keybindings/parser.py
 */

const MODIFIERS = { ctrl: "ctrl", shift: "shift", alt: "alt", meta: "meta", cmd: "meta", super: "meta" };
const SPECIAL_KEYS = {
  up: "up", down: "down", left: "left", right: "right",
  enter: "enter", return: "enter", tab: "tab", escape: "esc",
  backspace: "backspace", delete: "delete", home: "home", end: "end",
  pageup: "pageup", pagedown: "pagedown",
  space: "space", " ": "space",
  f1: "f1", f2: "f2", f3: "f3", f4: "f4", f5: "f5", f6: "f6",
  f7: "f7", f8: "f8", f9: "f9", f10: "f10", f11: "f11", f12: "f12",
};

/** Parse a keybinding string like "ctrl+shift+k" into { key, modifiers } */
function parseKeybinding(expr) {
  if (!expr || typeof expr !== "string") return null;
  const parts = expr.toLowerCase().split("+").map(p => p.trim());
  let key = parts[parts.length - 1];
  const modifiers = [];
  for (let i = 0; i < parts.length - 1; i++) {
    if (MODIFIERS[parts[i]]) modifiers.push(MODIFIERS[parts[i]]);
    else return null; // Unknown modifier
  }
  // Normalize key
  if (SPECIAL_KEYS[key]) key = SPECIAL_KEYS[key];
  else if (key.length === 1) key = key; // Single character
  else if (key.startsWith("f") && /^f\d+$/.test(key)) key = key;
  else return null; // Invalid key
  return { key, modifiers: [...new Set(modifiers)].sort() };
}

/** Check if a keypress event matches a parsed binding */
function matchesBinding(event, binding) {
  if (!binding || !event) return false;
  const parsed = typeof binding === "string" ? parseKeybinding(binding) : binding;
  if (!parsed) return false;
  // Check key
  const eventKey = (event.name || event.key || "").toLowerCase();
  const normalizedKey = SPECIAL_KEYS[eventKey] || eventKey;
  if (parsed.key !== normalizedKey && parsed.key !== eventKey) return false;
  // Check modifiers
  const eventMods = [];
  if (event.ctrl) eventMods.push("ctrl");
  if (event.shift) eventMods.push("shift");
  if (event.alt) eventMods.push("alt");
  if (event.meta) eventMods.push("meta");
  eventMods.sort();
  if (JSON.stringify(parsed.modifiers) !== JSON.stringify(eventMods)) return false;
  return true;
}

module.exports = { parseKeybinding, matchesBinding, MODIFIERS, SPECIAL_KEYS };
