/**
 * Tests for semantic-diff module.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  diffFiles,
  diffFunctions,
  diffImports,
  diffExports,
  diffStructure,
  parseImports,
  parseExports,
  parseStructure,
} = require("../../src/diff/semantic-diff");

// ---------------------------------------------------------------------------
// diffFunctions
// ---------------------------------------------------------------------------

test("diffFunctions: detects added functions", () => {
  const oldC = `function foo() { return 1; }`;
  const newC = `function foo() { return 1; }\nfunction bar() { return 2; }`;

  const result = diffFunctions(oldC, newC);

  assert.equal(result.type, "added");
  const added = result.elements.filter((e) => e.change === "added");
  assert.equal(added.length, 1);
  assert.equal(added[0].name, "bar");
});

test("diffFunctions: detects removed functions", () => {
  const oldC = `function foo() { return 1; }\nfunction bar() { return 2; }`;
  const newC = `function foo() { return 1; }`;

  const result = diffFunctions(oldC, newC);

  assert.equal(result.type, "removed");
  const removed = result.elements.filter((e) => e.change === "removed");
  assert.equal(removed.length, 1);
  assert.equal(removed[0].name, "bar");
});

test("diffFunctions: detects modified function signatures", () => {
  const oldC = `function add(a, b) { return a + b; }`;
  const newC = `function add(a, b, c) { return a + b + c; }`;

  const result = diffFunctions(oldC, newC);

  const modified = result.elements.filter((e) => e.change === "modified");
  assert.ok(modified.length >= 1, "should have at least one modified element");
  assert.equal(modified[0].name, "add");
});

test("diffFunctions: detects unchanged functions", () => {
  const oldC = `function foo() { return 1; }`;
  const newC = `function foo() { return 1; }`;

  const result = diffFunctions(oldC, newC);

  assert.equal(result.type, "unchanged");
  const unchanged = result.elements.filter((e) => e.change === "unchanged");
  assert.equal(unchanged.length, 1);
  assert.equal(unchanged[0].name, "foo");
});

test("diffFunctions: handles arrow functions", () => {
  const oldC = `const greet = (name) => "hi " + name;`;
  const newC = `const greet = (name) => "hi " + name;\nconst farewell = (name) => "bye " + name;`;

  const result = diffFunctions(oldC, newC);

  const added = result.elements.filter((e) => e.change === "added");
  assert.equal(added.length, 1);
  assert.equal(added[0].name, "farewell");
});

// ---------------------------------------------------------------------------
// diffImports
// ---------------------------------------------------------------------------

test("diffImports: detects added ESM imports", () => {
  const oldC = `import { foo } from "./foo.js";`;
  const newC = `import { foo } from "./foo.js";\nimport { bar } from "./bar.js";`;

  const result = diffImports(oldC, newC);

  const added = result.elements.filter((e) => e.change === "added");
  assert.ok(added.length >= 1, "should have at least one added import");
});

test("diffImports: detects removed imports", () => {
  const oldC = `import { foo } from "./foo.js";\nimport { bar } from "./bar.js";`;
  const newC = `import { foo } from "./foo.js";`;

  const result = diffImports(oldC, newC);

  const removed = result.elements.filter((e) => e.change === "removed");
  assert.ok(removed.length >= 1, "should have at least one removed import");
});

test("diffImports: handles CJS require", () => {
  const oldC = `const fs = require("fs");`;
  const newC = `const fs = require("fs");\nconst path = require("path");`;

  const result = diffImports(oldC, newC);

  const added = result.elements.filter((e) => e.change === "added");
  assert.ok(added.length >= 1, "should have at least one added CJS require");
});

test("diffImports: unchanged when imports are identical", () => {
  const oldC = `import { foo } from "./foo.js";`;
  const newC = `import { foo } from "./foo.js";`;

  const result = diffImports(oldC, newC);

  assert.equal(result.type, "unchanged");
});

// ---------------------------------------------------------------------------
// diffExports
// ---------------------------------------------------------------------------

test("diffExports: detects added exports", () => {
  const oldC = `module.exports = { foo };`;
  const newC = `module.exports = { foo };\nexports.bar = bar;`;

  const result = diffExports(oldC, newC);

  const added = result.elements.filter((e) => e.change === "added");
  assert.ok(added.length >= 1, "added exports should include bar");
});

test("diffExports: detects ESM named exports", () => {
  const oldC = `export function foo() {}`;
  const newC = `export function foo() {}\nexport function bar() {}`;

  const result = diffExports(oldC, newC);

  const added = result.elements.filter((e) => e.change === "added");
  assert.ok(added.length >= 1, "should detect added named export");
  const bar = added.find((e) => e.name === "bar");
  assert.ok(bar, "should find bar in added exports");
});

test("diffExports: parseExports extracts named, default, and CJS exports", () => {
  const content = `
    export function foo() {}
    export default class App {}
    export { bar, baz };
    module.exports = main;
    exports.extra = extra;
  `;

  const exportsList = parseExports(content);
  assert.ok(exportsList.length >= 4, `expected at least 4 exports, got ${exportsList.length}`);

  const names = exportsList.map((e) => e.name);
  assert.ok(names.includes("foo"), "should find named export 'foo'");
  assert.ok(names.includes("main"), "should find module.exports 'main'");
  assert.ok(names.includes("extra"), "should find exports.extra 'extra'");
});

// ---------------------------------------------------------------------------
// diffStructure
// ---------------------------------------------------------------------------

test("diffStructure: detects class additions", () => {
  const oldC = `function foo() {}`;
  const newC = `function foo() {}\nclass Bar {}`;

  const result = diffStructure(oldC, newC);

  const added = result.elements.filter((e) => e.change === "added");
  assert.equal(added.length, 1);
  assert.equal(added[0].name, "Bar");
  assert.equal(added[0].type, "class");
});

test("diffStructure: detects function removal at structural level", () => {
  const oldC = `function foo() {}\nfunction bar() {}`;
  const newC = `function foo() {}`;

  const result = diffStructure(oldC, newC);

  const removed = result.elements.filter((e) => e.change === "removed");
  assert.equal(removed.length, 1);
  assert.equal(removed[0].name, "bar");
});

// ---------------------------------------------------------------------------
// diffFiles (orchestrator)
// ---------------------------------------------------------------------------

test("diffFiles: returns all scopes by default", () => {
  const oldC = "function a() {}";
  const newC = "function a() {}\nfunction b() {}";

  const result = diffFiles(oldC, newC);

  assert.ok(result.functions, "should include functions");
  assert.ok(result.imports, "should include imports");
  assert.ok(result.exports, "should include exports");
  assert.ok(result.structure, "should include structure");
  assert.equal(result.functions.type, "added");
});

test("diffFiles: filters to specific scopes", () => {
  const oldC = "function a() {}";
  const newC = "function a() {}\nfunction b() {}";

  const result = diffFiles(oldC, newC, { scopes: ["functions"] });

  assert.ok(result.functions, "should include functions");
  assert.equal(result.imports, null, "should not include imports");
  assert.equal(result.exports, null, "should not include exports");
  assert.equal(result.structure, null, "should not include structure");
});

// ---------------------------------------------------------------------------
// Internals: parseStructure, parseImports, parseExports
// ---------------------------------------------------------------------------

test("parseStructure: extracts classes, functions, and arrow functions", () => {
  const content = `
    class UserController {}
    function handleRequest() {}
    const validate = (data) => {};
  `;

  const elements = parseStructure(content);
  const types = elements.map((e) => e.type);
  assert.ok(types.includes("class"));
  assert.ok(types.includes("function"));
  assert.ok(types.includes("arrow-function"));
});

test("parseImports: handles ESM and CJS patterns", () => {
  const content = `
    import React from "react";
    import { useState, useEffect } from "react";
    import type { User } from "./types";
    const fs = require("fs");
    const { join } = require("path");
  `;

  const imports = parseImports(content);
  assert.ok(imports.length >= 3, `expected at least 3 imports, got ${imports.length}`);

  const sources = imports.map((i) => i.source);
  assert.ok(sources.includes("react"));
  assert.ok(sources.includes("fs"));
});
