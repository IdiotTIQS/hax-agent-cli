"use strict";

const STRATEGIES = Object.freeze({
  ROUND_ROBIN: "round_robin",
  WEIGHTED: "weighted",
  LEAST_CONNECTIONS: "least_connections",
  ADAPTIVE: "adaptive",
});

const DEFAULT_STRATEGY = STRATEGIES.ROUND_ROBIN;
const DEFAULT_FAILURE_BACKOFF_MS = 30000;
const MAX_BACKOFF_MS = 300000;

class LoadBalancer {
  constructor(options = {}) {
    this._providers = new Map();
    this._strategies = { ...STRATEGIES };
    this._strategy = STRATEGIES.ROUND_ROBIN;
    this._roundRobinIndex = 0;
    this._failureBackoffMs = Number.isFinite(options.failureBackoffMs) && options.failureBackoffMs > 0
      ? options.failureBackoffMs
      : DEFAULT_FAILURE_BACKOFF_MS;
    this._maxBackoffMs = Number.isFinite(options.maxBackoffMs) && options.maxBackoffMs > 0
      ? options.maxBackoffMs
      : MAX_BACKOFF_MS;
    this._healthHistory = new Map();

    if (options.strategy) {
      this.setStrategy(options.strategy);
    }
  }

  addProvider(providerName, weight) {
    const name = String(providerName || "").trim();
    if (name.length === 0) {
      throw new Error("Provider name must be a non-empty string");
    }

    const resolvedWeight = Number.isFinite(weight) && weight > 0 ? weight : 1;

    if (this._providers.has(name)) {
      this._providers.get(name).weight = resolvedWeight;
    } else {
      this._providers.set(name, {
        name,
        weight: resolvedWeight,
        connectionCount: 0,
        totalConnections: 0,
        healthScore: 0.5,
        healthy: true,
        averageLatencyMs: 0,
        failureCount: 0,
        totalFailures: 0,
        failureTimestamp: null,
        backoffUntil: null,
        addedAt: Date.now(),
      });
    }

    return this;
  }

  removeProvider(providerName) {
    return this._providers.delete(String(providerName || ""));
  }

  next() {
    const activeProviders = this._getActiveProviders();

    if (activeProviders.length === 0) {
      throw new Error("No healthy providers available");
    }

    const strategy = this._strategy;

    switch (strategy) {
      case STRATEGIES.ROUND_ROBIN:
        return this._nextRoundRobin(activeProviders);
      case STRATEGIES.WEIGHTED:
        return this._nextWeighted(activeProviders);
      case STRATEGIES.LEAST_CONNECTIONS:
        return this._nextLeastConnections(activeProviders);
      case STRATEGIES.ADAPTIVE:
        return this._nextAdaptive(activeProviders);
      default:
        return this._nextRoundRobin(activeProviders);
    }
  }

  updateHealth(providerName, stats) {
    const name = String(providerName || "").trim();
    const entry = this._providers.get(name);
    if (!entry) {
      return;
    }

    if (stats && typeof stats === "object") {
      if (Number.isFinite(stats.healthScore)) {
        entry.healthScore = Math.max(0, Math.min(1, stats.healthScore));
      }
      if (Number.isFinite(stats.averageLatencyMs)) {
        entry.averageLatencyMs = stats.averageLatencyMs;
      }
      if (typeof stats.healthy === "boolean") {
        entry.healthy = stats.healthy;
      }
      if (Number.isFinite(stats.successRate)) {
        entry.healthScore = Math.max(0, Math.min(1,
          entry.healthScore * 0.5 + stats.successRate * 0.5
        ));
      }
    }
  }

  markFailed(providerName) {
    const name = String(providerName || "").trim();
    const entry = this._providers.get(name);
    if (!entry) {
      return;
    }

    entry.failureCount += 1;
    entry.totalFailures += 1;
    entry.failureTimestamp = Date.now();

    const backoffDuration = Math.min(
      this._failureBackoffMs * Math.pow(2, entry.failureCount - 1),
      this._maxBackoffMs,
    );

    entry.backoffUntil = Date.now() + backoffDuration;
    entry.healthScore = Math.max(0, entry.healthScore - 0.2);
    entry.healthy = entry.healthScore >= 0.3;

    if (!this._healthHistory.has(name)) {
      this._healthHistory.set(name, []);
    }
    this._healthHistory.get(name).push({
      timestamp: entry.failureTimestamp,
      healthScore: entry.healthScore,
      backoffUntil: entry.backoffUntil,
    });

    const history = this._healthHistory.get(name);
    const maxHistory = 100;
    if (history.length > maxHistory) {
      history.splice(0, history.length - maxHistory);
    }
  }

  markSuccess(providerName, latencyMs) {
    const name = String(providerName || "").trim();
    const entry = this._providers.get(name);
    if (!entry) {
      return;
    }

    entry.failureCount = Math.max(0, entry.failureCount - 1);
    entry.backoffUntil = null;

    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
      const alpha = 0.3;
      if (entry.averageLatencyMs === 0) {
        entry.averageLatencyMs = latencyMs;
      } else {
        entry.averageLatencyMs = entry.averageLatencyMs * (1 - alpha) + latencyMs * alpha;
      }
    }

    entry.healthScore = Math.min(1, entry.healthScore + 0.05);
    entry.healthy = true;
  }

  getStatus() {
    const status = {};
    for (const [name, entry] of this._providers) {
      status[name] = {
        weight: entry.weight,
        healthScore: entry.healthScore,
        healthy: entry.healthy,
        averageLatencyMs: entry.averageLatencyMs,
        connectionCount: entry.connectionCount,
        totalConnections: entry.totalConnections,
        failureCount: entry.failureCount,
        totalFailures: entry.totalFailures,
        backoffUntil: entry.backoffUntil,
        isBackedOff: entry.backoffUntil ? entry.backoffUntil > Date.now() : false,
        strategy: this._strategy,
      };
    }
    return status;
  }

  setStrategy(strategy) {
    const normalized = String(strategy || "").toLowerCase();
    if (!Object.values(this._strategies).includes(normalized)) {
      throw new Error(`Unknown load balancing strategy: ${strategy}. Valid strategies: ${Object.values(this._strategies).join(", ")}`);
    }
    this._strategy = normalized;
    this._roundRobinIndex = 0;
  }

  get strategy() {
    return this._strategy;
  }

  get providers() {
    return Array.from(this._providers.keys());
  }

  get providerCount() {
    return this._providers.size;
  }

  _getActiveProviders() {
    const now = Date.now();
    const active = [];

    for (const [, entry] of this._providers) {
      if (!entry.healthy) {
        continue;
      }

      if (entry.backoffUntil && entry.backoffUntil > now) {
        continue;
      }

      active.push(entry);
    }

    return active;
  }

  _nextRoundRobin(providers) {
    if (this._roundRobinIndex >= providers.length) {
      this._roundRobinIndex = 0;
    }

    const provider = providers[this._roundRobinIndex];
    provider.connectionCount += 1;
    provider.totalConnections += 1;

    this._roundRobinIndex += 1;
    if (this._roundRobinIndex >= providers.length) {
      this._roundRobinIndex = 0;
    }

    return provider.name;
  }

  _nextWeighted(providers) {
    const totalWeight = providers.reduce((sum, p) => sum + p.weight, 0);
    if (totalWeight <= 0) {
      return this._nextRoundRobin(providers);
    }

    let target = Math.random() * totalWeight;
    let selected = providers[0];

    for (const provider of providers) {
      target -= provider.weight;
      if (target <= 0) {
        selected = provider;
        break;
      }
    }

    selected.connectionCount += 1;
    selected.totalConnections += 1;
    return selected.name;
  }

  _nextLeastConnections(providers) {
    let best = providers[0];
    let minConnections = best.connectionCount;

    for (let i = 1; i < providers.length; i += 1) {
      const provider = providers[i];
      const conns = provider.connectionCount;
      if (conns < minConnections) {
        minConnections = conns;
        best = provider;
      } else if (conns === minConnections && provider.healthScore > best.healthScore) {
        best = provider;
      }
    }

    best.connectionCount += 1;
    best.totalConnections += 1;
    return best.name;
  }

  _nextAdaptive(providers) {
    let best = null;
    let bestScore = -Infinity;

    for (const provider of providers) {
      const latencyScore = provider.averageLatencyMs > 0
        ? Math.max(0, 1 - provider.averageLatencyMs / 5000)
        : 1;

      const connectionPenalty = provider.connectionCount > 0
        ? 1 / (1 + Math.log(1 + provider.connectionCount))
        : 1;

      const score = provider.healthScore * 0.5 + latencyScore * 0.3 + connectionPenalty * 0.2;

      if (score > bestScore) {
        bestScore = score;
        best = provider;
      }
    }

    if (best) {
      best.connectionCount += 1;
      best.totalConnections += 1;
      return best.name;
    }

    return this._nextRoundRobin(providers);
  }
}

module.exports = {
  LoadBalancer,
  STRATEGIES,
};
