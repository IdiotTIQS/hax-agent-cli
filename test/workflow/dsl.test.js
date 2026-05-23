/**
 * Tests for workflow DSL: parseWorkflow, validateWorkflow, workflowToDsl.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseWorkflow, validateWorkflow, workflowToDsl } = require("../../src/workflow/dsl");

// ---- parseWorkflow ----

test("parseWorkflow: parses a simple workflow with one tool step", () => {
  const source = [
    "workflow: ci",
    "description: Run CI checks",
    "steps:",
    "  - id: lint",
    "    type: tool",
    "    tool: shell.run",
    "    args:",
    "      command: npm run lint",
  ].join("\n");

  const result = parseWorkflow(source);

  assert.equal(result.name, "ci");
  assert.equal(result.description, "Run CI checks");
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].id, "lint");
  assert.equal(result.steps[0].type, "tool");
  assert.equal(result.steps[0].tool, "shell.run");
  assert.deepEqual(result.steps[0].args, { command: "npm run lint" });
});

test("parseWorkflow: parses a workflow with dependsOn", () => {
  const source = [
    "workflow: dep-test",
    "steps:",
    "  - id: test",
    "    type: tool",
    "    tool: shell.run",
    "  - id: build",
    "    type: tool",
    "    tool: shell.run",
    "    dependsOn: [\"test\"]",
  ].join("\n");

  const result = parseWorkflow(source);

  assert.equal(result.steps.length, 2);
  assert.deepEqual(result.steps[0].dependsOn, []);
  assert.deepEqual(result.steps[1].dependsOn, ["test"]);
});

test("parseWorkflow: parses steps with retry and timeout config", () => {
  const source = [
    "workflow: resilient",
    "steps:",
    "  - id: flaky-step",
    "    type: tool",
    "    tool: api.call",
    "    retryCount: 3",
    "    retryDelay: 5000",
    "    timeout: 30000",
    "    continueOnError: true",
  ].join("\n");

  const result = parseWorkflow(source);

  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].retryCount, 3);
  assert.equal(result.steps[0].retryDelay, 5000);
  assert.equal(result.steps[0].timeout, 30000);
  assert.equal(result.steps[0].continueOnError, true);
});

test("parseWorkflow: parses all supported step types", () => {
  const source = [
    "workflow: all-types",
    "steps:",
    "  - id: run-tool",
    "    type: tool",
    "  - id: run-agent",
    "    type: agent",
    "  - id: check-cond",
    "    type: condition",
    "  - id: pause",
    "    type: wait",
    "    duration: 3000",
    "  - id: group",
    "    type: parallel",
  ].join("\n");

  const result = parseWorkflow(source);

  assert.equal(result.steps.length, 5);
  assert.equal(result.steps[0].type, "tool");
  assert.equal(result.steps[1].type, "agent");
  assert.equal(result.steps[2].type, "condition");
  assert.equal(result.steps[3].type, "wait");
  assert.equal(result.steps[4].type, "parallel");
});

test("parseWorkflow: handles boolean, number, and null values", () => {
  const source = [
    "workflow: types",
    "steps:",
    "  - id: step1",
    "    type: tool",
    "    continueOnError: true",
    "    retryCount: 5",
    "    timeout: 60000",
    "    condition: null",
  ].join("\n");

  const result = parseWorkflow(source);

  assert.equal(result.steps[0].continueOnError, true);
  assert.equal(result.steps[0].retryCount, 5);
  assert.equal(result.steps[0].timeout, 60000);
  assert.equal(result.steps[0].condition, null);
});

test("parseWorkflow: throws for empty source", () => {
  assert.throws(() => parseWorkflow(""), { message: /non-empty string/ });
  assert.throws(() => parseWorkflow("   "), { message: /non-empty string/ });
  assert.throws(() => parseWorkflow(null), { message: /non-empty string/ });
});

test("parseWorkflow: handles missing workflow name gracefully", () => {
  const source = [
    "steps:",
    "  - id: s1",
    "    type: tool",
  ].join("\n");

  const result = parseWorkflow(source);
  assert.equal(result.name, "unnamed");
  assert.equal(result.steps.length, 1);
});

// ---- validateWorkflow ----

test("validateWorkflow: returns empty array for a valid definition", () => {
  const def = {
    name: "valid",
    steps: [
      { id: "lint", type: "tool", tool: "shell.run" },
      { id: "test", type: "tool", tool: "shell.run", dependsOn: ["lint"] },
    ],
  };

  const errors = validateWorkflow(def);
  assert.deepEqual(errors, []);
});

test("validateWorkflow: returns errors for missing name", () => {
  const errors = validateWorkflow({ steps: [] });
  assert.ok(errors.length > 0);
  assert.ok(errors.some((e) => e.includes("name")));
});

test("validateWorkflow: returns errors for missing steps array", () => {
  const errors = validateWorkflow({ name: "test" });
  assert.ok(errors.some((e) => e.includes("steps")));
});

test("validateWorkflow: returns errors for empty steps", () => {
  const errors = validateWorkflow({ name: "test", steps: [] });
  assert.ok(errors.some((e) => e.includes("at least one step")));
});

test("validateWorkflow: returns errors for invalid step type", () => {
  const def = {
    name: "bad",
    steps: [{ id: "s1", type: "badtype" }],
  };

  const errors = validateWorkflow(def);
  assert.ok(errors.some((e) => e.includes("invalid type")));
});

test("validateWorkflow: returns errors for missing tool on tool step", () => {
  const def = {
    name: "no-tool",
    steps: [{ id: "s1", type: "tool" }],
  };

  const errors = validateWorkflow(def);
  assert.ok(errors.some((e) => e.includes("tool")));
});

test("validateWorkflow: returns errors for duplicate step ids", () => {
  const def = {
    name: "dup",
    steps: [
      { id: "same", type: "tool", tool: "x" },
      { id: "same", type: "tool", tool: "y" },
    ],
  };

  const errors = validateWorkflow(def);
  assert.ok(errors.some((e) => e.includes("Duplicate")));
});

test("validateWorkflow: returns errors for unknown dependsOn reference", () => {
  const def = {
    name: "bad-dep",
    steps: [
      { id: "s1", type: "tool", tool: "x", dependsOn: ["ghost"] },
    ],
  };

  const errors = validateWorkflow(def);
  assert.ok(errors.some((e) => e.includes("unknown step")));
});

test("validateWorkflow: returns errors for negative numeric fields", () => {
  const def = {
    name: "bad-nums",
    steps: [{ id: "s1", type: "tool", tool: "x", retryCount: -1, timeout: -500 }],
  };

  const errors = validateWorkflow(def);
  assert.ok(errors.some((e) => e.includes("retryCount")));
  assert.ok(errors.some((e) => e.includes("timeout")));
});

// ---- workflowToDsl ----

test("workflowToDsl: serializes a definition back to DSL format", () => {
  const def = {
    name: "ci",
    description: "Continuous integration",
    steps: [
      {
        id: "lint",
        name: "Lint",
        type: "tool",
        tool: "shell.run",
        args: { command: "npm run lint" },
        dependsOn: [],
        retryCount: 2,
        timeout: 60000,
      },
      {
        id: "test",
        type: "tool",
        tool: "shell.run",
        dependsOn: ["lint"],
        continueOnError: false,
      },
    ],
  };

  const dsl = workflowToDsl(def);

  assert.ok(dsl.includes("workflow: ci"));
  assert.ok(dsl.includes("description: Continuous integration"));
  assert.ok(dsl.includes("- id: lint"));
  assert.ok(dsl.includes("type: tool"));
  assert.ok(dsl.includes("tool: shell.run"));
  assert.ok(dsl.includes("retryCount: 2"));
  assert.ok(dsl.includes("timeout: 60000"));
  assert.ok(dsl.includes("- id: test"));
  assert.ok(dsl.includes('dependsOn: ["lint"]'));
});

test("workflowToDsl: handles wait steps with duration", () => {
  const def = {
    name: "delayed",
    steps: [
      { id: "pause", type: "wait", duration: 5000 },
    ],
  };

  const dsl = workflowToDsl(def);
  assert.ok(dsl.includes("duration: 5000"));
  assert.ok(dsl.includes("type: wait"));
});

test("workflowToDsl: excludes undefined optional fields", () => {
  const def = {
    name: "minimal",
    steps: [
      { id: "s1", type: "tool" },
    ],
  };

  const dsl = workflowToDsl(def);

  // Should not contain keys that are not set
  assert.ok(!dsl.includes("retryCount"));
  assert.ok(!dsl.includes("continueOnError"));
  assert.ok(!dsl.includes("dependsOn"));
});

test("workflowToDsl: round-trips a parsed workflow", () => {
  const original = [
    "workflow: roundtrip",
    "description: Test round-trip",
    "steps:",
    "  - id: lint",
    "    type: tool",
    "    tool: eslint",
    "    retryCount: 1",
    "  - id: build",
    "    type: tool",
    "    tool: tsc",
    "    dependsOn: [\"lint\"]",
  ].join("\n");

  const parsed = parseWorkflow(original);
  const dsl = workflowToDsl(parsed);
  const reparsed = parseWorkflow(dsl);

  assert.equal(reparsed.name, "roundtrip");
  assert.equal(reparsed.description, "Test round-trip");
  assert.equal(reparsed.steps.length, 2);
  assert.equal(reparsed.steps[0].id, "lint");
  assert.equal(reparsed.steps[0].tool, "eslint");
  assert.equal(reparsed.steps[0].retryCount, 1);
  assert.equal(reparsed.steps[1].id, "build");
  assert.equal(reparsed.steps[1].tool, "tsc");
  assert.deepEqual(reparsed.steps[1].dependsOn, ["lint"]);
});

test("workflowToDsl: throws for non-object input", () => {
  assert.throws(() => workflowToDsl(null), { message: /must be an object/ });
  assert.throws(() => workflowToDsl("string"), { message: /must be an object/ });
});

test("workflowToDsl: handles steps without dependsOn gracefully", () => {
  const result = parseWorkflow("workflow: minimal\nsteps:\n  - id: s1\n    type: tool\n    tool: echo");
  assert.equal(result.steps[0].dependsOn.length, 0);
});
