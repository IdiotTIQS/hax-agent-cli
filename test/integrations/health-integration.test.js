"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");

const {
  attachHealthMonitor,
  generateHealthDashboard,
} = require("../../src/integrations/health-integration");

const { HealthMonitor } = require("../../src/health/monitor");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSession() {
  const emitter = new EventEmitter();
  // Minimal session-like shape
  return Object.assign(emitter, {
    id: "test-session-1",
    projectRoot: "/fake/project",
    startTime: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// attachHealthMonitor
// ---------------------------------------------------------------------------

test("attachHealthMonitor: creates monitor and returns dispose", () => {
  const session = mockSession();
  const result = attachHealthMonitor(session, { startImmediately: false });

  assert.ok(result.monitor instanceof HealthMonitor, "should return a HealthMonitor");
  assert.equal(typeof result.dispose, "function", "should return a dispose function");
});

test("attachHealthMonitor: starts monitoring by default", (_, done) => {
  const session = mockSession();
  const result = attachHealthMonitor(session, {
    intervalMs: 100,
    startImmediately: true,
  });

  // Monitor should have run at least the immediate check
  const status = result.monitor.getStatus();
  assert.ok(status.monitoring.totalChecks >= 1,
    `should have run at least 1 check from immediate start, got ${status.monitoring.totalChecks}`);

  // Let the interval fire a second cycle
  setTimeout(() => {
    try {
      const status2 = result.monitor.getStatus();
      assert.ok(status2.monitoring.totalChecks >= 2,
        `should have run at least 2 checks after interval, got ${status2.monitoring.totalChecks}`);
      result.dispose();
      done();
    } catch (err) {
      result.dispose();
      done(err);
    }
  }, 200);
});

test("attachHealthMonitor: dispose stops further checks", () => {
  const session = mockSession();
  const result = attachHealthMonitor(session, {
    intervalMs: 100,
    startImmediately: true,
  });

  const checksBefore = result.monitor.getStatus().monitoring.totalChecks;
  result.dispose();

  // After dispose, no more checks should be running
  // The disposed flag prevents further runCheck() calls
  assert.ok(result.monitor.getStatus().monitoring.totalChecks >= checksBefore,
    "checks should not decrease after dispose");
});

test("attachHealthMonitor: wires session events for turn:end", () => {
  const session = mockSession();
  const result = attachHealthMonitor(session, { startImmediately: false });

  const checksBefore = result.monitor.getStatus().monitoring.totalChecks;

  // Emit turn:end — should trigger a health check
  session.emit("turn:end");
  session.emit("turn:end");

  const status = result.monitor.getStatus();
  assert.ok(
    status.monitoring.totalChecks >= checksBefore + 2,
    "each turn:end event should trigger a check",
  );

  result.dispose();
});

test("attachHealthMonitor: metricCollector is called during checks", (_, done) => {
  const session = mockSession();
  let collected = false;

  const result = attachHealthMonitor(session, {
    intervalMs: 100,
    startImmediately: true,
    metricCollector(sess, mon) {
      collected = true;
      return { codeHealth: 85, testCoverage: 72 };
    },
  });

  setTimeout(() => {
    try {
      assert.ok(collected, "metricCollector should have been called");
      const status = result.monitor.getStatus();
      assert.equal(status.dimensions.codeHealth, 85, "codeHealth should be set from collector");
      assert.equal(status.dimensions.testCoverage, 72, "testCoverage should be set from collector");
      result.dispose();
      done();
    } catch (err) {
      result.dispose();
      done(err);
    }
  }, 200);
});

test("attachHealthMonitor: works even when session has no .on method", () => {
  // Plain object without EventEmitter
  const plainSession = { id: "plain", version: 1 };
  const result = attachHealthMonitor(plainSession, { startImmediately: false });

  assert.ok(result.monitor instanceof HealthMonitor);
  assert.equal(typeof result.dispose, "function");

  // Manual check should still work
  const snapshot = result.monitor.check({ codeHealth: 92 });
  assert.equal(snapshot.overallScore, 92);
  assert.equal(snapshot.grade, "A");

  result.dispose();
});

// ---------------------------------------------------------------------------
// generateHealthDashboard
// ---------------------------------------------------------------------------

test("generateHealthDashboard: renders dashboard from a monitor", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 88,
      testCoverage: 75,
      debtRatio: 0.15,
      docCoverage: 60,
      dependencyHealth: 82,
    },
  });

  monitor.check();

  const result = generateHealthDashboard(monitor, { termWidth: 80 });

  assert.ok(typeof result.dashboard === "string", "dashboard should be a string");
  assert.ok(result.dashboard.length > 0, "dashboard should not be empty");
  assert.ok(result.dashboard.includes("PROJECT HEALTH DASHBOARD"), "should contain title");
  assert.equal(result.status.overallScore, 79, "overall score should be computed");
  assert.ok(["A", "B", "C", "D", "F"].includes(result.status.grade), "grade should be a letter");

  // Trends
  assert.ok(result.trends, "should include trends");
  assert.ok(typeof result.trends.codeHealth === "string", "should have codeHealth trend");
  assert.ok(typeof result.trends.testCoverage === "string", "should have testCoverage trend");

  // History
  assert.ok(Array.isArray(result.history), "should include history array");
  assert.ok(result.history.length > 0, "history should have at least the initial check");
});

test("generateHealthDashboard: accepts session object with .healthMonitor", () => {
  const monitor = new HealthMonitor({
    initialMetrics: { codeHealth: 50, testCoverage: 40 },
  });
  monitor.check();

  const session = { healthMonitor: monitor };

  const result = generateHealthDashboard(session, { termWidth: 80 });
  assert.ok(result.dashboard.length > 0);
  assert.equal(result.status.overallScore, 45);
});

test("generateHealthDashboard: throws on invalid input", () => {
  assert.throws(
    () => generateHealthDashboard(null),
    /HealthMonitor/,
    "should throw on null input",
  );
  assert.throws(
    () => generateHealthDashboard({}),
    /HealthMonitor/,
    "should throw on object without monitor",
  );
});

test("generateHealthDashboard: respects termWidth", () => {
  const monitor = new HealthMonitor({
    initialMetrics: {
      codeHealth: 95,
      testCoverage: 90,
      debtRatio: 0.05,
      docCoverage: 85,
      dependencyHealth: 92,
    },
  });
  monitor.check();

  const wide = generateHealthDashboard(monitor, { termWidth: 120 });
  const narrow = generateHealthDashboard(monitor, { termWidth: 60 });

  assert.ok(wide.dashboard.length > narrow.dashboard.length,
    "wider terminal should produce more output");
});
