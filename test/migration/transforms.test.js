/**
 * Tests for pre-built migration transforms.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  requireToImport,
  callbackToAsyncAwait,
  varToLetConst,
  stringConcatToTemplate,
  forEachToForOf,
  promiseChainToAsyncAwait,
  functionToArrow,
  objectAssignToSpread,
} = require("../../src/migration/transforms");

// ---------------------------------------------------------------------------
// requireToImport
// ---------------------------------------------------------------------------

test("requireToImport: converts single require to import", () => {
  const input = `"use strict";
const fs = require('fs');
`;
  const output = requireToImport.apply(input, {});
  assert.ok(output.includes("import fs from 'fs';"));
  assert.ok(!output.includes("require('fs')"));
});

test("requireToImport: converts destructured require to import", () => {
  const input = `"use strict";
const { readFile, writeFile } = require('fs');
`;
  const output = requireToImport.apply(input, {});
  assert.ok(output.includes("import { readFile, writeFile } from 'fs';"));
  assert.ok(!output.includes("require('fs')"));
});

test("requireToImport: inserts imports after use strict", () => {
  const input = `"use strict";
// some comment
const _ = require('lodash');
`;
  const output = requireToImport.apply(input, {});
  const lines = output.split("\n");
  const strictIdx = lines.findIndex((l) => l.includes("use strict"));
  const importIdx = lines.findIndex((l) => l.includes("import"));
  assert.ok(importIdx > strictIdx);
});

test("requireToImport: does not convert requires inside strings", () => {
  const input = `"use strict";
const s = "const x = require('fs')";
const fs = require('fs');
`;
  const output = requireToImport.apply(input, {});
  // The string literal should be preserved
  assert.ok(output.includes("require('fs')"));
  // Only one import should be added
  const importCount = (output.match(/import .+ from /g) || []).length;
  assert.equal(importCount, 1);
});

// ---------------------------------------------------------------------------
// varToLetConst
// ---------------------------------------------------------------------------

test("varToLetConst: converts var with literal value to const", () => {
  const input = 'var name = "hello";';
  const output = varToLetConst.apply(input, {});
  assert.ok(output.includes("const name = "));
  assert.ok(!output.includes("var name"));
});

test("varToLetConst: converts var with expression value to let", () => {
  const input = "var result = computeValue();";
  const output = varToLetConst.apply(input, {});
  assert.ok(output.includes("let result = "));
  assert.ok(!output.includes("var result"));
});

test("varToLetConst: converts multiple var declarations", () => {
  const input = `var a = 42;
var b = getValue();
var c = "static";
`;
  const output = varToLetConst.apply(input, {});
  assert.ok(output.includes("const a = 42"));
  assert.ok(output.includes("let b = getValue()"));
  assert.ok(output.includes('const c = "static"'));
  assert.ok(!output.includes("var "));
});

test("varToLetConst: does not modify var inside strings", () => {
  const input = 'var x = "var y = 5;";';
  const output = varToLetConst.apply(input, {});
  // The string content should stay as "var y = 5;"
  assert.ok(output.includes('"var y = 5;"'));
  assert.ok(!output.includes('var x'));
});

// ---------------------------------------------------------------------------
// forEachToForOf
// ---------------------------------------------------------------------------

test("forEachToForOf: converts simple forEach to for...of", () => {
  const input = `items.forEach(item => {
  console.log(item);
});`;
  const output = forEachToForOf.apply(input, {});
  assert.ok(output.includes("for (const item of items)"));
  assert.ok(!output.includes(".forEach("));
});

test("forEachToForOf: does not modify forEach inside a string", () => {
  const input = `const code = "arr.forEach(x => x)";
arr.forEach(item => { console.log(item); });`;
  const output = forEachToForOf.apply(input, {});
  // The string should be preserved
  assert.ok(output.includes('"arr.forEach(x => x)"'));
  assert.ok(output.includes("for (const item of arr)"));
});

// ---------------------------------------------------------------------------
// functionToArrow
// ---------------------------------------------------------------------------

test("functionToArrow: converts named function expression to arrow", () => {
  const input = `"use strict";
const greet = function(name) {
  return "hello " + name;
};`;
  const output = functionToArrow.apply(input, {});
  assert.ok(output.includes("const greet = (name) => {"));
  assert.ok(!output.includes("function("));
});

test("functionToArrow: does not convert function inside strings", () => {
  const input = `const msg = "function test() {}";
const fn = function(x) { return x; };`;
  const output = functionToArrow.apply(input, {});
  assert.ok(output.includes('"function test() {}"'));
  assert.ok(output.includes("(x) => {"));
});

test("functionToArrow: handles function with multiple params", () => {
  const input = `const add = function sum(a, b) {
  return a + b;
};`;
  const output = functionToArrow.apply(input, {});
  assert.ok(output.includes("(a, b) => {"));
});

// ---------------------------------------------------------------------------
// objectAssignToSpread
// ---------------------------------------------------------------------------

test("objectAssignToSpread: converts Object.assign with empty target to spread", () => {
  const input = `const merged = Object.assign({}, a, b);`;
  const output = objectAssignToSpread.apply(input, {});
  assert.ok(output.includes("{ ...a, ...b }"));
  assert.ok(!output.includes("Object.assign"));
});

test("objectAssignToSpread: handles single source", () => {
  const input = `const copy = Object.assign({}, original);`;
  const output = objectAssignToSpread.apply(input, {});
  assert.ok(output.includes("{ ...original }"));
  assert.ok(!output.includes("Object.assign"));
});

test("objectAssignToSpread: does not modify Object.assign inside strings", () => {
  const input = `const hint = "Use Object.assign({}, a, b)";
const merged = Object.assign({}, a, b);`;
  const output = objectAssignToSpread.apply(input, {});
  // String should preserve the mention of Object.assign
  assert.ok(output.includes('"Use Object.assign({}, a, b)"'));
  // The actual code should be transformed
  assert.ok(output.includes("{ ...a, ...b }"));
});

// ---------------------------------------------------------------------------
// stringConcatToTemplate
// ---------------------------------------------------------------------------

test("stringConcatToTemplate: converts simple concatenation to template literal", () => {
  const input = `const msg = 'Hello ' + name + '!';`;
  const output = stringConcatToTemplate.apply(input, {});
  assert.ok(output.includes("`Hello ${name}!`"));
});

test("stringConcatToTemplate: does not modify concatenation inside strings", () => {
  const input = `const example = "'a' + b + 'c'";
const result = 'x' + val + 'y';`;
  const output = stringConcatToTemplate.apply(input, {});
  assert.ok(output.includes("'a' + b + 'c'"));
  assert.ok(output.includes("`x${val}y`"));
});

// ---------------------------------------------------------------------------
// promiseChainToAsyncAwait
// ---------------------------------------------------------------------------

test("promiseChainToAsyncAwait: converts simple then chain", () => {
  const input = `const result = fetchData().then(r => r.json()).then(data => data.id);`;
  const output = promiseChainToAsyncAwait.apply(input, {});
  assert.ok(output.includes("(async () => {"));
  assert.ok(output.includes("await fetchData()"));
  assert.ok(!output.includes(".then("));
});

// ---------------------------------------------------------------------------
// callbackToAsyncAwait
// ---------------------------------------------------------------------------

test("callbackToAsyncAwait: converts fs.readFile callback to try/catch", () => {
  const input = `fs.readFile('test.txt', 'utf8', (err, data) => {
  console.log(data);
});`;
  const output = callbackToAsyncAwait.apply(input, {});
  // The transform wraps the call with try/catch
  assert.ok(output.includes("try {"));
  assert.ok(output.includes("catch (err)"));
});

// ---------------------------------------------------------------------------
// Transform interface compliance
// ---------------------------------------------------------------------------

test("all transforms have name, description, and apply function", () => {
  const transforms = [
    requireToImport,
    callbackToAsyncAwait,
    varToLetConst,
    stringConcatToTemplate,
    forEachToForOf,
    promiseChainToAsyncAwait,
    functionToArrow,
    objectAssignToSpread,
  ];

  for (const t of transforms) {
    assert.ok(typeof t.name === "string", `${t.name}: must have name string`);
    assert.ok(t.name.length > 0, `${t.name}: name must not be empty`);
    assert.ok(typeof t.description === "string", `${t.name}: must have description`);
    assert.ok(typeof t.apply === "function", `${t.name}: must have apply function`);
  }
});

test("transforms are idempotent on already-transformed code", () => {
  // Apply varToLetConst twice; the second pass should not introduce errors
  const input = 'var a = 1;\nvar b = get();';
  const firstPass = varToLetConst.apply(input, {});
  const secondPass = varToLetConst.apply(firstPass, {});
  // Should still be valid JS (no double "const const" or "let let")
  assert.ok(!secondPass.includes("var "));
  assert.ok(!secondPass.includes("const const"));
  assert.ok(!secondPass.includes("let let"));
  assert.ok(!secondPass.includes("let const"));
  assert.ok(!secondPass.includes("const let"));
});
