"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { WorkflowValidator } = require("../../src/workflow/validator");

const validator = new WorkflowValidator();

// Helper: a minimal valid workflow
function validWorkflow(overrides = {}) {
  return {
    name: "test-workflow",
    steps: [
      { id: "lint", name: "Lint code", type: "tool", config: { handler: () => {} }, dependsOn: [] },
      { id: "build", name: "Build project", type: "tool", config: { handler: () => {} }, dependsOn: ["lint"] },
    ],
    ...overrides,
  };
}

// ---- validate ----

test("validate: returns valid for a well-formed workflow", () => {
  const result = validator.validate(validWorkflow());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validate: rejects non-object workflow", () => {
  const result = validator.validate(null);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("must be an object")));
});

test("validate: rejects workflow with missing name", () => {
  const result = validator.validate({ steps: validWorkflow().steps });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('"name"')));
});

test("validate: rejects workflow with missing steps array", () => {
  const result = validator.validate({ name: "test" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('"steps"')));
});

test("validate: rejects workflow with empty steps", () => {
  const result = validator.validate({ name: "empty", steps: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("at least one step")));
});

// ---- validateSteps ----

test("validateSteps: catches missing required fields", () => {
  const result = validator.validateSteps([
    { name: "no id or type" },
    { id: "", type: "" },
  ]);
  assert.ok(result.errors.some((e) => e.includes("missing required field")));
  assert.ok(result.errors.some((e) => e.includes('"id" must be a non-empty string')));
});

test("validateSteps: catches invalid step type", () => {
  const result = validator.validateSteps([
    { id: "s1", type: "invalid_type" },
  ]);
  assert.ok(result.errors.some((e) => e.includes("invalid type")));
});

test("validateSteps: catches duplicate step IDs", () => {
  const result = validator.validateSteps([
    { id: "dup", type: "tool" },
    { id: "dup", type: "agent" },
  ]);
  assert.ok(result.errors.some((e) => e.includes("Duplicate step id")));
});

test("validateSteps: catches negative numeric fields", () => {
  const result = validator.validateSteps([
    { id: "s1", type: "tool", retryCount: -1, timeout: -100 },
  ]);
  assert.ok(result.errors.some((e) => e.includes("retryCount") && e.includes("non-negative")));
  assert.ok(result.errors.some((e) => e.includes("timeout") && e.includes("non-negative")));
});

test("validateSteps: warns on missing name", () => {
  const result = validator.validateSteps([
    { id: "s1", type: "tool" },
  ]);
  assert.ok(result.warnings.some((w) => w.includes('missing a descriptive "name"')));
});

test("validateSteps: warns on non-boolean continueOnError", () => {
  const result = validator.validateSteps([
    { id: "s1", type: "tool", continueOnError: "yes" },
  ]);
  assert.ok(result.warnings.some((w) => w.includes("continueOnError")));
});

test("validateSteps: warns on non-object config", () => {
  const result = validator.validateSteps([
    { id: "s1", type: "tool", config: ["not", "an", "object"] },
  ]);
  assert.ok(result.warnings.some((w) => w.includes('"config" should be a plain object')));
});

// ---- validateDependencies ----

test("validateDependencies: catches dangling dependency references", () => {
  const result = validator.validateDependencies([
    { id: "a", type: "tool", dependsOn: ["ghost"] },
  ]);
  assert.ok(result.errors.some((e) => e.includes("unknown step")));
});

test("validateDependencies: catches circular dependencies", () => {
  const result = validator.validateDependencies([
    { id: "a", type: "tool", dependsOn: ["b"] },
    { id: "b", type: "tool", dependsOn: ["a"] },
  ]);
  assert.ok(result.errors.some((e) => e.includes("Circular dependency")));
});

test("validateDependencies: catches self-dependency", () => {
  const result = validator.validateDependencies([
    { id: "a", type: "tool", dependsOn: ["a"] },
  ]);
  assert.ok(result.errors.some((e) => e.includes("depends on itself")));
});

test("validateDependencies: detects dead steps (unreachable from entry)", () => {
  const result = validator.validateDependencies([
    { id: "entry", type: "tool", dependsOn: [] },
    { id: "orphan", type: "tool", dependsOn: ["nonexistent"] },
    { id: "reachable", type: "tool", dependsOn: ["entry"] },
  ]);
  // orphan depends on nonexistent -> dangling dep error
  // orphan is unreachable -> dead step warning
  assert.ok(result.warnings.some((w) => w.includes("Dead step") && w.includes("orphan")));
});

test("validateDependencies: warns on no entry point", () => {
  const result = validator.validateDependencies([
    { id: "a", type: "tool", dependsOn: ["b"] },
    { id: "b", type: "tool", dependsOn: ["c"] },
    { id: "c", type: "tool", dependsOn: ["a"] },
  ]);
  // This is circular AND has no entry point
  assert.ok(result.warnings.some((w) => w.includes("No entry point")));
  assert.ok(result.warnings.some((w) => w.includes("No exit point")));
});

// ---- validateTypes ----

test("validateTypes: catches tool step without handler or tool", () => {
  const result = validator.validateTypes([
    { id: "t1", type: "tool", config: {} },
  ]);
  assert.ok(result.errors.some((e) => e.includes("requires config.handler")));
});

test("validateTypes: catches agent step without handler", () => {
  const result = validator.validateTypes([
    { id: "a1", type: "agent", config: {} },
  ]);
  assert.ok(result.errors.some((e) => e.includes("requires config.handler")));
});

test("validateTypes: catches condition step without evaluate", () => {
  const result = validator.validateTypes([
    { id: "c1", type: "condition", config: {} },
  ]);
  assert.ok(result.errors.some((e) => e.includes("requires config.evaluate")));
});

test("validateTypes: catches wait step without duration", () => {
  const result = validator.validateTypes([
    { id: "w1", type: "wait", config: {} },
  ]);
  assert.ok(result.errors.some((e) => e.includes("requires config.duration")));
});

test("validateTypes: catches parallel step without steps array", () => {
  const result = validator.validateTypes([
    { id: "p1", type: "parallel", config: {} },
  ]);
  assert.ok(result.errors.some((e) => e.includes("requires config.steps")));
});

test("validateTypes: accepts valid type configs", () => {
  const result = validator.validateTypes([
    { id: "t1", type: "tool", config: { handler: () => {} } },
    { id: "t2", type: "tool", config: { tool: "shell.run" } },
    { id: "a1", type: "agent", config: { handler: () => {} } },
    { id: "c1", type: "condition", config: { evaluate: () => true } },
    { id: "w1", type: "wait", config: { duration: 1000 } },
    { id: "p1", type: "parallel", config: { steps: [{ id: "sub", type: "tool" }] } },
  ]);
  assert.deepEqual(result.errors, []);
});

// ---- suggestFixes ----

test("suggestFixes: returns suggestions for invalid workflows", () => {
  const workflow = {
    name: "bad",
    steps: [
      { id: "dup", type: "badtype" },
    ],
  };
  const suggestions = validator.suggestFixes(workflow);
  assert.ok(suggestions.length > 0, "should have at least one suggestion");
  // Should have a suggestion about invalid type
  assert.ok(suggestions.some((s) => s.issue.includes("invalid type")));
});

test("suggestFixes: returns suggestions for circular deps", () => {
  const workflow = {
    name: "cycle",
    steps: [
      { id: "a", type: "tool", config: { handler: () => {} }, dependsOn: ["b"] },
      { id: "b", type: "tool", config: { handler: () => {} }, dependsOn: ["a"] },
    ],
  };
  const suggestions = validator.suggestFixes(workflow);
  assert.ok(suggestions.some((s) => s.issue.includes("Circular dependency")));
});

test("suggestFixes: returns suggestions for missing required fields", () => {
  const workflow = {
    name: "incomplete",
    steps: [
      { id: "s1" }, // missing type
    ],
  };
  const suggestions = validator.suggestFixes(workflow);
  assert.ok(suggestions.some((s) => s.issue.includes('missing required field "type"')));
});

test("suggestFixes: returns suggestions for dangling deps", () => {
  const workflow = {
    name: "dangling",
    steps: [
      { id: "s1", type: "tool", config: { handler: () => {} }, dependsOn: ["ghost"] },
    ],
  };
  const suggestions = validator.suggestFixes(workflow);
  assert.ok(suggestions.some((s) => s.issue.includes("unknown step")));
});

// ---- validate: full integration ----

test("validate: full validation of complex valid workflow", () => {
  const workflow = {
    name: "complex-pipeline",
    description: "A complete CI/CD pipeline",
    steps: [
      { id: "lint", name: "Lint", type: "tool", config: { handler: () => {} }, retryCount: 1, timeout: 120000, dependsOn: [] },
      { id: "test", name: "Test", type: "tool", config: { handler: () => {} }, retryCount: 2, retryDelay: 5000, timeout: 300000, dependsOn: ["lint"] },
      { id: "build", name: "Build", type: "tool", config: { handler: () => {} }, dependsOn: ["test"] },
      { id: "deploy", name: "Deploy", type: "tool", config: { handler: () => {} }, retryCount: 3, dependsOn: ["build"] },
      { id: "verify", name: "Verify", type: "agent", config: { handler: () => {} }, dependsOn: ["deploy"] },
    ],
  };
  const result = validator.validate(workflow);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

// ---- Edge cases ----

test("validate: handles steps with non-array dependsOn gracefully", () => {
  const result = validator.validateSteps([
    { id: "s1", type: "tool", config: { handler: () => {} }, dependsOn: "not-an-array" },
  ]);
  assert.ok(result.errors.some((e) => e.includes('"dependsOn" must be an array')));
});

test("validate: handles null steps in array", () => {
  const result = validator.validateSteps([
    { id: "ok", type: "tool", config: { handler: () => {} } },
    null,
  ]);
  assert.ok(result.errors.some((e) => e.includes("must be an object") && e.includes("null")));
});
