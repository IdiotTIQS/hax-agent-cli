"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { OwnershipTracker } = require("../../src/ownership/tracker");

test("OwnershipTracker: constructor creates with default maxChanges", () => {
  const tracker = new OwnershipTracker();
  assert.equal(tracker._maxChanges, 50000);
  assert.equal(tracker.changeCount, 0);
  assert.deepEqual(tracker.trackedFiles, []);
  assert.deepEqual(tracker.trackedAuthors, []);
});

test("OwnershipTracker: constructor accepts custom maxChanges", () => {
  const tracker = new OwnershipTracker({ maxChanges: 100 });
  assert.equal(tracker._maxChanges, 100);
});

test("OwnershipTracker: recordChange throws on empty filePath", () => {
  const tracker = new OwnershipTracker();
  assert.throws(() => tracker.recordChange("", "agent-a", {}), {
    message: "filePath must be a non-empty string",
  });
  assert.throws(() => tracker.recordChange(null, "agent-a", {}), {
    message: "filePath must be a non-empty string",
  });
});

test("OwnershipTracker: recordChange throws on empty author", () => {
  const tracker = new OwnershipTracker();
  assert.throws(() => tracker.recordChange("src/a.js", "", {}), {
    message: "author must be a non-empty string",
  });
  assert.throws(() => tracker.recordChange("src/a.js", null, {}), {
    message: "author must be a non-empty string",
  });
});

test("OwnershipTracker: recordChange returns index and stores entry", () => {
  const tracker = new OwnershipTracker();
  const idx = tracker.recordChange("src/a.js", "agent-a", {
    type: "modified",
    lines: [1, 2, 3],
    message: "refactor function",
  });

  assert.equal(idx, 0);
  assert.equal(tracker.changeCount, 1);
  assert.deepEqual(tracker.trackedFiles, ["src/a.js"]);
  assert.deepEqual(tracker.trackedAuthors, ["agent-a"]);

  const changes = tracker.getFileChanges("src/a.js");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].author, "agent-a");
  assert.equal(changes[0].type, "modified");
  assert.deepEqual(changes[0].lines, [1, 2, 3]);
  assert.equal(changes[0].message, "refactor function");
  assert.ok(changes[0].timestamp);
});

test("OwnershipTracker: recordChange normalizes Windows paths", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src\\windows\\path.js", "agent-a");

  const files = tracker.trackedFiles;
  assert.equal(files.length, 1);
  assert.equal(files[0], "src/windows/path.js");

  const owner = tracker.getOwner("src\\windows\\path.js");
  assert.ok(owner);
  assert.equal(owner.author, "agent-a");
});

test("OwnershipTracker: recordChange expands line range", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src/a.js", "agent-a", {
    lines: { start: 10, end: 15 },
    type: "added",
  });

  const changes = tracker.getFileChanges("src/a.js");
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].lines, [10, 11, 12, 13, 14, 15]);
});

test("OwnershipTracker: getOwner returns primary owner by change count", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src/a.js", "agent-b");
  tracker.recordChange("src/a.js", "agent-a");
  tracker.recordChange("src/a.js", "agent-a");
  tracker.recordChange("src/a.js", "agent-c");

  const owner = tracker.getOwner("src/a.js");
  assert.ok(owner);
  assert.equal(owner.author, "agent-a");
  assert.equal(owner.changeCount, 2);
  assert.equal(owner.share, 0.5);
});

test("OwnershipTracker: getOwner returns null for unknown file", () => {
  const tracker = new OwnershipTracker();
  const owner = tracker.getOwner("nonexistent.js");
  assert.equal(owner, null);
});

test("OwnershipTracker: getContributors returns sorted by contribution", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src/a.js", "agent-b");
  tracker.recordChange("src/a.js", "agent-a");
  tracker.recordChange("src/a.js", "agent-a");
  tracker.recordChange("src/a.js", "agent-c");
  tracker.recordChange("src/a.js", "agent-a");

  const contributors = tracker.getContributors("src/a.js");
  assert.equal(contributors.length, 3);
  assert.equal(contributors[0].author, "agent-a");
  assert.equal(contributors[0].changeCount, 3);
  assert.equal(contributors[0].share, 0.6);

  assert.equal(contributors[1].author, "agent-b");
  assert.equal(contributors[1].changeCount, 1);
  assert.equal(contributors[1].share, 0.2);

  assert.equal(contributors[2].author, "agent-c");
  assert.equal(contributors[2].changeCount, 1);
  assert.equal(contributors[2].share, 0.2);
});

test("OwnershipTracker: getContributors returns empty array for unknown file", () => {
  const tracker = new OwnershipTracker();
  const contributors = tracker.getContributors("nonexistent.js");
  assert.deepEqual(contributors, []);
});

test("OwnershipTracker: getOwnedFiles returns files where author is primary owner", () => {
  const tracker = new OwnershipTracker();

  // agent-a dominates src/a.js
  tracker.recordChange("src/a.js", "agent-a");
  tracker.recordChange("src/a.js", "agent-a");
  tracker.recordChange("src/a.js", "agent-b");

  // agent-b dominates src/b.js
  tracker.recordChange("src/b.js", "agent-b");
  tracker.recordChange("src/b.js", "agent-b");
  tracker.recordChange("src/b.js", "agent-b");
  tracker.recordChange("src/b.js", "agent-a");

  // agent-a dominates src/c.js
  tracker.recordChange("src/c.js", "agent-a");

  const owned = tracker.getOwnedFiles("agent-a");
  assert.equal(owned.length, 2);

  const paths = owned.map((f) => f.filePath).sort();
  assert.deepEqual(paths, ["src/a.js", "src/c.js"]);
});

test("OwnershipTracker: getOwnedFiles returns empty array for unknown author", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src/a.js", "agent-a");
  const owned = tracker.getOwnedFiles("agent-b");
  assert.deepEqual(owned, []);
});

test("OwnershipTracker: getOwnershipMap returns complete file-to-owner mapping", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src/x.js", "agent-x");
  tracker.recordChange("src/y.js", "agent-y");
  tracker.recordChange("src/y.js", "agent-y");
  tracker.recordChange("src/y.js", "agent-x");

  const map = tracker.getOwnershipMap();
  assert.equal(map.size, 2);

  const xOwner = map.get("src/x.js");
  assert.equal(xOwner.author, "agent-x");
  assert.equal(xOwner.changeCount, 1);

  const yOwner = map.get("src/y.js");
  assert.equal(yOwner.author, "agent-y");
  assert.equal(yOwner.changeCount, 2);
});

test("OwnershipTracker: suggestReviewers scores authors by coverage and ownership", () => {
  const tracker = new OwnershipTracker();

  // agent-a owns FileA and FileB
  tracker.recordChange("FileA.js", "agent-a");
  tracker.recordChange("FileA.js", "agent-a");
  tracker.recordChange("FileB.js", "agent-a");
  tracker.recordChange("FileB.js", "agent-c");

  // agent-b owns FileB
  tracker.recordChange("FileB.js", "agent-b");
  tracker.recordChange("FileB.js", "agent-b");
  tracker.recordChange("FileB.js", "agent-b");

  const reviewers = tracker.suggestReviewers(["FileA.js", "FileB.js"]);
  assert.ok(reviewers.length >= 1);

  // agent-b should have high score (owns FileB with 3/5 changes)
  const bReviewer = reviewers.find((r) => r.author === "agent-b");
  assert.ok(bReviewer);
  assert.ok(bReviewer.score > 0);
  assert.ok(bReviewer.filesCovered >= 1);
});

test("OwnershipTracker: suggestReviewers returns empty array for empty files list", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src/a.js", "agent-a");
  const reviewers = tracker.suggestReviewers([]);
  assert.deepEqual(reviewers, []);
});

test("OwnershipTracker: clear removes all tracked data", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src/a.js", "agent-a");
  tracker.recordChange("src/b.js", "agent-b");

  assert.equal(tracker.changeCount, 2);

  tracker.clear();

  assert.equal(tracker.changeCount, 0);
  assert.deepEqual(tracker.trackedFiles, []);
  assert.deepEqual(tracker.trackedAuthors, []);
  assert.equal(tracker.getOwner("src/a.js"), null);
});

test("OwnershipTracker: maxChanges trims oldest entries", () => {
  const tracker = new OwnershipTracker({ maxChanges: 3 });

  tracker.recordChange("src/first.js", "agent-a");
  tracker.recordChange("src/second.js", "agent-b");
  tracker.recordChange("src/third.js", "agent-c");
  tracker.recordChange("src/fourth.js", "agent-d");

  assert.equal(tracker.changeCount, 3);
  // oldest entry (src/first.js) should have been removed
  const contributor = tracker.getContributors("src/first.js");
  assert.deepEqual(contributor, []);
});

test("OwnershipTracker: getAuthorChanges filters by author", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src/a.js", "agent-a", { type: "modified" });
  tracker.recordChange("src/b.js", "agent-b", { type: "added" });
  tracker.recordChange("src/c.js", "agent-a", { type: "deleted" });

  const aChanges = tracker.getAuthorChanges("agent-a");
  assert.equal(aChanges.length, 2);
  assert.equal(aChanges[0].filePath, "src/a.js");
  assert.equal(aChanges[1].filePath, "src/c.js");

  const bChanges = tracker.getAuthorChanges("agent-b");
  assert.equal(bChanges.length, 1);
  assert.equal(bChanges[0].filePath, "src/b.js");
});
