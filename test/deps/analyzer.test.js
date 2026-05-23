/**
 * Tests for ModuleDependencyAnalyzer — module-level dependency graph
 * analysis: imports, exports, circular deps, unused modules, layers, metrics.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");

const { ModuleDependencyAnalyzer } = require("../../src/deps/analyzer");

/**
 * Creates a temporary project directory with the given file map.
 * @param {Record<string, string>} files - { relativePath: content }
 * @returns {string} Temp directory path.
 */
function createTempProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-deps-test-"));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    const parent = path.dirname(fullPath);
    fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
  }
  return dir;
}

/**
 * Recursively removes a directory.
 */
function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {
    // best-effort cleanup
  }
}

// ─── Linear dependency chain tests ────────────────────────────────

describe("ModuleDependencyAnalyzer — linear imports", () => {
  /** @type {string} */
  let tmpDir;
  /** @type {ModuleDependencyAnalyzer} */
  let analyzer;

  before(() => {
    tmpDir = createTempProject({
      "src/a.js": `"use strict";\nconst b = require("./b");\nmodule.exports = { greet: () => "hello" };`,
      "src/b.js": `"use strict";\nconst c = require("./c");\nexports.compute = function() { return 42; };`,
      "src/c.js": `"use strict";\n// leaf module — no imports`,
      "src/index.js": `"use strict";\nconst a = require("./src/a");\nconst external = require("lodash");`,
    });
    analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
  });

  after(() => {
    removeDir(tmpDir);
  });

  it("discovers all four files", () => {
    assert.equal(analyzer.files.size, 4);
  });

  it("a.js imports b.js", () => {
    const graph = analyzer.getImportGraph();
    const deps = graph.get("src/a.js");
    assert.ok(deps);
    assert.ok(deps.has("src/b.js"));
  });

  it("b.js imports c.js", () => {
    const graph = analyzer.getImportGraph();
    const deps = graph.get("src/b.js");
    assert.ok(deps);
    assert.ok(deps.has("src/c.js"));
  });

  it("c.js imports nothing", () => {
    const graph = analyzer.getImportGraph();
    const deps = graph.get("src/c.js");
    assert.ok(deps);
    assert.equal(deps.size, 0);
  });

  it("external modules are not in import graph", () => {
    const graph = analyzer.getImportGraph();
    const deps = graph.get("src/index.js");
    assert.ok(deps);
    // should only contain project files, not 'lodash'
    assert.equal([...deps].filter((d) => d.includes("lodash")).length, 0);
  });
});

// ─── Export detection tests ───────────────────────────────────────

describe("ModuleDependencyAnalyzer — export detection", () => {
  /** @type {string} */
  let tmpDir;
  /** @type {ModuleDependencyAnalyzer} */
  let analyzer;

  before(() => {
    tmpDir = createTempProject({
      "src/moduleExports.js": `"use strict";\nmodule.exports = { foo: 1, bar: 2, baz: 3 };`,
      "src/exportsDot.js": `"use strict";\nexports.helper = () => {};\nexports.compute = () => {};`,
      "src/esmNamed.js": `export const PI = 3.14;\nexport function square(x) { return x * x; }\nexport class Circle { }`,
      "src/esmBrace.js": `const A = 1; const B = 2;\nexport { A, B as C };`,
      "src/esmDefault.js": `export default function handler() {}`,
    });
    analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
  });

  after(() => {
    removeDir(tmpDir);
  });

  it("detects module.exports object keys", () => {
    const exports = analyzer.getExportGraph();
    const mod = exports.get("src/moduleExports.js");
    assert.ok(mod);
    assert.ok(mod.has("foo"));
    assert.ok(mod.has("bar"));
    assert.ok(mod.has("baz"));
  });

  it("detects exports.dot assignments", () => {
    const exports = analyzer.getExportGraph();
    const mod = exports.get("src/exportsDot.js");
    assert.ok(mod);
    assert.ok(mod.has("helper"));
    assert.ok(mod.has("compute"));
  });

  it("detects ES module named exports", () => {
    const exports = analyzer.getExportGraph();
    const mod = exports.get("src/esmNamed.js");
    assert.ok(mod);
    assert.ok(mod.has("PI"));
    assert.ok(mod.has("square"));
    assert.ok(mod.has("Circle"));
  });

  it("detects ES module brace exports", () => {
    const exports = analyzer.getExportGraph();
    const mod = exports.get("src/esmBrace.js");
    assert.ok(mod);
    assert.ok(mod.has("A"));
    assert.ok(mod.has("B"));
  });

  it("detects ES module default exports", () => {
    const exports = analyzer.getExportGraph();
    const mod = exports.get("src/esmDefault.js");
    assert.ok(mod);
    assert.ok(mod.has("handler"));
  });
});

// ─── Circular dependency detection tests ──────────────────────────

describe("ModuleDependencyAnalyzer — circular dependencies", () => {
  /** @type {string} */
  let tmpDir;
  /** @type {ModuleDependencyAnalyzer} */
  let analyzer;

  before(() => {
    tmpDir = createTempProject({
      "src/a.js": `"use strict";\nconst b = require("./b");\nmodule.exports = { name: "a" };`,
      "src/b.js": `"use strict";\nconst c = require("./c");\nexports.name = "b";`,
      "src/c.js": `"use strict";\nconst a = require("./a");\nexports.name = "c";`,
    });
    analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
  });

  after(() => {
    removeDir(tmpDir);
  });

  it("detects a → b → c → a cycle", () => {
    const cycles = analyzer.findCircularDeps();
    assert.ok(cycles.length >= 1, "Expected at least one cycle");
    const cycle = cycles[0];
    assert.ok(cycle.length >= 3, "Cycle should have at least 3 nodes");
  });

  it("cycle contains all three files", () => {
    const cycles = analyzer.findCircularDeps();
    const flat = cycles.flat();
    assert.ok(flat.includes("src/a.js"));
    assert.ok(flat.includes("src/b.js"));
    assert.ok(flat.includes("src/c.js"));
  });
});

// ─── No circular dependency tests ─────────────────────────────────

describe("ModuleDependencyAnalyzer — no circular dependencies", () => {
  /** @type {string} */
  let tmpDir;
  /** @type {ModuleDependencyAnalyzer} */
  let analyzer;

  before(() => {
    tmpDir = createTempProject({
      "src/app.js": `"use strict";\nconst util = require("./util");\nconst db = require("./db");`,
      "src/util.js": `"use strict";\nconst fmt = require("./fmt");`,
      "src/db.js": `"use strict";\nconst conn = require("./conn");`,
      "src/conn.js": `"use strict";\n// leaf`,
      "src/fmt.js": `"use strict";\n// leaf`,
    });
    analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
  });

  after(() => {
    removeDir(tmpDir);
  });

  it("returns empty array for acyclic graph", () => {
    const cycles = analyzer.findCircularDeps();
    assert.equal(cycles.length, 0);
  });
});

// ─── Unused module detection tests ────────────────────────────────

describe("ModuleDependencyAnalyzer — unused modules", () => {
  /** @type {string} */
  let tmpDir;
  /** @type {ModuleDependencyAnalyzer} */
  let analyzer;

  before(() => {
    tmpDir = createTempProject({
      "src/index.js": `"use strict";\nconst a = require("./a");`,
      "src/a.js": `"use strict";\nmodule.exports = {};`,
      "src/unused.js": `"use strict";\n// never imported anywhere`,
      "src/alsoUnused.js": `"use strict";\n// also never imported`,
    });
    analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
  });

  after(() => {
    removeDir(tmpDir);
  });

  it("identifies modules that are never imported", () => {
    const unused = analyzer.findUnusedModules();
    assert.ok(unused.includes("src/unused.js"));
    assert.ok(unused.includes("src/alsoUnused.js"));
  });

  it("does not flag modules that ARE imported", () => {
    const unused = analyzer.findUnusedModules();
    assert.ok(!unused.includes("src/a.js"));
  });
});

// ─── Layered architecture tests ───────────────────────────────────

describe("ModuleDependencyAnalyzer — layered architecture", () => {
  /** @type {string} */
  let tmpDir;
  /** @type {ModuleDependencyAnalyzer} */
  let analyzer;

  before(() => {
    tmpDir = createTempProject({
      "src/app.js": `"use strict";\nconst svc = require("./service");\nconst db = require("./db");`,
      "src/service.js": `"use strict";\nconst util = require("./util");\nconst db = require("./db");`,
      "src/db.js": `"use strict";\nconst driver = require("./driver");`,
      "src/driver.js": `"use strict";\n// leaf`,
      "src/util.js": `"use strict";\n// leaf`,
    });
    analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
  });

  after(() => {
    removeDir(tmpDir);
  });

  it("produces at least 2 layers", () => {
    const layers = analyzer.getLayeredArchitecture();
    assert.ok(layers.length >= 2, `Expected >= 2 layers, got ${layers.length}`);
  });

  it("places leaf modules (driver, util) in layer 0", () => {
    const layers = analyzer.getLayeredArchitecture();
    const layer0Files = layers[0] || [];
    assert.ok(layer0Files.includes("src/driver.js"));
    assert.ok(layer0Files.includes("src/util.js"));
  });

  it("places app.js in a higher layer than driver.js", () => {
    const layers = analyzer.getLayeredArchitecture();
    let driverLayer = -1;
    let appLayer = -1;
    for (let i = 0; i < layers.length; i++) {
      if (layers[i].includes("src/driver.js")) driverLayer = i;
      if (layers[i].includes("src/app.js")) appLayer = i;
    }
    assert.ok(appLayer > driverLayer, `appLayer (${appLayer}) should be > driverLayer (${driverLayer})`);
  });
});

// ─── Module metrics tests ─────────────────────────────────────────

describe("ModuleDependencyAnalyzer — module metrics", () => {
  /** @type {string} */
  let tmpDir;
  /** @type {ModuleDependencyAnalyzer} */
  let analyzer;

  before(() => {
    tmpDir = createTempProject({
      "src/index.js": `"use strict";\nconst a = require("./a");\nconst b = require("./b");\nmodule.exports = {};`,
      "src/a.js": `"use strict";\n// simple leaf`,
      "src/b.js": `"use strict";\nconst c = require("./c");\nif (true) { doWork(); }`,
      "src/c.js": `"use strict";\n// another leaf`,
    });
    analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
  });

  after(() => {
    removeDir(tmpDir);
  });

  it("returns one metric entry per file", () => {
    const metrics = analyzer.getModuleMetrics();
    assert.equal(metrics.length, analyzer.files.size);
  });

  it("reports fan-in for a.js as 1 (index.js imports it)", () => {
    const metrics = analyzer.getModuleMetrics();
    const aMetric = metrics.find((m) => m.file === "src/a.js");
    assert.ok(aMetric);
    assert.equal(aMetric.fanIn, 1);
  });

  it("reports fan-out for index.js as 2", () => {
    const metrics = analyzer.getModuleMetrics();
    const idxMetric = metrics.find((m) => m.file === "src/index.js");
    assert.ok(idxMetric);
    assert.equal(idxMetric.fanOut, 2);
  });

  it("reports size (lines of code) as a positive number", () => {
    const metrics = analyzer.getModuleMetrics();
    for (const m of metrics) {
      assert.ok(m.size > 0, `${m.file} should have size > 0`);
      assert.ok(typeof m.size === "number");
    }
  });

  it("reports complexity as a non-negative number", () => {
    const metrics = analyzer.getModuleMetrics();
    const bMetric = metrics.find((m) => m.file === "src/b.js");
    assert.ok(bMetric);
    assert.ok(bMetric.complexity > 0, "b.js has an if statement, so complexity > 0");
    const cMetric = metrics.find((m) => m.file === "src/c.js");
    assert.ok(cMetric);
    assert.equal(cMetric.complexity, 0, "c.js has no branching, so complexity = 0");
  });

  it("computes instability between 0 and 1", () => {
    const metrics = analyzer.getModuleMetrics();
    for (const m of metrics) {
      assert.ok(m.instability >= 0 && m.instability <= 1,
        `${m.file} instability (${m.instability}) should be between 0 and 1`);
    }
  });
});

// ─── Empty project tests ──────────────────────────────────────────

describe("ModuleDependencyAnalyzer — empty project", () => {
  it("handles a project with no JS files", () => {
    const tmpDir = createTempProject({
      "README.md": "# My Project",
      ".gitignore": "node_modules",
    });
    const analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
    assert.equal(analyzer.files.size, 0);
    assert.equal(analyzer.findCircularDeps().length, 0);
    assert.equal(analyzer.findUnusedModules().length, 0);
    removeDir(tmpDir);
  });
});

// ─── Import resolution tests ──────────────────────────────────────

describe("ModuleDependencyAnalyzer — import resolution", () => {
  it("resolves require with relative path (./)", () => {
    const tmpDir = createTempProject({
      "src/main.js": `"use strict";\nconst h = require("./helper");\nmodule.exports = {};`,
      "src/helper.js": `"use strict";\nexports.help = () => {};`,
    });
    const analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
    const graph = analyzer.getImportGraph();
    const deps = graph.get("src/main.js");
    assert.ok(deps.has("src/helper.js"));
    removeDir(tmpDir);
  });

  it("resolves ESM import with relative path", () => {
    const tmpDir = createTempProject({
      "src/app.js": `import { util } from "./util";\nexport const APP = "app";`,
      "src/util.js": `export const util = {};`,
    });
    const analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
    const graph = analyzer.getImportGraph();
    const deps = graph.get("src/app.js");
    assert.ok(deps.has("src/util.js"));
    removeDir(tmpDir);
  });

  it("resolves dynamic import() with relative path", () => {
    const tmpDir = createTempProject({
      "src/lazy.js": `module.exports = async () => { const m = await import("./target"); };`,
      "src/target.js": `module.exports = {};`,
    });
    const analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
    const graph = analyzer.getImportGraph();
    const deps = graph.get("src/lazy.js");
    assert.ok(deps.has("src/target.js"));
    removeDir(tmpDir);
  });

  it("does not resolve bare specifier imports (external packages)", () => {
    const tmpDir = createTempProject({
      "src/app.js": `const _ = require("lodash");\nconst fs = require("node:fs");`,
    });
    const analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
    const graph = analyzer.getImportGraph();
    const deps = graph.get("src/app.js");
    assert.equal(deps.size, 0, "Should have zero project dependencies");
    removeDir(tmpDir);
  });
});
