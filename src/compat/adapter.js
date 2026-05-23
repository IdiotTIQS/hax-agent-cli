"use strict";

/**
 * APIAdapter — translates calls from one API version to another so client code
 * that targets an older (or newer) API shape continues to work.
 *
 * Three adapters are provided:
 *   - APIAdapter        Manually-defined version-to-version adapters
 *   - ChainAdapter      Composes multiple APIAdapters for multi-hop migrations
 *   - AutoAdapter       Derives a mapping from explicit old→new parameter
 *                       renames, requiring zero transformation functions.
 *
 * Example:
 *
 *   // Manual adapter
 *   const a = new APIAdapter();
 *   a.registerAdapter("1.0.0", "2.0.0", {
 *     version: "2.0.0",
 *     map(method, args) { ... },
 *   });
 *   a.resolve({ method: "search", args: [q] }, "2.0.0");
 *
 *   // AutoAdapter (parameter rename only)
 *   const b = new AutoAdapter("1.0.0", "2.0.0", { query: "q", limit: "maxResults" });
 *   b.resolve({ method: "search", args: { query: "hello" } }, "2.0.0");
 */

// ---------------------------------------------------------------------------
// APIAdapter
// ---------------------------------------------------------------------------

class APIAdapter {
  constructor() {
    /**
     * Map<string, object>  key = "fromVersion:toVersion"
     *   value = { version, map(method, args): [method, args] }
     */
    this._adapters = new Map();
  }

  /**
   * Create a one-hop adapter from `fromVersion` to `toVersion`.
   *
   * This is a convenience factory that internally calls `registerAdapter`.
   *
   * @param {string}   fromVersion
   * @param {string}   toVersion
   * @param {object}   adapter   { version: string, map(method, args): [method, args] }
   * @returns {APIAdapter} this (chainable)
   */
  adapt(fromVersion, toVersion, adapter) {
    this.registerAdapter(fromVersion, toVersion, adapter);
    return this;
  }

  /**
   * Register a version adapter.
   *
   * @param {string} fromVersion  Source API version
   * @param {string} toVersion    Target API version
   * @param {object} adapter      Must have a `map(method, args)` function
   * @returns {APIAdapter} this (chainable)
   */
  registerAdapter(fromVersion, toVersion, adapter) {
    if (typeof fromVersion !== "string" || fromVersion.trim().length === 0) {
      throw new TypeError("fromVersion must be a non-empty string");
    }
    if (typeof toVersion !== "string" || toVersion.trim().length === 0) {
      throw new TypeError("toVersion must be a non-empty string");
    }
    if (!adapter || typeof adapter.map !== "function") {
      throw new TypeError("adapter must have a map(method, args) function");
    }

    const key = this._key(fromVersion, toVersion);
    this._adapters.set(key, {
      fromVersion,
      toVersion,
      version: adapter.version || toVersion,
      map: adapter.map,
    });

    return this;
  }

  /**
   * Resolve a request from its source version to the requested target version.
   *
   * A shortest-path BFS is performed over the registered adapter graph so that
   * multi-hop chains are discovered automatically.
   *
   * @param {object} request       { method: string, args: any }
   * @param {string} targetVersion  Desired output API version
   * @throws {Error} if no route exists or a required adapter is missing
   * @returns {object}  { method: string, args: any, hops: number, path: string[] }
   */
  resolve(request, targetVersion) {
    if (!request || typeof request !== "object") {
      throw new TypeError("request must be an object");
    }
    if (typeof request.method !== "string") {
      throw new TypeError("request.method must be a string");
    }
    if (typeof targetVersion !== "string" || targetVersion.trim().length === 0) {
      throw new TypeError("targetVersion must be a non-empty string");
    }

    const sourceVersion = request.version || null;
    if (!sourceVersion) {
      throw new Error(
        "request.version is required to resolve adapters. " +
          "Include the source version in your request object.",
      );
    }

    // Build adjacency graph: each version string is a node, each adapter an
    // edge from fromVersion → toVersion.
    const graph = {};
    for (const [key, adapter] of this._adapters) {
      const from = adapter.fromVersion;
      const to = adapter.toVersion;
      if (!graph[from]) graph[from] = [];
      graph[from].push({ to, adapter });
    }

    // BFS to find the shortest path
    const visited = new Set();
    const queue = [{ version: sourceVersion, hops: 0, current: request, path: [sourceVersion] }];

    while (queue.length > 0) {
      const { version, hops, current, path } = queue.shift();

      if (version === targetVersion) {
        return {
          method: current.method,
          args: current.args,
          version: targetVersion,
          hops,
          path,
        };
      }

      if (visited.has(version)) continue;
      visited.add(version);

      const edges = graph[version] || [];
      for (const { to, adapter } of edges) {
        let next;
        try {
          next = adapter.map(current.method, current.args);
        } catch (err) {
          throw new Error(
            `Adapter from ${version} to ${to} failed for method "${current.method}": ${err.message}`,
          );
        }

        if (!Array.isArray(next) || next.length < 1) {
          throw new Error(
            `Adapter from ${version} to ${to} must return [method, args]`,
          );
        }

        queue.push({
          version: to,
          hops: hops + 1,
          current: {
            method: next[0],
            args: next.length >= 2 ? next[1] : undefined,
            version: to,
          },
          path: [...path, to],
        });
      }
    }

    throw new Error(
      `No adapter path found from ${sourceVersion} to ${targetVersion}. ` +
        `Registered adapters: ${Array.from(this._adapters.keys()).join(", ") || "none"}`,
    );
  }

  /**
   * Check whether a direct adapter exists between two versions.
   *
   * @param {string} fromVersion
   * @param {string} toVersion
   * @returns {boolean}
   */
  hasAdapter(fromVersion, toVersion) {
    return this._adapters.has(this._key(fromVersion, toVersion));
  }

  /**
   * Return the number of registered adapters.
   *
   * @returns {number}
   */
  get size() {
    return this._adapters.size;
  }

  /**
   * List all registered adapter pairs.
   *
   * @returns {Array<{fromVersion: string, toVersion: string, version: string}>}
   */
  listAdapters() {
    return Array.from(this._adapters.values()).map((a) => ({
      fromVersion: a.fromVersion,
      toVersion: a.toVersion,
      version: a.version,
    }));
  }

  /** Internal key builder */
  _key(from, to) {
    return `${from}:${to}`;
  }
}

// ---------------------------------------------------------------------------
// ChainAdapter
// ---------------------------------------------------------------------------

/**
 * ChainAdapter composes multiple adapters into a single hop, hiding the
 * intermediate versions from callers.
 *
 * Example:
 *   const chain = new ChainAdapter();
 *   chain.add("1.0.0", "1.1.0", adapterA)
 *        .add("1.1.0", "2.0.0", adapterB);
 *   // Now resolves 1.0.0 -> 2.0.0 automatically
 */
class ChainAdapter extends APIAdapter {
  /**
   * Add an adapter link to the chain.
   *
   * @param {string} fromVersion
   * @param {string} toVersion
   * @param {object} adapter
   * @returns {ChainAdapter} this (chainable)
   */
  add(fromVersion, toVersion, adapter) {
    this.registerAdapter(fromVersion, toVersion, adapter);
    return this;
  }

  /**
   * Resolve using the full chain — inherited from APIAdapter.resolve() which
   * performs BFS and will automatically traverse multiple hops.
   */
}

// ---------------------------------------------------------------------------
// AutoAdapter
// ---------------------------------------------------------------------------

/**
 * AutoAdapter generates an adapter automatically from a simple parameter-name
 * mapping.  It only handles parameter renaming — if the method name or call
 * shape changes fundamentally you need a manual APIAdapter instead.
 *
 * Example:
 *   const auto = new AutoAdapter("1.0.0", "2.0.0", {
 *     query: "q",
 *     limit: "maxResults",
 *     sortBy: "orderBy",
 *   });
 *
 *   // Input:  { method: "search", args: { query: "hi", limit: 10 } }
 *   // Output: { method: "search", args: { q: "hi", maxResults: 10 } }
 */
class AutoAdapter {
  /**
   * @param {string} fromVersion  Source API version
   * @param {string} toVersion    Target API version
   * @param {object} paramMap     { oldParamName: newParamName }
   */
  constructor(fromVersion, toVersion, paramMap) {
    if (typeof fromVersion !== "string" || fromVersion.trim().length === 0) {
      throw new TypeError("fromVersion must be a non-empty string");
    }
    if (typeof toVersion !== "string" || toVersion.trim().length === 0) {
      throw new TypeError("toVersion must be a non-empty string");
    }
    if (!paramMap || typeof paramMap !== "object") {
      throw new TypeError("paramMap must be an object");
    }

    this.fromVersion = fromVersion;
    this.toVersion = toVersion;
    /** @type {Map<string, string>} */
    this._paramMap = new Map(Object.entries(paramMap));

    // Register self as a plain adapter on an internal APIAdapter so we can
    // use its resolve / graph traversal machinery
    this._inner = new APIAdapter();
    this._inner.registerAdapter(fromVersion, toVersion, {
      version: toVersion,
      map: (method, args) => this._mapArgs(method, args),
    });
  }

  /**
   * Resolve a request from the source version to the target version.
   *
   * This is a single-hop resolve; AutoAdapter does not chain across
   * intermediate versions on its own.  If you need multi-hop auto-adapting
   * compose AutoAdapter instances into a ChainAdapter.
   *
   * @param {object} request  { method: string, args: object, version?: string }
   * @param {string} [targetVersion]  Defaults to this.toVersion
   * @returns {object}
   */
  resolve(request, targetVersion) {
    const target = targetVersion || this.toVersion;
    return this._inner.resolve(request, target);
  }

  /**
   * Return the resolved request directly without going through BFS (single-hop
   * shortcut).  Throws if the request version does not match fromVersion.
   *
   * @param {object} request  { method: string, args: object, version: string }
   * @returns {object}  { method: string, args: object }
   */
  adapt(request) {
    if (!request || typeof request !== "object") {
      throw new TypeError("request must be an object");
    }
    if (request.version && request.version !== this.fromVersion) {
      throw new Error(
        `Version mismatch: request is ${request.version}, adapter expects ${this.fromVersion}`,
      );
    }
    const [method, args] = this._mapArgs(request.method, request.args);
    return { method, args, version: this.toVersion };
  }

  /**
   * Map a method name and its arguments through the parameter renames.
   *
   * @param {string} method  — passed through unchanged
   * @param {object} args    — keys are renamed per paramMap
   * @returns {[string, object]}
   */
  _mapArgs(method, args) {
    if (args === null || args === undefined) {
      return [method, args];
    }

    if (typeof args !== "object" || Array.isArray(args)) {
      // Non-object args (strings, arrays, numbers) are passed through
      return [method, args];
    }

    const mapped = {};
    const seen = new Set();

    for (const [key, value] of Object.entries(args)) {
      if (this._paramMap.has(key)) {
        const newKey = this._paramMap.get(key);
        mapped[newKey] = value;
        seen.add(key);
      } else {
        // Pass through unchanged parameters
        mapped[key] = value;
      }
    }

    return [method, mapped];
  }

  /**
   * Set or update a single parameter mapping.
   *
   * @param {string} oldParam
   * @param {string} newParam
   * @returns {AutoAdapter} this (chainable)
   */
  mapParam(oldParam, newParam) {
    this._paramMap.set(oldParam, newParam);
    return this;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  APIAdapter,
  ChainAdapter,
  AutoAdapter,
};
