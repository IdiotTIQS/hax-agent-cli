"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const paths = require("../../src/platform/paths");

// -------------------------------------------------------------------
// normalizePath
// -------------------------------------------------------------------

test("normalizePath: resolves redundant separators", () => {
  const result = paths.normalizePath("/usr//local///bin");
  if (process.platform === "win32") {
    assert.ok(!result.includes("\\\\"), `Should not have double backslashes, got "${result}"`);
  } else {
    assert.equal(result, "/usr/local/bin");
  }
});

test("normalizePath: resolves .. segments", () => {
  const result = paths.normalizePath("/foo/bar/../baz");
  const expected = path.normalize("/foo/baz");
  assert.equal(result, expected);
});

test("normalizePath: resolves . segments", () => {
  const result = paths.normalizePath("/foo/./bar");
  const expected = path.normalize("/foo/bar");
  assert.equal(result, expected);
});

test("normalizePath: returns empty string for non-string", () => {
  assert.equal(paths.normalizePath(null), "");
  assert.equal(paths.normalizePath(undefined), "");
  assert.equal(paths.normalizePath(123), "");
});

// -------------------------------------------------------------------
// toSystemPath
// -------------------------------------------------------------------

test("toSystemPath: converts forward slashes to platform separator", () => {
  const result = paths.toSystemPath("a/b/c/d");
  if (process.platform === "win32") {
    assert.equal(result, "a\\b\\c\\d");
  } else {
    assert.equal(result, "a/b/c/d");
  }
});

test("toSystemPath: handles empty/non-string input", () => {
  assert.equal(paths.toSystemPath(""), "");
  assert.equal(paths.toSystemPath(null), "");
});

// -------------------------------------------------------------------
// toUnixPath
// -------------------------------------------------------------------

test("toUnixPath: converts all separators to forward slashes", () => {
  const result = paths.toUnixPath("a\\b\\c");
  assert.equal(result, "a/b/c");
});

test("toUnixPath: mixed separators become forward slashes", () => {
  const result = paths.toUnixPath("a/b\\c/d");
  assert.equal(result, "a/b/c/d");
});

// -------------------------------------------------------------------
// isAbsolute
// -------------------------------------------------------------------

test("isAbsolute: / is absolute on POSIX", () => {
  if (process.platform === "win32") return;
  assert.equal(paths.isAbsolute("/"), true);
});

test("isAbsolute: C:\\ is absolute on Windows", () => {
  if (process.platform !== "win32") return;
  assert.equal(paths.isAbsolute("C:\\Windows"), true);
});

test("isAbsolute: relative paths are not absolute", () => {
  assert.equal(paths.isAbsolute("foo/bar"), false);
  assert.equal(paths.isAbsolute("./foo"), false);
});

test("isAbsolute: handles non-string", () => {
  assert.equal(paths.isAbsolute(null), false);
  assert.equal(paths.isAbsolute(undefined), false);
});

// -------------------------------------------------------------------
// resolvePath
// -------------------------------------------------------------------

test("resolvePath: resolves relative paths against cwd", () => {
  const result = paths.resolvePath("foo", "bar");
  const expected = path.resolve("foo", "bar");
  assert.equal(result, expected);
});

test("resolvePath: ignores empty segments", () => {
  const result = paths.resolvePath("foo", "", "bar");
  const expected = path.resolve("foo", "bar");
  assert.equal(result, expected);
});

test("resolvePath: absolute segment makes earlier ones irrelevant", () => {
  const absoluteStart = process.platform === "win32" ? "C:\\abs" : "/abs";
  const result = paths.resolvePath("relative", absoluteStart);
  const expected = path.resolve("relative", absoluteStart);
  assert.equal(result, expected);
});

// -------------------------------------------------------------------
// relativePath
// -------------------------------------------------------------------

test("relativePath: computes relative between two paths", () => {
  const from = "/a/b/c";
  const to = "/a/b/d";
  const result = paths.relativePath(from, to);
  assert.equal(result, path.relative(from, to));
});

test("relativePath: handles non-string input", () => {
  assert.equal(paths.relativePath(null, "/foo"), "");
  assert.equal(paths.relativePath("/foo", null), "");
});

// -------------------------------------------------------------------
// isPathInside
// -------------------------------------------------------------------

test("isPathInside: child inside parent returns true", () => {
  const parent = "/foo/bar";
  const child = "/foo/bar/baz/qux";
  assert.equal(paths.isPathInside(parent, child), true);
});

test("isPathInside: identical paths returns true", () => {
  const p = process.platform === "win32" ? "C:\\foo\\bar" : "/foo/bar";
  assert.equal(paths.isPathInside(p, p), true);
});

test("isPathInside: child outside parent returns false", () => {
  const parent = "/foo/bar";
  const child = "/foo/baz";
  assert.equal(paths.isPathInside(parent, child), false);
});

test("isPathInside: parent with trailing slash works correctly", () => {
  const parent = "/foo/bar/";
  const child = "/foo/bar/baz";
  assert.equal(paths.isPathInside(parent, child), true);
});

test("isPathInside: partial segment match is not inside", () => {
  // /foo/bar should NOT be inside /foo/ba
  const parent = "/foo/ba";
  const child = "/foo/bar/baz";
  assert.equal(paths.isPathInside(parent, child), false);
});

// -------------------------------------------------------------------
// getPathSegments
// -------------------------------------------------------------------

test("getPathSegments: returns root and segments", () => {
  const p = process.platform === "win32" ? "C:\\foo\\bar\\baz.txt" : "/foo/bar/baz.txt";
  const segments = paths.getPathSegments(p);
  assert.ok(segments.length === 4, `Expected 4 segments, got ${segments.length}: [${segments}]`);
  // Last segment should be the file name
  assert.equal(segments[segments.length - 1], "baz.txt");
});

test("getPathSegments: empty input returns empty array", () => {
  assert.deepEqual(paths.getPathSegments(""), []);
  assert.deepEqual(paths.getPathSegments(null), []);
});

test("getPathSegments: disk root has only root segment", () => {
  const rootPath = process.platform === "win32" ? "C:\\" : "/";
  const segments = paths.getPathSegments(rootPath);
  assert.ok(segments.length >= 1 && segments[0] === rootPath,
    `Expected root as first segment, got: [${segments}]`);
});

// -------------------------------------------------------------------
// Additional edge cases
// -------------------------------------------------------------------

test("normalizePath: preserveTrailing option keeps trailing separator", () => {
  const input = path.join("foo", "bar") + path.sep;
  const result = paths.normalizePath(input, { preserveTrailing: true });
  assert.ok(
    result.endsWith(path.sep),
    `Expected trailing separator, got "${result}"`
  );
});

test("normalizePath: mixed Windows/Unix separators are unified", () => {
  const result = paths.normalizePath("a/b\\c");
  // After normalization there should be no mixed separators
  const hasMixed = result.includes("/") && result.includes("\\");
  assert.equal(hasMixed, false, `Mixed separators in "${result}"`);
});

test("isPathInside: handles Windows drive letter case-insensitively", () => {
  if (process.platform !== "win32") return;
  const parent = "C:\\Projects";
  const child = "c:\\projects\\myapp";
  assert.equal(paths.isPathInside(parent, child), true);
});
