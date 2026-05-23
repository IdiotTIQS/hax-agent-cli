"use strict";

/**
 * release.js — ReleaseManager for aggregating artifacts into versioned
 * releases with changelog generation and cross-release comparison.
 *
 *   const { ReleaseManager } = require("./artifact/release");
 *   const rm = new ReleaseManager({ artifactManager });
 *   const rel = rm.createRelease("1.0.0", [art1, art2], "Initial release");
 *   rm.publishRelease(rel);
 *   rm.getRelease("1.0.0");
 *   rm.compareReleases("0.9.0", "1.0.0");
 *   rm.generateReleaseNotes("0.9.0", "1.0.0", changes);
 */

const semver = require("../versioning/semver");

// ---------------------------------------------------------------------------
// ReleaseManager
// ---------------------------------------------------------------------------

class ReleaseManager {
  /**
   * @param {object} options
   * @param {object} [options.artifactManager] — ArtifactManager instance for resolution
   * @param {string} [options.channel]         — default release channel
   */
  constructor(options = {}) {
    this.artifactManager = options.artifactManager || null;
    this.defaultChannel = options.channel || "stable";
    this._releases = new Map();
  }

  // --- public API ---

  /**
   * Create a release from a set of artifacts.
   *
   * @param {string} version    — semver release version
   * @param {object[]} artifacts — array of artifact objects
   * @param {string} [notes]    — human-readable release notes
   * @param {object} [options]
   * @param {string} [options.status="draft"]  — "draft", "prerelease", "stable", "deprecated"
   * @param {string} [options.channel]         — overrides default channel
   * @param {object} [options.metadata]
   * @returns {object} release
   */
  createRelease(version, artifacts, notes, options = {}) {
    if (!version || typeof version !== "string") {
      throw new Error("Release version is required");
    }
    if (!semver.isValid(version)) {
      throw new Error(`Invalid semver version: ${version}`);
    }

    const now = new Date().toISOString();
    const changelog = options.changelog || [];
    const status = options.status || "draft";
    const channel = options.channel || this.defaultChannel;

    const release = {
      version,
      artifacts: artifacts.map((a) => ({
        name: a.name,
        version: a.version,
        type: a.type,
        checksums: a.checksums || {},
      })),
      notes: notes || "",
      changelog,
      date: now,
      status,
      channel,
      metadata: options.metadata || {},
    };

    this._releases.set(version, release);
    return release;
  }

  /**
   * Publish a release to its channel, transitioning status to "stable".
   *
   * @param {object} release
   * @returns {object} the published release
   */
  publishRelease(release) {
    if (!release || !release.version) {
      throw new Error("Invalid release: must have version");
    }

    const updated = { ...release, status: "stable" };
    this._releases.set(release.version, updated);
    return updated;
  }

  /**
   * Retrieve a release by version.
   *
   * @param {string} version
   * @returns {object|null}
   */
  getRelease(version) {
    return this._releases.get(version) || null;
  }

  /**
   * List all releases, optionally filtered.
   *
   * @param {object} [filter]
   * @param {string} [filter.status]    — "draft", "prerelease", "stable", "deprecated"
   * @param {string} [filter.channel]
   * @param {string} [filter.before]    — ISO date
   * @param {string} [filter.after]     — ISO date
   * @returns {object[]} sorted newest-first by semver
   */
  listReleases(filter = {}) {
    let releases = [...this._releases.values()];

    if (filter.status) {
      releases = releases.filter((r) => r.status === filter.status);
    }
    if (filter.channel) {
      releases = releases.filter((r) => r.channel === filter.channel);
    }
    if (filter.before) {
      const before = new Date(filter.before).getTime();
      releases = releases.filter((r) => new Date(r.date).getTime() < before);
    }
    if (filter.after) {
      const after = new Date(filter.after).getTime();
      releases = releases.filter((r) => new Date(r.date).getTime() > after);
    }

    // Sort newest-first by semver
    releases.sort((a, b) => semver.compare(b.version, a.version));

    return releases;
  }

  /**
   * Compare two releases and return a diff of what changed.
   *
   * @param {string} v1 — older version
   * @param {string} v2 — newer version
   * @returns {object} diff report
   */
  compareReleases(v1, v2) {
    const r1 = this._releases.get(v1);
    const r2 = this._releases.get(v2);

    if (!r1) throw new Error(`Release not found: ${v1}`);
    if (!r2) throw new Error(`Release not found: ${v2}`);

    const diffType = semver.diff(v1, v2);

    // Map artifact names for quick lookup
    const a1Map = new Map(r1.artifacts.map((a) => [a.name, a]));
    const a2Map = new Map(r2.artifacts.map((a) => [a.name, a]));

    const added = [];
    const removed = [];
    const changed = [];
    const unchanged = [];

    for (const [name, a2] of a2Map) {
      const a1 = a1Map.get(name);
      if (!a1) {
        added.push(name);
      } else if (a1.version !== a2.version) {
        changed.push({ name, from: a1.version, to: a2.version });
      } else {
        unchanged.push(name);
      }
    }

    for (const [name] of a1Map) {
      if (!a2Map.has(name)) {
        removed.push(name);
      }
    }

    return {
      from: v1,
      to: v2,
      diffType,
      added,
      removed,
      changed,
      unchanged,
      statusChange: r1.status !== r2.status ? { from: r1.status, to: r2.status } : null,
    };
  }

  /**
   * Auto-generate release notes from a list of changes.
   *
   * @param {string} from     — previous version
   * @param {string} to       — new version
   * @param {object[]} changes — array of { type, scope, message }
   *   type: "feat", "fix", "chore", "docs", "refactor", "perf", "test", "breaking"
   * @param {object} [options]
   * @param {string} [options.template] — "default", "keepachangelog"
   * @returns {string} formatted release notes (markdown)
   */
  generateReleaseNotes(from, to, changes, options = {}) {
    if (!Array.isArray(changes)) {
      changes = [];
    }

    const template = options.template || "default";
    const categories = categorizeChanges(changes);
    const diffType = from && to ? semver.diff(from, to) : null;

    if (template === "keepachangelog") {
      return buildKeepAChangelog(to, diffType, categories);
    }

    return buildDefaultNotes(to, from, diffType, categories);
  }

  /**
   * Get the latest release (by semver ordering).
   * @param {object} [filter] — same as listReleases filter
   * @returns {object|null}
   */
  latestRelease(filter = {}) {
    const releases = this.listReleases(filter);
    return releases.length > 0 ? releases[0] : null;
  }

  /**
   * Tag a release with a custom label.
   *
   * @param {string} version
   * @param {string} tag — e.g. "lts", "next", "beta"
   * @returns {object|null} updated release
   */
  tagRelease(version, tag) {
    const release = this._releases.get(version);
    if (!release) return null;

    if (!release.metadata) {
      release.metadata = {};
    }
    if (!release.metadata.tags) {
      release.metadata.tags = [];
    }
    if (!release.metadata.tags.includes(tag)) {
      release.metadata.tags.push(tag);
    }

    this._releases.set(version, release);
    return release;
  }
}

// ---------------------------------------------------------------------------
// Change categorization
// ---------------------------------------------------------------------------

function categorizeChanges(changes) {
  const cats = {
    feat: [],
    fix: [],
    chore: [],
    docs: [],
    refactor: [],
    perf: [],
    test: [],
    breaking: [],
    other: [],
  };

  for (const c of changes) {
    const type = c.type || "other";
    if (cats[type]) {
      cats[type].push(c);
    } else {
      cats.other.push(c);
    }
  }

  return cats;
}

// ---------------------------------------------------------------------------
// Notes formatting
// ---------------------------------------------------------------------------

function buildDefaultNotes(version, from, diffType, categories) {
  const lines = [];

  lines.push(`## Release ${version}`);
  lines.push("");
  if (from) {
    lines.push(`*Upgrading from ${from}*  `);
  }
  if (diffType) {
    lines.push(`*Change level: **${diffType}***  `);
  }
  lines.push("");

  appendCategory(lines, "Features", categories.feat);
  appendCategory(lines, "Bug Fixes", categories.fix);
  appendCategory(lines, "Breaking Changes", categories.breaking);
  appendCategory(lines, "Performance", categories.perf);
  appendCategory(lines, "Refactoring", categories.refactor);
  appendCategory(lines, "Documentation", categories.docs);
  appendCategory(lines, "Tests", categories.test);
  appendCategory(lines, "Chores", categories.chore);
  appendCategory(lines, "Other", categories.other);

  return lines.join("\n").trim();
}

function buildKeepAChangelog(version, diffType, categories) {
  const lines = [];

  lines.push(`## [${version}] - ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");

  appendChangelogSection(lines, "Added", [...categories.feat, ...categories.other]);
  appendChangelogSection(lines, "Changed", [...categories.refactor, ...categories.perf]);
  appendChangelogSection(lines, "Fixed", categories.fix);
  appendChangelogSection(lines, "Removed", []);
  if (categories.breaking.length > 0) {
    appendChangelogSection(lines, "Security", categories.breaking);
  }

  return lines.join("\n").trim();
}

function appendCategory(lines, heading, entries) {
  if (entries.length === 0) return;
  lines.push(`### ${heading}`);
  for (const e of entries) {
    const scope = e.scope ? `**${e.scope}**: ` : "";
    lines.push(`- ${scope}${e.message}`);
  }
  lines.push("");
}

function appendChangelogSection(lines, heading, entries) {
  if (entries.length === 0) return;
  lines.push(`### ${heading}`);
  for (const e of entries) {
    const scope = e.scope ? `**${e.scope}**: ` : "";
    lines.push(`- ${scope}${e.message}`);
  }
  lines.push("");
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ReleaseManager,
};
