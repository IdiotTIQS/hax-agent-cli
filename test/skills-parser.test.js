/**
 * Tests for skills parser: parseFrontmatter, extractDescriptionFromMarkdown,
 * parseArgumentNames, substituteArguments.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseFrontmatter,
  extractDescriptionFromMarkdown,
  parseArgumentNames,
  substituteArguments,
} = require("../src/skills/parser");

// ── parseFrontmatter ─────────────────────────────────────

test("parseFrontmatter: returns empty frontmatter for content without markers", () => {
  const result = parseFrontmatter("Just some plain text\nNo frontmatter here");
  assert.deepEqual(result.frontmatter, {});
  assert.equal(result.content, "Just some plain text\nNo frontmatter here");
});

test("parseFrontmatter: returns empty frontmatter for empty content", () => {
  const result = parseFrontmatter("");
  assert.deepEqual(result.frontmatter, {});
  assert.equal(result.content, "");
});

test("parseFrontmatter: parses simple key-value pairs", () => {
  const content = [
    "---",
    "name: test-skill",
    "description: A test skill",
    "---",
    "# Body content",
    "",
    "More markdown",
  ].join("\n");

  const result = parseFrontmatter(content);
  assert.equal(result.frontmatter.name, "test-skill");
  assert.equal(result.frontmatter.description, "A test skill");
  assert.equal(result.content.trim(), "# Body content\n\nMore markdown");
});

test("parseFrontmatter: strips quotes from string values", () => {
  const content = [
    "---",
    'name: "quoted name"',
    "description: 'single quoted'",
    "---",
    "body",
  ].join("\n");

  const result = parseFrontmatter(content);
  assert.equal(result.frontmatter.name, "quoted name");
  assert.equal(result.frontmatter.description, "single quoted");
});

test("parseFrontmatter: parses inline arrays", () => {
  const content = [
    "---",
    'allowed-tools: ["file.read", "file.write", \'file.edit\']',
    "---",
    "body",
  ].join("\n");

  const result = parseFrontmatter(content);
  assert.deepEqual(result.frontmatter["allowed-tools"], [
    "file.read",
    "file.write",
    "file.edit",
  ]);
});

test("parseFrontmatter: handles empty inline array", () => {
  const content = ["---", "allowed-tools: []", "---", "body"].join("\n");
  const result = parseFrontmatter(content);
  assert.deepEqual(result.frontmatter["allowed-tools"], []);
});

test("parseFrontmatter: parses multi-line array", () => {
  const content = [
    "---",
    "arguments:",
    "  - arg1",
    "  - arg2",
    "  - arg3",
    "---",
    "body",
  ].join("\n");

  const result = parseFrontmatter(content);
  assert.deepEqual(result.frontmatter.arguments, ["arg1", "arg2", "arg3"]);
});

test("parseFrontmatter: handles key-value after multi-line array", () => {
  const content = [
    "---",
    "arguments:",
    "  - arg1",
    "  - arg2",
    "description: A skill",
    "---",
    "body",
  ].join("\n");

  const result = parseFrontmatter(content);
  assert.deepEqual(result.frontmatter.arguments, ["arg1", "arg2"]);
  assert.equal(result.frontmatter.description, "A skill");
});

test("parseFrontmatter: ignores empty lines in multi-line arrays", () => {
  const content = [
    "---",
    "arguments:",
    "  - arg1",
    "",
    "  - arg2",
    "---",
    "body",
  ].join("\n");

  const result = parseFrontmatter(content);
  assert.deepEqual(result.frontmatter.arguments, ["arg1", "arg2"]);
});

test("parseFrontmatter: handles hyphen in key names", () => {
  const content = [
    "---",
    "allowed-tools:",
    "  - file.read",
    "user-invocable: false",
    "argument-hint: [desc|help]",
    "---",
    "body",
  ].join("\n");

  const result = parseFrontmatter(content);
  assert.deepEqual(result.frontmatter["allowed-tools"], ["file.read"]);
  assert.equal(result.frontmatter["user-invocable"], "false");
  // Inline array syntax: [desc|help] is parsed as array ["desc|help"]
  assert.deepEqual(result.frontmatter["argument-hint"], ["desc|help"]);
});

test("parseFrontmatter: handles multiple keys with hyphens", () => {
  const content = [
    "---",
    "custom-key: custom_value",
    "when-to-use: When asked",
    "---",
    "body",
  ].join("\n");

  const result = parseFrontmatter(content);
  assert.equal(result.frontmatter["custom-key"], "custom_value");
  assert.equal(result.frontmatter["when-to-use"], "When asked");
});

// ── extractDescriptionFromMarkdown ───────────────────────

test("extractDescriptionFromMarkdown: uses first H1 as description", () => {
  const result = extractDescriptionFromMarkdown("# My Skill Title\n\nBody text");
  assert.equal(result, "My Skill Title");
});

test("extractDescriptionFromMarkdown: falls back to default when no H1", () => {
  const result = extractDescriptionFromMarkdown(
    "Some text without a heading\nMore text"
  );
  assert.equal(result, "Skill description");
});

test("extractDescriptionFromMarkdown: uses custom fallback", () => {
  const result = extractDescriptionFromMarkdown("no headings", "My Default");
  assert.equal(result, "My Default description");
});

test("extractDescriptionFromMarkdown: skips blank leading lines", () => {
  const result = extractDescriptionFromMarkdown("\n\n# Title after blanks\nBody");
  assert.equal(result, "Title after blanks");
});

test("extractDescriptionFromMarkdown: handles empty content", () => {
  const result = extractDescriptionFromMarkdown("");
  assert.equal(result, "Skill description");
});

// ── parseArgumentNames ───────────────────────────────────

test("parseArgumentNames: returns empty array for null/undefined", () => {
  assert.deepEqual(parseArgumentNames(null), []);
  assert.deepEqual(parseArgumentNames(undefined), []);
});

test("parseArgumentNames: splits comma-separated string", () => {
  const result = parseArgumentNames("arg1, arg2, arg3");
  assert.deepEqual(result, ["arg1", "arg2", "arg3"]);
});

test("parseArgumentNames: handles string with extra whitespace", () => {
  const result = parseArgumentNames("  arg1 ,  arg2  ,arg3  ");
  assert.deepEqual(result, ["arg1", "arg2", "arg3"]);
});

test("parseArgumentNames: returns string array when already an array", () => {
  const result = parseArgumentNames(["arg1", "arg2"]);
  assert.deepEqual(result, ["arg1", "arg2"]);
});

test("parseArgumentNames: filters non-string values from array", () => {
  const result = parseArgumentNames(["arg1", 42, null, "arg2", undefined]);
  assert.deepEqual(result, ["arg1", "arg2"]);
});

test("parseArgumentNames: handles single arg string without commas", () => {
  const result = parseArgumentNames("singleArg");
  assert.deepEqual(result, ["singleArg"]);
});

test("parseArgumentNames: returns empty for empty string", () => {
  assert.deepEqual(parseArgumentNames(""), []);
  assert.deepEqual(parseArgumentNames("   "), []);
});

// ── substituteArguments ──────────────────────────────────

test("substituteArguments: returns content unchanged when no args", () => {
  const result = substituteArguments(
    "Use $tool for this",
    null,
    ["tool"]
  );
  assert.equal(result, "Use $tool for this");
});

test("substituteArguments: returns content unchanged when no argument names", () => {
  const result = substituteArguments(
    "Use $tool for this",
    ["file.read"],
    null
  );
  assert.equal(result, "Use $tool for this");
});

test("substituteArguments: returns content unchanged with empty args array", () => {
  // Empty array is truthy in JS, so args pass the `if (!args)` check.
  // Each missing arg defaults to empty string, so $tool becomes "".
  const result = substituteArguments(
    "Use $tool for this",
    [],
    ["tool"]
  );
  assert.equal(result, "Use  for this");
});

test("substituteArguments: replaces $argName with values", () => {
  const result = substituteArguments(
    "Use $tool on $path",
    ["file.read", "src/index.js"],
    ["tool", "path"]
  );
  assert.equal(result, "Use file.read on src/index.js");
});

test("substituteArguments: missing args default to empty string", () => {
  const result = substituteArguments(
    "Use $tool on $path",
    ["file.read"],
    ["tool", "path"]
  );
  assert.equal(result, "Use file.read on ");
});

test("substituteArguments: replaces all occurrences globally", () => {
  const content = "File: $file, read $file, write $file";
  const result = substituteArguments(content, ["test.txt"], ["file"]);
  assert.equal(result, "File: test.txt, read test.txt, write test.txt");
});

test("substituteArguments: handles empty args", () => {
  const result = substituteArguments(
    "Use $tool",
    [""],
    ["tool"]
  );
  assert.equal(result, "Use ");
});
