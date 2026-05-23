"use strict";

const { ANSI, THEME } = require("../renderer");

/**
 * Format a yes/no confirmation prompt.
 *
 * Usage: call confirm(question) to build the prompt string, then use
 * readline or similar to collect the answer.
 *
 * @param {string} question - The question to display.
 * @param {boolean} [defaultVal=true] - Default answer (true = Yes, false = No).
 * @returns {string} The formatted prompt string.
 */
function confirm(question, defaultVal = true) {
  const yesLabel = defaultVal ? "Y" : "y";
  const noLabel = defaultVal ? "n" : "N";
  return `${question} ${THEME.dim}(${yesLabel}/${noLabel})${ANSI.reset} `;
}

/**
 * Format a single-select prompt from a list of options.
 *
 * @param {string} label - Label shown above the list.
 * @param {Array<string|{value: string, label: string}>} options - Selectable options.
 * @returns {string} The formatted prompt (numbered list).
 */
function select(label, options) {
  if (!Array.isArray(options) || options.length === 0) return "";

  const lines = [`${THEME.bold}${label}${ANSI.reset}`];

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const display = typeof opt === "string" ? opt : (opt.label || opt.value);
    const num = String(i + 1);
    lines.push(`  ${THEME.accent}${num}${ANSI.reset} ${display}`);
  }

  lines.push(`${THEME.dim}Enter a number (1-${options.length}):${ANSI.reset} `);
  return lines.join("\n");
}

/**
 * Format a free-text input prompt.
 *
 * @param {string} prompt - The prompt text.
 * @param {object} [options]
 * @param {Function} [options.validate] - Validator function (not used in output, caller handles).
 * @param {string} [options.default]   - Default value shown in prompt.
 * @returns {string} The formatted prompt string.
 */
function input(prompt, options = {}) {
  const def = options.default;
  let line = `${prompt}`;
  if (def !== undefined && def !== null && def !== "") {
    line += ` ${THEME.dim}(${String(def)})${ANSI.reset}`;
  }
  line += " ";
  return line;
}

/**
 * Format a multi-select prompt with checkbox indicators.
 *
 * @param {string} label - Label shown above the list.
 * @param {Array<string|{value: string, label: string, checked?: boolean}>} options - Options.
 * @param {object} [opts]
 * @param {Array<string>} [opts.checked=[]] - Pre-checked values.
 * @returns {string} The formatted prompt string.
 */
function multiSelect(label, options, opts = {}) {
  if (!Array.isArray(options) || options.length === 0) return "";

  const checked = new Set(opts.checked || []);
  const lines = [
    `${THEME.bold}${label}${ANSI.reset}`,
    `${THEME.dim}Press space to toggle, enter to confirm${ANSI.reset}`,
    "",
  ];

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const val = typeof opt === "string" ? opt : (opt.value || "");
    const display = typeof opt === "string" ? opt : (opt.label || val);
    const isChecked = typeof opt === "object" && opt.checked !== undefined
      ? opt.checked
      : checked.has(val);
    const checkbox = isChecked
      ? `${THEME.success}${"◉"}${ANSI.reset}`
      : `${THEME.dim}${"○"}${ANSI.reset}`;
    lines.push(`  ${checkbox} ${display}`);
  }

  lines.push("");
  lines.push(`${THEME.dim}Enter to confirm${ANSI.reset} `);
  return lines.join("\n");
}

module.exports = {
  confirm,
  select,
  input,
  multiSelect,
};
