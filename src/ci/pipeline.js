"use strict";

/**
 * CIPipeline — defines and executes CI pipelines composed of ordered stages.
 *
 * Each stage contains steps (async functions) that run sequentially within
 * the stage.  Stages run in definition order.  A stage may be configured with
 * continueOnError to keep the pipeline going after a stage failure.
 *
 * Lifecycle events are emitted so external reporters / loggers can observe.
 *
 *   Events:
 *     pipeline.start    { runId, pipelineName, options }
 *     stage.start       { runId, pipelineName, stageName }
 *     stage.complete    { runId, pipelineName, stageName, result, duration }
 *     stage.error       { runId, pipelineName, stageName, error }
 *     step.start        { runId, pipelineName, stageName, stepIndex, stepName }
 *     step.complete     { runId, pipelineName, stageName, stepIndex, stepName, result, duration }
 *     step.error        { runId, pipelineName, stageName, stepIndex, stepName, error }
 *     pipeline.complete { runId, pipelineName, status, summary }
 *     pipeline.cancel   { runId, pipelineName }
 */

const { EventEmitter } = require("node:events");

const VALID_STAGE_NAMES = new Set([
  "checkout", "install", "lint", "test", "build",
  "security", "quality", "deploy",
]);

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
const DEFAULT_STAGE_TIMEOUT = 300_000; // 5 minutes

class PipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PipelineError";
    this.code = String(code);
  }
}

class CIPipeline extends EventEmitter {
  constructor() {
    super();
    this._pipelines = new Map();
    this._runs = new Map();
    this._runCounter = 0;
    this._cancelTokens = new Map();
  }

  // ---- Definition ----

  /**
   * Define (or overwrite) a named CI pipeline.
   * @param {string} name - Unique pipeline name.
   * @param {Array<object>} stages - Array of stage definitions.
   *   Each stage: { name, steps[], timeout?, continueOnError?, cache?, artifacts? }
   *   Each step:  { name, run: async(ctx) => result }
   */
  define(name, stages) {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new PipelineError("INVALID_NAME", "Pipeline name must be a non-empty string.");
    }
    if (!Array.isArray(stages) || stages.length === 0) {
      throw new PipelineError("INVALID_STAGES", "Pipeline stages must be a non-empty array.");
    }

    const normalized = stages.map((stage, index) =>
      this._normalizeStage(stage, index)
    );

    this._pipelines.set(name.trim(), {
      name: name.trim(),
      stages: normalized,
      createdAt: new Date().toISOString(),
    });

    return this;
  }

  /**
   * Return the definition for a pipeline (shallow copy).
   */
  getDefinition(name) {
    const pipeline = this._pipelines.get(name);
    if (!pipeline) {
      throw new PipelineError("NOT_FOUND", `Pipeline not found: ${name}`);
    }
    return {
      name: pipeline.name,
      stages: pipeline.stages.map(clone),
      createdAt: pipeline.createdAt,
    };
  }

  /**
   * List names of all defined pipelines.
   */
  list() {
    return [...this._pipelines.keys()];
  }

  /**
   * Remove a pipeline definition.
   */
  remove(name) {
    return this._pipelines.delete(name);
  }

  // ---- Execution ----

  /**
   * Run a pipeline from start to finish.
   * @param {string|object} options - Pipeline name string, or options object:
   *   { name, context?, cache? }
   * @returns {Promise<object>} run summary.
   */
  async run(options = {}) {
    let pipelineName;
    let context = {};
    let cacheStore = null;

    if (typeof options === "string") {
      pipelineName = options;
    } else if (options && typeof options === "object") {
      pipelineName = options.name;
      context = options.context || {};
      cacheStore = options.cache || null;
    }

    if (!pipelineName) {
      throw new PipelineError("MISSING_NAME", "Pipeline name is required.");
    }

    const definition = this._resolvePipeline(pipelineName);
    const runId = this._nextRunId();
    const runState = {
      runId,
      pipelineName,
      context: { ...context },
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      stages: {},
    };

    this._runs.set(runId, runState);
    this._cancelTokens.set(runId, { cancelled: false });

    this.emit("pipeline.start", {
      runId,
      pipelineName,
      options: { context, hasCache: cacheStore !== null },
    });

    try {
      await this._executeStages(definition, runState, cacheStore);

      if (!TERMINAL_STATES.has(runState.status)) {
        runState.status = "completed";
      }
      runState.completedAt = new Date().toISOString();

      this.emit("pipeline.complete", {
        runId,
        pipelineName,
        status: runState.status,
        summary: this._summarizeRun(runState),
      });
    } catch (err) {
      if (runState.status === "cancelled") {
        this.emit("pipeline.complete", {
          runId,
          pipelineName,
          status: "cancelled",
          summary: this._summarizeRun(runState),
        });
      } else {
        runState.status = "failed";
        runState.error = serializeError(err);
        runState.completedAt = new Date().toISOString();

        this.emit("pipeline.complete", {
          runId,
          pipelineName,
          status: "failed",
          error: runState.error,
          summary: this._summarizeRun(runState),
        });
      }
    }

    // Archive run to history (remove from active runs)
    this._runs.delete(runId);
    this._cancelTokens.delete(runId);

    // Keep a peek into history for getHistory()
    if (!this._runHistory) {
      this._runHistory = [];
    }
    this._runHistory.push(runState);

    // Cap history at 200 entries
    if (this._runHistory.length > 200) {
      this._runHistory = this._runHistory.slice(-200);
    }

    return this._summarizeRun(runState);
  }

  /**
   * Return the current status of a pipeline run.
   * @param {string} runId
   * @returns {object}
   */
  status(runId) {
    const run = this._runs.get(runId);
    if (!run) {
      // Check history
      if (this._runHistory) {
        const historic = this._runHistory.find((r) => r.runId === runId);
        if (historic) {
          return this._summarizeRun(historic);
        }
      }
      throw new PipelineError("RUN_NOT_FOUND", `Run not found: ${runId}`);
    }
    return this._summarizeRun(run);
  }

  /**
   * Cancel a running pipeline.
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

    this.emit("pipeline.cancel", { runId, pipelineName: run.pipelineName });
    return true;
  }

  /**
   * Return past pipeline runs.
   * @param {object} [filter] - { pipelineName?, limit?, since? }
   * @returns {Array<object>}
   */
  getHistory(filter = {}) {
    if (!this._runHistory || this._runHistory.length === 0) {
      return [];
    }

    let results = [...this._runHistory];

    if (filter.pipelineName) {
      results = results.filter((r) => r.pipelineName === filter.pipelineName);
    }

    if (filter.since) {
      const sinceTs = new Date(filter.since).getTime();
      results = results.filter((r) => new Date(r.startedAt).getTime() >= sinceTs);
    }

    if (filter.limit && Number.isSafeInteger(filter.limit) && filter.limit > 0) {
      results = results.slice(-filter.limit);
    }

    return results.map((r) => this._summarizeRun(r));
  }

  // ---- Internal: stage execution ----

  async _executeStages(definition, runState, cacheStore) {
    for (const stage of definition.stages) {
      if (this._isCancelled(runState.runId)) {
        throw new PipelineError("CANCELLED", "Pipeline was cancelled.");
      }

      try {
        await this._executeStage(stage, runState, cacheStore);
      } catch (err) {
        if (stage.continueOnError) {
          this._recordStageResult(runState, stage.name, {
            status: "failed_but_continued",
            error: serializeError(err),
            startedAt: null,
            completedAt: new Date().toISOString(),
            steps: {},
          });
          continue;
        }
        throw err;
      }
    }
  }

  async _executeStage(stage, runState, cacheStore) {
    const startedAt = new Date().toISOString();

    this.emit("stage.start", {
      runId: runState.runId,
      pipelineName: runState.pipelineName,
      stageName: stage.name,
    });

    // Check cache for this stage
    if (cacheStore && stage.cache) {
      const cacheResult = this._checkStageCache(cacheStore, stage, runState);
      if (cacheResult !== undefined) {
        const completedAt = new Date().toISOString();
        this._recordStageResult(runState, stage.name, {
          status: "completed",
          result: cacheResult,
          cacheHit: true,
          startedAt,
          completedAt,
          steps: {},
        });

        this.emit("stage.complete", {
          runId: runState.runId,
          pipelineName: runState.pipelineName,
          stageName: stage.name,
          cacheHit: true,
          result: cacheResult,
          duration: new Date(completedAt) - new Date(startedAt),
        });

        return;
      }
    }

    let error = null;
    let result = null;
    const stepResults = {};

    try {
      result = await withTimeout(
        this._executeSteps(stage, runState, stepResults),
        stage.timeout,
        `Stage "${stage.name}" timed out after ${stage.timeout}ms`
      );
    } catch (err) {
      error = err;
    }

    const completedAt = new Date().toISOString();

    if (error) {
      this.emit("stage.error", {
        runId: runState.runId,
        pipelineName: runState.pipelineName,
        stageName: stage.name,
        error: serializeError(error),
      });

      this._recordStageResult(runState, stage.name, {
        status: "failed",
        error: serializeError(error),
        startedAt,
        completedAt,
        steps: stepResults,
      });

      throw error;
    }

    // Store in cache if configured
    if (cacheStore && stage.cache) {
      this._setStageCache(cacheStore, stage, runState, result);
    }

    this._recordStageResult(runState, stage.name, {
      status: "completed",
      result,
      cacheHit: false,
      startedAt,
      completedAt,
      steps: stepResults,
    });

    this.emit("stage.complete", {
      runId: runState.runId,
      pipelineName: runState.pipelineName,
      stageName: stage.name,
      cacheHit: false,
      result,
      duration: new Date(completedAt) - new Date(startedAt),
    });

    return result;
  }

  async _executeSteps(stage, runState, stepResults) {
    let lastResult = null;

    for (let i = 0; i < stage.steps.length; i++) {
      if (this._isCancelled(runState.runId)) {
        throw new PipelineError("CANCELLED", "Pipeline was cancelled.");
      }

      const step = stage.steps[i];
      const stepStartedAt = new Date().toISOString();

      this.emit("step.start", {
        runId: runState.runId,
        pipelineName: runState.pipelineName,
        stageName: stage.name,
        stepIndex: i,
        stepName: step.name,
      });

      let stepResult;
      let stepError;

      try {
        stepResult = await step.run(runState.context);
      } catch (err) {
        stepError = err;
      }

      const stepCompletedAt = new Date().toISOString();

      if (stepError) {
        this.emit("step.error", {
          runId: runState.runId,
          pipelineName: runState.pipelineName,
          stageName: stage.name,
          stepIndex: i,
          stepName: step.name,
          error: serializeError(stepError),
        });

        stepResults[step.name] = {
          status: "failed",
          error: serializeError(stepError),
          startedAt: stepStartedAt,
          completedAt: stepCompletedAt,
        };

        throw stepError;
      }

      lastResult = stepResult;

      this.emit("step.complete", {
        runId: runState.runId,
        pipelineName: runState.pipelineName,
        stageName: stage.name,
        stepIndex: i,
        stepName: step.name,
        result: stepResult,
        duration: new Date(stepCompletedAt) - new Date(stepStartedAt),
      });

      stepResults[step.name] = {
        status: "completed",
        result: stepResult,
        startedAt: stepStartedAt,
        completedAt: stepCompletedAt,
      };
    }

    return lastResult;
  }

  // ---- Internal: cache helpers ----

  _checkStageCache(cacheStore, stage, runState) {
    try {
      const key = `ci:pipeline:${runState.pipelineName}:${stage.name}`;
      return cacheStore.get ? cacheStore.get(key) : undefined;
    } catch (_e) {
      return undefined;
    }
  }

  _setStageCache(cacheStore, stage, runState, result) {
    try {
      const key = `ci:pipeline:${runState.pipelineName}:${stage.name}`;
      if (typeof cacheStore.set === "function") {
        cacheStore.set(key, result, {
          pipeline: runState.pipelineName,
          stage: stage.name,
          cachedAt: new Date().toISOString(),
        });
      }
    } catch (_e) {
      // Best-effort caching
    }
  }

  // ---- Internal helpers ----

  _resolvePipeline(name) {
    const pipeline = this._pipelines.get(name);
    if (!pipeline) {
      throw new PipelineError("NOT_FOUND", `Pipeline not found: ${name}`);
    }
    return pipeline;
  }

  _nextRunId() {
    this._runCounter += 1;
    return `ci-run-${Date.now().toString(36)}-${this._runCounter}`;
  }

  _recordStageResult(runState, stageName, record) {
    runState.stages[stageName] = record;
  }

  _summarizeRun(run) {
    const stageNames = Object.keys(run.stages);
    const stageSummary = stageNames.map((name) => {
      const s = run.stages[name];
      return {
        name,
        status: s.status,
        error: s.error || null,
        cacheHit: s.cacheHit,
      };
    });

    const totalStages = stageNames.length;
    const completedStages = stageNames.filter(
      (n) => run.stages[n].status === "completed" || run.stages[n].status === "failed_but_continued"
    ).length;
    const failedStages = stageNames.filter(
      (n) => run.stages[n].status === "failed"
    ).length;

    return {
      runId: run.runId,
      pipelineName: run.pipelineName,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      error: run.error,
      context: run.context,
      stages: stageSummary,
      totalStages,
      completedStages,
      failedStages,
    };
  }

  _normalizeStage(stage, index) {
    if (!stage || typeof stage !== "object") {
      throw new PipelineError(
        "INVALID_STAGE",
        `Stage at index ${index} must be an object.`
      );
    }

    if (typeof stage.name !== "string" || stage.name.trim().length === 0) {
      throw new PipelineError(
        "INVALID_STAGE_NAME",
        `Stage at index ${index} must have a string "name".`
      );
    }

    const name = stage.name.trim();

    if (!Array.isArray(stage.steps)) {
      throw new PipelineError(
        "INVALID_STAGE_STEPS",
        `Stage "${name}" must have a "steps" array.`
      );
    }

    return {
      name,
      steps: stage.steps.map((step, si) => this._normalizeStep(step, name, si)),
      timeout: normalizeInt(stage.timeout, DEFAULT_STAGE_TIMEOUT),
      continueOnError: Boolean(stage.continueOnError),
      cache: stage.cache !== undefined ? Boolean(stage.cache) : false,
      artifacts: Array.isArray(stage.artifacts) ? stage.artifacts : [],
    };
  }

  _normalizeStep(step, stageName, stepIndex) {
    if (!step || typeof step !== "object") {
      throw new PipelineError(
        "INVALID_STEP",
        `Step at index ${stepIndex} in stage "${stageName}" must be an object.`
      );
    }

    if (typeof step.run !== "function") {
      throw new PipelineError(
        "INVALID_STEP_FN",
        `Step "${step.name || stepIndex}" in stage "${stageName}" must have an async "run" function.`
      );
    }

    return {
      name: String(step.name || `step-${stepIndex}`).trim(),
      run: step.run,
    };
  }

  _isCancelled(runId) {
    const token = this._cancelTokens.get(runId);
    return token ? token.cancelled : false;
  }
}

// ---- Standalone helpers ----

function normalizeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    sleep(ms).then(() =>
      Promise.reject(new PipelineError("TIMEOUT", message || `Timeout after ${ms}ms`))
    ),
  ]);
}

module.exports = { CIPipeline, PipelineError };
