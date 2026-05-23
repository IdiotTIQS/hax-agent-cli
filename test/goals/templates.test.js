/**
 * Tests for src/goals/templates.js -- goal templates
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  TEMPLATES,
  TEMPLATE_NAMES,
  createFromTemplate,
} = require("../../src/goals/templates");

// ---- Template structure -----------------------------------------------------

test("TEMPLATES: all templates are frozen", () => {
  assert.equal(Object.isFrozen(TEMPLATES), true);
  for (const name of TEMPLATE_NAMES) {
    assert.equal(
      Object.isFrozen(TEMPLATES[name]),
      true,
      `Template ${name} should be frozen`,
    );
  }
});

test("TEMPLATES: every template has title, description, priority, milestones", () => {
  for (const name of TEMPLATE_NAMES) {
    const t = TEMPLATES[name];
    assert.ok(typeof t.title === "string", `${name}: title missing or not string`);
    assert.ok(typeof t.description === "string", `${name}: description missing`);
    assert.ok(typeof t.defaultPriority === "string", `${name}: defaultPriority missing`);
    assert.ok(Array.isArray(t.milestones), `${name}: milestones not an array`);
    assert.ok(t.milestones.length > 0, `${name}: milestones is empty`);
    for (const m of t.milestones) {
      assert.ok(typeof m.title === "string", `${name}: milestone missing title`);
      assert.ok(typeof m.status === "string", `${name}: milestone missing status`);
      assert.equal(m.status, "pending", `${name}: milestones should default to pending`);
    }
  }
});

test("TEMPLATES: all expected template names are present", () => {
  assert.ok(TEMPLATE_NAMES.includes("ADD_FEATURE"));
  assert.ok(TEMPLATE_NAMES.includes("FIX_BUG"));
  assert.ok(TEMPLATE_NAMES.includes("REFACTOR_CODE"));
  assert.ok(TEMPLATE_NAMES.includes("WRITE_TESTS"));
  assert.ok(TEMPLATE_NAMES.includes("SETUP_PROJECT"));
  assert.ok(TEMPLATE_NAMES.includes("OPTIMIZE_PERF"));
  assert.equal(TEMPLATE_NAMES.length, 6);
});

// ---- createFromTemplate() ---------------------------------------------------

test("createFromTemplate: ADD_FEATURE returns correct structure", () => {
  const goal = createFromTemplate("ADD_FEATURE");

  assert.equal(goal.title, "Add New Feature");
  assert.ok(goal.description.length > 0);
  assert.equal(goal.priority, "high");
  assert.equal(goal.status, "active");
  assert.equal(goal.deadline, null);
  assert.equal(goal.milestones.length, 7);
  assert.equal(goal.milestones[0].title, "Write specification");
  assert.equal(goal.milestones[6].title, "Merge and deploy");
});

test("createFromTemplate: FIX_BUG returns correct structure", () => {
  const goal = createFromTemplate("FIX_BUG");

  assert.equal(goal.title, "Fix Bug");
  assert.equal(goal.milestones.length, 6);
  assert.equal(goal.milestones[0].title, "Reproduce the issue");
  assert.equal(goal.milestones[5].title, "Regression test surrounding area");
});

test("createFromTemplate: REFACTOR_CODE returns correct structure", () => {
  const goal = createFromTemplate("REFACTOR_CODE");

  assert.equal(goal.title, "Refactor Code");
  assert.equal(goal.priority, "medium");
  assert.equal(goal.milestones.length, 7);
  assert.equal(goal.milestones[0].title, "Analyze current implementation");
});

test("createFromTemplate: WRITE_TESTS returns correct structure", () => {
  const goal = createFromTemplate("WRITE_TESTS");

  assert.equal(goal.title, "Write Tests");
  assert.equal(goal.milestones.length, 5);
  assert.equal(goal.milestones[0].title, "Identify testing gaps");
  assert.equal(goal.milestones[4].title, "Review code coverage report");
});

test("createFromTemplate: SETUP_PROJECT returns correct structure", () => {
  const goal = createFromTemplate("SETUP_PROJECT");

  assert.equal(goal.title, "Set Up Project");
  assert.equal(goal.milestones.length, 5);
  assert.equal(goal.milestones[0].title, "Initialize project structure");
});

test("createFromTemplate: OPTIMIZE_PERF returns correct structure", () => {
  const goal = createFromTemplate("OPTIMIZE_PERF");

  assert.equal(goal.title, "Optimize Performance");
  assert.equal(goal.milestones.length, 5);
  assert.equal(goal.milestones[0].title, "Profile application");
});

// ---- Overrides --------------------------------------------------------------

test("createFromTemplate: title override works", () => {
  const goal = createFromTemplate("FIX_BUG", { title: "Fix login timeout" });
  assert.equal(goal.title, "Fix login timeout");
  // Description should still be the template default
  assert.ok(goal.description.includes("Reproduce"));
  assert.equal(goal.milestones[0].title, "Reproduce the issue");
});

test("createFromTemplate: description override works", () => {
  const goal = createFromTemplate("ADD_FEATURE", {
    description: "Custom feature description",
  });
  assert.equal(goal.description, "Custom feature description");
  assert.equal(goal.title, "Add New Feature");
});

test("createFromTemplate: priority override works", () => {
  const goal = createFromTemplate("SETUP_PROJECT", { priority: "critical" });
  assert.equal(goal.priority, "critical");
});

test("createFromTemplate: deadline override works", () => {
  const deadline = "2026-12-25T00:00:00.000Z";
  const goal = createFromTemplate("ADD_FEATURE", { deadline });
  assert.equal(goal.deadline, deadline);
});

test("createFromTemplate: status override works", () => {
  const goal = createFromTemplate("FIX_BUG", { status: "paused" });
  assert.equal(goal.status, "paused");
});

test("createFromTemplate: custom milestones override", () => {
  const customMilestones = [
    { title: "Custom step 1", status: "pending" },
    { title: "Custom step 2", status: "pending" },
  ];
  const goal = createFromTemplate("FIX_BUG", { milestones: customMilestones });
  assert.equal(goal.milestones.length, 2);
  assert.equal(goal.milestones[0].title, "Custom step 1");
  assert.equal(goal.milestones[1].title, "Custom step 2");
});

test("createFromTemplate: unknown template name throws", () => {
  assert.throws(
    () => createFromTemplate("NONEXISTENT"),
    /Unknown template/,
  );
  assert.throws(
    () => createFromTemplate(""),
    /Unknown template/,
  );
});

// ---- Templates produce valid goal inputs for GoalTracker --------------------

test("createFromTemplate: all templates produce compatible goal descriptors", () => {
  // Simulate validation that GoalTracker.setGoal() would perform
  for (const name of TEMPLATE_NAMES) {
    const goal = createFromTemplate(name);
    assert.ok(typeof goal.title === "string", `${name}: title must be string`);
    assert.ok(goal.title.trim().length > 0, `${name}: title must be non-empty`);
    assert.ok(typeof goal.priority === "string", `${name}: priority must be string`);
    assert.ok(Array.isArray(goal.milestones), `${name}: milestones must be array`);
    for (const m of goal.milestones) {
      assert.ok(typeof m.title === "string", `${name}: each milestone needs title`);
      assert.ok(m.title.length > 0, `${name}: milestone title must be non-empty`);
    }
  }
});

// ---- Immutability check (non-destructive override) --------------------------

test("createFromTemplate: overriding does not mutate the original template", () => {
  const originalMilestoneTitle = TEMPLATES.FIX_BUG.milestones[0].title;

  const goal = createFromTemplate("FIX_BUG", {
    title: "Custom title",
    milestones: [{ title: "Custom", status: "pending" }],
  });

  // Original template must be untouched
  assert.equal(TEMPLATES.FIX_BUG.title, "Fix Bug");
  assert.equal(TEMPLATES.FIX_BUG.milestones[0].title, originalMilestoneTitle);
  assert.equal(TEMPLATES.FIX_BUG.milestones.length, 6);

  // Custom goal has overridden values
  assert.equal(goal.title, "Custom title");
  assert.equal(goal.milestones.length, 1);
});
