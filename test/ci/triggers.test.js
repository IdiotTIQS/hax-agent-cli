"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const { CITriggerManager, TriggerError, TRIGGER_TYPES } = require("../../src/ci/triggers");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function passHandler(event) {
  return { received: event };
}

async function failHandler(_event) {
  throw new Error("handler failure");
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("CITriggerManager", () => {
  let mgr;

  beforeEach(() => {
    mgr = new CITriggerManager();
  });

  // 1. register push trigger
  it("should register a push trigger and return an id", () => {
    const id = mgr.onPush(passHandler);
    assert.ok(typeof id === "string");
    assert.ok(id.startsWith("trigger-"));
    assert.strictEqual(mgr.count, 1);
  });

  // 2. register schedule trigger
  it("should register a schedule trigger with a valid cron expression", () => {
    const id = mgr.onSchedule("0 * * * *", passHandler);
    assert.ok(typeof id === "string");
    assert.strictEqual(mgr.count, 1);

    const triggers = mgr.getTriggers();
    const t = triggers.find((t) => t.id === id);
    assert.strictEqual(t.type, "schedule");
    assert.strictEqual(t.cron, "0 * * * *");
  });

  it("should reject invalid cron expressions", () => {
    assert.throws(() => mgr.onSchedule("invalid", passHandler), { code: "INVALID_CRON" });
    assert.throws(() => mgr.onSchedule("", passHandler), { code: "INVALID_CRON" });
    assert.throws(() => mgr.onSchedule("0 * *", passHandler), { code: "INVALID_CRON" }); // only 3 parts
  });

  // 3. register PR trigger
  it("should register a pull_request trigger", () => {
    const id = mgr.onPullRequest(passHandler, { name: "pr-check" });
    const triggers = mgr.getTriggers();
    const t = triggers.find((t) => t.id === id);
    assert.strictEqual(t.type, "pull_request");
    assert.strictEqual(t.name, "pr-check");
  });

  // 4. register manual trigger
  it("should register a manual (on-demand) trigger", () => {
    const id = mgr.onDemand("deploy-staging");
    assert.ok(typeof id === "string");

    const triggers = mgr.getTriggers();
    const t = triggers.find((t) => t.id === id);
    assert.strictEqual(t.type, "manual");
    assert.strictEqual(t.manualName, "deploy-staging");
  });

  it("should throw on empty manual trigger name", () => {
    assert.throws(() => mgr.onDemand(""), { code: "INVALID_NAME" });
  });

  // 5. fire a trigger with event payload
  it("should fire a push trigger and receive correct event", async () => {
    const id = mgr.onPush(async (event) => {
      assert.strictEqual(event.type, "push");
      assert.strictEqual(event.branch, "feature/x");
      assert.strictEqual(event.author, "dev");
      return { ok: true };
    });

    const result = await mgr.fire(id, {
      branch: "feature/x",
      author: "dev",
      commit: "abc123",
    });

    assert.deepStrictEqual(result, { ok: true });
  });

  // 6. fireDemand for manual triggers
  it("should fire a demand trigger by name with params", async () => {
    const id = mgr.onDemand("release", async (event) => {
      return { params: event.params };
    });

    const result = await mgr.fireDemand("release", { version: "2.0.0" });
    assert.deepStrictEqual(result, { params: { version: "2.0.0" } });
  });

  // 7. fireAll for a given type
  it("should fireAll triggers of a given type", async () => {
    mgr.onPush(async () => "a");
    mgr.onPush(async () => "b");
    mgr.onSchedule("0 0 * * *", async () => "c"); // different type

    const results = await mgr.fireAll("push", { branch: "main" });
    assert.strictEqual(results.length, 2);
    assert.ok(results.every((r) => r.status === "success"));
    assert.deepStrictEqual(results.map((r) => r.result), ["a", "b"]);
  });

  it("should collect errors in fireAll", async () => {
    mgr.onPush(failHandler);
    mgr.onPush(passHandler);

    const results = await mgr.fireAll("push");
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].status, "error");
    assert.strictEqual(results[1].status, "success");
  });

  // 8. fire throws on unknown trigger
  it("should throw when firing unknown trigger", async () => {
    await assert.rejects(() => mgr.fire("nonexistent"), { code: "NOT_FOUND" });
  });

  // 9. fire throws on disabled trigger
  it("should throw when firing a disabled trigger", async () => {
    const id = mgr.onPush(passHandler);
    mgr.disable(id);

    await assert.rejects(() => mgr.fire(id), { code: "DISABLED" });
  });

  // 10. enable / disable
  it("should enable and disable triggers", () => {
    const id = mgr.onPush(passHandler);
    const t = mgr.getTriggers().find((t) => t.id === id);
    assert.strictEqual(t.enabled, true);

    mgr.disable(id);
    const t2 = mgr.getTriggers().find((t) => t.id === id);
    assert.strictEqual(t2.enabled, false);

    mgr.enable(id);
    const t3 = mgr.getTriggers().find((t) => t.id === id);
    assert.strictEqual(t3.enabled, true);
  });

  it("should throw on enable/disable of unknown trigger", () => {
    assert.throws(() => mgr.disable("nope"), { code: "NOT_FOUND" });
    assert.throws(() => mgr.enable("nope"), { code: "NOT_FOUND" });
  });

  // 11. remove trigger
  it("should remove a trigger", () => {
    const id = mgr.onPush(passHandler);
    assert.strictEqual(mgr.count, 1);

    const removed = mgr.remove(id);
    assert.ok(removed);
    assert.strictEqual(mgr.count, 0);
  });

  // 12. getTriggers returns metadata
  it("should return trigger metadata via getTriggers", () => {
    mgr.onPush(passHandler, { name: "ci-push" });
    mgr.onSchedule("0 */2 * * *", passHandler, { name: "nightly" });

    const triggers = mgr.getTriggers();
    assert.strictEqual(triggers.length, 2);
    assert.ok(triggers.every((t) => typeof t.id === "string"));
    assert.ok(triggers.every((t) => typeof t.createdAt === "string"));
    assert.ok(triggers.every((t) => t.lastRun === null)); // not fired yet
  });

  // 13. events
  it("should emit trigger lifecycle events", async () => {
    const events = [];
    mgr.on("trigger.start", (e) => events.push(["start", e.triggerId]));
    mgr.on("trigger.complete", (e) => events.push(["complete", e.triggerId]));

    const id = mgr.onPush(passHandler);
    await mgr.fire(id);

    assert.strictEqual(events.length, 2);
    assert.deepStrictEqual(events[0][0], "start");
    assert.deepStrictEqual(events[1][0], "complete");
    assert.strictEqual(events[0][1], id);
  });

  it("should emit trigger.error on failure", async () => {
    const errors = [];
    mgr.on("trigger.error", (e) => errors.push(e));

    const id = mgr.onPush(failHandler);
    try {
      await mgr.fire(id);
    } catch (_e) {
      // expected
    }

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].error.message, "handler failure");
  });

  // 14. matchesCron
  it("should match cron expressions correctly", () => {
    // This test constructs a specific date and checks matching
    // Jan 1, 2023 12:00 = Sunday
    const date = new Date(2023, 0, 1, 12, 0, 0, 0);

    assert.ok(mgr.matchesCron("0 12 1 1 0", date));  // minute=0, hour=12, dom=1, month=1, dow=0(Sunday)
    assert.ok(mgr.matchesCron("* * * * *", date));    // every minute
    assert.ok(mgr.matchesCron("0 12 * * *", date));   // 12:00 every day
    assert.ok(!mgr.matchesCron("0 13 * * *", date));  // 13:00 — not a match
    assert.ok(mgr.matchesCron("0,30 12 * * *", date)); // minute 0 or 30 at 12:00
    assert.ok(!mgr.matchesCron("5 12 * * *", date));  // minute 5 — not a match
    assert.ok(mgr.matchesCron("*/5 * * * *", date));  // minute divisible by 5 (0)
    assert.ok(mgr.matchesCron("0-30 * * * *", date)); // minute 0-30 range
    assert.ok(!mgr.matchesCron("31-59 * * * *", date)); // minute 31-59 — not in range
  });

  it("should match 6-part cron (with seconds)", () => {
    const date = new Date(2023, 0, 1, 12, 0, 30, 0); // 30 seconds
    assert.ok(mgr.matchesCron("30 0 12 1 1 0", date)); // sec=30
    assert.ok(!mgr.matchesCron("45 0 12 1 1 0", date)); // sec=45 no match
  });

  // 15. fireDemand not found
  it("should throw when firing unknown demand", async () => {
    await assert.rejects(() => mgr.fireDemand("ghost"), { code: "NOT_FOUND" });
  });
});
