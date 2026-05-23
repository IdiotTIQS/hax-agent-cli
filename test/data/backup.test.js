/**
 * Tests for data/backup: createBackup, listBackups, restoreBackup,
 * rotateBackups, createSnapshot.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createBackup,
  listBackups,
  restoreBackup,
  restoreFromBackupDir,
  rotateBackups,
  createSnapshot,
  computeChecksum,
} = require("../../src/data/backup");

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
    // ignore cleanup errors
  }
}

function createFixtureFiles(baseDir, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(baseDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
  }
}

// ───────────────────────────────────────────────────────────────────────────
// createBackup
// ───────────────────────────────────────────────────────────────────────────

test("createBackup: creates a backup with manifest", () => {
  const sourceDir = createTempDir("hax-bk-src-");
  const backupDir = createTempDir("hax-bk-dest-");

  try {
    createFixtureFiles(sourceDir, {
      "config.json": '{"name":"test"}',
      "data/memory.json": '{"key":"val"}',
      "data/log.txt": "log line\n",
    });

    const result = createBackup(sourceDir, backupDir, { label: "test-backup" });

    assert.ok(result.id.startsWith("backup-"));
    assert.ok(fs.existsSync(result.path));
    assert.equal(result.fileCount, 3);

    // Manifest exists
    const manifestPath = path.join(result.path, "manifest.json");
    assert.ok(fs.existsSync(manifestPath));

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.label, "test-backup");
    assert.equal(manifest.fileCount, 3);
    assert.equal(Object.keys(manifest.checksums).length, 3);

    // Files are copied
    assert.ok(fs.existsSync(path.join(result.path, "config.json")));
    assert.ok(fs.existsSync(path.join(result.path, "data", "memory.json")));
  } finally {
    cleanup(sourceDir);
    cleanup(backupDir);
  }
});

test("createBackup: throws for non-existent source directory", () => {
  assert.throws(
    () => createBackup("/nonexistent/path/12345", "/tmp/backups"),
    { message: /Source directory does not exist/ }
  );
});

test("createBackup: respects exclude filter", () => {
  const sourceDir = createTempDir("hax-bk-exc-");
  const backupDir = createTempDir("hax-bk-exc-d-");

  try {
    createFixtureFiles(sourceDir, {
      "include.txt": "keep me",
      "exclude.log": "skip me",
      "sub/include.txt": "keep too",
    });

    const result = createBackup(sourceDir, backupDir, { exclude: /\.log$/ });
    assert.equal(result.fileCount, 2);
    // exclude.log should not be in the manifest
    const manifest = JSON.parse(
      fs.readFileSync(path.join(result.path, "manifest.json"), "utf8")
    );
    const logFiles = manifest.files.filter((f) => f.endsWith(".log"));
    assert.equal(logFiles.length, 0);
  } finally {
    cleanup(sourceDir);
    cleanup(backupDir);
  }
});

test("createBackup: respects include filter", () => {
  const sourceDir = createTempDir("hax-bk-inc-");
  const backupDir = createTempDir("hax-bk-inc-d-");

  try {
    createFixtureFiles(sourceDir, {
      "data.json": "{}",
      "readme.md": "# readme",
      "notes.txt": "notes",
    });

    const result = createBackup(sourceDir, backupDir, { include: /\.json$/ });
    assert.equal(result.fileCount, 1);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(result.path, "manifest.json"), "utf8")
    );
    assert.equal(manifest.files[0], "data.json");
  } finally {
    cleanup(sourceDir);
    cleanup(backupDir);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// listBackups
// ───────────────────────────────────────────────────────────────────────────

test("listBackups: returns empty array for non-existent dir", () => {
  const result = listBackups("/nonexistent/backup/dir");
  assert.deepEqual(result, []);
});

test("listBackups: returns backups sorted by timestamp (newest first)", () => {
  const backupDir = createTempDir("hax-bk-list-");

  try {
    // Create two mock backup dirs
    const b1 = path.join(backupDir, "backup-2025-01-01T00-00-00-000Z");
    const b2 = path.join(backupDir, "backup-2025-06-01T00-00-00-000Z");
    fs.mkdirSync(b1, { recursive: true });
    fs.mkdirSync(b2, { recursive: true });

    // Add manifests
    fs.writeFileSync(
      path.join(b1, "manifest.json"),
      JSON.stringify({ timestamp: "2025-01-01T00:00:00.000Z", fileCount: 5 }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(b2, "manifest.json"),
      JSON.stringify({ timestamp: "2025-06-01T00:00:00.000Z", fileCount: 10 }),
      "utf8"
    );

    const backups = listBackups(backupDir);
    assert.equal(backups.length, 2);
    // Newest first
    assert.ok(backups[0].timestamp > backups[1].timestamp);
    assert.equal(backups[0].fileCount, 10);
    assert.equal(backups[1].fileCount, 5);
  } finally {
    cleanup(backupDir);
  }
});

test("listBackups: handles corrupt manifest gracefully", () => {
  const backupDir = createTempDir("hax-bk-corr-");

  try {
    const b1 = path.join(backupDir, "backup-2025-01-01T00-00-00-000Z");
    fs.mkdirSync(b1, { recursive: true });
    // Corrupt manifest (not valid JSON)
    fs.writeFileSync(path.join(b1, "manifest.json"), "{not-json", "utf8");

    const backups = listBackups(backupDir);
    assert.equal(backups.length, 1);
    assert.equal(backups[0].fileCount, 0); // fallback
    assert.equal(backups[0].id, "backup-2025-01-01T00-00-00-000Z");
  } finally {
    cleanup(backupDir);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// restoreBackup
// ───────────────────────────────────────────────────────────────────────────

test("restoreBackup: restores files from backup path", () => {
  const sourceDir = createTempDir("hax-rst-src-");
  const backupDir = createTempDir("hax-rst-bk-");
  const targetDir = createTempDir("hax-rst-tgt-");

  try {
    createFixtureFiles(sourceDir, {
      "app.js": "console.log('hello');",
      "lib/utils.js": "module.exports = {};",
    });

    const backup = createBackup(sourceDir, backupDir);
    const result = restoreBackup(backup.path, targetDir);

    assert.equal(result.restored.length, 2);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.errors.length, 0);
    assert.ok(fs.existsSync(path.join(targetDir, "app.js")));
    assert.ok(fs.existsSync(path.join(targetDir, "lib", "utils.js")));
    assert.equal(
      fs.readFileSync(path.join(targetDir, "app.js"), "utf8"),
      "console.log('hello');"
    );
  } finally {
    cleanup(sourceDir);
    cleanup(backupDir);
    cleanup(targetDir);
  }
});

test("restoreBackup: throws for non-existent backup", () => {
  assert.throws(
    () => restoreBackup("/nonexistent/backup", "/tmp/target"),
    { message: /Backup directory not found/ }
  );
});

test("restoreBackup: skip strategy avoids overwriting existing files", () => {
  const sourceDir = createTempDir("hax-rst-sk-");
  const backupDir = createTempDir("hax-rst-sk-bk-");
  const targetDir = createTempDir("hax-rst-sk-tg-");

  try {
    createFixtureFiles(sourceDir, {
      "config.json": '{"version":2}',
    });

    const backup = createBackup(sourceDir, backupDir);

    // Pre-create the same file in target
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, "config.json"), '{"version":1}', "utf8");

    const result = restoreBackup(backup.path, targetDir, { conflictStrategy: "skip" });

    assert.equal(result.restored.length, 0);
    assert.equal(result.skipped.length, 1);
    // File should still be the original
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(targetDir, "config.json"), "utf8")).version,
      1
    );
  } finally {
    cleanup(sourceDir);
    cleanup(backupDir);
    cleanup(targetDir);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// restoreFromBackupDir
// ───────────────────────────────────────────────────────────────────────────

test("restoreFromBackupDir: restores using backupDir + backupId", () => {
  const sourceDir = createTempDir("hax-rbdir-src-");
  const backupDir = createTempDir("hax-rbdir-bk-");
  const targetDir = createTempDir("hax-rbdir-tg-");

  try {
    createFixtureFiles(sourceDir, { "file.txt": "content" });
    const backup = createBackup(sourceDir, backupDir);

    const result = restoreFromBackupDir(backupDir, backup.id, targetDir);
    assert.equal(result.restored.length, 1);
    assert.ok(fs.existsSync(path.join(targetDir, "file.txt")));
  } finally {
    cleanup(sourceDir);
    cleanup(backupDir);
    cleanup(targetDir);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// rotateBackups
// ───────────────────────────────────────────────────────────────────────────

test("rotateBackups: removes backups exceeding maxCount", () => {
  const backupDir = createTempDir("hax-rot-");

  try {
    // Create 5 backups with different timestamps
    for (let i = 1; i <= 5; i++) {
      const ts = `2025-0${i}-01T00-00-00-000Z`;
      const dir = path.join(backupDir, `backup-${ts}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "manifest.json"),
        JSON.stringify({ timestamp: ts, fileCount: 1 }),
        "utf8"
      );
    }

    const result = rotateBackups(backupDir, { maxCount: 2 });
    assert.equal(result.removed.length, 3);
    assert.equal(result.kept.length, 2);

    // Verify only 2 remain
    const remaining = fs.readdirSync(backupDir);
    assert.equal(remaining.length, 2);
  } finally {
    cleanup(backupDir);
  }
});

test("rotateBackups: removes backups older than maxAge", () => {
  const backupDir = createTempDir("hax-rot-age-");

  try {
    // Create a backup with timestamp far in the past
    const oldTs = "2020-01-01T00-00-00-000Z";
    const newTs = new Date().toISOString().replace(/[:.]/g, "-");

    const oldDir = path.join(backupDir, `backup-${oldTs}`);
    const newDir = path.join(backupDir, `backup-${newTs}`);
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(
      path.join(oldDir, "manifest.json"),
      JSON.stringify({ timestamp: "2020-01-01T00:00:00.000Z", fileCount: 1 }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(newDir, "manifest.json"),
      JSON.stringify({ timestamp: new Date().toISOString(), fileCount: 1 }),
      "utf8"
    );

    // maxAge of 1 day (86400000 ms) — old backup is way older
    const result = rotateBackups(backupDir, { maxAge: 86400000 });
    assert.ok(result.removed.includes(`backup-${oldTs}`));
  } finally {
    cleanup(backupDir);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// createSnapshot
// ───────────────────────────────────────────────────────────────────────────

test("createSnapshot: snapshots project directories", () => {
  const projectRoot = createTempDir("hax-snap-prj-");
  const snapshotDir = createTempDir("hax-snap-dir-");

  try {
    // Set up project structure
    const memDir = path.join(projectRoot, ".hax-agent", "memory");
    const sessDir = path.join(projectRoot, ".hax-agent", "sessions");
    const configPath = path.join(projectRoot, ".hax-agent", "config.json");

    fs.mkdirSync(memDir, { recursive: true });
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, "mem1.json"), '{"name":"test"}', "utf8");
    fs.writeFileSync(path.join(sessDir, "session1.jsonl"), '{"role":"user"}\n', "utf8");
    fs.writeFileSync(configPath, '{"agent":{"name":"test"}}', "utf8");

    const result = createSnapshot({
      projectRoot,
      snapshotDir,
      settings: {
        memory: { directory: memDir },
        sessions: { directory: sessDir },
      },
    });

    assert.ok(result.id.startsWith("snapshot-"));
    assert.ok(fs.existsSync(result.path));
    assert.equal(result.manifest.fileCount, 3);
    assert.ok(result.manifest.directories.includes("memory"));
    assert.ok(result.manifest.directories.includes("sessions"));
  } finally {
    cleanup(projectRoot);
    cleanup(snapshotDir);
  }
});

test("createSnapshot: works with minimal options (only projectRoot)", () => {
  const projectRoot = createTempDir("hax-snap-min-");
  const snapshotDir = createTempDir("hax-snap-min-d-");

  try {
    const result = createSnapshot({
      projectRoot,
      snapshotDir,
    });

    assert.ok(result.id.startsWith("snapshot-"));
    assert.ok(fs.existsSync(result.path));
  } finally {
    cleanup(projectRoot);
    cleanup(snapshotDir);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// computeChecksum
// ───────────────────────────────────────────────────────────────────────────

test("computeChecksum: produces consistent SHA-256 hash", () => {
  const dir = createTempDir("hax-cksum-");
  try {
    const filePath = path.join(dir, "test.txt");
    fs.writeFileSync(filePath, "hello world", "utf8");

    const hash1 = computeChecksum(filePath);
    const hash2 = computeChecksum(filePath);

    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64); // SHA-256 is 64 hex chars
  } finally {
    cleanup(dir);
  }
});
