"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  TEMPLATES,
  listTemplateNames,
  getTemplate,
  generateSkillMarkdown,
  searchTemplates,
} = require("../src/skills/templates");

test("TEMPLATES contains all 8 expected templates", () => {
  const names = listTemplateNames();
  assert.equal(names.length, 8);
  const expected = [
    "code-review",
    "refactor",
    "write-tests",
    "explain-code",
    "debug-error",
    "write-docs",
    "optimize-perf",
    "generate-cli",
  ];
  for (const name of expected) {
    assert.ok(names.includes(name), `Missing template: ${name}`);
  }
});

test("Each template has required fields", () => {
  for (const [name, tmpl] of Object.entries(TEMPLATES)) {
    assert.ok(tmpl.name, `${name}: missing name`);
    assert.ok(tmpl.title, `${name}: missing title`);
    assert.ok(tmpl.description, `${name}: missing description`);
    assert.ok(tmpl.descriptionZh, `${name}: missing descriptionZh`);
    assert.ok(Array.isArray(tmpl.arguments), `${name}: arguments not an array`);
    assert.ok(Array.isArray(tmpl.recommendedTools), `${name}: recommendedTools not an array`);
    assert.ok(tmpl.systemPrompt, `${name}: missing systemPrompt`);
    assert.ok(tmpl.systemPrompt.length > 100, `${name}: systemPrompt too short`);
  }
});

test("getTemplate returns null for unknown template names", () => {
  assert.equal(getTemplate("non-existent"), null);
  assert.equal(getTemplate(""), null);
  assert.equal(getTemplate("invalid-name"), null);
});

test("getTemplate returns full template for valid names", () => {
  const codeReview = getTemplate("code-review");
  assert.equal(codeReview.name, "code-review");
  assert.equal(codeReview.title, "Code Review");
  assert.ok(codeReview.description.length > 0);
  assert.ok(codeReview.descriptionZh.length > 0);
  assert.ok(codeReview.systemPrompt.includes("Code Review"));
});

test("generateSkillMarkdown produces valid SKILL.md content", () => {
  const md = generateSkillMarkdown("code-review");
  assert.ok(md, "Should return a string");
  assert.ok(md.includes("---"), "Should have frontmatter");
  assert.ok(md.includes("name: code-review"), "Should include name");
  assert.ok(md.includes("description:"), "Should include description");
  assert.ok(md.includes("allowed-tools:"), "Should include allowed-tools");
  assert.ok(md.includes("arguments:"), "Should include arguments");
  assert.ok(md.includes("when_to_use:"), "Should include when_to_use");
  assert.ok(md.includes("# Code Review"), "Should include the title heading");
  assert.ok(md.includes("## Inputs"), "Should include steps");
  assert.ok(md.includes("## Goal"), "Should include goal section");
});

test("generateSkillMarkdown returns null for unknown template", () => {
  assert.equal(generateSkillMarkdown("nonexistent"), null);
});

test("generateSkillMarkdown applies overrides", () => {
  const md = generateSkillMarkdown("refactor", {
    title: "Custom Refactor",
    description: "My custom description",
    arguments: ["customArg"],
    recommendedTools: ["file.read"],
  });

  assert.ok(md);
  assert.ok(md.includes("# Custom Refactor"), "Should use custom title");
  assert.ok(md.includes("My custom description"), "Should use custom description");
  assert.ok(md.includes("- customArg"), "Should use custom arguments");
  assert.ok(md.includes("- file.read"), "Should use custom tools");
  // The body still contains the original variable references; overrides only
  // affect the frontmatter metadata, not the embedded markdown body.
  assert.ok(md.includes("$targetFiles"), "Original body variable references are preserved");
});

test("searchTemplates returns all templates for empty query", () => {
  const results = searchTemplates("");
  assert.equal(results.length, 8);
  assert.ok(results.every((r) => r.name && r.title));
});

test("searchTemplates matches by name", () => {
  const results = searchTemplates("code");
  assert.ok(results.length >= 2); // code-review, explain-code
  assert.ok(results.some((r) => r.name === "code-review"));
});

test("searchTemplates matches by title", () => {
  const results = searchTemplates("Debug");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "debug-error");
});

test("searchTemplates matches by description", () => {
  const results = searchTemplates("test cases");
  assert.ok(results.some((r) => r.name === "write-tests"));
});

test("searchTemplates matches by Chinese description", () => {
  const results = searchTemplates("审查代码");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "code-review");
});

test("searchTemplates returns empty for no matches", () => {
  const results = searchTemplates("xyzzy_plugh_nonexistent_term");
  assert.deepEqual(results, []);
});

test("searchTemplates is case-insensitive", () => {
  const lower = searchTemplates("refactor");
  const upper = searchTemplates("REFACTOR");
  assert.deepEqual(lower.map((r) => r.name), upper.map((r) => r.name));
});

test("Each template has a unique name", () => {
  const names = listTemplateNames();
  const unique = new Set(names);
  assert.equal(unique.size, names.length);
});

test("generateSkillMarkdown for all templates produces parseable frontmatter", () => {
  for (const name of listTemplateNames()) {
    const md = generateSkillMarkdown(name);
    assert.ok(md, `Should produce markdown for ${name}`);
    // Check frontmatter wrapper
    assert.ok(md.startsWith("---"), `${name}: should start with frontmatter`);
    const parts = md.split("---");
    assert.ok(parts.length >= 3, `${name}: should have valid frontmatter delimiters`);
  }
});

test("Each template systemPrompt includes key structural sections", () => {
  for (const [name, tmpl] of Object.entries(TEMPLATES)) {
    assert.ok(
      tmpl.systemPrompt.includes("## Inputs") || tmpl.systemPrompt.includes("## Goal"),
      `${name}: should include Inputs or Goal section`
    );
    assert.ok(
      tmpl.systemPrompt.includes("## Steps") || tmpl.systemPrompt.includes("### "),
      `${name}: should include Steps`
    );
    assert.ok(
      tmpl.systemPrompt.includes("Success criteria"),
      `${name}: should mention Success criteria`
    );
  }
});
