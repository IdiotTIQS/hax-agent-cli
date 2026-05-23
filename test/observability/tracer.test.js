/**
 * Tests for tracing: Span, Tracer, createTracer, span trees, and JSON export.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Tracer, Span, createTracer } = require("../../src/observability/tracer");

test("Span: initializes with id, name, traceId, and startTime", () => {
  const span = new Span({ name: "http.request" });
  assert.ok(typeof span.id === "string" && span.id.length > 0);
  assert.equal(span.name, "http.request");
  assert.ok(typeof span.traceId === "string" && span.traceId.startsWith("trace_"));
  assert.equal(span.parentId, null);
  assert.equal(span.endTime, null);
  assert.equal(span.children.length, 0);
  assert.equal(span.events.length, 0);
});

test("Span: setTag and getTag store and retrieve values", () => {
  const span = new Span({ name: "test" });
  span.setTag("http.method", "GET");
  span.setTag("http.status_code", 200);

  assert.equal(span.getTag("http.method"), "GET");
  assert.equal(span.getTag("http.status_code"), 200);
  assert.equal(span.getTag("nonexistent"), undefined);
});

test("Span: addEvent records timestamped annotations", () => {
  const span = new Span({ name: "test" });
  span.addEvent("started", { user: "admin" });
  span.addEvent("validated", { result: "ok" });

  assert.equal(span.events.length, 2);
  assert.equal(span.events[0].name, "started");
  assert.equal(span.events[0].attributes.user, "admin");
  assert.equal(span.events[1].name, "validated");
  assert.equal(span.events[1].attributes.result, "ok");
  assert.ok(typeof span.events[0].timestamp === "number");
});

test("Span: addChild establishes parent-child relationship", () => {
  const parent = new Span({ name: "parent" });
  const child = new Span({ name: "child" });

  parent.addChild(child);

  assert.equal(child.parentId, parent.id);
  assert.equal(child.traceId, parent.traceId);
  assert.equal(parent.children.length, 1);
  assert.equal(parent.children[0].id, child.id);
});

test("Span: finish sets endTime and durationMs computes correctly", () => {
  const span = new Span({ name: "timed", startTime: 1000 });
  span.finish(1500);

  assert.equal(span.endTime, 1500);
  assert.equal(span.durationMs(), 500);
});

test("Span: toJson exports full span tree", () => {
  const root = new Span({ name: "root" });
  root.setTag("env", "test");

  const child = new Span({ name: "child" });
  child.addEvent("step1", { count: 1 });
  root.addChild(child);

  const json = root.toJson();

  assert.equal(json.name, "root");
  assert.equal(json.tags.env, "test");
  assert.equal(json.children.length, 1);
  assert.equal(json.children[0].name, "child");
  assert.equal(json.children[0].events.length, 1);
  assert.equal(json.children[0].events[0].name, "step1");
});

test("Tracer: startSpan creates and returns a new span", () => {
  const tracer = new Tracer({ serviceName: "test-svc" });
  const span = tracer.startSpan("operation.start");

  assert.ok(span instanceof Span);
  assert.equal(span.name, "operation.start");
  assert.equal(span.getTag("service"), "test-svc");
});

test("Tracer: spans form a tree via startSpan parent-child nesting", () => {
  const tracer = new Tracer();
  const root = tracer.startSpan("root.op");
  const child = tracer.startSpan("child.op", { childOf: root });
  const grandchild = tracer.startSpan("leaf.op", { childOf: child });

  assert.equal(root.children.length, 1);
  assert.equal(child.children.length, 1);
  assert.equal(grandchild.parentId, child.id);
  assert.equal(grandchild.traceId, root.traceId);
  assert.equal(child.traceId, root.traceId);
});

test("Tracer: startSpan accepts parentId string to attach to existing span", () => {
  const tracer = new Tracer();
  const root = tracer.startSpan("root");
  const child = tracer.startSpan("child", { parentId: root.id });

  assert.equal(child.parentId, root.id);
  assert.equal(root.children.length, 1);
});

test("Tracer: finishSpan marks span as complete", () => {
  const tracer = new Tracer();
  const span = tracer.startSpan("temp.op");

  assert.equal(span.endTime, null);

  const finished = tracer.finishSpan(span);
  assert.ok(finished.endTime !== null);
});

test("Tracer: currentSpan returns the most recently active span", () => {
  const tracer = new Tracer();
  const first = tracer.startSpan("first");
  const second = tracer.startSpan("second");

  const current = tracer.currentSpan();
  assert.equal(current.id, second.id);

  tracer.finishSpan(second);
  const afterFinish = tracer.currentSpan();
  assert.equal(afterFinish.id, first.id);
});

test("Tracer: toJson exports the full trace tree", () => {
  const tracer = new Tracer({ serviceName: "api-gateway" });
  tracer.setTag("version", "1.0.0");

  const root = tracer.startSpan("request");
  root.addEvent("received", { size: 1024 });

  const db = tracer.startSpan("db.query", { childOf: root });
  db.setTag("db.type", "sql");
  db.addEvent("executed", { rows: 42 });
  tracer.finishSpan(db);

  tracer.finishSpan(root);

  const json = tracer.toJson();

  assert.equal(json.serviceName, "api-gateway");
  assert.equal(json.tags.version, "1.0.0");
  assert.equal(json.spans.length, 1);

  const exportedRoot = json.spans[0];
  assert.equal(exportedRoot.name, "request");
  assert.equal(exportedRoot.children.length, 1);
  assert.equal(exportedRoot.children[0].name, "db.query");
  assert.equal(exportedRoot.children[0].tags["db.type"], "sql");
});

test("Tracer: createTracer factory returns Tracer instance", () => {
  const tracer = createTracer({ serviceName: "factory-test" });
  assert.ok(tracer instanceof Tracer);
  assert.equal(tracer.serviceName, "factory-test");
});

test("Tracer: reset clears all spans", () => {
  const tracer = new Tracer();
  tracer.startSpan("op1");
  tracer.startSpan("op2");

  assert.equal(tracer.getSpans().length, 2);

  tracer.reset();
  assert.equal(tracer.getSpans().length, 0);
  assert.equal(tracer.rootSpans().length, 0);
});

test("Tracer: rootSpans returns only top-level spans", () => {
  const tracer = new Tracer();
  const root1 = tracer.startSpan("r1");
  const root2 = tracer.startSpan("r2");
  tracer.startSpan("c1", { childOf: root1 });

  const roots = tracer.rootSpans();
  assert.equal(roots.length, 2);
});

test("Span: addEvent redacts sensitive attributes", () => {
  const span = new Span({ name: "auth" });
  span.addEvent("credentials", {
    username: "admin",
    password: "s3cret",
    apiKey: "sk-abc",
    token: "bearer-xyz",
  });

  assert.equal(span.events[0].attributes.username, "admin");
  assert.equal(span.events[0].attributes.password, "[REDACTED]");
  assert.equal(span.events[0].attributes.apiKey, "[REDACTED]");
  assert.equal(span.events[0].attributes.token, "[REDACTED]");
});

test("Span: toJSON alias returns same as toJson", () => {
  const span = new Span({ name: "alias-test" });
  span.finish();
  const json = span.toJson();
  const alt = span.toJSON();

  assert.deepEqual(alt, json);
});
