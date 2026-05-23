"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const {
  ConsolidationAnalyzer,
  buildModuleMap,
  jaccardSimilarity,
  diceSimilarity,
  nameSimilarity,
  exportSimilarity,
  dependencyOverlap,
  commonPrefixLength,
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
      tags: ["scheduler", "cron"],
      lines: 457,
      complexity: 7,
    },
    {
      path: "src/scheduler/queue.js",
      slug: "scheduler/queue",
      exports: ["TaskQueue", "PriorityQueue", "normalizeTask", "isTaskReady"],
      imports: ["debug"],
      category: "scheduler",
      tags: ["scheduler", "queue", "priority"],
      lines: 449,
      complexity: 8,
    },
    {
      path: "src/scheduler/worker.js",
      slug: "scheduler/worker",
      exports: ["TaskWorker", "TaskWorkerError"],
      imports: ["debug", "node:events"],
      category: "scheduler",
      tags: ["scheduler", "worker"],
      lines: 324,
      complexity: 6,
    },
    {
      path: "src/tokens/budget.js",
      slug: "tokens/budget",
      exports: ["TokenBudget", "CATEGORIES", "DEFAULT_ALLOCATION_PERCENTAGES"],
      imports: [],
      category: "tokens",
      tags: ["tokens", "budget"],
      lines: 238,
      complexity: 5,
    },
    {
      path: "src/tokens/cost-tracker.js",
      slug: "tokens/cost-tracker",
      exports: ["CostTracker", "MODEL_PRICING", "DEFAULT_BUDGET"],
      imports: [],
      category: "tokens",
      tags: ["tokens", "cost"],
      lines: 682,
      complexity: 9,
    },
    {
      path: "src/tokens/monitor.js",
      slug: "tokens/monitor",
      exports: ["TokenMonitor", "ALERT_THRESHOLDS"],
      imports: [],
      category: "tokens",
      tags: ["tokens", "monitor"],
      lines: 450,
      complexity: 6,
    },
    {
      path: "src/session.js",
      slug: "session",
      exports: ["InputHistory", "CostTracker", "Session"],
      imports: ["memory", "i18n"],
      category: "session",
      tags: ["session", "cli"],
      lines: 262,
      complexity: 5,
    },
    {
      path: "src/runtime/sessions.js",
      slug: "runtime/sessions",
      exports: ["Session", "createSession"],
      imports: ["runtime/utils"],
      category: "session",
      tags: ["session", "runtime"],
      lines: 51,
      complexity: 3,
    },
    {
      path: "src/context.js",
      slug: "context",
      exports: ["ContextManager", "buildContext", "ContextWindow"],
      imports: ["config", "memory"],
      category: "context",
      tags: ["context"],
      lines: 200,
      complexity: 6,
    },
    {
      path: "src/context-window.js",
      slug: "context-window",
      exports: ["ContextWindow", "estimateTokens", "truncateMessages"],
      imports: ["config"],
      category: "context",
      tags: ["context", "window"],
      lines: 180,
      complexity: 5,
    },
  ];
}

// ---------------------------------------------------------------------------
// Utility function tests
// ---------------------------------------------------------------------------

test("jaccardSimilarity: identical sets return 1", () => {
  const a = new Set([1, 2, 3]);
  const b = new Set([1, 2, 3]);
  assert.equal(jaccardSimilarity(a, b), 1);
});

test("jaccardSimilarity: disjoint sets return 0", () => {
  const a = new Set([1, 2]);
  const b = new Set([3, 4]);
  assert.equal(jaccardSimilarity(a, b), 0);
});

test("jaccardSimilarity: partial overlap", () => {
  const a = new Set([1, 2, 3]);
  const b = new Set([2, 3, 4]);
  // intersection = {2,3} = 2, union = {1,2,3,4} = 4 => 0.5
  assert.equal(jaccardSimilarity(a, b), 0.5);
});

test("diceSimilarity: identical sets", () => {
  const a = new Set(["a", "b"]);
  const b = new Set(["a", "b"]);
  // 2*2 / (2+2) = 1
  assert.equal(diceSimilarity(a, b), 1);
});

test("diceSimilarity: no overlap", () => {
  const a = new Set(["a"]);
  const b = new Set(["b"]);
  assert.equal(diceSimilarity(a, b), 0);
});

test("nameSimilarity: similar slugs score high", () => {
  const score = nameSimilarity("scheduler/cron-job", "scheduler/cron");
  // Should be reasonably high — they share "scheduler" and "cron"
  assert.ok(score > 0.3, `Expected > 0.3, got ${score}`);
});

test("nameSimilarity: unrelated slugs score low", () => {
  const score = nameSimilarity("scheduler/cron", "tokens/budget");
  assert.ok(score < 0.3, `Expected < 0.3, got ${score}`);
});

test("commonPrefixLength: finds shared prefix", () => {
  assert.equal(commonPrefixLength("CronScheduler", "CronSchedule"), 12);
  assert.equal(commonPrefixLength("abc", "xyz"), 0);
  assert.equal(commonPrefixLength("hello", "helloWorld"), 5);
});

test("exportSimilarity: overlapping exports score high", () => {
  const expA = ["Session", "createSession", "getTranscript"];
  const expB = ["Session", "createSession", "addMessage"];
  const score = exportSimilarity(expA, expB);
  assert.ok(score > 0.35, `Expected > 0.35, got ${score}`);
});

test("exportSimilarity: disjoint exports score zero", () => {
  const score = exportSimilarity(
    ["parseCron", "cronMatches"],
    ["TokenBudget", "ModelPricing"],
  );
  assert.equal(score, 0);
});

test("dependencyOverlap: overlapping imports score high", () => {
  const score = dependencyOverlap(
    ["debug", "config"],
    ["debug", "node:events"],
  );
  // intersection = {debug} = 1, union = {debug,config,node:events} = 3 => ~0.33
  assert.ok(score > 0.3, `Expected > 0.3, got ${score}`);
});

// ---------------------------------------------------------------------------
// buildModuleMap tests
// ---------------------------------------------------------------------------

test("buildModuleMap: creates a map from module array", () => {
  const modules = makeFixtureModules();
  const map = buildModuleMap(modules);
  assert.equal(typeof map, "object");
  assert.ok("scheduler/cron" in map);
  assert.ok("tokens/budget" in map);
});

test("buildModuleMap: preserves exports as arrays", () => {
  const map = buildModuleMap(makeFixtureModules());
  const cron = map["scheduler/cron"];
  assert.ok(Array.isArray(cron.exports));
  assert.ok(cron.exports.includes("CronScheduler"));
});

test("buildModuleMap: normalises slashes in path", () => {
  const map = buildModuleMap([
    { path: "src\\foo\\bar.js", exports: ["x"] },
  ]);
  // Slug derived from normalised path
  const slug = Object.keys(map)[0];
  assert.ok(!slug.includes("\\"), `Slug "${slug}" should not contain backslashes`);
});

// ---------------------------------------------------------------------------
// ConsolidationAnalyzer tests
// ---------------------------------------------------------------------------

test("ConsolidationAnalyzer: constructor rejects non-object moduleMap", () => {
  assert.throws(() => new ConsolidationAnalyzer(null), /moduleMap/);
  assert.throws(() => new ConsolidationAnalyzer(undefined), /moduleMap/);
});

test("ConsolidationAnalyzer: findDuplicates detects scheduler overlap", () => {
  const map = buildModuleMap(makeFixtureModules());
  const analyzer = new ConsolidationAnalyzer(map);

  const duplicates = analyzer.findDuplicates();
  // All three scheduler modules should have pairings.
  const schedulerPairs = duplicates.filter(
    (d) =>
      d.moduleA.includes("scheduler") && d.moduleB.includes("scheduler"),
  );

  assert.ok(schedulerPairs.length >= 2, `Expected >= 2 scheduler duplicate pairs, got ${schedulerPairs.length}`);
});

test("ConsolidationAnalyzer: findDuplicates respects threshold option", () => {
  const map = buildModuleMap(makeFixtureModules());
  const analyzer = new ConsolidationAnalyzer(map, { duplicateThreshold: 0.9 });

  const duplicatesHigh = analyzer.findDuplicates({ threshold: 0.9 });
  const duplicatesLow = analyzer.findDuplicates({ threshold: 0.1 });

  assert.ok(
    duplicatesHigh.length <= duplicatesLow.length,
    `High threshold should produce fewer duplicates. High: ${duplicatesHigh.length}, Low: ${duplicatesLow.length}`,
  );
});

test("ConsolidationAnalyzer: findDuplicates detects session duplication", () => {
  const map = buildModuleMap(makeFixtureModules());
  const analyzer = new ConsolidationAnalyzer(map);

  const duplicates = analyzer.findDuplicates();
  const sessionPairs = duplicates.filter(
    (d) =>
      (d.moduleA === "session" && d.moduleB === "runtime/sessions") ||
      (d.moduleA === "runtime/sessions" && d.moduleB === "session"),
  );

  assert.ok(
    sessionPairs.length > 0,
    "Expected 'session' and 'runtime/sessions' to be flagged as duplicates",
  );
});

test("ConsolidationAnalyzer: findOverlappingAPIs finds Session export conflict", () => {
  const map = buildModuleMap(makeFixtureModules());
  const analyzer = new ConsolidationAnalyzer(map);

  const overlaps = analyzer.findOverlappingAPIs();
  const sessionOverlap = overlaps.find(
    (o) =>
      (o.moduleA === "session" && o.moduleB === "runtime/sessions") ||
      (o.moduleA === "runtime/sessions" && o.moduleB === "session"),
  );

  assert.ok(sessionOverlap, "Expected session modules to have overlapping APIs");
  assert.ok(
    sessionOverlap.exactOverlap.includes("Session"),
    "Expected 'Session' export name overlap",
  );
});

test("ConsolidationAnalyzer: findOverlappingAPIs finds context overlap", () => {
  const map = buildModuleMap(makeFixtureModules());
  const analyzer = new ConsolidationAnalyzer(map);

  const overlaps = analyzer.findOverlappingAPIs();
  const ctxOverlap = overlaps.find(
    (o) =>
      (o.moduleA === "context" && o.moduleB === "context-window") ||
      (o.moduleA === "context-window" && o.moduleB === "context"),
  );

  assert.ok(ctxOverlap, "Expected context modules to have overlapping APIs");
});

test("ConsolidationAnalyzer: suggestConsolidation produces clusters", () => {
  const map = buildModuleMap(makeFixtureModules());
  const analyzer = new ConsolidationAnalyzer(map, { duplicateThreshold: 0.2 });

  const suggestions = analyzer.suggestConsolidation();
  assert.ok(Array.isArray(suggestions));
  // With our fixture data, we expect at least the scheduler cluster.
  const schedulerClusters = suggestions.filter((s) =>
    s.cluster.some((c) => c.includes("scheduler")),
  );
  assert.ok(
    schedulerClusters.length >= 1,
    `Expected at least 1 scheduler cluster, got ${schedulerClusters.length}`,
  );
});

test("ConsolidationAnalyzer: estimateEffort returns breakdown for valid consolidation", () => {
  const map = buildModuleMap(makeFixtureModules());
  const analyzer = new ConsolidationAnalyzer(map);

  const suggestion = {
    cluster: ["tokens/budget", "tokens/cost-tracker", "tokens/monitor"],
    size: 3,
    modules: [
      map["tokens/budget"],
      map["tokens/cost-tracker"],
      map["tokens/monitor"],
    ],
    categories: ["tokens"],
    sameCategory: true,
    totalExports: 8,
    averageComplexity: 6.67,
    priority: 15,
  };

  const effort = analyzer.estimateEffort(suggestion);
  assert.ok(effort.total > 0, "Effort should be positive");
  assert.ok(effort.breakdown, "Effort should include breakdown");
  assert.equal(effort.breakdown.modulesAffected, 3);
  assert.ok(["high", "medium", "low", "none"].includes(effort.confidence));
});

test("ConsolidationAnalyzer: estimateEffort handles cross-category merges with penalty", () => {
  const map = buildModuleMap(makeFixtureModules());
  const analyzer = new ConsolidationAnalyzer(map);

  const suggestion = {
    cluster: ["scheduler/cron", "tokens/budget"],
    size: 2,
    modules: [map["scheduler/cron"], map["tokens/budget"]],
    categories: ["scheduler", "tokens"],
    sameCategory: false,
    totalExports: 8,
    averageComplexity: 6,
    priority: 8,
  };

  const effort = analyzer.estimateEffort(suggestion);
  assert.ok(effort.breakdown.categoryPenalty > 0, "Cross-category merge should have a penalty");
});

test("ConsolidationAnalyzer: estimateEffort rejects invalid input", () => {
  const map = buildModuleMap(makeFixtureModules());
  const analyzer = new ConsolidationAnalyzer(map);

  const result1 = analyzer.estimateEffort(null);
  assert.equal(result1.total, 0);

  const result2 = analyzer.estimateEffort({ modules: [{ slug: "single" }] });
  assert.equal(result2.total, 0);
});

test("ConsolidationAnalyzer: getConsolidationPlan returns a phased plan", () => {
  const map = buildModuleMap(makeFixtureModules());
  const analyzer = new ConsolidationAnalyzer(map, { duplicateThreshold: 0.2 });

  const plan = analyzer.getConsolidationPlan();
  assert.ok(plan.phases !== undefined);
  assert.ok(Array.isArray(plan.phases));

  if (plan.phases.length > 0) {
    const phase1 = plan.phases[0];
    assert.equal(phase1.phase, 1);
    assert.ok(typeof phase1.title === "string");
    assert.ok(Array.isArray(phase1.items));
  }
});

test("ConsolidationAnalyzer: getCategoryStats returns per-category breakdown", () => {
  const map = buildModuleMap(makeFixtureModules());
  const analyzer = new ConsolidationAnalyzer(map);

  const stats = analyzer.getCategoryStats();
  assert.ok("scheduler" in stats);
  assert.ok("tokens" in stats);
  assert.equal(stats.scheduler.count, 3);
  assert.equal(stats.tokens.count, 3);
});

test("ConsolidationAnalyzer: handle empty module map gracefully", () => {
  const map = buildModuleMap([]);
  const analyzer = new ConsolidationAnalyzer(map);

  assert.deepEqual(analyzer.findDuplicates(), []);
  assert.deepEqual(analyzer.findOverlappingAPIs(), []);
  assert.deepEqual(analyzer.suggestConsolidation(), []);

  const plan = analyzer.getConsolidationPlan();
  assert.equal(plan.phases.length, 0);
  assert.equal(plan.totalEffort, 0);
});
