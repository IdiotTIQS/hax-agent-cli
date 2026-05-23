"use strict";

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_FILENAME = 'manifest.json';
const BACKUP_DIR_PREFIX = 'backup-';

// ─────────────────────────────────────────────────────────────────────────────
// Backup creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a timestamped backup of a source directory.
 *
 * @param {string} sourceDir   - directory to back up
 * @param {string} backupDir   - root directory where backups are stored
 * @param {object} [options]
 * @param {string} [options.label]         - optional human-readable label
 * @param {RegExp} [options.include]       - regex to filter files to include
 * @param {RegExp} [options.exclude]       - regex to filter files to exclude
 * @param {number} [options.maxFileSize]   - skip files larger than this (bytes)
 * @returns {{ id: string, path: string, manifest: object, fileCount: number }}
 */
function createBackup(sourceDir, backupDir, options = {}) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }

  const timestamp = new Date().toISOString();
  const id = generateBackupId(timestamp);
  const destDir = path.join(backupDir, id);

  fs.mkdirSync(destDir, { recursive: true });

  const fileList = [];
  const checksums = {};
  let fileCount = 0;

  collectFiles(sourceDir, sourceDir, fileList, options);

  for (const entry of fileList) {
    const { relativePath, absolutePath } = entry;
    const destPath = path.join(destDir, relativePath);

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(absolutePath, destPath);

    checksums[relativePath] = computeChecksum(absolutePath);
    fileCount++;
  }

  const manifest = {
    version: 1,
    id,
    timestamp,
    label: options.label || '',
    sourceDir: path.resolve(sourceDir),
    fileCount,
    files: fileList.map((f) => f.relativePath),
    checksums,
  };

  fs.writeFileSync(
    path.join(destDir, MANIFEST_FILENAME),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  return {
    id,
    path: destDir,
    manifest,
    fileCount,
  };
}

/**
 * List all available backups with their metadata.
 *
 * @param {string} backupDir - root backup directory
 * @returns {Array<{ id: string, path: string, timestamp: string, label: string, fileCount: number }>}
 */
function listBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return [];

  const entries = fs.readdirSync(backupDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(BACKUP_DIR_PREFIX))
    .map((entry) => {
      const manifestPath = path.join(backupDir, entry.name, MANIFEST_FILENAME);
      let manifest = null;

      try {
        if (fs.existsSync(manifestPath)) {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        }
      } catch {
        // Corrupt manifest — return what we can
      }

      return {
        id: entry.name,
        path: path.join(backupDir, entry.name),
        timestamp: manifest?.timestamp || '',
        label: manifest?.label || '',
        fileCount: manifest?.fileCount || 0,
        manifest,
      };
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Restore from a backup.
 *
 * @param {string} backupId     - backup ID (directory name)
 * @param {string} targetDir    - directory to restore into
 * @param {object} [options]
 * @param {'overwrite'|'skip'|'ask'} [options.conflictStrategy='overwrite']
 * @param {RegExp} [options.include]  - regex to filter files to restore
 * @param {boolean} [options.dryRun]  - if true, report what would happen without restoring
 * @returns {{ restored: string[], skipped: string[], errors: string[] }}
 */
function restoreBackup(backupId, targetDir, options = {}) {
  // Support passing the full backup path as backupId
  const backupPath = path.isAbsolute(backupId) && fs.existsSync(backupId)
    ? backupId
    : null;

  if (!backupPath) {
    throw new Error(`Backup directory not found: ${backupId}`);
  }

  const srcDir = backupPath;
  const manifestPath = path.join(srcDir, MANIFEST_FILENAME);

  if (!fs.existsSync(srcDir)) {
    throw new Error(`Backup directory not found: ${srcDir}`);
  }

  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }

  const conflictStrategy = options.conflictStrategy || 'overwrite';
  const dryRun = options.dryRun === true;
  const includeFilter = options.include || null;

  const restoreFiles = collectRestoreFiles(srcDir, includeFilter);
  const restored = [];
  const skipped = [];
  const errors = [];

  fs.mkdirSync(targetDir, { recursive: true });

  for (const { relativePath, absolutePath } of restoreFiles) {
    const destPath = path.join(targetDir, relativePath);

    try {
      if (fs.existsSync(destPath)) {
        if (conflictStrategy === 'skip') {
          skipped.push(relativePath);
          continue;
        }
      }

      if (!dryRun) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(absolutePath, destPath);
      }

      // Verify checksum if manifest has it
      if (!dryRun && manifest?.checksums?.[relativePath]) {
        const expected = manifest.checksums[relativePath];
        const actual = computeChecksum(destPath);
        if (expected !== actual) {
          errors.push(`Checksum mismatch for ${relativePath}: expected ${expected}, got ${actual}`);
        }
      }

      restored.push(relativePath);
    } catch (err) {
      errors.push(`Failed to restore ${relativePath}: ${err.message}`);
    }
  }

  return {
    restored,
    skipped,
    errors,
    manifest,
  };
}

/**
 * Restore from a backup in the standard backup directory.
 *
 * @param {string} backupDir   - root backup directory
 * @param {string} backupId    - backup ID
 * @param {string} targetDir   - target directory
 * @param {object} [options]
 * @returns {{ restored: string[], skipped: string[], errors: string[] }}
 */
function restoreFromBackupDir(backupDir, backupId, targetDir, options = {}) {
  const backupPath = path.join(backupDir, backupId);
  return restoreBackup(backupPath, targetDir, options);
}

/**
 * Rotate backups: remove old backups based on count and/or age limits.
 *
 * @param {string} backupDir
 * @param {{ maxCount?: number, maxAge?: number }} [options]
 *   maxCount - keep at most this many backups (oldest removed first)
 *   maxAge   - remove backups older than this many milliseconds
 * @returns {{ removed: string[], kept: string[] }}
 */
function rotateBackups(backupDir, options = {}) {
  const maxCount = options.maxCount || 0;
  const maxAge = options.maxAge || 0;

  if (!fs.existsSync(backupDir)) return { removed: [], kept: [] };

  let backups = listBackups(backupDir);
  const removed = [];
  const kept = [];
  const now = Date.now();

  for (const backup of backups) {
    const backupTime = new Date(backup.timestamp).getTime();
    const age = now - backupTime;

    if (maxAge > 0 && age > maxAge) {
      removeBackupDir(backup.path);
      removed.push(backup.id);
    }
  }

  // Re-list after age-based removal
  backups = listBackups(backupDir);

  // Remove excess by maxCount (keep newest)
  if (maxCount > 0 && backups.length > maxCount) {
    const toRemove = backups.slice(maxCount);
    for (const backup of toRemove) {
      removeBackupDir(backup.path);
      removed.push(backup.id);
    }
  }

  // Compute kept
  const finalBackups = listBackups(backupDir);
  for (const backup of finalBackups) {
    kept.push(backup.id);
  }

  return { removed, kept };
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a snapshot of the current project state (config, memory, sessions).
 *
 * @param {object} options
 * @param {string} options.projectRoot    - project root directory
 * @param {string} options.snapshotDir    - directory to store snapshots
 * @param {object} [options.settings]     - merged settings object (for directory discovery)
 * @param {string} [options.label]        - optional label
 * @returns {{ id: string, path: string, manifest: object }}
 */
function createSnapshot(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const snapshotDir = path.resolve(options.snapshotDir || path.join(projectRoot, '.hax-agent', 'snapshots'));
  const snapshotId = `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const destDir = path.join(snapshotDir, snapshotId);

  const dirsToSnap = [];
  const settings = options.settings || {};

  // Discover data directories from settings or defaults
  if (settings.memory?.directory) {
    const memDir = path.isAbsolute(settings.memory.directory)
      ? settings.memory.directory
      : path.resolve(projectRoot, settings.memory.directory);
    if (fs.existsSync(memDir)) dirsToSnap.push({ name: 'memory', path: memDir });
  } else {
    const defaultMemDir = path.join(projectRoot, '.hax-agent', 'memory');
    if (fs.existsSync(defaultMemDir)) dirsToSnap.push({ name: 'memory', path: defaultMemDir });
  }

  if (settings.sessions?.directory) {
    const sessDir = path.isAbsolute(settings.sessions.directory)
      ? settings.sessions.directory
      : path.resolve(projectRoot, settings.sessions.directory);
    if (fs.existsSync(sessDir)) dirsToSnap.push({ name: 'sessions', path: sessDir });
  } else {
    const defaultSessDir = path.join(projectRoot, '.hax-agent', 'sessions');
    if (fs.existsSync(defaultSessDir)) dirsToSnap.push({ name: 'sessions', path: defaultSessDir });
  }

  // Config files
  const configFiles = [];
  const projectConfig = path.join(projectRoot, '.hax-agent', 'config.json');
  const userConfig = path.join(projectRoot, '.hax-agent', 'user-config.json');

  if (fs.existsSync(projectConfig)) configFiles.push({ name: 'config.json', path: projectConfig });
  if (fs.existsSync(userConfig)) configFiles.push({ name: 'user-config.json', path: userConfig });

  const fileList = [];
  const checksums = {};
  let fileCount = 0;

  fs.mkdirSync(destDir, { recursive: true });

  // Copy data directories
  for (const dir of dirsToSnap) {
    const entries = [];
    collectFiles(dir.path, dir.path, entries, { exclude: null });
    for (const entry of entries) {
      const relPath = path.join(dir.name, entry.relativePath);
      const destPath = path.join(destDir, relPath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(entry.absolutePath, destPath);
      checksums[relPath] = computeChecksum(entry.absolutePath);
      fileList.push(relPath);
      fileCount++;
    }
  }

  // Copy config files
  for (const cf of configFiles) {
    const relPath = cf.name;
    const destPath = path.join(destDir, relPath);
    fs.copyFileSync(cf.path, destPath);
    checksums[relPath] = computeChecksum(cf.path);
    fileList.push(relPath);
    fileCount++;
  }

  const manifest = {
    version: 1,
    id: snapshotId,
    timestamp: new Date().toISOString(),
    type: 'snapshot',
    label: options.label || '',
    projectRoot,
    fileCount,
    files: fileList,
    checksums,
    directories: dirsToSnap.map((d) => d.name),
  };

  fs.writeFileSync(
    path.join(destDir, MANIFEST_FILENAME),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  return {
    id: snapshotId,
    path: destDir,
    manifest,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function generateBackupId(timestamp) {
  const slug = timestamp.replace(/[:.]/g, '-');
  return `${BACKUP_DIR_PREFIX}${slug}`;
}

function computeChecksum(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function collectFiles(baseDir, currentDir, results, options = {}) {
  if (!fs.existsSync(currentDir)) return;

  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const include = options.include || null;
  const exclude = options.exclude || null;
  const maxFileSize = options.maxFileSize || 0;

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(baseDir, absolutePath);

    // Skip manifest files to avoid recursion issues
    if (entry.name === MANIFEST_FILENAME) continue;

    if (entry.isDirectory()) {
      // Skip node_modules and .git by default
      if (['node_modules', '.git'].includes(entry.name)) continue;
      collectFiles(baseDir, absolutePath, results, options);
    } else if (entry.isFile()) {
      if (include && !include.test(relativePath)) continue;
      if (exclude && exclude.test(relativePath)) continue;
      if (maxFileSize > 0) {
        try {
          const stats = fs.statSync(absolutePath);
          if (stats.size > maxFileSize) continue;
        } catch {
          continue;
        }
      }
      results.push({ relativePath: relativePath.replace(/\\/g, '/'), absolutePath });
    }
  }

  return results;
}

function collectRestoreFiles(srcDir, includeFilter) {
  const results = [];
  _collectRestoreFilesRecursive(srcDir, srcDir, results, includeFilter);
  return results;
}

function _collectRestoreFilesRecursive(baseDir, currentDir, results, includeFilter) {
  if (!fs.existsSync(currentDir)) return;

  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(baseDir, absolutePath).replace(/\\/g, '/');

    if (entry.name === MANIFEST_FILENAME) continue;

    if (entry.isDirectory()) {
      _collectRestoreFilesRecursive(baseDir, absolutePath, results, includeFilter);
    } else if (entry.isFile()) {
      if (includeFilter && !includeFilter.test(relativePath)) continue;
      results.push({ relativePath, absolutePath });
    }
  }
}

function removeBackupDir(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  fs.rmSync(dirPath, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  createBackup,
  listBackups,
  restoreBackup,
  restoreFromBackupDir,
  rotateBackups,
  createSnapshot,
  computeChecksum,
  generateBackupId,
  MANIFEST_FILENAME,
  BACKUP_DIR_PREFIX,
};
