/**
 * Tests for WorkflowLibrary: registration, search, instantiation, export/import.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { WorkflowLibrary, CATEGORIES } = require("../../src/workflow/library");

// Helper to create a minimal template
function makeTemplate(overrides = {}) {
  return {
    name: overrides.name || "test-template",
    description: overrides.description || "A test template",
    category: overrides.category || "Testing",
    tags: overrides.tags || ["test"],
    version: overrides.version || "1.0.0",
    params: overrides.params || [],
    steps: overrides.steps || [
      {
        id: "step1",
        name: "First step",
        type: "tool",
        config: { tool: "shell.run", command: "echo hello" },
        dependsOn: [],
      },
    ],
  };
}

// ---- Registration ----

test("WorkflowLibrary: constructor registers 12+ built-in templates", () => {
  const lib = new WorkflowLibrary();
  const stats = lib.stats();
  assert.ok(stats.total >= 12, `Expected >= 12 built-in templates, got ${stats.total}`);
});

test("WorkflowLibrary: register() adds a custom template", () => {
  const lib = new WorkflowLibrary();
  const before = lib.stats().total;

  lib.register(makeTemplate({ name: "my-custom", category: "Custom" }));

  const stats = lib.stats();
  assert.equal(stats.total, before + 1);
  assert.ok(lib.get("my-custom"));
});

test("WorkflowLibrary: register() rejects invalid input", () => {
  const lib = new WorkflowLibrary();

  assert.throws(() => lib.register(null), /must be an object/);
  assert.throws(() => lib.register({}), /must have a non-empty string name/);
  assert.throws(() => lib.register({ name: "x" }), /must have a steps array/);
  assert.throws(() => lib.register({ name: "", steps: [] }), /non-empty string name/);
});

test("WorkflowLibrary: register() defaults unknown category to Custom", () => {
  const lib = new WorkflowLibrary();

  lib.register(makeTemplate({ name: "weird-cat", category: "UnknownStuff" }));
  const tmpl = lib.get("weird-cat");

  assert.equal(tmpl.category, "Custom");
});

test("WorkflowLibrary: unregister() removes a template", () => {
  const lib = new WorkflowLibrary();

  lib.register(makeTemplate({ name: "temp" }));
  assert.ok(lib.get("temp"));

  const removed = lib.unregister("temp");
  assert.equal(removed, true);
  assert.equal(lib.get("temp"), undefined);
});

test("WorkflowLibrary: unregister() returns false for unknown", () => {
  const lib = new WorkflowLibrary();
  assert.equal(lib.unregister("nonexistent"), false);
});

test("WorkflowLibrary: get() returns a deep clone", () => {
  const lib = new WorkflowLibrary();

  lib.register(makeTemplate({ name: "clonetest" }));
  const copy1 = lib.get("clonetest");
  const copy2 = lib.get("clonetest");

  copy1.description = "modified";
  assert.notEqual(copy1.description, copy2.description);
  assert.notStrictEqual(copy1, copy2);
});

// ---- Listing / Categories ----

test("WorkflowLibrary: list() returns all template summaries", () => {
  const lib = new WorkflowLibrary();
  const all = lib.list();

  assert.ok(Array.isArray(all));
  assert.ok(all.length >= 12);

  for (const entry of all) {
    assert.ok(entry.name);
    assert.ok(entry.category);
    assert.ok(typeof entry.stepCount === "number");
    assert.ok(typeof entry.usageCount === "number");
  }
});

test("WorkflowLibrary: list() filters by category", () => {
  const lib = new WorkflowLibrary();

  const cicd = lib.list("CI/CD");
  for (const e of cicd) {
    assert.equal(e.category, "CI/CD");
  }

  const sec = lib.list("Security");
  for (const e of sec) {
    assert.equal(e.category, "Security");
  }

  assert.ok(cicd.length >= 1);
  assert.ok(sec.length >= 1);
});

test("WorkflowLibrary: categories() returns distinct categories", () => {
  const lib = new WorkflowLibrary();
  const cats = lib.categories();

  assert.ok(Array.isArray(cats));
  assert.ok(cats.length >= 1);
  assert.ok(cats.includes("CI/CD"));
  // Should be sorted
  for (let i = 1; i < cats.length; i++) {
    assert.ok(cats[i] > cats[i - 1], "Categories should be sorted");
  }
});

test("WorkflowLibrary: stats() returns counts per category", () => {
  const lib = new WorkflowLibrary();
  const stats = lib.stats();

  assert.ok(typeof stats.total === "number");
  assert.ok(typeof stats.byCategory === "object");
  assert.ok(typeof stats.totalUsage === "number");

  // Verify byCategory sums to total
  const sum = Object.values(stats.byCategory).reduce((a, b) => a + b, 0);
  assert.equal(sum, stats.total);
});

// ---- Search ----

test("WorkflowLibrary: search() finds templates by name", () => {
  const lib = new WorkflowLibrary();
  const results = lib.search("ci-build");

  assert.ok(results.length >= 1);
  assert.equal(results[0].name, "ci-build-pipeline");
});

test("WorkflowLibrary: search() finds templates by category", () => {
  const lib = new WorkflowLibrary();
  const results = lib.search("Security");

  assert.ok(results.length >= 1);
  for (const r of results) {
    assert.equal(r.category, "Security");
  }
});

test("WorkflowLibrary: search() finds templates by tag", () => {
  const lib = new WorkflowLibrary();
  const results = lib.search("canary");

  assert.ok(results.length >= 1);
  const found = results.some((r) => r.tags.includes("canary"));
  assert.ok(found, "Should find template tagged 'canary'");
});

test("WorkflowLibrary: search() returns empty for no match", () => {
  const lib = new WorkflowLibrary();
  const results = lib.search("zzzNONEXISTENTzzz");

  assert.deepEqual(results, []);
});

test("WorkflowLibrary: search() returns empty for empty query", () => {
  const lib = new WorkflowLibrary();
  assert.deepEqual(lib.search(""), []);
  assert.deepEqual(lib.search("   "), []);
});

test("WorkflowLibrary: search() returns empty for non-string input", () => {
  const lib = new WorkflowLibrary();
  assert.deepEqual(lib.search(null), []);
  assert.deepEqual(lib.search(undefined), []);
});

// ---- Instantiation ----

test("WorkflowLibrary: instantiate() creates a runnable instance", () => {
  const lib = new WorkflowLibrary();
  const instance = lib.instantiate("ci-build-pipeline");

  assert.equal(instance.name, "ci-build-pipeline");
  assert.ok(instance.description);
  assert.equal(instance.templateVersion, "1.0.0");
  assert.ok(instance.templateId);
  assert.ok(instance.instantiatedAt);
  assert.ok(Array.isArray(instance.steps));
  assert.ok(instance.steps.length >= 2);
});

test("WorkflowLibrary: instantiate() applies parameter substitution", () => {
  const lib = new WorkflowLibrary();

  // Register a template with a parameter
  lib.register(makeTemplate({
    name: "param-test",
    category: "Custom",
    params: [
      { name: "greeting", type: "string", default: "hello", required: false },
    ],
    steps: [
      {
        id: "echo",
        name: "Echo",
        type: "tool",
        config: { tool: "shell.run", command: "echo {{greeting}}" },
        dependsOn: [],
      },
    ],
  }));

  const instance = lib.instantiate("param-test", { greeting: "bonjour" });
  assert.equal(instance.steps[0].config.command, "echo bonjour");
});

test("WorkflowLibrary: instantiate() leaves unresolved params as-is", () => {
  const lib = new WorkflowLibrary();

  lib.register(makeTemplate({
    name: "unresolved-test",
    category: "Custom",
    steps: [
      {
        id: "echo",
        name: "Echo",
        type: "tool",
        config: { tool: "shell.run", command: "echo {{nonexistent}}" },
        dependsOn: [],
      },
    ],
  }));

  const instance = lib.instantiate("unresolved-test");
  // Unresolved param should remain as the template string
  assert.equal(instance.steps[0].config.command, "echo {{nonexistent}}");
});

test("WorkflowLibrary: instantiate() throws on missing required params", () => {
  const lib = new WorkflowLibrary();

  lib.register(makeTemplate({
    name: "required-param-test",
    category: "Custom",
    params: [
      { name: "target", type: "string", required: true },
    ],
    steps: [
      { id: "s1", type: "tool", config: {}, dependsOn: [] },
    ],
  }));

  assert.throws(
    () => lib.instantiate("required-param-test"),
    /requires parameters: target/,
  );
});

test("WorkflowLibrary: instantiate() increments usage counter", () => {
  const lib = new WorkflowLibrary();

  lib.register(makeTemplate({ name: "usage-test", category: "Custom" }));

  const before = lib.get("usage-test").usageCount;
  lib.instantiate("usage-test");
  lib.instantiate("usage-test");
  const after = lib.get("usage-test").usageCount;

  assert.equal(after, before + 2);
});

test("WorkflowLibrary: instantiate() throws for unknown template", () => {
  const lib = new WorkflowLibrary();

  assert.throws(
    () => lib.instantiate("nonexistent"),
    /Unknown template/,
  );
});

// ---- Export ----

test("WorkflowLibrary: exportTemplate() as JSON", () => {
  const lib = new WorkflowLibrary();
  const exported = lib.exportTemplate("ci-build-pipeline", "json");

  const parsed = JSON.parse(exported);
  assert.equal(parsed.name, "ci-build-pipeline");
  assert.equal(parsed.category, "CI/CD");
  assert.ok(Array.isArray(parsed.steps));
  assert.ok(Array.isArray(parsed.tags));
});

test("WorkflowLibrary: exportTemplate() as DSL/YAML", () => {
  const lib = new WorkflowLibrary();
  const exported = lib.exportTemplate("security-scan-pipeline", "dsl");

  assert.ok(typeof exported === "string");
  assert.ok(exported.includes("security-scan-pipeline"));
  assert.ok(exported.includes("Security"));
  assert.ok(exported.includes("steps:"));
});

test("WorkflowLibrary: exportTemplate() throws for unknown format", () => {
  const lib = new WorkflowLibrary();

  assert.throws(
    () => lib.exportTemplate("ci-build-pipeline", "xml"),
    /Unsupported format/,
  );
});

test("WorkflowLibrary: exportTemplate() throws for unknown template", () => {
  const lib = new WorkflowLibrary();

  assert.throws(
    () => lib.exportTemplate("nonexistent", "json"),
    /Unknown template/,
  );
});

// ---- Import ----

test("WorkflowLibrary: importDefinition() from JSON object", () => {
  const lib = new WorkflowLibrary();
  const before = lib.stats().total;

  lib.importDefinition({
    name: "imported-json",
    description: "Imported via JSON",
    category: "DataProcessing",
    tags: ["import"],
    steps: [
      { id: "s1", type: "tool", config: { tool: "shell.run", command: "echo imported" }, dependsOn: [] },
    ],
  });

  const stats = lib.stats();
  assert.equal(stats.total, before + 1);

  const imported = lib.get("imported-json");
  assert.equal(imported.name, "imported-json");
  assert.equal(imported.category, "DataProcessing");
  assert.equal(imported.steps.length, 1);
});

test("WorkflowLibrary: importDefinition() from DSL string", () => {
  const lib = new WorkflowLibrary();
  const before = lib.stats().total;

  const dsl = [
    "workflow: imported-dsl",
    "description: Imported from DSL",
    "steps:",
    "  - id: lint",
    "    type: tool",
    "    tool: shell.run",
    "    args:",
    "      command: npm run lint",
  ].join("\n");

  lib.importDefinition(dsl);

  const stats = lib.stats();
  assert.equal(stats.total, before + 1);

  const imported = lib.get("imported-dsl");
  assert.equal(imported.name, "imported-dsl");
  assert.equal(imported.description, "Imported from DSL");
});

test("WorkflowLibrary: importDefinition() rejects invalid input", () => {
  const lib = new WorkflowLibrary();

  assert.throws(
    () => lib.importDefinition(null),
    /must be a DSL string or JSON object/,
  );

  assert.throws(
    () => lib.importDefinition(42),
    /must be a DSL string or JSON object/,
  );
});

test("WorkflowLibrary: importDefinition() rejects object without name", () => {
  const lib = new WorkflowLibrary();

  assert.throws(
    () => lib.importDefinition({ steps: [] }),
    /must have a name/,
  );
});

test("WorkflowLibrary: importDefinition() rejects object without steps", () => {
  const lib = new WorkflowLibrary();

  assert.throws(
    () => lib.importDefinition({ name: "bad" }),
    /must have steps/,
  );
});

// ---- Built-in template coverage ----

test("WorkflowLibrary: all 8 categories have at least one template", () => {
  const lib = new WorkflowLibrary();
  const stats = lib.stats();

  const expected = ["CI/CD", "CodeReview", "Custom", "DataProcessing", "Deployment", "Documentation", "Security", "Testing"];
  for (const cat of expected) {
    assert.ok(stats.byCategory[cat] >= 1, `Category "${cat}" should have at least 1 template`);
  }
});

test("WorkflowLibrary: each built-in template can be instantiated", () => {
  const lib = new WorkflowLibrary();
  const all = lib.list();

  // Map of templates that require specific params to instantiate
  const requiredParams = {
    "pr-review-pipeline": { prNumber: "42" },
  };

  for (const entry of all) {
    const params = requiredParams[entry.name] || {};
    const instance = lib.instantiate(entry.name, params);
    assert.equal(instance.name, entry.name);
    assert.ok(Array.isArray(instance.steps));
    assert.ok(instance.steps.length > 0, `Template "${entry.name}" should have steps`);
    // Verify each step has required fields
    for (const step of instance.steps) {
      assert.ok(step.id, `Step in "${entry.name}" must have id`);
      assert.ok(step.type, `Step "${step.id}" in "${entry.name}" must have type`);
    }
  }
});

test("WorkflowLibrary: ci-cd-full template requires prNumber parameter", () => {
  const lib = new WorkflowLibrary();

  assert.throws(
    () => lib.instantiate("pr-review-pipeline"),
    /requires parameters: prNumber/,
  );

  // Should work with the required param
  const instance = lib.instantiate("pr-review-pipeline", { prNumber: "42" });
  assert.equal(instance.name, "pr-review-pipeline");
});

test("WorkflowLibrary: instantiate() with params applies to nested config", () => {
  const lib = new WorkflowLibrary();

  lib.register(makeTemplate({
    name: "nested-config-test",
    category: "Custom",
    params: [
      { name: "service", type: "string", default: "api", required: false },
    ],
    steps: [
      {
        id: "check",
        name: "Check service",
        type: "tool",
        config: {
          tool: "http.get",
          url: "https://{{service}}.example.com/health",
          headers: { "X-Service": "{{service}}" },
        },
        dependsOn: [],
      },
    ],
  }));

  const instance = lib.instantiate("nested-config-test", { service: "gateway" });
  assert.equal(instance.steps[0].config.url, "https://gateway.example.com/health");
  assert.equal(instance.steps[0].config.headers["X-Service"], "gateway");
});

test("WorkflowLibrary: get() returns undefined for missing template", () => {
  const lib = new WorkflowLibrary();
  assert.equal(lib.get("not-registered"), undefined);
});
