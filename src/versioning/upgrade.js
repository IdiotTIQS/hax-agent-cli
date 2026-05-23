"use strict";

/**
 * UpgradeEngine — Manages version upgrade paths for plugins, skills, and
 * agent definitions. Supports registering upgrade chains, executing data
 * migrations, compatibility checks, and listing available upgrades.
 *
 *   const engine = new UpgradeEngine();
 *   engine.registerUpgrade("1.0.0", "1.1.0", (data) => {
 *     data.newField = "default";
 *     return data;
 *   });
 *   engine.registerUpgrade("1.1.0", "2.0.0", (data) => {
 *     delete data.oldField;
 *     data.schemaVersion = 2;
 *     return data;
 *   });
 *
 *   // Single-step upgrade
 *   const upgraded = engine.upgrade(data, "1.0.0", "1.1.0");
 *
 *   // Multi-step upgrade (finds the chain)
 *   const upgraded2 = engine.upgrade(data, "1.0.0", "2.0.0");
 */

const { compare, satisfies, diff: semverDiff } = require("./semver");

class UpgradeEngine {
  constructor() {
    /** @type {Map<string, Map<string, function>>}  fromVersion -> { toVersion -> fn } */
    this._upgrades = new Map();
    /** @type {Map<string, Set<string>>}  fromVersion -> Set of toVersions */
    this._edges = new Map();
    /** @type {Map<string, string>}  componentName -> latestVersion */
    this._latest = new Map();
    /** @type {Map<string, Map<string, object>>}  componentName -> version -> compatibility info */
    this._compatibility = new Map();
  }

  /**
   * Register an upgrade function that transforms data from one version to another.
   *
   * @param {string} fromVersion  Source version
   * @param {string} toVersion    Target version
   * @param {function(object): object} upgradeFn
   *   Upgrade function that receives data and returns transformed data
   * @param {object} [opts]       Optional metadata
   * @param {string} [opts.component]  Component name for version tracking
   * @param {string} [opts.description] Human-readable description
   * @throws {Error} If versions are invalid or the upgrade already exists
   */
  registerUpgrade(fromVersion, toVersion, upgradeFn, opts) {
    if (typeof fromVersion !== "string" || typeof toVersion !== "string") {
      throw new Error("fromVersion and toVersion must be strings");
    }
    if (typeof upgradeFn !== "function") {
      throw new Error("upgradeFn must be a function");
    }
    if (fromVersion === toVersion) {
      throw new Error("fromVersion and toVersion must be different");
    }

    // Don't allow downgrades
    if (compare(fromVersion, toVersion) >= 0) {
      throw new Error(
        `Invalid upgrade path: ${fromVersion} -> ${toVersion} (must be an upgrade, not downgrade or equal)`
      );
    }

    // Check for duplicate
    if (this._upgrades.has(fromVersion) && this._upgrades.get(fromVersion).has(toVersion)) {
      throw new Error(
        `Upgrade path ${fromVersion} -> ${toVersion} is already registered`
      );
    }

    // Store the upgrade
    if (!this._upgrades.has(fromVersion)) {
      this._upgrades.set(fromVersion, new Map());
    }
    this._upgrades.get(fromVersion).set(toVersion, upgradeFn);

    // Track edges for path finding
    if (!this._edges.has(fromVersion)) {
      this._edges.set(fromVersion, new Set());
    }
    this._edges.get(fromVersion).add(toVersion);

    // Track latest version if component specified
    const component = (opts && opts.component) || null;
    if (component) {
      let best = this._latest.get(component) || "0.0.0";
      if (compare(toVersion, best) > 0) best = toVersion;
      if (compare(fromVersion, best) > 0) best = fromVersion;
      this._latest.set(component, best);
    }
  }

  /**
   * Find the shortest upgrade chain from one version to another.
   * Uses BFS to find the minimum number of steps.
   *
   * @param {string} fromVersion
   * @param {string} toVersion
   * @returns {Array<{ from: string, to: string }>|null}  Chain of upgrade steps, or null if no path
   */
  getUpgradePath(fromVersion, toVersion) {
    if (fromVersion === toVersion) return [];

    // BFS through the upgrade graph
    const queue = [{ version: fromVersion, path: [] }];
    const visited = new Set([fromVersion]);

    while (queue.length > 0) {
      const { version, path } = queue.shift();

      const edges = this._edges.get(version);
      if (!edges) continue;

      for (const nextVersion of edges) {
        if (visited.has(nextVersion)) continue;
        visited.add(nextVersion);

        const newPath = [...path, { from: version, to: nextVersion }];

        if (nextVersion === toVersion) {
          return newPath;
        }

        queue.push({ version: nextVersion, path: newPath });
      }
    }

    return null; // No path found
  }

  /**
   * Execute an upgrade chain, transforming data through each step.
   *
   * @param {object} data         The data to upgrade
   * @param {string} fromVersion  Starting version
   * @param {string} toVersion    Target version
   * @returns {{ data: object, steps: Array<string>, originalVersion: string, finalVersion: string }}
   * @throws {Error} If no upgrade path is found or an upgrade step fails
   */
  upgrade(data, fromVersion, toVersion) {
    if (fromVersion === toVersion) {
      return {
        data,
        steps: [],
        originalVersion: fromVersion,
        finalVersion: toVersion,
      };
    }

    const path = this.getUpgradePath(fromVersion, toVersion);
    if (!path) {
      throw new Error(
        `No upgrade path found from ${fromVersion} to ${toVersion}`
      );
    }

    let current = { ...data };
    const stepDescriptions = [];

    for (const step of path) {
      const upgradeFn = this._upgrades.get(step.from).get(step.to);
      if (!upgradeFn) {
        throw new Error(
          `Missing upgrade function for ${step.from} -> ${step.to}`
        );
      }

      try {
        current = upgradeFn(current);
        stepDescriptions.push(`${step.from} -> ${step.to}`);
      } catch (err) {
        throw new Error(
          `Upgrade step ${step.from} -> ${step.to} failed: ${err.message}`
        );
      }
    }

    return {
      data: current,
      steps: stepDescriptions,
      originalVersion: fromVersion,
      finalVersion: toVersion,
    };
  }

  /**
   * Check whether a component version is compatible with a target version.
   *
   * @param {string} component      Component name
   * @param {string} targetVersion  Target version or range to check against
   * @returns {{ compatible: boolean, reason: string, currentVersion: string|null }}
   */
  checkCompatibility(component, targetVersion) {
    const latest = this._latest.get(component);
    if (!latest) {
      return {
        compatible: false,
        reason: `Component "${component}" has no registered versions`,
        currentVersion: null,
      };
    }

    // Check if the component's concrete latest version satisfies the target range
    if (!satisfies(latest, targetVersion)) {
      return {
        compatible: false,
        reason: `Version ${latest} does not satisfy target range ${targetVersion}`,
        currentVersion: latest,
      };
    }

    // If compatibility data specifies engine/environment requirements, check those
    const compatData = this._compatibility.get(component);
    if (compatData && compatData.has(latest)) {
      const info = compatData.get(latest);
      if (info.engineMin) {
        // For engine requirements, the caller would supply the actual engine version
        // Pass through — the caller handles engine-level compatibility separately
      }
    }

    return {
      compatible: true,
      reason: `Version ${latest} is compatible with target ${targetVersion}`,
      currentVersion: latest,
    };
  }

  /**
   * Register compatibility information for a component version.
   *
   * @param {string} component   Component name
   * @param {string} version     Version this info applies to
   * @param {object} info        Compatibility info
   * @param {string} [info.requires]    Semver range that this version requires
   * @param {string} [info.breaks]      Semver range this version breaks with
   * @param {string} [info.engineMin]   Minimum required engine version
   */
  registerCompatibility(component, version, info) {
    if (!this._compatibility.has(component)) {
      this._compatibility.set(component, new Map());
    }
    this._compatibility.get(component).set(version, info);
  }

  /**
   * Get all available upgrades from a given version.
   *
   * @param {string} fromVersion   Starting version, or null/undefined for all
   * @returns {Array<{ from: string, to: string }>}
   */
  getAvailableUpgrades(fromVersion) {
    const results = [];

    if (fromVersion) {
      const edges = this._edges.get(fromVersion);
      if (edges) {
        for (const to of edges) {
          results.push({ from: fromVersion, to });
        }
      }
    } else {
      // Return all registered upgrades
      for (const [from, toMap] of this._upgrades) {
        for (const [to] of toMap) {
          results.push({ from, to });
        }
      }
    }

    return results;
  }

  /**
   * Get the latest version registered for a component.
   *
   * @param {string} componentName
   * @returns {string|null}
   */
  getLatestVersion(componentName) {
    return this._latest.get(componentName) || null;
  }

  /**
   * Get all known components and their versions.
   *
   * @returns {Map<string, string>}
   */
  getAllVersions() {
    return new Map(this._latest);
  }

  /**
   * Remove an upgrade path.
   *
   * @param {string} fromVersion
   * @param {string} toVersion
   * @returns {boolean}
   */
  removeUpgrade(fromVersion, toVersion) {
    const upgrades = this._upgrades.get(fromVersion);
    if (!upgrades) return false;

    const deleted = upgrades.delete(toVersion);
    if (deleted) {
      const edges = this._edges.get(fromVersion);
      if (edges) edges.delete(toVersion);
      if (upgrades.size === 0) {
        this._upgrades.delete(fromVersion);
        this._edges.delete(fromVersion);
      }
    }
    return deleted;
  }

  /**
   * Check if a direct upgrade path exists.
   *
   * @param {string} fromVersion
   * @param {string} toVersion
   * @returns {boolean}
   */
  hasUpgrade(fromVersion, toVersion) {
    return this._upgrades.has(fromVersion) && this._upgrades.get(fromVersion).has(toVersion);
  }

  /**
   * Count registered upgrade paths.
   *
   * @returns {number}
   */
  countUpgrades() {
    let count = 0;
    for (const toMap of this._upgrades.values()) {
      count += toMap.size;
    }
    return count;
  }
}

module.exports = { UpgradeEngine };
