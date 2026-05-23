/**
 * Tests for NotificationManager: channel registration, event
 * subscriptions, send, notify, status, and history.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { NotificationManager } = require("../../src/notify/manager");
const { CallbackChannel, CompositeChannel } = require("../../src/notify/channels");

// ---- Helpers ---------------------------------------------------------------

function spyChannel() {
  const calls = [];
  const channel = {
    send: async (notification) => { calls.push(notification); },
    validate: () => ({ valid: true, errors: [] }),
    calls,
  };
  return channel;
}

function failingChannel(errorMessage) {
  return {
    send: async () => { throw new Error(errorMessage); },
    validate: () => ({ valid: true, errors: [] }),
  };
}

// ---- Channel Registration --------------------------------------------------

test("NotificationManager: registerChannel adds a named channel", () => {
  const manager = new NotificationManager();
  const ch = spyChannel();

  manager.registerChannel("desktop", ch);
  assert.equal(manager.hasChannel("desktop"), true);
  assert.deepEqual(manager.listChannels(), ["desktop"]);
});

test("NotificationManager: registerChannel throws for empty name", () => {
  const manager = new NotificationManager();
  assert.throws(() => manager.registerChannel("", spyChannel()), {
    message: /non-empty string/,
  });
  assert.throws(() => manager.registerChannel("  ", spyChannel()), {
    message: /non-empty string/,
  });
});

test("NotificationManager: registerChannel throws for duplicate name", () => {
  const manager = new NotificationManager();
  manager.registerChannel("desktop", spyChannel());
  assert.throws(() => manager.registerChannel("desktop", spyChannel()), {
    message: /already registered/,
  });
});

test("NotificationManager: registerChannel throws for invalid channel", () => {
  const manager = new NotificationManager();
  assert.throws(() => manager.registerChannel("bad", null), {
    message: /implement.*send/,
  });
  assert.throws(() => manager.registerChannel("bad", {}), {
    message: /implement.*send/,
  });
});

test("NotificationManager: unregisterChannel removes a channel and its subscriptions", () => {
  const manager = new NotificationManager();
  const ch = spyChannel();
  manager.registerChannel("slack", ch);
  manager.subscribe("slack", "task.complete");

  assert.equal(manager.hasChannel("slack"), true);
  const removed = manager.unregisterChannel("slack");
  assert.equal(removed, true);
  assert.equal(manager.hasChannel("slack"), false);

  // Removing non-existent returns false
  assert.equal(manager.unregisterChannel("ghost"), false);
});

// ---- Subscriptions ---------------------------------------------------------

test("NotificationManager: subscribe adds event types for a channel", () => {
  const manager = new NotificationManager();
  manager.registerChannel("desktop", spyChannel());

  manager.subscribe("desktop", ["task.complete", "task.error"]);
  const subs = manager.getSubscriptions("desktop");
  assert.deepEqual(subs, ["task.complete", "task.error"]);
});

test("NotificationManager: subscribe accepts a single string event type", () => {
  const manager = new NotificationManager();
  manager.registerChannel("desktop", spyChannel());
  manager.subscribe("desktop", "task.complete");

  assert.deepEqual(manager.getSubscriptions("desktop"), ["task.complete"]);
});

test("NotificationManager: subscribe throws for unregistered channel", () => {
  const manager = new NotificationManager();
  assert.throws(() => manager.subscribe("missing", "task.complete"), {
    message: /not registered/,
  });
});

test("NotificationManager: subscribe throws for empty event type", () => {
  const manager = new NotificationManager();
  manager.registerChannel("ch", spyChannel());
  assert.throws(() => manager.subscribe("ch", ""), {
    message: /non-empty string/,
  });
});

test("NotificationManager: unsubscribe removes specific event types", () => {
  const manager = new NotificationManager();
  manager.registerChannel("desktop", spyChannel());
  manager.subscribe("desktop", ["a", "b", "c"]);
  manager.unsubscribe("desktop", ["b", "c"]);
  assert.deepEqual(manager.getSubscriptions("desktop"), ["a"]);
});

test("NotificationManager: unsubscribe without eventTypes clears all subscriptions", () => {
  const manager = new NotificationManager();
  manager.registerChannel("desktop", spyChannel());
  manager.subscribe("desktop", ["a", "b"]);
  manager.unsubscribe("desktop");
  assert.deepEqual(manager.getSubscriptions("desktop"), []);
});

// ---- Send ------------------------------------------------------------------

test("NotificationManager: send to a specific channel", async () => {
  const manager = new NotificationManager();
  const ch = spyChannel();
  manager.registerChannel("desktop", ch);

  const result = await manager.send(
    { type: "test", title: "Hello" },
    "desktop"
  );

  assert.equal(result.delivered, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(ch.calls.length, 1);
  assert.equal(ch.calls[0].type, "test");
  assert.equal(ch.calls[0].title, "Hello");
});

test("NotificationManager: send to all channels when no target specified", async () => {
  const manager = new NotificationManager();
  const ch1 = spyChannel();
  const ch2 = spyChannel();
  manager.registerChannel("a", ch1);
  manager.registerChannel("b", ch2);

  const result = await manager.send({ type: "broadcast" });

  assert.equal(result.delivered, 2);
  assert.equal(ch1.calls.length, 1);
  assert.equal(ch2.calls.length, 1);
});

test("NotificationManager: send collects errors from failing channels", async () => {
  const manager = new NotificationManager();
  manager.registerChannel("good", spyChannel());
  manager.registerChannel("bad", failingChannel("boom"));

  const result = await manager.send({ type: "test" });
  assert.equal(result.delivered, 1);
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0].error.includes("boom"));
});

test("NotificationManager: send in strict mode throws for unknown channel", async () => {
  const manager = new NotificationManager({ strict: true });
  await assert.rejects(
    () => manager.send({ type: "test" }, "missing"),
    { message: /not registered/ }
  );
});

// ---- Notify (event-based) --------------------------------------------------

test("NotificationManager: notify dispatches to subscribed channels only", async () => {
  const manager = new NotificationManager();
  const chA = spyChannel();
  const chB = spyChannel();
  const chC = spyChannel();

  manager.registerChannel("a", chA);
  manager.registerChannel("b", chB);
  manager.registerChannel("c", chC);

  manager.subscribe("a", "task.complete");
  manager.subscribe("b", ["task.complete", "task.error"]);
  // chC is not subscribed to anything

  const result = await manager.notify("task.complete", { title: "Done" });

  assert.equal(result.delivered, 2);
  assert.equal(chA.calls.length, 1);
  assert.equal(chB.calls.length, 1);
  assert.equal(chC.calls.length, 0);
});

test("NotificationManager: notify returns zero delivered when no subscriptions match", async () => {
  const manager = new NotificationManager();
  manager.registerChannel("desktop", spyChannel());
  manager.subscribe("desktop", "task.complete");

  const result = await manager.notify("task.error", { title: "Error" });
  assert.equal(result.delivered, 0);
});

// ---- Status & History ------------------------------------------------------

test("NotificationManager: getStatus returns health info for all channels", () => {
  const manager = new NotificationManager();
  manager.registerChannel("desktop", spyChannel());
  manager.registerChannel("file", spyChannel());
  manager.subscribe("desktop", ["task.complete"]);

  const status = manager.getStatus();
  assert.equal(status.length, 2);

  const desktopStatus = status.find((s) => s.name === "desktop");
  assert.equal(desktopStatus.healthy, true);
  assert.equal(desktopStatus.totalSent, 0);
  assert.deepEqual(desktopStatus.subscriptions, ["task.complete"]);
});

test("NotificationManager: getStatus reflects failures and lastError", async () => {
  const manager = new NotificationManager();
  manager.registerChannel("sink", failingChannel("network timeout"));

  await manager.send({ type: "test" }, "sink");

  const status = manager.getStatus();
  assert.equal(status.length, 1);
  assert.equal(status[0].failures, 1);
  assert.ok(status[0].lastError.includes("network timeout"));
});

test("NotificationManager: getHistory tracks recent notifications", async () => {
  const manager = new NotificationManager();
  manager.registerChannel("desktop", spyChannel());

  await manager.send({ type: "one" }, "desktop");
  await manager.send({ type: "two" }, "desktop");
  await manager.send({ type: "three" }, "desktop");

  const history = manager.getHistory();
  assert.equal(history.length, 3);
  assert.equal(history[0].type, "one");
  assert.equal(history[2].type, "three");
});

test("NotificationManager: getHistory with limit returns last N entries", async () => {
  const manager = new NotificationManager();
  manager.registerChannel("desktop", spyChannel());

  for (let i = 0; i < 5; i++) {
    await manager.send({ type: `event-${i}` }, "desktop");
  }

  const recent = manager.getHistory(2);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].type, "event-3");
  assert.equal(recent[1].type, "event-4");
});

test("NotificationManager: clearHistory empties the buffer", async () => {
  const manager = new NotificationManager();
  manager.registerChannel("desktop", spyChannel());

  await manager.send({ type: "a" }, "desktop");
  await manager.send({ type: "b" }, "desktop");

  manager.clearHistory();
  assert.equal(manager.getHistory().length, 0);
});

test("NotificationManager: history respects maxHistory cap", async () => {
  const manager = new NotificationManager({ maxHistory: 3 });
  manager.registerChannel("desktop", spyChannel());

  for (let i = 0; i < 10; i++) {
    await manager.send({ type: `e-${i}` }, "desktop");
  }

  const history = manager.getHistory();
  assert.equal(history.length, 3);
  assert.equal(history[0].type, "e-7");
  assert.equal(history[2].type, "e-9");
});
