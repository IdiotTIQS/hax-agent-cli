"use strict";

const MODEL_PRICING = {
  "claude-sonnet-4": { inputPer1k: 0.003, outputPer1k: 0.015, cacheWritePer1k: 0.00375, cacheReadPer1k: 0.0003 },
  "claude-opus-4": { inputPer1k: 0.015, outputPer1k: 0.075, cacheWritePer1k: 0.01875, cacheReadPer1k: 0.0015 },
  "claude-haiku-4": { inputPer1k: 0.0008, outputPer1k: 0.004, cacheWritePer1k: 0.001, cacheReadPer1k: 0.00008 },
  "claude-3-5-sonnet": { inputPer1k: 0.003, outputPer1k: 0.015, cacheWritePer1k: 0.00375, cacheReadPer1k: 0.0003 },
  "claude-3-opus": { inputPer1k: 0.015, outputPer1k: 0.075, cacheWritePer1k: 0.01875, cacheReadPer1k: 0.0015 },
  "claude-haiku-3-5": { inputPer1k: 0.0008, outputPer1k: 0.004, cacheWritePer1k: 0.001, cacheReadPer1k: 0.00008 },
  "gpt-4o": { inputPer1k: 0.0025, outputPer1k: 0.01 },
  "gpt-4o-mini": { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  "gpt-4.1": { inputPer1k: 0.002, outputPer1k: 0.008 },
  "gpt-4.1-mini": { inputPer1k: 0.0004, outputPer1k: 0.0016 },
  "gpt-4-turbo": { inputPer1k: 0.01, outputPer1k: 0.03 },
  "gpt-3.5-turbo": { inputPer1k: 0.0005, outputPer1k: 0.0015 },
  "gemini-2.5-pro": { inputPer1k: 0.00125, outputPer1k: 0.01 },
  "gemini-2.5-flash": { inputPer1k: 0.000075, outputPer1k: 0.0003 },
  "gemini-1.5-pro": { inputPer1k: 0.00125, outputPer1k: 0.005 },
};

function normalizeModelId(model) {
  if (typeof model === "object" && model !== null) {
    return String(model.id || "").trim().toLowerCase();
  }
  return String(model || "").trim().toLowerCase();
}

function getModelPricing(model) {
  const id = normalizeModelId(model);
  const exactMatch = MODEL_PRICING[id];
  if (exactMatch) {
    return exactMatch;
  }

  if (typeof model === "object" && model !== null) {
    return {
      inputPer1k: Number.isFinite(model.inputPer1k) ? model.inputPer1k : (model.costTier?.inputPer1k ?? 0),
      outputPer1k: Number.isFinite(model.outputPer1k) ? model.outputPer1k : (model.costTier?.outputPer1k ?? 0),
      cacheWritePer1k: Number.isFinite(model.cacheWritePer1k) ? model.cacheWritePer1k : (model.costTier?.cacheWritePer1k ?? 0),
      cacheReadPer1k: Number.isFinite(model.cacheReadPer1k) ? model.cacheReadPer1k : (model.costTier?.cacheReadPer1k ?? 0),
    };
  }

  return { inputPer1k: 0, outputPer1k: 0 };
}

function estimateTokens(text) {
  const content = String(text ?? "");
  return content.length === 0 ? 0 : Math.ceil(content.length / 4);
}

function estimateTokensForMessage(message) {
  if (!message || typeof message !== "object") {
    return 0;
  }

  let tokens = 4;
  let contentText = "";

  if (typeof message.content === "string") {
    contentText = message.content;
  } else if (Array.isArray(message.content)) {
    contentText = message.content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text ?? part?.content ?? JSON.stringify(part ?? "");
      })
      .join("");
  } else if (message.content) {
    contentText = JSON.stringify(message.content);
  }

  tokens += estimateTokens(contentText);

  if (message.role) {
    tokens += estimateTokens(message.role);
  }

  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      tokens += estimateTokens(JSON.stringify(tc));
    }
  }

  return tokens;
}

function estimateCost(model, inputTokens, outputTokens) {
  const pricing = getModelPricing(model);
  const input = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0;
  const output = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0;

  const inputCost = (pricing.inputPer1k * input) / 1000;
  const outputCost = (pricing.outputPer1k * output) / 1000;

  return Number((inputCost + outputCost).toFixed(8));
}

function compareCosts(models, inputTokens, outputTokens) {
  if (!Array.isArray(models) || models.length === 0) {
    return [];
  }

  const input = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0;
  const output = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0;

  const ranked = models
    .map((model) => ({
      model,
      cost: estimateCost(model, input, output),
      pricing: getModelPricing(model),
    }))
    .sort((a, b) => a.cost - b.cost);

  return ranked;
}

function getCheapestModel(models, task) {
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error("At least one model is required");
  }

  const inputTokens = (task && Number.isFinite(task.estimatedInputTokens)) ? task.estimatedInputTokens : 1000;
  const outputTokens = (task && Number.isFinite(task.estimatedOutputTokens)) ? task.estimatedOutputTokens : 500;

  let cheapest = null;
  let cheapestCost = Infinity;

  for (const model of models) {
    if (!model || typeof model !== "object") {
      continue;
    }

    if (task) {
      const caps = model.capabilities || {};
      if (task.needsVision && !caps.vision) continue;
      if (task.needsTools && !caps.tools) continue;
      if (task.maxTokens && caps.maxTokens && caps.maxTokens < task.maxTokens) continue;
    }

    const cost = estimateCost(model, inputTokens, outputTokens);
    if (cost < cheapestCost) {
      cheapestCost = cost;
      cheapest = model;
    }
  }

  if (!cheapest) {
    throw new Error("No capable model found matching task requirements");
  }

  return cheapest;
}

class CacheAwareOptimizer {
  constructor(options = {}) {
    this._cacheablePatterns = Array.isArray(options.cacheablePatterns) ? options.cacheablePatterns : this._defaultCacheablePatterns();
    this._minReuseThreshold = Number.isFinite(options.minReuseThreshold) && options.minReuseThreshold > 0 ? options.minReuseThreshold : 2;
    this._queryHistory = new Map();
    this._maxHistorySize = Number.isFinite(options.maxHistorySize) && options.maxHistorySize > 0 ? options.maxHistorySize : 500;
  }

  _defaultCacheablePatterns() {
    return [
      { pattern: /^system$/i, weight: 3 },
      { pattern: /tool definitions?|function definitions?|json schemas?/i, weight: 2 },
      { pattern: /(?:instructions?|guidelines?|rules?|policy|policies)\b/i, weight: 2 },
      { pattern: /^you are /, weight: 2 },
      { pattern: /documentation|docs?|reference/i, weight: 1 },
      { pattern: /example|sample|template/i, weight: 1 },
      { pattern: /context (?:window|information|data)/i, weight: 1 },
    ];
  }

  shouldUseCache(query) {
    const text = typeof query === "string" ? query : JSON.stringify(query || "");
    const normalizedText = text.toLowerCase();
    const normalized = normalizedText.trim();

    if (normalized.length < 20) {
      return false;
    }

    const historyEntry = this._queryHistory.get(normalizedText) || { count: 0 };
    if (historyEntry.count >= this._minReuseThreshold - 1) {
      return true;
    }

    for (const { pattern, weight } of this._cacheablePatterns) {
      if (pattern.test(normalized)) {
        return weight >= 2;
      }
    }

    return false;
  }

  estimateSavings(model, inputTokens) {
    const pricing = getModelPricing(model);
    const tokens = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0;

    if (!pricing.cacheReadPer1k || !pricing.cacheWritePer1k) {
      return { savings: 0, percentage: 0, tokens };
    }

    const standardCost = (pricing.inputPer1k * tokens) / 1000;
    const cacheWriteCost = (pricing.cacheWritePer1k * tokens) / 1000;
    const cacheReadCost = (pricing.cacheReadPer1k * tokens) / 1000;

    const initialHitCost = cacheWriteCost;
    const subsequentHitCost = cacheReadCost;

    const savings = Number((standardCost - subsequentHitCost).toFixed(8));
    const percentage = standardCost > 0 ? Number(((savings / standardCost) * 100).toFixed(2)) : 0;

    return {
      savings,
      percentage,
      tokens,
      standardCost,
      cacheWriteCost,
      cacheReadCost,
    };
  }

  optimizeRequest(model, messages, options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return { messages, cacheBreakpoints: [], estimatedSavings: 0 };
    }

    const breakpoints = [];
    let accumulatedCacheTokens = 0;

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      const content = typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content || "");

      if (this.shouldUseCache(content)) {
        const messageTokens = estimateTokensForMessage(message);
        accumulatedCacheTokens += messageTokens;
        breakpoints.push({
          index: i,
          type: "cache_breakpoint",
          tokens: messageTokens,
        });
      }
    }

    const savings = this.estimateSavings(model, accumulatedCacheTokens);

    return {
      messages,
      cacheBreakpoints: breakpoints,
      estimatedSavings: savings.savings,
      cachedTokens: accumulatedCacheTokens,
    };
  }

  recordQuery(query) {
    const text = typeof query === "string" ? query : JSON.stringify(query || "");
    const key = text.toLowerCase().trim();
    const entry = this._queryHistory.get(key) || { count: 0, lastSeen: 0 };
    entry.count += 1;
    entry.lastSeen = Date.now();
    this._queryHistory.set(key, entry);

    if (this._queryHistory.size > this._maxHistorySize) {
      const oldest = Array.from(this._queryHistory.entries())
        .sort((a, b) => a[1].lastSeen - b[1].lastSeen)
        .slice(0, Math.floor(this._maxHistorySize * 0.2));
      for (const [k] of oldest) {
        this._queryHistory.delete(k);
      }
    }
  }
}

module.exports = {
  estimateCost,
  compareCosts,
  getCheapestModel,
  CacheAwareOptimizer,
  getModelPricing,
  MODEL_PRICING,
};
