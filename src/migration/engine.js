/**
 * MigrationEngine — systematic code transformation engine.
 *
 * Registers transforms, applies them across filesets with preview/rollback support,
 * and maintains an audit history of every applied transform.
 *
 * Transform shape:
 *   {
 *     name: string,               // unique transform identifier
 *     description: string,        // human-readable summary
 *     match(file, content): boolean   // optional — whether this transform applies
 *     apply(content, options): string // required — returns transformed content
 *   }
 *
 * Options:
 *   dryRun: boolean   — compute diff but don't write
 *   backup: boolean   — save original content before mutation
 *   parallel: boolean — process files concurrently
 *   maxFiles: number  — cap on concurrently processed files
 */
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

class MigrationEngine {
  constructor(options) {
    const opts = options || {};
    /** @type {Map<string, object>} registered transforms keyed by name */
    this._transforms = new Map();
    /** @type {Array<object>} ordered history of applied transforms */
    this._history = [];
    /** @type {Map<string, string>} rollback snapshots keyed by transformId */
    this._backups = new Map();
    /** @type {string} working directory for relative file resolution */
    this._cwd = opts.cwd || process.cwd();
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Register a code transform.
   *
   * @param {string} name - unique transform identifier
   * @param {{description?: string, match?(file: string, content: string): boolean, apply(content: string, options?: object): string}} transform
   * @returns {MigrationEngine} this (chaining)
   */
  defineTransform(name, transform) {
    if (!name || typeof name !== "string") {
      throw new TypeError("defineTransform: name must be a non-empty string");
    }
    if (!transform || typeof transform.apply !== "function") {
      throw new TypeError("defineTransform: transform.apply must be a function");
    }
    if (!transform.description) {
      transform.description = name;
    }
    this._transforms.set(name, transform);
    return this;
  }

  /**
   * Look up a registered transform by name.
   * @param {string} name
   * @returns {object|undefined}
   */
  getTransform(name) {
    return this._transforms.get(name);
  }

  /**
   * Return all registered transform names.
   * @returns {string[]}
   */
  listTransforms() {
    return Array.from(this._transforms.keys());
  }

  // ---------------------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------------------

  /**
   * Apply a registered transform to one or more files.
   *
   * @param {string|string[]} files - single file path, glob pattern, or array of file paths
   * @param {string|object} transform - registered transform name OR inline transform object
   * @param {{ dryRun?: boolean, backup?: boolean, parallel?: boolean, maxFiles?: number }} [options]
   * @returns {{ transformId: string, results: Array<{file: string, original: string, transformed: string, changed: boolean, error?: string}>, summary: { total: number, changed: number, unchanged: number, errors: number } }}
   */
  apply(files, transform, options) {
    const opts = options || {};
    const dryRun = opts.dryRun !== false;
    const backup = opts.backup === true;
    const parallel = opts.parallel === true;
    const maxFiles = opts.maxFiles || Infinity;

    // Resolve transform
    const resolvedTransform = typeof transform === "string"
      ? this._transforms.get(transform)
      : transform;

    if (!resolvedTransform) {
      throw new Error(`apply: transform "${transform}" is not registered`);
    }

    // Resolve file list
    const fileList = this._resolveFiles(files);

    if (fileList.length === 0) {
      return {
        transformId: null,
        results: [],
        summary: { total: 0, changed: 0, unchanged: 0, errors: 0 },
      };
    }

    // Cap file count
    const cappedFiles = fileList.slice(0, maxFiles);

    // Generate a unique transform ID for this run
    const transformId = this._generateTransformId(
      typeof transform === "string" ? transform : (resolvedTransform.name || "inline"),
      cappedFiles
    );

    // Process files
    let results;
    if (parallel) {
      results = this._processParallel(cappedFiles, resolvedTransform, opts, transformId);
    } else {
      results = this._processSequential(cappedFiles, resolvedTransform, opts, transformId);
    }

    // Save backups if requested
    if (backup && !dryRun) {
      const backups = {};
      for (const r of results) {
        if (r.changed && !r.error) {
          backups[r.file] = r.original;
        }
      }
      if (Object.keys(backups).length > 0) {
        this._backups.set(transformId, backups);
      }
    }

    // Write to disk if not a dry run
    if (!dryRun) {
      for (const r of results) {
        if (r.changed && !r.error) {
          try {
            fs.writeFileSync(r.file, r.transformed, "utf-8");
          } catch (err) {
            r.error = err.message;
          }
        }
      }
    }

    // Record history entry
    const summary = {
      total: results.length,
      changed: results.filter((r) => r.changed && !r.error).length,
      unchanged: results.filter((r) => !r.changed && !r.error).length,
      errors: results.filter((r) => r.error).length,
    };

    this._history.push({
      transformId,
      transformName: typeof transform === "string" ? transform : (resolvedTransform.name || "inline"),
      timestamp: new Date().toISOString(),
      dryRun,
      backup,
      fileCount: cappedFiles.length,
      summary,
    });

    return { transformId, results, summary };
  }

  // ---------------------------------------------------------------------------
  // Preview (dry-run shorthand)
  // ---------------------------------------------------------------------------

  /**
   * Dry-run a transform without writing to disk. Identical to apply(…, { dryRun: true }).
   *
   * @param {string|string[]} files
   * @param {string|object} transform
   * @param {{ backup?: boolean, parallel?: boolean, maxFiles?: number }} [options]
   * @returns {{ transformId: string, results: Array<{file: string, original: string, transformed: string, changed: boolean, error?: string}>, summary: { total: number, changed: number, unchanged: number, errors: number } }}
   */
  preview(files, transform, options) {
    const opts = Object.assign({}, options || {}, { dryRun: true });
    return this.apply(files, transform, opts);
  }

  // ---------------------------------------------------------------------------
  // Rollback
  // ---------------------------------------------------------------------------

  /**
   * Roll back a previously applied (non-dry-run) transform using its on-disk backup.
   *
   * @param {string} transformId
   * @returns {{ success: boolean, restored: number, errors: string[] }}
   */
  rollback(transformId) {
    const errors = [];
    let restored = 0;

    const historyEntry = this._history.find((h) => h.transformId === transformId);
    if (!historyEntry) {
      errors.push(`rollback: no history entry found for transformId "${transformId}"`);
      return { success: false, restored: 0, errors };
    }

    if (historyEntry.dryRun) {
      errors.push(`rollback: cannot roll back a dry-run (transformId "${transformId}")`);
      return { success: false, restored: 0, errors };
    }

    const backups = this._backups.get(transformId);
    if (!backups) {
      errors.push(`rollback: no backup data found for transformId "${transformId}". The backup may have been cleared.`);
      return { success: false, restored: 0, errors };
    }

    for (const [file, originalContent] of Object.entries(backups)) {
      try {
        fs.writeFileSync(file, originalContent, "utf-8");
        restored++;
      } catch (err) {
        errors.push(`rollback: failed to restore "${file}": ${err.message}`);
      }
    }

    // Clear the backup to prevent double-rollback
    this._backups.delete(transformId);

    return {
      success: errors.length === 0 && restored > 0,
      restored,
      errors,
    };
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  /**
   * Return the full transform application history.
   *
   * @param {{ limit?: number, transformName?: string }} [options]
   * @returns {Array<object>}
   */
  getHistory(options) {
    const opts = options || {};
    let entries = [...this._history];

    if (opts.transformName) {
      entries = entries.filter((e) => e.transformName === opts.transformName);
    }

    if (opts.limit && opts.limit > 0) {
      entries = entries.slice(-opts.limit);
    }

    return entries;
  }

  /**
   * Clear all history entries and backups.
   */
  clearHistory() {
    this._history.length = 0;
    this._backups.clear();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve a single path, array of paths, or bare file list into absolute paths.
   */
  _resolveFiles(files) {
    if (typeof files === "string") {
      // Check for glob characters
      if (files.includes("*") || files.includes("?") || files.includes("[")) {
        return this._resolveGlob(files);
      }
      return [path.resolve(this._cwd, files)];
    }

    if (Array.isArray(files)) {
      if (files.length === 0) return [];
      // If any item contains glob chars, expand
      const resolved = [];
      for (const f of files) {
        if (typeof f !== "string") continue;
        if (f.includes("*") || f.includes("?") || f.includes("[")) {
          for (const expanded of this._resolveGlob(f)) {
            resolved.push(expanded);
          }
        } else {
          resolved.push(path.resolve(this._cwd, f));
        }
      }
      return resolved;
    }

    throw new TypeError("apply: files must be a string or string[]");
  }

  /**
   * Expand a simple glob pattern (supports * and **).
   */
  _resolveGlob(pattern) {
    // If the pattern is anchored to the cwd, resolve it
    const absPattern = path.isAbsolute(pattern)
      ? pattern
      : path.resolve(this._cwd, pattern);

    // Simple glob: find the base directory
    const globIdx = absPattern.search(/[*?\[\]]/);
    if (globIdx === -1) {
      return [absPattern];
    }

    const baseDir = absPattern.slice(0, globIdx).replace(/[/\\]$/, "") || path.dirname(absPattern);
    // Find the deepest directory that doesn't contain glob chars
    const parts = absPattern.split(/[/\\]/);
    const nonGlobParts = [];
    for (const p of parts) {
      if (/[*?\[\]]/.test(p)) break;
      nonGlobParts.push(p);
    }

    const searchRoot = nonGlobParts.length > 0
      ? nonGlobParts.join(path.sep)
      : (path.isAbsolute(pattern) ? path.parse(absPattern).root : ".");

    if (!fs.existsSync(searchRoot)) {
      return [];
    }

    const matches = [];

    // Build a regex from the glob pattern
    const escaped = absPattern
      .replace(/[.+^${}()|\\]/g, "\\$&")
      .replace(/\*\*\//g, "___DOUBLESTAR___")
      .replace(/\*/g, "[^/\\\\]*")
      .replace(/___DOUBLESTAR___/g, "(?:.*[/\\\\])?")
      .replace(/\?/g, "[^/\\\\]")
      .replace(/\[!/g, "[^");

    const regex = new RegExp("^" + escaped + "$", "i");

    this._walkDir(searchRoot, regex, matches);
    return matches;
  }

  /**
   * Recursively walk a directory collecting files matching a regex.
   */
  _walkDir(dir, regex, matches) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this._walkDir(fullPath, regex, matches);
      } else if (entry.isFile()) {
        if (regex.test(fullPath)) {
          matches.push(fullPath);
        }
      }
    }
  }

  /**
   * Process files sequentially.
   */
  _processSequential(files, transform, opts, transformId) {
    const results = [];
    for (const file of files) {
      results.push(this._transformFile(file, transform, opts));
    }
    return results;
  }

  /**
   * Process files in parallel (only meaningful for I/O-bound work).
   */
  _processParallel(files, transform, opts, transformId) {
    // For a pure in-memory transformation this is equivalent to sequential,
    // but we provide a consistent API surface that can be extended later
    // (e.g., worker threads for expensive AST transforms).
    const results = new Array(files.length);
    // Process in batches of maxFiles to avoid overwhelming the process
    const batchSize = opts.maxFiles || 10;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      for (let j = 0; j < batch.length; j++) {
        results[i + j] = this._transformFile(batch[j], transform, opts);
      }
    }
    return results;
  }

  /**
   * Apply a transform to a single file.
   */
  _transformFile(file, transform, opts) {
    let original;
    try {
      original = fs.readFileSync(file, "utf-8");
    } catch (err) {
      return { file, original: "", transformed: "", changed: false, error: `read error: ${err.message}` };
    }

    // Run the optional match gate
    if (typeof transform.match === "function") {
      try {
        if (!transform.match(file, original)) {
          return { file, original, transformed: original, changed: false };
        }
      } catch (err) {
        return { file, original, transformed: original, changed: false, error: `match error: ${err.message}` };
      }
    }

    let transformed;
    try {
      transformed = transform.apply(original, opts);
    } catch (err) {
      return { file, original, transformed: original, changed: false, error: `transform error: ${err.message}` };
    }

    const changed = transformed !== original;
    return { file, original, transformed, changed };
  }

  /**
   * Generate a unique, deterministic transform ID.
   */
  _generateTransformId(transformName, files) {
    const seed = `${transformName}:${files.length}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const hash = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 12);
    return `mig_${hash}`;
  }
}

module.exports = { MigrationEngine };
