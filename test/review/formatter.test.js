"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert");

const {
  ReviewFormatter,
  groupBySeverity,
  groupByFile,
  sortFindings,
  SEVERITY_EMOJI,
  SEVERITY_LABEL,
} = require("../../src/review/formatter");

// ---------------------------------------------------------------------------
// Sample findings
// ---------------------------------------------------------------------------

function sampleFindings() {
  return [
    {
      file: "src/auth.js",
      line: 42,
      perspective: "security",
      severity: "BLOCKER",
      title: "Hardcoded API key",
      message: "Found a hardcoded API key on line 42.",
      suggestion: "Move API key to environment variable.",
    },
    {
      file: "src/auth.js",
      line: 88,
      perspective: "security",
      severity: "CRITICAL",
      title: "Use of eval()",
      message: "eval() used on line 88.",
      suggestion: "Replace eval() with JSON.parse().",
    },
    {
      file: "src/utils.js",
      line: 15,
      perspective: "performance",
      severity: "MAJOR",
      title: "Sync fs operation",
      message: "fs.readFileSync blocks the event loop.",
      suggestion: "Use fs.promises.readFile() instead.",
    },
    {
      file: "src/utils.js",
      line: 55,
      perspective: "maintainability",
      severity: "MINOR",
      title: "Magic number",
      message: "The number 3600 appears without explanation.",
      suggestion: "Extract 3600 into a named constant.",
    },
    {
      file: "src/format.js",
      line: 10,
      perspective: "style",
      severity: "SUGGESTION",
      title: "Missing use strict",
      message: "File does not start with 'use strict'.",
      suggestion: "Add 'use strict' as the first line.",
    },
  ];
}

// ---------------------------------------------------------------------------
// groupBySeverity
// ---------------------------------------------------------------------------

test("groupBySeverity groups findings by severity level", () => {
  const findings = sampleFindings();
  const groups = groupBySeverity(findings);
  assert.strictEqual(groups.BLOCKER.length, 1);
  assert.strictEqual(groups.CRITICAL.length, 1);
  assert.strictEqual(groups.MAJOR.length, 1);
  assert.strictEqual(groups.MINOR.length, 1);
  assert.strictEqual(groups.SUGGESTION.length, 1);
});

test("groupBySeverity returns empty arrays for missing severities", () => {
  const groups = groupBySeverity([]);
  assert.strictEqual(groups.BLOCKER.length, 0);
  assert.strictEqual(groups.CRITICAL.length, 0);
  assert.strictEqual(groups.MAJOR.length, 0);
  assert.strictEqual(groups.MINOR.length, 0);
  assert.strictEqual(groups.SUGGESTION.length, 0);
});

// ---------------------------------------------------------------------------
// groupByFile
// ---------------------------------------------------------------------------

test("groupByFile groups findings by file path", () => {
  const findings = sampleFindings();
  const byFile = groupByFile(findings);
  assert.strictEqual(Object.keys(byFile).length, 3);
  assert.strictEqual(byFile["src/auth.js"].length, 2);
  assert.strictEqual(byFile["src/utils.js"].length, 2);
  assert.strictEqual(byFile["src/format.js"].length, 1);
});

test("groupByFile handles findings with missing file property", () => {
  const findings = [
    { file: "a.js", line: 1, severity: "MINOR", title: "T" },
    { line: 2, severity: "MAJOR", title: "No file" },
  ];
  const byFile = groupByFile(findings);
  assert.ok(Object.keys(byFile).includes("<unknown>"));
});

// ---------------------------------------------------------------------------
// sortFindings
// ---------------------------------------------------------------------------

test("sortFindings sorts by severity (most severe first)", () => {
  const findings = [
    { file: "a.js", line: 1, severity: "SUGGESTION", title: "S" },
    { file: "b.js", line: 1, severity: "BLOCKER", title: "B" },
    { file: "c.js", line: 1, severity: "MINOR", title: "M" },
    { file: "d.js", line: 1, severity: "CRITICAL", title: "C" },
    { file: "e.js", line: 1, severity: "MAJOR", title: "Mj" },
  ];
  const sorted = sortFindings(findings);
  assert.strictEqual(sorted[0].severity, "BLOCKER");
  assert.strictEqual(sorted[1].severity, "CRITICAL");
  assert.strictEqual(sorted[2].severity, "MAJOR");
  assert.strictEqual(sorted[3].severity, "MINOR");
  assert.strictEqual(sorted[4].severity, "SUGGESTION");
});

test("sortFindings sorts by file path within same severity, then by line", () => {
  const findings = [
    { file: "z.js", line: 5, severity: "MINOR", title: "Z" },
    { file: "a.js", line: 99, severity: "MINOR", title: "A-L99" },
    { file: "a.js", line: 1, severity: "MINOR", title: "A-L1" },
  ];
  const sorted = sortFindings(findings);
  assert.strictEqual(sorted[0].file, "a.js");
  assert.strictEqual(sorted[0].line, 1);
  assert.strictEqual(sorted[1].file, "a.js");
  assert.strictEqual(sorted[1].line, 99);
  assert.strictEqual(sorted[2].file, "z.js");
});

// ---------------------------------------------------------------------------
// ReviewFormatter: formatAsPRComment
// ---------------------------------------------------------------------------

test("formatAsPRComment returns a markdown string with title", () => {
  const formatter = new ReviewFormatter();
  const findings = sampleFindings();
  const output = formatter.formatAsPRComment(findings);
  assert.ok(typeof output === "string");
  assert.ok(output.includes("Automated Code Review"));
  assert.ok(output.includes("5 finding"));
});

test("formatAsPRComment includes severity table", () => {
  const formatter = new ReviewFormatter();
  const findings = sampleFindings();
  const output = formatter.formatAsPRComment(findings);
  assert.ok(output.includes("| Severity | Count |"));
  assert.ok(output.includes("BLOCKER"));
  assert.ok(output.includes("| 1 |"));
});

test("formatAsPRComment shows clean message when no findings", () => {
  const formatter = new ReviewFormatter();
  const output = formatter.formatAsPRComment([]);
  assert.ok(output.includes("All clear"));
  assert.ok(output.includes("No issues found"));
});

test("formatAsPRComment respects custom title option", () => {
  const formatter = new ReviewFormatter();
  const findings = sampleFindings();
  const output = formatter.formatAsPRComment(findings, { title: "Security Review" });
  assert.ok(output.includes("Security Review"));
});

test("formatAsPRComment includes footerText from constructor options", () => {
  const formatter = new ReviewFormatter({ footerText: "Generated by HaxAgent review pipeline." });
  const findings = sampleFindings();
  const output = formatter.formatAsPRComment(findings);
  assert.ok(output.includes("Generated by HaxAgent review pipeline."));
});

// ---------------------------------------------------------------------------
// ReviewFormatter: formatAsChecklist
// ---------------------------------------------------------------------------

test("formatAsChecklist produces checkbox items for each finding", () => {
  const formatter = new ReviewFormatter();
  const findings = sampleFindings();
  const output = formatter.formatAsChecklist(findings);
  assert.ok(output.includes("Code Review Checklist"));
  assert.ok(output.includes("- [ ]"));
  const checkCount = (output.match(/\[ \]/g) || []).length;
  assert.strictEqual(checkCount, 5, "should have 5 checkboxes");
});

test("formatAsChecklist groups by file when groupByFile is true", () => {
  const formatter = new ReviewFormatter();
  const findings = sampleFindings();
  const output = formatter.formatAsChecklist(findings, { groupByFile: true });
  assert.ok(output.includes("src/auth.js"));
  assert.ok(output.includes("src/utils.js"));
  assert.ok(output.includes("src/format.js"));
});

test("formatAsChecklist shows completed message when no findings", () => {
  const formatter = new ReviewFormatter();
  const output = formatter.formatAsChecklist([]);
  assert.ok(output.includes("[x]"));
  assert.ok(output.includes("no issues found"));
});

// ---------------------------------------------------------------------------
// ReviewFormatter: formatAsReport
// ---------------------------------------------------------------------------

test("formatAsReport produces a comprehensive report with score", () => {
  const formatter = new ReviewFormatter();
  const findings = sampleFindings();
  const output = formatter.formatAsReport(findings, { score: 52, summary: "Test summary" });
  assert.ok(output.includes("Code Review Report"));
  assert.ok(output.includes("52/100"));
  assert.ok(output.includes("Test summary"));
  assert.ok(output.includes("Severity Breakdown"));
  assert.ok(output.includes("Files Reviewed"));
  assert.ok(output.includes("Recommendations"));
});

test("formatAsReport includes ISO timestamp footer", () => {
  const formatter = new ReviewFormatter();
  const findings = sampleFindings();
  const output = formatter.formatAsReport(findings);
  assert.ok(output.includes("Report generated at"));
  assert.ok(/\d{4}-\d{2}-\d{2}T/.test(output)); // ISO date pattern
});

// ---------------------------------------------------------------------------
// ReviewFormatter: formatAsInlineComments
// ---------------------------------------------------------------------------

test("formatAsInlineComments returns GitHub-compatible comment objects", () => {
  const formatter = new ReviewFormatter();
  const findings = sampleFindings();
  const comments = formatter.formatAsInlineComments(findings);
  assert.ok(Array.isArray(comments));
  assert.strictEqual(comments.length, 5);
  const first = comments[0];
  assert.ok(first.hasOwnProperty("path"));
  assert.ok(first.hasOwnProperty("line"));
  assert.ok(first.hasOwnProperty("body"));
  assert.strictEqual(first.side, "RIGHT");
  assert.ok(first.body.includes("BLOCKER"));
});

test("formatAsInlineComments respects maxComments limit", () => {
  const formatter = new ReviewFormatter();
  const findings = sampleFindings();
  const comments = formatter.formatAsInlineComments(findings, { maxComments: 2 });
  assert.strictEqual(comments.length, 2);
});

test("formatAsInlineComments deduplicates by file+line+perspective", () => {
  const formatter = new ReviewFormatter();
  const findings = [
    { file: "f.js", line: 10, perspective: "security", severity: "MAJOR", title: "T1", message: "m1", suggestion: "s1" },
    { file: "f.js", line: 10, perspective: "security", severity: "MAJOR", title: "T2", message: "m2", suggestion: "s2" },
    { file: "f.js", line: 20, perspective: "security", severity: "MINOR", title: "T3", message: "m3", suggestion: "s3" },
  ];
  const comments = formatter.formatAsInlineComments(findings);
  assert.strictEqual(comments.length, 2, "should deduplicate by file+line+perspective");
});

// ---------------------------------------------------------------------------
// ReviewFormatter: formatAsJSON
// ---------------------------------------------------------------------------

test("formatAsJSON returns machine-readable JSON summary", () => {
  const formatter = new ReviewFormatter();
  const findings = sampleFindings();
  const json = formatter.formatAsJSON(findings, { score: 85, summary: "Good shape" });
  assert.strictEqual(json.totalFindings, 5);
  assert.strictEqual(json.score, 85);
  assert.strictEqual(json.summary, "Good shape");
  assert.ok(json.severityBreakdown);
  assert.strictEqual(json.severityBreakdown.BLOCKER, 1);
  assert.ok(Array.isArray(json.files));
  assert.ok(Array.isArray(json.findings));
  assert.ok(typeof json.generatedAt === "string");
});

// ---------------------------------------------------------------------------
// SEVERITY constants
// ---------------------------------------------------------------------------

test("SEVERITY_EMOJI maps all five severity levels", () => {
  assert.ok(SEVERITY_EMOJI.BLOCKER);
  assert.ok(SEVERITY_EMOJI.CRITICAL);
  assert.ok(SEVERITY_EMOJI.MAJOR);
  assert.ok(SEVERITY_EMOJI.MINOR);
  assert.ok(SEVERITY_EMOJI.SUGGESTION);
});

test("SEVERITY_LABEL maps all five severity levels", () => {
  assert.strictEqual(SEVERITY_LABEL.BLOCKER, "BLOCKER");
  assert.strictEqual(SEVERITY_LABEL.CRITICAL, "CRITICAL");
  assert.strictEqual(SEVERITY_LABEL.MAJOR, "MAJOR");
  assert.strictEqual(SEVERITY_LABEL.MINOR, "MINOR");
  assert.strictEqual(SEVERITY_LABEL.SUGGESTION, "SUGGESTION");
});

// ---------------------------------------------------------------------------
// Edge case: empty findings with all formatters
// ---------------------------------------------------------------------------

test("formatAsReport with empty findings produces valid output", () => {
  const formatter = new ReviewFormatter();
  const output = formatter.formatAsReport([], { score: 100, summary: "Perfect score" });
  assert.ok(output.includes("100/100"));
  assert.ok(output.includes("Perfect score"));
  assert.ok(output.includes("Severity Breakdown"));
});

test("formatAsInlineComments with empty findings returns empty array", () => {
  const formatter = new ReviewFormatter();
  const comments = formatter.formatAsInlineComments([]);
  assert.ok(Array.isArray(comments));
  assert.strictEqual(comments.length, 0);
});
