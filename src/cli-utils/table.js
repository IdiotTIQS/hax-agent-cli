"use strict";

const { ANSI, THEME } = require("../renderer");

/**
 * Format an array of rows as an aligned text table.
 *
 * @param {Array<Array<string|number>>} rows  - Data rows; first row is treated as header
 *                                              if options.header is not false.
 * @param {object} [options]
 * @param {boolean} [options.header=true]       - Treat first row as a header.
 * @param {Array<number>} [options.widths]      - Custom column widths (overrides auto-sizing).
 * @param {number} [options.minWidth=3]         - Minimum column width.
 * @param {number} [options.padding=1]          - Spaces between columns.
 * @param {string} [options.color]  - ANSI color for header text (e.g. THEME.heading).
 * @param {boolean} [options.ansi=false]        - Enable ANSI color output.
 * @returns {string}
 */
function formatTable(rows, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return "";

  const header = options.header !== false;
  const padding = options.padding ?? 1;
  const minWidth = options.minWidth ?? 3;
  const customWidths = Array.isArray(options.widths) ? options.widths : null;
  const useAnsi = options.ansi === true;
  const headerColor = options.color || "";

  const colCount = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)));

  // Calculate column widths
  let widths;
  if (customWidths) {
    widths = customWidths.slice(0, colCount);
    // Pad with minWidth if fewer custom widths than columns
    while (widths.length < colCount) widths.push(minWidth);
  } else {
    widths = new Array(colCount).fill(minWidth);
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      for (let i = 0; i < row.length; i++) {
        const len = String(row[i] ?? "").length;
        if (len > widths[i]) widths[i] = len;
      }
    }
  }

  const pad = " ".repeat(padding);
  const output = [];

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    if (!Array.isArray(row)) continue;

    const cells = [];
    for (let col = 0; col < widths.length; col++) {
      const val = String(row[col] ?? "");
      cells.push(val.padEnd(widths[col]));
    }

    let line = cells.join(pad);

    if (useAnsi && header && rowIdx === 0 && headerColor) {
      line = `${headerColor}${line}${ANSI.reset}`;
    }

    output.push(line);

    // Separator line after header
    if (header && rowIdx === 0) {
      const sepCells = [];
      for (let col = 0; col < widths.length; col++) {
        sepCells.push("─".repeat(widths[col]));
      }
      let sepLine = sepCells.join(pad);
      if (useAnsi) {
        sepLine = `${THEME.dim}${sepLine}${ANSI.reset}`;
      }
      output.push(sepLine);
    }
  }

  return output.join("\n");
}

/**
 * Format an object as aligned key-value pairs.
 *
 * @param {object} data           - Object with string/number values.
 * @param {object} [options]
 * @param {number} [options.minKeyWidth=12] - Minimum key column width.
 * @param {number} [options.indent=0]       - Leading spaces.
 * @param {boolean} [options.ansi=false]    - Enable ANSI color.
 * @returns {string}
 */
function formatKeyValue(data, options = {}) {
  if (data == null || typeof data !== "object") return "";

  const entries = Object.entries(data);
  if (entries.length === 0) return "";

  const minKeyWidth = options.minKeyWidth ?? 12;
  const indent = options.indent ?? 0;
  const useAnsi = options.ansi === true;
  const indentStr = " ".repeat(indent);

  // Determine max key width
  let keyWidth = minKeyWidth;
  for (const [key] of entries) {
    if (key.length > keyWidth) keyWidth = key.length;
  }

  const output = [];
  for (const [key, value] of entries) {
    let displayVal;
    if (value == null) {
      displayVal = useAnsi ? `${THEME.dim}null${ANSI.reset}` : "null";
    } else if (typeof value === "object") {
      displayVal = JSON.stringify(value);
    } else {
      displayVal = String(value);
    }

    const line = `${indentStr}${key.padEnd(keyWidth)}  ${displayVal}`;
    output.push(line);
  }

  return output.join("\n");
}

/**
 * Format a hierarchical tree structure as indented text.
 *
 * Each node should have:
 *   { label: string, children?: Array<Node> }
 *
 * @param {object|Array<object>} tree  - Root node(s).
 * @param {object} [options]
 * @param {string} [options.indent='  ']          - Indentation per level.
 * @param {string} [options.branch='├─ ']         - Branch prefix.
 * @param {string} [options.lastBranch='└─ ']     - Last item branch prefix.
 * @param {string} [options.pipe='│ ']            - Vertical pipe for intermediate levels.
 * @param {boolean} [options.ansi=false]          - Enable ANSI color.
 * @returns {string}
 */
function formatTree(tree, options = {}) {
  const indent = options.indent ?? "  ";
  const branch = options.branch ?? "├─ ";
  const lastBranch = options.lastBranch ?? "└─ ";
  const pipe = options.pipe ?? "│ ";
  const useAnsi = options.ansi === true;

  const output = [];

  /**
   * @param {object|Array} nodes
   * @param {string} prefix
   * @param {boolean} isLast
   */
  function render(nodes, prefix, isLast) {
    const list = Array.isArray(nodes) ? nodes : [nodes];

    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      if (!node || typeof node !== "object") continue;

      const isLastItem = i === list.length - 1;
      const connector = isLastItem ? lastBranch : branch;
      const linePrefix = prefix + connector;

      const label = node.label ?? String(node);
      output.push(linePrefix + label);

      if (Array.isArray(node.children) && node.children.length > 0) {
        const childPrefix = prefix + (isLastItem ? indent : pipe);
        render(node.children, childPrefix, isLastItem);
      }
    }
  }

  render(tree, "", true);
  return output.join("\n");
}

module.exports = {
  formatTable,
  formatKeyValue,
  formatTree,
};
