/**
 * AgentCatalog tests — publish, unpublish, search, list, update, stats.
 *
 * Node.js native test runner.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { AgentCatalog, VALID_TYPES, VALID_CATEGORIES } = require("../../src/hub/catalog");

// ─── helpers ────────────────────────────────────────────────────────────

function makeItem(overrides = {}) {
  return {
    type: "agent",
    name: "Test Agent",
    version: "1.0.0",
    author: "tester",
    description: "A test agent for catalog tests",
    tags: ["test", "example"],
    category: "TESTING",
    content: { prompt: "You are a test agent." },
    ...overrides,
  };
}

// ─── publish ─────────────────────────────────────────────────────────────

test("publish creates item with id and timestamps", () => {
  const catalog = new AgentCatalog();
  const item = catalog.publish(makeItem());

  assert.ok(typeof item.id === "string", "id is a string");
  assert.ok(item.id.startsWith("item-"), "id starts with item-");
  assert.equal(item.type, "agent");
  assert.equal(item.name, "Test Agent");
  assert.equal(item.version, "1.0.0");
  assert.equal(item.author, "tester");
  assert.equal(item.category, "TESTING");
  assert.equal(item.rating, 0);
  assert.equal(item.downloads, 0);
  assert.ok(typeof item.createdAt === "string", "createdAt is set");
  assert.ok(typeof item.updatedAt === "string", "updatedAt is set");
  assert.deepEqual(item.tags, ["example", "test"]);
  assert.deepEqual(item.content, { prompt: "You are a test agent." });
});

test("publish defaults missing fields", () => {
  const catalog = new AgentCatalog();
  const item = catalog.publish({
    type: "skill",
    name: "Minimal Skill",
  });

  assert.equal(item.version, "0.1.0");
  assert.equal(item.author, "anonymous");
  assert.equal(item.description, "");
  assert.deepEqual(item.tags, []);
  assert.equal(item.category, null);
  assert.equal(item.rating, 0);
  assert.equal(item.downloads, 0);
  assert.equal(item.content, null);
});

test("publish assigns unique ids", () => {
  const catalog = new AgentCatalog();
  const a = catalog.publish(makeItem({ name: "Alpha" }));
  const b = catalog.publish(makeItem({ name: "Beta" }));

  assert.notEqual(a.id, b.id, "ids are unique");
});

test("publish validates required fields", () => {
  const catalog = new AgentCatalog();

  assert.throws(() => catalog.publish(null), { message: /must be an object/ });
  assert.throws(() => catalog.publish({}), { message: /name is required/ });
  assert.throws(() => catalog.publish({ name: "Bad Type", type: "invalid" }), {
    message: /Invalid item type/,
  });
  assert.throws(
    () => catalog.publish({ name: "Bad Category", type: "agent", category: "NOPE" }),
    { message: /Invalid category/ },
  );
  assert.throws(
    () => catalog.publish({ name: "Bad Rating", type: "agent", rating: 99 }),
    { message: /Rating must be a number between 0 and 5/ },
  );
  assert.throws(
    () => catalog.publish({ name: "Bad Downloads", type: "agent", downloads: -1 }),
    { message: /Downloads must be a non-negative integer/ },
  );
});

test("publish freezes returned item", () => {
  const catalog = new AgentCatalog();
  const item = catalog.publish(makeItem());

  assert.throws(() => {
    item.name = "Hacked";
  }, "returned item is frozen");
});

// ─── unpublish ───────────────────────────────────────────────────────────

test("unpublish removes item from catalog", () => {
  const catalog = new AgentCatalog();
  const item = catalog.publish(makeItem());

  assert.equal(catalog.count(), 1);
  const removed = catalog.unpublish(item.id);
  assert.equal(removed, true);
  assert.equal(catalog.count(), 0);
  assert.equal(catalog.getItem(item.id), null);
});

test("unpublish returns false for unknown id", () => {
  const catalog = new AgentCatalog();
  assert.equal(catalog.unpublish("nonexistent"), false);
});

test("unpublish throws for empty id", () => {
  const catalog = new AgentCatalog();
  assert.throws(() => catalog.unpublish(""), { message: /id is required/ });
});

// ─── getItem / getAll / count ────────────────────────────────────────────

test("getItem retrieves by id", () => {
  const catalog = new AgentCatalog();
  const published = catalog.publish(makeItem({ name: "FindMe" }));

  const found = catalog.getItem(published.id);
  assert.equal(found.name, "FindMe");
  assert.equal(found.id, published.id);
});

test("getItem returns null for missing id", () => {
  const catalog = new AgentCatalog();
  assert.equal(catalog.getItem("missing"), null);
  assert.equal(catalog.getItem(""), null);
  assert.equal(catalog.getItem(null), null);
});

test("getAll returns all items", () => {
  const catalog = new AgentCatalog();
  catalog.publish(makeItem({ name: "A" }));
  catalog.publish(makeItem({ name: "B" }));
  catalog.publish(makeItem({ name: "C" }));

  assert.equal(catalog.getAll().length, 3);
  assert.equal(catalog.count(), 3);
});

// ─── search ──────────────────────────────────────────────────────────────

test("search finds items by name", () => {
  const catalog = new AgentCatalog();
  catalog.publish(makeItem({ name: "Code Reviewer" }));
  catalog.publish(makeItem({ name: "Test Runner" }));
  catalog.publish(makeItem({ name: "Doc Writer" }));

  const results = catalog.search("code");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "Code Reviewer");
});

test("search finds items by tag", () => {
  const catalog = new AgentCatalog();
  catalog.publish(makeItem({ name: "Alpha", tags: ["security", "audit"] }));
  catalog.publish(makeItem({ name: "Beta", tags: ["testing", "unit"] }));

  const results = catalog.search("security");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "Alpha");
});

test("search finds items by author", () => {
  const catalog = new AgentCatalog();
  catalog.publish(makeItem({ name: "Alpha", author: "alice" }));
  catalog.publish(makeItem({ name: "Beta", author: "bob" }));

  const results = catalog.search("alice");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "Alpha");
});

test("search returns empty for no match", () => {
  const catalog = new AgentCatalog();
  catalog.publish(makeItem({ name: "Alpha" }));

  assert.deepEqual(catalog.search("xyzzy"), []);
  assert.deepEqual(catalog.search(""), []);
  assert.deepEqual(catalog.search("  "), []);
});

test("search matches all terms (AND logic)", () => {
  const catalog = new AgentCatalog();
  catalog.publish(makeItem({ name: "Security Code Reviewer", tags: ["security", "code"] }));
  catalog.publish(makeItem({ name: "Security Scanner", tags: ["security"] }));
  catalog.publish(makeItem({ name: "Code Formatter", tags: ["code"] }));

  const results = catalog.search("security code");
  // Only the first item has both "security" AND "code"
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "Security Code Reviewer");
});

test("search results sorted by relevance then name", () => {
  const catalog = new AgentCatalog();
  // This one matches "test" in name, tags, and description — higher relevance
  catalog.publish(
    makeItem({
      name: "AAA Test Master",
      tags: ["test"],
      description: "Testing everything with tests",
    }),
  );
  // This one only has "test" in name
  catalog.publish(makeItem({ name: "ZZZ Test Helper", tags: ["other"] }));

  const results = catalog.search("test");
  assert.equal(results.length, 2);
  // More matches = higher score = first
  assert.equal(results[0].name, "AAA Test Master");
  assert.equal(results[1].name, "ZZZ Test Helper");
});

// ─── list ────────────────────────────────────────────────────────────────

test("list filters by type", () => {
  const catalog = new AgentCatalog();
  catalog.publish(makeItem({ name: "Agent A", type: "agent" }));
  catalog.publish(makeItem({ name: "Team A", type: "team" }));
  catalog.publish(makeItem({ name: "Skill A", type: "skill" }));

  const agents = catalog.list({ type: "agent" });
  assert.equal(agents.length, 1);
  assert.equal(agents[0].name, "Agent A");

  const teams = catalog.list({ type: "team" });
  assert.equal(teams.length, 1);
  assert.equal(teams[0].name, "Team A");
});

test("list filters by category", () => {
  const catalog = new AgentCatalog();
  catalog.publish(makeItem({ name: "Security Agent", category: "SECURITY" }));
  catalog.publish(makeItem({ name: "Test Agent", category: "TESTING" }));
  catalog.publish(makeItem({ name: "DevOps Agent", category: "DEVOPS" }));

  const secResults = catalog.list({ category: "SECURITY" });
  assert.equal(secResults.length, 1);
  assert.equal(secResults[0].name, "Security Agent");
});

test("list supports sorting", () => {
  const catalog = new AgentCatalog();
  catalog.publish(makeItem({ name: "Charlie", downloads: 30, rating: 3 }));
  catalog.publish(makeItem({ name: "Alpha", downloads: 10, rating: 5 }));
  catalog.publish(makeItem({ name: "Bravo", downloads: 20, rating: 4 }));

  // Sort by name ascending
  const byName = catalog.list({ sortBy: "name", order: "asc" });
  assert.deepEqual(byName.map((i) => i.name), ["Alpha", "Bravo", "Charlie"]);

  // Sort by downloads descending
  const byDownloads = catalog.list({ sortBy: "downloads", order: "desc" });
  assert.deepEqual(byDownloads.map((i) => i.name), ["Charlie", "Bravo", "Alpha"]);
});

test("list supports pagination with offset and limit", () => {
  const catalog = new AgentCatalog();
  for (let i = 0; i < 10; i++) {
    catalog.publish(makeItem({ name: `Agent ${i}` }));
  }

  const page1 = catalog.list({ sortBy: "name", order: "asc", limit: 3, offset: 0 });
  assert.equal(page1.length, 3);
  assert.equal(page1[0].name, "Agent 0");

  const page2 = catalog.list({ sortBy: "name", order: "asc", limit: 3, offset: 3 });
  assert.equal(page2.length, 3);
  assert.equal(page2[0].name, "Agent 3");
});

// ─── update ───────────────────────────────────────────────────────────────

test("update modifies existing item fields", () => {
  const catalog = new AgentCatalog();
  const original = catalog.publish(makeItem({ name: "Original" }));

  const updated = catalog.update(original.id, {
    name: "Renamed",
    description: "New description",
    tags: ["updated"],
  });

  assert.equal(updated.id, original.id, "id preserved");
  assert.equal(updated.name, "Renamed");
  assert.equal(updated.description, "New description");
  assert.deepEqual(updated.tags, ["updated"]);
  assert.equal(updated.type, "agent", "unchanged fields preserved");
  assert.equal(updated.createdAt, original.createdAt, "createdAt preserved");
  assert.ok(
    new Date(updated.updatedAt).getTime() >= new Date(original.updatedAt).getTime(),
    "updatedAt bumped or same (sub-ms)",
  );
});

test("update throws for unknown id", () => {
  const catalog = new AgentCatalog();
  assert.throws(() => catalog.update("nonexistent", { name: "X" }), {
    message: /not found/,
  });
});

test("update validates merged item", () => {
  const catalog = new AgentCatalog();
  const item = catalog.publish(makeItem());

  assert.throws(() => catalog.update(item.id, { name: "" }), {
    message: /name is required/,
  });
  assert.throws(() => catalog.update(item.id, { rating: 99 }), {
    message: /Rating must be a number/,
  });
});

// ─── stats ────────────────────────────────────────────────────────────────

test("stats returns totals by type and category", () => {
  const catalog = new AgentCatalog();
  catalog.publish(makeItem({ type: "agent", category: "SECURITY" }));
  catalog.publish(makeItem({ type: "agent", category: "TESTING" }));
  catalog.publish(makeItem({ type: "team", category: "DEVOPS" }));
  catalog.publish(makeItem({ type: "skill", category: null }));

  const stats = catalog.stats();
  assert.equal(stats.total, 4);
  assert.deepEqual(stats.byType, { agent: 2, team: 1, skill: 1 });
  assert.equal(stats.byCategory.SECURITY, 1);
  assert.equal(stats.byCategory.TESTING, 1);
  assert.equal(stats.byCategory.DEVOPS, 1);
  assert.equal(stats.byCategory.uncategorized, 1);
});

test("stats on empty catalog returns zeroes", () => {
  const catalog = new AgentCatalog();
  const stats = catalog.stats();
  assert.equal(stats.total, 0);
  assert.deepEqual(stats.byType, {});
  assert.deepEqual(stats.byCategory, {});
});

// ─── constants ───────────────────────────────────────────────────────────

test("VALID_TYPES contains expected values", () => {
  assert.deepEqual(VALID_TYPES, ["agent", "team", "skill", "config"]);
});

test("VALID_CATEGORIES contains expected values", () => {
  assert.ok(VALID_CATEGORIES.includes("CODE_GEN"));
  assert.ok(VALID_CATEGORIES.includes("CODE_REVIEW"));
  assert.ok(VALID_CATEGORIES.includes("TESTING"));
  assert.ok(VALID_CATEGORIES.includes("DEVOPS"));
  assert.ok(VALID_CATEGORIES.includes("SECURITY"));
  assert.ok(VALID_CATEGORIES.includes("DATA"));
  assert.ok(VALID_CATEGORIES.includes("DOCS"));
  assert.ok(VALID_CATEGORIES.includes("REFACTORING"));
  assert.ok(VALID_CATEGORIES.includes("DEBUGGING"));
  assert.ok(VALID_CATEGORIES.includes("CUSTOM"));
  assert.equal(VALID_CATEGORIES.length, 10);
});
