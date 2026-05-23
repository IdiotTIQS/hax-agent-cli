"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ACCESS_LEVELS,
  AGENT_ROLES,
  ConcurrentKnowledgeBase,
  SharedKnowledgeBase,
} = require("../../src/collab/knowledge-base");

// ---- Registration ----

test("SharedKnowledgeBase: registerAgent adds an agent with a normalized role", () => {
  const kb = new SharedKnowledgeBase();
  kb.registerAgent("architect", "architect");
  kb.registerAgent("alice", "lead");

  assert.deepEqual(kb.agents, ["architect", "alice"]);
});

test("SharedKnowledgeBase: registerAgent defaults unknown roles to observer", () => {
  const kb = new SharedKnowledgeBase();
  kb.registerAgent("bob", "unknown-role");

  assert.equal(kb.agents.length, 1);
  // Should still be registered even with an unrecognized role
  assert.equal(kb.agents[0], "bob");
});

test("SharedKnowledgeBase: registerAgent throws on empty agentId or role", () => {
  const kb = new SharedKnowledgeBase();

  assert.throws(() => kb.registerAgent("", "architect"), {
    message: /non-empty string/,
  });
  assert.throws(() => kb.registerAgent("architect", ""), {
    message: /non-empty string/,
  });
});

// ---- Share and query ----

test("SharedKnowledgeBase: share stores an entry and query retrieves it", () => {
  const kb = new SharedKnowledgeBase();
  kb.registerAgent("architect", "architect");

  const entry = kb.share("architect", "db-schema", { tables: ["users", "posts"] });
  assert.equal(entry.key, "db-schema");
  assert.equal(entry.sharedBy, "architect");
  assert.ok(entry.id.startsWith("kb-"));

  const found = kb.query("db-schema", "architect");
  assert.deepEqual(found.value, { tables: ["users", "posts"] });
});

test("SharedKnowledgeBase: query returns null for unknown key", () => {
  const kb = new SharedKnowledgeBase();
  assert.equal(kb.query("nonexistent"), null);
});

test("SharedKnowledgeBase: query enforces role-required access control", () => {
  const kb = new SharedKnowledgeBase();
  kb.registerAgent("lead", "lead");
  kb.registerAgent("alice", "implementer");
  kb.registerAgent("bob", "explorer");

  kb.share("lead", "secret-plan", "classified-info", {
    accessLevel: ACCESS_LEVELS.restricted,
    roleRequired: "implementer",
  });

  // alice has the required role
  const aliceResult = kb.query("secret-plan", "alice");
  assert.equal(aliceResult.value, "classified-info");

  // bob does not have the required role
  assert.throws(() => kb.query("secret-plan", "bob"), {
    message: /Access denied/,
  });
});

test("SharedKnowledgeBase: lead role can read any access level", () => {
  const kb = new SharedKnowledgeBase();
  kb.registerAgent("lead", "lead");
  kb.registerAgent("alice", "implementer");

  kb.share("alice", "confidential-data", "secret", {
    accessLevel: ACCESS_LEVELS.confidential,
  });

  // lead overrides access control
  const result = kb.query("confidential-data", "lead");
  assert.equal(result.value, "secret");

  // alice can read her own confidential entries
  const ownResult = kb.query("confidential-data", "alice");
  assert.equal(ownResult.value, "secret");
});

// ---- Search ----

test("SharedKnowledgeBase: search matches by key, value, and tags", () => {
  const kb = new SharedKnowledgeBase();
  kb.registerAgent("architect", "architect");

  kb.share("architect", "api-endpoints", "GET /users, POST /users", { tags: ["api", "rest"] });
  kb.share("architect", "db-indexes", "CREATE INDEX on users", { tags: ["database", "performance"] });
  kb.share("architect", "deploy-guide", "Use k8s for deployment", { tags: ["ops", "k8s"] });

  const byKey = kb.search("api");
  assert.equal(byKey.length, 1);
  assert.equal(byKey[0].key, "api-endpoints");

  const byValue = kb.search("k8s");
  assert.equal(byValue.length, 1);
  assert.equal(byValue[0].key, "deploy-guide");

  const byTag = kb.search("database");
  assert.equal(byTag.length, 1);
  assert.equal(byTag[0].key, "db-indexes");
});

test("SharedKnowledgeBase: search filters out entries the agent cannot access", () => {
  const kb = new SharedKnowledgeBase();
  kb.registerAgent("lead", "lead");
  kb.registerAgent("alice", "implementer");

  kb.share("lead", "public-fact", "the sky is blue", { accessLevel: ACCESS_LEVELS.public });
  kb.share("lead", "team-note", "deploy at midnight", { accessLevel: ACCESS_LEVELS.team });

  // alice can see both
  assert.equal(kb.search("sky", "alice").length, 1);
  assert.equal(kb.search("midnight", "alice").length, 1);
});

// ---- Subscribe ----

test("SharedKnowledgeBase: subscribe returns an unsubscribe function that works", () => {
  const kb = new SharedKnowledgeBase();
  kb.registerAgent("alice", "implementer");

  const unsub = kb.subscribe("alice", /^db-/);
  assert.equal(typeof unsub, "function");

  const removed = unsub();
  assert.equal(removed, true);

  // Second call returns false
  assert.equal(unsub(), false);
});

test("SharedKnowledgeBase: subscribe with string pattern is converted to wildcard regex", () => {
  const kb = new SharedKnowledgeBase();
  kb.registerAgent("alice", "implementer");

  const unsub = kb.subscribe("alice", "config-*");
  assert.equal(typeof unsub, "function");
  unsub();
});

// ---- listByAgent ----

test("SharedKnowledgeBase: listByAgent returns all entries shared by a given agent", () => {
  const kb = new SharedKnowledgeBase();
  kb.registerAgent("architect", "architect");
  kb.registerAgent("reviewer", "reviewer");

  kb.share("architect", "roadmap", "Q3 goals");
  kb.share("architect", "conventions", "use tabs");
  kb.share("reviewer", "audit-log", "all clear");

  const architectEntries = kb.listByAgent("architect");
  assert.equal(architectEntries.length, 2);
  assert.deepEqual(architectEntries.map((e) => e.key).sort(), ["conventions", "roadmap"]);

  const reviewerEntries = kb.listByAgent("reviewer");
  assert.equal(reviewerEntries.length, 1);
  assert.equal(reviewerEntries[0].key, "audit-log");
});

// ---- Size, keys, clear ----

test("SharedKnowledgeBase: size and keys reflect current state", () => {
  const kb = new SharedKnowledgeBase();
  kb.registerAgent("architect", "architect");

  assert.equal(kb.size, 0);
  assert.deepEqual(kb.keys, []);

  kb.share("architect", "a", 1);
  kb.share("architect", "b", 2);

  assert.equal(kb.size, 2);
  assert.deepEqual(kb.keys.sort(), ["a", "b"]);
});

test("SharedKnowledgeBase: clear removes all entries and resets sequence", () => {
  const kb = new SharedKnowledgeBase();
  kb.registerAgent("architect", "architect");

  kb.share("architect", "a", 1);
  kb.share("architect", "b", 2);

  assert.equal(kb.size, 2);

  kb.clear();

  assert.equal(kb.size, 0);
  assert.deepEqual(kb.keys, []);
  assert.deepEqual(kb.agents, []);
});

// ---- ConcurrentKnowledgeBase ----

test("ConcurrentKnowledgeBase: share and query work through the async lock", async () => {
  const kb = new ConcurrentKnowledgeBase();
  await kb.registerAgent("architect", "architect");

  const entry = await kb.share("architect", "key1", "value1");
  assert.equal(entry.key, "key1");

  const found = await kb.query("key1", "architect");
  assert.equal(found.value, "value1");
});

test("ConcurrentKnowledgeBase: concurrent writes do not corrupt state", async () => {
  const kb = new ConcurrentKnowledgeBase();
  await kb.registerAgent("architect", "architect");

  const promises = [];
  for (let i = 0; i < 20; i++) {
    promises.push(kb.share("architect", `key-${i}`, i));
  }

  const entries = await Promise.all(promises);
  assert.equal(entries.length, 20);

  const sz = await kb.size();
  assert.equal(sz, 20);

  const keys = await kb.keys();
  assert.equal(keys.length, 20);
});

test("ConcurrentKnowledgeBase: clear resets everything", async () => {
  const kb = new ConcurrentKnowledgeBase();
  await kb.registerAgent("architect", "architect");
  await kb.share("architect", "k", "v");

  await kb.clear();

  const sz = await kb.size();
  assert.equal(sz, 0);
});
