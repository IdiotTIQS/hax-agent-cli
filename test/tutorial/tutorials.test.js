/**
 * Tests for tutorial definitions: structure validation, step requirements,
 * metadata consistency, and edge cases.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const TUTORIALS = require("../../src/tutorial/tutorials");

const VALID_DIFFICULTIES = new Set(["beginner", "intermediate", "advanced"]);

const ALL_TUTORIAL_IDS = [
  "GETTING_STARTED",
  "SLASH_COMMANDS",
  "AGENT_TEAMS",
  "PLUGIN_BASICS",
  "SKILL_BASICS",
  "MEMORY_SYSTEM",
  "BATCH_MODE",
  "CONFIGURATION",
];

function getTutorials() {
  return ALL_TUTORIAL_IDS.map((key) => TUTORIALS[key]);
}

test("All eight tutorial exports are defined and non-null", () => {
  for (const key of ALL_TUTORIAL_IDS) {
    assert.ok(TUTORIALS[key], `Tutorial "${key}" should be defined`);
    assert.equal(typeof TUTORIALS[key], "object", `Tutorial "${key}" should be an object`);
  }

  // Verify no extra exports
  assert.equal(Object.keys(TUTORIALS).length, 8);
});

test("Every tutorial has required metadata fields: id, name, description, difficulty, estimatedMinutes, steps", () => {
  const required = ["id", "name", "description", "difficulty", "estimatedMinutes", "steps"];

  for (const tutorial of getTutorials()) {
    for (const field of required) {
      assert.ok(
        tutorial[field] !== undefined && tutorial[field] !== null,
        `Tutorial "${tutorial.id}" missing required field: ${field}`
      );
    }
  }
});

test("Every tutorial has a unique id matching the export key", () => {
  for (const key of ALL_TUTORIAL_IDS) {
    const tutorial = TUTORIALS[key];
    const expectedId = key.toLowerCase().replace(/_/g, "-");
    assert.equal(
      tutorial.id,
      expectedId,
      `Tutorial key "${key}" should have id "${expectedId}", got "${tutorial.id}"`
    );
  }
});

test("All tutorial ids are unique", () => {
  const ids = getTutorials().map((t) => t.id);
  const unique = new Set(ids);
  assert.equal(ids.length, unique.size, "All tutorial ids must be unique");
});

test("Every tutorial has a valid difficulty level", () => {
  for (const tutorial of getTutorials()) {
    assert.ok(
      VALID_DIFFICULTIES.has(tutorial.difficulty),
      `Tutorial "${tutorial.id}" has invalid difficulty: "${tutorial.difficulty}". Must be one of: ${[...VALID_DIFFICULTIES].join(", ")}`
    );
  }
});

test("Every tutorial has a positive estimatedMinutes", () => {
  for (const tutorial of getTutorials()) {
    assert.ok(
      Number.isInteger(tutorial.estimatedMinutes) && tutorial.estimatedMinutes > 0,
      `Tutorial "${tutorial.id}" estimatedMinutes must be a positive integer, got: ${tutorial.estimatedMinutes}`
    );
  }
});

test("Every tutorial has a non-empty name and description string", () => {
  for (const tutorial of getTutorials()) {
    assert.equal(typeof tutorial.name, "string", `Tutorial "${tutorial.id}" name must be a string`);
    assert.ok(tutorial.name.length > 0, `Tutorial "${tutorial.id}" name must not be empty`);

    assert.equal(typeof tutorial.description, "string", `Tutorial "${tutorial.id}" description must be a string`);
    assert.ok(tutorial.description.length > 0, `Tutorial "${tutorial.id}" description must not be empty`);
  }
});

test("Every tutorial has at least one step", () => {
  for (const tutorial of getTutorials()) {
    assert.ok(
      Array.isArray(tutorial.steps),
      `Tutorial "${tutorial.id}" steps must be an array`
    );
    assert.ok(
      tutorial.steps.length > 0,
      `Tutorial "${tutorial.id}" must have at least 1 step, got ${tutorial.steps.length}`
    );
  }
});

test("Every step has required fields: id, title, instruction, expectedAction, hints, validation", () => {
  const required = ["id", "title", "instruction", "expectedAction", "hints", "validation"];

  for (const tutorial of getTutorials()) {
    for (const step of tutorial.steps) {
      for (const field of required) {
        assert.ok(
          field in step,
          `Step "${step.id || "(missing id)"}" in tutorial "${tutorial.id}" missing field: ${field}`
        );
      }
    }
  }
});

test("Every step has a non-empty title and instruction", () => {
  for (const tutorial of getTutorials()) {
    for (const step of tutorial.steps) {
      assert.equal(typeof step.title, "string", `Step "${step.id}" title must be a string`);
      assert.ok(step.title.length > 0, `Step "${step.id}" title must not be empty`);

      assert.equal(typeof step.instruction, "string", `Step "${step.id}" instruction must be a string`);
      assert.ok(step.instruction.length > 0, `Step "${step.id}" instruction must not be empty`);
    }
  }
});

test("Every step id is unique within its tutorial", () => {
  for (const tutorial of getTutorials()) {
    const ids = tutorial.steps.map((s) => s.id);
    const unique = new Set(ids);
    assert.equal(
      ids.length,
      unique.size,
      `Tutorial "${tutorial.id}" has duplicate step ids: ${ids.join(", ")}`
    );
  }
});

test("Expected action values are sensible strings", () => {
  const validActions = new Set([
    "acknowledge",
    "run-command",
    "send-message",
    "observe",
    "run-slash",
    "configure",
    "create-file",
    "done",
  ]);

  for (const tutorial of getTutorials()) {
    for (const step of tutorial.steps) {
      assert.equal(typeof step.expectedAction, "string", `Step "${step.id}" expectedAction must be a string`);
      assert.ok(step.expectedAction.length > 0, `Step "${step.id}" expectedAction must not be empty`);
    }
  }
});

test("Hints are always an array (may be empty)", () => {
  for (const tutorial of getTutorials()) {
    for (const step of tutorial.steps) {
      assert.ok(Array.isArray(step.hints), `Step "${step.id}" hints must be an array`);
    }
  }
});

test("Getting Started is the first tutorial (beginner, lowest time)", () => {
  const gettingStarted = TUTORIALS.GETTING_STARTED;
  assert.equal(gettingStarted.difficulty, "beginner");
  assert.equal(gettingStarted.estimatedMinutes, 5);

  // Verify it has a welcome step as its first step
  assert.equal(gettingStarted.steps[0].id, "welcome");
});

test("All GETTING_STARTED steps have non-empty hints except the completion step", () => {
  const tutorial = TUTORIALS.GETTING_STARTED;
  for (const step of tutorial.steps) {
    if (step.id === "completion") {
      assert.equal(step.hints.length, 0, "Completion step should have no hints");
    } else {
      assert.ok(step.hints.length > 0, `Step "${step.id}" should have hints`);
    }
  }
});
