"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * File-Backup Plugin — Before any file write, edit, or delete, copies the
 * original file to `.hax-agent/backups/` with a timestamp prefix so you can
 * always recover the previous version.
 *
 * Install:
 *   Copy this file to `.hax-agent/plugins/` and restart the agent.
 *
 * Watched tools: `file.write`, `file.edit`, `file.delete`
 *
 * Backup naming scheme:
 *   .hax-agent/backups/
 *     <ISO-timestamp>_<original-basename>
 *
 *   Example: 2026-05-22T14-31-05-123Z_index.js
 *
 * Directories are created automatically.  If the file does not exist yet
 * (e.g. a fresh `file.write`), the backup is silently skipped — there is
 * nothing to back up.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tool names that mutate files (and therefore warrant a backup). */
const MUTATING_TOOLS = new Set(["file.write", "file.edit", "file.delete"]);

/**
 * Resolve project root from the session or fall back to cwd.
 */
function resolveProjectRoot(session) {
  if (session && typeof session.cwd === "string" && session.cwd.length > 0) {
    return session.cwd;
  }
  return process.cwd();
}

/**
 * Derive the file path from tool arguments.
 *
 * All current file-operation tools (`file.write`, `file.edit`, `file.delete`)
 * accept a `path` property.  We also check `filePath` as a fallback in case
 * future tools use a different convention.
 */
function extractFilePath(args) {
  if (!args || typeof args !== "object") return null;
  if (typeof args.path === "string" && args.path.length > 0) return args.path;
  if (typeof args.filePath === "string" && args.filePath.length > 0)
    return args.filePath;
  return null;
}

/**
 * Build a safe filename prefix from the current timestamp.
 * Colons are replaced with hyphens so the name is valid on Windows too.
 */
function timestampPrefix() {
  return new Date().toISOString().replace(/:/g, "-");
}

/**
 * Create a backup copy of `absolutePath` inside `.hax-agent/backups/`.
 * Returns the backup path on success, or null if the source does not exist.
 */
function createBackup(projectRoot, absolutePath) {
  if (!fs.existsSync(absolutePath)) return null;

  const stats = fs.statSync(absolutePath);
  if (!stats.isFile()) return null;

  const backupDir = path.join(projectRoot, ".hax-agent", "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const baseName = path.basename(absolutePath);
  const backupName = `${timestampPrefix()}_${baseName}`;
  const backupPath = path.join(backupDir, backupName);

  fs.copyFileSync(absolutePath, backupPath);

  return backupPath;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function beforeToolCall(ctx) {
  const toolName = ctx.toolName;

  if (!toolName || !MUTATING_TOOLS.has(toolName)) return ctx;

  const filePath = extractFilePath(ctx.args);
  if (!filePath) return ctx;

  try {
    const projectRoot = resolveProjectRoot(ctx.session);
    // Resolve relative paths against the project root.
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(projectRoot, filePath);

    const backupPath = createBackup(projectRoot, absolutePath);

    // Attach backup metadata to the context so downstream hooks
    // (e.g. afterToolCall, onError) know a backup was taken.
    if (backupPath) {
      ctx._backupPath = backupPath;
      ctx._backupOriginal = absolutePath;
    }
  } catch (_err) {
    // Never let a backup failure crash the tool call.
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// Plugin descriptor
// ---------------------------------------------------------------------------

const FileBackupPlugin = {
  name: "file-backup-plugin",
  version: "1.0.0",

  hooks: {
    beforeToolCall,
  },
};

/**
 * Convenience: if loaded directly via `require()`, auto-register with the
 * provided PluginRegistry instance.
 */
function register(registry) {
  registry.register(FileBackupPlugin);
}

module.exports = FileBackupPlugin;
module.exports.register = register;
