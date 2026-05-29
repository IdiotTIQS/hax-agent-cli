"use strict";
/** Output style definitions. Ported from OpenHarness output_styles/loader.py */

const BUILTIN_STYLES = {
  default: { name: "default", description: "Standard terminal output", spinner: "dots", colors: true, emoji: true, compact: false },
  minimal: { name: "minimal", description: "Minimal output, fewer decorations", spinner: "line", colors: true, emoji: false, compact: true },
  verbose: { name: "verbose", description: "Verbose output with full details", spinner: "dots", colors: true, emoji: true, compact: false },
  plain: { name: "plain", description: "Plain text, no ANSI codes", spinner: "none", colors: false, emoji: false, compact: true },
  json: { name: "json", description: "JSON Lines output for machine processing", spinner: "none", colors: false, emoji: false, compact: false },
};

function listStyles() { return Object.values(BUILTIN_STYLES); }
function getStyle(name) { return BUILTIN_STYLES[name] || BUILTIN_STYLES.default; }

module.exports = { BUILTIN_STYLES, listStyles, getStyle };
