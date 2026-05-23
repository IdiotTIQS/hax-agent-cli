/**
 * Tests for structured JSON logger: levels, output targets, redaction, child loggers.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Logger, createLogger, LEVELS } = require("../../src/observability/logger");

test("Logger: createLogger returns a Logger instance", () => {
  const logger = createLogger({ sessionId: "test-session" });
  assert.ok(logger instanceof Logger);
  assert.equal(logger.sessionId, "test-session");
  assert.equal(logger.output, "stderr");
  assert.equal(logger.fd, null);
});

test("Logger: defaults level to info when not specified", () => {
  const logger = new Logger({ sessionId: "default-test" });
  assert.equal(logger.level, LEVELS.info);
});

test("Logger: resolves string level names", () => {
  const debugLogger = new Logger({ sessionId: "s1", level: "debug" });
  assert.equal(debugLogger.level, LEVELS.debug);

  const errorLogger = new Logger({ sessionId: "s2", level: "error" });
  assert.equal(errorLogger.level, LEVELS.error);
});

test("Logger: accepts numeric level values", () => {
  const logger = new Logger({ sessionId: "s1", level: 30 });
  assert.equal(logger.level, LEVELS.warn);
});

test("Logger: ignores messages below configured level", () => {
  const logger = new Logger({ sessionId: "test", level: "error" });
  // debug, info, warn should all be skipped; only error should pass
  // No assertion on output since we are not capturing stdout in this test,
  // but verify the method is callable without throwing
  assert.doesNotThrow(() => logger.debug("should be muted"));
  assert.doesNotThrow(() => logger.info("should be muted"));
  assert.doesNotThrow(() => logger.warn("should be muted"));
  assert.doesNotThrow(() => logger.error("should pass"));
});

test("Logger: writes JSON lines to file when output is file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-logger-"));
  const filePath = path.join(tmpDir, "app.log");

  const logger = new Logger({
    sessionId: "file-test",
    output: "file",
    filePath,
    level: "debug",
  });

  logger.info("hello", { user: "test" });
  logger.warn("caution", { code: 42 });

  logger.close();

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.trim().split("\n");
  assert.equal(lines.length, 2);

  const first = JSON.parse(lines[0]);
  assert.equal(first.level, "info");
  assert.equal(first.sessionId, "file-test");
  assert.equal(first.message, "hello");
  assert.equal(first.user, "test");
  assert.ok(typeof first.timestamp === "string");

  const second = JSON.parse(lines[1]);
  assert.equal(second.level, "warn");
  assert.equal(second.message, "caution");
  assert.equal(second.code, 42);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Logger: redacts sensitive keys from data", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-logger-"));
  const filePath = path.join(tmpDir, "app.log");

  const logger = new Logger({
    sessionId: "redact-test",
    output: "file",
    filePath,
    level: "debug",
  });

  logger.info("auth attempt", {
    apiKey: "sk-12345",
    token: "bearer-abc",
    password: "s3cret",
    username: "admin",
  });

  logger.close();

  const content = fs.readFileSync(filePath, "utf8");
  const entry = JSON.parse(content.trim());

  assert.equal(entry.apiKey, "[REDACTED]");
  assert.equal(entry.token, "[REDACTED]");
  assert.equal(entry.password, "[REDACTED]");
  assert.equal(entry.username, "admin");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Logger: redacts nested sensitive keys", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-logger-"));
  const filePath = path.join(tmpDir, "app.log");

  const logger = new Logger({
    sessionId: "nested-test",
    output: "file",
    filePath,
    level: "debug",
  });

  logger.info("config", {
    auth: {
      apiKey: "nested-key",
      token: "nested-token",
      timeout: 5000,
    },
  });

  logger.close();

  const content = fs.readFileSync(filePath, "utf8");
  const entry = JSON.parse(content.trim());

  assert.equal(entry.auth.apiKey, "[REDACTED]");
  assert.equal(entry.auth.token, "[REDACTED]");
  assert.equal(entry.auth.timeout, 5000);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Logger: child logger inherits parent configuration and merges bindings", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-logger-"));
  const filePath = path.join(tmpDir, "app.log");

  const parent = new Logger({
    sessionId: "parent-session",
    output: "file",
    filePath,
    level: "debug",
  });

  const child = parent.child({ module: "auth" });

  child.info("child message", { step: "login" });

  parent.close();

  const content = fs.readFileSync(filePath, "utf8");
  const entry = JSON.parse(content.trim());

  assert.equal(entry.sessionId, "parent-session");
  assert.equal(entry.module, "auth");
  assert.equal(entry.message, "child message");
  assert.equal(entry.step, "login");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Logger: close prevents further file writes gracefully", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-logger-"));
  const filePath = path.join(tmpDir, "app.log");

  const logger = new Logger({
    sessionId: "close-test",
    output: "file",
    filePath,
    level: "debug",
  });

  logger.info("before close");
  logger.close();

  // Writing after close should not crash; fd is null so file output is skipped
  assert.doesNotThrow(() => logger.info("after close"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Logger: both output mode writes to stderr and file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-logger-"));
  const filePath = path.join(tmpDir, "app.log");

  const logger = new Logger({
    sessionId: "both-test",
    output: "both",
    filePath,
    level: "debug",
  });

  logger.info("dual output");

  logger.close();

  const content = fs.readFileSync(filePath, "utf8");
  const entry = JSON.parse(content.trim());

  assert.equal(entry.message, "dual output");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
