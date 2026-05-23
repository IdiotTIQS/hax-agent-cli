/**
 * Tests for EventBus: on, once, emit, emitAsync, off, removeAllListeners,
 * listenerCount, events, wildcard matching, priority ordering, and filters.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventBus } = require("../../src/events/bus");

// ---- Core subscription ----

test("EventBus: on subscribes a handler and returns unsubscribe function", () => {
  const bus = new EventBus();
  const unsub = bus.on("tool.execute", () => {});
  assert.equal(typeof unsub, "function");
  assert.equal(bus.events().length, 1);
  assert.deepEqual(bus.events(), ["tool.execute"]);
});

test("EventBus: on throws for empty event name", () => {
  const bus = new EventBus();
  assert.throws(() => bus.on("", () => {}), {
    message: /non-empty string/,
  });
  assert.throws(() => bus.on(null, () => {}), {
    message: /non-empty string/,
  });
});

test("EventBus: on throws for non-function handler", () => {
  const bus = new EventBus();
  assert.throws(() => bus.on("tool.execute", "not-a-fn"), {
    message: /must be a function/,
  });
  assert.throws(() => bus.on("tool.execute", 42), {
    message: /must be a function/,
  });
});

test("EventBus: once subscribes for single invocation", () => {
  const bus = new EventBus();
  const calls = [];
  bus.once("session.start", (data) => calls.push(data));

  bus.emit("session.start", { id: "s1" });
  bus.emit("session.start", { id: "s2" });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { id: "s1" });
  assert.equal(bus.listenerCount("session.start"), 0);
});

test("EventBus: once throws for invalid event or handler", () => {
  const bus = new EventBus();
  assert.throws(() => bus.once("", () => {}), { message: /non-empty string/ });
  assert.throws(() => bus.once("ev", "bad"), { message: /must be a function/ });
});

// ---- Emit ----

test("EventBus: emit calls matching handlers with event and data", () => {
  const bus = new EventBus();
  let receivedData = null;
  let receivedEvent = null;

  bus.on("tool.execute", (data, event) => {
    receivedData = data;
    receivedEvent = event;
  });

  const count = bus.emit("tool.execute", { toolName: "file.read" });
  assert.equal(count, 1);
  assert.deepEqual(receivedData, { toolName: "file.read" });
  assert.equal(receivedEvent, "tool.execute");
});

test("EventBus: emit returns 0 when no handlers match", () => {
  const bus = new EventBus();
  const count = bus.emit("no.handlers", {});
  assert.equal(count, 0);
});

test("EventBus: emit does not call handlers for non-matching events", () => {
  const bus = new EventBus();
  let called = false;
  bus.on("tool.execute", () => { called = true; });
  bus.emit("tool.success", {});
  assert.equal(called, false);
});

test("EventBus: emit swallows handler errors and continues", () => {
  const bus = new EventBus();
  const secondCalled = [];
  bus.on("tool.execute", () => { throw new Error("boom"); });
  bus.on("tool.execute", (data) => secondCalled.push(data));

  const count = bus.emit("tool.execute", { ok: true });
  assert.equal(count, 2);
  assert.deepEqual(secondCalled, [{ ok: true }]);
});

// ---- Priority ----

test("EventBus: handlers run in priority order (highest first)", () => {
  const bus = new EventBus();
  const order = [];
  bus.on("ev", () => order.push("low"), { priority: 0 });
  bus.on("ev", () => order.push("high"), { priority: 10 });
  bus.on("ev", () => order.push("mid"), { priority: 5 });

  bus.emit("ev");
  assert.deepEqual(order, ["high", "mid", "low"]);
});

// ---- Filters ----

test("EventBus: filter option skips handler when predicate returns false", () => {
  const bus = new EventBus();
  const called = [];
  bus.on("ev", (d) => called.push(d), {
    filter: (data) => data.include === true,
  });
  bus.on("ev", (d) => called.push(d));

  bus.emit("ev", { include: false });
  // Only the unfiltered handler should have fired
  assert.equal(called.length, 1);
});

test("EventBus: filter passes data through when predicate returns true", () => {
  const bus = new EventBus();
  const called = [];
  bus.on("ev", (d) => called.push(d), {
    filter: (data) => data.level >= 3,
  });

  bus.emit("ev", { level: 5 });
  assert.equal(called.length, 1);
});

// ---- Wildcards ----

test("EventBus: wildcard 'tool.*' matches 'tool.execute' and 'tool.error'", () => {
  const bus = new EventBus();
  const matched = [];
  bus.on("tool.*", (data, event) => matched.push(event));

  bus.emit("tool.execute", {});
  bus.emit("tool.error", {});
  bus.emit("session.start", {});

  assert.deepEqual(matched, ["tool.execute", "tool.error"]);
});

test("EventBus: wildcard '*.error' matches cross-domain error events", () => {
  const bus = new EventBus();
  const matched = [];
  bus.on("*.error", (data, event) => matched.push(event));

  bus.emit("tool.error", {});
  bus.emit("agent.error", {});
  bus.emit("provider.error", {});
  bus.emit("tool.execute", {}); // Should not match

  assert.deepEqual(matched, ["tool.error", "agent.error", "provider.error"]);
});

test("EventBus: exact match and wildcard both fire for same event", () => {
  const bus = new EventBus();
  const exact = [];
  const wildcard = [];

  bus.on("tool.execute", (d) => exact.push(d));
  bus.on("tool.*", (d) => wildcard.push(d));

  bus.emit("tool.execute", { val: 1 });
  assert.equal(exact.length, 1);
  assert.equal(wildcard.length, 1);
});

// ---- emitAsync ----

test("EventBus: emitAsync resolves with handler count", async () => {
  const bus = new EventBus();
  bus.on("ev", () => {});
  bus.on("ev", () => {});

  const count = await bus.emitAsync("ev", {});
  assert.equal(count, 2);
});

test("EventBus: emitAsync runs handlers in parallel", async () => {
  const bus = new EventBus();
  const finishOrder = [];
  bus.on("ev", async () => {
    await delay(20);
    finishOrder.push("slow");
  });
  bus.on("ev", async () => {
    await delay(5);
    finishOrder.push("fast");
  });

  await bus.emitAsync("ev", {});
  // The faster handler should finish first
  assert.deepEqual(finishOrder, ["fast", "slow"]);
});

test("EventBus: emitAsync resolves with fulfilled count when some handlers reject", async () => {
  const bus = new EventBus();
  bus.on("ev", () => { throw new Error("fail"); });
  bus.on("ev", () => "ok");

  // emitAsync uses Promise.allSettled, so rejections do not cause the
  // overall promise to reject; only fulfilled handlers are counted.
  const count = await bus.emitAsync("ev", {});
  assert.equal(count, 1);
});

test("EventBus: emitAsync removes once handlers after firing", async () => {
  const bus = new EventBus();
  bus.once("ev", () => {});
  await bus.emitAsync("ev", {});
  assert.equal(bus.listenerCount("ev"), 0);
});

// ---- Unsubscription ----

test("EventBus: off removes a specific handler", () => {
  const bus = new EventBus();
  const handler = () => {};
  bus.on("ev", handler);
  assert.equal(bus.listenerCount("ev"), 1);

  const removed = bus.off("ev", handler);
  assert.equal(removed, true);
  assert.equal(bus.listenerCount("ev"), 0);
  assert.equal(bus.events().length, 0);
});

test("EventBus: off returns false when handler not found", () => {
  const bus = new EventBus();
  bus.on("ev", () => {});
  const removed = bus.off("ev", () => {});
  assert.equal(removed, false);
  assert.equal(bus.listenerCount("ev"), 1);
});

test("EventBus: off returns false for unregistered event", () => {
  const bus = new EventBus();
  assert.equal(bus.off("nonexistent", () => {}), false);
});

test("EventBus: unsubscribe function returned by on() works like off()", () => {
  const bus = new EventBus();
  const handler = () => {};
  const unsub = bus.on("ev", handler);
  assert.equal(bus.listenerCount("ev"), 1);

  unsub();
  assert.equal(bus.listenerCount("ev"), 0);
});

// ---- removeAllListeners ----

test("EventBus: removeAllListeners with event name clears only that event", () => {
  const bus = new EventBus();
  bus.on("a", () => {});
  bus.on("b", () => {});

  bus.removeAllListeners("a");
  assert.equal(bus.listenerCount("a"), 0);
  assert.equal(bus.listenerCount("b"), 1);
  assert.deepEqual(bus.events(), ["b"]);
});

test("EventBus: removeAllListeners with no argument clears entire bus", () => {
  const bus = new EventBus();
  bus.on("a", () => {});
  bus.on("b", () => {});

  bus.removeAllListeners();
  assert.equal(bus.events().length, 0);
});

// ---- listenerCount & events ----

test("EventBus: listenerCount includes wildcard subscribers", () => {
  const bus = new EventBus();
  bus.on("tool.*", () => {});
  bus.on("tool.execute", () => {});

  assert.equal(bus.listenerCount("tool.execute"), 2);
  assert.equal(bus.listenerCount("tool.error"), 1);
  assert.equal(bus.listenerCount("session.start"), 0);
});

test("EventBus: events returns all registered patterns", () => {
  const bus = new EventBus();
  bus.on("a", () => {});
  bus.on("b.*", () => {});
  bus.on("c.sub", () => {});

  const names = bus.events().sort();
  assert.deepEqual(names, ["a", "b.*", "c.sub"]);
});

test("EventBus: default priority is 0", () => {
  const bus = new EventBus();
  bus.on("ev", () => {});
  assert.equal(bus._handlers.get("ev")[0].priority, 0);
});

test("EventBus: wildcard escaping handles regex special characters", () => {
  const bus = new EventBus();
  // Event names with characters that are special in regex should still
  // be matched correctly by wildcards.
  bus.on("+special.*", () => {});
  // The "+" is regex-special, so a badly-constructed wildcard could
  // match unintended patterns.
  const count = bus.listenerCount("+special.foo");
  assert.equal(count, 1);
});

// -- Helpers --

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
