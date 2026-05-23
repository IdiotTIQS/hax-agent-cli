/**
 * Tests for EnvironmentSnapshot — capture, compare, persist, and drift detection.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { EnvironmentSnapshot, SnapshotError } = require("../../src/isolate/snapshot");

// -- Helper ------------------------------------------------------------------

let tmpDir;

test.before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-snapshot-test-"));
});

test.after(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("EnvironmentSnapshot: captures system info", () => {
  const snap = new EnvironmentSnapshot();
  const result = snap.capture();

  assert.ok(typeof result.capturedAt === "string");
  assert.ok(typeof result.system === "object");
  assert.equal(result.system.platform, os.platform());
  assert.equal(result.system.arch, os.arch());
  assert.equal(typeof result.system.release, "string");
  assert.equal(result.system.hostname, os.hostname());
  assert.ok(result.system.cpus >= 1);
  assert.ok(result.system.totalMemory > 0);
  assert.ok(result.meta.snapshotVersion === 1);
});

test("EnvironmentSnapshot: captures node version", () => {
  const snap = new EnvironmentSnapshot();
  const result = snap.capture();

  assert.ok(typeof result.node === "object");
  assert.equal(result.node.version, process.version);
  assert.equal(result.node.versions.node, process.versions.node);
  assert.ok(typeof result.node.execPath === "string");
});

test("EnvironmentSnapshot: captures environment variables with sensitive masking", () => {
  const snap = new EnvironmentSnapshot();

  // Set a fake sensitive var for testing
  const key = "TEST_SECRET_TOKEN";
  const original = process.env[key];
  process.env[key] = "super-secret-value-12345";

  try {
    const result = snap.capture({ maskSensitive: true });
    assert.ok(typeof result.env === "object");
    assert.ok(key in result.env);
    // Should be masked (either "***" or partial mask)
    const masked = result.env[key];
    assert.notEqual(masked, "super-secret-value-12345");
    assert.ok(masked.includes("*") || masked.length < 20);
  } finally {
    if (original !== undefined) {
      process.env[key] = original;
    } else {
      delete process.env[key];
    }
  }
});

test("EnvironmentSnapshot: captures PATH as an array", () => {
  const snap = new EnvironmentSnapshot();
  const result = snap.capture({ capturePath: true });

  assert.ok(Array.isArray(result.path));
  assert.ok(result.path.length > 0);
  // PATH should contain entries
  assert.ok(result.path.some((entry) => entry.length > 0));
});

test("EnvironmentSnapshot: compare() returns identical=true for identical snapshots", () => {
  const snap = new EnvironmentSnapshot();
  const now = new Date().toISOString();
  const a = {
    capturedAt: now,
    system: { platform: "linux", arch: "x64", release: "5.15.0" },
    node: { version: "v18.17.0" },
    env: { FOO: "bar", BAZ: "qux" },
    path: ["/usr/bin", "/bin"],
    npmLocal: [{ name: "lodash", version: "4.17.21" }],
    npmGlobal: [],
    python: { pythonVersion: "Python 3.10.0", pipPackages: [] },
  };
  const b = {
    capturedAt: now,
    system: { platform: "linux", arch: "x64", release: "5.15.0" },
    node: { version: "v18.17.0" },
    env: { FOO: "bar", BAZ: "qux" },
    path: ["/usr/bin", "/bin"],
    npmLocal: [{ name: "lodash", version: "4.17.21" }],
    npmGlobal: [],
    python: { pythonVersion: "Python 3.10.0", pipPackages: [] },
  };

  const diff = snap.compare(a, b);
  assert.equal(diff.identical, true);
  assert.ok(typeof diff.sections.system === "object");
  assert.equal(Object.keys(diff.sections.system).length, 0);
});

test("EnvironmentSnapshot: compare() detects env var differences", () => {
  const snap = new EnvironmentSnapshot();
  const a = {
    capturedAt: new Date().toISOString(),
    env: { FOO: "bar", BAZ: "qux", UNCHANGED: "same" },
    path: ["/usr/bin", "/bin"],
  };
  const b = {
    capturedAt: new Date().toISOString(),
    env: { FOO: "bar", BAZ: "changed", NEWVAR: "hello", UNCHANGED: "same" },
    path: ["/usr/bin", "/bin", "/usr/local/bin"],
  };

  const diff = snap.compare(a, b);
  assert.equal(diff.identical, false);
  assert.deepEqual(diff.sections.env.added, ["NEWVAR"]);
  assert.deepEqual(diff.sections.env.removed, []);
  assert.equal(diff.sections.env.modified.length, 1);
  assert.equal(diff.sections.env.modified[0].key, "BAZ");
  assert.equal(diff.sections.path.added.length, 1);
  assert.equal(diff.sections.path.removed.length, 0);
});

test("EnvironmentSnapshot: compare() detects package differences", () => {
  const snap = new EnvironmentSnapshot();
  const a = {
    capturedAt: new Date().toISOString(),
    npmLocal: [
      { name: "lodash", version: "4.17.21" },
      { name: "express", version: "4.18.0" },
    ],
  };
  const b = {
    capturedAt: new Date().toISOString(),
    npmLocal: [
      { name: "lodash", version: "4.17.22" },
      { name: "fastify", version: "4.0.0" },
    ],
  };

  const diff = snap.compare(a, b);
  assert.equal(diff.identical, false);
  assert.equal(diff.sections.npmLocal.added.length, 1);
  assert.equal(diff.sections.npmLocal.added[0].name, "fastify");
  assert.equal(diff.sections.npmLocal.removed.length, 1);
  assert.equal(diff.sections.npmLocal.removed[0].name, "express");
  assert.equal(diff.sections.npmLocal.modified.length, 1);
  assert.equal(diff.sections.npmLocal.modified[0].name, "lodash");
});

test("EnvironmentSnapshot: save() and load() round-trip preserves data", () => {
  const snap = new EnvironmentSnapshot();
  const data = snap.capture();

  const filePath = path.join(tmpDir, "snapshot-test.json");
  const saved = snap.save(filePath);
  assert.equal(saved, true);
  assert.ok(fs.existsSync(filePath));

  // Load into a new instance
  const snap2 = new EnvironmentSnapshot();
  const loaded = snap2.load(filePath);
  assert.equal(loaded.capturedAt, data.capturedAt);
  assert.equal(loaded.system.platform, data.system.platform);
  assert.equal(loaded.node.version, data.node.version);
});

test("EnvironmentSnapshot: restore() detects drift when env changes", () => {
  const snap = new EnvironmentSnapshot();
  const baseline = {
    capturedAt: new Date().toISOString(),
    system: { platform: "linux", arch: "x64", release: "5.15.0" },
    node: { version: "v18.0.0" },
    env: { FOO: "bar" },
    path: ["/usr/bin"],
    npmLocal: [{ name: "test-lib", version: "1.0.0" }],
    npmGlobal: [],
    python: { pythonVersion: "Python 3.10.0", pipPackages: [] },
  };

  // Mock capture to return something different
  const originalCapture = snap.capture.bind(snap);
  snap.capture = () => ({
    capturedAt: new Date().toISOString(),
    system: { platform: "linux", arch: "arm64", release: "6.1.0" },
    node: { version: "v20.0.0" },
    env: { FOO: "bar", BAR: "new" },
    path: ["/usr/bin", "/usr/local/bin"],
    npmLocal: [{ name: "test-lib", version: "2.0.0" }],
    npmGlobal: [{ name: "typescript", version: "5.0.0" }],
    python: { pythonVersion: "Python 3.11.0", pipPackages: [] },
  });

  try {
    const result = snap.restore(baseline);
    assert.equal(result.drifted, true);
    assert.ok(result.warnings.length > 0);
    // Should detect arch change in system
    assert.ok(Object.keys(result.diff.sections.system).length > 0);
  } finally {
    snap.capture = originalCapture;
  }
});

test("EnvironmentSnapshot: restore() returns drifted=false for matching envs", () => {
  const snap = new EnvironmentSnapshot();
  const now = new Date().toISOString();
  const s = {
    capturedAt: now,
    system: { platform: "linux", arch: "x64", release: "5.15.0" },
    node: { version: "v18.17.0" },
    env: { FOO: "bar" },
    path: ["/usr/bin"],
    npmLocal: [{ name: "test-lib", version: "1.0.0" }],
    npmGlobal: [],
    python: { pythonVersion: "Python 3.10.0", pipPackages: [] },
  };

  // Override capture to return identical data
  const originalCapture = snap.capture.bind(snap);
  snap.capture = () => ({ ...s, capturedAt: new Date().toISOString() });

  try {
    const result = snap.restore(s);
    // Should match apart from capturedAt timestamp (which compare ignores for these sections)
    assert.equal(result.drifted, false);
    assert.deepEqual(result.warnings, []);
  } finally {
    snap.capture = originalCapture;
  }
});

test("EnvironmentSnapshot: lockfileFromSnapshot generates valid lockfile", () => {
  const snap = new EnvironmentSnapshot();
  const snapshotData = {
    capturedAt: new Date().toISOString(),
    node: { version: "v18.17.0" },
    system: { platform: "linux", arch: "x64" },
    npmLocal: [
      { name: "lodash", version: "4.17.21" },
      { name: "express", version: "4.18.2" },
    ],
    npmGlobal: [
      { name: "typescript", version: "5.1.6" },
    ],
  };

  const lockfile = snap.lockfileFromSnapshot(snapshotData);
  assert.equal(lockfile.lockfileVersion, 2);
  assert.ok(typeof lockfile.generatedAt === "string");
  assert.equal(lockfile.metadata.nodeVersion, "v18.17.0");

  // Should contain all 3 packages (deduplicated, local wins)
  assert.ok("node_modules/lodash" in lockfile.packages);
  assert.ok("node_modules/express" in lockfile.packages);
  assert.ok("node_modules/typescript" in lockfile.packages);
  assert.equal(lockfile.packages["node_modules/lodash"].version, "4.17.21");
});

test("EnvironmentSnapshot: save() throws when no data captured", () => {
  const snap = new EnvironmentSnapshot();
  const filePath = path.join(tmpDir, "empty-snapshot.json");

  assert.throws(
    () => snap.save(filePath),
    (err) => err instanceof SnapshotError && err.code === "SNAPSHOT_EMPTY",
  );
});

test("EnvironmentSnapshot: load() throws when file not found", () => {
  const snap = new EnvironmentSnapshot();
  const missingPath = path.join(tmpDir, "does-not-exist.json");

  assert.throws(
    () => snap.load(missingPath),
    (err) => err instanceof SnapshotError && err.code === "SNAPSHOT_NOT_FOUND",
  );
});

test("EnvironmentSnapshot: lockfileFromSnapshot throws on null snapshot", () => {
  const snap = new EnvironmentSnapshot();
  assert.throws(
    () => snap.lockfileFromSnapshot(null),
    (err) => err instanceof SnapshotError && err.code === "SNAPSHOT_INVALID",
  );
});

test("EnvironmentSnapshot: restore() throws on null snapshot", () => {
  const snap = new EnvironmentSnapshot();
  assert.throws(
    () => snap.restore(null),
    (err) => err instanceof SnapshotError && err.code === "SNAPSHOT_INVALID",
  );
});

test("EnvironmentSnapshot: capture respects captureEnvVars=false", () => {
  const snap = new EnvironmentSnapshot();
  const result = snap.capture({ captureEnvVars: false });
  assert.equal(result.env, undefined);
});

test("EnvironmentSnapshot: captures are independent instances", () => {
  const snap = new EnvironmentSnapshot();
  const a = snap.capture();
  const b = snap.capture();

  // Modify a, should not affect b
  a.system = { modified: true };
  assert.ok(typeof b.system.platform === "string");
});
