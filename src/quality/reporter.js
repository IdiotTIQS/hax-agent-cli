"use strict";

/**
 * Quality gate reporter — formats gate results in various output styles.
 *
 * Gate result shape (from QualityGate.runAll / runByName):
 *   { passed, failed, skipped, totalScore, maxScore, threshold, results }
 * Each result entry:
 *   { name, status, message, score, details, weight }
 */

const STATUS_ICONS = {
  pass: "✓",
  fail: "✖",
  skip: "○",
};

const STATUS_COLORS = {
  pass: "green",
  fail: "red",
  skip: "gray",
};

/**
 * Format a single gate result as a human-readable string.
 * @param {object} result — the full gate run result
 * @returns {string}
 */
function formatGateResult(result) {
  const lines = [];

  const verdict = result.passed ? "PASSED" : "FAILED";
  lines.push(`Quality Gate: ${verdict}`);
  lines.push(`  Score: ${result.totalScore}/${result.maxScore}`);
  if (result.threshold > 0) {
    lines.push(`  Threshold: ${result.threshold}`);
  }
  lines.push(`  Failed: ${result.failed}  Skipped: ${result.skipped}`);
  lines.push("");

  for (const r of result.results) {
    const icon = STATUS_ICONS[r.status] || "?";
    const statusLabel = r.status.toUpperCase();
    lines.push(`  ${icon} [${statusLabel}] ${r.name}: ${r.message} (score: ${r.score})`);
  }

  return lines.join("\n");
}

/**
 * Format results as a markdown checklist.
 * @param {object[]} results — result.results array
 * @returns {string}
 */
function formatAsChecklist(results) {
  const lines = [];

  for (const r of results) {
    if (r.status === "pass") {
      lines.push(`- [x] **${r.name}**: ${r.message}`);
    } else if (r.status === "fail") {
      lines.push(`- [ ] **${r.name}**: ${r.message} *(failed)*`);
    } else {
      lines.push(`- [ ] **${r.name}**: ${r.message} *(skipped)*`);
    }
  }

  return lines.join("\n");
}

/**
 * Format results as a shields.io badge URL (markdown format).
 * @param {object} result — the full gate run result
 * @returns {string}
 */
function formatAsBadge(result) {
  const label = "quality gate";
  const status = result.passed ? "passed" : "failed";
  const color = result.passed ? "green" : "red";
  return `![${label}](https://img.shields.io/badge/${label}-${status}-${color})`;
}

/**
 * One-line summary of a gate run.
 * @param {object} result — the full gate run result
 * @returns {string}
 */
function summarizeGateRun(result) {
  const verdict = result.passed ? "PASS" : "FAIL";
  return `[${verdict}] ${result.failed} failed, ${result.skipped} skipped — score ${result.totalScore}/${result.maxScore}`;
}

/**
 * Append a gate run to the quality history log.
 * Returns the updated history array.
 * @param {object} run — the full gate run result
 * @param {Array<object>} [history] — existing history array (optional)
 * @returns {Array<object>}
 */
function trackHistory(run, history) {
  const log = history || [];
  const entry = {
    timestamp: new Date().toISOString(),
    passed: run.passed,
    totalScore: run.totalScore,
    maxScore: run.maxScore,
    failed: run.failed,
    skipped: run.skipped,
    threshold: run.threshold,
    checkCount: run.results.length,
  };
  log.push(entry);
  return log;
}

/**
 * Generate a quality trend summary from history entries.
 * @param {Array<object>} history — array of tracked history entries
 * @returns {{ entries: number, passCount: number, failCount: number, passRate: string, scores: number[], trend: 'improving'|'declining'|'stable'|'insufficient-data' }}
 */
function getQualityTrend(history) {
  if (!history || history.length === 0) {
    return { entries: 0, passCount: 0, failCount: 0, passRate: "0%", scores: [], trend: "insufficient-data" };
  }

  let passCount = 0;
  let failCount = 0;
  const scores = [];

  for (const entry of history) {
    if (entry.passed) {
      passCount++;
    } else {
      failCount++;
    }
    if (entry.maxScore > 0) {
      scores.push(entry.totalScore / entry.maxScore);
    } else {
      scores.push(0);
    }
  }

  const passRate = ((passCount / history.length) * 100).toFixed(0) + "%";

  let trend = "stable";
  if (scores.length >= 2) {
    const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
    const secondHalf = scores.slice(Math.floor(scores.length / 2));
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    if (secondAvg > firstAvg + 0.05) {
      trend = "improving";
    } else if (secondAvg < firstAvg - 0.05) {
      trend = "declining";
    }
  } else {
    trend = "insufficient-data";
  }

  return { entries: history.length, passCount, failCount, passRate, scores, trend };
}

module.exports = {
  STATUS_ICONS,
  STATUS_COLORS,
  formatGateResult,
  formatAsChecklist,
  formatAsBadge,
  summarizeGateRun,
  trackHistory,
  getQualityTrend,
};
