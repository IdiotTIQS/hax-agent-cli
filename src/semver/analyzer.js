"use strict";

/**
 * SemverAnalyzer — Analyzes the impact of version changes.
 *
 * Classifies change impact, detects breaking changes, estimates migration
 * effort, generates migration guides, and performs quick safety checks.
 *
 *   const { SemverAnalyzer } = require("./semver/analyzer");
 *   const analyzer = new SemverAnalyzer();
 *   analyzer.analyzeChange("1.0.0", "2.0.0");
 */

const semver = require("../versioning/semver");

// ---------------------------------------------------------------------------
// Impact levels
// ---------------------------------------------------------------------------

const ImpactLevel = Object.freeze({
  PATCH: "PATCH",
  MINOR: "MINOR",
  MAJOR: "MAJOR",
  PRERELEASE: "PRERELEASE",
});

/**
 * Descriptions of breaking change categories that help estimate effort.
 */
const BREAKING_CATEGORIES = {
  API_REMOVED: {
    name: "api-removed",
    label: "Public API removed",
    baseEffort: "high",
  },
  API_CHANGED: {
    name: "api-changed",
    label: "Public API signature changed",
    baseEffort: "medium",
  },
  BEHAVIOR_CHANGED: {
    name: "behavior-changed",
    label: "Behavioral change in existing function",
    baseEffort: "medium",
  },
  DEPRECATION_REMOVED: {
    name: "deprecation-removed",
    label: "Previously deprecated feature removed",
    baseEffort: "medium",
  },
  DEPENDENCY_BUMP: {
    name: "dependency-bump",
    label: "Major dependency version bump",
    baseEffort: "low",
  },
  CONFIG_CHANGED: {
    name: "config-changed",
    label: "Configuration format changed",
    baseEffort: "medium",
  },
  DATA_MIGRATION: {
    name: "data-migration",
    label: "Data format or schema change",
    baseEffort: "high",
  },
  RENAMED: {
    name: "renamed",
    label: "Exports, files, or modules renamed",
    baseEffort: "low",
  },
};

/**
 * Impact analysis result structure:
 *   {
 *     level,           // ImpactLevel
 *     isBreaking,      // boolean
 *     isSafe,          // boolean
 *     breakingChanges, // array of detected categories
 *     migrationEffort, // { level: string, hours: number, tasks: number }
 *     guide            // array of migration steps
 *   }
 */

// ---------------------------------------------------------------------------
// SemverAnalyzer
// ---------------------------------------------------------------------------

class SemverAnalyzer {
  /**
   * @param {object} [options]
   * @param {object} [options.breakingChanges] - Known breaking changes per version
   * @param {object} [options.migrationGuides] - Pre-written migration guides per version
   */
  constructor(options) {
    const opts = options || {};
    this._breakingChanges = opts.breakingChanges || Object.create(null);
    this._migrationGuides = opts.migrationGuides || Object.create(null);
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register known breaking changes for a version transition.
   *
   * @param {string} fromVersion - Source version
   * @param {string} toVersion   - Target version
   * @param {Array<object>} changes - Array of { category, description, effort }
   */
  registerBreakingChanges(fromVersion, toVersion, changes) {
    const key = `${fromVersion}->${toVersion}`;
    if (!this._breakingChanges[key]) {
      this._breakingChanges[key] = [];
    }
    this._breakingChanges[key].push(...changes);
  }

  /**
   * Register a pre-written migration guide for a version transition.
   *
   * @param {string} fromVersion
   * @param {string} toVersion
   * @param {Array<object>} steps - Array of { step, action, details }
   */
  registerMigrationGuide(fromVersion, toVersion, steps) {
    const key = `${fromVersion}->${toVersion}`;
    this._migrationGuides[key] = steps;
  }

  // -------------------------------------------------------------------------
  // analyzeChange
  // -------------------------------------------------------------------------

  /**
   * Classify the impact of changing from one version to another.
   *
   * @param {string} fromVersion
   * @param {string} toVersion
   * @returns {object} Impact analysis result
   */
  analyzeChange(fromVersion, toVersion) {
    if (typeof fromVersion !== "string" || typeof toVersion !== "string") {
      return this._invalidResult("Invalid version strings provided.");
    }

    const from = semver.parse(fromVersion);
    const to = semver.parse(toVersion);

    if (!from) {
      return this._invalidResult(`Invalid source version: "${fromVersion}"`);
    }
    if (!to) {
      return this._invalidResult(`Invalid target version: "${toVersion}"`);
    }

    const cmp = semver.compare(fromVersion, toVersion);
    if (cmp === 0) {
      return {
        level: ImpactLevel.PATCH,
        isBreaking: false,
        isSafe: true,
        fromVersion,
        toVersion,
        direction: "same",
        diff: null,
        breakingChanges: [],
        migrationEffort: { level: "none", hours: 0, tasks: 0 },
        guide: [],
        summary: "Versions are identical — no change needed.",
      };
    }

    if (cmp > 0) {
      return {
        level: ImpactLevel.MAJOR,
        isBreaking: true,
        isSafe: false,
        fromVersion,
        toVersion,
        direction: "downgrade",
        diff: null,
        breakingChanges: [],
        migrationEffort: { level: "unknown", hours: 0, tasks: 0 },
        guide: [],
        summary: `Downgrading from ${fromVersion} to ${toVersion} is not recommended.`,
      };
    }

    const diff = semver.diff(fromVersion, toVersion);

    let level;
    let isBreaking = false;
    let isSafe = true;

    switch (diff) {
      case "MAJOR":
      case "PREMAJOR":
        level = ImpactLevel.MAJOR;
        isBreaking = true;
        isSafe = false;
        break;
      case "MINOR":
      case "PREMINOR":
        level = ImpactLevel.MINOR;
        isBreaking = false;
        isSafe = true;
        break;
      case "PATCH":
      case "PREPATCH":
        level = ImpactLevel.PATCH;
        isBreaking = false;
        isSafe = true;
        break;
      case "PRE":
        level = ImpactLevel.PRERELEASE;
        isBreaking = false;
        isSafe = false;
        break;
      default:
        level = ImpactLevel.PATCH;
        break;
    }

    const breakingChanges = this.detectBreakingChanges(fromVersion, toVersion);
    const migrationEffort = this.estimateMigrationEffort(fromVersion, toVersion);
    const guide = this.getMigrationGuide(fromVersion, toVersion);

    // Override isBreaking if registered breaking changes exist for a patch/minor
    if (!isBreaking && breakingChanges.length > 0) {
      isBreaking = true;
      isSafe = false;
    }

    return {
      level,
      isBreaking,
      isSafe,
      fromVersion,
      toVersion,
      direction: "upgrade",
      diff,
      breakingChanges,
      migrationEffort,
      guide,
      summary: this._buildSummary(level, isBreaking, diff, fromVersion, toVersion),
    };
  }

  // -------------------------------------------------------------------------
  // detectBreakingChanges
  // -------------------------------------------------------------------------

  /**
   * Identify breaking changes between two versions.
   *
   * @param {string} from - Source version
   * @param {string} to   - Target version
   * @returns {Array<object>} Detected breaking changes
   */
  detectBreakingChanges(from, to) {
    const diff = semver.diff(from, to);

    if (!diff) return [];

    const detected = [];

    // Heuristic detection based on version diff
    if (diff === "MAJOR" || diff === "PREMAJOR") {
      const parsedFrom = semver.parse(from);
      const parsedTo = semver.parse(to);

      if (parsedFrom && parsedTo) {
        if (parsedFrom.major !== parsedTo.major) {
          detected.push({
            category: BREAKING_CATEGORIES.API_REMOVED.name,
            label: BREAKING_CATEGORIES.API_REMOVED.label,
            description: `Major version bump from ${parsedFrom.major}.x to ${parsedTo.major}.x — the public API likely has breaking changes.`,
            effort: BREAKING_CATEGORIES.API_REMOVED.baseEffort,
          });
        }
      }

      // If pre-release of next major, include pre-release warning
      if (diff === "PREMAJOR") {
        detected.push({
          category: BREAKING_CATEGORIES.BEHAVIOR_CHANGED.name,
          label: BREAKING_CATEGORIES.BEHAVIOR_CHANGED.label,
          description: `Pre-release of next major version — API may be unstable and subject to further change.`,
          effort: BREAKING_CATEGORIES.BEHAVIOR_CHANGED.baseEffort,
        });
      }
    }

    // Check for registered breaking changes
    const key = `${from}->${to}`;
    if (this._breakingChanges[key]) {
      detected.push(...this._breakingChanges[key]);
    }

    // For PREMINOR / PREPATCH — note pre-release instability
    if (diff === "PREMINOR" || diff === "PREPATCH" || diff === "PRE") {
      detected.push({
        category: BREAKING_CATEGORIES.BEHAVIOR_CHANGED.name,
        label: BREAKING_CATEGORIES.BEHAVIOR_CHANGED.label,
        description: "This is a pre-release version — behavior may change before the final release.",
        effort: "low",
      });
    }

    return detected;
  }

  // -------------------------------------------------------------------------
  // estimateMigrationEffort
  // -------------------------------------------------------------------------

  /**
   * Estimate the amount of work required to migrate between versions.
   *
   * @param {string} from - Source version
   * @param {string} to   - Target version
   * @returns {{ level: string, hours: number, tasks: number }}
   */
  estimateMigrationEffort(from, to) {
    const parsedFrom = semver.parse(from);
    const parsedTo = semver.parse(to);

    if (!parsedFrom || !parsedTo) {
      return { level: "unknown", hours: 0, tasks: 0 };
    }

    const diff = semver.diff(from, to);
    const cmp = semver.compare(from, to);

    if (cmp === 0) {
      return { level: "none", hours: 0, tasks: 0 };
    }

    if (cmp > 0) {
      return { level: "unknown", hours: 0, tasks: 0 };
    }

    // Major gap estimation
    const majorGap = parsedTo.major - parsedFrom.major;
    const minorGap = parsedTo.minor - parsedFrom.minor;
    const patchGap = parsedTo.patch - parsedFrom.patch;

    // Count registered breaking changes for additional effort
    const key = `${from}->${to}`;
    const registeredBreaks = (this._breakingChanges[key] || []).length;

    switch (diff) {
      case "MAJOR": {
        // Each major version ~ 8-40 hours of migration
        const baseHours = majorGap * 16;
        const taskCount = Math.max(1, majorGap * 3 + registeredBreaks);
        let level = "low";
        if (majorGap >= 3) level = "high";
        else if (majorGap >= 2) level = "medium";

        return {
          level,
          hours: baseHours + registeredBreaks * 2,
          tasks: taskCount,
        };
      }

      case "PREMAJOR": {
        return {
          level: "medium",
          hours: 8 + registeredBreaks * 2,
          tasks: Math.max(1, 2 + registeredBreaks),
        };
      }

      case "MINOR": {
        return {
          level: "low",
          hours: minorGap * 1 + registeredBreaks * 1,
          tasks: Math.max(1, minorGap + registeredBreaks),
        };
      }

      case "PREMINOR": {
        return {
          level: "low",
          hours: 2 + registeredBreaks,
          tasks: Math.max(1, 1 + registeredBreaks),
        };
      }

      case "PATCH": {
        return {
          level: "none",
          hours: 0.25 + registeredBreaks * 0.5,
          tasks: registeredBreaks > 0 ? registeredBreaks : 0,
        };
      }

      case "PREPATCH": {
        return {
          level: "none",
          hours: 0.5 + registeredBreaks * 0.5,
          tasks: registeredBreaks > 0 ? registeredBreaks : 0,
        };
      }

      case "PRE": {
        return {
          level: "low",
          hours: 1,
          tasks: 1,
        };
      }

      default: {
        return { level: "unknown", hours: 0, tasks: 0 };
      }
    }
  }

  // -------------------------------------------------------------------------
  // getMigrationGuide
  // -------------------------------------------------------------------------

  /**
   * Generate a step-by-step migration guide between two versions.
   *
   * @param {string} from - Source version
   * @param {string} to   - Target version
   * @returns {Array<object>} Migration steps
   */
  getMigrationGuide(from, to) {
    const key = `${from}->${to}`;

    // Return pre-registered guide if available
    if (this._migrationGuides[key]) {
      return this._migrationGuides[key];
    }

    const diff = semver.diff(from, to);

    if (!diff) {
      return [{ step: 1, action: "none", details: "No migration needed." }];
    }

    const parsedFrom = semver.parse(from);
    const parsedTo = semver.parse(to);
    const steps = [];

    // Generate guide based on diff type
    switch (diff) {
      case "MAJOR":
        steps.push({
          step: 1,
          action: "review-changelog",
          details: `Review the changelog for all versions between ${from} and ${to}. Pay special attention to breaking changes.`,
        });
        steps.push({
          step: 2,
          action: "update-dependencies",
          details: `Update all imports and references from v${parsedFrom.major}.x to v${parsedTo.major}.x.`,
        });
        steps.push({
          step: 3,
          action: "migrate-api",
          details: "Replace removed or changed API calls with their new equivalents. Check for renamed exports and changed function signatures.",
        });
        steps.push({
          step: 4,
          action: "update-config",
          details: "Review configuration files for any format changes. Update config schemas if needed.",
        });
        steps.push({
          step: 5,
          action: "run-tests",
          details: "Run your full test suite. Fix any failing tests caused by API changes.",
        });
        steps.push({
          step: 6,
          action: "update-docs",
          details: "Update any internal documentation referencing the old API or version.",
        });
        break;

      case "PREMAJOR":
        steps.push({
          step: 1,
          action: "review-changelog",
          details: `Review the pre-release notes for ${to}. Note that APIs in pre-release may still change.`,
        });
        steps.push({
          step: 2,
          action: "test-integration",
          details: "Test your integration thoroughly. Report any issues to the maintainers as this is a pre-release.",
        });
        steps.push({
          step: 3,
          action: "prepare-rollback",
          details: "Have a rollback plan ready. Pre-release versions may introduce breaking changes before final release.",
        });
        break;

      case "MINOR":
        steps.push({
          step: 1,
          action: "review-changelog",
          details: `Review the changelog for new features added between ${from} and ${to}.`,
        });
        steps.push({
          step: 2,
          action: "check-deprecations",
          details: "Check for any new deprecation warnings. Address them proactively to ease future major upgrades.",
        });
        steps.push({
          step: 3,
          action: "run-tests",
          details: "Run your test suite to verify compatibility with the new minor version.",
        });
        break;

      case "PREMINOR":
        steps.push({
          step: 1,
          action: "review-notes",
          details: `Review the pre-release notes for ${to}. This minor version is still in pre-release.`,
        });
        steps.push({
          step: 2,
          action: "test-new-features",
          details: "Test new features in a non-production environment.",
        });
        break;

      case "PATCH":
        steps.push({
          step: 1,
          action: "review-changelog",
          details: `Review the changelog for bug fixes between ${from} and ${to}.`,
        });
        steps.push({
          step: 2,
          action: "update",
          details: `Update from ${from} to ${to}. No API changes expected.`,
        });
        steps.push({
          step: 3,
          action: "run-tests",
          details: "Run your test suite to verify the update does not introduce regressions.",
        });
        break;

      case "PREPATCH":
        steps.push({
          step: 1,
          action: "review-notes",
          details: `Review the pre-release patch notes for ${to}.`,
        });
        steps.push({
          step: 2,
          action: "update",
          details: `Update to ${to} in a non-production environment first.`,
        });
        break;

      case "PRE":
        steps.push({
          step: 1,
          action: "compare-pre-releases",
          details: `Compare the pre-release tags: ${from} to ${to}. Check what changed between these pre-release versions.`,
        });
        break;

      default:
        steps.push({
          step: 1,
          action: "unknown",
          details: `Could not determine migration steps for change from ${from} to ${to}.`,
        });
        break;
    }

    return steps;
  }

  // -------------------------------------------------------------------------
  // isSafeUpgrade
  // -------------------------------------------------------------------------

  /**
   * Quick safety check — returns true if the upgrade is likely safe and
   * should not introduce breaking changes.
   *
   * @param {string} from - Source version
   * @param {string} to   - Target version
   * @returns {boolean}
   */
  isSafeUpgrade(from, to) {
    const analysis = this.analyzeChange(from, to);
    return analysis.isSafe;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  _invalidResult(reason) {
    return {
      level: null,
      isBreaking: false,
      isSafe: false,
      fromVersion: null,
      toVersion: null,
      direction: "invalid",
      diff: null,
      breakingChanges: [],
      migrationEffort: { level: "unknown", hours: 0, tasks: 0 },
      guide: [],
      summary: reason,
    };
  }

  _buildSummary(level, isBreaking, diff, fromVersion, toVersion) {
    if (isBreaking) {
      return `Version change from ${fromVersion} to ${toVersion} is BREAKING (${diff}). Manual migration required.`;
    }
    switch (level) {
      case ImpactLevel.MINOR:
        return `Version change from ${fromVersion} to ${toVersion} is SAFE (${diff}). New features added, no breaking changes expected.`;
      case ImpactLevel.PATCH:
        return `Version change from ${fromVersion} to ${toVersion} is SAFE (${diff}). Bug fixes only, no breaking changes.`;
      case ImpactLevel.PRERELEASE:
        return `Version change from ${fromVersion} to ${toVersion} is a PRE-RELEASE change (${diff}). Behavior may be unstable.`;
      default:
        return `Version change from ${fromVersion} to ${toVersion} (${diff}).`;
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  SemverAnalyzer,
  ImpactLevel,
  BREAKING_CATEGORIES,
};
