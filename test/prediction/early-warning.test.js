"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  EarlyWarningSystem,
  SEVERITY,
  WARNING_INDICATOR,
} = require("../../src/prediction/early-warning");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function assistantMsg(content, usage, offset) {
  const entry = { timestamp: new Date(Date.now() - (offset || 0)).toISOString(), role: "assistant", content };
  if (usage) entry.usage = usage;
  return entry;
}

function toolMsg(name, isError, durationMs) {
  const entry = { timestamp: new Date().toISOString(), role: "tool", name };
  if (isError) entry.isError = true;
  if (durationMs !== undefined) entry.durationMs = durationMs;
  return entry;
}

function makeSession(entries) {
  return entries;
}

/**
 * Create a session with enough assistant messages to establish a token baseline.
 */
function baselineSession() {
  const entries = [];
  for (let i = 0; i < 6; i++) {
    entries.push(assistantMsg(`Baseline message ${i}`, {
      input_tokens: 200,
      output_tokens: 100,
    }));
    entries.push(toolMsg("file.read", false, 150));
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("EarlyWarningSystem: constructs with defaults", () => {
  const ews = new EarlyWarningSystem();
  assert.ok(ews instanceof EarlyWarningSystem);
  assert.deepEqual(ews.getWarnings(), []);
  const trends = ews.getTrends();
  assert.equal(trends.baselinesEstablished, false);
});

test("EarlyWarningSystem: establishes baselines from repeated monitoring", () => {
  const ews = new EarlyWarningSystem();
  const session = baselineSession();

  ews.monitor(session);
  const trends = ews.getTrends();
  assert.equal(trends.baselinesEstablished, true);
  assert.ok(trends.tokenUsage.baselineAvg > 0, "should have token baseline");
});

test("EarlyWarningSystem: detects token acceleration", () => {
  const ews = new EarlyWarningSystem();

  // Establish baseline with low token usage
  const baseline = [];
  for (let i = 0; i < 5; i++) {
    baseline.push(assistantMsg(`msg ${i}`, { input_tokens: 100, output_tokens: 50 }));
    baseline.push(toolMsg("file.read", false, 150));
  }
  ews.monitor(makeSession(baseline));

  // Now send messages with much higher token usage
  const spike = [];
  for (let i = 0; i < 5; i++) {
    spike.push(assistantMsg(`spike ${i}`, { input_tokens: 5000, output_tokens: 2000 }));
  }
  ews.monitor(makeSession(spike));

  const warnings = ews.getWarnings();
  const tokenWarnings = warnings.filter((w) => w.indicator === WARNING_INDICATOR.TOKEN_ACCELERATION);
  assert.ok(tokenWarnings.length > 0, "should detect token acceleration");
  assert.ok(
    tokenWarnings[0].severity === SEVERITY.URGENT || tokenWarnings[0].severity === SEVERITY.WARNING
  );
});

test("EarlyWarningSystem: detects tool failure patterns", () => {
  const ews = new EarlyWarningSystem();

  // Establish baseline first
  const baseEntries = [];
  for (let i = 0; i < 5; i++) {
    baseEntries.push(assistantMsg(`msg ${i}`, { input_tokens: 100, output_tokens: 50 }));
    baseEntries.push(toolMsg("file.read", false, 150));
  }
  ews.monitor(makeSession(baseEntries));

  // Now cause tool failures
  const failureSession = [
    toolMsg("file.write", true),
    toolMsg("file.write", true),
    toolMsg("file.write", true),
    toolMsg("file.write", true),
  ];

  ews.monitor(makeSession(failureSession));

  const warnings = ews.getWarnings();
  const toolWarnings = warnings.filter((w) => w.indicator === WARNING_INDICATOR.TOOL_FAILURE_PATTERN);
  assert.ok(toolWarnings.length > 0, "should detect tool failure pattern");
  assert.equal(toolWarnings[0].details.toolName, "file.write");
});

test("EarlyWarningSystem: detects latency growth", () => {
  const ews = new EarlyWarningSystem();

  // Baseline with low latency
  const baseline = [];
  for (let i = 0; i < 5; i++) {
    baseline.push(assistantMsg(`msg ${i}`, { input_tokens: 100, output_tokens: 50 }));
    baseline.push(toolMsg("file.read", false, 100));
  }
  ews.monitor(makeSession(baseline));

  // High-latency tool calls
  const slowSession = [];
  for (let i = 0; i < 5; i++) {
    slowSession.push(toolMsg("file.read", false, 800));
  }

  ews.monitor(makeSession(slowSession));

  const warnings = ews.getWarnings();
  const latWarnings = warnings.filter((w) => w.indicator === WARNING_INDICATOR.LATENCY_GROWTH);
  assert.ok(latWarnings.length > 0, "should detect latency growth");
});

test("EarlyWarningSystem: detects error rate increase", () => {
  const ews = new EarlyWarningSystem();

  // Clean baseline
  const baseline = [];
  for (let i = 0; i < 5; i++) {
    baseline.push(assistantMsg(`msg ${i}`, { input_tokens: 100, output_tokens: 50 }));
    baseline.push(toolMsg("file.read", false, 150));
  }
  ews.monitor(makeSession(baseline));

  // Now send errors
  const errorSession = [];
  for (let i = 0; i < 5; i++) {
    errorSession.push(assistantMsg("trying...", { input_tokens: 200, output_tokens: 80 }));
    errorSession.push(toolMsg("file.write", true));
    errorSession.push(toolMsg("shell.run", true));
  }

  ews.monitor(makeSession(errorSession));

  const warnings = ews.getWarnings();
  const errWarnings = warnings.filter((w) => w.indicator === WARNING_INDICATOR.ERROR_RATE_INCREASE);
  assert.ok(errWarnings.length > 0, "should detect error rate increase");
});

test("EarlyWarningSystem: detects conversation loops", () => {
  const ews = new EarlyWarningSystem();

  const loopSession = [];
  for (let i = 0; i < 8; i++) {
    loopSession.push(assistantMsg(
      "Let me read the file and try again with the same approach.",
      { input_tokens: 300, output_tokens: 100 }
    ));
    loopSession.push(toolMsg("file.read", false, 150));
  }

  // Repeated monitoring with same pattern
  for (let cycle = 0; cycle < 3; cycle++) {
    ews.monitor(makeSession(loopSession));
  }

  const warnings = ews.getWarnings();
  const loopWarnings = warnings.filter((w) => w.indicator === WARNING_INDICATOR.CONVERSATION_LOOP);
  assert.ok(loopWarnings.length > 0, "should detect conversation loop");
});

test("EarlyWarningSystem: suggests intervention for active warnings", () => {
  const ews = new EarlyWarningSystem();

  // Feed baseline
  const baseline = [];
  for (let i = 0; i < 5; i++) {
    baseline.push(assistantMsg(`msg ${i}`, { input_tokens: 100, output_tokens: 50 }));
    baseline.push(toolMsg("file.read", false, 150));
  }
  ews.monitor(makeSession(baseline));

  // Trigger multiple warning types
  const problemSession = [
    assistantMsg("large message with lots of content to push token count up significantly", {
      input_tokens: 6000,
      output_tokens: 3000,
    }),
    toolMsg("file.write", true),
    toolMsg("file.write", true),
    toolMsg("file.write", true),
    toolMsg("file.write", true),
    toolMsg("shell.exec", false, 3000),
  ];

  ews.monitor(makeSession(problemSession));

  const interventions = ews.suggestIntervention();
  assert.ok(interventions.length > 0, "should suggest interventions");
  // Interventions should be sorted by priority
  if (interventions.length > 1) {
    assert.ok(interventions[0].priority <= interventions[1].priority);
  }
  assert.ok(interventions.some((i) => i.action === "pauseAndInvestigate"), "should suggest pausing for tool failures");
});

test("EarlyWarningSystem: acknowledge marks warning as acknowledged", () => {
  const ews = new EarlyWarningSystem();

  // Baseline
  const baseline = [];
  for (let i = 0; i < 5; i++) {
    baseline.push(assistantMsg(`msg ${i}`, { input_tokens: 100, output_tokens: 50 }));
    baseline.push(toolMsg("file.read", false, 150));
  }
  ews.monitor(makeSession(baseline));

  // Trigger a warning
  ews.monitor(makeSession([
    toolMsg("file.write", true),
    toolMsg("file.write", true),
    toolMsg("file.write", true),
    toolMsg("file.write", true),
  ]));

  const warningsBefore = ews.getWarnings();
  assert.ok(warningsBefore.length > 0, "should have warnings before acknowledge");

  const warned = ews.acknowledge(warningsBefore[0].id);
  assert.equal(warned, true);

  const warningsAfter = ews.getWarnings();
  assert.equal(
    warningsAfter.filter((w) => w.id === warningsBefore[0].id).length,
    0,
    "acknowledged warning should not appear in getWarnings"
  );
});

test("EarlyWarningSystem: acknowledges non-existent ID returns false", () => {
  const ews = new EarlyWarningSystem();
  assert.equal(ews.acknowledge("nonexistent-id"), false);
});

test("EarlyWarningSystem: reset clears everything", () => {
  const ews = new EarlyWarningSystem();

  // Feed data
  const baseline = [];
  for (let i = 0; i < 5; i++) {
    baseline.push(assistantMsg(`msg ${i}`, { input_tokens: 100, output_tokens: 50 }));
    baseline.push(toolMsg("file.read", false, 150));
  }
  ews.monitor(makeSession(baseline));

  // Trigger warnings
  ews.monitor(makeSession([
    toolMsg("file.write", true),
    toolMsg("file.write", true),
    toolMsg("file.write", true),
    toolMsg("file.write", true),
  ]));

  ews.reset();

  assert.deepEqual(ews.getWarnings(), []);
  const trends = ews.getTrends();
  assert.equal(trends.baselinesEstablished, false);
  assert.equal(trends.tokenUsage.baselineAvg, 0);
});

test("EarlyWarningSystem: getAllWarnings includes acknowledged", () => {
  const ews = new EarlyWarningSystem();

  // Baseline
  const baseline = [];
  for (let i = 0; i < 5; i++) {
    baseline.push(assistantMsg(`msg ${i}`, { input_tokens: 100, output_tokens: 50 }));
    baseline.push(toolMsg("file.read", false, 150));
  }
  ews.monitor(makeSession(baseline));

  // Trigger warning
  ews.monitor(makeSession([
    toolMsg("file.write", true),
    toolMsg("file.write", true),
    toolMsg("file.write", true),
    toolMsg("file.write", true),
  ]));

  const allBefore = ews.getAllWarnings();
  assert.ok(allBefore.length > 0, "should have warnings");

  // Acknowledge all
  for (const w of allBefore) {
    ews.acknowledge(w.id);
  }

  assert.deepEqual(ews.getWarnings(), [], "getWarnings should be empty after ack");
  assert.equal(
    ews.getAllWarnings().length,
    allBefore.length,
    "getAllWarnings should still include acknowledged"
  );
});

test("EarlyWarningSystem: handles empty session gracefully", () => {
  const ews = new EarlyWarningSystem();
  const result = ews.monitor([]);
  assert.deepEqual(result, []);
  assert.deepEqual(ews.getWarnings(), []);
});
