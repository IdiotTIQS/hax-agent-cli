/**
 * Tests for semantic code search (ast-grep.js).
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  searchFunctionCalls,
  searchFunctionDefinitions,
  searchVariableReferences,
  searchImports,
  searchClassDefinitions,
  searchPatterns,
  findExcludedRegions,
  isExcluded,
  offsetToPosition,
} = require("../../src/search/ast-grep");

// -----------------------------------------------------------------------
// findExcludedRegions
// -----------------------------------------------------------------------

test("findExcludedRegions: skips single-line comments", () => {
  const code = "const x = 1; // this is a comment\nconst y = 2;";
  const regions = findExcludedRegions(code);
  // "// this is a comment" should be excluded
  const commentOffset = code.indexOf("//");
  assert.ok(isExcluded(commentOffset, regions), "comment start should be excluded");
  // Code before the comment should be included
  assert.ok(!isExcluded(0, regions), "code before comment should not be excluded");
});

test("findExcludedRegions: skips block comments", () => {
  const code = "/* block\ncomment */ const x = 1;";
  const regions = findExcludedRegions(code);
  const commentOffset = code.indexOf("/*");
  assert.ok(isExcluded(commentOffset, regions), "block comment start should be excluded");
  // Code after comment should be included
  const afterOffset = code.indexOf("const");
  assert.ok(!isExcluded(afterOffset, regions), "code after block comment should not be excluded");
});

test("findExcludedRegions: skips string literals", () => {
  const code = "'hello world'; const x = \"test\"; const y = `template`;";
  const regions = findExcludedRegions(code);
  // Single-quoted
  const sqOffset = code.indexOf("'");
  assert.ok(isExcluded(sqOffset, regions), "single-quoted string should be excluded");
  // Double-quoted
  const dqOffset = code.indexOf('"');
  assert.ok(isExcluded(dqOffset, regions), "double-quoted string should be excluded");
  // Template literal
  const tplOffset = code.indexOf("`");
  assert.ok(isExcluded(tplOffset, regions), "template string should be excluded");
});

// -----------------------------------------------------------------------
// offsetToPosition
// -----------------------------------------------------------------------

test("offsetToPosition: computes correct line and column", () => {
  const code = "line one\nline two\nline three";
  // offset 13 = 't' in "two" (line one\n = 9 chars, then "line " = 5 chars = 14 for 't'...)
  // offset 14 = 't' in "two" on line 2, column 6
  const pos = offsetToPosition(code, 14); // "t" in "two"
  assert.equal(pos.line, 2);
  assert.equal(pos.column, 6);
});

test("offsetToPosition: handles start of file", () => {
  const code = "first line";
  const pos = offsetToPosition(code, 0);
  assert.equal(pos.line, 1);
  assert.equal(pos.column, 1);
});

// -----------------------------------------------------------------------
// searchFunctionCalls
// -----------------------------------------------------------------------

test("searchFunctionCalls: finds direct calls", () => {
  const code = "foo();\nbar();\nfoo(1, 2);";
  const results = searchFunctionCalls(code, "foo");
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.match === "foo"));
});

test("searchFunctionCalls: ignores calls inside comments", () => {
  const code = "// foo()\nfoo();\n/* foo() */";
  const results = searchFunctionCalls(code, "foo");
  assert.equal(results.length, 1, "only real call outside comments should match");
});

test("searchFunctionCalls: ignores calls inside strings", () => {
  const code = 'const s = "foo() is called";\nfoo();';
  const results = searchFunctionCalls(code, "foo");
  assert.equal(results.length, 1, "only real call outside strings should match");
});

// -----------------------------------------------------------------------
// searchFunctionDefinitions
// -----------------------------------------------------------------------

test("searchFunctionDefinitions: finds named function declarations", () => {
  const code = "function hello() {}\nfunction world() {}";
  const results = searchFunctionDefinitions(code, "hello");
  assert.equal(results.length, 1);
  assert.equal(results[0].match, "hello");
});

test("searchFunctionDefinitions: finds arrow functions assigned to const", () => {
  const code = "const myHandler = (x) => x * 2;\nconst other = () => {};";
  const results = searchFunctionDefinitions(code, "myHandler");
  assert.equal(results.length, 1);
  assert.equal(results[0].match, "myHandler");
});

test("searchFunctionDefinitions: finds async functions", () => {
  const code = "async function fetchData(url) { return await get(url); }";
  const results = searchFunctionDefinitions(code, "fetchData");
  assert.equal(results.length, 1);
  assert.equal(results[0].match, "fetchData");
});

test("searchFunctionDefinitions: skips definitions in comments", () => {
  const code = "// function hidden() {}\nfunction visible() {}";
  const results = searchFunctionDefinitions(code, "hidden");
  assert.equal(results.length, 0);
});

// -----------------------------------------------------------------------
// searchVariableReferences
// -----------------------------------------------------------------------

test("searchVariableReferences: finds all occurrences", () => {
  const code = "let count = 0;\ncount += 1;\ncount += 2;\nreturn count;";
  const results = searchVariableReferences(code, "count");
  assert.equal(results.length, 4);
});

test("searchVariableReferences: does not match inside longer identifiers", () => {
  const code = "let foo = 1;\nlet foobar = 2;\nfoo += 3;";
  const results = searchVariableReferences(code, "foo");
  // Should match "foo" but not the "foo" part of "foobar"
  assert.equal(results.length, 2);
});

test("searchVariableReferences: skips references in strings", () => {
  const code = 'console.log("count is " + count);\ncount++;';
  const results = searchVariableReferences(code, "count");
  assert.equal(results.length, 2, "should not match count inside string");
});

// -----------------------------------------------------------------------
// searchImports
// -----------------------------------------------------------------------

test("searchImports: finds ES module imports", () => {
  const code = 'import { readFile } from "fs";\nimport path from "path";';
  const results = searchImports(code, "fs");
  assert.equal(results.length, 1);
});

test("searchImports: finds require() calls", () => {
  const code = "const fs = require('fs');\nconst path = require('path');";
  const results = searchImports(code, "fs");
  assert.equal(results.length, 1);
});

test("searchImports: does not match module name in comments", () => {
  const code = "// require('non-existent')\nconst real = require('real-module');";
  const results = searchImports(code, "non-existent");
  assert.equal(results.length, 0);
});

// -----------------------------------------------------------------------
// searchClassDefinitions
// -----------------------------------------------------------------------

test("searchClassDefinitions: finds class declarations", () => {
  const code = "class Animal {}\nclass Dog extends Animal {}";
  const results = searchClassDefinitions(code, "Animal");
  assert.equal(results.length, 1);
});

test("searchClassDefinitions: finds exported classes", () => {
  const code = "export class MyComponent {}\nexport default class App {}";
  assert.equal(searchClassDefinitions(code, "MyComponent").length, 1);
  assert.equal(searchClassDefinitions(code, "App").length, 1);
});

test("searchClassDefinitions: skips classes inside comments", () => {
  const code = "// class Ghost {}\nclass Real {}";
  const results = searchClassDefinitions(code, "Ghost");
  assert.equal(results.length, 0);
});

// -----------------------------------------------------------------------
// searchPatterns
// -----------------------------------------------------------------------

test("searchPatterns: multi-pattern search returns named groups", () => {
  const code = "function foo() {}\nfunction bar() {}\nclass Baz {}";
  const results = searchPatterns(code, [
    { name: "functions", pattern: "function\\s+\\w+" },
    { name: "classes", pattern: "class\\s+\\w+" },
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].patternName, "functions");
  assert.equal(results[1].patternName, "classes");
  assert.ok(results[0].results.length >= 2);
  assert.ok(results[1].results.length >= 1);
});

test("searchPatterns: supports RegExp instances", () => {
  const code = "const x = 42;\nlet y = 99;\nvar z = 0;";
  const results = searchPatterns(code, [
    { name: "declarations", pattern: /\b(const|let|var)\s+\w+/g },
  ]);
  assert.equal(results[0].results.length, 3);
});
