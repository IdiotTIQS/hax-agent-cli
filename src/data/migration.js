"use strict";

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION_FILE = '.hax-version';

// ─────────────────────────────────────────────────────────────────────────────
// Migration Registry
// ─────────────────────────────────────────────────────────────────────────────

class MigrationRegistry {
  constructor() {
    this._migrations = new Map();
  }

  /**
   * Register a migration function for a target version.
   * @param {string} version - target version (e.g., "2", "2.0.0")
   * @param {function} fn     - migration function receiving (projectDir, options)
   * @param {{ description?: string, requiresBackup?: boolean }} [meta]
   */
  register(version, fn, meta = {}) {
    if (typeof version !== 'string' || !version.trim()) {
      throw new Error('Migration version must be a non-empty string');
    }
    if (typeof fn !== 'function') {
      throw new Error('Migration must be a function');
    }

    const key = normalizeVersion(version);
    this._migrations.set(key, {
      version: key,
      migrate: fn,
      description: meta.description || `Migrate to version ${version}`,
      requiresBackup: meta.requiresBackup !== false,
    });
  }

  /**
   * Get a migration by version.
   */
  get(version) {
    return this._migrations.get(normalizeVersion(version)) || null;
  }

  /**
   * List all registered migrations sorted by version.
   */
  list() {
    return [...this._migrations.values()]
      .sort((a, b) => compareVersions(a.version, b.version));
  }

  /**
   * Get migrations that are pending for a given current version.
   */
  getPending(currentVersion) {
    const current = normalizeVersion(currentVersion);
    return this.list().filter((m) => compareVersions(m.version, current) > 0);
  }

  /**
   * Remove a registered migration.
   */
  unregister(version) {
    return this._migrations.delete(normalizeVersion(version));
  }

  /**
   * Clear all registered migrations.
   */
  clear() {
    this._migrations.clear();
  }

  get size() {
    return this._migrations.size;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Version detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect the current data format version of a project.
 * Looks for a .hax-version file in the project's .hax-agent directory.
 * Falls back to "1" if no version file exists (assumes legacy v1 format).
 *
 * @param {string} projectDir
 * @returns {string} detected version
 */
function detectVersion(projectDir) {
  const haxDir = path.join(projectDir, '.hax-agent');
  const versionFile = path.join(haxDir, VERSION_FILE);

  if (fs.existsSync(versionFile)) {
    try {
      const content = fs.readFileSync(versionFile, 'utf8').trim();
      const parsed = JSON.parse(content);
      return parsed.version || '1';
    } catch {
      return '1';
    }
  }

  // Check for v2 markers (e.g., new directory structure)
  if (fs.existsSync(path.join(haxDir, 'data', 'version.json'))) {
    try {
      const dataVersion = JSON.parse(
        fs.readFileSync(path.join(haxDir, 'data', 'version.json'), 'utf8')
      );
      return dataVersion.version || '2';
    } catch {
      // fall through
    }
  }

  // Legacy: no version file → assume v1
  return '1';
}

/**
 * Write the version file for a project.
 * @param {string} projectDir
 * @param {string} version
 */
function writeVersion(projectDir, version) {
  const haxDir = path.join(projectDir, '.hax-agent');
  fs.mkdirSync(haxDir, { recursive: true });
  const versionFile = path.join(haxDir, VERSION_FILE);
  fs.writeFileSync(
    versionFile,
    JSON.stringify({ version, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration check and execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a project needs migration.
 * @param {string} projectDir
 * @param {MigrationRegistry} [registry] - defaults to a fresh registry
 * @returns {boolean}
 */
function needsMigration(projectDir, registry) {
  const reg = registry || createDefaultRegistry();
  const current = detectVersion(projectDir);
  const pending = reg.getPending(current);
  return pending.length > 0;
}

/**
 * Run all pending migrations in order.
 * Each migration is wrapped such that a backup is created beforehand
 * and the version file is updated afterward.
 *
 * @param {string} projectDir
 * @param {MigrationRegistry} [registry] - defaults to built-in registry
 * @param {object} [options]
 * @param {string} [options.backupDir]   - backup directory
 * @param {boolean} [options.dryRun]     - if true, report without executing
 * @returns {{ migrated: string[], currentVersion: string, errors: string[] }}
 */
function runMigrations(projectDir, registry, options = {}) {
  const reg = registry || createDefaultRegistry();
  const current = detectVersion(projectDir);
  const pending = reg.getPending(current);
  const migrated = [];
  const errors = [];
  const dryRun = options.dryRun === true;

  if (pending.length === 0) {
    return { migrated, currentVersion: current, errors: [], dryRun };
  }

  const backupDir = options.backupDir || path.join(projectDir, '.hax-agent', 'migration-backups');

  for (const migration of pending) {
    try {
      if (!dryRun && migration.requiresBackup) {
        const { createBackup } = require('./backup');
        const sourceDir = path.join(projectDir, '.hax-agent');
        if (fs.existsSync(sourceDir)) {
          const backupPath = path.join(backupDir, `pre-migrate-${migration.version}`);
          createBackup(sourceDir, backupPath, {
            label: `Pre-migration backup before v${migration.version}`,
          });
        }
      }

      if (!dryRun) {
        migration.migrate(projectDir, { dryRun: false });
        writeVersion(projectDir, migration.version);
      }

      migrated.push(migration.version);
    } catch (err) {
      errors.push(`Migration to ${migration.version} failed: ${err.message}`);
      // Stop on first error
      break;
    }
  }

  return {
    migrated,
    currentVersion: migrated.length > 0 ? migrated[migrated.length - 1] : current,
    errors,
    dryRun,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in migrations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Example migration: v1 to v2.
 *
 * Changes:
 *  - Memory files move from .hax-agent/memory/ to .hax-agent/data/memory/
 *  - Session files move from .hax-agent/sessions/ to .hax-agent/data/sessions/
 *  - Add a data/version.json marker
 */
function migrateV1toV2(projectDir, options = {}) {
  const haxDir = path.join(projectDir, '.hax-agent');
  const dataDir = path.join(haxDir, 'data');
  const dryRun = options.dryRun === true;

  const moves = [
    { from: 'memory', to: 'data/memory' },
    { from: 'sessions', to: 'data/sessions' },
  ];

  for (const { from, to } of moves) {
    const fromPath = path.join(haxDir, from);
    const toPath = path.join(haxDir, to);

    if (!fs.existsSync(fromPath)) continue;

    if (dryRun) continue;

    fs.mkdirSync(path.dirname(toPath), { recursive: true });

    // Move directory contents
    if (fs.existsSync(toPath)) {
      // Merge: move files from fromPath into toPath
      const entries = fs.readdirSync(fromPath, { withFileTypes: true });
      for (const entry of entries) {
        const src = path.join(fromPath, entry.name);
        const dest = path.join(toPath, entry.name);
        if (entry.isFile()) {
          fs.renameSync(src, dest);
        } else if (entry.isDirectory()) {
          copyDirRecursive(src, dest, true);
        }
      }
      fs.rmSync(fromPath, { recursive: true, force: true });
    } else {
      fs.renameSync(fromPath, toPath);
    }
  }

  // Write version marker
  if (!dryRun) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, 'version.json'),
      JSON.stringify({ version: '2', migratedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  }

  return { version: '2', moves };
}

function copyDirRecursive(srcDir, destDir, deleteSource = false) {
  if (!fs.existsSync(srcDir)) return;

  fs.mkdirSync(destDir, { recursive: true });

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, deleteSource);
    } else {
      fs.copyFileSync(srcPath, destPath);
      if (deleteSource) {
        fs.unlinkSync(srcPath);
      }
    }
  }

  if (deleteSource) {
    fs.rmdirSync(srcDir);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeVersion(version) {
  const str = String(version).trim();
  // Strip leading 'v' if present
  const clean = str.replace(/^v/i, '');
  if (!clean) return '0.0.0';
  // Ensure major.minor.patch format for comparison
  const parts = clean.split('.');
  while (parts.length < 3) parts.push('0');
  return parts.slice(0, 3).join('.');
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

function createDefaultRegistry() {
  const registry = new MigrationRegistry();
  registry.register('2', migrateV1toV2, {
    description: 'Move memory/sessions to data/ subdirectory',
    requiresBackup: true,
  });
  return registry;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MigrationRegistry,
  detectVersion,
  writeVersion,
  needsMigration,
  runMigrations,
  migrateV1toV2,
  createDefaultRegistry,
  VERSION_FILE,
  normalizeVersion,
  compareVersions,
};
