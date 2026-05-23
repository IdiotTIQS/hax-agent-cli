"use strict";

/**
 * semver.js — Full SemVer 2.0.0 utilities for version parsing, comparison,
 * range satisfaction, diffing, bumping, validation, and coercion.
 *
 *   const semver = require("./versioning/semver");
 *   semver.parse("1.2.3-alpha.1+build.123");
 *   semver.compare("1.2.3", "1.3.0");        // -1
 *   semver.satisfies("1.2.3", "^1.0.0");     // true
 *   semver.diff("1.0.0", "2.0.0");           // "MAJOR"
 *   semver.bump("1.2.3", "minor");           // "1.3.0"
 *   semver.isValid("1.2.3-alpha");           // true
 *   semver.coerce("v1.2");                   // "1.2.0"
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SEMVER_RE =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * Compare two arrays of pre-release identifiers element by element.
 * Numeric identifiers compare numerically; alphanumeric compare lexically.
 * Having a pre-release gives LOWER precedence than not having one.
 */
function comparePre(a, b) {
  // No pre-release has higher precedence than having one
  if (!a && !b) return 0;
  if (!a && b) return 1;
  if (a && !b) return -1;

  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const aNum = Number(a[i]);
    const bNum = Number(b[i]);
    const aIsNum = !Number.isNaN(aNum);
    const bIsNum = !Number.isNaN(bNum);

    if (aIsNum && bIsNum) {
      if (aNum !== bNum) return aNum < bNum ? -1 : 1;
    } else if (aIsNum && !bIsNum) {
      return -1; // numeric < alphanumeric
    } else if (!aIsNum && bIsNum) {
      return 1; // alphanumeric > numeric
    } else {
      // Both alphanumeric — lexical compare
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
  }

  // All compared elements are equal; longer pre-release has higher precedence
  if (a.length < b.length) return -1;
  if (a.length > b.length) return 1;
  return 0;
}

/**
 * Parse a version string into components.
 *
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number, pre: string[]|null, build: string[]|null, raw: string } | null}
 */
function parse(version) {
  if (typeof version !== "string") return null;
  const match = version.match(SEMVER_RE);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split(".") : null,
    build: match[5] ? match[5].split(".") : null,
    raw: version,
  };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Compare two version strings per SemVer 2.0.0 rules.
 *
 * @param {string} a  First version string
 * @param {string} b  Second version string
 * @returns {number} -1 if a < b, 0 if equal, 1 if a > b
 */
function compare(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;

  return comparePre(pa.pre, pb.pre);
}

// ---------------------------------------------------------------------------
// Range satisfaction
// ---------------------------------------------------------------------------

/**
 * Check whether a version satisfies a semver range expression.
 *
 * Supported operators:
 *   - Caret ^1.2.3   — compatible with 1.2.3, <2.0.0
 *   - Tilde ~1.2.3   — approximately equivalent to 1.2.3, <1.3.0
 *   - >=1.2.3        — greater than or equal
 *   - <=1.2.3        — less than or equal
 *   - >1.2.3         — greater than
 *   - <1.2.3         — less than
 *   - 1.2.3          — exact match
 *   - 1.2.x / 1.x   — wildcard (x or * matches any)
 *   - Multiple ||    — OR combination
 *   - Multiple spaces — AND combination
 *
 * @param {string} version  Concrete version string
 * @param {string} range    Range expression
 * @returns {boolean}
 */
function satisfies(version, range) {
  if (typeof version !== "string" || typeof range !== "string") return false;

  // Trim and handle OR (||) — version satisfies any one of the sets
  const trimmed = range.trim();
  if (trimmed.includes("||")) {
    return trimmed
      .split("||")
      .map((s) => s.trim())
      .some((r) => satisfiesVersionSet(version, r));
  }

  return satisfiesVersionSet(version, trimmed);
}

/**
 * Check a single AND version set (space-separated comparators).
 */
function satisfiesVersionSet(version, set) {
  if (!set) return false;
  const comparators = set.trim().split(/\s+/).filter(Boolean);

  for (const comp of comparators) {
    if (!satisfiesSingle(version, comp)) return false;
  }
  return true;
}

/**
 * Check a single comparator/range expression against a version.
 */
function satisfiesSingle(version, comp) {
  const ver = parse(version);
  if (!ver) return false;

  // Wildcard range: 1.x, 1.2.x, 1.2.*, *, etc.
  if (comp.includes("x") || comp.includes("*") || comp === "*" || comp === "latest") {
    return satisfiesWildcard(ver, comp);
  }

  // Exact: starts with digit, no prefix operators
  if (/^\d/.test(comp)) {
    const exact = comp;
    // Strip leading 'v' if present
    const cleaned = exact.replace(/^v/, "");
    if (/^\d+\.\d+\.\d+/.test(cleaned) && !cleaned.startsWith(">") && !cleaned.startsWith("<") && !cleaned.startsWith("^") && !cleaned.startsWith("~")) {
      const parsed = parse(cleaned);
      if (!parsed) return false;
      return ver.major === parsed.major && ver.minor === parsed.minor && ver.patch === parsed.patch;
    }
  }

  // Caret ^1.2.3
  if (comp.startsWith("^")) {
    return satisfiesCaret(ver, comp.slice(1));
  }

  // Tilde ~1.2.3
  if (comp.startsWith("~")) {
    return satisfiesTilde(ver, comp.slice(1));
  }

  // >=1.2.3
  if (comp.startsWith(">=")) {
    const base = parse(comp.slice(2));
    if (!base) return false;
    return compare(version, comp.slice(2)) >= 0;
  }

  // <=1.2.3
  if (comp.startsWith("<=")) {
    const base = parse(comp.slice(2));
    if (!base) return false;
    return compare(version, comp.slice(2)) <= 0;
  }

  // >1.2.3
  if (comp.startsWith(">")) {
    const base = parse(comp.slice(1));
    if (!base) return false;
    return compare(version, comp.slice(1)) > 0;
  }

  // <1.2.3
  if (comp.startsWith("<")) {
    const base = parse(comp.slice(1));
    if (!base) return false;
    return compare(version, comp.slice(1)) < 0;
  }

  return false;
}

/**
 * Caret satisfaction: ^1.2.3 means >=1.2.3 <2.0.0
 * Special cases for 0.x.y major.
 */
function satisfiesCaret(ver, range) {
  const base = parse(range);
  if (!base) return false;
  const cmp = compare(ver.raw, range);
  if (cmp < 0) return false;

  if (base.major === 0) {
    if (base.minor === 0) {
      // ^0.0.x: >=0.0.x <0.0.(x+1)
      return ver.major === 0 && ver.minor === 0 && ver.patch >= base.patch && ver.patch < base.patch + 1;
    }
    // ^0.x.y: >=0.x.y <0.(x+1).0
    return ver.major === 0 && ver.minor >= base.minor && ver.minor < base.minor + 1;
  }
  // ^x.y.z: >=x.y.z <(x+1).0.0
  return ver.major >= base.major && ver.major < base.major + 1;
}

/**
 * Tilde satisfaction: ~1.2.3 means >=1.2.3 <1.3.0
 */
function satisfiesTilde(ver, range) {
  const base = parse(range);
  if (!base) return false;
  const cmp = compare(ver.raw, range);
  if (cmp < 0) return false;
  return ver.major === base.major && ver.minor >= base.minor && ver.minor < base.minor + 1;
}

/**
 * Wildcard satisfaction: 1.x, 1.2.x, 1.*, *, x.x.x
 */
function satisfiesWildcard(ver, wildcard) {
  if (wildcard === "*" || wildcard === "x" || wildcard === "latest") return true;
  // Normalize * to x for consistency
  const normalized = wildcard.replace(/\*/g, "x");
  const parts = normalized.split(".");
  if (parts.length > 3) return false;

  const majorOk = parts[0] === "x" || String(ver.major) === parts[0];
  if (!majorOk) return false;

  if (parts.length === 1) return true;

  const minorOk = parts[1] === "x" || String(ver.minor) === parts[1];
  if (!minorOk) return false;

  if (parts.length === 2) return true;

  const patchOk = parts[2] === "x" || String(ver.patch) === parts[2];
  return patchOk;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Determine the difference level between two versions.
 *
 * Returns one of:
 *   - "MAJOR"     — major version changed
 *   - "MINOR"     — only minor version changed
 *   - "PATCH"     — only patch version changed
 *   - "PRE"       — only pre-release changed (same MAJOR.MINOR.PATCH)
 *   - "PREPATCH"  — pre-release of the next patch (e.g. 1.2.3 → 1.2.4-alpha)
 *   - "PREMINOR"  — pre-release of the next minor
 *   - "PREMAJOR"  — pre-release of the next major
 *   - null         — versions are equal, or inputs are invalid
 *
 * @param {string} a
 * @param {string} b
 * @returns {string|null}
 */
function diff(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;

  const dir = compare(a, b);
  if (dir === 0) return null; // Same version

  // Swap so a is always the lower version
  const [from, to] = dir < 0 ? [pa, pb] : [pb, pa];

  if (from.major !== to.major) {
    // Check if to is a pre-release of the next major
    if (to.pre && to.major === from.major + 1 && to.minor === 0 && to.patch === 0) {
      return "PREMAJOR";
    }
    return "MAJOR";
  }

  if (from.minor !== to.minor) {
    if (to.pre && to.minor === from.minor + 1 && to.patch === 0) {
      return "PREMINOR";
    }
    return "MINOR";
  }

  if (from.patch !== to.patch) {
    if (to.pre && to.patch === from.patch + 1) {
      return "PREPATCH";
    }
    return "PATCH";
  }

  // Same MAJOR.MINOR.PATCH, different pre-release
  return "PRE";
}

// ---------------------------------------------------------------------------
// Bump
// ---------------------------------------------------------------------------

/**
 * Bump a version string at the specified level.
 *
 * @param {string} version   e.g. "1.2.3" or "1.2.3-alpha"
 * @param {string} level     One of: "major", "minor", "patch", "premajor", "preminor", "prepatch", "prerelease"
 * @param {string} [preid]  Pre-release identifier (defaults to "alpha")
 * @returns {string|null}    Bumped version, or null on invalid input
 */
function bump(version, level, preid) {
  const parsed = parse(version);
  if (!parsed) return null;

  const pre = preid || "alpha";
  const { major, minor, patch } = parsed;

  switch (level) {
    case "major":
      return formatVersion({ major: major + 1, minor: 0, patch: 0 });

    case "minor":
      return formatVersion({ major, minor: minor + 1, patch: 0 });

    case "patch":
      return formatVersion({ major, minor, patch: patch + 1 });

    case "premajor":
      return formatVersion({
        major: major + 1,
        minor: 0,
        patch: 0,
        pre: [pre, "0"],
      });

    case "preminor":
      return formatVersion({
        major,
        minor: minor + 1,
        patch: 0,
        pre: [pre, "0"],
      });

    case "prepatch":
      return formatVersion({
        major,
        minor,
        patch: patch + 1,
        pre: [pre, "0"],
      });

    case "prerelease": {
      if (!parsed.pre) {
        // No pre-release: bump patch and add pre
        return formatVersion({
          major,
          minor,
          patch: patch + 1,
          pre: [pre, "0"],
        });
      }
      // Has existing pre-release — increment the last numeric identifier
      const preParts = [...parsed.pre];
      const last = preParts[preParts.length - 1];
      const lastNum = Number(last);
      if (!Number.isNaN(lastNum)) {
        preParts[preParts.length - 1] = String(lastNum + 1);
      } else {
        preParts.push("0");
      }
      return formatVersion({ major, minor, patch, pre: preParts });
    }

    default:
      return null;
  }
}

/**
 * Format version components back into a string.
 */
function formatVersion(components) {
  let v = `${components.major}.${components.minor}.${components.patch}`;
  if (components.pre && components.pre.length > 0) {
    v += "-" + components.pre.join(".");
  }
  return v;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Check if a string is a valid semver version.
 *
 * @param {string} version
 * @returns {boolean}
 */
function isValid(version) {
  return parse(version) !== null;
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/**
 * Attempt to coerce a loose version string into a valid semver.
 *
 * Handles:
 *   - "v1.2"         → "1.2.0"
 *   - "1"            → "1.0.0"
 *   - "1.2.3-alpha"  → "1.2.3-alpha"
 *   - "=1.2.3"       → "1.2.3"
 *   - " 1.2.3 "      → "1.2.3"
 *
 * @param {string} input  Loose version string
 * @returns {string|null} Coerced semver string, or null if unparseable
 */
function coerce(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();

  // Try strict parse first
  if (isValid(trimmed)) return trimmed;

  // Remove leading 'v', '=', 'V'
  let cleaned = trimmed.replace(/^[vV=]/, "");

  // Try to extract version-like parts
  const looseMatch = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/);
  if (!looseMatch) return null;

  const major = Number(looseMatch[1]) || 0;
  const minor = looseMatch[2] !== undefined ? Number(looseMatch[2]) : 0;
  const patch = looseMatch[3] !== undefined ? Number(looseMatch[3]) : 0;
  const pre = looseMatch[4] || null;

  let result = `${major}.${minor}.${patch}`;
  if (pre) {
    // Validate pre-release characters
    const validPre = pre.split(".").every((id) => /^[0-9A-Za-z-]+$/.test(id));
    if (validPre) {
      result += "-" + pre;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  parse,
  compare,
  satisfies,
  diff,
  bump,
  isValid,
  coerce,
};
