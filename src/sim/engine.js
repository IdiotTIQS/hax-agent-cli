/**
 * SimulationEngine — deterministic multi-agent simulation runner.
 *
 * Runs agent-team scenarios step-by-step in a controlled mock environment,
 * producing repeatable results via a configurable random seed.
 */
"use strict";

const { EventEmitter } = require("node:events");

const DEFAULT_MAX_STEPS = 100;
const DEFAULT_TIME_LIMIT = 600_000; // 10 minutes
const DEFAULT_SEED = 42;

const RUN_STATUSES = new Set(["idle", "running", "paused", "completed", "failed", "cancelled", "timed_out"]);

// Simple deterministic PRNG (mulberry32)
function createRng(seed) {
  let state = Math.abs(seed | 0) || 1;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class SimulationEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this._scenarios = new Map();
    this._agents = [];
    this._rng = null;
    this._seed = options.seed !== undefined ? options.seed : DEFAULT_SEED;
    this._stepIndex = 0;
    this._startedAt = null;
    this._completedAt = null;
    this._status = "idle";
    this._history = [];
    this._currentScenario = null;
    this._config = {
      maxSteps: options.maxSteps || DEFAULT_MAX_STEPS,
      timeLimit: options.timeLimit || DEFAULT_TIME_LIMIT,
      stopOnFirstFailure: options.stopOnFirstFailure !== undefined ? options.stopOnFirstFailure : false,
      verbose: options.verbose || false,
    };
  }

  // ── Scenario management ─────────────────────────────────

  /**
   * Define a named simulation scenario.
   * @param {string} name - Unique scenario name.
   * @param {object} config - Scenario configuration.
   *   { description, agents:[], environment:{}, successCriteria:[], setupSteps:[], teardownSteps:[] }
   */
  createScenario(name, config = {}) {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new Error("Scenario name must be a non-empty string.");
    }

    const scenario = {
      name: name.trim(),
      description: String(config.description || "").trim(),
      agents: Array.isArray(config.agents) ? config.agents.map(clone) : [],
      environment: config.environment && typeof config.environment === "object" ? clone(config.environment) : {},
      successCriteria: Array.isArray(config.successCriteria) ? [...config.successCriteria] : [],
      setupSteps: Array.isArray(config.setupSteps) ? [...config.setupSteps] : [],
      teardownSteps: Array.isArray(config.teardownSteps) ? [...config.teardownSteps] : [],
      metadata: config.metadata && typeof config.metadata === "object" ? clone(config.metadata) : {},
    };

    this._scenarios.set(scenario.name, scenario);
    this.emit("scenario.created", { name: scenario.name, description: scenario.description });

    return scenario;
  }

  /**
   * Remove a scenario by name.
   */
  removeScenario(name) {
    return this._scenarios.delete(name);
  }

  /**
   * Get a scenario definition (shallow copy).
   */
  getScenario(name) {
    const scenario = this._scenarios.get(name);
    if (!scenario) {
      throw new Error(`Scenario not found: ${name}`);
    }
    return clone(scenario);
  }

  /**
   * List names of all defined scenarios.
   */
  listScenarios() {
    return [...this._scenarios.keys()];
  }

  // ── Agent management ────────────────────────────────────

  /**
   * Add an agent to the simulation.
   * @param {object} agent - Agent definition: { name, type, role, capabilities, model, behavior }
   * @param {string} role - Optional role override.
   */
  addAgent(agent, role) {
    if (!agent || typeof agent !== "object") {
      throw new Error("Agent must be an object.");
    }
    if (!agent.name || typeof agent.name !== "string") {
      throw new Error("Agent must have a string name.");
    }

    const normalized = {
      id: `sim-agent-${agent.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`,
      name: agent.name.trim(),
      type: agent.type || "general-purpose",
      role: role || agent.role || "participant",
      capabilities: Array.isArray(agent.capabilities) ? [...agent.capabilities] : [],
      model: agent.model || null,
      behavior: agent.behavior && typeof agent.behavior === "object" ? clone(agent.behavior) : null,
      status: "idle",
      interactions: 0,
      taskCount: 0,
      completedCount: 0,
      failedCount: 0,
    };

    this._agents.push(normalized);
    this.emit("agent.added", { id: normalized.id, name: normalized.name, role: normalized.role });

    return normalized;
  }

  /**
   * Remove an agent by name or id.
   */
  removeAgent(identifier) {
    const idx = this._findAgentIndex(identifier);
    if (idx === -1) {
      return false;
    }
    const [removed] = this._agents.splice(idx, 1);
    this.emit("agent.removed", { id: removed.id, name: removed.name });
    return true;
  }

  /**
   * Get an agent by name or id.
   */
  getAgent(identifier) {
    return this._agents.find((a) => a.name === identifier || a.id === identifier) || null;
  }

  // ── Simulation execution ────────────────────────────────

  /**
   * Run a complete simulation for the active scenario.
   * @param {object} [options={}]
   * @param {string} options.scenario - Scenario name to run.
   * @param {number} options.maxSteps - Override maxSteps.
   * @param {number} options.timeLimit - Override time limit in ms.
   * @param {number} options.seed - Override random seed for deterministic runs.
   * @param {object} options.context - Initial shared context.
   * @returns {object} Result summary.
   */
  run(options = {}) {
    const scenarioName = options.scenario || (this._currentScenario ? this._currentScenario.name : null);

    if (!scenarioName) {
      throw new Error("No scenario specified and no active scenario.");
    }

    const scenario = this._scenarios.get(scenarioName);
    if (!scenario) {
      throw new Error(`Scenario not found: ${scenarioName}`);
    }

    this._initialize(scenario, options);

    try {
      this._runLoop();
    } catch (err) {
      this._status = "failed";
      this._completedAt = new Date().toISOString();
      this._history.push({ step: this._stepIndex, event: "error", data: serializeError(err), timestamp: new Date().toISOString() });
      this.emit("simulation.error", { scenario: scenario.name, error: serializeError(err) });
    }

    return this.getResult();
  }

  /**
   * Advance the simulation by exactly one timestep.
   * @returns {object} The step result.
   */
  step() {
    if (this._status !== "running" && this._status !== "paused") {
      throw new Error(`Cannot step: simulation status is "${this._status}". Call run() first or reset().`);
    }

    if (this._status === "paused") {
      this._status = "running";
      this.emit("simulation.resumed", { scenario: this._currentScenario ? this._currentScenario.name : null, step: this._stepIndex });
    }

    const stepResult = this._executeStep();

    this._stepIndex++;
    this._checkCompletion(stepResult);

    return stepResult;
  }

  // ── State and history ───────────────────────────────────

  /**
   * Return the current simulation state.
   */
  getState() {
    return {
      status: this._status,
      stepIndex: this._stepIndex,
      currentScenario: this._currentScenario ? this._currentScenario.name : null,
      agents: this._agents.map(clone),
      startedAt: this._startedAt,
      completedAt: this._completedAt,
      config: { ...this._config },
      seed: this._seed,
    };
  }

  /**
   * Return the full event history.
   */
  getHistory() {
    return this._history.map(clone);
  }

  /**
   * Return the final outcome and computed metrics.
   */
  getResult() {
    const criteria = this._currentScenario ? this._currentScenario.successCriteria : [];
    const criteriaResults = this._evaluateCriteria(criteria);

    const agentStats = this._agents.map((agent) => ({
      name: agent.name,
      role: agent.role,
      interactions: agent.interactions,
      tasksAssigned: agent.taskCount,
      tasksCompleted: agent.completedCount,
      tasksFailed: agent.failedCount,
      successRate: agent.taskCount > 0 ? agent.completedCount / agent.taskCount : 0,
    }));

    const duration = this._startedAt && this._completedAt
      ? new Date(this._completedAt).getTime() - new Date(this._startedAt).getTime()
      : 0;

    return {
      scenario: this._currentScenario ? this._currentScenario.name : null,
      status: this._status,
      stepsExecuted: this._stepIndex,
      duration,
      criteriaResults,
      allCriteriaMet: criteriaResults.every((c) => c.met),
      agentStats,
      historyLength: this._history.length,
      startedAt: this._startedAt,
      completedAt: this._completedAt,
      seed: this._seed,
    };
  }

  // ── Control ─────────────────────────────────────────────

  /**
   * Pause a running simulation.
   */
  pause() {
    if (this._status !== "running") {
      return false;
    }
    this._status = "paused";
    this.emit("simulation.paused", { scenario: this._currentScenario ? this._currentScenario.name : null, step: this._stepIndex });
    return true;
  }

  /**
   * Reset the simulation engine to its initial state.
   */
  reset() {
    this._rng = null;
    this._stepIndex = 0;
    this._startedAt = null;
    this._completedAt = null;
    this._status = "idle";
    this._history = [];
    this._currentScenario = null;
    this._agents = [];
    this.emit("simulation.reset", {});
  }

  /**
   * Return the current run status.
   */
  getStatus() {
    return this._status;
  }

  // ── Internal helpers ────────────────────────────────────

  _initialize(scenario, options) {
    this._seed = options.seed !== undefined ? options.seed : this._seed;
    this._rng = createRng(this._seed);
    this._stepIndex = 0;
    this._startedAt = new Date().toISOString();
    this._completedAt = null;
    this._status = "running";
    this._history = [];
    this._currentScenario = scenario;

    if (options.maxSteps !== undefined) {
      this._config.maxSteps = normalizeInt(options.maxSteps, DEFAULT_MAX_STEPS);
    }
    if (options.timeLimit !== undefined) {
      this._config.timeLimit = normalizeInt(options.timeLimit, DEFAULT_TIME_LIMIT);
    }
    if (options.stopOnFirstFailure !== undefined) {
      this._config.stopOnFirstFailure = Boolean(options.stopOnFirstFailure);
    }

    // Reset agent stats
    for (const agent of this._agents) {
      agent.interactions = 0;
      agent.taskCount = 0;
      agent.completedCount = 0;
      agent.failedCount = 0;
      agent.status = "idle";
    }

    // Execute setup steps
    for (const setupStep of scenario.setupSteps) {
      if (typeof setupStep === "function") {
        setupStep(this._getContext(options.context));
      }
    }

    this.emit("simulation.started", { scenario: scenario.name, seed: this._seed, maxSteps: this._config.maxSteps });
    this._recordEvent("simulation_started", { scenario: scenario.name, seed: this._seed });

    return this._status;
  }

  _runLoop() {
    while (true) {
      if (this._isTimedOut()) {
        this._status = "timed_out";
        this._completedAt = new Date().toISOString();
        this._recordEvent("simulation_timed_out", { step: this._stepIndex });
        this.emit("simulation.timed_out", { scenario: this._currentScenario.name, step: this._stepIndex });
        break;
      }

      const stepResult = this._executeStep();
      this._stepIndex++;

      if (this._checkCompletion(stepResult)) {
        break;
      }
    }

    // Execute teardown steps
    if (this._currentScenario) {
      for (const teardownStep of this._currentScenario.teardownSteps) {
        if (typeof teardownStep === "function") {
          try {
            teardownStep();
          } catch (_) {
            // Suppress teardown errors
          }
        }
      }
    }
  }

  _executeStep() {
    const rngValue = this._rng();
    const agentCount = this._agents.length;

    // Select agents for this step using the PRNG
    const activeAgents = this._agents.length > 0
      ? this._selectActiveAgents(rngValue, agentCount)
      : [];

    const stepResult = {
      step: this._stepIndex,
      timestamp: new Date().toISOString(),
      rngValue,
      activeAgents: activeAgents.map((a) => a.name),
      actions: [],
    };

    for (const agent of activeAgents) {
      agent.status = "busy";
      agent.interactions++;

      const actionRng = this._rng();
      const action = this._simulateAgentAction(agent, actionRng, rngValue);

      stepResult.actions.push(action);

      this._recordEvent("agent_action", {
        agent: agent.name,
        action: action.type,
        outcome: action.outcome,
      });

      agent.status = "idle";
    }

    this.emit("simulation.step", stepResult);
    this._recordEvent("step_executed", stepResult);

    return stepResult;
  }

  _selectActiveAgents(rngValue, totalAgents) {
    if (totalAgents === 0) {
      return [];
    }

    // Use PRNG to select 1-3 agents per step
    const count = Math.min(totalAgents, 1 + Math.floor(rngValue * 3));
    const pool = [...this._agents];
    const selected = [];

    for (let i = 0; i < count; i++) {
      if (pool.length === 0) break;
      const idx = Math.floor(this._rng() * pool.length);
      selected.push(pool.splice(idx, 1)[0]);
    }

    return selected;
  }

  _simulateAgentAction(agent, actionRng, stepRng) {
    const outcomes = ["success", "partial_success", "failure", "needs_input"];
    const types = ["think", "communicate", "execute", "review", "decide"];

    const type = types[Math.floor(actionRng * types.length)];
    let outcome;

    if (stepRng < 0.1) {
      outcome = "failure";
    } else if (stepRng < 0.3) {
      outcome = "needs_input";
    } else if (stepRng < 0.5) {
      outcome = "partial_success";
    } else {
      outcome = "success";
    }

    // Track task stats
    agent.taskCount++;
    if (outcome === "success") {
      agent.completedCount++;
    } else if (outcome === "failure") {
      agent.failedCount++;
    }

    return {
      agent: agent.name,
      type,
      outcome,
      rngValue: actionRng,
      metadata: {
        role: agent.role,
        step: this._stepIndex,
      },
    };
  }

  _checkCompletion(stepResult) {
    // Check max steps
    if (this._stepIndex >= this._config.maxSteps) {
      this._status = "completed";
      this._completedAt = new Date().toISOString();
      this._recordEvent("max_steps_reached", { step: this._stepIndex });
      this.emit("simulation.max_steps", { scenario: this._currentScenario.name, step: this._stepIndex });
      return true;
    }

    // Check stop condition from scenario
    if (this._currentScenario && typeof this._currentScenario.environment.stopCondition === "function") {
      if (this._currentScenario.environment.stopCondition(this.getState())) {
        this._status = "completed";
        this._completedAt = new Date().toISOString();
        this._recordEvent("stop_condition_met", { step: this._stepIndex });
        this.emit("simulation.complete", { scenario: this._currentScenario.name, reason: "stopCondition" });
        return true;
      }
    }

    // Check stopOnFirstFailure
    if (this._config.stopOnFirstFailure && stepResult) {
      const hasFailure = stepResult.actions.some((a) => a.outcome === "failure");
      if (hasFailure) {
        this._status = "failed";
        this._completedAt = new Date().toISOString();
        this._recordEvent("first_failure", { step: this._stepIndex });
        this.emit("simulation.failed", { scenario: this._currentScenario.name, reason: "stopOnFirstFailure" });
        return true;
      }
    }

    return false;
  }

  _isTimedOut() {
    if (!this._startedAt) return false;
    const elapsed = Date.now() - new Date(this._startedAt).getTime();
    return elapsed >= this._config.timeLimit;
  }

  _evaluateCriteria(criteria) {
    return criteria.map((criterion) => {
      if (typeof criterion === "function") {
        try {
          return { description: criterion.name || "anonymous", met: criterion(this.getState(), this.getHistory()) };
        } catch (_) {
          return { description: criterion.name || "anonymous", met: false, error: true };
        }
      }
      if (criterion && typeof criterion === "object") {
        const met = typeof criterion.check === "function"
          ? criterion.check(this.getState(), this.getHistory())
          : false;
        return { description: criterion.description || "anonymous", met };
      }
      return { description: "anonymous", met: false };
    });
  }

  _findAgentIndex(identifier) {
    return this._agents.findIndex((a) => a.name === identifier || a.id === identifier);
  }

  _getContext(contextInput) {
    return contextInput && typeof contextInput === "object" ? { ...contextInput } : {};
  }

  _recordEvent(type, data) {
    this._history.push({
      step: this._stepIndex,
      event: type,
      data: clone(data),
      timestamp: new Date().toISOString(),
    });
  }
}

// ── Standalone helpers ────────────────────────────────────

function normalizeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function serializeError(err) {
  if (err instanceof Error) {
    return { name: err.name || "Error", message: err.message, stack: err.stack, code: err.code };
  }
  if (err && typeof err === "object") {
    return { name: "Error", message: JSON.stringify(err) };
  }
  return { name: "Error", message: String(err || "Unknown error") };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  SimulationEngine,
  createRng,
};
