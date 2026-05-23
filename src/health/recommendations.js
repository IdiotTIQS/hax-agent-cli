"use strict";

/**
 * HealthRecommender — generates prioritized improvement recommendations
 * from code health reports and technical debt data.
 *
 * Takes a health report (from CodeHealthScorer) and optionally a debt summary
 * (from TechnicalDebtTracker), then produces actionable improvement plans,
 * ROI estimates, and tracks improvement over time.
 */

const { DEBT_TYPES, SEVERITY_WEIGHTS } = require("./debt-tracker");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Estimated effort (hours) to resolve different issue types.
 */
const ISSUE_EFFORT = Object.freeze({
  // Structural
  LONG_FILE: { hours: 4, category: "structure" },
  LARGE_FILE: { hours: 3, category: "structure" },
  TOO_MANY_DEFINITIONS: { hours: 2, category: "structure" },
  MANY_IMPORTS: { hours: 1, category: "structure" },
  NO_EXPORTS: { hours: 0.25, category: "structure" },

  // Complexity
  HIGH_BRANCH_DENSITY: { hours: 3, category: "complexity" },
  MODERATE_BRANCH_DENSITY: { hours: 1.5, category: "complexity" },
  DEEP_NESTING: { hours: 2, category: "complexity" },
  LONG_LINES: { hours: 0.5, category: "complexity" },

  // Duplication
  DUPLICATE_CODE: { hours: 2, category: "duplication" },

  // Documentation
  LOW_COMMENT_DENSITY: { hours: 1, category: "documentation" },
  LOW_JSDOC_COVERAGE: { hours: 2, category: "documentation" },
  MISSING_FILE_HEADER: { hours: 0.25, category: "documentation" },

  // Test coverage
  NO_TESTS: { hours: 3, category: "testCoverage" },

  // Error handling
  LOW_ERROR_HANDLING: { hours: 3, category: "errorHandling" },
  FEW_TRY_CATCH: { hours: 2, category: "errorHandling" },
  BARE_THROW: { hours: 0.5, category: "errorHandling" },

  // Naming
  SINGLE_LETTER_NAMES: { hours: 0.5, category: "naming" },
  UNCLEAR_NAMES: { hours: 0.5, category: "naming" },
  MIXED_CASE: { hours: 0.5, category: "naming" },

  // Security
  EVAL_USAGE: { hours: 2, category: "security" },
  EXEC_USAGE: { hours: 1, category: "security" },
  HARDCODED_SECRETS: { hours: 0.5, category: "security" },
  SHELL_INJECTION_RISK: { hours: 1.5, category: "security" },
});

/**
 * Impact values for issue types (0-1, how much fixing this issue improves health).
 */
const ISSUE_IMPACT = Object.freeze({
  LONG_FILE: 0.6,
  LARGE_FILE: 0.5,
  TOO_MANY_DEFINITIONS: 0.4,
  MANY_IMPORTS: 0.3,
  NO_EXPORTS: 0.1,
  HIGH_BRANCH_DENSITY: 0.7,
  MODERATE_BRANCH_DENSITY: 0.3,
  DEEP_NESTING: 0.7,
  LONG_LINES: 0.2,
  DUPLICATE_CODE: 0.8,
  LOW_COMMENT_DENSITY: 0.3,
  LOW_JSDOC_COVERAGE: 0.4,
  MISSING_FILE_HEADER: 0.1,
  NO_TESTS: 0.8,
  LOW_ERROR_HANDLING: 0.9,
  FEW_TRY_CATCH: 0.6,
  BARE_THROW: 0.3,
  SINGLE_LETTER_NAMES: 0.2,
  UNCLEAR_NAMES: 0.2,
  MIXED_CASE: 0.2,
  EVAL_USAGE: 1.0,
  EXEC_USAGE: 0.9,
  HARDCODED_SECRETS: 1.0,
  SHELL_INJECTION_RISK: 1.0,
});

// ---------------------------------------------------------------------------
// HealthRecommender
// ---------------------------------------------------------------------------

class HealthRecommender {
  constructor() {
    /** @type {Array<object>} historical health reports for trend analysis */
    this._reportHistory = [];
  }

  /**
   * Generate prioritized improvement suggestions from a health report.
   * Flattens all issues across categories and sorts by ROI.
   *
   * @param {object} healthReport - output from CodeHealthScorer.scoreProject() or scoreFile()
   * @returns {Array<{issue: object, roi: number, estimatedHours: number, recommendation: string}>}
   */
  suggestImprovements(healthReport) {
    const suggestions = [];
    const categories = healthReport.categories || {};

    for (const [catKey, cat] of Object.entries(categories)) {
      const issues = cat.issues || cat.allIssues || [];

      for (const issue of issues) {
        const roi = this.estimateROI(issue);
        const effortEst = ISSUE_EFFORT[issue.type];
        const estimatedHours = effortEst ? effortEst.hours : 1;

        // Generate a specific recommendation.
        let recommendation = this._formatRecommendation(issue, cat, estimatedHours);

        suggestions.push({
          issue: {
            ...issue,
            category: catKey,
            categoryLabel: cat.label || catKey,
          },
          roi,
          estimatedHours,
          recommendation,
        });
      }
    }

    // Sort by ROI descending.
    suggestions.sort((a, b) => b.roi - a.roi);

    return suggestions;
  }

  /**
   * Estimate the return on investment for fixing a given issue.
   * ROI = impact / effort. Higher values mean better payoff per hour.
   *
   * @param {object} issue - an issue object with at least a `type` property
   * @returns {number} ROI value (higher is better)
   */
  estimateROI(issue) {
    const type = issue.type;
    const impact = ISSUE_IMPACT[type] || 0.3;

    // Severity modifier.
    const severityMod = {
      high: 1.5,
      medium: 1.0,
      low: 0.5,
      critical: 2.0,
    };
    const sevMod = severityMod[issue.severity] || 1.0;

    const effortDef = ISSUE_EFFORT[type];
    const hours = effortDef ? effortDef.hours : 1;

    const adjustedImpact = impact * sevMod;
    const roi = adjustedImpact / hours;

    return Math.round(roi * 10000) / 10000;
  }

  /**
   * Generate an action plan that fits within a given time budget (hours).
   * Selects the highest-ROI issues that can be completed within the budget.
   *
   * @param {Array<object>} issues - array of issues (or output from suggestImprovements)
   * @param {number} budget - maximum hours available for fixes
   * @returns {{
   *   budget: number,
   *   totalEstimatedHours: number,
   *   issuesPlanned: number,
   *   remainingBudget: number,
   *   plan: Array<{issue: object, estimatedHours: number, recommendation: string}>,
   *   unplanned: Array
   * }}
   */
  generateActionPlan(issues, budget) {
    if (!Array.isArray(issues)) {
      throw new TypeError("issues must be an array");
    }
    if (!Number.isFinite(budget) || budget <= 0) {
      throw new TypeError("budget must be a positive finite number");
    }

    // If issues don't have roi/estimatedHours yet, enrich them.
    const enriched = issues.map((item) => {
      if (item.roi !== undefined && item.estimatedHours !== undefined) {
        return item;
      }
      // Assume raw issue objects: { type, severity, ... }
      const roi = this.estimateROI(item);
      const effortDef = ISSUE_EFFORT[item.type];
      const estimatedHours = effortDef ? effortDef.hours : 1;
      const recommendation = this._formatRecommendation(item, null, estimatedHours);
      return { issue: item, roi, estimatedHours, recommendation };
    });

    // Sort by ROI descending.
    enriched.sort((a, b) => b.roi - a.roi);

    const plan = [];
    let remainingBudget = budget;

    for (const item of enriched) {
      if (item.estimatedHours <= remainingBudget) {
        plan.push(item);
        remainingBudget -= item.estimatedHours;
      }
    }

    const totalEstimatedHours = plan.reduce((sum, p) => sum + p.estimatedHours, 0);
    const unplanned = enriched.filter((item) => !plan.includes(item));

    return {
      budget,
      totalEstimatedHours: Math.round(totalEstimatedHours * 100) / 100,
      issuesPlanned: plan.length,
      remainingBudget: Math.round(remainingBudget * 100) / 100,
      plan,
      unplanned,
    };
  }

  /**
   * Measure the improvement between two health scores (before and after).
   *
   * @param {object} before - health report before changes
   * @param {object} after - health report after changes
   * @returns {{
   *   scoreDelta: number,
   *   percentImprovement: number,
   *   gradeChange: { from: string, to: string },
   *   categoriesImproved: number,
   *   categoriesDeclined: number,
   *   categoryDeltas: object,
   *   issuesAdded: number,
   *   issuesRemoved: number,
   *   summary: string
   * }}
   */
  trackImprovement(before, after) {
    const scoreDelta = (after.score || 0) - (before.score || 0);
    const percentImprovement = before.score > 0
      ? ((scoreDelta / before.score) * 100).toFixed(1) + "%"
      : "N/A";

    const gradeChange = {
      from: before.grade || "N/A",
      to: after.grade || "N/A",
    };

    // Per-category deltas.
    const categoryDeltas = {};
    const beforeCats = before.categories || {};
    const afterCats = after.categories || {};
    let categoriesImproved = 0;
    let categoriesDeclined = 0;

    const allCatKeys = new Set([
      ...Object.keys(beforeCats),
      ...Object.keys(afterCats),
    ]);

    for (const key of allCatKeys) {
      const beforeScore = (beforeCats[key] && beforeCats[key].score) || 0;
      const afterScore = (afterCats[key] && afterCats[key].score) || 0;
      const delta = afterScore - beforeScore;

      categoryDeltas[key] = {
        label: (beforeCats[key] && beforeCats[key].label) || (afterCats[key] && afterCats[key].label) || key,
        before: beforeScore,
        after: afterScore,
        delta,
      };

      if (delta > 0) categoriesImproved++;
      if (delta < 0) categoriesDeclined++;
    }

    // Issue counts.
    const beforeIssues = this._countIssues(before);
    const afterIssues = this._countIssues(after);
    const issuesAdded = Math.max(0, afterIssues - beforeIssues);
    const issuesRemoved = Math.max(0, beforeIssues - afterIssues);

    let summary;
    if (scoreDelta > 0) {
      summary = `Health improved by ${scoreDelta} point(s) (${percentImprovement}). ${categoriesImproved} categories improved, ${issuesRemoved} issues resolved.`;
    } else if (scoreDelta < 0) {
      summary = `Health declined by ${Math.abs(scoreDelta)} point(s). ${categoriesDeclined} categories declined, ${issuesAdded} new issues introduced.`;
    } else {
      summary = "No measurable change in health score.";
    }

    return {
      scoreDelta,
      percentImprovement,
      gradeChange,
      categoriesImproved,
      categoriesDeclined,
      categoryDeltas,
      issuesAdded,
      issuesRemoved,
      summary,
    };
  }

  /**
   * Generate a comprehensive health report with trends.
   * Stores the current report in history for future trend analysis.
   *
   * @param {object} [healthReport] - optional current health report to include. If not
   *   provided, uses the most recent report from history.
   * @returns {{
   *   current: object|null,
   *   history: Array<{timestamp: string, score: number, grade: string, issues: number}>,
   *   trend: { direction: string, scoreDeltas: Array<number>, averageChange: number, description: string },
   *   recommendations: Array
   * }}
   */
  generateHealthReport(healthReport) {
    // Store current report if provided.
    if (healthReport) {
      this._reportHistory.push({
        timestamp: new Date().toISOString(),
        score: healthReport.score,
        grade: healthReport.grade,
        categories: healthReport.categories,
        totalIssues: this._countIssues(healthReport),
        raw: healthReport,
      });
    }

    const current =
      this._reportHistory.length > 0
        ? this._reportHistory[this._reportHistory.length - 1]
        : null;

    // Compute trend.
    const scoreDeltas = [];
    for (let i = 1; i < this._reportHistory.length; i++) {
      scoreDeltas.push(
        this._reportHistory[i].score - this._reportHistory[i - 1].score
      );
    }

    const averageChange =
      scoreDeltas.length > 0
        ? scoreDeltas.reduce((a, b) => a + b, 0) / scoreDeltas.length
        : 0;

    let direction = "stable";
    if (averageChange > 1) direction = "improving";
    else if (averageChange < -1) direction = "declining";

    const trendDescription =
      this._reportHistory.length < 2
        ? "Insufficient history for trend analysis"
        : direction === "improving"
          ? `Health is improving (avg +${averageChange.toFixed(1)} points per report)`
          : direction === "declining"
            ? `Health is declining (avg ${averageChange.toFixed(1)} points per report)`
            : "Health is stable";

    // Generate recommendations from the most recent report.
    let recommendations = [];
    if (healthReport && healthReport.categories) {
      recommendations = this.suggestImprovements(healthReport);
    } else if (current && current.raw && current.raw.categories) {
      recommendations = this.suggestImprovements(current.raw);
    }

    return {
      current: current
        ? {
            timestamp: current.timestamp,
            score: current.score,
            grade: current.grade,
            issues: current.totalIssues,
          }
        : null,
      history: this._reportHistory.map((h) => ({
        timestamp: h.timestamp,
        score: h.score,
        grade: h.grade,
        issues: h.totalIssues,
      })),
      trend: {
        direction,
        scoreDeltas,
        averageChange: Math.round(averageChange * 100) / 100,
        description: trendDescription,
      },
      recommendations: recommendations.slice(0, 10), // top 10 by ROI
    };
  }

  /**
   * Get the full history of tracked health reports.
   *
   * @returns {Array<object>}
   */
  getHistory() {
    return [...this._reportHistory];
  }

  /**
   * Clear all historical data.
   */
  clearHistory() {
    this._reportHistory = [];
  }

  // ---- Private helpers ----

  _countIssues(report) {
    const categories = report.categories || {};
    let count = 0;
    for (const cat of Object.values(categories)) {
      if (cat.issues) {
        count += cat.issues.length;
      } else if (cat.allIssues) {
        count += cat.allIssues.length;
      } else if (cat.totalIssues !== undefined) {
        count += cat.totalIssues;
      }
    }
    if (report.totalIssues !== undefined) {
      count = report.totalIssues;
    }
    return count;
  }

  _formatRecommendation(issue, cat, estimatedHours) {
    const type = issue.type || "UNKNOWN";
    const severity = issue.severity || "medium";
    const file = issue.file || issue.filePath || "";

    const severityLabel = severity.charAt(0).toUpperCase() + severity.slice(1);
    const fileRef = file ? ` in ${file}` : "";

    switch (type) {
      case "LONG_FILE":
      case "LARGE_FILE":
        return `[${severityLabel}] Split large file${fileRef} into smaller, focused modules (~${estimatedHours}h).`;
      case "HIGH_BRANCH_DENSITY":
      case "MODERATE_BRANCH_DENSITY":
        return `[${severityLabel}] Simplify conditional logic${fileRef} by extracting helper functions or using lookup tables (~${estimatedHours}h).`;
      case "DEEP_NESTING":
        return `[${severityLabel}] Flatten deep nesting${fileRef} by extracting inner blocks into named functions (~${estimatedHours}h).`;
      case "DUPLICATE_CODE":
        return `[${severityLabel}] Extract duplicated code${fileRef} into a shared utility function (~${estimatedHours}h).`;
      case "NO_TESTS":
        return `[${severityLabel}] Write unit tests for${fileRef} to prevent regressions (~${estimatedHours}h).`;
      case "LOW_JSDOC_COVERAGE":
      case "LOW_COMMENT_DENSITY":
        return `[${severityLabel}] Improve documentation${fileRef} with JSDoc comments and inline explanations (~${estimatedHours}h).`;
      case "LOW_ERROR_HANDLING":
      case "FEW_TRY_CATCH":
        return `[${severityLabel}] Add error handling (try/catch)${fileRef} around risky operations (~${estimatedHours}h).`;
      case "EVAL_USAGE":
        return `[${severityLabel}] Replace eval()${fileRef} with a safer alternative immediately (${estimatedHours}h).`;
      case "EXEC_USAGE":
        return `[${severityLabel}] Replace child_process.exec()${fileRef} with execFile() and sanitize inputs (~${estimatedHours}h).`;
      case "HARDCODED_SECRETS":
        return `[${severityLabel}] Remove hardcoded secrets${fileRef} and use environment variables (~${estimatedHours}h).`;
      case "SHELL_INJECTION_RISK":
        return `[${severityLabel}] Sanitize inputs${fileRef} passed to shell commands (~${estimatedHours}h).`;
      case "SINGLE_LETTER_NAMES":
      case "UNCLEAR_NAMES":
        return `[${severityLabel}] Rename unclear identifiers${fileRef} with descriptive, domain-specific names (~${estimatedHours}h).`;
      case "TOO_MANY_DEFINITIONS":
        return `[${severityLabel}] Extract groups of related functions${fileRef} into focused modules (~${estimatedHours}h).`;
      default:
        return `[${severityLabel}] Fix ${type}${fileRef} — estimated ${estimatedHours}h`;
    }
  }
}

module.exports = {
  HealthRecommender,
  ISSUE_EFFORT,
  ISSUE_IMPACT,
};
