/**
 * Pre-built simulation scenarios for the HaxAgent simulation engine.
 *
 * Each scenario is a reusable template defining agent roles, environment
 * settings, and success criteria for common multi-agent workflows.
 */
"use strict";

const SCENARIOS = {
  PAIR_PROGRAMMING: {
    name: "pair_programming",
    description: "Two agents collaborate on a coding task — a driver implements while a navigator reviews and suggests improvements in real time.",
    agents: [
      {
        type: "driver",
        role: "Driver — writes the implementation code",
        capabilities: ["write_file", "edit_file", "run_tests", "search_code"],
        behavior: { turnTakingChance: 0.6, reviewChance: 0.1 },
      },
      {
        type: "navigator",
        role: "Navigator — reviews code, suggests improvements, catches bugs early",
        capabilities: ["read_file", "suggest_edit", "run_analysis", "search_code"],
        behavior: { turnTakingChance: 0.4, reviewChance: 0.7 },
      },
    ],
    environment: {
      mode: "collaborative",
      sharedState: true,
      turnLimit: 50,
      stopCondition(state) {
        return state.stepIndex >= 40;
      },
    },
    successCriteria: [
      {
        description: "Driver produced at least one successful action",
        check(state, history) {
          return history.some((event) =>
            event.event === "agent_action" &&
            event.data.agent === "driver" &&
            event.data.outcome === "success"
          );
        },
      },
      {
        description: "Navigator reviewed or suggested changes",
        check(state, history) {
          return history.some((event) =>
            event.event === "agent_action" &&
            event.data.agent === "navigator"
          );
        },
      },
    ],
  },

  BUG_HUNT: {
    name: "bug_hunt",
    description: "Agents search a codebase for bugs, triage them by severity, and attempt fixes — simulating a debugging sprint.",
    agents: [
      {
        type: "hunter",
        role: "Bug Hunter — scans code, runs analyzers, identifies defects",
        capabilities: ["read_file", "search_code", "run_linter", "run_static_analysis"],
        behavior: { findChance: 0.4, falsePositiveChance: 0.15 },
      },
      {
        type: "fixer",
        role: "Fixer — triages found bugs and applies patches",
        capabilities: ["read_file", "edit_file", "write_file", "run_tests"],
        behavior: { fixSuccessChance: 0.7, regressionChance: 0.1 },
      },
      {
        type: "verifier",
        role: "Verifier — confirms fixes and checks for regressions",
        capabilities: ["run_tests", "run_linter", "read_file"],
        behavior: { verifySuccessChance: 0.85 },
      },
    ],
    environment: {
      mode: "sequential",
      sharedState: true,
      bugCount: 10,
      stopCondition(state) {
        return state.stepIndex >= 60;
      },
    },
    successCriteria: [
      {
        description: "At least one bug was found",
        check(state, history) {
          return history.some((event) =>
            event.event === "agent_action" &&
            event.data.agent === "hunter" &&
            event.data.action === "execute" &&
            event.data.outcome !== "failure"
          );
        },
      },
      {
        description: "At least one fix was attempted",
        check(state, history) {
          return history.some((event) =>
            event.event === "agent_action" &&
            event.data.agent === "fixer"
          );
        },
      },
      {
        description: "Verification was performed",
        check(state, history) {
          return history.some((event) =>
            event.event === "agent_action" &&
            event.data.agent === "verifier"
          );
        },
      },
    ],
  },

  CODE_REVIEW: {
    name: "code_review",
    description: "An implementer submits work for review. A reviewer evaluates the code, finds issues, and either approves or requests changes.",
    agents: [
      {
        type: "implementer",
        role: "Implementer — writes the feature code and responds to review feedback",
        capabilities: ["write_file", "edit_file", "run_tests", "search_code"],
        behavior: { responseQuality: 0.8, iterationSpeed: 0.6 },
      },
      {
        type: "reviewer",
        role: "Reviewer — evaluates code quality, finds issues, approves or rejects",
        capabilities: ["read_file", "suggest_edit", "run_analysis", "run_linter"],
        behavior: { strictness: 0.7, nitpickChance: 0.3, approvalThreshold: 3 },
      },
    ],
    environment: {
      mode: "turn_based",
      sharedState: true,
      reviewRounds: 3,
      stopCondition(state) {
        return state.stepIndex >= 30;
      },
    },
    successCriteria: [
      {
        description: "Reviewer found issues or approved the work",
        check(state, history) {
          return history.some((event) =>
            event.event === "agent_action" &&
            event.data.agent === "reviewer"
          );
        },
      },
      {
        description: "Implementer responded to review",
        check(state, history) {
          return history.some((event) =>
            event.event === "agent_action" &&
            event.data.agent === "implementer" &&
            event.data.action === "execute"
          );
        },
      },
    ],
  },

  ARCHITECTURE_DEBATE: {
    name: "architecture_debate",
    description: "Two agents debate competing design approaches for a system. One proposes a solution, the other critiques it — driving toward the best architecture via adversarial collaboration.",
    agents: [
      {
        type: "proposer",
        role: "Proposer — advocates for a specific architectural approach with evidence",
        capabilities: ["search_code", "read_file", "write_file"],
        behavior: { confidence: 0.75, evidenceQuality: 0.8 },
      },
      {
        type: "critic",
        role: "Critic — challenges assumptions, points out trade-offs, proposes alternatives",
        capabilities: ["search_code", "read_file", "run_analysis"],
        behavior: { skepticism: 0.8, alternativeChance: 0.5 },
      },
    ],
    environment: {
      mode: "debate",
      sharedState: true,
      maxRounds: 5,
      stopCondition(state) {
        return state.stepIndex >= 40;
      },
    },
    successCriteria: [
      {
        description: "Proposer made at least one argument",
        check(state, history) {
          return history.some((event) =>
            event.event === "agent_action" &&
            event.data.agent === "proposer"
          );
        },
      },
      {
        description: "Critic challenged or responded",
        check(state, history) {
          return history.some((event) =>
            event.event === "agent_action" &&
            event.data.agent === "critic"
          );
        },
      },
      {
        description: "Both agents participated",
        check(state, history) {
          const proposerActions = history.filter((e) =>
            e.event === "agent_action" && e.data.agent === "proposer"
          ).length;
          const criticActions = history.filter((e) =>
            e.event === "agent_action" && e.data.agent === "critic"
          ).length;
          return proposerActions > 0 && criticActions > 0;
        },
      },
    ],
  },

  REFACTOR_RACE: {
    name: "refactor_race",
    description: "Two agents independently refactor the same code block using different strategies. Results are compared for efficiency, readability, and correctness.",
    agents: [
      {
        type: "refactor_a",
        role: "Refactor Agent A — applies an extract-method / functional approach",
        capabilities: ["read_file", "edit_file", "write_file", "run_tests"],
        behavior: { strategy: "functional", speedBias: 0.7, qualityBias: 0.6 },
      },
      {
        type: "refactor_b",
        role: "Refactor Agent B — applies an OOP / class-based approach",
        capabilities: ["read_file", "edit_file", "write_file", "run_tests"],
        behavior: { strategy: "oop", speedBias: 0.5, qualityBias: 0.8 },
      },
      {
        type: "judge",
        role: "Judge — compares both refactored outputs and declares a winner",
        capabilities: ["read_file", "run_analysis", "run_linter"],
        behavior: { fairness: 0.9, criteria: ["readability", "correctness", "efficiency"] },
      },
    ],
    environment: {
      mode: "parallel_race",
      sharedState: false,
      stopCondition(state) {
        return state.stepIndex >= 50;
      },
    },
    successCriteria: [
      {
        description: "Both refactor agents completed their work",
        check(state, history) {
          const refactorAActions = history.filter((e) =>
            e.event === "agent_action" && e.data.agent === "refactor_a"
          ).length;
          const refactorBActions = history.filter((e) =>
            e.event === "agent_action" && e.data.agent === "refactor_b"
          ).length;
          return refactorAActions > 0 && refactorBActions > 0;
        },
      },
      {
        description: "Judge evaluated both results",
        check(state, history) {
          return history.some((event) =>
            event.event === "agent_action" &&
            event.data.agent === "judge"
          );
        },
      },
    ],
  },

  SECURITY_AUDIT: {
    name: "security_audit",
    description: "A security agent scans the codebase for vulnerabilities (injection, XSS, auth bypass, hardcoded secrets), reports findings by severity, and proposes remediations.",
    agents: [
      {
        type: "security_auditor",
        role: "Security Auditor — performs vulnerability scanning and threat modeling",
        capabilities: ["read_file", "search_code", "run_static_analysis", "run_dependency_check"],
        behavior: { thoroughness: 0.9, falsePositiveRate: 0.1, severityBias: 0.5 },
      },
      {
        type: "developer",
        role: "Developer — receives audit results and applies security fixes",
        capabilities: ["read_file", "edit_file", "write_file", "run_tests"],
        behavior: { fixCompliance: 0.85, fixSpeed: 0.6 },
      },
    ],
    environment: {
      mode: "audit",
      sharedState: true,
      vulnerabilityDensity: "medium",
      stopCondition(state) {
        return state.stepIndex >= 45;
      },
    },
    successCriteria: [
      {
        description: "Auditor scanned for vulnerabilities",
        check(state, history) {
          return history.some((event) =>
            event.event === "agent_action" &&
            event.data.agent === "security_auditor" &&
            event.data.action === "execute"
          );
        },
      },
      {
        description: "Developer remediated at least one finding",
        check(state, history) {
          return history.some((event) =>
            event.event === "agent_action" &&
            event.data.agent === "developer"
          );
        },
      },
      {
        description: "No unrecoverable failures in the audit",
        check(state, history) {
          const failures = history.filter((event) =>
            event.event === "agent_action" &&
            event.data.outcome === "failure"
          ).length;
          const total = history.filter((event) =>
            event.event === "agent_action"
          ).length;
          return total === 0 || failures / total < 0.5;
        },
      },
    ],
  },
};

/**
 * Return a deep copy of a scenario so callers cannot mutate the originals.
 * @param {string} name - One of the SCENARIOS keys.
 * @returns {object}
 */
function getScenario(name) {
  const scenario = SCENARIOS[name];
  if (!scenario) {
    throw new Error(`Unknown scenario: ${name}. Available: ${Object.keys(SCENARIOS).join(", ")}`);
  }
  return clone(scenario);
}

/**
 * Return light metadata for all scenarios.
 */
function listScenarios() {
  return Object.keys(SCENARIOS).map((key) => ({
    name: SCENARIOS[key].name,
    description: SCENARIOS[key].description,
    agentCount: SCENARIOS[key].agents.length,
    criteriaCount: SCENARIOS[key].successCriteria.length,
  }));
}

/**
 * Register all pre-built scenarios on a SimulationEngine instance.
 * @param {import('./engine').SimulationEngine} engine
 */
function registerAll(engine) {
  for (const scenario of Object.values(SCENARIOS)) {
    engine.createScenario(scenario.name, scenario);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  SCENARIOS,
  getScenario,
  listScenarios,
  registerAll,
};
