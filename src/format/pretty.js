"use strict";

const { ANSI, THEME } = require("../renderer");

// ── JSON prettification ──────────────────────────────────────────────

/**
 * Pretty-print a JSON string or parseable text.
 * Handles already-parsed objects as well.
 *
 * @param {string|object} text  - JSON string or parsed object
 * @param {number} [indent=2]   - Spaces for indentation
 * @returns {string}
 */
function prettifyJson(text, indent = 2) {
  if (text == null) return "";

  let obj;
  if (typeof text === "string") {
    try {
      obj = JSON.parse(text);
    } catch {
      // Return original if not parseable
      return text;
    }
  } else if (typeof text === "object") {
    obj = text;
  } else {
    return String(text);
  }

  try {
    return JSON.stringify(obj, null, indent);
  } catch {
    return JSON.stringify(obj);
  }
}

// ── XML / HTML prettification ────────────────────────────────────────

/**
 * Pretty-print an XML or HTML string with nested indentation.
 * Preserves text content that has no child elements.
 *
 * @param {string} text  - Raw XML/HTML string
 * @param {number} [indent=2]  - Spaces for indentation
 * @returns {string}
 */
function prettifyXml(text, indent = 2) {
  if (typeof text !== "string" || text.trim().length === 0) return "";

  const indentStr = " ".repeat(indent);
  const selfClosing = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;

  let out = "";
  let depth = 0;
  let i = 0;
  const len = text.length;

  while (i < len) {
    // Skip whitespace between tags
    if (/^\s+/.test(text.slice(i))) {
      const ws = text.slice(i).match(/^\s+/)[0];
      // Only emit newline in the output; skip leading spaces that we'll reindent
      const newlines = (ws.match(/\n/g) || []).length;
      if (newlines > 0) out += "\n".repeat(Math.min(newlines, 1));
      i += ws.length;
      continue;
    }

    // Tag
    if (text[i] === "<") {
      // Comment
      if (text.slice(i, i + 4) === "<!--") {
        const end = text.indexOf("-->", i);
        const commentEnd = end === -1 ? len : end + 3;
        const comment = text.slice(i, commentEnd);
        out += indentStr.repeat(depth) + comment + "\n";
        i = commentEnd;
        continue;
      }

      // CDATA
      if (text.slice(i, i + 9) === "<![CDATA[") {
        const end = text.indexOf("]]>", i + 9);
        const cdataEnd = end === -1 ? len : end + 3;
        out += indentStr.repeat(depth) + text.slice(i, cdataEnd) + "\n";
        i = cdataEnd;
        continue;
      }

      // Processing instruction
      if (text[i + 1] === "?") {
        const end = text.indexOf("?>", i);
        const piEnd = end === -1 ? len : end + 2;
        out += indentStr.repeat(depth) + text.slice(i, piEnd) + "\n";
        i = piEnd;
        continue;
      }

      // Closing tag
      if (text[i + 1] === "/") {
        const end = text.indexOf(">", i);
        if (end === -1) { out += text[i]; i++; continue; }
        const tag = text.slice(i, end + 1);
        depth = Math.max(0, depth - 1);
        out += indentStr.repeat(depth) + tag + "\n";
        i = end + 1;
        continue;
      }

      // Opening or self-closing tag
      const tagEnd = text.indexOf(">", i);
      if (tagEnd === -1) { out += text[i]; i++; continue; }

      const tagText = text.slice(i + 1, tagEnd).trim();
      const tagName = tagText.split(/\s+/)[0].replace(/\/$/, "");
      const isSelfClose = text[tagEnd - 1] === "/" || selfClosing.test(tagName);

      // Check for inline content (text between open and close with no child elements)
      const closeTag = `</${tagName}>`;
      const closeIdx = text.indexOf(closeTag, tagEnd + 1);
      const hasInlineContent = closeIdx !== -1 &&
        !/<[^!?]/.test(text.slice(tagEnd + 1, closeIdx));

      if (isSelfClose) {
        out += indentStr.repeat(depth) + text.slice(i, tagEnd + 1) + "\n";
        i = tagEnd + 1;
      } else if (hasInlineContent) {
        const inner = text.slice(tagEnd + 1, closeIdx).trim();
        out += indentStr.repeat(depth) + "<" + tagText + ">" + inner + closeTag + "\n";
        i = closeIdx + closeTag.length;
      } else {
        // Block-level: open, increase depth
        out += indentStr.repeat(depth) + "<" + tagText + ">\n";
        depth++;
        i = tagEnd + 1;
      }

      continue;
    }

    // Text content between tags
    const nextTag = text.indexOf("<", i);
    const contentEnd = nextTag === -1 ? len : nextTag;
    const content = text.slice(i, contentEnd).trim();
    if (content.length > 0) {
      out += indentStr.repeat(depth) + content + "\n";
    }
    i = contentEnd;
  }

  return out;
}

// ── Code block formatting ────────────────────────────────────────────

/**
 * Format a code block with optional language label and ANSI borders.
 *
 * @param {string} code     - Source code text
 * @param {string} [language]  - Language identifier for the label
 * @param {object} [options]
 * @param {number} [options.maxWidth=100]  - Maximum content width
 * @returns {string}
 */
function formatCodeBlock(code, language, options = {}) {
  if (typeof code !== "string" || code.length === 0) return "";

  const maxWidth = options.maxWidth || 100;
  const lines = code.split("\n");
  const width = Math.min(maxWidth, Math.max(...lines.map((l) => l.length), 10) + 2);
  const langLabel = language ? ` ${THEME.dim}${language}${ANSI.reset}` : "";

  const topBorder = `${THEME.border}╭${"─".repeat(width)}╮${ANSI.reset}${langLabel}`;
  const bottomBorder = `${THEME.border}╰${"─".repeat(width)}╯${ANSI.reset}`;

  const rendered = [topBorder];
  for (const line of lines) {
    const content = line.length > width - 2 ? line.slice(0, width - 5) + "..." : line;
    rendered.push(
      `${THEME.border}│${ANSI.reset} ${THEME.codeText}${content.padEnd(width - 1)}${ANSI.reset}${THEME.border}│${ANSI.reset}`,
    );
  }
  rendered.push(bottomBorder);

  return rendered.join("\n");
}

// ── Table formatting ─────────────────────────────────────────────────

/**
 * Format a 2D array of data as an aligned text table.
 * First row is the header by default.
 *
 * @param {Array<Array<string|number>>} data   - 2D array of cell values
 * @param {object} [options]
 * @param {boolean} [options.header=true]       - Treat first row as header
 * @param {Array<number>} [options.widths]      - Custom column widths
 * @param {number} [options.minWidth=3]         - Minimum column width
 * @param {number} [options.padding=1]          - Spaces between columns
 * @param {boolean} [options.ansi=false]        - Enable ANSI color output
 * @returns {string}
 */
function formatTable(data, options = {}) {
  if (!Array.isArray(data) || data.length === 0) return "";

  const header = options.header !== false;
  const padding = options.padding ?? 1;
  const minWidth = options.minWidth ?? 3;
  const customWidths = Array.isArray(options.widths) ? options.widths : null;
  const useAnsi = options.ansi === true;
  const pad = " ".repeat(padding);

  const colCount = Math.max(...data.map((r) => (Array.isArray(r) ? r.length : 0)));
  if (colCount === 0) return "";

  let widths;
  if (customWidths) {
    widths = customWidths.slice(0, colCount);
    while (widths.length < colCount) widths.push(minWidth);
  } else {
    widths = new Array(colCount).fill(minWidth);
    for (const row of data) {
      if (!Array.isArray(row)) continue;
      for (let c = 0; c < row.length; c++) {
        const len = String(row[c] ?? "").length;
        if (len > widths[c]) widths[c] = len;
      }
    }
  }

  const output = [];

  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    if (!Array.isArray(row)) continue;

    const cells = [];
    for (let c = 0; c < widths.length; c++) {
      cells.push(String(row[c] ?? "").padEnd(widths[c]));
    }

    let line = cells.join(pad);

    if (useAnsi && header && r === 0) {
      line = `${THEME.heading}${line}${ANSI.reset}`;
    }

    output.push(line);

    if (header && r === 0) {
      const sepCells = widths.map((w) => "─".repeat(w));
      let sepLine = sepCells.join(pad);
      if (useAnsi) sepLine = `${THEME.dim}${sepLine}${ANSI.reset}`;
      output.push(sepLine);
    }
  }

  return output.join("\n");
}

// ── List formatting ──────────────────────────────────────────────────

/**
 * Format an array of strings as a bulleted or numbered list.
 *
 * @param {string[]} items   - List item strings
 * @param {string} [style="bullet"]  - "bullet", "dash", "number", "none"
 * @param {object} [options]
 * @param {number} [options.indent=0]   - Leading spaces for each item
 * @param {boolean} [options.ansi=false] - Enable ANSI color
 * @returns {string}
 */
function formatList(items, style = "bullet", options = {}) {
  if (!Array.isArray(items) || items.length === 0) return "";

  const indent = " ".repeat(options.indent ?? 0);
  const useAnsi = options.ansi === true;

  const getMarker = (index) => {
    switch (style) {
      case "number":
      case "ordered":
        return `${index + 1}.`;
      case "dash":
        return "─";
      case "none":
        return "";
      case "bullet":
      default:
        return "•";
    }
  };

  const output = [];
  for (let i = 0; i < items.length; i++) {
    const marker = getMarker(i);
    const markerStr = marker ? (useAnsi ? `${THEME.list}${marker}${ANSI.reset} ` : `${marker} `) : "";
    output.push(`${indent}${markerStr}${items[i]}`);
  }

  return output.join("\n");
}

// ── Key-value formatting ─────────────────────────────────────────────

/**
 * Format an object as aligned key‑value pairs.
 *
 * @param {object} data           - Object with string/number values
 * @param {object} [options]
 * @param {number} [options.minKeyWidth=12]  - Minimum key column width
 * @param {number} [options.indent=0]        - Leading spaces
 * @param {boolean} [options.ansi=false]     - Enable ANSI color
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

    output.push(`${indentStr}${key.padEnd(keyWidth)}  ${displayVal}`);
  }

  return output.join("\n");
}

// ── Smart truncation ─────────────────────────────────────────────────

/**
 * Smart text truncation at word or sentence boundaries.
 *
 * @param {string} text         - The text to truncate
 * @param {number} maxLength    - Maximum allowed character length
 * @param {object} [options]
 * @param {string} [options.mode="word"]     - "word", "sentence", "line", or "char"
 * @param {string} [options.ellipsis="…"]    - Trailing indicator
 * @param {boolean} [options.trimEnd=true]   - Trim whitespace from the result
 * @param {boolean} [options.preserveNewlines=false] - Keep internal \n sequences
 * @returns {string}
 */
function truncate(text, maxLength, options = {}) {
  if (typeof text !== "string") return "";
  if (text.length <= maxLength) {
    // Still trim trailing newlines for empty result
    return options.trimEnd !== false ? text.replace(/\s+$/, "") : text;
  }

  const mode = options.mode || "word";
  const ellipsis = options.ellipsis || "…";
  const preserveNewlines = options.preserveNewlines === true;
  const ellipLen = ellipsis.length;
  const limit = Math.max(0, maxLength - ellipLen);

  if (limit <= 0) {
    return text.slice(0, maxLength);
  }

  if (mode === "char") {
    // Simple character truncation
    const result = text.slice(0, maxLength - ellipLen) + ellipsis;
    return options.trimEnd !== false ? result.replace(/\s+$/, "") : result;
  }

  if (mode === "line") {
    // Truncate at newline boundary: take whole lines up to the limit
    const lines = text.split("\n");
    let acc = "";
    let i = 0;
    for (; i < lines.length; i++) {
      const tentative = acc.length === 0 ? lines[i] : acc + "\n" + lines[i];
      if (tentative.length > limit) break;
      acc = tentative;
    }
    if (acc.length === 0 && i < lines.length) {
      // First line itself is too long, fall back to word truncation
      acc = _truncateWord(lines[0], limit);
    }
    return acc + (i < lines.length ? "\n" + ellipsis : "");
  }

  if (mode === "sentence") {
    // Truncate at sentence boundaries (. ! ?)
    let best = 0;
    let i = 0;
    while (i < limit && i < text.length) {
      const ch = text[i];
      if (ch === "." || ch === "!" || ch === "?") {
        // Check that this is sentence-terminating (not e.g. "Mr." or "Dr." or "...")
        if (i + 1 >= text.length || text[i + 1] === " " || text[i + 1] === "\n" || text[i + 1] === "\r") {
          best = i + 1;
        } else if (ch === "." && (text[i - 1] === "." || text[i + 1] === ".")) {
          // Ellipsis in progress, don't pick up on it
          // just continue
        } else {
          best = i + 1; // fallback best
        }
      }
      i++;
    }
    if (best === 0) best = limit;
    const result = text.slice(0, best) + ellipsis;
    return options.trimEnd !== false ? result.replace(/\s+$/, "") : result;
  }

  // Default: word boundary
  const wordEnd = _truncateWord(text, limit);
  const result = wordEnd + ellipsis;
  return options.trimEnd !== false ? result.replace(/\s+$/, "") : result;
}

/**
 * Truncate at the nearest word boundary before `limit`.
 * A word boundary is after a non-whitespace char that's followed by whitespace.
 */
function _truncateWord(text, limit) {
  if (limit >= text.length) return text;

  // Walk backwards from limit to find a word boundary
  let cut = limit;
  while (cut > 0 && text[cut] !== " " && text[cut] !== "\n") {
    cut--;
  }

  // If we found a whitespace boundary within a reasonable range (within 20 chars of limit)
  if (cut > 0 && limit - cut <= 20) {
    return text.slice(0, cut);
  }

  // Otherwise just cut at limit
  return text.slice(0, limit);
}

// ── Exports ───────────────────────────────────────────────────────────

module.exports = {
  prettifyJson,
  prettifyXml,
  formatCodeBlock,
  formatTable,
  formatList,
  formatKeyValue,
  truncate,
};
