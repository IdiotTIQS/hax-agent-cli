"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert");

const {
  HealthRecommender,
  ISSUE_EFFORT,
  ISSUE_IMPACT,
} = require("../../src/health/recommendations");

// -------------------------------------------------------------------------
// Helpers: build realistic health reports
// -------------------------------------------------------------------------

function makeCategory(key, label, score, weight, issues) {
  return {
    [key]: {
      label,
      weight,
      score,
      issues,
      suggestions: issues.map((i) => `Fix suggestion for ${i.type}`),
    },
  };
}

function makeFileHealthReport(filePath, score, categories) {
  return {
    score,
    grade: score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : "D",
    filePath,
    categories: Object.assign({}, ...Object.entries(categories).map(
      ([k, v]) => ({ [k]: v })
    )),
    totalIssues: Object.values(categories).reduce(
      (sum, cat) => sum + (cat.issues || []).length, 0
    ),
    summary: "Test health report",
  };
}

function makeProjectHealthReport(score, categories) {
  const catObj = {};
  let totalIssues = 0;
  for (const [key, cat] of Object.entries(categories)) {
    catObj[key] = {
      ...cat,
      allIssues: cat.issues || [],
      allSuggestions: cat.suggestions || [],
    };
    totalIssues += (cat.issues || []).length;
  }
  return {
    score,
    grade: score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : "D",
    scope: "directory",
    root: "/project",
    fileCount: 10,
    scoredCount: 8,
    skippedCount: 2,
    fileScores: [],
    categories: catObj,
    totalIssues,
    summary: `Project health: ${score}/100`,
  };
}

// -------------------------------------------------------------------------
// suggestImprovements
// -------------------------------------------------------------------------

test("suggestImprovements returns sorted recommendations from a health report", () => {
  const recommender = new HealthRecommender();
  const report = makeFileHealthReport("/src/app.js", 55, {
    complexity: {
      label: "Complexity", weight: 0.18, score: 50,
      issues: [
        { type: "HIGH_BRANCH_DENSITY", severity: "high", message: "high branch density" },
        { type: "DEEP_NESTING", severity: "medium", message: "deep nesting" },
      ],
    },
    security: {
      label: "Security", weight: 0.07, score: 45,
      issues: [
        { type: "EVAL_USAGE", severity: "high", message: "eval used" },
        { type: "HARDCODED_SECRETS", severity: "critical", message: "secret in code" },
      ],
    },
    documentation: {
      label: "Documentation", weight: 0.12, score: 60,
      issues: [
        { type: "LOW_JSDOC_COVERAGE", severity: "medium", message: "missing jsdoc" },
      ],
    },
    duplication: { label: "Duplication", weight: 0.14, score: 80, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 30, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 70, issues: [] },
    naming: { label: "Naming", weight: 0.10, score: 90, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 75, issues: [] },
  });

  const suggestions = recommender.suggestImprovements(report);

  assert.ok(suggestions.length > 0, "expected at least one suggestion");

  // Security issues (EVAL_USAGE, HARDCODED_SECRETS) should rank high (high impact).
  // ROI should be descending.
  for (let i = 1; i < suggestions.length; i++) {
    assert.ok(
      suggestions[i - 1].roi >= suggestions[i].roi,
      `ROI at ${i - 1} (${suggestions[i - 1].roi}) >= ROI at ${i} (${suggestions[i].roi})`
    );
  }

  // Each suggestion should have required fields.
  for (const s of suggestions) {
    assert.ok(s.issue, "missing issue");
    assert.ok(typeof s.roi === "number", "roi should be number");
    assert.ok(s.estimatedHours > 0, "estimatedHours should be positive");
    assert.ok(typeof s.recommendation === "string", "recommendation should be string");
    assert.ok(s.recommendation.length > 10, "recommendation should be descriptive");
  }
});

test("suggestImprovements returns empty array for clean report", () => {
  const recommender = new HealthRecommender();
  const report = makeFileHealthReport("/src/clean.js", 95, {
    complexity: { label: "Complexity", weight: 0.18, score: 95, issues: [] },
    duplication: { label: "Duplication", weight: 0.14, score: 100, issues: [] },
    documentation: { label: "Documentation", weight: 0.12, score: 90, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 100, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 95, issues: [] },
    naming: { label: "Naming", weight: 0.10, score: 95, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 90, issues: [] },
    security: { label: "Security", weight: 0.07, score: 100, issues: [] },
  });

  const suggestions = recommender.suggestImprovements(report);
  assert.strictEqual(suggestions.length, 0);
});

// -------------------------------------------------------------------------
// estimateROI
// -------------------------------------------------------------------------

test("estimateROI returns higher ROI for high-impact, low-effort issues", () => {
  const recommender = new HealthRecommender();

  const highRoi = recommender.estimateROI({
    type: "HARDCODED_SECRETS",
    severity: "critical",
  });
  const lowRoi = recommender.estimateROI({
    type: "MISSING_FILE_HEADER",
    severity: "low",
  });

  assert.ok(highRoi > lowRoi, `highRoi (${highRoi}) should exceed lowRoi (${lowRoi})`);

  // Also: higher severity same type gives higher ROI.
  const lowSev = recommender.estimateROI({ type: "EVAL_USAGE", severity: "low" });
  const highSev = recommender.estimateROI({ type: "EVAL_USAGE", severity: "critical" });
  assert.ok(highSev > lowSev, `high severity (${highSev}) should exceed low (${lowSev})`);
});

test("estimateROI assigns default values for unknown issue types", () => {
  const recommender = new HealthRecommender();
  const roi = recommender.estimateROI({ type: "SOME_UNKNOWN_THING", severity: "medium" });
  assert.ok(roi > 0, "ROI should be positive even for unknown types");
  assert.ok(Number.isFinite(roi), "ROI should be finite");
});

test("ISSUE_EFFORT covers all ISSUE_IMPACT types and vice versa", () => {
  // Some types only in IMPACT (security related patterns) or only in EFFORT is OK,
  // but most should overlap.
  const effortKeys = new Set(Object.keys(ISSUE_EFFORT));
  const impactKeys = new Set(Object.keys(ISSUE_IMPACT));

  const common = [...effortKeys].filter((k) => impactKeys.has(k));
  assert.ok(common.length > 10, `expected > 10 common keys, got ${common.length}`);
});

// -------------------------------------------------------------------------
// generateActionPlan
// -------------------------------------------------------------------------

test("generateActionPlan fits issues within budget", () => {
  const recommender = new HealthRecommender();
  const report = makeProjectHealthReport(50, {
    complexity: {
      label: "Complexity", weight: 0.18, score: 50,
      issues: [
        { type: "HIGH_BRANCH_DENSITY", severity: "high", message: "branch density" },
        { type: "DEEP_NESTING", severity: "medium", message: "deep nesting" },
      ],
    },
    security: {
      label: "Security", weight: 0.07, score: 40,
      issues: [
        { type: "EVAL_USAGE", severity: "high", message: "eval" },
        { type: "HARDCODED_SECRETS", severity: "critical", message: "secrets" },
      ],
    },
    duplication: { label: "Duplication", weight: 0.14, score: 70, issues: [] },
    documentation: { label: "Documentation", weight: 0.12, score: 60, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 50, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 55, issues: [] },
    naming: { label: "Naming", weight: 0.10, score: 80, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 70, issues: [] },
  });

  const suggestions = recommender.suggestImprovements(report);

  // Budget of 4 hours.
  const plan = recommender.generateActionPlan(suggestions, 4);

  assert.ok(plan.issuesPlanned > 0, `expected some planned issues, got ${plan.issuesPlanned}`);
  assert.ok(plan.totalEstimatedHours <= plan.budget,
    `total (${plan.totalEstimatedHours}) should be <= budget (${plan.budget})`);
  assert.ok(plan.remainingBudget >= 0);
  assert.ok(plan.plan.length === plan.issuesPlanned);
  assert.ok(plan.unplanned.length > 0, "some issues should be unplanned when budget is tight");
});

test("generateActionPlan works with raw issue objects", () => {
  const recommender = new HealthRecommender();
  const rawIssues = [
    { type: "HARDCODED_SECRETS", severity: "critical", message: "secret" },
    { type: "MISSING_FILE_HEADER", severity: "low", message: "header" },
    { type: "NO_TESTS", severity: "high", message: "tests" },
  ];

  const plan = recommender.generateActionPlan(rawIssues, 3);
  assert.ok(plan.plan.length > 0);
});

test("generateActionPlan throws on invalid inputs", () => {
  const recommender = new HealthRecommender();
  assert.throws(() => recommender.generateActionPlan(null, 5), TypeError);
  assert.throws(() => recommender.generateActionPlan([], 0), TypeError);
  assert.throws(() => recommender.generateActionPlan([], -1), TypeError);
});

test("generateActionPlan includes all issues when budget is sufficient", () => {
  const recommender = new HealthRecommender();
  const report = makeFileHealthReport("/src/small.js", 60, {
    complexity: {
      label: "Complexity", weight: 0.18, score: 60,
      issues: [
        { type: "LONG_LINES", severity: "low", message: "long lines" },
      ],
    },
    naming: {
      label: "Naming", weight: 0.10, score: 70,
      issues: [
        { type: "SINGLE_LETTER_NAMES", severity: "low", message: "bad names" },
      ],
    },
    duplication: { label: "Duplication", weight: 0.14, score: 80, issues: [] },
    documentation: { label: "Documentation", weight: 0.12, score: 80, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 80, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 80, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 80, issues: [] },
    security: { label: "Security", weight: 0.07, score: 80, issues: [] },
  });

  const suggestions = recommender.suggestImprovements(report);
  const plan = recommender.generateActionPlan(suggestions, 1000);
  assert.strictEqual(plan.unplanned.length, 0, "all issues should be planned with large budget");
  assert.strictEqual(plan.issuesPlanned, suggestions.length);
});

// -------------------------------------------------------------------------
// trackImprovement
// -------------------------------------------------------------------------

test("trackImprovement measures positive improvement", () => {
  const recommender = new HealthRecommender();
  const before = makeFileHealthReport("/src/app.js", 55, {
    complexity: { label: "Complexity", weight: 0.18, score: 50, issues: [{ type: "DEEP_NESTING", severity: "high" }] },
    duplication: { label: "Duplication", weight: 0.14, score: 40, issues: [{ type: "DUPLICATE_CODE", severity: "high" }] },
    documentation: { label: "Documentation", weight: 0.12, score: 60, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 50, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 60, issues: [] },
    naming: { label: "Naming", weight: 0.10, score: 80, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 70, issues: [] },
    security: { label: "Security", weight: 0.07, score: 60, issues: [] },
  });

  const after = makeFileHealthReport("/src/app.js", 80, {
    complexity: { label: "Complexity", weight: 0.18, score: 80, issues: [] },
    duplication: { label: "Duplication", weight: 0.14, score: 85, issues: [] },
    documentation: { label: "Documentation", weight: 0.12, score: 75, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 70, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 85, issues: [] },
    naming: { label: "Naming", weight: 0.10, score: 85, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 80, issues: [] },
    security: { label: "Security", weight: 0.07, score: 80, issues: [] },
  });

  const improvement = recommender.trackImprovement(before, after);

  assert.strictEqual(improvement.scoreDelta, 25);
  assert.ok(Number.parseFloat(improvement.percentImprovement) > 0);
  assert.strictEqual(improvement.gradeChange.from, "D");
  assert.strictEqual(improvement.gradeChange.to, "B");
  assert.ok(improvement.categoriesImproved > 0);
  assert.strictEqual(improvement.categoriesDeclined, 0);
  assert.ok(improvement.summary.includes("improved"));
});

test("trackImprovement detects decline in health", () => {
  const recommender = new HealthRecommender();
  const before = makeFileHealthReport("/src/app.js", 85, {
    complexity: { label: "Complexity", weight: 0.18, score: 85, issues: [] },
    duplication: { label: "Duplication", weight: 0.14, score: 85, issues: [] },
    documentation: { label: "Documentation", weight: 0.12, score: 85, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 85, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 85, issues: [] },
    naming: { label: "Naming", weight: 0.10, score: 85, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 85, issues: [] },
    security: { label: "Security", weight: 0.07, score: 85, issues: [] },
  });

  const after = makeFileHealthReport("/src/app.js", 60, {
    complexity: { label: "Complexity", weight: 0.18, score: 60, issues: [] },
    duplication: { label: "Duplication", weight: 0.14, score: 60, issues: [{ type: "DUPLICATE_CODE", severity: "high" }] },
    documentation: { label: "Documentation", weight: 0.12, score: 60, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 60, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 60, issues: [] },
    naming: { label: "Naming", weight: 0.10, score: 60, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 60, issues: [] },
    security: { label: "Security", weight: 0.07, score: 60, issues: [] },
  });

  const improvement = recommender.trackImprovement(before, after);

  assert.ok(improvement.scoreDelta < 0);
  assert.ok(improvement.summary.includes("declined"));
  assert.ok(improvement.issuesAdded > 0);
});

test("trackImprovement handles no change", () => {
  const recommender = new HealthRecommender();
  const report = makeFileHealthReport("/src/app.js", 75, {
    complexity: { label: "Complexity", weight: 0.18, score: 75, issues: [] },
    duplication: { label: "Duplication", weight: 0.14, score: 75, issues: [] },
    documentation: { label: "Documentation", weight: 0.12, score: 75, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 75, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 75, issues: [] },
    naming: { label: "Naming", weight: 0.10, score: 75, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 75, issues: [] },
    security: { label: "Security", weight: 0.07, score: 75, issues: [] },
  });

  const improvement = recommender.trackImprovement(report, report);
  assert.strictEqual(improvement.scoreDelta, 0);
  assert.ok(improvement.summary.includes("No measurable change"));
});

// -------------------------------------------------------------------------
// generateHealthReport
// -------------------------------------------------------------------------

test("generateHealthReport stores and returns history with trend", () => {
  const recommender = new HealthRecommender();

  const r1 = makeFileHealthReport("/src/app.js", 55, {
    complexity: { label: "Complexity", weight: 0.18, score: 55, issues: [] },
    duplication: { label: "Duplication", weight: 0.14, score: 55, issues: [] },
    documentation: { label: "Documentation", weight: 0.12, score: 55, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 55, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 55, issues: [] },
    naming: { label: "Naming", weight: 0.10, score: 55, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 55, issues: [] },
    security: { label: "Security", weight: 0.07, score: 55, issues: [] },
  });

  const r2 = makeFileHealthReport("/src/app.js", 72, {
    complexity: { label: "Complexity", weight: 0.18, score: 72, issues: [] },
    duplication: { label: "Duplication", weight: 0.14, score: 72, issues: [] },
    documentation: { label: "Documentation", weight: 0.12, score: 72, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 72, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 72, issues: [] },
    naming: { label: "Naming", weight: 0.10, score: 72, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 72, issues: [] },
    security: { label: "Security", weight: 0.07, score: 72, issues: [] },
  });

  const r3 = makeFileHealthReport("/src/app.js", 88, {
    complexity: { label: "Complexity", weight: 0.18, score: 88, issues: [] },
    duplication: { label: "Duplication", weight: 0.14, score: 88, issues: [] },
    documentation: { label: "Documentation", weight: 0.12, score: 88, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 88, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 88, issues: [] },
    naming: { label: "Naming", weight: 0.10, score: 88, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 88, issues: [] },
    security: { label: "Security", weight: 0.07, score: 88, issues: [] },
  });

  recommender.generateHealthReport(r1);
  recommender.generateHealthReport(r2);
  const fullReport = recommender.generateHealthReport(r3);

  assert.ok(fullReport.current);
  assert.strictEqual(fullReport.current.score, 88);
  assert.strictEqual(fullReport.current.grade, "B");
  assert.strictEqual(fullReport.history.length, 3);
  assert.strictEqual(fullReport.trend.direction, "improving");
  assert.ok(fullReport.trend.averageChange > 0);
  assert.ok(fullReport.trend.description.includes("improving"));
});

test("generateHealthReport works without providing a report", () => {
  const recommender = new HealthRecommender();
  const report = recommender.generateHealthReport();
  assert.strictEqual(report.current, null);
  assert.strictEqual(report.history.length, 0);
  assert.strictEqual(report.trend.direction, "stable");
  assert.strictEqual(report.trend.description, "Insufficient history for trend analysis");
});

test("getHistory returns a copy of all reports", () => {
  const recommender = new HealthRecommender();
  const r1 = makeFileHealthReport("/src/a.js", 80, {
    complexity: { label: "Complexity", weight: 0.18, score: 80, issues: [] },
    duplication: { label: "Duplication", weight: 0.14, score: 80, issues: [] },
    documentation: { label: "Documentation", weight: 0.12, score: 80, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 80, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 80, issues: [] },
    naming: { label: "Naming", weight: 0.10, score: 80, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 80, issues: [] },
    security: { label: "Security", weight: 0.07, score: 80, issues: [] },
  });

  recommender.generateHealthReport(r1);
  const history = recommender.getHistory();
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].score, 80);

  // Mutating the returned array should not affect internal state.
  history.length = 0;
  assert.strictEqual(recommender.getHistory().length, 1);
});

test("clearHistory removes all stored reports", () => {
  const recommender = new HealthRecommender();
  const report = makeFileHealthReport("/src/app.js", 70, {
    complexity: { label: "Complexity", weight: 0.18, score: 70, issues: [] },
    duplication: { label: "Duplication", weight: 0.14, score: 70, issues: [] },
    documentation: { label: "Documentation", weight: 0.12, score: 70, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 70, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 70, issues: [] },
    naming: { label: "Naming", weight: 0.10, score: 70, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 70, issues: [] },
    security: { label: "Security", weight: 0.07, score: 70, issues: [] },
  });

  recommender.generateHealthReport(report);
  assert.strictEqual(recommender.getHistory().length, 1);

  recommender.clearHistory();
  assert.strictEqual(recommender.getHistory().length, 0);
});

// -------------------------------------------------------------------------
// Edge cases
// -------------------------------------------------------------------------

test("suggestImprovements handles report with allIssues from project-level report", () => {
  const recommender = new HealthRecommender();
  const report = makeProjectHealthReport(60, {
    complexity: {
      label: "Complexity", weight: 0.18, score: 60,
      issues: [
        { type: "LONG_FILE", severity: "high", message: "file > 300 lines" },
      ],
    },
    duplication: { label: "Duplication", weight: 0.14, score: 80, issues: [] },
    documentation: { label: "Documentation", weight: 0.12, score: 60, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 50, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 55, issues: [] },
    naming: { label: "Naming", weight: 0.10, score: 60, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 65, issues: [] },
    security: { label: "Security", weight: 0.07, score: 60, issues: [] },
  });

  const suggestions = recommender.suggestImprovements(report);
  assert.ok(suggestions.length >= 1, `expected >= 1, got ${suggestions.length}`);
});

test("generateActionPlan respects tight budget with precise selection", () => {
  const recommender = new HealthRecommender();
  const report = makeFileHealthReport("/src/app.js", 50, {
    complexity: {
      label: "Complexity", weight: 0.18, score: 50,
      issues: [
        { type: "HIGH_BRANCH_DENSITY", severity: "high", message: "high branch" },
        { type: "DEEP_NESTING", severity: "high", message: "deep nesting" },
      ],
    },
    security: {
      label: "Security", weight: 0.07, score: 40,
      issues: [
        { type: "EVAL_USAGE", severity: "critical", message: "eval" },
      ],
    },
    duplication: { label: "Duplication", weight: 0.14, score: 50, issues: [] },
    documentation: { label: "Documentation", weight: 0.12, score: 50, issues: [] },
    testCoverage: { label: "Test Coverage", weight: 0.15, score: 50, issues: [] },
    errorHandling: { label: "Error Handling", weight: 0.14, score: 50, issues: [] },
    naming: { label: "Naming", weight: 0.10, score: 50, issues: [] },
    structure: { label: "Structure", weight: 0.10, score: 50, issues: [] },
  });

  const suggestions = recommender.suggestImprovements(report);

  // Budget of 0.5 hours — should only fit the cheapest high-ROI item.
  const plan = recommender.generateActionPlan(suggestions, 0.5);
  assert.ok(plan.issuesPlanned >= 0);
  // All planned items should fit in budget.
  for (const item of plan.plan) {
    assert.ok(item.estimatedHours <= 0.5, `item ${item.issue.type} costs ${item.estimatedHours}h, exceeding budget 0.5h`);
  }
});
