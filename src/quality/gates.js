"use strict";

/**
 * Quality Gate — runs automated checks before/after agent actions
 * to ensure code quality, security, and project health standards.
 *
 * Each check returns: { name, status: 'pass'|'fail'|'skip', message, score, details }
 * Gate result: { passed, failed, skipped, totalScore, maxScore, threshold, results }
 */

/**
 * Pre-built check implementations.
 * External tool output is expected to be mocked/injected via context
 * so that tests can run without real linters installed.
 */

/**
 * Parse lint output from ESLint/biome JSON.
 * Expects context.lintOutput: parsed JSON with shape { errorCount, warningCount, messages }
 */
function lintCheck(context) {
  const output = (context && context.lintOutput) || { errorCount: 0, warningCount: 0, messages: [] };
  const errors = output.errorCount || 0;
  const warnings = output.warningCount || 0;
  const total = errors + warnings;

  if (total === 0) {
    return { name: "lint", status: "pass", message: "No lint issues found", score: 10, details: { errors, warnings } };
  }
  if (errors === 0) {
    return { name: "lint", status: "pass", message: `${warnings} lint warning(s) found`, score: 8, details: { errors, warnings } };
  }
  return { name: "lint", status: "fail", message: `${errors} lint error(s), ${warnings} warning(s)`, score: 0, details: { errors, warnings, messages: output.messages } };
}

/**
 * Run TypeScript/Flow type check.
 * Expects context.typeCheckOutput: { errors: number, messages: string[] }
 */
function typeCheck(context) {
  const output = (context && context.typeCheckOutput) || { errors: 0, messages: [] };

  if (output.errors === 0) {
    return { name: "typeCheck", status: "pass", message: "Type checking passed", score: 10, details: { errors: 0 } };
  }
  return { name: "typeCheck", status: "fail", message: `${output.errors} type error(s)`, score: 0, details: { errors: output.errors, messages: output.messages || [] } };
}

/**
 * Verify tests pass.
 * Expects context.testOutput: { passed, failed, skipped, total }
 */
function testCheck(context) {
  const output = (context && context.testOutput) || { passed: 0, failed: 0, skipped: 0, total: 0 };

  if (output.failed === 0 && output.total > 0) {
    const msg = output.skipped > 0
      ? `All ${output.passed} tests passed (${output.skipped} skipped)`
      : `All ${output.passed} tests passed`;
    return { name: "test", status: "pass", message: msg, score: 10, details: { ...output } };
  }
  if (output.total === 0) {
    return { name: "test", status: "skip", message: "No tests found", score: 0, details: { ...output } };
  }
  return { name: "test", status: "fail", message: `${output.failed}/${output.total} tests failed`, score: 0, details: { ...output } };
}

/**
 * Run security audit (npm audit or similar).
 * Expects context.securityOutput: { vulnerabilities: { critical, high, moderate, low }, total }
 */
function securityCheck(context) {
  const output = (context && context.securityOutput) || { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 }, total: 0 };

  if (output.total === 0) {
    return { name: "security", status: "pass", message: "No known vulnerabilities", score: 10, details: { ...output } };
  }

  const vulns = output.vulnerabilities || {};
  if ((vulns.critical || 0) > 0 || (vulns.high || 0) > 0) {
    return {
      name: "security",
      status: "fail",
      message: `${vulns.critical || 0} critical, ${vulns.high || 0} high vulnerabilities`,
      score: 0,
      details: { ...output },
    };
  }

  return {
    name: "security",
    status: "pass",
    message: `${output.total} low/moderate vulnerability(s) — review recommended`,
    score: 5,
    details: { ...output },
  };
}

/**
 * Verify test coverage thresholds.
 * Expects context.coverageOutput: { lines, statements, functions, branches }
 */
function coverageCheck(context) {
  const thresholds = (context && context.coverageThresholds) || { lines: 80, statements: 80, functions: 80, branches: 70 };
  const output = (context && context.coverageOutput) || { lines: 0, statements: 0, functions: 0, branches: 0 };

  const failures = [];
  for (const key of Object.keys(thresholds)) {
    const actual = output[key] || 0;
    const required = thresholds[key] || 0;
    if (actual < required) {
      failures.push(`${key}: ${actual}% (need ${required}%)`);
    }
  }

  if (failures.length === 0) {
    const avg = Math.round(Object.values(output).reduce((a, b) => a + b, 0) / 4);
    return { name: "coverage", status: "pass", message: `Coverage at ${avg}% — all thresholds met`, score: 10, details: { thresholds, coverage: output } };
  }

  return {
    name: "coverage",
    status: "fail",
    message: `Coverage below threshold: ${failures.join("; ")}`,
    score: 0,
    details: { thresholds, coverage: output, failures },
  };
}

/**
 * Check for known dependency vulnerabilities via audit.
 * Expects context.dependencyOutput: { advisories: object, total: number }
 */
function dependencyCheck(context) {
  const output = (context && context.dependencyOutput) || { advisories: {}, total: 0 };

  if (output.total === 0) {
    return { name: "dependencies", status: "pass", message: "No dependency issues found", score: 10, details: { ...output } };
  }

  const advisoryCount = Object.keys(output.advisories || {}).length;
  return {
    name: "dependencies",
    status: "fail",
    message: `${advisoryCount} dependency advisorie(s) found`,
    score: 0,
    details: { ...output },
  };
}

const PREBUILT_CHECKS = {
  lint: lintCheck,
  typeCheck: typeCheck,
  test: testCheck,
  security: securityCheck,
  coverage: coverageCheck,
  dependencies: dependencyCheck,
};

/**
 * QualityGate — registry and runner for quality checks.
 */
class QualityGate {
  constructor() {
    this._checks = new Map();
    this._threshold = 0;

    // Register pre-built checks by default
    for (const [name, fn] of Object.entries(PREBUILT_CHECKS)) {
      this._checks.set(name, { fn, options: { enabled: true, weight: 1 } });
    }
  }

  /**
   * Register a quality check function.
   * @param {string} name - unique check name
   * @param {function} checkFn - (context) => { name, status, message, score, details }
   * @param {{ enabled?: boolean, weight?: number }} [options]
   */
  addCheck(name, checkFn, options = {}) {
    if (typeof name !== "string" || !name.trim()) {
      throw new Error("Check name must be a non-empty string");
    }
    if (typeof checkFn !== "function") {
      throw new Error("Check function must be a function");
    }
    this._checks.set(name, {
      fn: checkFn,
      options: {
        enabled: options.enabled !== undefined ? options.enabled : true,
        weight: options.weight !== undefined ? options.weight : 1,
      },
    });
    return this;
  }

  /**
   * Remove a previously registered check.
   * @param {string} name
   */
  removeCheck(name) {
    this._checks.delete(name);
    return this;
  }

  /**
   * Get list of registered check names.
   * @returns {string[]}
   */
  listChecks() {
    return [...this._checks.keys()];
  }

  /**
   * Set minimum total score required for the gate to pass.
   * @param {number} score
   */
  setThreshold(score) {
    if (!Number.isFinite(score) || score < 0) {
      throw new Error("Threshold must be a non-negative finite number");
    }
    this._threshold = score;
    return this;
  }

  /**
   * Get the current threshold.
   * @returns {number}
   */
  getThreshold() {
    return this._threshold;
  }

  /**
   * Run all registered, enabled checks against the given context.
   * @param {object} [context]
   * @returns {{ passed: boolean, failed: number, skipped: number, totalScore: number, maxScore: number, threshold: number, results: Array }}
   */
  runAll(context = {}) {
    const results = [];
    let totalScore = 0;
    let maxScore = 0;

    for (const [name, { fn, options }] of this._checks) {
      if (!options.enabled) {
        results.push({ name, status: "skip", message: "Check disabled", score: 0, details: null });
        continue;
      }

      let result;
      try {
        result = fn(context);
      } catch (error) {
        result = { name, status: "fail", message: `Check threw: ${error.message}`, score: 0, details: { error: error.message } };
      }

      // Ensure result has required fields
      const normalized = {
        name: result.name || name,
        status: result.status || "fail",
        message: result.message || "",
        score: result.score !== undefined ? result.score : 0,
        details: result.details || null,
        weight: options.weight || 1,
      };

      totalScore += normalized.score;
      maxScore += 10 * (options.weight || 1);
      results.push(normalized);
    }

    const failed = results.filter((r) => r.status === "fail").length;
    const skipped = results.filter((r) => r.status === "skip").length;
    const passed = this._threshold > 0
      ? totalScore >= this._threshold
      : failed === 0;

    return { passed, failed, skipped, totalScore, maxScore, threshold: this._threshold, results };
  }

  /**
   * Run only the named checks.
   * @param {string[]} names
   * @param {object} [context]
   * @returns {{ passed: boolean, failed: number, skipped: number, totalScore: number, maxScore: number, threshold: number, results: Array }}
   */
  runByName(names, context = {}) {
    const results = [];
    let totalScore = 0;
    let maxScore = 0;

    for (const name of names) {
      const entry = this._checks.get(name);
      if (!entry) {
        results.push({ name, status: "skip", message: "Check not registered", score: 0, details: null });
        continue;
      }

      const { fn, options } = entry;
      if (!options.enabled) {
        results.push({ name, status: "skip", message: "Check disabled", score: 0, details: null });
        continue;
      }

      let result;
      try {
        result = fn(context);
      } catch (error) {
        result = { name, status: "fail", message: `Check threw: ${error.message}`, score: 0, details: { error: error.message } };
      }

      const normalized = {
        name: result.name || name,
        status: result.status || "fail",
        message: result.message || "",
        score: result.score !== undefined ? result.score : 0,
        details: result.details || null,
        weight: options.weight || 1,
      };

      totalScore += normalized.score;
      maxScore += 10 * (options.weight || 1);
      results.push(normalized);
    }

    const failed = results.filter((r) => r.status === "fail").length;
    const skipped = results.filter((r) => r.status === "skip").length;
    const passed = this._threshold > 0
      ? totalScore >= this._threshold
      : failed === 0;

    return { passed, failed, skipped, totalScore, maxScore, threshold: this._threshold, results };
  }
}

module.exports = {
  QualityGate,
  PREBUILT_CHECKS,
  lintCheck,
  typeCheck,
  testCheck,
  securityCheck,
  coverageCheck,
  dependencyCheck,
};
