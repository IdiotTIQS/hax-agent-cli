"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { WorkflowLinter, SEVERITY } = require("../../src/workflow/linter");

const linter = new WorkflowLinter();

// Helper: a well-structured workflow that should score high
function cleanWorkflow(overrides = {}) {
  return {
    name: "ci-build-pipeline",
    description: "Lint, test, and build the project",
    steps: [
      { id: "lint", name: "Lint source code", type: "tool", config: { handler: () => {} }, retryCount: 0, timeout: 120000, dependsOn: [] },
      { id: "test", name: "Run unit tests", type: "tool", config: { handler: () => {} }, retryCount: 1, retryDelay: 3000, timeout: 300000, dependsOn: ["lint"] },
      { id: "build", name: "Build project artifacts", type: "tool", config: { handler: () => {} }, retryCount: 1, retryDelay: 5000, timeout: 300000, dependsOn: ["test"] },
    ],
    ...overrides,
  };
}

// ---- lint ----

test("lint: clean workflow scores 100", () => {
  const { issues, score } = linter.lint(cleanWorkflow());
  assert.equal(score, 100);
  assert.deepEqual(issues, []);
});

test("lint: non-object workflow errors", () => {
  const { issues, score } = linter.lint(null);
  assert.ok(score < 100);
  assert.ok(issues.some((i) => i.severity === SEVERITY.ERROR));
});

test("lint: empty steps workflow errors", () => {
  const { issues, score } = linter.lint({ name: "empty", steps: [] });
  assert.ok(score < 100);
  assert.ok(issues.some((i) => i.severity === SEVERITY.ERROR));
});

// ---- checkNaming ----

test("checkNaming: flags single-character step IDs", () => {
  const workflow = cleanWorkflow({
    steps: [
      { id: "x", type: "tool", config: { handler: () => {} } },
    ],
  });
  const { issues, score } = linter.lint(workflow);
  assert.ok(score < 100);
  assert.ok(issues.some((i) => i.rule === "descriptive-ids" && i.message.includes("x")));
});

test("checkNaming: flags numeric-only step IDs", () => {
  const workflow = cleanWorkflow({
    steps: [
      { id: "12345", type: "tool", config: { handler: () => {} } },
    ],
  });
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.rule === "descriptive-ids" && i.message.includes("12345")));
});

test("checkNaming: flags step IDs with whitespace", () => {
  const workflow = cleanWorkflow({
    steps: [
      { id: "my step", type: "tool", config: { handler: () => {} } },
    ],
  });
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.rule === "naming-convention" && i.message.includes("whitespace")));
});

test("checkNaming: flags step IDs with special characters", () => {
  const workflow = cleanWorkflow({
    steps: [
      { id: "step@#$", type: "tool", config: { handler: () => {} } },
    ],
  });
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.rule === "naming-convention" && i.message.includes("special characters")));
});

test("checkNaming: flags workflow name with uppercase", () => {
  const workflow = cleanWorkflow({ name: "MyWorkflow" });
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.message.includes("MyWorkflow") && i.message.includes("uppercase")));
});

test("checkNaming: info when step name equals step id", () => {
  const workflow = cleanWorkflow({
    steps: [
      { id: "lint", name: "lint", type: "tool", config: { handler: () => {} } },
    ],
  });
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.rule === "descriptive-names" && i.message.includes("identical to its ID")));
});

// ---- checkStructure ----

test("checkStructure: info for single-step workflows", () => {
  const workflow = cleanWorkflow({
    steps: [
      { id: "only", type: "tool", config: { handler: () => {} } },
    ],
  });
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.rule === "single-step-workflow"));
});

test("checkStructure: suggests description when missing", () => {
  const workflow = cleanWorkflow();
  delete workflow.description;
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.rule === "missing-description"));
});

// ---- checkPerformance ----

test("checkPerformance: warns on excessive retries", () => {
  const workflow = cleanWorkflow({
    steps: [
      { id: "flaky", type: "tool", config: { handler: () => {} }, retryCount: 10, dependsOn: [] },
    ],
  });
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.rule === "excessive-retries"));
});

test("checkPerformance: warns on large timeout", () => {
  const workflow = cleanWorkflow({
    steps: [
      { id: "slow", type: "tool", config: { handler: () => {} }, timeout: 900000, dependsOn: [] },
    ],
  });
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.rule === "large-timeout"));
});

test("checkPerformance: warns on retry storm (high retry + low delay)", () => {
  const workflow = cleanWorkflow({
    steps: [
      { id: "storm", type: "tool", config: { handler: () => {} }, retryCount: 5, retryDelay: 100, dependsOn: [] },
    ],
  });
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.rule === "retry-storm"));
});

test("checkPerformance: error on tool step without handler or tool", () => {
  const workflow = cleanWorkflow({
    steps: [
      { id: "no-handler", type: "tool", config: {}, dependsOn: [] },
    ],
  });
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.rule === "missing-handler" && i.severity === SEVERITY.ERROR));
});

// ---- score calculation ----

test("score: deductions accumulate per severity level", () => {
  // A workflow with multiple issues should score lower
  const workflow = {
    name: "bad",
    steps: [
      { id: "x", type: "tool", config: {}, retryCount: 20, timeout: 9999999, dependsOn: [] },
    ],
  };
  const { score } = linter.lint(workflow);
  assert.ok(score < 60, `Expected score < 60, got ${score}`);
});

// ---- getBestPractices ----

test("getBestPractices: returns structured best practices guide", () => {
  const guide = linter.getBestPractices();
  assert.ok(Array.isArray(guide));
  assert.ok(guide.length >= 4, "should have at least 4 categories");
  for (const category of guide) {
    assert.ok(typeof category.category === "string");
    assert.ok(Array.isArray(category.practices));
    assert.ok(category.practices.length > 0, `${category.category} should have practices`);
  }
  // Verify key categories exist
  const cats = guide.map((g) => g.category);
  assert.ok(cats.includes("Naming"));
  assert.ok(cats.includes("Structure"));
  assert.ok(cats.includes("Performance"));
  assert.ok(cats.includes("Dependencies"));
});

// ---- Edge cases ----

test("lint: handles workflow with parallel step and excessive sub-steps", () => {
  const manySubSteps = Array.from({ length: 15 }, (_, i) => ({ id: `sub-${i}`, type: "tool" }));
  const workflow = {
    name: "big-parallel",
    description: "Too many parallel sub-steps",
    steps: [
      { id: "group", type: "parallel", config: { steps: manySubSteps }, dependsOn: [] },
    ],
  };
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.rule === "excessive-parallelism"));
});

test("lint: suggests parallelization for independent consecutive steps", () => {
  const workflow = {
    name: "can-parallelize",
    description: "Independent steps",
    steps: [
      { id: "lint", type: "tool", config: { handler: () => {} }, dependsOn: [] },
      { id: "audit", type: "tool", config: { handler: () => {} }, dependsOn: [] },
    ],
  };
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.rule === "parallelization-opportunity"));
});

test("lint: warns on continueOnError with downstream dependents", () => {
  const workflow = {
    name: "risky-continue",
    description: "Step continues on error but has dependents",
    steps: [
      { id: "flaky", type: "tool", config: { handler: () => {} }, continueOnError: true, dependsOn: [] },
      { id: "rely-on-flaky", type: "tool", config: { handler: () => {} }, dependsOn: ["flaky"] },
    ],
  };
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.rule === "continue-on-error-with-dependents"));
});

test("lint: info when condition step has no dependents", () => {
  const workflow = {
    name: "orphan-condition",
    description: "Condition with no downstream",
    steps: [
      { id: "check", type: "condition", config: { evaluate: () => true }, dependsOn: [] },
    ],
  };
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.rule === "unused-condition"));
});

test("lint: info about handlerless tool step", () => {
  const workflow = {
    name: "handlerless",
    description: "Tool with config.tool but no handler",
    steps: [
      { id: "run", type: "tool", config: { tool: "shell.run" }, dependsOn: [] },
    ],
  };
  const { issues } = linter.lint(workflow);
  assert.ok(issues.some((i) => i.rule === "handlerless-tool"));
});
