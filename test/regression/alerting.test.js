/**
 * Tests for RegressionAlerter.
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { RegressionAlerter, ALERT_LEVELS } = require("../../src/regression/alerting.js");
const { RegressionDetector } = require("../../src/regression/detector.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(name, overrides = {}) {
  return {
    name,
    min: overrides.min ?? 1.2,
    max: overrides.max ?? 8.5,
    avg: overrides.avg ?? 3.2,
    p50: overrides.p50 ?? 2.9,
    p95: overrides.p95 ?? 6.1,
    p99: overrides.p99 ?? 7.8,
    stddev: overrides.stddev ?? 1.1,
    opsPerSec: overrides.opsPerSec ?? 312,
    tokensTotal: overrides.tokensTotal ?? 5000,
    tokensInput: overrides.tokensInput ?? 3000,
    tokensOutput: overrides.tokensOutput ?? 2000,
    cost: overrides.cost ?? 0.05,
    errorRate: overrides.errorRate ?? 0.01,
    memoryPeak: overrides.memoryPeak ?? 128,
    memoryAvg: overrides.memoryAvg ?? 96,
    samples: overrides.samples ?? 100,
    totalTime: overrides.totalTime ?? 320,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RegressionAlerter", () => {
  let detector;
  let alerter;

  beforeEach(() => {
    detector = new RegressionDetector();
    alerter = new RegressionAlerter({ detector, console: false });
  });

  afterEach(() => {
    detector.clearBaseline();
  });

  // Test 1: checkAndAlert fires alert when regression detected
  it("checkAndAlert fires alert when regression is detected", () => {
    const baseline = makeResult("v1.0", { avg: 3.2 });
    const current = makeResult("v2.0", { avg: 5.0 }); // +56.25%
    detector.setBaseline(baseline);

    const { alertsFired, report } = alerter.checkAndAlert(current);
    assert.strictEqual(report.hasRegression, true);
    assert.ok(alertsFired.length >= 1, `Expected at least 1 alert, got ${alertsFired.length}`);

    const avgAlert = alertsFired.find((a) => a.regression.metric === "avg");
    assert.ok(avgAlert, "avg alert should be fired");
    assert.ok(avgAlert.message.includes("Avg Latency"), `Message should mention metric: ${avgAlert.message}`);
  });

  // Test 2: checkAndAlert is silent when no regression
  it("checkAndAlert does not fire alerts when no regression is detected", () => {
    const baseline = makeResult("v1.0", { avg: 3.2 });
    const current = makeResult("v2.0", { avg: 3.3 }); // small change
    detector.setBaseline(baseline);

    const { alertsFired, report } = alerter.checkAndAlert(current);
    assert.strictEqual(report.hasRegression, false);
    assert.strictEqual(alertsFired.length, 0);
  });

  // Test 3: alert levels are correctly mapped from severity
  it("alert levels map correctly from regression severity", () => {
    const baseline = makeResult("v1.0", { avg: 3.0, errorRate: 0.01 });
    // Create a massive regression to trigger critical
    const current = makeResult("v2.0", {
      avg: 15.0,       // +400% => critical
      errorRate: 0.15, // +1400% => critical
      cost: 0.5,       // +900% => blocker? (critical severity)
    });
    detector.setBaseline(baseline);

    const { alertsFired } = alerter.checkAndAlert(current);
    assert.ok(alertsFired.length >= 1);

    // Alert level should be BLOCKER for critical severity
    const blockerAlerts = alertsFired.filter((a) => a.level === ALERT_LEVELS.BLOCKER);
    assert.ok(blockerAlerts.length >= 1, `Expected at least 1 BLOCKER alert, got ${blockerAlerts.length}`);
  });

  // Test 4: mute prevents alerts for specified metric
  it("mute prevents alerts for the specified metric", () => {
    const baseline = makeResult("v1.0", { avg: 3.2, cost: 0.05 });
    const current = makeResult("v2.0", { avg: 5.0, cost: 0.15 }); // Both regress
    detector.setBaseline(baseline);

    // Mute avg
    alerter.mute("avg", 60000);
    const { alertsFired } = alerter.checkAndAlert(current);

    const avgAlert = alertsFired.find((a) => a.regression.metric === "avg");
    assert.strictEqual(avgAlert, undefined, "avg alert should be muted");

    const costAlert = alertsFired.find((a) => a.regression.metric === "cost");
    assert.ok(costAlert, "cost alert should still fire");
  });

  // Test 5: mute expires after duration
  it("mute expires after the specified duration", async () => {
    const baseline = makeResult("v1.0", { avg: 3.2 });
    const current = makeResult("v2.0", { avg: 5.0 });
    detector.setBaseline(baseline);

    // Mute for 50ms
    alerter.mute("avg", 50);

    // First check — should be muted
    let { alertsFired } = alerter.checkAndAlert(current);
    let avgAlert = alertsFired.find((a) => a.regression.metric === "avg");
    assert.strictEqual(avgAlert, undefined, "should be muted initially");

    // Wait for mute to expire
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Second check — should fire
    ({ alertsFired } = alerter.checkAndAlert(current));
    avgAlert = alertsFired.find((a) => a.regression.metric === "avg");
    assert.ok(avgAlert, "alert should fire after mute expires");
  });

  // Test 6: setAlertPolicy changes alerting behavior
  it("setAlertPolicy changes the minimum alert level", () => {
    const baseline = makeResult("v1.0", { avg: 3.2 });
    const current = makeResult("v2.0", { avg: 5.0 }); // +56% => minor severity => INFO alert
    detector.setBaseline(baseline);

    // Default minLevel is INFO — alert should fire
    let { alertsFired } = alerter.checkAndAlert(current);
    assert.ok(alertsFired.length >= 1, "should fire with default INFO minLevel");

    // Set minLevel to BLOCKER — no alert for minor regression
    alerter.setAlertPolicy({ minLevel: ALERT_LEVELS.BLOCKER });
    ({ alertsFired } = alerter.checkAndAlert(current));
    assert.strictEqual(alertsFired.length, 0, "should not fire with BLOCKER minLevel for minor regression");
  });

  // Test 7: getAlertHistory tracks all alerts
  it("getAlertHistory tracks all fired alerts", () => {
    const baseline = makeResult("v1.0", { avg: 3.2, cost: 0.05 });
    const current = makeResult("v2.0", { avg: 5.0, cost: 0.15 });
    detector.setBaseline(baseline);

    alerter.checkAndAlert(current);
    const history = alerter.getAlertHistory();
    assert.ok(history.length >= 2, `Expected at least 2 history entries, got ${history.length}`);
    assert.ok(history[0].timestamp, "history entries should have timestamps");
    assert.ok(history[0].level, "history entries should have levels");
    assert.ok(history[0].message, "history entries should have messages");
  });

  // Test 8: clearAlertHistory empties the history
  it("clearAlertHistory removes all recorded alerts", () => {
    const baseline = makeResult("v1.0", { avg: 3.2 });
    const current = makeResult("v2.0", { avg: 5.0 });
    detector.setBaseline(baseline);

    alerter.checkAndAlert(current);
    assert.ok(alerter.getAlertHistory().length > 0);

    alerter.clearAlertHistory();
    assert.strictEqual(alerter.getAlertHistory().length, 0);
  });

  // Test 9: console channel outputs messages (default on)
  it("console channel outputs alert messages when enabled", () => {
    const alerter2 = new RegressionAlerter({ detector, console: true });
    const baseline = makeResult("v1.0", { avg: 3.2 });
    const current = makeResult("v2.0", { avg: 10.0 });
    detector.setBaseline(baseline);

    // Wrap console.warn to capture output
    const originalWarn = console.warn;
    const originalError = console.error;
    const captured = [];
    console.warn = (msg) => captured.push({ method: "warn", msg });
    console.error = (msg) => captured.push({ method: "error", msg });

    try {
      alerter2.checkAndAlert(current);
      assert.ok(captured.length >= 1, `Expected console output, got ${captured.length}`);
      assert.ok(captured[0].msg.includes("Avg Latency"), `Message should include metric name: ${captured[0].msg}`);
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
  });

  // Test 10: file channel writes alerts to disk
  it("file channel writes alerts to a file", () => {
    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, `regression-alerts-${Date.now()}.log`);

    try {
      const alerter2 = new RegressionAlerter({
        detector,
        console: false,
        file: filePath,
      });

      const baseline = makeResult("v1.0", { avg: 3.2 });
      const current = makeResult("v2.0", { avg: 5.0 });
      detector.setBaseline(baseline);

      alerter2.checkAndAlert(current);

      assert.ok(fs.existsSync(filePath), "Alert file should exist");
      const content = fs.readFileSync(filePath, "utf8");
      assert.ok(content.includes("Avg Latency"), `File should contain metric name: ${content}`);
      const hasLevel = content.includes("INFO") || content.includes("WARNING") ||
                       content.includes("CRITICAL") || content.includes("BLOCKER");
      assert.ok(hasLevel, `File should contain alert level: ${content}`);
    } finally {
      try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
    }
  });

  // Test 11: callback channel invokes callback with alert data
  it("callback channel invokes the callback function with alert data", () => {
    const callbacks = [];
    const alerter2 = new RegressionAlerter({
      detector,
      console: false,
      callback: (alertEntry) => callbacks.push(alertEntry),
    });

    const baseline = makeResult("v1.0", { avg: 3.2 });
    const current = makeResult("v2.0", { avg: 5.0 });
    detector.setBaseline(baseline);

    alerter2.checkAndAlert(current);

    assert.ok(callbacks.length >= 1, `Expected callback invocations, got ${callbacks.length}`);
    assert.ok(callbacks[0].regression, "callback should receive regression data");
    assert.ok(callbacks[0].message, "callback should receive alert message");
  });

  // Test 12: cooldown prevents duplicate alerts for same metric
  it("cooldown prevents duplicate alerts for the same metric within the cooldown period", () => {
    const alerter2 = new RegressionAlerter({
      detector,
      console: false,
      cooldownMs: 10000, // 10 second cooldown
    });

    const baseline = makeResult("v1.0", { avg: 3.2 });
    const current = makeResult("v2.0", { avg: 5.0 });
    detector.setBaseline(baseline);

    // First check
    const { alertsFired: firstAlerts } = alerter2.checkAndAlert(current);
    const avgFirst = firstAlerts.filter((a) => a.regression.metric === "avg");
    assert.ok(avgFirst.length >= 1, "first alert should fire");

    // Second check immediately — should be in cooldown
    const { alertsFired: secondAlerts } = alerter2.checkAndAlert(current);
    const avgSecond = secondAlerts.filter((a) => a.regression.metric === "avg");
    assert.strictEqual(avgSecond.length, 0, "second alert should be suppressed by cooldown");
  });

  // Test 13: getMutedMetrics returns currently muted metrics
  it("getMutedMetrics returns currently active mutes with remaining duration", () => {
    alerter.mute("avg", 60000);
    alerter.mute("cost", 30000);

    const muted = alerter.getMutedMetrics();
    assert.strictEqual(muted.length, 2);

    const avgMute = muted.find((m) => m.metric === "avg");
    assert.ok(avgMute);
    assert.ok(avgMute.remainingMs > 0 && avgMute.remainingMs <= 60000);
  });

  // Test 14: unmute and unmuteAll work
  it("unmute removes a specific mute and unmuteAll clears all mutes", () => {
    alerter.mute("avg", 60000);
    alerter.mute("cost", 60000);
    assert.strictEqual(alerter.getMutedMetrics().length, 2);

    alerter.unmute("avg");
    assert.strictEqual(alerter.getMutedMetrics().length, 1);

    alerter.unmuteAll();
    assert.strictEqual(alerter.getMutedMetrics().length, 0);
  });
});
