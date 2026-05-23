"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  EDGE_TYPES,
  KnowledgeGraph,
  NODE_TYPES,
} = require("../../src/graph/engine");

// ---- Node operations ----

test("KnowledgeGraph: addNode creates a node with correct type and id", () => {
  const kg = new KnowledgeGraph();
  const node = kg.addNode(NODE_TYPES.FILE, "src/index.js", { path: "src/index.js" });

  assert.equal(node.id, "src/index.js");
  assert.equal(node.type, NODE_TYPES.FILE);
  assert.equal(node.properties.path, "src/index.js");
  assert.ok(node.createdAt);
});

test("KnowledgeGraph: addNode throws on empty id", () => {
  const kg = new KnowledgeGraph();

  assert.throws(() => kg.addNode(NODE_TYPES.CONCEPT, ""), {
    message: /non-empty string/,
  });
  assert.throws(() => kg.addNode(NODE_TYPES.CONCEPT, "   "), {
    message: /non-empty string/,
  });
});

test("KnowledgeGraph: addNode throws on invalid node type", () => {
  const kg = new KnowledgeGraph();

  assert.throws(() => kg.addNode("INVALID_TYPE", "test"), {
    message: /Invalid node type/,
  });
});

test("KnowledgeGraph: getNode returns the stored node or null", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.AGENT, "agent-1");

  const node = kg.getNode("agent-1");
  assert.equal(node.id, "agent-1");
  assert.equal(node.type, NODE_TYPES.AGENT);

  assert.equal(kg.getNode("nonexistent"), null);
});

test("KnowledgeGraph: hasNode correctly checks existence", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.TASK, "task-1");

  assert.ok(kg.hasNode("task-1"));
  assert.ok(!kg.hasNode("nope"));
});

test("KnowledgeGraph: nodeCount and nodeIds reflect state", () => {
  const kg = new KnowledgeGraph();

  assert.equal(kg.nodeCount, 0);
  assert.deepEqual(kg.nodeIds, []);

  kg.addNode(NODE_TYPES.FILE, "a.js");
  kg.addNode(NODE_TYPES.FILE, "b.js");
  kg.addNode(NODE_TYPES.CLASS, "MyClass");

  assert.equal(kg.nodeCount, 3);
  assert.deepEqual(kg.nodeIds.sort(), ["MyClass", "a.js", "b.js"].sort());
});

test("KnowledgeGraph: nodes getter returns all nodes", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.CONCEPT, "concept-1", { label: "GraphQL" });
  kg.addNode(NODE_TYPES.CONCEPT, "concept-2", { label: "REST" });

  const allNodes = kg.nodes;
  assert.equal(allNodes.length, 2);
  const labels = allNodes.map((n) => n.properties.label).sort();
  assert.deepEqual(labels, ["GraphQL", "REST"]);
});

// ---- Edge operations ----

test("KnowledgeGraph: addEdge creates a directed edge between nodes", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js");
  kg.addNode(NODE_TYPES.FILE, "b.js");

  const edge = kg.addEdge("a.js", "b.js", EDGE_TYPES.DEPENDS_ON, { weight: 1 });

  assert.equal(edge.from, "a.js");
  assert.equal(edge.to, "b.js");
  assert.equal(edge.type, EDGE_TYPES.DEPENDS_ON);
  assert.equal(edge.properties.weight, 1);
  assert.ok(edge.id.startsWith("e-"));
  assert.ok(edge.createdAt);
});

test("KnowledgeGraph: addEdge throws when source or target node does not exist", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js");

  assert.throws(() => kg.addEdge("nope", "a.js", EDGE_TYPES.DEPENDS_ON), {
    message: /Source node/,
  });
  assert.throws(() => kg.addEdge("a.js", "nope", EDGE_TYPES.DEPENDS_ON), {
    message: /Target node/,
  });
});

test("KnowledgeGraph: addEdge throws on invalid edge type", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js");
  kg.addNode(NODE_TYPES.FILE, "b.js");

  assert.throws(() => kg.addEdge("a.js", "b.js", "FAKE_EDGE"), {
    message: /Invalid edge type/,
  });
});

test("KnowledgeGraph: getEdges retrieves edges by direction", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js");
  kg.addNode(NODE_TYPES.FILE, "b.js");
  kg.addNode(NODE_TYPES.FILE, "c.js");

  kg.addEdge("a.js", "b.js", EDGE_TYPES.DEPENDS_ON);
  kg.addEdge("a.js", "c.js", EDGE_TYPES.DEPENDS_ON);
  kg.addEdge("b.js", "c.js", EDGE_TYPES.CALLS);

  // Outgoing from a.js
  const outgoing = kg.getEdges("a.js", "outgoing");
  assert.equal(outgoing.length, 2);

  // Incoming to c.js
  const incoming = kg.getEdges("c.js", "incoming");
  assert.equal(incoming.length, 2);

  // Both for b.js
  const both = kg.getEdges("b.js", "both");
  assert.equal(both.length, 2);

  // Type filter
  const calls = kg.getEdges("b.js", "outgoing", EDGE_TYPES.CALLS);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, EDGE_TYPES.CALLS);
});

test("KnowledgeGraph: edgeCount and edgeIds reflect state", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js");
  kg.addNode(NODE_TYPES.FILE, "b.js");
  kg.addNode(NODE_TYPES.FILE, "c.js");

  assert.equal(kg.edgeCount, 0);

  kg.addEdge("a.js", "b.js", EDGE_TYPES.DEPENDS_ON);
  kg.addEdge("b.js", "c.js", EDGE_TYPES.CALLS);

  assert.equal(kg.edgeCount, 2);
  assert.equal(kg.edgeIds.length, 2);
});

test("KnowledgeGraph: edges getter returns all edges", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js");
  kg.addNode(NODE_TYPES.FILE, "b.js");

  kg.addEdge("a.js", "b.js", EDGE_TYPES.DEPENDS_ON);
  kg.addEdge("a.js", "b.js", EDGE_TYPES.MODIFIES);

  const allEdges = kg.edges;
  assert.equal(allEdges.length, 2);
});

// ---- Query ----

test("KnowledgeGraph: query by nodeType returns all nodes of that type", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js");
  kg.addNode(NODE_TYPES.FILE, "b.js");
  kg.addNode(NODE_TYPES.TASK, "task-1");

  const result = kg.query({ nodeType: NODE_TYPES.FILE });
  assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes[0].type, NODE_TYPES.FILE);
  assert.equal(result.nodes[1].type, NODE_TYPES.FILE);
});

test("KnowledgeGraph: query with properties filter", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js", { priority: "high", lang: "js" });
  kg.addNode(NODE_TYPES.FILE, "b.js", { priority: "low", lang: "js" });
  kg.addNode(NODE_TYPES.FILE, "c.py", { priority: "high", lang: "py" });

  const result = kg.query({
    nodeType: NODE_TYPES.FILE,
    properties: { priority: "high" },
  });
  assert.equal(result.nodes.length, 2);
  const ids = result.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["a.js", "c.py"]);
});

test("KnowledgeGraph: query with id filter", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js");
  kg.addNode(NODE_TYPES.FILE, "b.js");

  const result = kg.query({ id: "a.js" });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].id, "a.js");
});

test("KnowledgeGraph: query with edge traversal", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js");
  kg.addNode(NODE_TYPES.FILE, "b.js");
  kg.addNode(NODE_TYPES.FILE, "c.js");

  kg.addEdge("a.js", "b.js", EDGE_TYPES.DEPENDS_ON);
  kg.addEdge("b.js", "c.js", EDGE_TYPES.DEPENDS_ON);

  const result = kg.query({
    nodeType: NODE_TYPES.FILE,
    properties: {},
    edges: [{ type: EDGE_TYPES.DEPENDS_ON, direction: "outgoing" }],
  });

  // a.js -> b.js, b.js -> c.js, return nodes along those edges
  assert.ok(result.nodes.length > 0);
  assert.ok(result.edges.length > 0);
});

// ---- Traverse ----

test("KnowledgeGraph: traverse follows outgoing edges by depth", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js");
  kg.addNode(NODE_TYPES.FILE, "b.js");
  kg.addNode(NODE_TYPES.FILE, "c.js");
  kg.addNode(NODE_TYPES.FILE, "d.js");

  kg.addEdge("a.js", "b.js", EDGE_TYPES.DEPENDS_ON);
  kg.addEdge("b.js", "c.js", EDGE_TYPES.DEPENDS_ON);
  kg.addEdge("c.js", "d.js", EDGE_TYPES.DEPENDS_ON);

  // Depth 1: should reach b.js only
  const result1 = kg.traverse("a.js", { maxDepth: 1, direction: "outgoing" });
  assert.equal(result1.nodes.length, 2); // a.js + b.js

  // Depth 2: should reach b.js and c.js
  const result2 = kg.traverse("a.js", { maxDepth: 2, direction: "outgoing" });
  assert.equal(result2.nodes.length, 3); // a.js + b.js + c.js
});

test("KnowledgeGraph: traverse throws on nonexistent start node", () => {
  const kg = new KnowledgeGraph();

  assert.throws(() => kg.traverse("ghost", { maxDepth: 1 }), {
    message: /does not exist/,
  });
});

test("KnowledgeGraph: traverse with nodeFilter", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js", { scope: "src" });
  kg.addNode(NODE_TYPES.FILE, "b.js", { scope: "test" });
  kg.addNode(NODE_TYPES.FILE, "c.js", { scope: "src" });

  kg.addEdge("a.js", "b.js", EDGE_TYPES.DEPENDS_ON);
  kg.addEdge("a.js", "c.js", EDGE_TYPES.DEPENDS_ON);

  const result = kg.traverse("a.js", {
    maxDepth: 1,
    direction: "outgoing",
    nodeFilter: (node) => node.properties.scope === "src",
  });

  const nodeIds = result.nodes.map((n) => n.id).sort();
  assert.deepEqual(nodeIds, ["a.js", "c.js"]);
});

test("KnowledgeGraph: traverse with edgeType filter", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js");
  kg.addNode(NODE_TYPES.FILE, "b.js");
  kg.addNode(NODE_TYPES.FILE, "c.js");

  kg.addEdge("a.js", "b.js", EDGE_TYPES.DEPENDS_ON);
  kg.addEdge("a.js", "c.js", EDGE_TYPES.CALLS);

  const result = kg.traverse("a.js", {
    maxDepth: 1,
    direction: "outgoing",
    edgeTypes: [EDGE_TYPES.CALLS],
  });

  const nodeIds = result.nodes.map((n) => n.id).sort();
  assert.deepEqual(nodeIds, ["a.js", "c.js"]);
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].type, EDGE_TYPES.CALLS);
});

// ---- Remove operations ----

test("KnowledgeGraph: removeNode deletes node and its edges", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js");
  kg.addNode(NODE_TYPES.FILE, "b.js");
  kg.addEdge("a.js", "b.js", EDGE_TYPES.DEPENDS_ON);

  assert.equal(kg.nodeCount, 2);
  assert.equal(kg.edgeCount, 1);

  const removed = kg.removeNode("a.js");
  assert.ok(removed);
  assert.equal(kg.nodeCount, 1);
  assert.equal(kg.edgeCount, 0); // edges were deleted too
  assert.equal(kg.getNode("a.js"), null);
});

test("KnowledgeGraph: removeNode returns false for nonexistent node", () => {
  const kg = new KnowledgeGraph();
  assert.equal(kg.removeNode("nope"), false);
});

test("KnowledgeGraph: removeEdge deletes a specific edge", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js");
  kg.addNode(NODE_TYPES.FILE, "b.js");

  const edge = kg.addEdge("a.js", "b.js", EDGE_TYPES.DEPENDS_ON);
  assert.equal(kg.edgeCount, 1);

  const removed = kg.removeEdge(edge.id);
  assert.ok(removed);
  assert.equal(kg.edgeCount, 0);
});

test("KnowledgeGraph: removeEdge returns false for nonexistent edge", () => {
  const kg = new KnowledgeGraph();
  assert.equal(kg.removeEdge("e-999"), false);
});

// ---- Clear ----

test("KnowledgeGraph: clear removes all nodes and edges", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js");
  kg.addNode(NODE_TYPES.FILE, "b.js");
  kg.addEdge("a.js", "b.js", EDGE_TYPES.DEPENDS_ON);

  assert.equal(kg.nodeCount, 2);
  assert.equal(kg.edgeCount, 1);

  kg.clear();

  assert.equal(kg.nodeCount, 0);
  assert.equal(kg.edgeCount, 0);
  assert.deepEqual(kg.nodeIds, []);
  assert.deepEqual(kg.edgeIds, []);
});

// ---- getNodesByType ----

test("KnowledgeGraph: getNodesByType returns nodes of the specified type", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "f1.js");
  kg.addNode(NODE_TYPES.FILE, "f2.js");
  kg.addNode(NODE_TYPES.CLASS, "c1");
  kg.addNode(NODE_TYPES.FUNCTION, "fn1");

  const files = kg.getNodesByType(NODE_TYPES.FILE);
  assert.equal(files.length, 2);

  const classes = kg.getNodesByType(NODE_TYPES.CLASS);
  assert.equal(classes.length, 1);
});

// ---- name property ----

test("KnowledgeGraph: name defaults to knowledge-graph", () => {
  const kg = new KnowledgeGraph();
  assert.equal(kg.name, "knowledge-graph");
});

test("KnowledgeGraph: custom name is stored", () => {
  const kg = new KnowledgeGraph({ name: "my-project" });
  assert.equal(kg.name, "my-project");
});

// ---- All node types ----

test("KnowledgeGraph: all NODE_TYPES are usable", () => {
  const kg = new KnowledgeGraph();
  const types = Object.values(NODE_TYPES);

  for (const type of types) {
    const id = `node-${type}`;
    const node = kg.addNode(type, id);
    assert.equal(node.type, type);
  }

  assert.equal(kg.nodeCount, types.length);
});

// ---- All edge types ----

test("KnowledgeGraph: all EDGE_TYPES are usable", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.FILE, "a.js");
  kg.addNode(NODE_TYPES.FILE, "b.js");

  const types = Object.values(EDGE_TYPES);

  // Each edge type pair
  for (const type of types) {
    // Re-add nodes since they get removed after some edges
    if (!kg.hasNode("src-" + type)) {
      kg.addNode(NODE_TYPES.FILE, "src-" + type);
    }
    if (!kg.hasNode("tgt-" + type)) {
      kg.addNode(NODE_TYPES.FILE, "tgt-" + type);
    }
    const edge = kg.addEdge("src-" + type, "tgt-" + type, type);
    assert.equal(edge.type, type);
  }
});
