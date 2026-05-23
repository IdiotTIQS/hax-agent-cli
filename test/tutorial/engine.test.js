/**
 * Tests for TutorialEngine: start, next, previous, skip,
 * getCurrentStep, getProgress, isComplete.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { TutorialEngine } = require("../../src/tutorial/engine");

const MOCK_TUTORIALS = {
  "alpha": {
    id: "alpha",
    name: "Alpha Tutorial",
    description: "First test tutorial.",
    difficulty: "beginner",
    estimatedMinutes: 3,
    steps: [
      { id: "alpha-1", title: "Step 1", instruction: "Do step 1.", expectedAction: "ack", hints: ["Hint 1"], validation: null },
      { id: "alpha-2", title: "Step 2", instruction: "Do step 2.", expectedAction: "ack", hints: [], validation: null },
      { id: "alpha-3", title: "Step 3", instruction: "Do step 3.", expectedAction: "done", hints: [], validation: null },
    ],
  },
  "beta": {
    id: "beta",
    name: "Beta Tutorial",
    description: "Second test tutorial.",
    difficulty: "advanced",
    estimatedMinutes: 7,
    steps: [
      { id: "beta-1", title: "Intro", instruction: "Intro step.", expectedAction: "ack", hints: [], validation: null },
    ],
  },
  "gamma": {
    id: "gamma",
    name: "Gamma Tutorial",
    description: "Empty edge case.",
    difficulty: "beginner",
    estimatedMinutes: 0,
    steps: [],
  },
};

test("TutorialEngine: start sets the current tutorial and resets step index", () => {
  const engine = new TutorialEngine(MOCK_TUTORIALS);
  engine.start("alpha");

  const step = engine.getCurrentStep();
  assert.equal(step.tutorialId, "alpha");
  assert.equal(step.tutorialName, "Alpha Tutorial");
  assert.equal(step.stepIndex, 0);
  assert.equal(step.step.id, "alpha-1");
});

test("TutorialEngine: start throws for unknown tutorial id", () => {
  const engine = new TutorialEngine(MOCK_TUTORIALS);
  assert.throws(() => {
    engine.start("nonexistent");
  }, /Unknown tutorial/);
});

test("TutorialEngine: next advances to the next step", () => {
  const engine = new TutorialEngine(MOCK_TUTORIALS);
  engine.start("alpha");

  assert.equal(engine.next(), true);
  assert.equal(engine.getCurrentStep().step.id, "alpha-2");

  assert.equal(engine.next(), true);
  assert.equal(engine.getCurrentStep().step.id, "alpha-3");
});

test("TutorialEngine: next returns false at last step and stays in place", () => {
  const engine = new TutorialEngine(MOCK_TUTORIALS);
  engine.start("beta");

  assert.equal(engine.next(), false);
  assert.equal(engine.getCurrentStep().step.id, "beta-1");
});

test("TutorialEngine: previous goes back one step", () => {
  const engine = new TutorialEngine(MOCK_TUTORIALS);
  engine.start("alpha");

  // Advance to step 2
  engine.next();
  assert.equal(engine.getCurrentStep().step.id, "alpha-2");

  // Go back
  assert.equal(engine.previous(), true);
  assert.equal(engine.getCurrentStep().step.id, "alpha-1");
});

test("TutorialEngine: previous returns false at first step", () => {
  const engine = new TutorialEngine(MOCK_TUTORIALS);
  engine.start("alpha");

  assert.equal(engine.previous(), false);
  assert.equal(engine.getCurrentStep().step.id, "alpha-1");
});

test("TutorialEngine: skip advances to next step like next", () => {
  const engine = new TutorialEngine(MOCK_TUTORIALS);
  engine.start("alpha");

  assert.equal(engine.skip(), true);
  assert.equal(engine.getCurrentStep().step.id, "alpha-2");

  assert.equal(engine.skip(), true);
  assert.equal(engine.getCurrentStep().step.id, "alpha-3");

  assert.equal(engine.skip(), false);
});

test("TutorialEngine: getProgress reports correct current, total, percent", () => {
  const engine = new TutorialEngine(MOCK_TUTORIALS);
  engine.start("alpha");

  let progress = engine.getProgress();
  assert.deepEqual(progress, { current: 1, total: 3, percent: 33 });

  engine.next();
  progress = engine.getProgress();
  assert.deepEqual(progress, { current: 2, total: 3, percent: 67 });

  engine.next();
  progress = engine.getProgress();
  assert.deepEqual(progress, { current: 3, total: 3, percent: 100 });
});

test("TutorialEngine: isComplete returns true only on last step", () => {
  const engine = new TutorialEngine(MOCK_TUTORIALS);
  engine.start("alpha");

  assert.equal(engine.isComplete(), false);

  engine.next(); // step 2
  assert.equal(engine.isComplete(), false);

  engine.next(); // step 3 (last)
  assert.equal(engine.isComplete(), true);
});

test("TutorialEngine: getCurrentStep returns null when no tutorial started", () => {
  const engine = new TutorialEngine(MOCK_TUTORIALS);
  assert.equal(engine.getCurrentStep(), null);
});

test("TutorialEngine: throws when navigating without starting", () => {
  const engine = new TutorialEngine(MOCK_TUTORIALS);

  assert.throws(() => engine.next(), /No tutorial started/);
  assert.throws(() => engine.previous(), /No tutorial started/);
  assert.throws(() => engine.skip(), /No tutorial started/);
  assert.throws(() => engine.getProgress(), /No tutorial started/);
});

test("TutorialEngine: start resets state when switching tutorials", () => {
  const engine = new TutorialEngine(MOCK_TUTORIALS);
  engine.start("alpha");
  engine.next(); // step 2
  engine.next(); // step 3

  engine.start("beta");
  assert.equal(engine.getCurrentStep().step.id, "beta-1");
  // beta has only 1 step, so we are on the final step immediately
  assert.equal(engine.isComplete(), true);

  const progress = engine.getProgress();
  assert.deepEqual(progress, { current: 1, total: 1, percent: 100 });
});
