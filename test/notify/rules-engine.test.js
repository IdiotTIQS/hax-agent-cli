/**
 * Tests for NotificationRules engine: rule registration, evaluation,
 * matching, actions, resolve, and condition checkers.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  NotificationRules,
  doesEventTypeMatch,
  doesSeverityMatch,
  doesListMatch,
  checkFrequency,
  checkTimeWindow,
} = require("../../src/notify/rules-engine");

// ---- Helpers ---------------------------------------------------------------

function makeEvent(overrides = {}) {
  return {
    type: "task.complete",
    severity: "info",
    source: "agent",
    ...overrides,
  };
}

// ---- Rule registration ------------------------------------------------------

test("addRule: registers a valid rule and returns it", () => {
  const engine = new NotificationRules();
  const rule = engine.addRule({
    id: "test-1",
    priority: 10,
    condition: { eventType: "task.complete" },
    action: { type: "notify", params: { channel: "desktop" } },
  });

  assert.equal(rule.id, "test-1");
  assert.equal(rule.priority, 10);
  assert.equal(rule.enabled, true);
  assert.equal(engine.count, 1);
});

test("addRule: generates an id when requireId is false", () => {
  const engine = new NotificationRules({ requireId: false });
  const rule = engine.addRule({
    priority: 5,
    condition: {},
    action: { type: "notify" },
  });

  assert.ok(typeof rule.id === "string");
  assert.ok(rule.id.length > 0);
  assert.equal(engine.count, 1);
});

test("addRule: throws for duplicate id", () => {
  const engine = new NotificationRules();
  engine.addRule({ id: "dup", condition: {}, action: { type: "notify" } });

  assert.throws(() => {
    engine.addRule({ id: "dup", condition: {}, action: { type: "notify" } });
  }, { message: /already exists/ });
});

test("addRule: throws for missing id when requireId is true", () => {
  const engine = new NotificationRules();
  assert.throws(() => {
    engine.addRule({ condition: {}, action: { type: "notify" } });
  }, { message: /non-empty string `id`/ });
});

test("addRule: throws for invalid action type", () => {
  const engine = new NotificationRules();
  assert.throws(() => {
    engine.addRule({
      id: "bad-action",
      action: { type: "demolish" },
    });
  }, { message: /Unknown action type/ });
});

test("removeRule: removes a rule by id and returns true", () => {
  const engine = new NotificationRules();
  engine.addRule({ id: "r1", condition: {}, action: { type: "notify" } });
  assert.equal(engine.count, 1);

  const removed = engine.removeRule("r1");
  assert.equal(removed, true);
  assert.equal(engine.count, 0);

  const notFound = engine.removeRule("r1");
  assert.equal(notFound, false);
});

test("setRuleEnabled: enables and disables a rule", () => {
  const engine = new NotificationRules();
  engine.addRule({ id: "toggle", condition: { eventType: "task.complete" }, action: { type: "notify" } });

  const result = engine.evaluate(makeEvent());
  assert.equal(result[0].matched, true);

  engine.setRuleEnabled("toggle", false);
  const result2 = engine.evaluate(makeEvent());
  assert.equal(result2.length, 0);

  engine.setRuleEnabled("toggle", true);
  const result3 = engine.evaluate(makeEvent());
  assert.equal(result3[0].matched, true);
});

test("listRules: returns rules sorted by priority descending", () => {
  const engine = new NotificationRules();
  engine.addRule({ id: "low", priority: 1, condition: {}, action: { type: "notify" } });
  engine.addRule({ id: "high", priority: 100, condition: {}, action: { type: "notify" } });
  engine.addRule({ id: "mid", priority: 50, condition: {}, action: { type: "notify" } });

  const rules = engine.listRules();
  assert.equal(rules.length, 3);
  assert.equal(rules[0].id, "high");
  assert.equal(rules[1].id, "mid");
  assert.equal(rules[2].id, "low");
});

// ---- Evaluation ----------------------------------------------------------

test("evaluate: matches eventType condition exactly", () => {
  const engine = new NotificationRules();
  engine.addRule({
    id: "complete-only",
    condition: { eventType: "task.complete" },
    action: { type: "notify" },
  });

  const match = engine.evaluate(makeEvent({ type: "task.complete" }));
  assert.equal(match[0].matched, true);

  const noMatch = engine.evaluate(makeEvent({ type: "task.error" }));
  assert.equal(noMatch[0].matched, false);
  assert.ok(noMatch[0].reason.includes("does not match"));
});

test("evaluate: matches eventType with array and wildcard", () => {
  const engine = new NotificationRules();
  engine.addRule({
    id: "multi-type",
    condition: { eventType: ["task.complete", "task.error"] },
    action: { type: "notify" },
  });
  engine.addRule({
    id: "wildcard",
    condition: { eventType: "*" },
    action: { type: "notify" },
  });

  // Multi-type match
  assert.equal(engine.evaluate(makeEvent({ type: "task.complete" }))[0].matched, true);
  assert.equal(engine.evaluate(makeEvent({ type: "task.error" }))[0].matched, true);
  assert.equal(engine.evaluate(makeEvent({ type: "file.change" }))[0].matched, false);

  // Wildcard
  assert.equal(engine.evaluate(makeEvent({ type: "anything" }))[1].matched, true);
});

test("evaluate: matches severity condition (string, array, min, max)", () => {
  const engine = new NotificationRules();

  // Exact severity match
  engine.addRule({
    id: "exact-error",
    condition: { severity: "error" },
    action: { type: "notify" },
  });
  assert.equal(engine.evaluate(makeEvent({ severity: "error" }))[0].matched, true);
  assert.equal(engine.evaluate(makeEvent({ severity: "warn" }))[0].matched, false);

  // Min severity
  engine.addRule({
    id: "min-error",
    condition: { severity: { min: "error" } },
    action: { type: "notify" },
  });
  const results = engine.evaluate(makeEvent({ severity: "critical" }));
  const minRule = results.find((r) => r.rule.id === "min-error");
  assert.equal(minRule.matched, true);

  // Max severity
  engine.addRule({
    id: "max-warn",
    condition: { severity: { max: "warn" } },
    action: { type: "notify" },
  });
  const results2 = engine.evaluate(makeEvent({ severity: "info" }));
  const maxRule = results2.find((r) => r.rule.id === "max-warn");
  assert.equal(maxRule.matched, true);
});

test("evaluate: matches source condition", () => {
  const engine = new NotificationRules();
  engine.addRule({
    id: "agent-only",
    condition: { source: "agent" },
    action: { type: "notify" },
  });
  engine.addRule({
    id: "multi-source",
    condition: { source: ["agent", "scheduler"] },
    action: { type: "notify" },
  });

  assert.equal(engine.evaluate(makeEvent({ source: "agent" }))[0].matched, true);
  assert.equal(engine.evaluate(makeEvent({ source: "ui" }))[0].matched, false);
  assert.equal(engine.evaluate(makeEvent({ source: "scheduler" }))[1].matched, true);
});

test("evaluate: matches timeWindow with epoch range", () => {
  const engine = new NotificationRules();
  const now = Date.now();
  engine.addRule({
    id: "window-active",
    condition: {
      timeWindow: { start: now - 10000, end: now + 10000 },
    },
    action: { type: "notify" },
  });
  engine.addRule({
    id: "window-expired",
    condition: {
      timeWindow: { start: 1, end: 100 },
    },
    action: { type: "notify" },
  });

  const results = engine.evaluate(makeEvent());
  const active = results.find((r) => r.rule.id === "window-active");
  const expired = results.find((r) => r.rule.id === "window-expired");

  assert.equal(active.matched, true);
  assert.equal(expired.matched, false);
  assert.ok(expired.reason.includes("outside window"));
});

test("evaluate: matches timeWindow with days of week", () => {
  const engine = new NotificationRules();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const allDays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  // Rule that only fires today
  engine.addRule({
    id: "today-only",
    condition: { timeWindow: { days: [today] } },
    action: { type: "notify" },
  });
  // Rule that fires on a non-existent day
  engine.addRule({
    id: "never",
    condition: { timeWindow: { days: ["funday"] } },
    action: { type: "notify" },
  });

  const results = engine.evaluate(makeEvent());
  const todayRule = results.find((r) => r.rule.id === "today-only");
  const neverRule = results.find((r) => r.rule.id === "never");

  assert.equal(todayRule.matched, true);
  assert.equal(neverRule.matched, false);
  assert.ok(neverRule.reason.includes("not in allowed days"));
});

test("evaluate: matches timeWindow with hours range", () => {
  const engine = new NotificationRules();
  engine.addRule({
    id: "all-day",
    condition: { timeWindow: { hours: [0, 24] } },
    action: { type: "notify" },
  });
  engine.addRule({
    id: "nonexistent-hour-range",
    condition: { timeWindow: { hours: [25, 26] } },
    action: { type: "notify" },
  });

  const results = engine.evaluate(makeEvent());
  assert.equal(results.find((r) => r.rule.id === "all-day").matched, true);
  assert.equal(results.find((r) => r.rule.id === "nonexistent-hour-range").matched, false);
});

test("evaluate: respects priority ordering in results", () => {
  const engine = new NotificationRules();
  engine.addRule({ id: "p10", priority: 10, condition: { eventType: "task.complete" }, action: { type: "notify" } });
  engine.addRule({ id: "p100", priority: 100, condition: { eventType: "task.complete" }, action: { type: "escalate" } });
  engine.addRule({ id: "p1", priority: 1, condition: { eventType: "task.complete" }, action: { type: "notify" } });

  const results = engine.evaluate(makeEvent());
  assert.equal(results[0].rule.id, "p100");
  assert.equal(results[1].rule.id, "p10");
  assert.equal(results[2].rule.id, "p1");
});

test("evaluate: function condition receives event and context", () => {
  const engine = new NotificationRules();
  const received = [];

  engine.addRule({
    id: "fn-condition",
    condition: (event, ctx) => {
      received.push({ event, ctx });
      return event.durationMs > 5000;
    },
    action: { type: "notify" },
  });

  const results = engine.evaluate(
    makeEvent({ durationMs: 10000 }),
    { extra: "data" }
  );
  assert.equal(results[0].matched, true);
  assert.equal(received.length, 1);
  assert.equal(received[0].event.durationMs, 10000);
  assert.equal(received[0].ctx.extra, "data");
});

test("evaluate: function condition that throws is treated as not matched", () => {
  const engine = new NotificationRules();
  engine.addRule({
    id: "throws",
    condition: () => {
      throw new Error("eval failure");
    },
    action: { type: "notify" },
  });

  const results = engine.evaluate(makeEvent());
  assert.equal(results[0].matched, false);
  assert.ok(results[0].reason.includes("eval failure"));
});

// ---- getMatchingRules -------------------------------------------------------

test("getMatchingRules: returns only matching rule objects", () => {
  const engine = new NotificationRules();
  engine.addRule({ id: "match", condition: { eventType: "task.complete" }, action: { type: "notify" } });
  engine.addRule({ id: "nomatch", condition: { eventType: "task.error" }, action: { type: "notify" } });

  const matched = engine.getMatchingRules(makeEvent({ type: "task.complete" }));
  assert.equal(matched.length, 1);
  assert.equal(matched[0].id, "match");
});

// ---- getActions -------------------------------------------------------------

test("getActions: extracts actions from a rule object", () => {
  const engine = new NotificationRules();
  const rule = engine.addRule({
    id: "multi-action",
    condition: {},
    action: [
      { type: "notify", params: { channel: "desktop" } },
      { type: "route", params: { target: "slack" } },
    ],
  });

  const actions = engine.getActions(rule);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].type, "notify");
  assert.equal(actions[0].params.channel, "desktop");
  assert.equal(actions[1].type, "route");
  assert.equal(actions[1].params.target, "slack");
});

test("getActions: handles evaluation result input", () => {
  const engine = new NotificationRules();
  engine.addRule({
    id: "single",
    condition: { eventType: "task.complete" },
    action: { type: "escalate", params: { to: "critical" } },
  });

  const [result] = engine.evaluate(makeEvent());
  const actions = engine.getActions(result);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "escalate");
});

test("getActions: returns empty array for missing action", () => {
  const engine = new NotificationRules();
  assert.deepEqual(engine.getActions(null), []);
  assert.deepEqual(engine.getActions({}), []);
});

// ---- resolve -----------------------------------------------------------------

test("resolve: returns suppressed when suppress rule matches", () => {
  const engine = new NotificationRules();
  engine.addRule({
    id: "suppress-info",
    priority: 100,
    condition: { severity: "info" },
    action: { type: "suppress", params: { reason: "Not important" } },
  });
  engine.addRule({
    id: "always-notify",
    priority: 1,
    condition: { eventType: "task.complete" },
    action: { type: "notify" },
  });

  const result = engine.resolve(makeEvent({ severity: "info" }));
  assert.equal(result.matched, true);
  assert.equal(result.suppressed, true);
  assert.deepEqual(result.suppressedBy, ["suppress-info"]);
  assert.ok(result.actions.every((a) => a.type === "suppress"));
});

test("resolve: returns non-suppress actions when nothing suppresses", () => {
  const engine = new NotificationRules();
  engine.addRule({
    id: "route-slack",
    priority: 10,
    condition: { eventType: "task.complete" },
    action: { type: "route", params: { target: "slack" } },
  });

  const result = engine.resolve(makeEvent({ severity: "info" }));
  assert.equal(result.matched, true);
  assert.equal(result.suppressed, false);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].type, "route");
});

// ---- Evaluation log ----------------------------------------------------------

test("getLog: tracks evaluation entries", () => {
  const engine = new NotificationRules();
  engine.addRule({ id: "r1", condition: { eventType: "task.complete" }, action: { type: "notify" } });

  engine.evaluate(makeEvent());
  engine.evaluate(makeEvent({ type: "task.error" }));

  const log = engine.getLog();
  assert.equal(log.length, 2);
  assert.equal(log[0].ruleId, "r1");
  assert.equal(log[0].matched, true);
  assert.equal(log[1].matched, false);
});

// ---- Query methods ----------------------------------------------------------

test("getRulesByActionType: filters rules by action type", () => {
  const engine = new NotificationRules();
  engine.addRule({ id: "n1", condition: {}, action: { type: "notify" } });
  engine.addRule({ id: "s1", condition: {}, action: { type: "suppress" } });
  engine.addRule({ id: "r1", condition: {}, action: { type: "route" } });

  const notifiers = engine.getRulesByActionType("notify");
  assert.equal(notifiers.length, 1);
  assert.equal(notifiers[0].id, "n1");

  const suppressors = engine.getRulesByActionType("suppress");
  assert.equal(suppressors.length, 1);
  assert.equal(suppressors[0].id, "s1");
});

test("getRulesByEventType: filters rules by event type target", () => {
  const engine = new NotificationRules();
  engine.addRule({ id: "complete", condition: { eventType: "task.complete" }, action: { type: "notify" } });
  engine.addRule({ id: "error", condition: { eventType: "task.error" }, action: { type: "notify" } });
  engine.addRule({ id: "all", condition: { eventType: "*" }, action: { type: "notify" } });

  const completeRules = engine.getRulesByEventType("task.complete");
  assert.equal(completeRules.length, 2); // explicit + wildcard

  const errorRules = engine.getRulesByEventType("task.error");
  assert.equal(errorRules.length, 2);
});

// ---- Condition checker unit tests --------------------------------------------

test("doesEventTypeMatch: matches string, array, wildcard, and regex", () => {
  // String match
  assert.equal(doesEventTypeMatch({ eventType: "task.complete" }, "task.complete"), true);
  assert.equal(doesEventTypeMatch({ eventType: "task.complete" }, "task.error"), false);

  // Wildcard
  assert.equal(doesEventTypeMatch({ eventType: "*" }, "anything"), true);

  // Array
  assert.equal(doesEventTypeMatch({ eventType: ["task.complete", "task.error"] }, "task.error"), true);
  assert.equal(doesEventTypeMatch({ eventType: ["task.complete", "task.error"] }, "file.change"), false);

  // Regex
  assert.equal(doesEventTypeMatch({ eventType: /^task\./ }, "task.complete"), true);
  assert.equal(doesEventTypeMatch({ eventType: /^task\./ }, "file.change"), false);

  // Undefined condition passes
  assert.equal(doesEventTypeMatch({}, "anything"), true);
});

test("doesSeverityMatch: matches object spec with min and max", () => {
  // Exact string
  assert.equal(doesSeverityMatch("error", "error"), true);
  assert.equal(doesSeverityMatch("error", "critical"), false);

  // Array
  assert.equal(doesSeverityMatch(["error", "critical"], "critical"), true);
  assert.equal(doesSeverityMatch(["error", "critical"], "info"), false);

  // Min
  assert.equal(doesSeverityMatch({ min: "error" }, "critical"), true);
  assert.equal(doesSeverityMatch({ min: "error" }, "error"), true);
  assert.equal(doesSeverityMatch({ min: "error" }, "warn"), false);

  // Max
  assert.equal(doesSeverityMatch({ max: "warn" }, "info"), true);
  assert.equal(doesSeverityMatch({ max: "warn" }, "error"), false);

  // Exact (object form)
  assert.equal(doesSeverityMatch({ exact: "error" }, "error"), true);
  assert.equal(doesSeverityMatch({ exact: "error" }, "warn"), false);

  // Rank
  assert.equal(doesSeverityMatch({ rank: 2 }, "error"), true);
  assert.equal(doesSeverityMatch({ rank: 2 }, "warn"), false);

  // Null/undefined event
  assert.equal(doesSeverityMatch("error", null), false);
  assert.equal(doesSeverityMatch("error", undefined), false);
});

test("doesListMatch: matches string, array, wildcard, regex, and function", () => {
  assert.equal(doesListMatch("agent", "agent"), true);
  assert.equal(doesListMatch("agent", "ui"), false);
  assert.equal(doesListMatch(["agent", "scheduler"], "scheduler"), true);
  assert.equal(doesListMatch("*", "anything"), true);
  assert.equal(doesListMatch(/^ag/, "agent"), true);
  assert.equal(doesListMatch((v) => v.length > 3, "agent"), true);
  assert.equal(doesListMatch((v) => v.length > 3, "ui"), false);
  assert.equal(doesListMatch(undefined, "x"), true);
  assert.equal(doesListMatch("agent", null), false);
});

test("checkFrequency: enforces max count and rate limits", () => {
  const ctx = {
    _history: [
      { type: "task.complete", timestamp: Date.now() - 1000 },
      { type: "task.complete", timestamp: Date.now() - 500 },
      { type: "task.complete", timestamp: Date.now() - 100 },
    ],
  };

  // Max total count of 2 should fail (3 in history)
  const r1 = checkFrequency(2, { type: "task.complete" }, ctx);
  assert.equal(r1.passed, false);

  // Max total count of 5 should pass
  const r2 = checkFrequency(5, { type: "task.complete" }, ctx);
  assert.equal(r2.passed, true);

  // Max 2 in 60000ms window (all 3 are within window)
  const r3 = checkFrequency(
    { max: 2, windowMs: 60000 },
    { type: "task.complete" },
    ctx
  );
  assert.equal(r3.passed, false);

  // Max 10 in window passes
  const r4 = checkFrequency(
    { max: 10, windowMs: 60000 },
    { type: "task.complete" },
    ctx
  );
  assert.equal(r4.passed, true);

  // Min frequency: 3 required, 3 present
  const r5 = checkFrequency(
    { min: 3, windowMs: 60000 },
    { type: "task.complete" },
    ctx
  );
  assert.equal(r5.passed, true);

  // Min frequency: 5 required, only 3 present
  const r6 = checkFrequency(
    { min: 5, windowMs: 60000 },
    { type: "task.complete" },
    ctx
  );
  assert.equal(r6.passed, false);
});

test("checkTimeWindow: validates days and hours", () => {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const hour = new Date().getHours();

  // Day match (today)
  const r1 = checkTimeWindow({ days: [today] });
  assert.equal(r1.passed, true);

  // All-day hours
  const r2 = checkTimeWindow({ hours: [0, 24] });
  assert.equal(r2.passed, true);

  // Current hour range wrapping (e.g., [hour - 1, hour + 2])
  const r3 = checkTimeWindow({ hours: [Math.max(0, hour - 1), Math.min(24, hour + 2)] });
  assert.equal(r3.passed, true);

  // Exclusion range that excludes everything
  const r4 = checkTimeWindow({ excludeHours: [0, 24] });
  assert.equal(r4.passed, false);

  // Wrapping exclusion range when current hour is in range
  const wrapExclude = hour >= 22 || hour < 6 ? [22, 6] : [Math.max(0, hour - 1), Math.min(24, hour + 1)];
  const r5 = checkTimeWindow({ excludeHours: wrapExclude });
  assert.equal(r5.passed, false);
});

test("checkTimeWindow: validates after and before bounds", () => {
  const now = Date.now();

  // Within window
  const r1 = checkTimeWindow({ after: now - 10000, before: now + 10000 });
  assert.equal(r1.passed, true);

  // Too early
  const r2 = checkTimeWindow({ after: now + 10000 });
  assert.equal(r2.passed, false);
  assert.ok(r2.reason.includes("before allowed start"));

  // Too late
  const r3 = checkTimeWindow({ before: now - 10000 });
  assert.equal(r3.passed, false);
  assert.ok(r3.reason.includes("after allowed end"));
});

// ---- resolve with multiple conflicting rules ---------------------------------

test("resolve: higher-priority suppress wins over lower-priority notify", () => {
  const engine = new NotificationRules();
  engine.addRule({
    id: "always-suppress",
    priority: 1000,
    condition: { eventType: "task.complete" },
    action: { type: "suppress" },
  });
  engine.addRule({
    id: "must-notify",
    priority: 1,
    condition: { eventType: "task.complete" },
    action: { type: "notify" },
  });

  const result = engine.resolve(makeEvent());
  assert.equal(result.suppressed, true);
});
