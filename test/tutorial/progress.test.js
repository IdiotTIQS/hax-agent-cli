/**
 * Tests for TutorialProgress: markComplete, isComplete,
 * getCompletedTutorials, getNextRecommended, getOverallProgress, reset.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const os = require("node:os");

const { TutorialProgress } = require("../../src/tutorial/progress");

const MOCK_TUTORIALS = {
  "first-tutorial": {
    id: "first-tutorial",
    name: "First Tutorial",
    description: "Beginner intro.",
    difficulty: "beginner",
    estimatedMinutes: 5,
    steps: [],
  },
  "second-tutorial": {
    id: "second-tutorial",
    name: "Second Tutorial",
    description: "Intermediate material.",
    difficulty: "intermediate",
    estimatedMinutes: 10,
    steps: [],
  },
  "third-tutorial": {
    id: "third-tutorial",
    name: "Third Tutorial",
    description: "Advanced stuff.",
    difficulty: "advanced",
    estimatedMinutes: 15,
    steps: [],
  },
};

function createProgress(options = {}) {
  const tmpDir = options.tmpDir || os.tmpdir();
  const id = `test-progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(tmpDir, ".haxagent-test", id);
  const progressFile = path.join(dir, "tutorial-progress.json");

  // Cleanup any previous run
  try {
    const fs = require("node:fs");
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ok */ }

  return new TutorialProgress({
    ...options,
    progressFile,
    tutorials: options.tutorials || MOCK_TUTORIALS,
  });
}

test("TutorialProgress: markComplete persists and is retrievable via isComplete", () => {
  const progress = createProgress();

  progress.markComplete("first-tutorial");
  assert.equal(progress.isComplete("first-tutorial"), true);
  assert.equal(progress.isComplete("second-tutorial"), false);
});

test("TutorialProgress: marking same tutorial twice does not throw", () => {
  const progress = createProgress();

  progress.markComplete("first-tutorial");
  progress.markComplete("first-tutorial"); // idempotent

  assert.equal(progress.isComplete("first-tutorial"), true);
  assert.equal(progress.getCompletedTutorials().length, 1);
});

test("TutorialProgress: markComplete throws for unknown tutorial id", () => {
  const progress = createProgress();

  assert.throws(() => {
    progress.markComplete("nonexistent-tutorial");
  }, /Unknown tutorial/);
});

test("TutorialProgress: getCompletedTutorials returns all completed ids", () => {
  const progress = createProgress();

  assert.deepEqual(progress.getCompletedTutorials(), []);

  progress.markComplete("first-tutorial");
  assert.deepEqual(progress.getCompletedTutorials(), ["first-tutorial"]);

  progress.markComplete("third-tutorial");
  const completed = progress.getCompletedTutorials();
  assert.equal(completed.length, 2);
  assert.ok(completed.includes("first-tutorial"));
  assert.ok(completed.includes("third-tutorial"));
});

test("TutorialProgress: getNextRecommended returns first uncompleted tutorial", () => {
  const progress = createProgress();

  const first = progress.getNextRecommended();
  assert.equal(first.id, "first-tutorial");

  progress.markComplete("first-tutorial");
  const second = progress.getNextRecommended();
  assert.equal(second.id, "second-tutorial");
});

test("TutorialProgress: getNextRecommended returns null when all completed", () => {
  const progress = createProgress();

  progress.markComplete("first-tutorial");
  progress.markComplete("second-tutorial");
  progress.markComplete("third-tutorial");

  assert.equal(progress.getNextRecommended(), null);
});

test("TutorialProgress: getOverallProgress returns correct percentages", () => {
  const progress = createProgress();

  let stats = progress.getOverallProgress();
  assert.deepEqual(stats, { completed: 0, total: 3, percent: 0 });

  progress.markComplete("first-tutorial");
  stats = progress.getOverallProgress();
  assert.deepEqual(stats, { completed: 1, total: 3, percent: 33 });

  progress.markComplete("second-tutorial");
  stats = progress.getOverallProgress();
  assert.deepEqual(stats, { completed: 2, total: 3, percent: 67 });

  progress.markComplete("third-tutorial");
  stats = progress.getOverallProgress();
  assert.deepEqual(stats, { completed: 3, total: 3, percent: 100 });
});

test("TutorialProgress: reset clears all progress", () => {
  const progress = createProgress();

  progress.markComplete("first-tutorial");
  progress.markComplete("second-tutorial");
  assert.equal(progress.getCompletedTutorials().length, 2);

  progress.reset();
  assert.equal(progress.getCompletedTutorials().length, 0);
  assert.equal(progress.getOverallProgress().percent, 0);
  assert.equal(progress.isComplete("first-tutorial"), false);
});

test("TutorialProgress: persistence survives across instances", () => {
  const tmpDir = os.tmpdir();
  const id = `test-persist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(tmpDir, ".haxagent-test", id);
  const progressFile = path.join(dir, "tutorial-progress.json");

  try {
    require("node:fs").rmSync(dir, { recursive: true, force: true });
  } catch { /* ok */ }

  const options = { progressFile, tutorials: MOCK_TUTORIALS };

  const progressA = new TutorialProgress(options);
  progressA.markComplete("first-tutorial");

  // New instance with same file path
  const progressB = new TutorialProgress(options);
  assert.equal(progressB.isComplete("first-tutorial"), true);
  assert.equal(progressB.getCompletedTutorials().length, 1);

  // Cleanup
  try {
    require("node:fs").rmSync(dir, { recursive: true, force: true });
  } catch { /* ok */ }
});

test("TutorialProgress: fresh instance with no saved file returns empty state", () => {
  const tmpDir = os.tmpdir();
  const nonExistentFile = path.join(tmpDir, ".haxagent-test", `no-file-${Date.now()}`, "tutorial-progress.json");

  const progress = new TutorialProgress({
    progressFile: nonExistentFile,
    tutorials: MOCK_TUTORIALS,
  });

  assert.equal(progress.getCompletedTutorials().length, 0);
  assert.equal(progress.getOverallProgress().percent, 0);
  assert.equal(progress.getNextRecommended().id, "first-tutorial");
});

test("TutorialProgress: getNextRecommended returned object has all required fields", () => {
  const progress = createProgress();

  const rec = progress.getNextRecommended();
  assert.ok(rec);
  assert.equal(typeof rec.id, "string");
  assert.equal(typeof rec.name, "string");
  assert.equal(typeof rec.description, "string");
  assert.equal(typeof rec.difficulty, "string");
  assert.equal(typeof rec.estimatedMinutes, "number");
  assert.ok(rec.estimatedMinutes > 0);
});

test("TutorialProgress: handles zero-tutorial set gracefully", () => {
  const progress = createProgress({ tutorials: {} });

  assert.deepEqual(progress.getCompletedTutorials(), []);
  assert.equal(progress.getNextRecommended(), null);
  assert.deepEqual(progress.getOverallProgress(), { completed: 0, total: 0, percent: 0 });
});
