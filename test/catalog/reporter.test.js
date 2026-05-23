/**
 * Tests for CatalogReporter: generate*Report methods and formatAsMarkdown.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ModuleScanner } = require("../../src/catalog/scanner");
const { CatalogReporter } = require("../../src/catalog/reporter");

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function createFixtureTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hax-reporter-test-"));
  for (const [relPath, content] of Object.entries(spec)) {
    const full = path.join(root, relPath);
    if (content === null) {
      fs.mkdirSync(full, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    }
  }
  return root;
}

function buildReporter(root) {
  const scanner = new ModuleScanner();
  scanner.scan(root);
  return new CatalogReporter(scanner, { projectRoot: root });
}

// ------------------------------------------------------------------
// generateModuleReport
// ------------------------------------------------------------------

test("CatalogReporter: generateModuleReport returns structured catalog", () => {
  const root = createFixtureTree({
    "src/index.js": `
      "use strict";
      const config = require("./config");
      module.exports = { config };
    `,
    "src/config.js": `
      "use strict";
      /**
       * Application configuration module.
       */
      module.exports = { port: 3000 };
    `,
  });

  const reporter = buildReporter(root);
  const report = reporter.generateModuleReport();

  assert.equal(report.title, "Module Catalog");
  assert.ok(report.generatedAt);
  assert.equal(report.projectRoot, root);

  // stats
  assert.equal(report.stats.totalModules, 2);
  assert.ok(report.stats.totalLinesOfCode > 0);

  // modules
  assert.equal(report.modules.length, 2);

  // byDirectory
  assert.ok(report.byDirectory["src"]);
  assert.equal(report.byDirectory["src"].length, 2);
});

test("CatalogReporter: generateModuleReport handles empty project", () => {
  const root = createFixtureTree({});

  const reporter = buildReporter(root);
  const report = reporter.generateModuleReport();

  assert.equal(report.title, "Module Catalog");
  assert.equal(report.stats.totalModules, 0);
  assert.equal(report.modules.length, 0);
  assert.deepEqual(report.byDirectory, {});
});

// ------------------------------------------------------------------
// generateOrphanReport
// ------------------------------------------------------------------

test("CatalogReporter: generateOrphanReport returns orphan list and recommendations", () => {
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
    "src/orphan.js": `
      "use strict";
      module.exports = { forgotten: true };
    `,
    "src/config-constants.js": `
      "use strict";
      module.exports = { MAX: 100 };
    `,
  });

  const reporter = buildReporter(root);
  const report = reporter.generateOrphanReport();

  assert.equal(report.title, "Orphan Module Report");
  assert.ok(report.generatedAt);
  assert.equal(report.orphanCount, 2);

  const orphanNames = report.orphans.map((o) => path.basename(o.relativePath)).sort();
  assert.deepEqual(orphanNames, ["config-constants.js", "orphan.js"]);

  // Recommendations should cover config-constants as a "config" category
  assert.ok(report.recommendations.length > 0);
  const configRec = report.recommendations.find((r) =>
    r.module.replace(/\\/g, "/").includes("config-constants")
  );
  assert.ok(configRec);
  assert.equal(configRec.category, "config");
});

test("CatalogReporter: generateOrphanReport with zero orphans", () => {
  const root = createFixtureTree({
    "src/index.js": `
      "use strict";
      const lib = require("./lib");
      module.exports = { lib };
    `,
    "src/lib.js": `
      "use strict";
      module.exports = { lib: true };
    `,
  });

  const reporter = buildReporter(root);
  const report = reporter.generateOrphanReport();

  assert.equal(report.orphanCount, 0);
  assert.equal(report.orphans.length, 0);
  assert.equal(report.recommendations.length, 0);
});

// ------------------------------------------------------------------
// generateDependencyReport
// ------------------------------------------------------------------

test("CatalogReporter: generateDependencyReport returns graph data", () => {
  const root = createFixtureTree({
    "src/a.js": `"use strict"; const b = require("./b"); module.exports = { a: 1 };`,
    "src/b.js": `"use strict"; const c = require("./c"); module.exports = { b: 2 };`,
    "src/c.js": `"use strict"; module.exports = { c: 3 };`,
  });

  const reporter = buildReporter(root);
  const report = reporter.generateDependencyReport();

  assert.equal(report.title, "Dependency Report");
  assert.ok(report.generatedAt);

  // Nodes
  assert.equal(report.summary.totalNodes, 3);
  assert.equal(report.nodes.length, 3);

  // Edges: a→b, b→c
  assert.equal(report.summary.totalEdges, 2);
  assert.equal(report.edges.length, 2);

  // max in-degree: a=0, b=1, c=1  → maxInDegree=1
  assert.equal(report.summary.maxInDegree, 1);
  // max out-degree: a=1, b=1, c=0 → maxOutDegree=1
  assert.equal(report.summary.maxOutDegree, 1);
});

test("CatalogReporter: generateDependencyReport handles complex graph", () => {
  const root = createFixtureTree({
    "src/hub.js": `"use strict"; const a = require("./a"); const b = require("./b"); const c = require("./c"); module.exports = {};`,
    "src/a.js": `"use strict"; module.exports = { a: 1 };`,
    "src/b.js": `"use strict"; module.exports = { b: 2 };`,
    "src/c.js": `"use strict"; module.exports = { c: 3 };`,
  });

  const reporter = buildReporter(root);
  const report = reporter.generateDependencyReport();

  assert.equal(report.summary.totalNodes, 4);
  assert.equal(report.summary.totalEdges, 3); // hub → a, b, c

  // hub should have the highest out-degree (3)
  const hubNode = report.nodes.find((n) =>
    n.id.replace(/\\/g, "/") === "src/hub.js"
  );
  assert.ok(hubNode);
  assert.equal(hubNode.outDegree, 3);
});

// ------------------------------------------------------------------
// generateCoverageReport
// ------------------------------------------------------------------

test("CatalogReporter: generateCoverageReport identifies covered and uncovered modules", () => {
  const root = createFixtureTree({
    "src/app.js": `
      "use strict";
      module.exports = { run: () => {} };
    `,
    "src/utils.js": `
      "use strict";
      module.exports = { add: (a, b) => a + b };
    `,
    "test/app.test.js": `
      "use strict";
      const { run } = require("../src/app");
    `,
    "test/catalog/scanner.test.js": `
      "use strict";
      const { ModuleScanner } = require("../../src/catalog/scanner");
    `,
  });

  const reporter = buildReporter(root);
  const report = reporter.generateCoverageReport();

  assert.equal(report.title, "Test Coverage Overview");
  assert.ok(report.generatedAt);

  // app.js has a test, utils.js does not
  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.covered, 1);
  assert.equal(report.summary.uncovered, 1);
  assert.equal(report.summary.coveragePct, 50);

  const coveredNames = report.covered.map((c) => path.basename(c.module));
  assert.ok(coveredNames.includes("app.js"));

  const uncoveredNames = report.uncovered.map((c) => path.basename(c.module));
  assert.ok(uncoveredNames.includes("utils.js"));
});

test("CatalogReporter: generateCoverageReport full coverage returns 100%", () => {
  const root = createFixtureTree({
    "src/calc.js": `
      "use strict";
      module.exports = { add: (a, b) => a + b };
    `,
    "test/calc.test.js": `
      "use strict";
      const { add } = require("../src/calc");
    `,
  });

  const reporter = buildReporter(root);
  const report = reporter.generateCoverageReport();

  assert.equal(report.summary.total, 1);
  assert.equal(report.summary.covered, 1);
  assert.equal(report.summary.uncovered, 0);
  assert.equal(report.summary.coveragePct, 100);
});

// ------------------------------------------------------------------
// formatAsMarkdown — Module Catalog
// ------------------------------------------------------------------

test("CatalogReporter: formatAsMarkdown produces valid catalog markdown", () => {
  const root = createFixtureTree({
    "src/main.js": `
      "use strict";
      /**
       * Main entry module.
       */
      const sub = require("./sub");
      module.exports = { main: true, sub };
    `,
    "src/sub.js": `
      "use strict";
      module.exports = { sub: true };
    `,
  });

  const reporter = buildReporter(root);
  const report = reporter.generateModuleReport();
  const md = reporter.formatAsMarkdown(report);

  assert.ok(md.startsWith("# Module Catalog"));
  assert.ok(md.includes("## Summary"));
  assert.ok(md.includes("Total modules"));
  assert.ok(md.includes("## Modules by Directory"));
  assert.ok(md.includes("### src"));
  assert.ok(md.includes("main.js"));
  assert.ok(md.includes("sub.js"));
  // JSDoc column for main.js should be "yes"
  assert.ok(md.includes("yes"), "JSDoc column should show 'yes' for documented modules");
});

// ------------------------------------------------------------------
// formatAsMarkdown — Orphan Report
// ------------------------------------------------------------------

test("CatalogReporter: formatAsMarkdown produces valid orphan markdown", () => {
  const root = createFixtureTree({
    "src/index.js": `
      "use strict";
      module.exports = {};
    `,
    "src/standalone.js": `
      "use strict";
      module.exports = { orphan: true };
    `,
  });

  const reporter = buildReporter(root);
  const report = reporter.generateOrphanReport();
  const md = reporter.formatAsMarkdown(report);

  assert.ok(md.startsWith("# Orphan Module Report"));
  assert.ok(md.includes("Orphan count:"));
  assert.ok(md.includes("## Orphan Modules"));
  assert.ok(md.includes("standalone.js"));
});

test("CatalogReporter: formatAsMarkdown orphan with zero results is friendly", () => {
  const root = createFixtureTree({});

  const reporter = buildReporter(root);
  const report = reporter.generateOrphanReport();
  const md = reporter.formatAsMarkdown(report);

  assert.ok(md.includes("No orphan modules detected"));
});

// ------------------------------------------------------------------
// formatAsMarkdown — Dependency Report
// ------------------------------------------------------------------

test("CatalogReporter: formatAsMarkdown produces valid dependency markdown", () => {
  const root = createFixtureTree({
    "src/a.js": `"use strict"; const b = require("./b"); module.exports = {};`,
    "src/b.js": `"use strict"; module.exports = {};`,
  });

  const reporter = buildReporter(root);
  const report = reporter.generateDependencyReport();
  const md = reporter.formatAsMarkdown(report);

  assert.ok(md.startsWith("# Dependency Report"));
  assert.ok(md.includes("## Graph Summary"));
  assert.ok(md.includes("## Most Depended-Upon Modules"));
  assert.ok(md.includes("## Edges"));
  assert.ok(md.includes("a"));
  assert.ok(md.includes("b"));
});

// ------------------------------------------------------------------
// formatAsMarkdown — Coverage Report
// ------------------------------------------------------------------

test("CatalogReporter: formatAsMarkdown produces valid coverage markdown", () => {
  const root = createFixtureTree({
    "src/only.js": `"use strict"; module.exports = {};`,
  });

  const reporter = buildReporter(root);
  const report = reporter.generateCoverageReport();
  const md = reporter.formatAsMarkdown(report);

  assert.ok(md.startsWith("# Test Coverage Overview"));
  assert.ok(md.includes("## Summary"));
  assert.ok(md.includes("Coverage"));
  assert.ok(md.includes("## Uncovered Modules"));
  assert.ok(md.includes("only.js"));
});

test("CatalogReporter: formatAsMarkdown coverage all-covered shows success message", () => {
  const root = createFixtureTree({
    "src/good.js": `"use strict"; module.exports = {};`,
    "test/good.test.js": `"use strict";`,
  });

  const reporter = buildReporter(root);
  const report = reporter.generateCoverageReport();
  const md = reporter.formatAsMarkdown(report);

  assert.ok(!md.includes("Uncovered Modules"), "Should not show uncovered table when all covered");
});

// ------------------------------------------------------------------
// formatAsMarkdown — generic fallback
// ------------------------------------------------------------------

test("CatalogReporter: formatAsMarkdown generic fallback for unknown report type", () => {
  const root = createFixtureTree({});
  const reporter = buildReporter(root);

  const md = reporter.formatAsMarkdown({
    title: "Custom Report",
    someData: { key: "value" },
  });

  assert.ok(md.startsWith("# Report"));
  assert.ok(md.includes("```json"));
  assert.ok(md.includes("Custom Report"));
  assert.ok(md.includes("someData"));
});
