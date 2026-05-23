"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { TemplateEngine } = require("../../src/optimizer/template-engine");

// ---------------------------------------------------------------------------
// TemplateEngine: compile
// ---------------------------------------------------------------------------

test("compile: substitutes simple variables", () => {
  const engine = new TemplateEngine();
  const template = "Hello, {{name}}! Your role is {{role}}.";
  const result = engine.compile(template, { name: "Alice", role: "admin" });

  assert.equal(result, "Hello, Alice! Your role is admin.");
});

test("compile: handles missing variables gracefully", () => {
  const engine = new TemplateEngine();
  const result = engine.compile("Hello, {{name}}!", {});

  assert.equal(result, "Hello, !");
});

test("compile: renders conditional blocks when variable is truthy", () => {
  const engine = new TemplateEngine();
  const template = "{{#if show}}Visible content{{/if}} After.";

  assert.equal(engine.compile(template, { show: true }), "Visible content After.");
  assert.equal(engine.compile(template, { show: false }), " After.");
  assert.equal(engine.compile(template, {}), " After.");
});

test("compile: renders each block iterating over array", () => {
  const engine = new TemplateEngine();
  const template = "Items:\n{{#each items}}- {{name}}: {{score}}\n{{/each}}End.";

  const variables = {
    items: [
      { name: "apple", score: 10 },
      { name: "banana", score: 20 },
    ],
  };

  const result = engine.compile(template, variables);

  assert.ok(result.includes("- apple: 10"), `got: ${result}`);
  assert.ok(result.includes("- banana: 20"));
  assert.ok(result.includes("End."));
  assert.ok(result.indexOf("apple") < result.indexOf("banana"),
    "items should appear in order");
});

test("compile: returns empty string for empty template", () => {
  const engine = new TemplateEngine();
  assert.equal(engine.compile("", { name: "test" }), "");
  assert.equal(engine.compile(null, { name: "test" }), "");
});

test("compile: resolves dot-separated nested paths", () => {
  const engine = new TemplateEngine();
  const template = "User: {{user.name}}, City: {{user.address.city}}";
  const variables = {
    user: {
      name: "Bob",
      address: { city: "Paris" },
    },
  };

  const result = engine.compile(template, variables);
  assert.equal(result, "User: Bob, City: Paris");
});

test("compile: nested conditionals and each blocks work together", () => {
  const engine = new TemplateEngine();
  const template = "{{#if showList}}{{#each items}}{{name}},{{/each}}{{/if}}";

  const result = engine.compile(template, {
    showList: true,
    items: [{ name: "a" }, { name: "b" }],
  });

  assert.equal(result, "a,b,");
});

test("compile: empty each block produces no output", () => {
  const engine = new TemplateEngine();
  const template = "Before. {{#each items}}Item: {{name}}{{/each}} After.";

  const result = engine.compile(template, { items: [] });

  assert.equal(result, "Before.  After.");
});

// ---------------------------------------------------------------------------
// TemplateEngine: optimizeTemplate
// ---------------------------------------------------------------------------

test("optimizeTemplate: removes empty conditional blocks", () => {
  const engine = new TemplateEngine();
  const template = "Before. {{#if unused}}{{/if}} Middle. {{#if unused2}}{{/if}} After.";
  const optimized = engine.optimizeTemplate(template);

  assert.ok(!optimized.includes("{{#if"), "should remove empty if blocks");
  assert.ok(optimized.includes("Before."));
  assert.ok(optimized.includes("Middle."));
  assert.ok(optimized.includes("After."));
});

test("optimizeTemplate: removes empty each blocks", () => {
  const engine = new TemplateEngine();
  const template = "Start. {{#each items}}{{/each}} End.";
  const optimized = engine.optimizeTemplate(template);

  assert.ok(!optimized.includes("{{#each"), "should remove empty each blocks");
  assert.ok(optimized.includes("Start."));
  assert.ok(optimized.includes("End."));
});

test("optimizeTemplate: collapses excess blank lines", () => {
  const engine = new TemplateEngine();
  const template = "Line 1\n\n\n\nLine 2\n\n\nLine 3";
  const optimized = engine.optimizeTemplate(template);

  assert.ok(!optimized.includes("\n\n\n"), "should not have triple newlines");
  assert.ok(optimized.includes("Line 1"));
  assert.ok(optimized.includes("Line 2"));
  assert.ok(optimized.includes("Line 3"));
});

test("optimizeTemplate: trims leading and trailing blank lines", () => {
  const engine = new TemplateEngine();
  const template = "\n\n\nHello\nWorld\n\n\n";
  const optimized = engine.optimizeTemplate(template);

  assert.equal(optimized, "Hello\nWorld");
});

// ---------------------------------------------------------------------------
// TemplateEngine: extractVariables
// ---------------------------------------------------------------------------

test("extractVariables: finds all simple variable references", () => {
  const engine = new TemplateEngine();
  const template = "{{name}} and {{role}} are here.";
  const vars = engine.extractVariables(template);

  assert.deepEqual(vars, ["name", "role"]);
});

test("extractVariables: finds variables in condition and each blocks", () => {
  const engine = new TemplateEngine();
  const template = "{{#if show}}{{#each items}}{{title}}{{/each}}{{/if}}";
  const vars = engine.extractVariables(template);

  assert.ok(vars.includes("show"));
  assert.ok(vars.includes("items"));
  assert.ok(vars.includes("title"));
});

test("extractVariables: returns sorted unique list with no duplicates", () => {
  const engine = new TemplateEngine();
  const template = "{{name}} {{name}} {{name}} {{role}}";
  const vars = engine.extractVariables(template);

  assert.deepEqual(vars, ["name", "role"]);
  assert.equal(vars.length, 2);
});

test("extractVariables: returns empty array for template with no variables", () => {
  const engine = new TemplateEngine();
  const vars = engine.extractVariables("Just plain text, no variables.");
  assert.deepEqual(vars, []);
});

// ---------------------------------------------------------------------------
// TemplateEngine: validateTemplate
// ---------------------------------------------------------------------------

test("validateTemplate: passes for a well-formed template", () => {
  const engine = new TemplateEngine();
  const result = engine.validateTemplate("Hello, {{name}}! {{#if show}}Yes{{/if}}");

  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validateTemplate: detects unclosed if block", () => {
  const engine = new TemplateEngine();
  const result = engine.validateTemplate("{{#if show}}No closing tag...");

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Unclosed")),
    `should have unclosed error, got: ${result.errors.join("; ")}`);
});

test("validateTemplate: detects mismatched block types", () => {
  const engine = new TemplateEngine();
  const result = engine.validateTemplate("{{#if show}}{{/each}}");

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Mismatched")),
    `should have mismatched error, got: ${result.errors.join("; ")}`);
});

test("validateTemplate: detects unexpected closing tag", () => {
  const engine = new TemplateEngine();
  const result = engine.validateTemplate("{{/if}}");

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Unexpected")),
    `should have unexpected error, got: ${result.errors.join("; ")}`);
});

test("validateTemplate: detects empty variable references", () => {
  const engine = new TemplateEngine();
  const result = engine.validateTemplate("Hello, {{ }}!");

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Empty variable")),
    `should have empty var error, got: ${result.errors.join("; ")}`);
});

test("validateTemplate: detects mismatched brace count", () => {
  const engine = new TemplateEngine();
  const result = engine.validateTemplate("Hello, {{name}");

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Mismatched curly")),
    `should have brace mismatch error, got: ${result.errors.join("; ")}`);
});

// ---------------------------------------------------------------------------
// TemplateEngine: caching
// ---------------------------------------------------------------------------

test("compile: caches compiled templates for repeated use", () => {
  const engine = new TemplateEngine();

  assert.equal(engine.getCacheSize(), 0);

  engine.compile("{{name}}", { name: "Alice" });
  assert.equal(engine.getCacheSize(), 1, "should have one cached template");

  // Same template — should hit cache.
  engine.compile("{{name}}", { name: "Bob" });
  assert.equal(engine.getCacheSize(), 1, "cache should not grow for same template");

  // Different template — should add to cache.
  engine.compile("{{role}}", { role: "admin" });
  assert.equal(engine.getCacheSize(), 2);
});

test("compile: skips cache when noCache option is set", () => {
  const engine = new TemplateEngine();

  engine.compile("{{name}}", { name: "Alice" }, { noCache: true });
  assert.equal(engine.getCacheSize(), 0, "should not cache when noCache is true");
});

test("clearCache: empties the cache", () => {
  const engine = new TemplateEngine();

  engine.compile("{{name}}", { name: "Alice" });
  engine.compile("{{role}}", { role: "admin" });
  assert.equal(engine.getCacheSize(), 2);

  engine.clearCache();
  assert.equal(engine.getCacheSize(), 0);
});
