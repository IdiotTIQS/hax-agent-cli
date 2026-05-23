"use strict";

/**
 * @fileoverview Change impact estimation system.
 *
 * Estimates the downstream impact of proposed file changes.
 * Analyzes dependency graphs, change types, and file criticality
 * to provide risk assessments and testing recommendations.
 *
 * All analysis is heuristic — no LLM dependency.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a file path for consistent keying.
 * @param {string} filePath
 * @returns {string}
 */
function normalizePath(filePath) {
  return (filePath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .toLowerCase();
}

/**
 * Check if a file path looks like a test file.
 * @param {string} filePath
 * @returns {boolean}
 */
function isTestFile(filePath) {
  const lower = filePath.toLowerCase();
  return (
    lower.includes(".test.") ||
    lower.includes(".spec.") ||
    lower.includes("/test/") ||
    lower.includes("/tests/") ||
    lower.includes("/__tests__/") ||
    lower.endsWith(".test.js") ||
    lower.endsWith(".test.ts") ||
    lower.endsWith(".spec.js") ||
    lower.endsWith(".spec.ts")
  );
}

/**
 * Check if a file is a configuration file.
 * @param {string} filePath
 * @returns {boolean}
 */
function isConfigFile(filePath) {
  const name = filePath.toLowerCase();
  const configNames = [
    ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    "package.json", "tsconfig", "webpack", "eslint", "babel",
    ".env", "dockerfile", "docker-compose", "makefile",
    ".editorconfig", ".prettierrc", ".gitignore",
  ];
  return configNames.some((n) => name.includes(n) || name.endsWith(n));
}

/**
 * Compute the depth of a file in the dependency tree.
 * @param {string} key
 * @param {Map<string, string[]>} importGraph
 * @param {number} maxDepth
 * @returns {number}
 */
function computeDepth(key, importGraph, maxDepth = 10) {
  const visited = new Set();
  function walk(k, depth) {
    if (depth >= maxDepth || visited.has(k)) return depth;
    visited.add(k);
    const deps = importGraph.get(k);
    if (!deps || deps.length === 0) return depth;
    let maxChild = depth;
    for (const dep of deps) {
      const depKey = normalizePath(dep);
      const childDepth = walk(depKey, depth + 1);
      if (childDepth > maxChild) maxChild = childDepth;
    }
    return maxChild;
  }
  return walk(key, 0);
}

// ---------------------------------------------------------------------------
// Risk levels
// ---------------------------------------------------------------------------

/** @enum {string} */
const RiskLevel = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
};

// ---------------------------------------------------------------------------
// ChangeImpact
// ---------------------------------------------------------------------------

/**
 * Estimates the downstream impact of file changes and provides
 * risk assessments, affected-file discovery, and testing recommendations.
 */
class ChangeImpact {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxAffectedFiles=100] - max number of affected files to trace
   * @param {number} [opts.maxDepth=10] - max dependency graph depth to traverse
   */
  constructor(opts = {}) {
    this._opts = {
      maxAffectedFiles: opts.maxAffectedFiles || 100,
      maxDepth: opts.maxDepth || 10,
    };

    /** @type {Map<string, string[]>} - file -> resolved imports */
    this._importGraph = new Map();

    /** @type {Map<string, string[]>} - file -> files that import it */
    this._reverseImportGraph = new Map();

    /** @type {Map<string, number>} - file -> number of consumers (fan-out) */
    this._fanOut = new Map();

    /** @type {Map<string, string>} - file -> category (util, config, core, feature, test, unknown) */
    this._categories = new Map();

    /** @type {Map<string, string>} - file -> source content */
    this._fileSources = new Map();

    /** @type {Map<string, string[]>} - file -> test files associated with it */
    this._testMap = new Map();

    /** @type {Map<string, number>} - file -> modification count */
    this._modificationCount = new Map();

    /** @type {string[]} - files marked as critical */
    this._criticalFiles = [];
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Register a project file with its metadata.
   *
   * @param {object} fileInfo
   * @param {string} fileInfo.filePath
   * @param {string} [fileInfo.source] - file source content
   * @param {string[]} [fileInfo.imports] - explicit imports (auto-detected if source given)
   * @param {number} [fileInfo.modifications=0] - number of times modified
   * @param {boolean} [fileInfo.critical=false] - whether this is a critical file
   * @param {string} [fileInfo.category] - file category
   */
  addFile(fileInfo) {
    if (!fileInfo || !fileInfo.filePath) return;

    const key = normalizePath(fileInfo.filePath);

    // Store source
    if (fileInfo.source) {
      this._fileSources.set(key, fileInfo.source);
    }

    // Categorize the file
    const category = fileInfo.category || this._categorizeFile(fileInfo.filePath);
    this._categories.set(key, category);

    // Extract imports
    let imports = fileInfo.imports || [];
    if (fileInfo.source && imports.length === 0) {
      imports = this._extractImports(fileInfo.source);
    }
    this._importGraph.set(key, imports);

    // Build reverse import graph
    for (const imp of imports) {
      const impKey = normalizePath(imp);
      if (!this._reverseImportGraph.has(impKey)) {
        this._reverseImportGraph.set(impKey, []);
      }
      const rev = this._reverseImportGraph.get(impKey);
      if (!rev.includes(key)) {
        rev.push(key);
      }
    }

    // Track fan-out
    this._fanOut.set(key, imports.length);

    // Track modifications
    if (fileInfo.modifications) {
      this._modificationCount.set(key, fileInfo.modifications);
    }

    // Track critical files
    if (fileInfo.critical) {
      this._criticalFiles.push(key);
    }

    // Auto-detect test files
    if (isTestFile(fileInfo.filePath)) {
      // Map test file to potential source files
      const testBase = this._inferSourceFromTest(fileInfo.filePath);
      if (testBase) {
        if (!this._testMap.has(testBase)) {
          this._testMap.set(testBase, []);
        }
        const existing = this._testMap.get(testBase);
        if (!existing.includes(key)) {
          existing.push(key);
        }
      }
    }
  }

  /**
   * Register an explicit test-to-source mapping.
   * @param {string} sourceFile - the source file path
   * @param {string} testFile - the test file path
   */
  addTest(sourceFile, testFile) {
    const srcKey = normalizePath(sourceFile);
    const testKey = normalizePath(testFile);
    if (!this._testMap.has(srcKey)) {
      this._testMap.set(srcKey, []);
    }
    const existing = this._testMap.get(srcKey);
    if (!existing.includes(testKey)) {
      existing.push(testKey);
    }
  }

  // -----------------------------------------------------------------------
  // estimateImpact
  // -----------------------------------------------------------------------

  /**
   * Estimate the impact of a change to a specific file.
   *
   * @param {string} file - file being changed
   * @param {object} change
   * @param {"create"|"edit"|"delete"|"refactor"|"rename"|"unknown"} [change.operation="edit"] - type of change
   * @param {number} [change.lineCount=0] - number of lines changed
   * @param {boolean} [change.isBreaking=false] - whether the change is breaking
   * @param {string} [change.description=""] - human description of the change
   * @returns {{
   *   file: string,
   *   operation: string,
   *   riskLevel: string,
   *   riskScore: number,
   *   affectedFileCount: number,
   *   affectedFiles: string[],
   *   breakingRisk: boolean,
   *   factors: string[]
   * }}
   */
  estimateImpact(file, change) {
    const key = normalizePath(file);
    const operation = (change && change.operation) || "edit";
    const lineCount = (change && change.lineCount) || 0;
    const isBreaking = !!(change && change.isBreaking);
    const factors = [];
    let riskScore = 0;

    // Factor 1: Operation risk
    const operationRisk = {
      create: 5,
      edit: 10,
      refactor: 20,
      rename: 25,
      delete: 30,
      unknown: 15,
    };
    const opRisk = operationRisk[operation] || operationRisk.unknown;
    riskScore += opRisk;
    if (operation === "delete" || operation === "rename") {
      factors.push("destructive-operation");
    }
    if (operation === "refactor") {
      factors.push("structural-change");
    }

    // Factor 2: File category risk
    const category = this._categories.get(key) || "unknown";
    const categoryRisk = {
      core: 30,
      config: 25,
      util: 20,
      feature: 15,
      test: 2,
      docs: 2,
      unknown: 10,
    };
    const catRisk = categoryRisk[category] || categoryRisk.unknown;
    riskScore += catRisk;
    if (catRisk >= 20) {
      factors.push(`category-${category}`);
    }

    // Factor 3: Fan-out (number of consumers)
    const consumers = this._reverseImportGraph.get(key);
    const consumerCount = consumers ? consumers.length : 0;
    const fanOutRisk = Math.min(25, consumerCount * 3);
    riskScore += fanOutRisk;
    if (consumerCount >= 10) {
      factors.push("high-fanout");
    } else if (consumerCount >= 5) {
      factors.push("moderate-fanout");
    }

    // Factor 4: Modification history (frequently changed files are higher risk on further changes)
    const modCount = this._modificationCount.get(key) || 0;
    const modRisk = Math.min(15, modCount);
    riskScore += modRisk;
    if (modCount >= 10) {
      factors.push("frequently-modified");
    }

    // Factor 5: Breaking change flag
    if (isBreaking) {
      riskScore += 30;
      factors.push("breaking-change");
    }

    // Factor 6: Line count (larger changes = higher risk)
    const lineRisk = Math.min(15, Math.floor(lineCount / 10));
    riskScore += lineRisk;
    if (lineCount >= 100) {
      factors.push("large-change");
    } else if (lineCount >= 50) {
      factors.push("moderate-size-change");
    }

    // Factor 7: Critical file
    if (this._criticalFiles.includes(key)) {
      riskScore += 20;
      factors.push("critical-file");
    }

    // Factor 8: Deep dependency chain
    const depth = computeDepth(key, this._importGraph, this._opts.maxDepth);
    const depthRisk = Math.min(10, depth * 2);
    riskScore += depthRisk;
    if (depth >= 5) {
      factors.push("deep-dependencies");
    }

    // Factor 9: Configuration file changes are risky
    if (isConfigFile(file)) {
      riskScore += 15;
      factors.push("config-file");
    }

    // Clamp risk score to 0-100
    riskScore = Math.min(100, Math.max(0, Math.round(riskScore)));

    // Determine risk level
    let riskLevel = RiskLevel.LOW;
    if (riskScore >= 75) {
      riskLevel = RiskLevel.CRITICAL;
    } else if (riskScore >= 50) {
      riskLevel = RiskLevel.HIGH;
    } else if (riskScore >= 25) {
      riskLevel = RiskLevel.MEDIUM;
    }

    // Find affected files
    const affectedFiles = this._getAffectedFilesRecursive(key);

    return {
      file,
      operation,
      riskLevel,
      riskScore,
      affectedFileCount: affectedFiles.length,
      affectedFiles: affectedFiles.slice(0, this._opts.maxAffectedFiles),
      breakingRisk: isBreaking || consumerCount >= 5,
      factors,
    };
  }

  // -----------------------------------------------------------------------
  // getAffectedFiles
  // -----------------------------------------------------------------------

  /**
   * Find all files that could be affected by a change to the given file.
   *
   * Traces the dependency graph forward (files that import this file)
   * and backward (files this file imports).
   *
   * @param {string} filePath
   * @returns {{ direct: string[], transitive: string[], total: number }}
   */
  getAffectedFiles(filePath) {
    const key = normalizePath(filePath);
    const direct = [];
    const transitive = [];

    // Direct consumers (files that directly import this file)
    const consumers = this._reverseImportGraph.get(key);
    if (consumers) {
      for (const c of consumers) {
        direct.push(c);
      }
    }

    // Transitive consumers (files that import the direct consumers)
    const visited = new Set(direct);
    visited.add(key);
    const queue = [...direct];

    while (queue.length > 0 && transitive.length < this._opts.maxAffectedFiles) {
      const current = queue.shift();
      const currentConsumers = this._reverseImportGraph.get(current);
      if (currentConsumers) {
        for (const c of currentConsumers) {
          if (!visited.has(c)) {
            visited.add(c);
            transitive.push(c);
            queue.push(c);
          }
        }
      }
    }

    return {
      direct,
      transitive,
      total: direct.length + transitive.length,
    };
  }

  // -----------------------------------------------------------------------
  // getRiskLevel
  // -----------------------------------------------------------------------

  /**
   * Get the risk level for a proposed change.
   *
   * @param {object} change
   * @param {string} change.file
   * @param {"create"|"edit"|"delete"|"refactor"|"rename"|"unknown"} [change.operation="edit"]
   * @param {number} [change.lineCount=0]
   * @param {boolean} [change.isBreaking=false]
   * @param {string} [change.description=""]
   * @returns {{ level: "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", score: number, factors: string[] }}
   */
  getRiskLevel(change) {
    if (!change || !change.file) {
      return { level: RiskLevel.LOW, score: 0, factors: ["no-file"] };
    }

    const impact = this.estimateImpact(change.file, change);
    return {
      level: impact.riskLevel,
      score: impact.riskScore,
      factors: impact.factors,
    };
  }

  // -----------------------------------------------------------------------
  // suggestTests
  // -----------------------------------------------------------------------

  /**
   * Suggest test files that should be run based on the changed file.
   *
   * Matches based on:
   *  - Direct test-to-source mappings
   *  - Naming conventions (src/foo.js -> test/foo.test.js)
   *  - Transitive consumers' test files
   *
   * @param {string} filePath - the file that was changed
   * @returns {Array<{file: string, reason: string, priority: "must-run"|"should-run"|"consider"}>}
   */
  suggestTests(filePath) {
    const key = normalizePath(filePath);
    const suggestions = [];

    // Direct test mapping
    const directTests = this._testMap.get(key);
    if (directTests) {
      for (const test of directTests) {
        suggestions.push({ file: test, reason: "direct-test", priority: "must-run" });
      }
    }

    // Convention-based test detection
    const conventionTests = this._findTestsByConvention(filePath);
    for (const test of conventionTests) {
      const already = suggestions.find((s) => s.file === test);
      if (!already) {
        suggestions.push({ file: test, reason: "naming-convention", priority: "should-run" });
      }
    }

    // Consumers' tests (files that import this file)
    const consumers = this._reverseImportGraph.get(key);
    if (consumers) {
      for (const consumer of consumers) {
        const consumerTests = this._testMap.get(consumer);
        if (consumerTests) {
          for (const test of consumerTests) {
            const already = suggestions.find((s) => s.file === test);
            if (!already) {
              suggestions.push({ file: test, reason: `consumer-${consumer}`, priority: "should-run" });
            }
          }
        }
      }
    }

    // Transitive consumers' tests (one level deeper)
    const affected = this._getAffectedFilesRecursive(key);
    for (const file of affected) {
      const fileTests = this._testMap.get(file);
      if (fileTests) {
        for (const test of fileTests) {
          const already = suggestions.find((s) => s.file === test);
          if (!already) {
            suggestions.push({ file: test, reason: `transitive-${file}`, priority: "consider" });
          }
        }
      }
    }

    return suggestions;
  }

  // -----------------------------------------------------------------------
  // getRollbackDifficulty
  // -----------------------------------------------------------------------

  /**
   * Estimate how difficult it would be to rollback/undo a change.
   *
   * Factors:
   *  - Operation type (delete is hardest)
   *  - Number of affected files
   *  - Whether the change is structural (refactor/rename)
   *  - Configuration or database changes
   *
   * @param {object} change
   * @param {string} change.file
   * @param {"create"|"edit"|"delete"|"refactor"|"rename"|"unknown"} [change.operation]
   * @param {number} [change.lineCount=0]
   * @param {boolean} [change.isBreaking=false]
   * @returns {{ difficulty: "trivial"|"easy"|"moderate"|"hard"|"very-hard", score: number, factors: string[], recommendation: string }}
   */
  getRollbackDifficulty(change) {
    if (!change || !change.file) {
      return {
        difficulty: "trivial",
        score: 0,
        factors: ["no-change"],
        recommendation: "No rollback needed.",
      };
    }

    const key = normalizePath(change.file);
    const operation = change.operation || "edit";
    const factors = [];
    let score = 0;

    // Operation difficulty
    const opDifficulty = {
      create: 2,   // easy: just delete the file
      edit: 5,     // moderate: revert to previous version
      refactor: 15, // hard: may span many files
      rename: 10,  // moderate-hard: need to rename back
      delete: 20,  // very hard: need to recover content
      unknown: 5,
    };
    const opScore = opDifficulty[operation] || opDifficulty.unknown;
    score += opScore;

    if (operation === "delete") {
      factors.push("delete-operation");
    }
    if (operation === "refactor") {
      factors.push("refactor-operation");
    }

    // Affected files count
    const affected = this._getAffectedFilesRecursive(key);
    const affectedScore = Math.min(20, affected.length * 2);
    score += affectedScore;
    if (affected.length >= 10) {
      factors.push("wide-impact");
    } else if (affected.length >= 5) {
      factors.push("moderate-impact");
    }

    // Line count (more lines = harder to revert)
    const lineCount = change.lineCount || 0;
    const lineScore = Math.min(15, Math.floor(lineCount / 20));
    score += lineScore;
    if (lineCount >= 200) {
      factors.push("very-large-change");
    } else if (lineCount >= 100) {
      factors.push("large-change");
    }

    // Breaking changes are harder to rollback
    if (change.isBreaking) {
      score += 15;
      factors.push("breaking-change");
    }

    // Config files require extra care
    if (isConfigFile(change.file)) {
      score += 10;
      factors.push("config-file");
    }

    // Critical files
    if (this._criticalFiles.includes(key)) {
      score += 10;
      factors.push("critical-file");
    }

    // Frequently modified files may have complex state
    const modCount = this._modificationCount.get(key) || 0;
    if (modCount >= 10) {
      score += 5;
      factors.push("highly-modified");
    }

    // Clamp
    score = Math.min(100, Math.max(0, Math.round(score)));

    // Map to difficulty level
    let difficulty;
    let recommendation;
    if (score >= 60) {
      difficulty = "very-hard";
      recommendation = "Create a full backup before proceeding. Consider a phased rollout with feature flags.";
    } else if (score >= 40) {
      difficulty = "hard";
      recommendation = "Ensure a revert commit is prepared. Run full test suite before and after.";
    } else if (score >= 20) {
      difficulty = "moderate";
      recommendation = "Standard git revert should suffice. Run affected tests to validate.";
    } else if (score >= 10) {
      difficulty = "easy";
      recommendation = "A simple git checkout or undo will restore the previous state.";
    } else {
      difficulty = "trivial";
      recommendation = "The change is minimal and can be undone trivially.";
    }

    return { difficulty, score, factors, recommendation };
  }

  // -----------------------------------------------------------------------
  // clear
  // -----------------------------------------------------------------------

  /** Clear all data. */
  clear() {
    this._importGraph.clear();
    this._reverseImportGraph.clear();
    this._fanOut.clear();
    this._categories.clear();
    this._fileSources.clear();
    this._testMap.clear();
    this._modificationCount.clear();
    this._criticalFiles = [];
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * Extract imports from source code.
   * @param {string} source
   * @returns {string[]}
   */
  _extractImports(source) {
    if (!source) return [];
    const imports = new Set();

    const cjsPattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = cjsPattern.exec(source)) !== null) {
      imports.add(match[1]);
    }

    const esmPattern = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    while ((match = esmPattern.exec(source)) !== null) {
      imports.add(match[1]);
    }

    const dynamicPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicPattern.exec(source)) !== null) {
      imports.add(match[1]);
    }

    return [...imports];
  }

  /**
   * Categorize a file based on its path.
   * @param {string} filePath
   * @returns {string}
   */
  _categorizeFile(filePath) {
    const lower = filePath.toLowerCase();

    if (isTestFile(filePath)) return "test";

    if (lower.includes("/core/") || lower.includes("/engine/") ||
        lower.includes("/kernel/") || lower.includes("/foundation/")) {
      return "core";
    }

    if (lower.includes("/config/") || lower.includes("/settings/") ||
        isConfigFile(filePath)) {
      return "config";
    }

    if (lower.includes("/util/") || lower.includes("/utils/") ||
        lower.includes("/helpers/") || lower.includes("/shared/") ||
        lower.includes("/common/")) {
      return "util";
    }

    if (lower.includes("/docs/") || lower.includes("/doc/") ||
        lower.endsWith(".md")) {
      return "docs";
    }

    if (lower.includes("/components/") || lower.includes("/pages/") ||
        lower.includes("/views/") || lower.includes("/modules/") ||
        lower.includes("/features/")) {
      return "feature";
    }

    return "unknown";
  }

  /**
   * Recursively find all files affected by a change.
   * @param {string} key
   * @returns {string[]}
   */
  _getAffectedFilesRecursive(key) {
    const affected = [];
    const visited = new Set();
    visited.add(key);

    // Direct consumers
    const direct = this._reverseImportGraph.get(key) || [];
    const queue = [...direct];

    while (queue.length > 0 && affected.length < this._opts.maxAffectedFiles) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      affected.push(current);

      const next = this._reverseImportGraph.get(current);
      if (next) {
        for (const n of next) {
          if (!visited.has(n)) {
            queue.push(n);
          }
        }
      }
    }

    return affected;
  }

  /**
   * Infer source file path from test file path using common conventions.
   * @param {string} testPath
   * @returns {string|null}
   */
  _inferSourceFromTest(testPath) {
    const lower = normalizePath(testPath);

    // src/foo.test.js -> src/foo.js
    let src = lower
      .replace(/\.test\./, ".")
      .replace(/\.spec\./, ".");

    // test/foo.js -> src/foo.js
    src = src.replace(/\/tests?\//, "/src/");
    src = src.replace(/\/__tests__\//, "/src/");

    return src !== lower ? src : null;
  }

  /**
   * Find test files by naming convention.
   * @param {string} filePath
   * @returns {string[]}
   */
  _findTestsByConvention(filePath) {
    const key = normalizePath(filePath);
    const base = key.replace(/\.[^./]+$/, ""); // strip extension

    const candidates = [
      `${base}.test.js`,
      `${base}.test.ts`,
      `${base}.spec.js`,
      `${base}.spec.ts`,
    ];

    // Build variations for common directory patterns
    const parts = base.split("/");
    if (parts.length > 1) {
      const fileName = parts[parts.length - 1];
      // src/foo -> test/foo.test.js
      const testDirBase = [...parts.slice(0, -1)
        .map((d) => d.replace(/^src$/, "test"))
        .join("/"), fileName].join("/");

      candidates.push(`${testDirBase}.test.js`);
      candidates.push(`${testDirBase}.spec.js`);

      // Also check __tests__ convention
      const parentDir = parts.slice(0, -1).join("/");
      candidates.push(`${parentDir}/__tests__/${fileName}.test.js`);
      candidates.push(`${parentDir}/__tests__/${fileName}.spec.js`);
    }

    // Return only candidates that match registered files
    const allTests = new Set();
    for (const [src, tests] of this._testMap) {
      for (const t of tests) allTests.add(t);
    }

    return candidates.filter((c) => allTests.has(c));
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ChangeImpact,
  RiskLevel,
  // Helpers exported for testing.
  _internals: {
    normalizePath,
    isTestFile,
    isConfigFile,
    computeDepth,
  },
};
