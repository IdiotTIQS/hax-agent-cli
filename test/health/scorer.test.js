"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const {
  CodeHealthScorer,
  scoreComplexity,
  scoreDuplication,
  scoreDocumentation,
  scoreErrorHandling,
  scoreNaming,
  scoreSecurity,
  scoreStructure,
  scoreTestCoverage,
  isTestFile,
  isConfigOrGenerated,
} = require("../../src/health/scorer");

// -------------------------------------------------------------------------
// scoreComplexity
// -------------------------------------------------------------------------

test("scoreComplexity returns full score for simple code", () => {
  const code = "const x = 1;\nconst y = 2;\nconsole.log(x + y);\n";
  const result = scoreComplexity(code);
  assert.ok(result.score >= 90, `expected >= 90, got ${result.score}`);
  assert.strictEqual(result.issues.length, 0);
});

test("scoreComplexity penalizes high branch density", () => {
  const code = Array.from({ length: 50 }, (_, i) => `if (x === ${i}) { doA(); } else { doB(); }`).join("\n");
  const result = scoreComplexity(code);
  assert.ok(result.score < 80, `expected < 80, got ${result.score}`);
  const branchIssue = result.issues.find((i) => i.type === "HIGH_BRANCH_DENSITY");
  assert.ok(branchIssue, "expected HIGH_BRANCH_DENSITY issue");
});

test("scoreComplexity penalizes long files", () => {
  const code = Array.from({ length: 350 }, (_, i) => `const x${i} = ${i};`).join("\n");
  const result = scoreComplexity(code);
  const issue = result.issues.find((i) => i.type === "LONG_FILE");
  assert.ok(issue, "expected LONG_FILE issue");
});

test("scoreComplexity penalizes deep nesting", () => {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += "  ".repeat(i) + "if (cond) {\n";
  }
  for (let i = 7; i >= 0; i--) {
    code += "  ".repeat(i) + "}\n";
  }
  const result = scoreComplexity(code);
  const issue = result.issues.find((i) => i.type === "DEEP_NESTING");
  assert.ok(issue, "expected DEEP_NESTING issue for 8-level nesting");
});

// -------------------------------------------------------------------------
// scoreDuplication
// -------------------------------------------------------------------------

test("scoreDuplication returns full score for unique code", () => {
  const code = "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n";
  const result = scoreDuplication(code);
  assert.ok(result.score >= 90, `expected >= 90, got ${result.score}`);
});

test("scoreDuplication detects duplicate lines", () => {
  // Need at least 10 non-empty lines to pass the early-return threshold.
  const dupLine = "const processedData = transform(validate(parse(rawData)));\n";
  const code = dupLine.repeat(8) + "const other = 1;\nconst another = 2;\nconst yetAnother = 3;\n";
  const result = scoreDuplication(code);
  assert.ok(result.issues.length > 0, "expected duplication issue");
});

// -------------------------------------------------------------------------
// scoreDocumentation
// -------------------------------------------------------------------------

test("scoreDocumentation penalizes missing comments", () => {
  const code = "function foo(x) { return x * 2; }\nfunction bar(y) { return y + 1; }\n";
  const result = scoreDocumentation(code, "/src/utils.js");
  assert.ok(result.score < 90, `expected < 90, got ${result.score}`);
});

test("scoreDocumentation detects missing file header", () => {
  const code = "function doStuff() { return 42; }\n";
  const result = scoreDocumentation(code, "/src/stuff.js");
  const issue = result.issues.find((i) => i.type === "MISSING_FILE_HEADER");
  assert.ok(issue, "expected MISSING_FILE_HEADER issue");
});

// -------------------------------------------------------------------------
// scoreErrorHandling
// -------------------------------------------------------------------------

test("scoreErrorHandling penalizes lack of try/catch", () => {
  const code = `function readFile() { return fs.readFileSync('f'); }
function parseData(d) { return JSON.parse(d); }
function process(x) { return x.data.value; }
function handle(r) { doStuff(r); }`;
  const result = scoreErrorHandling(code);
  assert.ok(result.score < 80, `expected < 80, got ${result.score}`);
});

test("scoreErrorHandling scores well for good error handling", () => {
  const code = `function readFile() { try { return fs.readFileSync('f'); } catch (e) { throw new Error('read failed: ' + e.message); } }
function parse(d) { if (typeof d !== 'string') throw new TypeError('expected string'); try { return JSON.parse(d); } catch (e) { throw new Error('parse failed'); } }`;
  const result = scoreErrorHandling(code);
  assert.ok(result.score >= 70, `expected >= 70, got ${result.score}`);
});

// -------------------------------------------------------------------------
// scoreNaming
// -------------------------------------------------------------------------

test("scoreNaming penalizes single-letter variable names", () => {
  const code = "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;\n";
  const result = scoreNaming(code);
  const issue = result.issues.find((i) => i.type === "SINGLE_LETTER_NAMES");
  assert.ok(issue, "expected SINGLE_LETTER_NAMES issue");
});

test("scoreNaming penalizes unclear names", () => {
  const code = "const data = fetch();\nconst item = data[0];\nconst tmp = item.value;\nconst obj = {};\nconst res = doWork(tmp);\n";
  const result = scoreNaming(code);
  const issue = result.issues.find(
    (i) => i.type === "UNCLEAR_NAMES"
  );
  assert.ok(issue, "expected UNCLEAR_NAMES issue");
});

// -------------------------------------------------------------------------
// scoreSecurity
// -------------------------------------------------------------------------

test("scoreSecurity penalizes eval usage", () => {
  const code = "const result = eval('2 + 2');\n";
  const result = scoreSecurity(code);
  const issue = result.issues.find((i) => i.type === "EVAL_USAGE");
  assert.ok(issue, "expected EVAL_USAGE issue");
  assert.ok(result.score < 80, `expected < 80, got ${result.score}`);
});

test("scoreSecurity penalizes hardcoded secrets", () => {
  const code = 'const API_KEY = "sk-abcdefghijklmnopqrstuvwx123456";\n';
  const result = scoreSecurity(code);
  const issue = result.issues.find((i) => i.type === "HARDCODED_SECRETS");
  assert.ok(issue, "expected HARDCODED_SECRETS issue");
});

// -------------------------------------------------------------------------
// CodeHealthScorer.scoreFile
// -------------------------------------------------------------------------

test("CodeHealthScorer.scoreFile returns breakdown for a source file", () => {
  const scorer = new CodeHealthScorer();
  const code = [
    "/** Calculator module */",
    "function add(a, b) {",
    "  if (typeof a !== 'number') throw new TypeError('a must be number');",
    "  if (typeof b !== 'number') throw new TypeError('b must be number');",
    "  return a + b;",
    "}",
    "function subtract(a, b) {",
    "  if (typeof a !== 'number') throw new TypeError('a must be number');",
    "  if (typeof b !== 'number') throw new TypeError('b must be number');",
    "  return a - b;",
    "}",
    "module.exports = { add, subtract };",
  ].join("\n");

  const result = scorer.scoreFile(code, "/src/calculator.js");
  assert.strictEqual(typeof result.score, "number");
  assert.ok(result.score >= 0 && result.score <= 100, "score must be 0-100");
  assert.ok(result.categories.complexity, "missing complexity category");
  assert.ok(result.categories.duplication, "missing duplication category");
  assert.ok(result.categories.documentation, "missing documentation category");
  assert.ok(result.categories.testCoverage, "missing testCoverage category");
  assert.ok(result.categories.errorHandling, "missing errorHandling category");
  assert.ok(result.categories.naming, "missing naming category");
  assert.ok(result.categories.structure, "missing structure category");
  assert.ok(result.categories.security, "missing security category");
  assert.ok(result.grade, "missing grade");
  assert.strictEqual(result.filePath, "/src/calculator.js");
});

test("CodeHealthScorer.scoreFile skips config files by default", () => {
  const scorer = new CodeHealthScorer();
  const result = scorer.scoreFile('{"name": "test"}', "/project/package.json");
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.score, null);
});

test("CodeHealthScorer.scoreFile throws on invalid input", () => {
  const scorer = new CodeHealthScorer();
  assert.throws(() => scorer.scoreFile(null, "/f.js"), TypeError);
  assert.throws(() => scorer.scoreFile("code", null), TypeError);
  assert.throws(() => scorer.scoreFile(123, "/f.js"), TypeError);
});

// -------------------------------------------------------------------------
// CodeHealthScorer.scoreDirectory
// -------------------------------------------------------------------------

test("CodeHealthScorer.scoreDirectory scores all files in a directory", () => {
  const scorer = new CodeHealthScorer();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-test-"));

  fs.writeFileSync(path.join(tmpDir, "index.js"), "const x = 1;\n");
  fs.writeFileSync(path.join(tmpDir, "utils.js"), "function helper() { return 42; }\nmodule.exports = { helper };\n");
  // Skip files that match isConfigOrGenerated patterns.
  fs.mkdirSync(path.join(tmpDir, "lib"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "lib", "math.js"), "function add(a,b){return a+b;}\n");

  const result = scorer.scoreDirectory(tmpDir);
  assert.ok(result.score >= 0 && result.score <= 100, "score must be 0-100");
  assert.ok(result.scoredCount >= 1, `expected at least 1 scored, got ${result.scoredCount}`);
  assert.ok(result.categories, "missing categories");

  // Cleanup.
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("CodeHealthScorer.scoreDirectory throws for missing directory", () => {
  const scorer = new CodeHealthScorer();
  assert.throws(() => scorer.scoreDirectory("/nonexistent/path/12345"), Error);
});

// -------------------------------------------------------------------------
// getBreakdown
// -------------------------------------------------------------------------

test("getBreakdown returns the last scored result", () => {
  const scorer = new CodeHealthScorer();
  assert.strictEqual(scorer.getBreakdown(), null);

  scorer.scoreFile("const x = 1;\n", "/src/a.js");
  const breakdown = scorer.getBreakdown();
  assert.ok(breakdown);
  assert.strictEqual(breakdown.filePath, "/src/a.js");

  scorer.scoreFile("const y = 2;\n", "/src/b.js");
  const breakdown2 = scorer.getBreakdown();
  assert.strictEqual(breakdown2.filePath, "/src/b.js");
});

// -------------------------------------------------------------------------
// Utility functions
// -------------------------------------------------------------------------

test("isTestFile detects test files correctly", () => {
  assert.strictEqual(isTestFile("/src/foo.test.js"), true);
  assert.strictEqual(isTestFile("/src/foo.spec.js"), true);
  assert.strictEqual(isTestFile("/test/foo.js"), true);
  assert.strictEqual(isTestFile("\\test\\bar.js"), true);
  assert.strictEqual(isTestFile("/src/foo.js"), false);
});

test("isConfigOrGenerated detects config files", () => {
  assert.strictEqual(isConfigOrGenerated("/p/package.json"), true);
  assert.strictEqual(isConfigOrGenerated("/p/yarn.lock"), true);
  assert.strictEqual(isConfigOrGenerated("/p/.env"), true);
  assert.strictEqual(isConfigOrGenerated("/p/node_modules/lib.js"), true);
  assert.strictEqual(isConfigOrGenerated("/p/dist/bundle.js"), true);
  assert.strictEqual(isConfigOrGenerated("/p/src/app.js"), false);
});

// -------------------------------------------------------------------------
// Additional integration tests
// -------------------------------------------------------------------------

test("CodeHealthScorer.scoreFile provides meaningful suggestions", () => {
  const scorer = new CodeHealthScorer();
  const badCode = [
    "function x(a, b, c, d, e, f) {",
    "  const t = eval(a + b);",
    "  const key = 'sk-1234567890abcdefghijklmnop';",
    "  if (t > 0) {",
    "    if (t > 10) {",
    "    if (t > 100) {",
    "    if (t > 1000) {",
    "    if (t > 10000) {",
    "    if (t > 100000) {",
    "        return true;",
    "    }}}}}",
    "  return false;",
    "}",
  ].join("\n");

  const result = scorer.scoreFile(badCode, "/src/bad.js");

  // Should have low score.
  assert.ok(result.score < 80, `expected low score, got ${result.score}`);

  // Should have security issues.
  const secCat = result.categories.security;
  assert.ok(secCat.issues.length > 0, "expected security issues for eval + secrets");

  // Should have complexity issues for deep nesting.
  const compCat = result.categories.complexity;
  assert.ok(compCat.issues.length > 0, "expected complexity issues for deep nesting checks");
});

test("CodeHealthScorer.scoreProject is an alias for scoreDirectory", () => {
  const scorer = new CodeHealthScorer();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-proj-"));

  fs.writeFileSync(path.join(tmpDir, "main.js"), "function main() { return true; }\nmodule.exports = main;\n");

  const result = scorer.scoreProject(tmpDir);
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.strictEqual(result.scope, "directory");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("scoreStructure detects large files and many definitions", () => {
  let code = "";
  for (let i = 0; i < 15; i++) {
    code += `function fn${i}() { return ${i}; }\n`;
  }
  const result = scoreStructure(code, "/src/big.js");
  const issue = result.issues.find((i) => i.type === "TOO_MANY_DEFINITIONS");
  assert.ok(issue, "expected TOO_MANY_DEFINITIONS issue for 15 functions");
});

test("scoreDuplication scores well for short content", () => {
  const code = "const x = 1;\n";
  const result = scoreDuplication(code);
  assert.strictEqual(result.score, 100);
  assert.strictEqual(result.issues.length, 0);
});

test("scoreTestCoverage detects missing test file", () => {
  const code = "function foo() { return 1; }\nmodule.exports = foo;\n";
  // Use a path that definitely has no test file.
  const tmpFile = path.join(os.tmpdir(), `health-tc-${Date.now()}.js`);
  fs.writeFileSync(tmpFile, code);
  const result = scoreTestCoverage(code, tmpFile);
  const issue = result.issues.find((i) => i.type === "NO_TESTS");
  assert.ok(issue, "expected NO_TESTS issue for file without test companion");
  assert.ok(result.score < 80, `expected < 80, got ${result.score}`);
  fs.unlinkSync(tmpFile);
});

test("scoreTestCoverage gives full score for test files", () => {
  const code = "test('foo', () => { assert.strictEqual(1, 1); });\n";
  const result = scoreTestCoverage(code, "/src/foo.test.js");
  assert.strictEqual(result.score, 100);
  assert.strictEqual(result.issues.length, 0);
});
