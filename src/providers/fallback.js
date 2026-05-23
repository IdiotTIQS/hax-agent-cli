"use strict";

class HealthChecker {
  constructor(options = {}) {
    this.providerName = options.providerName || "unknown";
    this.maxSamples = Number.isFinite(options.maxSamples) && options.maxSamples > 0 ? options.maxSamples : 100;
    this.minSamplesForHealth = Number.isFinite(options.minSamplesForHealth) && options.minSamplesForHealth > 0 ? options.minSamplesForHealth : 3;
    this.successes = 0;
    this.failures = 0;
    this.totalLatencyMs = 0;
    this.latencySamples = [];
    this.lastCheckTime = null;
    this.lastError = null;
  }

  recordSuccess(latencyMs) {
    this.successes += 1;
    const resolvedLatency = Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : 0;
    this.totalLatencyMs += resolvedLatency;
    this.latencySamples.push(resolvedLatency);
    this.lastCheckTime = Date.now();
    this.lastError = null;

    if (this.latencySamples.length > this.maxSamples) {
      const removed = this.latencySamples.shift();
      this.totalLatencyMs -= removed;
    }

    if (this.successes + this.failures > this.maxSamples) {
      if (this.failures > 0) {
        this.failures -= 1;
      } else {
        this.successes -= 1;
      }
    }
  }

  recordFailure(error) {
    this.failures += 1;
    this.lastCheckTime = Date.now();
    this.lastError = error || null;

    if (this.successes + this.failures > this.maxSamples) {
      if (this.successes > 0) {
        this.successes -= 1;
      } else {
        this.failures -= 1;
      }
    }
  }

  get totalRequests() {
    return this.successes + this.failures;
  }

  get successRate() {
    if (this.totalRequests === 0) {
      return 1;
    }
    return this.successes / this.totalRequests;
  }

  get errorRate() {
    if (this.totalRequests === 0) {
      return 0;
    }
    return this.failures / this.totalRequests;
  }

  get averageLatencyMs() {
    if (this.latencySamples.length === 0) {
      return 0;
    }
    return this.totalLatencyMs / this.latencySamples.length;
  }

  get healthScore() {
    if (this.totalRequests < this.minSamplesForHealth) {
      return 0.5;
    }

    const latencyPenalty = this.averageLatencyMs > 0
      ? Math.min(0.3, this.averageLatencyMs / 30000)
      : 0;

    return Math.max(0, this.successRate - this.errorRate * 0.5 - latencyPenalty);
  }

  isHealthy() {
    return this.healthScore >= 0.3;
  }

  reset() {
    this.successes = 0;
    this.failures = 0;
    this.totalLatencyMs = 0;
    this.latencySamples = [];
    this.lastCheckTime = null;
    this.lastError = null;
  }

  toJSON() {
    return {
      providerName: this.providerName,
      totalRequests: this.totalRequests,
      successRate: this.successRate,
      errorRate: this.errorRate,
      averageLatencyMs: this.averageLatencyMs,
      healthScore: this.healthScore,
      healthy: this.isHealthy(),
      lastCheckTime: this.lastCheckTime,
      lastError: this.lastError ? String(this.lastError.message || this.lastError) : null,
    };
  }
}

function createFallbackChain(providers) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new Error("At least one provider is required for a fallback chain");
  }

  return async (request) => {
    const errors = [];

    for (const provider of providers) {
      try {
        return await provider.chat(request);
      } catch (err) {
        errors.push({ provider: provider.name || "unknown", error: err.message });
      }
    }

    const errorSummary = errors
      .map((e) => `${e.provider}: ${e.error}`)
      .join("; ");

    throw new Error(`All providers in fallback chain failed. Errors: ${errorSummary}`);
  };
}

function withFallback(primaryProvider, fallbackProvider) {
  const healthChecker = new HealthChecker({ providerName: primaryProvider.name || "primary" });
  const chain = createFallbackChain([primaryProvider, fallbackProvider]);

  return {
    name: primaryProvider.name || "primary-with-fallback",

    async chat(request) {
      const startTime = Date.now();

      try {
        const response = await chain(request);
        healthChecker.recordSuccess(Date.now() - startTime);
        return response;
      } catch (err) {
        healthChecker.recordFailure(err);
        throw err;
      }
    },

    stream(request) {
      return primaryProvider.stream(request);
    },

    setModel(model) {
      primaryProvider.setModel(model);
      fallbackProvider.setModel(model);
    },

    setApiUrl(url) {
      primaryProvider.setApiUrl(url);
      fallbackProvider.setApiUrl(url);
    },

    setApiKey(key) {
      primaryProvider.setApiKey(key);
      fallbackProvider.setApiKey(key);
    },

    async listModels() {
      try {
        return await primaryProvider.listModels();
      } catch (_err) {
        return fallbackProvider.listModels();
      }
    },

    get health() {
      return healthChecker.toJSON();
    },
  };
}

function selectHealthiestProvider(providers) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new Error("At least one provider is required to select the healthiest");
  }

  if (providers.length === 1) {
    return providers[0];
  }

  let bestProvider = null;
  let bestScore = -Infinity;

  for (const provider of providers) {
    const checker = provider._healthChecker || provider.healthChecker;
    let score;

    if (checker instanceof HealthChecker) {
      score = checker.healthScore;
    } else if (checker && typeof checker.healthScore === "number") {
      score = checker.healthScore;
    } else if (provider.health && typeof provider.health.healthScore === "number") {
      score = provider.health.healthScore;
    } else {
      score = 0.5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestProvider = provider;
    }
  }

  return bestProvider;
}

module.exports = {
  HealthChecker,
  createFallbackChain,
  withFallback,
  selectHealthiestProvider,
};
