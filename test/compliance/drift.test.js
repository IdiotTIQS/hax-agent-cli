"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DriftDetector,
  DRIFT_TYPES,
  SEVERITY,
} = require("../../src/compliance/drift");

// ---------------------------------------------------------------------------
// Sample configs for testing
// ---------------------------------------------------------------------------

const BASELINE_CONFIG = Object.freeze({
  agent: {
    name: "hax-agent",
    model: "claude-sonnet-4-20250514",
    apiKey: undefined,
    apiUrl: undefined,
    maxTurns: 20,
    temperature: 0.2,
  },
  permissions: {
    mode: "normal",
  },
  tools: {
    shell: {
      enabled: true,
      timeoutMs: 10_000,
      maxBuffer: 52_428_800,
    },
  },
  ui: {
    theme: "dark",
    locale: "en",
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("DriftDetector: detects MISSING_KEY drift", () => {
  const detector = new DriftDetector();
  const current = {
    agent: { model: "claude-sonnet-4-20250514" },
  };
  const baseline = {
    agent: { model: "claude-sonnet-4-20250514", name: "hax-agent" },
  };

  const drifts = detector.detect(current, baseline);
  const missing = drifts.filter((d) => d.type === DRIFT_TYPES.MISSING_KEY);

  assert.ok(missing.length > 0, "Expected at least one MISSING_KEY drift");
  assert.equal(missing[0].key, "agent.name");
  assert.equal(missing[0].baselineValue, "hax-agent");
  assert.equal(missing[0].currentValue, undefined);
});

test("DriftDetector: detects EXTRA_KEY drift", () => {
  const detector = new DriftDetector();
  const current = {
    agent: { model: "claude-sonnet-4-20250514", legacyField: true },
  };
  const baseline = {
    agent: { model: "claude-sonnet-4-20250514" },
  };

  const drifts = detector.detect(current, baseline);
  const extra = drifts.filter((d) => d.type === DRIFT_TYPES.EXTRA_KEY);

  assert.ok(extra.length > 0, "Expected at least one EXTRA_KEY drift");
  assert.equal(extra[0].key, "agent.legacyField");
  assert.equal(extra[0].currentValue, true);
  assert.equal(extra[0].baselineValue, undefined);
});

test("DriftDetector: detects VALUE_CHANGED drift", () => {
  const detector = new DriftDetector();
  const current = {
    agent: { temperature: 0.9 },
  };
  const baseline = {
    agent: { temperature: 0.2 },
  };

  const drifts = detector.detect(current, baseline);
  const changed = drifts.filter((d) => d.type === DRIFT_TYPES.VALUE_CHANGED);

  assert.ok(changed.length > 0, "Expected VALUE_CHANGED drift");
  assert.equal(changed[0].key, "agent.temperature");
  assert.equal(changed[0].currentValue, 0.9);
  assert.equal(changed[0].baselineValue, 0.2);
});

test("DriftDetector: detects TYPE_CHANGED drift", () => {
  const detector = new DriftDetector();
  const current = {
    tools: { shell: { timeoutMs: "10000" } },
  };
  const baseline = {
    tools: { shell: { timeoutMs: 10_000 } },
  };

  const drifts = detector.detect(current, baseline);
  const typeChanged = drifts.filter((d) => d.type === DRIFT_TYPES.TYPE_CHANGED);

  assert.ok(typeChanged.length > 0, "Expected TYPE_CHANGED drift");
  assert.equal(typeChanged[0].key, "tools.shell.timeoutMs");
  assert.equal(typeChanged[0].currentType, "string");
  assert.equal(typeChanged[0].baselineType, "number");
});

test("DriftDetector: detects INSECURE drift (YOLO mode)", () => {
  const detector = new DriftDetector();
  const current = {
    permissions: { mode: "yolo" },
  };
  const baseline = {
    permissions: { mode: "normal" },
  };

  const drifts = detector.detect(current, baseline);
  const insecure = drifts.filter((d) => d.type === DRIFT_TYPES.INSECURE);

  assert.ok(
    insecure.length > 0,
    "Expected INSECURE drift for yolo permissions mode"
  );
  assert.equal(insecure[0].key, "permissions.mode");
  assert.equal(insecure[0].severity, SEVERITY.CRITICAL);
  assert.ok(
    typeof insecure[0].reason === "string",
    "INSECURE drift should have a reason string"
  );
});

test("DriftDetector: detects INSECURE drift (API key in config)", () => {
  const detector = new DriftDetector();
  const current = {
    agent: { apiKey: "sk-exposed-key-in-config" },
  };
  const baseline = {
    agent: { apiKey: undefined },
  };

  const drifts = detector.detect(current, baseline);
  const insecure = drifts.filter((d) => d.type === DRIFT_TYPES.INSECURE);

  assert.ok(
    insecure.length > 0,
    "Expected INSECURE drift for API key in config"
  );
  assert.equal(insecure[0].key, "agent.apiKey");
  assert.equal(insecure[0].severity, SEVERITY.CRITICAL);
  assert.match(insecure[0].reason, /environment variable/i);
});

test("DriftDetector: categorizes drifts with correct severity", () => {
  const detector = new DriftDetector();

  const drifts = [
    { type: DRIFT_TYPES.INSECURE, key: "permissions.mode" },
    { type: DRIFT_TYPES.TYPE_CHANGED, key: "tools.shell.timeoutMs" },
    { type: DRIFT_TYPES.DEPRECATED, key: "agent.maxTurns" },
    { type: DRIFT_TYPES.MISSING_KEY, key: "ui.locale" },
    { type: DRIFT_TYPES.EXTRA_KEY, key: "custom.unknown" },
    { type: DRIFT_TYPES.VALUE_CHANGED, key: "agent.temperature" },
  ];

  const categorized = detector.categorize(drifts);

  assert.equal(
    categorized[0].severity,
    SEVERITY.CRITICAL,
    "INSECURE should be CRITICAL"
  );
  assert.equal(
    categorized[1].severity,
    SEVERITY.CRITICAL,
    "TYPE_CHANGED should be CRITICAL"
  );
  assert.equal(
    categorized[2].severity,
    SEVERITY.WARNING,
    "DEPRECATED should be WARNING"
  );
  assert.equal(
    categorized[3].severity,
    SEVERITY.INFO,
    "MISSING_KEY for non-critical key should be INFO"
  );
  assert.equal(
    categorized[4].severity,
    SEVERITY.INFO,
    "EXTRA_KEY should be INFO"
  );
  assert.equal(
    categorized[5].severity,
    SEVERITY.WARNING,
    "VALUE_CHANGED should be WARNING"
  );
});

test("DriftDetector: getDriftSummary produces readable report", () => {
  const detector = new DriftDetector();

  const current = {
    permissions: { mode: "yolo" },
    ui: { theme: "light" },
  };
  const baseline = {
    permissions: { mode: "normal" },
    ui: { theme: "dark", locale: "en" },
  };

  detector.detect(current, baseline);
  const summary = detector.getDriftSummary();

  assert.ok(summary.includes("Configuration Drift Report"));
  assert.ok(summary.includes("CRITICAL"));
  assert.ok(summary.includes("permissions.mode"));
  assert.ok(summary.includes("End of Report"));
});

test("DriftDetector: autoCorrect handles info-level drifts only", () => {
  const detector = new DriftDetector();

  const current = {
    agent: { model: "claude-sonnet-4-20250514" },
  };
  const baseline = {
    agent: { model: "claude-sonnet-4-20250514", name: "hax-agent" },
    ui: { locale: "en" },
  };

  detector.detect(current, baseline);
  const corrected = detector.autoCorrect();

  // MISSING_KEY for non-critical keys are INFO — should be auto-corrected
  assert.ok(corrected.length > 0, "Expected at least one auto-correction");
  for (const c of corrected) {
    assert.equal(c.action === "restore" || c.action === "remove", true);
  }
});

test("DriftDetector: requiresApproval returns critical and warning drifts", () => {
  const detector = new DriftDetector();

  const current = {
    permissions: { mode: "yolo" },
    tools: { shell: { timeoutMs: 500 } },
    ui: { locale: "en" },
  };
  const baseline = {
    permissions: { mode: "normal" },
    tools: { shell: { timeoutMs: 10_000 } },
    ui: { locale: "en", newFeature: true },
  };

  detector.detect(current, baseline);
  const needsApproval = detector.requiresApproval();

  // permissions.mode value change = CRITICAL, tools.shell.timeoutMs value change = WARNING
  assert.ok(needsApproval.length > 0, "Expected drifts needing approval");
  for (const d of needsApproval) {
    assert.ok(
      d.severity === SEVERITY.CRITICAL || d.severity === SEVERITY.WARNING,
      `Drift severity ${d.severity} should require approval`
    );
  }
});

test("DriftDetector: no drift for identical configs", () => {
  const detector = new DriftDetector();
  const config = {
    agent: { model: "claude-sonnet-4-20250514" },
    ui: { theme: "dark" },
  };

  const drifts = detector.detect(config, config);
  assert.equal(drifts.length, 0, "Identical configs should produce zero drift");
  assert.ok(
    detector.getDriftSummary().includes("No configuration drift detected")
  );
});

test("DriftDetector: setBaseline updates baseline reference", () => {
  const detector = new DriftDetector();
  const newBaseline = {
    agent: { model: "claude-opus-4-20250514" },
  };
  detector.setBaseline(newBaseline);

  const drifts = detector.detect(
    { agent: { model: "claude-sonnet-4-20250514" } },
    null
  );
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].type, DRIFT_TYPES.VALUE_CHANGED);
  assert.equal(drifts[0].key, "agent.model");
});
