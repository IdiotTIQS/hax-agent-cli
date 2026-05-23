"use strict";

/**
 * Model Integration Bridge
 *
 * Wires the orphan `src/models/matrix.js` (ModelMatrix) and
 * `src/models/selector.js` (ModelSelector) modules into the
 * provider-selection workflow.
 *
 * Intent: use the model capability matrix and multi-strategy selector
 * to enhance provider/model choice for a given task without modifying
 * existing provider factory code.
 */

const { ModelMatrix, TASK_PROFILES } = require("../models/matrix");
const { ModelSelector } = require("../models/selector");

// ---------------------------------------------------------------------------
// enhanceProviderSelection
// ---------------------------------------------------------------------------

/**
 * Enhance provider selection by consulting the model matrix to find the
 * top-ranked model for a task, then producing a provider hint the caller
 * can feed into `createProvider`.
 *
 * @param {object} task
 *   Task descriptor. Recognised fields:
 *     {string}  task.type         - task category (coding, chat, vision, ...)
 *     {string}  task.provider     - preferred provider id
 *     {boolean} task.needsVision  - requires vision capability
 *     {boolean} task.needsTools   - requires tool-use capability
 *     {boolean} task.needsStreaming - requires streaming
 *     {boolean} task.needsCaching - requires prompt caching
 *     {boolean} task.needsLongContext - requires long-context
 *     {boolean} task.needsReasoning - requires reasoning
 *     {boolean} task.needsJsonMode - requires JSON mode
 *     {number}  task.minCodeQuality - minimum code generation score 1-10
 *     {number}  task.minSpeed     - minimum speed score 1-10
 *     {number}  task.maxBudget    - maximum cost tier (higher = cheaper)
 *     {number}  task.minMaxTokens - minimum max tokens
 * @param {ModelMatrix} [modelMatrix]  - pre-built matrix (new one created if omitted)
 * @returns {{ selected: object, ranking: object[], reasoning: string[], matrix: ModelMatrix }}
 */
function enhanceProviderSelection(task, modelMatrix) {
  if (!task || typeof task !== "object") {
    throw new TypeError("task must be a non-null object");
  }

  const matrix = modelMatrix || new ModelMatrix();
  const selector = new ModelSelector({ matrix });

  const recommendation = selector.getRecommendation(task);

  const reasoning = recommendation.primary.reasoning || [];
  if (recommendation.primary.model) {
    reasoning.unshift(
      `Primary recommendation: ${recommendation.primary.model.displayName} (${recommendation.primary.model.provider}), score ${recommendation.primary.score}`,
    );
  }

  return {
    selected: recommendation.primary.model || null,
    ranking: recommendation.topRanked || [],
    reasoning,
    matrix,
  };
}

// ---------------------------------------------------------------------------
// recommendModelForTask
// ---------------------------------------------------------------------------

/**
 * One-call model recommendation. Returns the single best model for the
 * given task description.
 *
 * @param {object} task - task descriptor (same shape as enhanceProviderSelection)
 * @param {ModelMatrix} [modelMatrix] - pre-built matrix
 * @returns {{ model: { id: string, provider: string, displayName: string }, score: number, reasoning: string[] }}
 */
function recommendModelForTask(task, modelMatrix) {
  if (!task || typeof task !== "object") {
    throw new TypeError("task must be a non-null object");
  }

  const matrix = modelMatrix || new ModelMatrix();
  const selector = new ModelSelector({ matrix });

  const result = selector.selectForTask(task);

  return {
    model: result.model,
    score: result.score,
    reasoning: result.reasoning,
  };
}

// ---------------------------------------------------------------------------
// compareAvailableModels
// ---------------------------------------------------------------------------

/**
 * Compare the models available from a list of providers (or all providers).
 *
 * Produces a report showing relative strengths between the top model from
 * each provider so the caller can make an informed trade-off decision.
 *
 * @param {string[]} providersList - list of provider ids (e.g. ["anthropic", "openai"])
 *                                   If empty/omitted, all known providers are compared.
 * @param {object} [options]
 * @param {ModelMatrix} [options.matrix]   - pre-built matrix
 * @param {string} [options.taskType]      - task category for ranking (default "coding")
 * @returns {{ providers: object[], comparison: object, summary: object }}
 */
function compareAvailableModels(providersList, options) {
  const opts = options || {};
  const matrix = opts.matrix || new ModelMatrix();
  const taskType = opts.taskType || "coding";

  const want = Array.isArray(providersList) && providersList.length > 0
    ? providersList.map((p) => String(p).toLowerCase())
    : Object.keys(matrix.getProviderBreakdown());

  const providers = [];
  const selector = new ModelSelector({ matrix });

  for (const providerId of want) {
    const models = matrix.getModelsByProvider(providerId);
    if (models.length === 0) {
      providers.push({
        provider: providerId,
        modelCount: 0,
        topModel: null,
        ranking: [],
        note: "No models registered for this provider",
      });
      continue;
    }

    // Rank models from this provider for the task type
    const ranked = matrix.rank(taskType, models);
    const topModel = ranked.length > 0 ? ranked[0] : null;

    // Multi-strategy selection within this provider
    let recommendation = null;
    try {
      const taskDef = { type: taskType };
      recommendation = selector.selectForTask(taskDef, models);
    } catch (_err) {
      // Selection may fail if models don't meet requirements; that's ok.
    }

    providers.push({
      provider: providerId,
      modelCount: models.length,
      topModel,
      ranking: ranked,
      recommended: recommendation ? recommendation.model : null,
    });
  }

  // Cross-provider comparison: find the best across all
  const allRanked = matrix.rank(taskType);
  const overallBest = allRanked.length > 0 ? allRanked[0] : null;

  // Provider strengths matrix — look up full model for numeric capabilities
  const providerStrengths = {};
  for (const p of providers) {
    if (!p.topModel) continue;
    const fullModel = matrix.getModel(p.topModel.id);
    providerStrengths[p.provider] = {
      topModel: p.topModel.displayName,
      speed: fullModel ? fullModel.speed : 0,
      cost: fullModel ? fullModel.cost : 0,
      codeGeneration: fullModel ? fullModel.codeGeneration : 0,
      modelCount: p.modelCount,
    };
  }

  // Determine category leaders (using full model capabilities)
  let speedLeader = null;
  let costLeader = null;
  let qualityLeader = null;
  for (const p of providers) {
    if (!p.topModel) continue;
    const fullModel = matrix.getModel(p.topModel.id);
    if (!fullModel) continue;
    if (!speedLeader || fullModel.speed > speedLeader.speed) {
      speedLeader = { provider: p.provider, model: p.topModel.id, speed: fullModel.speed };
    }
    if (!costLeader || fullModel.cost > costLeader.cost) {
      costLeader = { provider: p.provider, model: p.topModel.id, cost: fullModel.cost };
    }
    if (!qualityLeader || fullModel.codeGeneration > qualityLeader.codeGeneration) {
      qualityLeader = { provider: p.provider, model: p.topModel.id, codeGeneration: fullModel.codeGeneration };
    }
  }

  return {
    providers,
    comparison: {
      taskType,
      overallBest,
      speedLeader,
      costLeader,
      qualityLeader,
    },
    summary: {
      totalProviders: providers.length,
      totalModels: matrix.size,
      providerStrengths,
    },
  };
}

module.exports = {
  enhanceProviderSelection,
  recommendModelForTask,
  compareAvailableModels,
};
