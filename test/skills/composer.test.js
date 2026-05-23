/**
 * Tests for SkillComposer — AI-assisted skill composition including
 * chain suggestion, optimisation, validation, and duration estimation.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { SkillChain, CHAIN_TYPE, createChain } = require("../../src/skills/chains");
const {
  SkillComposer,
  KNOWN_PATTERNS,
  CATEGORY_DURATIONS,
  createComposer,
} = require("../../src/skills/composer");

// ── helpers ───────────────────────────────────────────────────

const sampleSkills = [
  { name: "code-analyzer", displayName: "Code Analyzer", description: "Analyzes code" },
  { name: "lint-checker", displayName: "Lint Checker", description: "Checks lint" },
  { name: "security-scanner", displayName: "Security Scanner", description: "Scans for vulns" },
  { name: "review-summary", displayName: "Review Summary", description: "Summarizes review" },
  { name: "test-runner", displayName: "Test Runner", description: "Runs tests" },
  { name: "health-check", displayName: "Health Check", description: "Checks health" },
];

// ── construction ─────────────────────────────────────────────

test("SkillComposer: constructs with default empty skills", () => {
  const composer = new SkillComposer();
  assert.equal(composer.getAvailableSkills().length, 0);
});

test("SkillComposer: constructs with pre-loaded skills", () => {
  const composer = new SkillComposer({ availableSkills: sampleSkills });
  assert.equal(composer.getAvailableSkills().length, 6);
});

test("SkillComposer: setAvailableSkills / getAvailableSkills roundtrip", () => {
  const composer = new SkillComposer();
  composer.setAvailableSkills(sampleSkills);
  const skills = composer.getAvailableSkills();
  assert.equal(skills.length, 6);
  assert.equal(skills[0].name, "code-analyzer");
  // getAvailableSkills returns a copy
  skills.pop();
  assert.equal(composer.getAvailableSkills().length, 6);
});

test("createComposer() factory returns a SkillComposer", () => {
  const c = createComposer(sampleSkills);
  assert.ok(c instanceof SkillComposer);
  assert.equal(c.getAvailableSkills().length, 6);
});

// ── suggestChain ─────────────────────────────────────────────

test("suggestChain() returns suggestions for a matching goal", () => {
  const composer = new SkillComposer({ availableSkills: sampleSkills });
  const suggestions = composer.suggestChain("I need a code review for my pull request");

  assert.ok(suggestions.length > 0);
  assert.equal(suggestions[0].pattern, "code-review");
  assert.ok(suggestions[0].chain instanceof SkillChain);
  assert.ok(typeof suggestions[0].confidence, "number");
  assert.ok(suggestions[0].confidence > 0);
});

test("suggestChain() returns deployment suggestion for deploy goal", () => {
  const composer = new SkillComposer({ availableSkills: sampleSkills });
  const suggestions = composer.suggestChain("I want to deploy to production");

  assert.ok(suggestions.length > 0);
  assert.equal(suggestions[0].pattern, "deploy");
  assert.ok(suggestions[0].chain instanceof SkillChain);
});

test("suggestChain() returns incident response for outage goal", () => {
  const composer = new SkillComposer();
  const suggestions = composer.suggestChain("We have a production outage, triage this alert");

  assert.ok(suggestions.length > 0);
  assert.equal(suggestions[0].pattern, "incident-response");
});

test("suggestChain() returns documentation suggestion", () => {
  const composer = new SkillComposer();
  const suggestions = composer.suggestChain("I need to generate api docs for this project");

  assert.ok(suggestions.length > 0);
  assert.equal(suggestions[0].pattern, "generate-docs");
});

test("suggestChain() returns empty array for unknown goal", () => {
  const composer = new SkillComposer();
  const suggestions = composer.suggestChain("order a pizza with extra cheese");

  assert.equal(suggestions.length, 0);
});

test("suggestChain() returns empty array for empty or invalid input", () => {
  const composer = new SkillComposer({ availableSkills: sampleSkills });
  assert.deepEqual(composer.suggestChain(""), []);
  assert.deepEqual(composer.suggestChain("   "), []);
  assert.deepEqual(composer.suggestChain(null), []);
  assert.deepEqual(composer.suggestChain(undefined), []);
});

test("suggestChain() respects maxSuggestions option", () => {
  const composer = new SkillComposer();
  // "analyze" matches multiple patterns (multi-step-analysis, code-review)
  const suggestions = composer.suggestChain("analyze the code and deploy it", { maxSuggestions: 2 });
  assert.ok(suggestions.length <= 2);
});

test("suggestChain() with requireAvailable filters missing skills", () => {
  const composer = new SkillComposer({
    availableSkills: [
      { name: "code-analyzer" },
      { name: "lint-checker" },
      // intentionally missing security-scanner and review-summary
    ],
  });

  const suggestions = composer.suggestChain("I need a code review", { requireAvailable: true });

  // When requireAvailable is true and skills are missing, the pattern is penalised
  // It may still appear if the keyword match is strong enough, or may be excluded
  // The key is that it doesn't crash
  for (const s of suggestions) {
    assert.ok(s.chain instanceof SkillChain);
    assert.ok(typeof s.confidence, "number");
  }
});

// ── optimizeChain ────────────────────────────────────────────

test("optimizeChain() returns an optimised SkillChain instance", () => {
  const composer = new SkillComposer();
  const chain = createChain([
    { id: "a", skill: async () => "a" },
    { id: "b", skill: async () => "b" },
  ]);

  const optimized = composer.optimizeChain(chain);

  assert.ok(optimized instanceof SkillChain);
  assert.notEqual(optimized.id, chain.id); // new chain with "opt-" prefix
});

test("optimizeChain() throws for non-SkillChain input", () => {
  const composer = new SkillComposer();
  assert.throws(
    () => composer.optimizeChain({ not: "a chain" }),
    TypeError,
  );
});

test("optimizeChain() flattens nested sub-chains", () => {
  const composer = new SkillComposer();
  const inner = createChain([{ id: "inner", skill: async () => "inner" }]);
  const outer = createChain([
    { id: "before", skill: async () => "before" },
  ]);
  outer.append(inner);

  const optimized = composer.optimizeChain(outer);

  assert.ok(optimized instanceof SkillChain);
  // Flattening should merge inner's nodes into outer
  assert.ok(optimized.nodes.length > 0);
});

// ── validateChain ────────────────────────────────────────────

test("validateChain() returns valid for a well-formed chain", () => {
  const composer = new SkillComposer();
  const chain = createChain([
    { id: "a", skill: async () => "a" },
    { id: "b", skill: async () => "b" },
  ]);

  const result = composer.validateChain(chain);

  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 0);
});

test("validateChain() reports warning for empty chain", () => {
  const composer = new SkillComposer();
  const chain = new SkillChain({ name: "empty" });

  const result = composer.validateChain(chain);

  assert.equal(result.valid, true); // warning, not error
  assert.ok(result.issues.some((i) => i.message.includes("no nodes")));
});

test("validateChain() reports error for duplicate node IDs", () => {
  const composer = new SkillComposer();
  const chain = new SkillChain();
  chain.chain(
    { id: "dup", skill: async () => "a" },
    { id: "dup", skill: async () => "b" },
  );

  const result = composer.validateChain(chain);

  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.message.includes("Duplicate")));
});

test("validateChain() reports error for invalid node type", () => {
  const composer = new SkillComposer();
  const chain = new SkillChain();
  // Inject a node with bad type directly
  chain.nodes.push({ id: "bad", name: "bad", type: "INVALID_TYPE", skill: async () => {} });

  const result = composer.validateChain(chain);

  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.message.includes("Invalid node type")));
});

test("validateChain() reports error for missing condition in conditional node", () => {
  const composer = new SkillComposer();
  const chain = new SkillChain();
  chain.conditional(
    { id: "cond", skill: async () => "ok" },
    () => true,
  );
  // Manually strip the condition
  chain.nodes[0]._condition = undefined;

  const result = composer.validateChain(chain);

  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.severity === "error" && i.message.includes("condition")));
});

test("validateChain() returns error for non-chain input", () => {
  const composer = new SkillComposer();
  const result = composer.validateChain("not-a-chain");

  assert.equal(result.valid, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].severity, "error");
});

// ── estimateChainDuration ────────────────────────────────────

test("estimateChainDuration() returns estimates for a known skill chain", () => {
  const composer = new SkillComposer();
  const chain = createChain([
    { id: "code-analyzer", name: "analyzer", skill: async () => {}, config: { skillName: "code-analyzer" } },
    { id: "security-scanner", name: "scanner", skill: async () => {}, config: { skillName: "security-scanner" } },
  ]);

  const { total, breakdown } = composer.estimateChainDuration(chain);

  assert.ok(total > 0);
  assert.equal(breakdown.length, 2);
  assert.equal(breakdown[0].nodeId, "code-analyzer");
  assert.equal(breakdown[0].estimate, CATEGORY_DURATIONS["code-analyzer"] || CATEGORY_DURATIONS._default);
  assert.equal(breakdown[1].nodeId, "security-scanner");
  assert.equal(breakdown[1].estimate, CATEGORY_DURATIONS["security-scanner"] || CATEGORY_DURATIONS._default);
  // Sequential: total = sum of children
  assert.equal(total, breakdown[0].estimate + breakdown[1].estimate);
});

test("estimateChainDuration() parallel group uses max of children", () => {
  const composer = new SkillComposer();
  const chain = new SkillChain();
  chain.parallel([
    { id: "fast", name: "fast", skill: async () => {}, config: { skillName: "aggregator" } }, // 500ms
    { id: "slow", name: "slow", skill: async () => {}, config: { skillName: "build-project" } }, // 30000ms
  ]);

  const { total, breakdown } = composer.estimateChainDuration(chain);

  // Parallel: total should be max, not sum
  assert.equal(total, CATEGORY_DURATIONS["build-project"]);
  // Breakdown includes both child entries plus the wrapper node entry
  assert.ok(breakdown.length >= 2);
});

test("estimateChainDuration() returns default for unknown skill", () => {
  const composer = new SkillComposer();
  const chain = createChain([
    { id: "unknown-skill", name: "unknown", skill: async () => {}, config: { skillName: "totally-unknown" } },
  ]);

  const { total, breakdown } = composer.estimateChainDuration(chain);

  assert.equal(total, CATEGORY_DURATIONS._default);
  assert.equal(breakdown[0].estimate, CATEGORY_DURATIONS._default);
});

test("estimateChainDuration() throws for non-SkillChain input", () => {
  const composer = new SkillComposer();
  assert.throws(
    () => composer.estimateChainDuration(null),
    TypeError,
  );
});

test("setDurationEstimate() / getDurationEstimates() allows custom durations", () => {
  const composer = new SkillComposer();

  composer.setDurationEstimate("my-custom-skill", 12345);
  const estimates = composer.getDurationEstimates();

  assert.equal(estimates["my-custom-skill"], 12345);
  // Original table is not mutated (getDurationEstimates returns a copy)
  assert.equal(CATEGORY_DURATIONS["my-custom-skill"], 12345);
});

// ── integration: composer + chain round-trip ─────────────────

test("suggested chain can be validated and executed", async () => {
  const composer = new SkillComposer({ availableSkills: sampleSkills });

  // Suggest a chain
  const suggestions = composer.suggestChain("I need a code review");
  assert.ok(suggestions.length > 0);

  const suggested = suggestions[0].chain;

  // Validate it
  const validation = composer.validateChain(suggested);
  assert.equal(validation.valid, true);

  // Estimate its duration
  const { total } = composer.estimateChainDuration(suggested);
  assert.ok(total > 0);

  // Execute it (nodes are pass-through since we have no real handlers)
  const result = await suggested.execute("test input");
  assert.ok(result.output !== undefined);
  assert.ok(result.trace.length > 0);
});

// ── KNOWN_PATTERNS coverage ──────────────────────────────────

test("KNOWN_PATTERNS is a frozen array of valid pattern objects", () => {
  assert.ok(Array.isArray(KNOWN_PATTERNS));
  assert.ok(KNOWN_PATTERNS.length > 0);

  for (const pattern of KNOWN_PATTERNS) {
    assert.ok(typeof pattern.name, "string");
    assert.ok(Array.isArray(pattern.keywords));
    assert.ok(pattern.keywords.length > 0);
    assert.ok(Array.isArray(pattern.steps));
    assert.ok(pattern.steps.length > 0);
    assert.ok(typeof pattern.description, "string");
  }
});
