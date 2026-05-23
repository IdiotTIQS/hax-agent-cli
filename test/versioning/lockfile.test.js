/**
 * Tests for Lockfile: load, save, addDependency, resolve, diff, validate.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { Lockfile } = require("../../src/versioning/lockfile");

// ---------------------------------------------------------------------------
// Construction / addDependency / resolve
// ---------------------------------------------------------------------------

test("Lockfile: constructor initializes empty", () => {
  const lock = new Lockfile();
  assert.equal(lock.version, 1);
  assert.equal(lock.size, 0);
  assert.deepEqual(lock.getNames(), []);
});

test("Lockfile: addDependency records a dependency", () => {
  const lock = new Lockfile();
  lock.addDependency("plugin-auth", "1.2.3", {
    resolved: "https://registry.example.com/plugin-auth-1.2.3.tgz",
    integrity: "sha512-abcdef1234567890",
  });

  assert.equal(lock.size, 1);
  assert.equal(lock.hasDependency("plugin-auth"), true);

  const resolved = lock.resolve("plugin-auth");
  assert.deepEqual(resolved, {
    version: "1.2.3",
    resolved: "https://registry.example.com/plugin-auth-1.2.3.tgz",
    integrity: "sha512-abcdef1234567890",
  });
});

test("Lockfile: addDependency updates existing dependency", () => {
  const lock = new Lockfile();
  lock.addDependency("plugin-auth", "1.0.0");
  lock.addDependency("plugin-auth", "1.1.0");

  assert.equal(lock.size, 1);
  assert.equal(lock.resolve("plugin-auth").version, "1.1.0");
});

test("Lockfile: addDependency throws for empty name", () => {
  const lock = new Lockfile();
  assert.throws(() => lock.addDependency("", "1.0.0"), {
    message: /must be a non-empty string/,
  });
  assert.throws(() => lock.addDependency("  ", "1.0.0"), {
    message: /must be a non-empty string/,
  });
});

test("Lockfile: addDependency throws for empty version", () => {
  const lock = new Lockfile();
  assert.throws(() => lock.addDependency("plugin", ""), {
    message: /must be a non-empty string/,
  });
});

test("Lockfile: addDependency handles missing optional metadata", () => {
  const lock = new Lockfile();
  lock.addDependency("plugin-auth", "1.0.0");

  const resolved = lock.resolve("plugin-auth");
  assert.equal(resolved.version, "1.0.0");
  assert.equal(resolved.resolved, null);
  assert.equal(resolved.integrity, null);
});

test("Lockfile: addDependency returns this for chaining", () => {
  const lock = new Lockfile();
  const result = lock.addDependency("a", "1.0.0").addDependency("b", "2.0.0");
  assert.equal(result, lock);
  assert.equal(lock.size, 2);
});

// ---------------------------------------------------------------------------
// resolve / hasDependency / removeDependency
// ---------------------------------------------------------------------------

test("Lockfile: resolve returns null for unknown dependency", () => {
  const lock = new Lockfile();
  assert.equal(lock.resolve("nonexistent"), null);
});

test("Lockfile: hasDependency returns true/false", () => {
  const lock = new Lockfile();
  assert.equal(lock.hasDependency("plugin-auth"), false);

  lock.addDependency("plugin-auth", "1.0.0");
  assert.equal(lock.hasDependency("plugin-auth"), true);
});

test("Lockfile: removeDependency deletes and returns boolean", () => {
  const lock = new Lockfile();
  lock.addDependency("plugin-auth", "1.0.0");

  assert.equal(lock.removeDependency("plugin-auth"), true);
  assert.equal(lock.size, 0);
  assert.equal(lock.hasDependency("plugin-auth"), false);
  assert.equal(lock.removeDependency("nonexistent"), false);
});

// ---------------------------------------------------------------------------
// save / load
// ---------------------------------------------------------------------------

test("Lockfile: save writes valid JSON to disk", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-lockfile-"));
  const lockPath = path.join(tmpDir, "hax-lock.json");

  const lock = new Lockfile();
  lock.addDependency("plugin-auth", "1.2.3", {
    resolved: "https://example.com/pkg.tgz",
    integrity: "sha512-abcdef",
    dependencies: { lodash: "^4.0.0" },
  });
  lock.save(lockPath);

  const raw = fs.readFileSync(lockPath, "utf8");
  const parsed = JSON.parse(raw);

  assert.equal(parsed.version, 1);
  assert.equal(parsed.lockfileVersion, 1);
  assert.ok(parsed.dependencies);
  assert.equal(parsed.dependencies["plugin-auth"].version, "1.2.3");
  assert.equal(parsed.dependencies["plugin-auth"].resolved, "https://example.com/pkg.tgz");
  assert.equal(parsed.dependencies["plugin-auth"].integrity, "sha512-abcdef");
  assert.deepEqual(parsed.dependencies["plugin-auth"].dependencies, { lodash: "^4.0.0" });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Lockfile: save throws when no path is provided and no loaded path", () => {
  const lock = new Lockfile();
  assert.throws(() => lock.save(), {
    message: /No path specified/,
  });
});

test("Lockfile: load reads and populates from JSON file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-lockfile-"));
  const lockPath = path.join(tmpDir, "hax-lock.json");

  const data = {
    version: 1,
    dependencies: {
      "plugin-auth": {
        version: "1.2.3",
        resolved: "https://example.com/pkg.tgz",
        integrity: "sha512-test",
      },
      "plugin-storage": {
        version: "0.5.0",
      },
    },
  };
  fs.writeFileSync(lockPath, JSON.stringify(data), "utf8");

  const lock = new Lockfile();
  lock.load(lockPath);

  assert.equal(lock.size, 2);
  assert.equal(lock.resolve("plugin-auth").version, "1.2.3");
  assert.equal(lock.resolve("plugin-auth").resolved, "https://example.com/pkg.tgz");
  assert.equal(lock.resolve("plugin-storage").version, "0.5.0");
  assert.equal(lock.resolve("plugin-storage").resolved, null);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Lockfile: load throws for nonexistent file", () => {
  const lock = new Lockfile();
  assert.throws(() => lock.load("/nonexistent/path/lock.json"), {
    message: /Lockfile not found/,
  });
});

test("Lockfile: load throws for invalid JSON", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-lockfile-"));
  const lockPath = path.join(tmpDir, "bad.json");
  fs.writeFileSync(lockPath, "this is not json", "utf8");

  const lock = new Lockfile();
  assert.throws(() => lock.load(lockPath), {
    message: /Failed to parse lockfile/,
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Lockfile: load handles empty dependencies gracefully", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-lockfile-"));
  const lockPath = path.join(tmpDir, "empty.json");
  fs.writeFileSync(lockPath, JSON.stringify({ version: 1 }), "utf8");

  const lock = new Lockfile();
  lock.load(lockPath);

  assert.equal(lock.size, 0);
  assert.deepEqual(lock.getNames(), []);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Lockfile: save uses loaded path when no path argument given", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-lockfile-"));
  const lockPath = path.join(tmpDir, "hax-lock.json");

  // First save creates the file
  const lock = new Lockfile();
  lock.addDependency("p1", "1.0.0");
  lock.save(lockPath);

  // Load it
  const lock2 = new Lockfile();
  lock2.load(lockPath);
  lock2.addDependency("p2", "2.0.0");
  lock2.save(); // Should save back to the same path

  const reloaded = new Lockfile().load(lockPath);
  assert.equal(reloaded.size, 2);
  assert.equal(reloaded.resolve("p1").version, "1.0.0");
  assert.equal(reloaded.resolve("p2").version, "2.0.0");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// static diff
// ---------------------------------------------------------------------------

test("Lockfile.diff: detects added dependencies", () => {
  const old = new Lockfile();
  old.addDependency("p1", "1.0.0");

  const current = new Lockfile();
  current.addDependency("p1", "1.0.0");
  current.addDependency("p2", "2.0.0");

  const result = Lockfile.diff(old, current);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].name, "p2");
  assert.equal(result.removed.length, 0);
  assert.equal(result.updated.length, 0);
  assert.equal(result.unchanged.length, 1);
});

test("Lockfile.diff: detects removed dependencies", () => {
  const old = new Lockfile();
  old.addDependency("p1", "1.0.0");
  old.addDependency("p2", "2.0.0");

  const current = new Lockfile();
  current.addDependency("p1", "1.0.0");

  const result = Lockfile.diff(old, current);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].name, "p2");
  assert.equal(result.added.length, 0);
});

test("Lockfile.diff: detects updated dependencies", () => {
  const old = new Lockfile();
  old.addDependency("p1", "1.0.0");

  const current = new Lockfile();
  current.addDependency("p1", "1.1.0");

  const result = Lockfile.diff(old, current);
  assert.equal(result.updated.length, 1);
  assert.equal(result.updated[0].name, "p1");
  assert.equal(result.updated[0].oldVersion, "1.0.0");
  assert.equal(result.updated[0].newVersion, "1.1.0");
});

test("Lockfile.diff: detects unchanged dependencies", () => {
  const old = new Lockfile();
  old.addDependency("p1", "1.0.0");
  old.addDependency("p2", "2.0.0");

  const current = new Lockfile();
  current.addDependency("p1", "1.0.0");
  current.addDependency("p2", "2.0.0");

  const result = Lockfile.diff(old, current);
  assert.equal(result.added.length, 0);
  assert.equal(result.removed.length, 0);
  assert.equal(result.updated.length, 0);
  assert.equal(result.unchanged.length, 2);
});

test("Lockfile.diff: handles raw objects", () => {
  const old = { dependencies: { p1: { version: "1.0.0" } } };
  const current = { dependencies: { p1: { version: "1.1.0" }, p2: { version: "2.0.0" } } };

  const result = Lockfile.diff(old, current);
  assert.equal(result.added.length, 1);
  assert.equal(result.updated.length, 1);
  assert.equal(result.removed.length, 0);
});

// ---------------------------------------------------------------------------
// static validate
// ---------------------------------------------------------------------------

test("Lockfile.validate: returns valid for a proper lockfile", () => {
  const lock = new Lockfile();
  lock.addDependency("p1", "1.0.0", {
    resolved: "https://example.com/pkg.tgz",
    integrity: "sha512-abcdef",
  });

  const result = Lockfile.validate(lock);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("Lockfile.validate: rejects null/undefined", () => {
  const result = Lockfile.validate(null);
  assert.equal(result.valid, false);
  assert.ok(result.errors[0].includes("null or undefined"));
});

test("Lockfile.validate: detects missing version", () => {
  const data = {
    dependencies: {
      "bad-plugin": { resolved: "https://example.com" },
    },
  };

  const result = Lockfile.validate(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("missing or invalid version")));
});

test("Lockfile.validate: detects invalid integrity format", () => {
  const data = {
    dependencies: {
      p1: { version: "1.0.0", integrity: "not-a-valid-hash" },
    },
  };

  const result = Lockfile.validate(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("unsupported format")));
});

test("Lockfile.validate: accepts sha256, sha384, sha512, md5 formats", () => {
  const formats = ["sha256-abc", "sha384-def", "sha512-ghi", "md5-jkl"];
  for (const fmt of formats) {
    const data = { dependencies: { p1: { version: "1.0.0", integrity: fmt } } };
    const result = Lockfile.validate(data);
    assert.equal(result.valid, true, `Should accept ${fmt}`);
  }
});

// ---------------------------------------------------------------------------
// generateIntegrity
// ---------------------------------------------------------------------------

test("Lockfile.generateIntegrity: generates a valid hash string", () => {
  const hash = Lockfile.generateIntegrity("hello world");
  assert.ok(hash.startsWith("sha512-"));
  assert.ok(hash.length > 16);

  const hash256 = Lockfile.generateIntegrity("hello world", "sha256");
  assert.ok(hash256.startsWith("sha256-"));
});

// ---------------------------------------------------------------------------
// toObject / clear
// ---------------------------------------------------------------------------

test("Lockfile: toObject returns plain object representation", () => {
  const lock = new Lockfile();
  lock.addDependency("p1", "1.0.0", { resolved: "https://example.com" });
  lock.addDependency("p2", "2.0.0");

  const obj = lock.toObject();
  assert.deepEqual(Object.keys(obj), ["p1", "p2"]);
  assert.equal(obj.p1.version, "1.0.0");
  assert.equal(obj.p1.resolved, "https://example.com");
  assert.equal(obj.p2.version, "2.0.0");
});

test("Lockfile: clear empties all dependencies", () => {
  const lock = new Lockfile();
  lock.addDependency("p1", "1.0.0");
  lock.addDependency("p2", "2.0.0");

  lock.clear();
  assert.equal(lock.size, 0);
  assert.deepEqual(lock.getNames(), []);
});
