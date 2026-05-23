"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { OwnershipTracker } = require("../../src/ownership/tracker");
const { BlameEngine } = require("../../src/ownership/blame");

test("BlameEngine: constructor requires OwnershipTracker instance", () => {
  assert.throws(() => new BlameEngine(null), {
    message: "BlameEngine requires an OwnershipTracker instance",
  });
  assert.throws(() => new BlameEngine({}), {
    message: "BlameEngine requires an OwnershipTracker instance",
  });

  const tracker = new OwnershipTracker();
  const blame = new BlameEngine(tracker);
  assert.ok(blame);
});

test("BlameEngine: blame returns empty array for file with no changes", () => {
  const tracker = new OwnershipTracker();
  const blame = new BlameEngine(tracker);

  const result = blame.blame("nonexistent.js");
  assert.deepEqual(result, []);
});

test("BlameEngine: blame returns empty lines when maxLines set and no changes", () => {
  const tracker = new OwnershipTracker();
  const blame = new BlameEngine(tracker);

  const result = blame.blame("nonexistent.js", { maxLines: 5 });
  assert.equal(result.length, 5);
  for (const entry of result) {
    assert.equal(entry.author, "unknown");
    assert.equal(entry.timestamp, null);
    assert.equal(entry.type, "unmodified");
  }
  assert.equal(result[0].line, 1);
  assert.equal(result[4].line, 5);
});

test("BlameEngine: blame returns line-by-line attribution from change history", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src/module.js", "agent-a", {
    lines: [1, 2, 3],
    type: "modified",
    message: "initial implementation",
  });
  tracker.recordChange("src/module.js", "agent-b", {
    lines: [2],
    type: "modified",
    message: "fix bug on line 2",
  });

  const blame = new BlameEngine(tracker);
  const result = blame.blame("src/module.js");

  assert.equal(result.length, 3);

  // Line 1: last changed by agent-a
  const line1 = result.find((l) => l.line === 1);
  assert.ok(line1);
  assert.equal(line1.author, "agent-a");
  assert.equal(line1.type, "modified");

  // Line 2: last changed by agent-b (overwrites agent-a)
  const line2 = result.find((l) => l.line === 2);
  assert.ok(line2);
  assert.equal(line2.author, "agent-b");

  // Line 3: last changed by agent-a
  const line3 = result.find((l) => l.line === 3);
  assert.ok(line3);
  assert.equal(line3.author, "agent-a");
});

test("BlameEngine: blame with maxLines fills unknown lines when no line-level history", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src/small.js", "agent-a", {
    lines: [1, 2],
    type: "modified",
  });

  const blame = new BlameEngine(tracker);
  const result = blame.blame("src/small.js", { maxLines: 5 });

  assert.equal(result.length, 5);
  assert.equal(result[0].author, "agent-a"); // line 1
  assert.equal(result[1].author, "agent-a"); // line 2
  assert.equal(result[2].author, "unknown"); // line 3
  assert.equal(result[3].author, "unknown"); // line 4
  assert.equal(result[4].author, "unknown"); // line 5
});

test("BlameEngine: getLastModified returns author for a specific line", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src/module.js", "agent-a", { lines: [10], type: "modified" });
  tracker.recordChange("src/module.js", "agent-c", { lines: [10, 11], type: "modified" });

  const blame = new BlameEngine(tracker);
  const result = blame.getLastModified("src/module.js", 10);
  assert.ok(result);
  assert.equal(result.author, "agent-c");
  assert.equal(result.type, "modified");
  assert.ok(result.timestamp);
});

test("BlameEngine: getLastModified returns null for unknown line", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src/module.js", "agent-a", { lines: [1, 2], type: "modified" });

  const blame = new BlameEngine(tracker);
  const result = blame.getLastModified("src/module.js", 99);
  assert.equal(result, null);
});

test("BlameEngine: getLineHistory returns all changes for a specific line", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src/file.js", "agent-a", {
    lines: [5],
    type: "added",
    message: "add line 5",
  });
  tracker.recordChange("src/file.js", "agent-b", {
    lines: [5],
    type: "modified",
    message: "update line 5",
  });
  tracker.recordChange("src/file.js", "agent-c", {
    lines: [3, 5, 7],
    type: "modified",
    message: "batch edit",
  });

  const blame = new BlameEngine(tracker);
  const history = blame.getLineHistory("src/file.js", 5);

  assert.equal(history.length, 3);
  assert.equal(history[0].author, "agent-a");
  assert.equal(history[0].message, "add line 5");
  assert.equal(history[1].author, "agent-b");
  assert.equal(history[1].message, "update line 5");
  assert.equal(history[2].author, "agent-c");
  assert.equal(history[2].message, "batch edit");
});

test("BlameEngine: getLineHistory returns empty array for unknown file", () => {
  const tracker = new OwnershipTracker();
  const blame = new BlameEngine(tracker);

  const history = blame.getLineHistory("nonexistent.js", 1);
  assert.deepEqual(history, []);
});

test("BlameEngine: getFileHistory returns complete sorted change history", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src/app.js", "agent-a", {
    type: "added",
    lines: [1, 2, 3],
    message: "initial",
  });

  // Simulate a slightly later timestamp for the second change
  const t2 = new Date(Date.now() + 1000).toISOString();
  tracker.recordChange("src/app.js", "agent-b", {
    type: "modified",
    lines: [2],
    message: "fix",
    timestamp: t2,
  });

  const blame = new BlameEngine(tracker);
  const history = blame.getFileHistory("src/app.js");

  assert.equal(history.length, 2);
  assert.equal(history[0].author, "agent-a");
  assert.equal(history[0].message, "initial");
  assert.equal(history[1].author, "agent-b");
  assert.equal(history[1].message, "fix");
});

test("BlameEngine: getHotFiles returns most frequently changed files", () => {
  const tracker = new OwnershipTracker();

  // hot.js: 5 changes
  for (let i = 0; i < 5; i++) {
    tracker.recordChange("src/hot.js", "agent-a", { type: "modified" });
  }
  // warm.js: 3 changes
  for (let i = 0; i < 3; i++) {
    tracker.recordChange("src/warm.js", "agent-b", { type: "modified" });
  }
  // cold.js: 1 change
  tracker.recordChange("src/cold.js", "agent-c", { type: "modified" });

  const blame = new BlameEngine(tracker);
  const hotFiles = blame.getHotFiles(10);

  assert.ok(hotFiles.length >= 3);
  assert.equal(hotFiles[0].filePath, "src/hot.js");
  assert.equal(hotFiles[0].changeCount, 5);
  assert.equal(hotFiles[1].filePath, "src/warm.js");
  assert.equal(hotFiles[1].changeCount, 3);
  assert.equal(hotFiles[2].filePath, "src/cold.js");
  assert.equal(hotFiles[2].changeCount, 1);
});

test("BlameEngine: getHotFiles respects limit parameter", () => {
  const tracker = new OwnershipTracker();

  for (let i = 1; i <= 10; i++) {
    tracker.recordChange(`src/file${i}.js`, "agent-a", { type: "modified" });
  }
  // Give file3 more changes so it's hotter
  tracker.recordChange("src/file3.js", "agent-a", { type: "modified" });
  tracker.recordChange("src/file3.js", "agent-b", { type: "modified" });

  const blame = new BlameEngine(tracker);
  const hotFiles = blame.getHotFiles(3);

  assert.equal(hotFiles.length, 3);
});

test("BlameEngine: getHotFiles can filter by author", () => {
  const tracker = new OwnershipTracker();

  tracker.recordChange("src/a.js", "agent-x", { type: "modified" });
  tracker.recordChange("src/a.js", "agent-x", { type: "modified" });
  tracker.recordChange("src/a.js", "agent-y", { type: "modified" });

  tracker.recordChange("src/b.js", "agent-y", { type: "modified" });
  tracker.recordChange("src/b.js", "agent-y", { type: "modified" });
  tracker.recordChange("src/b.js", "agent-y", { type: "modified" });

  const blame = new BlameEngine(tracker);
  const hotForX = blame.getHotFiles(10, { author: "agent-x" });

  assert.ok(hotForX.length >= 1);
  const aFile = hotForX.find((f) => f.filePath === "src/a.js");
  assert.ok(aFile);
  assert.equal(aFile.changeCount, 2);
});

test("BlameEngine: getFilesChangedBetween filters by time range", () => {
  const tracker = new OwnershipTracker();

  const t1 = new Date(Date.now() - 10000).toISOString();
  const t2 = new Date(Date.now() - 5000).toISOString();
  const t3 = new Date().toISOString();

  tracker.recordChange("src/old.js", "agent-a", { type: "modified", timestamp: t1 });
  tracker.recordChange("src/mid.js", "agent-b", { type: "modified", timestamp: t2 });
  tracker.recordChange("src/new.js", "agent-c", { type: "modified", timestamp: t3 });

  const blame = new BlameEngine(tracker);
  const recent = blame.getFilesChangedBetween(
    new Date(Date.now() - 7000),
    new Date()
  );

  const paths = recent.map((f) => f.filePath);
  assert.ok(paths.includes("src/mid.js"));
  assert.ok(paths.includes("src/new.js"));
  assert.ok(!paths.includes("src/old.js"));
});
