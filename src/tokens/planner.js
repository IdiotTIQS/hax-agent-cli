"use strict";

const CHARS_PER_TOKEN = 4;
const TASK_COMPLEXITY_LEVELS = Object.freeze(["trivial", "low", "medium", "high", "very_high"]);

const COMPLEXITY_MULTIPLIERS = Object.freeze({
  trivial: 0.5,
  low: 1.0,
  medium: 2.0,
  high: 4.0,
  very_high: 8.0,
});

const BASE_TOKEN_ESTIMATES = Object.freeze({
  trivial: { system_prompt: 500, conversation: 1000, tools: 200, output: 500, safety_margin: 300 },
  low: { system_prompt: 800, conversation: 2000, tools: 500, output: 1000, safety_margin: 500 },
  medium: { system_prompt: 1500, conversation: 5000, tools: 2000, output: 2000, safety_margin: 1000 },
  high: { system_prompt: 3000, conversation: 10000, tools: 4000, output: 4000, safety_margin: 2000 },
  very_high: { system_prompt: 5000, conversation: 20000, tools: 8000, output: 8000, safety_margin: 4000 },
});

const MODEL_CAPABILITY_FACTORS = Object.freeze({
  default: 1.0,
});

const PHASE_WEIGHTS = Object.freeze({
  planning: { conversation: 0.3, tools: 0.1, output: 0.2, system_prompt: 0.3, safety_margin: 0.1 },
  execution: { conversation: 0.2, tools: 0.4, output: 0.2, system_prompt: 0.1, safety_margin: 0.1 },
  review: { conversation: 0.1, tools: 0.1, output: 0.6, system_prompt: 0.1, safety_margin: 0.1 },
  default: { conversation: 0.35, tools: 0.2, output: 0.25, system_prompt: 0.1, safety_margin: 0.1 },
});

const HISTORY_WINDOW_SIZE = 50;

class TokenPlanner {
  constructor() {
    this._history = [];
    this._modelProfiles = {};
  }

  plan(task, model) {
    const complexity = this._assessComplexity(task);
    const estimates = this._getBaseEstimates(complexity);
    const modelFactor = this._resolveModelFactor(model);
    const phase = this._detectPhase(task);

    const budget = {};
    for (const category of Object.keys(estimates)) {
      const base = estimates[category] * modelFactor;
      const phaseWeight = (PHASE_WEIGHTS[phase] || PHASE_WEIGHTS.default)[category] || 0.2;
      budget[category] = Math.max(1, Math.floor(base * phaseWeight * 2));
    }

    const totalTokens = Object.values(budget).reduce((sum, val) => sum + val, 0);

    return {
      totalTokens,
      categories: budget,
      complexity,
      modelFactor,
      phase,
      plan: this._generatePlanSteps(task, complexity, phase),
    };
  }

  estimate(task) {
    const complexity = this._assessComplexity(task);
    const estimates = this._getBaseEstimates(complexity);
    return Object.values(estimates).reduce((sum, val) => sum + val, 0);
  }

  optimize(budget, priorities) {
    if (!budget || typeof budget !== "object") {
      throw new Error("optimize() requires a valid budget object.");
    }

    const priorityList = Array.isArray(priorities) && priorities.length > 0
      ? priorities
      : ["conversation", "tools", "output", "safety_margin", "system_prompt"];

    const totalTokens = typeof budget.totalTokens === "number"
      ? budget.totalTokens
      : this._sumCategoryTokens(budget);

    if (totalTokens <= 0) {
      return {
        totalTokens: 0,
        categories: {},
        adjustments: [],
        message: "No tokens available to optimize.",
      };
    }

    const adjustments = [];
    const optimizedBudget = {};
    let remainingTokens = totalTokens;

    // Assign tokens in priority order, weighting higher priorities more.
    const weightMap = {};
    let totalWeight = 0;
    for (let i = 0; i < priorityList.length; i++) {
      const weight = priorityList.length - i;
      weightMap[priorityList[i]] = weight;
      totalWeight += weight;
    }

    for (const category of Object.keys(budget.categories || budget)) {
      if (!priorityList.includes(category)) {
        optimizedBudget[category] = 1;
        remainingTokens -= 1;
        adjustments.push({ category, action: "minimized", reason: "not in priority list" });
      }
    }

    for (const priority of priorityList) {
      const share = Math.floor(totalTokens * (weightMap[priority] / totalWeight));
      optimizedBudget[priority] = Math.max(2, share);
      if (priority !== priorityList[priorityList.length - 1]) {
        remainingTokens -= optimizedBudget[priority];
      }
    }

    // Assign remaining to top priority.
    if (remainingTokens > 0 && priorityList.length > 0) {
      optimizedBudget[priorityList[0]] += remainingTokens;
    }

    return {
      totalTokens,
      categories: optimizedBudget,
      adjustments,
      priorityOrder: priorityList,
    };
  }

  adjust(budget, actualUsage) {
    if (!budget || !actualUsage) {
      return budget;
    }

    const adjusted = {
      totalTokens: budget.totalTokens || 0,
      categories: {},
      insights: [],
    };

    const categories = Object.keys(budget.categories || {});
    let totalAdjusted = 0;

    for (const category of categories) {
      const planned = budget.categories[category] || 0;
      const actual = actualUsage[category] || 0;

      if (actual > planned) {
        // Over-ran budget — increase allocation.
        const overage = actual - planned;
        const newAllocation = planned + Math.ceil(overage * 1.2);
        adjusted.categories[category] = newAllocation;
        totalAdjusted += newAllocation;
        adjusted.insights.push({
          category,
          type: "overrun",
          planned,
          actual,
          overage,
          recommendation: `Increase "${category}" budget by ${Math.ceil(overage * 1.2)} tokens.`,
        });
      } else if (actual < planned * 0.5) {
        // Significant under-utilization — reduce allocation.
        const newAllocation = Math.max(1, Math.floor(actual * 1.3));
        adjusted.categories[category] = newAllocation;
        totalAdjusted += newAllocation;
        adjusted.insights.push({
          category,
          type: "underutilized",
          planned,
          actual,
          saved: planned - actual,
          recommendation: `Reduce "${category}" budget to ${newAllocation} tokens.`,
        });
      } else {
        adjusted.categories[category] = planned;
        totalAdjusted += planned;
        adjusted.insights.push({
          category,
          type: "adequate",
          planned,
          actual,
        });
      }
    }

    adjusted.totalTokens = totalAdjusted;
    return adjusted;
  }

  suggestBudget(task, model, history) {
    const taskComplexity = this._assessComplexity(task);
    const historyRecords = Array.isArray(history) ? history : [];
    const relevantHistory = this._filterRelevantHistory(historyRecords, taskComplexity);
    const modelFactor = this._resolveModelFactor(model);

    const categories = ["system_prompt", "conversation", "tools", "output", "safety_margin"];

    if (relevantHistory.length === 0) {
      // No history — use base estimates.
      const estimates = this._getBaseEstimates(taskComplexity);
      const budget = {};
      for (const cat of categories) {
        budget[cat] = Math.max(1, Math.floor(estimates[cat] * modelFactor));
      }
      return {
        totalTokens: Object.values(budget).reduce((s, v) => s + v, 0),
        categories: budget,
        confidence: "low",
        basedOn: "base_estimates",
        sampleSize: 0,
      };
    }

    // Compute median actual usage from history.
    const budget = {};
    for (const cat of categories) {
      const usages = relevantHistory
        .map((r) => (r.usage && r.usage[cat]) || 0)
        .filter((v) => v > 0)
        .sort((a, b) => a - b);

      if (usages.length === 0) {
        const estimates = this._getBaseEstimates(taskComplexity);
        budget[cat] = Math.max(1, Math.floor(estimates[cat] * modelFactor));
      } else {
        const median = this._median(usages);
        // Add 15% buffer on top of median.
        budget[cat] = Math.max(1, Math.floor(median * 1.15 * modelFactor));
      }
    }

    const totalTokens = Object.values(budget).reduce((s, v) => s + v, 0);
    const sampleSize = relevantHistory.length;
    const confidence = sampleSize > 20 ? "high" : sampleSize > 5 ? "medium" : "low";

    return {
      totalTokens,
      categories: budget,
      confidence,
      basedOn: "historical_usage",
      sampleSize,
    };
  }

  recordUsage(plan, actualUsage, task, model) {
    const record = {
      timestamp: Date.now(),
      complexity: this._assessComplexity(task),
      model: model || "unknown",
      plan: plan ? { ...plan.categories } : {},
      usage: actualUsage ? { ...actualUsage } : {},
      taskLength: typeof task === "string" ? task.length : 0,
    };

    this._history.push(record);

    // Prune old entries.
    if (this._history.length > HISTORY_WINDOW_SIZE) {
      this._history = this._history.slice(-HISTORY_WINDOW_SIZE);
    }

    // Update model profile.
    if (model) {
      if (!this._modelProfiles[model]) {
        this._modelProfiles[model] = { count: 0, totalTokens: 0, efficiencies: [] };
      }
      const profile = this._modelProfiles[model];
      profile.count += 1;
      if (actualUsage) {
        const usageTotal = Object.values(actualUsage).reduce((s, v) => s + v, 0);
        profile.totalTokens += usageTotal;
        if (plan && plan.totalTokens > 0) {
          profile.efficiencies.push(usageTotal / plan.totalTokens);
        }
      }
    }

    return record;
  }

  getHistory() {
    return [...this._history];
  }

  getModelProfile(model) {
    const profile = this._modelProfiles[model];
    if (!profile) {
      return null;
    }

    return {
      model,
      count: profile.count,
      averageTokens: profile.count > 0 ? Math.floor(profile.totalTokens / profile.count) : 0,
      averageEfficiency: profile.efficiencies.length > 0
        ? this._median(profile.efficiencies)
        : 1.0,
    };
  }

  // --- private helpers ---

  _assessComplexity(task) {
    if (!task || typeof task !== "string") {
      return "low";
    }

    const length = task.length;

    // Heuristic signals for complexity.
    let signals = 0;

    if (length > 2000) signals += 3;
    else if (length > 1000) signals += 2;
    else if (length > 500) signals += 1;

    const multiStepIndicators = [
      /\b(?:step|phase|stage)\s*\d/i,
      /\b(?:first|then|next|finally|after)\b/i,
      /\b(?:build|create|implement|design|refactor|migrate|deploy|optimize)\b/i,
      /\b(?:analyze|investigate|debug|diagnose|audit)\b/i,
      /\b(?:multiple|several|various|complex|comprehensive)\b/i,
    ];

    for (const pattern of multiStepIndicators) {
      if (pattern.test(task)) {
        signals += 1;
      }
    }

    const fileReferences = (task.match(/\b[\w./\\-]+\.\w{1,6}\b/g) || []).length;
    if (fileReferences > 10) signals += 3;
    else if (fileReferences > 5) signals += 2;
    else if (fileReferences > 2) signals += 1;

    if (signals >= 6) return "very_high";
    if (signals >= 4) return "high";
    if (signals >= 2) return "medium";
    if (signals >= 1) return "low";
    return "trivial";
  }

  _getBaseEstimates(complexity) {
    const level = TASK_COMPLEXITY_LEVELS.includes(complexity) ? complexity : "low";
    return { ...BASE_TOKEN_ESTIMATES[level] };
  }

  _resolveModelFactor(model) {
    if (!model || typeof model !== "string") {
      return MODEL_CAPABILITY_FACTORS.default;
    }

    const key = model.toLowerCase();

    // Models with larger context windows may use more tokens for the same task.
    if (/claude-opus-4/.test(key) || /deepseek-v4/.test(key) || /gpt-5\.[45]/.test(key)) {
      return 1.2;
    }

    if (/claude-sonnet|deepseek-v3|gpt-4o|gemini-2/.test(key)) {
      return 1.0;
    }

    if (/claude-haiku|gpt-4\.1-mini|deepseek-chat/.test(key)) {
      return 0.85;
    }

    return MODEL_CAPABILITY_FACTORS.default;
  }

  _detectPhase(task) {
    if (!task || typeof task !== "string") {
      return "default";
    }

    const lower = task.toLowerCase();

    if (/\b(?:plan|design|architect|outline|spec|proposal|scaffold)\b/.test(lower)) {
      return "planning";
    }

    if (/\b(?:review|check|verify|audit|inspect|examine|assess|evaluate)\b/.test(lower)) {
      return "review";
    }

    if (/\b(?:implement|build|create|write|code|fix|debug|run|execute|deploy|test|refactor)\b/.test(lower)) {
      return "execution";
    }

    return "default";
  }

  _generatePlanSteps(task, complexity, phase) {
    const steps = [];

    switch (phase) {
      case "planning":
        steps.push(
          { step: "analyze_requirements", tokens: Math.floor(this.estimate(task) * 0.2) },
          { step: "design_approach", tokens: Math.floor(this.estimate(task) * 0.3) },
          { step: "create_plan", tokens: Math.floor(this.estimate(task) * 0.3) },
          { step: "validate_plan", tokens: Math.floor(this.estimate(task) * 0.2) }
        );
        break;
      case "execution":
        steps.push(
          { step: "setup_context", tokens: Math.floor(this.estimate(task) * 0.15) },
          { step: "execute_task", tokens: Math.floor(this.estimate(task) * 0.55) },
          { step: "verify_results", tokens: Math.floor(this.estimate(task) * 0.3) }
        );
        break;
      case "review":
        steps.push(
          { step: "load_context", tokens: Math.floor(this.estimate(task) * 0.25) },
          { step: "review_changes", tokens: Math.floor(this.estimate(task) * 0.4) },
          { step: "provide_feedback", tokens: Math.floor(this.estimate(task) * 0.35) }
        );
        break;
      default:
        steps.push(
          { step: "understand_task", tokens: Math.floor(this.estimate(task) * 0.2) },
          { step: "execute", tokens: Math.floor(this.estimate(task) * 0.6) },
          { step: "report", tokens: Math.floor(this.estimate(task) * 0.2) }
        );
    }

    return steps;
  }

  _filterRelevantHistory(history, complexity) {
    if (!Array.isArray(history)) return [];

    return history.filter((record) => {
      if (!record || !record.complexity) return false;

      // Include records of same or adjacent complexity.
      const complexityIndex = TASK_COMPLEXITY_LEVELS.indexOf(complexity);
      const recordIndex = TASK_COMPLEXITY_LEVELS.indexOf(record.complexity);

      if (recordIndex === -1) return false;
      return Math.abs(complexityIndex - recordIndex) <= 1;
    });
  }

  _median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  _sumCategoryTokens(budget) {
    let total = 0;
    const cats = budget.categories || budget;
    for (const value of Object.values(cats)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        total += value;
      }
    }
    return total;
  }
}

module.exports = {
  TokenPlanner,
  TASK_COMPLEXITY_LEVELS,
  COMPLEXITY_MULTIPLIERS,
  PHASE_WEIGHTS,
};
