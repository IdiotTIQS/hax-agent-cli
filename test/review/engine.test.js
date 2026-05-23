"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert");

const {
  CodeReviewEngine,
  reviewSecurity,
  reviewPerformance,
  reviewMaintainability,
  reviewStyle,
  makeFinding,
  scoreFromFindings,
  summarizeFindings,
  recommendationsFromFindings,
  SEVERITY_ORDER,
  PERSPECTIVES,
} = require("../../src/review/engine");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(path, content) {
  return { path: path || "/test/file.js", content: content || "" };
}

// ---------------------------------------------------------------------------
// makeFinding
// ---------------------------------------------------------------------------

test("makeFinding creates a well-formed finding object", () => {
  const f = makeFinding("file.js", 10, "security", "MAJOR", "Test title", "Test message", "Test suggestion");
  assert.strictEqual(f.file, "file.js");
  assert.strictEqual(f.line, 10);
  assert.strictEqual(f.perspective, "security");
  assert.strictEqual(f.severity, "MAJOR");
  assert.strictEqual(f.title, "Test title");
  assert.strictEqual(f.message, "Test message");
  assert.strictEqual(f.suggestion, "Test suggestion");
});

test("makeFinding throws on invalid severity", () => {
  assert.throws(() => makeFinding("f.js", 1, "security", "INVALID", "x", "x", "x"), {
    message: /Invalid severity/,
  });
});

test("makeFinding defaults line to 1 when falsy", () => {
  const f = makeFinding("f.js", 0, "style", "SUGGESTION", "T", "M", "S");
  assert.strictEqual(f.line, 1);
});

// ---------------------------------------------------------------------------
// scoreFromFindings
// ---------------------------------------------------------------------------

test("scoreFromFindings returns 100 for no findings", () => {
  assert.strictEqual(scoreFromFindings([]), 100);
});

test("scoreFromFindings deducts per severity", () => {
  const findings = [
    makeFinding("f.js", 1, "security", "BLOCKER", "B", "b", "b"),
    makeFinding("f.js", 2, "security", "CRITICAL", "C", "c", "c"),
    makeFinding("f.js", 3, "security", "MAJOR", "M", "m", "m"),
    makeFinding("f.js", 4, "security", "MINOR", "m", "m", "m"),
    makeFinding("f.js", 5, "security", "SUGGESTION", "S", "s", "s"),
  ];
  // 100 - 25 - 15 - 8 - 3 - 1 = 48
  assert.strictEqual(scoreFromFindings(findings), 48);
});

test("scoreFromFindings floors at 0", () => {
  const findings = [];
  for (let i = 0; i < 10; i++) {
    findings.push(makeFinding(`f${i}.js`, 1, "security", "BLOCKER", "B", "b", "b"));
  }
  assert.strictEqual(scoreFromFindings(findings), 0);
});

// ---------------------------------------------------------------------------
// summarizeFindings
// ---------------------------------------------------------------------------

test("summarizeFindings returns clean message for no findings", () => {
  const s = summarizeFindings([], 100);
  assert.ok(s.includes("100/100"));
  assert.ok(s.includes("No issues found"));
});

test("summarizeFindings breaks down by severity", () => {
  const findings = [
    makeFinding("f.js", 1, "security", "BLOCKER", "B", "b", "b"),
    makeFinding("f.js", 2, "security", "CRITICAL", "C", "c", "c"),
  ];
  const s = summarizeFindings(findings, 60);
  assert.ok(s.includes("1 blocker"));
  assert.ok(s.includes("1 critical"));
  assert.ok(s.includes("2 issue"));
});

// ---------------------------------------------------------------------------
// recommendationsFromFindings
// ---------------------------------------------------------------------------

test("recommendationsFromFindings deduplicates and sorts by severity", () => {
  const findings = [
    makeFinding("f.js", 1, "security", "MINOR", "T1", "m1", "Use env vars"),
    makeFinding("f.js", 2, "security", "BLOCKER", "T2", "m2", "Use env vars"), // duplicate suggestion
    makeFinding("f.js", 3, "security", "CRITICAL", "T3", "m3", "Sanitize input"),
  ];
  const recs = recommendationsFromFindings(findings);
  // BLOCKER suggestion should be first (deduped), then CRITICAL
  assert.strictEqual(recs.length, 2, "should deduplicate suggestions");
  assert.strictEqual(recs[0].severity, "BLOCKER");
  assert.strictEqual(recs[1].severity, "CRITICAL");
});

// ---------------------------------------------------------------------------
// reviewSecurity
// ---------------------------------------------------------------------------

test("reviewSecurity detects hardcoded secret patterns", () => {
  const file = makeFile("/src/config.js", [
    "const config = {",
    "  apiKey: 'sk-abcdefghijklmnopqrstuvwxyz123456',",
    "  secret: 'my-super-secret-token-here',",
    "};",
  ].join("\n"));
  const result = reviewSecurity(file);
  assert.ok(result.findings.length >= 1, "should find at least one secret");
  assert.ok(result.findings.every((f) => f.perspective === "security"));
  const hasSecret = result.findings.some((f) => f.severity === "BLOCKER" && f.title.includes("Hardcoded"));
  assert.ok(hasSecret, "should have a BLOCKER hardcoded secret finding");
  assert.ok(result.score < 100);
});

test("reviewSecurity detects eval() usage", () => {
  const file = makeFile("/src/runner.js", 'eval("console.log(1)");');
  const result = reviewSecurity(file);
  const evalFinding = result.findings.find((f) => f.title.includes("eval"));
  assert.ok(evalFinding, "should flag eval()");
  assert.strictEqual(evalFinding.severity, "CRITICAL");
});

test("reviewSecurity detects child_process.exec()", () => {
  const file = makeFile("/src/executor.js", "const { exec } = require('child_process');\nexec('rm -rf ' + userInput);");
  const result = reviewSecurity(file);
  const execFinding = result.findings.find((f) => f.title.includes("exec"));
  assert.ok(execFinding, "should flag exec()");
});

test("reviewSecurity returns full score for clean code", () => {
  const file = makeFile("/src/clean.js", "const x = 1;\nmodule.exports = { x };\n");
  const result = reviewSecurity(file);
  assert.strictEqual(result.score, 100);
  assert.strictEqual(result.findings.length, 0);
});

test("reviewSecurity flags XSS patterns", () => {
  const file = makeFile("/src/component.js", "document.getElementById('app').innerHTML = userInput;");
  const result = reviewSecurity(file);
  const xss = result.findings.find((f) => f.title.includes("XSS"));
  assert.ok(xss, "should detect innerHTML XSS risk");
});

// ---------------------------------------------------------------------------
// reviewPerformance
// ---------------------------------------------------------------------------

test("reviewPerformance detects synchronous fs operations", () => {
  const file = makeFile("/src/reader.js", "const data = fs.readFileSync('/etc/passwd', 'utf-8');");
  const result = reviewPerformance(file);
  const syncFs = result.findings.find((f) => f.title.includes("Synchronous file"));
  assert.ok(syncFs, "should flag readFileSync");
  assert.strictEqual(syncFs.severity, "MAJOR");
});

test("reviewPerformance detects nested loops", () => {
  const file = makeFile("/src/matrix.js", [
    "for (let i = 0; i < arr.length; i++) {",
    "  for (let j = 0; j < arr[i].length; j++) {",
    "    console.log(arr[i][j]);",
    "  }",
    "}",
  ].join("\n"));
  const result = reviewPerformance(file);
  const nested = result.findings.find((f) => f.title.includes("Nested loop"));
  assert.ok(nested, "should detect nested loops");
});

test("reviewPerformance returns full score for simple code", () => {
  const file = makeFile("/src/simple.js", "const x = arr.map(y => y * 2);\n");
  const result = reviewPerformance(file);
  assert.strictEqual(result.score, 100);
});

// ---------------------------------------------------------------------------
// reviewMaintainability
// ---------------------------------------------------------------------------

test("reviewMaintainability detects deep nesting", () => {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += "  ".repeat(i) + "if (cond) {\n";
  }
  for (let i = 7; i >= 0; i--) {
    code += "  ".repeat(i) + "}\n";
  }
  const file = makeFile("/src/deep.js", code);
  const result = reviewMaintainability(file);
  assert.ok(result.findings.some((f) => f.title && f.title.includes("nesting")), "should detect deep nesting");
});

test("reviewMaintainability detects empty catch blocks", () => {
  const file = makeFile("/src/silent.js", "try { risky(); } catch (e) { }");
  const result = reviewMaintainability(file);
  const emptyCatch = result.findings.find((f) => f.title.includes("Empty catch"));
  assert.ok(emptyCatch, "should flag empty catch blocks");
  assert.strictEqual(emptyCatch.severity, "MAJOR");
});

test("reviewMaintainability flags untracked TODOs", () => {
  const file = makeFile("/src/todo.js", "// TODO fix this later\nfunction go() {}");
  const result = reviewMaintainability(file);
  const todo = result.findings.find((f) => f.title.includes("TODO"));
  assert.ok(todo, "should flag untracked TODO");
  assert.strictEqual(todo.severity, "SUGGESTION");
});

test("reviewMaintainability detects magic numbers", () => {
  const file = makeFile("/src/magic.js", "setTimeout(() => {}, 30000);\nconst delay = 86400;\nfunction retry(n) { return n * 42; }");
  const result = reviewMaintainability(file);
  const magic = result.findings.find((f) => f.title.includes("Magic number"));
  assert.ok(magic, `should detect magic numbers, found: ${JSON.stringify(result.findings.map(f => f.title))}`);
});

// ---------------------------------------------------------------------------
// reviewStyle
// ---------------------------------------------------------------------------

test("reviewStyle detects trailing whitespace", () => {
  const file = makeFile("/src/messy.js", "const x = 1;   \nconst y = 2;\t\n");
  const result = reviewStyle(file);
  const trailing = result.findings.find((f) => f.title.includes("Trailing whitespace"));
  assert.ok(trailing, "should detect trailing whitespace");
});

test("reviewStyle detects mixed quote usage", () => {
  const code = Array.from({ length: 20 }, (_, i) => i % 2 === 0 ? `const a${i} = 'hello${i}';` : `const b${i} = "world${i}";`).join("\n");
  const file = makeFile("/src/mixed.js", code);
  const result = reviewStyle(file);
  const quotes = result.findings.find((f) => f.title.includes("Inconsistent quote"));
  assert.ok(quotes, "should detect mixed quotes");
});

test("reviewStyle detects missing 'use strict'", () => {
  const file = makeFile("/src/nostrict.js", "const x = 1;\nmodule.exports = x;\n");
  const result = reviewStyle(file);
  const strict = result.findings.find((f) => f.title.includes("use strict"));
  assert.ok(strict, "should flag missing use strict");
});

test("reviewStyle returns full score for clean code", () => {
  const code = "'use strict';\nconst greeting = 'hello';\nconst farewell = 'goodbye';\nmodule.exports = { greeting, farewell };\n";
  const file = makeFile("/src/clean.js", code);
  const result = reviewStyle(file);
  assert.strictEqual(result.score, 100);
  assert.strictEqual(result.findings.length, 0);
});

// ---------------------------------------------------------------------------
// CodeReviewEngine class
// ---------------------------------------------------------------------------

test("CodeReviewEngine: review() with a single file aggregates all perspectives", () => {
  const engine = new CodeReviewEngine();
  const file = makeFile("/src/test.js", [
    "'use strict';",
    "const apiKey = 'sk-abcdefghijklmnopqrstuvwxyz123456';",  // security issue
    "const data = fs.readFileSync('/path');",                   // performance issue
    "const MAGIC = 90000;",                                     // maintainability issue
    "const x = 1;   ",                                          // style issue (trailing whitespace)
  ].join("\n"));
  const result = engine.review(file);
  assert.ok(Array.isArray(result.findings));
  assert.ok(result.findings.length > 0, "should have findings across multiple perspectives");
  assert.ok(typeof result.score === "number");
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(typeof result.summary === "string");
  assert.ok(Array.isArray(result.recommendations));
  assert.strictEqual(result.fileCount, 1);
  assert.ok(result.perspectives.length >= 1);
});

test("CodeReviewEngine: review() with multiple files", () => {
  const engine = new CodeReviewEngine();
  const file1 = makeFile("/src/a.js", "'use strict';\nconst x = 1;\n");
  const file2 = makeFile("/src/b.js", "eval('x');\n");
  const result = engine.review([file1, file2], { perspectives: ["security"] });
  assert.strictEqual(result.fileCount, 2);
  assert.ok(result.findings.length >= 1, "should flag eval in b.js");
});

test("CodeReviewEngine: review() with empty array returns clean", () => {
  const engine = new CodeReviewEngine();
  const result = engine.review([]);
  assert.strictEqual(result.findings.length, 0);
  assert.strictEqual(result.score, 100);
  assert.strictEqual(result.fileCount, 0);
  assert.ok(result.summary.includes("No files"));
});

test("CodeReviewEngine: registerReviewer adds a custom perspective", () => {
  const engine = new CodeReviewEngine();
  engine.registerReviewer("custom", (file) => ({
    perspective: "custom",
    findings: [makeFinding(file.path, 1, "custom", "SUGGESTION", "Custom issue", "msg", "fix")],
    score: 90,
  }));
  const perspectives = engine.getPerspectives();
  assert.ok(perspectives.includes("custom"));
  const file = makeFile("/src/test.js", "x");
  const result = engine.review(file, { perspectives: ["custom"] });
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.findings[0].perspective, "custom");
});

test("CodeReviewEngine: registerReviewer throws on invalid input", () => {
  const engine = new CodeReviewEngine();
  assert.throws(() => engine.registerReviewer("", () => {}), { message: /non-empty string/ });
  assert.throws(() => engine.registerReviewer("bad", "not-a-function"), { message: /must be a function/ });
});

test("CodeReviewEngine: removeReviewer removes a reviewer", () => {
  const engine = new CodeReviewEngine();
  engine.removeReviewer("style");
  assert.ok(!engine.getPerspectives().includes("style"));
});

test("CodeReviewEngine: getLastResult tracks the most recent review", () => {
  const engine = new CodeReviewEngine();
  const file = makeFile("/src/test.js", "const x = 1;\n");
  engine.review(file, { perspectives: ["style"] });
  const last = engine.getLastResult();
  assert.ok(last !== null);
  assert.ok(Array.isArray(last.findings));
  assert.strictEqual(last.fileCount, 1);
});

test("CodeReviewEngine: reviewPerspective throws on invalid file", () => {
  const engine = new CodeReviewEngine();
  assert.throws(() => engine.reviewPerspective(null, "security"), { message: /file must be an object/ });
});

test("CodeReviewEngine: reviewPerspective throws on unknown perspective", () => {
  const engine = new CodeReviewEngine();
  const file = makeFile("/src/test.js", "x");
  assert.throws(() => engine.reviewPerspective(file, "unknown_perspective"), { message: /Unknown perspective/ });
});

test("CodeReviewEngine: convenience methods delegate correctly", () => {
  const engine = new CodeReviewEngine();
  const file = makeFile("/src/hack.js", "eval('console.log(1)');");
  const secResult = engine.reviewSecurity(file);
  assert.strictEqual(secResult.perspective, "security");
  assert.ok(secResult.findings.length > 0);

  const perfResult = engine.reviewPerformance(file);
  assert.strictEqual(perfResult.perspective, "performance");

  const maintResult = engine.reviewMaintainability(file);
  assert.strictEqual(maintResult.perspective, "maintainability");

  const styleResult = engine.reviewStyle(file);
  assert.strictEqual(styleResult.perspective, "style");
});

test("CodeReviewEngine: review() allows overriding perspectives via options", () => {
  const engine = new CodeReviewEngine();
  const file = makeFile("/src/eval.js", "eval('bad'); fs.readFileSync('path'); const MAGIC = 99999;");
  // Only security
  const resultSec = engine.review(file, { perspectives: ["security"] });
  assert.ok(resultSec.perspectives.length === 1);
  const nonSecurity = resultSec.findings.filter((f) => f.perspective !== "security");
  assert.strictEqual(nonSecurity.length, 0, "should have no non-security findings when only security perspective is selected");
});

test("PERSPECTIVES constant includes all four default perspectives", () => {
  assert.ok(PERSPECTIVES.includes("security"));
  assert.ok(PERSPECTIVES.includes("performance"));
  assert.ok(PERSPECTIVES.includes("maintainability"));
  assert.ok(PERSPECTIVES.includes("style"));
  assert.strictEqual(PERSPECTIVES.length, 4);
});

test("SEVERITY_ORDER defines correct ordering", () => {
  assert.ok(SEVERITY_ORDER.BLOCKER < SEVERITY_ORDER.CRITICAL);
  assert.ok(SEVERITY_ORDER.CRITICAL < SEVERITY_ORDER.MAJOR);
  assert.ok(SEVERITY_ORDER.MAJOR < SEVERITY_ORDER.MINOR);
  assert.ok(SEVERITY_ORDER.MINOR < SEVERITY_ORDER.SUGGESTION);
});

// ---------------------------------------------------------------------------
// Edge-case: review() with non-Array passed but treated as single
// ---------------------------------------------------------------------------

test("CodeReviewEngine: review() handles single file object (non-array)", () => {
  const engine = new CodeReviewEngine();
  const file = makeFile("/src/ok.js", "'use strict';\nconst x = 1;\nmodule.exports = { x };\n");
  const result = engine.review(file);
  assert.strictEqual(result.fileCount, 1);
});

// ---------------------------------------------------------------------------
// Edge-case: reviewer function throws
// ---------------------------------------------------------------------------

test("CodeReviewEngine: reviewPerspective catches reviewer errors gracefully", () => {
  const engine = new CodeReviewEngine();
  engine.registerReviewer("explosive", () => { throw new Error("Boom"); });
  const file = makeFile("/src/boom.js", "x");
  const result = engine.reviewPerspective(file, "explosive");
  assert.strictEqual(result.score, 0);
  assert.strictEqual(result.findings.length, 1);
  assert.ok(result.findings[0].title.includes("Reviewer error"));
});
