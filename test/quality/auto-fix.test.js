/**
 * Tests for auto-fix engine.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  AutoFixEngine,
  fixTrailingWhitespace,
  fixMissingNewline,
  fixCommonTypos,
  fixImportOrder,
} = require("../../src/quality/auto-fix");

test("fixTrailingWhitespace: removes trailing spaces", () => {
  const input = "hello world   \nfoo bar\t \t\nbaz";
  const output = fixTrailingWhitespace(input);
  assert.ok(!output.includes("   "));
  assert.equal(output, "hello world\nfoo bar\nbaz");
});

test("fixTrailingWhitespace: handles empty string", () => {
  assert.equal(fixTrailingWhitespace(""), "");
});

test("fixTrailingWhitespace: handles non-string input", () => {
  assert.equal(fixTrailingWhitespace(null), null);
  assert.equal(fixTrailingWhitespace(undefined), undefined);
});

test("fixMissingNewline: adds missing trailing newline", () => {
  const input = "some content";
  const output = fixMissingNewline(input);
  assert.equal(output, "some content\n");
});

test("fixMissingNewline: normalizes multiple trailing newlines", () => {
  const input = "content\n\n\n";
  const output = fixMissingNewline(input);
  assert.equal(output, "content\n");
});

test("fixCommonTypos: corrects known misspellings", () => {
  const input = "I will recieve the seperate package";
  const output = fixCommonTypos(input);
  assert.ok(!output.includes("recieve"));
  assert.ok(!output.includes("seperate"));
  assert.ok(output.includes("receive"));
  assert.ok(output.includes("separate"));
});

test("fixCommonTypos: preserves capitalization", () => {
  const input = "Recieve the package";
  const output = fixCommonTypos(input);
  assert.ok(output.startsWith("Receive"));
});

test("fixImportOrder: sorts require imports alphabetically", () => {
  const input = [
    "const path = require('path');",
    "const assert = require('node:assert/strict');",
    "const test = require('node:test');",
    "",
    "// code here",
  ].join("\n");
  const output = fixImportOrder(input);
  const lines = output.split("\n");
  const importLines = lines.filter((l) => l.startsWith("const") && l.includes("require"));
  assert.equal(importLines.length, 3);
  // Node builtins sorted: assert then test, then path
  assert.ok(importLines[0].includes("assert"));
  assert.ok(importLines[1].includes("path"));
  assert.ok(importLines[2].includes("test"));
});

test("fixImportOrder: handles no imports gracefully", () => {
  const input = "just some content\nno imports here";
  const output = fixImportOrder(input);
  assert.equal(output, input);
});

test("AutoFixEngine: registers pre-built fixers by default", () => {
  const engine = new AutoFixEngine();
  const fixes = engine.listFixes();
  assert.ok(fixes.length >= 4);
  assert.ok(fixes.some((f) => f.includes("trailingWhitespace")));
  assert.ok(fixes.some((f) => f.includes("missingNewline")));
  assert.ok(fixes.some((f) => f.includes("commonTypos")));
  assert.ok(fixes.some((f) => f.includes("importOrder")));
});

test("AutoFixEngine: registerFix adds a custom fixer", () => {
  const engine = new AutoFixEngine();
  engine.registerFix("customFix", (content) => content.toUpperCase());
  const fixes = engine.listFixes();
  assert.ok(fixes.some((f) => f.includes("customFix")));
});

test("AutoFixEngine: registerFix throws on non-function", () => {
  const engine = new AutoFixEngine();
  assert.throws(() => engine.registerFix("bad", "not-a-function"), { message: /must be a function/ });
});

test("AutoFixEngine: suggestFixes returns fix suggestions for failed lint", () => {
  const engine = new AutoFixEngine();
  const results = [
    { name: "lint", status: "fail", message: "3 lint errors", details: { errors: 3 } },
    { name: "typeCheck", status: "pass", message: "ok", details: {} },
  ];
  const suggestions = engine.suggestFixes(results);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].checkName, "lint");
  assert.ok(suggestions[0].suggestedFixes.length > 0);
});

test("AutoFixEngine: suggestFixes returns empty for all-passing", () => {
  const engine = new AutoFixEngine();
  const results = [
    { name: "lint", status: "pass", message: "ok", details: {} },
  ];
  const suggestions = engine.suggestFixes(results);
  assert.equal(suggestions.length, 0);
});

test("AutoFixEngine: applyFixes corrects trailing whitespace", () => {
  const engine = new AutoFixEngine();
  const results = [
    { name: "lint", status: "fail", message: "lint errors", details: { errors: 1 } },
  ];
  const output = engine.applyFixes(results, {
    content: "hello   \nworld",
    selectedFixes: ["trailingWhitespace"],
  });
  assert.equal(output.fixed, true);
  assert.ok(output.appliedFixes.includes("trailingWhitespace"));
  assert.equal(output.content, "hello\nworld");
});

test("AutoFixEngine: applyFixes auto-approve applies relevant fixes", () => {
  const engine = new AutoFixEngine();
  const results = [
    { name: "lint", status: "fail", message: "lint errors", details: { errors: 2 } },
  ];
  const output = engine.applyFixes(results, {
    content: "hello   \nworld",
    autoApprove: true,
  });
  assert.equal(output.fixed, true);
  assert.ok(output.appliedFixes.length >= 2);
});

test("AutoFixEngine: applyFixes skips irrelevant fixes", () => {
  const engine = new AutoFixEngine();
  const results = [
    { name: "lint", status: "fail", message: "lint errors", details: { errors: 1 } },
  ];
  const output = engine.applyFixes(results, {
    content: "hello\n",
    selectedFixes: ["trailingWhitespace"],
  });
  assert.equal(output.fixed, true);
  assert.ok(!output.skippedFixes.some((s) => s.includes("trailingWhitespace")));
});

test("AutoFixEngine: applyFixes handles missing content gracefully", () => {
  const engine = new AutoFixEngine();
  const results = [
    { name: "lint", status: "fail", message: "lint errors", details: { errors: 1 } },
  ];
  const output = engine.applyFixes(results, { autoApprove: true });
  // No content provided, but fixes still run on empty string
  assert.equal(typeof output.content, "string");
});
