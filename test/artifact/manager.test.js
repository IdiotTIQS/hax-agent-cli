/**
 * Tests for ArtifactManager — artifact CRUD, local and directory backends,
 * auto-versioning, filtering, checksumming.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ArtifactManager } = require("../../src/artifact/manager");

// ---------------------------------------------------------------------------
// Local backend
// ---------------------------------------------------------------------------

test("create: produces a valid artifact object with defaults", () => {
  const mgr = new ArtifactManager({ backend: "local" });
  const art = mgr.create("my-report", [], { type: "report" });

  assert.equal(art.name, "my-report");
  assert.equal(art.type, "report");
  assert.equal(art.version, "0.0.1");
  assert.ok(Array.isArray(art.files));
  assert.equal(typeof art.createdAt, "string");
  assert.ok(art.createdAt.endsWith("Z") || art.createdAt.includes("T"));
  assert.deepEqual(art.metadata, {});
  assert.deepEqual(art.checksums, {});
});

test("create: computes checksums for real files", () => {
  const mgr = new ArtifactManager({ backend: "local" });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-art-"));
  const filePath = path.join(tmpDir, "data.txt");
  fs.writeFileSync(filePath, "hello world", "utf8");

  const art = mgr.create("test-artifact", [filePath], { type: "export" });

  assert.equal(Object.keys(art.checksums).length, 1);
  const cs = art.checksums["data.txt"];
  assert.ok(cs && cs.length === 64);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("create: marks MISSING for nonexistent files in checksums", () => {
  const mgr = new ArtifactManager({ backend: "local" });
  const art = mgr.create("test", ["/nonexistent/path/file.xyz"], {
    type: "export",
  });

  assert.equal(art.checksums["file.xyz"], "MISSING");
});

test("publish and download: round-trip an artifact", () => {
  const mgr = new ArtifactManager({ backend: "local" });
  const art = mgr.create("my-lib", [], {
    version: "1.0.0",
    type: "plugin",
  });

  mgr.publish(art);
  const retrieved = mgr.download("my-lib", "1.0.0");

  assert.ok(retrieved !== null);
  assert.equal(retrieved.name, "my-lib");
  assert.equal(retrieved.version, "1.0.0");
  assert.equal(retrieved.type, "plugin");
});

test("download: returns null for nonexistent artifact", () => {
  const mgr = new ArtifactManager({ backend: "local" });
  const result = mgr.download("does-not-exist", "9.9.9");
  assert.equal(result, null);
});

test("list: returns all artifacts and supports filters", () => {
  const mgr = new ArtifactManager({ backend: "local" });

  mgr.publish(mgr.create("alpha", [], { version: "1.0.0", type: "report" }));
  mgr.publish(mgr.create("alpha", [], { version: "2.0.0", type: "report" }));
  mgr.publish(mgr.create("beta", [], { version: "1.0.0", type: "plugin" }));

  assert.equal(mgr.list().length, 3);
  assert.equal(mgr.list({ name: "alpha" }).length, 2);
  assert.equal(mgr.list({ type: "plugin" }).length, 1);
  assert.equal(mgr.list({ type: "plugin" })[0].name, "beta");
  assert.equal(mgr.list({ limit: 1 }).length, 1);
});

test("delete: removes an artifact and returns correct boolean", () => {
  const mgr = new ArtifactManager({ backend: "local" });

  mgr.publish(mgr.create("temp", [], { version: "1.0.0" }));
  assert.equal(mgr.exists("temp", "1.0.0"), true);

  const deleted = mgr.delete("temp", "1.0.0");
  assert.equal(deleted, true);
  assert.equal(mgr.exists("temp", "1.0.0"), false);
  assert.equal(mgr.delete("temp", "1.0.0"), false);
});

test("auto-versioning: increments patch for subsequent artifacts", () => {
  const mgr = new ArtifactManager({ backend: "local" });

  const a1 = mgr.create("pkg", []);
  assert.equal(a1.version, "0.0.1");
  mgr.publish(a1);

  const a2 = mgr.create("pkg", []);
  assert.equal(a2.version, "0.0.2");
  mgr.publish(a2);

  const a3 = mgr.create("pkg", []);
  assert.equal(a3.version, "0.0.3");
});

// ---------------------------------------------------------------------------
// Directory backend
// ---------------------------------------------------------------------------

test("directory backend: persists and retrieves artifacts on disk", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-artdir-"));
  const mgr = new ArtifactManager({ backend: "directory", basePath: tmpDir });

  // Create a real file to include
  const srcFile = path.join(tmpDir, "src.txt");
  fs.writeFileSync(srcFile, "artifact content", "utf8");

  const art = mgr.create("disk-pkg", [srcFile], {
    version: "2.0.0",
    type: "bundle",
    metadata: { author: "test" },
  });
  mgr.publish(art);

  const retrieved = mgr.download("disk-pkg", "2.0.0");
  assert.ok(retrieved !== null);
  assert.equal(retrieved.name, "disk-pkg");
  assert.equal(retrieved.version, "2.0.0");
  assert.equal(retrieved.type, "bundle");
  assert.equal(retrieved.metadata.author, "test");
  assert.ok(retrieved.files.length >= 1);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("directory backend: list returns persisted artifacts", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-artlist-"));
  const mgr = new ArtifactManager({ backend: "directory", basePath: tmpDir });

  mgr.publish(mgr.create("a", [], { version: "1.0.0", type: "report" }));
  mgr.publish(mgr.create("b", [], { version: "1.0.0", type: "export" }));

  const all = mgr.list();
  assert.equal(all.length, 2);

  const reports = mgr.list({ type: "report" });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].name, "a");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("directory backend: delete removes on-disk artifact", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-artdel-"));
  const mgr = new ArtifactManager({ backend: "directory", basePath: tmpDir });

  mgr.publish(mgr.create("delme", [], { version: "1.0.0" }));
  assert.equal(mgr.exists("delme", "1.0.0"), true);

  mgr.delete("delme", "1.0.0");
  assert.equal(mgr.exists("delme", "1.0.0"), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("directory backend: nonexistent basePath is created automatically", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-artauto-"));
  const deepDir = path.join(tmpDir, "deeply", "nested", "artifacts");

  const mgr = new ArtifactManager({ backend: "directory", basePath: deepDir });
  mgr.publish(mgr.create("auto-test", [], { version: "1.0.0" }));

  const retrieved = mgr.download("auto-test", "1.0.0");
  assert.ok(retrieved !== null);
  assert.equal(retrieved.name, "auto-test");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("validation: create throws for missing name", () => {
  const mgr = new ArtifactManager({ backend: "local" });
  assert.throws(
    () => mgr.create("", []),
    /name is required/
  );
  assert.throws(
    () => mgr.create(null, []),
    /name is required/
  );
});

test("validation: publish throws for invalid artifact", () => {
  const mgr = new ArtifactManager({ backend: "local" });
  assert.throws(
    () => mgr.publish({}),
    /must have name and version/
  );
  assert.throws(
    () => mgr.publish({ name: "x" }),
    /must have name and version/
  );
});

test("validation: download throws for missing name or version", () => {
  const mgr = new ArtifactManager({ backend: "local" });
  assert.throws(
    () => mgr.download(),
    /requires name and version/
  );
  assert.throws(
    () => mgr.download("x"),
    /requires name and version/
  );
});
