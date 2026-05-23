"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CompliancePolicy,
  RULE_SEVERITY,
  ENFORCE_ACTION,
  PREBUILT_RULES,
} = require("../../src/compliance/policies");

// ---------------------------------------------------------------------------
// Helper: create a valid config
// ---------------------------------------------------------------------------

function createConfig(overrides = {}) {
  const base = {
    agent: {
      apiKey: "sk-valid-test-key",
      model: "claude-sonnet-4-20250514",
    },
    permissions: {
      mode: "normal",
    },
    tools: {
      shell: {
        timeoutMs: 30_000,
      },
    },
  };

  return deepMerge(base, overrides);
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const [key, val] of Object.entries(source)) {
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      result[key] !== null &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("CompliancePolicy: addRule registers a custom rule", () => {
  const policy = new CompliancePolicy({ rules: [] });

  const rule = {
    id: "custom-test-rule",
    description: "A test rule",
    severity: RULE_SEVERITY.MUST,
    evaluate() {
      return { passed: true };
    },
  };

  policy.addRule(rule);
  const rules = policy.getRules();

  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, "custom-test-rule");
});

test("CompliancePolicy: addRule rejects duplicates", () => {
  const policy = new CompliancePolicy({ rules: [] });

  const rule = {
    id: "unique-id",
    evaluate() {
      return { passed: true };
    },
  };

  policy.addRule(rule);
  assert.throws(
    () => policy.addRule(rule),
    /already exists/,
    "Should throw on duplicate rule id"
  );
});

test("CompliancePolicy: evaluate detects require-api-key violation", () => {
  const policy = new CompliancePolicy({ rules: [PREBUILT_RULES[0]] }); // require-api-key
  const config = {
    agent: { apiKey: undefined },
  };

  const violations = policy.evaluate(config);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].ruleId, "require-api-key");
  assert.equal(violations[0].severity, RULE_SEVERITY.MUST);
  assert.ok(violations[0].message.includes("API key"));
});

test("CompliancePolicy: evaluate passes when API key is set", () => {
  const policy = new CompliancePolicy({ rules: [PREBUILT_RULES[0]] }); // require-api-key
  const config = createConfig();

  const violations = policy.evaluate(config);

  assert.equal(violations.length, 0, "Should have no violations with valid API key");
});

test("CompliancePolicy: evaluate detects yolo without explicit flag", () => {
  const policy = new CompliancePolicy({ rules: [PREBUILT_RULES[1]] }); // disallow-yolo-without-explicit-flag
  const config = createConfig({
    permissions: { mode: "yolo" },
  });

  const violations = policy.evaluate(config);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].ruleId, "disallow-yolo-without-explicit-flag");
  assert.match(violations[0].message, /yolo/i);
});

test("CompliancePolicy: evaluate passes yolo with explicit flag", () => {
  const policy = new CompliancePolicy({ rules: [PREBUILT_RULES[1]] });
  const config = createConfig({
    permissions: { mode: "yolo", yoloExplicitOptIn: true },
  });

  const violations = policy.evaluate(config);

  assert.equal(violations.length, 0);
});

test("CompliancePolicy: evaluate enforces timeout limits", () => {
  const policy = new CompliancePolicy({ rules: [PREBUILT_RULES[4]] }); // require-timeout-limits

  // Too low
  const lowConfig = createConfig({
    tools: { shell: { timeoutMs: 500 } },
  });
  const lowViolations = policy.evaluate(lowConfig);
  assert.equal(lowViolations.length, 1);
  assert.match(lowViolations[0].message, /too low/);

  // Too high
  const highConfig = createConfig({
    tools: { shell: { timeoutMs: 600_000 } },
  });
  const highViolations = policy.evaluate(highConfig);
  assert.equal(highViolations.length, 1);
  assert.match(highViolations[0].message, /too high/);

  // Missing — build config from scratch without timeoutMs
  const missingConfig = {
    agent: { apiKey: "sk-valid-test-key", model: "claude-sonnet-4-20250514" },
    permissions: { mode: "normal" },
    tools: { shell: {} },
  };
  const missingViolations = policy.evaluate(missingConfig);
  assert.equal(missingViolations.length, 1);
  assert.match(missingViolations[0].message, /timeout configured/);
});

test("CompliancePolicy: enforce fixes MUST violations", () => {
  const policy = new CompliancePolicy({ rules: PREBUILT_RULES });

  // YOLO without flag is a MUST violation that can be auto-fixed
  const config = createConfig({
    permissions: { mode: "yolo" },
  });

  const result = policy.enforce(config);

  // Check that yolo was downgraded
  assert.equal(result.config.permissions.mode, "ask");

  // Check that fixes contain the yolo fix
  const yoloFix = result.fixes.find(
    (f) => f.ruleId === "disallow-yolo-without-explicit-flag"
  );
  assert.ok(yoloFix, "Expected a fix for yolo mode");
  assert.equal(yoloFix.action, ENFORCE_ACTION.FIX);
  assert.equal(yoloFix.applied, true);
});

test("CompliancePolicy: enforce returns warnings for SHOULD violations", () => {
  const policy = new CompliancePolicy({ rules: [PREBUILT_RULES[4]] }); // require-timeout-limits

  const config = createConfig({
    tools: { shell: { timeoutMs: 500 } },
  });

  const result = policy.enforce(config);

  // Default rule severity is SHOULD; enforce does NOT apply FIX, only WARN
  const timeoutFix = result.fixes.find(
    (f) => f.ruleId === "require-timeout-limits"
  );
  assert.ok(!timeoutFix, "SHOULD violations should not produce fixes by default");

  const timeoutWarning = result.warnings.find(
    (w) => w.ruleId === "require-timeout-limits"
  );
  assert.ok(timeoutWarning, "SHOULD violations should produce warnings");
});

test("CompliancePolicy: getViolations returns current violations", () => {
  const policy = new CompliancePolicy({ rules: [PREBUILT_RULES[0]] }); // require-api-key
  const config = { agent: {} };

  policy.evaluate(config);
  const violations = policy.getViolations();

  assert.equal(violations.length, 1);
  assert.equal(violations[0].ruleId, "require-api-key");
});

test("CompliancePolicy: removeRule removes a rule by id", () => {
  const policy = new CompliancePolicy({ rules: PREBUILT_RULES });

  const initialCount = policy.getRules().length;
  const removed = policy.removeRule("require-api-key");

  assert.equal(removed, true);
  assert.equal(policy.getRules().length, initialCount - 1);

  // Removing non-existent returns false
  const removedAgain = policy.removeRule("require-api-key");
  assert.equal(removedAgain, false);
});

test("CompliancePolicy: load with empty rules works", () => {
  const policy = new CompliancePolicy({ rules: [] });

  assert.equal(policy.getRules().length, 0);
  assert.equal(policy.getViolations().length, 0);

  const result = policy.evaluate(createConfig());
  assert.equal(result.length, 0);
});

test("CompliancePolicy: enforce with secure endpoints rule catches http URLs", () => {
  const policy = new CompliancePolicy({ rules: [PREBUILT_RULES[2]] }); // require-secure-endpoints

  const insecureConfig = createConfig({
    agent: { apiUrl: "http://api.example.com/v1" },
  });

  const violations = policy.evaluate(insecureConfig);
  assert.equal(violations.length, 1, "Should flag non-HTTPS URL");
  assert.match(violations[0].message, /HTTPS/);

  // HTTPS should be fine
  const secureConfig = createConfig({
    agent: { apiUrl: "https://api.example.com/v1" },
  });
  const secureViolations = policy.evaluate(secureConfig);
  assert.equal(secureViolations.length, 0, "HTTPS URL should pass");

  // No URL set should also be fine
  const noUrlConfig = createConfig();
  const noUrlViolations = policy.evaluate(noUrlConfig);
  assert.equal(noUrlViolations.length, 0, "No URL set should pass");
});
