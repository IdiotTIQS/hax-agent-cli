"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ConversationPredictor,
  SUCCESS_THRESHOLD,
  FAILURE_THRESHOLD,
} = require("../../src/analytics/predictor");

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

function toolMsg(name, offset = 0, isError) {
  const entry = { timestamp: ts(offset), role: "tool", name };
  if (isError) entry.isError = true;
  return entry;
}

// Healthy session: low errors, good cadence
function healthySession() {
  return [
    userMsg("Please analyze the file structure and suggest improvements.", 0),
    assistantMsg("Let me start by reading the directory structure and config files.", 1, {
      input_tokens: 200,
      output_tokens: 80,
    }),
    toolMsg("glob", 2),
    assistantMsg("Found the structure. Now reading key files.", 3, {
      input_tokens: 350,
      output_tokens: 120,
    }),
    toolMsg("file.read", 4),
    toolMsg("file.read", 5),
    assistantMsg("I see the issues. Let me suggest edits.", 6, {
      input_tokens: 400,
      output_tokens: 200,
    }),
    userMsg("Those look good, please apply them.", 7),
    assistantMsg("Applying now.", 8, { input_tokens: 150, output_tokens: 60 }),
    toolMsg("file.edit", 9),
    toolMsg("file.edit", 10),
    assistantMsg("All changes applied and verified.", 11, {
      input_tokens: 180,
      output_tokens: 90,
    }),
  ];
}

// Error-prone session: repeated failures, short messages
function failingSession() {
  return [
    userMsg("Fix the bug now", 0),
    assistantMsg("Trying.", 1, { input_tokens: 80, output_tokens: 30 }),
    toolMsg("file.write", 2, true),
    assistantMsg("Failed, retrying.", 3, { input_tokens: 120, output_tokens: 40 }),
    toolMsg("file.write", 4, true),
    assistantMsg("Still failing.", 5, { input_tokens: 130, output_tokens: 35 }),
    toolMsg("file.write", 6, true),
    assistantMsg("Another attempt.", 7, { input_tokens: 140, output_tokens: 30 }),
    toolMsg("shell.run", 8, true),
    userMsg("???", 9),
    assistantMsg("Working on it...", 10, { input_tokens: 90, output_tokens: 25 }),
    toolMsg("shell.run", 11, true),
  ];
}

// Mixed session: some success, some failure, moderate cadence
function mixedSession() {
  return [
    userMsg("Can you refactor the auth module? It needs better error handling.", 0),
    assistantMsg("Let me review the current implementation first.", 1, {
      input_tokens: 250,
      output_tokens: 100,
    }),
    toolMsg("file.read", 2),
    assistantMsg("I see the structure. Let me make the changes.", 3, {
      input_tokens: 300,
      output_tokens: 150,
    }),
    toolMsg("file.edit", 4),
    toolMsg("file.edit", 5, true),
    assistantMsg("One edit failed. Let me fix that.", 6, {
      input_tokens: 280,
      output_tokens: 90,
    }),
    toolMsg("file.edit", 7),
    assistantMsg("Done. Now let me run the tests.", 8, {
      input_tokens: 200,
      output_tokens: 70,
    }),
    toolMsg("shell.run", 9),
    assistantMsg("Tests pass. Ready for review.", 10, {
      input_tokens: 160,
      output_tokens: 55,
    }),
  ];
}

// ---------------------------------------------------------------------------
// predictSuccess tests
// ---------------------------------------------------------------------------

test("predictSuccess: returns score, prediction, and factors", () => {
  const predictor = new ConversationPredictor();
  const result = predictor.predictSuccess(healthySession());

  assert.ok(typeof result.score === "number");
  assert.ok(result.score >= 0 && result.score <= 1);
  assert.ok(["success", "failure", "uncertain"].includes(result.prediction));
  assert.ok(result.factors);
  assert.ok(typeof result.factors.errorPatterns === "number");
  assert.ok(typeof result.factors.toolVelocity === "number");
  assert.ok(typeof result.factors.messageComplexity === "number");
  assert.ok(typeof result.factors.sessionRhythm === "number");
  assert.ok(typeof result.factors.recentTrend === "number");
});

test("predictSuccess: healthy session predicts success", () => {
  const predictor = new ConversationPredictor();
  const result = predictor.predictSuccess(healthySession());

  assert.ok(result.score >= SUCCESS_THRESHOLD, `score ${result.score} should be >= ${SUCCESS_THRESHOLD}`);
  assert.equal(result.prediction, "success");
});

test("predictSuccess: failing session predicts failure", () => {
  const predictor = new ConversationPredictor();
  const result = predictor.predictSuccess(failingSession());

  assert.ok(
    result.score <= FAILURE_THRESHOLD || result.prediction === "failure",
    `score ${result.score}, prediction ${result.prediction}`
  );
});

test("predictSuccess: mixed session is in between", () => {
  const predictor = new ConversationPredictor();
  const result = predictor.predictSuccess(mixedSession());

  // Mixed session should score higher than failing but may not reach success
  const failResult = predictor.predictSuccess(failingSession());
  assert.ok(result.score > failResult.score, "mixed session should score higher than failing session");
});

test("predictSuccess: empty session returns uncertain", () => {
  const predictor = new ConversationPredictor();
  const result = predictor.predictSuccess([]);

  assert.equal(result.score, 0.50);
  assert.equal(result.prediction, "uncertain");
  assert.deepEqual(result.factors, {});
});

test("predictSuccess: handles null session", () => {
  const predictor = new ConversationPredictor();
  const result = predictor.predictSuccess(null);

  assert.equal(result.score, 0.50);
  assert.equal(result.prediction, "uncertain");
});

test("predictSuccess: returns confidence in the prediction", () => {
  const predictor = new ConversationPredictor();
  const result = predictor.predictSuccess(healthySession());

  assert.ok(result.confidence);
  assert.ok(["low", "medium", "high"].includes(result.confidence.level));
  assert.ok(typeof result.confidence.value === "number");
  assert.ok(result.confidence.value > 0 && result.confidence.value <= 1);
});

// ---------------------------------------------------------------------------
// predictDuration tests
// ---------------------------------------------------------------------------

test("predictDuration: estimates remaining time for a session", () => {
  const predictor = new ConversationPredictor();
  const result = predictor.predictDuration(healthySession());

  assert.ok(typeof result.estimatedMs === "number");
  assert.ok(result.estimatedMs >= 0);
  assert.ok(typeof result.estimatedRemainingTurns === "number");
  assert.ok(result.estimatedRemainingTurns > 0);
  assert.ok(typeof result.confidence === "number");
  assert.ok(typeof result.reasoning === "string");
});

test("predictDuration: returns zero with insufficient data", () => {
  const predictor = new ConversationPredictor();
  const short = [userMsg("hi", 0)];

  const result = predictor.predictDuration(short);
  assert.equal(result.estimatedMs, 0);
  assert.equal(result.confidence, 0);
});

test("predictDuration: empty session handles gracefully", () => {
  const predictor = new ConversationPredictor();
  const result = predictor.predictDuration([]);

  assert.equal(result.estimatedMs, 0);
  assert.ok(result.reasoning.includes("insufficient"));
});

// ---------------------------------------------------------------------------
// predictToolNeeds tests
// ---------------------------------------------------------------------------

test("predictToolNeeds: returns sorted prediction list", () => {
  const predictor = new ConversationPredictor();
  const result = predictor.predictToolNeeds(healthySession());

  assert.ok(Array.isArray(result.predictions));
  assert.ok(result.predictions.length > 0, "should predict at least one tool");
  assert.ok(result.confidence > 0);

  // Check sort order (descending score)
  for (let i = 1; i < result.predictions.length; i++) {
    assert.ok(
      result.predictions[i - 1].score >= result.predictions[i].score,
      "predictions should be sorted by score descending"
    );
  }

  // Each prediction should have name and score
  for (const p of result.predictions) {
    assert.ok(typeof p.name === "string");
    assert.ok(typeof p.score === "number");
    assert.ok(p.score > 0 && p.score <= 1);
  }
});

test("predictToolNeeds: failing session predicts retry tools", () => {
  const predictor = new ConversationPredictor();
  const result = predictor.predictToolNeeds(failingSession());

  // file.write and shell.run should appear since they failed
  const names = result.predictions.map((p) => p.name);
  assert.ok(
    names.includes("file.write") || names.includes("shell.run"),
    "failing tools should appear in predictions"
  );
});

test("predictToolNeeds: empty session returns empty predictions", () => {
  const predictor = new ConversationPredictor();
  const result = predictor.predictToolNeeds([]);

  assert.deepEqual(result.predictions, []);
  assert.equal(result.confidence, 0);
});

// ---------------------------------------------------------------------------
// getConfidence tests
// ---------------------------------------------------------------------------

test("getConfidence: returns null before first prediction", () => {
  const predictor = new ConversationPredictor();
  assert.equal(predictor.getConfidence(), null);
});

test("getConfidence: returns confidence object after prediction", () => {
  const predictor = new ConversationPredictor();
  predictor.predictSuccess(healthySession());

  const conf = predictor.getConfidence();
  assert.ok(conf);
  assert.ok(["low", "medium", "high"].includes(conf.level));
  assert.ok(conf.dataPoints > 0);
});
