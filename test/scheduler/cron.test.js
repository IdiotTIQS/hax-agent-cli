"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CronScheduler,
  parseCron,
  parseField,
  cronMatches,
  nextCronDate,
} = require("../../src/scheduler/cron");

// ---------------------------------------------------------------------------
// parseField
// ---------------------------------------------------------------------------

test("parseField: * returns all values in range", () => {
  const s = parseField("*", 0, 5);
  assert.equal(s.size, 6);
  for (let i = 0; i <= 5; i++) assert.ok(s.has(i));
});

test("parseField: exact value", () => {
  const s = parseField("3", 0, 59);
  assert.equal(s.size, 1);
  assert.ok(s.has(3));
});

test("parseField: range", () => {
  const s = parseField("10-15", 0, 59);
  assert.equal(s.size, 6);
  for (let i = 10; i <= 15; i++) assert.ok(s.has(i));
});

test("parseField: step syntax */5", () => {
  const s = parseField("*/5", 0, 23);
  assert.deepEqual([...s].sort((a, b) => a - b), [0, 5, 10, 15, 20]);
});

test("parseField: range with step", () => {
  const s = parseField("0-15/5", 0, 23);
  assert.deepEqual([...s].sort((a, b) => a - b), [0, 5, 10, 15]);
});

test("parseField: list", () => {
  const s = parseField("1,3,5,7", 0, 10);
  assert.deepEqual([...s].sort((a, b) => a - b), [1, 3, 5, 7]);
});

test("parseField: list with ranges and steps", () => {
  const s = parseField("1-3,5,7-9/2", 0, 10);
  assert.deepEqual([...s].sort((a, b) => a - b), [1, 2, 3, 5, 7, 9]);
});

// ---------------------------------------------------------------------------
// parseCron
// ---------------------------------------------------------------------------

test("parseCron: valid 5-field expression", () => {
  const parsed = parseCron("*/15 9-17 1,15 * 1-5");
  assert.ok(parsed.minute instanceof Set);
  assert.ok(parsed.hour instanceof Set);
  assert.ok(parsed.dayOfMonth instanceof Set);
  assert.ok(parsed.month instanceof Set);
  assert.ok(parsed.dayOfWeek instanceof Set);
});

test("parseCron: throws on wrong field count", () => {
  assert.throws(() => parseCron("* * * *"), { message: /expected 5 fields/ });
  assert.throws(() => parseCron("* * * * * *"), { message: /expected 5 fields/ });
});

test("parseCron: every-minute expression matches all minutes", () => {
  const parsed = parseCron("* * * * *");
  assert.equal(parsed.minute.size, 60);
  assert.equal(parsed.hour.size, 24);
});

// ---------------------------------------------------------------------------
// cronMatches
// ---------------------------------------------------------------------------

test("cronMatches: matches specific minute", () => {
  const schedule = parseCron("30 14 * * *"); // 14:30 every day
  assert.equal(cronMatches(schedule, new Date(2026, 4, 22, 14, 30, 0)), true);
  assert.equal(cronMatches(schedule, new Date(2026, 4, 22, 14, 31, 0)), false);
  assert.equal(cronMatches(schedule, new Date(2026, 4, 22, 15, 30, 0)), false);
});

test("cronMatches: every Sunday at midnight", () => {
  const schedule = parseCron("0 0 * * 0"); // midnight, Sunday
  // 2026-05-24 is a Sunday
  const sun = new Date(2026, 4, 24, 0, 0, 0);
  const mon = new Date(2026, 4, 25, 0, 0, 0);
  assert.equal(cronMatches(schedule, sun), true);
  assert.equal(cronMatches(schedule, mon), false);
});

// ---------------------------------------------------------------------------
// nextCronDate
// ---------------------------------------------------------------------------

test("nextCronDate: finds the next matching minute", () => {
  const schedule = parseCron("15 * * * *"); // minute 15 of every hour
  const base = new Date(2026, 4, 22, 12, 0, 0);
  const next = nextCronDate(schedule, base);
  assert.ok(next);
  assert.equal(next.getMinutes(), 15);
  assert.equal(next.getHours(), 12);
});

test("nextCronDate: returns null for impossible schedule", () => {
  // A schedule that never matches in the next 2 years (e.g., Feb 30).
  const schedule = parseCron("0 0 30 2 *"); // Feb 30 never exists
  const next = nextCronDate(schedule);
  assert.equal(next, null);
});

// ---------------------------------------------------------------------------
// CronScheduler
// ---------------------------------------------------------------------------

test("CronScheduler: schedule adds a cron job and list returns it", () => {
  const scheduler = new CronScheduler();
  const jobId = scheduler.schedule("0 9 * * 1-5", { type: "daily-report" });
  assert.ok(jobId.startsWith("cron-"));

  const jobs = scheduler.list();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, jobId);
  assert.equal(jobs[0].cronExpr, "0 9 * * 1-5");
});

test("CronScheduler: scheduleAt adds a one-shot job", () => {
  const scheduler = new CronScheduler();
  const future = Date.now() + 60_000;
  const jobId = scheduler.scheduleAt(future, { type: "reminder" });
  assert.ok(jobId.startsWith("at-"));

  const nextRun = scheduler.getNextRun(jobId);
  assert.ok(nextRun);
  assert.equal(nextRun.getTime(), future);
});

test("CronScheduler: scheduleAt throws for past date", () => {
  const scheduler = new CronScheduler();
  assert.throws(() => scheduler.scheduleAt(Date.now() - 10_000, { type: "late" }), {
    message: /future/,
  });
});

test("CronScheduler: scheduleEvery adds a recurring interval job", () => {
  const scheduler = new CronScheduler();
  const now = Date.now();
  const jobId = scheduler.scheduleEvery(5_000, { type: "heartbeat" });
  assert.ok(jobId.startsWith("every-"));

  const nextRun = scheduler.getNextRun(jobId);
  assert.ok(nextRun.getTime() >= now + 5_000);
});

test("CronScheduler: scheduleEvery throws for non-positive interval", () => {
  const scheduler = new CronScheduler();
  assert.throws(() => scheduler.scheduleEvery(0, { type: "bad" }), {
    message: />= 1/,
  });
  assert.throws(() => scheduler.scheduleEvery(-100, { type: "bad" }), {
    message: />= 1/,
  });
});

test("CronScheduler: cancel removes a job", () => {
  const scheduler = new CronScheduler();
  const jobId = scheduler.schedule("0 6 * * *", { type: "morning" });
  assert.equal(scheduler.jobCount, 1);

  scheduler.cancel(jobId);
  assert.equal(scheduler.jobCount, 0);
  assert.equal(scheduler.list().length, 0);
  assert.equal(scheduler.getNextRun(jobId), null);
  assert.equal(scheduler.cancel("nonexistent"), false);
});

test("CronScheduler: list respects activeOnly option", () => {
  const scheduler = new CronScheduler();
  scheduler.schedule("0 * * * *", { type: "hourly" });
  const jobId = scheduler.scheduleEvery(1000, { type: "pulse" });

  assert.equal(scheduler.list({ activeOnly: true }).length, 2);
  assert.equal(scheduler.list({ activeOnly: false }).length, 2);

  scheduler.cancel(jobId);
  assert.equal(scheduler.list({ activeOnly: true }).length, 1);
  assert.equal(scheduler.list({ activeOnly: false }).length, 1);
});

test("CronScheduler: setEnqueue receives fired jobs", async () => {
  const scheduler = new CronScheduler({ tickInterval: 50 });

  const enqueued = [];
  scheduler.setEnqueue((task) => enqueued.push(task));

  // Schedule a job that fires almost immediately.
  const now = Date.now();
  scheduler.scheduleAt(now + 30, { id: "quick", type: "fast" });

  scheduler.start();

  // Wait for tick to fire it.
  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (enqueued.length > 0) { clearInterval(check); resolve(); }
    }, 10);
  });

  scheduler.stop();

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].id, "quick");

  // One-shot jobs are removed after firing.
  assert.equal(scheduler.jobCount, 0);
});

test("CronScheduler: start is idempotent", () => {
  const scheduler = new CronScheduler();
  scheduler.start();
  scheduler.start(); // second call is a no-op
  scheduler.stop();
  // Should not throw or break.
});

test("CronScheduler: getNextRun returns null for unknown id", () => {
  const scheduler = new CronScheduler();
  assert.equal(scheduler.getNextRun("not-a-job"), null);
});
