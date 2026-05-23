/**
 * Tests for notification channels: DesktopChannel, FileChannel,
 * WebhookChannel, CallbackChannel, CompositeChannel, createNotification.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createNotification,
  DesktopChannel,
  FileChannel,
  WebhookChannel,
  CallbackChannel,
  CompositeChannel,
} = require("../../src/notify/channels");

// ---- createNotification ----------------------------------------------------

test("createNotification: produces frozen object with defaults", () => {
  const n = createNotification({ type: "test.event" });
  assert.equal(n.type, "test.event");
  assert.equal(n.severity, "info");
  assert.equal(n.title, "");
  assert.equal(n.message, "");
  assert.equal(n.source, "haxagent");
  assert.ok(typeof n.timestamp === "number");
  assert.ok(n.timestamp <= Date.now());
  assert.equal(n.data, null);

  // Should be immutable (Object.freeze throws TypeError in strict mode)
  assert.throws(() => { n.type = "changed"; }, TypeError);
});

test("createNotification: normalizes severity to valid values", () => {
  assert.equal(createNotification({ type: "e", severity: "CRITICAL" }).severity, "critical");
  assert.equal(createNotification({ type: "e", severity: "Error" }).severity, "error");
  assert.equal(createNotification({ type: "e", severity: "WARN" }).severity, "warn");
  assert.equal(createNotification({ type: "e", severity: "info" }).severity, "info");
  assert.equal(createNotification({ type: "e", severity: "unknown" }).severity, "info");
  assert.equal(createNotification({ type: "e" }).severity, "info");
});

test("createNotification: preserves custom fields", () => {
  const ts = 1700000000000;
  const n = createNotification({
    type: "task.complete",
    title: "Done",
    message: "Build passed",
    severity: "error",
    timestamp: ts,
    data: { exitCode: 0 },
    source: "agent-1",
  });
  assert.equal(n.title, "Done");
  assert.equal(n.message, "Build passed");
  assert.equal(n.severity, "error");
  assert.equal(n.timestamp, ts);
  assert.deepEqual(n.data, { exitCode: 0 });
  assert.equal(n.source, "agent-1");
});

// ---- DesktopChannel --------------------------------------------------------

test("DesktopChannel: send writes to stdout when notifier unavailable", async () => {
  const channel = new DesktopChannel({ appName: "TestApp", fallbackToStdout: true });
  const originalWrite = process.stdout.write;
  let captured = "";

  process.stdout.write = (chunk) => { captured += chunk; return true; };

  try {
    await channel.send({
      type: "test",
      title: "Hello",
      message: "World",
      severity: "error",
    });

    assert.ok(captured.includes("Hello"));
    assert.ok(captured.includes("World"));
    assert.ok(captured.includes("ERROR")); // severity prefix
  } finally {
    process.stdout.write = originalWrite;
  }
});

test("DesktopChannel: validate catches invalid appName", () => {
  const channel = new DesktopChannel({ appName: 123 });
  const result = channel.validate();
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("appName")));
});

test("DesktopChannel: validate passes with valid config", () => {
  const channel = new DesktopChannel({ appName: "HaxAgent" });
  const result = channel.validate();
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

// ---- FileChannel -----------------------------------------------------------

test("FileChannel: appends JSON lines to a log file", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-notify-"));
  const filePath = path.join(tmpDir, "notifications.log");

  const channel = new FileChannel({ filePath, createDir: true });

  await channel.send({ type: "task.error", title: "Oops", message: "Fail", severity: "error" });
  await channel.send({ type: "task.complete", title: "Yay", message: "OK" });

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.trim().split("\n");
  assert.equal(lines.length, 2);

  const first = JSON.parse(lines[0]);
  assert.equal(first.type, "task.error");
  assert.equal(first.title, "Oops");
  assert.equal(first.severity, "error");

  const second = JSON.parse(lines[1]);
  assert.equal(second.type, "task.complete");
  assert.equal(second.severity, "info");

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("FileChannel: creates parent directories when createDir is true", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-notify-"));
  const deepPath = path.join(tmpDir, "deep", "nested", "dir", "events.log");

  const channel = new FileChannel({ filePath: deepPath, createDir: true });
  await channel.send({ type: "test" });

  assert.ok(fs.existsSync(deepPath));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("FileChannel: validate fails for missing filePath", () => {
  const channel = new FileChannel({ filePath: "" });
  const result = channel.validate();
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("filePath")));
});

test("FileChannel: validate passes for writable path", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-notify-"));
  const channel = new FileChannel({ filePath: path.join(tmpDir, "test.log") });
  const result = channel.validate();
  assert.equal(result.valid, true);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---- WebhookChannel --------------------------------------------------------

test("WebhookChannel: sends POST with JSON payload via mock transport", async () => {
  const calls = [];

  const mockTransport = (url, options) => {
    calls.push({ url, options });
    return Promise.resolve();
  };

  const channel = new WebhookChannel({
    url: "https://hooks.example.com/notify",
    headers: { "X-Custom": "value" },
    timeoutMs: 3000,
    httpTransport: mockTransport,
  });

  await channel.send({ type: "alert", title: "Server down", severity: "critical" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hooks.example.com/notify");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.equal(calls[0].options.headers["X-Custom"], "value");

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.type, "alert");
  assert.equal(body.title, "Server down");
  assert.equal(body.severity, "critical");
});

test("WebhookChannel: validate rejects non-http URL", () => {
  const channel = new WebhookChannel({ url: "ftp://example.com" });
  const result = channel.validate();
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("http or https")));
});

test("WebhookChannel: validate rejects invalid URL", () => {
  const channel = new WebhookChannel({ url: "not-a-url" });
  const result = channel.validate();
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("valid URL")));
});

test("WebhookChannel: validate passes for https URL", () => {
  const channel = new WebhookChannel({ url: "https://hooks.example.com/webhook" });
  const result = channel.validate();
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

// ---- CallbackChannel -------------------------------------------------------

test("CallbackChannel: invokes callback with notification", async () => {
  const received = [];
  const channel = new CallbackChannel({
    callback: (n) => { received.push(n); },
  });

  await channel.send({ type: "test", title: "Callback test", severity: "warn" });

  assert.equal(received.length, 1);
  assert.equal(received[0].type, "test");
  assert.equal(received[0].title, "Callback test");
  assert.equal(received[0].severity, "warn");
});

test("CallbackChannel: handles async callbacks", async () => {
  const order = [];
  const channel = new CallbackChannel({
    callback: async (n) => {
      order.push("start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("end");
    },
  });

  await channel.send({ type: "test" });
  assert.deepEqual(order, ["start", "end"]);
});

test("CallbackChannel: no-op when callback is not a function", async () => {
  const channel = new CallbackChannel({ callback: null });
  // Should not throw
  await channel.send({ type: "test" });
  // Validator should catch it
  const result = channel.validate();
  assert.equal(result.valid, false);
});

test("CallbackChannel: validate passes when callback is a function", () => {
  const channel = new CallbackChannel({ callback: () => {} });
  const result = channel.validate();
  assert.equal(result.valid, true);
});

test("CallbackChannel: sync mode does not await non-promise result", async () => {
  const received = [];
  const channel = new CallbackChannel({
    callback: (n) => { received.push(n); },
    async: false,
  });

  await channel.send({ type: "sync-test" });
  assert.equal(received.length, 1);
  assert.equal(received[0].type, "sync-test");
});

// ---- CompositeChannel ------------------------------------------------------

test("CompositeChannel: fans out to multiple channels", async () => {
  const callsA = [];
  const callsB = [];
  const chA = new CallbackChannel({ callback: (n) => callsA.push(n) });
  const chB = new CallbackChannel({ callback: (n) => callsB.push(n) });

  const composite = new CompositeChannel({ channels: [chA, chB] });

  const result = await composite.send({ type: "fanout", title: "All" });
  assert.equal(result.delivered, 2);
  assert.equal(result.errors.length, 0);
  assert.equal(callsA.length, 1);
  assert.equal(callsB.length, 1);
  assert.equal(callsA[0].type, "fanout");
  assert.equal(callsB[0].type, "fanout");
});

test("CompositeChannel: collects errors without stopping fan-out", async () => {
  const good = new CallbackChannel({ callback: (n) => {} });
  const bad = {
    send: async () => { throw new Error("channel down"); },
    validate: () => ({ valid: true, errors: [] }),
  };

  const composite = new CompositeChannel({ channels: [good, bad] });

  const result = await composite.send({ type: "test" });
  assert.equal(result.delivered, 1);
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0].error.includes("channel down"));
});

test("CompositeChannel: add and remove channels dynamically", () => {
  const composite = new CompositeChannel();
  assert.equal(composite.size, 0);

  const ch = new CallbackChannel({ callback: () => {} });
  composite.add(ch);
  assert.equal(composite.size, 1);

  const removed = composite.remove(ch);
  assert.equal(removed, true);
  assert.equal(composite.size, 0);

  // Remove non-existent returns false
  assert.equal(composite.remove(ch), false);
});

test("CompositeChannel: validate checks all children", () => {
  const valid = new CallbackChannel({ callback: () => {} });
  const invalid = new CallbackChannel({ callback: null });

  const composite = new CompositeChannel({ channels: [valid, invalid] });
  const result = composite.validate();
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test("CompositeChannel: validate warns on empty channel list", () => {
  const composite = new CompositeChannel();
  const result = composite.validate();
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("no child channels")));
});
