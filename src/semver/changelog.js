"use strict";

/**
 * ChangelogGenerator — Generates changelogs from commit history, categorizes
 * changes by conventional commit types, formats in Keep a Changelog style,
 * suggests the next version based on changes, and validates format compliance.
 *
 *   const { ChangelogGenerator } = require("./semver/changelog");
 *   const gen = new ChangelogGenerator();
 *   gen.generate("1.0.0", "1.1.0", commits);
 */

const semver = require("../versioning/semver");

// ---------------------------------------------------------------------------
// Change types (Conventional Commits)
// ---------------------------------------------------------------------------

const ChangeType = Object.freeze({
  FEAT: "feat",
  FIX: "fix",
  BREAKING: "breaking",
  DOCS: "docs",
  STYLE: "style",
  REFACTOR: "refactor",
  PERF: "perf",
  TEST: "test",
  BUILD: "build",
  CI: "ci",
  CHORE: "chore",
  REVERT: "revert",
  OTHER: "other",
});

/**
 * Ordered sections for Keep a Changelog format.
 * Sections without entries are omitted.
 */
const CHANGELOG_SECTIONS = [
  { type: ChangeType.BREAKING, heading: "Breaking Changes" },
  { type: ChangeType.FEAT, heading: "Added" },
  { type: ChangeType.FIX, heading: "Fixed" },
  { type: ChangeType.PERF, heading: "Performance" },
  { type: ChangeType.DOCS, heading: "Documentation" },
  { type: ChangeType.STYLE, heading: "Styles" },
  { type: ChangeType.REFACTOR, heading: "Refactored" },
  { type: ChangeType.TEST, heading: "Tests" },
  { type: ChangeType.BUILD, heading: "Build System" },
  { type: ChangeType.CI, heading: "CI/CD" },
  { type: ChangeType.CHORE, heading: "Chores" },
  { type: ChangeType.REVERT, heading: "Reverts" },
  { type: ChangeType.OTHER, heading: "Other Changes" },
];

// Conventional commit regex
const CONVENTIONAL_RE =
  /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?\s*:\s*(?<description>.+)/;

const BREAKING_FOOTER_RE = /^BREAKING[-\s]CHANGE:\s*(.+)/im;

// ---------------------------------------------------------------------------
// ChangelogGenerator
// ---------------------------------------------------------------------------

class ChangelogGenerator {
  /**
   * @param {object} [options]
   * @param {string} [options.repoUrl] - Repository URL for linking commits
   * @param {boolean} [options.includeDate] - Include release date (default true)
   * @param {boolean} [options.includeCompare] - Include compare link (default true)
   */
  constructor(options) {
    const opts = options || {};
    this.repoUrl = opts.repoUrl || null;
    this.includeDate = opts.includeDate !== false;
    this.includeCompare = opts.includeCompare !== false;
  }

  // -------------------------------------------------------------------------
  // generate
  // -------------------------------------------------------------------------

  /**
   * Generate a full changelog from a list of commits between two versions.
   *
   * @param {string} fromVersion - Previous version
   * @param {string} toVersion   - New version
   * @param {Array<object>} commits - Array of { hash, message, author?, date? }
   * @returns {string} Formatted changelog for the version range
   */
  generate(fromVersion, toVersion, commits) {
    if (!Array.isArray(commits) || commits.length === 0) {
      return this._emptyChangelog(fromVersion, toVersion);
    }

    const categories = this.categorize(commits);
    return this.formatChangelog(categories, toVersion, fromVersion);
  }

  // -------------------------------------------------------------------------
  // categorize
  // -------------------------------------------------------------------------

  /**
   * Categorize commits by their conventional commit type.
   *
   * @param {Array<object>} commits - Array of { hash, message, author?, date? }
   * @returns {object} Map of ChangeType → array of categorized entries
   */
  categorize(commits) {
    const categories = Object.create(null);

    // Initialize all categories with empty arrays
    for (const type of Object.values(ChangeType)) {
      categories[type] = [];
    }

    for (const commit of commits) {
      if (!commit || typeof commit.message !== "string") continue;

      const entry = this._parseCommit(commit);
      categories[entry.type].push(entry);

      // If the commit has a breaking change, also add to breaking category
      if (entry.isBreaking && entry.type !== ChangeType.BREAKING) {
        categories[ChangeType.BREAKING].push({
          ...entry,
          type: ChangeType.BREAKING,
          description: entry.description,
          note: `(from ${entry.hash ? entry.hash.substring(0, 7) : "commit"})`,
        });
      }
    }

    return categories;
  }

  // -------------------------------------------------------------------------
  // formatChangelog
  // -------------------------------------------------------------------------

  /**
   * Format categorized changes into a Keep a Changelog style string.
   *
   * @param {object} categories - Map of ChangeType → entries
   * @param {string} [version]  - Version being released
   * @param {string} [previous] - Previous version for compare link
   * @returns {string} Formatted changelog
   */
  formatChangelog(categories, version, previous) {
    const lines = [];

    // Header
    if (version) {
      let header = `## [${version}]`;
      if (this.includeDate) {
        header += ` - ${this._todayISO()}`;
      }
      lines.push(header);
      lines.push("");
    }

    let hasAnyContent = false;

    // Body — render each section in order
    for (const section of CHANGELOG_SECTIONS) {
      const entries = categories[section.type];
      if (!entries || entries.length === 0) continue;

      lines.push(`### ${section.heading}`);
      lines.push("");

      for (const entry of entries) {
        lines.push(this._formatEntry(entry));
      }

      lines.push("");
      hasAnyContent = true;
    }

    if (!hasAnyContent) {
      lines.push("_No significant changes._");
      lines.push("");
    }

    // Compare link
    if (this.includeCompare && this.repoUrl && version && previous) {
      const compareUrl = `${this.repoUrl.replace(/\/$/, "")}/compare/v${previous}...v${version}`;
      lines.push(`[${version}]: ${compareUrl}`);
    }

    return lines.join("\n").trimEnd() + "\n";
  }

  // -------------------------------------------------------------------------
  // suggestNextVersion
  // -------------------------------------------------------------------------

  /**
   * Suggest the next version based on categorized changes.
   *
   * @param {object} changes - Categorized changes (output of categorize())
   * @param {string} currentVersion - Current version string
   * @param {string} [preid="alpha"] - Pre-release identifier
   * @returns {{ version: string, bump: string, reason: string }}
   */
  suggestNextVersion(changes, currentVersion, preid) {
    if (!semver.isValid(currentVersion)) {
      return { version: null, bump: null, reason: `Invalid current version: "${currentVersion}"` };
    }

    const pre = preid || "alpha";
    const hasBreaking = changes[ChangeType.BREAKING] && changes[ChangeType.BREAKING].length > 0;
    const hasFeat = changes[ChangeType.FEAT] && changes[ChangeType.FEAT].length > 0;
    const hasFix = changes[ChangeType.FIX] && changes[ChangeType.FIX].length > 0;
    const hasOther = Object.entries(changes).some(([type, entries]) => {
      if (type === ChangeType.BREAKING || type === ChangeType.FEAT || type === ChangeType.FIX) return false;
      return entries && entries.length > 0;
    });

    const parsed = semver.parse(currentVersion);

    if (parsed.pre) {
      // Currently on a pre-release — bump prerelease
      const next = semver.bump(currentVersion, "prerelease", preid);
      return {
        version: next,
        bump: "prerelease",
        reason: `Currently on pre-release ${currentVersion}. Bumping pre-release identifier.`,
      };
    }

    if (parsed.major === 0) {
      // 0.x.y — minor may be breaking, patch for fixes
      if (hasBreaking || hasFeat) {
        const next = semver.bump(currentVersion, "minor");
        return {
          version: next,
          bump: "minor",
          reason: "New features or breaking changes detected (pre-1.0 — bumping minor).",
        };
      }
      if (hasFix || hasOther) {
        const next = semver.bump(currentVersion, "patch");
        return {
          version: next,
          bump: "patch",
          reason: "Bug fixes or other changes detected — bumping patch.",
        };
      }
    }

    if (hasBreaking) {
      const next = semver.bump(currentVersion, "major");
      return {
        version: next,
        bump: "major",
        reason: `Breaking changes detected (${changes[ChangeType.BREAKING].length} item(s)) — bumping major.`,
      };
    }

    if (hasFeat) {
      const next = semver.bump(currentVersion, "minor");
      return {
        version: next,
        bump: "minor",
        reason: `New features detected (${changes[ChangeType.FEAT].length} item(s)) — bumping minor.`,
      };
    }

    if (hasFix || hasOther) {
      const next = semver.bump(currentVersion, "patch");
      return {
        version: next,
        bump: "patch",
        reason: "Bug fixes or non-feature changes detected — bumping patch.",
      };
    }

    return {
      version: currentVersion,
      bump: null,
      reason: "No changes detected — version unchanged.",
    };
  }

  // -------------------------------------------------------------------------
  // validateChangelog
  // -------------------------------------------------------------------------

  /**
   * Validate a changelog string for Keep a Changelog format compliance.
   *
   * @param {string} changelog - Changelog content to validate
   * @returns {{ valid: boolean, issues: Array<object> }}
   */
  validateChangelog(changelog) {
    if (typeof changelog !== "string" || changelog.trim().length === 0) {
      return {
        valid: false,
        issues: [{ severity: "error", message: "Changelog is empty or not a string." }],
      };
    }

    const issues = [];
    const lines = changelog.split("\n");

    // Check for CHANGELOG.md naming convention (in header or content context)
    let hasVersionHeader = false;
    let hasUnreleased = false;
    let versionCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Check version headers: ## [x.y.z] or ## [Unreleased]
      if (/^##\s+\[/.test(trimmed)) {
        if (/^##\s+\[Unreleased\]/i.test(trimmed)) {
          hasUnreleased = true;
        } else if (/^##\s+\[\d+\.\d+\.\d+.*\]/.test(trimmed)) {
          hasVersionHeader = true;
          versionCount++;
        }
      }

      // Check for malformed non-Keep-A-Changelog style
      if (/^#+\s+\d+\.\d+\.\d+/.test(trimmed) && !/^##\s+\[/.test(trimmed)) {
        issues.push({
          severity: "warning",
          message: `Version header "${trimmed}" should use Keep a Changelog format: "## [x.y.z]".`,
        });
      }
    }

    if (!hasUnreleased && !hasVersionHeader) {
      issues.push({
        severity: "error",
        message: 'No version headers found. Expected "## [Unreleased]" or "## [x.y.z]" format.',
      });
    }

    // Check for section headings
    const expectedSections = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];
    const foundSections = [];

    for (const line of lines) {
      const match = line.trim().match(/^###\s+(.+)/);
      if (match) {
        foundSections.push(match[1]);
      }
    }

    for (const expected of expectedSections) {
      if (!foundSections.some((s) => s.toLowerCase() === expected.toLowerCase())) {
        // Only warn if there are version headers (non-empty changelog)
        if (hasVersionHeader || hasUnreleased) {
          issues.push({
            severity: "info",
            message: `Section "### ${expected}" not found. Consider adding it if changes exist.`,
          });
        }
      }
    }

    // Check for compare links
    if (this.repoUrl) {
      const hasCompareLink = /^\[.+\]:\s*https?:\/\/.+\/compare\/.+\.\.\..+/m.test(changelog);
      if (!hasCompareLink && (hasVersionHeader || hasUnreleased)) {
        issues.push({
          severity: "info",
          message: "No compare links found. Consider adding version diff links.",
        });
      }
    }

    return {
      valid: issues.filter((i) => i.severity === "error").length === 0,
      issues,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Parse a single commit into a categorized entry.
   */
  _parseCommit(commit) {
    const message = commit.message.trim();
    const match = message.match(CONVENTIONAL_RE);

    if (!match) {
      // Check for breaking footer in non-conventional commit
      const breakingMatch = message.match(BREAKING_FOOTER_RE);
      return {
        hash: commit.hash || null,
        message,
        type: ChangeType.OTHER,
        scope: null,
        description: message.split("\n")[0],
        isBreaking: breakingMatch !== null,
        breakingDescription: breakingMatch ? breakingMatch[1].trim() : null,
        author: commit.author || null,
        date: commit.date || null,
      };
    }

    const groups = match.groups || {};

    return {
      hash: commit.hash || null,
      message,
      type: this._normalizeType(groups.type),
      scope: groups.scope || null,
      description: groups.description.trim(),
      isBreaking: groups.breaking === "!" || BREAKING_FOOTER_RE.test(message),
      breakingDescription: this._extractBreakingFooter(message),
      author: commit.author || null,
      date: commit.date || null,
    };
  }

  /**
   * Normalize a conventional commit type string to a ChangeType.
   */
  _normalizeType(rawType) {
    const t = rawType.toLowerCase().trim();

    // Direct matches
    for (const type of Object.values(ChangeType)) {
      if (t === type) return type;
    }

    return ChangeType.OTHER;
  }

  /**
   * Extract breaking change description from footer.
   */
  _extractBreakingFooter(message) {
    const match = message.match(BREAKING_FOOTER_RE);
    return match ? match[1].trim() : null;
  }

  /**
   * Format a single entry line for the changelog.
   */
  _formatEntry(entry) {
    let line = "- ";

    if (entry.scope) {
      line += `**${entry.scope}**: `;
    }

    line += entry.description;

    if (entry.isBreaking && entry.type !== ChangeType.BREAKING) {
      line += " **[BREAKING]**";
    }

    if (entry.note) {
      line += ` ${entry.note}`;
    }

    if (entry.hash && this.repoUrl) {
      const shortHash = entry.hash.substring(0, 7);
      line += ` ([${shortHash}](${this.repoUrl.replace(/\/$/, "")}/commit/${entry.hash}))`;
    }

    return line;
  }

  /**
   * Generate an empty changelog for a release with no commits.
   */
  _emptyChangelog(fromVersion, toVersion) {
    const lines = [];

    if (toVersion) {
      let header = `## [${toVersion}]`;
      if (this.includeDate) {
        header += ` - ${this._todayISO()}`;
      }
      lines.push(header);
      lines.push("");
    }

    lines.push("_No changes recorded for this release._");
    lines.push("");

    return lines.join("\n");
  }

  /**
   * ISO date string for today.
   */
  _todayISO() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ChangelogGenerator,
  ChangeType,
  CHANGELOG_SECTIONS,
};
