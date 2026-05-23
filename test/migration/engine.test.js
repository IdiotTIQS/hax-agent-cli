/**
 * Tests for MigrationEngine.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { MigrationEngine } = require("../../src/migration/engine");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hax-mig-eng-"));
}

function cleanupDir(dir) {
  try {
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (_) { /* ignore */ }
}

function writeTempFile(dir, name, content) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// A simple no-op transform for testing
const identityTransform = {
  name: "identity",
  description: "Leaves code unchanged",
  apply(content) { return content; },
};

const upperTransform = {
  name: "upper",
  description: "Uppercases variable declarations",
  match(file, content) { return /\.js$/i.test(file); },
  apply(content) { return content.toUpperCase(); },
};

const addHeaderTransform = {
  name: "addHeader",
  description: "Prepends a header comment",
  apply(content, _opts) {
    return "// Transformed\n" + content;
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("defineTransform: registers a transform and returns engine for chaining", () => {
  const engine = new MigrationEngine();
  const returned = engine.defineTransform("testTf", identityTransform);
  assert.equal(returned, engine);
  assert.equal(engine.getTransform("testTf"), identityTransform);
  assert.ok(engine.listTransforms().includes("testTf"));
});

test("defineTransform: throws on missing name", () => {
  const engine = new MigrationEngine();
  assert.throws(() => engine.defineTransform("", identityTransform), TypeError);
  assert.throws(() => engine.defineTransform(null, identityTransform), TypeError);
});

test("defineTransform: throws on transform without apply function", () => {
  const engine = new MigrationEngine();
  assert.throws(() => engine.defineTransform("bad", {}), TypeError);
  assert.throws(() => engine.defineTransform("bad", { apply: "not-a-function" }), TypeError);
  assert.throws(() => engine.defineTransform("bad", null), TypeError);
});

test("getTransform: returns undefined for unregistered transform", () => {
  const engine = new MigrationEngine();
  assert.equal(engine.getTransform("nonexistent"), undefined);
});

test("listTransforms: returns empty array when nothing registered", () => {
  const engine = new MigrationEngine();
  assert.deepEqual(engine.listTransforms(), []);
});

test("apply: processes a single file with a registered transform", () => {
  const dir = createTempDir();
  const filePath = writeTempFile(dir, "test.js", "var x = 1;\nvar y = 2;");

  const engine = new MigrationEngine({ cwd: dir });
  engine.defineTransform("upper", upperTransform);

  const result = engine.apply("test.js", "upper", { dryRun: true });

  assert.equal(result.summary.total, 1);
  assert.equal(result.summary.changed, 1);
  assert.equal(result.summary.errors, 0);
  assert.ok(typeof result.transformId === "string");
  assert.ok(result.transformId.startsWith("mig_"));

  // File should NOT be modified on disk (dry run)
  const diskContent = fs.readFileSync(filePath, "utf-8");
  assert.equal(diskContent, "var x = 1;\nvar y = 2;");

  cleanupDir(dir);
});

test("apply: actually writes to disk when dryRun is false", () => {
  const dir = createTempDir();
  const filePath = writeTempFile(dir, "test.js", "hello world");

  const engine = new MigrationEngine({ cwd: dir });
  engine.defineTransform("upper", upperTransform);

  const result = engine.apply("test.js", "upper", { dryRun: false });

  assert.equal(result.summary.changed, 1);
  const diskContent = fs.readFileSync(filePath, "utf-8");
  assert.equal(diskContent.toUpperCase(), diskContent);

  cleanupDir(dir);
});

test("apply: respects maxFiles cap", () => {
  const dir = createTempDir();
  writeTempFile(dir, "a.js", "content");
  writeTempFile(dir, "b.js", "content");
  writeTempFile(dir, "c.js", "content");

  const engine = new MigrationEngine({ cwd: dir });
  engine.defineTransform("addHeader", addHeaderTransform);

  const result = engine.apply(["a.js", "b.js", "c.js"], "addHeader", { dryRun: true, maxFiles: 2 });

  assert.equal(result.summary.total, 2);
  assert.equal(result.results.length, 2);

  cleanupDir(dir);
});

test("apply: supports inline transform objects", () => {
  const dir = createTempDir();
  const filePath = writeTempFile(dir, "test.js", "abc");

  const engine = new MigrationEngine({ cwd: dir });

  const result = engine.apply("test.js", {
    name: "reverse",
    apply(content) { return content.split("").reverse().join(""); },
  }, { dryRun: true });

  assert.equal(result.summary.changed, 1);
  assert.equal(result.results[0].transformed, "cba");

  cleanupDir(dir);
});

test("apply: uses match gate to skip non-matching files", () => {
  const dir = createTempDir();
  writeTempFile(dir, "script.js", "var x = 1;");
  writeTempFile(dir, "readme.txt", "some text content");

  const engine = new MigrationEngine({ cwd: dir });
  engine.defineTransform("upper", upperTransform);

  const result = engine.apply(["script.js", "readme.txt"], "upper", { dryRun: true });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.changed, 1);
  assert.equal(result.summary.unchanged, 1);

  // The .txt file should be unchanged
  const txtResult = result.results.find((r) => r.file.endsWith("readme.txt"));
  assert.ok(txtResult);
  assert.equal(txtResult.changed, false);
  assert.equal(txtResult.transformed, txtResult.original);

  cleanupDir(dir);
});

test("apply: handles read errors gracefully", () => {
  const engine = new MigrationEngine();
  engine.defineTransform("upper", upperTransform);

  const result = engine.apply("/nonexistent/path/file.js", "upper", { dryRun: true });

  assert.equal(result.summary.errors, 1);
  assert.ok(result.results[0].error.includes("read error"));
});

test("preview: is equivalent to apply with dryRun: true", () => {
  const dir = createTempDir();
  writeTempFile(dir, "test.js", "var a = 1;");

  const engine = new MigrationEngine({ cwd: dir });
  engine.defineTransform("addHeader", addHeaderTransform);

  const previewResult = engine.preview("test.js", "addHeader");
  const applyResult = engine.apply("test.js", "addHeader", { dryRun: true });

  assert.equal(previewResult.summary.changed, applyResult.summary.changed);
  assert.equal(previewResult.results[0].transformed, applyResult.results[0].transformed);

  cleanupDir(dir);
});

test("rollback: restores files from backup", () => {
  const dir = createTempDir();
  const filePath = writeTempFile(dir, "test.js", "original content");

  const engine = new MigrationEngine({ cwd: dir });
  engine.defineTransform("addHeader", addHeaderTransform);

  // Apply with backup enabled
  const applyResult = engine.apply("test.js", "addHeader", { dryRun: false, backup: true });

  assert.equal(applyResult.summary.changed, 1);
  const afterApply = fs.readFileSync(filePath, "utf-8");
  assert.ok(afterApply.startsWith("// Transformed"));

  // Rollback
  const rollbackResult = engine.rollback(applyResult.transformId);

  assert.equal(rollbackResult.success, true);
  assert.equal(rollbackResult.restored, 1);
  assert.equal(rollbackResult.errors.length, 0);

  const afterRollback = fs.readFileSync(filePath, "utf-8");
  assert.equal(afterRollback, "original content");

  cleanupDir(dir);
});

test("rollback: fails gracefully for unknown transformId", () => {
  const engine = new MigrationEngine();
  const result = engine.rollback("mig_nonexistent");

  assert.equal(result.success, false);
  assert.equal(result.restored, 0);
  assert.ok(result.errors.length > 0);
});

test("rollback: fails for dry-run entries", () => {
  const dir = createTempDir();
  writeTempFile(dir, "test.js", "content");

  const engine = new MigrationEngine({ cwd: dir });
  engine.defineTransform("addHeader", addHeaderTransform);

  const result = engine.apply("test.js", "addHeader", { dryRun: true });
  const rbResult = engine.rollback(result.transformId);

  assert.equal(rbResult.success, false);
  assert.ok(rbResult.errors.some((e) => e.includes("dry-run")));

  cleanupDir(dir);
});

test("getHistory: records application entries", () => {
  const dir = createTempDir();
  writeTempFile(dir, "a.js", "content");

  const engine = new MigrationEngine({ cwd: dir });
  engine.defineTransform("addHeader", addHeaderTransform);

  engine.apply("a.js", "addHeader", { dryRun: true });
  engine.apply("a.js", "addHeader", { dryRun: false });

  const history = engine.getHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].transformName, "addHeader");
  assert.equal(history[1].transformName, "addHeader");
  assert.equal(history[0].dryRun, true);
  assert.equal(history[1].dryRun, false);
  assert.ok(history[0].timestamp < history[1].timestamp || history[0].timestamp === history[1].timestamp);

  cleanupDir(dir);
});

test("getHistory: supports filter by transformName", () => {
  const dir = createTempDir();
  writeTempFile(dir, "a.js", "content");

  const engine = new MigrationEngine({ cwd: dir });
  engine.defineTransform("addHeader", addHeaderTransform);
  engine.defineTransform("upper", upperTransform);

  engine.apply("a.js", "addHeader", { dryRun: true });
  engine.apply("a.js", "upper", { dryRun: true });

  const headerHistory = engine.getHistory({ transformName: "addHeader" });
  assert.equal(headerHistory.length, 1);
  assert.equal(headerHistory[0].transformName, "addHeader");

  const nonExistent = engine.getHistory({ transformName: "nonexistent" });
  assert.equal(nonExistent.length, 0);

  cleanupDir(dir);
});

test("getHistory: supports limit option", () => {
  const dir = createTempDir();
  writeTempFile(dir, "a.js", "content");

  const engine = new MigrationEngine({ cwd: dir });
  engine.defineTransform("addHeader", addHeaderTransform);

  for (let i = 0; i < 5; i++) {
    engine.apply("a.js", "addHeader", { dryRun: true });
  }

  const limited = engine.getHistory({ limit: 3 });
  assert.equal(limited.length, 3);

  // Should return the most recent entries
  const full = engine.getHistory();
  assert.equal(full.length, 5);

  cleanupDir(dir);
});

test("clearHistory: removes all history and backups", () => {
  const dir = createTempDir();
  writeTempFile(dir, "a.js", "content");

  const engine = new MigrationEngine({ cwd: dir });
  engine.defineTransform("addHeader", addHeaderTransform);

  engine.apply("a.js", "addHeader", { dryRun: false, backup: true });
  assert.equal(engine.getHistory().length, 1);

  engine.clearHistory();
  assert.equal(engine.getHistory().length, 0);

  cleanupDir(dir);
});

test("apply: handles empty file list", () => {
  const engine = new MigrationEngine();
  engine.defineTransform("addHeader", addHeaderTransform);

  const result = engine.apply([], "addHeader");

  assert.equal(result.transformId, null);
  assert.deepEqual(result.results, []);
  assert.deepEqual(result.summary, { total: 0, changed: 0, unchanged: 0, errors: 0 });
});

test("apply: throws for unregistered transform name", () => {
  const engine = new MigrationEngine();
  assert.throws(() => engine.apply("test.js", "nonexistent"), Error);
});
