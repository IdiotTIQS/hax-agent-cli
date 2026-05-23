"use strict";

/**
 * ConstraintSolver — Resolves semver version constraints, finds satisfying
 * versions, detects impossible constraints, suggests conflict resolutions,
 * and optimizes version ranges.
 *
 *   const { ConstraintSolver } = require("./semver/constraints");
 *   const solver = new ConstraintSolver();
 *   solver.resolve([">=1.0.0", "<2.0.0"]);
 */

const semver = require("../versioning/semver");

// ---------------------------------------------------------------------------
// Constraint types
// ---------------------------------------------------------------------------

const ConstraintType = Object.freeze({
  CARET: "caret",
  TILDE: "tilde",
  GREATER_EQ: ">=",
  LESS_EQ: "<=",
  GREATER: ">",
  LESS: "<",
  EXACT: "exact",
  WILDCARD: "wildcard",
  ANY: "any",
  HYPHEN: "hyphen",
});

/**
 * Parse a single constraint string into a structured object.
 *
 * @param {string} raw - Constraint string (e.g. "^1.2.3", ">=1.0.0", "1.x")
 * @returns {{ type: string, version: string|null, raw: string } | null}
 */
function parseConstraint(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Any / latest
  if (trimmed === "*" || trimmed === "x" || trimmed === "latest" || trimmed === "") {
    return { type: ConstraintType.ANY, version: null, raw: trimmed };
  }

  // Caret: ^1.2.3
  if (trimmed.startsWith("^")) {
    const ver = trimmed.slice(1);
    return { type: ConstraintType.CARET, version: ver, raw: trimmed };
  }

  // Tilde: ~1.2.3
  if (trimmed.startsWith("~")) {
    const ver = trimmed.slice(1);
    return { type: ConstraintType.TILDE, version: ver, raw: trimmed };
  }

  // Greater or equal: >=1.2.3
  if (trimmed.startsWith(">=")) {
    const ver = trimmed.slice(2);
    return { type: ConstraintType.GREATER_EQ, version: ver, raw: trimmed };
  }

  // Less or equal: <=1.2.3
  if (trimmed.startsWith("<=")) {
    const ver = trimmed.slice(2);
    return { type: ConstraintType.LESS_EQ, version: ver, raw: trimmed };
  }

  // Greater: >1.2.3
  if (trimmed.startsWith(">")) {
    const ver = trimmed.slice(1);
    return { type: ConstraintType.GREATER, version: ver, raw: trimmed };
  }

  // Less: <1.2.3
  if (trimmed.startsWith("<")) {
    const ver = trimmed.slice(1);
    return { type: ConstraintType.LESS, version: ver, raw: trimmed };
  }

  // Hyphen range: 1.2.3 - 2.3.4
  if (trimmed.includes(" - ")) {
    const parts = trimmed.split(/\s+-\s+/);
    if (parts.length === 2) {
      return { type: ConstraintType.HYPHEN, version: parts[0], to: parts[1], raw: trimmed };
    }
  }

  // =1.2.3 (explicit equal)
  if (trimmed.startsWith("=")) {
    const ver = trimmed.slice(1);
    return { type: ConstraintType.EXACT, version: ver, raw: trimmed };
  }

  // Wildcard: 1.x, 1.2.x, 1.2.*
  if (trimmed.includes("x") || trimmed.includes("*")) {
    return { type: ConstraintType.WILDCARD, version: trimmed, raw: trimmed };
  }

  // Exact version (starts with digit)
  if (/^v?\d/.test(trimmed)) {
    const clean = trimmed.replace(/^v/, "");
    return { type: ConstraintType.EXACT, version: clean, raw: trimmed };
  }

  return null;
}

/**
 * Get the lower bound version from a parsed constraint.
 */
function constraintLowerBound(parsed) {
  if (!parsed) return null;

  switch (parsed.type) {
    case ConstraintType.ANY:
      return "0.0.0";
    case ConstraintType.CARET:
      return parsed.version;
    case ConstraintType.TILDE:
      return parsed.version;
    case ConstraintType.GREATER_EQ:
      return parsed.version;
    case ConstraintType.GREATER:
      return semver.bump(parsed.version, "patch") || parsed.version;
    case ConstraintType.LESS_EQ:
      return "0.0.0";
    case ConstraintType.LESS:
      return "0.0.0";
    case ConstraintType.EXACT:
      return parsed.version;
    case ConstraintType.WILDCARD: {
      const filled = parsed.version.replace(/[x*]/g, "0").replace(/\.$/, "");
      return semver.coerce(filled) || filled;
    }
    case ConstraintType.HYPHEN:
      return parsed.version;
    default:
      return null;
  }
}

/**
 * Get the upper bound version from a parsed constraint.
 */
function constraintUpperBound(parsed) {
  if (!parsed) return null;

  switch (parsed.type) {
    case ConstraintType.ANY:
      return null; // unbounded
    case ConstraintType.CARET: {
      const base = semver.parse(parsed.version);
      if (!base) return null;
      if (base.major === 0 && base.minor === 0) {
        return `${base.major}.${base.minor}.${base.patch + 1}`;
      }
      if (base.major === 0) {
        return `${base.major}.${base.minor + 1}.0`;
      }
      return `${base.major + 1}.0.0`;
    }
    case ConstraintType.TILDE: {
      const base = semver.parse(parsed.version);
      if (!base) return null;
      return `${base.major}.${base.minor + 1}.0`;
    }
    case ConstraintType.GREATER_EQ:
      return null; // unbounded
    case ConstraintType.GREATER:
      return null; // unbounded
    case ConstraintType.LESS_EQ:
      return parsed.version;
    case ConstraintType.LESS:
      return parsed.version;
    case ConstraintType.EXACT:
      return parsed.version;
    case ConstraintType.WILDCARD: {
      const parts = parsed.version.replace(/\*/g, "x").split(".");
      const major = parts[0] === "x" ? "Infinity" : parts[0];
      const minor = parts[1] === "x" ? "Infinity" : (parseInt(parts[1], 10) + 1).toString();
      const patch = parts[2] === "x" ? "0" : "0";
      return `${major !== "Infinity" ? major : "∞"}.${minor !== "Infinity" ? minor : "∞"}.${patch}`;
    }
    case ConstraintType.HYPHEN:
      return parsed.to;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// ConstraintSolver
// ---------------------------------------------------------------------------

class ConstraintSolver {
  constructor() {
    // no config needed
  }

  // -------------------------------------------------------------------------
  // resolve
  // -------------------------------------------------------------------------

  /**
   * Resolve a set of version constraints. Returns the intersection of all
   * constraints as a version range.
   *
   * @param {Array<string>} constraints - Array of constraint strings
   * @returns {{ lower: string|null, upper: string|null, inclusive: boolean, anySatisfying: string|null, allSatisfied: boolean, conflicts: Array<object> }}
   */
  resolve(constraints) {
    if (!Array.isArray(constraints) || constraints.length === 0) {
      return {
        lower: null,
        upper: null,
        inclusive: false,
        anySatisfying: null,
        allSatisfied: false,
        conflicts: [{ message: "No constraints provided." }],
      };
    }

    let lower = "0.0.0";
    let upper = null; // null = infinity
    let inclusiveLower = true;
    const conflicts = [];

    for (const raw of constraints) {
      const parsed = parseConstraint(raw);
      if (!parsed) {
        conflicts.push({
          constraint: raw,
          message: `Unable to parse constraint: "${raw}"`,
        });
        continue;
      }

      const cLower = constraintLowerBound(parsed);
      const cUpper = constraintUpperBound(parsed);

      // Update lower bound (take the maximum)
      if (cLower) {
        const cmp = semver.compare(cLower, lower);
        if (cmp > 0) {
          lower = cLower;
          inclusiveLower = parsed.type === ConstraintType.GREATER_EQ ||
            parsed.type === ConstraintType.EXACT ||
            parsed.type === ConstraintType.CARET ||
            parsed.type === ConstraintType.TILDE ||
            parsed.type === ConstraintType.HYPHEN;
        }
      }

      // Update upper bound (take the minimum)
      if (cUpper) {
        if (upper === null) {
          upper = cUpper;
        } else {
          const cmp = semver.compare(cUpper, upper);
          if (cmp < 0) {
            upper = cUpper;
          }
        }
      }
    }

    // Check for conflicts: lower > upper
    let allSatisfied = true;
    if (upper !== null) {
      const cmp = semver.compare(lower, upper);
      if (cmp > 0) {
        allSatisfied = false;
        conflicts.push({
          constraint: `lower=${lower}, upper=${upper}`,
          message: `Lower bound ${lower} exceeds upper bound ${upper}. No version can satisfy these constraints.`,
        });
      } else if (cmp === 0 && !inclusiveLower) {
        allSatisfied = false;
        conflicts.push({
          constraint: `lower=${lower}, upper=${upper}`,
          message: `Lower bound ${lower} equals upper bound ${upper} but lower bound is exclusive. No version satisfies.`,
        });
      }
    }

    const anySatisfying = allSatisfied ? lower : null;

    return {
      lower,
      upper,
      inclusive: inclusiveLower,
      anySatisfying,
      allSatisfied,
      conflicts,
    };
  }

  // -------------------------------------------------------------------------
  // findSatisfying
  // -------------------------------------------------------------------------

  /**
   * Find all versions from a list that satisfy a given constraint.
   *
   * @param {string} constraint - Constraint string (e.g. "^1.2.0")
   * @param {Array<string>} versions - Array of version strings to check
   * @returns {{ satisfying: Array<string>, count: number, constraint: string }}
   */
  findSatisfying(constraint, versions) {
    if (!Array.isArray(versions)) {
      return { satisfying: [], count: 0, constraint };
    }

    const satisfying = versions.filter((v) => semver.satisfies(v, constraint));

    // Sort satisfying versions
    satisfying.sort(semver.compare);

    return {
      satisfying,
      count: satisfying.length,
      constraint,
    };
  }

  // -------------------------------------------------------------------------
  // isConflicting
  // -------------------------------------------------------------------------

  /**
   * Detect if a set of constraints are mutually impossible.
   *
   * @param {Array<string>} constraints - Array of constraint strings
   * @returns {{ conflicting: boolean, conflicts: Array<object> }}
   */
  isConflicting(constraints) {
    if (!Array.isArray(constraints) || constraints.length <= 1) {
      return { conflicting: false, conflicts: [] };
    }

    const conflicts = [];
    let conflicting = false;

    // Pairwise check: for each pair, see if they overlap
    for (let i = 0; i < constraints.length; i++) {
      for (let j = i + 1; j < constraints.length; j++) {
        const pairConflict = this._checkPairConflict(constraints[i], constraints[j]);
        if (pairConflict) {
          conflicting = true;
          conflicts.push(pairConflict);
        }
      }
    }

    return { conflicting, conflicts };
  }

  /**
   * Check if two individual constraints conflict.
   */
  _checkPairConflict(a, b) {
    const pa = parseConstraint(a);
    const pb = parseConstraint(b);
    if (!pa || !pb) return null;

    const aLower = constraintLowerBound(pa);
    const aUpper = constraintUpperBound(pa);
    const bLower = constraintLowerBound(pb);
    const bUpper = constraintUpperBound(pb);

    if (!aLower || !bLower) return null;

    // If both have upper bounds, check overlap
    if (aUpper && bUpper) {
      // The intervals are [aLower, aUpper) and [bLower, bUpper)
      // They don't overlap if aUpper <= bLower or bUpper <= aLower
      if (semver.compare(aUpper, bLower) <= 0) {
        return {
          constraints: [a, b],
          message: `Constraint "${a}" requires versions < ${aUpper}, but "${b}" requires versions >= ${bLower}. No overlap.`,
        };
      }
      if (semver.compare(bUpper, aLower) <= 0) {
        return {
          constraints: [a, b],
          message: `Constraint "${b}" requires versions < ${bUpper}, but "${a}" requires versions >= ${aLower}. No overlap.`,
        };
      }
    }

    // If one has upper bound and the other only a lower bound
    if (aUpper && !bUpper) {
      // a: < X, b: >= Y — conflict if X <= Y
      if (semver.compare(aUpper, bLower) <= 0) {
        return {
          constraints: [a, b],
          message: `Constraint "${a}" caps at ${aUpper}, but "${b}" starts at ${bLower}. No overlap.`,
        };
      }
    }

    if (!aUpper && bUpper) {
      if (semver.compare(bUpper, aLower) <= 0) {
        return {
          constraints: [a, b],
          message: `Constraint "${b}" caps at ${bUpper}, but "${a}" starts at ${aLower}. No overlap.`,
        };
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // suggestResolution
  // -------------------------------------------------------------------------

  /**
   * Suggest a resolution for a set of conflicting constraints.
   *
   * @param {Array<{ constraints: Array<string>, message: string }>} conflicts
   *   - Output from isConflicting()
   * @returns {Array<{ suggestion: string, action: string, detail: string }>}
   */
  suggestResolution(conflicts) {
    if (!Array.isArray(conflicts) || conflicts.length === 0) {
      return [];
    }

    const suggestions = [];

    for (const conflict of conflicts) {
      if (!conflict.constraints || conflict.constraints.length < 2) continue;

      const [a, b] = conflict.constraints;
      const pa = parseConstraint(a);
      const pb = parseConstraint(b);

      if (!pa || !pb) continue;

      const aLower = constraintLowerBound(pa);
      const bLower = constraintLowerBound(pb);

      if (!aLower || !bLower) continue;

      // Suggest widening constraints if they are version-locked
      if (pa.type === ConstraintType.EXACT || pa.type === ConstraintType.EXACT) {
        const higher = semver.compare(aLower, bLower) >= 0 ? aLower : bLower;
        suggestions.push({
          suggestion: `Use "^${higher}"`,
          action: "widen",
          detail: `Widen exact constraint "${a}" to "^${higher}" to allow more flexible resolution.`,
        });
      } else if (pa.type === ConstraintType.CARET && pb.type === ConstraintType.CARET) {
        // Two caret ranges with no overlap — suggest upgrading to a shared major
        const baseA = semver.parse(aLower);
        const baseB = semver.parse(bLower);
        if (baseA && baseB && baseA.major < baseB.major) {
          suggestions.push({
            suggestion: `Upgrade constraint "${a}" to "^${baseB.major}.0.0"`,
            action: "upgrade",
            detail: `Upgrade the lower constraint "${a}" to match the higher version range "${b}".`,
          });
        }
      } else {
        suggestions.push({
          suggestion: `Relax "${a}" to ">=${aLower}"`,
          action: "relax",
          detail: `Remove the upper bound from "${a}" to allow overlap with "${b}".`,
        });
      }
    }

    return suggestions;
  }

  // -------------------------------------------------------------------------
  // optimizeRange
  // -------------------------------------------------------------------------

  /**
   * Find the minimal range expression covering a set of versions.
   *
   * @param {Array<string>} versions - Array of version strings
   * @returns {{ range: string, type: string, versions: number }}
   */
  optimizeRange(versions) {
    if (!Array.isArray(versions) || versions.length === 0) {
      return { range: null, type: "empty", versions: 0 };
    }

    const sorted = [...versions]
      .filter((v) => semver.isValid(v))
      .sort(semver.compare);

    if (sorted.length === 0) {
      return { range: null, type: "invalid", versions: 0 };
    }

    if (sorted.length === 1) {
      return { range: sorted[0], type: "exact", versions: 1 };
    }

    const lowest = semver.parse(sorted[0]);
    const highest = semver.parse(sorted[sorted.length - 1]);

    if (!lowest || !highest) {
      return { range: null, type: "invalid", versions: sorted.length };
    }

    // Try to express as a wildcard: if all share the same major.minor, use x.x.x notation
    const majors = new Set();
    const minors = new Set();
    const patches = new Set();

    for (const v of sorted) {
      const p = semver.parse(v);
      if (!p) continue;
      majors.add(p.major);
      minors.add(p.minor);
      patches.add(p.patch);
    }

    // Try tilde first: ~1.2.3 covers >=1.2.3 <1.3.0 (same major.minor)
    if (majors.size === 1 && minors.size === 1) {
      return {
        range: `~${sorted[0]}`,
        type: "tilde",
        versions: sorted.length,
      };
    }

    // Try caret: ^1.2.3 covers >=1.2.3 <2.0.0 (same major, different minors)
    if (majors.size === 1 && minors.size > 1) {
      return {
        range: `^${sorted[0]}`,
        type: "caret",
        versions: sorted.length,
      };
    }

    // Fall back to >=X.Y.Z <X2.Y2.Z2 range expression
    const nextMajor = highest.major + 1;
    return {
      range: `>=${sorted[0]} <${nextMajor}.0.0`,
      type: "range",
      versions: sorted.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ConstraintSolver,
  ConstraintType,
  parseConstraint,
  constraintLowerBound,
  constraintUpperBound,
};
