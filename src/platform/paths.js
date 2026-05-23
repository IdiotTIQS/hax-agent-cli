"use strict";

const path = require("node:path");

/**
 * Path utility functions that work consistently across Windows, macOS, and Linux.
 *
 * All functions accept and return strings. They work with POSIX, Windows, and
 * mixed-separator paths.  No function modifies the filesystem.
 */

/**
 * Normalise a path for the current platform.
 *
 * - Converts all separators to the platform-specific separator.
 * - Resolves `.` and `..` segments.
 * - Removes redundant separators.
 * - Preserves trailing separators only when explicitly given `preserveTrailing`.
 *
 * @param {string} p — path to normalise
 * @param {object} [options]
 * @param {boolean} [options.preserveTrailing=false]
 * @returns {string}
 */
function normalizePath(p, options = {}) {
  if (typeof p !== "string") return "";

  // Normalise slashes to system separator first, then let path.normalize
  // handle the rest.
  let normalised = toSystemPath(p);
  normalised = path.normalize(normalised);

  if (options.preserveTrailing && (p.endsWith("/") || p.endsWith("\\"))) {
    normalised += path.sep;
  }

  return normalised;
}

/**
 * Convert all forward slashes to the platform's path separator.
 *
 * On Windows this turns `/` into `\`. On POSIX systems this is a no-op.
 *
 * @param {string} p
 * @returns {string}
 */
function toSystemPath(p) {
  if (typeof p !== "string") return "";
  if (path.sep === "/") return p;
  return p.replace(/\//g, path.sep);
}

/**
 * Convert all path separators to forward slashes.
 *
 * Useful for creating paths that need to be consistent across platforms
 * (e.g. URIs, config files, serialisation).
 *
 * @param {string} p
 * @returns {string}
 */
function toUnixPath(p) {
  if (typeof p !== "string") return "";
  return p.replace(/\\/g, "/");
}

/**
 * Returns `true` when the path is absolute on the current platform.
 *
 * Windows absolute paths:
 *   - Drive letter: `C:\\foo`
 *   - UNC: `\\\\server\\share`
 * macOS / Linux absolute paths:
 *   - Starts with `/`
 *
 * @param {string} p
 * @returns {boolean}
 */
function isAbsolute(p) {
  if (typeof p !== "string") return false;
  return path.isAbsolute(p);
}

/**
 * Resolve a sequence of path segments into an absolute path.
 *
 * Thin wrapper around `path.resolve` that also normalises each segment.
 *
 * @param {...string} segments
 * @returns {string}
 */
function resolvePath(...segments) {
  const cleaned = segments
    .filter((s) => typeof s === "string" && s.length > 0)
    .map((s) => normalizePath(s));
  return path.resolve(...cleaned);
}

/**
 * Return a relative path from `from` to `to`.
 *
 * Thin wrapper around `path.relative` with platform-normalised arguments.
 *
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
function relativePath(from, to) {
  if (typeof from !== "string" || typeof to !== "string") return "";
  return path.relative(normalizePath(from), normalizePath(to));
}

/**
 * Check whether `child` is located inside `parent` (including when paths are equal).
 *
 * Paths are normalised before comparison.  On Windows the comparison is
 * case-insensitive; on POSIX systems it is case-sensitive (matching fs behaviour).
 *
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
function isPathInside(parent, child) {
  const parentNorm = normalizePath(parent);
  const childNorm = normalizePath(child);

  if (parentNorm === childNorm) return true;

  // Ensure parent has trailing separator so we don't match partial segments.
  const parentWithSep = parentNorm.endsWith(path.sep) ? parentNorm : parentNorm + path.sep;

  if (process.platform === "win32") {
    return childNorm.toLowerCase().startsWith(parentWithSep.toLowerCase());
  }

  return childNorm.startsWith(parentWithSep);
}

/**
 * Split a path into its constituent segments.
 *
 * - Root (e.g. `/`, `C:\\`, `\\\\server\\share`) is always the first entry.
 * - Empty segments (from double separators) are discarded.
 * - The returned array does NOT include trailing empty strings.
 *
 * @param {string} p
 * @returns {string[]}
 */
function getPathSegments(p) {
  if (typeof p !== "string" || p.trim() === "") return [];

  const root = path.parse(p).root;
  const body = p.slice(root.length);
  const parts = body.split(/[/\\]+/).filter(Boolean);
  return [root, ...parts];
}

module.exports = {
  normalizePath,
  toSystemPath,
  toUnixPath,
  isAbsolute,
  resolvePath,
  relativePath,
  isPathInside,
  getPathSegments,
};
