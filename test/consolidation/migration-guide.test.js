"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MigrationGuide,
  suggestMergedName,
  computeRelativeImport,
  computeRequirePattern,
} = require("../../src/consolidation/migration-guide");

// We also need the analyzer to build plans.
const {
  ConsolidationAnalyzer,
  buildModuleMap,
} = require("../../src/consolidation/analyzer");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFixtureModules() {
  return [
    {
      path: "src/scheduler/cron.js",
      slug: "scheduler/cron",
      exports: ["CronScheduler", "parseCron", "parseField", "cronMatches", "nextCronDate"],
      imports: ["debug"],
      category: "scheduler",
      lines: 457,
      complexity: 7,
    },
    {
      path: "src/scheduler/queue.js",
      slug: "scheduler/queue",
      exports: ["TaskQueue", "PriorityQueue", "normalizeTask", "isTaskReady"],
      imports: ["debug"],
      category: "scheduler",
      lines: 449,
      complexity: 8,
    },
    {
      path: "src/scheduler/worker.js",
      slug: "scheduler/worker",
      exports: ["TaskWorker", "TaskWorkerError"],
      imports: ["debug", "node:events"],
      category: "scheduler",
      lines: 324,
      complexity: 6,
    },
    {
      path: "src/tokens/budget.js",
      slug: "tokens/budget",
      exports: ["TokenBudget", "CATEGORIES", "DEFAULT_ALLOCATION_PERCENTAGES"],
      imports: [],
      category: "tokens",
      lines: 238,
      complexity: 5,
    },
    {
      path: "src/tokens/cost-tracker.js",
      slug: "tokens/cost-tracker",
      exports: ["CostTracker", "MODEL_PRICING", "DEFAULT_BUDGET"],
      imports: [],
      category: "tokens",
      lines: 682,
      complexity: 9,
    },
    {
      path: "src/tokens/monitor.js",
      slug: "tokens/monitor",
      exports: ["TokenMonitor", "ALERT_THRESHOLDS"],
      imports: [],
      category: "tokens",
      lines: 450,
      complexity: 6,
    },
    {
      path: "src/session.js",
      slug: "session",
      exports: ["InputHistory", "CostTracker", "Session"],
      imports: ["memory", "i18n"],
      category: "session",
      lines: 262,
      complexity: 5,
    },
    {
      path: "src/runtime/sessions.js",
      slug: "runtime/sessions",
      exports: ["Session", "createSession"],
      imports: ["runtime/utils"],
      category: "session",
      lines: 51,
      complexity: 3,
    },
  ];
}

function buildPlan() {
  const map = buildModuleMap(makeFixtureModules());
  const analyzer = new ConsolidationAnalyzer(map, { duplicateThreshold: 0.2 });
  return analyzer.getConsolidationPlan();
}

// ---------------------------------------------------------------------------
// Utility function tests
// ---------------------------------------------------------------------------

test("suggestMergedName: single-category cluster uses category name", () => {
  const cluster = [
    { slug: "scheduler/cron", category: "scheduler" },
    { slug: "scheduler/queue", category: "scheduler" },
  ];
  const name = suggestMergedName(cluster);
  assert.equal(name, "scheduler-consolidated");
});

test("suggestMergedName: same-category cluster uses category-consolidated", () => {
  const cluster = [
    { slug: "tokens/budget", category: "tokens" },
    { slug: "tokens/cost", category: "tokens" },
  ];
  const name = suggestMergedName(cluster);
  assert.equal(name, "tokens-consolidated");
});

test("suggestMergedName: empty cluster returns fallback", () => {
  assert.equal(suggestMergedName([]), "merged");
});

test("computeRelativeImport: produces relative path", () => {
  const result = computeRelativeImport("src/scheduler/cron.js", "scheduler-core.js");
  assert.ok(typeof result === "string");
  assert.ok(result.includes("scheduler-core"), `Expected to include "scheduler-core", got "${result}"`);
});

test("computeRequirePattern: generates regex patterns from module paths", () => {
  const mod = {
    path: "src/scheduler/cron.js",
    slug: "scheduler/cron",
  };
  const patterns = computeRequirePattern(mod);
  assert.ok(Array.isArray(patterns));
  assert.ok(patterns.length > 0, "Expected at least one pattern");
});

// ---------------------------------------------------------------------------
// MigrationGuide tests
// ---------------------------------------------------------------------------

test("MigrationGuide: constructor accepts options", () => {
  const guide = new MigrationGuide({ projectRoot: "lib", packageManager: "yarn" });
  assert.equal(guide._projectRoot, "lib");
  assert.equal(guide._packageManager, "yarn");
});

test("MigrationGuide: constructor uses defaults", () => {
  const guide = new MigrationGuide();
  assert.equal(guide._projectRoot, "src");
  assert.equal(guide._packageManager, "npm");
});

test("MigrationGuide: generateGuide produces structured output", () => {
  const plan = buildPlan();
  const guide = new MigrationGuide();
  const output = guide.generateGuide(plan);

  // Should contain markdown-structured content.
  assert.ok(typeof output === "string");
  assert.ok(output.length > 0);
  assert.ok(output.includes("# Consolidation Migration Guide"), "Guide should have a title");
  assert.ok(output.includes("Phase"), "Guide should mention phases");
  assert.ok(output.includes("Step"), "Guide should detail steps");
  assert.ok(output.includes("Post-Migration Checklist"), "Guide should include checklist");
});

test("MigrationGuide: generateGuide for empty plan returns no-op message", () => {
  const guide = new MigrationGuide();
  const output = guide.generateGuide({ phases: [] });
  assert.ok(output.includes("No consolidation actions required"));
});

test("MigrationGuide: generateGuide includes step-by-step merge instructions", () => {
  const plan = buildPlan();
  const guide = new MigrationGuide();
  const output = guide.generateGuide(plan);

  if (plan.phases.length > 0) {
    assert.ok(output.includes("Create the consolidated module"));
    assert.ok(output.includes("Reconcile exports"));
    assert.ok(output.includes("Migrate internals"));
    assert.ok(output.includes("Update dependents"));
  }
});

test("MigrationGuide: generateBreakingChanges lists import path changes", () => {
  const plan = buildPlan();
  const guide = new MigrationGuide();
  const changes = guide.generateBreakingChanges(plan);

  assert.ok(Array.isArray(changes.changes));
  assert.ok(typeof changes.summary === "string");
  assert.ok(typeof changes.severe === "number");
  assert.ok(typeof changes.moderate === "number");
  assert.ok(typeof changes.minor === "number");
});

test("MigrationGuide: generateBreakingChanges for empty plan has no changes", () => {
  const guide = new MigrationGuide();
  const changes = guide.generateBreakingChanges({ phases: [] });
  assert.equal(changes.changes.length, 0);
  assert.equal(changes.totalAffectedDependents, 0);
});

test("MigrationGuide: generateBreakingChanges detects export name conflicts", () => {
  const plan = buildPlan();
  const guide = new MigrationGuide();
  const changes = guide.generateBreakingChanges(plan);

  // The session modules both export "Session" — that's a conflict.
  const exportConflicts = changes.changes.filter(
    (c) => c.type === "export_name_conflict",
  );
  const sessionConflicts = exportConflicts.filter((c) => {
    const names = c.conflictingNames || [];
    return names.includes("Session") || names.includes("CostTracker");
  });

  assert.ok(
    sessionConflicts.length >= 1,
    `Expected session export conflicts, found ${sessionConflicts.length}`,
  );
});

test("MigrationGuide: generateCompatLayer produces shim suggestions", () => {
  const plan = buildPlan();
  const guide = new MigrationGuide();
  const layers = guide.generateCompatLayer(plan);

  assert.ok(Array.isArray(layers));

  // Each layer should have shims for the old modules.
  if (layers.length > 0) {
    const layer = layers[0];
    assert.ok(typeof layer.mergedModule === "string");
    assert.ok(typeof layer.mergedName === "string");
    assert.ok(Array.isArray(layer.sourceModules));
    assert.ok(Array.isArray(layer.shims));

    if (layer.shims.length > 0) {
      const shim = layer.shims[0];
      assert.ok(typeof shim.shimContent === "string");
      assert.ok(Array.isArray(shim.exportsBridged));
      assert.ok(shim.shimContent.includes("deprecated"), "Shim should have @deprecated tag");
    }
  }
});

test("MigrationGuide: generateCompatLayer for empty plan has no layers", () => {
  const guide = new MigrationGuide();
  const layers = guide.generateCompatLayer({ phases: [] });
  assert.deepEqual(layers, []);
});

test("MigrationGuide: generateMigrationScript creates executable Node.js script", () => {
  const plan = buildPlan();
  const guide = new MigrationGuide();
  const script = guide.generateMigrationScript(plan);

  assert.ok(typeof script === "string");
  assert.ok(script.includes('"use strict"'));
  assert.ok(script.includes("require("));
  assert.ok(script.includes("migrateFile"));
  assert.ok(script.includes("walk"));
  assert.ok(script.includes("--dry-run"));
});

test("MigrationGuide: generateMigrationScript handles empty plan", () => {
  const guide = new MigrationGuide();
  const script = guide.generateMigrationScript({ phases: [] });
  assert.ok(script.includes("Nothing to migrate"));
});

test("MigrationGuide: generateGuide mentions total effort", () => {
  const plan = buildPlan();
  const guide = new MigrationGuide();
  const output = guide.generateGuide(plan);

  assert.ok(
    output.includes("story points"),
    "Guide should mention effort estimates in story points",
  );
});

test("MigrationGuide: generateGuide mentions verification steps", () => {
  const plan = buildPlan();
  const guide = new MigrationGuide();
  const output = guide.generateGuide(plan);

  assert.ok(output.includes("test passes"));
  assert.ok(output.includes("lint passes"));
  assert.ok(output.includes("circular dependency"));
});

test("MigrationGuide: handles null / undefined plan gracefully", () => {
  const guide = new MigrationGuide();

  // generateGuide
  const guideNull = guide.generateGuide(null);
  assert.ok(guideNull.includes("No consolidation"));

  const guideUndef = guide.generateGuide(undefined);
  assert.ok(guideUndef.includes("No consolidation"));

  // generateBreakingChanges
  const bc = guide.generateBreakingChanges(null);
  assert.deepEqual(bc.changes, []);

  // generateCompatLayer
  const cl = guide.generateCompatLayer(null);
  assert.deepEqual(cl, []);

  // generateMigrationScript
  const ms = guide.generateMigrationScript(null);
  assert.ok(ms.includes("Nothing to migrate"));
});
