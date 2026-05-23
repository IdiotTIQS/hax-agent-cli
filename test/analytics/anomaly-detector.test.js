"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AnomalyDetector,
  SEVERITY_LEVELS,
} = require("../../src/analytics/anomaly-detector");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// Use recent timestamps so trailing-silence checks don't fire spuriously.
// BASE is 5 min ago; offsetMinutes shifts forward from there.
const TS_BASE = Date.now() - 300000;
function ts(offsetMinutes = 0) {
  return new Date(TS_BASE + offsetMinutes * 60000).toISOString();
}

function userMsg(content, offset = 0) {
  return { timestamp: ts(offset), role: "user", content };
}

function assistantMsg(content, offset = 0, usage) {
  const entry = { timestamp: ts(offset), role: "assistant", content };
  if (usage) entry.usage = usage;
  return entry;
}

function toolMsg(name, offset = 0, isError) {
  const entry = { timestamp: ts(offset), role: "tool", name };
  if (isError) entry.isError = true;
  return entry;
}

// Normal session — no anomalies expected
function normalSession() {
  return [
    userMsg("Read the config file and suggest improvements.", 0),
    assistantMsg("Let me read and analyze.", 1, {
      input_tokens: 200,
      output_tokens: 100,
    }),
    toolMsg("file.read", 2),
    assistantMsg("I see potential optimizations. Let me apply them.", 3, {
      input_tokens: 250,
      output_tokens: 120,
    }),
    toolMsg("file.edit", 4),
    assistantMsg("Changes have been applied and verified successfully.", 5, {
      input_tokens: 150,
      output_tokens: 60,
    }),
  ];
}

// Session with excessive retries
function retryHellSession() {
  const entries = [];
  entries.push(userMsg("Fix the configuration error on production.", 0));
  entries.push(assistantMsg("Let me check the config.", 1, { input_tokens: 200, output_tokens: 80 }));
  entries.push(toolMsg("file.read", 2));
  entries.push(assistantMsg("Trying to fix.", 3, { input_tokens: 180, output_tokens: 50 }));
  // 5 consecutive failed retries on the same tool
  for (let i = 0; i < 5; i++) {
    entries.push(toolMsg("file.write", 4 + i, true));
  }
  entries.push(assistantMsg("I keep failing.", 9, { input_tokens: 100, output_tokens: 30 }));
  return entries;
}

// Session with silence gaps
function silenceGapSession() {
  return [
    userMsg("Start task.", 0),
    assistantMsg("Working.", 1, { input_tokens: 100, output_tokens: 50 }),
    toolMsg("file.read", 2),
    assistantMsg("Analyzing...", 3, { input_tokens: 120, output_tokens: 40 }),
    // 15-minute gap
    userMsg("Are you still there?", 18),
    assistantMsg("Yes, still here.", 19, { input_tokens: 80, output_tokens: 30 }),
    // Another 25-minute gap
    userMsg("???", 44),
    assistantMsg("Processing.", 45, { input_tokens: 60, output_tokens: 20 }),
  ];
}

// Session with token spikes
function tokenSpikeSession() {
  return [
    userMsg("hi", 0),
    assistantMsg("hello", 1, { input_tokens: 50, output_tokens: 20 }),
    userMsg("ok", 2),
    assistantMsg("got it", 3, { input_tokens: 60, output_tokens: 25 }),
    userMsg("go", 4),
    assistantMsg("done", 5, { input_tokens: 55, output_tokens: 30 }),
    // Massive spike
    userMsg("Read the entire codebase", 6),
    assistantMsg("Reading everything...", 7, {
      input_tokens: 50000,
      output_tokens: 8000,
    }),
  ];
}

// Session with unusual tool sequence (3+ consecutive same tool)
function unusualSequenceSession() {
  return [
    userMsg("Clean up the codebase", 0),
    assistantMsg("Running cleanups.", 1, { input_tokens: 150, output_tokens: 60 }),
    toolMsg("shell.run", 2),
    assistantMsg("More cleanup.", 3, { input_tokens: 100, output_tokens: 40 }),
    toolMsg("shell.run", 4),
    assistantMsg("Even more.", 5, { input_tokens: 90, output_tokens: 35 }),
    toolMsg("shell.run", 6),
  ];
}

// Session with aggressive tool patterns
function aggressiveSession() {
  const entries = [];
  entries.push(userMsg("Deploy everything to production", 0));
  entries.push(assistantMsg("Deploying now.", 1, { input_tokens: 100, output_tokens: 50 }));
  for (let i = 0; i < 7; i++) {
    entries.push(toolMsg("git.push", 2 + i));
  }
  entries.push(assistantMsg("All pushed.", 9, { input_tokens: 80, output_tokens: 30 }));
  return entries;
}

// ---------------------------------------------------------------------------
// detect tests
// ---------------------------------------------------------------------------

test("detect: returns array of anomalies", () => {
  const detector = new AnomalyDetector();
  const anomalies = detector.detect(normalSession());

  assert.ok(Array.isArray(anomalies));
});

test("detect: normal session produces zero anomalies", () => {
  const detector = new AnomalyDetector();
  const anomalies = detector.detect(normalSession());

  assert.equal(anomalies.length, 0, "normal session should have no anomalies");
});

test("detect: excessive retries are detected", () => {
  const detector = new AnomalyDetector();
  const anomalies = detector.detect(retryHellSession());

  const retryAnomalies = anomalies.filter(
    (a) => a.type === "excessiveRetries"
  );
  assert.ok(
    retryAnomalies.length >= 1,
    `should detect excessive retries, got ${retryAnomalies.length}`
  );
});

test("detect: excessive retries have HIGH or CRITICAL severity", () => {
  const detector = new AnomalyDetector();
  const anomalies = detector.detect(retryHellSession());

  const retryAnomalies = anomalies.filter(
    (a) => a.type === "excessiveRetries"
  );
  for (const a of retryAnomalies) {
    assert.ok(
      a.severity === SEVERITY_LEVELS.HIGH || a.severity === SEVERITY_LEVELS.CRITICAL,
      `expected HIGH or CRITICAL, got ${a.severity}`
    );
  }
});

test("detect: silence gaps are detected", () => {
  const detector = new AnomalyDetector();
  const anomalies = detector.detect(silenceGapSession());

  const gapAnomalies = anomalies.filter((a) => a.type === "silenceGap");
  assert.ok(
    gapAnomalies.length >= 1,
    `should detect silence gaps, got ${gapAnomalies.length}`
  );
});

test("detect: token spikes are detected", () => {
  const detector = new AnomalyDetector({ tokenSpikeFactor: 1.5 });
  const anomalies = detector.detect(tokenSpikeSession());

  const spikeAnomalies = anomalies.filter((a) => a.type === "tokenSpike");
  assert.ok(
    spikeAnomalies.length >= 1,
    `should detect token spikes, got ${spikeAnomalies.length}`
  );
});

test("detect: unusual tool sequences are detected", () => {
  const detector = new AnomalyDetector();
  const anomalies = detector.detect(unusualSequenceSession());

  // 3 consecutive shell.run should trigger unusualToolSequence
  const seqAnomalies = anomalies.filter(
    (a) => a.type === "unusualToolSequence"
  );
  assert.ok(
    seqAnomalies.length >= 1,
    `should detect unusual tool sequence (3 consecutive shell.run), got ${seqAnomalies.length}`
  );
});

test("detect: aggressive tool patterns are detected", () => {
  const detector = new AnomalyDetector({ aggressiveToolLimit: 3 });
  const anomalies = detector.detect(aggressiveSession());

  const aggressiveAnomalies = anomalies.filter(
    (a) => a.type === "aggressiveToolPattern"
  );
  assert.ok(
    aggressiveAnomalies.length >= 1,
    `should detect aggressive tool patterns, got ${aggressiveAnomalies.length}`
  );
});

test("detect: handles empty session gracefully", () => {
  const detector = new AnomalyDetector();
  const anomalies = detector.detect([]);

  assert.deepEqual(anomalies, []);
});

test("detect: handles null session gracefully", () => {
  const detector = new AnomalyDetector();
  const anomalies = detector.detect(null);

  assert.deepEqual(anomalies, []);
});

// ---------------------------------------------------------------------------
// getAnomalies tests
// ---------------------------------------------------------------------------

test("getAnomalies: returns the result from last detect", () => {
  const detector = new AnomalyDetector();
  detector.detect(normalSession());
  const result = detector.getAnomalies();

  assert.ok(Array.isArray(result));
});

test("getAnomalies: is empty before first detect", () => {
  const detector = new AnomalyDetector();
  const result = detector.getAnomalies();

  assert.deepEqual(result, []);
});

test("getAnomaliesByCategory: groups anomalies by type", () => {
  const detector = new AnomalyDetector();
  detector.detect(retryHellSession());

  const grouped = detector.getAnomaliesByCategory();
  assert.ok(grouped.excessiveRetries);
  assert.ok(Array.isArray(grouped.excessiveRetries));
  assert.ok(grouped.unusualToolSequence);
  assert.ok(grouped.silenceGap);
  assert.ok(grouped.tokenSpike);
  assert.ok(grouped.aggressiveToolPattern);
  assert.ok(grouped.suddenTopicShift);
});

// ---------------------------------------------------------------------------
// getSeverity tests
// ---------------------------------------------------------------------------

test("getSeverity: returns severity of an anomaly object", () => {
  const detector = new AnomalyDetector();
  detector.detect(retryHellSession());

  const anomalies = detector.getAnomalies();
  if (anomalies.length > 0) {
    const sev = detector.getSeverity(anomalies[0]);
    assert.ok(
      Object.values(SEVERITY_LEVELS).includes(sev),
      `severity should be one of ${JSON.stringify(Object.values(SEVERITY_LEVELS))}, got ${sev}`
    );
  }
});

test("getSeverity: returns LOW for invalid/null anomaly", () => {
  const detector = new AnomalyDetector();
  assert.equal(detector.getSeverity(null), SEVERITY_LEVELS.LOW);
  assert.equal(detector.getSeverity({}), SEVERITY_LEVELS.LOW);
});

// ---------------------------------------------------------------------------
// getSeveritySummary tests
// ---------------------------------------------------------------------------

test("getSeveritySummary: counts anomalies by severity level", () => {
  const detector = new AnomalyDetector();
  detector.detect(retryHellSession());

  const summary = detector.getSeveritySummary();
  assert.equal(typeof summary.LOW, "number");
  assert.equal(typeof summary.MEDIUM, "number");
  assert.equal(typeof summary.HIGH, "number");
  assert.equal(typeof summary.CRITICAL, "number");
  assert.equal(typeof summary.total, "number");
  assert.ok(summary.total >= 0);
});

// ---------------------------------------------------------------------------
// Topic shift detection
// ---------------------------------------------------------------------------

test("detect: sudden topic shift is detected with dramatic length change", () => {
  const detector = new AnomalyDetector({ topicShiftRatio: 5 });
  const session = [
    userMsg("A".repeat(500), 0), // Long message (500 chars)
    assistantMsg("Yes sir", 1, { input_tokens: 30, output_tokens: 10 }), // 7 chars (>= 5)
    userMsg("ok done", 2), // 7 chars — dramatic drop from 500
  ];

  const anomalies = detector.detect(session);
  const shifts = anomalies.filter((a) => a.type === "suddenTopicShift");

  assert.ok(shifts.length >= 1, `should detect at least one topic shift, got ${shifts.length}`);
});

// ---------------------------------------------------------------------------
// Custom thresholds
// ---------------------------------------------------------------------------

test("detect: respects custom retry threshold", () => {
  // Default threshold is 3. With threshold 2, even 2 consecutive errors triggers.
  const detector = new AnomalyDetector({ retryThreshold: 2 });

  const session = [
    userMsg("fix it", 0),
    assistantMsg("ok", 1, { input_tokens: 50, output_tokens: 20 }),
    toolMsg("shell.run", 2, true),
    toolMsg("shell.run", 3, true),
    assistantMsg("failed", 4, { input_tokens: 60, output_tokens: 25 }),
  ];

  const anomalies = detector.detect(session);
  const retries = anomalies.filter((a) => a.type === "excessiveRetries");
  assert.ok(retries.length >= 1, "2 consecutive errors should trigger with threshold 2");
});

test("detect: respects custom silence gap threshold", () => {
  // 5-minute threshold should catch a 6-minute gap
  const detector = new AnomalyDetector({ silenceGapMinutes: 5 });

  const session = [
    userMsg("start", 0),
    assistantMsg("working", 1, { input_tokens: 100, output_tokens: 50 }),
    userMsg("still there?", 7), // 6-minute gap
  ];

  const anomalies = detector.detect(session);
  const gaps = anomalies.filter((a) => a.type === "silenceGap");
  assert.ok(gaps.length >= 1, `should detect gap with 5-min threshold, got ${gaps.length}`);
});
