"use strict";

/**
 * Compliance Reporter for HaxAgent.
 *
 * Generates human-readable compliance reports, executive summaries,
 * fix plans, and diff reports. Supports exporting in text, markdown,
 * and JSON formats.
 */

const { DriftDetector } = require("./drift");
const { CompliancePolicy } = require("./policies");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function indent(text, level = 1) {
  const prefix = "  ".repeat(level);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? prefix + line : line))
    .join("\n");
}

function severityIcon(severity) {
  switch (severity) {
    case "CRITICAL":
      return "[!!]";
    case "WARNING":
      return "[! ]";
    case "INFO":
      return "[i ]";
    case "MUST":
      return "[MUST]";
    case "SHOULD":
      return "[SHOULD]";
    case "MAY":
      return "[MAY]";
    default:
      return "[ - ]";
  }
}

// ---------------------------------------------------------------------------
// ComplianceReporter
// ---------------------------------------------------------------------------

class ComplianceReporter {
  /**
   * @param {{ driftDetector?: DriftDetector, policy?: CompliancePolicy }} [opts]
   */
  constructor(opts = {}) {
    this._driftDetector = opts.driftDetector || new DriftDetector();
    this._policy = opts.policy || new CompliancePolicy();
  }

  // ---------------------------------------------------------------------------
  // Report generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a full compliance report.
   *
   * @param {object} config - current configuration
   * @param {object} baseline - desired/baseline configuration
   * @returns {object} report object
   */
  generateReport(config, baseline) {
    // --- Drift detection ---
    const drifts = this._driftDetector.detect(config, baseline);
    const driftCritical = drifts.filter((d) => d.severity === "CRITICAL");
    const driftWarnings = drifts.filter((d) => d.severity === "WARNING");
    const driftInfos = drifts.filter((d) => d.severity === "INFO");
    const needsApproval = this._driftDetector.requiresApproval(drifts);
    const autoCorrections = this._driftDetector.autoCorrect(drifts);

    // --- Policy evaluation ---
    const violations = this._policy.evaluate(config);

    // --- Recommendations ---
    const recommendations = buildRecommendations(drifts, violations);

    // --- Fix plan ---
    const fixPlan = buildFixPlan(drifts, violations);

    // --- Conformance ---
    const conformance = buildConformanceInfo(config);

    return {
      meta: {
        generatedAt: new Date().toISOString(),
        version: "1.0.0",
        configKeys: countKeys(config),
        baselineKeys: countKeys(baseline),
      },
      overview: {
        totalDrifts: drifts.length,
        totalViolations: violations.length,
        driftCritical: driftCritical.length,
        driftWarnings: driftWarnings.length,
        driftInfos: driftInfos.length,
        needsApproval: needsApproval.length,
        autoCorrected: autoCorrections.length,
        compliant:
          drifts.length === 0 &&
          violations.length === 0,
      },
      driftDetails: drifts,
      policyViolations: violations,
      recommendations,
      fixPlan,
      conformance,
    };
  }

  /**
   * Generate an executive summary from a report.
   *
   * @param {object} report - output of generateReport()
   * @returns {string}
   */
  generateSummary(report) {
    const lines = [];
    lines.push("═══════════════════════════════════════════");
    lines.push("  HAXAGENT COMPLIANCE — EXECUTIVE SUMMARY");
    lines.push("═══════════════════════════════════════════");
    lines.push("");

    const { overview } = report;

    if (overview.compliant) {
      lines.push("  Status: COMPLIANT");
      lines.push("  No drift or policy violations detected.");
      lines.push("");
      return lines.join("\n");
    }

    lines.push(`  Status: ${overview.driftCritical > 0 ? "NON-COMPLIANT" : "NEEDS ATTENTION"}`);
    lines.push("");
    lines.push(`  Drift Findings:`);
    lines.push(`    - ${overview.driftCritical} critical`);
    lines.push(`    - ${overview.driftWarnings} warnings`);
    lines.push(`    - ${overview.driftInfos} informational`);
    lines.push(`    - ${overview.autoCorrected} auto-corrected`);
    lines.push("");
    lines.push(`  Policy Violations: ${overview.totalViolations}`);
    lines.push(`  Items Requiring Approval: ${overview.needsApproval}`);
    lines.push("");
    lines.push(`  Generated: ${report.meta.generatedAt}`);
    lines.push(`  Keys evaluated: ${report.meta.configKeys}`);
    lines.push("");

    if (report.recommendations && report.recommendations.length > 0) {
      lines.push("  Key Recommendations:");
      const top = report.recommendations.slice(0, 3);
      for (const r of top) {
        lines.push(`    - ${r.summary}`);
      }
      lines.push("");
    }

    lines.push("═══════════════════════════════════════════");
    return lines.join("\n");
  }

  /**
   * Generate a step-by-step fix plan from a report.
   *
   * @param {object} report - output of generateReport()
   * @returns {string}
   */
  generateFixPlan(report) {
    const lines = [];
    lines.push("=== Configuration Fix Plan ===");
    lines.push("");

    let step = 1;

    // Step 1: Address critical drifts
    const criticalDrifts = report.driftDetails.filter(
      (d) => d.severity === "CRITICAL"
    );
    if (criticalDrifts.length > 0) {
      lines.push("--- Step 1: Address Critical Drifts ---");
      for (const d of criticalDrifts) {
        lines.push("");
        lines.push(`  Step ${step}. ${d.type === "INSECURE" ? "Fix" : "Resolve"} ${d.key}`);
        lines.push(`     Type: ${d.type}`);
        lines.push(`     Current value: ${JSON.stringify(d.currentValue)}`);
        lines.push(`     Desired value : ${JSON.stringify(d.baselineValue)}`);
        if (d.reason) {
          lines.push(`     Reason: ${d.reason}`);
        }
        if (d.type === "MISSING_KEY") {
          lines.push(
            `     Action: Add the "${d.key}" key with value ${JSON.stringify(d.baselineValue)} to your config.`
          );
        } else if (d.type === "INSECURE") {
          lines.push(
            `     Action: Change "${d.key}" to match the baseline value for security compliance.`
          );
        } else if (d.type === "TYPE_CHANGED") {
          lines.push(
            `     Action: Change the type of "${d.key}" from ${d.currentType} to ${d.baselineType}.`
          );
        } else {
          lines.push(
            `     Action: Update "${d.key}" to the baseline value.`
          );
        }
        lines.push(`     Approval: REQUIRED`);
        step++;
      }
      lines.push("");
    }

    // Step 2: Address warnings
    const warningDrifts = report.driftDetails.filter(
      (d) => d.severity === "WARNING"
    );
    if (warningDrifts.length > 0) {
      lines.push("--- Step 2: Address Warning Drifts ---");
      for (const d of warningDrifts) {
        lines.push("");
        lines.push(`  Step ${step}. Review ${d.key}`);
        lines.push(`     Type: ${d.type}`);
        lines.push(`     Current: ${JSON.stringify(d.currentValue)}`);
        lines.push(`     Baseline: ${JSON.stringify(d.baselineValue)}`);
        if (d.replacement) {
          lines.push(`     Note: "${d.key}" is deprecated, use "${d.replacement}" instead.`);
        }
        lines.push(`     Approval: REQUIRED`);
        step++;
      }
      lines.push("");
    }

    // Step 3: Address policy violations
    if (report.policyViolations.length > 0) {
      lines.push("--- Step 3: Fix Policy Violations ---");
      for (const v of report.policyViolations) {
        lines.push("");
        lines.push(`  Step ${step}. [${v.severity}] ${v.ruleId}`);
        lines.push(`     ${v.message}`);
        step++;
      }
      lines.push("");
    }

    // Step 4: Info drifts (optional)
    const infoDrifts = report.driftDetails.filter(
      (d) => d.severity === "INFO"
    );
    if (infoDrifts.length > 0) {
      lines.push("--- Step 4: Optional Cleanup ---");
      for (const d of infoDrifts) {
        lines.push("");
        lines.push(`  Step ${step}. Consider ${d.type === "EXTRA_KEY" ? "removing" : "adding"} ${d.key}`);
        lines.push(`     Type: ${d.type}`);
        lines.push(
          `     Current: ${JSON.stringify(d.currentValue)}`
        );
        lines.push(`     Approval: NOT REQUIRED`);
        step++;
      }
      lines.push("");
    }

    if (step === 1) {
      lines.push("  No fixes required — configuration is compliant.");
      lines.push("");
    }

    lines.push("=== End of Fix Plan ===");
    return lines.join("\n");
  }

  /**
   * Generate a diff report showing what changed between two configs and why.
   *
   * @param {object} oldConfig
   * @param {object} newConfig
   * @returns {string}
   */
  generateDiffReport(oldConfig, newConfig) {
    const drifts = this._driftDetector.detect(oldConfig, newConfig);
    const lines = [];
    lines.push("=== Configuration Diff Report ===");
    lines.push("");

    if (drifts.length === 0) {
      lines.push("  No differences detected between configurations.");
      lines.push("");
      lines.push("=== End of Diff Report ===");
      return lines.join("\n");
    }

    const byType = groupBy(drifts, "type");

    const sections = [
      { type: "INSECURE", label: "Security Concerns" },
      { type: "DEPRECATED", label: "Deprecated Keys" },
      { type: "MISSING_KEY", label: "Missing Keys (removed in new config)" },
      { type: "EXTRA_KEY", label: "New Keys (added in new config)" },
      { type: "VALUE_CHANGED", label: "Value Changes" },
      { type: "TYPE_CHANGED", label: "Type Changes" },
    ];

    for (const section of sections) {
      const items = byType[section.type];
      if (!items || items.length === 0) continue;

      lines.push(`--- ${section.label} (${items.length}) ---`);
      for (const d of items) {
        lines.push(`  ${severityIcon(d.severity)} ${d.key}`);
        lines.push(`      Old: ${JSON.stringify(d.baselineValue)}`);
        lines.push(`      New: ${JSON.stringify(d.currentValue)}`);
        if (d.reason) {
          lines.push(`      Why: ${d.reason}`);
        }
        if (d.replacement) {
          lines.push(`      Use: ${d.replacement}`);
        }
      }
      lines.push("");
    }

    lines.push(`Total differences: ${drifts.length}`);
    lines.push("=== End of Diff Report ===");
    return lines.join("\n");
  }

  /**
   * Export a report in the specified format.
   *
   * @param {object} report - output of generateReport()
   * @param {string} format - "text" | "markdown" | "json"
   * @returns {string}
   */
  exportReport(report, format = "text") {
    switch (format.toLowerCase()) {
      case "json":
        return JSON.stringify(report, (key, value) => (value === undefined ? null : value), 2);

      case "markdown":
        return formatMarkdown(report);

      case "text":
      default:
        return formatText(report);
    }
  }
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function formatText(report) {
  const lines = [];

  lines.push("════════════════════════════════════════════════");
  lines.push("  HAXAGENT COMPLIANCE REPORT");
  lines.push("════════════════════════════════════════════════");
  lines.push("");
  lines.push(`Generated: ${report.meta.generatedAt}`);
  lines.push(
    `Status: ${report.overview.compliant ? "COMPLIANT" : "NON-COMPLIANT"}`
  );
  lines.push("");

  // Overview
  lines.push("--- Overview ---");
  lines.push(`  Total drifts:         ${report.overview.totalDrifts}`);
  lines.push(`  Critical drifts:      ${report.overview.driftCritical}`);
  lines.push(`  Warning drifts:       ${report.overview.driftWarnings}`);
  lines.push(`  Info drifts:          ${report.overview.driftInfos}`);
  lines.push(`  Policy violations:    ${report.overview.totalViolations}`);
  lines.push(`  Needs approval:       ${report.overview.needsApproval}`);
  lines.push(`  Auto-corrected:       ${report.overview.autoCorrected}`);
  lines.push("");

  // Drift details
  if (report.driftDetails.length > 0) {
    lines.push("--- Drift Details ---");
    for (const d of report.driftDetails) {
      lines.push(`  ${severityIcon(d.severity)} ${d.type}: ${d.key}`);
      lines.push(`    Current : ${JSON.stringify(d.currentValue)}`);
      lines.push(`    Baseline: ${JSON.stringify(d.baselineValue)}`);
      if (d.reason) lines.push(`    Reason  : ${d.reason}`);
      if (d.replacement) lines.push(`    Replace : ${d.replacement}`);
    }
    lines.push("");
  }

  // Policy violations
  if (report.policyViolations.length > 0) {
    lines.push("--- Policy Violations ---");
    for (const v of report.policyViolations) {
      lines.push(`  ${severityIcon(v.severity)} ${v.ruleId}`);
      lines.push(`    ${v.message}`);
    }
    lines.push("");
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push("--- Recommendations ---");
    for (let i = 0; i < report.recommendations.length; i++) {
      const r = report.recommendations[i];
      lines.push(`  ${i + 1}. ${r.summary}`);
      if (r.detail) lines.push(`     ${r.detail}`);
    }
    lines.push("");
  }

  // Fix plan
  if (report.fixPlan.length > 0) {
    lines.push("--- Fix Plan ---");
    for (const f of report.fixPlan) {
      lines.push(`  ${severityIcon(f.severity)} Step ${f.step}: ${f.action}`);
      lines.push(`     ${f.note}`);
    }
    lines.push("");
  }

  // Conformance
  if (report.conformance) {
    lines.push("--- Conformance ---");
    lines.push(`  Sections present: ${report.conformance.sections?.join(", ") || "N/A"}`);
    if (report.conformance.totalKeys !== undefined) {
      lines.push(`  Total keys: ${report.conformance.totalKeys}`);
    }
    lines.push("");
  }

  lines.push("════════════════════════════════════════════════");
  return lines.join("\n");
}

function formatMarkdown(report) {
  const lines = [];

  lines.push("# HaxAgent Compliance Report");
  lines.push("");
  lines.push(`**Generated:** ${report.meta.generatedAt}`);
  lines.push(
    `**Status:** ${report.overview.compliant ? "COMPLIANT" : "NON-COMPLIANT"}`
  );
  lines.push("");

  // Overview
  lines.push("## Overview");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|--------|-------|");
  lines.push(`| Total drifts | ${report.overview.totalDrifts} |`);
  lines.push(`| Critical drifts | ${report.overview.driftCritical} |`);
  lines.push(`| Warning drifts | ${report.overview.driftWarnings} |`);
  lines.push(`| Info drifts | ${report.overview.driftInfos} |`);
  lines.push(`| Policy violations | ${report.overview.totalViolations} |`);
  lines.push(`| Needs approval | ${report.overview.needsApproval} |`);
  lines.push(`| Auto-corrected | ${report.overview.autoCorrected} |`);
  lines.push("");

  // Drift details
  if (report.driftDetails.length > 0) {
    lines.push("## Drift Details");
    lines.push("");
    lines.push(
      "| Severity | Type | Key | Current | Baseline | Notes |"
    );
    lines.push(
      "|----------|------|-----|---------|----------|-------|"
    );
    for (const d of report.driftDetails) {
      const notes = [];
      if (d.reason) notes.push(d.reason);
      if (d.replacement) notes.push(`Use: ${d.replacement}`);
      lines.push(
        `| ${d.severity} | ${d.type} | \`${d.key}\` | \`${JSON.stringify(d.currentValue)}\` | \`${JSON.stringify(d.baselineValue)}\` | ${notes.join("; ")} |`
      );
    }
    lines.push("");
  }

  // Policy violations
  if (report.policyViolations.length > 0) {
    lines.push("## Policy Violations");
    lines.push("");
    lines.push("| Severity | Rule | Message |");
    lines.push("|----------|------|---------|");
    for (const v of report.policyViolations) {
      lines.push(
        `| ${v.severity} | ${v.ruleId} | ${v.message} |`
      );
    }
    lines.push("");
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push("## Recommendations");
    lines.push("");
    for (let i = 0; i < report.recommendations.length; i++) {
      const r = report.recommendations[i];
      lines.push(`${i + 1}. **${r.summary}**`);
      if (r.detail) lines.push(`   ${r.detail}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

function buildRecommendations(drifts, violations) {
  const recommendations = [];

  // Insecure settings
  const insecure = drifts.filter((d) => d.type === "INSECURE");
  if (insecure.length > 0) {
    recommendations.push({
      summary: `Address ${insecure.length} insecure configuration(s) immediately`,
      detail: insecure.map((d) => `${d.key}: ${d.reason}`).join("; "),
      severity: "CRITICAL",
    });
  }

  // Missing API key
  const missingApiKey = drifts.find(
    (d) => d.type === "MISSING_KEY" && d.key.includes("apiKey")
  );
  if (missingApiKey) {
    recommendations.push({
      summary: "Configure an API key for the AI provider",
      detail:
        "Set the ANTHROPIC_API_KEY environment variable or agent.apiKey in your settings.",
      severity: "CRITICAL",
    });
  }

  // Deprecated keys
  const deprecated = drifts.filter((d) => d.type === "DEPRECATED");
  if (deprecated.length > 0) {
    recommendations.push({
      summary: `Migrate ${deprecated.length} deprecated configuration key(s)`,
      detail: deprecated
        .map((d) => `${d.key} -> ${d.replacement || "(removed)"}`)
        .join("; "),
      severity: "WARNING",
    });
  }

  // Policy violations
  const mustViolations = violations.filter((v) => v.severity === "MUST");
  if (mustViolations.length > 0) {
    recommendations.push({
      summary: `Fix ${mustViolations.length} mandatory policy violation(s)`,
      detail: mustViolations.map((v) => v.message).join("; "),
      severity: "CRITICAL",
    });
  }

  const shouldViolations = violations.filter((v) => v.severity === "SHOULD");
  if (shouldViolations.length > 0) {
    recommendations.push({
      summary: `Review ${shouldViolations.length} recommended policy item(s)`,
      detail: shouldViolations.map((v) => v.message).join("; "),
      severity: "WARNING",
    });
  }

  return recommendations;
}

function buildFixPlan(drifts, violations) {
  const plan = [];
  let step = 0;

  for (const d of drifts.filter((d) => d.severity === "CRITICAL")) {
    step++;
    plan.push({
      step,
      severity: d.severity,
      action: `${d.type === "INSECURE" ? "Fix insecure" : "Resolve"} ${d.key}`,
      note: `Current: ${JSON.stringify(d.currentValue)}, Baseline: ${JSON.stringify(d.baselineValue)}${d.reason ? `. ${d.reason}` : ""}`,
    });
  }

  for (const d of drifts.filter((d) => d.severity === "WARNING")) {
    step++;
    plan.push({
      step,
      severity: d.severity,
      action: `Review ${d.key}`,
      note: `Current: ${JSON.stringify(d.currentValue)}, Baseline: ${JSON.stringify(d.baselineValue)}${d.replacement ? `. Replace with ${d.replacement}` : ""}`,
    });
  }

  for (const v of violations) {
    step++;
    plan.push({
      step,
      severity: v.severity,
      action: `Fix policy violation: ${v.ruleId}`,
      note: v.message,
    });
  }

  for (const d of drifts.filter((d) => d.severity === "INFO")) {
    step++;
    plan.push({
      step,
      severity: d.severity,
      action: `${d.type === "EXTRA_KEY" ? "Remove extra key" : "Add missing key"} ${d.key}`,
      note: `Type: ${d.type}`,
    });
  }

  return plan;
}

function buildConformanceInfo(config) {
  if (!isPlainObject(config)) {
    return { sections: [], totalKeys: 0 };
  }
  const sections = Object.keys(config);
  const totalKeys = countKeys(config);
  return { sections, totalKeys };
}

function countKeys(obj) {
  if (!isPlainObject(obj)) return 0;
  let count = 0;
  for (const [, val] of Object.entries(obj)) {
    if (isPlainObject(val)) {
      count += countKeys(val);
    } else {
      count += 1;
    }
  }
  return count;
}

function groupBy(arr, key) {
  const result = {};
  for (const item of arr) {
    const val = item[key];
    if (!result[val]) result[val] = [];
    result[val].push(item);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { ComplianceReporter };
