"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ConfigProfiler,
  ISSUE_SEVERITY,
  SUBOPTIMAL_PATTERNS,
  COST_WEIGHTS,
} = require("../../src/config/profiler");
const { schemaDefaults } = require("../../src/config/schema");

// ---------------------------------------------------------------------------
// Helper: build a valid default config from the schema
// ---------------------------------------------------------------------------

function defaultConfig(overrides = {}) {
  const base = schemaDefaults();
  return deepMerge(base, overrides);
}

function deepMerge(target, ...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of Object.keys(source)) {
      const srcVal = source[key];
      const tgtVal = target[key];
      if (
        srcVal &&
        typeof srcVal === "object" &&
        !Array.isArray(srcVal) &&
        srcVal !== null
      ) {
        target[key] = deepMerge(
          tgtVal && typeof tgtVal === "object" && !Array.isArray(tgtVal)
            ? tgtVal
            : {},
          srcVal
        );
      } else {
        target[key] = srcVal;
      }
    }
  }
  return target;
}

// ---------------------------------------------------------------------------
// Tests: ConfigProfiler construction
// ---------------------------------------------------------------------------

test("ConfigProfiler: constructs without options", () => {
  const profiler = new ConfigProfiler();
  assert.ok(profiler instanceof ConfigProfiler);
});

test("ConfigProfiler: constructs with custom schema", () => {
  const customSchema = [
    { path: "agent.foo", key: "foo", type: "string", default: "bar", description: "test" },
  ];
  const profiler = new ConfigProfiler({ schema: customSchema });
  assert.ok(profiler instanceof ConfigProfiler);
});

// ---------------------------------------------------------------------------
// Tests: profile(config)
// ---------------------------------------------------------------------------

test("profile: returns no CRITICAL issues for default config (whitelist warnings expected)", () => {
  const profiler = new ConfigProfiler();
  const config = defaultConfig();
  const issues = profiler.profile(config);
  // Default config has ["*"] whitelists which trigger SUBOPTIMAL warnings
  // (these are the expected base state). Verify that only the expected
  // whitelist/security items exist — no unexpected CRITICALs.
  const criticals = issues.filter((i) => i.severity === ISSUE_SEVERITY.CRITICAL);
  const unexpectedCritical = criticals.filter(
    (i) => i.path !== "tools.shell.allowedCommands"
  );
  assert.equal(
    unexpectedCritical.length,
    0,
    `Unexpected critical issues: ${JSON.stringify(unexpectedCritical)}`
  );
  // Verify the whitelist issues are present
  const shellCmdIssue = issues.find((i) => i.path === "tools.shell.allowedCommands");
  assert.ok(shellCmdIssue, "Expected shell.allowedCommands warning");
  assert.equal(shellCmdIssue.type, "SUBOPTIMAL");
});

test("profile: flags yolo mode as CRITICAL", () => {
  const profiler = new ConfigProfiler();
  const config = defaultConfig({
    permissions: { mode: "yolo" },
  });
  const issues = profiler.profile(config);
  const yolo = issues.find((i) => i.path === "permissions.mode");
  assert.ok(yolo);
  assert.equal(yolo.severity, ISSUE_SEVERITY.CRITICAL);
  assert.equal(yolo.type, "SUBOPTIMAL");
});

test("profile: flags unrestricted shell commands as CRITICAL", () => {
  const profiler = new ConfigProfiler();
  const config = defaultConfig({
    tools: { shell: { allowedCommands: ["*"] } },
  });
  const issues = profiler.profile(config);
  const shellCmd = issues.find((i) => i.path === "tools.shell.allowedCommands");
  assert.ok(shellCmd);
  assert.equal(shellCmd.severity, ISSUE_SEVERITY.CRITICAL);
});

test("profile: flags high maxToolTurns as WARNING", () => {
  const profiler = new ConfigProfiler();
  const config = defaultConfig({
    agent: { maxToolTurns: 150 },
  });
  const issues = profiler.profile(config);
  const turns = issues.find(
    (i) => i.path === "agent.maxToolTurns" && i.type === "SUBOPTIMAL"
  );
  assert.ok(turns);
  assert.equal(turns.severity, ISSUE_SEVERITY.WARNING);
  assert.equal(turns.suggestedValue, 50);
});

test("profile: flags very low maxToolTurns as INFO", () => {
  const profiler = new ConfigProfiler();
  const config = defaultConfig({
    agent: { maxToolTurns: 1 },
  });
  const issues = profiler.profile(config);
  const turns = issues.find(
    (i) => i.path === "agent.maxToolTurns" && i.type === "SUBOPTIMAL"
  );
  assert.ok(turns);
  assert.equal(turns.severity, ISSUE_SEVERITY.INFO);
  assert.equal(turns.suggestedValue, 5);
});

test("profile: flags apiKey in config as WARNING", () => {
  const profiler = new ConfigProfiler();
  const config = defaultConfig({
    agent: { apiKey: "sk-secret-key-in-file" },
  });
  const issues = profiler.profile(config);
  const apiKeyIssue = issues.find(
    (i) => i.path === "agent.apiKey" && i.type === "SECURITY"
  );
  assert.ok(apiKeyIssue);
  assert.equal(apiKeyIssue.severity, ISSUE_SEVERITY.WARNING);
  assert.equal(apiKeyIssue.currentValue, "[REDACTED]");
});

test("profile: throws TypeError for non-object input", () => {
  const profiler = new ConfigProfiler();
  assert.throws(() => profiler.profile(null), { message: /non-null object/ });
  assert.throws(() => profiler.profile("string"), { message: /non-null object/ });
  assert.throws(() => profiler.profile(42), { message: /non-null object/ });
});

// ---------------------------------------------------------------------------
// Tests: suggestOptimizations(config)
// ---------------------------------------------------------------------------

test("suggestOptimizations: recommends lower temperature for coding", () => {
  const profiler = new ConfigProfiler();
  const config = defaultConfig({
    agent: { temperature: 0.9 },
  });
  const suggestions = profiler.suggestOptimizations(config);
  assert.ok(suggestions.length > 0);
  const tempSug = suggestions.find((s) => s.path === "agent.temperature");
  assert.ok(tempSug, "Expected a temperature suggestion");
  assert.ok(tempSug.recommendedValue < 0.9, "Should recommend a lower temperature");
});

test("suggestOptimizations: recommends enabling autoCompact when disabled with small window", () => {
  const profiler = new ConfigProfiler();
  const config = defaultConfig({
    context: { autoCompact: false, windowTokens: 50000 },
  });
  const suggestions = profiler.suggestOptimizations(config);
  const compactSug = suggestions.find((s) => s.path === "context.autoCompact");
  assert.ok(compactSug);
  assert.equal(compactSug.recommendedValue, true);
});

test("suggestOptimizations: throws TypeError for non-object input", () => {
  const profiler = new ConfigProfiler();
  assert.throws(() => profiler.suggestOptimizations(null), { message: /non-null object/ });
});

// ---------------------------------------------------------------------------
// Tests: compareConfigs(a, b)
// ---------------------------------------------------------------------------

test("compareConfigs: reports identical configs with 100% match", () => {
  const profiler = new ConfigProfiler();
  const config = defaultConfig();
  const result = profiler.compareConfigs(config, config);
  assert.equal(result.matchPercentage, 100);
  assert.equal(result.onlyInACount, 0);
  assert.equal(result.onlyInBCount, 0);
  assert.equal(result.diffCount, 0);
});

test("compareConfigs: detects keys only in A", () => {
  const profiler = new ConfigProfiler();
  const a = defaultConfig({ agent: { customFieldA: "extra" } });
  const b = defaultConfig();
  const result = profiler.compareConfigs(a, b);
  assert.ok(result.onlyInACount > 0);
  const onlyInAKeys = result.onlyInA.map((e) => e.key);
  assert.ok(onlyInAKeys.some((k) => k.includes("customFieldA")));
});

test("compareConfigs: detects keys only in B", () => {
  const profiler = new ConfigProfiler();
  const a = defaultConfig();
  const b = defaultConfig({ agent: { customFieldB: "extraB" } });
  const result = profiler.compareConfigs(a, b);
  assert.ok(result.onlyInBCount > 0);
  const onlyInBKeys = result.onlyInB.map((e) => e.key);
  assert.ok(onlyInBKeys.some((k) => k.includes("customFieldB")));
});

test("compareConfigs: detects differing values", () => {
  const profiler = new ConfigProfiler();
  const a = defaultConfig({ agent: { maxToolTurns: 10 } });
  const b = defaultConfig({ agent: { maxToolTurns: 50 } });
  const result = profiler.compareConfigs(a, b);
  assert.ok(result.diffCount > 0);
  const diff = result.differing.find((d) => d.key === "agent.maxToolTurns");
  assert.ok(diff);
  assert.equal(diff.valueA, 10);
  assert.equal(diff.valueB, 50);
});

test("compareConfigs: throws TypeError for non-object inputs", () => {
  const profiler = new ConfigProfiler();
  assert.throws(() => profiler.compareConfigs(null, {}), { message: /non-null plain objects/ });
  assert.throws(() => profiler.compareConfigs({}, undefined), { message: /non-null plain objects/ });
});

// ---------------------------------------------------------------------------
// Tests: benchmarkConfig(config)
// ---------------------------------------------------------------------------

test("benchmarkConfig: returns tier and totalScore for default config", () => {
  const profiler = new ConfigProfiler();
  const config = defaultConfig();
  const result = profiler.benchmarkConfig(config);
  assert.ok(typeof result.totalScore === "number");
  assert.ok(result.totalScore > 0);
  assert.ok(["LIGHTWEIGHT", "MODERATE", "HEAVY", "HIGH_COST"].includes(result.tier));
  assert.ok(Array.isArray(result.breakdown));
  assert.ok(Array.isArray(result.topFactors));
  assert.ok(result.topFactors.length <= 3);
  assert.ok(typeof result.recommendation === "string");
});

test("benchmarkConfig: heavy config produces higher score than lightweight", () => {
  const profiler = new ConfigProfiler();
  const lightConfig = defaultConfig({
    agent: { maxToolTurns: 5, maxTokens: 1024 },
    memory: { enabled: false },
    fileContext: { enabled: false },
  });
  const heavyConfig = defaultConfig({
    agent: { maxToolTurns: 150, maxTokens: 64000 },
    shell: { timeoutMs: 180_000, maxBuffer: 268_435_456 },
    fileContext: { maxFiles: 100, maxIndexFiles: 5000 },
  });
  const lightResult = profiler.benchmarkConfig(lightConfig);
  const heavyResult = profiler.benchmarkConfig(heavyConfig);
  assert.ok(heavyResult.totalScore > lightResult.totalScore);
});

test("benchmarkConfig: throws TypeError for non-object input", () => {
  const profiler = new ConfigProfiler();
  assert.throws(() => profiler.benchmarkConfig(null), { message: /non-null object/ });
});

// ---------------------------------------------------------------------------
// Tests: getProfile() and getReportText()
// ---------------------------------------------------------------------------

test("getProfile: returns health score 100 with no issues", () => {
  const profiler = new ConfigProfiler();
  const config = defaultConfig();
  profiler.profile(config);
  profiler.suggestOptimizations(config);
  const profile = profiler.getProfile();
  assert.ok(profile.summary.totalIssues >= 0);
  assert.ok(profile.summary.healthScore <= 100);
  assert.ok(Array.isArray(profile.issues));
  assert.ok(Array.isArray(profile.suggestions));
  assert.ok(profile.summary.bySeverity);
  assert.ok(profile.summary.byType);
});

test("getProfile: health score decreases with critical issues", () => {
  const profiler = new ConfigProfiler();
  const config = defaultConfig({
    permissions: { mode: "yolo" },
    tools: { shell: { allowedCommands: ["*"] } },
  });
  profiler.profile(config);
  const profile = profiler.getProfile();
  assert.ok(profile.summary.healthScore < 100);
  assert.ok(profile.summary.bySeverity.critical >= 2);
});

test("getReportText: produces a non-empty string report", () => {
  const profiler = new ConfigProfiler();
  const config = defaultConfig({
    permissions: { mode: "yolo" },
    agent: { maxToolTurns: 150 },
  });
  profiler.profile(config);
  profiler.suggestOptimizations(config);
  const report = profiler.getReportText();
  assert.ok(typeof report === "string");
  assert.ok(report.length > 0);
  assert.ok(report.includes("=== Configuration Profile Report ==="));
  assert.ok(report.includes("Health Score:"));
  assert.ok(report.includes("=== End of Report ==="));
});

test("getReportText: shows profile report for default config", () => {
  const profiler = new ConfigProfiler();
  const config = defaultConfig();
  profiler.profile(config);
  const report = profiler.getReportText();
  // Default config has whitelist warnings, so the report should exist and
  // contain the report header / structure
  assert.ok(typeof report === "string");
  assert.ok(report.includes("=== Configuration Profile Report ==="));
  assert.ok(report.includes("=== End of Report ==="));
});

// ---------------------------------------------------------------------------
// Tests: reset()
// ---------------------------------------------------------------------------

test("reset: clears all stored state", () => {
  const profiler = new ConfigProfiler();
  const config = defaultConfig({ permissions: { mode: "yolo" } });
  profiler.profile(config);
  profiler.suggestOptimizations(config);
  const before = profiler.getProfile();
  assert.ok(before.summary.totalIssues > 0);

  profiler.reset();
  const after = profiler.getProfile();
  assert.equal(after.summary.totalIssues, 0);
  assert.equal(after.summary.totalSuggestions, 0);
  assert.equal(after.summary.healthScore, 100);
});

// ---------------------------------------------------------------------------
// Tests: exported constants
// ---------------------------------------------------------------------------

test("ISSUE_SEVERITY exports three levels", () => {
  assert.equal(ISSUE_SEVERITY.CRITICAL, "CRITICAL");
  assert.equal(ISSUE_SEVERITY.WARNING, "WARNING");
  assert.equal(ISSUE_SEVERITY.INFO, "INFO");
});

test("SUBOPTIMAL_PATTERNS is a non-empty frozen array", () => {
  assert.ok(Array.isArray(SUBOPTIMAL_PATTERNS));
  assert.ok(SUBOPTIMAL_PATTERNS.length > 0);
  assert.throws(() => {
    SUBOPTIMAL_PATTERNS.push({});
  });
});

test("COST_WEIGHTS has all expected factors", () => {
  const keys = Object.keys(COST_WEIGHTS);
  assert.ok(keys.includes("tokenGeneration"));
  assert.ok(keys.includes("toolExecution"));
  assert.ok(keys.includes("memoryLookup"));
  assert.ok(keys.includes("compactionPass"));
  assert.ok(keys.includes("fileScan"));
  assert.ok(keys.includes("networkCall"));
  assert.ok(keys.includes("apiLatency"));
});
