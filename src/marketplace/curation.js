"use strict";

const { PLUGIN_HOOK_NAMES } = require("../plugins");
const { validatePlugin } = require("../plugin-validator");

// Quality dimension weights (must sum to 1.0)
const QUALITY_WEIGHTS = {
  security: 0.30,
  performance: 0.15,
  documentation: 0.20,
  compatibility: 0.20,
  tests: 0.15,
};

// Suspicious patterns that might indicate security issues
const SECURITY_PATTERNS = [
  { pattern: /\beval\s*\(/, severity: "high", label: "Uses eval()" },
  { pattern: /\bFunction\s*\(/, severity: "high", label: "Uses Function() constructor" },
  { pattern: /\bexecSync\b/, severity: "medium", label: "Uses execSync" },
  { pattern: /\bexec\s*\(/, severity: "medium", label: "Uses child_process.exec" },
  { pattern: /\brm\s+-rf\b/, severity: "high", label: "Contains rm -rf" },
  { pattern: /\bprocess\.env\b/, severity: "low", label: "Reads process.env" },
  { pattern: /\brequire\s*\(\s*[`'"][^`'"]*child_process/, severity: "medium", label: "Imports child_process" },
  { pattern: /\brequire\s*\(\s*[`'"][^`'"]*net\b/, severity: "medium", label: "Imports net module" },
  { pattern: /\b__proto__\b/, severity: "medium", label: "Accesses __proto__" },
  { pattern: /new\s+Function\b/, severity: "high", label: "Uses new Function()" },
];

// Good patterns that indicate quality
const QUALITY_PATTERNS = [
  { pattern: /\bmodule\.exports\b/, label: "Uses module.exports", weight: 0 },
  { pattern: /"use strict"/, label: "Has 'use strict' directive", weight: 3 },
  { pattern: /\bvalidatePlugin\b/, label: "Uses plugin validator", weight: 2 },
  { pattern: /\btry\b/, label: "Has try-catch blocks", weight: 2 },
  { pattern: /\basync\b/, label: "Uses async/await", weight: 1 },
  { pattern: /@param\b/, label: "Has JSDoc annotations", weight: 2 },
  { pattern: /@returns?\b/, label: "Has return type annotations", weight: 2 },
];

/**
 * MarketplaceCurator — Quality control, review, and approval system for the
 * Plugin Marketplace.  Keeps the marketplace healthy by reviewing submissions,
 * flagging problematic plugins, and computing quality scores.
 *
 *   const curator = new MarketplaceCurator();
 *   const review = curator.review(plugin);
 *   if (review.approved) { curator.approve(plugin); }
 *   const stats = curator.getStats();
 */
class MarketplaceCurator {
  constructor(opts) {
    const options = opts || {};

    /** @type {Map<string, object>} plugin name → review record */
    this._reviews = new Map();

    /** @type {Set<string>} approved plugin names */
    this._approved = new Set();

    /** @type {Map<string, object>} plugin name → flag { reason, flaggedAt, flaggedBy } */
    this._flagged = new Map();

    /** @type {Map<string, number>} plugin name → quality score (0-100) */
    this._qualityScores = new Map();

    /** @type {function|null} optional custom security checker */
    this._securityChecker = options.securityChecker || null;

    // Statistics counters
    this._stats = {
      totalSubmitted: 0,
      totalApproved: 0,
      totalRejected: 0,
      totalFlagged: 0,
      totalReviews: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Review
  // -------------------------------------------------------------------------

  /**
   * Review a plugin submission.  Runs validation, quality checks, and returns
   * a detailed review record.
   *
   * @param {object} plugin - The plugin module exports or metadata object
   * @param {string} [pluginCode] - Optional raw source code of the plugin for deep analysis
   * @returns {{ approved: boolean, score: number, checks: object, issues: Array,
   *             warnings: Array, recommendation: string }}
   */
  review(plugin, pluginCode) {
    if (!plugin || typeof plugin !== "object") {
      return this._failedReview("Plugin must be a non-null object", 0);
    }

    const name = plugin.name || "<unnamed>";

    // 1. Run base validation
    const validation = validatePlugin(plugin);

    // 2. Run quality checks
    const checks = {
      security: this._checkSecurity(plugin, pluginCode),
      performance: this._checkPerformance(plugin),
      documentation: this._checkDocumentation(plugin, pluginCode),
      compatibility: this._checkCompatibility(plugin),
      tests: this._checkTests(plugin, pluginCode),
    };

    // 3. Collect issues and warnings
    const issues = [];
    const warnings = [];

    // Validation errors are automatic issues
    for (const err of validation.errors) {
      issues.push({
        severity: "error",
        category: "validation",
        message: `${err.path}: ${err.message}`,
      });
    }

    for (const warn of validation.warnings) {
      warnings.push({
        severity: "warning",
        category: "validation",
        message: `${warn.path}: ${warn.message}`,
      });
    }

    // Security findings
    for (const finding of checks.security.findings) {
      if (finding.severity === "high") {
        issues.push({ severity: "error", category: "security", message: finding.label });
      } else {
        warnings.push({ severity: "warning", category: "security", message: finding.label });
      }
    }

    // Performance findings
    for (const finding of checks.performance.findings) {
      warnings.push({ severity: "warning", category: "performance", message: finding });
    }

    // Documentation findings
    for (const finding of checks.documentation.findings) {
      if (finding.severity === "error") {
        issues.push({ severity: "error", category: "documentation", message: finding.message || finding });
      } else {
        warnings.push({ severity: "warning", category: "documentation", message: finding.message || finding });
      }
    }

    // Compatibility findings
    for (const finding of checks.compatibility.findings) {
      issues.push({ severity: "error", category: "compatibility", message: finding });
    }

    // Tests findings
    for (const finding of checks.tests.findings) {
      warnings.push({ severity: "warning", category: "tests", message: finding });
    }

    // 4. Compute quality score
    const score = this._computeQualityScore(checks);

    // 5. Approval decision: no errors, score >= 50, no high-severity security issues
    const highSecurityIssues = checks.security.findings.filter((f) => f.severity === "high");
    const hasNoErrors = issues.filter((i) => i.severity === "error").length === 0;
    const approved = hasNoErrors && score >= 50 && highSecurityIssues.length === 0;

    // 6. Generate recommendation
    let recommendation;
    if (approved) {
      recommendation = score >= 80
        ? "Strongly recommended for marketplace inclusion"
        : "Recommended with minor improvements suggested";
    } else if (highSecurityIssues.length > 0) {
      recommendation = "Rejected — high-severity security issues must be resolved";
    } else if (!hasNoErrors) {
      recommendation = "Rejected — validation errors must be fixed before resubmission";
    } else {
      recommendation = "Not yet ready — improve quality score above 50";
    }

    // Store review record
    const reviewRecord = {
      name,
      approved,
      score,
      checks,
      issues,
      warnings,
      recommendation,
      reviewedAt: new Date().toISOString(),
      validation,
    };

    this._reviews.set(name, reviewRecord);
    this._stats.totalReviews += 1;

    return reviewRecord;
  }

  // -------------------------------------------------------------------------
  // Approve / Reject
  // -------------------------------------------------------------------------

  /**
   * Approve a plugin for the marketplace.  Must have been reviewed first.
   *
   * @param {object} plugin - The plugin to approve (must have a name)
   * @returns {{ approved: boolean, name: string, approvedAt: string }}
   */
  approve(plugin) {
    if (!plugin || typeof plugin.name !== "string" || !plugin.name.trim()) {
      throw new Error("Plugin must have a valid name");
    }

    const name = plugin.name;

    // Check if already flagged
    if (this._flagged.has(name)) {
      const flag = this._flagged.get(name);
      throw new Error(
        `Plugin "${name}" cannot be approved — it is flagged: ${flag.reason}`,
      );
    }

    // Require review first
    const review = this._reviews.get(name);
    if (!review) {
      throw new Error(`Plugin "${name}" has not been reviewed yet. Call review() first.`);
    }

    if (!review.approved) {
      throw new Error(
        `Plugin "${name}" did not pass review. Issues: ${review.issues.length}, Warnings: ${review.warnings.length}`,
      );
    }

    this._approved.add(name);
    this._stats.totalApproved += 1;

    return {
      approved: true,
      name,
      approvedAt: new Date().toISOString(),
      score: review.score,
    };
  }

  /**
   * Reject a plugin submission.
   *
   * @param {string} pluginName
   * @param {string} reason
   * @returns {{ rejected: boolean, name: string, reason: string }}
   */
  reject(pluginName, reason) {
    if (!pluginName || typeof pluginName !== "string" || !pluginName.trim()) {
      throw new Error("Plugin name is required");
    }

    const review = this._reviews.get(pluginName);
    if (review) {
      review.approved = false;
      review.recommendation = `Rejected: ${reason || "No reason provided"}`;
    }

    this._approved.delete(pluginName);
    this._stats.totalRejected += 1;

    return {
      rejected: true,
      name: pluginName,
      reason: reason || "No reason provided",
    };
  }

  // -------------------------------------------------------------------------
  // Flag
  // -------------------------------------------------------------------------

  /**
   * Flag a problematic plugin (security concern, broken, spam, etc.).
   *
   * @param {object|string} plugin - Plugin object or plugin name string
   * @param {string} reason - Why this plugin is being flagged
   * @param {string} [flaggedBy] - Who/what is flagging it
   * @returns {{ flagged: boolean, name: string, reason: string }}
   */
  flag(plugin, reason, flaggedBy) {
    const name = typeof plugin === "string" ? plugin : (plugin && plugin.name);

    if (!name || typeof name !== "string" || !name.trim()) {
      throw new Error("Plugin name is required for flagging");
    }

    if (!reason || typeof reason !== "string" || !reason.trim()) {
      throw new Error("A reason is required for flagging a plugin");
    }

    const flagRecord = {
      reason: reason.trim(),
      flaggedAt: new Date().toISOString(),
      flaggedBy: flaggedBy || "system",
    };

    this._flagged.set(name, flagRecord);

    // Auto-remove from approved set
    this._approved.delete(name);

    this._stats.totalFlagged += 1;

    return {
      flagged: true,
      name,
      reason: flagRecord.reason,
    };
  }

  /**
   * Remove a flag from a plugin.
   *
   * @param {string} pluginName
   * @returns {boolean}
   */
  unflag(pluginName) {
    return this._flagged.delete(pluginName);
  }

  /**
   * Check if a plugin is flagged.
   *
   * @param {string} pluginName
   * @returns {boolean}
   */
  isFlagged(pluginName) {
    return this._flagged.has(pluginName);
  }

  /**
   * Get the flag details for a plugin.
   *
   * @param {string} pluginName
   * @returns {object|null}
   */
  getFlag(pluginName) {
    return this._flagged.get(pluginName) || null;
  }

  // -------------------------------------------------------------------------
  // Quality Score
  // -------------------------------------------------------------------------

  /**
   * Get the quality score for a plugin (0-100).
   *
   * Recomputes if not cached or if forced.
   *
   * @param {object} plugin - Plugin object
   * @param {string} [pluginCode] - Optional source code
   * @param {boolean} [force=false] - Force recompute
   * @returns {number} Quality score 0-100
   */
  getQualityScore(plugin, pluginCode, force) {
    if (!plugin || typeof plugin !== "object") return 0;

    // Guard against empty objects with no plugin characteristics
    if (!plugin.name && !plugin.hooks && !plugin.description && !plugin.version && !plugin.metadata) {
      return 0;
    }

    const name = plugin.name || "<unnamed>";
    if (!force && this._qualityScores.has(name)) {
      return this._qualityScores.get(name);
    }

    const checks = {
      security: this._checkSecurity(plugin, pluginCode),
      performance: this._checkPerformance(plugin),
      documentation: this._checkDocumentation(plugin, pluginCode),
      compatibility: this._checkCompatibility(plugin),
      tests: this._checkTests(plugin, pluginCode),
    };

    const score = this._computeQualityScore(checks);
    this._qualityScores.set(name, score);
    return score;
  }

  /**
   * Check if a plugin is approved.
   *
   * @param {string} pluginName
   * @returns {boolean}
   */
  isApproved(pluginName) {
    return this._approved.has(pluginName);
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  /**
   * Get marketplace curation statistics.
   *
   * @returns {{ totalSubmitted: number, totalApproved: number, totalRejected: number,
   *             totalFlagged: number, totalReviews: number, approvalRate: string,
   *             avgQualityScore: number, flaggedPlugins: Array }}
   */
  getStats() {
    const approvalRate =
      this._stats.totalReviews > 0
        ? `${Math.round((this._stats.totalApproved / this._stats.totalReviews) * 100)}%`
        : "0%";

    // Average quality score across reviewed plugins
    let avgScore = 0;
    if (this._qualityScores.size > 0) {
      const scores = Array.from(this._qualityScores.values());
      avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    }

    const flaggedPlugins = Array.from(this._flagged.entries()).map(([name, flag]) => ({
      name,
      reason: flag.reason,
      flaggedAt: flag.flaggedAt,
      flaggedBy: flag.flaggedBy,
    }));

    return {
      totalSubmitted: this._stats.totalSubmitted,
      totalApproved: this._stats.totalApproved,
      totalRejected: this._stats.totalRejected,
      totalFlagged: this._stats.totalFlagged,
      totalReviews: this._stats.totalReviews,
      approvalRate,
      avgQualityScore: avgScore,
      flaggedPlugins,
    };
  }

  /**
   * Get the review record for a plugin.
   *
   * @param {string} pluginName
   * @returns {object|null}
   */
  getReview(pluginName) {
    return this._reviews.get(pluginName) || null;
  }

  // -------------------------------------------------------------------------
  // Private: Quality Checks
  // -------------------------------------------------------------------------

  /**
   * Security check: scan for dangerous patterns, eval usage, etc.
   */
  _checkSecurity(plugin, pluginCode) {
    const findings = [];
    let score = 100;

    // Check plugin code for suspicious patterns
    if (typeof pluginCode === "string") {
      for (const rule of SECURITY_PATTERNS) {
        if (rule.pattern.test(pluginCode)) {
          findings.push({ severity: rule.severity, label: rule.label });
          score -= rule.severity === "high" ? 25 : 10;
        }
      }
    }

    // Check hooks for dangerous patterns at object level
    if (plugin.hooks && typeof plugin.hooks === "object") {
      for (const hookFn of Object.values(plugin.hooks)) {
        if (typeof hookFn === "function") {
          const fnStr = hookFn.toString();
          for (const rule of SECURITY_PATTERNS) {
            if (rule.pattern.test(fnStr) && !findings.some((f) => f.label === rule.label)) {
              findings.push({ severity: rule.severity, label: `${rule.label} (in hook)` });
              score -= rule.severity === "high" ? 25 : 10;
            }
          }
        }
      }
    }

    // Run custom security checker if provided
    if (typeof this._securityChecker === "function") {
      try {
        const customFindings = this._securityChecker(plugin, pluginCode);
        if (Array.isArray(customFindings)) {
          for (const finding of customFindings) {
            findings.push(finding);
            score -= finding.severity === "high" ? 25 : 10;
          }
        }
      } catch (_err) {
        findings.push({ severity: "low", label: "Custom security checker failed to run" });
      }
    }

    return {
      score: Math.max(0, score),
      findings,
      passed: findings.filter((f) => f.severity === "high").length === 0,
    };
  }

  /**
   * Performance check: verify hooks are not blocking, check for known slow patterns.
   */
  _checkPerformance(plugin) {
    const findings = [];
    let score = 100;

    if (plugin.hooks && typeof plugin.hooks === "object") {
      for (const [hookName, hookFn] of Object.entries(plugin.hooks)) {
        if (typeof hookFn === "function") {
          const fnBody = hookFn.toString();

          // Check for synchronous blocking calls in hooks
          if (/\breadFileSync\b/.test(fnBody)) {
            findings.push(`Hook "${hookName}" uses readFileSync — consider async version`);
            score -= 15;
          }
          if (/\bwriteFileSync\b/.test(fnBody)) {
            findings.push(`Hook "${hookName}" uses writeFileSync — consider async version`);
            score -= 15;
          }
          if (/\bexecSync\b/.test(fnBody)) {
            findings.push(`Hook "${hookName}" uses execSync — this blocks the event loop`);
            score -= 20;
          }

          // Check if hook is not async but should be
          if (!hookFn.constructor.name.includes("Async") && fnBody.includes("await")) {
            // No issue — function body has await but constructor may vary
          }
        }
      }
    }

    return {
      score: Math.max(0, score),
      findings,
      passed: findings.length === 0,
    };
  }

  /**
   * Documentation check: verify description, JSDoc, README, etc.
   */
  _checkDocumentation(plugin, pluginCode) {
    const findings = [];
    let score = 100;

    // Missing description
    if (!plugin.description || typeof plugin.description !== "string" || !plugin.description.trim()) {
      findings.push({ severity: "error", message: "Missing plugin description — documentation is essential for discoverability" });
      score -= 30;
    } else if (plugin.description.length < 20) {
      findings.push({ severity: "warning", message: "Plugin description is very short (< 20 chars) — consider expanding" });
      score -= 10;
    }

    // Check for JSDoc comments in source code
    if (typeof pluginCode === "string") {
      if (!/@description|@param|@returns|@example/.test(pluginCode)) {
        findings.push({ severity: "warning", message: "No JSDoc annotations found — add documentation for public API" });
        score -= 15;
      } else {
        const jsdocCount = (pluginCode.match(/@\w+/g) || []).length;
        if (jsdocCount < 3) {
          findings.push({ severity: "warning", message: "Minimal JSDoc documentation — consider expanding" });
          score -= 5;
        } else {
          score += 5; // Bonus for good docs
        }
      }
    }

    // No version
    if (!plugin.version) {
      findings.push({ severity: "warning", message: "No version specified — versioning helps users track updates" });
      score -= 10;
    }

    // No metadata
    if (!plugin.metadata || typeof plugin.metadata !== "object") {
      findings.push({ severity: "warning", message: "No metadata provided — add author, license, and repository info" });
      score -= 5;
    } else {
      // Check metadata fields
      const meta = plugin.metadata;
      if (!meta.author) {
        findings.push({ severity: "warning", message: "Metadata missing 'author' field" });
        score -= 3;
      }
      if (!meta.license) {
        findings.push({ severity: "warning", message: "Metadata missing 'license' field" });
        score -= 3;
      }
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      findings,
      passed: findings.filter((f) => f.severity === "error").length === 0,
    };
  }

  /**
   * Compatibility check: valid hook names, version format, exports shape.
   */
  _checkCompatibility(plugin) {
    const findings = [];
    let score = 100;

    // Version format
    if (plugin.version && !/^\d+\.\d+\.\d+/.test(plugin.version)) {
      findings.push(`Version "${plugin.version}" does not follow semver (e.g., "1.0.0")`);
      score -= 5;
    }

    // Hook compatibility
    if (plugin.hooks && typeof plugin.hooks === "object") {
      const hookNames = Object.keys(plugin.hooks);
      const unknownHooks = hookNames.filter((h) => !PLUGIN_HOOK_NAMES.includes(h));
      const validHooks = hookNames.filter((h) => PLUGIN_HOOK_NAMES.includes(h));

      if (unknownHooks.length > 0) {
        findings.push(
          `Unknown hook(s): ${unknownHooks.join(", ")}. Valid hooks: ${PLUGIN_HOOK_NAMES.join(", ")}`,
        );
        score -= unknownHooks.length * 10;
      }

      if (validHooks.length === 0) {
        findings.push("Plugin has zero valid hooks — it will not interact with the agent lifecycle");
        score -= 20;
      }
    } else {
      findings.push("Plugin has no hooks defined — it will not extend agent behavior");
      score -= 30;
    }

    // Check for module.exports compatibility hint
    if (typeof plugin.name !== "string") {
      findings.push("Plugin must export a 'name' field");
      score -= 50;
    }

    return {
      score: Math.max(0, score),
      findings,
      passed: findings.length === 0,
    };
  }

  /**
   * Tests check: evidence of test files, test coverage indication.
   */
  _checkTests(plugin, pluginCode) {
    const findings = [];
    let score = 100;

    // Check source code for test-related patterns
    if (typeof pluginCode === "string") {
      // Look for test assertions or references to test files
      if (/\btest\b/i.test(pluginCode) || /describe|it\(|test\(/.test(pluginCode)) {
        // Plugin source references tests — good sign
        score += 5;
      } else {
        findings.push("No test references found in source code");
        score -= 20;
      }
    } else {
      findings.push("No source code provided for test analysis");
      score -= 15;
    }

    // Check metadata for test info
    if (plugin.metadata && typeof plugin.metadata === "object") {
      if (plugin.metadata.tests) {
        const testsInfo = plugin.metadata.tests;
        if (testsInfo.coverage !== undefined) {
          const coverage = Number(testsInfo.coverage);
          if (coverage >= 80) {
            score += 10;
          } else if (coverage >= 50) {
            score += 0;
          } else {
            score -= 10;
            findings.push(`Low test coverage: ${coverage}%`);
          }
        }
        if (testsInfo.passing !== undefined && testsInfo.total !== undefined) {
          const ratio = testsInfo.passing / testsInfo.total;
          if (ratio < 1) {
            findings.push(`${testsInfo.total - testsInfo.passing} failing tests out of ${testsInfo.total}`);
            score -= 15;
          }
        }
      } else {
        findings.push("No test info in metadata — consider adding test coverage data");
        score -= 10;
      }
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      findings,
      passed: findings.length === 0,
    };
  }

  // -------------------------------------------------------------------------
  // Private: Score computation
  // -------------------------------------------------------------------------

  /**
   * Compute weighted quality score from individual check scores.
   *
   * @param {object} checks - The five quality check results
   * @returns {number} 0-100
   */
  _computeQualityScore(checks) {
    let score = 0;

    for (const [dimension, weight] of Object.entries(QUALITY_WEIGHTS)) {
      const check = checks[dimension];
      if (check && typeof check.score === "number") {
        score += check.score * weight;
      }
    }

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  /**
   * Create a failed review result.
   */
  _failedReview(message, score) {
    return {
      approved: false,
      score,
      checks: {
        security: { score: 0, findings: [], passed: true },
        performance: { score: 0, findings: [], passed: true },
        documentation: { score: 0, findings: [], passed: true },
        compatibility: { score: 0, findings: [], passed: true },
        tests: { score: 0, findings: [], passed: true },
      },
      issues: [{ severity: "error", category: "validation", message }],
      warnings: [],
      recommendation: `Rejected: ${message}`,
      reviewedAt: new Date().toISOString(),
      validation: { valid: false, errors: [{ path: "", message }], warnings: [] },
    };
  }
}

module.exports = { MarketplaceCurator, QUALITY_WEIGHTS, SECURITY_PATTERNS, QUALITY_PATTERNS };
