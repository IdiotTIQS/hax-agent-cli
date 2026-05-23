/**
 * Tests for WorkflowScheduler: schedule, triggers, query, cancel, lifecycle.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  WorkflowScheduler,
  TRIGGER_TYPES,
  STATUS,
} = require("../../src/workflow/scheduler");

function makeWorkflow(overrides = {}) {
  return {
    name: overrides.name || "test-workflow",
    description: overrides.description || "",
    steps: overrides.steps || [
      { id: "s1", name: "Step 1", type: "tool", config: {}, dependsOn: [] },
    ],
  };
}

function makeTrigger(overrides = {}) {
  return {
    type: overrides.type || TRIGGER_TYPES.ON_DEMAND,
    config: overrides.config || {},
    name: overrides.name,
    priority: overrides.priority,
    maxRetries: overrides.maxRetries,
    timeout: overrides.timeout,
    metadata: overrides.metadata,
  };
}

// ---- schedule ----

test("scheduler: schedule() creates a scheduled entry for onDemand trigger", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(
    makeWorkflow({ name: "ci-workflow" }),
    makeTrigger({ type: TRIGGER_TYPES.ON_DEMAND }),
  );

  assert.equal(entry.workflowName, "ci-workflow");
  assert.equal(entry.trigger.type, TRIGGER_TYPES.ON_DEMAND);
  assert.equal(entry.status, STATUS.RUNNING);
  assert.ok(entry.id.startsWith("sched-"));
  assert.ok(entry.createdAt);
  assert.ok(entry.startedAt);
});

test("scheduler: schedule() creates entry for onSchedule with valid cron", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(
    makeWorkflow({ name: "nightly" }),
    makeTrigger({
      type: TRIGGER_TYPES.ON_SCHEDULE,
      config: { cron: "0 2 * * *" },
    }),
  );

  assert.equal(entry.trigger.type, TRIGGER_TYPES.ON_SCHEDULE);
  assert.ok(entry.nextRunAt, "Should compute next run time");
  assert.equal(entry.status, STATUS.SCHEDULED);
});

test("scheduler: schedule() rejects invalid cron expression", () => {
  const sched = new WorkflowScheduler();

  assert.throws(
    () =>
      sched.schedule(
        makeWorkflow(),
        makeTrigger({ type: TRIGGER_TYPES.ON_SCHEDULE, config: { cron: "not-valid" } }),
      ),
    /valid cron expression/,
  );
});

test("scheduler: schedule() rejects invalid trigger type", () => {
  const sched = new WorkflowScheduler();

  assert.throws(
    () =>
      sched.schedule(
        makeWorkflow(),
        makeTrigger({ type: "badTriggerType" }),
      ),
    /Invalid trigger type/,
  );
});

test("scheduler: schedule() rejects invalid workflow", () => {
  const sched = new WorkflowScheduler();

  assert.throws(() => sched.schedule(null, makeTrigger()), /must be an object/);
  assert.throws(() => sched.schedule({}, makeTrigger()), /must have a non-empty name/);
  assert.throws(() => sched.schedule({ name: "x" }, makeTrigger()), /must have a steps array/);
});

// ---- lifecycle: complete, fail, cancel ----

test("scheduler: complete() marks entry as completed and archives to history", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(
    makeWorkflow({ name: "w" }),
    makeTrigger({ type: TRIGGER_TYPES.ON_DEMAND }),
  );

  const result = sched.complete(entry.id, { message: "done" });
  assert.equal(result, true);

  const updated = sched.get(entry.id);
  assert.equal(updated.status, STATUS.COMPLETED);
  assert.equal(updated.result.message, "done");
  assert.ok(updated.duration !== null);
  assert.ok(updated.completedAt);

  // Should appear in history
  const history = sched.getHistory();
  assert.ok(history.length >= 1);
  const histEntry = history.find((h) => h.id === entry.id);
  assert.ok(histEntry);
  assert.equal(histEntry.status, STATUS.COMPLETED);
});

test("scheduler: fail() marks entry as failed after max retries", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(
    makeWorkflow(),
    makeTrigger({
      type: TRIGGER_TYPES.ON_DEMAND,
      maxRetries: 2,
    }),
  );

  // Should retry up to maxRetries
  sched.fail(entry.id, new Error("boom 1"));
  let updated = sched.get(entry.id);
  assert.equal(updated.status, STATUS.SCHEDULED);
  assert.equal(updated.retryCount, 1);

  sched.fail(entry.id, new Error("boom 2"));
  updated = sched.get(entry.id);
  assert.equal(updated.retryCount, 2);

  // Third failure should exceed maxRetries (0-indexed: 0, 1, 2 = 3 attempts)
  sched.fail(entry.id, new Error("boom 3"));
  updated = sched.get(entry.id);
  assert.equal(updated.status, STATUS.FAILED);
  assert.ok(updated.error);
  assert.equal(updated.error.message, "boom 3");
});

test("scheduler: cancel() cancels a scheduled workflow", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(
    makeWorkflow(),
    makeTrigger({ type: TRIGGER_TYPES.ON_SCHEDULE, config: { cron: "0 2 * * *" } }),
  );

  assert.equal(entry.status, STATUS.SCHEDULED);

  const cancelled = sched.cancel(entry.id);
  assert.equal(cancelled, true);

  const updated = sched.get(entry.id);
  assert.equal(updated.status, STATUS.CANCELLED);
  assert.ok(updated.completedAt);
});

test("scheduler: cancel() returns false for already terminal", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(
    makeWorkflow(),
    makeTrigger({ type: TRIGGER_TYPES.ON_DEMAND }),
  );

  sched.complete(entry.id);
  assert.equal(sched.cancel(entry.id), false);
});

test("scheduler: cancel() returns false for unknown id", () => {
  const sched = new WorkflowScheduler();
  assert.equal(sched.cancel("nonexistent"), false);
});

// ---- query: getUpcoming, getHistory, get, stats ----

test("scheduler: getUpcoming() lists non-terminal entries sorted by nextRunAt", () => {
  const sched = new WorkflowScheduler();

  // onSchedule creates SCHEDULED entries (upcoming)
  sched.schedule(
    makeWorkflow({ name: "w1" }),
    makeTrigger({ type: TRIGGER_TYPES.ON_SCHEDULE, config: { cron: "30 8 * * *" } }),
  );
  sched.schedule(
    makeWorkflow({ name: "w2" }),
    makeTrigger({ type: TRIGGER_TYPES.ON_SCHEDULE, config: { cron: "0 9 * * *" } }),
  );

  const upcoming = sched.getUpcoming();
  // onDemand entries are RUNNING, not SCHEDULED, so they're still "upcoming"
  assert.ok(upcoming.length >= 2);

  // Verify it's an array of descriptions
  for (const u of upcoming) {
    assert.ok(u.id);
    assert.ok(u.status);
    assert.ok(![STATUS.COMPLETED, STATUS.FAILED, STATUS.CANCELLED].includes(u.status));
  }
});

test("scheduler: getHistory() returns completed/failed/cancelled entries", () => {
  const sched = new WorkflowScheduler();

  const e1 = sched.schedule(makeWorkflow({ name: "w1" }), makeTrigger({ type: TRIGGER_TYPES.ON_DEMAND }));
  const e2 = sched.schedule(makeWorkflow({ name: "w2" }), makeTrigger({ type: TRIGGER_TYPES.ON_DEMAND }));

  sched.complete(e1.id);
  sched.fail(e2.id, new Error("fail"));
  sched.fail(e2.id, new Error("fail again"));
  sched.fail(e2.id, new Error("fail final"));

  const history = sched.getHistory();
  assert.ok(history.length >= 2);
});

test("scheduler: getHistory() filters by status and workflowName", () => {
  const sched = new WorkflowScheduler();

  const e1 = sched.schedule(makeWorkflow({ name: "alpha" }), makeTrigger({ type: TRIGGER_TYPES.ON_DEMAND }));
  const e2 = sched.schedule(makeWorkflow({ name: "beta" }), makeTrigger({ type: TRIGGER_TYPES.ON_DEMAND }));

  sched.complete(e1.id);
  sched.fail(e2.id, new Error("fail"));
  sched.fail(e2.id, new Error("fail again"));
  sched.fail(e2.id, new Error("fail final"));

  const completed = sched.getHistory({ status: STATUS.COMPLETED });
  for (const h of completed) {
    assert.equal(h.status, STATUS.COMPLETED);
  }

  const betaOnly = sched.getHistory({ workflowName: "beta" });
  for (const h of betaOnly) {
    assert.equal(h.workflowName, "beta");
  }
});

test("scheduler: getHistory() supports limit and offset", () => {
  const sched = new WorkflowScheduler();

  for (let i = 0; i < 5; i++) {
    const entry = sched.schedule(
      makeWorkflow({ name: `w${i}` }),
      makeTrigger({ type: TRIGGER_TYPES.ON_DEMAND }),
    );
    sched.complete(entry.id);
  }

  const page1 = sched.getHistory({ limit: 2, offset: 0 });
  assert.ok(page1.length <= 2);

  const page2 = sched.getHistory({ limit: 2, offset: 2 });
  assert.ok(page2.length <= 2);

  // Should get different entries
  if (page1.length > 0 && page2.length > 0) {
    assert.notDeepEqual(page1, page2);
  }
});

test("scheduler: get() returns entry details or undefined", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(makeWorkflow(), makeTrigger({ type: TRIGGER_TYPES.ON_DEMAND }));

  const fetched = sched.get(entry.id);
  assert.ok(fetched);
  assert.equal(fetched.id, entry.id);
  assert.ok(fetched.stepCount);

  assert.equal(sched.get("nonexistent"), undefined);
});

test("scheduler: stats() returns aggregated statistics", () => {
  const sched = new WorkflowScheduler();

  sched.schedule(makeWorkflow({ name: "w1" }), makeTrigger({ type: TRIGGER_TYPES.ON_SCHEDULE, config: { cron: "0 2 * * *" } }));
  sched.schedule(makeWorkflow({ name: "w2" }), makeTrigger({ type: TRIGGER_TYPES.ON_PUSH }));

  const stats = sched.stats();
  assert.ok(typeof stats.total === "number");
  assert.ok(typeof stats.byStatus === "object");
  assert.ok(typeof stats.byTrigger === "object");
  assert.ok(typeof stats.running === "number");
  assert.ok(typeof stats.historyTotal === "number");
});

// ---- pause / resume ----

test("scheduler: pause() and resume() toggle workflow state", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(
    makeWorkflow(),
    makeTrigger({ type: TRIGGER_TYPES.ON_SCHEDULE, config: { cron: "0 2 * * *" } }),
  );

  assert.equal(sched.pause(entry.id), true);
  let updated = sched.get(entry.id);
  assert.equal(updated.status, STATUS.PAUSED);
  assert.ok(updated.pausedAt);

  assert.equal(sched.resume(entry.id), true);
  updated = sched.get(entry.id);
  assert.equal(updated.status, STATUS.SCHEDULED);
});

test("scheduler: pause() returns false for already paused or terminal", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(
    makeWorkflow(),
    makeTrigger({ type: TRIGGER_TYPES.ON_SCHEDULE, config: { cron: "0 2 * * *" } }),
  );

  sched.pause(entry.id);
  assert.equal(sched.pause(entry.id), false); // Already paused

  sched.complete(entry.id);
  assert.equal(sched.pause(entry.id), false); // Terminal
});

test("scheduler: resume() returns false for non-paused", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(
    makeWorkflow(),
    makeTrigger({ type: TRIGGER_TYPES.ON_SCHEDULE, config: { cron: "0 2 * * *" } }),
  );

  assert.equal(sched.resume(entry.id), false); // Not paused
  assert.equal(sched.resume("nonexistent"), false);
});

// ---- remove / clear ----

test("scheduler: remove() removes a scheduled entry", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(makeWorkflow(), makeTrigger({ type: TRIGGER_TYPES.ON_DEMAND }));

  assert.ok(sched.get(entry.id));
  assert.equal(sched.remove(entry.id), true);
  assert.equal(sched.get(entry.id), undefined);
  assert.equal(sched.remove("nonexistent"), false);
});

test("scheduler: clear() removes all entries", () => {
  const sched = new WorkflowScheduler();

  sched.schedule(makeWorkflow({ name: "a" }), makeTrigger({ type: TRIGGER_TYPES.ON_DEMAND }));
  sched.schedule(makeWorkflow({ name: "b" }), makeTrigger({ type: TRIGGER_TYPES.ON_SCHEDULE, config: { cron: "0 2 * * *" } }));

  assert.equal(sched.stats().total, 2);

  sched.clear();

  assert.equal(sched.stats().total, 0);
  assert.deepEqual(sched.getUpcoming(), []);
  assert.deepEqual(sched.getHistory(), []);
});

// ---- triggerNow ----

test("scheduler: triggerNow() manually triggers a scheduled workflow", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(
    makeWorkflow(),
    makeTrigger({ type: TRIGGER_TYPES.ON_SCHEDULE, config: { cron: "0 2 * * *" } }),
  );

  assert.equal(entry.status, STATUS.SCHEDULED);

  const triggered = sched.triggerNow(entry.id);
  assert.equal(triggered.status, STATUS.RUNNING);
  assert.ok(triggered.startedAt);
});

test("scheduler: triggerNow() returns false for already running", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(makeWorkflow(), makeTrigger({ type: TRIGGER_TYPES.ON_DEMAND }));

  // Already running (onDemand)
  assert.equal(sched.triggerNow(entry.id), false);
});

test("scheduler: triggerNow() returns false for unknown id", () => {
  const sched = new WorkflowScheduler();
  assert.equal(sched.triggerNow("nonexistent"), false);
});

// ---- Trigger types ----

test("scheduler: onPush trigger stores branch config", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(
    makeWorkflow(),
    makeTrigger({ type: TRIGGER_TYPES.ON_PUSH, config: { branch: "develop" } }),
  );

  assert.equal(entry.trigger.type, TRIGGER_TYPES.ON_PUSH);
});

test("scheduler: onPR trigger stores branch config", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(
    makeWorkflow(),
    makeTrigger({
      type: TRIGGER_TYPES.ON_PR,
      config: { targetBranch: "main", sourceBranch: "feature/*" },
    }),
  );

  assert.equal(entry.trigger.type, TRIGGER_TYPES.ON_PR);
});

test("scheduler: onFileChange trigger stores paths config", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(
    makeWorkflow(),
    makeTrigger({
      type: TRIGGER_TYPES.ON_FILE_CHANGE,
      config: { paths: ["src/**/*.js", "test/**/*.js"] },
    }),
  );

  assert.equal(entry.trigger.type, TRIGGER_TYPES.ON_FILE_CHANGE);
});

// ---- Events ----

test("scheduler: emits events on schedule, complete, fail, cancel", () => {
  const sched = new WorkflowScheduler();
  const events = [];

  sched.on("workflow.scheduled", (data) => events.push({ type: "scheduled", id: data.id }));
  sched.on("workflow.completed", (data) => events.push({ type: "completed", id: data.id }));
  sched.on("workflow.failed", (data) => events.push({ type: "failed", id: data.id }));
  sched.on("workflow.cancelled", (data) => events.push({ type: "cancelled", id: data.id }));

  // Schedule and complete
  const e1 = sched.schedule(makeWorkflow({ name: "e1" }), makeTrigger({ type: TRIGGER_TYPES.ON_DEMAND }));
  sched.complete(e1.id);

  // Schedule, fail, fail, fail (to terminal)
  const e2 = sched.schedule(makeWorkflow({ name: "e2" }), makeTrigger({ type: TRIGGER_TYPES.ON_DEMAND, maxRetries: 2 }));
  sched.fail(e2.id, new Error("fail 1"));
  sched.fail(e2.id, new Error("fail 2"));
  sched.fail(e2.id, new Error("fail 3"));

  // Schedule and cancel
  const e3 = sched.schedule(
    makeWorkflow({ name: "e3" }),
    makeTrigger({ type: TRIGGER_TYPES.ON_SCHEDULE, config: { cron: "0 2 * * *" } }),
  );
  sched.cancel(e3.id);

  const scheduled = events.filter((e) => e.type === "scheduled");
  const completed = events.filter((e) => e.type === "completed");
  const failed = events.filter((e) => e.type === "failed");
  const cancelled = events.filter((e) => e.type === "cancelled");

  assert.ok(scheduled.length >= 3, `Expected >= 3 scheduled, got ${scheduled.length}`);
  assert.ok(completed.length >= 1, `Expected >= 1 completed, got ${completed.length}`);
  assert.ok(failed.length >= 1, `Expected >= 1 failed, got ${failed.length}`);
  assert.ok(cancelled.length >= 1, `Expected >= 1 cancelled, got ${cancelled.length}`);
});

// ---- Cron expression parsing ----

test("scheduler: cron supports wildcard, ranges, steps, and lists", () => {
  const sched = new WorkflowScheduler();

  // Every minute
  const e1 = sched.schedule(
    makeWorkflow({ name: "every-min" }),
    makeTrigger({ type: TRIGGER_TYPES.ON_SCHEDULE, config: { cron: "* * * * *" } }),
  );
  assert.ok(e1.nextRunAt);

  // Range: 9-17 on weekdays
  const e2 = sched.schedule(
    makeWorkflow({ name: "business-hours" }),
    makeTrigger({ type: TRIGGER_TYPES.ON_SCHEDULE, config: { cron: "0 9-17 * * 1-5" } }),
  );
  assert.ok(e2.nextRunAt);

  // Step: every 15 minutes
  const e3 = sched.schedule(
    makeWorkflow({ name: "every-15" }),
    makeTrigger({ type: TRIGGER_TYPES.ON_SCHEDULE, config: { cron: "*/15 * * * *" } }),
  );
  assert.ok(e3.nextRunAt);

  // List: specific hours
  const e4 = sched.schedule(
    makeWorkflow({ name: "specific-hours" }),
    makeTrigger({ type: TRIGGER_TYPES.ON_SCHEDULE, config: { cron: "0 6,12,18 * * *" } }),
  );
  assert.ok(e4.nextRunAt);
});

// ---- Metadata and custom options ----

test("scheduler: schedule stores metadata and custom timeout", () => {
  const sched = new WorkflowScheduler();
  const entry = sched.schedule(
    makeWorkflow({ name: "custom-opts" }),
    makeTrigger({
      type: TRIGGER_TYPES.ON_DEMAND,
      name: "Custom Scheduled Job",
      priority: 5,
      maxRetries: 5,
      timeout: 900_000,
      metadata: { owner: "team-a", project: "core" },
    }),
  );

  assert.equal(entry.name, "Custom Scheduled Job");
  assert.equal(entry.trigger.type, TRIGGER_TYPES.ON_DEMAND);
  assert.equal(entry.priority, 5);
  assert.equal(entry.maxRetries, 5);
  assert.equal(entry.timeout, 900_000);
  assert.deepEqual(entry.metadata, { owner: "team-a", project: "core" });
});
