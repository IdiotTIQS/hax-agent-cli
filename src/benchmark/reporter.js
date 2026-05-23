/**
 * Formatting and comparison utilities for benchmark results.
 *
 * Supports plain-text tables, GitHub-flavored Markdown, JSON export,
 * side-by-side comparisons, and regression detection.
 */
"use strict";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const COLUMNS = [
  { key: "name", label: "name", width: 24, align: "left" },
  { key: "avg", label: "avg (ms)", width: 10, align: "right", digits: 3 },
  { key: "p50", label: "p50 (ms)", width: 10, align: "right", digits: 3 },
  { key: "p95", label: "p95 (ms)", width: 10, align: "right", digits: 3 },
  { key: "p99", label: "p99 (ms)", width: 10, align: "right", digits: 3 },
  { key: "min", label: "min (ms)", width: 10, align: "right", digits: 3 },
  { key: "max", label: "max (ms)", width: 10, align: "right", digits: 3 },
  { key: "stddev", label: "stddev", width: 10, align: "right", digits: 3 },
  { key: "opsPerSec", label: "ops/s", width: 12, align: "right" },
];

/**
 * Normalize input to an array of result objects.
 * @param {object|object[]} results
 * @returns {object[]}
 */
function toList(results) {
  return Array.isArray(results) ? results : [results];
}

/**
 * Format a single cell value.
 */
function fmtCell(value, col) {
  if (col.key === "opsPerSec") {
    if (!Number.isFinite(value) || value <= 0) return "n/a".padStart(col.width);
    return (value >= 1000 ? value.toFixed(0) : value.toFixed(1)).padStart(col.width);
  }
  if (col.key === "name") {
    return String(value || "").slice(0, col.width - 1).padEnd(col.width);
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return "n/a".padStart(col.width);
  return num.toFixed(col.digits).padStart(col.width);
}

/**
 * Build aligned text rows for the given results.
 * @returns {{ header: string, rows: string[] }}
 */
function buildRows(results) {
  const list = toList(results);
  const header = COLUMNS.map((c) =>
    c.align === "right" ? c.label.padStart(c.width) : c.label.padEnd(c.width),
  ).join("");

  const rows = list.map((r) =>
    COLUMNS.map((c) => fmtCell(r[c.key], c)).join(""),
  );

  return { header, rows };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Format results as a plain-text aligned table.
 * @param {object|object[]} results
 * @returns {string}
 */
function formatAsText(results) {
  const list = toList(results);
  if (list.length === 0) return "(no results)";

  const { header, rows } = buildRows(list);
  return [header, ...rows].join("\n");
}

/**
 * Format results as a GitHub-flavored Markdown table.
 * @param {object|object[]} results
 * @returns {string}
 */
function formatAsMarkdown(results) {
  const list = toList(results);
  if (list.length === 0) return "_No results._";

  const headerParts = COLUMNS.map((c) => c.label);
  const separatorParts = COLUMNS.map((c) =>
    c.align === "right" ? "-:".padStart(c.width, "-") : ":-".padEnd(c.width, "-"),
  );

  const lines = [
    `| ${headerParts.join(" | ")} |`,
    `| ${separatorParts.join(" | ")} |`,
  ];

  for (const r of list) {
    const cells = COLUMNS.map((c) => fmtCell(r[c.key], c).trim());
    lines.push(`| ${cells.join(" | ")} |`);
  }

  return lines.join("\n");
}

/**
 * Export results as indented JSON (machine-readable).
 * @param {object|object[]} results
 * @returns {string}
 */
function formatAsJson(results) {
  return JSON.stringify(results, null, 2);
}

/**
 * Produce a side-by-side comparison of two benchmark result sets.
 * @param {object|object[]} resultA
 * @param {object|object[]} resultB
 * @returns {string} multi-line comparison string
 */
function formatComparison(resultA, resultB) {
  const listA = toList(resultA);
  const listB = toList(resultB);
  const maxLen = Math.max(listA.length, listB.length);

  const lines = [];
  lines.push(`${"Metric".padEnd(24)} ${"A".padStart(14)} ${"B".padStart(14)} ${"Delta".padStart(14)}`);
  lines.push(`${"".padEnd(24)} ${"".padStart(14)} ${"".padStart(14)} ${"".padStart(14)}`.replace(/ /g, "-"));

  for (let i = 0; i < maxLen; i++) {
    const a = listA[i] || null;
    const b = listB[i] || null;

    if (a && b) {
      const nameA = (a.name || "").slice(0, 23);
      const nameB = (b.name || "").slice(0, 23);
      const nameCol = nameA === nameB ? nameA : `${nameA} / ${nameB}`;

      const delta = b.avg - a.avg;
      const deltaPct = a.avg > 0 ? ((delta / a.avg) * 100).toFixed(1) : "n/a";
      const sign = delta > 0 ? "+" : "";

      lines.push(
        `${nameCol.padEnd(24)} ` +
        `${a.avg.toFixed(3).padStart(9)} ms ` +
        `${b.avg.toFixed(3).padStart(9)} ms ` +
        `${sign}${delta.toFixed(3).padStart(9)} ms (${sign}${deltaPct}%)`,
      );
    } else if (a) {
      lines.push(`${(a.name || "").padEnd(24)} ${a.avg.toFixed(3).padStart(9)} ms ${"(no counterpart)".padStart(14)}`);
    } else if (b) {
      lines.push(`${(b.name || "").padEnd(24)} ${"(no counterpart)".padStart(14)} ${b.avg.toFixed(3).padStart(9)} ms`);
    }
  }

  return lines.join("\n");
}

/**
 * Compare a current result against a baseline and flag regressions.
 *
 * A "regression" is defined as a metric whose value has increased by more
 * than the given threshold percentage compared to the baseline.
 *
 * @param {object} current - current benchmark result (single object; must have .avg)
 * @param {object} baseline - baseline benchmark result (single object; must have .avg)
 * @param {number} [threshold=5] - percentage threshold for flagging (e.g. 5 = 5 %)
 * @returns {object|null} regression report, or null when no regression detected
 */
function detectRegression(current, baseline, threshold = 5) {
  if (!current || !baseline) return null;

  const resolvedThreshold = Number.isFinite(threshold) ? threshold : 5;
  const metrics = ["avg", "p50", "p95", "p99", "min", "max", "stddev"];
  const regressions = [];

  for (const key of metrics) {
    const cur = Number(current[key]);
    const base = Number(baseline[key]);
    if (!Number.isFinite(cur) || !Number.isFinite(base) || base === 0) continue;

    const changePct = ((cur - base) / base) * 100;
    if (changePct > resolvedThreshold) {
      regressions.push({ metric: key, current: cur, baseline: base, changePct });
    }
  }

  if (regressions.length === 0) return null;

  return {
    name: current.name || "unnamed",
    threshold: resolvedThreshold,
    regressions,
  };
}

module.exports = {
  formatAsText,
  formatAsMarkdown,
  formatAsJson,
  formatComparison,
  detectRegression,
};
