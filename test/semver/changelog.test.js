/**
 * Tests for ChangelogGenerator: generate, categorize, formatChangelog,
 * suggestNextVersion, validateChangelog.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { ChangelogGenerator, ChangeType } = require("../../src/semver/changelog");

// ---------------------------------------------------------------------------
// Sample commits
// ---------------------------------------------------------------------------

const sampleCommits = [
  { hash: "abc1234", message: "feat: add user authentication system" },
  { hash: "def5678", message: "fix: resolve token expiry bug" },
  { hash: "ghi9012", message: "feat(api): add new GraphQL endpoint\n\nBREAKING CHANGE: Removed REST /v1/users endpoint" },
  { hash: "jkl3456", message: "docs: update API documentation" },
  { hash: "mno7890", message: "chore: update dependencies" },
  { hash: "pqr2345", message: "refactor(core): extract validation logic" },
  { hash: "stu6789", message: "perf: optimize database queries" },
  { hash: "vwx0123", message: "test: add integration tests for auth flow" },
];

// ---------------------------------------------------------------------------
// categorize
// ---------------------------------------------------------------------------

test("categorize: classifies commits by conventional commit type", () => {
  const gen = new ChangelogGenerator();
  const categories = gen.categorize(sampleCommits);

  assert.equal(categories[ChangeType.FEAT].length, 2); // feat + feat(api) with breaking
  assert.equal(categories[ChangeType.FIX].length, 1);
  assert.equal(categories[ChangeType.BREAKING].length, 1);
  assert.equal(categories[ChangeType.DOCS].length, 1);
  assert.equal(categories[ChangeType.CHORE].length, 1);
  assert.equal(categories[ChangeType.REFACTOR].length, 1);
  assert.equal(categories[ChangeType.PERF].length, 1);
  assert.equal(categories[ChangeType.TEST].length, 1);
});

test("categorize: detects breaking change in feat commit", () => {
  const gen = new ChangelogGenerator();
  const categories = gen.categorize([
    { hash: "abc1234", message: "feat!: remove legacy API\n\nBREAKING CHANGE: All endpoints require auth header" },
  ]);

  assert.equal(categories[ChangeType.FEAT].length, 1);
  assert.equal(categories[ChangeType.FEAT][0].isBreaking, true);
  assert.equal(categories[ChangeType.BREAKING].length, 1);
});

test("categorize: handles non-conventional commit messages", () => {
  const gen = new ChangelogGenerator();
  const categories = gen.categorize([
    { hash: "abc1234", message: "Updated some stuff" },
    { hash: "def5678", message: "Miscellaneous changes" },
  ]);

  assert.equal(categories[ChangeType.OTHER].length, 2);
});

test("categorize: handles empty commits array", () => {
  const gen = new ChangelogGenerator();
  const categories = gen.categorize([]);

  for (const type of Object.values(ChangeType)) {
    assert.equal(categories[type].length, 0);
  }
});

// ---------------------------------------------------------------------------
// formatChangelog
// ---------------------------------------------------------------------------

test("formatChangelog: formats in Keep a Changelog style", () => {
  const gen = new ChangelogGenerator({ includeDate: true });
  const categories = gen.categorize(sampleCommits);
  const changelog = gen.formatChangelog(categories, "1.0.0", "0.9.0");

  assert.ok(changelog.includes("## [1.0.0]"));
  assert.ok(changelog.includes("### Breaking Changes"));
  assert.ok(changelog.includes("### Added"));
  assert.ok(changelog.includes("### Fixed"));
  assert.ok(changelog.includes("### Documentation"));
  assert.ok(changelog.includes("### Performance"));
});

test("formatChangelog: omits headings with no entries", () => {
  const gen = new ChangelogGenerator();
  const categories = gen.categorize([
    { hash: "abc1234", message: "fix: typo in readme" },
  ]);
  const changelog = gen.formatChangelog(categories, "1.0.1", "1.0.0");

  assert.ok(changelog.includes("### Fixed"));
  assert.ok(!changelog.includes("### Added"));
});

test("formatChangelog: includes compare link when repoUrl is set", () => {
  const gen = new ChangelogGenerator({
    repoUrl: "https://github.com/user/repo",
    includeCompare: true,
  });
  const categories = gen.categorize([
    { hash: "abc1234", message: "fix: typo" },
  ]);
  const changelog = gen.formatChangelog(categories, "1.0.1", "1.0.0");

  assert.ok(changelog.includes("[1.0.1]: https://github.com/user/repo/compare/v1.0.0...v1.0.1"));
});

// ---------------------------------------------------------------------------
// suggestNextVersion
// ---------------------------------------------------------------------------

test("suggestNextVersion: suggests major bump for breaking changes", () => {
  const gen = new ChangelogGenerator();
  const categories = gen.categorize([
    { hash: "abc1234", message: "feat!: completely new API" },
  ]);
  const result = gen.suggestNextVersion(categories, "1.2.3");

  assert.equal(result.bump, "major");
  assert.equal(result.version, "2.0.0");
  assert.ok(result.reason.includes("Breaking changes detected"));
});

test("suggestNextVersion: suggests minor bump for new features", () => {
  const gen = new ChangelogGenerator();
  const categories = gen.categorize([
    { hash: "abc1234", message: "feat: add dark mode" },
  ]);
  const result = gen.suggestNextVersion(categories, "1.2.3");

  assert.equal(result.bump, "minor");
  assert.equal(result.version, "1.3.0");
});

test("suggestNextVersion: suggests patch bump for bug fixes", () => {
  const gen = new ChangelogGenerator();
  const categories = gen.categorize([
    { hash: "abc1234", message: "fix: crash on startup" },
  ]);
  const result = gen.suggestNextVersion(categories, "1.2.3");

  assert.equal(result.bump, "patch");
  assert.equal(result.version, "1.2.4");
});

test("suggestNextVersion: bumps prerelease from existing pre-release", () => {
  const gen = new ChangelogGenerator();
  const categories = gen.categorize([
    { hash: "abc1234", message: "feat: new feature" },
  ]);
  const result = gen.suggestNextVersion(categories, "1.0.0-alpha.1");

  assert.equal(result.bump, "prerelease");
  assert.equal(result.version, "1.0.0-alpha.2");
});

test("suggestNextVersion: returns null for invalid current version", () => {
  const gen = new ChangelogGenerator();
  const categories = gen.categorize([
    { hash: "abc1234", message: "feat: new thing" },
  ]);
  const result = gen.suggestNextVersion(categories, "not-a-version");

  assert.equal(result.version, null);
  assert.equal(result.bump, null);
  assert.ok(result.reason.includes("Invalid current version"));
});

test("suggestNextVersion: returns unchanged when no changes exist", () => {
  const gen = new ChangelogGenerator();
  const categories = gen.categorize([]);
  const result = gen.suggestNextVersion(categories, "1.2.3");

  assert.equal(result.version, "1.2.3");
  assert.equal(result.bump, null);
  assert.ok(result.reason.includes("No changes detected"));
});

// ---------------------------------------------------------------------------
// validateChangelog
// ---------------------------------------------------------------------------

test("validateChangelog: passes valid Keep a Changelog format", () => {
  const gen = new ChangelogGenerator();
  const changelog = [
    "## [1.0.0] - 2024-01-15",
    "",
    "### Added",
    "- New feature A",
    "",
    "### Fixed",
    "- Bug fix B",
    "",
    "[1.0.0]: https://github.com/user/repo/compare/v0.9.0...v1.0.0",
  ].join("\n");

  const result = gen.validateChangelog(changelog);
  assert.equal(result.valid, true);
});

test("validateChangelog: fails for empty changelog", () => {
  const gen = new ChangelogGenerator();
  const result = gen.validateChangelog("");

  assert.equal(result.valid, false);
  assert.ok(result.issues.length > 0);
});

test("validateChangelog: fails for changelog with no version headers", () => {
  const gen = new ChangelogGenerator();
  const changelog = [
    "Here is a changelog without version headers.",
    "",
    "- Some change",
    "- Another change",
  ].join("\n");

  const result = gen.validateChangelog(changelog);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.severity === "error"));
});

test("validateChangelog: warns on malformed version headers", () => {
  const gen = new ChangelogGenerator();
  const changelog = [
    "# 1.0.0",
    "",
    "Changes in this release:",
  ].join("\n");

  const result = gen.validateChangelog(changelog);
  assert.ok(result.issues.some((i) => i.severity === "warning"));
});

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

test("generate: produces full changelog from commits", () => {
  const gen = new ChangelogGenerator();
  const changelog = gen.generate("0.9.0", "1.0.0", sampleCommits);

  assert.ok(changelog.includes("## [1.0.0]"));
  assert.ok(changelog.includes("### Breaking Changes"));
  assert.ok(changelog.includes("### Added"));
  assert.ok(changelog.includes("### Fixed"));
});

test("generate: handles empty commits list gracefully", () => {
  const gen = new ChangelogGenerator();
  const changelog = gen.generate("0.9.0", "1.0.0", []);
  assert.ok(changelog.includes("No changes recorded"));
});

// ---------------------------------------------------------------------------
// 0.x.y pre-1.0 version suggestion
// ---------------------------------------------------------------------------

test("suggestNextVersion: bumps minor for features in 0.x.y (pre-1.0)", () => {
  const gen = new ChangelogGenerator();
  const categories = gen.categorize([
    { hash: "abc1234", message: "feat: add new API" },
  ]);
  const result = gen.suggestNextVersion(categories, "0.3.2");

  assert.equal(result.bump, "minor");
  assert.equal(result.version, "0.4.0");
  assert.ok(result.reason.includes("pre-1.0"));
});
