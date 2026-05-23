"use strict";

/**
 * Configuration Profiler for HaxAgent.
 *
 * Analyzes configuration objects for issues, suggests optimizations,
 * compares configurations, and estimates performance characteristics.
 */

const { flattenSchema, validateEntry } = require("./schema");

// ---------------------------------------------------------------------------
// Profile issue severity levels
// ---------------------------------------------------------------------------

const ISSUE_SEVERITY = Object.freeze({
  CRITICAL: "CRITICAL",
  WARNING: "WARNING",
  INFO: "INFO",
});

// ---------------------------------------------------------------------------
// Performance cost weights (relative; higher = more expensive)
// ---------------------------------------------------------------------------

const COST_WEIGHTS = Object.freeze({
  tokenGeneration: 1.0,
  toolExecution: 2.5,
  memoryLookup: 0.5,
  compactionPass: 3.0,
  fileScan: 1.8,
  networkCall: 4.0,
  apiLatency: 2.0,
});

// ---------------------------------------------------------------------------
// Known suboptimal value patterns and their recommendations
// ---------------------------------------------------------------------------

const SUBOPTIMAL_PATTERNS = Object.freeze([
  {
    key: "permissions.mode",
    check: (v) => v === "yolo",
    severity: ISSUE_SEVERITY.CRITICAL,
    message: "YOLO mode auto-approves all tool calls without confirmation.",
    recommendation: "Use 'normal' or 'auto' mode for safer operation.",
    suggestedValue: "normal",
  },
  {
    key: "tools.shell.allowedCommands",
    check: (v) => Array.isArray(v) && v.length === 1 && v[0] === "*",
    severity: ISSUE_SEVERITY.CRITICAL,
    message: "Unrestricted shell command whitelist allows arbitrary execution.",
    recommendation: "Restrict allowedCommands to a specific set of commands.",
    suggestedValue: null, // needs user input
  },
  {
    key: "tools.file.allowedPaths",
    check: (v) => Array.isArray(v) && v.length === 1 && v[0] === "*",
    severity: ISSUE_SEVERITY.WARNING,
    message: "Unrestricted file paths allow access to the entire filesystem.",
    recommendation: "Limit allowedPaths to the project directory.",
    suggestedValue: null,
  },
  {
    key: "agent.maxToolTurns",
    check: (v) => v > 80,
    severity: ISSUE_SEVERITY.WARNING,
    message: "High maxToolTurns can lead to runaway agent loops and high costs.",
    recommendation: "Reduce maxToolTurns to 50 or below unless long-running tasks are required.",
    suggestedValue: 50,
  },
  {
    key: "agent.maxToolTurns",
    check: (v) => v <= 2,
    severity: ISSUE_SEVERITY.INFO,
    message: "Very low maxToolTurns limits the agent's ability to complete multi-step tasks.",
    recommendation: "Increase maxToolTurns to at least 5 for practical task execution.",
    suggestedValue: 5,
  },
  {
    key: "agent.temperature",
    check: (v) => v > 0.8,
    severity: ISSUE_SEVERITY.INFO,
    message: "High temperature (>0.8) may produce non-deterministic/unreliable outputs.",
    recommendation: "Lower temperature to 0.3-0.5 for more predictable agent behavior.",
    suggestedValue: 0.3,
  },
  {
    key: "context.charsPerToken",
    check: (v) => v < 3 || v > 6,
    severity: ISSUE_SEVERITY.INFO,
    message: "Unusual charsPerToken value may cause inaccurate token estimation.",
    recommendation: "Use the default of 4 for general English text; adjust if working with non-English languages.",
    suggestedValue: 4,
  },
  {
    key: "context.reserveOutputTokens",
    check: (v) => v < 1024,
    severity: ISSUE_SEVERITY.WARNING,
    message: "Low reserveOutputTokens may truncate model responses.",
    recommendation: "Set reserveOutputTokens to at least 4096 for typical output needs.",
    suggestedValue: 4096,
  },
  {
    key: "memory.maxEntries",
    check: (v) => v > 200,
    severity: ISSUE_SEVERITY.INFO,
    message: "Large maxEntries increases memory overhead and token usage per turn.",
    recommendation: "Keep maxEntries at 50 or below for most use cases; only increase for long-running sessions.",
    suggestedValue: 50,
  },
  {
    key: "agent.maxTokens",
    check: (v) => v < 512,
    severity: ISSUE_SEVERITY.WARNING,
    message: "Very low maxTokens severely limits model response length.",
    recommendation: "Increase maxTokens to at least 1024 for meaningful responses.",
    suggestedValue: 1024,
  },
  {
    key: "agent.maxTokens",
    check: (v) => v > 64000,
    severity: ISSUE_SEVERITY.INFO,
    message: "Very high maxTokens increases cost and latency for each response.",
    recommendation: "Consider using a moderate limit (16384-32768) unless very long outputs are required.",
    suggestedValue: 16384,
  },
  {
    key: "shell.timeoutMs",
    check: (v) => v > 180_000,
    severity: ISSUE_SEVERITY.INFO,
    message: "Very long shell timeouts can block agent progress in CI environments.",
    recommendation: "Reduce timeoutMs to 60000-120000 for better responsiveness.",
    suggestedValue: 60000,
  },
  {
    key: "shell.timeoutMs",
    check: (v) => v < 2000,
    severity: ISSUE_SEVERITY.WARNING,
    message: "Very short shell timeout may cause legitimate commands to fail prematurely.",
    recommendation: "Set timeoutMs to at least 5000 to allow reasonable command execution.",
    suggestedValue: 5000,
  },
  {
    key: "context.threshold",
    check: (v) => v < 0.3,
    severity: ISSUE_SEVERITY.WARNING,
    message: "Low auto-compact threshold triggers compaction too aggressively, losing context.",
    recommendation: "Use a threshold of 0.7-0.85 for balanced compaction behavior.",
    suggestedValue: 0.75,
  },
  {
    key: "context.threshold",
    check: (v) => v > 0.95,
    severity: ISSUE_SEVERITY.WARNING,
    message: "High auto-compact threshold may trigger too late, risking context overflow.",
    recommendation: "Use a threshold of 0.7-0.85 for balanced compaction behavior.",
    suggestedValue: 0.75,
  },
]);

// ---------------------------------------------------------------------------
// Benchmark stat estimation model
// ---------------------------------------------------------------------------

/**
 * Estimate cost and performance metrics for a configuration object.
 * Returns a relative "cost score" and breakdown.
 *
 * @param {object} config
 * @returns {{ totalScore: number, breakdown: Array<{factor: string, score: number, contribution: number}> }}
 */
function estimatePerformance(config) {
  const agent = config.agent || {};
  const tools = config.tools || {};
  const shell = tools.shell || {};
  const memory = config.memory || {};
  const context = config.context || {};
  const fileContext = config.fileContext || {};

  const breakdown = [];

  // Token generation cost: proportional to maxTokens × maxToolTurns
  const maxTokens = agent.maxTokens || 8192;
  const maxTurns = agent.maxToolTurns || 20;
  const tokenCost = (maxTokens / 8192) * maxTurns * COST_WEIGHTS.tokenGeneration;
  breakdown.push({ factor: "Token generation", score: tokenCost, contribution: tokenCost });

  // Tool execution: each turn may execute tools
  const toolCost = maxTurns * COST_WEIGHTS.toolExecution;
  breakdown.push({ factor: "Tool execution", score: toolCost, contribution: toolCost });

  // Shell overhead: affected by timeout and maxBuffer
  const shellTimeoutMs = shell.timeoutMs || 10000;
  const shellMaxBuffer = shell.maxBuffer || 52428800;
  const shellCost =
    (shellTimeoutMs / 10000) * (shellMaxBuffer / 52428800) * 0.2 * COST_WEIGHTS.toolExecution;
  breakdown.push({ factor: "Shell overhead", score: shellCost, contribution: shellCost });

  // Memory overhead
  const memEnabled = memory.enabled !== false ? 1 : 0;
  const memEntries = memory.maxEntries || 20;
  const memCost = memEnabled * memEntries * 0.05 * COST_WEIGHTS.memoryLookup;
  breakdown.push({ factor: "Memory overhead", score: memCost, contribution: memCost });

  // Compaction cost
  const autoCompact = context.autoCompact !== false ? 1 : 0;
  const compactCost = autoCompact * maxTurns * 0.15 * COST_WEIGHTS.compactionPass;
  breakdown.push({ factor: "Auto-compaction", score: compactCost, contribution: compactCost });

  // File scan cost
  const fileCtxEnabled = fileContext.enabled !== false ? 1 : 0;
  const maxFiles = fileContext.maxFiles || 8;
  const maxFileScan = fileContext.maxIndexFiles || 2000;
  const fileScanCost =
    fileCtxEnabled * Math.min(maxFiles, 10) * (maxFileScan / 2000) * COST_WEIGHTS.fileScan;
  breakdown.push({ factor: "File scanning", score: fileScanCost, contribution: fileScanCost });

  // Network/API latency base cost
  const networkCost = COST_WEIGHTS.networkCall * (1 + maxTurns * 0.1);
  breakdown.push({ factor: "API latency", score: networkCost, contribution: networkCost });

  // Max tokens contributes to latency
  const latencyCost = (maxTokens / 8192) * COST_WEIGHTS.apiLatency;
  breakdown.push({ factor: "Token latency", score: latencyCost, contribution: latencyCost });

  const totalScore = breakdown.reduce((sum, b) => sum + b.contribution, 0);

  // Normalize contributions to percentages
  for (const entry of breakdown) {
    entry.contribution = totalScore > 0
      ? Math.round((entry.contribution / totalScore) * 10000) / 100
      : 0;
  }

  return { totalScore: Math.round(totalScore * 100) / 100, breakdown };
}

// ---------------------------------------------------------------------------
// Config comparison helpers
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function flatten(obj, prefix = "") {
  const result = {};
  for (const [key, val] of Object.entries(obj || {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(val)) {
      Object.assign(result, flatten(val, fullKey));
    } else {
      result[fullKey] = val;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// ConfigProfiler
// ---------------------------------------------------------------------------

class ConfigProfiler {
  /**
   * @param {object} [opts]
   * @param {object} [opts.schema] — internal schema entries (defaults to flattenSchema())
   */
  constructor(opts = {}) {
    this._schema = opts.schema || flattenSchema();
    /** @type {Array<object>} */
    this._issues = [];
    /** @type {Array<object>} */
    this._suggestions = [];
    /** @type {object|null} */
    this._lastProfile = null;
  }

  // ---------------------------------------------------------------------------
  // profile(config) — profiles current config for issues
  // ---------------------------------------------------------------------------

  /**
   * Profile a configuration object, returning a list of issues found.
   * Each issue includes a severity, the setting path, a description,
   * and a recommended fix.
   *
   * @param {object} config — the configuration to profile
   * @returns {Array<object>} issues
   */
  profile(config) {
    if (!config || typeof config !== "object") {
      throw new TypeError("config must be a non-null object");
    }

    const issues = [];
    const flatConfig = flatten(config);

    // 1. Schema validation issues
    for (const entry of this._schema) {
      const value = flatConfig[entry.path];
      if (value === undefined) continue;

      const err = validateEntry(entry, value);
      if (err) {
        issues.push({
          severity: ISSUE_SEVERITY.WARNING,
          type: "SCHEMA_VIOLATION",
          path: entry.path,
          message: err,
          currentValue: value,
          recommendation: `Set ${entry.path} to match type "${entry.type}"${entry.choices ? ` (choices: ${entry.choices.join(", ")})` : ""}.`,
        });
      }
    }

    // 2. Suboptimal value pattern checks
    for (const pattern of SUBOPTIMAL_PATTERNS) {
      const value = flatConfig[pattern.key];
      if (value === undefined) continue;

      if (pattern.check(value)) {
        issues.push({
          severity: pattern.severity,
          type: "SUBOPTIMAL",
          path: pattern.key,
          message: pattern.message,
          currentValue: value,
          recommendation: pattern.recommendation,
          suggestedValue: pattern.suggestedValue !== undefined ? pattern.suggestedValue : undefined,
        });
      }
    }

    // 3. Missing important keys
    const importantKeys = [
      { path: "agent.provider", fallback: "anthropic" },
      { path: "agent.model", fallback: "claude-sonnet-4-20250514" },
    ];
    for (const ik of importantKeys) {
      if (!(ik.path in flatConfig)) {
        issues.push({
          severity: ISSUE_SEVERITY.WARNING,
          type: "MISSING_IMPORTANT",
          path: ik.path,
          message: `Important setting "${ik.path}" is not configured; falling back to "${ik.fallback}".`,
          currentValue: undefined,
          recommendation: `Explicitly set ${ik.path} to avoid relying on fallbacks.`,
        });
      }
    }

    // 4. Unrecognized keys (present in flatConfig but not in schema)
    const schemaPaths = new Set(this._schema.map((e) => e.path));
    for (const key of Object.keys(flatConfig)) {
      if (!schemaPaths.has(key)) {
        // Skip well-known runtime/metadata keys
        if (key === "projectRoot" || key.startsWith("_")) continue;
        issues.push({
          severity: ISSUE_SEVERITY.INFO,
          type: "UNRECOGNIZED_KEY",
          path: key,
          message: `Unrecognized configuration key "${key}" — may be a typo or outdated setting.`,
          currentValue: flatConfig[key],
          recommendation: `Verify that "${key}" is a valid HaxAgent setting.`,
        });
      }
    }

    // 5. Environment variable hints: warn if apiKey is set in config (less secure)
    if (flatConfig["agent.apiKey"] && typeof flatConfig["agent.apiKey"] === "string") {
      issues.push({
        severity: ISSUE_SEVERITY.WARNING,
        type: "SECURITY",
        path: "agent.apiKey",
        message: "API key stored in config file — prefer using environment variable ANTHROPIC_API_KEY.",
        currentValue: "[REDACTED]",
        recommendation: "Remove apiKey from config and set the ANTHROPIC_API_KEY environment variable instead.",
      });
    }

    this._issues = issues;
    return issues;
  }

  // ---------------------------------------------------------------------------
  // suggestOptimizations(config) — recommends optimal settings
  // ---------------------------------------------------------------------------

  /**
   * Analyze a configuration and return concrete optimization suggestions.
   * Each suggestion includes the path, current value, recommended value,
   * and a rationale.
   *
   * @param {object} config
   * @returns {Array<object>} suggestions
   */
  suggestOptimizations(config) {
    if (!config || typeof config !== "object") {
      throw new TypeError("config must be a non-null object");
    }

    const suggestions = [];
    const flatConfig = flatten(config);

    for (const pattern of SUBOPTIMAL_PATTERNS) {
      const value = flatConfig[pattern.key];
      if (value === undefined) continue;

      if (pattern.check(value) && pattern.suggestedValue !== undefined && pattern.suggestedValue !== null) {
        suggestions.push({
          path: pattern.key,
          currentValue: value,
          recommendedValue: pattern.suggestedValue,
          severity: pattern.severity,
          rationale: pattern.message,
        });
      }
    }

    // Context window optimizations
    const windowTokens = flatConfig["context.windowTokens"];
    const reserveOutput = flatConfig["context.reserveOutputTokens"] || 8192;

    if (windowTokens !== undefined && windowTokens < 32000) {
      suggestions.push({
        path: "context.windowTokens",
        currentValue: windowTokens,
        recommendedValue: Math.max(windowTokens, 100000),
        severity: ISSUE_SEVERITY.INFO,
        rationale: "Modern models support large context windows; larger windows reduce compaction frequency.",
      });
    }

    if (reserveOutput < 4096) {
      suggestions.push({
        path: "context.reserveOutputTokens",
        currentValue: reserveOutput,
        recommendedValue: 4096,
        severity: ISSUE_SEVERITY.WARNING,
        rationale: "Insufficient output token reservation can truncate model responses.",
      });
    }

    // Auto-compact: recommend enabling if disabled but using a small window
    const autoCompact = flatConfig["context.autoCompact"];
    if (autoCompact === false && windowTokens !== undefined && windowTokens <= 100000) {
      suggestions.push({
        path: "context.autoCompact",
        currentValue: false,
        recommendedValue: true,
        severity: ISSUE_SEVERITY.INFO,
        rationale: "Auto-compaction is recommended to prevent context overflow with smaller windows.",
      });
    }

    // Temperature optimization for coding tasks
    const temperature = flatConfig["agent.temperature"];
    if (temperature !== undefined && temperature > 0.5) {
      suggestions.push({
        path: "agent.temperature",
        currentValue: temperature,
        recommendedValue: 0.2,
        severity: ISSUE_SEVERITY.INFO,
        rationale: "Lower temperature produces more deterministic, reliable code generation.",
      });
    }

    // Max shell buffer: warn on unreasonably low buffers
    const maxBuffer = flatConfig["shell.maxBuffer"];
    if (maxBuffer !== undefined && maxBuffer < 1_048_576) {
      suggestions.push({
        path: "shell.maxBuffer",
        currentValue: maxBuffer,
        recommendedValue: 5_242_880,
        severity: ISSUE_SEVERITY.INFO,
        rationale: "A larger maxBuffer prevents premature truncation of command outputs.",
      });
    }

    this._suggestions = suggestions;
    return suggestions;
  }

  // ---------------------------------------------------------------------------
  // compareConfigs(a, b) — detailed config comparison
  // ---------------------------------------------------------------------------

  /**
   * Compare two configuration objects and return a detailed diff.
   * Reports keys that are only in A, only in B, shared but differ,
   * and shared and equal.
   *
   * @param {object} configA
   * @param {object} configB
   * @returns {object} comparison result
   */
  compareConfigs(configA, configB) {
    if (!isPlainObject(configA) || !isPlainObject(configB)) {
      throw new TypeError("Both arguments must be non-null plain objects");
    }

    const flatA = flatten(configA);
    const flatB = flatten(configB);

    const onlyInA = [];
    const onlyInB = [];
    const differing = [];
    const shared = [];

    const allKeys = new Set([...Object.keys(flatA), ...Object.keys(flatB)]);

    for (const key of allKeys) {
      const inA = key in flatA;
      const inB = key in flatB;

      if (inA && !inB) {
        onlyInA.push({ key, value: flatA[key] });
      } else if (!inA && inB) {
        onlyInB.push({ key, value: flatB[key] });
      } else if (inA && inB) {
        const aVal = flatA[key];
        const bVal = flatB[key];
        if (deepEqual(aVal, bVal)) {
          shared.push({ key, value: aVal });
        } else {
          differing.push({ key, valueA: aVal, valueB: bVal });
        }
      }
    }

    // Sort all arrays by key for consistent output
    const byKey = (a, b) => a.key.localeCompare(b.key);
    onlyInA.sort(byKey);
    onlyInB.sort(byKey);
    differing.sort(byKey);
    shared.sort(byKey);

    return {
      totalKeys: allKeys.size,
      sharedCount: shared.length,
      diffCount: differing.length,
      onlyInACount: onlyInA.length,
      onlyInBCount: onlyInB.length,
      matchPercentage: allKeys.size > 0
        ? Math.round((shared.length / allKeys.size) * 10000) / 100
        : 100,
      onlyInA,
      onlyInB,
      differing,
      shared,
    };
  }

  // ---------------------------------------------------------------------------
  // benchmarkConfig(config) — estimates performance of config
  // ---------------------------------------------------------------------------

  /**
   * Estimate the performance profile of a configuration.
   * Returns a cost score and breakdown of contributing factors.
   *
   * @param {object} config
   * @returns {object} benchmark result
   */
  benchmarkConfig(config) {
    if (!config || typeof config !== "object") {
      throw new TypeError("config must be a non-null object");
    }

    const perf = estimatePerformance(config);

    // Classify performance tier
    let tier;
    if (perf.totalScore < 20) {
      tier = "LIGHTWEIGHT";
    } else if (perf.totalScore < 50) {
      tier = "MODERATE";
    } else if (perf.totalScore < 100) {
      tier = "HEAVY";
    } else {
      tier = "HIGH_COST";
    }

    // Identify top cost factors
    const sorted = [...perf.breakdown].sort((a, b) => b.contribution - a.contribution);
    const topFactors = sorted.slice(0, 3).map((f) => ({
      factor: f.factor,
      contribution: f.contribution,
    }));

    return {
      totalScore: perf.totalScore,
      tier,
      breakdown: perf.breakdown,
      topFactors,
      recommendation: tier === "HIGH_COST"
        ? "Consider reducing maxToolTurns or maxTokens to lower operational cost."
        : tier === "HEAVY"
          ? "Configuration is on the heavier side; consider tuning for specific workloads."
          : tier === "MODERATE"
            ? "Configuration is balanced for general use."
            : "Configuration is lightweight and cost-efficient.",
    };
  }

  // ---------------------------------------------------------------------------
  // getProfile() — full profile report
  // ---------------------------------------------------------------------------

  /**
   * Return a comprehensive profile report for the last profiled configuration.
   * Call profile(), suggestOptimizations(), or benchmarkConfig() first.
   *
   * @returns {{ issues: Array<object>, suggestions: Array<object>, summary: object }}
   */
  getProfile() {
    const issues = [...this._issues];
    const suggestions = [...this._suggestions];

    const criticalCount = issues.filter((i) => i.severity === ISSUE_SEVERITY.CRITICAL).length;
    const warningCount = issues.filter((i) => i.severity === ISSUE_SEVERITY.WARNING).length;
    const infoCount = issues.filter((i) => i.severity === ISSUE_SEVERITY.INFO).length;

    const suboptimalCount = issues.filter((i) => i.type === "SUBOPTIMAL").length;
    const schemaViolationCount = issues.filter((i) => i.type === "SCHEMA_VIOLATION").length;
    const securityCount = issues.filter((i) => i.type === "SECURITY").length;

    const summary = {
      totalIssues: issues.length,
      bySeverity: { critical: criticalCount, warning: warningCount, info: infoCount },
      byType: {
        suboptimal: suboptimalCount,
        schemaViolation: schemaViolationCount,
        security: securityCount,
        unrecognized: issues.filter((i) => i.type === "UNRECOGNIZED_KEY").length,
        missingImportant: issues.filter((i) => i.type === "MISSING_IMPORTANT").length,
      },
      totalSuggestions: suggestions.length,
      healthScore: issues.length === 0
        ? 100
        : Math.max(0, Math.round(100 - criticalCount * 25 - warningCount * 10 - infoCount * 2)),
    };

    this._lastProfile = { issues, suggestions, summary };
    return this._lastProfile;
  }

  // ---------------------------------------------------------------------------
  // Convenience: generate a human-readable text report
  // ---------------------------------------------------------------------------

  /**
   * Generate a human-readable string report from the current profile.
   * @returns {string}
   */
  getReportText() {
    const profile = this.getProfile();
    if (!profile || profile.issues.length === 0) {
      return "No configuration issues detected. Health score: 100.";
    }

    const lines = [];
    lines.push("=== Configuration Profile Report ===");
    lines.push(`Health Score: ${profile.summary.healthScore}/100`);
    lines.push(
      `Issues: ${profile.summary.totalIssues} (${profile.summary.bySeverity.critical} CRITICAL, ${profile.summary.bySeverity.warning} WARNING, ${profile.summary.bySeverity.info} INFO)`
    );
    lines.push(`Suggestions: ${profile.summary.totalSuggestions}`);
    lines.push("");

    const severities = [ISSUE_SEVERITY.CRITICAL, ISSUE_SEVERITY.WARNING, ISSUE_SEVERITY.INFO];
    for (const sev of severities) {
      const group = profile.issues.filter((i) => i.severity === sev);
      if (group.length === 0) continue;
      lines.push(`--- ${sev} (${group.length}) ---`);
      for (const issue of group) {
        lines.push(`  [${issue.type}] ${issue.path}`);
        lines.push(`    ${issue.message}`);
        if (issue.recommendation) {
          lines.push(`    Fix: ${issue.recommendation}`);
        }
      }
      lines.push("");
    }

    if (profile.suggestions.length > 0) {
      lines.push("--- Suggested Optimizations ---");
      for (const sug of profile.suggestions) {
        lines.push(
          `  ${sug.path}: ${JSON.stringify(sug.currentValue)} -> ${JSON.stringify(sug.recommendedValue)}`
        );
        lines.push(`    ${sug.rationale}`);
      }
      lines.push("");
    }

    lines.push("=== End of Report ===");
    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  /**
   * Reset internal state.
   */
  reset() {
    this._issues = [];
    this._suggestions = [];
    this._lastProfile = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ConfigProfiler,
  ISSUE_SEVERITY,
  SUBOPTIMAL_PATTERNS,
  COST_WEIGHTS,
};
