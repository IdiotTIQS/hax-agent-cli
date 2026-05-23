"use strict";

/**
 * HealthVisualizer — renders project health data as rich text visualizations
 * using Unicode block characters, sparklines, and ANSI color codes.
 *
 * Provides five render primitives:
 *   - renderDashboard   — full text-based health dashboard
 *   - renderTrend       — sparkline-style trend for a single metric
 *   - renderRadar       — text-based radar (kiviat) chart
 *   - renderHeatmap     — color-coded health heatmap by project area
 *   - renderStatusBadge — compact colored status badge
 *
 * Theme and color constants mirror those in src/dashboard/renderer.js
 * and src/renderer.js for visual consistency across the project.
 */

// ---------------------------------------------------------------------------
// ANSI / THEME constants
// ---------------------------------------------------------------------------

const ANSI = {
  reset:          "\x1B[0m",
  bold:           "\x1B[1m",
  dim:            "\x1B[2m",
  italic:         "\x1B[3m",
  underline:      "\x1B[4m",
  red:            "\x1B[31m",
  green:          "\x1B[32m",
  yellow:         "\x1B[33m",
  blue:           "\x1B[34m",
  magenta:        "\x1B[35m",
  cyan:           "\x1B[36m",
  white:          "\x1B[37m",
  brightRed:      "\x1B[91m",
  brightGreen:    "\x1B[92m",
  brightYellow:   "\x1B[93m",
  brightBlue:     "\x1B[94m",
  brightMagenta:  "\x1B[95m",
  brightCyan:     "\x1B[96m",
  brightWhite:    "\x1B[97m",
  bgBrightBlack:  "\x1B[100m",
};

const THEME = {
  heading:      ANSI.bold + ANSI.brightCyan,
  subheading:   ANSI.bold + ANSI.brightWhite,
  success:      ANSI.brightGreen,
  warning:      ANSI.brightYellow,
  error:        ANSI.brightRed,
  muted:        ANSI.dim,
  accent:       ANSI.brightMagenta,
  info:         ANSI.brightBlue,
  cost:         ANSI.brightYellow,
  token:        ANSI.dim,
  border:       ANSI.dim,
  scoreA:       ANSI.brightGreen,
  scoreB:       ANSI.green,
  scoreC:       ANSI.brightYellow,
  scoreD:       ANSI.yellow,
  scoreF:       ANSI.brightRed,
};

// Unicode block characters for visual elements
const BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const HEAT_BLOCKS = ["░", "▒", "▓", "█"];
const RADAR_POINTS = ["○", "◌", "◉", "●"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padRight(str, len) {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function padLeft(str, len) {
  const s = String(str);
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Map a score (0-100) to a block character index (0-8).
 */
function scoreToBlock(score, max) {
  if (max === 0) return 0;
  const ratio = clamp(score / max, 0, 1);
  return Math.min(BLOCKS.length - 1, Math.round(ratio * (BLOCKS.length - 1)));
}

/**
 * Build a horizontal bar from a value.
 */
function barChart(value, max, width, colorFn) {
  width = width || 20;
  colorFn = colorFn || (() => ANSI.brightCyan);

  if (max === 0) {
    return ANSI.dim + "─".repeat(width) + ANSI.reset;
  }

  const ratio = Math.min(1, Math.max(0, value / max));
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  return colorFn(ratio) + "█".repeat(filled) + ANSI.dim + "─".repeat(empty) + ANSI.reset;
}

/**
 * Pick a color based on score ratio (higher = greener).
 */
function scoreColor(ratio) {
  if (ratio >= 0.9) return ANSI.brightGreen;
  if (ratio >= 0.8) return ANSI.green;
  if (ratio >= 0.7) return ANSI.brightYellow;
  if (ratio >= 0.6) return ANSI.yellow;
  return ANSI.brightRed;
}

function divider(width) {
  width = width || 64;
  return ANSI.dim + "─".repeat(width) + ANSI.reset;
}

function sectionHeader(title) {
  return THEME.heading + "\n┌─ " + title + " " + "─".repeat(48) + ANSI.reset;
}

function statusIcon(status) {
  if (status === "pass") return ANSI.brightGreen + "✓" + ANSI.reset;
  if (status === "warn") return ANSI.brightYellow + "⚠" + ANSI.reset;
  if (status === "critical") return ANSI.brightRed + "✗" + ANSI.reset;
  return ANSI.dim + "?" + ANSI.reset;
}

// ---------------------------------------------------------------------------
// HealthVisualizer
// ---------------------------------------------------------------------------

class HealthVisualizer {
  constructor(options = {}) {
    this._termWidth = options.termWidth || 80;
    this._showColor = options.showColor !== false;
  }

  // -----------------------------------------------------------------------
  // renderDashboard
  // -----------------------------------------------------------------------

  /**
   * Render a full text-based health dashboard.
   *
   * Expected `health` object shape (from HealthMonitor.getStatus()):
   *   {
   *     overallScore, grade, timestamp,
   *     dimensions: { codeHealth, testCoverage, debtRatio, docCoverage, dependencyHealth },
   *     dimensionStatuses: { [key]: { value, status, threshold } },
   *     monitoring: { running, startedAt, lastCheckAt, totalChecks },
   *     alerts: { active, recent }
   *   }
   *
   * @param {object} health
   * @returns {string} ANSI-colored dashboard text
   */
  renderDashboard(health) {
    if (!health) return "";

    const lines = [];
    const W = this._termWidth;

    // ---- Header ----
    lines.push("");
    lines.push(
      THEME.heading + ANSI.bold +
      padRight("  PROJECT HEALTH DASHBOARD", W - 4) +
      ANSI.reset
    );
    lines.push(
      ANSI.muted + "  " + (health.timestamp
        ? new Date(health.timestamp).toLocaleString()
        : new Date().toLocaleString()) +
      ANSI.reset
    );
    lines.push("");

    // ---- Overall Score + Badge ----
    lines.push(this._renderOverallBar(health.overallScore, health.grade));
    lines.push(divider(W - 2));

    // ---- Dimension Gauges ----
    lines.push(sectionHeader("HEALTH DIMENSIONS"));
    lines.push("");

    if (health.dimensions && health.dimensionStatuses) {
      const dims = [
        { key: "codeHealth", label: "Code Health" },
        { key: "testCoverage", label: "Test Coverage" },
        { key: "debtRatio", label: "Debt Ratio", inverted: true },
        { key: "docCoverage", label: "Doc Coverage" },
        { key: "dependencyHealth", label: "Dependency Health" },
      ];

      for (const dim of dims) {
        lines.push(this._renderDimensionRow(dim, health));
      }
    }

    lines.push("");

    // ---- Radar Chart (compact) ----
    const radarChart = this.renderRadar(health.dimensions || {}, {
      width: Math.min(36, W - 4),
      height: 8,
      compact: true,
    });
    lines.push(THEME.subheading + "  Metric Radar" + ANSI.reset);
    for (const line of radarChart.split("\n")) {
      lines.push("  " + line);
    }
    lines.push("");

    // ---- Heatmap ----
    const areaScores = this._extractAreaScores(health);
    const heatmap = this.renderHeatmap(areaScores, { width: W - 4 });
    lines.push(THEME.subheading + "  Area Heatmap" + ANSI.reset);
    lines.push(heatmap);
    lines.push("");

    // ---- Monitoring Status ----
    if (health.monitoring) {
      const m = health.monitoring;
      lines.push(divider(W - 2));
      lines.push(
        THEME.subheading + "  Status: " + ANSI.reset +
        (m.running
          ? THEME.success + "ACTIVE" + ANSI.reset
          : ANSI.dim + "STOPPED" + ANSI.reset) +
        "  |  Checks: " + ANSI.brightWhite + (m.totalChecks || 0) + ANSI.reset +
        "  |  " + (m.lastCheckAt
          ? ANSI.muted + "Last: " + new Date(m.lastCheckAt).toLocaleTimeString() + ANSI.reset
          : "")
      );
    }

    // ---- Alerts ----
    if (health.alerts && health.alerts.active > 0) {
      lines.push(
        THEME.warning + "  ⚠ " + health.alerts.active +
        " active alert(s)" + ANSI.reset
      );
      if (health.alerts.recent) {
        for (const alert of health.alerts.recent.slice(0, 5)) {
          const icon = alert.level === "critical"
            ? ANSI.brightRed + "✗" + ANSI.reset
            : ANSI.brightYellow + "⚠" + ANSI.reset;
          lines.push(
            "  " + icon + " " + ANSI.dim + "[" + alert.dimension + "]" + ANSI.reset +
            " " + alert.message
          );
        }
      }
    }

    // ---- Footer ----
    lines.push("");
    lines.push(divider(W - 2));
    lines.push(
      ANSI.muted + "  HaxAgent Health Monitor" + ANSI.reset
    );
    lines.push("");

    return lines.join("\n");
  }

  // -----------------------------------------------------------------------
  // renderTrend
  // -----------------------------------------------------------------------

  /**
   * Render a sparkline trend visualization for a single metric.
   *
   * @param {string} metric     - metric name (e.g., "codeHealth")
   * @param {Array<object>} history - array of health snapshots from getHistory()
   * @param {object} [options]
   * @param {number} [options.width]       - sparkline width (default 30)
   * @param {boolean} [options.showLabel]  - include metric label (default true)
   * @param {boolean} [options.showStats]  - include min/max/avg/latest (default true)
   * @returns {string}
   */
  renderTrend(metric, history, options = {}) {
    if (!Array.isArray(history) || history.length === 0) {
      return ANSI.dim + "(no data)" + ANSI.reset;
    }

    const width = options.width || 30;
    const showLabel = options.showLabel !== false;
    const showStats = options.showStats !== false;

    // Extract values from history
    const values = [];
    for (const snap of history) {
      const v = (snap.dimensions && snap.dimensions[metric] != null)
        ? snap.dimensions[metric]
        : (snap[metric] != null ? snap[metric] : null);
      if (v != null) values.push(v);
    }

    if (values.length === 0) {
      return ANSI.dim + "(no data for " + metric + ")" + ANSI.reset;
    }

    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;

    // Generate sparkline
    let spark = "";
    const sample = values.length > width
      ? _resampleArray(values, width)
      : values;

    for (const val of sample) {
      const ratio = (val - min) / range;
      const idx = Math.min(SPARK.length - 1, Math.max(0, Math.floor(ratio * SPARK.length)));
      spark += SPARK[idx];
    }

    // Color based on trend direction
    const firstValue = values[0];
    const lastValue = values[values.length - 1];
    const delta = lastValue - firstValue;
    const trendColor = metric === "debtRatio"
      ? (delta < 0 ? ANSI.brightGreen : ANSI.brightRed)
      : (delta > 0 ? ANSI.brightGreen : ANSI.brightRed);

    const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "─";
    const absDelta = Math.abs(delta).toFixed(1);

    let line = trendColor + spark + ANSI.reset;

    if (showLabel) {
      const label = this._metricLabel(metric);
      line = padRight(label, 16) + " " + line;
    }

    if (showStats) {
      const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
      const latest = lastValue.toFixed(1);
      line += "  " + ANSI.brightWhite + latest + ANSI.reset +
        "  " + trendColor + arrow + " " + absDelta + ANSI.reset +
        "  " + ANSI.muted + "avg:" + avg + "  min:" + min.toFixed(1) + "  max:" + max.toFixed(1) + ANSI.reset;
    }

    return line;
  }

  // -----------------------------------------------------------------------
  // renderRadar
  // -----------------------------------------------------------------------

  /**
   * Render a text-based radar (kiviat) chart for a set of metrics.
   *
   * The chart plots each metric as a point on an axis radiating from
   * the center. Each axis represents a 0-100 scale (higher is better).
   *
   * @param {object} metrics   - { label: score (0-100), ... }
   * @param {object} [options]
   * @param {number} [options.width]   - chart width in characters (default 36)
   * @param {number} [options.height]  - char height (default 8)
   * @param {boolean} [options.compact] - use compact labels (default false)
   * @returns {string}
   */
  renderRadar(metrics, options = {}) {
    if (!metrics || Object.keys(metrics).length === 0) {
      return ANSI.dim + "(no metrics)" + ANSI.reset;
    }

    const width = options.width || 36;
    const height = options.height || 8;
    const compact = options.compact || false;
    const keys = Object.keys(metrics);
    const numAxes = keys.length;

    if (numAxes < 2) {
      return ANSI.dim + "(need at least 2 metrics for radar)" + ANSI.reset;
    }

    // Build a character grid
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    const maxRadius = Math.min(cx, cy) - 1;

    const grid = [];
    for (let y = 0; y < height; y++) {
      grid[y] = [];
      for (let x = 0; x < width; x++) {
        grid[y][x] = { char: " ", color: null };
      }
    }

    // Place center marker and rings
    for (let r = 1; r <= maxRadius; r++) {
      for (let angle = 0; angle < 360; angle += 2) {
        const rad = (angle * Math.PI) / 180;
        const x = Math.round(cx + r * Math.cos(rad));
        const y = Math.round(cy + r * Math.sin(rad) * 0.5); // halve Y for aspect

        if (x >= 0 && x < width && y >= 0 && y < height) {
          if (!grid[y][x].color) {
            grid[y][x] = { char: "·", color: ANSI.dim };
          }
        }
      }
    }

    // Place axes
    const axisLabels = [];
    for (let i = 0; i < numAxes; i++) {
      const angle = (2 * Math.PI * i) / numAxes - Math.PI / 2;
      const ax = Math.round(cx + maxRadius * Math.cos(angle));
      const ay = Math.round(cy + maxRadius * Math.sin(angle) * 0.5);
      const labelX = Math.round(cx + (maxRadius + 2) * Math.cos(angle));
      const labelY = Math.round(cy + (maxRadius + 2) * Math.sin(angle) * 0.5);

      axisLabels.push({
        key: keys[i],
        label: compact ? keys[i].substring(0, 4) : this._metricLabel(keys[i]),
        labelX: clamp(labelX, 0, width - 1),
        labelY: clamp(labelY, 0, height - 1),
      });

      // Draw axis line
      for (let r = 1; r <= maxRadius; r++) {
        const px = Math.round(cx + r * Math.cos(angle));
        const py = Math.round(cy + r * Math.sin(angle) * 0.5);
        if (px >= 0 && px < width && py >= 0 && py < height) {
          grid[py][px] = { char: "·", color: ANSI.dim };
        }
      }
    }

    // Plot data points
    for (let i = 0; i < numAxes; i++) {
      const angle = (2 * Math.PI * i) / numAxes - Math.PI / 2;
      const label = keys[i];
      const rawVal = metrics[label];
      if (rawVal == null) continue;

      // Normalize: debtRatio is inverted
      let normalized;
      if (label === "debtRatio") {
        normalized = clamp(1 - rawVal, 0, 1);
      } else {
        normalized = clamp(rawVal / 100, 0, 1);
      }

      const r = Math.round(normalized * maxRadius);
      const px = Math.round(cx + r * Math.cos(angle));
      const py = Math.round(cy + r * Math.sin(angle) * 0.5);

      if (px >= 0 && px < width && py >= 0 && py < height) {
        grid[py][px] = {
          char: RADAR_POINTS[Math.min(RADAR_POINTS.length - 1, Math.floor(normalized * RADAR_POINTS.length))],
          color: scoreColor(normalized),
        };
      }
    }

    // Center point
    grid[cy][cx] = { char: "+", color: ANSI.dim };

    // Render grid to string
    const rows = [];
    for (let y = 0; y < height; y++) {
      let row = "";
      for (let x = 0; x < width; x++) {
        const cell = grid[y][x];
        if (cell.color) {
          row += cell.color + cell.char + ANSI.reset;
        } else {
          row += cell.char;
        }
      }
      // Append axis labels that belong on this row
      for (const al of axisLabels) {
        if (al.labelY === y) {
          let insertX = al.labelX;
          if (insertX >= width) insertX = width - al.label.length;
          if (insertX < 0) insertX = 0;
          const before = row.substring(0, insertX);
          const after = row.substring(insertX + al.label.length);
          row = before + ANSI.muted + al.label.substring(0, Math.min(al.label.length, width - insertX)) + ANSI.reset + after;
        }
      }
      rows.push(row);
    }

    return rows.join("\n");
  }

  // -----------------------------------------------------------------------
  // renderHeatmap
  // -----------------------------------------------------------------------

  /**
   * Render a color-coded health heatmap by project area.
   *
   * @param {Array<{label: string, score: number, status?: string}>} areas
   * @param {object} [options]
   * @param {number} [options.width]   - max width (default 80)
   * @param {boolean} [options.showLegend] - show color legend (default true)
   * @returns {string}
   */
  renderHeatmap(areas, options = {}) {
    if (!Array.isArray(areas) || areas.length === 0) {
      return ANSI.dim + "  (no areas)" + ANSI.reset;
    }

    const width = options.width || 80;
    const showLegend = options.showLegend !== false;
    const cellWidth = 3; // each cell is e.g. "███"
    const cols = Math.max(1, Math.floor((width - 4) / cellWidth));
    const rows = Math.ceil(areas.length / cols);

    const lines = [];

    for (let r = 0; r < rows; r++) {
      let line = "  ";
      const labelLine = "";

      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx >= areas.length) break;

        const area = areas[idx];
        const score = clamp(area.score || 0, 0, 100);
        const ratio = score / 100;

        // Heat intensity: darker (more red) for low, lighter (more green) for high
        let color;
        if (ratio >= 0.9) color = ANSI.brightGreen;
        else if (ratio >= 0.8) color = ANSI.green;
        else if (ratio >= 0.7) color = ANSI.brightYellow;
        else if (ratio >= 0.6) color = ANSI.yellow;
        else if (ratio >= 0.4) color = ANSI.brightRed;
        else color = ANSI.red;

        const blockIdx = Math.min(
          HEAT_BLOCKS.length - 1,
          Math.floor(ratio * HEAT_BLOCKS.length)
        );
        line += color + HEAT_BLOCKS[blockIdx].repeat(3) + ANSI.reset;
      }

      lines.push(line);
    }

    // Add labels beneath
    if (areas.length <= 24) {
      let labelRow = "  ";
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (idx >= areas.length) break;
          const area = areas[idx];
          const shortLabel = (area.label || "").substring(0, 10);
          labelRow += ANSI.muted + padRight(shortLabel, 3) + ANSI.reset;
        }
        if (r < rows - 1) labelRow += "\n  ";
      }
      lines.push(labelRow);
    }

    if (showLegend) {
      lines.push("");
      lines.push(
        "  " +
        ANSI.brightGreen + "███ " + ANSI.reset + "90+  " +
        ANSI.green + "███ " + ANSI.reset + "80+  " +
        ANSI.brightYellow + "███ " + ANSI.reset + "70+  " +
        ANSI.yellow + "███ " + ANSI.reset + "60+  " +
        ANSI.brightRed + "███ " + ANSI.reset + "40+  " +
        ANSI.red + "███ " + ANSI.reset + "<40"
      );
    }

    return lines.join("\n");
  }

  // -----------------------------------------------------------------------
  // renderStatusBadge
  // -----------------------------------------------------------------------

  /**
   * Render a compact colored status badge for a score.
   *
   * @param {number} score - 0-100 score
   * @param {object} [options]
   * @param {boolean} [options.showGrade] - include letter grade (default true)
   * @param {boolean} [options.showScore] - include numeric score (default true)
   * @returns {string}
   */
  renderStatusBadge(score, options = {}) {
    if (score == null) {
      return ANSI.dim + "[  N/A  ]" + ANSI.reset;
    }

    const showGrade = options.showGrade !== false;
    const showScore = options.showScore !== false;
    const ratio = clamp(score, 0, 100) / 100;

    let color;
    let grade;
    if (ratio >= 0.9) { color = THEME.scoreA; grade = "A"; }
    else if (ratio >= 0.8) { color = THEME.scoreB; grade = "B"; }
    else if (ratio >= 0.7) { color = THEME.scoreC; grade = "C"; }
    else if (ratio >= 0.6) { color = THEME.scoreD; grade = "D"; }
    else { color = THEME.scoreF; grade = "F"; }

    let badge = ANSI.bold + color;

    if (showGrade && showScore) {
      badge += "[" + grade + " " + String(Math.round(score)).padStart(3, " ") + "]";
    } else if (showGrade) {
      badge += "[" + grade + "]";
    } else if (showScore) {
      badge += "[" + String(Math.round(score)) + "]";
    } else {
      badge += "[--]";
    }

    badge += ANSI.reset;
    return badge;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  _renderOverallBar(score, grade) {
    score = score || 0;
    const ratio = clamp((score || 0) / 100, 0, 1);
    const color = scoreColor(ratio);

    const barWidth = 30;
    const filled = Math.round(ratio * barWidth);
    const empty = barWidth - filled;

    const badge = this.renderStatusBadge(score);

    return (
      "  " + badge + "  " +
      color + "█".repeat(filled) + ANSI.dim + "─".repeat(empty) + ANSI.reset
    );
  }

  _renderDimensionRow(dim, health) {
    const { key, label, inverted } = dim;
    const ds = health.dimensionStatuses && health.dimensionStatuses[key];
    const value = health.dimensions && health.dimensions[key];

    if (value == null) {
      return "  " + ANSI.dim + padRight(label, 20) + " (no data)" + ANSI.reset;
    }

    const icon = ds ? statusIcon(ds.status) : " ";

    let displayValue;
    if (inverted) {
      displayValue = `${(value * 100).toFixed(1)}%`;
    } else {
      displayValue = `${Math.round(value)}/100`;
    }

    const barMax = inverted ? 1 : 100;
    const barVal = inverted ? value : value;
    const barRatio = inverted
      ? clamp(1 - barVal, 0, 1)
      : clamp(barVal / 100, 0, 1);

    const bar = barChart(
      inverted ? 1 - value : value,
      inverted ? 1 : 100,
      18,
      (ratio) => scoreColor(inverted ? ratio : ratio)
    );

    // Add threshold markers
    let thresholdInfo = "";
    if (ds && ds.threshold) {
      const thresholdValue = ds.status === "critical"
        ? ds.threshold.critical
        : ds.threshold.warn;
      let displayThreshold;
      if (inverted) {
        displayThreshold = `${(thresholdValue * 100).toFixed(0)}%`;
      } else {
        displayThreshold = thresholdValue;
      }
      thresholdInfo = ANSI.muted + " (threshold: " + displayThreshold + ")" + ANSI.reset;
    }

    return (
      "  " + icon + " " +
      padRight(label, 20) +
      bar + " " +
      ANSI.brightWhite + padLeft(displayValue, 9) + ANSI.reset +
      thresholdInfo
    );
  }

  /**
   * Extract area-level scores from a health status object for the heatmap.
   */
  _extractAreaScores(health) {
    const areas = [];

    if (health.dimensions) {
      const dims = health.dimensions;
      const mapping = [
        { key: "codeHealth", label: "Code" },
        { key: "testCoverage", label: "Tests" },
        { key: "debtRatio", label: "Debt", inverted: true },
        { key: "docCoverage", label: "Docs" },
        { key: "dependencyHealth", label: "Deps" },
      ];

      for (const m of mapping) {
        if (dims[m.key] != null) {
          if (m.inverted) {
            areas.push({
              label: m.label,
              score: clamp(100 - dims[m.key] * 100, 0, 100),
              rawValue: dims[m.key],
            });
          } else {
            areas.push({
              label: m.label,
              score: clamp(dims[m.key], 0, 100),
              rawValue: dims[m.key],
            });
          }
        }
      }
    }

    // Add any dimension statuses as sub-areas
    if (health.dimensionStatuses) {
      for (const [key, status] of Object.entries(health.dimensionStatuses)) {
        if (status.value != null && !areas.find((a) => a.key === key)) {
          // Already handled above via dimensions
        }
      }
    }

    return areas;
  }

  _metricLabel(key) {
    const labels = {
      codeHealth: "Code Health",
      testCoverage: "Test Coverage",
      debtRatio: "Debt Ratio",
      docCoverage: "Doc Coverage",
      dependencyHealth: "Dep Health",
      overallScore: "Overall",
    };
    return labels[key] || key;
  }
}

// ---------------------------------------------------------------------------
// Standalone helpers (also exposed for testing)
// ---------------------------------------------------------------------------

/**
 * Linearly resample an array to a target length.
 */
function _resampleArray(arr, targetLen) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  if (arr.length <= targetLen) return arr;

  const result = [];
  const step = (arr.length - 1) / (targetLen - 1);
  for (let i = 0; i < targetLen; i++) {
    const idx = Math.min(arr.length - 1, Math.round(i * step));
    result.push(arr[idx]);
  }
  return result;
}

module.exports = {
  HealthVisualizer,
  THEME,
  ANSI,
  BLOCKS,
  SPARK,
  HEAT_BLOCKS,
  RADAR_POINTS,
  _resampleArray,
};
