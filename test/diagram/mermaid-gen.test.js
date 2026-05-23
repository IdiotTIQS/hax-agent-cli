"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  generateMermaid,
  flowchartFromDependencies,
  sequenceFromMessages,
  classFromCode,
  stateFromLifecycle,
  erFromSchema,
  ganttFromTasks,
} = require("../../src/diagram/mermaid-gen");

// ── generateMermaid dispatcher ──────────────────────────────

test("generateMermaid: dispatches flowchart type correctly", () => {
  const result = generateMermaid("flowchart", {
    nodes: [{ name: "A" }],
  });
  assert.ok(result.startsWith("flowchart "));
  assert.ok(result.includes("A["));
});

test("generateMermaid: dispatches sequenceDiagram type", () => {
  const result = generateMermaid("sequenceDiagram", {
    messages: [{ from: "User", to: "Agent", label: "hello" }],
  });
  assert.ok(result.startsWith("sequenceDiagram"));
  assert.ok(result.includes("User"));
  assert.ok(result.includes("Agent"));
});

test("generateMermaid: dispatches classDiagram type", () => {
  const result = generateMermaid("classDiagram", {
    classes: [{ name: "User" }],
  });
  assert.ok(result.startsWith("classDiagram"));
  assert.ok(result.includes("class User"));
});

test("generateMermaid: dispatches stateDiagram type", () => {
  const result = generateMermaid("stateDiagram", {
    states: [{ name: "idle" }],
  });
  assert.ok(result.startsWith("stateDiagram"));
  assert.ok(result.includes("idle"));
});

test("generateMermaid: dispatches erDiagram type", () => {
  const result = generateMermaid("erDiagram", {
    entities: [{ entity: "Users", attributes: [{ name: "id", type: "int" }] }],
  });
  assert.ok(result.startsWith("erDiagram"));
  assert.ok(result.includes("Users"));
});

test("generateMermaid: throws on unknown type", () => {
  assert.throws(() => {
    generateMermaid("bogus", {});
  }, /Unknown Mermaid diagram type/);
});

test("generateMermaid: dispatches gantt type", () => {
  const result = generateMermaid("gantt", {
    tasks: [{ name: "Task 1", start: "2024-01-01", duration: 5 }],
  });
  assert.ok(result.startsWith("gantt"));
  assert.ok(result.includes("Task 1"));
});

// ── flowchartFromDependencies ───────────────────────────────

test("flowchartFromDependencies: builds nodes and edges", () => {
  const result = flowchartFromDependencies({
    direction: "LR",
    nodes: [
      { name: "main", deps: ["helper"] },
      { name: "helper", deps: [] },
    ],
  });
  assert.ok(result.includes("flowchart LR"));
  assert.ok(result.includes("main["));
  assert.ok(result.includes("helper["));
  assert.ok(result.includes("main --> helper"));
});

test("flowchartFromDependencies: adds title when provided", () => {
  const result = flowchartFromDependencies({
    title: "My Flow",
    nodes: [{ name: "A" }],
  });
  assert.ok(result.includes("title: My Flow"));
});

test("flowchartFromDependencies: handles node types", () => {
  const result = flowchartFromDependencies({
    nodes: [
      { name: "Start", type: "terminator" },
      { name: "Check", type: "decision" },
    ],
  });
  assert.ok(result.includes("(("));  // terminator uses (())
  assert.ok(result.includes("{"));   // decision uses {}
});

// ── sequenceFromMessages ────────────────────────────────────

test("sequenceFromMessages: builds participants and arrows", () => {
  const result = sequenceFromMessages({
    title: "Protocol",
    messages: [
      { from: "Alice", to: "Bob", label: "greet", type: "request" },
      { from: "Bob", to: "Alice", label: "reply", type: "response" },
    ],
  });
  assert.ok(result.includes("Alice"));
  assert.ok(result.includes("Bob"));
  assert.ok(result.includes("greet"));
  assert.ok(result.includes("reply"));
});

test("sequenceFromMessages: handles empty messages", () => {
  const result = sequenceFromMessages({ messages: [] });
  assert.ok(result.startsWith("sequenceDiagram"));
  // Should have no participants beyond the header
  const lines = result.split("\n").filter(l => l.startsWith("    participant"));
  assert.equal(lines.length, 0);
});

test("sequenceFromMessages: uses correct arrow types", () => {
  const result = sequenceFromMessages({
    messages: [
      { from: "X", to: "Y", type: "response" },
    ],
  });
  // response uses -->>
  assert.ok(result.includes("-->>"));
});

// ── classFromCode ───────────────────────────────────────────

test("classFromCode: builds classes with members", () => {
  const result = classFromCode({
    classes: [
      {
        name: "Person",
        type: "entity",
        members: [{ name: "name", type: "String" }],
        methods: [{ name: "greet", returnType: "void" }],
      },
    ],
    relations: [],
  });
  assert.ok(result.includes("class Person"));
  assert.ok(result.includes("+name String"));
  assert.ok(result.includes("+greet() void"));
  assert.ok(result.includes("<<entity>>"));
});

test("classFromCode: renders class relations", () => {
  const result = classFromCode({
    classes: [
      { name: "A" },
      { name: "B" },
    ],
    relations: [
      { from: "A", to: "B", relation: "extends" },
    ],
  });
  assert.ok(result.includes("A <|-- B"));
});

test("classFromCode: renders inheritance from extends property", () => {
  const result = classFromCode({
    classes: [
      { name: "Dog", extends: "Animal" },
    ],
  });
  assert.ok(result.includes("Animal <|-- Dog"));
});

// ── stateFromLifecycle ──────────────────────────────────────

test("stateFromLifecycle: builds states and transitions", () => {
  const result = stateFromLifecycle({
    states: [
      { name: "idle" },
      { name: "running" },
    ],
    transitions: [
      { from: "idle", to: "running", event: "start" },
    ],
  });
  assert.ok(result.includes("[*] -->"));
  assert.ok(result.includes("idle"));
  assert.ok(result.includes("running"));
  assert.ok(result.includes("start"));
});

test("stateFromLifecycle: handles initial marker", () => {
  const result = stateFromLifecycle({
    initial: "loading",
    states: [{ name: "loading" }],
  });
  assert.ok(result.includes("[*] -->"));
});

test("stateFromLifecycle: handles start/end wildcards in transitions", () => {
  const result = stateFromLifecycle({
    states: [{ name: "middle" }],
    transitions: [
      { from: "start", to: "middle" },
      { from: "middle", to: "end" },
    ],
  });
  assert.ok(result.includes("[*] -->"));
  assert.ok(result.includes("--> [*]"));
});

// ── erFromSchema ────────────────────────────────────────────

test("erFromSchema: builds entities and attributes", () => {
  const result = erFromSchema({
    entities: [
      {
        entity: "Users",
        attributes: [
          { name: "id", type: "int", key: "PK" },
          { name: "email", type: "string" },
        ],
      },
    ],
  });
  assert.ok(result.includes("Users"));
  assert.ok(result.includes("PK int id"));
  assert.ok(result.includes("string email"));
});

test("erFromSchema: renders relationships", () => {
  const result = erFromSchema({
    entities: [
      { entity: "Users", attributes: [] },
      { entity: "Posts", attributes: [] },
    ],
    relationships: [
      { from: "Users", to: "Posts", type: "one-to-many", label: "writes" },
    ],
  });
  assert.ok(result.includes("Users ||--o{ Posts"));
  assert.ok(result.includes("writes"));
});

test("erFromSchema: supports many relationship types", () => {
  const oneToMany = erFromSchema({
    entities: [{ entity: "A", attributes: [] }, { entity: "B", attributes: [] }],
    relationships: [{ from: "A", to: "B", type: "1:N" }],
  });
  assert.ok(oneToMany.includes("||--o{"));

  const manyToMany = erFromSchema({
    entities: [{ entity: "A", attributes: [] }, { entity: "B", attributes: [] }],
    relationships: [{ from: "A", to: "B", type: "many_many" }],
  });
  assert.ok(manyToMany.includes("}o--o{"));
});

// ── ganttFromTasks ──────────────────────────────────────────

test("ganttFromTasks: builds gantt with tasks", () => {
  const result = ganttFromTasks({
    title: "Project Plan",
    dateFormat: "YYYY-MM-DD",
    tasks: [
      { name: "Design", start: "2024-01-01", end: "2024-01-05" },
      { name: "Implement", start: "2024-01-06", duration: 10 },
    ],
  });
  assert.ok(result.includes("title: Project Plan"));
  assert.ok(result.includes("dateFormat  YYYY-MM-DD"));
  assert.ok(result.includes("Design"));
  assert.ok(result.includes("Implement"));
});

test("ganttFromTasks: handles sections", () => {
  const result = ganttFromTasks({
    sections: [
      { name: "Phase 1" },
      { name: "Phase 2" },
    ],
    tasks: [
      { name: "Task A", section: "Phase 1", start: "2024-01-01", duration: 3 },
      { name: "Task B", section: "Phase 2", start: "2024-01-04", duration: 5 },
    ],
  });
  assert.ok(result.includes("section Phase 1"));
  assert.ok(result.includes("section Phase 2"));
  assert.ok(result.includes("Task A"));
  assert.ok(result.includes("Task B"));
});

test("ganttFromTasks: handles empty input", () => {
  const result = ganttFromTasks({ tasks: [] });
  assert.ok(result.startsWith("gantt"));
});
