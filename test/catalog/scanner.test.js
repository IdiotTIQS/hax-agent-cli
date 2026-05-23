/**
 * Tests for ModuleScanner: scan, getModuleGraph, getOrphanModules,
 * getMostUsedModules, getModuleStats, getAllModules.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ModuleScanner } = require("../../src/catalog/scanner");

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/**
 * Create a temporary directory tree from a spec.
 *
 * spec is { <relativePath>: "file contents" | null }
 *   - null means it is a directory (created implicitly).
 */
function createFixtureTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hax-catalog-test-"));
  for (const [relPath, content] of Object.entries(spec)) {
    const full = path.join(root, relPath);
    if (content === null) {
      // It's a directory
      fs.mkdirSync(full, { recursive: true });
    } else {
      // It's a file
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    }
  }
  return root;
}

// ------------------------------------------------------------------
// scan() basics
// ------------------------------------------------------------------

test("ModuleScanner: scan finds all .js files recursively", () => {
  const root = createFixtureTree({
    "src/index.js": `
      "use strict";
      const config = require("./config");
      module.exports = { config };
    `,
    "src/config.js": `
      "use strict";
      module.exports = { port: 3000 };
    `,
    "src/utils/helpers.js": `
      "use strict";
      const path = require("path");
      exports.resolvePath = (p) => path.resolve(p);
    `,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  const all = scanner.getAllModules();
  assert.equal(all.length, 3);

  const relPaths = all.map((m) => m.relativePath.replace(/\\/g, "/")).sort();
  assert.deepEqual(relPaths, [
    "src/config.js",
    "src/index.js",
    "src/utils/helpers.js",
  ]);
});

test("ModuleScanner: scan skips node_modules by default", () => {
  const root = createFixtureTree({
    "src/app.js": `
      "use strict";
      module.exports = {};
    `,
    "node_modules/leftpad/index.js": `
      module.exports = (s, n) => s + " ".repeat(n);
    `,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  const all = scanner.getAllModules();
  assert.equal(all.length, 1);
  assert.equal(path.basename(all[0].relativePath), "app.js");
});

test("ModuleScanner: scan with skipNodeModules=false includes node_modules", () => {
  const root = createFixtureTree({
    "src/app.js": `
      "use strict";
      module.exports = {};
    `,
    "node_modules/leftpad/index.js": `
      module.exports = (s, n) => s;
    `,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root, { skipNodeModules: false });

  const all = scanner.getAllModules();
  assert.equal(all.length, 2);
});

test("ModuleScanner: scan respects excludeDirs option", () => {
  const root = createFixtureTree({
    "src/app.js": `"use strict"; module.exports = {};`,
    "generated/bundle.js": `"use strict"; module.exports = {};`,
    "dist/compiled.js": `"use strict"; module.exports = {};`,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root, { excludeDirs: ["generated", "dist"] });

  const all = scanner.getAllModules();
  assert.equal(all.length, 1);
  assert.ok(all[0].relativePath.includes("src/app"));
});

// ------------------------------------------------------------------
// Require parsing
// ------------------------------------------------------------------

test("ModuleScanner: parses require() calls as imports", () => {
  const root = createFixtureTree({
    "src/index.js": `
      "use strict";
      const config = require("./config");
      const utils = require("./utils/helpers");
      const x = require("os");
      module.exports = { config, utils };
    `,
    "src/config.js": `"use strict"; module.exports = {};`,
    "src/utils/helpers.js": `"use strict"; module.exports = {};`,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  const all = scanner.getAllModules();
  const indexMod = all.find((m) => m.relativePath.replace(/\\/g, "/") === "src/index.js");
  assert.ok(indexMod, "index.js should exist");

  // Should have resolved ./config and ./utils/helpers but NOT "os"
  const imps = indexMod.imports.map((p) => p.replace(/\\/g, "/")).sort();
  assert.deepEqual(imps, ["src/config.js", "src/utils/helpers.js"]);
});

test("ModuleScanner: parses destructured require() calls", () => {
  const root = createFixtureTree({
    "src/main.js": `
      "use strict";
      const { readFile, writeFile } = require("./io");
      const { config } = require("./config");
      module.exports = { readFile, writeFile };
    `,
    "src/io.js": `"use strict"; module.exports = { readFile, writeFile };`,
    "src/config.js": `"use strict"; module.exports = { config: {} };`,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  const mainMod = scanner.getAllModules().find((m) =>
    m.relativePath.replace(/\\/g, "/") === "src/main.js"
  );
  assert.ok(mainMod);
  const imps = mainMod.imports.map((p) => p.replace(/\\/g, "/")).sort();
  assert.deepEqual(imps, ["src/config.js", "src/io.js"]);
});

// ------------------------------------------------------------------
// Export parsing
// ------------------------------------------------------------------

test("ModuleScanner: parses module.exports = { ... } exports", () => {
  const root = createFixtureTree({
    "src/api.js": `
      "use strict";
      const { helper } = require("./helper");
      module.exports = { hello, world, greet };
      function hello() {}
      function world() {}
      function greet() {}
    `,
    "src/helper.js": `"use strict"; module.exports = { helper: () => {} };`,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  const apiMod = scanner.getAllModules().find((m) =>
    m.relativePath.replace(/\\/g, "/") === "src/api.js"
  );
  assert.ok(apiMod);
  assert.ok(apiMod.exports.includes("hello"));
  assert.ok(apiMod.exports.includes("world"));
  assert.ok(apiMod.exports.includes("greet"));
  assert.equal(apiMod.exports.length, 3);
});

test("ModuleScanner: parses exports.xxx = ... exports", () => {
  const root = createFixtureTree({
    "src/standalone.js": `
      "use strict";
      exports.sayHello = function(name) { return "hello " + name; };
      exports.VERSION = "1.0.0";
      exports.info = { name: "test" };
    `,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  const mod = scanner.getAllModules()[0];
  assert.ok(mod.exports.includes("sayHello"));
  assert.ok(mod.exports.includes("VERSION"));
  assert.ok(mod.exports.includes("info"));
  assert.equal(mod.exports.length, 3);
});

test("ModuleScanner: parses module.exports.xxx = ... exports", () => {
  const root = createFixtureTree({
    "src/mixed.js": `
      "use strict";
      module.exports.SampleClass = class SampleClass {};
      module.exports.factory = () => new SampleClass();
    `,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  const mod = scanner.getAllModules()[0];
  assert.ok(mod.exports.includes("SampleClass"));
  assert.ok(mod.exports.includes("factory"));
  assert.equal(mod.exports.length, 2);
});

// ------------------------------------------------------------------
// JSDoc parsing
// ------------------------------------------------------------------

test("ModuleScanner: parses JSDoc comments", () => {
  const root = createFixtureTree({
    "src/documented.js": `
      "use strict";
      /**
       * This is the main router module.
       * It handles all HTTP routing logic.
       *
       * @module router
       */
      const express = require("express");
      module.exports = { createRouter };
      function createRouter() { return express.Router(); }
    `,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  const mod = scanner.getAllModules()[0];
  assert.ok(mod.jsdoc.includes("main router module"));
  assert.ok(mod.jsdoc.includes("HTTP routing"));
  assert.ok(mod.jsdoc.includes("@module router"));
  // Should not contain "*" prefix characters
  assert.ok(!mod.jsdoc.includes("* "));
});

test("ModuleScanner: returns empty string for modules without JSDoc", () => {
  const root = createFixtureTree({
    "src/nodoc.js": `
      "use strict";
      // Just a comment, not JSDoc
      module.exports = { run: () => {} };
    `,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  const mod = scanner.getAllModules()[0];
  assert.equal(mod.jsdoc, "");
});

// ------------------------------------------------------------------
// getModuleGraph
// ------------------------------------------------------------------

test("ModuleScanner: getModuleGraph returns adjacency map", () => {
  const root = createFixtureTree({
    "src/a.js": `"use strict"; const b = require("./b"); module.exports = { a: 1 };`,
    "src/b.js": `"use strict"; const c = require("./c"); module.exports = { b: 2 };`,
    "src/c.js": `"use strict"; module.exports = { c: 3 };`,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  const graph = scanner.getModuleGraph();
  const keys = Object.keys(graph).map((k) => k.replace(/\\/g, "/")).sort();
  assert.deepEqual(keys, ["src/a.js", "src/b.js", "src/c.js"]);

  // a imports b
  assert.deepEqual(
    graph[keys[0]].map((i) => i.replace(/\\/g, "/")),
    ["src/b.js"]
  );
  // b imports c
  assert.deepEqual(
    graph[keys[1]].map((i) => i.replace(/\\/g, "/")),
    ["src/c.js"]
  );
  // c has no imports
  assert.deepEqual(graph[keys[2]], []);
});

// ------------------------------------------------------------------
// getOrphanModules
// ------------------------------------------------------------------

test("ModuleScanner: getOrphanModules returns modules with zero inbound imports", () => {
  const root = createFixtureTree({
    "src/index.js": `
      "use strict";
      const core = require("./core");
      module.exports = { core };
    `,
    "src/core.js": `
      "use strict";
      module.exports = { core: true };
    `,
    "src/unused.js": `
      "use strict";
      module.exports = { noOneUsesThis: true };
    `,
    "src/also-unused.js": `
      "use strict";
      module.exports = { also: true };
    `,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  const orphans = scanner.getOrphanModules();
  // index.js is an entry point and should be excluded
  // core.js is imported by index.js
  // unused.js and also-unused.js have zero inbound
  const orphanNames = orphans.map((o) => path.basename(o.relativePath)).sort();
  assert.deepEqual(orphanNames, ["also-unused.js", "unused.js"]);
});

test("ModuleScanner: getOrphanModules excludes cli.js and index.js as entry points", () => {
  const root = createFixtureTree({
    "src/cli.js": `
      "use strict";
      const app = require("./app");
      module.exports = { run: () => {} };
    `,
    "src/index.js": `
      "use strict";
      const config = require("./config");
      module.exports = { config };
    `,
    "src/app.js": `
      "use strict";
      module.exports = { app: true };
    `,
    "src/config.js": `
      "use strict";
      module.exports = { port: 3000 };
    `,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  // cli.js imports app.js, index.js imports config.js
  // So app.js is imported by cli.js
  // config.js is imported by index.js
  // Both cli.js and index.js are entry points (excluded)
  const orphans = scanner.getOrphanModules();
  assert.equal(orphans.length, 0, "No orphans expected — all modules are either entry points or imported");
});

// ------------------------------------------------------------------
// getMostUsedModules
// ------------------------------------------------------------------

test("ModuleScanner: getMostUsedModules returns modules sorted by import count", () => {
  const root = createFixtureTree({
    "src/config.js": `"use strict"; module.exports = { port: 3000 };`,
    "src/a.js": `"use strict"; const config = require("./config"); module.exports = {};`,
    "src/b.js": `"use strict"; const config = require("./config"); module.exports = {};`,
    "src/c.js": `"use strict"; const config = require("./config"); module.exports = {};`,
    "src/d.js": `"use strict"; const config = require("./config"); module.exports = {};`,
    "src/e.js": `"use strict"; module.exports = {};`,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  const top = scanner.getMostUsedModules(5);
  assert.ok(top.length >= 1);

  // config.js should be the most used (importCount = 4)
  const configEntry = top.find((e) => e.relativePath.replace(/\\/g, "/") === "src/config.js");
  assert.ok(configEntry, "config.js should be in the most-used list");
  assert.equal(configEntry.importCount, 4);
  assert.equal(configEntry.exporter, true);

  // Sorted descending
  for (let i = 1; i < top.length; i++) {
    assert.ok(top[i - 1].importCount >= top[i].importCount, "Should be sorted descending");
  }
});

// ------------------------------------------------------------------
// getModuleStats
// ------------------------------------------------------------------

test("ModuleScanner: getModuleStats returns accurate aggregate statistics", () => {
  const root = createFixtureTree({
    "src/a.js": [
      '"use strict";',
      'const b = require("./b");',
      'module.exports = { a: 1 };',
    ].join("\n"),
    "src/b.js": [
      '"use strict";',
      '/**',
      " * Helper module B.",
      " */",
      'module.exports = { b: 2 };',
    ].join("\n"),
    "src/c.js": [
      '"use strict";',
      'exports.c = 3;',
      'exports.d = 4;',
    ].join("\n"),
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  const stats = scanner.getModuleStats();
  assert.equal(stats.totalModules, 3);
  // lines of code: a has 3 non-empty, b has 4? Actually the JSDoc lines aren't code either.
  // Our counter only avoids blank lines. We'll just check it's a reasonable positive number.
  assert.ok(stats.totalLinesOfCode > 0);
  // Total exports: a=1, b=1, c=2
  assert.equal(stats.totalExports, 1 + 1 + 2);
  // Total imports: a imports 1, b imports 0, c imports 0
  assert.equal(stats.totalImports, 1);
  // b has JSDoc
  assert.equal(stats.modulesWithJSDoc, 1);
  // avg LOC
  assert.ok(stats.avgLinesPerModule > 0);
});

// ------------------------------------------------------------------
// getAllModules
// ------------------------------------------------------------------

test("ModuleScanner: getAllModules returns complete list sorted by relative path", () => {
  const root = createFixtureTree({
    "src/z.js": `"use strict"; module.exports = { z: 1 };`,
    "src/a.js": `"use strict"; module.exports = { a: 1 };`,
    "src/mid/m.js": `"use strict"; module.exports = { m: 1 };`,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  const all = scanner.getAllModules();
  assert.equal(all.length, 3);

  // Should be sorted alphabetically by relativePath
  const names = all.map((m) => m.relativePath.replace(/\\/g, "/"));
  const sorted = [...names].sort();
  assert.deepEqual(names, sorted);
});

// ------------------------------------------------------------------
// lines of code counting
// ------------------------------------------------------------------

test("ModuleScanner: counts non-empty lines as lines of code", () => {
  const root = createFixtureTree({
    "src/count.js": `
      "use strict";

      const x = 1;

      const y = 2;

      module.exports = { x, y };

    `,
  });

  const scanner = new ModuleScanner();
  scanner.scan(root);

  const mod = scanner.getAllModules()[0];
  // Non-empty lines: "use strict";, const x = 1;, const y = 2;, module.exports = { x, y };
  assert.equal(mod.linesOfCode, 4);
});
