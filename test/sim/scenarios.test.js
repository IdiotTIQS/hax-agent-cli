/**
 * Tests for pre-built simulation scenarios.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { SimulationEngine } = require("../../src/sim/engine");
const {
  SCENARIOS,
  getScenario,
  listScenarios,
  registerAll,
} = require("../../src/sim/scenarios");

// ── Scenario definitions ───────────────────────────────

test("SCENARIOS: all 6 scenarios are defined", () => {
  const keys = Object.keys(SCENARIOS);
  assert.equal(keys.length, 6);
  assert.ok(keys.includes("PAIR_PROGRAMMING"));
  assert.ok(keys.includes("BUG_HUNT"));
  assert.ok(keys.includes("CODE_REVIEW"));
  assert.ok(keys.includes("ARCHITECTURE_DEBATE"));
  assert.ok(keys.includes("REFACTOR_RACE"));
  assert.ok(keys.includes("SECURITY_AUDIT"));
});

test("SCENARIOS: each scenario has required fields", () => {
  const requiredFields = ["name", "description", "agents", "environment", "successCriteria"];

  for (const [key, scenario] of Object.entries(SCENARIOS)) {
    for (const field of requiredFields) {
      assert.ok(scenario[field] !== undefined, `${key} missing field: ${field}`);
    }
    assert.equal(typeof scenario.name, "string", `${key} name is not a string`);
    assert.ok(scenario.name.length > 0, `${key} name is empty`);
    assert.equal(typeof scenario.description, "string", `${key} description is not a string`);
    assert.ok(scenario.description.length > 0, `${key} description is empty`);
    assert.ok(Array.isArray(scenario.agents), `${key} agents is not an array`);
    assert.ok(scenario.agents.length >= 2, `${key} needs at least 2 agents`);
    assert.ok(Array.isArray(scenario.successCriteria), `${key} successCriteria is not an array`);
    assert.ok(scenario.successCriteria.length > 0, `${key} has no successCriteria`);
  }
});

test("SCENARIOS: all agents have required fields", () => {
  for (const [key, scenario] of Object.entries(SCENARIOS)) {
    for (const agent of scenario.agents) {
      assert.ok(agent.type, `${key} agent missing type`);
      assert.ok(agent.role, `${key} agent missing role`);
      assert.ok(Array.isArray(agent.capabilities), `${key} agent ${agent.type} capabilities not array`);
      assert.ok(agent.capabilities.length > 0, `${key} agent ${agent.type} has no capabilities`);
      assert.ok(agent.behavior, `${key} agent ${agent.type} missing behavior`);
    }
  }
});

test("SCENARIOS: all success criteria have check functions", () => {
  for (const [key, scenario] of Object.entries(SCENARIOS)) {
    for (let i = 0; i < scenario.successCriteria.length; i++) {
      const criterion = scenario.successCriteria[i];
      assert.ok(criterion.description, `${key} criterion ${i} missing description`);
      assert.equal(typeof criterion.check, "function", `${key} criterion ${i} check is not a function`);
    }
  }
});

test("SCENARIOS: all stopCondition functions are functions", () => {
  for (const [key, scenario] of Object.entries(SCENARIOS)) {
    const stop = scenario.environment.stopCondition;
    assert.ok(stop, `${key} missing stopCondition`);
    assert.equal(typeof stop, "function", `${key} stopCondition is not a function`);
  }
});

// ── getScenario ────────────────────────────────────────

test("getScenario: returns a deep copy", () => {
  const original = getScenario("PAIR_PROGRAMMING");
  const copy = getScenario("PAIR_PROGRAMMING");

  assert.equal(original.name, copy.name);
  assert.equal(original.description, copy.description);
  assert.notStrictEqual(original, copy);
  assert.notStrictEqual(original.agents, copy.agents);
});

test("getScenario: throws on unknown name", () => {
  assert.throws(() => getScenario("NONEXISTENT"), {
    message: /Unknown scenario/,
  });
});

// ── listScenarios ───────────────────────────────────────

test("listScenarios: returns all 6 with metadata", () => {
  const list = listScenarios();
  assert.equal(list.length, 6);
  for (const item of list) {
    assert.ok(item.name);
    assert.ok(item.description);
    assert.ok(typeof item.agentCount === "number");
    assert.ok(typeof item.criteriaCount === "number");
    assert.ok(item.agentCount > 0);
    assert.ok(item.criteriaCount > 0);
  }
});

// ── registerAll ────────────────────────────────────────

test("registerAll: registers all scenarios on an engine", () => {
  const engine = new SimulationEngine();
  registerAll(engine);

  const names = engine.listScenarios();
  assert.equal(names.length, 6);
  assert.ok(names.includes("pair_programming"));
  assert.ok(names.includes("bug_hunt"));
  assert.ok(names.includes("code_review"));
  assert.ok(names.includes("architecture_debate"));
  assert.ok(names.includes("refactor_race"));
  assert.ok(names.includes("security_audit"));
});

// ── Integration: run each scenario ─────────────────────

test("PAIR_PROGRAMMING: runs to completion with 2 agents", () => {
  const engine = new SimulationEngine({ maxSteps: 20 });
  registerAll(engine);
  engine.addAgent({ name: "driver" });
  engine.addAgent({ name: "navigator" });

  const result = engine.run({ scenario: "pair_programming" });
  assert.equal(result.status, "completed");
  assert.equal(result.agentStats.length, 2);
  assert.ok(result.criteriaResults.length > 0);
});

test("BUG_HUNT: runs to completion with 3 agents", () => {
  const engine = new SimulationEngine({ maxSteps: 30 });
  registerAll(engine);
  engine.addAgent({ name: "hunter" });
  engine.addAgent({ name: "fixer" });
  engine.addAgent({ name: "verifier" });

  const result = engine.run({ scenario: "bug_hunt" });
  assert.equal(result.status, "completed");
  assert.equal(result.agentStats.length, 3);
});

test("CODE_REVIEW: runs to completion with 2 agents", () => {
  const engine = new SimulationEngine({ maxSteps: 10 });
  registerAll(engine);
  engine.addAgent({ name: "implementer" });
  engine.addAgent({ name: "reviewer" });

  const result = engine.run({ scenario: "code_review" });
  assert.equal(result.status, "completed");
  assert.equal(result.agentStats.length, 2);
});

test("ARCHITECTURE_DEBATE: runs to completion with 2 agents", () => {
  const engine = new SimulationEngine({ maxSteps: 20 });
  registerAll(engine);
  engine.addAgent({ name: "proposer" });
  engine.addAgent({ name: "critic" });

  const result = engine.run({ scenario: "architecture_debate" });
  assert.equal(result.status, "completed");
  assert.equal(result.agentStats.length, 2);
});

test("REFACTOR_RACE: runs to completion with 3 agents", () => {
  const engine = new SimulationEngine({ maxSteps: 30 });
  registerAll(engine);
  engine.addAgent({ name: "refactor_a" });
  engine.addAgent({ name: "refactor_b" });
  engine.addAgent({ name: "judge" });

  const result = engine.run({ scenario: "refactor_race" });
  assert.equal(result.status, "completed");
  assert.equal(result.agentStats.length, 3);
});

test("SECURITY_AUDIT: runs to completion with 2 agents", () => {
  const engine = new SimulationEngine({ maxSteps: 20 });
  registerAll(engine);
  engine.addAgent({ name: "security_auditor" });
  engine.addAgent({ name: "developer" });

  const result = engine.run({ scenario: "security_audit" });
  assert.equal(result.status, "completed");
  assert.equal(result.agentStats.length, 2);
});

// ── Determinism across scenario runs ────────────────────

test("PAIR_PROGRAMMING: same seed produces identical results", () => {
  const runScenario = () => {
    const engine = new SimulationEngine({ maxSteps: 10 });
    registerAll(engine);
    engine.addAgent({ name: "driver" });
    engine.addAgent({ name: "navigator" });
    return engine.run({ scenario: "pair_programming", seed: 42 });
  };

  const r1 = runScenario();
  const r2 = runScenario();

  assert.equal(r1.stepsExecuted, r2.stepsExecuted);
  assert.equal(r1.historyLength, r2.historyLength);
  assert.equal(r1.allCriteriaMet, r2.allCriteriaMet);
});
