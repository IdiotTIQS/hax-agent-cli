/**
 * Tests for NotificationAggregator: aggregation, grouping, digests,
 * suppression, delivery decisions, and specialized aggregation methods.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { NotificationAggregator } = require("../../src/notify/aggregator");

// ---- Helpers ---------------------------------------------------------------

function makeNotification(overrides = {}) {
  return {
    type: "task.complete",
    title: "Task completed",
    message: "Task finished successfully",
    severity: "info",
    source: "agent",
    ...overrides,
  };
}

function makeBatch(count, template = {}) {
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push(makeNotification({
      ...template,
      title: `Task ${i + 1} completed`,
      message: `Task ${i + 1} finished`,
    }));
  }
  return list;
}

// ---- Aggregation ------------------------------------------------------------

test("aggregate: adds a single notification to buffer and groups", () => {
  const agg = new NotificationAggregator();
  const n = makeNotification();

  const result = agg.aggregate(n);

  assert.equal(agg.bufferSize, 1);
  assert.equal(agg.groupCount, 1);
  assert.equal(result.groupCount, 1);
  assert.ok(result.newGroups.length > 0);
});

test("aggregate: adds multiple notifications and groups by source+type+severity", () => {
  const agg = new NotificationAggregator();
  const batch = [
    makeNotification({ type: "task.complete", severity: "info", source: "agent", title: "T1", message: "M1" }),
    makeNotification({ type: "task.error", severity: "error", source: "agent", title: "T2", message: "M2" }),
    makeNotification({ type: "task.complete", severity: "info", source: "scheduler", title: "T3", message: "M3" }),
    makeNotification({ type: "task.complete", severity: "info", source: "agent", title: "T4", message: "M4" }),
  ];

  const result = agg.aggregate(batch);

  assert.equal(agg.bufferSize, 4);
  // Grouped by source::type::severity => 3 unique groups
  assert.equal(agg.groupCount, 3);
  assert.equal(result.groupCount, 3);

  // The group with 2 agent/task.complete/info notifications should have size 2
  const groupKey = "agent::task.complete::info";
  const group = agg.getGroups().get(groupKey);
  assert.equal(group.length, 2);
});

test("aggregate: deduplicates by title and message by default", () => {
  const agg = new NotificationAggregator();
  const n1 = makeNotification({ title: "Same", message: "Same msg" });
  const n2 = makeNotification({ title: "Same", message: "Same msg" });

  agg.aggregate([n1, n2]);

  assert.equal(agg.bufferSize, 1);
  assert.equal(agg.suppressedCount, 1);

  const suppressed = agg.getSuppressed();
  assert.equal(suppressed.length, 1);
  assert.equal(suppressed[0].reason, "duplicate");
});

test("aggregate: allows duplicates when deduplicate is false", () => {
  const agg = new NotificationAggregator({ deduplicate: false });
  const n1 = makeNotification({ title: "Same", message: "Same msg" });
  const n2 = makeNotification({ title: "Same", message: "Same msg" });

  agg.aggregate([n1, n2]);

  assert.equal(agg.bufferSize, 2);
  assert.equal(agg.suppressedCount, 0);
});

test("aggregate: uses custom groupKeyFn when provided", () => {
  const agg = new NotificationAggregator({
    groupKeyFn: (n) => n.severity, // group by severity only
  });

  agg.aggregate([
    makeNotification({ severity: "info", source: "agent", type: "task.complete", title: "A", message: "A" }),
    makeNotification({ severity: "info", source: "scheduler", type: "file.change", title: "B", message: "B" }),
    makeNotification({ severity: "error", source: "agent", type: "task.error", title: "C", message: "C" }),
  ]);

  assert.equal(agg.groupCount, 2); // info group + error group
});

// ---- getSuppressed ----------------------------------------------------------

test("getSuppressed: filters by reason", () => {
  const agg = new NotificationAggregator();
  // Manually inject suppressed entries (dedup triggers "duplicate" reason)
  agg.aggregate([
    makeNotification({ title: "A", message: "A" }),
    makeNotification({ title: "A", message: "A" }), // duplicate
  ]);

  const withReason = agg.getSuppressed({ reason: "duplicate" });
  assert.equal(withReason.length, 1);

  const noMatch = agg.getSuppressed({ reason: "nonexistent" });
  assert.equal(noMatch.length, 0);
});

test("getSuppressed: filters by timestamp", () => {
  const agg = new NotificationAggregator();
  agg.aggregate([
    makeNotification({ title: "B", message: "B" }),
    makeNotification({ title: "B", message: "B" }), // duplicate
  ]);

  const recent = agg.getSuppressed({ since: Date.now() - 5000 });
  assert.equal(recent.length, 1);

  const old = agg.getSuppressed({ since: Date.now() + 10000 });
  assert.equal(old.length, 0);
});

// ---- getDigest --------------------------------------------------------------

test("getDigest: generates a summary digest grouped by key", () => {
  const agg = new NotificationAggregator();
  const batch = makeBatch(10, { source: "agent" });

  agg.aggregate(batch);
  agg.aggregate(makeNotification({ source: "scheduler", severity: "error", message: "Sched error" }));

  const digest = agg.getDigest({ frequency: "hourly", maxGroups: 10 });

  assert.equal(digest.frequency, "hourly");
  assert.equal(digest.totalNotifications, 11);
  assert.equal(digest.totalGroups, 2);
  assert.equal(digest.displayedGroups, 2);

  // agent group should be largest
  assert.ok(digest.groups[0].count >= 10);
  assert.ok(digest.groups[0].key.includes("agent"));

  // Check severity breakdown
  assert.equal(digest.groups[0].severities.info, 10);
});

test("getDigest: respects maxGroups limit", () => {
  const agg = new NotificationAggregator();

  // Create 5 distinct groups
  for (let i = 0; i < 5; i++) {
    agg.aggregate(makeNotification({ source: `src_${i}`, title: `T${i}`, message: `M${i}` }));
  }

  const digest = agg.getDigest({ frequency: "hourly", maxGroups: 3 });
  assert.equal(digest.totalGroups, 5);
  assert.equal(digest.displayedGroups, 3);
});

test("getDigest: immediate frequency returns all in-window", () => {
  const agg = new NotificationAggregator();
  agg.aggregate(makeBatch(5));

  const digest = agg.getDigest({ frequency: "immediate" });
  assert.equal(digest.frequency, "immediate");
  assert.equal(digest.windowMs, 0);
  assert.equal(digest.totalNotifications, 5);
});

test("getDigest: filters by custom since/until timestamps", () => {
  const agg = new NotificationAggregator();
  const n = makeNotification();
  n._receivedAt = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
  agg.aggregate(n);

  const n2 = makeNotification({ title: "Recent", message: "Recent task" });
  agg.aggregate(n2);

  // Only last 1 hour
  const digest = agg.getDigest({
    since: Date.now() - 60 * 60 * 1000,
    until: Date.now(),
  });

  // Only the recent notification should be in window
  assert.equal(digest.totalNotifications, 1);
});

test("getDigest: tracks digest history", () => {
  const agg = new NotificationAggregator();
  agg.aggregate(makeBatch(3));

  agg.getDigest({ frequency: "hourly" });
  agg.getDigest({ frequency: "daily" });

  const history = agg.getDigestHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].frequency, "hourly");
  assert.equal(history[1].frequency, "daily");
});

// ---- shouldDeliver ----------------------------------------------------------

test("shouldDeliver: approves valid notification by default", () => {
  const agg = new NotificationAggregator();
  const result = agg.shouldDeliver(makeNotification());

  assert.equal(result.deliver, true);
  assert.ok(result.reason.includes("approved"));
});

test("shouldDeliver: rejects null or invalid input", () => {
  const agg = new NotificationAggregator();
  assert.equal(agg.shouldDeliver(null).deliver, false);
  assert.equal(agg.shouldDeliver("string").deliver, false);
});

test("shouldDeliver: rejects when severity is below minimum", () => {
  const agg = new NotificationAggregator();
  const result = agg.shouldDeliver(
    makeNotification({ severity: "info" }),
    { minSeverity: 2 } // error rank = 2
  );

  assert.equal(result.deliver, false);
  assert.ok(result.reason.includes("below minimum"));
});

test("shouldDeliver: respects cooldown between similar notifications", () => {
  const agg = new NotificationAggregator();

  // Add first notification to the group
  const n1 = makeNotification({
    title: "First alert",
    message: "First message",
    source: "agent",
    type: "task.complete",
    severity: "info",
  });
  agg.aggregate(n1);

  // A different notification in the same group should still be deliverable (no cooldown set)
  const n2 = makeNotification({
    title: "Second alert",
    message: "Second message",
    source: "agent",
    type: "task.complete",
    severity: "info",
  });
  const r1 = agg.shouldDeliver(n2, { cooldownMs: 0 });
  assert.equal(r1.deliver, true);

  // Now add it to the buffer
  agg.aggregate(n2);

  // Third notification in same group within cooldown should be rejected
  const n3 = makeNotification({
    title: "Third alert",
    message: "Third message",
    source: "agent",
    type: "task.complete",
    severity: "info",
  });
  const r3 = agg.shouldDeliver(n3, { cooldownMs: 60000 });
  assert.equal(r3.deliver, false);
  assert.ok(r3.reason.includes("Cooldown active"));
});

test("shouldDeliver: enforces maxPerWindow limit", () => {
  const agg = new NotificationAggregator();
  const group = [
    makeNotification({ source: "agent", title: "T1", message: "M1" }),
    makeNotification({ source: "agent", title: "T2", message: "M2" }),
    makeNotification({ source: "agent", title: "T3", message: "M3" }),
  ];
  agg.aggregate(group);

  const result = agg.shouldDeliver(
    makeNotification({ source: "agent", title: "T4", message: "M4" }),
    { maxPerWindow: 3, windowMs: 60000 }
  );

  assert.equal(result.deliver, false);
  assert.ok(result.reason.includes("Max per window reached"));
});

// ---- Specialized aggregation methods ----------------------------------------

test("aggregateBySource: groups by source field", () => {
  const agg = new NotificationAggregator();
  agg.aggregate([
    makeNotification({ source: "agent", title: "A1", message: "M1" }),
    makeNotification({ source: "scheduler", title: "A2", message: "M2" }),
    makeNotification({ source: "agent", title: "A3", message: "M3" }),
  ]);

  const bySource = agg.aggregateBySource();
  assert.equal(bySource.size, 2);
  assert.equal(bySource.get("agent").length, 2);
  assert.equal(bySource.get("scheduler").length, 1);
});

test("aggregateByType: groups by type field", () => {
  const agg = new NotificationAggregator();
  agg.aggregate([
    makeNotification({ type: "task.complete", title: "C1", message: "M1" }),
    makeNotification({ type: "task.error", title: "E1", message: "M2" }),
    makeNotification({ type: "task.complete", title: "C2", message: "M3" }),
  ]);

  const byType = agg.aggregateByType();
  assert.equal(byType.size, 2);
  assert.equal(byType.get("task.complete").length, 2);
  assert.equal(byType.get("task.error").length, 1);
});

test("aggregateBySeverity: groups by severity field", () => {
  const agg = new NotificationAggregator();
  agg.aggregate([
    makeNotification({ severity: "info", title: "I1", message: "M1" }),
    makeNotification({ severity: "error", title: "E1", message: "M2" }),
    makeNotification({ severity: "critical", title: "C1", message: "M3" }),
  ]);

  const bySeverity = agg.aggregateBySeverity();
  assert.equal(bySeverity.size, 3);
  assert.equal(bySeverity.get("info").length, 1);
  assert.equal(bySeverity.get("error").length, 1);
  assert.equal(bySeverity.get("critical").length, 1);
});

test("aggregateByTimeWindow: groups by time chunks", () => {
  const agg = new NotificationAggregator();

  // Notifications at different times
  const n1 = makeNotification({ title: "N1", message: "M1" });
  n1._receivedAt = 60000; // 1 min
  const n2 = makeNotification({ title: "N2", message: "M2" });
  n2._receivedAt = 120000; // 2 min
  const n3 = makeNotification({ title: "N3", message: "M3" });
  n3._receivedAt = 61000; // 1 min 1 sec — same chunk as n1

  agg.aggregate([n1, n2, n3]);

  const byTime = agg.aggregateByTimeWindow(undefined, 60000); // 1-minute chunks
  assert.equal(byTime.size, 2); // chunk at 60000 and chunk at 120000

  // Find the 60000 chunk
  const keys = Array.from(byTime.keys());
  const chunk60 = keys.find((k) => k.includes("1970"));
  assert.ok(chunk60);
  assert.equal(byTime.get(chunk60).length, 2); // n1 and n3
});

// ---- Buffer and lifecycle ---------------------------------------------------

test("clear: empties buffer, groups, and suppressed", () => {
  const agg = new NotificationAggregator();
  agg.aggregate([
    makeNotification({ title: "A", message: "A" }),
    makeNotification({ title: "A", message: "A" }), // duplicate -> suppressed
  ]);

  assert.equal(agg.bufferSize, 1);
  assert.equal(agg.suppressedCount, 1);
  assert.equal(agg.groupCount, 1);

  agg.clear();

  assert.equal(agg.bufferSize, 0);
  assert.equal(agg.suppressedCount, 0);
  assert.equal(agg.groupCount, 0);
});

test("clearSuppressed: only clears suppressed, keeps buffer and groups", () => {
  const agg = new NotificationAggregator();
  agg.aggregate([
    makeNotification({ title: "A", message: "A" }),
    makeNotification({ title: "A", message: "A" }), // duplicate -> suppressed
  ]);

  agg.clearSuppressed();

  assert.equal(agg.suppressedCount, 0);
  assert.equal(agg.bufferSize, 1);
  assert.equal(agg.groupCount, 1);
});

test("getBuffer: returns buffered notifications with optional limit", () => {
  const agg = new NotificationAggregator();
  agg.aggregate(makeBatch(5));

  assert.equal(agg.getBuffer().length, 5);
  assert.equal(agg.getBuffer(3).length, 3);
});

test("aggregate: empty array returns current state without changes", () => {
  const agg = new NotificationAggregator();
  agg.aggregate(makeNotification());

  const result = agg.aggregate([]);
  assert.equal(result.groupCount, 1);
  assert.equal(result.newGroups.length, 0);
  assert.equal(agg.bufferSize, 1);
});
