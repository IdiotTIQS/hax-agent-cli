"use strict";

/**
 * DependencyGraph — Manages plugin dependency relationships with
 * cycle detection, topological ordering, version-conflict detection,
 * and simple semver-range matching (^1.0.0, ~1.0.0, >=1.0.0).
 *
 *   const graph = new DependencyGraph();
 *   graph.addPlugin("p1", "1.0.0", { p2: "^2.0.0" });
 *   graph.addPlugin("p2", "2.1.0", {});
 *   console.log(graph.loadOrder());  // ["p2", "p1"]
 *   console.log(graph.detectCycles());  // []
 */

// ---------------------------------------------------------------------------
// Semver helpers
// ---------------------------------------------------------------------------

/**
 * Parse a semver string "1.2.3-prerelease" into { major, minor, patch, pre }.
 * Returns null if the string does not look like a version.
 */
function parseVersion(version) {
  if (typeof version !== "string") return null;
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] || null,
    raw: version,
  };
}

/**
 * Check whether `version` satisfies `range`.
 *
 * Supported range forms:
 *   - Exact:  "1.2.3"
 *   - Caret:  "^1.2.3"  → >=1.2.3 <2.0.0
 *   - Tilde:  "~1.2.3"  → >=1.2.3 <1.3.0
 *   - Gte:    ">=1.2.3"
 *   - Lte:    "<=1.2.3"
 *   - Gt:     ">1.2.3"
 *   - Lt:     "<1.2.3"
 *
 * @param {string} version  Concrete version string (e.g. "1.3.0")
 * @param {string} range    Range string (e.g. "^1.0.0")
 * @returns {boolean}
 */
function satisfies(version, range) {
  const ver = parseVersion(version);
  if (!ver) return false;

  // Exact match
  if (/^\d+\.\d+\.\d+/.test(range) && !range.startsWith(">") && !range.startsWith("<") && !range.startsWith("^") && !range.startsWith("~")) {
    const exact = parseVersion(range);
    if (!exact) return false;
    return ver.major === exact.major && ver.minor === exact.minor && ver.patch === exact.patch;
  }

  // Caret range: ^1.2.3
  if (range.startsWith("^")) {
    const base = parseVersion(range.slice(1));
    if (!base) return false;
    const cmp = compareVersions(ver, base);
    if (cmp < 0) return false;
    if (base.major === 0 && base.minor === 0) {
      // ^0.0.x → >=0.0.x <0.0.(x+1)
      return ver.major === 0 && ver.minor === 0 && ver.patch < base.patch + 1;
    }
    if (base.major === 0) {
      // ^0.x.y → >=0.x.y <0.(x+1).0
      return ver.major === 0 && ver.minor < base.minor + 1;
    }
    // ^x.y.z → >=x.y.z <(x+1).0.0
    return ver.major < base.major + 1;
  }

  // Tilde range: ~1.2.3
  if (range.startsWith("~")) {
    const base = parseVersion(range.slice(1));
    if (!base) return false;
    const cmp = compareVersions(ver, base);
    if (cmp < 0) return false;
    return ver.major === base.major && ver.minor < base.minor + 1;
  }

  // Gte: >=1.2.3
  if (range.startsWith(">=")) {
    const base = parseVersion(range.slice(2));
    if (!base) return false;
    return compareVersions(ver, base) >= 0;
  }

  // Lte: <=1.2.3
  if (range.startsWith("<=")) {
    const base = parseVersion(range.slice(2));
    if (!base) return false;
    return compareVersions(ver, base) <= 0;
  }

  // Gt: >1.2.3
  if (range.startsWith(">")) {
    const base = parseVersion(range.slice(1));
    if (!base) return false;
    return compareVersions(ver, base) > 0;
  }

  // Lt: <1.2.3
  if (range.startsWith("<")) {
    const base = parseVersion(range.slice(1));
    if (!base) return false;
    return compareVersions(ver, base) < 0;
  }

  // Fallback: exact string compare
  return version === range;
}

/**
 * Compare two parsed versions.  Returns negative if a < b, 0 if equal, positive if a > b.
 * Ignores pre-release tags for simplicity in ordering.
 */
function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  return 0;
}

// ---------------------------------------------------------------------------
// DependencyGraph
// ---------------------------------------------------------------------------

class DependencyGraph {
  constructor() {
    /** @type {Map<string, { name: string, version: string, dependencies: object }>} */
    this._nodes = new Map();
  }

  /**
   * Add or update a plugin node in the graph.
   *
   * @param {string} name           Plugin name
   * @param {string} version        Concrete version string
   * @param {object} [dependencies] Map of dep-name → semver-range
   */
  addPlugin(name, version, dependencies) {
    if (typeof name !== "string" || !name.trim()) {
      throw new Error("Plugin name is required");
    }
    if (typeof version !== "string" || !version.trim()) {
      throw new Error("Plugin version is required");
    }

    const deps = {};
    if (dependencies && typeof dependencies === "object") {
      for (const [depName, range] of Object.entries(dependencies)) {
        if (typeof range === "string") {
          deps[depName] = range;
        }
      }
    }

    this._nodes.set(name, { name, version, dependencies: deps });
  }

  /**
   * Remove a plugin from the graph.
   */
  removePlugin(name) {
    return this._nodes.delete(name);
  }

  /**
   * Get a single plugin node.
   */
  get(name) {
    return this._nodes.get(name) || null;
  }

  /**
   * Resolve the full dependency tree for a plugin (including transitive deps).
   *
   * Returns an array of plugin entries in dependency order (deps first).
   *
   * @param {string} pluginName
   * @returns {Array<object>}
   */
  resolve(pluginName) {
    const resolved = [];
    const visited = new Set();

    const visit = (name, parents) => {
      if (parents && parents.has(name)) {
        // Cycle detected — skip
        return;
      }

      if (visited.has(name)) {
        return;
      }

      const node = this._nodes.get(name);
      if (!node) {
        throw new Error(`Unknown dependency: ${name}`);
      }

      const parentChain = parents ? new Set(parents) : new Set();
      parentChain.add(name);
      visited.add(name);

      // Resolve dependencies first
      for (const depName of Object.keys(node.dependencies)) {
        if (!this._nodes.has(depName)) {
          throw new Error(`Unknown dependency: ${depName} (required by ${name})`);
        }
        visit(depName, parentChain);
      }

      resolved.push({ name: node.name, version: node.version, dependencies: node.dependencies });
    };

    visit(pluginName, null);
    return resolved;
  }

  /**
   * Detect circular dependencies in the graph.
   *
   * Runs a DFS from every node and returns an array of cycle descriptions.
   * Each cycle is represented as an array of plugin names that form the loop.
   *
   * @returns {Array<Array<string>>}
   */
  detectCycles() {
    const cycles = [];
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map();

    for (const name of this._nodes.keys()) {
      color.set(name, WHITE);
    }

    const dfs = (node, stack) => {
      color.set(node, GRAY);
      stack.push(node);

      const plugin = this._nodes.get(node);
      if (plugin) {
        for (const depName of Object.keys(plugin.dependencies)) {
          if (!color.has(depName)) continue; // Unknown dep, skip

          const c = color.get(depName);
          if (c === GRAY) {
            // Found a cycle — extract it from the stack
            const idx = stack.indexOf(depName);
            if (idx !== -1) {
              cycles.push(stack.slice(idx).concat(depName));
            }
          } else if (c === WHITE) {
            dfs(depName, stack);
          }
        }
      }

      stack.pop();
      color.set(node, BLACK);
    };

    for (const name of this._nodes.keys()) {
      if (color.get(name) === WHITE) {
        dfs(name, []);
      }
    }

    return cycles;
  }

  /**
   * Compute a topologically sorted load order.
   *
   * Uses Kahn's algorithm.  Returns an array of plugin names in load order
   * (dependencies before dependents).  Throws if a cycle is detected.
   *
   * @returns {Array<string>}
   */
  loadOrder() {
    const inDegree = new Map();
    const adj = new Map();

    for (const name of this._nodes.keys()) {
      inDegree.set(name, 0);
      adj.set(name, []);
    }

    // Build adjacency list and in-degrees
    for (const [name, node] of this._nodes) {
      for (const depName of Object.keys(node.dependencies)) {
        if (this._nodes.has(depName)) {
          adj.get(depName).push(name);
          inDegree.set(name, (inDegree.get(name) || 0) + 1);
        }
      }
    }

    // Queue nodes with zero in-degree
    const queue = [];
    for (const [name, deg] of inDegree) {
      if (deg === 0) queue.push(name);
    }

    const order = [];
    while (queue.length > 0) {
      const current = queue.shift();
      order.push(current);

      for (const neighbor of adj.get(current) || []) {
        const newDeg = inDegree.get(neighbor) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) {
          queue.push(neighbor);
        }
      }
    }

    // If we didn't process all nodes, there is a cycle
    if (order.length !== this._nodes.size) {
      throw new Error("Cannot compute load order: circular dependency detected");
    }

    return order;
  }

  /**
   * Detect version conflicts across the graph.
   *
   * A conflict occurs when two plugins depend on different incompatible
   * versions of the same dependency.  Returns an array of conflict
   * descriptions.
   *
   * @returns {Array<{ dependency: string, versions: Array<{ requiredBy: string, range: string }> }>}
   */
  checkConflicts() {
    /** @type {Map<string, Array<{ requiredBy: string, range: string }>>} */
    const depRequests = new Map();

    for (const [name, node] of this._nodes) {
      for (const [depName, range] of Object.entries(node.dependencies)) {
        if (!depRequests.has(depName)) {
          depRequests.set(depName, []);
        }
        depRequests.get(depName).push({ requiredBy: name, range });
      }
    }

    const conflicts = [];

    for (const [depName, requests] of depRequests) {
      if (requests.length <= 1) continue;

      // Check if all requested ranges are compatible with at least one
      // concrete version.  We consider ranges compatible if there exists
      // some version that satisfies all of them.
      // For simplicity, we check pairwise: pick a concrete version from
      // the first request and verify it satisfies all others.
      // If no concrete version is available in the graph, we flag a
      // potential conflict.
      const depNode = this._nodes.get(depName);
      const concreteVersion = depNode ? depNode.version : null;

      if (concreteVersion) {
        let allSatisfy = true;
        for (const req of requests) {
          if (!satisfies(concreteVersion, req.range)) {
            allSatisfy = false;
            break;
          }
        }
        if (allSatisfy) continue; // No conflict
      }

      // Determine if the ranges are mutually exclusive
      const hasConflict = requests.length >= 2 && !concreteVersion
        ? true
        : (() => {
            // Check if any pair of ranges are incompatible
            for (let i = 0; i < requests.length; i++) {
              for (let j = i + 1; j < requests.length; j++) {
                // For ^ ranges, check if major versions differ
                const ri = requests[i].range;
                const rj = requests[j].range;
                if (ri.startsWith("^") && rj.startsWith("^")) {
                  const baseI = parseVersion(ri.slice(1));
                  const baseJ = parseVersion(rj.slice(1));
                  if (baseI && baseJ && baseI.major !== baseJ.major) {
                    return true;
                  }
                }
              }
            }
            return !concreteVersion; // Uncertain if no concrete version
          })();

      if (hasConflict) {
        conflicts.push({
          dependency: depName,
          versions: requests.map((r) => ({ requiredBy: r.requiredBy, range: r.range })),
        });
      }
    }

    return conflicts;
  }
}

module.exports = { DependencyGraph, satisfies };
