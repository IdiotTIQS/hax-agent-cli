/**
 * DiscoveryEngine tests — getFeatured, getTrending, getRecommended,
 * getSimilar, getByCategory, getStats, trackInteraction.
 *
 * Node.js native test runner.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { AgentCatalog } = require("../../src/hub/catalog");
const { RatingSystem } = require("../../src/hub/rating");
const { DiscoveryEngine, CATEGORIES } = require("../../src/hub/discovery");

// ─── helpers ────────────────────────────────────────────────────────────

function setup() {
  const catalog = new AgentCatalog();
  const ratings = new RatingSystem();
  const discovery = new DiscoveryEngine(catalog, ratings);
  return { catalog, ratings, discovery };
}

function seedItems(catalog) {
  return {
    agent1: catalog.publish({
      type: "agent", name: "Code Reviewer", author: "alice",
      description: "Reviews code for bugs and style",
      tags: ["code", "review", "quality"], category: "CODE_REVIEW",
      downloads: 150,
    }),
    agent2: catalog.publish({
      type: "agent", name: "Security Scanner", author: "bob",
      description: "Scans for security vulnerabilities",
      tags: ["security", "scan", "audit"], category: "SECURITY",
      downloads: 300,
    }),
    agent3: catalog.publish({
      type: "agent", name: "Test Runner", author: "carol",
      description: "Runs test suites and reports results",
      tags: ["test", "runner", "quality"], category: "TESTING",
      downloads: 200,
    }),
    team1: catalog.publish({
      type: "team", name: "CI/CD Pipeline", author: "dave",
      description: "Full CI/CD team configuration",
      tags: ["devops", "ci", "cd"], category: "DEVOPS",
      downloads: 80,
    }),
    skill1: catalog.publish({
      type: "skill", name: "Data Migrator", author: "eve",
      description: "Migrates data between formats",
      tags: ["data", "migration"], category: "DATA",
      downloads: 50,
    }),
  };
}

function seedRatings(ratings, items) {
  // Code Reviewer: avg 4.5 (two ratings)
  ratings.rate(items.agent1.id, "u1", 5, "Excellent code reviewer!");
  ratings.rate(items.agent1.id, "u2", 4, "Very good");
  // Security Scanner: avg 5 (one rating)
  ratings.rate(items.agent2.id, "u1", 5, "Best security tool ever");
  // Test Runner: avg 3 (two ratings)
  ratings.rate(items.agent3.id, "u1", 3, "It's okay");
  ratings.rate(items.agent3.id, "u2", 3, "Average");
  // Team: avg 4
  ratings.rate(items.team1.id, "u2", 4, "Solid pipeline");
}

// ─── constructor validation ──────────────────────────────────────────────

test("constructor requires AgentCatalog and RatingSystem", () => {
  const catalog = new AgentCatalog();
  const ratings = new RatingSystem();

  assert.throws(() => new DiscoveryEngine(null, ratings), {
    message: /requires an AgentCatalog/,
  });
  assert.throws(() => new DiscoveryEngine(catalog, null), {
    message: /requires a RatingSystem/,
  });
  assert.throws(() => new DiscoveryEngine({}, {}), {
    message: /requires an AgentCatalog/,
  });
});

test("constructor succeeds with valid dependencies", () => {
  const catalog = new AgentCatalog();
  const ratings = new RatingSystem();
  const discovery = new DiscoveryEngine(catalog, ratings);

  assert.ok(discovery instanceof DiscoveryEngine);
  assert.equal(discovery.catalog, catalog);
  assert.equal(discovery.ratings, ratings);
});

// ─── getFeatured ─────────────────────────────────────────────────────────

test("getFeatured returns highest-rated items", () => {
  const { catalog, ratings, discovery } = setup();
  const items = seedItems(catalog);
  seedRatings(ratings, items);

  const featured = discovery.getFeatured(3);

  assert.equal(featured.length, 3);
  // Security Scanner has avg 5
  assert.equal(featured[0].name, "Security Scanner");
  // Code Reviewer has avg 4.5
  assert.equal(featured[1].name, "Code Reviewer");
});

test("getFeatured returns empty for empty catalog", () => {
  const { discovery } = setup();
  assert.deepEqual(discovery.getFeatured(), []);
});

test("getFeatured respects limit parameter", () => {
  const { catalog, ratings, discovery } = setup();
  const items = seedItems(catalog);
  seedRatings(ratings, items);

  assert.equal(discovery.getFeatured(2).length, 2);
  assert.equal(discovery.getFeatured(10).length, 5); // only 5 items total
});

// ─── getTrending ─────────────────────────────────────────────────────────

test("getTrending returns recent items when no interaction events", () => {
  const { catalog, discovery } = setup();
  seedItems(catalog);

  const trending = discovery.getTrending(3);
  assert.equal(trending.length, 3);
  // Without events, defaults to most recently updated
});

test("getTrending ranks by recent activity", () => {
  const { catalog, ratings, discovery } = setup();
  const items = seedItems(catalog);
  seedRatings(ratings, items);

  // Simulate heavy activity on one item
  discovery.trackInteraction(items.team1.id, "u1", "view");
  discovery.trackInteraction(items.team1.id, "u2", "download");
  discovery.trackInteraction(items.team1.id, "u3", "view");

  const trending = discovery.getTrending(5);
  // The team item should bubble to the top due to activity
  assert.equal(trending[0].name, "CI/CD Pipeline");
  assert.ok(trending[0]._activity >= 3);
});

test("getTrending returns empty for empty catalog", () => {
  const { discovery } = setup();
  assert.deepEqual(discovery.getTrending(), []);
});

// ─── getRecommended ──────────────────────────────────────────────────────

test("getRecommended returns featured for new users", () => {
  const { catalog, ratings, discovery } = setup();
  const items = seedItems(catalog);
  seedRatings(ratings, items);

  const recommendations = discovery.getRecommended("new-user", 3);
  assert.equal(recommendations.length, 3);
  // For a new user, falls back to featured (highest rated first)
  assert.equal(recommendations[0].name, "Security Scanner");
});

test("getRecommended returns personalized for returning users", () => {
  const { catalog, ratings, discovery } = setup();
  const items = seedItems(catalog);

  // User has viewed several code-related items
  discovery.trackInteraction(items.agent1.id, "alice", "download"); // Code Reviewer
  discovery.trackInteraction(items.agent3.id, "alice", "view");     // Test Runner (shares "quality" tag)

  seedRatings(ratings, items);

  const recommendations = discovery.getRecommended("alice", 5);
  assert.ok(recommendations.length > 0, "returns recommendations");

  // User should NOT see items they already interacted with
  const recommendedIds = new Set(recommendations.map((r) => r.id));
  assert.ok(!recommendedIds.has(items.agent1.id), "does not include already-downloaded agent1");
  assert.ok(!recommendedIds.has(items.agent3.id), "does not include already-viewed agent3");
});

test("getRecommended returns empty for empty catalog", () => {
  const { discovery } = setup();
  assert.deepEqual(discovery.getRecommended("anyone"), []);
});

// ─── getSimilar ──────────────────────────────────────────────────────────

test("getSimilar finds items with tag overlap", () => {
  const { catalog, ratings, discovery } = setup();
  const items = seedItems(catalog);
  seedRatings(ratings, items);

  // Code Reviewer has tags: ["code", "review", "quality"]
  // Similar items should include those sharing tags
  const similar = discovery.getSimilar(items.agent1.id, 3);

  assert.ok(similar.length > 0, "finds similar items");
  // Test Runner shares the "quality" tag
  const testRunner = similar.find((i) => i.name === "Test Runner");
  assert.ok(testRunner, "Test Runner is similar via quality tag");
  assert.ok(testRunner._similarityScore > 0);
});

test("getSimilar returns empty for unknown item", () => {
  const { catalog, ratings, discovery } = setup();
  seedItems(catalog);

  assert.deepEqual(discovery.getSimilar("nonexistent"), []);
});

test("getSimilar excludes the source item from results", () => {
  const { catalog, ratings, discovery } = setup();
  const items = seedItems(catalog);
  seedRatings(ratings, items);

  const similar = discovery.getSimilar(items.agent1.id, 10);
  const ids = similar.map((i) => i.id);
  assert.ok(!ids.includes(items.agent1.id), "source item excluded");
});

test("getSimilar returns empty when nothing shares tags", () => {
  const { catalog, ratings, discovery } = setup();
  catalog.publish({
    type: "agent", name: "Lone Wolf",
    tags: ["unique-tag-no-one-else-has"],
  });
  catalog.publish({
    type: "team", name: "Different",
    tags: ["completely-different"],
  });

  const similar = discovery.getSimilar(
    catalog.search("Lone Wolf")[0].id, 5,
  );
  // No tag overlap, so nothing is similar enough
  assert.equal(similar.length, 0);
});

// ─── getByCategory ───────────────────────────────────────────────────────

test("getByCategory returns items in a category", () => {
  const { catalog, ratings, discovery } = setup();
  const items = seedItems(catalog);
  seedRatings(ratings, items);

  const codeReview = discovery.getByCategory("CODE_REVIEW");
  assert.equal(codeReview.length, 1);
  assert.equal(codeReview[0].name, "Code Reviewer");
});

test("getByCategory sorts by rating by default", () => {
  const { catalog, ratings, discovery } = setup();
  seedItems(catalog);
  // Add a second CODE_REVIEW item with higher rating
  const better = catalog.publish({
    type: "agent", name: "Super Reviewer",
    category: "CODE_REVIEW", tags: ["review"],
  });
  ratings.rate(better.id, "u1", 5);
  ratings.rate(better.id, "u2", 5);

  const results = discovery.getByCategory("CODE_REVIEW");
  assert.equal(results[0].name, "Super Reviewer"); // avg 5 beats previously higher
});

test("getByCategory returns empty for invalid category", () => {
  const { catalog, discovery } = setup();
  seedItems(catalog);

  assert.deepEqual(discovery.getByCategory("INVALID"), []);
});

test("getByCategory supports sortBy downloads", () => {
  const { catalog, ratings, discovery } = setup();
  seedItems(catalog);

  const results = discovery.getByCategory("SECURITY", { sortBy: "downloads" });
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "Security Scanner");
});

// ─── getStats ────────────────────────────────────────────────────────────

test("getStats returns comprehensive statistics", () => {
  const { catalog, ratings, discovery } = setup();
  const items = seedItems(catalog);
  seedRatings(ratings, items);

  discovery.trackInteraction(items.agent1.id, "u1", "view");
  discovery.trackInteraction(items.agent1.id, "u1", "download");
  discovery.trackInteraction(items.agent2.id, "u2", "download");

  const stats = discovery.getStats();

  assert.equal(stats.totalItems, 5);
  assert.equal(stats.totalDownloads, 780); // 150+300+200+80+50
  assert.equal(stats.totalRatings, 6);     // 2+1+2+1 = 6
  assert.equal(stats.totalInteractions, 3);
  assert.equal(stats.uniqueUsers, 2);
  assert.equal(stats.byType.agent, 3);
  assert.equal(stats.byType.team, 1);
  assert.equal(stats.byType.skill, 1);
  assert.ok(typeof stats.overallAverage === "number");
});

test("getStats on empty catalog returns zeroes", () => {
  const { discovery } = setup();

  const stats = discovery.getStats();
  assert.equal(stats.totalItems, 0);
  assert.equal(stats.totalDownloads, 0);
  assert.equal(stats.totalRatings, 0);
  assert.equal(stats.overallAverage, 0);
});

// ─── trackInteraction ────────────────────────────────────────────────────

test("trackInteraction records events and user item sets", () => {
  const { catalog, discovery } = setup();
  const item = catalog.publish({
    type: "agent", name: "Test", tags: [],
  });

  const event = discovery.trackInteraction(item.id, "user-x", "download");
  assert.ok(event, "returns event object");
  assert.equal(event.itemId, item.id);
  assert.equal(event.userId, "user-x");
  assert.equal(event.action, "download");
  assert.ok(typeof event.timestamp === "string");
});

test("trackInteraction handles invalid inputs gracefully", () => {
  const { discovery } = setup();

  assert.equal(discovery.trackInteraction("", "user-a", "view"), undefined);
  assert.equal(discovery.trackInteraction("item-1", "", "view"), undefined);
});

// ─── constants ───────────────────────────────────────────────────────────

test("CATEGORIES contains all expected categories", () => {
  assert.equal(CATEGORIES.length, 10);
  assert.ok(CATEGORIES.includes("CODE_GEN"));
  assert.ok(CATEGORIES.includes("CODE_REVIEW"));
  assert.ok(CATEGORIES.includes("TESTING"));
  assert.ok(CATEGORIES.includes("DEVOPS"));
  assert.ok(CATEGORIES.includes("SECURITY"));
  assert.ok(CATEGORIES.includes("DATA"));
  assert.ok(CATEGORIES.includes("DOCS"));
  assert.ok(CATEGORIES.includes("REFACTORING"));
  assert.ok(CATEGORIES.includes("DEBUGGING"));
  assert.ok(CATEGORIES.includes("CUSTOM"));
});
