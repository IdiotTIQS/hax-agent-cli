"use strict";

class ProviderAggregator {
  constructor(options = {}) {
    this._providers = new Map();
    this._rankings = new Map();
    this._totalRequests = 0;
    this._defaultWeights = {
      quality: options.qualityWeight ?? 0.4,
      latency: options.latencyWeight ?? 0.3,
      cost: options.costWeight ?? 0.2,
      reliability: options.reliabilityWeight ?? 0.1,
    };
  }

  addProvider(name, provider) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) {
      throw new Error("Provider name is required");
    }
    if (!provider || typeof provider.chat !== "function") {
      throw new Error("Provider must implement a chat() method");
    }

    this._providers.set(normalizedName, provider);
    this._rankings.set(normalizedName, this._rankings.get(normalizedName) || { score: 0.5, requests: 0, successes: 0, failures: 0, totalLatencyMs: 0 });
    return this;
  }

  get providerNames() {
    return Array.from(this._providers.keys());
  }

  get providerCount() {
    return this._providers.size;
  }

  async sendAll(prompt, options = {}) {
    if (this._providers.size === 0) {
      throw new Error("No providers registered for aggregation");
    }

    const entries = Array.from(this._providers.entries());
    const results = await Promise.allSettled(
      entries.map(async ([name, provider]) => {
        const startTime = Date.now();
        try {
          const response = await provider.chat({
            prompt,
            ...options,
          });
          const latencyMs = Date.now() - startTime;
          this._recordSuccess(name, latencyMs);
          return {
            provider: name,
            response,
            latencyMs,
            success: true,
          };
        } catch (err) {
          this._recordFailure(name);
          return {
            provider: name,
            error: err.message,
            latencyMs: Date.now() - startTime,
            success: false,
          };
        }
      }),
    );

    this._totalRequests += 1;

    return results.map((result) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      return {
        provider: entries.find(([name]) => name === (result.reason?.provider))?.[0] || "unknown",
        error: result.reason?.message || "Provider failed",
        latencyMs: 0,
        success: false,
      };
    });
  }

  async sendBest(prompt, options = {}) {
    if (this._providers.size === 0) {
      throw new Error("No providers registered for aggregation");
    }

    const best = this._findBestProvider();
    const startTime = Date.now();

    try {
      const response = await best.provider.chat({
        prompt,
        ...options,
      });
      const latencyMs = Date.now() - startTime;
      this._recordSuccess(best.name, latencyMs);
      return {
        provider: best.name,
        response,
        latencyMs,
        success: true,
        selected: true,
      };
    } catch (err) {
      this._recordFailure(best.name);
      throw new Error(`Best provider "${best.name}" failed: ${err.message}`);
    }
  }

  async sendSequential(prompt, options = {}) {
    if (this._providers.size === 0) {
      throw new Error("No providers registered for aggregation");
    }

    const ranked = this._rankProviders();
    const errors = [];

    for (const { name, provider } of ranked) {
      const startTime = Date.now();
      try {
        const response = await provider.chat({
          prompt,
          ...options,
        });
        const latencyMs = Date.now() - startTime;
        this._recordSuccess(name, latencyMs);
        return {
          provider: name,
          response,
          latencyMs,
          success: true,
          selected: true,
        };
      } catch (err) {
        this._recordFailure(name);
        errors.push({ provider: name, error: err.message });
      }
    }

    const errorSummary = errors
      .map((e) => `${e.provider}: ${e.error}`)
      .join("; ");

    throw new Error(`All providers in sequential chain failed. Errors: ${errorSummary}`);
  }

  compareResponses(responses) {
    if (!Array.isArray(responses) || responses.length === 0) {
      throw new Error("At least one response is required for comparison");
    }

    const comparisons = [];

    for (const resp of responses) {
      comparisons.push({
        provider: resp.provider || "unknown",
        content: resp.response?.content || resp.content || "",
        contentLength: String(resp.response?.content || resp.content || "").length,
        success: resp.success !== false,
        latencyMs: resp.latencyMs || 0,
        error: resp.error || null,
      });
    }

    const successful = comparisons.filter((c) => c.success);
    const avgLength = successful.length > 0
      ? successful.reduce((sum, c) => sum + c.contentLength, 0) / successful.length
      : 0;

    return {
      totalResponses: comparisons.length,
      successfulCount: successful.length,
      failedCount: comparisons.length - successful.length,
      averageContentLength: Math.round(avgLength),
      responses: comparisons,
      summary: this._generateComparisonSummary(comparisons),
    };
  }

  voteResponses(responses) {
    if (!Array.isArray(responses) || responses.length === 0) {
      throw new Error("At least one response is required for voting");
    }

    const successful = responses.filter((r) => r.success !== false);
    if (successful.length === 0) {
      return {
        consensus: null,
        totalVotes: 0,
        agreement: 0,
        message: "No successful responses to vote on",
      };
    }

    const keyPoints = this._extractKeyPoints(successful.map((r) => r.response?.content || r.content || ""));

    const votes = {};
    for (const point of keyPoints) {
      votes[point] = this._countSupport(successful, point);
    }

    const consensusPoints = Object.entries(votes)
      .filter(([, count]) => count > successful.length / 2)
      .map(([point]) => point);

    const totalMatches = consensusPoints.length;
    const totalPoints = keyPoints.length;

    return {
      consensus: consensusPoints.length > 0 ? consensusPoints.join("\n") : null,
      totalVotes: successful.length,
      agreement: totalPoints > 0 ? Math.round((totalMatches / totalPoints) * 100) / 100 : 0,
      keyPoints,
      perProviderVotes: this._calculateProviderVotes(successful, keyPoints),
    };
  }

  recordSuccess(name, latencyMs) {
    this._recordSuccess(name, latencyMs);
  }

  recordFailure(name, error) {
    this._recordFailure(name);
  }

  getRankings() {
    const rankings = {};
    for (const [name, stats] of this._rankings) {
      rankings[name] = { ...stats };
    }
    return rankings;
  }

  reset() {
    this._rankings.clear();
    this._totalRequests = 0;
    for (const name of this._providers.keys()) {
      this._rankings.set(name, { score: 0.5, requests: 0, successes: 0, failures: 0, totalLatencyMs: 0 });
    }
  }

  _findBestProvider() {
    const ranked = this._rankProviders();
    return ranked[0] || Array.from(this._providers.entries())[0]?.map(([name, provider]) => ({ name, provider }))?.[0];
  }

  _rankProviders() {
    const entries = Array.from(this._providers.entries());

    if (entries.length === 1) {
      return [{ name: entries[0][0], provider: entries[0][1], score: 1 }];
    }

    const ranked = entries.map(([name, provider]) => {
      const stats = this._rankings.get(name) || { score: 0.5, requests: 0, successes: 0, failures: 0, totalLatencyMs: 0 };
      return { name, provider, score: stats.score };
    });

    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  _recordSuccess(name, latencyMs) {
    const stats = this._rankings.get(name);
    if (!stats) return;

    stats.requests += 1;
    stats.successes += 1;
    stats.totalLatencyMs += (Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : 0);

    const total = stats.successes + stats.failures;
    const successRate = total === 0 ? 1 : stats.successes / total;
    const avgLatency = stats.requests > 0 ? stats.totalLatencyMs / stats.requests : 0;
    const latencyNorm = avgLatency > 0 ? Math.min(1, 1000 / Math.max(avgLatency, 1)) : 1;

    stats.score = successRate * 0.6 + latencyNorm * 0.4;
  }

  _recordFailure(name) {
    const stats = this._rankings.get(name);
    if (!stats) return;

    stats.requests += 1;
    stats.failures += 1;

    const total = stats.successes + stats.failures;
    const successRate = total === 0 ? 1 : stats.successes / total;
    const avgLatency = stats.requests > 0 ? stats.totalLatencyMs / stats.requests : 0;
    const latencyNorm = avgLatency > 0 ? Math.min(1, 1000 / Math.max(avgLatency, 1)) : 1;

    stats.score = successRate * 0.6 + latencyNorm * 0.4;
  }

  _generateComparisonSummary(comparisons) {
    if (comparisons.length <= 1) {
      return "Single response; no comparison possible.";
    }

    const successful = comparisons.filter((c) => c.success);
    if (successful.length === 0) {
      return "All providers failed.";
    }

    const fastest = successful.reduce((best, c) =>
      (c.latencyMs < best.latencyMs ? c : best), successful[0]);
    const longest = successful.reduce((best, c) =>
      (c.contentLength > best.contentLength ? c : best), successful[0]);

    return `Fastest: ${fastest.provider} (${fastest.latencyMs}ms). ` +
      `Most detailed: ${longest.provider} (${longest.contentLength} chars). ` +
      `${successful.length}/${comparisons.length} providers succeeded.`;
  }

  _extractKeyPoints(contents) {
    const allWords = contents.join(" ").toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
    const wordFreq = {};
    for (const word of allWords) {
      if (word.length < 4) continue;
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }

    const stopWords = new Set([
      "this", "that", "with", "from", "have", "were", "been", "when", "will",
      "would", "could", "should", "about", "which", "their", "there",
    ]);

    const candidates = Object.entries(wordFreq)
      .filter(([word]) => !stopWords.has(word))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return candidates.map(([word]) => word);
  }

  _countSupport(successful, point) {
    let count = 0;
    for (const resp of successful) {
      const content = String(resp.response?.content || resp.content || "").toLowerCase();
      if (content.includes(point.toLowerCase())) {
        count += 1;
      }
    }
    return count;
  }

  _calculateProviderVotes(successful, keyPoints) {
    const providerVotes = {};
    for (const resp of successful) {
      const providerName = resp.provider || "unknown";
      const content = String(resp.response?.content || resp.content || "").toLowerCase();
      const matches = keyPoints.filter((point) => content.includes(point.toLowerCase()));
      providerVotes[providerName] = {
        matchedPoints: matches,
        matchCount: matches.length,
        matchRate: keyPoints.length > 0 ? Math.round((matches.length / keyPoints.length) * 100) / 100 : 0,
      };
    }
    return providerVotes;
  }
}

module.exports = {
  ProviderAggregator,
};
