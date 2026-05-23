/**
 * Tests for event middleware: logging, metrics, throttle, filter, timeout,
 * and the applyMiddleware composition helper.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventBus } = require("../../src/events/bus");
const {
  createLoggingMiddleware,
  createMetricsMiddleware,
  createThrottleMiddleware,
  createFilterMiddleware,
  createTimeoutMiddleware,
  applyMiddleware,
} = require("../../src/events/middleware");

// ---- createLoggingMiddleware ----

test("createLoggingMiddleware: throws if logger has no info() method", () => {
  assert.throws(() => createLoggingMiddleware(null), {
    message: /info\(\)/,
  });
  assert.throws(() => createLoggingMiddleware({}), {
    message: /info\(\)/,
  });
});

test("createLoggingMiddleware: logs event metadata on emit", () => {
  const logs = [];
  const logger = { info: (msg, meta) => logs.push({ msg, meta }) };

  const middleware = createLoggingMiddleware(logger);
  let called = false;
  middleware("tool.execute", { x: 1 }, () => { called = true; });

  assert.equal(called, true);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].msg, "event emitted");
  assert.equal(logs[0].meta.event, "tool.execute");
  assert.ok(typeof logs[0].meta.durationMs === "number");
  assert.equal(logs[0].meta.hasData, true);
});

test("createLoggingMiddleware: logs hasData false when data is null", () => {
  const logs = [];
  const logger = { info: (msg, meta) => logs.push(meta) };

  const middleware = createLoggingMiddleware(logger);
  middleware("ev", null, () => {});

  assert.equal(logs[0].hasData, false);
});

test("createLoggingMiddleware: passes through to next correctly", () => {
  const received = [];
  const logger = { info: () => {} };
  const middleware = createLoggingMiddleware(logger);

  middleware("ev", "payload", (event, data) => {
    received.push(event, data);
  });

  assert.deepEqual(received, ["ev", "payload"]);
});

// ---- createMetricsMiddleware ----

test("createMetricsMiddleware: throws if metrics has no counter() method", () => {
  assert.throws(() => createMetricsMiddleware(null), {
    message: /counter\(\)/,
  });
  assert.throws(() => createMetricsMiddleware({}), {
    message: /counter\(\)/,
  });
});

test("createMetricsMiddleware: increments counter per event type", () => {
  const counters = {};
  const metrics = {
    counter: (name, help) => {
      if (!counters[name]) {
        counters[name] = 0;
      }
      return {
        inc: () => { counters[name] += 1; },
      };
    },
  };

  const middleware = createMetricsMiddleware(metrics);
  middleware("tool.execute", {}, () => {});
  middleware("tool.execute", {}, () => {});
  middleware("tool.error", {}, () => {});

  assert.equal(counters["events.tool.execute.total"], 2);
  assert.equal(counters["events.tool.error.total"], 1);
});

test("createMetricsMiddleware: calls next even if counter throws", () => {
  const metrics = {
    counter: () => {
      throw new Error("counter creation failed");
    },
  };

  const middleware = createMetricsMiddleware(metrics);
  let called = false;
  // Should not throw
  middleware("ev", {}, () => { called = true; });
  assert.equal(called, true);
});

test("createMetricsMiddleware: passes through to next", () => {
  const counters = {};
  const metrics = { counter: () => ({ inc: () => {} }) };
  const middleware = createMetricsMiddleware(metrics);
  const passed = [];

  middleware("a", 42, (event, data) => passed.push(event, data));
  assert.deepEqual(passed, ["a", 42]);
});

// ---- createThrottleMiddleware ----

test("createThrottleMiddleware: throws for invalid event name", () => {
  assert.throws(() => createThrottleMiddleware("", 100), {
    message: /non-empty string/,
  });
});

test("createThrottleMiddleware: throws for invalid interval", () => {
  assert.throws(() => createThrottleMiddleware("ev", -1), {
    message: /non-negative number/,
  });
  assert.throws(() => createThrottleMiddleware("ev", NaN), {
    message: /non-negative number/,
  });
});

test("createThrottleMiddleware: drops events within minIntervalMs", () => {
  const middleware = createThrottleMiddleware("high.freq", 100);
  const calls = [];

  middleware("high.freq", 1, () => calls.push(1));
  middleware("high.freq", 2, () => calls.push(2));
  middleware("high.freq", 3, () => calls.push(3));

  // Only the first should pass through (within the same tick)
  assert.equal(calls.length, 1);
  assert.deepEqual(calls, [1]);
});

test("createThrottleMiddleware: allows events after interval passes", (_, done) => {
  const middleware = createThrottleMiddleware("high.freq", 10);
  const calls = [];

  middleware("high.freq", 1, () => calls.push(1));
  assert.deepEqual(calls, [1]);

  setTimeout(() => {
    middleware("high.freq", 2, () => calls.push(2));
    assert.deepEqual(calls, [1, 2]);
    done();
  }, 15);
});

test("createThrottleMiddleware: does not affect non-target events", () => {
  const middleware = createThrottleMiddleware("high.freq", 1000);
  const calls = [];

  middleware("other.event", 1, () => calls.push(1));
  middleware("other.event", 2, () => calls.push(2));

  assert.equal(calls.length, 2);
});

// ---- createFilterMiddleware ----

test("createFilterMiddleware: throws for non-function predicate", () => {
  assert.throws(() => createFilterMiddleware("not-a-fn"), {
    message: /must be a function/,
  });
  assert.throws(() => createFilterMiddleware(null), {
    message: /must be a function/,
  });
});

test("createFilterMiddleware: passes events when predicate returns true", () => {
  const middleware = createFilterMiddleware((event, data) => data.level > 0);
  const calls = [];

  middleware("ev", { level: 5 }, (e, d) => calls.push(d));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { level: 5 });
});

test("createFilterMiddleware: drops events when predicate returns false", () => {
  const middleware = createFilterMiddleware((event, data) => data.pass);
  const calls = [];

  middleware("ev", { pass: false }, () => calls.push("nope"));
  assert.equal(calls.length, 0);
});

test("createFilterMiddleware: predicate receives event name and data", () => {
  const received = [];
  const middleware = createFilterMiddleware((event, data) => {
    received.push({ event, data });
    return true;
  });

  middleware("tool.execute", { ok: true }, () => {});
  assert.equal(received.length, 1);
  assert.equal(received[0].event, "tool.execute");
  assert.deepEqual(received[0].data, { ok: true });
});

// ---- createTimeoutMiddleware ----

test("createTimeoutMiddleware: throws for invalid ms", () => {
  assert.throws(() => createTimeoutMiddleware(0), { message: /positive number/ });
  assert.throws(() => createTimeoutMiddleware(-5), { message: /positive number/ });
  assert.throws(() => createTimeoutMiddleware("100"), { message: /positive number/ });
});

test("createTimeoutMiddleware: warns when next exceeds threshold", () => {
  const warns = [];
  const logger = { warn: (msg, meta) => warns.push({ msg, meta }) };
  const middleware = createTimeoutMiddleware(1, logger);

  middleware("slow.event", {}, (event, data) => {
    // busy-wait to simulate a slow handler
    const end = Date.now() + 5;
    while (Date.now() < end) { /* wait */ }
  });

  assert.ok(warns.length >= 1);
  assert.equal(warns[0].msg, "slow event handler");
  assert.equal(warns[0].meta.event, "slow.event");
  assert.ok(warns[0].meta.elapsedMs > 1);
});

test("createTimeoutMiddleware: does not warn when handler is fast", () => {
  const warns = [];
  const logger = { warn: (msg, meta) => warns.push(meta) };
  const middleware = createTimeoutMiddleware(500, logger);

  middleware("fast.event", {}, () => { /* instant */ });
  assert.equal(warns.length, 0);
});

test("createTimeoutMiddleware: defaults to stderr logger when none provided", () => {
  // Just verify it does not throw
  const middleware = createTimeoutMiddleware(100);
  assert.doesNotThrow(() => {
    middleware("ev", {}, () => {});
  });
});

// ---- applyMiddleware ----

test("applyMiddleware: throws if bus is not an EventBus", () => {
  assert.throws(() => applyMiddleware(null), { message: /EventBus/ });
  assert.throws(() => applyMiddleware({}), { message: /EventBus/ });
});

test("applyMiddleware: applies middleware chain to emit", () => {
  const bus = new EventBus();
  const log = [];

  const trackingMw = (event, data, next) => {
    log.push(`before:${event}`);
    next(event, data);
    log.push(`after:${event}`);
  };

  const decorated = applyMiddleware(bus, trackingMw);
  const calls = [];
  bus.on("ev", (d) => calls.push(d));

  decorated.emit("ev", { hello: "world" });
  assert.deepEqual(log, ["before:ev", "after:ev"]);
  assert.equal(calls.length, 1);
});

test("applyMiddleware: applies middleware chain to emitAsync", async () => {
  const bus = new EventBus();
  const log = [];

  const trackingMw = (event, data, next) => {
    log.push(`mw:${event}`);
    next(event, data);
  };

  const decorated = applyMiddleware(bus, trackingMw);
  bus.on("ev", () => {});

  await decorated.emitAsync("ev", {});
  assert.deepEqual(log, ["mw:ev"]);
});

test("applyMiddleware: multiple middlewares compose correctly", () => {
  const bus = new EventBus();
  const order = [];

  const mw1 = (event, data, next) => {
    order.push(1);
    next(event, data);
    order.push(1);
  };
  const mw2 = (event, data, next) => {
    order.push(2);
    next(event, data);
    order.push(2);
  };

  const decorated = applyMiddleware(bus, mw1, mw2);
  bus.on("ev", () => order.push("handler"));

  decorated.emit("ev", {});
  // mw1 outer -> mw2 outer -> handler -> mw2 inner -> mw1 inner
  assert.deepEqual(order, [1, 2, "handler", 2, 1]);
});

test("applyMiddleware: middleware can inspect and mutate data", () => {
  const bus = new EventBus();
  const enrichMw = (event, data, next) => {
    const enriched = { ...data, timestamp: Date.now() };
    next(event, enriched);
  };

  const decorated = applyMiddleware(bus, enrichMw);
  const received = [];
  bus.on("ev", (d) => received.push(d));

  decorated.emit("ev", { user: "test" });
  assert.equal(received.length, 1);
  assert.equal(received[0].user, "test");
  assert.ok(typeof received[0].timestamp === "number");
});

test("applyMiddleware: middleware can block events by not calling next", () => {
  const bus = new EventBus();
  const blockMw = (event, data, next) => {
    if (event === "blocked") return; // never call next
    next(event, data);
  };

  const decorated = applyMiddleware(bus, blockMw);
  const calls = [];
  bus.on("blocked", (d) => calls.push(d));
  bus.on("allowed", (d) => calls.push(d));

  decorated.emit("blocked", {});
  assert.equal(calls.length, 0);

  decorated.emit("allowed", {});
  assert.equal(calls.length, 1);
});
