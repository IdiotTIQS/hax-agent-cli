"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ComplianceReporter } = require("../../src/compliance/reports");
const { DriftDetector } = require("../../src/compliance/drift");
const { CompliancePolicy } = require("../../src/compliance/policies");

// ---------------------------------------------------------------------------
// Sample configs
// ---------------------------------------------------------------------------

const BASELINE = Object.freeze({
  agent: {
    name: "hax-agent",
    model: "claude-sonnet-4-20250514",
    apiKey: undefined,
    apiUrl: undefined,
    maxTurns: 20,
    temperature: 0.2,
  },
  permissions: { mode: "normal" },
  ui: { theme: "dark", locale: "en" },
  tools: {
    shell: {
      enabled: true,
      timeoutMs: 10_000,
      maxBuffer: 52_428_800,
    },
  },
});

const COMPLIANT_CONFIG = {
  agent: {
    name: "hax-agent",
    model: "claude-sonnet-4-20250514",
    apiKey: "sk-valid-key",
    apiUrl: undefined,
    maxTurns: 20,
    temperature: 0.2,
  },
  permissions: { mode: "normal" },
  ui: { theme: "dark", locale: "en" },
  tools: {
    shell: {
      enabled: true,
      timeoutMs: 10_000,
      maxBuffer: 52_428_800,
    },
  },
};

const DRIFTED_CONFIG = {
  agent: {
    name: "hax-agent",
    model: "claude-opus-4-20250514", // drifted
    apiKey: "sk-exposed-in-config", // INSECURE
    apiUrl: "http://insecure.example.com/v1", // INSECURE
    maxTurns: 20,
    temperature: 0.5, // drifted
  },
  permissions: { mode: "yolo" }, // drifted + INSECURE
  ui: { theme: "light", locale: "en" }, // drifted
  tools: {
    shell: {
      enabled: false, // drifted
      timeoutMs: 10_000,
      maxBuffer: 52_428_800,
    },
  },
  extraSection: { extraKey: "unexpected" }, // EXTRA_KEY
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("ComplianceReporter: generateReport produces full report structure", () => {
  const reporter = new ComplianceReporter();
  const report = reporter.generateReport(DRIFTED_CONFIG, BASELINE);

  // Top-level sections
  assert.ok(report.meta, "Report should have meta section");
  assert.ok(report.overview, "Report should have overview section");
  assert.ok(Array.isArray(report.driftDetails), "Report should have driftDetails array");
  assert.ok(Array.isArray(report.policyViolations), "Report should have policyViolations array");
  assert.ok(Array.isArray(report.recommendations), "Report should have recommendations array");
  assert.ok(Array.isArray(report.fixPlan), "Report should have fixPlan array");
  assert.ok(report.conformance, "Report should have conformance section");

  // Meta
  assert.ok(report.meta.generatedAt, "Meta should have generatedAt timestamp");
  assert.ok(typeof report.meta.configKeys === "number", "Meta should have configKeys count");
  assert.ok(typeof report.meta.baselineKeys === "number", "Meta should have baselineKeys count");

  // Overview
  assert.ok(report.overview.totalDrifts > 0, "Drifted config should have drifts");
  assert.equal(report.overview.compliant, false, "Drifted config should not be compliant");
});

test("ComplianceReporter: generateReport marks identical config as compliant", () => {
  const reporter = new ComplianceReporter();
  const report = reporter.generateReport(COMPLIANT_CONFIG, COMPLIANT_CONFIG);

  assert.equal(report.overview.totalDrifts, 0);
  assert.equal(report.overview.totalViolations, 0);
  assert.equal(report.overview.compliant, true);
  assert.equal(report.driftDetails.length, 0);
});

test("ComplianceReporter: generateSummary produces executive summary", () => {
  const reporter = new ComplianceReporter();
  const report = reporter.generateReport(DRIFTED_CONFIG, BASELINE);
  const summary = reporter.generateSummary(report);

  assert.ok(summary.includes("EXECUTIVE SUMMARY"), "Summary should have title");
  assert.ok(
    summary.includes("NON-COMPLIANT") || summary.includes("NEEDS ATTENTION"),
    "Summary should indicate non-compliance"
  );
  assert.ok(
    summary.includes("Drift Findings"),
    "Summary should include drift findings"
  );
  assert.ok(
    summary.includes("Policy Violations"),
    "Summary should include policy violations"
  );
});

test("ComplianceReporter: generateSummary for compliant config shows PASS", () => {
  const reporter = new ComplianceReporter();
  const report = reporter.generateReport(COMPLIANT_CONFIG, COMPLIANT_CONFIG);
  const summary = reporter.generateSummary(report);

  assert.ok(summary.includes("COMPLIANT"));
  assert.ok(summary.includes("No drift or policy violations detected"));
});

test("ComplianceReporter: generateFixPlan produces step-by-step instructions", () => {
  const reporter = new ComplianceReporter();
  const report = reporter.generateReport(DRIFTED_CONFIG, BASELINE);
  const fixPlan = reporter.generateFixPlan(report);

  assert.ok(fixPlan.includes("Configuration Fix Plan"));
  assert.ok(fixPlan.includes("Step"), "Fix plan should contain step numbers");
  assert.ok(
    fixPlan.includes("REQUIRED"),
    "Critical items should be marked REQUIRED"
  );
  assert.ok(
    fixPlan.includes("End of Fix Plan"),
    "Fix plan should have a footer"
  );
});

test("ComplianceReporter: generateFixPlan for compliant config shows no fixes needed", () => {
  const reporter = new ComplianceReporter();
  const report = reporter.generateReport(COMPLIANT_CONFIG, COMPLIANT_CONFIG);
  const fixPlan = reporter.generateFixPlan(report);

  assert.ok(fixPlan.includes("No fixes required"));
});

test("ComplianceReporter: generateDiffReport shows differences between configs", () => {
  const reporter = new ComplianceReporter();

  const oldConfig = {
    agent: { model: "claude-sonnet-4-20250514", apiKey: undefined },
    ui: { theme: "dark" },
  };
  const newConfig = {
    agent: { model: "claude-opus-4-20250514", apiKey: "sk-new-key" },
    ui: { theme: "light" },
  };

  const diff = reporter.generateDiffReport(oldConfig, newConfig);

  assert.ok(diff.includes("Configuration Diff Report"));
  assert.ok(diff.includes("agent.model"), "Should show model change");
  assert.ok(diff.includes("agent.apiKey"), "Should show apiKey change");
  assert.ok(diff.includes("ui.theme"), "Should show theme change");
  assert.ok(diff.includes("End of Diff Report"));
});

test("ComplianceReporter: generateDiffReport shows no differences for identical configs", () => {
  const reporter = new ComplianceReporter();
  const config = { agent: { model: "test" } };
  const diff = reporter.generateDiffReport(config, config);

  assert.ok(diff.includes("No differences detected"));
});

test("ComplianceReporter: exportReport text format", () => {
  const reporter = new ComplianceReporter();
  const report = reporter.generateReport(DRIFTED_CONFIG, BASELINE);
  const text = reporter.exportReport(report, "text");

  assert.ok(text.includes("COMPLIANCE REPORT"));
  assert.ok(text.includes("Overview"));
  assert.ok(text.includes("Drift Details"));
});

test("ComplianceReporter: exportReport markdown format", () => {
  const reporter = new ComplianceReporter();
  const report = reporter.generateReport(DRIFTED_CONFIG, BASELINE);
  const md = reporter.exportReport(report, "markdown");

  assert.ok(md.includes("# "), "Markdown should contain heading markers");
  assert.ok(md.includes("|"), "Markdown should contain table pipes");
  assert.ok(md.includes("**"), "Markdown should contain bold markers");
});

test("ComplianceReporter: exportReport json format", () => {
  const reporter = new ComplianceReporter();
  const report = reporter.generateReport(DRIFTED_CONFIG, BASELINE);
  const json = reporter.exportReport(report, "json");

  const parsed = JSON.parse(json);
  assert.equal(parsed.overview.totalDrifts, report.overview.totalDrifts);
  assert.equal(parsed.overview.totalViolations, report.overview.totalViolations);

  // Verify drift details are intact (accounting for undefined -> null in JSON)
  assert.equal(parsed.driftDetails.length, report.driftDetails.length);
  for (let i = 0; i < parsed.driftDetails.length; i++) {
    assert.equal(parsed.driftDetails[i].type, report.driftDetails[i].type);
    assert.equal(parsed.driftDetails[i].key, report.driftDetails[i].key);
    assert.equal(parsed.driftDetails[i].severity, report.driftDetails[i].severity);
  }

  // Verify policy violations are intact
  assert.equal(parsed.policyViolations.length, report.policyViolations.length);
  for (let i = 0; i < parsed.policyViolations.length; i++) {
    assert.equal(parsed.policyViolations[i].ruleId, report.policyViolations[i].ruleId);
    assert.equal(parsed.policyViolations[i].severity, report.policyViolations[i].severity);
    assert.equal(parsed.policyViolations[i].message, report.policyViolations[i].message);
  }
});

test("ComplianceReporter: accepts custom DriftDetector and CompliancePolicy", () => {
  const driftDetector = new DriftDetector();
  const policy = new CompliancePolicy({ rules: [] });

  // Add a custom rule that always fails
  policy.addRule({
    id: "always-fail",
    severity: "MUST",
    evaluate() {
      return { passed: false, message: "Always fails for testing" };
    },
  });

  const reporter = new ComplianceReporter({ driftDetector, policy });
  const report = reporter.generateReport(COMPLIANT_CONFIG, COMPLIANT_CONFIG);

  assert.equal(report.overview.totalDrifts, 0, "Drifts should be 0 for identical config");
  assert.equal(
    report.overview.totalViolations,
    1,
    "Should have the custom rule violation"
  );
  assert.equal(report.policyViolations[0].ruleId, "always-fail");
});
