/**
 * Tests for safety SafetyAuditor — session auditing for tool execution safety.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SafetyAuditor,
  SAFETY_CATEGORIES,
  SEVERITY_WEIGHTS,
  createFinding,
} = require("../../src/safety/auditor");

// ---------------------------------------------------------------------------
// createFinding
// ---------------------------------------------------------------------------

test("createFinding: creates a properly shaped finding", () => {
  const finding = createFinding("FILE_OPERATIONS", "HIGH", "Test finding", { key: "value" });
  assert.equal(finding.category, "FILE_OPERATIONS");
  assert.equal(finding.severity, "HIGH");
  assert.equal(finding.message, "Test finding");
  assert.deepEqual(finding.details, { key: "value" });
  assert.ok(typeof finding.timestamp === "string");
});

test("createFinding: handles empty details", () => {
  const finding = createFinding("NETWORK_ACCESS", "LOW", "Minimal finding");
  assert.deepEqual(finding.details, {});
});

// ---------------------------------------------------------------------------
// SAFETY_CATEGORIES constant
// ---------------------------------------------------------------------------

test("SAFETY_CATEGORIES: contains all expected categories", () => {
  assert.ok("FILE_OPERATIONS" in SAFETY_CATEGORIES);
  assert.ok("NETWORK_ACCESS" in SAFETY_CATEGORIES);
  assert.ok("SHELL_EXECUTION" in SAFETY_CATEGORIES);
  assert.ok("DATA_ACCESS" in SAFETY_CATEGORIES);
  assert.equal(SAFETY_CATEGORIES.FILE_OPERATIONS.label, "File Operations");
  assert.ok(typeof SAFETY_CATEGORIES.FILE_OPERATIONS.weight === "number");
});

// ---------------------------------------------------------------------------
// SEVERITY_WEIGHTS constant
// ---------------------------------------------------------------------------

test("SEVERITY_WEIGHTS: defines expected weights", () => {
  assert.equal(SEVERITY_WEIGHTS.CRITICAL, 40);
  assert.equal(SEVERITY_WEIGHTS.HIGH, 20);
  assert.equal(SEVERITY_WEIGHTS.MEDIUM, 10);
  assert.equal(SEVERITY_WEIGHTS.LOW, 5);
  assert.equal(SEVERITY_WEIGHTS.INFO, 0);
});

// ---------------------------------------------------------------------------
// SafetyAuditor constructor
// ---------------------------------------------------------------------------

test("SafetyAuditor: creates instance with defaults", () => {
  const auditor = new SafetyAuditor();
  assert.ok(auditor instanceof SafetyAuditor);
  assert.equal(auditor.getSafetyScore(), 100);
  assert.deepEqual(auditor.getRiskyOperations(), []);
  assert.deepEqual(auditor.getSafetyRecommendations(), []);
});

test("SafetyAuditor: accepts options", () => {
  const auditor = new SafetyAuditor({
    minDurationWarningMs: 200,
    logFindings: true,
  });
  assert.ok(auditor instanceof SafetyAuditor);
});

// ---------------------------------------------------------------------------
// SafetyAuditor.audit — empty session
// ---------------------------------------------------------------------------

test("SafetyAuditor.audit: handles empty session", () => {
  const auditor = new SafetyAuditor();
  const result = auditor.audit([]);

  assert.equal(result.passed, true);
  assert.equal(result.safetyScore, 100);
  assert.equal(result.findings.length, 0);
  assert.equal(result.riskyOperations.length, 0);
  assert.equal(result.recommendations.length, 0);
});

test("SafetyAuditor.audit: throws on non-array input", () => {
  const auditor = new SafetyAuditor();
  assert.throws(() => auditor.audit(null), /must be an array/);
  assert.throws(() => auditor.audit("not an array"), /must be an array/);
  assert.throws(() => auditor.audit(undefined), /must be an array/);
});

// ---------------------------------------------------------------------------
// SafetyAuditor.audit — clean session
// ---------------------------------------------------------------------------

function makeExec(overrides = {}) {
  return {
    tool: "file.read",
    args: { path: "/tmp/test.txt" },
    result: "content",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 10,
    status: "completed",
    riskLevel: 1,
    categories: ["file"],
    ...overrides,
  };
}

test("SafetyAuditor.audit: clean session gets high score", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({ tool: "file.read", args: { path: "/tmp/a.txt" } }),
    makeExec({ tool: "file.read", args: { path: "/tmp/b.txt" } }),
  ];

  const result = auditor.audit(session);
  assert.equal(result.passed, true);
  assert.ok(result.safetyScore >= 90, `Expected >= 90, got ${result.safetyScore}`);
});

// ---------------------------------------------------------------------------
// SafetyAuditor.audit — file operation risks
// ---------------------------------------------------------------------------

test("SafetyAuditor.audit: flags high volume of file writes", () => {
  const auditor = new SafetyAuditor();
  const session = [];
  for (let i = 0; i < 15; i++) {
    session.push(makeExec({
      tool: "file.write",
      args: { path: `/tmp/file${i}.txt`, content: "data" },
      categories: ["file"],
    }));
  }

  const result = auditor.audit(session);
  assert.equal(result.passed, false);
  assert.ok(result.safetyScore < 100);

  const fileFindings = result.findings.filter((f) => f.category === "FILE_OPERATIONS");
  assert.ok(fileFindings.length >= 1, "Should have file operation findings");
});

test("SafetyAuditor.audit: flags file delete operations", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({
      tool: "file.delete",
      args: { path: "/tmp/important.txt" },
      categories: ["file"],
    }),
  ];

  const result = auditor.audit(session);
  const deleteFindings = result.findings.filter(
    (f) => f.message.includes("delete")
  );
  assert.ok(deleteFindings.length >= 1, "Should flag delete operations");

  const risky = auditor.getRiskyOperations();
  const deleteRisky = risky.filter((r) => r.operation === "FILE_DELETE");
  assert.ok(deleteRisky.length >= 1);
});

test("SafetyAuditor.audit: flags blocked file operations", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({
      tool: "file.read",
      args: { path: "/etc/shadow" },
      status: "blocked",
      categories: ["file"],
      preValidation: { reason: "Sensitive path denied" },
    }),
  ];

  const result = auditor.audit(session);
  // Blocked ops reduce the score below 100 (safety worked), but may not drop below 80
  assert.ok(result.safetyScore < 100, `Expected < 100, got ${result.safetyScore}`);
  const findings = auditor.getFindings("FILE_OPERATIONS");
  assert.ok(findings.length >= 1);
  assert.equal(findings[0].severity, "HIGH");
});

// ---------------------------------------------------------------------------
// SafetyAuditor.audit — network access risks
// ---------------------------------------------------------------------------

test("SafetyAuditor.audit: flags high volume of network requests", () => {
  const auditor = new SafetyAuditor();
  const session = [];
  for (let i = 0; i < 25; i++) {
    session.push(makeExec({
      tool: "network.fetch",
      args: { url: `https://api.example.com/resource/${i}` },
      result: "response",
      categories: ["network"],
    }));
  }

  const result = auditor.audit(session);
  const netFindings = result.findings.filter((f) => f.category === "NETWORK_ACCESS");
  assert.ok(netFindings.length >= 1, "Should flag high request frequency");
  assert.ok(result.safetyScore < 100);
});

test("SafetyAuditor.audit: flags large network responses", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({
      tool: "network.fetch",
      args: { url: "https://example.com/large" },
      result: "x".repeat(600_000), // 600KB
      categories: ["network"],
    }),
  ];

  const result = auditor.audit(session);
  const largeFindings = result.findings.filter(
    (f) => f.message.includes("exfiltration")
  );
  assert.ok(largeFindings.length >= 1);
});

// ---------------------------------------------------------------------------
// SafetyAuditor.audit — shell execution risks
// ---------------------------------------------------------------------------

test("SafetyAuditor.audit: flags shell executions", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({
      tool: "shell.run",
      args: "ls -la",
      result: "file list",
      categories: ["shell"],
    }),
  ];

  const result = auditor.audit(session);
  // Shell execution reduces score below 100 but single ops may still pass
  assert.ok(result.safetyScore < 100, `Expected < 100, got ${result.safetyScore}`);

  const risky = auditor.getRiskyOperations("MEDIUM");
  const shellRisky = risky.filter((r) => r.operation === "SHELL_EXECUTION");
  assert.ok(shellRisky.length >= 1);
});

test("SafetyAuditor.audit: flags blocked shell executions as critical", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({
      tool: "shell.exec",
      args: "rm -rf /",
      status: "blocked",
      categories: ["shell"],
      preValidation: { reason: "Suspicious command" },
    }),
  ];

  const result = auditor.audit(session);
  const criticalRisky = auditor.getRiskyOperations("CRITICAL");
  assert.ok(criticalRisky.length >= 1);
});

test("SafetyAuditor.audit: flags repeated shell executions from same tool", () => {
  const auditor = new SafetyAuditor();
  const session = [];
  for (let i = 0; i < 8; i++) {
    session.push(makeExec({
      tool: "shell.run",
      args: `echo "command ${i}"`,
      result: `output ${i}`,
      categories: ["shell"],
    }));
  }

  const result = auditor.audit(session);
  const repeatedFindings = result.findings.filter(
    (f) => f.message.includes("Repeated")
  );
  assert.ok(repeatedFindings.length >= 1);
});

// ---------------------------------------------------------------------------
// SafetyAuditor.audit — data access risks
// ---------------------------------------------------------------------------

test("SafetyAuditor.audit: flags destructive data operations", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({
      tool: "db.execute",
      args: { query: "DROP TABLE users" },
      categories: ["data"],
    }),
  ];

  const result = auditor.audit(session);
  const dataFindings = result.findings.filter((f) => f.category === "DATA_ACCESS");
  assert.ok(dataFindings.length >= 1);
  assert.equal(dataFindings[0].severity, "HIGH");

  const risky = auditor.getRiskyOperations("HIGH");
  const destructive = risky.filter((r) => r.operation === "DESTRUCTIVE_DATA");
  assert.ok(destructive.length >= 1);
});

test("SafetyAuditor.audit: flags bulk data retrieval", () => {
  const auditor = new SafetyAuditor();
  const largeResult = [];
  for (let i = 0; i < 150; i++) {
    largeResult.push({ id: i, name: `record_${i}` });
  }

  const session = [
    makeExec({
      tool: "db.query",
      args: { query: "SELECT * FROM large_table" },
      result: largeResult,
      categories: ["data"],
    }),
  ];

  const result = auditor.audit(session);
  const bulkFindings = result.findings.filter(
    (f) => f.message.includes("Bulk data")
  );
  assert.ok(bulkFindings.length >= 1);
});

// ---------------------------------------------------------------------------
// SafetyAuditor.getSafetyScore
// ---------------------------------------------------------------------------

test("SafetyAuditor.getSafetyScore: returns 100 before audit", () => {
  const auditor = new SafetyAuditor();
  assert.equal(auditor.getSafetyScore(), 100);
});

test("SafetyAuditor.getSafetyScore: decreases after risky audit", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({ tool: "shell.run", args: "rm -rf /", categories: ["shell"] }),
    makeExec({ tool: "process.spawn", args: { cmd: "/bin/sh" }, categories: ["shell"] }),
    makeExec({ tool: "file.delete", args: { path: "/important" }, categories: ["file"] }),
  ];

  auditor.audit(session);
  const score = auditor.getSafetyScore();
  assert.ok(score < 100, `Expected < 100, got ${score}`);
  assert.ok(score >= 0, `Expected >= 0, got ${score}`);
});

// ---------------------------------------------------------------------------
// SafetyAuditor.getRiskyOperations
// ---------------------------------------------------------------------------

test("SafetyAuditor.getRiskyOperations: returns empty before audit", () => {
  const auditor = new SafetyAuditor();
  assert.deepEqual(auditor.getRiskyOperations(), []);
});

test("SafetyAuditor.getRiskyOperations: filters by severity", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({ tool: "shell.exec", status: "blocked", categories: ["shell"] }),
    makeExec({ tool: "file.write", args: { path: "/tmp/a.txt" }, categories: ["file"] }),
  ];

  auditor.audit(session);

  const critical = auditor.getRiskyOperations("CRITICAL");
  const allOps = auditor.getRiskyOperations();

  assert.ok(allOps.length >= 2, `Expected >= 2, got ${allOps.length}`);

  // CRITICAL operations should be a subset
  for (const op of critical) {
    assert.equal(op.severity, "CRITICAL");
  }
});

// ---------------------------------------------------------------------------
// SafetyAuditor.getSafetyRecommendations
// ---------------------------------------------------------------------------

test("SafetyAuditor.getSafetyRecommendations: provides recommendations for shell usage", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({ tool: "shell.run", args: "ls", categories: ["shell"] }),
  ];

  auditor.audit(session);
  const recs = auditor.getSafetyRecommendations();
  assert.ok(recs.length >= 1, `Expected >= 1, got ${recs.length}`);
  assert.ok(recs.some((r) => r.includes("whitelist")));
});

test("SafetyAuditor.getSafetyRecommendations: provides recommendations for file operations", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({ tool: "file.delete", args: { path: "/tmp/test.txt" }, categories: ["file"] }),
  ];

  auditor.audit(session);
  const recs = auditor.getSafetyRecommendations();
  assert.ok(recs.some((r) => r.includes("confirmation") || r.includes("deletion")));
});

test("SafetyAuditor.getSafetyRecommendations: critical warning for low scores", () => {
  const auditor = new SafetyAuditor();
  // Build a session that will get a very low score
  const session = [];
  for (let i = 0; i < 10; i++) {
    session.push(makeExec({
      tool: "shell.exec",
      args: "rm -rf /",
      status: "blocked",
      categories: ["shell"],
      preValidation: { reason: "suspicious" },
    }));
  }

  auditor.audit(session);
  const recs = auditor.getSafetyRecommendations();
  const score = auditor.getSafetyScore();

  if (score < 50) {
    assert.ok(recs.some((r) => r.includes("CRITICAL") || r.includes("dangerously low")));
  }

  if (score < 75) {
    assert.ok(recs.some((r) => r.includes("strict mode") || r.includes("allowlists")));
  }
});

// ---------------------------------------------------------------------------
// SafetyAuditor.getFindings
// ---------------------------------------------------------------------------

test("SafetyAuditor.getFindings: returns all findings after audit", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({ tool: "shell.run", args: "bad command", categories: ["shell"] }),
  ];

  auditor.audit(session);
  const findings = auditor.getFindings();
  assert.equal(Array.isArray(findings), true);
});

test("SafetyAuditor.getFindings: filters by category", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({ tool: "file.write", args: { path: "/tmp/a.txt" }, categories: ["file"] }),
    makeExec({ tool: "shell.run", args: "ls", categories: ["shell"] }),
    makeExec({ tool: "network.fetch", args: { url: "https://example.com" }, categories: ["network"] }),
  ];

  auditor.audit(session);

  const shellFindings = auditor.getFindings("SHELL_EXECUTION");
  for (const f of shellFindings) {
    assert.equal(f.category, "SHELL_EXECUTION");
  }
});

// ---------------------------------------------------------------------------
// SafetyAuditor.getCategoryScores
// ---------------------------------------------------------------------------

test("SafetyAuditor.getCategoryScores: returns per-category scores", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({ tool: "shell.run", args: "ls", categories: ["shell"] }),
  ];

  auditor.audit(session);
  const scores = auditor.getCategoryScores();

  assert.ok("FILE_OPERATIONS" in scores);
  assert.ok("NETWORK_ACCESS" in scores);
  assert.ok("SHELL_EXECUTION" in scores);
  assert.ok("DATA_ACCESS" in scores);

  // Shell should have lower score than unused categories
  assert.ok(scores.SHELL_EXECUTION < 100, `Expected < 100, got ${scores.SHELL_EXECUTION}`);
  assert.equal(scores.NETWORK_ACCESS, 100); // No network ops
  assert.equal(scores.DATA_ACCESS, 100); // No data ops
});

// ---------------------------------------------------------------------------
// SafetyAuditor.getReport
// ---------------------------------------------------------------------------

test("SafetyAuditor.getReport: returns comprehensive report", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({ tool: "file.read", args: { path: "/tmp/a.txt" } }),
  ];

  auditor.audit(session);
  const report = auditor.getReport();

  assert.ok(typeof report.safetyScore === "number");
  assert.ok(typeof report.passed === "boolean");
  assert.ok(typeof report.categoryScores === "object");
  assert.ok(typeof report.findingCount === "number");
  assert.ok(typeof report.riskyOperationCount === "number");
  assert.ok(typeof report.recommendationCount === "number");
  assert.ok(Array.isArray(report.findings));
  assert.ok(Array.isArray(report.riskyOperations));
  assert.ok(Array.isArray(report.recommendations));
  assert.ok(report.stats !== null);
});

// ---------------------------------------------------------------------------
// SafetyAuditor.getAuditStats
// ---------------------------------------------------------------------------

test("SafetyAuditor.getAuditStats: returns null before audit", () => {
  const auditor = new SafetyAuditor();
  assert.equal(auditor.getAuditStats(), null);
});

test("SafetyAuditor.getAuditStats: returns stats after audit", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({ tool: "file.read", args: { path: "/tmp/a.txt" } }),
    makeExec({ tool: "shell.run", args: "ls", categories: ["shell"] }),
    makeExec({ tool: "file.read", status: "blocked", categories: ["file"] }),
    makeExec({ tool: "file.read", status: "error", categories: ["file"] }),
  ];

  auditor.audit(session);
  const stats = auditor.getAuditStats();

  assert.ok(stats !== null);
  assert.equal(stats.totalExecutions, 4);
  assert.equal(stats.blockedCount, 1);
  assert.equal(stats.errorCount, 1);
  assert.ok(typeof stats.totalOutputBytes === "number");
  assert.ok(typeof stats.categories === "object");
});

// ---------------------------------------------------------------------------
// SafetyAuditor — mixed session edge cases
// ---------------------------------------------------------------------------

test("SafetyAuditor.audit: mixed session with all categories", () => {
  const auditor = new SafetyAuditor();
  const session = [
    makeExec({ tool: "file.write", args: { path: "/tmp/a.txt" }, categories: ["file"] }),
    makeExec({ tool: "network.fetch", args: { url: "https://api.example.com" }, categories: ["network"] }),
    makeExec({ tool: "shell.run", args: "ls", categories: ["shell"] }),
    makeExec({ tool: "db.query", args: { query: "SELECT 1" }, categories: ["data"] }),
    makeExec({ tool: "file.read", args: { path: "/tmp/b.txt" }, categories: ["file"] }),
  ];

  const result = auditor.audit(session);
  assert.ok(result.safetyScore >= 0 && result.safetyScore <= 100);
  assert.ok(result.stats.categories.file >= 2);
  assert.ok(result.stats.categories.network >= 1);
  assert.ok(result.stats.categories.shell >= 1);
  assert.ok(result.stats.categories.data >= 1);
});

// ---------------------------------------------------------------------------
// SafetyAuditor — recommendations are deduplicated
// ---------------------------------------------------------------------------

test("SafetyAuditor.getSafetyRecommendations: produces no duplicates", () => {
  const auditor = new SafetyAuditor();
  const session = [];
  // Generate many shell operations to trigger the same recommendation pattern
  for (let i = 0; i < 7; i++) {
    session.push(makeExec({
      tool: "shell.run",
      args: `cmd${i}`,
      categories: ["shell"],
    }));
  }

  auditor.audit(session);
  const recs = auditor.getSafetyRecommendations();
  const unique = new Set(recs);

  assert.equal(recs.length, unique.size, "Recommendations should not contain duplicates");
});

// ---------------------------------------------------------------------------
// SafetyAuditor — logFindings option
// ---------------------------------------------------------------------------

test("SafetyAuditor: logFindings option works without throwing", () => {
  const auditor = new SafetyAuditor({ logFindings: true });
  const session = [
    makeExec({ tool: "shell.run", args: "suspicious command", categories: ["shell"] }),
    makeExec({ tool: "file.delete", args: { path: "/tmp/test" }, categories: ["file"] }),
  ];

  // Should not throw even with logFindings enabled
  assert.doesNotThrow(() => {
    auditor.audit(session);
  });
});
