/**
 * Tests for notification triggers: createCompletionTrigger,
 * createErrorTrigger, createDurationTrigger, createTokenThresholdTrigger,
 * createFileChangeTrigger, and TriggerEngine.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createCompletionTrigger,
  createErrorTrigger,
  createDurationTrigger,
  createTokenThresholdTrigger,
  createFileChangeTrigger,
  TriggerEngine,
} = require("../../src/notify/triggers");

const { NotificationManager } = require("../../src/notify/manager");
const { CallbackChannel } = require("../../src/notify/channels");

// ---- Helpers ---------------------------------------------------------------

function spyChannel() {
  const calls = [];
  return {
    send: async (n) => { calls.push(n); },
    validate: () => ({ valid: true, errors: [] }),
    calls,
  };
}

function setupEngine() {
  const manager = new NotificationManager();
  const ch = spyChannel();
  manager.registerChannel("main", ch);
  manager.subscribe("main", [
    "task.complete",
    "task.error",
    "task.duration_warning",
    "task.token_threshold",
    "file.change",
  ]);
  const engine = new TriggerEngine(manager);
  return { manager, channel: ch, engine };
}

// ---- createCompletionTrigger -----------------------------------------------

test("completion trigger: fires on task complete and builds notification", () => {
  const trigger = createCompletionTrigger({ channels: ["main"] });
  assert.equal(trigger.type, "task.complete");

  const context = { taskId: "t1", durationMs: 3200 };
  assert.equal(trigger.condition(context), true);

  const n = trigger.buildNotification(context);
  assert.equal(n.type, "task.complete");
  assert.equal(n.severity, "info");
  assert.ok(n.message.includes("t1"));
  assert.ok(n.message.includes("3s"));
  assert.deepEqual(n.data, context);
});

test("completion trigger: custom messageFn is used", () => {
  const trigger = createCompletionTrigger({
    channels: ["main"],
    messageFn: (ctx) => `Custom done: ${ctx.taskId}`,
  });

  const n = trigger.buildNotification({ taskId: "build", durationMs: 100 });
  assert.equal(n.message, "Custom done: build");
});

test("completion trigger: custom title is used", () => {
  const trigger = createCompletionTrigger({
    channels: ["main"],
    title: "Pipeline finished",
  });

  const n = trigger.buildNotification({ taskId: "deploy" });
  assert.equal(n.title, "Pipeline finished");
});

// ---- createErrorTrigger ----------------------------------------------------

test("error trigger: fires when severity meets threshold", () => {
  const trigger = createErrorTrigger({ minSeverity: "error", channels: ["main"] });

  // error meets error threshold
  assert.equal(trigger.condition({ severity: "error" }), true);
  // critical exceeds error threshold
  assert.equal(trigger.condition({ severity: "critical" }), true);
  // warn is below error threshold
  assert.equal(trigger.condition({ severity: "warn" }), false);
  // info is below threshold
  assert.equal(trigger.condition({ severity: "info" }), false);
});

test("error trigger: default minSeverity is error", () => {
  const trigger = createErrorTrigger();
  assert.equal(trigger.condition({ severity: "error" }), true);
  assert.equal(trigger.condition({ severity: "warn" }), false);
});

test("error trigger: builds notification with error message", () => {
  const trigger = createErrorTrigger({ channels: ["main"] });
  const n = trigger.buildNotification({
    taskId: "t1",
    severity: "error",
    message: "Connection refused",
    error: new Error("Connection refused"),
  });

  assert.equal(n.type, "task.error");
  assert.equal(n.severity, "error");
  assert.equal(n.message, "Connection refused");
});

test("error trigger: custom shouldFire overrides default severity check", () => {
  const trigger = createErrorTrigger({
    minSeverity: "error",
    shouldFire: (ctx) => ctx.retryCount > 3,
  });

  // Even though severity is warn (below error), custom shouldFire allows it
  assert.equal(trigger.condition({ severity: "warn", retryCount: 5 }), true);
  assert.equal(trigger.condition({ severity: "warn", retryCount: 1 }), false);
});

// ---- createDurationTrigger -------------------------------------------------

test("duration trigger: fires when elapsed exceeds threshold", () => {
  const trigger = createDurationTrigger(5); // 5 minutes = 300,000 ms

  // Below threshold
  assert.equal(trigger.condition({ elapsedMs: 200000 }), false);
  // At threshold
  assert.equal(trigger.condition({ elapsedMs: 300000 }), true);
  // Above threshold
  assert.equal(trigger.condition({ elapsedMs: 600000 }), true);
});

test("duration trigger: repeat mode fires once per threshold period", () => {
  const trigger = createDurationTrigger(5, { repeat: true });

  // First period exceeded
  assert.equal(trigger.condition({ elapsedMs: 350000 }), true);
  trigger.firedCount = 1;

  // Still in same period range
  assert.equal(trigger.condition({ elapsedMs: 400000 }), false);

  // Second period exceeded
  assert.equal(trigger.condition({ elapsedMs: 610000 }), true);
});

test("duration trigger: severity escalates for long-running tasks", () => {
  const trigger = createDurationTrigger(5);

  // Normal overtime
  const n1 = trigger.buildNotification({ taskId: "t1", elapsedMs: 400000 });
  assert.equal(n1.severity, "warn");

  // 3x overtime
  const n2 = trigger.buildNotification({ taskId: "t1", elapsedMs: 1000000 });
  assert.equal(n2.severity, "critical");
});

// ---- createTokenThresholdTrigger -------------------------------------------

test("token threshold trigger: fires at warning ratio and at max", () => {
  const trigger = createTokenThresholdTrigger(10000, { warningRatio: 0.8 });

  // Below warning threshold
  assert.equal(trigger.condition({ currentTokens: 5000 }), false);
  // At warning threshold (80% of 10000 = 8000)
  assert.equal(trigger.condition({ currentTokens: 8000 }), true);
  // At max
  assert.equal(trigger.condition({ currentTokens: 10000 }), true);
  // Above max
  assert.equal(trigger.condition({ currentTokens: 15000 }), true);
});

test("token threshold trigger: severity is critical when limit exceeded", () => {
  const trigger = createTokenThresholdTrigger(10000);

  const warn = trigger.buildNotification({ currentTokens: 8500 });
  assert.equal(warn.severity, "warn");
  assert.ok(warn.title.includes("warning"));

  const critical = trigger.buildNotification({ currentTokens: 10001 });
  assert.equal(critical.severity, "critical");
  assert.ok(critical.title.includes("exceeded"));
});

// ---- createFileChangeTrigger -----------------------------------------------

test("file change trigger: matches files against glob patterns", () => {
  const trigger = createFileChangeTrigger(["*.js", "src/**/*.ts"]);

  // Matching
  assert.equal(trigger.condition({ files: ["app.js"] }), true);
  assert.equal(trigger.condition({ files: ["src/utils/helper.ts"] }), true);
  // Not matching
  assert.equal(trigger.condition({ files: ["README.md"] }), false);
  assert.equal(trigger.condition({ files: [] }), false);
});

test("file change trigger: builds notification with file list", () => {
  const trigger = createFileChangeTrigger(["*.js"]);
  const n = trigger.buildNotification({
    files: ["a.js", "b.js", "c.js", "d.js", "e.js", "f.js"],
  });

  assert.equal(n.type, "file.change");
  assert.ok(n.message.includes("a.js"));
  assert.ok(n.message.includes("+1 more"));
});

// ---- TriggerEngine ---------------------------------------------------------

test("TriggerEngine: throws without NotificationManager", () => {
  assert.throws(() => new TriggerEngine(null), {
    message: /NotificationManager/,
  });
  assert.throws(() => new TriggerEngine({ notify: "nope" }), {
    message: /NotificationManager/,
  });
});

test("TriggerEngine: register adds trigger and unregister removes it", () => {
  const { engine } = setupEngine();
  const trigger = createCompletionTrigger();

  engine.register(trigger);
  assert.equal(engine.count, 1);

  const removed = engine.unregister(trigger);
  assert.equal(removed, true);
  assert.equal(engine.count, 0);

  // Removing non-existent returns false
  assert.equal(engine.unregister(trigger), false);
});

test("TriggerEngine: register throws for objects without condition", () => {
  const { engine } = setupEngine();
  assert.throws(() => engine.register(null), { message: /condition/ });
  assert.throws(() => engine.register({}), { message: /condition/ });
});

test("TriggerEngine: onTaskComplete evaluates and fires matching triggers", async () => {
  const { engine, channel, manager } = setupEngine();
  engine.register(createCompletionTrigger({ channels: ["main"] }));

  const results = await engine.onTaskComplete({ taskId: "t1", durationMs: 1200 });

  assert.equal(results.length, 1);
  assert.equal(channel.calls.length, 1);
  assert.equal(channel.calls[0].type, "task.complete");
});

test("TriggerEngine: onTaskError respects minSeverity threshold", async () => {
  const { engine, channel } = setupEngine();
  engine.register(createErrorTrigger({ channels: ["main"], minSeverity: "error" }));

  // Should NOT fire for warn
  await engine.onTaskError({ taskId: "t1", severity: "warn", message: "retry" });
  assert.equal(channel.calls.length, 0);

  // Should fire for error
  await engine.onTaskError({ taskId: "t1", severity: "error", message: "broken" });
  assert.equal(channel.calls.length, 1);
  assert.equal(channel.calls[0].severity, "error");
});

test("TriggerEngine: respects cooldown between firings", async () => {
  const { engine, channel } = setupEngine();
  const trigger = createCompletionTrigger({ channels: ["main"], cooldownMs: 60000 });
  // Force cooldown on
  trigger.lastFired = Date.now(); // just fired now
  engine.register(trigger);

  const results = await engine.onTaskComplete({ taskId: "t1" });
  assert.equal(results.length, 0); // blocked by cooldown
  assert.equal(channel.calls.length, 0);
});

test("TriggerEngine: resetCooldowns clears state allowing re-fire", async () => {
  const { engine, channel } = setupEngine();
  const trigger = createCompletionTrigger({ channels: ["main"], cooldownMs: 60000 });
  trigger.lastFired = Date.now();
  engine.register(trigger);

  engine.resetCooldowns();

  const results = await engine.onTaskComplete({ taskId: "t1" });
  assert.equal(results.length, 1);
  assert.equal(channel.calls.length, 1);
});

test("TriggerEngine: onDurationCheck fires when threshold exceeded", async () => {
  const { engine, channel } = setupEngine();
  engine.register(createDurationTrigger(5, { channels: ["main"] }));

  // Below threshold — no fire
  await engine.onDurationCheck({ taskId: "long", elapsedMs: 200000 });
  assert.equal(channel.calls.length, 0);

  // Above threshold — fire
  await engine.onDurationCheck({ taskId: "long", elapsedMs: 400000 });
  assert.equal(channel.calls.length, 1);
  assert.equal(channel.calls[0].type, "task.duration_warning");
});

test("TriggerEngine: onTokenCheck fires at warning and max thresholds", async () => {
  const { engine, channel } = setupEngine();
  engine.register(createTokenThresholdTrigger(5000, { channels: ["main"], warningRatio: 0.8 }));

  // Below warning (80% of 5000 = 4000)
  await engine.onTokenCheck({ currentTokens: 3000 });
  assert.equal(channel.calls.length, 0);

  // At warning threshold
  await engine.onTokenCheck({ currentTokens: 4200 });
  assert.equal(channel.calls.length, 1);
  assert.equal(channel.calls[0].type, "task.token_threshold");
});

test("TriggerEngine: listTriggers groups by type", () => {
  const { engine } = setupEngine();
  engine.register(createCompletionTrigger());
  engine.register(createCompletionTrigger());
  engine.register(createErrorTrigger());

  const list = engine.listTriggers();
  assert.equal(list.length, 2);

  const completeEntry = list.find((e) => e.type === "task.complete");
  assert.equal(completeEntry.count, 2);

  const errorEntry = list.find((e) => e.type === "task.error");
  assert.equal(errorEntry.count, 1);
});

test("TriggerEngine: onFileChange triggers when files match patterns", async () => {
  const { engine, channel } = setupEngine();
  engine.register(createFileChangeTrigger(["*.log", "output/*.txt"], { channels: ["main"] }));

  // No match
  await engine.onFileChange({ files: ["data.json"] });
  assert.equal(channel.calls.length, 0);

  // Match
  await engine.onFileChange({ files: ["app.log"] });
  assert.equal(channel.calls.length, 1);
  assert.equal(channel.calls[0].type, "file.change");
});

test("TriggerEngine: evaluate does not enforce cooldowns", async () => {
  const { engine, channel } = setupEngine();
  const trigger = createCompletionTrigger({ channels: ["main"], cooldownMs: 60000 });
  trigger.lastFired = Date.now(); // would block via check()
  engine.register(trigger);

  // evaluate() bypasses cooldown
  const results = await engine.evaluate("task.complete", { taskId: "force" });
  assert.equal(results.length, 1);
  assert.equal(channel.calls.length, 1);
});
