"use strict";

/**
 * CodeHealthScorer — quantitative code health scoring system.
 *
 * Scores files, directories, and entire projects on a 0-100 scale across
 * eight weighted categories: complexity, duplication, documentation,
 * testCoverage, errorHandling, naming, structure, and security.
 *
 * Each category produces a sub-score, a list of detected issues, and
 * suggested improvements. The aggregate score is a weighted average.
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Default category definitions
// ---------------------------------------------------------------------------

const DEFAULT_CATEGORIES = {
  complexity: {
    label: "Complexity",
    weight: 0.18,
    description: "Cyclomatic and cognitive complexity of code",
  },
  duplication: {
    label: "Duplication",
    weight: 0.14,
    description: "Copy-pasted or repeated code blocks",
  },
  documentation: {
    label: "Documentation",
    weight: 0.12,
    description: "JSDoc comments, inline docs, and README coverage",
  },
  testCoverage: {
    label: "Test Coverage",
    weight: 0.15,
    description: "Presence and quality of tests",
  },
  errorHandling: {
    label: "Error Handling",
    weight: 0.14,
    description: "Try/catch blocks, error propagation, input validation",
  },
  naming: {
    label: "Naming",
    weight: 0.10,
    description: "Clear, consistent variable and function naming",
  },
  structure: {
    label: "Structure",
    weight: 0.10,
    description: "Module organization, file size, import hygiene",
  },
  security: {
    label: "Security",
    weight: 0.07,
    description: "Secrets exposure, unsafe patterns, injection risks",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count occurrences of a regex pattern in a string.
 */
function countMatches(str, pattern) {
  const matches = str.match(pattern);
  return matches ? matches.length : 0;
}

/**
 * Check if a file path looks like a test file.
 */
function isTestFile(filePath) {
  const name = path.basename(filePath);
  return (
    filePath.includes("/test/") ||
    filePath.includes("\\test\\") ||
    /\.(test|spec)\.[jt]sx?$/.test(name) ||
    name.endsWith(".test.js") ||
    name.endsWith(".spec.js")
  );
}

/**
 * Check if a file looks like a config / non-source file.
 */
function isConfigOrGenerated(filePath) {
  const ext = path.extname(filePath);
  const name = path.basename(filePath);
  return (
    ext === ".json" ||
    ext === ".lock" ||
    ext === ".min.js" ||
    name.startsWith(".") ||
    filePath.includes("node_modules") ||
    filePath.includes("dist") ||
    filePath.includes("build") ||
    filePath.includes("coverage") ||
    filePath.includes(".git")
  );
}

/**
 * Walk a directory recursively, yielding file paths.
 */
function* walkDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      yield* walkDir(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

// ---------------------------------------------------------------------------
// Per-category scorers
// ---------------------------------------------------------------------------

/**
 * Score complexity: lower is better.
 * Penalizes long lines, deep nesting indicators, many branches.
 */
function scoreComplexity(content) {
  const lines = content.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const totalLines = nonEmpty.length;

  if (totalLines === 0) return { score: 100, issues: [], suggestions: [] };

  const issues = [];
  const suggestions = [];

  // Long file penalty.
  if (totalLines > 300) {
    issues.push({ type: "LONG_FILE", message: `File is ${totalLines} lines long`, severity: "medium" });
    suggestions.push("Split file into smaller modules (target < 300 lines)");
  }

  // Long line penalty.
  const longLines = nonEmpty.filter((l) => l.length > 120);
  if (longLines.length > 0) {
    issues.push({ type: "LONG_LINES", message: `${longLines.length} lines exceed 120 characters`, severity: "low" });
    suggestions.push("Refactor long lines for readability");
  }

  // Branch count (if/else/switch/case/for/while/?/: ) — rough cyclomatic proxy.
  const branchCount =
    countMatches(content, /\bif\b/g) +
    countMatches(content, /\belse\b/g) +
    countMatches(content, /\bcase\b/g) +
    countMatches(content, /\bfor\b/g) +
    countMatches(content, /\bwhile\b/g) +
    countMatches(content, /\bswitch\b/g) +
    countMatches(content, /\?\s*[^:]*:/g) +
    countMatches(content, /\bcatch\b/g);

  const branchDensity = branchCount / Math.max(totalLines, 1);

  if (branchDensity > 0.3) {
    issues.push({ type: "HIGH_BRANCH_DENSITY", message: `High branch density (${(branchDensity * 100).toFixed(0)}%)`, severity: "high" });
    suggestions.push("Reduce conditional complexity by extracting helper functions or using lookup tables");
  } else if (branchDensity > 0.2) {
    issues.push({ type: "MODERATE_BRANCH_DENSITY", message: `Moderate branch density (${(branchDensity * 100).toFixed(0)}%)`, severity: "medium" });
    suggestions.push("Consider simplifying conditional logic");
  }

  // Nesting indicator: count leading whitespace depth as proxy.
  let maxIndent = 0;
  for (const line of nonEmpty) {
    const depth = (line.match(/^(\s*)/) || [""])[0].length;
    if (depth > maxIndent) maxIndent = depth;
  }
  const indentDepth = Math.round(maxIndent / 2); // assume 2-space indent
  if (indentDepth > 5) {
    issues.push({ type: "DEEP_NESTING", message: `Max nesting depth ~${indentDepth} levels`, severity: "high" });
    suggestions.push("Flatten deep nesting by extracting inner logic into separate functions");
  }

  // Score: start at 100, deduct per issue.
  let score = 100;
  score -= Math.min(30, totalLines > 600 ? 30 : Math.max(0, (totalLines - 300) * 0.1));
  score -= Math.min(15, longLines.length * 2);
  score -= Math.min(25, branchDensity > 0.3 ? 25 : branchDensity > 0.2 ? 15 : 0);
  score -= Math.min(10, indentDepth > 5 ? 10 : indentDepth > 3 ? 5 : 0);

  return { score: Math.max(0, Math.round(score)), issues, suggestions };
}

/**
 * Score duplication: detect repeated patterns.
 */
function scoreDuplication(content) {
  const lines = content.split("\n").map((l) => l.trim());
  const nonEmpty = lines.filter((l) => l.length > 0);
  const issues = [];
  const suggestions = [];

  if (nonEmpty.length < 10) return { score: 100, issues, suggestions };

  // Find exact duplicate lines (beyond minimal threshold).
  const lineFreq = new Map();
  for (const l of nonEmpty) {
    if (l.length > 3) {
      lineFreq.set(l, (lineFreq.get(l) || 0) + 1);
    }
  }
  let duplicateLineCount = 0;
  for (const count of lineFreq.values()) {
    if (count > 2) duplicateLineCount += count;
  }

  // Find consecutive duplicate blocks (3+ identical consecutive lines).
  let consecutiveBlocks = 0;
  for (let i = 0; i < nonEmpty.length - 2; i++) {
    if (nonEmpty[i].length > 3 && nonEmpty[i] === nonEmpty[i + 1] && nonEmpty[i] === nonEmpty[i + 2]) {
      consecutiveBlocks++;
    }
  }

  if (duplicateLineCount > 5 || consecutiveBlocks > 0) {
    issues.push({
      type: "DUPLICATE_CODE",
      message: `${duplicateLineCount} duplicate lines, ${consecutiveBlocks} consecutive-duplicate blocks`,
      severity: duplicateLineCount > 20 ? "high" : "medium",
    });
    suggestions.push("Extract repeated code into shared functions or constants");
  }

  let score = 100;
  score -= Math.min(20, duplicateLineCount * 2);
  score -= Math.min(20, consecutiveBlocks * 5);

  return { score: Math.max(0, Math.round(score)), issues, suggestions };
}

/**
 * Score documentation: JSDoc, inline comments, README.
 */
function scoreDocumentation(content, filePath) {
  const lines = content.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const issues = [];
  const suggestions = [];

  if (nonEmpty.length === 0) return { score: 100, issues, suggestions };

  // Comment presence.
  const jsDocCount = countMatches(content, /\/\*\*[\s\S]*?\*\//g);
  const singleComments = countMatches(content, /\/\/.*$/gm);
  const blockComments = countMatches(content, /\/\*[\s\S]*?\*\//g) - jsDocCount;

  const totalComments = jsDocCount + singleComments + blockComments;
  const commentRatio = totalComments / Math.max(nonEmpty.length, 1);

  // Function count and JSDoc coverage.
  const fnCount = countMatches(content, /\bfunction\b/g) + countMatches(content, /=>/g);
  const docCoverage = fnCount > 0 ? jsDocCount / fnCount : 1;

  if (commentRatio < 0.05) {
    issues.push({ type: "LOW_COMMENT_DENSITY", message: `Comment ratio is ${(commentRatio * 100).toFixed(0)}%`, severity: "medium" });
    suggestions.push("Add explanatory comments for complex logic sections");
  }

  if (fnCount > 3 && docCoverage < 0.3) {
    issues.push({
      type: "LOW_JSDOC_COVERAGE",
      message: `Only ${jsDocCount} of ~${fnCount} functions have JSDoc comments`,
      severity: "medium",
    });
    suggestions.push("Add JSDoc comments to public functions");
  }

  // File header comment check.
  if (!content.match(/^[\s\n]*\/\*\*?/)) {
    issues.push({ type: "MISSING_FILE_HEADER", message: "File missing a header comment", severity: "low" });
    suggestions.push("Add a file-level JSDoc comment describing the module's purpose");
  }

  let score = 100;
  score -= Math.min(25, commentRatio < 0.05 ? 25 : commentRatio < 0.1 ? 15 : 0);
  score -= Math.min(25, fnCount > 3 && docCoverage < 0.3 ? 25 : docCoverage < 0.6 ? 10 : 0);
  score -= 5 * (issues.filter((i) => i.type === "MISSING_FILE_HEADER").length);

  return { score: Math.max(0, Math.round(score)), issues, suggestions };
}

/**
 * Score test coverage: check for corresponding test files.
 */
function scoreTestCoverage(content, filePath) {
  const issues = [];
  const suggestions = [];

  if (isTestFile(filePath)) return { score: 100, issues, suggestions };

  // Attempt to find a corresponding test file.
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);

  const possibleTestPaths = [
    path.join(dir, `${base}.test${ext}`),
    path.join(dir, `${base}.spec${ext}`),
    path.join(dir, "__tests__", `${base}${ext}`),
    path.resolve(path.join(dir, "..", "test", `${base}.test${ext}`)),
    path.resolve(path.join(dir, "..", "tests", `${base}.test${ext}`)),
  ];

  // Also try replacing /src/ with /test/ in the path.
  const normPath = filePath.replace(/\\/g, "/");
  if (normPath.includes("/src/")) {
    const testDir = normPath
      .replace("/src/", "/test/")
      .replace(new RegExp(`${ext.replace(".", "\\.")}$`), `.test${ext}`);
    possibleTestPaths.push(testDir);
  }

  let testExists = false;
  for (const tp of possibleTestPaths) {
    try {
      if (fs.existsSync(tp)) {
        testExists = true;
        break;
      }
    } catch {
      // Permission errors, etc.
    }
  }

  if (!testExists) {
    issues.push({ type: "NO_TESTS", message: "No corresponding test file found", severity: "medium" });
    suggestions.push(`Create a test file (e.g., ${base}.test${ext}) with meaningful test cases`);
  }

  // Check if the file contains test-like patterns (inline tests).
  const hasTestPatterns =
    /test\s*\(/.test(content) ||
    /\bit\s*\(/.test(content) ||
    /describe\s*\(/.test(content) ||
    /assert\./.test(content);

  const score = testExists ? 100 : hasTestPatterns ? 70 : 30;

  if (!testExists && !hasTestPatterns) {
    suggestions.push("Add unit tests for all public exports");
  }

  return { score, issues, suggestions };
}

/**
 * Score error handling: try/catch, input validation, error propagation.
 */
function scoreErrorHandling(content) {
  const issues = [];
  const suggestions = [];

  const lines = content.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);

  if (nonEmpty.length === 0) return { score: 100, issues, suggestions };

  const tryCount = countMatches(content, /\btry\b/g);
  const catchCount = countMatches(content, /\bcatch\b/g);
  const throwCount = countMatches(content, /\bthrow\s+(new\s+)?\w+/g);
  const fnCount = countMatches(content, /\bfunction\b/g) + countMatches(content, /=>/g);

  // Count .catch() promise chains.
  const promiseCatch = countMatches(content, /\.catch\s*\(/g);

  // Check for bare throw without context.
  const bareThrows = countMatches(content, /\bthrow\s+(?!new)/g);

  // Count input validation patterns.
  const validationPatterns = countMatches(content, /\bif\s*\(\s*!\s*\w+\s*\)/g) +
    countMatches(content, /\btypeof\s+\w+\s*[!=]==?\s*['"]/g) +
    countMatches(content, /\bthrow\s+new\s+TypeError/g) +
    countMatches(content, /\bthrow\s+new\s+Error/g) +
    countMatches(content, /^\s*if\s*\(\s*!\s*Array\.isArray/gm);

  // Error handling ratio.
  const errorHandlingCount = tryCount + catchCount + throwCount + promiseCatch + validationPatterns;
  const errorRatio = fnCount > 0 ? errorHandlingCount / fnCount : 1;

  if (fnCount > 2 && errorRatio < 0.5) {
    issues.push({
      type: "LOW_ERROR_HANDLING",
      message: `Low error handling ratio (${(errorRatio * 100).toFixed(0)}% of functions)`,
      severity: "high",
    });
    suggestions.push("Add try/catch blocks around risky operations (file I/O, network, parsing)");
  }

  if (fnCount > 5 && tryCount < Math.floor(fnCount * 0.3)) {
    issues.push({
      type: "FEW_TRY_CATCH",
      message: `Only ${tryCount} try blocks for ${fnCount} function boundaries`,
      severity: "medium",
    });
    suggestions.push("Wrap async operations and JSON.parse calls in try/catch");
  }

  if (bareThrows > 0 && throwCount > 0) {
    issues.push({
      type: "BARE_THROW",
      message: `${bareThrows} bare throw statement(s) without new Error()`,
      severity: "low",
    });
    suggestions.push("Always throw Error instances with descriptive messages");
  }

  let score = 100;
  score -= Math.min(30, fnCount > 2 && errorRatio < 0.5 ? 30 : errorRatio < 0.8 ? 15 : 0);
  score -= Math.min(15, fnCount > 5 && tryCount < Math.floor(fnCount * 0.3) ? 15 : 0);
  score -= Math.min(10, bareThrows > 0 ? 10 : 0);

  return { score: Math.max(0, Math.round(score)), issues, suggestions };
}

/**
 * Score naming: consistent, clear identifiers.
 */
function scoreNaming(content) {
  const issues = [];
  const suggestions = [];

  const lines = content.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);

  if (nonEmpty.length === 0) return { score: 100, issues, suggestions };

  // Detect single-letter variable names (except i, j, k loops).
  const singleLetterVars = countMatches(content, /\b(?:const|let|var)\s+([a-ln-z])\s*[=;]/g);
  const singleLetterFuncParams = countMatches(content, /\(\s*([a-ln-z])\s*[,)]/g);

  // Detect very short names (< 3 chars, not common abbreviations).
  const shortNames = countMatches(content, /\b(?:const|let|var)\s+(\w{1,2})\s*[=;]/g);

  // Detect inconsistent case: snake_case mixed with camelCase.
  const camelCount = countMatches(content, /\bconst\s+[a-z]+[A-Z]/g);
  const snakeCount = countMatches(content, /\bconst\s+[a-z]+_[a-z]/g);

  // Detect unclear names: data, item, obj, tmp, temp, result.
  const unclearNames = countMatches(content, /\b(?:let|const|var)\s+(?:data|item|obj|tmp|temp|val|res|buf|ret)\b/g);

  const totalNameIssues = singleLetterVars + singleLetterFuncParams + shortNames + unclearNames + Math.abs(camelCount - snakeCount);

  if (singleLetterVars + singleLetterFuncParams > 3) {
    issues.push({
      type: "SINGLE_LETTER_NAMES",
      message: `${singleLetterVars + singleLetterFuncParams} single-letter identifier(s)`,
      severity: "low",
    });
    suggestions.push("Use descriptive names for variables and parameters (except loop indices)");
  }

  if (unclearNames > 3) {
    issues.push({
      type: "UNCLEAR_NAMES",
      message: `${unclearNames} unclear variable name(s) like 'data', 'item', 'tmp'`,
      severity: "low",
    });
    suggestions.push("Replace generic names with domain-specific alternatives");
  }

  if (camelCount > 0 && snakeCount > 0) {
    issues.push({
      type: "MIXED_CASE",
      message: "Mixed camelCase and snake_case naming conventions",
      severity: "low",
    });
    suggestions.push("Use a consistent naming convention throughout the file");
  }

  let score = 100;
  score -= Math.min(20, totalNameIssues * 2);
  score -= Math.min(10, (camelCount > 0 && snakeCount > 0) ? 10 : 0);

  return { score: Math.max(0, Math.round(score)), issues, suggestions };
}

/**
 * Score structure: module organization, file size, imports.
 */
function scoreStructure(content, filePath) {
  const issues = [];
  const suggestions = [];

  const lines = content.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);

  if (nonEmpty.length === 0) return { score: 100, issues, suggestions };

  // File size check.
  if (nonEmpty.length > 500) {
    issues.push({
      type: "LARGE_FILE",
      message: `File is ${nonEmpty.length} lines — consider splitting`,
      severity: "medium",
    });
    suggestions.push("Split file into focused modules (target < 500 lines per file)");
  }

  // Import hygiene: count require/import lines.
  const requireCount = countMatches(content, /\brequire\s*\(/g);
  const importCount = countMatches(content, /\bimport\b/g);

  // Function and class count per file.
  const fnCount = countMatches(content, /\bfunction\s+\w+/g);
  const classCount = countMatches(content, /\bclass\s+\w+/g);
  const exportsCount = countMatches(content, /module\.exports\b/g) || countMatches(content, /\bexports\.\w+/g);

  if (fnCount + classCount > 10) {
    issues.push({
      type: "TOO_MANY_DEFINITIONS",
      message: `${fnCount + classCount} functions/classes in one file`,
      severity: "medium",
    });
    suggestions.push("Extract groups of related functions into separate modules");
  }

  // Check for circular import risk: high imports + exports.
  if (requireCount + importCount > 15) {
    issues.push({
      type: "MANY_IMPORTS",
      message: `${requireCount + importCount} imports — potential for circular dependencies`,
      severity: "low",
    });
    suggestions.push("Review imports for unused dependencies and consider dependency inversion");
  }

  // Module has clear export boundary.
  if (exportsCount === 0 && nonEmpty.length > 20) {
    issues.push({
      type: "NO_EXPORTS",
      message: "File has no clear module exports",
      severity: "low",
    });
    suggestions.push("Define clear module boundary with module.exports or export statements");
  }

  let score = 100;
  score -= Math.min(20, nonEmpty.length > 500 ? 20 : nonEmpty.length > 300 ? 10 : 0);
  score -= Math.min(15, fnCount + classCount > 10 ? 15 : fnCount + classCount > 6 ? 8 : 0);
  score -= Math.min(10, requireCount + importCount > 15 ? 10 : 0);

  return { score: Math.max(0, Math.round(score)), issues, suggestions };
}

/**
 * Score security: secrets, unsafe eval, injection risks.
 */
function scoreSecurity(content) {
  const issues = [];
  const suggestions = [];

  const lines = content.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);

  if (nonEmpty.length === 0) return { score: 100, issues, suggestions };

  // Dangerous API usage.
  const evalCount = countMatches(content, /\beval\s*\(/g);
  const execCount = countMatches(content, /\bexec\s*\(/g);

  // Secret patterns.
  const secretPatterns = [
    /api[_-]?key\s*[:=]\s*['"][\w-]{20,}/gi,
    /secret\s*[:=]\s*['"][\w-]{10,}/gi,
    /password\s*[:=]\s*['"][\w-]{4,}/gi,
    /token\s*[:=]\s*['"][\w-]{15,}/gi,
    /\bghp_\w{30,}/g,       // GitHub personal token
    /\bsk-[a-zA-Z0-9]{20,}/g, // OpenAI / stripe keys
    /\bAKIA[0-9A-Z]{16}\b/g,  // AWS access key
  ];

  let secretCount = 0;
  for (const pattern of secretPatterns) {
    secretCount += countMatches(content, pattern);
  }

  // Dangerous patterns.
  if (evalCount > 0) {
    issues.push({
      type: "EVAL_USAGE",
      message: `${evalCount} eval() call(s) — potential code injection risk`,
      severity: "high",
    });
    suggestions.push("Replace eval() with safer alternatives (JSON.parse, Function constructor with precautions)");
  }

  if (execCount > 0) {
    issues.push({
      type: "EXEC_USAGE",
      message: `${execCount} exec() call(s) — arbitrary code execution risk`,
      severity: "high",
    });
    suggestions.push("Avoid child_process.exec() with user-supplied input; use execFile() instead");
  }

  if (secretCount > 0) {
    issues.push({
      type: "HARDCODED_SECRETS",
      message: `${secretCount} potential hardcoded secret(s) or credential(s) detected`,
      severity: "high",
    });
    suggestions.push("Move secrets to environment variables or a secure vault; never commit secrets to version control");
  }

  // Detect shell injection patterns.
  const shellInjectionPatterns = [
    /\bexec\s*\(\s*['"`][^'"]*\$/,
    /\bspawn\s*\(\s*['"`][^'"]*\$/,
    /child_process\s*\.\s*exec/,
  ];

  let shellInjectionCount = 0;
  for (const pattern of shellInjectionPatterns) {
    shellInjectionCount += countMatches(content, pattern);
  }
  if (shellInjectionCount > 0) {
    issues.push({
      type: "SHELL_INJECTION_RISK",
      message: `${shellInjectionCount} potential shell injection pattern(s) detected`,
      severity: "high",
    });
    suggestions.push("Sanitize all user inputs passed to shell commands; use execFile with argument arrays");
  }

  let score = 100;
  score -= Math.min(25, evalCount > 0 ? 25 : 0);
  score -= Math.min(25, execCount > 0 ? 25 : 0);
  score -= Math.min(25, secretCount * 15);
  score -= Math.min(15, shellInjectionCount * 10);

  return { score: Math.max(0, Math.round(score)), issues, suggestions };
}

// ---------------------------------------------------------------------------
// CodeHealthScorer
// ---------------------------------------------------------------------------

class CodeHealthScorer {
  /**
   * @param {object} [options]
   * @param {object} [options.categories] - override default category weights
   * @param {boolean} [options.includeConfigFiles] - score config files too (default false)
   */
  constructor(options = {}) {
    this._options = options;
    this._categories = options.categories || DEFAULT_CATEGORIES;
    this._lastBreakdown = null;
    this._scoredFiles = [];
  }

  /**
   * Score a single file. Returns a score from 0-100 and detailed breakdown.
   *
   * @param {string} content - source code content
   * @param {string} filePath - file path (used for test detection and reporting)
   * @returns {{ score: number, filePath: string, categories: object, summary: string }}
   */
  scoreFile(content, filePath) {
    if (typeof content !== "string") {
      throw new TypeError("content must be a string");
    }
    if (typeof filePath !== "string") {
      throw new TypeError("filePath must be a string");
    }

    // Skip non-source files unless explicitly included.
    if (isConfigOrGenerated(filePath) && !this._options.includeConfigFiles) {
      return {
        score: null,
        filePath,
        categories: {},
        summary: "Skipped (config/generated file)",
        skipped: true,
      };
    }

    const catResults = {};
    const catDefs = Object.entries(this._categories);
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const [key, def] of catDefs) {
      let result;
      switch (key) {
        case "complexity":
          result = scoreComplexity(content);
          break;
        case "duplication":
          result = scoreDuplication(content);
          break;
        case "documentation":
          result = scoreDocumentation(content, filePath);
          break;
        case "testCoverage":
          result = scoreTestCoverage(content, filePath);
          break;
        case "errorHandling":
          result = scoreErrorHandling(content);
          break;
        case "naming":
          result = scoreNaming(content);
          break;
        case "structure":
          result = scoreStructure(content, filePath);
          break;
        case "security":
          result = scoreSecurity(content);
          break;
        default:
          result = { score: 100, issues: [], suggestions: [] };
      }

      catResults[key] = {
        label: def.label,
        weight: def.weight,
        ...result,
      };

      totalWeightedScore += result.score * def.weight;
      totalWeight += def.weight;
    }

    const overallScore = totalWeight > 0
      ? Math.round(totalWeightedScore / totalWeight)
      : 100;

    const allIssues = [];
    for (const [key, cat] of Object.entries(catResults)) {
      for (const issue of cat.issues) {
        allIssues.push({ category: key, ...issue });
      }
    }

    const grade = this._gradeFromScore(overallScore);

    const breakdown = {
      score: overallScore,
      grade,
      filePath,
      categories: catResults,
      totalIssues: allIssues.length,
      summary: allIssues.length === 0
        ? `Score ${overallScore}/100 (${grade}). No issues detected.`
        : `Score ${overallScore}/100 (${grade}). ${allIssues.length} issue(s) across ${this._categoriesWithIssues(catResults)} categories.`,
    };

    this._scoredFiles.push(breakdown);
    this._lastBreakdown = breakdown;
    return breakdown;
  }

  /**
   * Score an entire directory by scoring all source files and averaging.
   *
   * @param {string} root - directory path
   * @returns {{ score: number, grade: string, fileCount: number, scoredCount: number, skippedCount: number, fileScores: Array, categories: object, summary: string }}
   */
  scoreDirectory(root) {
    if (!fs.existsSync(root)) {
      throw new Error(`Directory not found: ${root}`);
    }

    const stat = fs.statSync(root);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${root}`);
    }

    const fileScores = [];
    let skippedCount = 0;

    for (const filePath of walkDir(root)) {
      let content;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        skippedCount++;
        continue;
      }

      const result = this.scoreFile(content, filePath);
      if (result.skipped) {
        skippedCount++;
        continue;
      }

      fileScores.push(result);
    }

    return this._aggregateScores(fileScores, root, skippedCount, "directory");
  }

  /**
   * Score the entire project. Scans the project root for all source files,
   * computes aggregate scores per category, and returns an overall project health report.
   *
   * @param {string} root - project root directory (defaults to process.cwd())
   * @returns {{ score: number, grade: string, fileCount: number, scoredCount: number, skippedCount: number, fileScores: Array, categories: object, summary: string }}
   */
  scoreProject(root) {
    const projectRoot = root || process.cwd();
    return this.scoreDirectory(projectRoot);
  }

  /**
   * Get the breakdown of the most recent scoreFile/scoreDirectory/scoreProject call.
   *
   * @returns {object|null} the last breakdown, or null if no scoring has been done
   */
  getBreakdown() {
    return this._lastBreakdown;
  }

  /**
   * Get breakdowns for all scored files (cleared on each aggregate call).
   *
   * @returns {Array}
   */
  getAllBreakdowns() {
    return [...this._scoredFiles];
  }

  // ---- Private helpers ----

  _aggregateScores(fileScores, root, skippedCount, scope) {
    const scoredCount = fileScores.length;

    if (scoredCount === 0) {
      return {
        score: 0,
        grade: "N/A",
        fileCount: fileScores.length + skippedCount,
        scoredCount: 0,
        skippedCount,
        fileScores: [],
        categories: {},
        summary: "No scorable source files found",
      };
    }

    // Aggregate per category.
    const catAgg = {};
    for (const key of Object.keys(this._categories)) {
      catAgg[key] = {
        label: this._categories[key].label,
        weight: this._categories[key].weight,
        score: 0,
        totalIssues: 0,
        allIssues: [],
        allSuggestions: [],
      };
    }

    for (const fs of fileScores) {
      for (const [key, cat] of Object.entries(fs.categories)) {
        if (catAgg[key]) {
          catAgg[key].score += cat.score;
          catAgg[key].totalIssues += (cat.issues || []).length;
          for (const issue of cat.issues || []) {
            catAgg[key].allIssues.push({ file: fs.filePath, ...issue });
          }
          for (const s of cat.suggestions || []) {
            if (!catAgg[key].allSuggestions.includes(s)) {
              catAgg[key].allSuggestions.push(s);
            }
          }
        }
      }
    }

    // Average per category.
    for (const key of Object.keys(catAgg)) {
      catAgg[key].score = Math.round(catAgg[key].score / scoredCount);
    }

    // Weighted overall score.
    let totalWeighted = 0;
    let totalWeight = 0;
    for (const key of Object.keys(catAgg)) {
      totalWeighted += catAgg[key].score * catAgg[key].weight;
      totalWeight += catAgg[key].weight;
    }
    const overallScore = totalWeight > 0 ? Math.round(totalWeighted / totalWeight) : 100;
    const grade = this._gradeFromScore(overallScore);

    const totalIssues = Object.values(catAgg).reduce((sum, c) => sum + c.totalIssues, 0);

    return {
      score: overallScore,
      grade,
      scope,
      root,
      fileCount: fileScores.length + skippedCount,
      scoredCount,
      skippedCount,
      fileScores,
      categories: catAgg,
      summary: totalIssues === 0
        ? `Project health: ${overallScore}/100 (${grade}). No issues found across ${scoredCount} files.`
        : `Project health: ${overallScore}/100 (${grade}). ${totalIssues} issue(s) across ${scoredCount} files.`,
    };
  }

  _gradeFromScore(score) {
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    return "F";
  }

  _categoriesWithIssues(catResults) {
    return Object.entries(catResults)
      .filter(([, cat]) => (cat.issues || []).length > 0)
      .map(([, cat]) => cat.label)
      .length;
  }
}

module.exports = {
  CodeHealthScorer,
  DEFAULT_CATEGORIES,
  scoreComplexity,
  scoreDuplication,
  scoreDocumentation,
  scoreTestCoverage,
  scoreErrorHandling,
  scoreNaming,
  scoreStructure,
  scoreSecurity,
  isTestFile,
  isConfigOrGenerated,
};
