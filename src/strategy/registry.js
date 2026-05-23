"use strict";

/**
 * StrategyRegistry — central registry for pluggable agent strategies.
 *
 * Strategy categories:
 *   toolSelection      — how to pick the best tool for a task
 *   taskPlanning       — how to decompose and sequence work
 *   errorRecovery      — how to respond to failures
 *   contextManagement  — how to manage conversation / context window
 *   responseFormatting — how to structure final output
 */

const STRATEGY_CATEGORIES = Object.freeze([
  "toolSelection",
  "taskPlanning",
  "errorRecovery",
  "contextManagement",
  "responseFormatting",
]);

const DEFAULT_STRATEGIES = Object.freeze({
  toolSelection: "leastCost",
  taskPlanning: "incremental",
  errorRecovery: "fallbackChain",
  contextManagement: "slidingWindow",
  responseFormatting: "markdownStructured",
});

class StrategyRegistry {
  constructor() {
    this._strategies = new Map();
    this._defaults = new Map();

    // seed defaults from the frozen map
    for (const [category, name] of Object.entries(DEFAULT_STRATEGIES)) {
      this._defaults.set(category, name);
    }
  }

  /**
   * Register a named strategy with metadata.
   *
   * @param {string} name     — unique strategy name
   * @param {object} strategy — { type, description, defaultConfig, factory? }
   *   - type:        one of STRATEGY_CATEGORIES
   *   - description: human-readable summary
   *   - defaultConfig: default configuration object
   *   - factory:     optional factory function (config) => strategy instance
   * @returns {this}
   */
  define(name, strategy) {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError("Strategy name must be a non-empty string");
    }
    if (!strategy || typeof strategy !== "object") {
      throw new TypeError("Strategy definition must be a non-null object");
    }

    const type = String(strategy.type || "");
    if (!STRATEGY_CATEGORIES.includes(type)) {
      throw new Error(
        `Unknown strategy type "${type}". Valid types: ${STRATEGY_CATEGORIES.join(", ")}`
      );
    }

    const entry = {
      name,
      type,
      description: String(strategy.description || ""),
      defaultConfig: Object.freeze({ ...(strategy.defaultConfig || {}) }),
      factory: typeof strategy.factory === "function" ? strategy.factory : null,
    };

    this._strategies.set(name, entry);
    return this;
  }

  /**
   * Get a strategy instance with (optionally overridden) configuration.
   *
   * @param {string} name   — strategy name
   * @param {object} [config] — configuration overrides
   * @returns {object} { name, type, config, execute?, evaluate? }
   */
  select(name, config) {
    const entry = this._strategies.get(name);
    if (!entry) {
      throw new Error(`Unknown strategy: "${name}". Use list() to see registered strategies.`);
    }

    const mergedConfig = { ...entry.defaultConfig, ...(config || {}) };

    if (entry.factory) {
      return entry.factory(mergedConfig);
    }

    return {
      name: entry.name,
      type: entry.type,
      description: entry.description,
      config: Object.freeze({ ...mergedConfig }),
    };
  }

  /**
   * List all registered strategies with metadata.
   *
   * @param {object} [filter] — optional filter { type, search }
   * @returns {Array<object>}
   */
  list(filter) {
    const entries = Array.from(this._strategies.values());

    if (!filter || typeof filter !== "object") {
      return entries.map(this._toMetadata);
    }

    let results = entries;

    if (filter.type) {
      const type = String(filter.type);
      results = results.filter((e) => e.type === type);
    }

    if (filter.search) {
      const term = String(filter.search).toLowerCase();
      results = results.filter(
        (e) =>
          e.name.toLowerCase().includes(term) ||
          e.description.toLowerCase().includes(term)
      );
    }

    return results.map(this._toMetadata);
  }

  /**
   * Return the default strategy name for a given category.
   *
   * @param {string} strategyType — one of STRATEGY_CATEGORIES
   * @returns {string} default strategy name
   */
  getDefault(strategyType) {
    if (!STRATEGY_CATEGORIES.includes(strategyType)) {
      throw new Error(
        `Unknown strategy type "${strategyType}". Valid types: ${STRATEGY_CATEGORIES.join(", ")}`
      );
    }

    const name = this._defaults.get(strategyType);
    if (!name) {
      throw new Error(`No default registered for strategy type "${strategyType}".`);
    }

    return name;
  }

  /**
   * Override the default for a category.
   *
   * @param {string} strategyType
   * @param {string} strategyName
   * @returns {this}
   */
  setDefault(strategyType, strategyName) {
    if (!STRATEGY_CATEGORIES.includes(strategyType)) {
      throw new Error(
        `Unknown strategy type "${strategyType}". Valid types: ${STRATEGY_CATEGORIES.join(", ")}`
      );
    }
    if (!this._strategies.has(strategyName)) {
      throw new Error(`Unknown strategy: "${strategyName}"`);
    }
    this._defaults.set(strategyType, strategyName);
    return this;
  }

  /**
   * Remove a strategy from the registry.
   *
   * @param {string} name
   * @returns {boolean}
   */
  remove(name) {
    return this._strategies.delete(name);
  }

  /** @returns {number} */
  get size() {
    return this._strategies.size;
  }

  /**
   * Check if a strategy is registered.
   *
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._strategies.has(name);
  }

  // ---- private ----

  _toMetadata(entry) {
    return {
      name: entry.name,
      type: entry.type,
      description: entry.description,
      config: { ...entry.defaultConfig },
    };
  }
}

module.exports = {
  StrategyRegistry,
  STRATEGY_CATEGORIES,
  DEFAULT_STRATEGIES,
};
