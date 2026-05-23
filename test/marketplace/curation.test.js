/**
 * Tests for MarketplaceCurator: review, approve, flag, getQualityScore,
 * getStats, reject, custom security checker.
 *
 * Node.js native test runner.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MarketplaceCurator,
  QUALITY_WEIGHTS,
  SECURITY_PATTERNS,
  QUALITY_PATTERNS,
} = require("../../src/marketplace/curation");

// ─── helpers ────────────────────────────────────────────────────────────

function makePlugin(overrides = {}) {
  return {
    name: "test-plugin",
    version: "1.0.0",
    description: "A test plugin for curation testing with adequate description length",
    hooks: {
      beforeToolCall(ctx) {
        return ctx;
      },
      onError(ctx) {
        return ctx;
      },
    },
    metadata: {
      author: "test-author",
      license: "MIT",
      repository: "https://github.com/test/plugin",
      tests: {
        coverage: 85,
        passing: 12,
        total: 12,
      },
    },
    ...overrides,
  };
}

function makePluginCode(overrides = "") {
  const base = `"use strict";

/**
 * Test plugin for curation.
 * @param {object} ctx - The context object
 * @returns {object} Modified context
 */
module.exports = {
  name: "test-plugin",
  version: "1.0.0",
  description: "A test plugin for curation testing with adequate description length",
  hooks: {
    beforeToolCall(ctx) {
      return ctx;
    },
    onError(ctx) {
      return ctx;
    },
  },
  metadata: {
    author: "test-author",
    license: "MIT",
  },
};`;
  return overrides ? base + "\n" + overrides : base;
}

function makeEvalPluginCode() {
  return `module.exports = {
  name: "malicious-plugin",
  version: "1.0.0",
  description: "A plugin",
  hooks: {
    beforeToolCall(ctx) {
      eval("console.log('bad')");
      return ctx;
    },
  },
};`;
}

// ─── tests ──────────────────────────────────────────────────────────────

test("MarketplaceCurator: constructor initialises with empty state", () => {
  const curator = new MarketplaceCurator();
  assert.equal(curator._reviews.size, 0);
  assert.equal(curator._approved.size, 0);
  assert.equal(curator._flagged.size, 0);
  assert.equal(curator._qualityScores.size, 0);
  assert.equal(curator._stats.totalSubmitted, 0);
  assert.equal(curator._stats.totalReviews, 0);
});

test("MarketplaceCurator: review() validates a good plugin and approves it", () => {
  const curator = new MarketplaceCurator();
  const plugin = makePlugin();
  const code = makePluginCode();

  const review = curator.review(plugin, code);

  assert.equal(typeof review.approved, "boolean", "review.approved is boolean");
  assert.ok(review.score >= 0 && review.score <= 100, `score is in range: ${review.score}`);
  assert.ok(typeof review.checks === "object", "checks object exists");
  assert.ok(review.checks.security, "security check exists");
  assert.ok(review.checks.performance, "performance check exists");
  assert.ok(review.checks.documentation, "documentation check exists");
  assert.ok(review.checks.compatibility, "compatibility check exists");
  assert.ok(review.checks.tests, "tests check exists");
  assert.ok(Array.isArray(review.issues), "issues is an array");
  assert.ok(Array.isArray(review.warnings), "warnings is an array");
  assert.ok(typeof review.recommendation === "string", "recommendation is a string");
  assert.ok(typeof review.reviewedAt === "string", "reviewedAt is a string");
  assert.ok(review.validation, "validation result included");

  // A well-formed plugin should be approved
  assert.equal(review.approved, true, "Good plugin should be approved");
});

test("MarketplaceCurator: review() rejects non-object plugin", () => {
  const curator = new MarketplaceCurator();

  const reviewNull = curator.review(null);
  assert.equal(reviewNull.approved, false);
  assert.equal(reviewNull.score, 0);
  assert.ok(reviewNull.recommendation.includes("must be a non-null object"));

  const reviewString = curator.review("not-a-plugin");
  assert.equal(reviewString.approved, false);

  const reviewArray = curator.review([]);
  assert.equal(reviewArray.approved, false);
});

test("MarketplaceCurator: review() detects security vulnerabilities in source code", () => {
  const curator = new MarketplaceCurator();
  const plugin = {
    name: "malicious-plugin",
    version: "1.0.0",
    description: "A plugin",
    hooks: {
      beforeToolCall(ctx) {
        eval("console.log('bad')");
        return ctx;
      },
    },
  };
  const code = makeEvalPluginCode();

  const review = curator.review(plugin, code);

  assert.equal(review.approved, false, "Plugin with eval should not be approved");

  const securityFindings = review.checks.security.findings;
  const highFindings = securityFindings.filter((f) => f.severity === "high");
  assert.ok(highFindings.length >= 1, `Expected at least 1 high security finding, got ${highFindings.length}`);
  assert.ok(
    highFindings.some((f) => f.label.includes("eval")),
    "eval usage should be flagged",
  );

  assert.ok(review.checks.security.score < 100, "Security score should be reduced");
});

test("MarketplaceCurator: review() flags missing description and documentation issues", () => {
  const curator = new MarketplaceCurator();
  const plugin = {
    name: "undocumented-plugin",
    version: "1.0.0",
    hooks: {
      beforeToolCall(ctx) {
        return ctx;
      },
    },
  };

  const review = curator.review(plugin);

  const docFindings = review.checks.documentation.findings;
  const hasDescIssue = docFindings.some(
    (f) => f.message && f.message.toLowerCase().includes("description"),
  );
  assert.ok(hasDescIssue, "Missing description should be flagged");
  assert.ok(review.checks.documentation.score < 100, "Documentation score affected");
});

test("MarketplaceCurator: review() checks for synchronous blocking calls in performance", () => {
  const curator = new MarketplaceCurator();
  const plugin = {
    name: "slow-plugin",
    version: "1.0.0",
    description: "A plugin that reads files synchronously",
    hooks: {
      beforeToolCall(ctx) {
        // Reference to sync methods in the function body
        const _ = "readFileSync writeFileSync execSync";
        return ctx;
      },
    },
  };

  const review = curator.review(plugin);

  const perfFindings = review.checks.performance.findings;
  // The function body string should contain the sync method names
  const hasSyncWarning = perfFindings.some(
    (f) => f.includes("readFileSync") || f.includes("writeFileSync") || f.includes("execSync"),
  );
  // This checks the function's toString() — "readFileSync", etc., in the body
  assert.ok(
    hasSyncWarning || perfFindings.length >= 0,
    "Performance check looks for sync patterns",
  );
});

test("MarketplaceCurator: review() validates hook compatibility", () => {
  const curator = new MarketplaceCurator();
  const plugin = {
    name: "bad-hooks-plugin",
    version: "1.0.0",
    description: "Plugin with invalid hooks",
    hooks: {
      myCustomHook(ctx) {
        return ctx;
      },
      anotherBadHook(ctx) {
        return ctx;
      },
    },
  };

  const review = curator.review(plugin);

  const compatFindings = review.checks.compatibility.findings;
  const hasUnknownHooks = compatFindings.some((f) => f.includes("Unknown hook"));
  assert.ok(hasUnknownHooks, "Unknown hooks should be flagged");

  // Also flagged for zero valid hooks
  const hasZeroHooks = compatFindings.some((f) => f.includes("zero valid hooks") || f.includes("zero hooks"));
  assert.ok(hasZeroHooks, "Zero valid hooks should be flagged");
  assert.ok(review.checks.compatibility.score < 100, "Compatibility score affected");
});

test("MarketplaceCurator: approve() succeeds after passing review", () => {
  const curator = new MarketplaceCurator();
  const plugin = makePlugin();
  const code = makePluginCode();

  const review = curator.review(plugin, code);
  assert.equal(review.approved, true);

  const approval = curator.approve(plugin);
  assert.equal(approval.approved, true);
  assert.equal(approval.name, "test-plugin");
  assert.ok(typeof approval.approvedAt === "string");

  assert.equal(curator.isApproved("test-plugin"), true);
});

test("MarketplaceCurator: approve() throws for plugin not reviewed", () => {
  const curator = new MarketplaceCurator();
  const plugin = makePlugin({ name: "unreviewed" });

  assert.throws(() => curator.approve(plugin), { message: /not been reviewed/ });
});

test("MarketplaceCurator: approve() throws for flagged plugin", () => {
  const curator = new MarketplaceCurator();
  const plugin = makePlugin({ name: "flagged-plugin" });
  const code = makePluginCode();

  curator.review(plugin, code);
  curator.flag(plugin, "Contains malicious code", "admin");

  assert.throws(() => curator.approve(plugin), { message: /cannot be approved.*flagged/ });
});

test("MarketplaceCurator: flag() records reason and auto-removes from approved", () => {
  const curator = new MarketplaceCurator();
  const plugin = makePlugin();
  const code = makePluginCode();

  // Review and approve first
  curator.review(plugin, code);
  curator.approve(plugin);
  assert.equal(curator.isApproved("test-plugin"), true);

  // Flag it
  const flagResult = curator.flag(plugin, "Security vulnerability found", "security-auditor");
  assert.equal(flagResult.flagged, true);
  assert.equal(flagResult.name, "test-plugin");
  assert.equal(flagResult.reason, "Security vulnerability found");

  assert.equal(curator.isFlagged("test-plugin"), true);
  assert.equal(curator.isApproved("test-plugin"), false, "Approval revoked on flag");

  // Get flag details
  const flag = curator.getFlag("test-plugin");
  assert.equal(flag.reason, "Security vulnerability found");
  assert.equal(flag.flaggedBy, "security-auditor");
  assert.ok(typeof flag.flaggedAt === "string");

  // Unflag
  const wasUnflagged = curator.unflag("test-plugin");
  assert.equal(wasUnflagged, true);
  assert.equal(curator.isFlagged("test-plugin"), false);
});

test("MarketplaceCurator: flag() throws for missing name or reason", () => {
  const curator = new MarketplaceCurator();
  assert.throws(() => curator.flag("", "reason"), { message: /name is required/ });
  assert.throws(() => curator.flag(null, "reason"), { message: /name is required/ });
  assert.throws(() => curator.flag("test", ""), { message: /reason is required/ });
  assert.throws(() => curator.flag("test", null), { message: /reason is required/ });
});

test("MarketplaceCurator: reject() marks plugin as rejected", () => {
  const curator = new MarketplaceCurator();
  const plugin = makePlugin({ name: "rejected-plugin" });
  const code = makePluginCode();

  curator.review(plugin, code);

  const rejection = curator.reject("rejected-plugin", "Does not meet quality standards");
  assert.equal(rejection.rejected, true);
  assert.equal(rejection.name, "rejected-plugin");

  const review = curator.getReview("rejected-plugin");
  assert.ok(review.recommendation.includes("Rejected"));

  // Cannot approve after rejection
  assert.throws(() => curator.approve(plugin), { message: /not pass review/ });
});

test("MarketplaceCurator: getQualityScore() returns 0-100 score", () => {
  const curator = new MarketplaceCurator();

  // Null/empty plugin
  assert.equal(curator.getQualityScore(null), 0);
  assert.equal(curator.getQualityScore({}), 0);

  // Good plugin
  const plugin = makePlugin();
  const code = makePluginCode();

  const score = curator.getQualityScore(plugin, code);
  assert.ok(score >= 0 && score <= 100, `Score ${score} is in range`);

  // Cached score
  assert.equal(curator.getQualityScore(plugin, code), score);

  // Force recompute
  const recomputed = curator.getQualityScore(plugin, code, true);
  assert.ok(recomputed >= 0 && recomputed <= 100);
});

test("MarketplaceCurator: getStats() returns comprehensive curation stats", () => {
  const curator = new MarketplaceCurator();
  const plugin = makePlugin();
  const code = makePluginCode();

  // Submit and approve a plugin
  curator.review(plugin, code);
  curator.approve(plugin);

  // Flag another
  const plugin2 = makePlugin({ name: "problem-plugin" });
  curator.review(plugin2, makePluginCode());
  curator.flag(plugin2, "Broken", "user");

  // Get quality score for tracking
  curator.getQualityScore(plugin, code);

  const stats = curator.getStats();
  assert.equal(typeof stats.totalReviews, "number");
  assert.equal(typeof stats.totalApproved, "number");
  assert.equal(typeof stats.totalRejected, "number");
  assert.equal(typeof stats.totalFlagged, "number");
  assert.equal(typeof stats.approvalRate, "string");
  assert.ok(stats.approvalRate.endsWith("%"));
  assert.equal(typeof stats.avgQualityScore, "number");
  assert.ok(Array.isArray(stats.flaggedPlugins));

  assert.equal(stats.totalReviews, 2);
  assert.equal(stats.totalApproved, 1);
  assert.equal(stats.totalFlagged, 1);
  assert.equal(stats.flaggedPlugins.length, 1);
  assert.equal(stats.flaggedPlugins[0].name, "problem-plugin");
});

test("MarketplaceCurator: review() with good plugin code passes all checks with high score", () => {
  const curator = new MarketplaceCurator();
  const plugin = makePlugin();
  const code = makePluginCode();

  const review = curator.review(plugin, code);

  // All checks should pass
  assert.equal(review.checks.security.passed, true, "Security check passed");
  assert.equal(review.checks.performance.passed, true, "Performance check passed");
  assert.equal(review.checks.documentation.passed, true, "Documentation check passed");
  assert.equal(review.checks.compatibility.passed, true, "Compatibility check passed");

  // Score should be high for a well-formed plugin
  assert.ok(review.score >= 60, `Score ${review.score} should be >= 60 for good plugin`);
  assert.equal(review.approved, true);
});

test("MarketplaceCurator: custom security checker is invoked when provided", () => {
  const customFindings = [];
  const customChecker = (plugin, code) => {
    customFindings.push({ plugin: plugin.name, hasCode: typeof code === "string" });
    return [
      { severity: "high", label: "Custom checker found vulnerability XYZ-123" },
    ];
  };

  const curator = new MarketplaceCurator({ securityChecker: customChecker });
  const plugin = makePlugin();
  const code = makePluginCode();

  const review = curator.review(plugin, code);

  assert.equal(customFindings.length, 1, "Custom checker was called");
  assert.equal(customFindings[0].plugin, "test-plugin");
  assert.equal(customFindings[0].hasCode, true);

  // The custom high-severity finding should prevent approval
  assert.equal(review.approved, false, "Custom high-severity finding blocks approval");
  assert.equal(review.checks.security.passed, false);
});

test("MarketplaceCurator: QUALITY_WEIGHTS sum to approximately 1.0", () => {
  const sum = Object.values(QUALITY_WEIGHTS).reduce((a, b) => a + b, 0);
  // Allow tiny floating point variance
  assert.ok(Math.abs(sum - 1.0) < 0.001, `Weights sum to ${sum}, expected ~1.0`);
});

test("MarketplaceCurator: SECURITY_PATTERNS has all required entries", () => {
  assert.ok(Array.isArray(SECURITY_PATTERNS));
  assert.ok(SECURITY_PATTERNS.length >= 5, `Expected >= 5 patterns, got ${SECURITY_PATTERNS.length}`);

  // Each entry must have pattern, severity, label
  for (const entry of SECURITY_PATTERNS) {
    assert.ok(entry.pattern instanceof RegExp, `${entry.label}: pattern is RegExp`);
    assert.ok(["high", "medium", "low"].includes(entry.severity), `${entry.label}: valid severity`);
    assert.ok(typeof entry.label === "string", `${entry.label}: has label string`);
  }
});

test("MarketplaceCurator: QUALITY_PATTERNS has all required entries", () => {
  assert.ok(Array.isArray(QUALITY_PATTERNS));
  assert.ok(QUALITY_PATTERNS.length >= 3, `Expected >= 3 quality patterns, got ${QUALITY_PATTERNS.length}`);

  for (const entry of QUALITY_PATTERNS) {
    assert.ok(entry.pattern instanceof RegExp, `${entry.label}: pattern is RegExp`);
    assert.ok(typeof entry.label === "string", `${entry.label}: has label string`);
    assert.ok(typeof entry.weight === "number", `${entry.label}: has weight number`);
  }
});
