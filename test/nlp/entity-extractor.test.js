/**
 * Tests for EntityExtractor: structured entity extraction.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  EntityExtractor,
  extractEntities,
  extractFilePaths,
  extractCodeReferences,
  extractTechnologies,
} = require("../../src/nlp/entity-extractor");

// ── extractFilePaths ───────────────────────────────────────────────

test("extractFilePaths: finds relative paths with code extensions", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extractFilePaths(
    "review src/utils/auth.js and lib/helpers.ts for bugs"
  );
  assert.ok(result.includes("src/utils/auth.js"), "Should find auth.js");
  assert.ok(result.includes("lib/helpers.ts"), "Should find helpers.ts");
});

test("extractFilePaths: finds paths with ./ prefix", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extractFilePaths(
    "the main entry point is ./src/index.ts"
  );
  assert.ok(result.includes("./src/index.ts"), "Should find ./src/index.ts");
});

test("extractFilePaths: finds paths in backticks", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extractFilePaths(
    "the file `components/App.tsx` needs to be updated"
  );
  assert.ok(result.includes("components/App.tsx"), "Should find App.tsx");
});

test("extractFilePaths: finds paths in quotes", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extractFilePaths(
    'look at "utils/validation.py" and \'tests/test_api.rb\''
  );
  assert.ok(result.includes("utils/validation.py"), "Should find validation.py");
  assert.ok(result.includes("tests/test_api.rb"), "Should find test_api.rb");
});

test("extractFilePaths: returns empty array for input without paths", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extractFilePaths("hello there, no paths here");
  assert.deepEqual(result, []);
});

test("extractFilePaths: deduplicates paths", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extractFilePaths(
    "check src/index.js and also look at src/index.js again"
  );
  const count = result.filter((f) => f === "src/index.js").length;
  assert.equal(count, 1, "Should deduplicate paths");
});

// ── extractCodeReferences ───────────────────────────────────────────

test("extractCodeReferences: finds explicitly mentioned function names", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extractCodeReferences(
    "the function getUserData in utils.ts and method handleSubmit in forms.ts"
  );
  assert.ok(result.functions.includes("getUserData"), "Should find getUserData");
  assert.ok(result.functions.includes("handleSubmit"), "Should find handleSubmit");
});

test("extractCodeReferences: finds class names", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extractCodeReferences(
    "the class UserController and component DashboardPage need updating"
  );
  assert.ok(result.classes.includes("UserController"), "Should find UserController");
  assert.ok(result.classes.includes("DashboardPage"), "Should find DashboardPage");
});

test("extractCodeReferences: finds snake_case identifiers", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extractCodeReferences(
    "the helper function get_user_by_id is in the database module"
  );
  assert.ok(result.functions.includes("get_user_by_id"), "Should find get_user_by_id");
});

test("extractCodeReferences: finds backtick-wrapped identifiers", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extractCodeReferences(
    "look at `calculateTotal` and `OrderValidator`"
  );
  assert.ok(result.functions.includes("calculateTotal"), "Should find calculateTotal");
  assert.ok(result.classes.includes("OrderValidator"), "Should find OrderValidator");
});

test("extractCodeReferences: filters common English PascalCase words", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extractCodeReferences(
    "Use JavaScript and TypeScript with React on Windows"
  );
  // These are common tech proper nouns, should not be reported as code references
  assert.ok(!result.classes.includes("JavaScript"), "JavaScript should be filtered out");
  assert.ok(!result.classes.includes("TypeScript"), "TypeScript should be filtered out");
  assert.ok(!result.classes.includes("Windows"), "Windows should be filtered out");
});

test("extractCodeReferences: returns empty for input without code refs", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extractCodeReferences("just a plain sentence with no code identifiers");
  assert.deepEqual(result.functions, []);
  assert.deepEqual(result.classes, []);
});

// ── extractTechnologies ─────────────────────────────────────────────

test("extractTechnologies: detects mentioned frameworks and tools", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extractTechnologies(
    "migrate the React app from webpack to vite and add TypeScript support"
  );
  assert.ok(result.includes("react"), "Should find react");
  assert.ok(result.includes("webpack"), "Should find webpack");
  assert.ok(result.includes("vite"), "Should find vite");
  assert.ok(result.includes("typescript"), "Should find typescript");
});

test("extractTechnologies: detects databases and infrastructure", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extractTechnologies(
    "deploy the PostgreSQL database to AWS using Docker and Kubernetes"
  );
  // PostgreSQL matches "postgresql" in the known tech list
  assert.ok(result.includes("postgresql"), "Should find postgresql");
  assert.ok(result.includes("aws"), "Should find aws");
  assert.ok(result.includes("docker"), "Should find docker");
  assert.ok(result.includes("kubernetes"), "Should find kubernetes");
});

test("extractTechnologies: supports custom technologies via constructor", () => {
  const extractor = new EntityExtractor({
    extraTechnologies: ["custom-framework", "internal-tool"],
  });

  const result = extractor.extractTechnologies(
    "we use custom-framework and internal-tool for this project"
  );
  assert.ok(result.includes("custom-framework"), "Should find custom tech");
  assert.ok(result.includes("internal-tool"), "Should find custom tech");
});

test("extractTechnologies: returns empty for no matches", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extractTechnologies("just some random text");
  assert.deepEqual(result, []);
});

// ── extract (full) ──────────────────────────────────────────────────

test("extract: returns all entity types", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extract(
    "review src/auth.ts function loginUser for security issues, see also commit abc1234f"
  );

  // Should have file paths
  assert.ok(result.filePaths.includes("src/auth.ts"), "Should extract file path");

  // Should have function names
  assert.ok(result.functionNames.includes("loginUser"), "Should extract function name");

  // Should have commit hashes
  assert.ok(result.commitHashes.includes("abc1234f"), "Should extract commit hash");

  // All keys should be present
  const expectedKeys = [
    "filePaths", "functionNames", "lineNumbers", "technologies",
    "errorMessages", "urls", "commitHashes", "branchNames", "versionNumbers",
  ];
  for (const key of expectedKeys) {
    assert.ok(Array.isArray(result[key]), `${key} should be an array`);
  }
});

test("extract: handles empty input gracefully", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extract("");
  const expectedKeys = [
    "filePaths", "functionNames", "lineNumbers", "technologies",
    "errorMessages", "urls", "commitHashes", "branchNames", "versionNumbers",
  ];
  for (const key of expectedKeys) {
    assert.deepEqual(result[key], [], `${key} should be empty array`);
  }
});

test("extract: extracts error messages from text", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extract(
    'I got an error "Cannot read property of undefined" when calling the API'
  );
  assert.ok(result.errorMessages.length > 0, "Should extract error messages");
  const found = result.errorMessages.some((m) =>
    m.includes("Cannot read property") || m.includes("undefined")
  );
  assert.ok(found, "Should find the error message");
});

test("extract: extracts version numbers", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extract(
    "upgrade from version 1.2.3 to 2.0.0-beta.1"
  );
  assert.ok(result.versionNumbers.includes("1.2.3"), "Should find 1.2.3");
  assert.ok(result.versionNumbers.includes("2.0.0-beta.1"), "Should find 2.0.0-beta.1");
});

test("extract: extracts branch names from text", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extract(
    "the bug is on branch feature/user-auth and we need to merge fix/login-crash"
  );
  assert.ok(result.branchNames.includes("feature/user-auth"), "Should find feature branch");
  assert.ok(result.branchNames.includes("fix/login-crash"), "Should find fix branch");
});

test("extract: extracts URLs from text", () => {
  const extractor = new EntityExtractor();

  const result = extractor.extract(
    "see the docs at https://example.com/api/v2 and https://docs.example.com/guide"
  );
  assert.ok(result.urls.includes("https://example.com/api/v2"), "Should find first URL");
  assert.ok(result.urls.includes("https://docs.example.com/guide"), "Should find second URL");
});

// ── Convenience exports ─────────────────────────────────────────────

test("extractEntities: convenience function works", () => {
  const result = extractEntities("refactor the UserService class in src/services/user.ts");
  assert.ok(result.filePaths.includes("src/services/user.ts"), "Should find file path");
});

test("extractFilePaths: convenience function works", () => {
  const result = extractFilePaths("check src/main.ts and lib/auth.js");
  assert.equal(result.length, 2);
});

test("extractCodeReferences: convenience function works", () => {
  const result = extractCodeReferences("the fetchData function and DataStore class");
  assert.ok(result.functions.includes("fetchData"));
  assert.ok(result.classes.includes("DataStore"));
});

test("extractTechnologies: convenience function works", () => {
  const result = extractTechnologies("build a next.js app with prisma and postgres");
  assert.ok(result.includes("next"));
  assert.ok(result.includes("prisma"));
  assert.ok(result.includes("postgres"));
});
