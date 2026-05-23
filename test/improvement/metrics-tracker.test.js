"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { MetricsTracker, TREND_DIRECTIONS } = require("../../src/improvement/metrics-tracker");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function ts(offsetMinutes = 0) {
  const d = new Date("2026-05-20T10:00:00Z");
  d.setMinutes(d.getMinutes() + offsetMinutes);
  return d.toISOString();
}

function userMsg(content, offset = 0) {
  return { timestamp: ts(offset), role: "user", content };
}

function assistantMsg(content, offset = 0, usage) {
  const entry = { timestamp: ts(offset), role: "assistant", content };
  if (usage) entry.usage = usage;
  return entry;
}

function toolMsg(name, offset = 0, data, isError) {
  const entry = { timestamp: ts(offset), role: "tool", name, data: data || {} };
  if (isError) entry.isError = true;
  return entry;
}

function goodSession(id = "good") {
  return {
    id,
    entries: [
      userMsg("Please fix the authentication bug in src/auth.js — it throws 401 for valid expired tokens", 0),
      assistantMsg("Let me read the file first.", 1, {
        input_tokens: 120,
        output_tokens: 40,
      }),
      toolMsg("file.read", 2, { path: "src/auth.js" }),
      assistantMsg("I see the issue. Let me edit it.", 3, {
        input_tokens: 250,
        output_tokens: 60,
      }),
      toolMsg("file.edit", 4, { path: "src/auth.js" }),
      assistantMsg("Done! The auth is now fixed and handles expiration properly.", 5, {
        input_tokens: 180,
        output_tokens: 50,
      }),
      userMsg("Thank you, that works perfectly!", 6),
      assistantMsg("You're welcome!", 7, {
        input_tokens: 100,
        output_tokens: 20,
      }),
    ],
  };
}

function badSession(id = "bad") {
  return {
    id,
    entries: [
      userMsg("fix it", 0),
      assistantMsg("What do you need fixed?", 1, {
        input_tokens: 60,
        output_tokens: 20,
      }),
      userMsg("the bug", 2),
      assistantMsg("I need more context.", 3, {
        input_tokens: 80,
        output_tokens: 25,
      }),
      toolMsg("shell.run", 4, { exitCode: 1 }, true),
      assistantMsg("That failed. Trying again.", 5, {
        input_tokens: 150,
        output_tokens: 40,
      }),
      toolMsg("shell.run", 6, { exitCode: 1 }, true),
      assistantMsg("Still not working. I'm having trouble.", 7, {
        input_tokens: 180,
        output_tokens: 45,
      }),
      userMsg("this is wrong, not what I wanted", 8),
      assistantMsg("Sorry about that.", 9, {
        input_tokens: 120,
        output_tokens: 25,
      }),
    ],
  };
}

function mixedSession(id = "mixed") {
  return {
    id,
    entries: [
      userMsg("Read the config", 0),
      assistantMsg("Reading...", 1, { input_tokens: 60, output_tokens: 20 }),
      toolMsg("file.read", 2, { path: "/config.json" }),
      toolMsg("file.read", 3, { path: "/app.js" }),
      assistantMsg("Here are the files.", 4, { input_tokens: 100, output_tokens: 80 }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests: trackSession()
// ---------------------------------------------------------------------------

test("trackSession: computes and records all metrics", () => {
  const tracker = new MetricsTracker();
  const metrics = tracker.trackSession(goodSession());

  // Required metric fields
  assert.ok(typeof metrics.toolSuccessRate === "number", "has toolSuccessRate");
  assert.ok(typeof metrics.avgResponseTimeMs === "number", "has avgResponseTimeMs");
  assert.ok(typeof metrics.tokenEfficiency === "number", "has tokenEfficiency");
  assert.ok(typeof metrics.userSatisfactionIndicator === "number", "has userSatisfactionIndicator");
  assert.ok(typeof metrics.errorRate === "number", "has errorRate");
  assert.ok(typeof metrics.toolCallsPerTurn === "number", "has toolCallsPerTurn");
  assert.ok(typeof metrics.tokensPerTurn === "number", "has tokensPerTurn");
  assert.ok(typeof metrics.userMessageLength === "number", "has userMessageLength");
  assert.ok(typeof metrics.assistantMessageLength === "number", "has assistantMessageLength");

  // Tool success rate should be 1.0 for good session (no errors)
  assert.equal(metrics.toolSuccessRate, 1, "good session has perfect tool success");
  assert.equal(metrics.errorRate, 0, "good session has zero errors");
});

test("trackSession: detects tool errors and satisfaction signals", () => {
  const tracker = new MetricsTracker();
  const metrics = tracker.trackSession(badSession());

  assert.ok(metrics.toolSuccessRate < 1, "bad session has tool failures");
  assert.ok(metrics.toolErrorCount > 0, "tool errors counted");
  assert.ok(metrics.errorRate > 0, "error rate > 0");
  // User with negative sentiment
  assert.ok(metrics.userSatisfactionIndicator < 0.5,
    "negative sentiment detected");
});

test("trackSession: computes token efficiency correctly", () => {
  const tracker = new MetricsTracker();
  const metrics = tracker.trackSession(mixedSession());

  // Two assistant messages with usage: (20/60) + (80/100) = ~0.333 + 0.8, avg-ish
  assert.ok(metrics.tokenEfficiency > 0, "token efficiency computed");
  assert.ok(metrics.totalEntries > 0, "total entries tracked");
  assert.equal(metrics.turns, 1, "one user turn");
});

test("trackSession: handles empty session", () => {
  const tracker = new MetricsTracker();
  const metrics = tracker.trackSession({ id: "empty", entries: [] });

  assert.equal(metrics.toolSuccessRate, 1, "empty session defaults to perfect tool rate");
  assert.equal(metrics.errorRate, 0);
  assert.equal(metrics.turns, 0);
  assert.equal(metrics.avgResponseTimeMs, 0);
});

// ---------------------------------------------------------------------------
// Tests: getTrends()
// ---------------------------------------------------------------------------

test("getTrends: returns trend analysis for a metric", () => {
  const tracker = new MetricsTracker();

  // Track improving tool success rates
  tracker._sessions = [
    { sessionId: "s1", timestamp: ts(0), metrics: { toolSuccessRate: 0.5 } },
    { sessionId: "s2", timestamp: ts(1), metrics: { toolSuccessRate: 0.6 } },
    { sessionId: "s3", timestamp: ts(2), metrics: { toolSuccessRate: 0.8 } },
    { sessionId: "s4", timestamp: ts(3), metrics: { toolSuccessRate: 0.9 } },
    { sessionId: "s5", timestamp: ts(4), metrics: { toolSuccessRate: 1.0 } },
  ];

  const trend = tracker.getTrends("toolSuccessRate");

  assert.equal(trend.metric, "toolSuccessRate");
  assert.equal(trend.dataPoints, 5, "all 5 data points included");
  assert.ok(trend.currentValue !== null, "current value exists");
  assert.equal(trend.currentValue, 1.0, "last value is correct");
  assert.ok(Object.values(TREND_DIRECTIONS).includes(trend.trend.direction),
    "valid trend direction");
  // Improving trend
  assert.ok(trend.trend.direction === TREND_DIRECTIONS.IMPROVING ||
           trend.trend.slope > 0,
    "trend direction reflects improving values");
});

test("getTrends: detects stable trends", () => {
  const tracker = new MetricsTracker();

  tracker._sessions = [
    { sessionId: "s1", timestamp: ts(0), metrics: { errorRate: 0.10 } },
    { sessionId: "s2", timestamp: ts(1), metrics: { errorRate: 0.11 } },
    { sessionId: "s3", timestamp: ts(2), metrics: { errorRate: 0.10 } },
    { sessionId: "s4", timestamp: ts(3), metrics: { errorRate: 0.09 } },
    { sessionId: "s5", timestamp: ts(4), metrics: { errorRate: 0.10 } },
  ];

  const trend = tracker.getTrends("errorRate");
  // Should be stable or have very low slope
  assert.ok(
    trend.trend.direction === TREND_DIRECTIONS.STABLE ||
    Math.abs(trend.trend.slope) < 0.01,
    "stable values produce stable or near-flat trend"
  );
});

test("getTrends: returns insufficient data for too few sessions", () => {
  const tracker = new MetricsTracker();

  tracker._sessions = [
    { sessionId: "s1", timestamp: ts(0), metrics: { toolSuccessRate: 0.8 } },
  ];

  const trend = tracker.getTrends("toolSuccessRate");
  assert.ok(
    trend.trend.direction === TREND_DIRECTIONS.INSUFFICIENT_DATA ||
    trend.dataPoints < 2,
    "single data point flagged"
  );
});

test("getTrends: applies window and smoothing", () => {
  const tracker = new MetricsTracker();

  // 10 sessions
  for (let i = 0; i < 10; i++) {
    tracker._sessions.push({
      sessionId: `s${i}`,
      timestamp: ts(i),
      metrics: { avgResponseTimeMs: 5000 - i * 300 },
    });
  }

  // With window=5, only last 5 sessions
  const windowed = tracker.getTrends("avgResponseTimeMs", { window: 5 });
  assert.equal(windowed.sessionsAnalyzed, 5, "window limits to 5 sessions");

  // With smoothing
  const smoothed = tracker.getTrends("avgResponseTimeMs", { smooth: true });
  assert.ok(smoothed.movingAverage, "moving average computed when smooth=true");
  assert.equal(smoothed.movingAverage.length, smoothed.dataPoints,
    "moving average matches data point count");
});

test("getTrends: returns all-time stats", () => {
  const tracker = new MetricsTracker();

  tracker._sessions = [
    { sessionId: "s1", timestamp: ts(0), metrics: { tokenEfficiency: 0.3 } },
    { sessionId: "s2", timestamp: ts(1), metrics: { tokenEfficiency: 0.9 } },
    { sessionId: "s3", timestamp: ts(2), metrics: { tokenEfficiency: 0.5 } },
  ];

  const trend = tracker.getTrends("tokenEfficiency");
  assert.equal(trend.allTimeHigh, 0.9, "all-time high correct");
  assert.equal(trend.allTimeLow, 0.3, "all-time low correct");
});

// ---------------------------------------------------------------------------
// Tests: setGoals() and checkGoals()
// ---------------------------------------------------------------------------

test("setGoals: validates and stores goals", () => {
  const tracker = new MetricsTracker();

  const count = tracker.setGoals([
    { metric: "toolSuccessRate", target: 0.95, direction: "up", timeframe: "30d" },
    { metric: "errorRate", target: 0.05, direction: "down" },
    { metric: "avgResponseTimeMs", target: 2000, direction: "down", timeframe: "100sessions" },
    // Invalid — should be filtered out
    { metric: "invalid", target: "not-a-number", direction: "sideways" },
    {},
    null,
  ]);

  assert.equal(count, 3, "3 valid goals set, 3 invalid filtered");
});

test("checkGoals: tracks progress toward goals", () => {
  const tracker = new MetricsTracker();

  tracker.setGoals([
    { metric: "toolSuccessRate", target: 0.9, direction: "up" },
    { metric: "errorRate", target: 0.1, direction: "down" },
  ]);

  // Track some sessions
  tracker._sessions = [
    { sessionId: "s1", timestamp: ts(0), metrics: { toolSuccessRate: 0.8, errorRate: 0.15 } },
    { sessionId: "s2", timestamp: ts(1), metrics: { toolSuccessRate: 0.85, errorRate: 0.12 } },
  ];

  const result = tracker.checkGoals();
  assert.equal(result.goals.length, 2, "both goals checked");
  assert.ok(result.summary, "has summary");
  assert.ok(typeof result.overallProgress === "number", "has overall progress");

  // Check individual goal structure
  for (const goal of result.goals) {
    assert.ok(typeof goal.metric === "string", "has metric name");
    assert.ok(typeof goal.target === "number", "has target");
    assert.ok(["up", "down"].includes(goal.direction), "valid direction");
    assert.ok(["achieved", "in_progress", "not_started", "at_risk"].includes(goal.status),
      `valid status: ${goal.status}`);
    assert.ok(typeof goal.progress === "number", "has progress percentage");
  }
});

test("checkGoals: detects achieved goals", () => {
  const tracker = new MetricsTracker();

  tracker.setGoals([
    { metric: "errorRate", target: 0.1, direction: "down" },
  ]);

  tracker._sessions = [
    { sessionId: "s1", timestamp: ts(0), metrics: { errorRate: 0.05 } },
  ];

  const result = tracker.checkGoals();
  assert.equal(result.goals[0].status, "achieved", "goal achieved when under target");
});

test("checkGoals: handles no goals set", () => {
  const tracker = new MetricsTracker();
  const result = tracker.checkGoals();
  assert.equal(result.summary, "no goals set");
  assert.deepEqual(result.goals, []);
});

// ---------------------------------------------------------------------------
// Tests: getScorecard()
// ---------------------------------------------------------------------------

test("getScorecard: produces comprehensive scorecard", () => {
  const tracker = new MetricsTracker();

  // Track a mix of sessions
  tracker.trackSession(goodSession("g1"));
  tracker.trackSession(goodSession("g2"));
  tracker.trackSession(mixedSession("m1"));
  tracker.trackSession(badSession("b1"));

  const scorecard = tracker.getScorecard();

  assert.ok(scorecard.sessions > 0, "has session count");
  assert.ok(scorecard.scores, "has scores");
  assert.ok(typeof scorecard.overall === "number", "has overall score");
  assert.ok(["A", "B", "C", "D", "F", "N/A"].includes(scorecard.grade),
    `valid grade: ${scorecard.grade}`);

  // Dimension scores
  assert.ok(typeof scorecard.scores.toolReliability === "number",
    "tool reliability scored");
  assert.ok(typeof scorecard.scores.responseSpeed === "number",
    "response speed scored");
  assert.ok(typeof scorecard.scores.tokenEfficiency === "number",
    "token efficiency scored");
  assert.ok(typeof scorecard.scores.userSatisfaction === "number",
    "user satisfaction scored");
  assert.ok(typeof scorecard.scores.errorManagement === "number",
    "error management scored");

  // All scores within 0-100
  for (const [dim, score] of Object.entries(scorecard.scores)) {
    assert.ok(score >= 0 && score <= 100,
      `${dim} score ${score} is within 0-100`);
  }

  // Dimensions metadata
  assert.ok(scorecard.dimensions.toolReliability, "dimension metadata exists");
  assert.ok(scorecard.dimensions.responseSpeed, "response speed metadata");
  assert.ok(scorecard.dimensions.tokenEfficiency, "token efficiency metadata");
  assert.ok(scorecard.dimensions.userSatisfaction, "user satisfaction metadata");
  assert.ok(scorecard.dimensions.errorManagement, "error management metadata");

  // Raw metrics
  assert.ok(scorecard.rawMetrics, "raw metrics present");
  assert.ok(typeof scorecard.rawMetrics.avgToolSuccessRate === "number");
  assert.ok(typeof scorecard.rawMetrics.avgErrorRate === "number");

  // Trends
  assert.ok(scorecard.trends, "trends present");
});

test("getScorecard: handles empty tracker", () => {
  const tracker = new MetricsTracker();
  const scorecard = tracker.getScorecard();

  assert.equal(scorecard.sessions, 0);
  assert.equal(scorecard.overall, 0);
  assert.equal(scorecard.grade, "N/A");
  assert.equal(scorecard.summary, "insufficient data");
});

// ---------------------------------------------------------------------------
// Tests: getMetricNames()
// ---------------------------------------------------------------------------

test("getMetricNames: returns all available metric keys", () => {
  const tracker = new MetricsTracker();
  const names = tracker.getMetricNames();

  assert.ok(Array.isArray(names));
  assert.ok(names.includes("toolSuccessRate"), "includes toolSuccessRate");
  assert.ok(names.includes("avgResponseTimeMs"), "includes avgResponseTimeMs");
  assert.ok(names.includes("tokenEfficiency"), "includes tokenEfficiency");
  assert.ok(names.includes("userSatisfactionIndicator"), "includes userSatisfactionIndicator");
  assert.ok(names.includes("errorRate"), "includes errorRate");
});

// ---------------------------------------------------------------------------
// Tests: TREND_DIRECTIONS
// ---------------------------------------------------------------------------

test("TREND_DIRECTIONS: exports all expected constants", () => {
  assert.equal(TREND_DIRECTIONS.IMPROVING, "improving");
  assert.equal(TREND_DIRECTIONS.DECLINING, "declining");
  assert.equal(TREND_DIRECTIONS.STABLE, "stable");
  assert.equal(TREND_DIRECTIONS.INSUFFICIENT_DATA, "insufficient_data");
});

// ---------------------------------------------------------------------------
// Tests: satisfaction detection
// ---------------------------------------------------------------------------

test("trackSession: positive satisfaction from thankful messages", () => {
  const tracker = new MetricsTracker();
  const session = {
    id: "thankful",
    entries: [
      userMsg("Thanks, that is great and works perfectly!", 0),
      assistantMsg("Happy to help!", 1, { input_tokens: 50, output_tokens: 20 }),
    ],
  };
  const metrics = tracker.trackSession(session);
  assert.ok(metrics.userSatisfactionIndicator > 0.5,
    "positive satisfaction signals detected");
});

test("trackSession: negative satisfaction from complaint messages", () => {
  const tracker = new MetricsTracker();
  const session = {
    id: "unhappy",
    entries: [
      userMsg("This is wrong and doesn't work at all", 0),
      assistantMsg("Let me try again.", 1, { input_tokens: 80, output_tokens: 25 }),
    ],
  };
  const metrics = tracker.trackSession(session);
  assert.ok(metrics.userSatisfactionIndicator < 0.5,
    "negative satisfaction signals detected");
});
