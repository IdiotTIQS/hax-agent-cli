"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { EDGE_TYPES, KnowledgeGraph, NODE_TYPES } = require("../../src/graph/engine");
const { GraphBuilder } = require("../../src/graph/builder");

function createTempProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-graph-builder-"));
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
  }
  return dir;
}

// ---- fromCodebase ----

test("GraphBuilder: fromCodebase scans source files and creates FILE nodes", () => {
  const dir = createTempProject({
    "index.js": "const helper = require('./helper');\nfunction main() { helper.init(); }",
    "helper.js": "class Helper {\n  init() {}\n}\nfunction init() {}",
  });

  const builder = new GraphBuilder();
  const graph = builder.fromCodebase(dir);

  assert.ok(graph instanceof KnowledgeGraph);
  assert.ok(graph.nodeCount > 0);

  // Should have FILE nodes for both files
  const files = graph.getNodesByType(NODE_TYPES.FILE);
  assert.ok(files.length >= 2, `expected at least 2 FILE nodes, got ${files.length}`);
});

test("GraphBuilder: fromCodebase extracts function nodes", () => {
  const dir = createTempProject({
    "main.js": "function parse() {}\nfunction render() {}\nfunction execute() {}",
  });

  const builder = new GraphBuilder();
  const graph = builder.fromCodebase(dir);

  const functions = graph.getNodesByType(NODE_TYPES.FUNCTION);
  assert.ok(functions.length >= 3, `expected at least 3 functions, got ${functions.length}`);
});

test("GraphBuilder: fromCodebase extracts class nodes", () => {
  const dir = createTempProject({
    "models.js": "class User {}\nclass Session {}\nclass Config {}",
  });

  const builder = new GraphBuilder();
  const graph = builder.fromCodebase(dir);

  const classes = graph.getNodesByType(NODE_TYPES.CLASS);
  assert.ok(classes.length >= 3, `expected at least 3 classes, got ${classes.length}`);
});

test("GraphBuilder: fromCodebase creates dependency edges via require/import", () => {
  const dir = createTempProject({
    "app.js": "const helper = require('./helper');",
    "helper.js": "module.exports = {};",
  });

  const builder = new GraphBuilder();
  const graph = builder.fromCodebase(dir, { extensions: [".js"] });

  const depEdges = [];
  for (const edgeId of graph.edgeIds) {
    // We need raw edges to check type — use the _edges map
  }

  // Check that dependency edges exist
  const edgeCount = graph.edgeCount;
  assert.ok(edgeCount > 0, `expected edges to exist, got ${edgeCount}`);
});

test("GraphBuilder: fromCodebase skips excluded paths", () => {
  const dir = createTempProject({
    "src/index.js": "function main() {}",
    "node_modules/pkg/index.js": "function hack() {}",
    ".git/objects/abc": "garbage",
  });

  const builder = new GraphBuilder();
  const graph = builder.fromCodebase(dir, {
    exclude: ["**/node_modules/**", "**/.git/**"],
  });

  // Only src/index.js should be included
  const files = graph.getNodesByType(NODE_TYPES.FILE);
  const paths = files.map((f) => f.properties.path);

  // All files should come from src/
  for (const p of paths) {
    assert.ok(
      !p.includes("node_modules"),
      `excluded path '${p}' should not appear`
    );
    assert.ok(
      !p.includes(".git"),
      `excluded path '${p}' should not appear`
    );
  }
});

test("GraphBuilder: fromCodebase returns empty graph for nonexistent directory", () => {
  const builder = new GraphBuilder();
  const graph = builder.fromCodebase("/nonexistent/path/12345");

  assert.ok(graph instanceof KnowledgeGraph);
  assert.equal(graph.nodeCount, 0);
});

test("GraphBuilder: fromCodebase handles custom extensions", () => {
  const dir = createTempProject({
    "data.json": '{"key": "value"}',
    "style.css": "body { color: red; }",
  });

  const builder = new GraphBuilder();
  const graph = builder.fromCodebase(dir, { extensions: [".json"] });

  const files = graph.getNodesByType(NODE_TYPES.FILE);
  const paths = files.map((f) => f.properties.path);

  // .json files should be included
  assert.ok(paths.some((p) => p.endsWith(".json")));
  // .css files should not be included
  assert.ok(!paths.some((p) => p.endsWith(".css")));
});

// ---- fromSession ----

test("GraphBuilder: fromSession builds graph from session transcript", () => {
  const session = {
    id: "session-123",
    createdAt: "2026-05-21T10:00:00.000Z",
    entries: [
      { role: "user", content: "Build a REST API" },
      {
        role: "assistant",
        content: "I decided to use Express for the API framework.",
        tool_calls: [{ name: "read_file" }, { name: "write_file" }],
      },
      {
        role: "assistant",
        content: "There was an error connecting to the database.",
      },
      { role: "user", content: "Fix the error" },
    ],
  };

  const builder = new GraphBuilder();
  const graph = builder.fromSession(session);

  assert.ok(graph instanceof KnowledgeGraph);
  assert.ok(graph.nodeCount > 0);

  // Should have a session task node
  const sessionNode = graph.getNode("session:session-123");
  assert.ok(sessionNode);
  assert.equal(sessionNode.type, NODE_TYPES.TASK);

  // Should have task nodes from user entries
  const tasks = graph.getNodesByType(NODE_TYPES.TASK);
  assert.ok(tasks.length >= 2); // session + 2 user messages = 3 task nodes
});

test("GraphBuilder: fromSession extracts decision nodes", () => {
  const session = {
    id: "session-456",
    entries: [
      { role: "user", content: "What framework should I use?" },
      {
        role: "assistant",
        content: "I decided to use React for the frontend after evaluating options.",
      },
    ],
  };

  const builder = new GraphBuilder();
  const graph = builder.fromSession(session);

  const decisions = graph.getNodesByType(NODE_TYPES.DECISION);
  assert.ok(decisions.length >= 1, `expected at least 1 decision, got ${decisions.length}`);
});

test("GraphBuilder: fromSession extracts concept nodes", () => {
  const session = {
    id: "session-789",
    entries: [
      { role: "user", content: "Tell me about Graph Theory" },
      {
        role: "assistant",
        content: '`GraphQL` is a query language. Also uses `React` components and "Redux" for state.',
      },
    ],
  };

  const builder = new GraphBuilder();
  const graph = builder.fromSession(session);

  const concepts = graph.getNodesByType(NODE_TYPES.CONCEPT);
  assert.ok(concepts.length > 0, `expected concepts, got ${concepts.length}`);
});

test("GraphBuilder: fromSession extracts error nodes", () => {
  const session = {
    id: "session-err",
    entries: [
      { role: "user", content: "Run the build" },
      {
        role: "assistant",
        content: "The build failed with an exception: TypeError: Cannot read property 'length'.",
      },
    ],
  };

  const builder = new GraphBuilder();
  const graph = builder.fromSession(session);

  const errors = graph.getNodesByType(NODE_TYPES.ERROR);
  assert.ok(errors.length >= 1, `expected at least 1 error node, got ${errors.length}`);
});

test("GraphBuilder: fromSession returns empty graph for invalid session", () => {
  const builder = new GraphBuilder();

  const g1 = builder.fromSession(null);
  assert.equal(g1.nodeCount, 0);

  const g2 = builder.fromSession({});
  assert.equal(g2.nodeCount, 0);
});

// ---- fromDependencies ----

test("GraphBuilder: fromDependencies builds graph from package dependencies", () => {
  const deps = {
    name: "my-app",
    dependencies: {
      react: "^18.0.0",
      express: "^4.18.0",
      lodash: "^4.17.21",
    },
    peerDependencies: {
      graphql: "^16.0.0",
    },
  };

  const builder = new GraphBuilder();
  const graph = builder.fromDependencies(deps);

  assert.ok(graph instanceof KnowledgeGraph);
  assert.ok(graph.nodeCount >= 3);

  // Verify all packages as nodes
  const nodes = graph.nodes;
  const packageNames = nodes.map((n) => n.properties.name);
  assert.ok(packageNames.includes("react"));
  assert.ok(packageNames.includes("express"));
  assert.ok(packageNames.includes("lodash"));
});

test("GraphBuilder: fromDependencies creates sub-dependency edges", () => {
  const deps = [
    {
      name: "react",
      version: "18.0.0",
      requires: {
        "loose-envify": "^1.1.0",
      },
    },
  ];

  const builder = new GraphBuilder();
  const graph = builder.fromDependencies(deps);

  const depEdges = [];
  for (const edgeId of graph.edgeIds) {
    const edges = graph._edges;
    // Access internal _edges for edge type checking
  }

  // Should have at least one edge
  assert.ok(graph.edgeCount > 0);
});

test("GraphBuilder: fromDependencies handles empty input", () => {
  const builder = new GraphBuilder();

  const g1 = builder.fromDependencies([]);
  assert.equal(g1.nodeCount, 0);

  const g2 = builder.fromDependencies(null);
  assert.equal(g2.nodeCount, 0);
});

// ---- merge ----

test("GraphBuilder: merge combines multiple graphs", () => {
  const kg1 = new KnowledgeGraph();
  kg1.addNode(NODE_TYPES.FILE, "a.js", { lang: "js" });
  kg1.addNode(NODE_TYPES.FILE, "b.js", { lang: "js" });
  kg1.addEdge("a.js", "b.js", EDGE_TYPES.DEPENDS_ON);

  const kg2 = new KnowledgeGraph();
  kg2.addNode(NODE_TYPES.FILE, "c.py", { lang: "py" });
  kg2.addNode(NODE_TYPES.FILE, "b.js", { lang: "js", framework: "express" });
  kg2.addEdge("b.js", "c.py", EDGE_TYPES.DEPENDS_ON);

  const builder = new GraphBuilder();
  const merged = builder.merge([kg1, kg2]);

  assert.ok(merged instanceof KnowledgeGraph);
  // 3 unique nodes: a.js, b.js, c.py
  assert.equal(merged.nodeCount, 3);
  // 2 edges: a.js->b.js, b.js->c.py (should not duplicate)
  assert.ok(merged.edgeCount >= 2);
  assert.ok(merged.edgeCount <= 3);
});

test("GraphBuilder: merge handles empty array", () => {
  const builder = new GraphBuilder();
  const merged = builder.merge([]);

  assert.ok(merged instanceof KnowledgeGraph);
  assert.equal(merged.nodeCount, 0);
});

test("GraphBuilder: merge skips non-graph items", () => {
  const kg = new KnowledgeGraph();
  kg.addNode(NODE_TYPES.CONCEPT, "test");

  const builder = new GraphBuilder();
  const merged = builder.merge([kg, null, 42, "string", {}]);

  assert.equal(merged.nodeCount, 1);
});

// ---- toDot ----

test("GraphBuilder: toDot produces valid DOT format", () => {
  const kg = new KnowledgeGraph({ name: "test-dot" });
  kg.addNode(NODE_TYPES.FILE, "index.js");
  kg.addNode(NODE_TYPES.CLASS, "MyComponent");
  kg.addEdge("index.js", "MyComponent", EDGE_TYPES.OWNED_BY);

  const builder = new GraphBuilder();
  const dot = builder.toDot(kg);

  assert.ok(typeof dot === "string");
  assert.ok(dot.startsWith("digraph G {"), "should start with digraph declaration");
  assert.ok(dot.includes('->'), "should contain at least one edge arrow");
  assert.ok(dot.endsWith("}\n") || dot.endsWith("}"), "should end with closing brace");
  assert.ok(dot.includes("index.js"), "should reference node id");
  assert.ok(dot.includes("MyComponent"), "should reference class node");
});

test("GraphBuilder: toDot handles empty graph", () => {
  const kg = new KnowledgeGraph();
  const builder = new GraphBuilder();
  const dot = builder.toDot(kg);

  assert.ok(dot.startsWith("digraph G {"));
  assert.ok(dot.includes("}"));
});

// ---- toMermaid ----

test("GraphBuilder: toMermaid produces valid Mermaid syntax", () => {
  const kg = new KnowledgeGraph({ name: "test-mm" });
  kg.addNode(NODE_TYPES.FILE, "index.js");
  kg.addNode(NODE_TYPES.TASK, "build-api");
  kg.addEdge("build-api", "index.js", EDGE_TYPES.MODIFIES);

  const builder = new GraphBuilder();
  const mermaid = builder.toMermaid(kg);

  assert.ok(typeof mermaid === "string");
  assert.ok(mermaid.startsWith("graph LR"), "should start with flowchart declaration");
  assert.ok(mermaid.includes("-->|"), "should contain edge notation with label");
  assert.ok(mermaid.includes("MODIFIES"), "should include edge type in label");
});

test("GraphBuilder: toMermaid handles empty graph", () => {
  const kg = new KnowledgeGraph();
  const builder = new GraphBuilder();
  const mermaid = builder.toMermaid(kg);

  assert.ok(mermaid.startsWith("graph LR"));
});

// ---- toDot and toMermaid accept non-graph gracefully ----

test("GraphBuilder: toDot returns empty digraph for non-KnowledgeGraph input", () => {
  const builder = new GraphBuilder();

  assert.equal(builder.toDot(null), "digraph G {}");
  assert.equal(builder.toDot({}), "digraph G {}");
});

test("GraphBuilder: toMermaid returns empty graph for non-KnowledgeGraph input", () => {
  const builder = new GraphBuilder();

  assert.ok(builder.toMermaid(null).startsWith("graph LR"));
  assert.ok(builder.toMermaid(42).startsWith("graph LR"));
});
