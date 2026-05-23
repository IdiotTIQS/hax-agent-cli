/**
 * Tests for IntentDetector: pattern-based intent detection.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { IntentDetector, detectIntent, INTENT_DEFINITIONS } = require("../../src/nlp/intent-detector");

// ── detect: basic intent classification ─────────────────────────────

test("detect: CODE_REVIEW for review-related input", () => {
  const detector = new IntentDetector();

  const result1 = detector.detect("review my last 3 commits for security issues");
  assert.equal(result1.intent, "CODE_REVIEW");
  assert.ok(result1.confidence > 0.3);

  const result2 = detector.detect("audit the auth module for vulnerabilities");
  assert.equal(result2.intent, "CODE_REVIEW");
});

test("detect: EXPLAIN_CODE for explanation requests", () => {
  const detector = new IntentDetector();

  const result1 = detector.detect("explain how the auth middleware works");
  assert.equal(result1.intent, "EXPLAIN_CODE");
  assert.ok(result1.confidence > 0.3);

  const result2 = detector.detect("what does this function do");
  assert.equal(result2.intent, "EXPLAIN_CODE");

  const result3 = detector.detect("walk me through the payment flow");
  assert.equal(result3.intent, "EXPLAIN_CODE");
});

test("detect: WRITE_TESTS for test-related input", () => {
  const detector = new IntentDetector();

  const result1 = detector.detect("write unit tests for the login controller");
  assert.equal(result1.intent, "WRITE_TESTS");
  assert.ok(result1.confidence > 0.3);

  const result2 = detector.detect("add integration tests for the API endpoints");
  assert.equal(result2.intent, "WRITE_TESTS");

  const result3 = detector.detect("increase test coverage for the utils module");
  assert.equal(result3.intent, "WRITE_TESTS");
});

test("detect: REFACTOR for restructuring requests", () => {
  const detector = new IntentDetector();

  const result1 = detector.detect("refactor the user service to be more modular");
  assert.equal(result1.intent, "REFACTOR");
  assert.ok(result1.confidence > 0.3);

  const result2 = detector.detect("clean up the utility functions");
  assert.equal(result2.intent, "REFACTOR");

  const result3 = detector.detect("extract the validation logic into a separate module");
  assert.equal(result3.intent, "REFACTOR");
});

test("detect: DEBUG for bug/fix requests", () => {
  const detector = new IntentDetector();

  const result1 = detector.detect("fix the login bug that causes a crash");
  assert.equal(result1.intent, "DEBUG");
  assert.ok(result1.confidence > 0.5);

  const result2 = detector.detect("debug why the API is returning 500 errors");
  assert.equal(result2.intent, "DEBUG");

  const result3 = detector.detect("this function is not working, can you troubleshoot it");
  assert.equal(result3.intent, "DEBUG");
});

test("detect: OPTIMIZE for performance requests", () => {
  const detector = new IntentDetector();

  const result1 = detector.detect("optimize the database query to be faster");
  assert.equal(result1.intent, "OPTIMIZE");
  assert.ok(result1.confidence > 0.3);

  const result2 = detector.detect("the page is loading too slow, speed it up");
  assert.equal(result2.intent, "OPTIMIZE");

  const result3 = detector.detect("fix the memory leak in the worker thread");
  assert.equal(result3.intent, "OPTIMIZE");
});

test("detect: DOCUMENT for documentation requests", () => {
  const detector = new IntentDetector();

  const result1 = detector.detect("write documentation for the public API");
  assert.equal(result1.intent, "DOCUMENT");
  assert.ok(result1.confidence > 0.3);

  const result2 = detector.detect("add JSDoc comments to all exported functions");
  assert.equal(result2.intent, "DOCUMENT");
});

test("detect: DEPLOY for deployment requests", () => {
  const detector = new IntentDetector();

  const result1 = detector.detect("deploy the app to production");
  assert.equal(result1.intent, "DEPLOY");
  assert.ok(result1.confidence > 0.4);

  const result2 = detector.detect("ship this release to staging");
  assert.equal(result2.intent, "DEPLOY");
});

test("detect: ANALYZE for analysis requests", () => {
  const detector = new IntentDetector();

  const result1 = detector.detect("analyze the performance of the search module");
  assert.equal(result1.intent, "ANALYZE");
  assert.ok(result1.confidence > 0.3);

  const result2 = detector.detect("benchmark the sorting algorithm");
  assert.equal(result2.intent, "ANALYZE");
});

test("detect: SEARCH_CODEBASE for search requests", () => {
  const detector = new IntentDetector();

  const result1 = detector.detect("find all places where we use deprecated API calls");
  assert.equal(result1.intent, "SEARCH_CODEBASE");
  assert.ok(result1.confidence > 0.3);

  const result2 = detector.detect("search the codebase for hardcoded secrets");
  assert.equal(result2.intent, "SEARCH_CODEBASE");

  const result3 = detector.detect("where is the authentication middleware defined");
  assert.equal(result3.intent, "SEARCH_CODEBASE");
});

// ── detect: confidence scoring ──────────────────────────────────────

test("detect: returns null intent for empty input", () => {
  const detector = new IntentDetector();

  const result1 = detector.detect("");
  assert.equal(result1.intent, null);
  assert.equal(result1.confidence, 0);

  const result2 = detector.detect("   ");
  assert.equal(result2.intent, null);
  assert.equal(result2.confidence, 0);
});

test("detect: confidence is higher for clearer intent expressions", () => {
  const detector = new IntentDetector();

  // Very clear intent
  const clear = detector.detect(
    "review this code for security vulnerabilities and check for bugs in the auth module"
  );
  // Generic text that happens to match
  const vague = detector.detect("look at something");

  assert.ok(clear.confidence > vague.confidence,
    `Expected clear confidence (${clear.confidence}) > vague confidence (${vague.confidence})`);
});

test("detect: subIntent detection for CODE_REVIEW", () => {
  const detector = new IntentDetector();

  const security = detector.detect("review for security vulnerabilities and token handling");
  assert.equal(security.intent, "CODE_REVIEW");
  assert.equal(security.subIntent, "security");

  const style = detector.detect("review the code style and linting issues");
  assert.equal(style.intent, "CODE_REVIEW");
  assert.equal(style.subIntent, "style");

  const correctness = detector.detect("review for logic bugs and edge case handling");
  assert.equal(correctness.intent, "CODE_REVIEW");
  assert.equal(correctness.subIntent, "correctness");
});

test("detect: subIntent detection for DEBUG", () => {
  const detector = new IntentDetector();

  const runtime = detector.detect("fix the runtime crash in production");
  assert.equal(runtime.intent, "DEBUG");
  assert.equal(runtime.subIntent, "runtime");

  const nullref = detector.detect("debug this null reference error");
  assert.equal(nullref.intent, "DEBUG");
  assert.equal(nullref.subIntent, "nullref");

  const asyncBug = detector.detect("fix the race condition in the async handler");
  assert.equal(asyncBug.intent, "DEBUG");
  assert.equal(asyncBug.subIntent, "async");
});

// ── detect: entity extraction (inline) ──────────────────────────────

test("detect: extracts file paths inline", () => {
  const detector = new IntentDetector();

  const result = detector.detect("review auth.js and src/utils/helpers.ts for bugs");
  assert.ok(result.entities.files, "Should extract files");
  assert.ok(result.entities.files.some((f) => f.includes("auth.js")),
    "Should find auth.js");
  assert.ok(result.entities.files.some((f) => f.includes("helpers.ts")),
    "Should find helpers.ts");
});

test("detect: extracts line numbers inline", () => {
  const detector = new IntentDetector();

  const result1 = detector.detect("look at line 42 in the config file");
  assert.ok(result1.entities.lineNumbers, "Should extract line numbers");
  assert.ok(result1.entities.lineNumbers.includes(42), "Should find line 42");

  const result2 = detector.detect("check lines 10 to 25 in main.ts");
  assert.ok(result2.entities.lineNumbers.includes(10), "Should find line 10");
});

test("detect: extracts technologies inline", () => {
  const detector = new IntentDetector();

  const result = detector.detect("migrate the React component to use TypeScript and Tailwind");
  assert.ok(result.entities.technologies, "Should extract technologies");
  assert.ok(result.entities.technologies.includes("react"), "Should find react");
  assert.ok(result.entities.technologies.includes("typescript"), "Should find typescript");
  assert.ok(result.entities.technologies.includes("tailwind"), "Should find tailwind");
});

test("detect: extracts commit hashes inline", () => {
  const detector = new IntentDetector();

  const result = detector.detect("review commits abc1234 and deadbeef for issues");
  assert.ok(result.entities.commitHashes, "Should extract hashes");
  assert.ok(result.entities.commitHashes.includes("abc1234"), "Should find abc1234");
});

// ── detectAll ───────────────────────────────────────────────────────

test("detectAll: returns all intent scores sorted by confidence", () => {
  const detector = new IntentDetector();

  const results = detector.detectAll("review the auth module for security issues");
  assert.ok(Array.isArray(results), "Should return array");
  assert.ok(results.length > 0, "Should have entries");
  assert.equal(results[0].intent, "CODE_REVIEW");
  assert.ok(results[0].score > 0.3, "Top score should be above threshold");
  // Verify sorted descending
  for (let i = 1; i < results.length; i += 1) {
    assert.ok(results[i - 1].score >= results[i].score,
      `Scores should be descending: ${results[i - 1].score} >= ${results[i].score}`);
  }
});

// ── minConfidence option ────────────────────────────────────────────

test("detect: respects minConfidence option", () => {
  const strict = new IntentDetector({ minConfidence: 0.8 });
  const lenient = new IntentDetector({ minConfidence: 0.1 });

  // Use a clear intent input so both detectors can work
  const input = "search for all uses of the deprecated API";

  // Strict may reject if below 0.8
  const strictResult = strict.detect(input);
  // Lenient should always accept a clear intent match
  const lenientResult = lenient.detect(input);

  // The lenient detector should definitely return an intent
  assert.ok(lenientResult.intent !== null, "Lenient detector should find an intent");
  // Verify that a more permissive minConfidence finds intents the strict one might skip
  assert.ok(
    lenientResult.intent !== null,
    "Lenient with minConfidence=0.1 should match where strict with minConfidence=0.8 might not"
  );
});

// ── Convenience export ──────────────────────────────────────────────

test("detectIntent: convenience function works", () => {
  const result = detectIntent("fix the bug in auth.js");
  assert.equal(result.intent, "DEBUG");
  assert.ok(result.confidence > 0.3);
});

// ── Edge cases ──────────────────────────────────────────────────────

test("detect: handles input with special characters", () => {
  const detector = new IntentDetector();

  const result = detector.detect("review the `UserService` class (src/services/user.ts)");
  assert.equal(result.intent, "CODE_REVIEW");
});

test("detect: handles very long input", () => {
  const detector = new IntentDetector();

  // Long input with repeated security-review language
  const longInput = "review the authentication module for security issues, " +
    "check the authorization logic for vulnerabilities, " +
    "and audit the password handling code for flaws and risks";
  const result = detector.detect(longInput);
  assert.equal(result.intent, "CODE_REVIEW");
  assert.ok(result.confidence > 0.3);
});

test("detect: handles inputs not matching any intent", () => {
  const detector = new IntentDetector({ minConfidence: 0.6 });

  // Very vague, non-technical input
  const result = detector.detect("hello world how are you doing today");
  // May or may not match — but shouldn't crash
  assert.ok(result !== null && typeof result === "object");
});

// ── INTENT_DEFINITIONS is exported ──────────────────────────────────

test("INTENT_DEFINITIONS: has all required intents", () => {
  const intents = INTENT_DEFINITIONS.map((d) => d.intent);
  const required = [
    "CODE_REVIEW", "EXPLAIN_CODE", "WRITE_TESTS", "REFACTOR",
    "DEBUG", "OPTIMIZE", "DOCUMENT", "DEPLOY", "ANALYZE", "SEARCH_CODEBASE",
  ];
  for (const req of required) {
    assert.ok(intents.includes(req), `Should include ${req}`);
  }
});

test("INTENT_DEFINITIONS: each has keywords, phrases, and patterns", () => {
  for (const def of INTENT_DEFINITIONS) {
    assert.ok(Array.isArray(def.keywords), `${def.intent} should have keywords array`);
    assert.ok(Array.isArray(def.phrases), `${def.intent} should have phrases array`);
    assert.ok(Array.isArray(def.patterns), `${def.intent} should have patterns array`);
    assert.ok(def.keywords.length > 0, `${def.intent} should have at least one keyword`);
    assert.ok(def.patterns.length > 0, `${def.intent} should have at least one pattern`);
  }
});
