"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PermissionMode,
  PermissionDecision,
  PermissionChecker,
} = require("../src/core/permissions/checker");

// === PermissionDecision factories ===

test("PermissionDecision.allow → allowed, no confirmation", () => {
  const d = PermissionDecision.allow("ok");
  assert.equal(d.allowed, true);
  assert.equal(d.requiresConfirmation, false);
  assert.equal(d.reason, "ok");
});

test("PermissionDecision.deny → not allowed", () => {
  const d = PermissionDecision.deny("nope");
  assert.equal(d.allowed, false);
  assert.equal(d.requiresConfirmation, false);
});

test("PermissionDecision.confirm → not allowed but requires confirmation", () => {
  const d = PermissionDecision.confirm("are you sure", { isPackageInstall: true });
  assert.equal(d.allowed, false);
  assert.equal(d.requiresConfirmation, true);
  assert.equal(d.isPackageInstall, true);
});

// === Priority: deny list beats allow list ===

test("deny list takes precedence over allow list", () => {
  const c = new PermissionChecker({
    allowedTools: ["shell.run"],
    deniedTools: ["shell.run"],
  });
  const d = c.evaluate("shell.run", { args: { command: "echo hi" } });
  assert.equal(d.allowed, false, "denied tool must win even if also allowed");
});

test("allow list bypasses all other checks (even modifying ops)", () => {
  const c = new PermissionChecker({ mode: PermissionMode.DEFAULT, allowedTools: ["file.write"] });
  const d = c.evaluate("file.write", { args: { path: "foo.txt" } });
  assert.equal(d.allowed, true);
  assert.equal(d.requiresConfirmation, false);
});

// === Priority: sensitive paths protected regardless of mode ===

test("sensitive path (.ssh) denied even in YOLO mode", () => {
  const c = new PermissionChecker({ mode: PermissionMode.YOLO });
  const d = c.evaluate("file.read", { args: { path: "/home/user/.ssh/id_rsa" }, cwd: "/home/user" });
  assert.equal(d.allowed, false, ".ssh path must be blocked even in YOLO");
});

test("id_rsa private key denied", () => {
  const c = new PermissionChecker({ mode: PermissionMode.FULL_AUTO });
  const d = c.evaluate("file.read", { args: { path: "/tmp/id_rsa" }, cwd: "/tmp" });
  assert.equal(d.allowed, false);
});

test("aws credentials denied", () => {
  const c = new PermissionChecker({ mode: PermissionMode.YOLO });
  const d = c.evaluate("file.read", { args: { path: "/home/u/.aws/credentials" }, cwd: "/home/u" });
  assert.equal(d.allowed, false);
});

// === Dangerous commands ===

test("rm -rf / is blocked", () => {
  const c = new PermissionChecker({ mode: PermissionMode.YOLO });
  const d = c.evaluate("shell.run", { args: { command: "rm -rf /" } });
  assert.equal(d.allowed, false, "destructive command must be denied even in YOLO");
});

test("fork bomb is blocked", () => {
  const c = new PermissionChecker({ mode: PermissionMode.FULL_AUTO });
  const d = c.evaluate("shell.run", { args: { command: ":(){ :|:& };:" } });
  assert.equal(d.allowed, false);
});

test("benign echo is not flagged as dangerous", () => {
  const c = new PermissionChecker({ mode: PermissionMode.YOLO });
  const d = c.evaluate("shell.run", { args: { command: "echo hello" } });
  assert.equal(d.allowed, true);
});

// === Read-only passthrough ===

test("isReadOnly boolean true allows in DEFAULT mode", () => {
  const c = new PermissionChecker({ mode: PermissionMode.DEFAULT });
  const d = c.evaluate("custom.tool", { args: {}, isReadOnly: true });
  assert.equal(d.allowed, true);
});

test("isReadOnly function is honored", () => {
  const c = new PermissionChecker({ mode: PermissionMode.DEFAULT });
  const d = c.evaluate("custom.tool", { args: { x: 1 }, isReadOnly: (a) => a.x === 1 });
  assert.equal(d.allowed, true);
});

// === Package install detection ===

test("npm install triggers confirmation with isPackageInstall flag", () => {
  const c = new PermissionChecker({ mode: PermissionMode.DEFAULT });
  const d = c.evaluate("shell.run", { args: { command: "npm install left-pad" } });
  assert.equal(d.requiresConfirmation, true);
  assert.equal(d.isPackageInstall, true);
});

// === Mode-based decisions ===

test("PLAN mode blocks modifying operations", () => {
  const c = new PermissionChecker({ mode: PermissionMode.PLAN });
  const d = c.evaluate("file.write", { args: { path: "foo.txt" } });
  assert.equal(d.allowed, false);
});

test("FULL_AUTO allows modifying operations silently", () => {
  const c = new PermissionChecker({ mode: PermissionMode.FULL_AUTO });
  const d = c.evaluate("file.write", { args: { path: "foo.txt" } });
  assert.equal(d.allowed, true);
  assert.equal(d.requiresConfirmation, false);
});

test("DEFAULT mode requires confirmation for modifying tools", () => {
  const c = new PermissionChecker({ mode: PermissionMode.DEFAULT });
  const d = c.evaluate("file.write", { args: { path: "foo.txt" } });
  assert.equal(d.requiresConfirmation, true);
});

test("DEFAULT mode allows known read-only tools without confirmation", () => {
  const c = new PermissionChecker({ mode: PermissionMode.DEFAULT });
  const d = c.evaluate("file.read", { args: { path: "foo.txt" } });
  assert.equal(d.allowed, true);
  assert.equal(d.requiresConfirmation, false);
});

// === Path rules ===

test("explicit deny path rule blocks access", () => {
  const c = new PermissionChecker({
    mode: PermissionMode.YOLO,
    pathRules: [{ pattern: "*/secret/*", allow: false }],
  });
  const d = c.evaluate("file.read", { args: { path: "/proj/secret/data" }, cwd: "/proj" });
  assert.equal(d.allowed, false);
});

// === setMode ===

test("setMode accepts valid mode and rejects invalid", () => {
  const c = new PermissionChecker();
  assert.equal(c.setMode(PermissionMode.YOLO), true);
  assert.equal(c.mode, PermissionMode.YOLO);
  assert.equal(c.setMode("bogus"), false);
  assert.equal(c.mode, PermissionMode.YOLO, "invalid mode must not change state");
});

// === getStatus ===

test("getStatus reports current configuration", () => {
  const c = new PermissionChecker({ mode: PermissionMode.PLAN, allowedTools: ["a"], deniedTools: ["b"] });
  const s = c.getStatus();
  assert.equal(s.mode, PermissionMode.PLAN);
  assert.deepEqual(s.allowedTools, ["a"]);
  assert.deepEqual(s.deniedTools, ["b"]);
  assert.ok(s.sensitivePathPatterns >= 13, "should include built-in sensitive patterns");
});
