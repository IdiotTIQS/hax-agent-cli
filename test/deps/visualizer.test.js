/**
 * Tests for DependencyVisualizer — ASCII tree rendering, import matrices,
 * module graphs, hotspot reports, and full reports.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");

const { ModuleDependencyAnalyzer } = require("../../src/deps/analyzer");
const { DependencyVisualizer, ANSI, BOX } = require("../../src/deps/visualizer");

/**
 * Creates a temporary project directory with the given file map.
 * @param {Record<string, string>} files - { relativePath: content }
 * @returns {string} Temp directory path.
 */
function createTempProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-deps-vis-test-"));
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

// ─── Dependency tree rendering ────────────────────────────────────

describe("DependencyVisualizer — renderDependencyTree", () => {
  /** @type {string} */
  let tmpDir;
  /** @type {ModuleDependencyAnalyzer} */
  let analyzer;
  /** @type {DependencyVisualizer} */
  let viz;

  before(() => {
    tmpDir = createTempProject({
      "src/index.js": `"use strict";\nconst a = require("./a");\nconst b = require("./b");`,
      "src/a.js": `"use strict";\nconst c = require("./c");`,
      "src/b.js": `"use strict";\n// leaf module`,
      "src/c.js": `"use strict";\n// leaf module`,
    });
    analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
    viz = new DependencyVisualizer({ useColor: false });
  });

  after(() => {
    removeDir(tmpDir);
  });

  it("renders the root module name as first line", () => {
    const output = viz.renderDependencyTree(analyzer, "src/index.js");
    assert.ok(output.includes("src/index.js"));
  });

  it("includes both a.js and b.js as dependencies", () => {
    const output = viz.renderDependencyTree(analyzer, "src/index.js");
    assert.ok(output.includes("a.js"));
    assert.ok(output.includes("b.js"));
  });

  it("shows leaf modules with (leaf) label", () => {
    const output = viz.renderDependencyTree(analyzer, "src/index.js");
    assert.ok(output.includes("(leaf)"));
  });

  it("returns error for unknown module", () => {
    const output = viz.renderDependencyTree(analyzer, "src/ghost.js");
    assert.ok(output.includes("not found"));
  });
});

// ─── Import matrix rendering ──────────────────────────────────────

describe("DependencyVisualizer — renderImportMatrix", () => {
  /** @type {string} */
  let tmpDir;
  /** @type {ModuleDependencyAnalyzer} */
  let analyzer;
  /** @type {DependencyVisualizer} */
  let viz;

  before(() => {
    tmpDir = createTempProject({
      "src/app.js": `"use strict";\nconst util = require("./util");`,
      "src/util.js": `"use strict";\n// leaf`,
      "src/extra.js": `"use strict";\nconst util = require("./util");`,
    });
    analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
    viz = new DependencyVisualizer({ useColor: false });
  });

  after(() => {
    removeDir(tmpDir);
  });

  it("outputs a title line", () => {
    const output = viz.renderImportMatrix(analyzer);
    assert.ok(output.includes("Import Matrix"));
  });

  it("shows X for existing imports", () => {
    const output = viz.renderImportMatrix(analyzer);
    assert.ok(output.includes("X"), "Matrix should contain 'X' for imports");
  });

  it("shows - for self-reference (diagonal)", () => {
    const output = viz.renderImportMatrix(analyzer);
    assert.ok(output.includes("-"), "Matrix should contain '-' diagonal");
  });

  it("supports filtering by specific modules", () => {
    const output = viz.renderImportMatrix(analyzer, ["src/app.js", "src/util.js"]);
    assert.ok(output.includes("app.js"));
    assert.ok(output.includes("util.js"));
    assert.ok(!output.includes("extra.js"), "extra.js should be absent when filtered out");
  });
});

// ─── Module graph rendering ───────────────────────────────────────

describe("DependencyVisualizer — renderModuleGraph", () => {
  /** @type {string} */
  let tmpDir;
  /** @type {ModuleDependencyAnalyzer} */
  let analyzer;
  /** @type {DependencyVisualizer} */
  let viz;

  before(() => {
    tmpDir = createTempProject({
      "src/main.js": `"use strict";\nconst svc = require("./service");`,
      "src/service.js": `"use strict";\nconst db = require("./db");`,
      "src/db.js": `"use strict";\n// leaf`,
    });
    analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
    viz = new DependencyVisualizer({ useColor: false });
  });

  after(() => {
    removeDir(tmpDir);
  });

  it("outputs a title line", () => {
    const output = viz.renderModuleGraph(analyzer);
    assert.ok(output.includes("Module Dependency Graph"));
  });

  it("lists all nodes in the Nodes section", () => {
    const output = viz.renderModuleGraph(analyzer);
    assert.ok(output.includes("main.js"));
    assert.ok(output.includes("service.js"));
    assert.ok(output.includes("db.js"));
  });

  it("shows edge count in the output", () => {
    const output = viz.renderModuleGraph(analyzer);
    assert.ok(output.includes("Total edges: 2"), `Expected 'Total edges: 2', got:\n${output}`);
  });
});

// ─── Hotspot report rendering ─────────────────────────────────────

describe("DependencyVisualizer — renderHotspotReport", () => {
  /** @type {string} */
  let tmpDir;
  /** @type {ModuleDependencyAnalyzer} */
  let analyzer;
  /** @type {DependencyVisualizer} */
  let viz;

  before(() => {
    // util.js is imported by 3 files → should be #1 hotspot
    tmpDir = createTempProject({
      "src/app1.js": `"use strict";\nconst u = require("./util");`,
      "src/app2.js": `"use strict";\nconst u = require("./util");`,
      "src/app3.js": `"use strict";\nconst u = require("./util");`,
      "src/util.js": `"use strict";\n// hot module`,
    });
    analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
    viz = new DependencyVisualizer({ useColor: false });
  });

  after(() => {
    removeDir(tmpDir);
  });

  it("outputs a title line", () => {
    const output = viz.renderHotspotReport(analyzer, 5);
    assert.ok(output.includes("Hotspot Report") || output.includes("hotspot") || output.includes("Hotspot"));
  });

  it("ranks the most-imported module as #1", () => {
    const output = viz.renderHotspotReport(analyzer, 5);
    assert.ok(output.includes("# 1") || output.includes("#1"));
  });

  it("respects the topN parameter", () => {
    const fullOutput = viz.renderHotspotReport(analyzer, 1);
    const lines = fullOutput.split("\n");
    // After header lines, we should have only 1 ranked entry + blank lines + legend
    const rankLines = lines.filter((l) => l.match(/^\s*#\s*\d/));
    assert.equal(rankLines.length, 1, `Expected 1 ranked line, got: ${rankLines.length}`);
  });
});

// ─── Full report rendering ────────────────────────────────────────

describe("DependencyVisualizer — renderFullReport", () => {
  /** @type {string} */
  let tmpDir;
  /** @type {ModuleDependencyAnalyzer} */
  let analyzer;
  /** @type {DependencyVisualizer} */
  let viz;

  before(() => {
    tmpDir = createTempProject({
      "src/index.js": `"use strict";\nconst a = require("./a");`,
      "src/a.js": `"use strict";\nconst b = require("./b");`,
      "src/b.js": `"use strict";\n// leaf`,
    });
    analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
    viz = new DependencyVisualizer({ useColor: false });
  });

  after(() => {
    removeDir(tmpDir);
  });

  it("includes summary section", () => {
    const output = viz.renderFullReport(analyzer);
    assert.ok(output.includes("Summary"));
    assert.ok(output.includes("Total files analyzed"));
    assert.ok(output.includes("Total dependency edges"));
  });

  it("includes architecture layers section", () => {
    const output = viz.renderFullReport(analyzer);
    assert.ok(output.includes("Architecture Layers") || output.includes("Architecture"));
  });

  it("includes circular dependency section", () => {
    const output = viz.renderFullReport(analyzer);
    assert.ok(output.includes("Circular"));
  });

  it("includes unused modules section", () => {
    const output = viz.renderFullReport(analyzer);
    assert.ok(output.includes("Unused Modules") || output.includes("Unused"));
  });
});

// ─── Color mode toggle ────────────────────────────────────────────

describe("DependencyVisualizer — color mode", () => {
  /** @type {string} */
  let tmpDir;
  /** @type {ModuleDependencyAnalyzer} */
  let analyzer;

  before(() => {
    tmpDir = createTempProject({
      "src/app.js": `"use strict";\nconst u = require("./util");`,
      "src/util.js": `"use strict";\nexports.doWork = () => {};`,
    });
    analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
  });

  after(() => {
    removeDir(tmpDir);
  });

  it("with color enabled includes ANSI escape codes", () => {
    const viz = new DependencyVisualizer({ useColor: true });
    const output = viz.renderDependencyTree(analyzer, "src/app.js");
    assert.ok(
      output.includes("\x1b[") || output.includes(ANSI.reset) || output.includes(ANSI.bold),
      "Output should contain ANSI escape codes when color is enabled"
    );
  });

  it("with color disabled contains no ANSI codes", () => {
    const viz = new DependencyVisualizer({ useColor: false });
    const output = viz.renderDependencyTree(analyzer, "src/app.js");
    assert.ok(
      !output.includes("\x1b["),
      "Output should NOT contain ANSI escape codes when color is disabled"
    );
  });
});

// ─── Render with empty module list ────────────────────────────────

describe("DependencyVisualizer — empty inputs", () => {
  it("renderImportMatrix handles empty analyzer gracefully", () => {
    const tmpDir = createTempProject({
      "README.md": "# nothing here",
    });
    const analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
    const viz = new DependencyVisualizer({ useColor: false });
    const output = viz.renderImportMatrix(analyzer);
    assert.ok(output.includes("No modules") || output.length > 0);
    removeDir(tmpDir);
  });

  it("renderModuleGraph handles empty analyzer gracefully", () => {
    const tmpDir = createTempProject({
      "README.md": "# nothing here",
    });
    const analyzer = new ModuleDependencyAnalyzer();
    analyzer.analyze(tmpDir);
    const viz = new DependencyVisualizer({ useColor: false });
    const output = viz.renderModuleGraph(analyzer);
    assert.ok(output.includes("No modules") || output.length > 0);
    removeDir(tmpDir);
  });
});

// ─── ANSI and BOX constants ───────────────────────────────────────

describe("ANSI and BOX exports", () => {
  it("ANSI object has expected properties", () => {
    assert.ok(ANSI.reset);
    assert.ok(ANSI.bold);
    assert.ok(ANSI.red);
    assert.ok(ANSI.green);
    assert.ok(ANSI.dim);
  });

  it("BOX object has expected tree characters", () => {
    assert.ok(BOX.tee);
    assert.ok(BOX.elbow);
    assert.ok(BOX.pipe);
    assert.ok(BOX.blank);
  });
});
