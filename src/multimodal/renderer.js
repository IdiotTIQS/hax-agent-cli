"use strict";

const { ANSI, THEME } = require("../renderer");
const {
  highlightJs,
  highlightJson,
  highlightMarkdown,
  highlightDiff,
  highlightShell,
  highlightXml,
} = require("../format/syntax");

// ── Box-drawing glyphs ──────────────────────────────────────────────────

const BOX = {
  tl: "╭", tr: "╮", bl: "╰", br: "╯",
  vl: "│", hl: "─",
  t: "┬", b: "┴", l: "├", r: "┤", x: "┼",
  dblVl: "║", dblHl: "═",
  teeR: "├", teeL: "┤", teeD: "┬", teeU: "┴",
  arrowR: "→", arrowD: "↓", arrowL: "←", arrowU: "↑",
  dot: "·", bullet: "•", check: "✓", cross: "✗",
  treeBranch: "├──", treeLast: "└──", treeDown: "│  ", treeSpace: "   ",
};

// ── Chart characters ────────────────────────────────────────────────────

const BAR_CHARS = ["█", "▓", "▒", "░", "▉", "▊", "▋", "▌", "▍", "▎", "▏"];
const BAR_EMPTY = " ";

// ── Helpers ─────────────────────────────────────────────────────────────

function clamp(val, min, max) {
  return val < min ? min : val > max ? max : val;
}

function repeatStr(ch, count) {
  if (count <= 0) return "";
  return ch.repeat(count);
}

function padRight(str, width) {
  const visualLen = stripAnsi(str).length;
  if (visualLen >= width) return str;
  return str + " ".repeat(width - visualLen);
}

function padLeft(str, width) {
  const visualLen = stripAnsi(str).length;
  if (visualLen >= width) return str;
  return " ".repeat(width - visualLen) + str;
}

function truncate(str, maxLen) {
  if (!str) return "";
  const s = String(str);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function visualLen(str) {
  return stripAnsi(String(str)).length;
}

// ── MultiModalRenderer ──────────────────────────────────────────────────

class MultiModalRenderer {
  constructor(options = {}) {
    this.columns = options.columns || 80;
    this.rows = options.rows || 24;
    this.ansiEnabled = options.ansiEnabled !== false;
    this.borderStyle = options.borderStyle || "rounded"; // rounded | double | ascii
  }

  // ── Main dispatch ──────────────────────────────────────────────────

  /**
   * Render content based on its type.
   *
   * @param {*} content - The content to render
   * @param {string} type - One of: text, image, code, table, chart, file-tree, key-value, mermaid
   * @param {object} [options] - Type-specific options
   * @returns {string}
   */
  render(content, type, options = {}) {
    switch (type) {
      case "image":
        return this.renderImage(content, options);
      case "code":
        return this.renderCodeBlock(
          typeof content === "string" ? content : content.code || "",
          content.language || options.language || "text"
        );
      case "table":
        return this.renderTable(content, options);
      case "chart":
        return this.renderChart(content.data || content, content.type || options.chartType || "bar");
      case "file-tree":
        return this._renderFileTree(content, options);
      case "key-value":
        return this._renderKeyValue(content, options);
      case "mermaid":
        return this._renderMermaid(content, options);
      case "text":
      default:
        return this._renderText(content, options);
    }
  }

  // ── Image ──────────────────────────────────────────────────────────

  /**
   * Render an image as an ANSI placeholder with metadata.
   *
   * @param {object|string} imageData - Image path, buffer, or metadata object
   * @param {object} [options]
   * @param {number} [options.width] - Display width in columns
   * @param {number} [options.height] - Display height in rows
   * @param {string} [options.label] - Caption text
   * @returns {string}
   */
  renderImage(imageData, options = {}) {
    const path = typeof imageData === "string" ? imageData : imageData.path || "";
    const width = options.width || this.columns - 4;
    const height = options.height || 6;
    const label = options.label || (typeof imageData !== "string" ? imageData.label : null) || path || "Image";

    const lines = [];
    const w = clamp(width, 20, this.columns - 2);

    // Top border
    lines.push(`${THEME.border}╭${repeatStr("─", w)}╮${ANSI.reset}`);

    // Image placeholder interior
    const frame = this._generateImagePlaceholder(w, height, label);

    for (const row of frame) {
      lines.push(`${THEME.border}│${ANSI.reset}${row}${THEME.border}│${ANSI.reset}`);
    }

    // Bottom border with metadata
    let metaStr = "";
    if (typeof imageData !== "string" && imageData) {
      const parts = [];
      if (imageData.width && imageData.height) parts.push(`${imageData.width}×${imageData.height}`);
      if (imageData.format) parts.push(imageData.format.toUpperCase());
      if (imageData.size) parts.push(formatBytes(imageData.size));
      metaStr = parts.length > 0 ? ` ${THEME.dim}${parts.join(" · ")}${ANSI.reset}` : "";
    }
    lines.push(`${THEME.border}╰${repeatStr("─", w)}╯${ANSI.reset}${metaStr}`);

    return lines.join("\n");
  }

  /**
   * Generate a simple ASCII-art placeholder for the image area.
   */
  _generateImagePlaceholder(width, height, label) {
    const rows = [];
    const innerW = width;

    for (let y = 0; y < height; y++) {
      let row = "";
      for (let x = 0; x < innerW; x++) {
        // Generate a gradient-like pattern
        const shade = Math.sin(x * 0.3 + y * 0.5) * 0.5 + 0.5;
        if (shade > 0.7) row += THEME.dim + "·" + ANSI.reset;
        else if (shade > 0.4) row += THEME.dim + ":" + ANSI.reset;
        else row += " ";
      }
      rows.push(row);
    }

    // Overlay label in center
    const centerY = Math.floor(height / 2);
    const centerX = Math.max(0, Math.floor((innerW - label.length) / 2));
    if (centerY >= 0 && centerY < rows.length && label) {
      let rowArr = [...rows[centerY]];
      for (let i = 0; i < label.length && centerX + i < innerW; i++) {
        rowArr[centerX + i] = THEME.badge + label[i] + ANSI.reset;
      }
      rows[centerY] = rowArr.join("");
    }

    return rows;
  }

  // ── Table ──────────────────────────────────────────────────────────

  /**
   * Render an interactive table using Unicode box-drawing characters.
   *
   * @param {object} data - { columns: string[], rows: Array<Array<*>>, [title]: string }
   * @param {object} [options]
   * @param {boolean} [options.sortable] - Add sort indicator header
   * @param {number} [options.maxColWidth] - Max column width
   * @returns {string}
   */
  renderTable(data, options = {}) {
    if (!data || !data.columns || !data.rows) {
      return this._renderEmpty("No table data");
    }

    const columns = data.columns;
    const rows = data.rows;
    const maxColWidth = options.maxColWidth || 30;
    const title = data.title || options.title || "";

    // Calculate column widths
    const colWidths = columns.map((col, ci) => {
      let maxW = visualLen(String(col)) + 2; // +2 for padding
      for (const row of rows) {
        const val = row[ci] !== undefined && row[ci] !== null ? String(row[ci]) : "";
        const lines = val.split("\n");
        for (const line of lines) {
          maxW = Math.max(maxW, visualLen(line) + 2);
        }
      }
      return Math.min(maxW, maxColWidth + 2);
    });

    const totalWidth = colWidths.reduce((a, b) => a + b, 0) + colWidths.length + 1;
    const out = [];

    // Title
    if (title) {
      out.push(`${THEME.bold}${title}${ANSI.reset}\n`);
    }

    // Top border
    out.push(this._tableBorder("top", colWidths));

    // Header row
    out.push(this._tableRow(columns, colWidths, THEME.bold, true));

    // Header/body separator
    out.push(this._tableBorder("separator", colWidths));

    // Data rows
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const rowColor = ri % 2 === 0 ? ANSI.reset : THEME.dim;
      out.push(this._tableRow(
        row.map(v => (v !== undefined && v !== null) ? String(v) : ""),
        colWidths,
        rowColor,
        false
      ));
    }

    // Bottom border
    out.push(this._tableBorder("bottom", colWidths));

    // Row count
    out.push(`${THEME.dim}${rows.length} row${rows.length !== 1 ? "s" : ""}${ANSI.reset}`);

    return out.join("\n");
  }

  _tableBorder(type, colWidths) {
    const left = type === "top" ? BOX.tl : type === "bottom" ? BOX.bl : BOX.teeR;
    const right = type === "top" ? BOX.tr : type === "bottom" ? BOX.br : BOX.teeL;
    const tee = type === "top" ? BOX.teeD : type === "bottom" ? BOX.teeU : BOX.x;

    let line = THEME.border + left;
    for (let i = 0; i < colWidths.length; i++) {
      line += repeatStr(BOX.hl, colWidths[i]);
      if (i < colWidths.length - 1) line += tee;
    }
    line += right + ANSI.reset;
    return line;
  }

  _tableRow(cells, colWidths, color, isHeader) {
    const cellStyle = isHeader ? THEME.accent : "";

    // Handle multi-line cells
    const cellLines = cells.map((cell, ci) => {
      return String(cell).split("\n").map(l => truncate(l, colWidths[ci] - 2));
    });
    const maxLines = Math.max(...cellLines.map(c => c.length));

    const lines = [];
    for (let l = 0; l < maxLines; l++) {
      let line = THEME.border + BOX.vl + ANSI.reset;
      for (let ci = 0; ci < cells.length; ci++) {
        const cellText = (cellLines[ci][l] || "").padEnd(colWidths[ci] - 2);
        const padded = ` ${cellText} `;
        line += `${color}${cellStyle}${padded}${ANSI.reset}`;
        line += `${THEME.border}${BOX.vl}${ANSI.reset}`;
      }
      lines.push(line);
    }
    return lines.join("\n");
  }

  // ── Code Block ─────────────────────────────────────────────────────

  /**
   * Render a syntax-highlighted code block.
   *
   * @param {string} code - Source code
   * @param {string} language - Programming language identifier
   * @param {object} [options]
   * @param {boolean} [options.lineNumbers] - Show line numbers
   * @param {string} [options.title] - Title bar text
   * @param {number} [options.highlightLines] - Lines to highlight
   * @returns {string}
   */
  renderCodeBlock(code, language, options = {}) {
    if (!code) return this._renderEmpty("No code");

    const lang = language || "text";
    const showLineNums = options.lineNumbers !== false;
    const title = options.title || "";
    const highlightLines = new Set(
      Array.isArray(options.highlightLines) ? options.highlightLines : []
    );

    const lines = code.split("\n");
    const lineNumWidth = showLineNums ? Math.max(2, String(lines.length).length) : 0;
    const maxContentWidth = Math.min(this.columns - 4 - lineNumWidth - 3, 100);
    const innerWidth = maxContentWidth + lineNumWidth + (showLineNums ? 3 : 0);

    const highlighted = this._highlightCode(code, lang);

    const out = [];

    // Top border
    const headerLabel = title ? ` ${THEME.dim}${title}${ANSI.reset} ` : "";
    const langLabel = lang && lang !== "text" ? ` ${THEME.dim}${lang}${ANSI.reset} ` : "";
    out.push(`${THEME.border}╭${repeatStr("─", innerWidth)}╮${ANSI.reset}${headerLabel}${langLabel}`);

    // Lines
    const hlLinesArr = highlighted.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const hlLine = hlLinesArr[i] || "";
      const lineNum = String(i + 1).padStart(lineNumWidth);
      const isHighlighted = highlightLines.has(i + 1);

      let prefix = "";
      if (showLineNums) {
        prefix = ` ${THEME.dim}${lineNum}${ANSI.reset} ${THEME.border}│${ANSI.reset} `;
      }

      let content = hlLine;
      const visualWidth = stripAnsi(hlLine).length;
      if (visualWidth > maxContentWidth) {
        // Truncate by slicing the raw text and re-add padding
        const rawLine = lines[i] || "";
        if (rawLine.length > maxContentWidth) {
          content = rawLine.slice(0, maxContentWidth - 3) + "...";
        } else {
          content = rawLine;
        }
      }

      const bgLine = isHighlighted ? THEME.bgBrightBlack : "";
      const paddedContent = padRight(content, maxContentWidth);
      out.push(`${THEME.border}│${ANSI.reset}${bgLine}${prefix}${paddedContent}${ANSI.reset}${THEME.border}│${ANSI.reset}`);
    }

    // Bottom border
    out.push(`${THEME.border}╰${repeatStr("─", innerWidth)}╯${ANSI.reset}`);

    return out.join("\n");
  }

  /**
   * Apply syntax highlighting based on language.
   */
  _highlightCode(code, language) {
    const lang = (language || "").toLowerCase();

    // Map common aliases
    if (/^(js|javascript|mjs|cjs|jsx)$/.test(lang)) return highlightJs(code);
    if (/^(ts|typescript|tsx)$/.test(lang)) return highlightJs(code);
    if (/^(json|jsonc|json5)$/.test(lang)) return highlightJson(code);
    if (/^(md|markdown)$/.test(lang)) return highlightMarkdown(code);
    if (/^(diff|patch)$/.test(lang)) return highlightDiff(code);
    if (/^(sh|bash|shell|zsh|fish)$/.test(lang)) return highlightShell(code);
    if (/^(xml|html|svg|xhtml)$/.test(lang)) return highlightXml(code);
    if (/^(py|python)$/.test(lang)) return this._highlightPython(code);
    if (/^(css|less|scss)$/.test(lang)) return code; // basic
    if (/^(yaml|yml|toml|ini|cfg|conf)$/.test(lang)) return code;
    if (/^(sql)$/.test(lang)) return code;
    if (/^(text|plain|txt|none)$/.test(lang)) return code;

    // Fallback: try to apply a reasonable highlighter
    return code;
  }

  /**
   * Basic Python syntax highlighting.
   */
  _highlightPython(code) {
    const PY_KEYWORDS = new Set([
      "and", "as", "assert", "async", "await", "break", "class", "continue",
      "def", "del", "elif", "else", "except", "False", "finally", "for",
      "from", "global", "if", "import", "in", "is", "lambda", "None",
      "not", "or", "pass", "raise", "return", "True", "try", "while",
      "with", "yield",
    ]);
    const PY_BUILTINS = new Set([
      "print", "len", "range", "int", "str", "float", "bool", "list", "dict",
      "set", "tuple", "type", "isinstance", "open", "enumerate", "zip", "map",
      "filter", "sorted", "reversed", "sum", "min", "max", "abs", "any", "all",
      "super", "self", "cls",
    ]);

    const lines = code.split("\n");
    return lines.map(line => {
      let result = "";
      let i = 0;
      const len = line.length;

      while (i < len) {
        // Comment
        if (line[i] === "#") {
          result += ANSI.dim + ANSI.italic + line.slice(i) + ANSI.reset;
          break;
        }

        // String
        if (line[i] === "'" || line[i] === '"') {
          const quote = line[i];
          let j = i + 1;
          if (line.slice(i, i + 3) === quote.repeat(3)) {
            j = i + 3;
            while (j < len && !(line.slice(j, j + 3) === quote.repeat(3))) j++;
            j += 3;
          } else {
            while (j < len && line[j] !== "\\" && line[j] !== quote) j++;
            if (j < len && line[j] === "\\") { result += line.slice(i, j + 2); i = j + 2; continue; }
            j = Math.min(j + 1, len);
          }
          result += THEME.toolSuccess + line.slice(i, j) + ANSI.reset;
          i = j;
          continue;
        }

        // Number
        if ((line[i] >= "0" && line[i] <= "9") || (line[i] === "." && i + 1 < len && line[i + 1] >= "0" && line[i + 1] <= "9")) {
          const start = i;
          while (i < len && /[0-9a-fA-FxXoObB_.]/.test(line[i])) i++;
          result += THEME.cost + line.slice(start, i) + ANSI.reset;
          continue;
        }

        // Decorator
        if (line[i] === "@") {
          const start = i;
          i++;
          while (i < len && /[a-zA-Z0-9_.]/.test(line[i])) i++;
          result += THEME.toolIndicator + line.slice(start, i) + ANSI.reset;
          continue;
        }

        // Identifier
        if (/[a-zA-Z_]/.test(line[i])) {
          const start = i;
          while (i < len && /[a-zA-Z0-9_]/.test(line[i])) i++;
          const word = line.slice(start, i);
          if (PY_KEYWORDS.has(word)) {
            result += THEME.accent + word + ANSI.reset;
          } else if (PY_BUILTINS.has(word)) {
            result += ANSI.brightCyan + word + ANSI.reset;
          } else if (i < len && line[i] === "(") {
            result += THEME.heading + word + ANSI.reset;
          } else if (word[0] === word[0].toUpperCase() && word !== word.toUpperCase()) {
            result += THEME.toolIndicator + word + ANSI.reset;
          } else {
            result += word;
          }
          continue;
        }

        result += line[i];
        i++;
      }

      return result;
    }).join("\n");
  }

  // ── Diff ───────────────────────────────────────────────────────────

  /**
   * Render a colored diff view.
   *
   * @param {string} diffText - Unified diff text
   * @param {object} [options]
   * @param {boolean} [options.showLineNumbers] - Show line numbers
   * @param {string} [options.title] - Title for the diff view
   * @returns {string}
   */
  renderDiff(diffText, options = {}) {
    if (!diffText) return this._renderEmpty("No diff");

    const title = options.title || "";
    const showLineNums = options.showLineNumbers !== false;

    const highlighted = highlightDiff(diffText);
    const lines = highlighted.split("\n");
    const maxLineNum = lines.length;

    const prefixWidth = showLineNums ? 6 : 0;
    const maxContentWidth = Math.min(this.columns - 4 - prefixWidth, 120);
    const innerWidth = maxContentWidth + prefixWidth;

    const out = [];

    // Top border
    if (title) {
      out.push(`${THEME.diffHeader}${title}${ANSI.reset}`);
      out.push(`${THEME.border}╭${repeatStr("─", innerWidth)}╮${ANSI.reset}`);
    } else {
      out.push(`${THEME.border}╭${repeatStr("─", innerWidth)}╮${ANSI.reset}`);
    }

    let addCount = 0;
    let delCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const rawLine = stripAnsi(line);

      if (rawLine.startsWith("+")) addCount++;
      if (rawLine.startsWith("-")) delCount++;

      let prefix = "";
      if (showLineNums) {
        prefix = ` ${THEME.dim}${String(i + 1).padStart(4)}${ANSI.reset} `;
      }

      const visualW = stripAnsi(line).length;
      const truncated = visualW > maxContentWidth
        ? rawLine.slice(0, maxContentWidth - 3) + "..."
        : line;
      const padded = padRight(truncated, maxContentWidth);

      out.push(`${THEME.border}│${ANSI.reset}${prefix}${padded}${THEME.border}│${ANSI.reset}`);
    }

    // Bottom border
    out.push(`${THEME.border}╰${repeatStr("─", innerWidth)}╯${ANSI.reset}`);

    // Summary
    const summaryParts = [];
    if (addCount > 0) summaryParts.push(`${THEME.diffAdd}+${addCount}${ANSI.reset}`);
    if (delCount > 0) summaryParts.push(`${THEME.diffRemove}-${delCount}${ANSI.reset}`);
    if (summaryParts.length > 0) {
      out.push(`${THEME.dim}${summaryParts.join(" ")}${ANSI.reset}`);
    }

    return out.join("\n");
  }

  // ── Chart ──────────────────────────────────────────────────────────

  /**
   * Render a chart using Unicode block characters.
   *
   * @param {object|Array} data - Chart data
   * @param {string} type - Chart type: "bar", "line", "pie"
   * @param {object} [options]
   * @param {number} [options.width] - Chart width in columns
   * @param {number} [options.height] - Chart height in rows
   * @param {string} [options.title] - Chart title
   * @returns {string}
   */
  renderChart(data, type, options = {}) {
    const chartType = (type || "bar").toLowerCase();
    const chartData = this._normalizeChartData(data);

    if (!chartData || chartData.length === 0) {
      return this._renderEmpty("No chart data");
    }

    switch (chartType) {
      case "bar":
        return this._renderBarChart(chartData, options);
      case "line":
        return this._renderLineChart(chartData, options);
      case "pie":
        return this._renderPieChart(chartData, options);
      default:
        return this._renderBarChart(chartData, options);
    }
  }

  _normalizeChartData(data) {
    if (Array.isArray(data)) {
      if (data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
        return data.map(d => ({
          label: d.label || d.name || d.key || "",
          value: d.value || d.count || d.size || 0,
          color: d.color || null,
        }));
      }
      return data.map((v, i) => ({
        label: String(i),
        value: typeof v === "number" ? v : parseFloat(v) || 0,
        color: null,
      }));
    }
    if (data && typeof data === "object") {
      return Object.entries(data).map(([label, value]) => ({
        label,
        value: typeof value === "number" ? value : parseFloat(value) || 0,
        color: null,
      }));
    }
    return [];
  }

  _renderBarChart(data, options = {}) {
    const title = options.title || "";
    const chartWidth = options.width || Math.min(this.columns - 10, 60);
    const chartHeight = options.height || 10;
    const maxVal = Math.max(...data.map(d => d.value), 1);

    // Label area width
    const maxLabelLen = Math.max(...data.map(d => visualLen(d.label)), 3);
    const labelWidth = Math.min(maxLabelLen + 1, 16);
    const barArea = chartWidth - labelWidth - 2;

    const out = [];
    if (title) out.push(`${THEME.bold}${title}${ANSI.reset}\n`);

    // Y-axis labels and bars
    const colors = [THEME.info, THEME.toolSuccess, THEME.brightYellow, THEME.accent, THEME.toolIndicator];
    for (let di = 0; di < data.length; di++) {
      const d = data[di];
      const barLen = Math.max(1, Math.round((d.value / maxVal) * barArea));
      const bar = repeatStr("█", barLen);
      const valStr = String(d.value);
      const color = d.color || colors[di % colors.length] || THEME.info;
      const labelPad = padLeft(truncate(d.label, labelWidth - 2), labelWidth - 1);

      out.push(`${THEME.dim}${labelPad}${ANSI.reset} ${THEME.border}│${ANSI.reset}${color}${bar}${ANSI.reset} ${THEME.dim}${valStr}${ANSI.reset}`);
    }

    // X-axis
    out.push(`${" ".repeat(labelWidth + 1)}${THEME.border}╰${repeatStr("─", barArea)}${ANSI.reset}`);

    return out.join("\n");
  }

  _renderLineChart(data, options = {}) {
    const title = options.title || "";
    const chartWidth = options.width || Math.min(this.columns - 10, 60);
    const chartHeight = options.height || 10;
    const maxVal = Math.max(...data.map(d => d.value), 1);

    const dots = ["·", "•", "●", "○", "◇", "◆", "□", "■"];
    const out = [];
    if (title) out.push(`${THEME.bold}${title}${ANSI.reset}\n`);

    // Y-axis with grid
    for (let row = chartHeight; row >= 0; row--) {
      let line = "";
      const normalizedY = maxVal * (row / chartHeight);

      // Y-axis label
      if (row === chartHeight) {
        line += padLeft(String(Math.round(maxVal)), 6) + " ";
      } else if (row === 0) {
        line += padLeft("0", 6) + " ";
      } else {
        line += repeatStr(" ", 6) + " ";
      }

      line += THEME.border + (row === 0 ? "╰" : "│") + ANSI.reset;

      // Plot points
      for (let x = 0; x < chartWidth - 8; x++) {
        const dataIdx = Math.round((x / (chartWidth - 8)) * (data.length - 1));
        const clampedIdx = clamp(dataIdx, 0, data.length - 1);
        const actualY = (data[clampedIdx].value / maxVal) * chartHeight;

        if (Math.abs(actualY - row) < 0.75) {
          const lineColor = THEME.info;
          if (clampedIdx % 2 === 0) {
            line += lineColor + dots[0] + ANSI.reset;
          } else {
            line += lineColor + dots[1] + ANSI.reset;
          }
        } else if (row === 0) {
          line += THEME.border + "─" + ANSI.reset;
        } else {
          line += " ";
        }
      }
      out.push(line);
    }

    // X-axis labels
    let xLabelLine = repeatStr(" ", 8);
    const step = Math.max(1, Math.floor(data.length / 5));
    for (let i = 0; i < data.length; i += step) {
      xLabelLine += truncate(data[i].label, 5).padEnd(6);
    }
    out.push(`${THEME.dim}${xLabelLine}${ANSI.reset}`);

    return out.join("\n");
  }

  _renderPieChart(data, options = {}) {
    const title = options.title || "";
    const total = data.reduce((sum, d) => sum + d.value, 0);
    if (total === 0) return this._renderEmpty("No chart data");

    const out = [];
    if (title) out.push(`${THEME.bold}${title}${ANSI.reset}\n`);

    // Simple ASCII pie using proportional segments
    const segments = "●●○○○○○○○○○○○○○○○○○○○○○○○○○○○○○○●●";
    const colors = [THEME.info, THEME.toolSuccess, THEME.brightYellow, THEME.accent, THEME.toolIndicator, THEME.assistantIndicator, THEME.heading, ANSI.brightGreen];

    const sorted = [...data].sort((a, b) => b.value - a.value);

    // Legend with proportional bars
    for (let i = 0; i < sorted.length; i++) {
      const d = sorted[i];
      const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0.0";
      const barLen = Math.max(1, Math.round((d.value / total) * 30));
      const bar = repeatStr("█", barLen);
      const color = d.color || colors[i % colors.length];
      const label = truncate(d.label, 20);
      out.push(`${color}${THEME.bold}●${ANSI.reset} ${label.padEnd(22)} ${color}${bar}${ANSI.reset} ${pct}%`);
    }

    out.push(`${THEME.dim}Total: ${total}${ANSI.reset}`);
    return out.join("\n");
  }

  // ── File Tree ──────────────────────────────────────────────────────

  /**
   * Render a file tree structure.
   *
   * @param {object|Array} tree - Tree node or array of nodes
   * @param {object} [options]
   * @param {string} [options.title] - Title
   * @returns {string}
   */
  _renderFileTree(tree, options = {}) {
    const title = options.title || "";

    const out = [];
    if (title) out.push(`${THEME.bold}${title}${ANSI.reset}\n`);

    const nodes = Array.isArray(tree) ? tree : (tree.children || tree.entries || [tree]);
    out.push(this._renderTreeNode(nodes, ""));

    return out.join("\n");
  }

  _renderTreeNode(nodes, prefix) {
    const lines = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const isLast = i === nodes.length - 1;
      const branch = isLast ? BOX.treeLast : BOX.treeBranch;
      const name = node.name || node.label || String(node);

      let icon = "";
      if (node.type === "directory" || node.children || node.entries) {
        icon = `${THEME.info}${BOX.bullet}${ANSI.reset} `;
        lines.push(`${prefix}${branch} ${icon}${THEME.bold}${name}/${ANSI.reset}`);
        const children = node.children || node.entries || [];
        const childPrefix = prefix + (isLast ? BOX.treeSpace : BOX.treeDown);
        lines.push(this._renderTreeNode(children, childPrefix));
      } else {
        // Color by extension
        let fileColor = ANSI.reset;
        if (/\.(js|ts|jsx|tsx|mjs|cjs)$/.test(name)) fileColor = THEME.brightYellow;
        else if (/\.(json|yaml|yml|toml)$/.test(name)) fileColor = THEME.toolSuccess;
        else if (/\.(md|txt|rst)$/.test(name)) fileColor = THEME.dim;
        else if (/\.(py|rb|go|rs)$/.test(name)) fileColor = THEME.info;
        else if (/\.(css|scss|less)$/.test(name)) fileColor = THEME.accent;
        else if (/\.(html|xml|svg)$/.test(name)) fileColor = THEME.toolIndicator;
        else if (/\.(sh|bash|zsh)$/.test(name)) fileColor = THEME.toolSuccess;

        if (node.size) {
          lines.push(`${prefix}${branch} ${fileColor}${name}${ANSI.reset} ${THEME.dim}${formatBytes(node.size)}${ANSI.reset}`);
        } else {
          lines.push(`${prefix}${branch} ${fileColor}${name}${ANSI.reset}`);
        }
      }
    }
    return lines.join("\n");
  }

  // ── Key-Value ──────────────────────────────────────────────────────

  /**
   * Render key-value pairs in a formatted style.
   *
   * @param {object|Map|Array} data - Key-value data
   * @param {object} [options]
   * @param {string} [options.title] - Section title
   * @returns {string}
   */
  _renderKeyValue(data, options = {}) {
    const title = options.title || "";

    let entries;
    if (data instanceof Map) {
      entries = [...data.entries()];
    } else if (Array.isArray(data)) {
      entries = data.map(item => {
        if (Array.isArray(item)) return item;
        if (item && typeof item === "object") return [item.key || item.name, item.value];
        return [String(item), ""];
      });
    } else if (data && typeof data === "object") {
      entries = Object.entries(data);
    } else {
      return this._renderEmpty("No key-value data");
    }

    if (entries.length === 0) return this._renderEmpty("No key-value data");

    const maxKeyLen = Math.max(...entries.map(([k]) => visualLen(String(k))), 5);
    const out = [];

    if (title) out.push(`${THEME.bold}${title}${ANSI.reset}\n`);

    for (const [key, value] of entries) {
      const k = String(key);
      const v = value !== undefined && value !== null ? String(value) : THEME.dim + "(null)" + ANSI.reset;
      const paddedKey = padRight(k, maxKeyLen + 2);
      out.push(`  ${THEME.accent}${paddedKey}${ANSI.reset}${THEME.dim}${v}${ANSI.reset}`);
    }

    return out.join("\n");
  }

  // ── Mermaid ────────────────────────────────────────────────────────

  /**
   * Render a Mermaid diagram as an ASCII approximation.
   *
   * @param {string} mermaidText - Mermaid diagram source
   * @param {object} [options]
   * @returns {string}
   */
  _renderMermaid(mermaidText, options = {}) {
    if (!mermaidText) return this._renderEmpty("No diagram");

    const lines = mermaidText.split("\n");
    const detectedType = this._detectMermaidType(lines);
    const title = options.title || (detectedType ? `${detectedType} Diagram` : "Diagram");

    const out = [];
    out.push(`${THEME.bold}${title}${ANSI.reset}`);
    out.push(`${THEME.dim}  (Mermaid source — render in viewer for graphical output)${ANSI.reset}\n`);

    // Render source with basic highlighting
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { out.push(""); continue; }

      if (/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|mindmap|timeline)/.test(trimmed)) {
        out.push(`${THEME.accent}${trimmed}${ANSI.reset}`);
      } else if (/^(-->|---|->|==>|-.->|--->|---|===|---)/.test(trimmed)) {
        out.push(`  ${THEME.toolIndicator}${trimmed}${ANSI.reset}`);
      } else if (/^[A-Z]/.test(trimmed) && /[:;]/.test(trimmed)) {
        out.push(`  ${THEME.info}${trimmed}${ANSI.reset}`);
      } else {
        out.push(`  ${THEME.dim}${trimmed}${ANSI.reset}`);
      }
    }

    out.push(`\n${THEME.dim}${repeatStr("─", 40)}${ANSI.reset}`);
    out.push(`${THEME.dim}Tip: paste diagram source into https://mermaid.live${ANSI.reset}`);

    return out.join("\n");
  }

  _detectMermaidType(lines) {
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed.startsWith("graph") || trimmed.startsWith("flowchart")) return "Flowchart";
      if (trimmed.startsWith("sequencediagram")) return "Sequence";
      if (trimmed.startsWith("classdiagram")) return "Class";
      if (trimmed.startsWith("statediagram")) return "State";
      if (trimmed.startsWith("erdiagram")) return "ER";
      if (trimmed.startsWith("gantt")) return "Gantt";
      if (trimmed.startsWith("pie")) return "Pie";
      if (trimmed.startsWith("gitgraph")) return "Git";
      if (trimmed.startsWith("mindmap")) return "Mind Map";
      if (trimmed.startsWith("timeline")) return "Timeline";
    }
    return null;
  }

  // ── Text ───────────────────────────────────────────────────────────

  _renderText(content, options = {}) {
    if (!content && content !== 0) return this._renderEmpty("No content");
    const text = String(content);
    const title = options.title || "";
    const out = [];
    if (title) out.push(`${THEME.bold}${title}${ANSI.reset}\n`);
    out.push(text);
    return out.join("\n");
  }

  _renderEmpty(message) {
    return `${THEME.dim}(${message})${ANSI.reset}`;
  }
}

// ── Utility: formatBytes (mirrors renderer.js) ──────────────────────────

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

module.exports = { MultiModalRenderer, BOX, formatBytes };
