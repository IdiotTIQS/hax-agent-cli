"use strict";

const { EventEmitter } = require("node:events");

const STEP_TYPES = new Set(["tool", "agent", "condition", "wait", "parallel"]);
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
const DEFAULT_TIMEOUT = 300_000; // 5 minutes
const DEFAULT_RETRY_COUNT = 0;
const DEFAULT_RETRY_DELAY = 1_000; // 1 second

class WorkflowEngine extends EventEmitter {
  constructor() {
    super();
    this._workflows = new Map();
    this._runs = new Map();
    this._runCounter = 0;
    this._cancelTokens = new Map();
  }

  // ---- Definition ----

  /**
   * Define (or overwrite) a named workflow.
   * @param {string} name - Unique workflow name.
   * @param {Array<object>} steps - Array of step definitions.
   *   Each step: { id, name, type, config, retryCount?, retryDelay?, timeout?, continueOnError?, condition? }
   */
  define(name, steps) {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new Error("Workflow name must be a non-empty string.");
    }
    if (!Array.isArray(steps)) {
      throw new Error("Workflow steps must be an array.");
    }

    const normalized = steps.map((step, index) => this._normalizeStep(step, index));
    this._validateSteps(normalized);

    this._workflows.set(name.trim(), {
      name: name.trim(),
      steps: normalized,
      createdAt: new Date().toISOString(),
    });

    return this;
  }

  /**
   * Return the definition for a workflow (shallow copy).
   */
  getDefinition(name) {
    const workflow = this._workflows.get(name);
    if (!workflow) {
      throw new Error(`Workflow not found: ${name}`);
    }
    return {
      name: workflow.name,
      steps: workflow.steps.map(clone),
      createdAt: workflow.createdAt,
    };
  }

  /**
   * List names of all defined workflows.
   */
  list() {
    return [...this._workflows.keys()];
  }

  /**
   * Remove a workflow definition.
   */
  remove(name) {
    const existed = this._workflows.delete(name);
    return existed;
  }

  // ---- Execution ----

  /**
   * Run a workflow sequentially, respecting `dependsOn` for parallelisation
   * inside each topological level.
   * @param {string} name - Workflow name.
   * @param {object} [context={}] - Shared context passed to each step handler.
   * @returns {Promise<object>} run summary.
   */
  async run(name, context = {}) {
    const definition = this._resolveWorkflow(name);
    const runId = this._nextRunId();
    const runState = this._createRunState(runId, name, context, "sequential");

    this._runs.set(runId, runState);

    try {
      await this._executeSequential(definition, runState);
      // Preserve pre-existing terminal status (e.g. cancelled) instead of overwriting
      if (!TERMINAL_STATES.has(runState.status)) {
        runState.status = "completed";
      }
      runState.completedAt = new Date().toISOString();
      this.emit("workflow.complete", { runId, workflowName: name, status: runState.status, summary: this._summarizeRun(runState) });
    } catch (err) {
      if (runState.status === "cancelled") {
        this.emit("workflow.complete", { runId, workflowName: name, status: "cancelled", summary: this._summarizeRun(runState) });
      } else {
        runState.status = "failed";
        runState.error = serializeError(err);
        runState.completedAt = new Date().toISOString();
        this.emit("workflow.complete", { runId, workflowName: name, status: "failed", error: runState.error, summary: this._summarizeRun(runState) });
      }
    }

    return this.status(runId);
  }

  /**
   * Run a workflow where steps with no interdependencies can execute in parallel.
   * Steps that share the same topological level (no blocking deps in that level)
   * are run concurrently with Promise.all.
   * @param {string} name
   * @param {object} [context={}]
   * @returns {Promise<object>}
   */
  async runParallel(name, context = {}) {
    const definition = this._resolveWorkflow(name);
    const runId = this._nextRunId();
    const runState = this._createRunState(runId, name, context, "parallel");

    this._runs.set(runId, runState);

    try {
      await this._executeParallel(definition, runState);
      // Preserve pre-existing terminal status (e.g. cancelled) instead of overwriting
      if (!TERMINAL_STATES.has(runState.status)) {
        runState.status = "completed";
      }
      runState.completedAt = new Date().toISOString();
      this.emit("workflow.complete", { runId, workflowName: name, status: "completed", summary: this._summarizeRun(runState) });
    } catch (err) {
      if (runState.status === "cancelled") {
        this.emit("workflow.complete", { runId, workflowName: name, status: "cancelled", summary: this._summarizeRun(runState) });
      } else {
        runState.status = "failed";
        runState.error = serializeError(err);
        runState.completedAt = new Date().toISOString();
        this.emit("workflow.complete", { runId, workflowName: name, status: "failed", error: runState.error, summary: this._summarizeRun(runState) });
      }
    }

    return this.status(runId);
  }

  // ---- Run status / cancellation ----

  /**
   * Return the current status of a workflow run.
   * @param {string} runId
   * @returns {object}
   */
  status(runId) {
    const run = this._runs.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    return this._summarizeRun(run);
  }

  /**
   * Request cancellation of a running workflow.
   * @param {string} runId
   * @returns {boolean} whether cancellation was requested.
   */
  cancel(runId) {
    const run = this._runs.get(runId);
    if (!run) {
      return false;
    }
    if (TERMINAL_STATES.has(run.status)) {
      return false;
    }

    run.status = "cancelled";
    run.completedAt = new Date().toISOString();

    const token = this._cancelTokens.get(runId);
    if (token) {
      token.cancelled = true;
    }

    this.emit("workflow.cancel", { runId, workflowName: run.workflowName });

    return true;
  }

  // ---- Internal: execution engines ----

  async _executeSequential(definition, runState) {
    for (const step of definition.steps) {
      if (this._isCancelled(runState.runId)) {
        throw new Error("Workflow cancelled.");
      }
      await this._executeStepWithRetry(step, runState);
    }
  }

  async _executeParallel(definition, runState) {
    const levels = this._topologicalLevels(definition.steps);
    const completed = new Set();

    for (const level of levels) {
      if (this._isCancelled(runState.runId)) {
        throw new Error("Workflow cancelled.");
      }

      const batch = level.filter((step) => {
        return step.dependsOn.every((depId) => completed.has(depId));
      });

      const results = await Promise.all(
        batch.map((step) =>
          this._executeStepWithRetry(step, runState).then(
            (result) => ({ stepId: step.id, status: "ok", result }),
            (err) => ({ stepId: step.id, status: "error", error: err }),
          ),
        ),
      );

      for (const r of results) {
        if (r.status === "ok") {
          completed.add(r.stepId);
        } else if (!this._shouldContinueOnError(definition.steps, r.stepId)) {
          throw r.error;
        }
      }
    }
  }

  async _executeStepWithRetry(step, runState) {
    const maxRetries = step.retryCount || 0;
    const retryDelay = step.retryDelay || DEFAULT_RETRY_DELAY;
    const timeout = step.timeout || DEFAULT_TIMEOUT;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (this._isCancelled(runState.runId)) {
        throw new Error("Workflow cancelled.");
      }

      try {
        return await this._executeStep(step, runState, timeout, attempt);
      } catch (err) {
        lastError = err;

        this.emit("step.error", {
          runId: runState.runId,
          workflowName: runState.workflowName,
          stepId: step.id,
          stepName: step.name,
          attempt,
          error: serializeError(err),
        });

        if (attempt < maxRetries) {
          await sleep(retryDelay);
        }
      }
    }

    if (step.continueOnError) {
      this._recordStepResult(runState, step.id, {
        status: "failed_but_continued",
        error: serializeError(lastError),
        startedAt: null,
        completedAt: new Date().toISOString(),
      });
      return { skipped: true, error: serializeError(lastError) };
    }

    throw lastError;
  }

  async _executeStep(step, runState, timeout, attempt) {
    // Evaluate condition
    if (step.condition !== undefined) {
      const condResult = typeof step.condition === "function"
        ? step.condition(runState.context)
        : step.condition;
      if (!condResult) {
        this.emit("step.skip", {
          runId: runState.runId,
          workflowName: runState.workflowName,
          stepId: step.id,
          stepName: step.name,
          reason: "condition evaluated to false",
        });
        return null;
      }
    }

    const startedAt = new Date().toISOString();

    this.emit("step.start", {
      runId: runState.runId,
      workflowName: runState.workflowName,
      stepId: step.id,
      stepName: step.name,
      stepType: step.type,
      attempt,
      startedAt,
    });

    let result;
    let error;

    try {
      result = await withTimeout(
        this._invokeStep(step, runState),
        timeout,
        `Step "${step.id}" timed out after ${timeout}ms`,
      );
    } catch (err) {
      error = err;
    }

    const completedAt = new Date().toISOString();

    if (error) {
      throw error;
    }

    this._recordStepResult(runState, step.id, {
      status: "completed",
      result,
      startedAt,
      completedAt,
    });

    this.emit("step.complete", {
      runId: runState.runId,
      workflowName: runState.workflowName,
      stepId: step.id,
      stepName: step.name,
      stepType: step.type,
      attempt,
      startedAt,
      completedAt,
      duration: new Date(completedAt) - new Date(startedAt),
      result,
    });

    return result;
  }

  async _invokeStep(step, runState) {
    switch (step.type) {
      case "tool": {
        if (typeof step.config.handler !== "function") {
          throw new Error(`Tool step "${step.id}" requires a config.handler function.`);
        }
        return step.config.handler(runState.context, step.config);
      }
      case "agent": {
        if (typeof step.config.handler !== "function") {
          throw new Error(`Agent step "${step.id}" requires a config.handler function.`);
        }
        return step.config.handler(runState.context, step.config);
      }
      case "condition": {
        if (typeof step.config.evaluate !== "function") {
          throw new Error(`Condition step "${step.id}" requires a config.evaluate function.`);
        }
        const passed = step.config.evaluate(runState.context, step.config);
        return { condition: passed };
      }
      case "wait": {
        const duration = step.config.duration || 1000;
        return sleep(duration).then(() => ({ waited: duration }));
      }
      case "parallel": {
        if (!Array.isArray(step.config.steps)) {
          throw new Error(`Parallel step "${step.id}" requires config.steps array.`);
        }
        const results = await Promise.all(
          step.config.steps.map((subStep) =>
            this._executeStep(this._normalizeStep(subStep), runState, step.timeout || DEFAULT_TIMEOUT, 0),
          ),
        );
        return { parallel: results };
      }
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  // ---- Internal helpers ----

  _resolveWorkflow(name) {
    const workflow = this._workflows.get(name);
    if (!workflow) {
      throw new Error(`Workflow not found: ${name}`);
    }
    return workflow;
  }

  _nextRunId() {
    this._runCounter += 1;
    return `run-${Date.now().toString(36)}-${this._runCounter}`;
  }

  _createRunState(runId, workflowName, context, mode) {
    // Initialize cancel token so cancel() can signal mid-flight
    this._cancelTokens.set(runId, { cancelled: false });

    return {
      runId,
      workflowName,
      context: context && typeof context === "object" ? { ...context } : {},
      mode,
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      steps: {},
    };
  }

  _recordStepResult(runState, stepId, record) {
    runState.steps[stepId] = record;
  }

  _summarySteps(runState, definition) {
    const stepIds = definition ? definition.steps.map((s) => s.id) : Object.keys(runState.steps);
    return stepIds.map((id) => runState.steps[id] || { status: "pending" });
  }

  _summarizeRun(run) {
    const definition = this._workflows.get(run.workflowName);
    return {
      runId: run.runId,
      workflowName: run.workflowName,
      mode: run.mode,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      error: run.error,
      context: run.context,
      steps: this._summarySteps(run, definition),
    };
  }

  _normalizeStep(step, index) {
    if (!step || typeof step !== "object") {
      throw new Error(`Step at index ${index} must be an object, got ${typeof step}.`);
    }

    if (!step.id || typeof step.id !== "string") {
      throw new Error(`Step at index ${index} must have a string "id".`);
    }

    if (!STEP_TYPES.has(step.type)) {
      throw new Error(
        `Step "${step.id}" has invalid type "${step.type}". Must be one of: ${[...STEP_TYPES].join(", ")}.`,
      );
    }

    return {
      id: step.id.trim(),
      name: String(step.name || step.id).trim(),
      type: step.type,
      config: step.config && typeof step.config === "object" ? step.config : {},
      retryCount: normalizeInt(step.retryCount, 0),
      retryDelay: normalizeInt(step.retryDelay, DEFAULT_RETRY_DELAY),
      timeout: normalizeInt(step.timeout, DEFAULT_TIMEOUT),
      continueOnError: Boolean(step.continueOnError),
      condition: step.condition !== undefined ? step.condition : undefined,
      dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn.map(String) : [],
    };
  }

  _validateSteps(steps) {
    const ids = new Set();
    for (const step of steps) {
      if (ids.has(step.id)) {
        throw new Error(`Duplicate step id: "${step.id}".`);
      }
      ids.add(step.id);
    }

    // Validate dependsOn references
    for (const step of steps) {
      for (const depId of step.dependsOn) {
        if (!ids.has(depId)) {
          throw new Error(`Step "${step.id}" depends on unknown step: "${depId}".`);
        }
      }
    }

    // Check for circular dependencies
    this._checkCircularDeps(steps);
  }

  _checkCircularDeps(steps) {
    const adjacency = new Map();
    for (const step of steps) {
      adjacency.set(step.id, step.dependsOn);
    }

    const visited = new Set();
    const recStack = new Set();

    const dfs = (id) => {
      visited.add(id);
      recStack.add(id);

      for (const dep of adjacency.get(id) || []) {
        if (!visited.has(dep)) {
          if (dfs(dep)) return true;
        } else if (recStack.has(dep)) {
          return true;
        }
      }

      recStack.delete(id);
      return false;
    };

    for (const step of steps) {
      if (!visited.has(step.id)) {
        if (dfs(step.id)) {
          throw new Error("Circular dependency detected in workflow steps.");
        }
      }
    }
  }

  _topologicalLevels(steps) {
    const remaining = new Map();
    for (const step of steps) {
      remaining.set(step.id, { ...step, remainingDeps: new Set(step.dependsOn) });
    }

    const levels = [];

    while (remaining.size > 0) {
      const level = [];
      for (const [id, stepData] of remaining) {
        if (stepData.remainingDeps.size === 0) {
          level.push(stepData);
        }
      }

      if (level.length === 0) {
        // This shouldn't happen after circular dep check, but guard anyway
        throw new Error("Unresolvable step dependencies detected.");
      }

      levels.push(level);

      for (const resolved of level) {
        remaining.delete(resolved.id);
        for (const [, stepData] of remaining) {
          stepData.remainingDeps.delete(resolved.id);
        }
      }
    }

    return levels;
  }

  _isCancelled(runId) {
    const token = this._cancelTokens.get(runId);
    return token ? token.cancelled : false;
  }

  _shouldContinueOnError(steps, stepId) {
    const step = steps.find((s) => s.id === stepId);
    return step ? step.continueOnError : false;
  }
}

// ---- Standalone helpers ----

function normalizeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function serializeError(err) {
  if (err instanceof Error) {
    return {
      name: err.name || "Error",
      message: err.message,
      stack: err.stack,
      code: err.code,
    };
  }
  if (err && typeof err === "object") {
    return { name: "Error", message: JSON.stringify(err) };
  }
  return { name: "Error", message: String(err || "Unknown error") };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    sleep(ms).then(() => Promise.reject(new Error(message || `Timeout after ${ms}ms`))),
  ]);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  WorkflowEngine,
  STEP_TYPES,
};
