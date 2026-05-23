"use strict";

/**
 * TokenVisualizer — visual token usage representation using Unicode blocks
 * and ANSI color codes. Designed for terminal output.
 */

const ANSI = {
  reset: "\x1B[0m",
  bold: "\x1B[1m",
  dim: "\x1B[2m",
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  blue: "\x1B[34m",
  magenta: "\x1B[35m",
  cyan: "\x1B[36m",
  white: "\x1B[37m",
  brightRed: "\x1B[91m",
  brightGreen: "\x1B[92m",
  brightYellow: "\x1B[93m",
  brightBlue: "\x1B[94m",
  brightMagenta: "\x1B[95m",
  brightCyan: "\x1B[96m",
  brightWhite: "\x1B[97m",
};

const THEME = {
  heading: ANSI.bold + ANSI.brightCyan,
  subheading: ANSI.bold + ANSI.brightWhite,
  success: ANSI.brightGreen,
  warning: ANSI.brightYellow,
  error: ANSI.brightRed,
  muted: ANSI.dim,
  accent: ANSI.brightMagenta,
  cost: ANSI.brightYellow,
  token: ANSI.dim,
  border: ANSI.dim,
  info: ANSI.brightBlue,
};

const BAR_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const PIE_SEGMENTS = ["█", "▓", "▒", "░", " "];

function padRight(str, len) {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function padLeft(str, len) {
  const s = String(str);
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

function barFill(ratio, width, char) {
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * width);
  const empty = width - filled;
  return (char || "█").repeat(filled) + ANSI.dim + "─".repeat(empty) + ANSI.reset;
}

function spark(values, width) {
  width = width || 20;
  if (!Array.isArray(values) || values.length === 0) {
    return ANSI.dim + "─".repeat(width) + ANSI.reset;
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  // Sample evenly if more values than width.
  const sampled = [];
  if (values.length <= width) {
    sampled.push(...values);
  } else {
    const step = values.length / width;
    for (let i = 0; i < width; i++) {
      sampled.push(values[Math.floor(i * step)]);
    }
  }

  let result = "";
  for (let i = 0; i < sampled.length; i++) {
    const ratio = (sampled[i] - min) / range;
    const idx = Math.min(SPARK.length - 1, Math.max(0, Math.floor(ratio * SPARK.length)));
    result += SPARK[idx];
  }
  return ANSI.brightGreen + result + ANSI.reset;
}

function divider(width, char) {
  return ANSI.dim + (char || "─").repeat(width || 60) + ANSI.reset;
}

function sectionHeader(title) {
  return THEME.heading + "── " + title + " " + "─".repeat(50) + ANSI.reset;
}

function formatNumber(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatCost(n) {
  return `$${n.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// TokenVisualizer
// ---------------------------------------------------------------------------

class TokenVisualizer {
  constructor(options = {}) {
    this._width = options.width || 40;
    this._barWidth = options.barWidth || 20;
  }

  /**
   * Render a usage bar with Unicode blocks.
   * @param {number} used - Tokens or cost used.
   * @param {number} total - Total limit or budget.
   * @param {object} [opts] - Optional label, warning/critical thresholds.
   * @returns {string} Formatted usage bar.
   */
  renderUsageBar(used, total, opts = {}) {
    const label = opts.label || "Usage";
    const ratio = total > 0 ? used / total : 0;
    const pct = Math.round(ratio * 10000) / 100;

    let color = THEME.success;
    if (ratio >= 0.85) color = THEME.error;
    else if (ratio >= 0.60) color = THEME.warning;

    const bar = barFill(ratio, this._barWidth, "█");
    const line = `${padRight(label, 14)} ${color}${bar}${ANSI.reset} ${ANSI.brightWhite}${pct}%${ANSI.reset}`;

    if (total > 0) {
      return line + `  (${formatNumber(used)} / ${formatNumber(total)})`;
    }
    return line;
  }

  /**
   * Render a cost breakdown pie chart by model or provider.
   * @param {object} costs - Map of { name: cost }.
   * @param {object} [opts] - { title, width }.
   * @returns {string} Formatted cost breakdown.
   */
  renderCostBreakdown(costs, opts = {}) {
    const title = opts.title || "Cost Breakdown";
    const entries = Object.entries(costs || {});
    if (entries.length === 0) {
      return sectionHeader(title) + "\n  " + ANSI.muted + "(no data)" + ANSI.reset;
    }

    const colors = [ANSI.brightCyan, ANSI.brightMagenta, ANSI.brightBlue, ANSI.brightGreen, ANSI.brightYellow, ANSI.brightRed];
    const total = entries.reduce((s, [, v]) => s + v, 0);

    entries.sort((a, b) => b[1] - a[1]);

    const lines = [];
    lines.push(sectionHeader(title));
    lines.push("");

    // Horizontal stacked bar (pie approximation).
    const barWidth = this._width - 4;
    let bar = "";
    for (let i = 0; i < entries.length; i++) {
      const [, value] = entries[i];
      const ratio = total > 0 ? value / total : 0;
      const filled = Math.max(1, Math.round(ratio * barWidth));
      bar += colors[i % colors.length] + PIE_SEGMENTS[i % PIE_SEGMENTS.length].repeat(filled);
    }
    bar += ANSI.reset;
    lines.push(`  ${bar}`);

    // Legend.
    for (let i = 0; i < entries.length; i++) {
      const [name, value] = entries[i];
      const pct = total > 0 ? Math.round((value / total) * 10000) / 100 : 0;
      const color = colors[i % colors.length];
      lines.push(
        `  ${color}●${ANSI.reset} ${padRight(name, 18)} ${ANSI.brightWhite}${formatCost(value)}${ANSI.reset}  ${ANSI.muted}(${pct}%)${ANSI.reset}`
      );
    }
    lines.push(`  ${divider(barWidth + 2)}`);
    lines.push(`  ${ANSI.brightWhite}Total: ${formatCost(total)}${ANSI.reset}`);

    return lines.join("\n");
  }

  /**
   * Render a sparkline showing token usage trend over time.
   * @param {Array<number>} history - Array of token counts per time interval.
   * @param {object} [opts] - { label, width, showRange }.
   * @returns {string} Formatted trend line.
   */
  renderTokenTrend(history, opts = {}) {
    const label = opts.label || "Token Trend";
    const showRange = opts.showRange !== false;

    if (!Array.isArray(history) || history.length === 0) {
      return `${THEME.heading}${label}${ANSI.reset}  ${ANSI.muted}(no data)${ANSI.reset}`;
    }

    const max = Math.max(...history, 1);
    const min = Math.min(...history, 0);
    const avg = history.reduce((s, v) => s + v, 0) / history.length;

    const line = spark(history, this._width);

    let detail = `${padRight(label, 14)} ${line}`;
    if (showRange) {
      detail += `  ${ANSI.muted}min:${ANSI.reset} ${formatNumber(min)}  ${ANSI.muted}avg:${ANSI.reset} ${formatNumber(Math.round(avg))}  ${ANSI.muted}max:${ANSI.reset} ${formatNumber(max)}`;
    }
    return detail;
  }

  /**
   * Render an input/output efficiency gauge.
   * @param {number} ratio - Output tokens per input token (or 0-1 efficiency score).
   * @param {object} [opts] - { label, format }.
   * @returns {string} Formatted efficiency gauge.
   */
  renderEfficiency(ratio, opts = {}) {
    const label = opts.label || "Efficiency";
    // ratio > 1 means more output than input (expensive), < 1 means input-heavy.
    const normalized = Math.min(1, Math.max(0, 1 / Math.max(0.1, ratio)));

    let color = THEME.error;
    let quality = "Low";
    if (ratio <= 0.5) {
      color = THEME.success;
      quality = "High";
    } else if (ratio <= 1.0) {
      color = THEME.info;
      quality = "Medium";
    }

    const gaugeChars = ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
    const gaugeWidth = 16;
    const filled = Math.round(normalized * gaugeWidth);
    const empty = gaugeWidth - filled;
    const gauge = ANSI.brightWhite + "│" + color + "█".repeat(filled) + ANSI.dim + "─".repeat(empty) + ANSI.brightWhite + "│" + ANSI.reset;

    return (
      `${padRight(label, 14)} ${gauge} ` +
      `${color}${quality}${ANSI.reset}  ` +
      `${ANSI.muted}ratio:${ANSI.reset} ${ratio.toFixed(2)} ` +
      `${ANSI.muted}(output/input)${ANSI.reset}`
    );
  }

  /**
   * Render side-by-side model comparison.
   * @param {Array<object>} models - Array of model comparison results from CostTracker.compareModels.
   * @param {object} [opts] - { maxModels, width }.
   * @returns {string} Formatted comparison.
   */
  renderModelComparison(models, opts = {}) {
    const maxModels = opts.maxModels || 10;
    const results = (Array.isArray(models) ? models : []).slice(0, maxModels);

    if (results.length === 0) {
      return sectionHeader("Model Comparison") + "\n  " + ANSI.muted + "(no data)" + ANSI.reset;
    }

    const maxCost = Math.max(...results.map((r) => r.totalCost || r.perCallCost || 0), 0.0001);

    const lines = [];
    lines.push(sectionHeader("Model Comparison"));

    // Header row.
    lines.push(
      `  ${ANSI.brightWhite}${padRight("Model", 20)} ${padRight("Provider", 10)} ${padLeft("Cost", 10)}  ${padLeft("Input$/M", 8)}  ${padLeft("Output$/M", 8)}${ANSI.reset}`
    );
    lines.push(`  ${divider(62, "─")}`);

    for (const model of results) {
      const cost = model.totalCost || model.perCallCost || 0;
      const ratio = maxCost > 0 ? cost / maxCost : 0;
      const bar = barFill(ratio, 10, "█");
      const rec = model.isRecommended ? ` ${THEME.success}★${ANSI.reset}` : "";
      const costStr = formatCost(cost);

      lines.push(
        `  ${padRight(model.model, 20)} ${padRight(model.provider || "?", 10)} ${padLeft(costStr, 10)}  ${padLeft(`$${model.inputPricePerM || "?"}`, 8)}  ${padLeft(`$${model.outputPricePerM || "?"}`, 8)} ${bar}${rec}`
      );
    }

    return lines.join("\n");
  }

  /**
   * Render savings opportunities visualization.
   * @param {Array<object>|object} opportunities - Savings opportunities data.
   * @param {object} [opts] - Display options.
   * @returns {string} Formatted savings opportunities.
   */
  renderSavingsOpportunities(opportunities, opts = {}) {
    const opps = Array.isArray(opportunities)
      ? opportunities
      : (opportunities && opportunities.opportunities ? opportunities.opportunities : []);

    if (opps.length === 0) {
      return sectionHeader("Savings Opportunities") + "\n  " + THEME.success + "No savings opportunities found." + ANSI.reset;
    }

    const lines = [];
    const totalSavings = Array.isArray(opportunities)
      ? opps.reduce((s, o) => s + (o.potentialSavings || 0), 0)
      : (opportunities && opportunities.totalPotentialSavings || 0);

    lines.push(sectionHeader("Savings Opportunities"));
    lines.push(`  ${ANSI.brightWhite}Total Potential Savings: ${THEME.cost}${formatCost(totalSavings)}${ANSI.reset}`);
    lines.push("");

    for (const opp of opps) {
      const savings = opp.potentialSavings || 0;
      const color = savings > 0 ? THEME.warning : THEME.muted;
      const icon = opp.type === "switch_cheaper_model" ? "🔀" :
                   opp.type === "reduce_output_tokens" ? "✂️ " :
                   opp.type === "batch_calls" ? "📦" :
                   opp.type === "budget_warning" ? "⚠️ " : "•";

      lines.push(`  ${icon} ${ANSI.brightWhite}${opp.type}${ANSI.reset}`);
      lines.push(`    ${opp.description || ""}`);
      if (savings > 0) {
        lines.push(`    ${color}Savings: ${formatCost(savings)}${ANSI.reset}`);
      }

      // Render details if available.
      if (opp.details) {
        if (Array.isArray(opp.details)) {
          for (const detail of opp.details.slice(0, 3)) {
            lines.push(`    ${ANSI.muted}→ ${detail.model || detail.alternative || ""}: save ${formatCost(detail.totalSavings || 0)}${ANSI.reset}`);
          }
        } else if (typeof opp.details === "object") {
          for (const [key, val] of Object.entries(opp.details)) {
            const displayVal = typeof val === "number" ? (val > 1000 ? formatNumber(val) : val.toFixed(4)) : val;
            lines.push(`    ${ANSI.muted}${key}: ${displayVal}${ANSI.reset}`);
          }
        }
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}

module.exports = { TokenVisualizer, THEME, ANSI, BAR_CHARS, SPARK };
