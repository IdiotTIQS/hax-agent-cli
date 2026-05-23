/**
 * Tests for ReleaseManager — release CRUD, comparison, notes generation,
 * tagging, filtering, semver integration.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { ReleaseManager } = require("../../src/artifact/release");
const { ArtifactManager } = require("../../src/artifact/manager");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArtifact(name, version, type) {
  return {
    name,
    version,
    type: type || "generic",
    files: [],
    metadata: {},
    checksums: {},
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// createRelease
// ---------------------------------------------------------------------------

test("createRelease: builds a valid release object", () => {
  const rm = new ReleaseManager();
  const artifacts = [
    makeArtifact("core-lib", "1.0.0", "plugin"),
    makeArtifact("docs", "1.0.0", "report"),
  ];
  const rel = rm.createRelease("1.0.0", artifacts, "Initial stable release");

  assert.equal(rel.version, "1.0.0");
  assert.equal(rel.status, "draft");
  assert.equal(rel.artifacts.length, 2);
  assert.equal(rel.artifacts[0].name, "core-lib");
  assert.equal(rel.notes, "Initial stable release");
  assert.ok(Array.isArray(rel.changelog));
  assert.ok(rel.date.endsWith("Z") || rel.date.includes("T"));
});

test("createRelease: respects custom status and channel", () => {
  const rm = new ReleaseManager({ channel: "beta" });
  const rel = rm.createRelease(
    "2.0.0-beta.1",
    [],
    "Pre-release",
    { status: "prerelease", channel: "next" }
  );

  assert.equal(rel.status, "prerelease");
  assert.equal(rel.channel, "next");
});

test("createRelease: rejects invalid semver versions", () => {
  const rm = new ReleaseManager();
  assert.throws(
    () => rm.createRelease("not-a-version", [], ""),
    /Invalid semver/
  );
  assert.throws(
    () => rm.createRelease("", [], ""),
    /Release version is required/
  );
});

// ---------------------------------------------------------------------------
// publishRelease / getRelease / listReleases
// ---------------------------------------------------------------------------

test("publishRelease: transitions status to stable", () => {
  const rm = new ReleaseManager();
  const rel = rm.createRelease("1.0.0", [], "");
  assert.equal(rel.status, "draft");

  const published = rm.publishRelease(rel);
  assert.equal(published.status, "stable");

  const fetched = rm.getRelease("1.0.0");
  assert.equal(fetched.status, "stable");
});

test("getRelease: returns null for nonexistent", () => {
  const rm = new ReleaseManager();
  assert.equal(rm.getRelease("9.9.9"), null);
});

test("listReleases: returns all and filters by status", () => {
  const rm = new ReleaseManager();

  rm.createRelease("1.0.0", [], "v1", { status: "stable" });
  rm.createRelease("1.1.0", [], "v1.1", { status: "stable" });
  rm.createRelease("2.0.0-alpha", [], "pre", { status: "prerelease" });

  assert.equal(rm.listReleases().length, 3);
  assert.equal(rm.listReleases({ status: "stable" }).length, 2);
  assert.equal(rm.listReleases({ status: "prerelease" }).length, 1);
});

test("listReleases: sorts newest-first by semver", () => {
  const rm = new ReleaseManager();

  rm.createRelease("1.0.0", [], "");
  rm.createRelease("3.0.0", [], "");
  rm.createRelease("2.0.0", [], "");

  const list = rm.listReleases();
  assert.equal(list[0].version, "3.0.0");
  assert.equal(list[1].version, "2.0.0");
  assert.equal(list[2].version, "1.0.0");
});

test("latestRelease: returns the highest semver match", () => {
  const rm = new ReleaseManager();

  rm.createRelease("1.0.0", [], "");
  rm.createRelease("2.0.0", [], "", { status: "stable" });

  const latest = rm.latestRelease();
  assert.equal(latest.version, "2.0.0");

  const stableLatest = rm.latestRelease({ status: "stable" });
  assert.equal(stableLatest.version, "2.0.0");

  const draftLatest = rm.latestRelease({ status: "draft" });
  assert.equal(draftLatest.version, "1.0.0");
});

// ---------------------------------------------------------------------------
// compareReleases
// ---------------------------------------------------------------------------

test("compareReleases: detects added, removed, and changed artifacts", () => {
  const rm = new ReleaseManager();

  rm.createRelease("1.0.0", [
    makeArtifact("core", "1.0.0"),
    makeArtifact("old-plugin", "1.0.0"),
  ], "");

  rm.createRelease("1.1.0", [
    makeArtifact("core", "1.1.0"),
    makeArtifact("new-plugin", "1.0.0"),
  ], "");

  const diff = rm.compareReleases("1.0.0", "1.1.0");

  assert.equal(diff.from, "1.0.0");
  assert.equal(diff.to, "1.1.0");
  assert.equal(diff.diffType, "MINOR");
  assert.deepEqual(diff.added, ["new-plugin"]);
  assert.deepEqual(diff.removed, ["old-plugin"]);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].name, "core");
  assert.equal(diff.changed[0].from, "1.0.0");
  assert.equal(diff.changed[0].to, "1.1.0");
});

test("compareReleases: throws for missing releases", () => {
  const rm = new ReleaseManager();
  rm.createRelease("1.0.0", [], "");

  assert.throws(
    () => rm.compareReleases("1.0.0", "9.9.9"),
    /not found/
  );
  assert.throws(
    () => rm.compareReleases("0.0.0", "1.0.0"),
    /not found/
  );
});

// ---------------------------------------------------------------------------
// generateReleaseNotes
// ---------------------------------------------------------------------------

test("generateReleaseNotes: produces default markdown with categories", () => {
  const rm = new ReleaseManager();
  const changes = [
    { type: "feat", scope: "cli", message: "Add export command" },
    { type: "fix", message: "Fix memory leak in session handler" },
    { type: "breaking", scope: "api", message: "Drop support for Node 14" },
  ];

  const notes = rm.generateReleaseNotes("1.0.0", "2.0.0", changes);

  assert.ok(notes.includes("## Release 2.0.0"));
  assert.ok(notes.includes("Upgrading from 1.0.0"));
  assert.ok(notes.includes("MAJOR"));
  assert.ok(notes.includes("### Features"));
  assert.ok(notes.includes("**cli**: Add export command"));
  assert.ok(notes.includes("### Bug Fixes"));
  assert.ok(notes.includes("Fix memory leak"));
  assert.ok(notes.includes("### Breaking Changes"));
  assert.ok(notes.includes("Drop support for Node 14"));
});

test("generateReleaseNotes: produces keepachangelog format", () => {
  const rm = new ReleaseManager();
  const changes = [
    { type: "feat", message: "New feature" },
    { type: "fix", message: "Bugfix" },
  ];

  const notes = rm.generateReleaseNotes("1.0.0", "1.1.0", changes, {
    template: "keepachangelog",
  });

  assert.ok(notes.includes("## [1.1.0]"));
  assert.ok(notes.includes("### Added"));
  assert.ok(notes.includes("New feature"));
  assert.ok(notes.includes("### Fixed"));
  assert.ok(notes.includes("Bugfix"));
});

test("generateReleaseNotes: handles empty changes array", () => {
  const rm = new ReleaseManager();
  const notes = rm.generateReleaseNotes("1.0.0", "1.0.1", []);
  assert.ok(notes.includes("## Release 1.0.1"));
  assert.ok(notes.includes("Upgrading from 1.0.0"));
});

// ---------------------------------------------------------------------------
// tagRelease
// ---------------------------------------------------------------------------

test("tagRelease: adds tags to release metadata", () => {
  const rm = new ReleaseManager();
  rm.createRelease("1.0.0", [], "LTS release");

  let rel = rm.tagRelease("1.0.0", "lts");
  assert.deepEqual(rel.metadata.tags, ["lts"]);

  rel = rm.tagRelease("1.0.0", "latest");
  assert.deepEqual(rel.metadata.tags, ["lts", "latest"]);

  // Duplicate tag not added
  rel = rm.tagRelease("1.0.0", "lts");
  assert.deepEqual(rel.metadata.tags, ["lts", "latest"]);
});

test("tagRelease: returns null for nonexistent release", () => {
  const rm = new ReleaseManager();
  assert.equal(rm.tagRelease("9.9.9", "lts"), null);
});

// ---------------------------------------------------------------------------
// publishRelease validation
// ---------------------------------------------------------------------------

test("publishRelease: throws for invalid release argument", () => {
  const rm = new ReleaseManager();
  assert.throws(
    () => rm.publishRelease(null),
    /must have version/
  );
  assert.throws(
    () => rm.publishRelease({}),
    /must have version/
  );
});
