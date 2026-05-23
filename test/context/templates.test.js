/**
 * Tests for context templates: pre-built scenario templates for code review,
 * bug fixes, features, refactoring, explanation, and deployment.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CODE_REVIEW_CONTEXT,
  BUG_FIX_CONTEXT,
  FEATURE_CONTEXT,
  REFACTOR_CONTEXT,
  EXPLAIN_CONTEXT,
  DEPLOY_CONTEXT,
  getTemplate,
  listTemplates,
  detectTemplate,
  buildTemplateContext,
} = require("../../src/context/templates");

// ── Template structure ───────────────────────────────────────

function validateTemplate(name, template) {
  test(`${name}: has required shape (name, sections, tokenBudget, priority, format)`, () => {
    assert.ok(typeof template.name === "string" && template.name.length > 0, `${name}: name must be non-empty string`);
    assert.ok(Array.isArray(template.sections), `${name}: sections must be an array`);
    assert.ok(template.sections.length >= 3, `${name}: should have at least 3 sections, got ${template.sections.length}`);
    assert.ok(Number.isSafeInteger(template.tokenBudget) && template.tokenBudget > 0, `${name}: tokenBudget must be positive integer`);
    assert.ok(Number.isSafeInteger(template.priority), `${name}: priority must be integer`);
    assert.ok(["system", "prefix", "tool"].includes(template.format), `${name}: format must be one of system|prefix|tool`);
  });

  test(`${name}: sections have required fields`, () => {
    for (const section of template.sections) {
      assert.ok(typeof section.name === "string" && section.name.length > 0, `Section in ${name}: name required`);
      assert.ok(typeof section.key === "string" && section.key.length > 0, `Section in ${name}: key required`);
      assert.ok(typeof section.description === "string", `Section "${section.name}" in ${name}: description required`);
      assert.ok(typeof section.required === "boolean", `Section "${section.name}" in ${name}: required must be boolean`);
    }
  });

  test(`${name}: at least one required section`, () => {
    const required = template.sections.filter(s => s.required);
    assert.ok(required.length >= 1, `${name}: must have at least one required section`);
  });

  test(`${name}: is frozen (immutable)`, () => {
    assert.throws(() => { template.newProp = "value"; }, /object is not extensible/i);
  });
}

validateTemplate("CODE_REVIEW_CONTEXT", CODE_REVIEW_CONTEXT);
validateTemplate("BUG_FIX_CONTEXT", BUG_FIX_CONTEXT);
validateTemplate("FEATURE_CONTEXT", FEATURE_CONTEXT);
validateTemplate("REFACTOR_CONTEXT", REFACTOR_CONTEXT);
validateTemplate("EXPLAIN_CONTEXT", EXPLAIN_CONTEXT);
validateTemplate("DEPLOY_CONTEXT", DEPLOY_CONTEXT);

// ── Template content specifics ───────────────────────────────

test("CODE_REVIEW_CONTEXT: includes changed files and git diff as required", () => {
  const sections = CODE_REVIEW_CONTEXT.sections;
  const changedFiles = sections.find(s => s.key === "changedFiles");
  const gitDiff = sections.find(s => s.key === "gitDiff");
  assert.ok(changedFiles && changedFiles.required, "changedFiles should be required");
  assert.ok(gitDiff && gitDiff.required, "gitDiff should be required");
});

test("BUG_FIX_CONTEXT: includes error info and related files as required", () => {
  const sections = BUG_FIX_CONTEXT.sections;
  const errorInfo = sections.find(s => s.key === "errorInfo");
  const relatedFiles = sections.find(s => s.key === "relatedFiles");
  assert.ok(errorInfo && errorInfo.required, "errorInfo should be required");
  assert.ok(relatedFiles && relatedFiles.required, "relatedFiles should be required");
});

test("FEATURE_CONTEXT: includes project structure and dependencies as required", () => {
  const sections = FEATURE_CONTEXT.sections;
  const projectStructure = sections.find(s => s.key === "projectStructure");
  const deps = sections.find(s => s.key === "dependencies");
  assert.ok(projectStructure && projectStructure.required, "projectStructure should be required");
  assert.ok(deps && deps.required, "dependencies should be required");
});

test("REFACTOR_CONTEXT: includes code structure and dependencies as required", () => {
  const sections = REFACTOR_CONTEXT.sections;
  const codeStructure = sections.find(s => s.key === "codeStructure");
  const deps = sections.find(s => s.key === "dependencies");
  assert.ok(codeStructure && codeStructure.required, "codeStructure should be required");
  assert.ok(deps && deps.required, "dependencies should be required");
});

test("EXPLAIN_CONTEXT: includes file contents as required", () => {
  const sections = EXPLAIN_CONTEXT.sections;
  const fileContents = sections.find(s => s.key === "fileContents");
  assert.ok(fileContents && fileContents.required, "fileContents should be required");
});

test("DEPLOY_CONTEXT: uses system placement format", () => {
  assert.equal(DEPLOY_CONTEXT.format, "system");
});

// ── getTemplate ──────────────────────────────────────────────

test("getTemplate: returns template by exact name", () => {
  const t = getTemplate("code_review");
  assert.ok(t);
  assert.equal(t.name, "code_review");
});

test("getTemplate: returns template by alias", () => {
  assert.ok(getTemplate("review"));
  assert.ok(getTemplate("debug"));
  assert.ok(getTemplate("understand"));
  assert.ok(getTemplate("release"));
});

test("getTemplate: returns undefined for unknown name", () => {
  assert.equal(getTemplate("nonexistent"), undefined);
  assert.equal(getTemplate(""), undefined);
});

test("getTemplate: case insensitive", () => {
  assert.ok(getTemplate("CODE_REVIEW"));
  assert.ok(getTemplate("Bug_Fix"));
  assert.ok(getTemplate("Refactor"));
});

// ── listTemplates ────────────────────────────────────────────

test("listTemplates: returns all registered names and aliases", () => {
  const names = listTemplates();
  assert.ok(names.length >= 6);
  assert.ok(names.includes("code_review"));
  assert.ok(names.includes("review")); // alias
  assert.ok(names.includes("bug_fix"));
  assert.ok(names.includes("debug")); // alias
  assert.ok(names.includes("feature"));
  assert.ok(names.includes("explain"));
});

// ── detectTemplate ───────────────────────────────────────────

test("detectTemplate: detects bug fix from error keywords", () => {
  const t = detectTemplate("there is a crash in the auth module, help me fix it");
  assert.ok(t);
  assert.equal(t.name, "bug_fix");
});

test("detectTemplate: detects code review from review keywords", () => {
  const t = detectTemplate("review this pull request diff");
  assert.ok(t);
  assert.equal(t.name, "code_review");
});

test("detectTemplate: detects feature from add/create keywords", () => {
  const t = detectTemplate("implement a new REST API endpoint for users");
  assert.ok(t);
  assert.equal(t.name, "feature");
});

test("detectTemplate: detects refactor from restructure keywords", () => {
  const t = detectTemplate("refactor the authentication module to use async/await");
  assert.ok(t);
  assert.equal(t.name, "refactor");
});

test("detectTemplate: detects deploy from deployment keywords", () => {
  const t = detectTemplate("deploy the new version to production");
  assert.ok(t);
  assert.equal(t.name, "deploy");
});

test("detectTemplate: detects explain from documentation keywords", () => {
  const t = detectTemplate("explain how the file-context scoring works");
  assert.ok(t);
  assert.equal(t.name, "explain");
});

test("detectTemplate: returns null for unrecognized query", () => {
  assert.equal(detectTemplate(""), null);
  assert.equal(detectTemplate("hello world"), null);
  assert.equal(detectTemplate("what is the weather"), null);
});

// ── buildTemplateContext ─────────────────────────────────────

test("buildTemplateContext: fills template sections from data", () => {
  const data = {
    errorInfo: "TypeError: Cannot read property 'x' of undefined\n  at app.js:42",
    recentChanges: "Modified src/app.js",
    relatedFiles: "src/app.js: line 42",
    dependencies: "",
    testFiles: "",
  };
  const result = buildTemplateContext(BUG_FIX_CONTEXT, data);
  assert.equal(result.template, "bug_fix");
  assert.ok(result.sections.length >= 2);
  assert.ok(result.sections.some(s => s.key === "errorInfo"));
  assert.ok(result.sections.some(s => s.key === "recentChanges"));
});

test("buildTemplateContext: marks missing required sections", () => {
  const result = buildTemplateContext(BUG_FIX_CONTEXT, {});
  // Required sections without data should have placeholder text
  const requiredSections = result.sections.filter(s => s.required);
  assert.ok(requiredSections.length > 0);
  for (const sec of requiredSections) {
    assert.ok(sec.content.includes("not available"), `Section ${sec.key} content: ${sec.content}`);
  }
});

test("buildTemplateContext: filters out empty optional sections", () => {
  const data = {
    fileContents: "console.log('hello');",
    imports: "",
    documentation: "",
    dependencies: "",
    usageExamples: "",
  };
  const result = buildTemplateContext(EXPLAIN_CONTEXT, data);
  // Only fileContents should appear (only required + non-empty optional)
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].key, "fileContents");
});

test("buildTemplateContext: uses template default placement and budget", () => {
  const data = {
    changedFiles: "src/index.js",
    gitDiff: "+ console.log('test');",
  };
  const result = buildTemplateContext(CODE_REVIEW_CONTEXT, data);
  assert.equal(result.placement, "prefix");
  assert.equal(result.tokenBudget, 14000);
});

test("buildTemplateContext: override placement and budget via options", () => {
  const data = {
    changedFiles: "src/index.js",
    gitDiff: "diff content",
  };
  const result = buildTemplateContext(CODE_REVIEW_CONTEXT, data, {
    placement: "system",
    tokenBudget: 5000,
  });
  assert.equal(result.placement, "system");
  assert.equal(result.tokenBudget, 5000);
});

test("buildTemplateContext: handles null template gracefully", () => {
  const result = buildTemplateContext(null, {});
  assert.equal(result.template, "unknown");
  assert.equal(result.sections.length, 0);
  assert.equal(result.placement, "prefix");
  assert.ok(result.tokenBudget > 0);
});
