"use strict";

const STRATEGIES = Object.freeze({
  LEAST_COST: "least_cost",
  HIGHEST_CAPABILITY: "highest_capability",
  ROUND_ROBIN: "round_robin",
  WEIGHTED_RANDOM: "weighted_random",
});

const DEFAULT_STRATEGY = STRATEGIES.LEAST_COST;

const CAPABILITY_WEIGHTS = {
  vision: 5,
  tools: 4,
  streaming: 1,
  caching: 2,
  longContext: 3,
  reasoning: 4,
};

class ModelRegistry {
  constructor() {
    this._models = new Map();
  }

  register(model) {
    if (!model || typeof model !== "object") {
      throw new Error("Model must be a non-null object");
    }
    if (typeof model.id !== "string" || model.id.length === 0) {
      throw new Error("Model must have a valid string id");
    }

    const entry = this._normalizeEntry(model);
    this._models.set(entry.id, entry);
    return this;
  }

  get(id) {
    return this._models.get(id) || null;
  }

  has(id) {
    return this._models.has(id);
  }

  list(filterFn) {
    const entries = Array.from(this._models.values());
    if (typeof filterFn === "function") {
      return entries.filter(filterFn);
    }
    return entries;
  }

  remove(id) {
    return this._models.delete(id);
  }

  get size() {
    return this._models.size;
  }

  _normalizeEntry(model) {
    return {
      id: model.id,
      provider: String(model.provider || "unknown").toLowerCase(),
      displayName: String(model.displayName || model.id),
      capabilities: {
        maxTokens: Number.isFinite(model.maxTokens) && model.maxTokens > 0 ? model.maxTokens : 4096,
        vision: Boolean(model.vision),
        tools: Boolean(model.tools),
        streaming: Boolean(model.streaming),
        caching: Boolean(model.caching),
        longContext: Boolean(model.longContext),
        reasoning: Boolean(model.reasoning),
        ...(model.capabilities || {}),
      },
      costTier: {
        inputPer1k: Number.isFinite(model.inputPer1k) ? model.inputPer1k : 0,
        outputPer1k: Number.isFinite(model.outputPer1k) ? model.outputPer1k : 0,
        ...(model.costTier || {}),
      },
      rateLimit: {
        requestsPerMinute: Number.isFinite(model.requestsPerMinute) ? model.requestsPerMinute : Infinity,
        tokensPerMinute: Number.isFinite(model.tokensPerMinute) ? model.tokensPerMinute : Infinity,
        ...(model.rateLimit || {}),
      },
      weight: Number.isFinite(model.weight) && model.weight > 0 ? model.weight : 1,
    };
  }
}

class RateLimitTracker {
  constructor() {
    this._windows = new Map();
  }

  record(modelId, tokenCount) {
    const now = Date.now();
    if (!this._windows.has(modelId)) {
      this._windows.set(modelId, []);
    }
    const window = this._windows.get(modelId);
    window.push({ time: now, tokens: tokenCount });
    this._prune(window, now);
  }

  isRateLimited(modelId, rateLimit) {
    const now = Date.now();
    const window = this._windows.get(modelId);
    if (!window || window.length === 0) {
      return false;
    }
    this._prune(window, now);

    const rpm = rateLimit?.requestsPerMinute ?? Infinity;
    const tpm = rateLimit?.tokensPerMinute ?? Infinity;

    if (window.length >= rpm && rpm !== Infinity) {
      return true;
    }

    const totalTokens = window.reduce((sum, entry) => sum + entry.tokens, 0);
    if (totalTokens >= tpm && tpm !== Infinity) {
      return true;
    }

    return false;
  }

  getUsage(modelId) {
    const now = Date.now();
    const window = this._windows.get(modelId);
    if (!window || window.length === 0) {
      return { requests: 0, tokens: 0 };
    }
    this._prune(window, now);
    return {
      requests: window.length,
      tokens: window.reduce((sum, entry) => sum + entry.tokens, 0),
    };
  }

  _prune(window, now) {
    const cutoff = now - 60000;
    while (window.length > 0 && window[0].time < cutoff) {
      window.shift();
    }
  }
}

class HealthTracker {
  constructor(options = {}) {
    this.maxSamples = Number.isFinite(options.maxSamples) && options.maxSamples > 0 ? options.maxSamples : 100;
    this.minSamplesForHealth = Number.isFinite(options.minSamplesForHealth) && options.minSamplesForHealth > 0 ? options.minSamplesForHealth : 3;
    this._models = new Map();
  }

  recordSuccess(modelId, latencyMs) {
    this._ensureModel(modelId);
    const m = this._models.get(modelId);
    m.successes += 1;
    const resolvedLatency = Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : 0;
    m.totalLatencyMs += resolvedLatency;
    m.latencySamples.push(resolvedLatency);

    if (m.latencySamples.length > this.maxSamples) {
      m.totalLatencyMs -= m.latencySamples.shift();
    }

    if (m.successes + m.failures > this.maxSamples) {
      if (m.failures > 0) {
        m.failures -= 1;
      } else {
        m.successes -= 1;
      }
    }
  }

  recordFailure(modelId, error) {
    this._ensureModel(modelId);
    const m = this._models.get(modelId);
    m.failures += 1;
    m.lastError = error || null;

    if (m.successes + m.failures > this.maxSamples) {
      if (m.successes > 0) {
        m.successes -= 1;
      } else {
        m.failures -= 1;
      }
    }
  }

  getHealth(modelId) {
    const m = this._models.get(modelId);
    if (!m) {
      return { totalRequests: 0, successRate: 1, errorRate: 0, averageLatencyMs: 0, healthScore: 0.5, healthy: true };
    }

    const total = m.successes + m.failures;
    const successRate = total === 0 ? 1 : m.successes / total;
    const errorRate = total === 0 ? 0 : m.failures / total;
    const averageLatencyMs = m.latencySamples.length === 0 ? 0 : m.totalLatencyMs / m.latencySamples.length;

    if (total < this.minSamplesForHealth) {
      return { totalRequests: total, successRate, errorRate, averageLatencyMs, healthScore: 0.5, healthy: true };
    }

    const latencyPenalty = averageLatencyMs > 0 ? Math.min(0.3, averageLatencyMs / 30000) : 0;
    const healthScore = Math.max(0, successRate - errorRate * 0.5 - latencyPenalty);

    return {
      totalRequests: total,
      successRate,
      errorRate,
      averageLatencyMs,
      healthScore,
      healthy: healthScore >= 0.3,
      lastError: m.lastError ? String(m.lastError.message || m.lastError) : null,
    };
  }

  _ensureModel(modelId) {
    if (!this._models.has(modelId)) {
      this._models.set(modelId, {
        successes: 0,
        failures: 0,
        totalLatencyMs: 0,
        latencySamples: [],
        lastError: null,
      });
    }
  }
}

class ModelRouter {
  constructor(options = {}) {
    this._registry = new ModelRegistry();
    this._rateLimitTracker = new RateLimitTracker();
    this._healthTracker = new HealthTracker(options);
    this._strategy = STRATEGIES.LEAST_COST;
    this._roundRobinIndex = new Map();
    this._usageStats = new Map();
  }

  registerModel(model) {
    this._registry.register(model);
    return this;
  }

  route(task, options = {}) {
    if (!task || typeof task !== "object") {
      throw new Error("Task must be a non-null object");
    }

    const available = this.getAvailableModels(task);
    if (available.length === 0) {
      throw new Error("No available models matching task requirements");
    }

    const strategy = this._resolveStrategy(options.strategy);

    switch (strategy) {
      case STRATEGIES.LEAST_COST:
        return this._routeLeastCost(available, task);
      case STRATEGIES.HIGHEST_CAPABILITY:
        return this._routeHighestCapability(available, task);
      case STRATEGIES.ROUND_ROBIN:
        return this._routeRoundRobin(available, task);
      case STRATEGIES.WEIGHTED_RANDOM:
        return this._routeWeightedRandom(available, task);
      default:
        return this._routeLeastCost(available, task);
    }
  }

  getAvailableModels(task) {
    if (task && typeof task === "object") {
      return this._registry.list((model) => this._modelMatches(task, model));
    }
    return this._registry.list((model) => !this._rateLimitTracker.isRateLimited(model.id, model.rateLimit));
  }

  getModelStats() {
    const stats = {};
    for (const model of this._registry.list()) {
      const health = this._healthTracker.getHealth(model.id);
      const rateUsage = this._rateLimitTracker.getUsage(model.id);
      const usageStat = this._usageStats.get(model.id) || { routed: 0, successes: 0, failures: 0, totalLatencyMs: 0 };
      stats[model.id] = {
        id: model.id,
        provider: model.provider,
        displayName: model.displayName,
        capabilities: { ...model.capabilities },
        health,
        rateLimit: { ...model.rateLimit },
        rateUsage,
        usage: { ...usageStat },
      };
    }
    return stats;
  }

  setStrategy(strategy) {
    const normalized = String(strategy || "").toLowerCase();
    if (!Object.values(STRATEGIES).includes(normalized)) {
      throw new Error(`Unknown routing strategy: ${strategy}. Valid strategies: ${Object.values(STRATEGIES).join(", ")}`);
    }
    this._strategy = normalized;
  }

  get strategy() {
    return this._strategy;
  }

  recordSuccess(modelId, latencyMs) {
    this._healthTracker.recordSuccess(modelId, latencyMs);
    this._incrementUsage(modelId, "successes", latencyMs);
  }

  recordFailure(modelId, error) {
    this._healthTracker.recordFailure(modelId, error);
    this._incrementUsage(modelId, "failures", 0);
  }

  recordTokenUsage(modelId, tokenCount) {
    this._rateLimitTracker.record(modelId, tokenCount);
  }

  _modelMatches(task, model) {
    if (task.maxTokens && model.capabilities.maxTokens < task.maxTokens) {
      return false;
    }

    if (task.needsVision && !model.capabilities.vision) {
      return false;
    }

    if (task.needsTools && !model.capabilities.tools) {
      return false;
    }

    if (task.needsStreaming && !model.capabilities.streaming) {
      return false;
    }

    if (task.needsCaching && !model.capabilities.caching) {
      return false;
    }

    if (task.needsLongContext && !model.capabilities.longContext) {
      return false;
    }

    if (task.needsReasoning && !model.capabilities.reasoning) {
      return false;
    }

    if (task.maxCost !== undefined && Number.isFinite(task.maxCost)) {
      const estimatedCost = this._estimateTaskCost(model, task);
      if (estimatedCost > task.maxCost) {
        return false;
      }
    }

    if (task.preferredProvider) {
      const preferred = String(task.preferredProvider).toLowerCase();
      if (model.provider !== preferred) {
        return false;
      }
    }

    if (this._rateLimitTracker.isRateLimited(model.id, model.rateLimit)) {
      return false;
    }

    return true;
  }

  _estimateTaskCost(model, task) {
    const inputTokens = Number.isFinite(task.estimatedInputTokens) ? task.estimatedInputTokens : 1000;
    const outputTokens = Number.isFinite(task.estimatedOutputTokens) ? task.estimatedOutputTokens : 500;
    return (model.costTier.inputPer1k * inputTokens) / 1000 + (model.costTier.outputPer1k * outputTokens) / 1000;
  }

  _routeLeastCost(available, task) {
    let best = null;
    let bestCost = Infinity;

    for (const model of available) {
      const cost = this._estimateTaskCost(model, task);
      if (cost < bestCost) {
        bestCost = cost;
        best = model;
      }
    }

    this._recordRouted(best);
    return best;
  }

  _routeHighestCapability(available, task) {
    let best = null;
    let bestScore = -Infinity;

    for (const model of available) {
      let score = 0;
      score += model.capabilities.maxTokens;

      if (model.capabilities.vision) score += CAPABILITY_WEIGHTS.vision * 10000;
      if (model.capabilities.tools) score += CAPABILITY_WEIGHTS.tools * 10000;
      if (model.capabilities.streaming) score += CAPABILITY_WEIGHTS.streaming * 10000;
      if (model.capabilities.caching) score += CAPABILITY_WEIGHTS.caching * 10000;
      if (model.capabilities.longContext) score += CAPABILITY_WEIGHTS.longContext * 10000;
      if (model.capabilities.reasoning) score += CAPABILITY_WEIGHTS.reasoning * 10000;

      const health = this._healthTracker.getHealth(model.id);
      score *= health.healthScore;

      if (score > bestScore) {
        bestScore = score;
        best = model;
      }
    }

    this._recordRouted(best);
    return best;
  }

  _routeRoundRobin(available, task) {
    const strategyKey = this._buildStrategyKey(available);

    let index = 0;
    if (this._roundRobinIndex.has(strategyKey)) {
      index = this._roundRobinIndex.get(strategyKey) + 1;
      if (index >= available.length) {
        index = 0;
      }
    }

    this._roundRobinIndex.set(strategyKey, index);
    const model = available[index];
    this._recordRouted(model);
    return model;
  }

  _routeWeightedRandom(available, task) {
    const totalWeight = available.reduce((sum, m) => sum + (Number.isFinite(m.weight) ? m.weight : 1), 0);
    let threshold = Math.random() * totalWeight;
    let selected = available[0];

    for (const model of available) {
      const w = Number.isFinite(model.weight) ? model.weight : 1;
      threshold -= w;
      if (threshold <= 0) {
        selected = model;
        break;
      }
    }

    this._recordRouted(selected);
    return selected;
  }

  _buildStrategyKey(available) {
    return available.map((m) => m.id).sort().join(",");
  }

  _resolveStrategy(strategyOverride) {
    if (strategyOverride) {
      const normalized = String(strategyOverride).toLowerCase();
      if (Object.values(STRATEGIES).includes(normalized)) {
        return normalized;
      }
    }
    return this._strategy;
  }

  _recordRouted(model) {
    if (!model) return;
    if (!this._usageStats.has(model.id)) {
      this._usageStats.set(model.id, { routed: 0, successes: 0, failures: 0, totalLatencyMs: 0 });
    }
    this._usageStats.get(model.id).routed += 1;
  }

  _incrementUsage(modelId, field, latencyMs) {
    if (!this._usageStats.has(modelId)) {
      this._usageStats.set(modelId, { routed: 0, successes: 0, failures: 0, totalLatencyMs: 0 });
    }
    const stats = this._usageStats.get(modelId);
    stats[field] += 1;
    if (latencyMs > 0) {
      stats.totalLatencyMs += latencyMs;
    }
  }
}

module.exports = {
  ModelRouter,
  STRATEGIES,
};
