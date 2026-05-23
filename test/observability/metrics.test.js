/**
 * Tests for metrics: Counter, Histogram, Gauge, and MetricsRegistry.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  Counter,
  Histogram,
  Gauge,
  MetricsRegistry,
} = require("../../src/observability/metrics");

// ---- Counter ----

test("Counter: initializes with zero value", () => {
  const c = new Counter({ name: "test.count", help: "Test counter" });
  assert.equal(c.value(), 0);
  assert.equal(c.name, "test.count");
  assert.equal(c.help, "Test counter");
});

test("Counter: increments and returns correct value", () => {
  const c = new Counter({ name: "test.inc" });
  c.inc();
  c.inc(5);
  c.inc(3);
  assert.equal(c.value(), 9);
});

test("Counter: ignores negative increments", () => {
  const c = new Counter({ name: "test.neg" });
  c.inc(10);
  c.inc(-3);
  assert.equal(c.value(), 10);
});

test("Counter: resets to zero", () => {
  const c = new Counter({ name: "test.reset" });
  c.inc(42);
  c.reset();
  assert.equal(c.value(), 0);
});

test("Counter: toJSON includes type, value, and rate", () => {
  const c = new Counter({ name: "test.json", help: "For serialization" });
  c.inc(100);
  const json = c.toJSON();
  assert.equal(json.type, "counter");
  assert.equal(json.name, "test.json");
  assert.equal(json.value, 100);
  assert.ok(typeof json.rate === "number");
  assert.ok(typeof json.createdAt === "string");
});

// ---- Histogram ----

test("Histogram: initializes with empty values", () => {
  const h = new Histogram({ name: "test.hist", help: "Test histogram" });
  assert.equal(h.count(), 0);
  assert.equal(h.sum(), 0);
  assert.equal(h.avg(), 0);
  assert.equal(h.min(), 0);
  assert.equal(h.max(), 0);
});

test("Histogram: records values and computes statistics", () => {
  const h = new Histogram({ name: "test.stats" });
  h.observe(10);
  h.observe(20);
  h.observe(30);
  h.observe(40);
  h.observe(50);

  assert.equal(h.count(), 5);
  assert.equal(h.sum(), 150);
  assert.equal(h.avg(), 30);
  assert.equal(h.min(), 10);
  assert.equal(h.max(), 50);
});

test("Histogram: computes percentiles correctly", () => {
  const h = new Histogram({ name: "test.pct" });
  for (let i = 1; i <= 100; i++) {
    h.observe(i);
  }

  assert.equal(h.p50(), 50);
  assert.equal(h.p95(), 95);
  assert.equal(h.p99(), 99);
});

test("Histogram: ignores non-number observations", () => {
  const h = new Histogram({ name: "test.nan" });
  h.observe(42);
  h.observe("not-a-number");
  h.observe(null);
  assert.equal(h.count(), 1);
  assert.equal(h.sum(), 42);
});

test("Histogram: toJSON includes all statistics", () => {
  const h = new Histogram({ name: "test.json", help: "For serialization" });
  h.observe(5);
  h.observe(15);
  h.observe(25);

  const json = h.toJSON();
  assert.equal(json.type, "histogram");
  assert.equal(json.name, "test.json");
  assert.equal(json.count, 3);
  assert.equal(json.sum, 45);
  assert.equal(json.avg, 15);
  assert.equal(json.min, 5);
  assert.equal(json.max, 25);
  assert.equal(json.p50, 15);
  assert.equal(json.p95, 25);
  assert.equal(json.p99, 25);
});

// ---- Gauge ----

test("Gauge: initializes with default zero value", () => {
  const g = new Gauge({ name: "test.gauge" });
  assert.equal(g.value(), 0);
});

test("Gauge: initializes with custom initial value", () => {
  const g = new Gauge({ name: "test.init", initialValue: 42 });
  assert.equal(g.value(), 42);
});

test("Gauge: set, inc, dec change value", () => {
  const g = new Gauge({ name: "test.mutate" });
  g.set(50);
  assert.equal(g.value(), 50);

  g.inc(10);
  assert.equal(g.value(), 60);

  g.dec(25);
  assert.equal(g.value(), 35);
});

test("Gauge: records value history", () => {
  const g = new Gauge({ name: "test.history", maxHistory: 5 });
  g.set(10);
  g.set(20);
  g.set(30);

  const history = g.history();
  // recordInitial is true by default, so we have initial(0) + 3 sets = 4 entries
  assert.equal(history.length, 4);
  assert.equal(history[0].value, 0);
  assert.equal(history[3].value, 30);
});

test("Gauge: trims history to maxHistory", () => {
  const g = new Gauge({ name: "test.trim", maxHistory: 3 });
  g.set(1);
  g.set(2);
  g.set(3);
  g.set(4);
  g.set(5);

  const history = g.history();
  assert.equal(history.length, 3);
  assert.equal(history[0].value, 3);
  assert.equal(history[2].value, 5);
});

// ---- MetricsRegistry ----

test("MetricsRegistry: pre-instruments default metrics", () => {
  const registry = new MetricsRegistry();
  const collected = registry.collect();

  assert.ok("tool.executions" in collected);
  assert.ok("tool.errors" in collected);
  assert.ok("tool.duration_ms" in collected);
  assert.ok("agent.turns" in collected);
  assert.ok("agent.tokens_in" in collected);
  assert.ok("agent.tokens_out" in collected);

  assert.equal(collected["tool.executions"].type, "counter");
  assert.equal(collected["tool.duration_ms"].type, "histogram");
});

test("MetricsRegistry: counter factory creates and retrieves counter", () => {
  const registry = new MetricsRegistry();
  const c = registry.counter("custom.calls", { help: "Custom counter" });

  assert.ok(c instanceof Counter);
  assert.equal(c.name, "custom.calls");

  c.inc(5);
  assert.equal(registry.get("custom.calls").value(), 5);
});

test("MetricsRegistry: histogram factory creates and retrieves histogram", () => {
  const registry = new MetricsRegistry();
  const h = registry.histogram("custom.latency", { help: "Custom histogram" });

  assert.ok(h instanceof Histogram);
  h.observe(100);
  h.observe(200);

  assert.equal(registry.get("custom.latency").avg(), 150);
});

test("MetricsRegistry: gauge factory creates and retrieves gauge", () => {
  const registry = new MetricsRegistry();
  const g = registry.gauge("custom.memory", { help: "Custom gauge", initialValue: 1024 });

  assert.ok(g instanceof Gauge);
  assert.equal(registry.get("custom.memory").value(), 1024);
});

test("MetricsRegistry: does not overwrite already registered metrics", () => {
  const registry = new MetricsRegistry();
  const first = registry.counter("unique.count");
  first.inc(10);

  // Trying to register same name should be silently ignored —
  // the second counter is discarded and the original value is preserved
  const second = registry.counter("unique.count");
  second.inc(5);

  assert.equal(registry.get("unique.count").value(), 10);
});

test("MetricsRegistry: collect returns snapshot of all metrics", () => {
  const registry = new MetricsRegistry();
  registry.counter("test.alpha").inc(10);
  registry.get("tool.executions").inc(3);

  const snapshot = registry.collect();
  assert.equal(snapshot["test.alpha"].value, 10);
  assert.equal(snapshot["tool.executions"].value, 3);
});

test("MetricsRegistry: reset clears all metrics", () => {
  const registry = new MetricsRegistry();
  registry.get("tool.executions").inc(100);
  registry.get("tool.errors").inc(5);

  registry.reset();

  assert.equal(registry.get("tool.executions").value(), 0);
  assert.equal(registry.get("tool.errors").value(), 0);
});
