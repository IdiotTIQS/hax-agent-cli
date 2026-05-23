"use strict";

const DEFAULT_CRITERIA = Object.freeze(["quality", "latency", "cost", "toolUse"]);

const DEFAULT_WEIGHTS = Object.freeze({
  quality: 0.4,
  latency: 0.25,
  cost: 0.2,
  toolUse: 0.15,
});

class ResponseComparator {
  constructor(options = {}) {
    this._weights = {
      quality: Number.isFinite(options.qualityWeight) ? options.qualityWeight : DEFAULT_WEIGHTS.quality,
      latency: Number.isFinite(options.latencyWeight) ? options.latencyWeight : DEFAULT_WEIGHTS.latency,
      cost: Number.isFinite(options.costWeight) ? options.costWeight : DEFAULT_WEIGHTS.cost,
      toolUse: Number.isFinite(options.toolUseWeight) ? options.toolUseWeight : DEFAULT_WEIGHTS.toolUse,
    };
    this._comparisons = [];
  }

  compare(a, b) {
    if (!a || !b) {
      throw new Error("Both responses are required for comparison");
    }

    const qualityDiff = this.compareQuality(a, b);
    const latencyDiff = this.compareLatency(a, b);
    const costDiff = this.compareCost(a, b);
    const toolDiff = this.compareToolUse(a, b);

    const weightedScore =
      qualityDiff.score * this._weights.quality +
      latencyDiff.score * this._weights.latency +
      costDiff.score * this._weights.cost +
      toolDiff.score * this._weights.toolUse;

    const result = {
      a: this._describeResponse(a),
      b: this._describeResponse(b),
      winner: null,
      dimensions: {
        quality: qualityDiff,
        latency: latencyDiff,
        cost: costDiff,
        toolUse: toolDiff,
      },
      overallScore: Math.round(weightedScore * 1000) / 1000,
    };

    if (qualityDiff.winner && latencyDiff.winner && costDiff.winner && toolDiff.winner) {
      result.winner = qualityDiff.winner;
      result.confidence = "high";
    } else if (weightedScore > 0.15) {
      result.winner = "a";
      result.confidence = "medium";
    } else if (weightedScore < -0.15) {
      result.winner = "b";
      result.confidence = "medium";
    } else {
      result.winner = null;
      result.confidence = "low";
    }

    this._comparisons.push(result);
    return result;
  }

  compareQuality(a, b) {
    const aContent = this._getContent(a);
    const bContent = this._getContent(b);

    const aMetrics = this._computeQualityMetrics(aContent);
    const bMetrics = this._computeQualityMetrics(bContent);

    const scores = {
      a: aMetrics.score,
      b: bMetrics.score,
      differences: {
        length: aMetrics.length - bMetrics.length,
        wordCount: aMetrics.wordCount - bMetrics.wordCount,
        sentenceCount: aMetrics.sentenceCount - bMetrics.sentenceCount,
        avgWordLength: Math.round((aMetrics.avgWordLength - bMetrics.avgWordLength) * 100) / 100,
        structureScore: Math.round((aMetrics.structureScore - bMetrics.structureScore) * 100) / 100,
        uniquenessScore: Math.round((aMetrics.uniquenessScore - bMetrics.uniquenessScore) * 100) / 100,
      },
      score: Math.round((aMetrics.score - bMetrics.score) * 1000) / 1000,
      winner: aMetrics.score > bMetrics.score ? "a" : bMetrics.score > aMetrics.score ? "b" : null,
      details: {
        a: aMetrics,
        b: bMetrics,
      },
    };

    return scores;
  }

  compareLatency(a, b) {
    const aLatency = this._getLatency(a);
    const bLatency = this._getLatency(b);

    const aScore = this._normalizeLatencyScore(aLatency);
    const bScore = this._normalizeLatencyScore(bLatency);

    return {
      a: aLatency,
      b: bLatency,
      differenceMs: aLatency - bLatency,
      winner: aLatency < bLatency ? "a" : bLatency < aLatency ? "b" : null,
      score: Math.round((aScore - bScore) * 1000) / 1000,
      fasterByPercent: this._computePercentDifference(aLatency, bLatency),
    };
  }

  compareCost(a, b) {
    const aCost = this._getCost(a);
    const bCost = this._getCost(b);

    const aScore = this._normalizeCostScore(aCost);
    const bScore = this._normalizeCostScore(bCost);

    return {
      a: aCost,
      b: bCost,
      difference: Math.round((aCost - bCost) * 1000000) / 1000000,
      winner: aCost < bCost ? "a" : bCost < aCost ? "b" : null,
      score: Math.round((aScore - bScore) * 1000) / 1000,
      cheaperByPercent: this._computePercentDifference(aCost, bCost),
    };
  }

  compareToolUse(a, b) {
    const aToolCalls = this._getToolCalls(a);
    const bToolCalls = this._getToolCalls(b);

    const aEffectiveness = this._computeToolEffectiveness(aToolCalls, a);
    const bEffectiveness = this._computeToolEffectiveness(bToolCalls, b);

    return {
      a: aEffectiveness,
      b: bEffectiveness,
      toolCountDiff: aEffectiveness.count - bEffectiveness.count,
      winner: aEffectiveness.score > bEffectiveness.score ? "a" : bEffectiveness.score > aEffectiveness.score ? "b" : null,
      score: Math.round((aEffectiveness.score - bEffectiveness.score) * 1000) / 1000,
    };
  }

  rankResponses(responses, criteria = null) {
    if (!Array.isArray(responses) || responses.length === 0) {
      throw new Error("At least one response is required for ranking");
    }

    const criteriaList = criteria || DEFAULT_CRITERIA;
    const normalizedCriteria = Array.isArray(criteriaList) ? criteriaList : [criteriaList];

    const scored = responses.map((response, index) => {
      const scores = {};
      let totalWeightedScore = 0;
      let totalWeight = 0;

      for (const criterion of normalizedCriteria) {
        const weight = this._weights[criterion] || 0.25;
        switch (criterion) {
          case "quality":
            scores.quality = this._computeQualityScore(response);
            totalWeightedScore += scores.quality * weight;
            break;
          case "latency":
            scores.latency = this._computeLatencyScore(response);
            totalWeightedScore += scores.latency * weight;
            break;
          case "cost":
            scores.cost = this._computeCostScore(response);
            totalWeightedScore += scores.cost * weight;
            break;
          case "toolUse":
            scores.toolUse = this._computeToolUseScore(response);
            totalWeightedScore += scores.toolUse * weight;
            break;
          default:
            break;
        }
        totalWeight += weight;
      }

      const normalizedScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;

      return {
        index,
        provider: this._getProvider(response),
        scores,
        totalScore: Math.round(normalizedScore * 1000) / 1000,
        response,
      };
    });

    scored.sort((a, b) => b.totalScore - a.totalScore);

    return scored.map((entry, rank) => ({
      ...entry,
      rank: rank + 1,
    }));
  }

  selectBest(responses, weights = null) {
    if (!Array.isArray(responses) || responses.length === 0) {
      throw new Error("At least one response is required for selection");
    }

    if (responses.length === 1) {
      return { ...responses[0], rank: 1 };
    }

    const effectiveWeights = weights || this._weights;
    const ranked = this.rankResponses(responses, Object.keys(effectiveWeights));
    const best = ranked[0];

    return {
      provider: best.provider,
      response: best.response,
      scores: best.scores,
      totalScore: best.totalScore,
      rank: 1,
      confidence: ranked.length > 1
        ? Math.round((best.totalScore / Math.max(ranked[1].totalScore, 0.001)) * 100) / 100
        : 1,
    };
  }

  getHistory() {
    return [...this._comparisons];
  }

  clearHistory() {
    this._comparisons = [];
  }

  setWeights(weights) {
    if (weights && typeof weights === "object") {
      if (Number.isFinite(weights.quality)) this._weights.quality = weights.quality;
      if (Number.isFinite(weights.latency)) this._weights.latency = weights.latency;
      if (Number.isFinite(weights.cost)) this._weights.cost = weights.cost;
      if (Number.isFinite(weights.toolUse)) this._weights.toolUse = weights.toolUse;
    }
  }

  getWeights() {
    return { ...this._weights };
  }

  _describeResponse(response) {
    return {
      provider: this._getProvider(response),
      contentLength: this._getContent(response).length,
      latencyMs: this._getLatency(response),
      cost: this._getCost(response),
      toolCalls: this._getToolCalls(response).length,
    };
  }

  _computeQualityMetrics(content) {
    const text = String(content || "").trim();
    const words = text.length > 0 ? text.split(/\s+/) : [];
    const sentences = text.length > 0 ? text.split(/[.!?]+/).filter((s) => s.trim().length > 0) : [];
    const uniqueWords = new Set(words.map((w) => w.toLowerCase()));

    const avgWordLength = words.length > 0
      ? words.reduce((sum, w) => sum + w.length, 0) / words.length
      : 0;

    const structureScore = this._calculateStructureScore(text, sentences);
    const uniquenessScore = words.length > 0 ? uniqueWords.size / words.length : 0;

    const lengthScore = Math.min(1, text.length / 2000);
    const wordCountScore = Math.min(1, words.length / 400);
    const avgWordLenScore = Math.min(1, avgWordLength / 7);

    const score =
      lengthScore * 0.2 +
      wordCountScore * 0.2 +
      avgWordLenScore * 0.1 +
      structureScore * 0.25 +
      uniquenessScore * 0.25;

    return {
      length: text.length,
      wordCount: words.length,
      sentenceCount: sentences.length,
      uniqueWordCount: uniqueWords.size,
      avgWordLength: Math.round(avgWordLength * 100) / 100,
      structureScore: Math.round(structureScore * 1000) / 1000,
      uniquenessScore: Math.round(uniquenessScore * 1000) / 1000,
      score: Math.round(score * 1000) / 1000,
    };
  }

  _calculateStructureScore(text, sentences) {
    if (sentences.length === 0) return 0;

    let score = 0;

    if (sentences.length >= 2) score += 0.3;
    if (sentences.length >= 3) score += 0.2;

    const avgLetters = /[a-zA-Z]/g;
    const letterCount = (text.match(avgLetters) || []).length;
    if (letterCount > 0 && sentences.length > 0) {
      const wordsPerSentence = letterCount / sentences.length / 5;
      if (wordsPerSentence >= 5 && wordsPerSentence <= 40) score += 0.3;
    }

    if (text.includes("\n")) score += 0.1;
    if (/^\s*(?:[*-]\s|(?:\d+[.)]\s))/m.test(text)) score += 0.1;

    return Math.min(1, score);
  }

  _normalizeLatencyScore(latencyMs) {
    if (!Number.isFinite(latencyMs) || latencyMs <= 0) return 0.5;
    return Math.min(1, Math.max(0, 1 - latencyMs / 30000));
  }

  _normalizeCostScore(cost) {
    if (!Number.isFinite(cost) || cost <= 0) return 0.5;
    return Math.min(1, Math.max(0, 1 - cost * 1000));
  }

  _computePercentDifference(aValue, bValue) {
    const maxVal = Math.max(aValue, bValue);
    if (maxVal === 0) return 0;
    return Math.round((Math.abs(aValue - bValue) / maxVal) * 100);
  }

  _computeToolEffectiveness(toolCalls, response) {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return {
        count: 0,
        uniqueTools: 0,
        errorRate: 0,
        score: 0.3,
      };
    }

    const uniqueNames = new Set(toolCalls.map((t) => t.name || "unknown")).size;
    const errors = toolCalls.filter((t) => t.isError === true || t.error).length;
    const errorRate = toolCalls.length > 0 ? errors / toolCalls.length : 0;

    const countScore = Math.min(1, toolCalls.length / 5);
    const uniquenessScore = Math.min(1, uniqueNames / toolCalls.length);
    const errorPenalty = Math.min(0.5, errorRate);

    const score = countScore * 0.3 + uniquenessScore * 0.4 + (1 - errorPenalty) * 0.3;

    return {
      count: toolCalls.length,
      uniqueTools: uniqueNames,
      errorRate: Math.round(errorRate * 100) / 100,
      score: Math.round(score * 1000) / 1000,
    };
  }

  _computeQualityScore(response) {
    const content = this._getContent(response);
    const metrics = this._computeQualityMetrics(content);
    return metrics.score;
  }

  _computeLatencyScore(response) {
    const latency = this._getLatency(response);
    return this._normalizeLatencyScore(latency);
  }

  _computeCostScore(response) {
    const cost = this._getCost(response);
    return this._normalizeCostScore(cost);
  }

  _computeToolUseScore(response) {
    const toolCalls = this._getToolCalls(response);
    const effectiveness = this._computeToolEffectiveness(toolCalls, response);
    return effectiveness.score;
  }

  _getContent(response) {
    if (!response) return "";
    return String(
      response.response?.content ||
      response.content ||
      response.text ||
      response.message ||
      ""
    );
  }

  _getLatency(response) {
    if (!response) return 0;
    const latency = response.latencyMs ?? response.latency ?? response.durationMs ?? 0;
    return Number.isFinite(latency) ? latency : 0;
  }

  _getCost(response) {
    if (!response) return 0;
    if (response.cost !== undefined && Number.isFinite(response.cost)) return response.cost;
    if (response.response?.usage) {
      const usage = response.response.usage;
      const inputTokens = usage.inputTokens || usage.input_tokens || 0;
      const outputTokens = usage.outputTokens || usage.output_tokens || 0;
      return (inputTokens * 0.000003) + (outputTokens * 0.000015);
    }
    return 0;
  }

  _getToolCalls(response) {
    if (!response) return [];
    if (Array.isArray(response.toolCalls)) return response.toolCalls;
    if (Array.isArray(response.tools)) return response.tools;
    if (response.response && Array.isArray(response.response.toolCalls)) return response.response.toolCalls;
    if (response.response && Array.isArray(response.response.tools)) return response.response.tools;
    return [];
  }

  _getProvider(response) {
    if (!response) return "unknown";
    return String(
      response.provider ||
      response.response?.provider ||
      response.name ||
      "unknown"
    );
  }
}

module.exports = {
  ResponseComparator,
  DEFAULT_CRITERIA,
  DEFAULT_WEIGHTS,
};
