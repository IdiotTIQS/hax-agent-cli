"use strict";

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const {
  HealthMonitor,
  HEALTH_DIMENSIONS,
  DEFAULT_THRESHOLDS,
} = require("../../src/health/monitor");

// -------------------------------------------------------------------------
// Constructor & initialization
// -------------------------------------------------------------------------

test("constructor initializes with default values", () => {
  const monitor = new HealthMonitor();

  const status = monitor.getStatus();
  assert.strictEqual(typeof status.overallScore, "number");
  assert.ok(status.grade === "F" || status.grade, "grade should be present");
  assert.ok(status.dimensions, "dimensions should be present");
  assert.strictEqual(status.monitoring.running, false);
  assert.strictEqual(status.monitoring.totalChecks, 0);
  assert.strictEqual(status.alerts.active, 0);
  assert.deepStrictEqual(status.alerts.recent, []);
});

test("constructor accepts initialMetrics", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 85,
      testCoverage: 72,
      debtRatio: 0.15,
      docCoverage: 60,
      dependencyHealth: 90,
    },
  });

  const status = monitor.getStatus();
  assert.strictEqual(status.dimensions.codeHealth, 85);
  assert.strictEqual(status.dimensions.testCoverage, 72);
  assert.strictEqual(status.dimensions.debtRatio, 0.15);
  assert.strictEqual(status.dimensions.docCoverage, 60);
  assert.strictEqual(status.dimensions.dependencyHealth, 90);
});

test("constructor accepts custom thresholds", () => {
  const monitor = new HealthMonitor({
    thresholds: {
      codeHealth: { warn: 80, critical: 60 },
    },
    initialMetrics: {
      codeHealth: 75,
      testCoverage: 80,
      debtRatio: 0.1,
      docCoverage: 80,
      dependencyHealth: 80,
    },
  });

  // codeHealth=75 should be warn with custom threshold (warn=80)
  const snapshot = monitor.check();
  const ds = snapshot.dimensionStatuses.codeHealth;
  assert.strictEqual(ds.status, "warn");
});

// -------------------------------------------------------------------------
// check() — single health check
// -------------------------------------------------------------------------

test("check() runs a single health check and returns a snapshot", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 95,
      testCoverage: 88,
      debtRatio: 0.05,
      docCoverage: 92,
      dependencyHealth: 87,
    },
  });

  const snapshot = monitor.check();

  assert.ok(snapshot.timestamp, "missing timestamp");
  assert.strictEqual(typeof snapshot.checkNumber, "number");
  assert.ok(snapshot.overallScore >= 80, "expected high health score");
  assert.ok(["A", "B"].includes(snapshot.grade), "expected A or B grade");
  assert.ok(snapshot.dimensions, "missing dimensions");
  assert.ok(snapshot.dimensionStatuses, "missing dimension statuses");

  // All dimensions should be "pass" with high metrics
  for (const dim of HEALTH_DIMENSIONS) {
    assert.strictEqual(
      snapshot.dimensionStatuses[dim].status,
      "pass",
      `${dim} should be pass`
    );
  }
});

test("check() accepts external metric overrides", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 40,
      testCoverage: 50,
      debtRatio: 0.1,
      docCoverage: 60,
      dependencyHealth: 70,
    },
  });

  // Override codeHealth to a high value
  const snapshot = monitor.check({ codeHealth: 92 });

  assert.strictEqual(snapshot.dimensions.codeHealth, 92);
  assert.strictEqual(
    snapshot.dimensionStatuses.codeHealth.status,
    "pass"
  );
});

test("check() detects critical status for low metrics", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 30,
      testCoverage: 20,
      debtRatio: 0.75,
      docCoverage: 15,
      dependencyHealth: 25,
    },
  });

  const snapshot = monitor.check();

  // All should be critical or warn
  const criticalCount = Object.values(snapshot.dimensionStatuses)
    .filter((s) => s.status === "critical").length;
  assert.ok(criticalCount >= 3, `expected >= 3 critical dimensions, got ${criticalCount}`);
});

test("debtRatio threshold is inverted — higher debt = worse health", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 90,
      testCoverage: 90,
      debtRatio: 0.8, // very high debt
      docCoverage: 90,
      dependencyHealth: 90,
    },
  });

  const snapshot = monitor.check();
  assert.strictEqual(
    snapshot.dimensionStatuses.debtRatio.status,
    "critical",
    "high debt ratio should be critical"
  );
});

// -------------------------------------------------------------------------
// getHistory()
// -------------------------------------------------------------------------

test("getHistory() returns check snapshots in order", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 80,
      testCoverage: 80,
      debtRatio: 0.2,
      docCoverage: 80,
      dependencyHealth: 80,
    },
  });

  monitor.check();
  monitor.check({ codeHealth: 70 });
  monitor.check({ codeHealth: 60 });

  const history = monitor.getHistory();
  assert.strictEqual(history.length, 3);
  assert.strictEqual(history[0].checkNumber, 1);
  assert.strictEqual(history[1].checkNumber, 2);
  assert.strictEqual(history[2].checkNumber, 3);
});

test("getHistory() supports limit", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 80,
      testCoverage: 80,
      debtRatio: 0.2,
      docCoverage: 80,
      dependencyHealth: 80,
    },
  });

  for (let i = 0; i < 10; i++) monitor.check();

  const limited = monitor.getHistory({ limit: 3 });
  assert.strictEqual(limited.length, 3);
  // Should return the most recent 3
  assert.strictEqual(limited[0].checkNumber, 8);
});

test("getHistory() supports summary mode", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 80,
      testCoverage: 80,
      debtRatio: 0.2,
      docCoverage: 80,
      dependencyHealth: 80,
    },
  });

  monitor.check();
  monitor.check();

  const summary = monitor.getHistory({ summary: true });

  assert.strictEqual(summary.length, 2);
  assert.ok(!summary[0].dimensions, "summary should not include full dimensions");
  assert.ok(!summary[0].dimensionStatuses, "summary should not include statuses");
  assert.strictEqual(typeof summary[0].overallScore, "number");
  assert.ok(summary[0].grade);
});

// -------------------------------------------------------------------------
// Alerts
// -------------------------------------------------------------------------

test("alerts are raised when metrics breach thresholds", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 60, // between warn(70) and critical(50), so "warn"
      testCoverage: 80,
      debtRatio: 0.2,
      docCoverage: 80,
      dependencyHealth: 80,
    },
  });

  monitor.check();

  const alerts = monitor.getAlerts();
  assert.ok(alerts.length > 0, "expected at least one alert for low codeHealth");

  const codeAlert = alerts.find((a) => a.dimension === "codeHealth");
  assert.ok(codeAlert, "expected alert for codeHealth");
  assert.strictEqual(codeAlert.level, "warn");
});

test("alert level escalates from warn to critical", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 60, // warn level
      testCoverage: 80,
      debtRatio: 0.2,
      docCoverage: 80,
      dependencyHealth: 80,
    },
  });

  monitor.check();

  let alerts = monitor.getAlerts({ dimension: "codeHealth" });
  assert.strictEqual(alerts[0].level, "warn");

  // Now drop to critical
  monitor.check({ codeHealth: 30 });

  alerts = monitor.getAlerts({ dimension: "codeHealth" });
  assert.strictEqual(
    alerts[0].level,
    "critical",
    "alert should escalate to critical"
  );
  assert.ok(alerts[0].count > 1, "alert count should increment");
});

test("alerts auto-resolve when metric recovers", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 40,
      testCoverage: 80,
      debtRatio: 0.2,
      docCoverage: 80,
      dependencyHealth: 80,
    },
  });

  // Should trigger a warn alert for codeHealth
  monitor.check();

  let alerts = monitor.getAlerts({ dimension: "codeHealth" });
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].resolved, false);

  // Recover
  monitor.check({ codeHealth: 85 });

  alerts = monitor.getAlerts({ dimension: "codeHealth" });
  if (alerts.length > 0) {
    assert.strictEqual(
      alerts[0].resolved,
      true,
      "alert should be auto-resolved"
    );
  }
});

test("onAlert() subscribes to alert events", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 40,
      testCoverage: 80,
      debtRatio: 0.2,
      docCoverage: 80,
      dependencyHealth: 80,
    },
  });

  const received = [];
  const unsubscribe = monitor.onAlert((alert) => {
    received.push(alert);
  });

  monitor.check();

  assert.ok(received.length > 0, "should have received alert events");

  // Unsubscribe
  unsubscribe();
  const beforeUnsub = received.length;

  monitor.check({ codeHealth: 80 });

  // No new alerts should be received after unsub
  assert.strictEqual(received.length, beforeUnsub);
});

test("onAlert() throws for non-function handler", () => {
  const monitor = new HealthMonitor();

  assert.throws(() => monitor.onAlert("not a function"), TypeError);
  assert.throws(() => monitor.onAlert(null), TypeError);
  assert.throws(() => monitor.onAlert(undefined), TypeError);
});

// -------------------------------------------------------------------------
// dismissAlert / dismissAllAlerts
// -------------------------------------------------------------------------

test("dismissAlert() removes a specific alert by ID", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 40,
      testCoverage: 80,
      debtRatio: 0.2,
      docCoverage: 80,
      dependencyHealth: 80,
    },
  });

  monitor.check();

  const alerts = monitor.getAlerts();
  assert.ok(alerts.length > 0);

  const alertId = alerts[0].id;
  const dismissed = monitor.dismissAlert(alertId);
  assert.strictEqual(dismissed, true);

  const after = monitor.getAlerts();
  assert.strictEqual(
    after.find((a) => a.id === alertId),
    undefined,
    "dismissed alert should be gone"
  );
});

test("dismissAlert() returns false for unknown ID", () => {
  const monitor = new HealthMonitor();
  assert.strictEqual(monitor.dismissAlert("nonexistent"), false);
});

test("dismissAllAlerts() clears all active alerts", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 40,
      testCoverage: 30,
      debtRatio: 0.2,
      docCoverage: 80,
      dependencyHealth: 80,
    },
  });

  monitor.check();

  const before = monitor.getAlerts().length;
  assert.ok(before > 0);

  const count = monitor.dismissAllAlerts();
  assert.strictEqual(count, before);

  assert.strictEqual(monitor.getAlerts().length, 0);
});

// -------------------------------------------------------------------------
// setDimension / updateThresholds
// -------------------------------------------------------------------------

test("setDimension() updates a single dimension value", () => {
  const monitor = new HealthMonitor();

  monitor.setDimension("codeHealth", 77);
  monitor.setDimension("testCoverage", 65);

  const status = monitor.getStatus();
  assert.strictEqual(status.dimensions.codeHealth, 77);
  assert.strictEqual(status.dimensions.testCoverage, 65);
});

test("setDimension() throws on invalid dimension name", () => {
  const monitor = new HealthMonitor();

  assert.throws(
    () => monitor.setDimension("invalidMetric", 50),
    TypeError
  );
});

test("setDimension() throws on non-number value", () => {
  const monitor = new HealthMonitor();

  assert.throws(
    () => monitor.setDimension("codeHealth", "fifty"),
    TypeError
  );
  assert.throws(
    () => monitor.setDimension("codeHealth", NaN),
    TypeError
  );
});

test("updateThresholds() changes thresholds at runtime", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 75,
      testCoverage: 80,
      debtRatio: 0.2,
      docCoverage: 80,
      dependencyHealth: 80,
    },
  });

  // With default threshold (warn at 70), codeHealth=75 should pass
  let snapshot = monitor.check();
  assert.strictEqual(snapshot.dimensionStatuses.codeHealth.status, "pass");

  // Raise the warn threshold to 80
  monitor.updateThresholds({ codeHealth: { warn: 80, critical: 50 } });
  snapshot = monitor.check();
  assert.strictEqual(snapshot.dimensionStatuses.codeHealth.status, "warn");
});

test("updateThresholds() throws on non-object input", () => {
  const monitor = new HealthMonitor();
  assert.throws(() => monitor.updateThresholds(null), TypeError);
  assert.throws(() => monitor.updateThresholds("string"), TypeError);
});

// -------------------------------------------------------------------------
// start / stop
// -------------------------------------------------------------------------

test("start() begins monitoring and returns this for chaining", (t, done) => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 80,
      testCoverage: 80,
      debtRatio: 0.2,
      docCoverage: 80,
      dependencyHealth: 80,
    },
  });

  const result = monitor.start({ intervalMs: 100, immediate: false });
  assert.strictEqual(result, monitor, "start() should return this");

  assert.strictEqual(monitor.getStatus().monitoring.running, true);

  // Wait for at least one tick
  setTimeout(() => {
    const status = monitor.getStatus();
    assert.ok(status.monitoring.totalChecks > 0, "should have run checks");

    monitor.stop();
    assert.strictEqual(monitor.getStatus().monitoring.running, false);
    done();
  }, 250);
});

test("start() throws on interval below 100ms", () => {
  const monitor = new HealthMonitor();

  assert.throws(
    () => monitor.start({ intervalMs: 50 }),
    RangeError
  );
});

test("start() emits started event", (t, done) => {
  const monitor = new HealthMonitor();

  monitor.on("started", (info) => {
    assert.ok(info.startedAt);
    assert.strictEqual(info.intervalMs, 100);
    monitor.stop();
    done();
  });

  monitor.start({ intervalMs: 100, immediate: false });
});

test("stop() emits stopped event", (t, done) => {
  const monitor = new HealthMonitor();

  monitor.on("stopped", (info) => {
    assert.ok(info.stoppedAt);
    done();
  });

  monitor.start({ intervalMs: 5000 });
  monitor.stop();
});

// -------------------------------------------------------------------------
// reset
// -------------------------------------------------------------------------

test("reset() clears all state", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 80,
      testCoverage: 80,
      debtRatio: 0.2,
      docCoverage: 80,
      dependencyHealth: 80,
    },
  });

  monitor.check();
  monitor.check();

  assert.strictEqual(monitor.getHistory().length, 2);

  monitor.reset();

  const status = monitor.getStatus();
  assert.strictEqual(monitor.getHistory().length, 0);
  assert.strictEqual(status.monitoring.running, false);
  assert.strictEqual(status.monitoring.totalChecks, 0);
  assert.strictEqual(status.alerts.active, 0);

  // All dimensions should be null
  for (const dim of HEALTH_DIMENSIONS) {
    assert.strictEqual(status.dimensions[dim], null);
  }
});

// -------------------------------------------------------------------------
// HEALTH_DIMENSIONS constant
// -------------------------------------------------------------------------

test("HEALTH_DIMENSIONS contains all 5 expected keys", () => {
  assert.deepStrictEqual(HEALTH_DIMENSIONS, [
    "codeHealth",
    "testCoverage",
    "debtRatio",
    "docCoverage",
    "dependencyHealth",
  ]);
});
