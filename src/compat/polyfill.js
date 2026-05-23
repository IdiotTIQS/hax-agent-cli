"use strict";

/**
 * PolyfillRegistry — detects missing platform capabilities and applies
 * replacement implementations so that code written for one environment
 * can run in another.
 *
 *   const reg = new PolyfillRegistry();
 *   reg.register("globalThis", () => typeof globalThis === "undefined", () => {
 *     (function () {
 *       if (typeof globalThis === "undefined") {
 *         Object.defineProperty(Object.prototype, "__magic__", { ... });
 *       }
 *     })();
 *   });
 *   reg.apply("globalThis");
 *   reg.applyAll();         // apply every registered polyfill
 */

// ---------------------------------------------------------------------------
// PolyfillRegistry
// ---------------------------------------------------------------------------

class PolyfillRegistry {
  constructor() {
    /**
     * Map<string, { feature, detector, implementation, applied, appliedAt }>
     */
    this._registry = new Map();

    /**
     * Callbacks invoked after a polyfill is applied.
     * @type {Array<function(feature: string, applied: boolean)>}
     */
    this._hooks = [];
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Register a polyfill.
   *
   * @param {string}   feature        Unique name for the feature / capability
   * @param {function} detector       () => boolean — returns true if the
   *   polyfill is needed (the feature is absent or broken).
   * @param {function} implementation Called when the polyfill is applied;
   *   should install the feature into the global scope.
   * @returns {PolyfillRegistry} this (chainable)
   */
  register(feature, detector, implementation) {
    if (typeof feature !== "string" || feature.trim().length === 0) {
      throw new TypeError("feature must be a non-empty string");
    }
    if (typeof detector !== "function") {
      throw new TypeError("detector must be a function");
    }
    if (typeof implementation !== "function") {
      throw new TypeError("implementation must be a function");
    }

    this._registry.set(feature, {
      feature,
      detector,
      implementation,
      applied: false,
      appliedAt: null,
    });

    return this;
  }

  // -----------------------------------------------------------------------
  // Detection
  // -----------------------------------------------------------------------

  /**
   * Check whether a polyfill is needed (the native feature is missing).
   *
   * @param {string} feature
   * @returns {boolean}  true if the polyfill should be applied
   * @throws {Error} if the feature is not registered
   */
  isNeeded(feature) {
    const entry = this._get(feature);
    try {
      return entry.detector();
    } catch (_) {
      // If the detector itself throws (broken API), treat as needed
      return true;
    }
  }

  // -----------------------------------------------------------------------
  // Application
  // -----------------------------------------------------------------------

  /**
   * Apply a single polyfill if its detector indicates it is needed.
   *
   * If the polyfill has already been applied this call is a no-op (idempotent).
   *
   * @param {string} feature
   * @returns {boolean} true if the polyfill was applied (or already applied),
   *   false if it was not needed.
   */
  apply(feature) {
    const entry = this._get(feature);

    if (entry.applied) return true;

    if (!this.isNeeded(feature)) return false;

    try {
      entry.implementation();
      entry.applied = true;
      entry.appliedAt = Date.now();
    } catch (err) {
      throw new Error(
        `Polyfill "${feature}" failed during application: ${err.message}`,
      );
    }

    this._notify(feature, true);
    return true;
  }

  /**
   * Apply multiple polyfills (or all registered ones).
   *
   * @param {string[]} [features]  Feature names to apply; if omitted, *all*
   *   registered polyfills are applied.
   * @returns {{ applied: string[], skipped: string[], errors: Array<{feature:string, error:string}> }}
   */
  applyAll(features) {
    const toApply = features || Array.from(this._registry.keys());
    const result = { applied: [], skipped: [], errors: [] };

    if (!Array.isArray(toApply)) {
      throw new TypeError("features must be an array of strings");
    }

    for (const feature of toApply) {
      try {
        const entry = this._get(feature);
        const needed = this.isNeeded(feature);

        if (!needed) {
          result.skipped.push(feature);
          continue;
        }

        if (entry.applied) {
          result.skipped.push(feature);
          continue;
        }

        entry.implementation();
        entry.applied = true;
        entry.appliedAt = Date.now();
        result.applied.push(feature);
        this._notify(feature, true);
      } catch (err) {
        result.errors.push({ feature, error: err.message });
      }
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Listing / introspection
  // -----------------------------------------------------------------------

  /**
   * Return a summary of all registered polyfills.
   *
   * @returns {Array<{feature: string, needed: boolean, applied: boolean}>}
   */
  list() {
    const results = [];
    for (const [feature] of this._registry) {
      results.push({
        feature,
        needed: this.isNeeded(feature),
        applied: this._registry.get(feature).applied,
      });
    }
    return results;
  }

  /**
   * Return the number of registered polyfills.
   *
   * @returns {number}
   */
  get size() {
    return this._registry.size;
  }

  /**
   * Return the number of polyfills that have already been applied.
   *
   * @returns {number}
   */
  get appliedCount() {
    let count = 0;
    for (const entry of this._registry.values()) {
      if (entry.applied) count++;
    }
    return count;
  }

  /**
   * Reset a single polyfill's applied state so it can be re-applied.
   *
   * @param {string} feature
   * @returns {boolean} true if reset, false if not found
   */
  reset(feature) {
    const entry = this._registry.get(feature);
    if (!entry) return false;
    entry.applied = false;
    entry.appliedAt = null;
    return true;
  }

  /**
   * Reset all polyfills to their non-applied state.
   */
  resetAll() {
    for (const entry of this._registry.values()) {
      entry.applied = false;
      entry.appliedAt = null;
    }
  }

  /**
   * Register a callback that fires after every successful polyfill application.
   *
   * @param {function(feature: string, applied: boolean)} fn
   * @returns {PolyfillRegistry} this (chainable)
   */
  onApplied(fn) {
    if (typeof fn === "function") {
      this._hooks.push(fn);
    }
    return this;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Retrieve a registered polyfill or throw.
   *
   * @param {string} feature
   * @returns {object}
   */
  _get(feature) {
    const entry = this._registry.get(feature);
    if (!entry) {
      throw new Error(
        `Polyfill "${feature}" is not registered. ` +
          `Available: ${Array.from(this._registry.keys()).join(", ") || "none"}`,
      );
    }
    return entry;
  }

  /**
   * Notify all onApplied hooks.
   */
  _notify(feature, applied) {
    for (const hook of this._hooks) {
      try {
        hook(feature, applied);
      } catch (_) {
        // Silently swallow hook errors to prevent cascading failures
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Built-in polyfill catalog
// ---------------------------------------------------------------------------

/**
 * A curated set of environment-gap polyfills relevant to HaxAgent's
 * Node.js / desktop runtime.
 *
 * Usage:
 *   const { BUILTIN_POLYFILLS } = require("./compat/polyfill");
 *   for (const [name, { detector, impl }] of Object.entries(BUILTIN_POLYFILLS)) {
 *     registry.register(name, detector, impl);
 *   }
 */
const BUILTIN_POLYFILLS = Object.freeze({
  // --------------------------------------------------------------------
  // globalThis (Node < 12)
  // --------------------------------------------------------------------
  globalThis: {
    detector: () => typeof globalThis !== "undefined",
    impl: () => {
      (function () {
        if (typeof globalThis === "undefined") {
          Object.defineProperty(global, "globalThis", {
            get() {
              return (function () {
                if (typeof self !== "undefined") return self;
                if (typeof window !== "undefined") return window;
                if (typeof global !== "undefined") return global;
                return undefined;
              })();
            },
            configurable: true,
          });
        }
      })();
    },
  },

  // --------------------------------------------------------------------
  // structuredClone (Node < 17)
  // --------------------------------------------------------------------
  structuredClone: {
    detector: () => typeof structuredClone === "function",
    impl: () => {
      if (typeof structuredClone !== "function") {
        global.structuredClone = (obj) => {
          if (obj === undefined) throw new TypeError("structuredClone: undefined");
          return JSON.parse(JSON.stringify(obj));
        };
      }
    },
  },

  // --------------------------------------------------------------------
  // AbortSignal.timeout (Node < 17.3)
  // --------------------------------------------------------------------
  abortSignalTimeout: {
    detector: () => typeof AbortSignal.timeout === "function",
    impl: () => {
      if (typeof AbortSignal.timeout !== "function") {
        AbortSignal.timeout = (ms) => {
          const controller = new AbortController();
          setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), ms);
          return controller.signal;
        };
      }
    },
  },

  // --------------------------------------------------------------------
  // String.prototype.replaceAll (Node < 15)
  // --------------------------------------------------------------------
  stringReplaceAll: {
    detector: () => typeof String.prototype.replaceAll === "function",
    impl: () => {
      if (typeof String.prototype.replaceAll !== "function") {
        String.prototype.replaceAll = function (search, replacement) {
          if (typeof search === "string") {
            return this.split(search).join(replacement);
          }
          return this.replace(new RegExp(search.source, "g" + search.flags), replacement);
        };
      }
    },
  },

  // --------------------------------------------------------------------
  // Array.prototype.at (Node < 16.6)
  // --------------------------------------------------------------------
  arrayAt: {
    detector: () => typeof Array.prototype.at === "function",
    impl: () => {
      if (typeof Array.prototype.at !== "function") {
        Array.prototype.at = function (index) {
          const len = this.length;
          const relativeIndex = index < 0 ? len + index : index;
          if (relativeIndex < 0 || relativeIndex >= len) return undefined;
          return this[relativeIndex];
        };
      }
    },
  },

  // --------------------------------------------------------------------
  // Object.hasOwn (Node < 16.9)
  // --------------------------------------------------------------------
  objectHasOwn: {
    detector: () => typeof Object.hasOwn === "function",
    impl: () => {
      if (typeof Object.hasOwn !== "function") {
        Object.hasOwn = (obj, prop) =>
          Object.prototype.hasOwnProperty.call(obj, prop);
      }
    },
  },

  // --------------------------------------------------------------------
  // crypto.randomUUID (Node < 19)
  // --------------------------------------------------------------------
  cryptoRandomUUID: {
    detector: () =>
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function",
    impl: () => {
      if (typeof crypto.randomUUID !== "function") {
        const cryptoObj = global.crypto || {};
        cryptoObj.randomUUID = function () {
          return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
            /[xy]/g,
            (c) => {
              const r = (Math.random() * 16) | 0;
              const v = c === "x" ? r : (r & 0x3) | 0x8;
              return v.toString(16);
            },
          );
        };
        global.crypto = cryptoObj;
      }
    },
  },

  // --------------------------------------------------------------------
  // Promise.allSettled (Node < 12.9)
  // --------------------------------------------------------------------
  promiseAllSettled: {
    detector: () => typeof Promise.allSettled === "function",
    impl: () => {
      if (typeof Promise.allSettled !== "function") {
        Promise.allSettled = (promises) =>
          Promise.all(
            Array.from(promises).map((p) =>
              Promise.resolve(p)
                .then((value) => ({ status: "fulfilled", value }))
                .catch((reason) => ({ status: "rejected", reason })),
            ),
          );
      }
    },
  },

  // --------------------------------------------------------------------
  // Provider API compatibility: OpenAI-style messages format
  // --------------------------------------------------------------------
  providerMessagesCompat: {
    detector: () => true, // Always available as a safety net
    impl: () => {
      // Stub — callers replace with a concrete provider adapter if needed
      if (!global.__hax_providerMessagesCompat) {
        global.__hax_providerMessagesCompat = {
          toAnthropic(messages) {
            // Basic conversion: OpenAI system message → Anthropic system param
            const systemMsg = messages.find((m) => m.role === "system");
            const userAssist = messages.filter((m) => m.role !== "system");
            return { system: systemMsg ? systemMsg.content : null, messages: userAssist };
          },
          toOpenAI(messages) {
            // Already in OpenAI format — pass through
            return messages;
          },
        };
      }
    },
  },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

PolyfillRegistry.BUILTIN_POLYFILLS = BUILTIN_POLYFILLS;

module.exports = {
  PolyfillRegistry,
  BUILTIN_POLYFILLS,
};
