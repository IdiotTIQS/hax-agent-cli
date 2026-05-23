/**
 * Tests for data/migration: MigrationRegistry, detectVersion, needsMigration,
 * runMigrations, migrateV1toV2.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MigrationRegistry,
  detectVersion,
  writeVersion,
  needsMigration,
  runMigrations,
  migrateV1toV2,
  createDefaultRegistry,
  normalizeVersion,
  compareVersions,
  VERSION_FILE,
} = require("../../src/data/migration");

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ───────────────────────────────────────────────────────────────────────────
// MigrationRegistry
// ───────────────────────────────────────────────────────────────────────────

test("MigrationRegistry: register and get migrations", () => {
  const registry = new MigrationRegistry();

  registry.register("2", () => {}, { description: "Migrate to v2" });
  registry.register("3", () => {}, { description: "Migrate to v3" });

  assert.equal(registry.size, 2);

  const m2 = registry.get("2");
  assert.ok(m2);
  assert.equal(m2.version, "2.0.0");
  assert.equal(m2.description, "Migrate to v2");

  const m3 = registry.get("3");
  assert.equal(m3.version, "3.0.0");
});

test("MigrationRegistry: list returns sorted migrations", () => {
  const registry = new MigrationRegistry();
  registry.register("3", () => {});
  registry.register("1", () => {});
  registry.register("2.5", () => {});
  registry.register("10", () => {});

  const list = registry.list();
  assert.equal(list.length, 4);
  assert.equal(list[0].version, "1.0.0");
  assert.equal(list[1].version, "2.5.0");
  assert.equal(list[2].version, "3.0.0");
  assert.equal(list[3].version, "10.0.0");
});

test("MigrationRegistry: getPending returns only newer versions", () => {
  const registry = new MigrationRegistry();
  registry.register("1", () => {});
  registry.register("2", () => {});
  registry.register("3", () => {});
  registry.register("4", () => {});

  const pending = registry.getPending("2.0.0");
  assert.equal(pending.length, 2);
  assert.equal(pending[0].version, "3.0.0");
  assert.equal(pending[1].version, "4.0.0");
});

test("MigrationRegistry: unregister removes by version", () => {
  const registry = new MigrationRegistry();
  registry.register("2", () => {});
  assert.equal(registry.size, 1);

  assert.equal(registry.unregister("2"), true);
  assert.equal(registry.size, 0);
  assert.equal(registry.get("2"), null);
});

test("MigrationRegistry: clear removes all", () => {
  const registry = new MigrationRegistry();
  registry.register("2", () => {});
  registry.register("3", () => {});
  registry.clear();
  assert.equal(registry.size, 0);
});

test("MigrationRegistry: throws for invalid version or function", () => {
  const registry = new MigrationRegistry();
  assert.throws(() => registry.register("", () => {}), { message: /non-empty string/ });
  assert.throws(() => registry.register("2", null), { message: /must be a function/ });
  assert.throws(() => registry.register("2", "not-a-fn"), { message: /must be a function/ });
});

// ───────────────────────────────────────────────────────────────────────────
// detectVersion
// ───────────────────────────────────────────────────────────────────────────

test("detectVersion: returns '1' for legacy project (no version file)", () => {
  const projectDir = createTempDir("hax-dv-");
  try {
    const haxDir = path.join(projectDir, ".hax-agent");
    fs.mkdirSync(haxDir, { recursive: true });
    // No .hax-version file

    const version = detectVersion(projectDir);
    assert.equal(version, "1");
  } finally {
    cleanup(projectDir);
  }
});

test("detectVersion: reads version from .hax-version file", () => {
  const projectDir = createTempDir("hax-dv2-");
  try {
    const haxDir = path.join(projectDir, ".hax-agent");
    fs.mkdirSync(haxDir, { recursive: true });
    fs.writeFileSync(
      path.join(haxDir, VERSION_FILE),
      JSON.stringify({ version: "2", updatedAt: new Date().toISOString() }),
      "utf8"
    );

    const version = detectVersion(projectDir);
    assert.equal(version, "2");
  } finally {
    cleanup(projectDir);
  }
});

test("detectVersion: falls back to v1 on corrupt version file", () => {
  const projectDir = createTempDir("hax-dv3-");
  try {
    const haxDir = path.join(projectDir, ".hax-agent");
    fs.mkdirSync(haxDir, { recursive: true });
    fs.writeFileSync(path.join(haxDir, VERSION_FILE), "{not-valid-json", "utf8");

    const version = detectVersion(projectDir);
    assert.equal(version, "1");
  } finally {
    cleanup(projectDir);
  }
});

test("detectVersion: detects v2 from data/version.json marker", () => {
  const projectDir = createTempDir("hax-dv4-");
  try {
    const dataDir = path.join(projectDir, ".hax-agent", "data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "version.json"),
      JSON.stringify({ version: "2" }),
      "utf8"
    );

    const version = detectVersion(projectDir);
    assert.equal(version, "2");
  } finally {
    cleanup(projectDir);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// writeVersion
// ───────────────────────────────────────────────────────────────────────────

test("writeVersion: writes .hax-version file", () => {
  const projectDir = createTempDir("hax-wv-");
  try {
    writeVersion(projectDir, "3");

    const versionFile = path.join(projectDir, ".hax-agent", VERSION_FILE);
    assert.ok(fs.existsSync(versionFile));

    const data = JSON.parse(fs.readFileSync(versionFile, "utf8"));
    assert.equal(data.version, "3");
    assert.ok(data.updatedAt);
  } finally {
    cleanup(projectDir);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// needsMigration
// ───────────────────────────────────────────────────────────────────────────

test("needsMigration: returns true when pending migrations exist", () => {
  const projectDir = createTempDir("hax-nm-");
  try {
    // No version file → defaults to v1
    const haxDir = path.join(projectDir, ".hax-agent");
    fs.mkdirSync(haxDir, { recursive: true });

    const registry = new MigrationRegistry();
    registry.register("2", () => {});

    assert.equal(needsMigration(projectDir, registry), true);
  } finally {
    cleanup(projectDir);
  }
});

test("needsMigration: returns false when up to date", () => {
  const projectDir = createTempDir("hax-nm2-");
  try {
    const haxDir = path.join(projectDir, ".hax-agent");
    fs.mkdirSync(haxDir, { recursive: true });
    fs.writeFileSync(
      path.join(haxDir, VERSION_FILE),
      JSON.stringify({ version: "2" }),
      "utf8"
    );

    const registry = new MigrationRegistry();
    registry.register("2", () => {});

    assert.equal(needsMigration(projectDir, registry), false);
  } finally {
    cleanup(projectDir);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// runMigrations
// ───────────────────────────────────────────────────────────────────────────

test("runMigrations: runs pending migrations and updates version", () => {
  const projectDir = createTempDir("hax-rm-");
  try {
    const haxDir = path.join(projectDir, ".hax-agent");
    const oldMemDir = path.join(haxDir, "memory");
    fs.mkdirSync(oldMemDir, { recursive: true });
    fs.writeFileSync(path.join(oldMemDir, "test.json"), '{"key":"val"}', "utf8");

    const oldSessDir = path.join(haxDir, "sessions");
    fs.mkdirSync(oldSessDir, { recursive: true });
    fs.writeFileSync(path.join(oldSessDir, "sess.jsonl"), '{"role":"user"}\n', "utf8");

    const registry = new MigrationRegistry();
    registry.register("2", migrateV1toV2, {
      description: "Move to data/ subdirectories",
      requiresBackup: false, // Skip backup in test for speed
    });

    const result = runMigrations(projectDir, registry);

    assert.equal(result.migrated.length, 1);
    assert.equal(result.migrated[0], "2.0.0");
    assert.equal(result.errors.length, 0);

    // Verify migration happened
    const dataDir = path.join(haxDir, "data");
    assert.ok(fs.existsSync(dataDir));
    assert.ok(fs.existsSync(path.join(dataDir, "memory", "test.json")));
    assert.ok(fs.existsSync(path.join(dataDir, "sessions", "sess.jsonl")));
    assert.ok(fs.existsSync(path.join(dataDir, "version.json")));

    // Version file should be updated
    const version = detectVersion(projectDir);
    assert.equal(version, "2.0.0");
  } finally {
    cleanup(projectDir);
  }
});

test("runMigrations: dryRun does not execute", () => {
  const projectDir = createTempDir("hax-rm-dry-");
  try {
    const haxDir = path.join(projectDir, ".hax-agent");
    fs.mkdirSync(haxDir, { recursive: true });

    const registry = new MigrationRegistry();
    let wasCalled = false;
    registry.register("2", () => { wasCalled = true; }, { requiresBackup: false });

    const result = runMigrations(projectDir, registry, { dryRun: true });

    assert.equal(result.dryRun, true);
    assert.equal(wasCalled, false);
    assert.equal(result.migrated.length, 1); // Still reports as "migrated"
  } finally {
    cleanup(projectDir);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// migrateV1toV2
// ───────────────────────────────────────────────────────────────────────────

test("migrateV1toV2: moves memory and sessions to data/ subdirectory", () => {
  const projectDir = createTempDir("hax-mv1-");
  try {
    const haxDir = path.join(projectDir, ".hax-agent");
    const oldMemDir = path.join(haxDir, "memory", "ns1");
    const oldSessDir = path.join(haxDir, "sessions");

    fs.mkdirSync(oldMemDir, { recursive: true });
    fs.mkdirSync(oldSessDir, { recursive: true });
    fs.writeFileSync(path.join(oldMemDir, "mem.json"), '{"name":"t"}', "utf8");
    fs.writeFileSync(path.join(oldSessDir, "sess.jsonl"), '{"role":"u"}\n', "utf8");

    migrateV1toV2(projectDir);

    // Old paths should be gone
    assert.ok(!fs.existsSync(oldMemDir));
    assert.ok(!fs.existsSync(oldSessDir));

    // New paths should exist
    assert.ok(fs.existsSync(path.join(haxDir, "data", "memory", "ns1", "mem.json")));
    assert.ok(fs.existsSync(path.join(haxDir, "data", "sessions", "sess.jsonl")));

    // Version marker should exist
    const versionData = JSON.parse(
      fs.readFileSync(path.join(haxDir, "data", "version.json"), "utf8")
    );
    assert.equal(versionData.version, "2");
  } finally {
    cleanup(projectDir);
  }
});

test("migrateV1toV2: dryRun does not modify files", () => {
  const projectDir = createTempDir("hax-mv1-dry-");
  try {
    const haxDir = path.join(projectDir, ".hax-agent");
    const oldMemDir = path.join(haxDir, "memory");
    fs.mkdirSync(oldMemDir, { recursive: true });
    fs.writeFileSync(path.join(oldMemDir, "mem.json"), '{"name":"t"}', "utf8");

    migrateV1toV2(projectDir, { dryRun: true });

    // Should still exist (not moved)
    assert.ok(fs.existsSync(path.join(oldMemDir, "mem.json")));
    // data dir should NOT exist
    assert.ok(!fs.existsSync(path.join(haxDir, "data")));
  } finally {
    cleanup(projectDir);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// normalizeVersion / compareVersions
// ───────────────────────────────────────────────────────────────────────────

test("normalizeVersion: normalizes various formats", () => {
  assert.equal(normalizeVersion("2"), "2.0.0");
  assert.equal(normalizeVersion("2.0"), "2.0.0");
  assert.equal(normalizeVersion("2.0.0"), "2.0.0");
  assert.equal(normalizeVersion("v2"), "2.0.0");
  assert.equal(normalizeVersion("V3.1"), "3.1.0");
  assert.equal(normalizeVersion(""), "0.0.0");
});

test("compareVersions: compares correctly", () => {
  assert.ok(compareVersions("2.0.0", "1.0.0") > 0);
  assert.ok(compareVersions("1.0.0", "2.0.0") < 0);
  assert.equal(compareVersions("2.0.0", "2.0.0"), 0);
  assert.ok(compareVersions("2.1.0", "2.0.0") > 0);
  assert.ok(compareVersions("2.0.1", "2.0.0") > 0);
  assert.ok(compareVersions("10.0.0", "2.0.0") > 0);
});

// ───────────────────────────────────────────────────────────────────────────
// createDefaultRegistry
// ───────────────────────────────────────────────────────────────────────────

test("createDefaultRegistry: includes v2 migration", () => {
  const registry = createDefaultRegistry();
  assert.ok(registry.size >= 1);
  const m2 = registry.get("2");
  assert.ok(m2);
  assert.equal(m2.version, "2.0.0");
  assert.ok(m2.description.length > 0);
});
