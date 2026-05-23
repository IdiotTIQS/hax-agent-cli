"use strict";

const { ModelMatrix, TASK_PROFILES } = require("./matrix");

// ── Constants ────────────────────────────────────────────────────────────

const CAPABILITY_WEIGHTS = Object.freeze({
  vision: 5,
  tools: 4,
  streaming: 1,
  caching: 2,
  longContext: 3,
  reasoning: 4,
  jsonMode: 2,
  codeGeneration: 4,
  multilingual: 3,
  speed: 3,
  cost: 3,
});

// ── Helpers ──────────────────────────────────────────────────────────────

function _resolveModel(model, matrix) {
  if (typeof model === "string") {
    const found = matrix.getModel(model);
    if (!found) {
      throw new Error(`Model not found in matrix: ${model}`);
    }
    return found;
  }
  if (model && typeof model === "object" && typeof model.id === "string") {
    const found = matrix.getModel(model.id);
    if (found) return found;
    return model;
  }
  throw new Error("Model must be a string id or object with id property");
}

function _resolveModels(list, matrix) {
  return (Array.isArray(list) ? list : []).map((m) => _resolveModel(m, matrix));
}

function _capabilityScore(model) {
  let score = 0;
  score += model.maxTokens / 100000;
  if (model.vision) score += CAPABILITY_WEIGHTS.vision;
  if (model.tools) score += CAPABILITY_WEIGHTS.tools;
  if (model.streaming) score += CAPABILITY_WEIGHTS.streaming;
  if (model.caching) score += CAPABILITY_WEIGHTS.caching;
  if (model.longContext) score += CAPABILITY_WEIGHTS.longContext;
  if (model.reasoning) score += CAPABILITY_WEIGHTS.reasoning;
  if (model.jsonMode) score += CAPABILITY_WEIGHTS.jsonMode;
  score += model.codeGeneration / 10 * CAPABILITY_WEIGHTS.codeGeneration;
  score += model.multilingual / 10 * CAPABILITY_WEIGHTS.multilingual;
  return score;
}

function _computeFitness(model, task) {
  const t = task || {};
  let fitness = 0;
  let requirementsMatched = 0;
  let totalRequirements = 0;

  // Boolean requirements
  const bools = ["vision", "tools", "streaming", "caching", "longContext", "reasoning", "jsonMode"];
  for (const cap of bools) {
    const needKey = `needs${cap.charAt(0).toUpperCase()}${cap.slice(1)}`;
    if (t[needKey] === true) {
      totalRequirements += 1;
      if (model[cap]) {
        fitness += CAPABILITY_WEIGHTS[cap] || 1;
        requirementsMatched += 1;
      }
    }
  }

  // Numeric requirements
  if (Number.isFinite(t.minMaxTokens)) {
    totalRequirements += 1;
    if (model.maxTokens >= t.minMaxTokens) {
      fitness += Math.min(model.maxTokens / t.minMaxTokens * 3, 10);
      requirementsMatched += 1;
    }
  }
  if (Number.isFinite(t.minCodeQuality)) {
    totalRequirements += 1;
    if (model.codeGeneration >= t.minCodeQuality) {
      fitness += model.codeGeneration / 10 * 5;
      requirementsMatched += 1;
    }
  }
  if (Number.isFinite(t.minSpeed)) {
    totalRequirements += 1;
    if (model.speed >= t.minSpeed) {
      fitness += model.speed / 10 * 3;
      requirementsMatched += 1;
    }
  }
  if (Number.isFinite(t.maxBudget)) {
    totalRequirements += 1;
    const costScore = model.cost / 10;
    fitness += costScore * 3;
    requirementsMatched += 1;
  }

  // Base fitness from capability score
  const baseFitness = _capabilityScore(model);
  fitness += baseFitness;

  // Hard check: if any required boolean is missing, immediately disqualify
  if (totalRequirements > 0) {
    const matchRatio = requirementsMatched / totalRequirements;
    if (matchRatio < 1) {
      // Partial match: still usable, but penalised
      fitness *= matchRatio;
    }
  }

  // Hard disqualification: missing a required boolean capability
  for (const cap of ["vision", "tools", "streaming", "caching", "longContext", "reasoning", "jsonMode"]) {
    const needKey = `needs${cap.charAt(0).toUpperCase()}${cap.slice(1)}`;
    if (task[needKey] === true && !model[cap]) {
      return -Infinity;
    }
  }

  // Cost and speed bonuses (always included)
  fitness += model.speed / 10 * 2;
  fitness += model.cost / 10 * 2;

  return fitness;
}

function _buildReasoning(model, task, factors) {
  const reasons = [];

  const bools = [
    ["vision", "vision tasks"],
    ["tools", "tool use"],
    ["streaming", "streaming output"],
    ["caching", "prompt caching"],
    ["longContext", "long context"],
    ["reasoning", "reasoning"],
    ["jsonMode", "JSON mode"],
  ];

  for (const [cap, label] of bools) {
    const needKey = `needs${cap.charAt(0).toUpperCase()}${cap.slice(1)}`;
    if (task[needKey]) {
      reasons.push(model[cap]
        ? `Supports ${label} (required)`
        : `Does NOT support ${label} (required)`);
    }
  }

  reasons.push(`Code generation: ${model.codeGeneration}/10`);
  reasons.push(`Multilingual: ${model.multilingual}/10`);
  reasons.push(`Speed: ${model.speed}/10`);
  reasons.push(`Cost tier: ${model.cost}/10 (higher = cheaper)`);
  reasons.push(`Max tokens: ${model.maxTokens.toLocaleString()}`);

  if (factors) {
    reasons.push(`---`);
    reasons.push(`Capability score: ${factors.capabilityScore.toFixed(1)}`);
    if (factors.costEstimate !== undefined) {
      reasons.push(`Estimated cost: $${factors.costEstimate.toFixed(6)}`);
    }
    reasons.push(`Fitness score: ${factors.fitness.toFixed(1)}`);
  }

  return reasons;
}

// ── ModelSelector ────────────────────────────────────────────────────────

class ModelSelector {
  /**
   * @param {object} [options]
   * @param {ModelMatrix} [options.matrix] — shared ModelMatrix instance
   * @param {boolean} [options.preload] — preload built-in models (default true)
   */
  constructor(options = {}) {
    this._matrix = options.matrix || new ModelMatrix({ preloadBuiltins: options.preload !== false });
  }

  get matrix() {
    return this._matrix;
  }

  // ── Core selection ──────────────────────────────────────────────────

  /**
   * Select the best model for a given task description.
   * @param {object} task — task requirements
   * @param {Array<string|object>} [available] — optional whitelist of model ids/objects
   * @returns {object} { model, score, reasoning }
   */
  selectForTask(task, available) {
    if (!task || typeof task !== "object") {
      throw new Error("Task must be a non-null object");
    }

    const candidates = available ? _resolveModels(available, this._matrix) : this._matrix.listAll();
    if (candidates.length === 0) {
      throw new Error("No models available for selection");
    }

    let best = null;
    let bestFitness = -Infinity;

    for (const model of candidates) {
      const fitness = _computeFitness(model, task);
      if (fitness > bestFitness) {
        bestFitness = fitness;
        best = model;
      }
    }

    if (!best) {
      throw new Error("No suitable model found for the given task");
    }

    const capScore = _capabilityScore(best);

    return {
      model: { id: best.id, provider: best.provider, displayName: best.displayName },
      score: Math.round(bestFitness * 100) / 100,
      reasoning: _buildReasoning(best, task, {
        capabilityScore: capScore,
        fitness: bestFitness,
      }),
    };
  }

  // ── Budget-aware selection ──────────────────────────────────────────

  /**
   * Select the best model that fits within a cost budget.
   * @param {object} task — task requirements
   * @param {number} budget — maximum acceptable cost tier (1–10, higher = cheaper)
   * @returns {object} { model, score, reasoning }
   */
  selectForBudget(task, budget) {
    if (!task || typeof task !== "object") {
      throw new Error("Task must be a non-null object");
    }
    const b = Number.isFinite(budget) ? budget : 10;

    const candidates = this._matrix.listAll();
    const withinBudget = candidates.filter((m) => m.cost <= b);

    if (withinBudget.length === 0) {
      // Fallback: use cheapest available model
      const cheapest = this._matrix.findCheapest(task);
      if (!cheapest) {
        throw new Error(`No model found within budget tier ${b}`);
      }
      const capScore = _capabilityScore(cheapest);
      const fitness = _computeFitness(cheapest, task);
      return {
        model: { id: cheapest.id, provider: cheapest.provider, displayName: cheapest.displayName },
        score: Math.round(fitness * 100) / 100,
        reasoning: _buildReasoning(cheapest, task, {
          capabilityScore: capScore,
          fitness,
        }).concat([`NOTE: No model within budget tier ${b}, falling back to cheapest.`]),
      };
    }

    let best = null;
    let bestFitness = -Infinity;

    for (const model of withinBudget) {
      const fitness = _computeFitness(model, task);
      if (fitness > bestFitness) {
        bestFitness = fitness;
        best = model;
      }
    }

    const capScore = _capabilityScore(best);

    return {
      model: { id: best.id, provider: best.provider, displayName: best.displayName },
      score: Math.round(bestFitness * 100) / 100,
      reasoning: _buildReasoning(best, task, {
        capabilityScore: capScore,
        fitness: bestFitness,
      }).concat([`Budget constraint: cost tier <= ${b}`]),
    };
  }

  // ── Speed-optimised selection ───────────────────────────────────────

  /**
   * Select the fastest model that still satisfies task requirements.
   * @param {object} task — task requirements
   * @returns {object} { model, score, reasoning }
   */
  selectForSpeed(task) {
    if (!task || typeof task !== "object") {
      throw new Error("Task must be a non-null object");
    }

    const candidates = this._matrix.listAll();
    const fastEnough = candidates.filter((m) => m.speed >= 5);

    const pool = fastEnough.length > 0 ? fastEnough : candidates;

    let best = null;
    let bestScore = -Infinity;

    for (const model of pool) {
      // Weight speed heavily
      const score = model.speed * 10 + _capabilityScore(model) * 0.3;
      const fitness = _computeFitness(model, task);
      const weighted = score * 0.6 + fitness * 0.4;
      if (weighted > bestScore) {
        bestScore = weighted;
        best = model;
      }
    }

    if (!best) {
      throw new Error("No model found for speed selection");
    }

    const capScore = _capabilityScore(best);

    return {
      model: { id: best.id, provider: best.provider, displayName: best.displayName },
      score: Math.round(bestScore * 100) / 100,
      reasoning: _buildReasoning(best, task, {
        capabilityScore: capScore,
        fitness: _computeFitness(best, task),
      }).concat([`Selection mode: speed-optimised`]),
    };
  }

  // ── Quality-optimised selection ─────────────────────────────────────

  /**
   * Select the highest-quality model for the task.
   * @param {object} task — task requirements
   * @returns {object} { model, score, reasoning }
   */
  selectForQuality(task) {
    if (!task || typeof task !== "object") {
      throw new Error("Task must be a non-null object");
    }

    const candidates = this._matrix.listAll();

    let best = null;
    let bestQuality = -Infinity;

    for (const model of candidates) {
      const quality =
        _capabilityScore(model) * 2 +
        model.reasoning * 10 +
        model.codeGeneration * 2 +
        model.multilingual +
        model.maxTokens / 50000;
      const fitness = _computeFitness(model, task);
      const combined = quality * 0.7 + fitness * 0.3;
      if (combined > bestQuality) {
        bestQuality = combined;
        best = model;
      }
    }

    if (!best) {
      throw new Error("No model found for quality selection");
    }

    const capScore = _capabilityScore(best);

    return {
      model: { id: best.id, provider: best.provider, displayName: best.displayName },
      score: Math.round(bestQuality * 100) / 100,
      reasoning: _buildReasoning(best, task, {
        capabilityScore: capScore,
        fitness: _computeFitness(best, task),
      }).concat([`Selection mode: quality-optimised`]),
    };
  }

  // ── Full recommendation ─────────────────────────────────────────────

  /**
   * Get a full recommendation with comparisons across all selection modes.
   * @param {object} task — task requirements
   * @returns {object} full recommendation report
   */
  getRecommendation(task) {
    if (!task || typeof task !== "object") {
      throw new Error("Task must be a non-null object");
    }

    const forTask = this.selectForTask(task);
    const forSpeed = this.selectForSpeed(task);
    const forQuality = this.selectForQuality(task);

    let forBudget = null;
    let budgetError = null;
    try {
      const budget = Number.isFinite(task.budget) ? task.budget : 7;
      forBudget = this.selectForBudget(task, budget);
    } catch (e) {
      budgetError = e.message;
    }

    const taskType = task.type || "chat";
    const profile = TASK_PROFILES[taskType] || null;
    const ranking = profile ? this._matrix.rank(taskType) : null;

    const report = {
      task: { ...task },
      primary: forTask,
      alternatives: { speed: forSpeed, quality: forQuality },
      budget: forBudget || { error: budgetError },
      topRanked: ranking ? ranking.slice(0, 5) : [],
      meta: {
        totalModels: this._matrix.size,
        taskProfile: taskType,
      },
    };

    return report;
  }
}

module.exports = {
  ModelSelector,
};
