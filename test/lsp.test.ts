import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as lsp from "../src/services/lsp.js";

// Build a throwaway workspace with known symbols.
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lsp-test-"));
  fs.writeFileSync(path.join(root, "alpha.js"),
    "class Widget {}\nfunction buildWidget() { return new Widget(); }\nconst makeThing = () => 1;\n");
  fs.writeFileSync(path.join(root, "beta.js"),
    "function buildWidget() { return 2; }\nconst other = 3;\n");
  fs.writeFileSync(path.join(root, "gamma.py"),
    "class PyThing:\n    pass\ndef py_func(a, b):\n    return a\n");
  return root;
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
}

test("detectLanguage maps extensions", () => {
  assert.equal(lsp.detectLanguage("x.js"), "js");
  assert.equal(lsp.detectLanguage("x.py"), "python");
  assert.equal(lsp.detectLanguage("x.ts"), "ts");
  assert.equal(lsp.detectLanguage("x.unknown"), "text");
});

test("listSymbols extracts classes, functions and arrow consts (JS)", () => {
  const root = makeFixture();
  try {
    const syms = lsp.listSymbols(path.join(root, "alpha.js"));
    const names = syms.map((s) => s.name).sort();
    assert.deepEqual(names, ["Widget", "buildWidget", "makeThing"]);
    const widget = syms.find((s) => s.name === "Widget");
    assert.equal(widget.kind, "class");
    assert.equal(widget.line, 1);
  } finally { cleanup(root); }
});

test("listSymbols parses Python classes and defs", () => {
  const root = makeFixture();
  try {
    const syms = lsp.listSymbols(path.join(root, "gamma.py"));
    const names = syms.map((s) => s.name).sort();
    assert.deepEqual(names, ["PyThing", "py_func"]);
  } finally { cleanup(root); }
});

test("goToDefinition finds a symbol across files", () => {
  const root = makeFixture();
  try {
    const defs = lsp.goToDefinition(root, "buildWidget");
    assert.equal(defs.length, 2, "buildWidget defined in alpha.js and beta.js");
  } finally { cleanup(root); }
});

test("goToDefinition file filter narrows results to one file", () => {
  const root = makeFixture();
  try {
    const defs = lsp.goToDefinition(root, "buildWidget", "beta.js");
    assert.equal(defs.length, 1, "file filter should restrict to beta.js");
    assert.ok(defs[0].path.replace(/\\/g, "/").endsWith("beta.js"));
  } finally { cleanup(root); }
});

test("goToDefinition returns empty for unknown symbol or empty query", () => {
  const root = makeFixture();
  try {
    assert.deepEqual(lsp.goToDefinition(root, "nope"), []);
    assert.deepEqual(lsp.goToDefinition(root, ""), []);
  } finally { cleanup(root); }
});

test("workspaceSearch matches symbols case-insensitively by substring", () => {
  const root = makeFixture();
  try {
    const hits = lsp.workspaceSearch(root, "widget");
    const names = hits.map((s) => s.name).sort();
    assert.deepEqual(names, ["Widget", "buildWidget", "buildWidget"]);
  } finally { cleanup(root); }
});

test("findReferences locates textual references with line numbers", () => {
  const root = makeFixture();
  try {
    const refs = lsp.findReferences(root, "Widget");
    assert.ok(refs.length >= 2, "Widget referenced in class def and new Widget()");
    for (const r of refs) {
      assert.ok(typeof r.line === "number" && r.line >= 1);
      assert.ok(typeof r.text === "string");
    }
  } finally { cleanup(root); }
});
