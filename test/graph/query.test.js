"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EDGE_TYPES, KnowledgeGraph, NODE_TYPES } = require("../../src/graph/engine");
const { GraphQuery } = require("../../src/graph/query");

function createFixture() {
  const kg = new KnowledgeGraph({ name: "test-graph" });

  // Build a simple dependency graph
  kg.addNode(NODE_TYPES.FILE, "src/a.js", { lang: "js", priority: "high" });
  kg.addNode(NODE_TYPES.FILE, "src/b.js", { lang: "js", priority: "medium" });
  kg.addNode(NODE_TYPES.FILE, "src/c.js", { lang: "js", priority: "low" });
  kg.addNode(NODE_TYPES.FILE, "src/d.py", { lang: "py", priority: "high" });
  kg.addNode(NODE_TYPES.CONCEPT, "concept-graph", { term: "Graph Theory" });
  kg.addNode(NODE_TYPES.CONCEPT, "concept-algo", { term: "Algorithm" });
  kg.addNode(NODE_TYPES.TASK, "task-1", { name: "build API" });
  kg.addNode(NODE_TYPES.CLASS, "class:Parser", { name: "Parser" });

  // a -> b, a -> c, b -> c
  kg.addEdge("src/a.js", "src/b.js", EDGE_TYPES.DEPENDS_ON);
  kg.addEdge("src/a.js", "src/c.js", EDGE_TYPES.DEPENDS_ON);
  kg.addEdge("src/b.js", "src/c.js", EDGE_TYPES.CALLS);
  kg.addEdge("src/c.js", "src/d.py", EDGE_TYPES.DEPENDS_ON);

  // Concepts
  kg.addEdge("concept-graph", "concept-algo", EDGE_TYPES.RELATED_TO);

  // Task relations
  kg.addEdge("task-1", "src/a.js", EDGE_TYPES.MODIFIES);
  kg.addEdge("task-1", "class:Parser", EDGE_TYPES.IMPLEMENTS);

  const query = new GraphQuery(kg);
  return { kg, query };
}

// ---- Constructor ----

test("GraphQuery: constructor requires KnowledgeGraph instance", () => {
  assert.throws(() => new GraphQuery({}), {
    message: /KnowledgeGraph instance/,
  });
  assert.throws(() => new GraphQuery(null), {
    message: /KnowledgeGraph instance/,
  });
});

// ---- findNodes ----

test("GraphQuery: findNodes returns all nodes of a type", () => {
  const { query } = createFixture();

  const files = query.findNodes(NODE_TYPES.FILE);
  assert.equal(files.length, 4);
  assert.ok(files.every((n) => n.type === NODE_TYPES.FILE));

  const concepts = query.findNodes(NODE_TYPES.CONCEPT);
  assert.equal(concepts.length, 2);
});

test("GraphQuery: findNodes with property filters", () => {
  const { query } = createFixture();

  const highPri = query.findNodes(NODE_TYPES.FILE, { priority: "high" });
  assert.equal(highPri.length, 2);
  assert.deepEqual(
    highPri.map((n) => n.id).sort(),
    ["src/a.js", "src/d.py"]
  );

  const pyFiles = query.findNodes(NODE_TYPES.FILE, { lang: "py" });
  assert.equal(pyFiles.length, 1);
  assert.equal(pyFiles[0].id, "src/d.py");
});

test("GraphQuery: findNodes with regex property filter", () => {
  const { query } = createFixture();

  const graphConcepts = query.findNodes(NODE_TYPES.CONCEPT, {
    term: /graph/i,
  });
  assert.equal(graphConcepts.length, 1);
  assert.equal(graphConcepts[0].id, "concept-graph");
});

// ---- findPaths ----

test("GraphQuery: findPaths finds all paths between nodes", () => {
  const { query } = createFixture();

  const paths = query.findPaths("src/a.js", "src/c.js", 3);
  assert.ok(paths.length >= 1);

  // Verify paths start at a.js and end at c.js
  for (const path of paths) {
    assert.equal(path[0], "src/a.js");
    assert.equal(path[path.length - 1], "src/c.js");
  }

  // Path lengths should be at most maxDepth + 1
  for (const path of paths) {
    assert.ok(path.length <= 3 + 1);
  }
});

test("GraphQuery: findPaths returns empty array when no path exists", () => {
  const { query } = createFixture();

  const paths = query.findPaths("src/c.js", "task-1", 3);
  assert.deepEqual(paths, []);
});

test("GraphQuery: findPaths throws for nonexistent nodes", () => {
  const { query } = createFixture();

  assert.throws(() => query.findPaths("ghost", "src/a.js"), {
    message: /does not exist/,
  });
  assert.throws(() => query.findPaths("src/a.js", "ghost"), {
    message: /does not exist/,
  });
});

// ---- findNeighbors ----

test("GraphQuery: findNeighbors returns immediate neighbors", () => {
  const { query } = createFixture();

  const neighborhood = query.findNeighbors("src/a.js", 1);
  // a.js + b.js + c.js + task-1 (incoming MODIFIES edge from task-1)
  assert.ok(neighborhood.nodes.length >= 3);

  const nodeIds = neighborhood.nodes.map((n) => n.id).sort();
  assert.ok(nodeIds.includes("src/a.js"));
  assert.ok(nodeIds.includes("src/b.js"));
  assert.ok(nodeIds.includes("src/c.js"));
});

test("GraphQuery: findNeighbors returns deeper neighbors with increased depth", () => {
  const { query } = createFixture();

  const neighborhood = query.findNeighbors("src/a.js", 2);
  // a.js, b.js, c.js, d.py are reachable within depth 2
  const nodeIds = neighborhood.nodes.map((n) => n.id).sort();
  assert.ok(nodeIds.includes("src/d.py"), "d.py should be reachable at depth 2");
});

// ---- findCentralNodes ----

test("GraphQuery: findCentralNodes returns nodes sorted by edge count", () => {
  const { query } = createFixture();

  const central = query.findCentralNodes();
  assert.ok(central.length > 0);
  assert.ok(central.length <= 10);

  // src/c.js has incoming from a.js and b.js, outgoing to d.py = 3 edges
  // src/a.js has outgoing to b.js and c.js = 2 edges
  // The most connected should have the highest edge count
  assert.ok(central[0].edgeCount >= central[1].edgeCount,
    "first central node should have most edges");
});

test("GraphQuery: findCentralNodes respects limit parameter", () => {
  const { query } = createFixture();

  const central = query.findCentralNodes(2);
  assert.equal(central.length, 2);
});

// ---- findClusters ----

test("GraphQuery: findClusters detects communities", () => {
  const { query } = createFixture();

  const clusters = query.findClusters();
  assert.ok(clusters instanceof Map);
  assert.ok(clusters.size > 0, "should find at least one cluster");

  // All nodes should be assigned to some cluster
  let totalAssigned = 0;
  for (const [, members] of clusters) {
    totalAssigned += members.length;
  }
  assert.equal(totalAssigned, 8); // all 8 nodes assigned
});

test("GraphQuery: findClusters converges within max iterations", () => {
  const { query } = createFixture();

  const clusters = query.findClusters(5);
  assert.ok(clusters instanceof Map);
  assert.ok(clusters.size > 0);
});

// ---- shortestPath ----

test("GraphQuery: shortestPath finds shortest path between connected nodes", () => {
  const { query } = createFixture();

  const path = query.shortestPath("src/a.js", "src/c.js");
  assert.ok(Array.isArray(path));
  assert.equal(path[0], "src/a.js");
  assert.equal(path[path.length - 1], "src/c.js");
  assert.equal(path.length, 2); // a.js -> c.js is direct
});

test("GraphQuery: shortestPath returns [id] when from equals to", () => {
  const { query } = createFixture();

  const path = query.shortestPath("src/a.js", "src/a.js");
  assert.deepEqual(path, ["src/a.js"]);
});

test("GraphQuery: shortestPath returns null for disconnected nodes", () => {
  const { query } = createFixture();

  // concept-algo is not reachable from c.js
  const path = query.shortestPath("src/c.js", "concept-algo");
  assert.equal(path, null);
});

// ---- stats ----

test("GraphQuery: stats reports correct node and edge counts", () => {
  const { query } = createFixture();

  const s = query.stats();
  assert.equal(s.nodeCount, 8);
  // fixture edges: a->b, a->c, b->c, c->d, concept-graph->concept-algo, task-1->a, task-1->Parser = 7
  assert.ok(s.edgeCount >= 7);
  assert.ok(typeof s.nodeTypes === "object");
  assert.ok(typeof s.edgeTypes === "object");

  // Check node type distribution
  assert.equal(s.nodeTypes[NODE_TYPES.FILE], 4);
  assert.equal(s.nodeTypes[NODE_TYPES.CONCEPT], 2);
});

// ---- Empty graph edge cases ----

test("GraphQuery: handles empty graph gracefully", () => {
  const kg = new KnowledgeGraph();
  const query = new GraphQuery(kg);

  assert.deepEqual(query.findNodes(NODE_TYPES.FILE), []);
  assert.deepEqual(query.findClusters(), new Map());
  assert.deepEqual(query.findCentralNodes(), []);
  assert.equal(query.shortestPath("nope", "also-nope"), null);

  const s = query.stats();
  assert.equal(s.nodeCount, 0);
  assert.equal(s.edgeCount, 0);
});
