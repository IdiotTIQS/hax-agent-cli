/**
 * Tests for ChangeLog: record, query, getChangesSince,
 * getFileHistory, getSummary, clear, prune.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { ChangeLog } = require("../../src/watcher/change-log");

// Helper: wait ms
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("ChangeLog: constructor defaults", () => {
  const log = new ChangeLog();
  assert.equal(log._maxEntries, 10000);
  assert.deepEqual(log._entries, []);
  assert.equal(log.count, 0);
});

test("ChangeLog: constructor accepts custom maxEntries", () => {
  const log = new ChangeLog({ maxEntries: 100 });
  assert.equal(log._maxEntries, 100);
});

test("ChangeLog: record throws for invalid event", () => {
  const log = new ChangeLog();
  assert.throws(() => log.record(null), { message: /non-empty filePath/ });
  assert.throws(() => log.record({}), { message: /non-empty filePath/ });
  assert.throws(() => log.record({ filePath: "" }), { message: /non-empty filePath/ });
});

test("ChangeLog: record returns index and stores full entry", () => {
  const log = new ChangeLog();
  const idx = log.record({
    filePath: "/src/test.js",
    event: "change",
    source: "watcher",
    metadata: { size: 1024 },
  });

  assert.equal(typeof idx, "number");
  assert.equal(log.count, 1);

  const entries = log.query();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].filePath, "/src/test.js");
  assert.equal(entries[0].event, "change");
  assert.equal(entries[0].source, "watcher");
  assert.deepEqual(entries[0].metadata, { size: 1024 });
  assert.ok(typeof entries[0].timestamp === "string");
});

test("ChangeLog: record sets default values for missing fields", () => {
  const log = new ChangeLog();
  log.record({ filePath: "/src/app.js" });

  const entries = log.query();
  assert.equal(entries[0].event, "change");
  assert.equal(entries[0].source, "unknown");
  assert.deepEqual(entries[0].metadata, {});
});

test("ChangeLog: query filters by filePath", () => {
  const log = new ChangeLog();
  log.record({ filePath: "/a.js", event: "change" });
  log.record({ filePath: "/b.js", event: "unlink" });
  log.record({ filePath: "/a.js", event: "change" });

  const results = log.query({ filePath: "/a.js" });
  assert.equal(results.length, 2);
  assert.ok(results.every((e) => e.filePath === "/a.js"));
});

test("ChangeLog: query filters by event type", () => {
  const log = new ChangeLog();
  log.record({ filePath: "/a.js", event: "change" });
  log.record({ filePath: "/b.js", event: "add" });
  log.record({ filePath: "/c.js", event: "unlink" });

  const changes = log.query({ event: "change" });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].filePath, "/a.js");

  // Multiple event types
  const multi = log.query({ event: ["add", "unlink"] });
  assert.equal(multi.length, 2);
});

test("ChangeLog: query filters by source", () => {
  const log = new ChangeLog();
  log.record({ filePath: "/a.js", source: "watcher" });
  log.record({ filePath: "/b.js", source: "git" });
  log.record({ filePath: "/c.js", source: "watcher" });

  const results = log.query({ source: "watcher" });
  assert.equal(results.length, 2);
  assert.ok(results.every((e) => e.source === "watcher"));
});

test("ChangeLog: query filters by time range (since/until)", async () => {
  const log = new ChangeLog();

  const t0 = new Date();
  log.record({ filePath: "/a.js" });
  await wait(10);

  const t1 = new Date();
  log.record({ filePath: "/b.js" });
  await wait(10);

  const t2 = new Date();

  // since t0 should include all
  const all = log.query({ since: t0 });
  assert.equal(all.length, 2);

  // since t1 should include only the second
  const afterT1 = log.query({ since: t1 });
  assert.equal(afterT1.length, 1);
  assert.equal(afterT1[0].filePath, "/b.js");

  // until t1 should include only the first
  const beforeT1 = log.query({ until: new Date(t1.getTime() - 1) });
  assert.equal(beforeT1.length, 1);
  assert.equal(beforeT1[0].filePath, "/a.js");
});

test("ChangeLog: query supports limit and offset pagination", () => {
  const log = new ChangeLog();
  for (let i = 0; i < 10; i++) {
    log.record({ filePath: `/file${i}.js` });
  }

  const page1 = log.query({ limit: 3, offset: 0 });
  assert.equal(page1.length, 3);

  const page2 = log.query({ limit: 3, offset: 3 });
  assert.equal(page2.length, 3);

  // page1 and page2 should not overlap
  const page1Files = new Set(page1.map((e) => e.filePath));
  const page2Files = new Set(page2.map((e) => e.filePath));
  const overlap = [...page1Files].filter((f) => page2Files.has(f));
  assert.equal(overlap.length, 0, "Pages should not overlap");
});

test("ChangeLog: getChangesSince returns entries after timestamp", async () => {
  const log = new ChangeLog();

  log.record({ filePath: "/old.js" });
  await wait(5);
  const cutoff = new Date();
  await wait(5);
  log.record({ filePath: "/new.js" });
  log.record({ filePath: "/new2.js" });

  const recent = log.getChangesSince(cutoff);
  assert.equal(recent.length, 2);
  assert.ok(recent.every((e) => e.filePath.startsWith("/new")));
});

test("ChangeLog: getFileHistory returns all changes for a file sorted chronologically", async () => {
  const log = new ChangeLog();
  log.record({ filePath: "/tracked.js", event: "add" });
  await wait(5);
  log.record({ filePath: "/tracked.js", event: "change" });
  await wait(5);
  log.record({ filePath: "/tracked.js", event: "unlink" });
  log.record({ filePath: "/other.js", event: "change" }); // should not appear

  const history = log.getFileHistory("/tracked.js");
  assert.equal(history.length, 3);
  assert.equal(history[0].event, "add");
  assert.equal(history[1].event, "change");
  assert.equal(history[2].event, "unlink");

  // Should be chronological
  for (let i = 1; i < history.length; i++) {
    assert.ok(
      new Date(history[i].timestamp) >= new Date(history[i - 1].timestamp),
    );
  }

  // Unknown file returns empty
  const empty = log.getFileHistory("/nonexistent.js");
  assert.deepEqual(empty, []);
});

test("ChangeLog: getSummary aggregates change statistics", () => {
  const log = new ChangeLog();
  log.record({ filePath: "/a.js", event: "change", source: "watcher" });
  log.record({ filePath: "/b.js", event: "add", source: "watcher" });
  log.record({ filePath: "/a.js", event: "change", source: "git" });
  log.record({ filePath: "/c.js", event: "unlink", source: "watcher" });

  const summary = log.getSummary();
  assert.equal(summary.total, 4);
  assert.equal(summary.filesAffected, 3);
  assert.deepEqual(summary.byEvent, { change: 2, add: 1, unlink: 1 });
  assert.deepEqual(summary.bySource, { watcher: 3, git: 1 });
});

test("ChangeLog: getSummary with since parameter limits to recent", async () => {
  const log = new ChangeLog();

  log.record({ filePath: "/old.js" });
  log.record({ filePath: "/old2.js" });
  await wait(5);
  const since = new Date();
  await wait(5);
  log.record({ filePath: "/new.js" });

  const summary = log.getSummary(since);
  assert.equal(summary.total, 1);
  assert.equal(summary.filesAffected, 1);
  assert.ok(summary.since);
});

test("ChangeLog: clear removes all entries", () => {
  const log = new ChangeLog();
  log.record({ filePath: "/a.js" });
  log.record({ filePath: "/b.js" });
  log.record({ filePath: "/c.js" });

  assert.equal(log.count, 3);
  log.clear();
  assert.equal(log.count, 0);
  assert.deepEqual(log.query(), []);
  assert.deepEqual(log.getFileHistory("/a.js"), []);
  assert.deepEqual(log.getSummary(), { total: 0, byEvent: {}, bySource: {}, filesAffected: 0 });
});

test("ChangeLog: prune removes entries older than maxAge", async () => {
  const log = new ChangeLog();

  // Record an entry we'll keep
  log.record({ filePath: "/keep.js" });
  await wait(5);

  const beforeOld = new Date();
  await wait(5);

  // Record an "old" entry and then back-date its timestamp
  log.record({ filePath: "/old.js" });
  // Manually set its timestamp to an old date to simulate aging
  log._entries[log._entries.length - 1].timestamp = new Date(Date.now() - 7200000).toISOString(); // 2 hours ago

  const pruned = log.prune(3600000); // 1 hour max age
  assert.equal(pruned, 1, "Should have pruned 1 old entry");
  assert.equal(log.count, 1);
  assert.equal(log.query()[0].filePath, "/keep.js");
});

test("ChangeLog: prune returns 0 when no entries are old enough", () => {
  const log = new ChangeLog();
  log.record({ filePath: "/recent1.js" });
  log.record({ filePath: "/recent2.js" });

  const pruned = log.prune(3600000);
  assert.equal(pruned, 0);
  assert.equal(log.count, 2);
});

test("ChangeLog: auto-trim when exceeding maxEntries", () => {
  const log = new ChangeLog({ maxEntries: 3 });
  log.record({ filePath: "/a.js" });
  log.record({ filePath: "/b.js" });
  log.record({ filePath: "/c.js" });
  log.record({ filePath: "/d.js" }); // should push out a.js

  assert.equal(log.count, 3);
  const files = log.query().map((e) => e.filePath);
  assert.deepEqual(files, ["/b.js", "/c.js", "/d.js"]);
});

test("ChangeLog: get count property reflects current entry count", () => {
  const log = new ChangeLog();
  assert.equal(log.count, 0);
  log.record({ filePath: "/a.js" });
  assert.equal(log.count, 1);
  log.record({ filePath: "/b.js" });
  assert.equal(log.count, 2);
  log.clear();
  assert.equal(log.count, 0);
});
