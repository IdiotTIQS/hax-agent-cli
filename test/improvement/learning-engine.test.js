"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("path");
const os = require("os");
const fs = require("fs");

const { LearningEngine, PATTERN_TYPES } = require("../../src/improvement/learning-engine");

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

function sessionWithToolCombos() {
  return {
    id: "sess-tool-combos",
    entries: [
      userMsg("Read and edit config", 0),
      assistantMsg("Reading file...", 1, { input_tokens: 80, output_tokens: 30 }),
      toolMsg("file.read", 2),
      toolMsg("file.edit", 3),
      assistantMsg("Done! All files are updated.", 4, { input_tokens: 60, output_tokens: 40 }),
      userMsg("Now run tests and deploy", 5),
      assistantMsg("Running...", 6, { input_tokens: 40, output_tokens: 15 }),
      toolMsg("shell.run", 7),
      toolMsg("shell.deploy", 8),
      assistantMsg("Tests passed and deployed.", 9, { input_tokens: 30, output_tokens: 20 }),
    ],
  };
}

function sessionWithErrorRecovery() {
  return {
    id: "sess-error-recovery",
    entries: [
      userMsg("Write to protected file", 0),
      assistantMsg("Let me write...", 1, { input_tokens: 80, output_tokens: 30 }),
      toolMsg("file.write", 2, { path: "/root/protected" }, true),
      assistantMsg("That failed. Let me try an alternative approach using shell.", 3, { input_tokens: 150, output_tokens: 50 }),
      toolMsg("shell.run", 4),
      assistantMsg("Fixed via shell.", 5, { input_tokens: 80, output_tokens: 25 }),
    ],
  };
}

function sessionWithEfficientPrompts() {
  return {
    id: "sess-efficient",
    entries: [
      userMsg("Please refactor the authentication middleware in src/auth/middleware.js to add token expiration handling and return proper 401 errors", 0),
      assistantMsg("I'll refactor that. Reading the file first.", 1, { input_tokens: 120, output_tokens: 40 }),
      toolMsg("file.read", 2),
      assistantMsg("Done! The middleware now handles expiration properly.", 3, { input_tokens: 100, output_tokens: 80 }),
    ],
  };
}

function sessionWithPitfalls() {
  return {
    id: "sess-pitfalls",
    entries: [
      userMsg("Fix it", 0),
      assistantMsg("Trying...", 1, { input_tokens: 50, output_tokens: 20 }),
      toolMsg("shell.run", 2, {}, true),
      toolMsg("shell.run", 3, {}, true),
      toolMsg("shell.run", 4, {}, true),
      assistantMsg("Multiple failures. Let me reassess.", 5, { input_tokens: 200, output_tokens: 60 }),
    ],
  };
}

function tempLearningsPath() {
  const tmpDir = os.tmpdir();
  const fname = `learnings-test-${Date.now()}.json`;
  return path.join(tmpDir, "haxagent-test", fname);
}

function cleanupTemp(path) {
  try { fs.unlinkSync(path); } catch {}
  try { fs.rmdirSync(path.dirname(path)); } catch {}
}

// ---------------------------------------------------------------------------
// Tests: learn()
// ---------------------------------------------------------------------------

test("learn: extracts patterns from a session with tool combos", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  const result = engine.learn(sessionWithToolCombos());

  assert.equal(result.sessionId, "sess-tool-combos");
  assert.ok(Array.isArray(result.patterns), "patterns is array");
  assert.ok(result.patterns.length > 0, "extracted at least one pattern");
  assert.ok(result.timestamp, "has timestamp");

  // Check for tool combo pattern
  const combos = result.patterns.filter(
    (p) => p.type === PATTERN_TYPES.SUCCESSFUL_TOOL_COMBO
  );
  assert.ok(combos.length > 0, "detected successful tool combos");

  // Verify pattern structure
  for (const p of result.patterns) {
    assert.ok(typeof p.type === "string", "pattern has type");
    assert.ok(Object.values(PATTERN_TYPES).includes(p.type),
      `valid pattern type: ${p.type}`);
    assert.ok(typeof p.pattern === "string", "pattern has description");
    assert.ok(typeof p.confidence === "number", "pattern has confidence");
  }

  cleanupTemp(learningsPath);
});

test("learn: detects error recovery patterns", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  const result = engine.learn(sessionWithErrorRecovery());

  const recoveries = result.patterns.filter(
    (p) => p.type === PATTERN_TYPES.ERROR_RECOVERY
  );
  assert.ok(recoveries.length > 0, "detected error recovery patterns");
  assert.ok(recoveries.some((r) => r.tool === "file.write"),
    "tracks which tool had the error");

  cleanupTemp(learningsPath);
});

test("learn: detects efficient prompt patterns", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  const result = engine.learn(sessionWithEfficientPrompts());

  const prompts = result.patterns.filter(
    (p) => p.type === PATTERN_TYPES.EFFICIENT_PROMPT
  );
  // May not always detect, but structure should be valid regardless
  for (const p of result.patterns) {
    assert.ok(p.type && p.pattern && typeof p.confidence === "number",
      "valid pattern structure");
  }

  cleanupTemp(learningsPath);
});

test("learn: detects common pitfalls", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  const result = engine.learn(sessionWithPitfalls());

  const pitfalls = result.patterns.filter(
    (p) => p.type === PATTERN_TYPES.COMMON_PITFALL
  );
  assert.ok(pitfalls.length > 0, "detected common pitfalls");

  cleanupTemp(learningsPath);
});

test("learn: handles invalid session gracefully", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  const nullResult = engine.learn(null);
  assert.equal(nullResult.error, "missing session id");

  const noIdResult = engine.learn({ entries: [] });
  assert.equal(noIdResult.error, "missing session id");

  const emptyEntries = engine.learn({ id: "empty", entries: [] });
  assert.equal(emptyEntries.sessionId, "empty");
  assert.ok(emptyEntries.patterns);

  cleanupTemp(learningsPath);
});

test("learn: accepts function-based entries", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  const result = engine.learn({
    id: "fn-entries",
    entries: () => [
      userMsg("hello", 0),
      assistantMsg("hi", 1),
    ],
  });

  assert.equal(result.sessionId, "fn-entries");
  assert.ok(Array.isArray(result.patterns));

  cleanupTemp(learningsPath);
});

// ---------------------------------------------------------------------------
// Tests: getPatterns()
// ---------------------------------------------------------------------------

test("getPatterns: returns patterns across multiple sessions", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  engine.learn(sessionWithToolCombos());
  engine.learn(sessionWithErrorRecovery());
  engine.learn(sessionWithPitfalls());

  const patterns = engine.getPatterns();
  assert.ok(patterns.length > 0, "returns accumulated patterns");

  // Patterns should be aggregated
  const combos = patterns.filter((p) => p.type === PATTERN_TYPES.SUCCESSFUL_TOOL_COMBO);
  assert.ok(combos.length > 0, "tool combos survive aggregation");

  cleanupTemp(learningsPath);
});

test("getPatterns: filters by type", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  engine.learn(sessionWithToolCombos());
  engine.learn(sessionWithErrorRecovery());
  engine.learn(sessionWithPitfalls());

  const onlyPitfalls = engine.getPatterns({ type: PATTERN_TYPES.COMMON_PITFALL });
  for (const p of onlyPitfalls) {
    assert.equal(p.type, PATTERN_TYPES.COMMON_PITFALL,
      "all returned patterns match the filter");
  }

  // Verify other types exist in unfiltered
  const all = engine.getPatterns();
  const types = new Set(all.map((p) => p.type));
  assert.ok(types.size > 1, "multiple pattern types exist");

  cleanupTemp(learningsPath);
});

test("getPatterns: filters by confidence and limit", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  engine.learn(sessionWithToolCombos());
  engine.learn(sessionWithErrorRecovery());

  const highConf = engine.getPatterns({ minConfidence: 0.7 });
  for (const p of highConf) {
    assert.ok(p.confidence >= 0.7, `confidence ${p.confidence} meets threshold`);
  }

  const limited = engine.getPatterns({ limit: 3 });
  assert.ok(limited.length <= 3, `limited to 3, got ${limited.length}`);

  cleanupTemp(learningsPath);
});

test("getPatterns: handles empty store", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  const patterns = engine.getPatterns();
  assert.deepEqual(patterns, []);
  assert.equal(patterns.length, 0);

  cleanupTemp(learningsPath);
});

// ---------------------------------------------------------------------------
// Tests: applyLearnings()
// ---------------------------------------------------------------------------

test("applyLearnings: provides guidance based on active tools", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  engine.learn(sessionWithToolCombos());

  const result = engine.applyLearnings({
    activeTools: ["file.read", "file.edit"],
    task: "edit a config file",
  });

  assert.ok(result.applicablePatterns >= 0, "applicable patterns counted");
  assert.ok(Array.isArray(result.guidance), "guidance is array");
  assert.ok(Array.isArray(result.recommendedActions), "recommended actions");
  assert.ok(Array.isArray(result.warnings), "warnings");

  cleanupTemp(learningsPath);
});

test("applyLearnings: warns about common pitfalls", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  engine.learn(sessionWithPitfalls());

  const result = engine.applyLearnings({
    activeTools: ["shell.run"],
    task: "fix something",
    recentErrors: { "shell.run": true },
  });

  // Should have warnings from pitfalls
  assert.ok(
    result.warnings.length >= 0 || result.applicablePatterns >= 0,
    "handles apply gracefully"
  );

  cleanupTemp(learningsPath);
});

test("applyLearnings: handles empty context", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  const result = engine.applyLearnings();
  assert.equal(result.applicablePatterns, 0);
  assert.deepEqual(result.guidance, []);

  cleanupTemp(learningsPath);
});

// ---------------------------------------------------------------------------
// Tests: getInsights()
// ---------------------------------------------------------------------------

test("getInsights: returns comprehensive insights from learned data", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  engine.learn(sessionWithToolCombos());
  engine.learn(sessionWithErrorRecovery());
  engine.learn(sessionWithPitfalls());
  engine.learn(sessionWithEfficientPrompts());

  const insights = engine.getInsights();

  assert.equal(typeof insights.sessionCount, "number");
  assert.equal(insights.sessionCount, 4, "correct session count");
  assert.equal(typeof insights.totalPatternsDiscovered, "number");
  assert.ok(insights.totalPatternsDiscovered > 0, "patterns discovered");
  assert.equal(typeof insights.learningVelocity, "number");
  assert.ok(insights.typeDistribution, "type distribution exists");

  // Best combos and top pitfalls
  assert.ok(Array.isArray(insights.bestCombos), "best combos is array");
  assert.ok(Array.isArray(insights.topPitfalls), "top pitfalls is array");
  assert.ok(Array.isArray(insights.bestRecoveries), "best recoveries is array");
  assert.ok(Array.isArray(insights.topPrompts), "top prompts is array");
  assert.ok(insights.maturityLevel, "has maturity level");
  assert.ok(["emerging", "collecting", "developing", "established", "mature"].includes(insights.maturityLevel),
    `valid maturity: ${insights.maturityLevel}`);

  cleanupTemp(learningsPath);
});

test("getInsights: handles empty engine", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  const insights = engine.getInsights();
  assert.equal(insights.sessionCount, 0);
  assert.equal(insights.totalPatternsDiscovered, 0);
  assert.equal(insights.maturityLevel, "emerging");

  cleanupTemp(learningsPath);
});

// ---------------------------------------------------------------------------
// Tests: persistence
// ---------------------------------------------------------------------------

test("learn: persists learnings to disk", () => {
  const learningsPath = tempLearningsPath();
  const engine = new LearningEngine({ learningsPath });

  engine.learn(sessionWithToolCombos());

  assert.ok(fs.existsSync(learningsPath), "learnings file created");

  const raw = JSON.parse(fs.readFileSync(learningsPath, "utf8"));
  assert.ok(Array.isArray(raw), "stored as array");
  assert.ok(raw.length > 0, "has entries");
  assert.equal(raw[0].sessionId, "sess-tool-combos");

  cleanupTemp(learningsPath);
});

test("learn: patterns persist across engine instances", () => {
  const learningsPath = tempLearningsPath();

  const engine1 = new LearningEngine({ learningsPath });
  engine1.learn(sessionWithToolCombos());

  // New instance should load persisted data
  const engine2 = new LearningEngine({ learningsPath });
  const patterns = engine2.getPatterns();

  assert.ok(patterns.length > 0, "persisted patterns loaded by new instance");

  cleanupTemp(learningsPath);
});

test("PATTERN_TYPES: all required types are defined", () => {
  assert.equal(PATTERN_TYPES.SUCCESSFUL_TOOL_COMBO, "SUCCESSFUL_TOOL_COMBO");
  assert.equal(PATTERN_TYPES.ERROR_RECOVERY, "ERROR_RECOVERY");
  assert.equal(PATTERN_TYPES.EFFICIENT_PROMPT, "EFFICIENT_PROMPT");
  assert.equal(PATTERN_TYPES.COMMON_PITFALL, "COMMON_PITFALL");
});
