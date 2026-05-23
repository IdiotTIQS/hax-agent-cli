"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const memory = require("../src/memory");

function createFixture() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-mem-ns-"));
  const settings = {
    projectRoot,
    memory: { directory: path.join(projectRoot, "memory") },
    sessions: { directory: path.join(projectRoot, "sessions") },
  };
  return { projectRoot, settings };
}

test("writeMemory: defaults namespace to 'default' and tags to empty array", () => {
  const { settings } = createFixture();

  const record = memory.writeMemory("test-memory", "some content", settings);

  assert.equal(record.namespace, "default");
  assert.deepEqual(record.tags, []);
  assert.equal(record.name, "test-memory");
  assert.equal(record.content, "some content");
});

test("writeMemory: stores namespace and tags when provided", () => {
  const { settings } = createFixture();

  const record = memory.writeMemory("config-notes", "API key location: .env", {
    ...settings,
    namespace: "project-settings",
    tags: ["config", "security"],
  });

  assert.equal(record.namespace, "project-settings");
  assert.deepEqual(record.tags, ["config", "security"]);
});

test("writeMemory: accepts tags as comma-separated string", () => {
  const { settings } = createFixture();

  const record = memory.writeMemory("tagged-memory", "content", {
    ...settings,
    namespace: "dev",
    tags: "typescript, testing, ci",
  });

  assert.equal(record.namespace, "dev");
  assert.deepEqual(record.tags, ["typescript", "testing", "ci"]);
});

test("writeMemory: read back preserves namespace and tags", () => {
  const { settings } = createFixture();

  memory.writeMemory("persistent-mem", "hello world", {
    ...settings,
    namespace: "docs",
    tags: ["readme", "api"],
  });

  const read = memory.readMemory("persistent-mem", settings);

  assert.equal(read.namespace, "docs");
  assert.deepEqual(read.tags, ["readme", "api"]);
  assert.equal(read.content, "hello world");
});

test("writeMemory: updating preserves namespace if not overridden", () => {
  const { settings } = createFixture();

  memory.writeMemory("updatable", "v1", {
    ...settings,
    namespace: "api",
    tags: ["v1"],
  });

  const updated = memory.writeMemory("updatable", "v2", settings);

  assert.equal(updated.namespace, "api", "namespace should persist from original");
  assert.deepEqual(updated.tags, ["v1"], "tags should persist from original");
  assert.equal(updated.content, "v2", "content should be updated");
});

test("listMemories: namespace filter returns only matching memories", () => {
  const { settings } = createFixture();

  memory.writeMemory("mem-a", "content a", { ...settings, namespace: "alpha" });
  memory.writeMemory("mem-b", "content b", { ...settings, namespace: "beta" });
  memory.writeMemory("mem-c", "content c", { ...settings, namespace: "alpha" });

  const alphaResults = memory.listMemories({ ...settings, namespace: "alpha" });
  assert.equal(alphaResults.length, 2);
  assert.ok(alphaResults.every((m) => m.namespace === "alpha"));

  const betaResults = memory.listMemories({ ...settings, namespace: "beta" });
  assert.equal(betaResults.length, 1);
  assert.equal(betaResults[0].name, "mem-b");

  const noneResults = memory.listMemories({ ...settings, namespace: "nonexistent" });
  assert.equal(noneResults.length, 0);
});

test("listMemories: default namespace memories are included with default filter", () => {
  const { settings } = createFixture();

  memory.writeMemory("default-mem", "content", settings);

  const results = memory.listMemories({ ...settings, namespace: "default" });
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "default-mem");
  assert.equal(results[0].namespace, "default");
});

test("listMemories: tag filter returns matching memories", () => {
  const { settings } = createFixture();

  memory.writeMemory("tagged-a", "a", { ...settings, tags: ["typescript"] });
  memory.writeMemory("tagged-b", "b", { ...settings, tags: ["python"] });
  memory.writeMemory("tagged-c", "c", { ...settings, tags: ["typescript", "testing"] });

  const tsResults = memory.listMemories({ ...settings, tag: "typescript" });
  assert.equal(tsResults.length, 2);
  assert.ok(tsResults.every((m) => (m.tags || []).includes("typescript")));

  const pyResults = memory.listMemories({ ...settings, tag: "python" });
  assert.equal(pyResults.length, 1);
  assert.equal(pyResults[0].name, "tagged-b");

  const noneResults = memory.listMemories({ ...settings, tag: "nonexistent" });
  assert.equal(noneResults.length, 0);
});

test("listMemories: combined namespace and tag filter", () => {
  const { settings } = createFixture();

  memory.writeMemory("a", "a", { ...settings, namespace: "dev", tags: ["typescript"] });
  memory.writeMemory("b", "b", { ...settings, namespace: "dev", tags: ["python"] });
  memory.writeMemory("c", "c", { ...settings, namespace: "prod", tags: ["typescript"] });

  const results = memory.listMemories({ ...settings, namespace: "dev", tag: "typescript" });
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "a");
});

test("searchMemories: respects namespace filter", () => {
  const { settings } = createFixture();

  memory.writeMemory("dev-note", "important API keys here", { ...settings, namespace: "dev" });
  memory.writeMemory("prod-note", "important API keys here too", { ...settings, namespace: "prod" });

  const devResults = memory.searchMemories("API keys", { ...settings, namespace: "dev" });
  assert.equal(devResults.length, 1);
  assert.equal(devResults[0].name, "dev-note");

  const prodResults = memory.searchMemories("API keys", { ...settings, namespace: "prod" });
  assert.equal(prodResults.length, 1);
  assert.equal(prodResults[0].name, "prod-note");
});

test("searchMemories: respects tag filter", () => {
  const { settings } = createFixture();

  memory.writeMemory("ts-mem", "TypeScript configuration guide", { ...settings, tags: ["typescript"] });
  memory.writeMemory("py-mem", "Python guide", { ...settings, tags: ["python"] });

  const tagResults = memory.searchMemories("guide", { ...settings, tag: "typescript" });
  assert.equal(tagResults.length, 1);
  assert.equal(tagResults[0].name, "ts-mem");
});

test("searchMemories: returns results ordered by relevance", () => {
  const { settings } = createFixture();

  memory.writeMemory("exact-match", "authentication token security", { ...settings, tags: ["security", "auth"] });
  memory.writeMemory("partial-match", "some file about something auth related", { ...settings, tags: ["auth"] });
  memory.writeMemory("unrelated", "general documentation notes", { ...settings, tags: ["docs"] });

  const results = memory.searchMemories("authentication token security", settings);

  assert.ok(results.length >= 1, "should find at least the exact match");
  // The exact-name match (or content match) should rank first
  assert.equal(results[0].name, "exact-match", "exact match should rank highest");
});

test("searchMemories: handles tag-based search scoring", () => {
  const { settings } = createFixture();

  memory.writeMemory("mem-a", "content", { ...settings, tags: ["react", "frontend"] });
  memory.writeMemory("mem-b", "content", { ...settings, tags: ["react"] });
  memory.writeMemory("mem-c", "content", { ...settings, tags: ["node"] });

  const results = memory.searchMemories("frontend", settings);

  assert.equal(results.length, 1);
  assert.equal(results[0].name, "mem-a");
});

test("searchMemories: handles empty query gracefully", () => {
  const { settings } = createFixture();

  memory.writeMemory("test", "content", settings);

  const results = memory.searchMemories("", settings);
  assert.deepEqual(results, []);

  const whitespace = memory.searchMemories("   ", settings);
  assert.deepEqual(whitespace, []);
});

test("normalizeTags: handles various input types", () => {
  assert.deepEqual(memory.normalizeTags(["a", "b"]), ["a", "b"]);
  assert.deepEqual(memory.normalizeTags("a,b,c"), ["a", "b", "c"]);
  assert.deepEqual(memory.normalizeTags([]), []);
  assert.deepEqual(memory.normalizeTags(null), []);
  assert.deepEqual(memory.normalizeTags(undefined), []);
  assert.deepEqual(memory.normalizeTags(""), []);
  assert.deepEqual(memory.normalizeTags(["A", "B"]), ["a", "b"], "tags are lowercased");
  assert.deepEqual(memory.normalizeTags("  TypeScript , React  "), ["typescript", "react"], "whitespace trimmed");
});

test("backward compat: old memories without namespace/tags are treated as default", () => {
  const { settings } = createFixture();

  // Write a memory the old way (no namespace/tags in options)
  const record = memory.writeMemory("old-memory", "old content", settings);

  assert.equal(record.namespace, "default");
  assert.deepEqual(record.tags, []);

  // Reading it back should work
  const read = memory.readMemory("old-memory", settings);
  assert.equal(read.namespace, "default");
  assert.deepEqual(read.tags, []);
});
