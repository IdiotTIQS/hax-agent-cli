/**
 * Tests for ChangeImpact: estimateImpact, getAffectedFiles, getRiskLevel,
 * suggestTests, getRollbackDifficulty, file categorization, and dependency tracing.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { ChangeImpact, RiskLevel, _internals } = require("../../src/files/impact");

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------
function fixtureFiles() {
  return [
    { filePath: "/src/core/engine.js", category: "core", source: "require('../utils/date')" },
    { filePath: "/src/utils/date.js", category: "util", source: "" },
    { filePath: "/src/features/login.js", category: "feature", source: "require('../core/engine'); require('../utils/date')" },
    { filePath: "/src/config/settings.js", category: "config", source: "" },
    { filePath: "/src/features/dashboard.js", category: "feature", source: "require('../core/engine')" },
    { filePath: "/test/features/login.test.js", category: "test", source: "require('../../src/features/login')" },
    { filePath: "/test/core/engine.test.js", category: "test", source: "require('../../src/core/engine')" },
  ];
}

function buildChange(file, opts = {}) {
  return Object.assign({ file, operation: "edit", lineCount: 0, isBreaking: false, description: "" }, opts);
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

test("ChangeImpact: constructor uses default options", () => {
  const ci = new ChangeImpact();
  assert.equal(ci._opts.maxAffectedFiles, 100);
  assert.equal(ci._opts.maxDepth, 10);
});

test("ChangeImpact: constructor accepts custom options", () => {
  const ci = new ChangeImpact({ maxAffectedFiles: 50, maxDepth: 3 });
  assert.equal(ci._opts.maxAffectedFiles, 50);
  assert.equal(ci._opts.maxDepth, 3);
});

test("ChangeImpact: addFile registers files in import graph and reverse graph", () => {
  const ci = new ChangeImpact();
  ci.addFile({
    filePath: "/src/app.js",
    source: "const utils = require('./utils'); const core = require('./core/engine');",
  });

  const key = "src/app.js";
  const imports = ci._importGraph.get(key);
  assert.ok(imports, "imports should be registered");
  assert.ok(imports.includes("./utils"), "should find ./utils import");
  assert.ok(imports.includes("./core/engine"), "should find ./core/engine import");

  // Reverse graph should have entries for the imported modules
  assert.ok(ci._reverseImportGraph.has("utils"), "utils should be in reverse graph");
  assert.ok(ci._reverseImportGraph.has("core/engine"), "core/engine should be in reverse graph");
});

test("ChangeImpact: addFile categorizes files correctly", () => {
  const ci = new ChangeImpact();

  ci.addFile({ filePath: "/src/core/engine.js" });
  ci.addFile({ filePath: "/src/utils/helpers.js" });
  ci.addFile({ filePath: "/src/config/db.js" });
  ci.addFile({ filePath: "/src/features/login.js" });
  ci.addFile({ filePath: "/src/components/button.js" });
  ci.addFile({ filePath: "/test/app.test.js" });
  ci.addFile({ filePath: "/docs/README.md" });

  assert.equal(ci._categories.get("src/core/engine.js"), "core");
  assert.equal(ci._categories.get("src/utils/helpers.js"), "util");
  assert.equal(ci._categories.get("src/config/db.js"), "config");
  assert.equal(ci._categories.get("src/features/login.js"), "feature");
  assert.equal(ci._categories.get("src/components/button.js"), "feature");
  assert.equal(ci._categories.get("test/app.test.js"), "test");
  assert.equal(ci._categories.get("docs/readme.md"), "docs");
});

test("ChangeImpact: estimateImpact returns structured impact assessment for core engine edit", () => {
  const ci = new ChangeImpact();
  ci.addFile({ filePath: "/src/core/engine.js", category: "core" });

  // Add many consumer files
  for (let i = 0; i < 12; i++) {
    ci.addFile({
      filePath: `/src/features/module${i}.js`,
      imports: ["/src/core/engine.js"],
    });
  }

  const impact = ci.estimateImpact("/src/core/engine.js", buildChange("/src/core/engine.js", {
    operation: "edit",
    lineCount: 150,
  }));

  assert.equal(impact.file, "/src/core/engine.js");
  assert.equal(impact.operation, "edit");
  assert.ok(impact.riskScore > 0, "should have positive risk score");
  assert.ok(impact.affectedFileCount > 0, "should have affected files");
  assert.ok(impact.factors.length > 0, "should have risk factors");
  assert.ok(["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(impact.riskLevel),
    `risk level should be valid, got ${impact.riskLevel}`);
});

test("ChangeImpact: estimateImpact rates delete as higher risk than edit", () => {
  const ci = new ChangeImpact();
  ci.addFile({ filePath: "/src/utils/helpers.js", category: "util" });

  const editImpact = ci.estimateImpact("/src/utils/helpers.js", buildChange("/src/utils/helpers.js", {
    operation: "edit",
  }));
  const deleteImpact = ci.estimateImpact("/src/utils/helpers.js", buildChange("/src/utils/helpers.js", {
    operation: "delete",
  }));

  assert.ok(deleteImpact.riskScore > editImpact.riskScore,
    `delete risk (${deleteImpact.riskScore}) should be > edit risk (${editImpact.riskScore})`);
  assert.ok(deleteImpact.factors.includes("destructive-operation"));
});

test("ChangeImpact: estimateImpact flags breaking changes", () => {
  const ci = new ChangeImpact();
  ci.addFile({ filePath: "/src/api/public.js", category: "core" });

  const impact = ci.estimateImpact("/src/api/public.js", buildChange("/src/api/public.js", {
    operation: "edit",
    isBreaking: true,
  }));

  assert.ok(impact.breakingRisk, "should identify breaking risk");
  assert.ok(impact.factors.includes("breaking-change"), "should include breaking-change factor");
  assert.ok(impact.riskScore >= 30, "breaking changes should have elevated risk");
});

test("ChangeImpact: estimateImpact detects critical files", () => {
  const ci = new ChangeImpact();
  ci.addFile({ filePath: "/src/core/auth.js", critical: true });

  const impact = ci.estimateImpact("/src/core/auth.js", buildChange("/src/core/auth.js"));

  assert.ok(impact.factors.includes("critical-file"), "should flag critical file");
});

test("ChangeImpact: estimateImpact rates config file changes as riskier", () => {
  const ci = new ChangeImpact();
  ci.addFile({ filePath: "/src/config/package.json" });

  const impact = ci.estimateImpact("/src/config/package.json", buildChange("/src/config/package.json"));
  assert.ok(impact.factors.includes("config-file"), "should flag config file");
});

test("ChangeImpact: getAffectedFiles returns direct and transitive consumers", () => {
  const ci = new ChangeImpact();

  // Build chain: engine -> middleware -> handler -> route
  ci.addFile({ filePath: "/src/engine.js", source: "" });
  ci.addFile({ filePath: "/src/middleware.js", imports: ["/src/engine.js"] });
  ci.addFile({ filePath: "/src/handler.js", imports: ["/src/middleware.js"] });
  ci.addFile({ filePath: "/src/route.js", imports: ["/src/handler.js"] });

  const affected = ci.getAffectedFiles("/src/engine.js");

  assert.equal(affected.direct.length, 1, "should have 1 direct consumer");
  assert.ok(affected.direct.includes("src/middleware.js"), "middleware directly imports engine");
  assert.equal(affected.transitive.length, 2, "should have 2 transitive consumers");
  assert.ok(affected.transitive.includes("src/handler.js"), "handler is transitive");
  assert.ok(affected.transitive.includes("src/route.js"), "route is transitive");
  assert.equal(affected.total, 3);
});

test("ChangeImpact: getAffectedFiles returns empty for isolated file", () => {
  const ci = new ChangeImpact();
  ci.addFile({ filePath: "/src/standalone.js", source: "" });

  const affected = ci.getAffectedFiles("/src/standalone.js");
  assert.equal(affected.direct.length, 0);
  assert.equal(affected.transitive.length, 0);
  assert.equal(affected.total, 0);
});

test("ChangeImpact: getRiskLevel delegates to estimateImpact", () => {
  const ci = new ChangeImpact();
  ci.addFile({ filePath: "/src/app.js", category: "feature" });

  const risk = ci.getRiskLevel(buildChange("/src/app.js"));
  assert.ok(["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(risk.level));
  assert.ok(typeof risk.score === "number");
  assert.ok(Array.isArray(risk.factors));
});

test("ChangeImpact: getRiskLevel returns LOW for empty change", () => {
  const ci = new ChangeImpact();
  const risk = ci.getRiskLevel(null);
  assert.equal(risk.level, RiskLevel.LOW);
  assert.equal(risk.score, 0);
});

test("ChangeImpact: suggestTests finds direct test mappings", () => {
  const ci = new ChangeImpact();

  ci.addFile({ filePath: "/src/features/login.js", category: "feature" });
  ci.addFile({ filePath: "/test/features/login.test.js", category: "test" });
  ci.addTest("/src/features/login.js", "/test/features/login.test.js");

  const suggestions = ci.suggestTests("/src/features/login.js");
  assert.ok(suggestions.length > 0, "should suggest tests");
  const directTest = suggestions.find((s) => s.reason === "direct-test");
  assert.ok(directTest, "should find direct test mapping");
  assert.equal(directTest.priority, "must-run");
  assert.ok(directTest.file.includes("login.test.js"), "should suggest the correct test file");
});

test("ChangeImpact: suggestTests returns consumer tests", () => {
  const ci = new ChangeImpact();

  ci.addFile({ filePath: "/src/core/engine.js", category: "core", source: "" });
  ci.addFile({ filePath: "/src/features/dashboard.js", category: "feature", imports: ["/src/core/engine.js"] });
  ci.addFile({ filePath: "/test/features/dashboard.test.js", category: "test" });
  ci.addTest("/src/features/dashboard.js", "/test/features/dashboard.test.js");

  const suggestions = ci.suggestTests("/src/core/engine.js");

  // Should suggest the dashboard test because dashboard imports engine
  const consumerTest = suggestions.find((s) => s.file.includes("dashboard.test"));
  assert.ok(consumerTest, "should suggest consumer test file");
});

test("ChangeImpact: getRollbackDifficulty rates delete as hardest to rollback", () => {
  const ci = new ChangeImpact();
  ci.addFile({ filePath: "/src/core/data.js", category: "core" });

  // Add consumers
  for (let i = 0; i < 8; i++) {
    ci.addFile({
      filePath: `/src/features/f${i}.js`,
      imports: ["/src/core/data.js"],
    });
  }

  const createRollback = ci.getRollbackDifficulty(buildChange("/src/core/data.js", { operation: "create" }));
  const editRollback = ci.getRollbackDifficulty(buildChange("/src/core/data.js", { operation: "edit" }));
  const deleteRollback = ci.getRollbackDifficulty(buildChange("/src/core/data.js", { operation: "delete" }));

  assert.ok(deleteRollback.score > createRollback.score,
    `delete (${deleteRollback.score}) harder than create (${createRollback.score})`);
  assert.ok(deleteRollback.score > editRollback.score,
    `delete (${deleteRollback.score}) harder than edit (${editRollback.score})`);

  assert.ok(["trivial", "easy", "moderate", "hard", "very-hard"].includes(deleteRollback.difficulty));
  assert.ok(typeof deleteRollback.recommendation === "string");
  assert.ok(deleteRollback.recommendation.length > 0);
});

test("ChangeImpact: getRollbackDifficulty returns trivial for minimal edit", () => {
  const ci = new ChangeImpact();
  ci.addFile({ filePath: "/src/simple.js" });

  const rollback = ci.getRollbackDifficulty(buildChange("/src/simple.js", {
    operation: "edit",
    lineCount: 5,
  }));

  assert.equal(rollback.difficulty, "trivial");
  assert.ok(rollback.score < 20);
});

test("ChangeImpact: getRollbackDifficulty considers large line counts and breaking changes", () => {
  const ci = new ChangeImpact();
  ci.addFile({ filePath: "/src/api.js", category: "core" });

  // Add consumers to increase impact
  for (let i = 0; i < 6; i++) {
    ci.addFile({ filePath: `/src/f${i}.js`, imports: ["/src/api.js"] });
  }

  const rollback = ci.getRollbackDifficulty(buildChange("/src/api.js", {
    operation: "refactor",
    lineCount: 300,
    isBreaking: true,
  }));

  assert.ok(rollback.score >= 30, `expected score >= 30, got ${rollback.score}`);
  assert.ok(
    ["hard", "very-hard"].includes(rollback.difficulty),
    `expected hard or very-hard, got ${rollback.difficulty}`,
  );
  assert.ok(rollback.factors.includes("refactor-operation"));
  assert.ok(rollback.factors.includes("breaking-change"));
  assert.ok(rollback.factors.includes("very-large-change"));
});

test("ChangeImpact: clear resets all internal state", () => {
  const ci = new ChangeImpact();
  ci.addFile({ filePath: "/src/app.js", source: "require('./utils')" });
  ci.addFile({ filePath: "/src/utils.js" });
  ci.addFile({ filePath: "/test/app.test.js", critical: true });
  ci.addTest("/src/app.js", "/test/app.test.js");

  assert.ok(ci._importGraph.size > 0, "should have data before clear");
  assert.ok(ci._criticalFiles.length > 0, "should have critical files before clear");

  ci.clear();

  assert.equal(ci._importGraph.size, 0);
  assert.equal(ci._reverseImportGraph.size, 0);
  assert.equal(ci._fanOut.size, 0);
  assert.equal(ci._categories.size, 0);
  assert.equal(ci._fileSources.size, 0);
  assert.equal(ci._testMap.size, 0);
  assert.equal(ci._modificationCount.size, 0);
  assert.equal(ci._criticalFiles.length, 0);
});

test("ChangeImpact: addFile handles missing/invalid input gracefully", () => {
  const ci = new ChangeImpact();
  assert.doesNotThrow(() => ci.addFile(null));
  assert.doesNotThrow(() => ci.addFile(undefined));
  assert.doesNotThrow(() => ci.addFile({}));
  assert.equal(ci._importGraph.size, 0);
});

test("ChangeImpact: estimateImpact includes config-file factor for package.json", () => {
  const ci = new ChangeImpact();
  ci.addFile({ filePath: "/package.json" });

  const impact = ci.estimateImpact("/package.json", buildChange("/package.json"));
  assert.ok(impact.factors.includes("config-file"));
});

test("ChangeImpact: estimateImpact includes deep-dependencies factor", () => {
  const ci = new ChangeImpact();

  // Build a deep dependency chain: a -> b -> c -> d -> e -> f
  ci.addFile({ filePath: "/src/a.js", imports: ["/src/b.js"] });
  ci.addFile({ filePath: "/src/b.js", imports: ["/src/c.js"] });
  ci.addFile({ filePath: "/src/c.js", imports: ["/src/d.js"] });
  ci.addFile({ filePath: "/src/d.js", imports: ["/src/e.js"] });
  ci.addFile({ filePath: "/src/e.js", imports: ["/src/f.js"] });
  ci.addFile({ filePath: "/src/f.js", source: "" });

  const impact = ci.estimateImpact("/src/a.js", buildChange("/src/a.js"));
  assert.ok(impact.factors.includes("deep-dependencies"));
});

test("ChangeImpact: RiskLevel enum values are exported", () => {
  assert.equal(RiskLevel.LOW, "LOW");
  assert.equal(RiskLevel.MEDIUM, "MEDIUM");
  assert.equal(RiskLevel.HIGH, "HIGH");
  assert.equal(RiskLevel.CRITICAL, "CRITICAL");
});

// -----------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------

test("_internals.normalizePath normalizes paths", () => {
  const { normalizePath } = _internals;
  assert.equal(normalizePath("/src/App.js"), "src/app.js");
  assert.equal(normalizePath("src/App.js"), "src/app.js");
  assert.equal(normalizePath("./src/App.js"), "src/app.js");
  assert.equal(normalizePath("./components/Button.tsx"), "components/button.tsx");
  assert.equal(normalizePath("src\\utils\\date.js"), "src/utils/date.js");
  assert.equal(normalizePath(null), "");
});

test("_internals.isTestFile identifies test files", () => {
  const { isTestFile } = _internals;
  assert.ok(isTestFile("/test/app.test.js"));
  assert.ok(isTestFile("/src/components/button.spec.ts"));
  assert.ok(isTestFile("/src/__tests__/helper.js"));
  assert.ok(isTestFile("src/app.test.js"));
  assert.equal(isTestFile("/src/app.js"), false);
  assert.equal(isTestFile("/src/utils.js"), false);
});

test("_internals.isConfigFile identifies config files", () => {
  const { isConfigFile } = _internals;
  assert.ok(isConfigFile("/package.json"));
  assert.ok(isConfigFile("/tsconfig.json"));
  assert.ok(isConfigFile("/webpack.config.js"));
  assert.ok(isConfigFile("/.env"));
  assert.ok(isConfigFile("/Dockerfile"));
  assert.equal(isConfigFile("/src/app.js"), false);
});

test("_internals.computeDepth calculates dependency depth", () => {
  const { computeDepth, normalizePath } = _internals;
  // Use _internals.normalizePath to build graph consistently
  const importGraph = new Map();
  importGraph.set(normalizePath("/src/a.js"), [normalizePath("/src/b.js")]);
  importGraph.set(normalizePath("/src/b.js"), [normalizePath("/src/c.js")]);
  importGraph.set(normalizePath("/src/c.js"), [normalizePath("/src/d.js")]);
  importGraph.set(normalizePath("/src/d.js"), []);

  const depth = computeDepth(normalizePath("/src/a.js"), importGraph, 10);
  assert.equal(depth, 3, "chain a->b->c->d should have depth 3");

  // Leaf node should have depth 0
  const leafDepth = computeDepth(normalizePath("/src/d.js"), importGraph, 10);
  assert.equal(leafDepth, 0);
});
