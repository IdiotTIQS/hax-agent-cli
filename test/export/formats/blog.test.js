/**
 * Tests for blog / documentation export formats.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  exportAsBlogPost,
  exportAsTutorial,
  exportAsDocumentation,
  exportAsChangelog,
  buildFrontmatter,
  extractToolsSummary,
  formatDate,
  slugify,
} = require("../../../src/export/formats/blog");

// ── helpers ──────────────────────────────────────────────────────────────

function makeSession(overrides = {}) {
  const entries = overrides.entries || [];
  const metadata = overrides.metadata || {};
  return {
    id: overrides.id || "blog-session-1",
    updatedAt: overrides.updatedAt || "2025-04-20T14:00:00.000Z",
    entries: () => entries,
    metadata: () => metadata,
  };
}

// ── utility functions ────────────────────────────────────────────────────

test("formatDate: extracts date part from ISO string", () => {
  assert.equal(formatDate("2025-04-20T14:00:00.000Z"), "2025-04-20");
});

test("formatDate: returns original for invalid input", () => {
  assert.equal(formatDate(""), "");
  assert.equal(formatDate(null), "");
});

test("slugify: converts text to URL-friendly slug", () => {
  assert.equal(slugify("Hello World"), "hello-world");
  assert.equal(slugify("My Cool Post!"), "my-cool-post");
  assert.equal(slugify("  Spaces  Everywhere  "), "spaces-everywhere");
  assert.equal(slugify("CamelCase"), "camelcase");
});

// ── buildFrontmatter ─────────────────────────────────────────────────────

test("buildFrontmatter: produces generic (YAML-style) frontmatter", () => {
  const fm = buildFrontmatter("generic", {
    title: "Test Post",
    date: "2025-04-20",
    tags: ["hax", "cli"],
  });

  assert.ok(fm.startsWith("---\n"), "should start with ---");
  assert.ok(fm.includes("title: Test Post"), "should include title");
  assert.ok(fm.includes("date: 2025-04-20"), "should include date");

  // Check array formatting
  assert.ok(fm.includes("tags:"), "should include tags key");
  assert.ok(fm.includes("- hax"), "should include tag item");

  assert.ok(fm.trimEnd().endsWith("---"), "should end with ---");
});

test("buildFrontmatter: produces Jekyll frontmatter", () => {
  const fm = buildFrontmatter("jekyll", {
    title: "Jekyll Post",
    layout: "post",
  });

  assert.ok(fm.startsWith("---\n"), "should start with ---");
  assert.ok(fm.includes("title: Jekyll Post"), "should include title");
  assert.ok(fm.includes("layout: post"), "should include layout");
});

test("buildFrontmatter: produces Hugo TOML frontmatter", () => {
  const fm = buildFrontmatter("hugo", {
    title: "Hugo Post",
    date: "2025-04-20",
    draft: true,
    tags: ["go", "ssg"],
  });

  assert.ok(fm.startsWith("---\n"), "should start with ---");
  assert.ok(fm.includes("title = "), "TOML should use =");
  assert.ok(fm.includes('"Hugo Post"'), "should include quoted title");
  assert.ok(fm.includes("draft = true"), "should include boolean");
  assert.ok(fm.includes("tags = ["), "should format array with brackets");
});

test("buildFrontmatter: handles nested objects", () => {
  const fm = buildFrontmatter("generic", {
    title: "Post",
    author: { name: "Jane", email: "jane@example.com" },
  });

  assert.ok(fm.includes("author:"), "should include author key");
  assert.ok(fm.includes("name: Jane"), "should include nested name");
  // YAML quotes values containing special characters like @
  assert.ok(fm.includes('email: "jane@example.com"'), "should include nested email");
});

// ── extractToolsSummary ──────────────────────────────────────────────────

test("extractToolsSummary: counts tool usage", () => {
  const entries = [
    { role: "tool", name: "read_file", data: "a" },
    { role: "tool", name: "read_file", data: "b" },
    { role: "tool", name: "write_file", data: "c" },
    { role: "user", content: "hello" },
    { role: "tool", name: "read_file", data: "d", isError: true },
  ];

  const summary = extractToolsSummary(entries);

  assert.equal(summary.size, 2);
  assert.equal(summary.get("read_file").count, 3);
  assert.equal(summary.get("read_file").errors, 1);
  assert.equal(summary.get("write_file").count, 1);
  assert.equal(summary.get("write_file").errors, 0);
});

test("extractToolsSummary: returns empty map for no tools", () => {
  const entries = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
  ];

  const summary = extractToolsSummary(entries);
  assert.equal(summary.size, 0);
});

// ── exportAsBlogPost ─────────────────────────────────────────────────────

test("exportAsBlogPost: produces markdown with frontmatter and content", () => {
  const session = makeSession({
    entries: [
      { role: "user", content: "What is HaxAgent?", timestamp: "2025-04-20T14:00:00Z" },
      { role: "assistant", content: "HaxAgent is a CLI tool.", timestamp: "2025-04-20T14:01:00Z" },
    ],
    metadata: { projectName: "HaxAgent" },
  });

  const post = exportAsBlogPost(session, {
    title: "My Blog Post",
    author: "Dev",
    tags: ["agent", "cli"],
    format: "generic",
  });

  // Frontmatter checks
  assert.ok(post.startsWith("---"), "should start with frontmatter");
  assert.ok(post.includes("title: My Blog Post"), "should include title");
  assert.ok(post.includes("author: Dev"), "should include author");
  assert.ok(post.includes("tags:"), "should include tags");
  assert.ok(post.includes("- agent"), "should include tag");

  // Content checks
  assert.ok(post.includes("# My Blog Post"), "should have title heading");
  assert.ok(post.includes("What is HaxAgent?"), "should include user content");
  assert.ok(post.includes("HaxAgent is a CLI tool."), "should include assistant content");
  assert.ok(post.includes("blog-session-1"), "should reference session ID");
});

test("exportAsBlogPost: omits frontmatter when disabled", () => {
  const session = makeSession({
    entries: [{ role: "user", content: "Test", timestamp: "2025-04-20T14:00:00Z" }],
  });

  const post = exportAsBlogPost(session, {
    title: "No FM Post",
    includeFrontmatter: false,
  });

  assert.ok(!post.startsWith("---"), "should not start with frontmatter");
  assert.ok(post.startsWith("# No FM Post"), "should start with title heading");
});

test("exportAsBlogPost: uses session metadata for auto-title", () => {
  const session = makeSession({
    entries: [{ role: "user", content: "Hello", timestamp: "2025-04-20T14:00:00Z" }],
    metadata: { projectName: "AutoProject" },
  });

  const post = exportAsBlogPost(session);
  assert.ok(post.includes("# AutoProject"), "should auto-generate title from project name");
});

test("exportAsBlogPost: handles empty sessions", () => {
  const session = makeSession({ entries: [] });
  const post = exportAsBlogPost(session, { title: "Empty Post" });

  assert.ok(post.includes("# Empty Post"), "should have title heading");
  assert.ok(post.includes("0 messages"), "should show zero messages");
});

// ── exportAsTutorial ─────────────────────────────────────────────────────

test("exportAsTutorial: produces structured tutorial format", () => {
  const session = makeSession({
    entries: [
      { role: "user", content: "Step 1: Install dependencies", timestamp: "2025-04-20T14:00:00Z" },
      { role: "assistant", content: "Run npm install.", timestamp: "2025-04-20T14:01:00Z" },
      { role: "user", content: "Step 2: Configure", timestamp: "2025-04-20T14:02:00Z" },
      { role: "assistant", content: "Edit config.json.", timestamp: "2025-04-20T14:03:00Z" },
    ],
  });

  const tutorial = exportAsTutorial(session, {
    title: "Setup Guide",
    difficulty: "beginner",
    estimatedTime: "10 minutes",
    prerequisites: ["Node.js", "npm"],
    format: "generic",
  });

  // Frontmatter
  assert.ok(tutorial.includes("difficulty: beginner"), "should include difficulty");
  assert.ok(tutorial.includes("estimated_time: 10 minutes"), "should include estimated time");
  assert.ok(tutorial.includes("prerequisites:"), "should include prerequisites");
  assert.ok(tutorial.includes("- Node.js"), "should include prereq item");

  // Content structure
  assert.ok(tutorial.includes("## Step 1:"), "should have step 1 heading");
  assert.ok(tutorial.includes("## Step 2:"), "should have step 2 heading");
  assert.ok(tutorial.includes("### Explanation"), "should have explanation sections");
  assert.ok(tutorial.includes("## Summary"), "should have summary section");
  assert.ok(tutorial.includes("2 steps"), "should count steps");
});

test("exportAsTutorial: includes difficulty table header", () => {
  const session = makeSession({
    entries: [{ role: "user", content: "Step one", timestamp: "2025-04-20T14:00:00Z" }],
  });

  const tutorial = exportAsTutorial(session, {
    title: "Quick Tutorial",
    difficulty: "advanced",
    estimatedTime: "30 min",
  });

  assert.ok(tutorial.includes("**Difficulty**"), "should have difficulty row");
  assert.ok(tutorial.includes("advanced"), "should show difficulty value");
  assert.ok(tutorial.includes("**Estimated Time**"), "should have time row");
});

test("exportAsTutorial: handles forward slashes in tutorial text safely", () => {
  const session = makeSession({
    entries: [
      {
        role: "user",
        content: "Open the file at ./src/index.js and edit the /export handler",
        timestamp: "2025-04-20T14:00:00Z",
      },
    ],
  });

  const tutorial = exportAsTutorial(session, { title: "Path Tutorial" });

  assert.ok(tutorial.includes("./src/index.js"), "should preserve file paths");
});

// ── exportAsDocumentation ─────────────────────────────────────────────────

test("exportAsDocumentation: produces doc structure with tools table", () => {
  const session = makeSession({
    entries: [
      { role: "user", content: "Document the API", timestamp: "2025-04-20T14:00:00Z" },
      { role: "assistant", content: "Here is the API doc.", timestamp: "2025-04-20T14:01:00Z" },
      { role: "tool", name: "read_file", data: "file contents", timestamp: "2025-04-20T14:02:00Z" },
      { role: "tool", name: "grep", data: "search results", timestamp: "2025-04-20T14:03:00Z" },
      { role: "tool", name: "grep", data: "more results", isError: true, timestamp: "2025-04-20T14:04:00Z" },
    ],
  });

  const doc = exportAsDocumentation(session, {
    title: "API Reference",
    docType: "api",
    format: "generic",
  });

  // Sections
  assert.ok(doc.includes("## Overview"), "should have overview section");
  assert.ok(doc.includes("### Tools Used"), "should have tools table section");
  assert.ok(doc.includes("## Session Content"), "should have content section");

  // Tools table
  assert.ok(doc.includes("read_file"), "should list read_file tool");
  assert.ok(doc.includes("grep"), "should list grep tool");

  // Content
  assert.ok(doc.includes("### Input"), "should have input section");
  assert.ok(doc.includes("### Response"), "should have response section");
});

test("exportAsDocumentation: includes parent reference when provided", () => {
  const session = makeSession({
    entries: [{ role: "user", content: "Doc content", timestamp: "2025-04-20T14:00:00Z" }],
  });

  const doc = exportAsDocumentation(session, {
    title: "Child Doc",
    parent: "Getting Started Guide",
    format: "generic",
  });

  assert.ok(doc.includes("Parent:"), "should include parent reference");
  assert.ok(doc.includes("Getting Started Guide"), "should show parent name");
});

test("exportAsDocumentation: honors weight option in frontmatter", () => {
  const session = makeSession({
    entries: [{ role: "user", content: "x", timestamp: "2025-04-20T14:00:00Z" }],
  });

  const doc = exportAsDocumentation(session, {
    title: "Weighted Doc",
    weight: 10,
    format: "generic",
  });

  assert.ok(doc.includes("weight: 10"), "should include weight in frontmatter");
});

// ── exportAsChangelog ────────────────────────────────────────────────────

test("exportAsChangelog: produces changelog with categorized sections", () => {
  const session = makeSession({
    entries: [
      {
        role: "assistant",
        content: "Added new export feature for PDF format",
        timestamp: "2025-04-20T14:00:00Z",
      },
      {
        role: "assistant",
        content: "Fixed a bug in the memory eviction logic",
        timestamp: "2025-04-20T14:01:00Z",
      },
      {
        role: "tool",
        name: "run_tests",
        data: "all passed",
        timestamp: "2025-04-20T14:02:00Z",
      },
    ],
  });

  const changelog = exportAsChangelog(session, {
    version: "1.5.0",
    releaseDate: "2025-04-20",
    format: "generic",
  });

  // Header
  assert.ok(changelog.includes("## [1.5.0] - 2025-04-20"), "should have version header");

  // Categorized sections
  assert.ok(changelog.includes("### Added"), "should have Added section");
  assert.ok(changelog.includes("### Fixed"), "should have Fixed section");

  // Content items
  assert.ok(changelog.includes("new export feature"), "should include added item");
  assert.ok(changelog.includes("memory eviction"), "should include fixed item");

  // Session context
  assert.ok(changelog.includes("### Session Context"), "should have session context");
  assert.ok(changelog.includes("Messages | 3"), "should show message count");
});

test("exportAsChangelog: handles no categorized content", () => {
  const session = makeSession({
    entries: [
      { role: "user", content: "Hello", timestamp: "2025-04-20T14:00:00Z" },
      { role: "assistant", content: "Hi", timestamp: "2025-04-20T14:01:00Z" },
    ],
  });

  const changelog = exportAsChangelog(session, {
    version: "v2.0.0",
    format: "generic",
  });

  assert.ok(changelog.includes("## [v2.0.0]"), "should have version header");
  assert.ok(changelog.includes("Session Context"), "should include session context");
});

test("exportAsChangelog: uses 'Unreleased' when no version provided", () => {
  const session = makeSession({
    entries: [{ role: "assistant", content: "Added something", timestamp: "2025-04-20T14:00:00Z" }],
  });

  const changelog = exportAsChangelog(session);

  assert.ok(changelog.includes("[Unreleased]"), "should default to Unreleased version");
});

// ── frontmatter format variations ────────────────────────────────────────

test("exportAsBlogPost: produces Hugo-compatible frontmatter", () => {
  const session = makeSession({
    entries: [{ role: "user", content: "Hugo post", timestamp: "2025-04-20T14:00:00Z" }],
  });

  const post = exportAsBlogPost(session, {
    title: "Hugo Test",
    format: "hugo",
  });

  // TOML uses = not :
  assert.ok(post.includes("title = "), "Hugo/TOML should use = syntax");
});

test("exportAsBlogPost: produces Jekyll-compatible frontmatter", () => {
  const session = makeSession({
    entries: [{ role: "user", content: "Jekyll post", timestamp: "2025-04-20T14:00:00Z" }],
  });

  const post = exportAsBlogPost(session, {
    title: "Jekyll Test",
    format: "jekyll",
  });

  // YAML uses :
  assert.ok(post.includes("title: "), "Jekyll/YAML should use : syntax");
});
