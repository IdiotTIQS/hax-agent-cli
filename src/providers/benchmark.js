"use strict";

class TestCase {
  constructor(spec) {
    if (!spec || typeof spec !== "object") {
      throw new Error("TestCase requires a valid specification object");
    }
    if (typeof spec.prompt !== "string" || String(spec.prompt).trim().length === 0) {
      throw new Error("TestCase requires a non-empty prompt string");
    }

    this.prompt = spec.prompt;
    this.expectedTools = Array.isArray(spec.expectedTools) ? spec.expectedTools : [];
    this.expectedConcepts = Array.isArray(spec.expectedConcepts) ? spec.expectedConcepts : [];
    this.minQuality = Number.isFinite(spec.minQuality) ? spec.minQuality : 0;
    this.maxTokens = Number.isFinite(spec.maxTokens) && spec.maxTokens > 0 ? spec.maxTokens : 4096;
    this.category = String(spec.category || "general");
    this.weight = Number.isFinite(spec.weight) && spec.weight > 0 ? spec.weight : 1;
    this.id = String(spec.id || `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  }
}

class ProviderBenchmark {
  constructor(options = {}) {
    this._timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 30000;
    this._concurrent = Number.isFinite(options.concurrent) && options.concurrent > 0 ? options.concurrent : 3;
    this._trackingStore = new Map();
    this._results = [];
  }

  async runBenchmark(providers, testCases) {
    if (!Array.isArray(providers) || providers.length === 0) {
      throw new Error("At least one provider is required for benchmarking");
    }
    if (!Array.isArray(testCases) || testCases.length === 0) {
      throw new Error("At least one test case is required for benchmarking");
    }

    const resolvedProviders = this._resolveProviders(providers);
    const resolvedCases = testCases.map((tc) => (tc instanceof TestCase ? tc : new TestCase(tc)));

    const latencyResults = await this.measureLatency(resolvedProviders, resolvedCases);
    const qualityResults = await this.measureQuality(resolvedProviders, resolvedCases);
    const reliabilityResults = await this.measureReliabilityAll(resolvedProviders, 5);

    const providerSummaries = {};

    for (const provider of resolvedProviders) {
      const name = provider.name || "unknown";
      const latency = latencyResults[name] || {};
      const quality = qualityResults[name] || {};
      const reliability = reliabilityResults[name] || {};

      providerSummaries[name] = {
        provider: name,
        model: provider.model || "unknown",
        latency: {
          averageMs: latency.averageMs || 0,
          minMs: latency.minMs || 0,
          maxMs: latency.maxMs || 0,
          p50Ms: latency.p50Ms || 0,
          p95Ms: latency.p95Ms || 0,
          p99Ms: latency.p99Ms || 0,
        },
        quality: {
          averageScore: quality.averageScore || 0,
          minScore: quality.minScore || 0,
          maxScore: quality.maxScore || 0,
          conceptRecall: quality.conceptRecall || 0,
          toolAccuracy: quality.toolAccuracy || 0,
        },
        reliability: {
          successRate: reliability.successRate || 0,
          errors: reliability.errors || [],
          consecutiveFailures: reliability.consecutiveFailures || 0,
        },
        overallScore: this._calculateOverallScore({
          avgLatency: latency.averageMs || 0,
          avgQuality: quality.averageScore || 0,
          successRate: reliability.successRate || 0,
        }),
      };
    }

    const report = this.generateComparisonReport(providerSummaries);
    this._results.push({ providers: providerSummaries, testCases: resolvedCases, report, timestamp: Date.now() });

    return {
      providers: providerSummaries,
      testCaseCount: resolvedCases.length,
      report,
      timestamp: Date.now(),
    };
  }

  async measureLatency(providers, prompts) {
    if (!Array.isArray(providers) || providers.length === 0) {
      throw new Error("At least one provider is required for latency measurement");
    }

    const resolvedProviders = this._resolveProviders(providers);
    const resolvedPrompts = Array.isArray(prompts)
      ? prompts.map((p) => (p instanceof TestCase ? p.prompt : typeof p === "string" ? p : String(p)))
      : [String(prompts)];

    const results = {};

    for (const provider of resolvedProviders) {
      const name = provider.name || "unknown";
      const measurements = [];

      for (const prompt of resolvedPrompts) {
        const startTime = Date.now();
        try {
          await provider.chat({ prompt });
          measurements.push(Date.now() - startTime);
        } catch (_err) {
          measurements.push(-1);
        }
      }

      const valid = measurements.filter((m) => m >= 0);
      results[name] = this._computeLatencyStats(valid);
    }

    return results;
  }

  async measureQuality(providers, testCases) {
    if (!Array.isArray(providers) || providers.length === 0) {
      throw new Error("At least one provider is required for quality measurement");
    }

    const resolvedProviders = this._resolveProviders(providers);
    const resolvedCases = testCases.map((tc) => (tc instanceof TestCase ? tc : new TestCase(tc)));
    const results = {};

    for (const provider of resolvedProviders) {
      const name = provider.name || "unknown";
      const scores = [];
      let conceptHits = 0;
      let totalConcepts = 0;
      let toolHits = 0;
      let totalTools = 0;

      for (const testCase of resolvedCases) {
        try {
          const response = await provider.chat({ prompt: testCase.prompt });
          const content = String(response?.content || "").toLowerCase();
          const qualityScore = this._evaluateQuality(content, testCase);

          let hitAllConcepts = true;
          for (const concept of testCase.expectedConcepts) {
            totalConcepts += 1;
            if (content.includes(String(concept).toLowerCase())) {
              conceptHits += 1;
            } else {
              hitAllConcepts = false;
            }
          }

          let hitAllTools = true;
          const toolCalls = response?.toolCalls || response?.tools || [];
          const toolNames = new Set(
            (Array.isArray(toolCalls) ? toolCalls : [])
              .map((t) => String(t.name || t.tool || "").toLowerCase())
              .filter(Boolean),
          );
          for (const tool of testCase.expectedTools) {
            totalTools += 1;
            if (toolNames.has(String(tool).toLowerCase())) {
              toolHits += 1;
            } else {
              hitAllTools = false;
            }
          }

          scores.push(qualityScore);
        } catch (_err) {
          scores.push(0);
        }
      }

      results[name] = {
        scores,
        averageScore: scores.length > 0
          ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 1000) / 1000
          : 0,
        minScore: scores.length > 0 ? Math.min(...scores) : 0,
        maxScore: scores.length > 0 ? Math.max(...scores) : 0,
        conceptRecall: totalConcepts > 0 ? Math.round((conceptHits / totalConcepts) * 1000) / 1000 : 0,
        toolAccuracy: totalTools > 0 ? Math.round((toolHits / totalTools) * 1000) / 1000 : 0,
      };
    }

    return results;
  }

  async measureReliability(provider, attempts = 10) {
    if (!provider || typeof provider.chat !== "function") {
      throw new Error("A valid provider with a chat() method is required");
    }

    const resolvedAttempts = Math.max(1, Number.isFinite(attempts) ? attempts : 10);
    const name = provider.name || "unknown";
    const results = [];
    const errors = [];

    for (let i = 0; i < resolvedAttempts; i += 1) {
      try {
        const response = await provider.chat({ prompt: "Reliability test prompt" });
        results.push({ success: true, contentLength: String(response?.content || "").length });
      } catch (err) {
        results.push({ success: false, error: err.message });
        errors.push({ attempt: i + 1, error: err.message });
      }
    }

    const successes = results.filter((r) => r.success).length;
    const successRate = resolvedAttempts > 0 ? successes / resolvedAttempts : 0;

    let maxConsecutive = 0;
    let currentConsecutive = 0;
    for (const r of results) {
      if (!r.success) {
        currentConsecutive += 1;
        maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
      } else {
        currentConsecutive = 0;
      }
    }

    return {
      provider: name,
      attempts: resolvedAttempts,
      successes,
      failures: resolvedAttempts - successes,
      successRate: Math.round(successRate * 1000) / 1000,
      errors,
      consecutiveFailures: maxConsecutive,
    };
  }

  generateComparisonReport(results) {
    if (!results || typeof results !== "object") {
      throw new Error("Results object is required for report generation");
    }

    const providerSummaries = results.providers || results;
    const entries = Object.entries(providerSummaries);

    if (entries.length === 0) {
      return {
        summary: "No provider results to compare.",
        providers: [],
        ranking: [],
        recommendations: "Run benchmarks first to populate results.",
        generatedAt: Date.now(),
      };
    }

    const providers = entries.map(([name, data]) => ({
      name,
      model: data.model || data.provider?.model || "unknown",
      latencyAvgMs: data.latency?.averageMs ?? 0,
      qualityScore: data.quality?.averageScore ?? 0,
      reliabilityRate: data.reliability?.successRate ?? 0,
      overallScore: data.overallScore ?? 0,
    }));

    providers.sort((a, b) => b.overallScore - a.overallScore);

    const summaryParts = [];
    if (providers.length > 0) {
      summaryParts.push(`Best overall: ${providers[0].name} (score: ${providers[0].overallScore})`);
    }
    if (providers.length > 1) {
      const fastest = providers.reduce((best, p) =>
        (p.latencyAvgMs > 0 && p.latencyAvgMs < best.latencyAvgMs) ? p : best,
        providers[0]);
      summaryParts.push(`Fastest: ${fastest.name} (${fastest.latencyAvgMs}ms)`);

      const mostReliable = providers.reduce((best, p) =>
        (p.reliabilityRate > best.reliabilityRate) ? p : best,
        providers[0]);
      summaryParts.push(`Most reliable: ${mostReliable.name} (${mostReliable.reliabilityRate} success rate)`);
    }

    return {
      summary: summaryParts.join(". ") + ".",
      providers,
      ranking: providers.map((p, i) => ({ rank: i + 1, name: p.name, score: p.overallScore })),
      strengths: this._identifyStrengths(providerSummaries),
      weaknesses: this._identifyWeaknesses(providerSummaries),
      recommendations: this._generateRecommendations(providerSummaries),
      generatedAt: Date.now(),
    };
  }

  trackOverTime(provider, metric) {
    if (!provider || typeof provider !== "object") {
      throw new Error("A valid provider object is required for tracking");
    }

    const name = String(provider.name || "unknown");
    const normalizedMetric = String(metric || "").toLowerCase().trim();

    if (!normalizedMetric) {
      throw new Error("A metric name is required for tracking");
    }

    if (!this._trackingStore.has(name)) {
      this._trackingStore.set(name, []);
    }

    const series = this._trackingStore.get(name);
    const snapshot = {
      metric: normalizedMetric,
      timestamp: Date.now(),
    };

    switch (normalizedMetric) {
      case "latency":
      case "latencyMs":
        snapshot.value = provider._lastLatency || 0;
        break;
      case "quality":
      case "qualityScore":
        snapshot.value = provider._lastQuality || 0;
        break;
      case "reliability":
      case "successRate":
        snapshot.value = provider._lastSuccessRate || 0;
        break;
      case "cost":
        snapshot.value = provider._lastCost || 0;
        break;
      default:
        snapshot.value = provider[normalizedMetric] !== undefined
          ? provider[normalizedMetric]
          : 0;
        break;
    }

    series.push(snapshot);

    if (series.length > 1000) {
      series.shift();
    }

    return {
      provider: name,
      metric: normalizedMetric,
      current: snapshot.value,
      history: [...series],
      trend: this._calculateTrend(series),
      sampleCount: series.length,
    };
  }

  getTrackingHistory(providerName) {
    const name = String(providerName || "");
    const series = this._trackingStore.get(name) || [];
    return [...series];
  }

  clearTracking(providerName) {
    if (providerName) {
      this._trackingStore.delete(String(providerName));
    } else {
      this._trackingStore.clear();
    }
  }

  getResults() {
    return [...this._results];
  }

  _resolveProviders(providers) {
    return providers.map((p) => {
      if (typeof p === "string") {
        return { name: p, async chat() { return { content: p }; } };
      }
      return p;
    });
  }

  async measureReliabilityAll(providers, attempts) {
    const results = {};
    for (const provider of providers) {
      const relResult = await this.measureReliability(provider, attempts);
      results[relResult.provider] = relResult;
    }
    return results;
  }

  _computeLatencyStats(measurements) {
    if (measurements.length === 0) {
      return {
        averageMs: 0,
        minMs: 0,
        maxMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        samples: 0,
      };
    }

    const sorted = [...measurements].sort((a, b) => a - b);
    const avg = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);

    return {
      averageMs: avg,
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1],
      p50Ms: this._percentile(sorted, 50),
      p95Ms: this._percentile(sorted, 95),
      p99Ms: this._percentile(sorted, 99),
      samples: sorted.length,
    };
  }

  _percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  _evaluateQuality(content, testCase) {
    let score = 0.3;
    const text = String(content || "").trim();

    if (text.length > 0) {
      score = Math.min(1, Math.max(0.1, text.length / 1000));
    }

    if (testCase.expectedConcepts.length > 0) {
      let hits = 0;
      const lower = text.toLowerCase();
      for (const concept of testCase.expectedConcepts) {
        if (lower.includes(String(concept).toLowerCase())) {
          hits += 1;
        }
      }
      const conceptScore = hits / testCase.expectedConcepts.length;
      score = score * 0.4 + conceptScore * 0.6;
    }

    if (testCase.minQuality > 0) {
      score = Math.max(score, testCase.minQuality);
    }

    return Math.round(Math.min(1, score) * 1000) / 1000;
  }

  _calculateOverallScore({ avgLatency, avgQuality, successRate }) {
    const latencyScore = avgLatency > 0 ? Math.min(1, 5000 / Math.max(avgLatency, 1)) : 0.5;
    const qualityScore = Number.isFinite(avgQuality) ? avgQuality : 0.5;
    const reliabilityScore = Number.isFinite(successRate) ? successRate : 0.5;

    return Math.round((latencyScore * 0.35 + qualityScore * 0.4 + reliabilityScore * 0.25) * 1000) / 1000;
  }

  _identifyStrengths(providerSummaries) {
    const strengths = {};
    for (const [name, data] of Object.entries(providerSummaries)) {
      const s = [];
      if ((data.latency?.averageMs || 0) > 0 && (data.latency?.averageMs || 0) < 500) {
        s.push("fast-responses");
      }
      if ((data.quality?.averageScore || 0) > 0.7) {
        s.push("high-quality");
      }
      if ((data.reliability?.successRate || 0) > 0.95) {
        s.push("high-reliability");
      }
      strengths[name] = s;
    }
    return strengths;
  }

  _identifyWeaknesses(providerSummaries) {
    const weaknesses = {};
    for (const [name, data] of Object.entries(providerSummaries)) {
      const w = [];
      if ((data.latency?.averageMs || 0) > 5000) {
        w.push("slow-responses");
      }
      if ((data.quality?.averageScore || 0) < 0.3) {
        w.push("low-quality");
      }
      if ((data.reliability?.successRate || 0) < 0.8) {
        w.push("low-reliability");
      }
      weaknesses[name] = w;
    }
    return weaknesses;
  }

  _generateRecommendations(providerSummaries) {
    const recommendations = [];
    const entries = Object.entries(providerSummaries);

    if (entries.length <= 1) {
      recommendations.push("Add more providers for meaningful comparison.");
      return recommendations;
    }

    const sortedByScore = entries
      .map(([name, data]) => ({ name, score: data.overallScore || 0 }))
      .sort((a, b) => b.score - a.score);

    if (sortedByScore.length > 0 && sortedByScore[0].score > 0.7) {
      recommendations.push(`Use "${sortedByScore[0].name}" as the primary provider for most tasks.`);
    }

    const latencyEntries = entries
      .filter(([, d]) => (d.latency?.averageMs || 0) > 0)
      .sort(([, a], [, b]) => (a.latency?.averageMs || Infinity) - (b.latency?.averageMs || Infinity));

    if (latencyEntries.length > 0 && latencyEntries[0][0] !== sortedByScore[0]?.name) {
      recommendations.push(`Use "${latencyEntries[0][0]}" for latency-sensitive tasks.`);
    }

    const reliabilityEntries = entries
      .sort(([, a], [, b]) => (b.reliability?.successRate || 0) - (a.reliability?.successRate || 0));

    if (reliabilityEntries.length > 0 && (reliabilityEntries[0][1].reliability?.successRate || 0) > 0.95) {
      recommendations.push(`Use "${reliabilityEntries[0][0]}" for critical/high-stakes tasks.`);
    }

    if (recommendations.length === 0) {
      recommendations.push("Run more benchmarks to gather sufficient data for recommendations.");
    }

    return recommendations;
  }

  _calculateTrend(series) {
    if (series.length < 2) return "insufficient-data";

    const values = series.map((s) => s.value).filter((v) => Number.isFinite(v));
    if (values.length < 2) return "insufficient-data";

    let increases = 0;
    let decreases = 0;

    for (let i = 1; i < values.length; i += 1) {
      if (values[i] > values[i - 1]) increases += 1;
      else if (values[i] < values[i - 1]) decreases += 1;
    }

    if (increases > decreases * 1.5) return "improving";
    if (decreases > increases * 1.5) return "declining";
    return "stable";
  }
}

module.exports = {
  ProviderBenchmark,
  TestCase,
};
