"use strict";

// Pricing per 1M tokens (input, output). Prices in USD.
const MODEL_PRICING = Object.freeze({
  // OpenAI
  "gpt-4.5": { input: 75.00, output: 150.00, provider: "openai", contextWindow: 128000 },
  "gpt-4o": { input: 2.50, output: 10.00, provider: "openai", contextWindow: 128000 },
  "gpt-4o-mini": { input: 0.15, output: 0.60, provider: "openai", contextWindow: 128000 },
  "gpt-4.1": { input: 2.00, output: 8.00, provider: "openai", contextWindow: 1000000 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60, provider: "openai", contextWindow: 1000000 },
  "gpt-4.1-nano": { input: 0.10, output: 0.40, provider: "openai", contextWindow: 1000000 },
  "gpt-4-turbo": { input: 10.00, output: 30.00, provider: "openai", contextWindow: 128000 },
  "gpt-4": { input: 30.00, output: 60.00, provider: "openai", contextWindow: 8192 },
  "gpt-3.5-turbo": { input: 0.50, output: 1.50, provider: "openai", contextWindow: 16385 },
  "o1": { input: 15.00, output: 60.00, provider: "openai", contextWindow: 200000 },
  "o1-mini": { input: 1.10, output: 4.40, provider: "openai", contextWindow: 128000 },
  "o3-mini": { input: 1.10, output: 4.40, provider: "openai", contextWindow: 200000 },

  // Anthropic
  "claude-opus-4": { input: 15.00, output: 75.00, provider: "anthropic", contextWindow: 200000 },
  "claude-sonnet-4": { input: 3.00, output: 15.00, provider: "anthropic", contextWindow: 200000 },
  "claude-haiku-3.5": { input: 0.80, output: 4.00, provider: "anthropic", contextWindow: 200000 },
  "claude-opus-3": { input: 15.00, output: 75.00, provider: "anthropic", contextWindow: 200000 },
  "claude-sonnet-3.5": { input: 3.00, output: 15.00, provider: "anthropic", contextWindow: 200000 },
  "claude-haiku-3": { input: 0.25, output: 1.25, provider: "anthropic", contextWindow: 200000 },

  // Google
  "gemini-2.5-pro": { input: 1.25, output: 10.00, provider: "google", contextWindow: 1000000 },
  "gemini-2.5-flash": { input: 0.15, output: 0.60, provider: "google", contextWindow: 1000000 },
  "gemini-2.0-flash": { input: 0.10, output: 0.40, provider: "google", contextWindow: 1000000 },
  "gemini-2.0-pro": { input: 1.25, output: 5.00, provider: "google", contextWindow: 2000000 },
  "gemini-1.5-pro": { input: 1.25, output: 5.00, provider: "google", contextWindow: 2000000 },
  "gemini-1.5-flash": { input: 0.075, output: 0.30, provider: "google", contextWindow: 1000000 },

  // DeepSeek
  "deepseek-v3": { input: 0.27, output: 1.10, provider: "deepseek", contextWindow: 128000 },
  "deepseek-r1": { input: 0.55, output: 2.19, provider: "deepseek", contextWindow: 128000 },
  "deepseek-chat": { input: 0.14, output: 0.28, provider: "deepseek", contextWindow: 128000 },
  "deepseek-reasoner": { input: 0.55, output: 2.19, provider: "deepseek", contextWindow: 128000 },

  // Meta
  "llama-3.1-405b": { input: 2.50, output: 3.00, provider: "meta", contextWindow: 131072 },
  "llama-3.1-70b": { input: 0.59, output: 0.79, provider: "meta", contextWindow: 131072 },
  "llama-3.1-8b": { input: 0.06, output: 0.06, provider: "meta", contextWindow: 131072 },
  "llama-3.3-70b": { input: 0.59, output: 0.79, provider: "meta", contextWindow: 131072 },

  // Mistral
  "mistral-large": { input: 2.00, output: 6.00, provider: "mistral", contextWindow: 128000 },
  "mistral-small": { input: 0.20, output: 0.60, provider: "mistral", contextWindow: 32000 },
  "mistral-8x22b": { input: 1.00, output: 2.00, provider: "mistral", contextWindow: 64000 },

  // Amazon
  "nova-pro": { input: 0.80, output: 3.20, provider: "amazon", contextWindow: 300000 },
  "nova-lite": { input: 0.06, output: 0.24, provider: "amazon", contextWindow: 300000 },
  "nova-micro": { input: 0.035, output: 0.14, provider: "amazon", contextWindow: 128000 },
});

const DEFAULT_BUDGET = 5.00; // $5 default session budget
const DEFAULT_ALERT_THRESHOLDS = Object.freeze({
  warning: 0.60,   // 60% of budget
  critical: 0.85,  // 85% of budget
  overBudget: 1.0, // 100% of budget
});

const MAX_RECORDS = 10000;

class CostTracker {
  constructor(options = {}) {
    this._records = [];
    this._sessionStart = Date.now();
    this._budgetLimit = options.budgetLimit || DEFAULT_BUDGET;
    this._thresholds = { ...DEFAULT_ALERT_THRESHOLDS, ...(options.thresholds || {}) };
    this._alerts = [];
    this._customPricing = options.customPricing ? { ...options.customPricing } : null;
    this._sessionName = options.sessionName || "default";
    this._tags = options.tags || [];
  }

  // --- public API ---

  /**
   * Record a token usage event and compute cost.
   * @param {string} model - Model name (matched against MODEL_PRICING keys).
   * @param {number} inputTokens - Number of input/prompt tokens.
   * @param {number} outputTokens - Number of output/completion tokens.
   * @param {object} [metadata] - Optional metadata (requestId, duration, etc.).
   * @returns {object} The cost record.
   */
  track(model, inputTokens, outputTokens, metadata = {}) {
    const pricing = this._resolvePricing(model);
    const inTokens = this._clampPositive(inputTokens);
    const outTokens = this._clampPositive(outputTokens);

    const inputCost = (inTokens / 1_000_000) * pricing.input;
    const outputCost = (outTokens / 1_000_000) * pricing.output;
    const totalCost = inputCost + outputCost;

    const record = {
      timestamp: Date.now(),
      model,
      provider: pricing.provider,
      inputTokens: inTokens,
      outputTokens: outTokens,
      totalTokens: inTokens + outTokens,
      inputCost: this._roundCost(inputCost),
      outputCost: this._roundCost(outputCost),
      totalCost: this._roundCost(totalCost),
      metadata: { ...metadata },
    };

    this._records.push(record);

    // Prune old records.
    while (this._records.length > MAX_RECORDS) {
      this._records.shift();
    }

    // Check budget alerts.
    this._checkBudgetAlerts(record);

    return record;
  }

  /**
   * Get the total cost for the current session.
   * @returns {object} Session cost summary.
   */
  getSessionCost() {
    const totalInputCost = this._records.reduce((s, r) => s + r.inputCost, 0);
    const totalOutputCost = this._records.reduce((s, r) => s + r.outputCost, 0);
    const totalCost = totalInputCost + totalOutputCost;
    const totalInputTokens = this._records.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutputTokens = this._records.reduce((s, r) => s + r.outputTokens, 0);
    const totalTokens = totalInputTokens + totalOutputTokens;

    const byModel = {};
    for (const r of this._records) {
      if (!byModel[r.model]) {
        byModel[r.model] = { model: r.model, provider: r.provider, calls: 0, totalTokens: 0, totalCost: 0 };
      }
      byModel[r.model].calls += 1;
      byModel[r.model].totalTokens += r.totalTokens;
      byModel[r.model].totalCost = this._roundCost(byModel[r.model].totalCost + r.totalCost);
    }

    const byProvider = {};
    for (const modelData of Object.values(byModel)) {
      if (!byProvider[modelData.provider]) {
        byProvider[modelData.provider] = { provider: modelData.provider, calls: 0, totalTokens: 0, totalCost: 0 };
      }
      byProvider[modelData.provider].calls += modelData.calls;
      byProvider[modelData.provider].totalTokens += modelData.totalTokens;
      byProvider[modelData.provider].totalCost = this._roundCost(
        byProvider[modelData.provider].totalCost + modelData.totalCost
      );
    }

    const sessionDurationMs = Date.now() - this._sessionStart;
    const costPerMinute = sessionDurationMs > 0
      ? (totalCost / (sessionDurationMs / 60000))
      : 0;

    return {
      sessionName: this._sessionName,
      totalCost: this._roundCost(totalCost),
      totalInputCost: this._roundCost(totalInputCost),
      totalOutputCost: this._roundCost(totalOutputCost),
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      totalCalls: this._records.length,
      budgetLimit: this._budgetLimit,
      budgetRemaining: this._roundCost(this._budgetLimit - totalCost),
      budgetUsedPercent: this._budgetLimit > 0
        ? Math.round((totalCost / this._budgetLimit) * 10000) / 100
        : 0,
      sessionDurationMs,
      sessionDurationMinutes: Math.round(sessionDurationMs / 60000 * 100) / 100,
      costPerMinute: this._roundCost(costPerMinute),
      costPerCall: this._records.length > 0
        ? this._roundCost(totalCost / this._records.length)
        : 0,
      byModel,
      byProvider,
      alerts: this._alerts.length,
    };
  }

  /**
   * Project the final session cost based on current trends.
   * @param {object} [session] - Optional session descriptor { estimatedRemainingCalls, estimatedRemainingMinutes }.
   * @returns {object} Cost projection.
   */
  projectCost(session = {}) {
    const current = this.getSessionCost();

    if (this._records.length === 0) {
      return {
        currentCost: current.totalCost,
        projectedCost: current.totalCost,
        confidence: "low",
        method: "none",
        message: "No usage records; cannot project cost.",
        isOverBudget: current.totalCost > this._budgetLimit,
        costPerMinute: 0,
        avgCallCost: 0,
        callsPerMinute: 0,
        timeProjection: null,
        callProjection: null,
      };
    }

    const elapsedMs = current.sessionDurationMs;
    const elapsedMinutes = Math.max(0.001, current.sessionDurationMinutes);
    const avgCallCost = current.totalCost / this._records.length;

    let costPerMinute;
    let callsPerMinute;

    if (elapsedMinutes > 0.001) {
      costPerMinute = current.totalCost / elapsedMinutes;
      callsPerMinute = this._records.length / elapsedMinutes;
    } else {
      // Elapsed time too small — estimate from call count.
      costPerMinute = avgCallCost * 5; // assume ~5 calls per minute
      callsPerMinute = 5;
    }

    // Projection 1: Time-based (if estimatedRemainingMinutes provided).
    let timeProjection = null;
    if (typeof session.estimatedRemainingMinutes === "number" && session.estimatedRemainingMinutes > 0) {
      timeProjection = current.totalCost + costPerMinute * session.estimatedRemainingMinutes;
    }

    // Projection 2: Call-based (if estimatedRemainingCalls provided).
    let callProjection = null;
    if (typeof session.estimatedRemainingCalls === "number" && session.estimatedRemainingCalls > 0) {
      callProjection = current.totalCost + avgCallCost * session.estimatedRemainingCalls;
    }

    // Projection 3: Linear extrapolation (estimate remaining = 50% of elapsed, min 1 min).
    const modeledRemainingMin = Math.max(1, elapsedMinutes * 0.5);
    const linearProjection = current.totalCost + costPerMinute * modeledRemainingMin;

    // Use the most specific projection available.
    let projectedCost;
    let method;

    if (callProjection !== null) {
      projectedCost = callProjection;
      method = "call_based";
    } else if (timeProjection !== null) {
      projectedCost = timeProjection;
      method = "time_based";
    } else {
      projectedCost = linearProjection;
      method = "linear_extrapolation";
    }

    const isOverBudget = projectedCost > this._budgetLimit;
    const confidence = this._records.length > 50 ? "high" : this._records.length > 10 ? "medium" : "low";

    let message;
    if (isOverBudget) {
      const overage = projectedCost - this._budgetLimit;
      message = `Projected to exceed budget by $${this._roundCost(overage)}. Consider switching to a cheaper model or applying token optimization strategies.`;
    } else {
      const remaining = this._budgetLimit - projectedCost;
      message = `Projected to stay within budget with $${this._roundCost(remaining)} remaining.`;
    }

    return {
      currentCost: current.totalCost,
      projectedCost: this._roundCost(projectedCost),
      budgetLimit: this._budgetLimit,
      isOverBudget,
      confidence,
      method,
      costPerMinute: this._roundCost(costPerMinute),
      avgCallCost: this._roundCost(avgCallCost),
      callsPerMinute: Math.round(callsPerMinute * 100) / 100,
      timeProjection: timeProjection !== null ? this._roundCost(timeProjection) : null,
      callProjection: callProjection !== null ? this._roundCost(callProjection) : null,
      message,
    };
  }

  /**
   * Compare cost across multiple models for a given task.
   * @param {object} task - { inputTokens, estimatedOutputTokens, estimatedCalls }.
   * @param {Array<string>} [models] - Models to compare (defaults to all known models).
   * @returns {object} Comparison results sorted by total estimated cost.
   */
  compareModels(task, models = null) {
    const inputTokens = this._clampPositive(task.inputTokens);
    const outputTokens = this._clampPositive(task.estimatedOutputTokens || 0);
    const calls = Math.max(1, this._clampPositive(task.estimatedCalls || 1));

    const modelsToCompare = Array.isArray(models) && models.length > 0
      ? models
      : Object.keys(MODEL_PRICING);

    const results = [];

    for (const model of modelsToCompare) {
      const pricing = this._resolvePricing(model);
      const perCallInputCost = (inputTokens / 1_000_000) * pricing.input;
      const perCallOutputCost = (outputTokens / 1_000_000) * pricing.output;
      const perCallCost = perCallInputCost + perCallOutputCost;
      const totalCost = perCallCost * calls;

      results.push({
        model,
        provider: pricing.provider,
        contextWindow: pricing.contextWindow,
        inputPricePerM: pricing.input,
        outputPricePerM: pricing.output,
        perCallCost: this._roundCost(perCallCost),
        totalCost: this._roundCost(totalCost),
        totalInputTokens: inputTokens * calls,
        totalOutputTokens: outputTokens * calls,
        estimatedCalls: calls,
        isRecommended: false,
      });
    }

    // Sort by total cost ascending.
    results.sort((a, b) => a.totalCost - b.totalCost);

    // Mark top 3 as recommended.
    const top3 = results.slice(0, 3);
    for (const r of top3) {
      r.isRecommended = true;
    }

    const cheapest = results[0];
    const mostExpensive = results[results.length - 1];
    const savingsPotential = mostExpensive
      ? this._roundCost(mostExpensive.totalCost - cheapest.totalCost)
      : 0;

    return {
      task: {
        inputTokensPerCall: inputTokens,
        outputTokensPerCall: outputTokens,
        estimatedCalls: calls,
      },
      results,
      cheapest: cheapest ? { model: cheapest.model, totalCost: cheapest.totalCost } : null,
      mostExpensive: mostExpensive ? { model: mostExpensive.model, totalCost: mostExpensive.totalCost } : null,
      savingsPotential,
      recommendation: cheapest
        ? `Use ${cheapest.model} to minimize cost at $${cheapest.totalCost} total.`
        : "No models available for comparison.",
    };
  }

  /**
   * Identify cost-saving opportunities from usage patterns.
   * @returns {object} Opportunities with estimated savings.
   */
  getSavingsOpportunities() {
    const opportunities = [];
    const current = this.getSessionCost();

    // Opportunity 1: High-cost model usage.
    const highCostModels = [];
    for (const [model, data] of Object.entries(current.byModel)) {
      if (data.totalCost > 1.0 && data.calls > 5) {
        const pricing = this._resolvePricing(model);
        // Find cheaper alternatives from the same provider.
        const sameProviderModels = Object.entries(MODEL_PRICING)
          .filter(([, p]) => p.provider === pricing.provider)
          .sort(([, a], [, b]) => (a.input + a.output) - (b.input + b.output));

        const cheaperAlternatives = sameProviderModels
          .filter(([, p]) => (p.input + p.output) < (pricing.input + pricing.output))
          .slice(0, 3);

        if (cheaperAlternatives.length > 0) {
          const savingsPerCall = cheaperAlternatives.map(([altModel, altPricing]) => {
            const currentCallCost = data.totalCost / Math.max(1, data.calls);
            const avgTokens = data.totalTokens / Math.max(1, data.calls);
            const inputRatio = current.totalInputTokens / Math.max(1, current.totalTokens);
            const altInputTokens = avgTokens * inputRatio;
            const altOutputTokens = avgTokens * (1 - inputRatio);
            const altCallCost =
              (altInputTokens / 1_000_000) * altPricing.input +
              (altOutputTokens / 1_000_000) * altPricing.output;
            return {
              alternative: altModel,
              currentCallCost: this._roundCost(currentCallCost),
              alternativeCallCost: this._roundCost(altCallCost),
              savingsPerCall: this._roundCost(currentCallCost - altCallCost),
              totalSavings: this._roundCost((currentCallCost - altCallCost) * data.calls),
            };
          });

          const best = savingsPerCall.reduce((a, b) => a.totalSavings > b.totalSavings ? a : b);

          highCostModels.push({
            model,
            currentTotalCost: this._roundCost(data.totalCost),
            calls: data.calls,
            bestAlternative: best.alternative,
            estimatedSavings: best.totalSavings,
            allAlternatives: savingsPerCall,
          });
        }
      }
    }

    if (highCostModels.length > 0) {
      opportunities.push({
        type: "switch_cheaper_model",
        description: "Switch to cheaper models for high-cost usage",
        potentialSavings: this._roundCost(
          highCostModels.reduce((s, m) => s + m.estimatedSavings, 0)
        ),
        details: highCostModels,
      });
    }

    // Opportunity 2: High output-to-input ratio.
    const totalInput = current.totalInputTokens;
    const totalOutput = current.totalOutputTokens;
    if (totalInput > 0 && totalOutput / totalInput > 1.5 && current.totalCost > 1.0) {
      // Output tokens are typically more expensive.
      const outputHeavyModels = Object.entries(current.byModel)
        .filter(([, data]) => data.totalTokens > 0)
        .map(([model, data]) => {
          const pricing = this._resolvePricing(model);
          const outputRatio = pricing.output / Math.max(0.001, pricing.input);
          return { model, outputPriceRatio: outputRatio, totalCost: data.totalCost };
        })
        .filter((m) => m.outputPriceRatio > 3)
        .sort((a, b) => b.totalCost - a.totalCost)
        .slice(0, 3);

      if (outputHeavyModels.length > 0) {
        const estimatedSavings = outputHeavyModels.reduce((s, m) => s + m.totalCost * 0.25, 0);
        opportunities.push({
          type: "reduce_output_tokens",
          description: "High output-to-input ratio. Consider limiting response length or being more specific.",
          potentialSavings: this._roundCost(estimatedSavings),
          details: outputHeavyModels,
        });
      }
    }

    // Opportunity 3: Many small calls (aggregation opportunity).
    if (this._records.length > 50) {
      const avgTokens = current.totalTokens / Math.max(1, this._records.length);
      if (avgTokens < 500) {
        opportunities.push({
          type: "batch_calls",
          description: "Many small API calls detected. Consider batching requests to reduce per-call overhead.",
          potentialSavings: this._roundCost(current.totalCost * 0.15),
          details: {
            totalCalls: this._records.length,
            avgTokensPerCall: Math.round(avgTokens),
          },
        });
      }
    }

    // Opportunity 4: Budget threshold warning.
    if (current.budgetRemaining < this._budgetLimit * 0.2) {
      opportunities.push({
        type: "budget_warning",
        description: `Only ${Math.round(current.budgetUsedPercent)}% of budget remaining.`,
        potentialSavings: 0,
        details: {
          budgetUsed: current.totalCost,
          budgetLimit: this._budgetLimit,
          remaining: current.budgetRemaining,
        },
      });
    }

    const totalPotentialSavings = opportunities.reduce((s, o) => s + o.potentialSavings, 0);

    return {
      opportunities,
      totalPotentialSavings: this._roundCost(totalPotentialSavings),
      sessionCost: current.totalCost,
      savingsPercent: current.totalCost > 0
        ? Math.round((totalPotentialSavings / current.totalCost) * 10000) / 100
        : 0,
      timestamp: Date.now(),
    };
  }

  /**
   * Get all active budget alerts.
   * @returns {Array} List of alert objects.
   */
  getAlerts() {
    return [...this._alerts];
  }

  /**
   * Reset the tracker for a new session.
   * @param {object} [options] - New session options.
   */
  reset(options = {}) {
    this._records = [];
    this._sessionStart = Date.now();
    this._alerts = [];
    if (options.budgetLimit !== undefined) this._budgetLimit = options.budgetLimit;
    if (options.sessionName !== undefined) this._sessionName = options.sessionName;
    if (options.tags !== undefined) this._tags = options.tags;
  }

  /**
   * Set a new budget limit.
   * @param {number} limit - New budget limit in USD.
   */
  setBudget(limit) {
    const clamped = Math.max(0, Number(limit) || 0);
    this._budgetLimit = clamped;
    return this;
  }

  /**
   * Get the model pricing database.
   * @returns {object} Frozen copy of pricing data.
   */
  static getModelPricing() {
    return { ...MODEL_PRICING };
  }

  /**
   * Look up pricing for a specific model.
   * @param {string} model
   * @returns {object | null}
   */
  static lookupModel(model) {
    return MODEL_PRICING[model] || null;
  }

  /**
   * Export session data for persistence.
   * @returns {object} Serializable session data.
   */
  export() {
    return {
      sessionName: this._sessionName,
      sessionStart: this._sessionStart,
      budgetLimit: this._budgetLimit,
      thresholds: { ...this._thresholds },
      tags: [...this._tags],
      records: this._records.map((r) => ({ ...r })),
      alerts: this._alerts.map((a) => ({ ...a })),
    };
  }

  /**
   * Import session data from a previous export.
   * @param {object} data
   */
  import(data) {
    if (!data || typeof data !== "object") return;

    if (typeof data.sessionName === "string") this._sessionName = data.sessionName;
    if (typeof data.sessionStart === "number") this._sessionStart = data.sessionStart;
    if (typeof data.budgetLimit === "number") this._budgetLimit = data.budgetLimit;
    if (data.thresholds && typeof data.thresholds === "object") {
      this._thresholds = { ...DEFAULT_ALERT_THRESHOLDS, ...data.thresholds };
    }
    if (Array.isArray(data.tags)) this._tags = [...data.tags];
    if (Array.isArray(data.records)) this._records = data.records.map((r) => ({ ...r }));
    if (Array.isArray(data.alerts)) this._alerts = data.alerts.map((a) => ({ ...a }));
  }

  // --- private helpers ---

  _resolvePricing(model) {
    // Normalize model name.
    const normalized = model ? model.toLowerCase().trim() : "";

    // Direct match.
    if (MODEL_PRICING[normalized]) {
      return MODEL_PRICING[normalized];
    }

    // Custom pricing.
    if (this._customPricing && this._customPricing[normalized]) {
      return {
        ...this._customPricing[normalized],
        provider: this._customPricing[normalized].provider || "custom",
        contextWindow: this._customPricing[normalized].contextWindow || 128000,
      };
    }

    // Fuzzy match: check if any known model name is a substring.
    for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return pricing;
      }
    }

    // Default fallback — assume a mid-range model price.
    return {
      input: 3.00,
      output: 15.00,
      provider: "unknown",
      contextWindow: 128000,
    };
  }

  _checkBudgetAlerts(record) {
    const currentTotal = this._records.reduce((s, r) => s + r.totalCost, 0);
    const ratio = this._budgetLimit > 0 ? currentTotal / this._budgetLimit : 0;

    if (ratio >= this._thresholds.overBudget) {
      const existing = this._alerts.find((a) => a.type === "over_budget");
      if (!existing) {
        this._alerts.push({
          type: "over_budget",
          severity: "critical",
          timestamp: record.timestamp,
          totalCost: this._roundCost(currentTotal),
          budgetLimit: this._budgetLimit,
          ratio: Math.round(ratio * 100) / 100,
          message: `BUDGET EXCEEDED: $${this._roundCost(currentTotal)} spent of $${this._budgetLimit} limit.`,
        });
      }
    } else if (ratio >= this._thresholds.critical) {
      const existing = this._alerts.find((a) => a.type === "critical_threshold" && a.ratio >= this._thresholds.critical);
      if (!existing) {
        this._alerts.push({
          type: "critical_threshold",
          severity: "critical",
          timestamp: record.timestamp,
          totalCost: this._roundCost(currentTotal),
          budgetLimit: this._budgetLimit,
          ratio: Math.round(ratio * 100) / 100,
          message: `CRITICAL: ${Math.round(ratio * 100)}% of budget used. Consider switching models or applying token optimization.`,
        });
      }
    } else if (ratio >= this._thresholds.warning) {
      const existing = this._alerts.find((a) => a.type === "warning_threshold" && a.ratio >= this._thresholds.warning);
      if (!existing) {
        this._alerts.push({
          type: "warning_threshold",
          severity: "warning",
          timestamp: record.timestamp,
          totalCost: this._roundCost(currentTotal),
          budgetLimit: this._budgetLimit,
          ratio: Math.round(ratio * 100) / 100,
          message: `Warning: ${Math.round(ratio * 100)}% of budget used.`,
        });
      }
    }

    // Prune old alerts.
    if (this._alerts.length > 500) {
      this._alerts = this._alerts.slice(-500);
    }
  }

  _roundCost(value) {
    return Math.round(value * 10000) / 10000;
  }

  _clampPositive(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      return 0;
    }
    return Math.floor(num);
  }
}

module.exports = {
  CostTracker,
  MODEL_PRICING,
  DEFAULT_BUDGET,
  DEFAULT_ALERT_THRESHOLDS,
};
