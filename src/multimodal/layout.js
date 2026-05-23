"use strict";

const { ANSI, THEME } = require("../renderer");

// ── Unicode box-drawing constants ───────────────────────────────────────

const G = {
  h: "─", v: "│",
  tl: "╭", tr: "╮", bl: "╰", br: "╯",
  t: "┬", b: "┴", l: "├", r: "┤", x: "┼",
  dh: "═", dv: "║",
  dtl: "╔", dtr: "╗", dbl: "╚", dbr: "╝",
  dt: "╦", db: "╩", dl: "╠", dr: "╣", dx: "╬",
  fill: " ", shade: "░", shadeD: "▒", shadeDD: "▓",
  vDash: "┆", hDash: "┄",
  teeR: "├", teeL: "┤",
  arrowR: "→", arrowL: "←", arrowU: "↑", arrowD: "↓",
  ball: "●", circle: "○", diamond: "◇", triangle: "▶",
  bullet: "•", dot: "·", star: "★",
  tabSigned: "┐",
};

// ── Helpers ─────────────────────────────────────────────────────────────

function repeat(ch, count) {
  if (count <= 0) return "";
  return String(ch).repeat(count);
}

function stripAnsi(text) {
  return String(text).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function visualLen(str) {
  return stripAnsi(String(str)).length;
}

function padRight(str, width) {
  const v = visualLen(str);
  if (v >= width) return str;
  return str + " ".repeat(width - v);
}

function padCenter(str, width) {
  const v = visualLen(str);
  if (v >= width) return str;
  const left = Math.floor((width - v) / 2);
  const right = width - v - left;
  return " ".repeat(left) + str + " ".repeat(right);
}

function truncate(str, maxLen) {
  const s = String(str);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

function visualTruncate(str, maxLen) {
  const s = String(str);
  const plain = stripAnsi(s);
  if (plain.length <= maxLen) return s;
  // Conservative: cut s at a safe point
  let visible = 0;
  let i = 0;
  while (i < s.length && visible < maxLen - 3) {
    if (s[i] === "\x1B") {
      while (i < s.length && s[i] !== "m") i++;
      i++;
    } else {
      visible++;
      i++;
    }
  }
  return s.slice(0, i) + "...";
}

// ── LayoutEngine ────────────────────────────────────────────────────────

class LayoutEngine {
  constructor(options = {}) {
    this.columns = options.columns || 80;
    this.rows = options.rows || 24;
    this.ansiEnabled = options.ansiEnabled !== false;
    this.borderStyle = options.borderStyle || "rounded"; // rounded | double | ascii
  }

  // ── Border style selection ──────────────────────────────────────────

  _glyph(single, double) {
    if (!this.ansiEnabled) return single;
    if (this.borderStyle === "double") return double || single;
    return single;
  }

  _borderTop(width) {
    const self = this;
    return `${THEME.border}${self._glyph(G.tl, G.dtl)}${repeat(self._glyph(G.h, G.dh), width)}${self._glyph(G.tr, G.dtr)}${ANSI.reset}`;
  }

  _borderBottom(width) {
    const self = this;
    return `${THEME.border}${self._glyph(G.bl, G.dbl)}${repeat(self._glyph(G.h, G.dh), width)}${self._glyph(G.br, G.dbr)}${ANSI.reset}`;
  }

  _borderH(width) {
    const self = this;
    return `${THEME.border}${self._glyph(G.teeR, G.dl)}${repeat(self._glyph(G.h, G.dh), width)}${self._glyph(G.teeL, G.dr)}${ANSI.reset}`;
  }

  _borderV() {
    return `${THEME.border}${this._glyph(G.v, G.dv)}${ANSI.reset}`;
  }

  // ── Horizontal split layout ────────────────────────────────────────

  /**
   * Split available space horizontally into panels.
   *
   * @param {Array<{content: string, width?: number|string, title?: string}>} panels
   *   Each panel: content (multi-line string), optional width (number or percentage like "30%"), optional title
   * @param {object} [options]
   * @returns {string}
   */
  splitHorizontal(panels, options = {}) {
    if (!panels || panels.length === 0) return "";

    const gutter = options.gutter || 1;
    const totalWidth = this.columns - 2;
    const available = totalWidth - (panels.length - 1) * gutter;

    // Resolve widths
    let fixedCount = 0;
    let fixedSum = 0;

    for (const p of panels) {
      if (typeof p.width === "number") {
        fixedSum += p.width;
        fixedCount++;
      } else if (typeof p.width === "string" && p.width.endsWith("%")) {
        const pct = parseFloat(p.width) / 100;
        const w = Math.floor(available * pct);
        p._resolvedWidth = w;
        fixedSum += w;
        fixedCount++;
      }
    }

    const remaining = available - fixedSum;
    const autoCount = panels.length - fixedCount;
    const autoWidth = autoCount > 0 ? Math.floor(remaining / autoCount) : 0;

    for (const p of panels) {
      if (p._resolvedWidth === undefined) {
        p._resolvedWidth = autoWidth;
      }
    }

    // Render each panel
    const panelLines = panels.map(p => {
      const w = p._resolvedWidth;
      const contentLines = this._splitToLines(p.content, w - 2);
      const lines = [];

      if (p.title) {
        lines.push(padCenter(`${THEME.bold}${p.title}${ANSI.reset}`, w));
      }
      for (const l of contentLines) {
        lines.push(padRight(l, w));
      }
      return lines;
    });

    // Equalize heights
    const maxHeight = Math.max(...panelLines.map(p => p.length));
    for (const pl of panelLines) {
      while (pl.length < maxHeight) pl.push(" ".repeat(pl[0] ? visualLen(pl[0]) : 0));
    }

    // Interleave rows
    const out = [];
    for (let row = 0; row < maxHeight; row++) {
      const rowParts = panelLines.map((pl, i) => {
        const w = panels[i]._resolvedWidth;
        let cell = pl[row] || "";
        cell = padRight(cell, w);
        return i === 0 ? cell : cell;
      });
      // Add gutter between panels
      let line = rowParts[0];
      for (let i = 1; i < rowParts.length; i++) {
        if (gutter > 0 && panels[i - 1]._resolvedWidth > 0) {
          const sepStyle = gutter > 1 ?
            THEME.border + repeat(G.v, 1) + ANSI.reset + " ".repeat(gutter - 1) :
            THEME.border + G.v + ANSI.reset;
          line += sepStyle + rowParts[i];
        } else {
          line += rowParts[i];
        }
      }
      out.push(line);
    }

    return out.join("\n");
  }

  // ── Vertical split layout ──────────────────────────────────────────

  /**
   * Split available space vertically into panels.
   *
   * @param {Array<{content: string, height?: number|string, title?: string}>} panels
   * @param {object} [options]
   * @returns {string}
   */
  splitVertical(panels, options = {}) {
    if (!panels || panels.length === 0) return "";

    const totalHeight = options.totalHeight || this.rows - 2;
    const separator = options.separator !== false;
    const sepHeight = separator ? 1 : 0;
    const available = totalHeight - (panels.length - 1) * sepHeight;

    // Resolve heights
    let fixedSum = 0;
    let autoCount = 0;
    for (const p of panels) {
      if (typeof p.height === "number") {
        p._resolvedHeight = p.height;
        fixedSum += p.height;
      } else if (typeof p.height === "string" && p.height.endsWith("%")) {
        const pct = parseFloat(p.height) / 100;
        p._resolvedHeight = Math.floor(available * pct);
        fixedSum += p._resolvedHeight;
      } else {
        autoCount++;
      }
    }
    const autoHeight = autoCount > 0 ? Math.floor((available - fixedSum) / autoCount) : 5;

    for (const p of panels) {
      if (p._resolvedHeight === undefined) p._resolvedHeight = autoHeight;
    }

    const width = this.columns - 2;
    const out = [];

    for (let pi = 0; pi < panels.length; pi++) {
      const p = panels[pi];
      const h = p._resolvedHeight;
      const innerWidth = width - 4;

      // Top border
      out.push(this._borderTop(width));

      // Title row
      if (p.title) {
        const titleStr = ` ${THEME.bold}${truncate(p.title, innerWidth - 2)}${ANSI.reset} `;
        out.push(`${this._borderV()} ${padRight(titleStr, innerWidth)} ${this._borderV()}`);
        // Title separator
        out.push(`${this._borderV()} ${THEME.border}${repeat(G.h, innerWidth)}${ANSI.reset} ${this._borderV()}`);
      }

      // Content
      const contentLines = this._splitToLines(p.content, innerWidth);
      const displayLines = contentLines.slice(0, Math.max(1, h - (p.title ? 2 : 0)));
      for (const line of displayLines) {
        out.push(`${this._borderV()} ${padRight(line, innerWidth)} ${this._borderV()}`);
      }

      // Fill remaining space
      const usedLines = (p.title ? 2 : 0) + displayLines.length;
      for (let i = usedLines; i < h; i++) {
        out.push(`${this._borderV()} ${" ".repeat(innerWidth)} ${this._borderV()}`);
      }

      // Bottom border
      out.push(this._borderBottom(width));
    }

    return out.join("\n");
  }

  // ── Grid layout ────────────────────────────────────────────────────

  /**
   * Create a grid layout of rows x cols cells.
   *
   * @param {number} rows - Number of grid rows
   * @param {number} cols - Number of grid columns
   * @param {Array<Array<string>>|Function} content - 2D array of cell content strings, or generator function (row, col) => string
   * @param {object} [options]
   * @param {number} [options.colWidth] - Width per cell
   * @param {number} [options.rowHeight] - Height per cell
   * @returns {string}
   */
  createGrid(rows, cols, content, options = {}) {
    if (rows <= 0 || cols <= 0) return "";

    const colWidth = options.colWidth || Math.floor((this.columns - 2) / cols) - 2;
    const rowHeight = options.rowHeight || 3;
    const totalWidth = (colWidth + 1) * cols + 1;

    const out = [];

    for (let r = 0; r < rows; r++) {
      // Top border of this row
      if (r === 0) {
        let topLine = THEME.border + G.tl;
        for (let c = 0; c < cols; c++) {
          topLine += repeat(G.h, colWidth);
          topLine += c < cols - 1 ? G.t : G.tr;
        }
        out.push(topLine + ANSI.reset);
      } else {
        let sepLine = THEME.border + G.teeR;
        for (let c = 0; c < cols; c++) {
          sepLine += repeat(G.h, colWidth);
          sepLine += c < cols - 1 ? G.x : G.teeL;
        }
        out.push(sepLine + ANSI.reset);
      }

      // Content lines
      for (let line = 0; line < rowHeight; line++) {
        let contentLine = this._borderV();
        for (let c = 0; c < cols; c++) {
          let cellContent = "";
          if (typeof content === "function") {
            cellContent = content(r, c) || "";
          } else if (Array.isArray(content) && Array.isArray(content[r])) {
            cellContent = String(content[r][c] || "");
          }

          // Get the Nth line of cell content
          const cellLines = this._splitToLines(cellContent, colWidth - 2);
          const lineContent = cellLines[line] || "";
          contentLine += " " + padRight(lineContent, colWidth - 2) + " ";
          contentLine += this._borderV();
        }
        out.push(contentLine);
      }
    }

    // Bottom border
    let bottomLine = THEME.border + G.bl;
    for (let c = 0; c < cols; c++) {
      bottomLine += repeat(G.h, colWidth);
      bottomLine += c < cols - 1 ? G.b : G.br;
    }
    out.push(bottomLine + ANSI.reset);

    return out.join("\n");
  }

  // ── Tabs ───────────────────────────────────────────────────────────

  /**
   * Create a tabbed interface.
   *
   * @param {Array<{label: string, content: string, active?: boolean}>} tabs
   * @param {object} [options]
   * @returns {string}
   */
  createTabs(tabs, options = {}) {
    if (!tabs || tabs.length === 0) return "";

    const activeIndex = options.activeIndex !== undefined
      ? options.activeIndex
      : tabs.findIndex(t => t.active);
    const active = activeIndex >= 0 ? activeIndex : 0;

    const width = this.columns - 2;
    const innerWidth = width - 4;

    const out = [];

    // Tab bar
    let tabBar = "";
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i];
      const isActive = i === active;
      const label = ` ${truncate(t.label, 20)} `;

      if (isActive) {
        tabBar += THEME.border + G.tl + repeat(G.h, 1);
        tabBar += `${THEME.bold}${label}${ANSI.reset}`;
        tabBar += repeat(G.h, 1) + G.tr + ANSI.reset + " ";
      } else {
        tabBar += THEME.dim + " " + label + " " + ANSI.reset;
        tabBar += THEME.border + G.v + ANSI.reset + " ";
      }
    }
    out.push(tabBar);

    // Content area
    out.push(this._borderTop(width));

    const activeTab = tabs[active];
    const contentLines = this._splitToLines(activeTab.content, innerWidth);

    for (const line of contentLines) {
      out.push(`${this._borderV()} ${padRight(line, innerWidth)} ${this._borderV()}`);
    }

    // Fill remaining if maxRows specified
    if (options.maxRows) {
      const used = contentLines.length;
      for (let i = used; i < options.maxRows; i++) {
        out.push(`${this._borderV()} ${" ".repeat(innerWidth)} ${this._borderV()}`);
      }
    }

    out.push(this._borderBottom(width));

    return out.join("\n");
  }

  // ── Panel ──────────────────────────────────────────────────────────

  /**
   * Create a bordered content panel with optional title.
   *
   * @param {string} title - Panel title (can be empty)
   * @param {string} content - Panel content (multi-line)
   * @param {string} [style] - Style variant: "default", "primary", "success", "warning", "error", "info"
   * @param {object} [options]
   * @param {number} [options.width] - Panel width
   * @param {number} [options.maxHeight] - Max content height before truncation
   * @param {boolean} [options.collapsible] - Add collapse indicator
   * @returns {string}
   */
  createPanel(title, content, style = "default", options = {}) {
    const width = options.width || Math.min(this.columns - 2, 80);
    const innerWidth = width - 4;
    const maxHeight = options.maxHeight || 0;
    const collapsible = options.collapsible || false;

    const styleColors = {
      default: THEME.border,
      primary: THEME.info,
      success: THEME.toolSuccess,
      warning: THEME.brightYellow,
      error: THEME.toolError,
      info: THEME.info,
    };
    const borderColor = styleColors[style] || THEME.border;

    const out = [];

    // Top border with title
    if (title) {
      const titleStr = truncate(title, innerWidth - 2);
      const collapseIcon = collapsible ? ` ${THEME.dim}${G.triangle}${ANSI.reset}` : "";
      const titlePadded = ` ${THEME.bold}${titleStr}${ANSI.reset}${collapseIcon} `;
      const remaining = innerWidth + 2 - visualLen(titlePadded);
      out.push(
        `${borderColor}${G.tl}${repeat(G.h, 3)} ${titlePadded}${repeat(G.h, Math.max(0, remaining))}${G.tr}${ANSI.reset}`
      );
    } else {
      out.push(`${borderColor}${G.tl}${repeat(G.h, width)}${G.tr}${ANSI.reset}`);
    }

    // Content
    const contentLines = this._splitToLines(content, innerWidth);
    const displayLines = maxHeight > 0 ? contentLines.slice(0, maxHeight) : contentLines;

    for (const line of displayLines) {
      out.push(`${borderColor}${G.v}${ANSI.reset} ${padRight(line, innerWidth)} ${borderColor}${G.v}${ANSI.reset}`);
    }

    if (maxHeight > 0 && contentLines.length > maxHeight) {
      out.push(
        `${borderColor}${G.v}${ANSI.reset} ` +
        `${THEME.dim}... ${contentLines.length - maxHeight} more line${contentLines.length - maxHeight !== 1 ? "s" : ""}${ANSI.reset}` +
        ` ${" ".repeat(Math.max(0, innerWidth - String(contentLines.length - maxHeight).length - 13))}` +
        ` ${borderColor}${G.v}${ANSI.reset}`
      );
    }

    // Bottom border
    out.push(`${borderColor}${G.bl}${repeat(G.h, width)}${G.br}${ANSI.reset}`);

    return out.join("\n");
  }

  // ── Status bar ─────────────────────────────────────────────────────

  /**
   * Create a status bar with left, center, and right sections.
   *
   * @param {Array<{text: string, align?: string, style?: string}|string>} items
   *   Items with optional alignment ("left", "center", "right") and style.
   *   Simple string items are treated as left-aligned.
   * @param {object} [options]
   * @param {string} [options.position] - "top" or "bottom" (default "bottom")
   * @returns {string}
   */
  createStatusBar(items, options = {}) {
    if (!items || items.length === 0) return "";

    const width = this.columns;
    const position = options.position || "bottom";

    const out = [];

    // Top separator for bottom bars
    if (position === "bottom") {
      out.push(`${THEME.border}${repeat(G.h, width)}${ANSI.reset}`);
    }

    // Collect items by alignment
    const leftItems = [];
    const centerItems = [];
    const rightItems = [];

    for (const item of items) {
      const parsed = typeof item === "string"
        ? { text: item, align: "left", style: null }
        : {
            text: item.text || "",
            align: item.align || "left",
            style: item.style || null,
          };

      const styleColor = parsed.style === "warning" ? THEME.warning :
        parsed.style === "error" ? THEME.toolError :
        parsed.style === "success" ? THEME.toolSuccess :
        parsed.style === "info" ? THEME.info :
        parsed.style === "dim" ? THEME.dim :
        null;

      const styledText = styleColor ? `${styleColor}${parsed.text}${ANSI.reset}` : parsed.text;

      if (parsed.align === "center") centerItems.push(styledText);
      else if (parsed.align === "right") rightItems.push(styledText);
      else leftItems.push(styledText);
    }

    // Build bar
    let bar = "";
    const bgColor = THEME.bgBrightBlack + THEME.brightWhite;

    // Left section
    if (leftItems.length > 0) {
      bar += ` ${leftItems.join(` ${THEME.dim}${G.v}${ANSI.reset}${bgColor} `)} `;
    }

    // Calculate remaining space and position center/right
    const leftLen = stripAnsi(bar).length;
    const centerStr = centerItems.length > 0 ? ` ${centerItems.join(` ${THEME.dim}${G.v}${ANSI.reset} `)} ` : "";
    const rightStr = rightItems.length > 0 ? ` ${rightItems.join(` ${THEME.dim}${G.v}${ANSI.reset} `)} ` : "";

    const centerLen = stripAnsi(centerStr).length;
    const rightLen = stripAnsi(rightStr).length;

    // Simple approach: left, then fill to center, then fill to right
    const rightStart = width - rightLen;
    const centerStart = Math.floor((width - centerLen) / 2);

    // Build with proper spacing
    bar = bgColor;
    let pos = 0;

    // Left items
    for (let i = 0; i < leftItems.length; i++) {
      if (i > 0) {
        bar += ` ${THEME.dim}${G.v}${ANSI.reset}${bgColor} `;
        pos += 4;
      }
      bar += leftItems[i];
      pos += stripAnsi(leftItems[i]).length;
    }

    // Pad to center
    const targetCenter = Math.max(pos + 1, centerStart);
    bar += " ".repeat(targetCenter - pos);
    pos = targetCenter;

    // Center items
    for (let i = 0; i < centerItems.length; i++) {
      if (i > 0) {
        bar += ` ${THEME.dim}${G.v}${ANSI.reset}${bgColor} `;
        pos += 4;
      }
      bar += centerItems[i];
      pos += stripAnsi(centerItems[i]).length;
    }

    // Pad to right
    const targetRight = Math.max(pos + 1, rightStart);
    bar += " ".repeat(targetRight - pos);
    pos = targetRight;

    // Right items
    for (let i = 0; i < rightItems.length; i++) {
      if (i > 0) {
        bar += ` ${THEME.dim}${G.v}${ANSI.reset}${bgColor} `;
        pos += 4;
      }
      bar += rightItems[i];
      pos += stripAnsi(rightItems[i]).length;
    }

    // Fill remaining
    bar += " ".repeat(Math.max(0, width - pos));
    bar += ANSI.reset;

    out.push(bar);

    // Bottom separator for top bars
    if (position === "top") {
      out.push(`${THEME.border}${repeat(G.h, width)}${ANSI.reset}`);
    }

    return out.join("\n");
  }

  // ── Utility ────────────────────────────────────────────────────────

  /**
   * Split text into lines, respecting display width for wrapping.
   */
  _splitToLines(text, maxWidth) {
    if (!text) return [""];
    if (maxWidth <= 0) return [String(text)];
    const lines = String(text).split("\n");
    const result = [];

    for (const line of lines) {
      if (line === "") { result.push(""); continue; }
      let remaining = line;
      while (remaining.length > 0) {
        const vLen = visualLen(remaining);
        if (vLen <= maxWidth) {
          result.push(remaining);
          break;
        }
        // Find safe break point
        let cut = maxWidth;
        const searchStart = Math.min(maxWidth - 1, remaining.length - 1);
        for (let i = searchStart; i >= Math.max(1, searchStart - 15); i--) {
          if (remaining[i] === " " || remaining[i] === "-" || remaining[i] === ".") {
            cut = i + 1;
            break;
          }
        }
        // Fallback: hard break at maxWidth if no break point found
        if (cut > remaining.length) cut = remaining.length;
        result.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut).trimStart();
        // Safety: if we didn't consume anything, force-advance
        if (remaining.length === line.slice(0, cut).length) break;
      }
    }

    return result.length > 0 ? result : [""];
  }

  /**
   * Create a simple horizontal rule / separator line.
   *
   * @param {object} [options]
   * @param {string} [options.label] - Centered label text
   * @param {number} [options.width] - Line width
   * @returns {string}
   */
  divider(options = {}) {
    const width = options.width || this.columns - 2;
    const label = options.label || "";

    if (label) {
      const labelStr = ` ${label} `;
      const labelLen = visualLen(labelStr);
      const sideLen = Math.floor((width - labelLen) / 2);
      return `${THEME.border}${repeat(G.h, sideLen)}${ANSI.reset}${THEME.dim}${labelStr}${ANSI.reset}${THEME.border}${repeat(G.h, width - labelLen - sideLen)}${ANSI.reset}`;
    }

    return `${THEME.border}${repeat(G.h, width)}${ANSI.reset}`;
  }

  /**
   * Create a progress bar.
   *
   * @param {number} current - Current value
   * @param {number} total - Maximum value
   * @param {object} [options]
   * @param {number} [options.width] - Bar width
   * @param {string} [options.label] - Label text
   * @returns {string}
   */
  progressBar(current, total, options = {}) {
    const width = options.width || 30;
    const label = options.label || "";
    const pct = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
    const filled = Math.round(pct * width);
    const empty = width - filled;
    const pctStr = ` ${Math.round(pct * 100)}%`;

    let bar = THEME.bgBrightBlack;
    for (let i = 0; i < width; i++) {
      if (i < filled) {
        bar += THEME.toolSuccess + G.shadeDD + ANSI.reset + THEME.bgBrightBlack;
      } else {
        bar += THEME.dim + G.shade + ANSI.reset + THEME.bgBrightBlack;
      }
    }
    bar += ANSI.reset;

    if (label) {
      return `${THEME.dim}${label}${ANSI.reset} ${bar}${pctStr}`;
    }
    return `${bar}${pctStr}`;
  }
}

module.exports = { LayoutEngine, G };
