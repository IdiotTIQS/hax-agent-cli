"use strict";

/**
 * ascii-charts — generates ASCII/Unicode text-based charts.
 *
 * All charts use Unicode box-drawing and block characters with zero external
 * dependencies.  Output is plain text ready for terminal display.
 */

// ---------------------------------------------------------------------------
// Constants — Unicode drawing characters
// ---------------------------------------------------------------------------

const BOX = {
  H: "─",       // ─
  V: "│",       // │
  TL: "┌",      // ┌
  TR: "┐",      // ┐
  BL: "└",      // └
  BR: "┘",      // ┘
  HD: "┬",      // ┬
  HU: "┴",      // ┴
  VL: "├",      // ├
  VR: "┤",      // ┤
  CR: "┼",      // ┼
  D: "╭",       // ╭  (rounded TL)
  DR: "╮",      // ╮  (rounded TR)
  DL: "╯",      // ╯  (rounded BR)
  DD: "╰",      // ╰  (rounded BL)
  DH: "─",      // ─  (rounded horiz)
  DV: "│",      // │  (rounded vert)

  BLOCK: "█",   // █
  LOWER: {
    1: "▁", 2: "▂", 3: "▃", 4: "▄",
    5: "▅", 6: "▆", 7: "▇",
  },
  LHALF: "▌",   // ▌
  RHALF: "▐",   // ▐
  FULL: "█",    // █
  DARK: "▓",    // ▓
  MEDIUM: "▒",  // ▒
  LIGHT: "░",   // ░

  // Tree characters
  TREE_V: "│",  // │
  TREE_L: "├",  // ├
  TREE_E: "└",  // └
  TREE_H: "─",  // ─
  TREE_T: "┬",  // ┬
};

const SPARK_BLOCKS = [
  "▁", "▂", "▃", "▄",
  "▅", "▆", "▇", "█",
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _clamp(val, lo, hi) {
  return Math.max(lo, Math.min(hi, val));
}

function _repeat(ch, n) {
  if (n <= 0) return "";
  return ch.repeat(Math.floor(n));
}

function _padRight(str, len) {
  const s = String(str);
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function _padLeft(str, len) {
  const s = String(str);
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

function _round(v) {
  return Math.round(v);
}

function _max(arr) {
  if (!arr || arr.length === 0) return 0;
  let m = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > m) m = arr[i];
  }
  return m;
}

function _min(arr) {
  if (!arr || arr.length === 0) return 0;
  let m = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < m) m = arr[i];
  }
  return m;
}

function _normalizeValues(values, max) {
  const m = max || _max(values);
  if (m === 0) return values.map(() => 0);
  return values.map(v => _clamp(v / m, 0, 1));
}

// ---------------------------------------------------------------------------
// barChart — vertical and horizontal bar charts with Unicode blocks
// ---------------------------------------------------------------------------

/**
 * Render a bar chart.
 *
 * @param {object} data
 * @param {Array<{label:string, value:number}>} data.bars — bar entries
 * @param {object} [options]
 * @param {string} [options.orientation="horizontal"] — "horizontal" or "vertical"
 * @param {number} [options.width=40] — chart width in characters
 * @param {number} [options.height=10] — chart height for vertical bars
 * @param {boolean} [options.showValues=true] — show numeric values
 * @param {string} [options.title] — optional chart title
 * @param {string} [options.fillChar] — custom fill character
 * @returns {string} bar chart as plain text
 */
function barChart(data, options) {
  options = options || {};
  const bars = Array.isArray(data) ? data : (Array.isArray(data.bars) ? data.bars : []);
  const orientation = options.orientation || "horizontal";
  const width = _clamp(options.width || 40, 10, 120);
  const height = _clamp(options.height || 10, 3, 40);
  const showValues = options.showValues !== false;
  const title = options.title || "";
  const fillChar = options.fillChar || BOX.BLOCK;

  if (bars.length === 0) return title ? `${title}\n(no data)` : "(no data)";

  if (orientation === "vertical") {
    return _barChartVertical(bars, width, height, showValues, title, fillChar);
  }
  return _barChartHorizontal(bars, width, showValues, title, fillChar);
}

function _barChartHorizontal(bars, width, showValues, title, fillChar) {
  const lines = [];
  if (title) {
    lines.push(title);
    lines.push(BOX.H.repeat(Math.min(title.length + 4, 60)));
  }

  const maxVal = _max(bars.map(b => b.value));
  const labelWidth = _max(bars.map(b => String(b.label || "").length)) + 1;
  const barWidth = Math.max(5, width - labelWidth - 10);

  for (const bar of bars) {
    const label = _padRight(String(bar.label || ""), labelWidth);
    const ratio = maxVal > 0 ? bar.value / maxVal : 0;
    const filled = Math.round(ratio * barWidth);
    const rest = Math.max(0, barWidth - filled);
    const fill = _repeat(fillChar, filled);
    const empty = _repeat(" ", rest);
    const valueStr = showValues ? ` ${bar.value}` : "";
    lines.push(`${label}${BOX.V}${fill}${empty}${BOX.V}${valueStr}`);
  }

  lines.push(_repeat(BOX.H, labelWidth + barWidth + 2));
  lines.push(` Max: ${maxVal}`);
  return lines.join("\n");
}

function _barChartVertical(bars, width, height, showValues, title, fillChar) {
  const lines = [];
  if (title) lines.push(title);

  const maxVal = _max(bars.map(b => b.value));
  const colWidth = Math.max(3, Math.floor(width / bars.length) - 1);
  const norms = bars.map(b => (maxVal > 0 ? b.value / maxVal : 0));

  // Build rows from top to bottom
  for (let row = height; row >= 0; row--) {
    let line = "";
    for (let c = 0; c < bars.length; c++) {
      const filledHeight = Math.round(norms[c] * height);
      if (row === 0) {
        line += _padRight(BOX.H.repeat(colWidth), colWidth + 1);
      } else if (row <= filledHeight) {
        line += _padRight(_repeat(fillChar, colWidth), colWidth + 1);
      } else {
        line += _padRight(" ".repeat(colWidth), colWidth + 1);
      }
    }
    // Y-axis labels on the left
    if (row === 0) {
      line = "     " + line;
    } else if (row === height || row === 1) {
      const yLabel = row === height ? _padRight(String(maxVal), 4) : _padRight("0", 4);
      const axisLine = row === 1 ? BOX.TL + BOX.H.repeat(bars.length * (colWidth + 1)) : "";
      line = `${yLabel} ${axisLine ? "" : BOX.V}` + line;
    } else {
      line = `     ${BOX.V}` + line;
    }
    lines.push(line);
  }

  // X-axis labels
  let labelLine = "     ";
  for (const bar of bars) {
    labelLine += _padRight(String(bar.label || "").slice(0, colWidth), colWidth + 1);
  }
  lines.push(labelLine);

  if (showValues) {
    let valLine = "     ";
    for (const bar of bars) {
      valLine += _padRight(String(bar.value), colWidth + 1);
    }
    lines.push(valLine);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// lineChart — line charts with Unicode line-drawing characters
// ---------------------------------------------------------------------------

/**
 * Render a line chart using Unicode characters.
 *
 * @param {object} data
 * @param {Array<number>} data.series — array of numeric values
 * @param {object} [options]
 * @param {number} [options.width=60] — chart width in characters
 * @param {number} [options.height=12] — chart height in characters
 * @param {string} [options.title] — optional chart title
 * @param {boolean} [options.showPoints=true] — show data point markers
 * @param {Array<string>} [options.labels] — x-axis labels
 * @returns {string} line chart as plain text
 */
function lineChart(data, options) {
  options = options || {};
  const series = Array.isArray(data) ? data : (Array.isArray(data.series) ? data.series : []);
  const width = _clamp(options.width || 60, 10, 200);
  const height = _clamp(options.height || 12, 3, 50);
  const title = options.title || "";
  const showPoints = options.showPoints !== false;
  const labels = Array.isArray(options.labels) ? options.labels : [];
  const lines = [];

  if (series.length === 0) return title ? `${title}\n(no data)` : "(no data)";
  if (title) lines.push(title);

  const minVal = _min(series);
  const maxVal = _max(series);
  const range = maxVal - minVal || 1;
  const colWidth = Math.max(1, Math.floor((width - 6) / series.length));

  // Build a grid of characters
  const grid = [];
  for (let r = 0; r <= height; r++) {
    grid[r] = [];
    for (let c = 0; c < series.length; c++) {
      grid[r][c] = " ";
    }
  }

  // Plot points and connecting lines
  for (let c = 0; c < series.length; c++) {
    const normVal = (series[c] - minVal) / range;
    const y = height - Math.round(normVal * height);
    if (showPoints) {
      grid[_clamp(y, 0, height)][c] = "●"; // ●
    }
  }

  // Connect consecutive points
  for (let c = 0; c < series.length - 1; c++) {
    const y1 = height - Math.round(((series[c] - minVal) / range) * height);
    const y2 = height - Math.round(((series[c + 1] - minVal) / range) * height);
    const cy1 = _clamp(y1, 0, height);
    const cy2 = _clamp(y2, 0, height);

    if (cy1 === cy2) {
      grid[cy1][c] = showPoints ? "●" : BOX.H;
      grid[cy1][c + 1] = showPoints ? "●" : BOX.H;
    } else {
      // Draw vertical/horizontal segments
      const lo = Math.min(cy1, cy2);
      const hi = Math.max(cy1, cy2);
      const firstY = cy1 < cy2 ? cy1 : cy2;
      const lastY = cy1 < cy2 ? cy2 : cy1;

      for (let r = lo; r <= hi; r++) {
        if (r === firstY) {
          // Corner piece
          if (cy1 <= cy2) {
            grid[r][c] = showPoints ? "●" : "╰"; // ╰
          } else {
            grid[r][c] = showPoints ? "●" : "╭"; // ╭
          }
          if (c < series.length - 1) grid[r][c + 1] = BOX.H;
        } else if (r === lastY) {
          if (cy1 >= cy2) {
            grid[r][c] = showPoints ? "●" : "╰"; // ╰
          } else {
            grid[r][c] = showPoints ? "●" : "╭"; // ╭
          }
          if (!showPoints) grid[r][c] = "╰";
        } else {
          grid[r][c] = BOX.V;
        }
      }
    }
  }

  // Render grid rows
  const labelWidth = Math.max(String(maxVal).length, String(minVal).length) + 1;
  for (let r = height; r >= 0; r--) {
    let row = "";
    for (let c = 0; c < series.length; c++) {
      row += _repeat(grid[r][c], colWidth);
    }

    // Y-axis labels
    if (r === height) {
      row = `${_padLeft(String(maxVal), labelWidth)} ${BOX.TR}${row}`;
    } else if (r === 0) {
      row = `${_padLeft(String(minVal), labelWidth)} ${BOX.TL}${row}`;
    } else {
      row = `${" ".repeat(labelWidth)} ${BOX.V} ${row}`;
    }
    lines.push(row);
  }

  // X-axis line
  lines.push(`${" ".repeat(labelWidth)}  ${BOX.H.repeat(series.length * colWidth)}`);

  // X-axis labels
  if (labels.length > 0) {
    let labelLine = " ".repeat(labelWidth + 2);
    for (let c = 0; c < series.length; c++) {
      const lbl = labels[c] || "";
      labelLine += _padRight(lbl.slice(0, colWidth), colWidth);
    }
    lines.push(labelLine);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// pieChart — simple pie-like percentage visualization
// ---------------------------------------------------------------------------

/**
 * Render a pie/percentage visualization.
 *
 * @param {object} data
 * @param {Array<{label:string, value:number}>} data.slices — pie slices
 * @param {object} [options]
 * @param {number} [options.radius=8] — approximate radius (impacts chart size)
 * @param {number} [options.width=40] — bar-mode width
 * @param {string} [options.title] — optional chart title
 * @param {string} [options.style="bar"] — "bar" (horizontal percentage bars) or "legend" (legend only)
 * @returns {string} pie chart text
 */
function pieChart(data, options) {
  options = options || {};
  const slices = Array.isArray(data) ? data : (Array.isArray(data.slices) ? data.slices : []);
  const width = _clamp(options.width || 40, 10, 100);
  const title = options.title || "";
  const style = options.style || "bar";
  const lines = [];

  if (slices.length === 0) return title ? `${title}\n(no data)` : "(no data)";
  if (title) {
    lines.push(title);
    lines.push(BOX.H.repeat(Math.min(title.length + 4, 50)));
  }

  const total = slices.reduce((sum, s) => sum + (s.value || 0), 0);
  if (total === 0) return lines.length > 0 ? lines.join("\n") + "\n(total is zero)" : "(total is zero)";

  const chars = [BOX.BLOCK, BOX.DARK, BOX.MEDIUM, BOX.LIGHT];
  let runningPct = 0;

  // Horizontal stacked bar with legend
  if (style === "bar") {
    let barLine = "  ";
    for (let i = 0; i < slices.length; i++) {
      const pct = (slices[i].value / total);
      const barWidth = Math.round(pct * width);
      if (barWidth > 0) {
        barLine += _repeat(chars[i % chars.length], barWidth);
      }
    }
    lines.push(barLine);
  }

  // Legend with percentages
  for (let i = 0; i < slices.length; i++) {
    const pct = ((slices[i].value / total) * 100).toFixed(1);
    const label = String(slices[i].label || `Slice ${i + 1}`);
    const prefix = style === "bar" ? chars[i % chars.length] + " " : "  ";
    const bar = style === "bar" ? _repeat(BOX.LIGHT, Math.max(1, Math.round((slices[i].value / total) * 15))) : "";
    lines.push(`${prefix}${label}${style === "bar" ? " " + bar : ""}: ${pct}% (${slices[i].value})`);
  }

  lines.push(`  Total: ${total}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// treeChart — tree visualization with box-drawing characters
// ---------------------------------------------------------------------------

/**
 * Render a tree structure using Unicode box-drawing characters.
 *
 * @param {object} data — tree root node
 * @param {string} data.name — node name
 * @param {Array<object>} [data.children] — child nodes (recursive)
 * @param {object} [options]
 * @param {string} [options.title] — optional chart title
 * @param {number} [options.maxDepth=10] — maximum depth to render
 * @returns {string} tree visualization
 */
function treeChart(data, options) {
  options = options || {};
  const title = options.title || "";
  const maxDepth = _clamp(options.maxDepth || 10, 1, 50);
  const lines = [];

  if (title) lines.push(title);
  if (!data) return title ? lines.join("\n") : "(no data)";

  _renderTreeNode(lines, data, "", "", maxDepth, 0);
  return lines.join("\n");
}

function _renderTreeNode(lines, node, prefix, childPrefix, maxDepth, depth) {
  if (depth >= maxDepth) return;

  const name = String(node.name || node.label || "(unnamed)");
  lines.push(`${prefix}${name}`);

  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) return;

  for (let i = 0; i < children.length; i++) {
    const isLast = i === children.length - 1;
    const connector = isLast ? `${BOX.TREE_E}${BOX.TREE_H}${BOX.TREE_H} ` : `${BOX.TREE_L}${BOX.TREE_H}${BOX.TREE_H} `;
    const subPrefix = isLast ? "    " : `${BOX.TREE_V}   `;
    _renderTreeNode(
      lines,
      children[i],
      `${childPrefix}${connector}`,
      `${childPrefix}${subPrefix}`,
      maxDepth,
      depth + 1,
    );
  }
}

// ---------------------------------------------------------------------------
// tableChart — formatted data tables with borders
// ---------------------------------------------------------------------------

/**
 * Render a formatted table with Unicode borders.
 *
 * @param {object} data
 * @param {Array<string>} data.headers — column header labels
 * @param {Array<Array<string|number>>} data.rows — table rows (each row is an array of values)
 * @param {object} [options]
 * @param {string} [options.title] — optional table title
 * @param {Array<string>} [options.align] — alignment hints per column: "left"|"right"|"center"
 * @param {boolean} [options.compact=false] — use single-line borders
 * @param {number} [options.maxWidth=100] — maximum table width
 * @returns {string} formatted table
 */
function tableChart(data, options) {
  options = options || {};
  const headers = Array.isArray(data) ? (data.length > 0 && Array.isArray(data[0]) ? null : data) : data.headers || [];
  const rows = Array.isArray(data) ? (headers ? data.rows || [] : data.slice(1)) : (data.rows || []);
  const actualHeaders = headers || (Array.isArray(data) && data.length > 0 ? data[0] : []);
  const title = options.title || "";
  const align = Array.isArray(options.align) ? options.align : [];
  const compact = options.compact === true;
  const maxWidth = _clamp(options.maxWidth || 100, 20, 300);

  // If data is an array of arrays and no explicit headers, treat first row as header
  const allHeaders = headers;
  const allRows = rows;

  if (!allHeaders || allHeaders.length === 0) {
    return title ? `${title}\n(no data)` : "(no data)";
  }

  const lines = [];
  if (title) lines.push(title);

  const colCount = allHeaders.length;
  // Calculate column widths
  const colWidths = [];
  for (let c = 0; c < colCount; c++) {
    let w = String(allHeaders[c] || "").length;
    for (const row of allRows) {
      const cell = row && row[c] !== undefined ? String(row[c]) : "";
      w = Math.max(w, cell.length);
    }
    colWidths.push(_clamp(w, 1, 60));
  }

  const totalWidth = colWidths.reduce((s, w) => s + w + 3, 1);
  const scale = totalWidth > maxWidth ? maxWidth / totalWidth : 1;
  if (scale < 1) {
    for (let c = 0; c < colWidths.length; c++) {
      colWidths[c] = Math.max(3, Math.floor(colWidths[c] * scale));
    }
  }

  // Render top border
  lines.push(_tableBorder("top", colWidths));

  // Header row
  lines.push(_tableRow(allHeaders, colWidths, align));
  lines.push(_tableBorder("sep", colWidths));

  // Data rows
  for (const row of allRows) {
    lines.push(_tableRow(row, colWidths, align));
    if (!compact) {
      lines.push(_tableBorder("inner", colWidths));
    }
  }

  // Replace last inner border with bottom border if not compact
  if (!compact && allRows.length > 0) {
    lines.pop();
  }
  lines.push(_tableBorder("bottom", colWidths));

  return lines.join("\n");
}

function _tableBorder(type, widths) {
  const chars = {
    top:    { L: BOX.TL, M: BOX.HD, R: BOX.TR, H: BOX.H },
    sep:    { L: BOX.VL, M: BOX.CR, R: BOX.VR, H: BOX.H },
    inner:  { L: BOX.VL, M: BOX.CR, R: BOX.VR, H: BOX.H },
    bottom: { L: BOX.BL, M: BOX.HU, R: BOX.BR, H: BOX.H },
  };
  const c = chars[type];
  const parts = widths.map(w => _repeat(c.H, w + 2));
  return `${c.L}${parts.join(c.M)}${c.R}`;
}

function _tableRow(cells, widths, align) {
  const parts = [];
  for (let i = 0; i < widths.length; i++) {
    const text = cells && cells[i] !== undefined ? String(cells[i]) : "";
    const al = align[i] || "left";
    const padded = al === "right"
      ? _padLeft(text, widths[i])
      : al === "center"
        ? _padCenter(text, widths[i])
        : _padRight(text, widths[i]);
    parts.push(` ${padded} `);
  }
  return `${BOX.V}${parts.join(BOX.V)}${BOX.V}`;
}

function _padCenter(str, len) {
  const s = String(str);
  if (s.length >= len) return s;
  const left = Math.floor((len - s.length) / 2);
  const right = len - s.length - left;
  return " ".repeat(left) + s + " ".repeat(right);
}

// ---------------------------------------------------------------------------
// ganttChart — ASCII Gantt chart for project timelines
// ---------------------------------------------------------------------------

/**
 * Render a Gantt chart in ASCII.
 *
 * @param {object} data
 * @param {Array<{name:string, start:number, end:number, progress?:number}>} data.tasks — tasks with start/end day offsets
 * @param {object} [options]
 * @param {number} [options.width=80] — chart width
 * @param {string} [options.title] — optional chart title
 * @param {boolean} [options.showProgress=true] — show progress fill inside bars
 * @returns {string} ASCII Gantt chart
 */
function ganttChart(data, options) {
  options = options || {};
  const tasks = Array.isArray(data) ? data : (Array.isArray(data.tasks) ? data.tasks : []);
  const width = _clamp(options.width || 80, 30, 200);
  const title = options.title || "";
  const showProgress = options.showProgress !== false;
  const lines = [];

  if (tasks.length === 0) return title ? `${title}\n(no tasks)` : "(no tasks)";
  if (title) {
    lines.push(title);
    lines.push(BOX.H.repeat(Math.min(title.length + 4, 60)));
  }

  // Find time range
  const minStart = _min(tasks.map(t => t.start));
  const maxEnd = _max(tasks.map(t => t.end));
  const totalDays = Math.max(1, maxEnd - minStart);
  const labelWidth = _max(tasks.map(t => String(t.name || "").length)) + 2;
  const chartWidth = Math.max(10, width - labelWidth - 5);

  // Timeline header
  const dayStep = Math.max(1, Math.ceil(totalDays / 10));
  let timelineHead = " ".repeat(labelWidth + 1);
  for (let d = minStart; d <= maxEnd; d += dayStep) {
    const dayLabel = String(d).slice(0, 3);
    timelineHead += _padRight(dayLabel, Math.round(chartWidth / 10) + (d === minStart ? 0 : 0));
  }
  lines.push(timelineHead);

  lines.push(" ".repeat(labelWidth + 1) + BOX.H.repeat(chartWidth));

  // Render each task
  for (const task of tasks) {
    const label = _padRight(String(task.name || ""), labelWidth);
    const startIdx = Math.round(((task.start - minStart) / totalDays) * chartWidth);
    const endIdx = Math.round(((task.end - minStart) / totalDays) * chartWidth);
    const barLen = Math.max(1, endIdx - startIdx);

    let bar;
    if (showProgress && task.progress !== undefined && task.progress > 0) {
      const progressPct = _clamp(task.progress, 0, 100) / 100;
      const filled = Math.round(barLen * progressPct);
      bar = _repeat(BOX.BLOCK, filled) + _repeat(BOX.LIGHT, barLen - filled);
    } else {
      bar = _repeat(BOX.BLOCK, barLen);
    }

    const prefix = _repeat(" ", startIdx);
    const suffix = _repeat(" ", Math.max(0, chartWidth - startIdx - barLen));
    lines.push(`${label}${BOX.V}${prefix}${bar}${suffix}${BOX.V}`);
  }

  lines.push(" ".repeat(labelWidth + 1) + BOX.H.repeat(chartWidth));
  lines.push(`${" ".repeat(labelWidth)} Day ${minStart} — ${maxEnd}  (total: ${totalDays}d)`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = {
  BOX,
  barChart,
  lineChart,
  pieChart,
  treeChart,
  tableChart,
  ganttChart,
};
