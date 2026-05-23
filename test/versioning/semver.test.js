/**
 * Tests for semver utilities: parse, compare, satisfies, diff, bump, isValid, coerce.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const semver = require("../../src/versioning/semver");

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

test("parse: parses a simple semver string", () => {
  const result = semver.parse("1.2.3");
  assert.deepEqual(result, {
    major: 1,
    minor: 2,
    patch: 3,
    pre: null,
    build: null,
    raw: "1.2.3",
  });
});

test("parse: parses version with pre-release tag", () => {
  const result = semver.parse("1.2.3-alpha.1");
  assert.equal(result.major, 1);
  assert.equal(result.minor, 2);
  assert.equal(result.patch, 3);
  assert.deepEqual(result.pre, ["alpha", "1"]);
  assert.equal(result.build, null);
});

test("parse: parses version with build metadata", () => {
  const result = semver.parse("1.2.3+build.123");
  assert.equal(result.major, 1);
  assert.equal(result.minor, 2);
  assert.equal(result.patch, 3);
  assert.equal(result.pre, null);
  assert.deepEqual(result.build, ["build", "123"]);
});

test("parse: parses version with pre-release and build metadata", () => {
  const result = semver.parse("1.2.3-beta.2+build.456");
  assert.deepEqual(result.pre, ["beta", "2"]);
  assert.deepEqual(result.build, ["build", "456"]);
});

test("parse: handles leading 'v' prefix", () => {
  const result = semver.parse("v1.2.3");
  assert.equal(result.major, 1);
  assert.equal(result.minor, 2);
  assert.equal(result.patch, 3);
});

test("parse: returns null for invalid version", () => {
  assert.equal(semver.parse("not-a-version"), null);
  assert.equal(semver.parse(""), null);
  assert.equal(semver.parse(undefined), null);
  assert.equal(semver.parse(null), null);
  assert.equal(semver.parse(123), null);
});

test("parse: returns null for partial version", () => {
  assert.equal(semver.parse("1"), null);
  assert.equal(semver.parse("1.2"), null);
});

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

test("compare: returns 0 for equal versions", () => {
  assert.equal(semver.compare("1.0.0", "1.0.0"), 0);
  assert.equal(semver.compare("2.3.4", "2.3.4"), 0);
});

test("compare: returns -1 when first is lower", () => {
  assert.equal(semver.compare("1.0.0", "2.0.0"), -1);
  assert.equal(semver.compare("1.2.0", "1.3.0"), -1);
  assert.equal(semver.compare("1.2.3", "1.2.5"), -1);
});

test("compare: returns 1 when first is higher", () => {
  assert.equal(semver.compare("2.0.0", "1.0.0"), 1);
  assert.equal(semver.compare("1.3.0", "1.2.0"), 1);
  assert.equal(semver.compare("1.2.5", "1.2.3"), 1);
});

test("compare: pre-release versions have lower precedence", () => {
  assert.equal(semver.compare("1.0.0-alpha", "1.0.0"), -1);
  assert.equal(semver.compare("1.0.0", "1.0.0-alpha"), 1);
});

test("compare: pre-release numeric vs alphanumeric identifiers", () => {
  // Numeric identifiers compare numerically
  assert.equal(semver.compare("1.0.0-1", "1.0.0-2"), -1);
  assert.equal(semver.compare("1.0.0-2", "1.0.0-10"), -1);
  // Numeric identifiers always have lower precedence than alphanumeric
  assert.equal(semver.compare("1.0.0-1", "1.0.0-alpha"), -1);
});

test("compare: handles invalid versions gracefully", () => {
  assert.equal(semver.compare("invalid", "1.0.0"), -1);
  assert.equal(semver.compare("1.0.0", "invalid"), 1);
  assert.equal(semver.compare("invalid-a", "invalid-b"), 0);
});

// ---------------------------------------------------------------------------
// satisfies
// ---------------------------------------------------------------------------

test("satisfies: exact match", () => {
  assert.equal(semver.satisfies("1.2.3", "1.2.3"), true);
  assert.equal(semver.satisfies("1.2.4", "1.2.3"), false);
});

test("satisfies: caret range ^1.2.3", () => {
  assert.equal(semver.satisfies("1.2.3", "^1.2.3"), true);
  assert.equal(semver.satisfies("1.9.9", "^1.2.3"), true);
  assert.equal(semver.satisfies("2.0.0", "^1.2.3"), false);
  assert.equal(semver.satisfies("1.2.2", "^1.2.3"), false);
});

test("satisfies: caret range ^0.2.3 (0.x.y special case)", () => {
  assert.equal(semver.satisfies("0.2.3", "^0.2.3"), true);
  assert.equal(semver.satisfies("0.3.0", "^0.2.3"), false);
  assert.equal(semver.satisfies("0.2.5", "^0.2.3"), true);
});

test("satisfies: caret range ^0.0.3 (0.0.x special case)", () => {
  assert.equal(semver.satisfies("0.0.3", "^0.0.3"), true);
  assert.equal(semver.satisfies("0.0.4", "^0.0.3"), false);
});

test("satisfies: tilde range ~1.2.3", () => {
  assert.equal(semver.satisfies("1.2.3", "~1.2.3"), true);
  assert.equal(semver.satisfies("1.2.9", "~1.2.3"), true);
  assert.equal(semver.satisfies("1.3.0", "~1.2.3"), false);
  assert.equal(semver.satisfies("1.2.2", "~1.2.3"), false);
});

test("satisfies: greater/less than operators", () => {
  assert.equal(semver.satisfies("2.0.0", ">=1.0.0"), true);
  assert.equal(semver.satisfies("1.0.0", ">=1.0.0"), true);
  assert.equal(semver.satisfies("0.9.0", ">=1.0.0"), false);

  assert.equal(semver.satisfies("1.0.0", "<=1.0.0"), true);
  assert.equal(semver.satisfies("0.9.0", "<=1.0.0"), true);
  assert.equal(semver.satisfies("1.1.0", "<=1.0.0"), false);

  assert.equal(semver.satisfies("2.0.0", ">1.0.0"), true);
  assert.equal(semver.satisfies("1.0.0", ">1.0.0"), false);

  assert.equal(semver.satisfies("0.9.0", "<1.0.0"), true);
  assert.equal(semver.satisfies("1.0.0", "<1.0.0"), false);
});

test("satisfies: OR combinations with ||", () => {
  assert.equal(semver.satisfies("2.0.0", "^1.0.0 || ^2.0.0"), true);
  assert.equal(semver.satisfies("1.5.0", "^1.0.0 || ^2.0.0"), true);
  assert.equal(semver.satisfies("3.0.0", "^1.0.0 || ^2.0.0"), false);
});

test("satisfies: AND combinations with spaces", () => {
  assert.equal(semver.satisfies("1.5.0", ">=1.0.0 <2.0.0"), true);
  assert.equal(semver.satisfies("0.9.0", ">=1.0.0 <2.0.0"), false);
  assert.equal(semver.satisfies("2.0.0", ">=1.0.0 <2.0.0"), false);
});

test("satisfies: wildcard ranges", () => {
  assert.equal(semver.satisfies("2.5.3", "2.x"), true);
  assert.equal(semver.satisfies("1.5.3", "2.x"), false);
  assert.equal(semver.satisfies("2.5.3", "2.5.x"), true);
  assert.equal(semver.satisfies("2.6.3", "2.5.x"), false);
  assert.equal(semver.satisfies("1.2.3", "*"), true);
  assert.equal(semver.satisfies("0.0.1", "*"), true);
});

test("satisfies: handles invalid inputs", () => {
  assert.equal(semver.satisfies("invalid", "^1.0.0"), false);
  assert.equal(semver.satisfies("1.0.0", ""), false);
  assert.equal(semver.satisfies(null, "^1.0.0"), false);
  assert.equal(semver.satisfies("1.0.0", null), false);
});

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

test("diff: detects MAJOR difference", () => {
  assert.equal(semver.diff("1.0.0", "2.0.0"), "MAJOR");
  assert.equal(semver.diff("2.0.0", "1.0.0"), "MAJOR");
  assert.equal(semver.diff("1.5.3", "3.0.0"), "MAJOR");
});

test("diff: detects MINOR difference", () => {
  assert.equal(semver.diff("1.0.0", "1.2.0"), "MINOR");
  assert.equal(semver.diff("1.5.3", "1.2.0"), "MINOR");
});

test("diff: detects PATCH difference", () => {
  assert.equal(semver.diff("1.2.0", "1.2.5"), "PATCH");
});

test("diff: detects PREPATCH difference", () => {
  assert.equal(semver.diff("1.2.3", "1.2.4-alpha"), "PREPATCH");
});

test("diff: detects PREMINOR difference", () => {
  assert.equal(semver.diff("1.2.3", "1.3.0-alpha"), "PREMINOR");
});

test("diff: detects PREMAJOR difference", () => {
  assert.equal(semver.diff("1.2.3", "2.0.0-alpha"), "PREMAJOR");
});

test("diff: detects PRE difference (only pre-release changed)", () => {
  assert.equal(semver.diff("1.2.3-alpha", "1.2.3-beta"), "PRE");
});

test("diff: returns null for equal versions", () => {
  assert.equal(semver.diff("1.0.0", "1.0.0"), null);
});

test("diff: returns null for invalid versions", () => {
  assert.equal(semver.diff("invalid", "1.0.0"), null);
});

// ---------------------------------------------------------------------------
// bump
// ---------------------------------------------------------------------------

test("bump: bumps major", () => {
  assert.equal(semver.bump("1.2.3", "major"), "2.0.0");
  assert.equal(semver.bump("0.1.5", "major"), "1.0.0");
});

test("bump: bumps minor", () => {
  assert.equal(semver.bump("1.2.3", "minor"), "1.3.0");
});

test("bump: bumps patch", () => {
  assert.equal(semver.bump("1.2.3", "patch"), "1.2.4");
});

test("bump: bumps premajor", () => {
  assert.equal(semver.bump("1.2.3", "premajor"), "2.0.0-alpha.0");
  assert.equal(semver.bump("1.2.3", "premajor", "rc"), "2.0.0-rc.0");
});

test("bump: bumps preminor", () => {
  assert.equal(semver.bump("1.2.3", "preminor"), "1.3.0-alpha.0");
});

test("bump: bumps prepatch", () => {
  assert.equal(semver.bump("1.2.3", "prepatch"), "1.2.4-alpha.0");
});

test("bump: bumps prerelease with existing pre-release", () => {
  assert.equal(semver.bump("1.2.3-alpha.0", "prerelease"), "1.2.3-alpha.1");
  assert.equal(semver.bump("1.2.3-beta.5", "prerelease"), "1.2.3-beta.6");
  assert.equal(semver.bump("1.2.3-alpha", "prerelease"), "1.2.3-alpha.0");
});

test("bump: bumps prerelease without existing pre-release", () => {
  assert.equal(semver.bump("1.2.3", "prerelease"), "1.2.4-alpha.0");
});

test("bump: returns null for invalid version", () => {
  assert.equal(semver.bump("invalid", "major"), null);
});

test("bump: returns null for invalid level", () => {
  assert.equal(semver.bump("1.0.0", "unknown"), null);
});

// ---------------------------------------------------------------------------
// isValid
// ---------------------------------------------------------------------------

test("isValid: returns true for valid semver", () => {
  assert.equal(semver.isValid("1.0.0"), true);
  assert.equal(semver.isValid("0.0.0"), true);
  assert.equal(semver.isValid("1.2.3-alpha"), true);
  assert.equal(semver.isValid("1.2.3-alpha.1.beta"), true);
  assert.equal(semver.isValid("1.2.3+build"), true);
});

test("isValid: returns false for invalid semver", () => {
  assert.equal(semver.isValid("1"), false);
  assert.equal(semver.isValid("1.0"), false);
  assert.equal(semver.isValid("not.a.version"), false);
  assert.equal(semver.isValid(""), false);
  assert.equal(semver.isValid(null), false);
});

// ---------------------------------------------------------------------------
// coerce
// ---------------------------------------------------------------------------

test("coerce: coerces loose version strings", () => {
  assert.equal(semver.coerce("v1.2"), "1.2.0");
  assert.equal(semver.coerce("1"), "1.0.0");
  assert.equal(semver.coerce("1.2.3"), "1.2.3");
  assert.equal(semver.coerce("=1.2.3"), "1.2.3");
  assert.equal(semver.coerce(" 1.2.3 "), "1.2.3");
  assert.equal(semver.coerce("V2.1"), "2.1.0");
});

test("coerce: preserves pre-release when possible", () => {
  assert.equal(semver.coerce("1.2.3-alpha"), "1.2.3-alpha");
  assert.equal(semver.coerce("1.2.3-beta.2"), "1.2.3-beta.2");
});

test("coerce: returns null for unparseable input", () => {
  assert.equal(semver.coerce("not-a-version"), null);
  assert.equal(semver.coerce(""), null);
  assert.equal(semver.coerce(null), null);
  assert.equal(semver.coerce(undefined), null);
});
