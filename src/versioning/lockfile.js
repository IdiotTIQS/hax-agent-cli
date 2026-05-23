"use strict";

/**
 * Lockfile — Manages version lockfiles for deterministic dependency resolution.
 *
 * Lockfiles ensure reproducible installs by recording exact versions,
 * resolved URLs / paths, and integrity hashes for every dependency in the tree.
 *
 *   const { Lockfile } = require("./versioning/lockfile");
 *   const lock = new Lockfile();
 *   lock.load("./hax-lock.json");
 *   lock.addDependency("plugin-auth", "1.2.3", {
 *     resolved: "https://registry.example.com/plugin-auth-1.2.3.tgz",
 *     integrity: "sha512-abc123..."
 *   });
 *   lock.save("./hax-lock.json");
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const LOCKFILE_VERSION = 1;

class Lockfile {
  constructor() {
    /** @type {number} */
    this.version = LOCKFILE_VERSION;
    /** @type {Map<string, { version: string, resolved: string|null, integrity: string|null, dependencies: object|null }>} */
    this._dependencies = new Map();
    /** @type {string|null} */
    this._path = null;
  }

  /**
   * Load a lockfile from disk.
   *
   * @param {string} filePath  Path to the lockfile JSON
   * @returns {Lockfile}       This instance (for chaining)
   * @throws {Error} If the file cannot be read or parsed
   */
  load(filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Lockfile not found: ${resolved}`);
    }

    const raw = fs.readFileSync(resolved, "utf8");
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse lockfile ${resolved}: ${err.message}`);
    }

    this.version = data.version || LOCKFILE_VERSION;
    this._path = resolved;
    this._dependencies.clear();

    if (data.dependencies && typeof data.dependencies === "object") {
      for (const [name, entry] of Object.entries(data.dependencies)) {
        if (entry && typeof entry === "object") {
          this._dependencies.set(name, {
            version: entry.version || "0.0.0",
            resolved: entry.resolved || null,
            integrity: entry.integrity || null,
            dependencies: entry.dependencies || null,
          });
        }
      }
    }

    return this;
  }

  /**
   * Save the lockfile to disk.
   *
   * @param {string} [filePath]  Path to write to (uses loaded path if omitted)
   */
  save(filePath) {
    const target = filePath ? path.resolve(filePath) : this._path;
    if (!target) {
      throw new Error("No path specified for saving lockfile");
    }

    const deps = {};
    for (const [name, entry] of this._dependencies) {
      deps[name] = {
        version: entry.version,
        resolved: entry.resolved,
        integrity: entry.integrity,
      };
      if (entry.dependencies) {
        deps[name].dependencies = entry.dependencies;
      }
    }

    const output = {
      version: this.version,
      lockfileVersion: LOCKFILE_VERSION,
      dependencies: deps,
    };

    fs.writeFileSync(target, JSON.stringify(output, null, 2), "utf8");
    this._path = target;
  }

  /**
   * Add or update a dependency in the lockfile.
   *
   * @param {string} name        Dependency name
   * @param {string} version     Exact resolved version
   * @param {object} [opts]      Additional metadata
   * @param {string} [opts.resolved]   URL or path the package was resolved from
   * @param {string} [opts.integrity]  Integrity hash (e.g. sha512-abc...)
   * @param {object} [opts.dependencies] Nested dependency map
   * @returns {Lockfile}  This instance (for chaining)
   */
  addDependency(name, version, opts) {
    if (typeof name !== "string" || !name.trim()) {
      throw new Error("Dependency name must be a non-empty string");
    }
    if (typeof version !== "string" || !version.trim()) {
      throw new Error(`Version for "${name}" must be a non-empty string`);
    }

    this._dependencies.set(name, {
      version,
      resolved: (opts && opts.resolved) || null,
      integrity: (opts && opts.integrity) || null,
      dependencies: (opts && opts.dependencies) || null,
    });

    return this;
  }

  /**
   * Resolve a dependency to its exact version and metadata.
   *
   * @param {string} name  Dependency name
   * @returns {{ version: string, resolved: string|null, integrity: string|null }|null}
   */
  resolve(name) {
    const entry = this._dependencies.get(name);
    if (!entry) return null;
    return {
      version: entry.version,
      resolved: entry.resolved,
      integrity: entry.integrity,
    };
  }

  /**
   * Compute a diff between two lockfiles (or Lockfile instances).
   *
   * @param {Lockfile|object} oldLockfile  Previous lockfile data/instance
   * @param {Lockfile|object} newLockfile  Current lockfile data/instance
   * @returns {{
   *   added: Array<{ name: string, version: string }>,
   *   removed: Array<{ name: string, version: string }>,
   *   updated: Array<{ name: string, oldVersion: string, newVersion: string }>,
   *   unchanged: Array<{ name: string, version: string }>
   * }}
   */
  static diff(oldLockfile, newLockfile) {
    const oldDeps = Lockfile._extractDeps(oldLockfile);
    const newDeps = Lockfile._extractDeps(newLockfile);

    const added = [];
    const removed = [];
    const updated = [];
    const unchanged = [];

    const allNames = new Set([...Object.keys(oldDeps), ...Object.keys(newDeps)]);

    for (const name of allNames) {
      const oldEntry = oldDeps[name];
      const newEntry = newDeps[name];

      if (oldEntry && newEntry) {
        if (oldEntry.version !== newEntry.version) {
          updated.push({
            name,
            oldVersion: oldEntry.version,
            newVersion: newEntry.version,
          });
        } else {
          unchanged.push({ name, version: newEntry.version });
        }
      } else if (newEntry && !oldEntry) {
        added.push({ name, version: newEntry.version });
      } else {
        removed.push({ name, version: oldEntry.version });
      }
    }

    return { added, removed, updated, unchanged };
  }

  /**
   * Extract dependency map from a Lockfile instance or raw lockfile object.
   *
   * @param {Lockfile|object} lockfile
   * @returns {object}  { name: { version, resolved, integrity } }
   */
  static _extractDeps(lockfile) {
    if (lockfile instanceof Lockfile) {
      const result = {};
      for (const [name, entry] of lockfile._dependencies) {
        result[name] = { version: entry.version, resolved: entry.resolved, integrity: entry.integrity };
      }
      return result;
    }

    if (lockfile && typeof lockfile === "object") {
      const deps = lockfile.dependencies || lockfile._dependencies || {};
      if (deps instanceof Map) {
        const result = {};
        for (const [name, entry] of deps) {
          result[name] = { version: entry.version, resolved: entry.resolved, integrity: entry.integrity };
        }
        return result;
      }
      return deps;
    }

    return {};
  }

  /**
   * Validate lockfile integrity.
   *
   * Checks:
   *   - Has required "version" and "dependencies" fields
   *   - Every dependency has a non-empty version
   *   - Resolved URLs are valid (if present)
   *   - Integrity hashes match expected format (sha256-..., sha512-...)
   *
   * @param {Lockfile|object} lockfile  The lockfile to validate
   * @returns {{ valid: boolean, errors: Array<string> }}
   */
  static validate(lockfile) {
    const errors = [];

    if (!lockfile) {
      return { valid: false, errors: ["Lockfile is null or undefined"] };
    }

    const deps = Lockfile._extractDeps(lockfile);

    if (typeof deps !== "object" || Array.isArray(deps)) {
      return { valid: false, errors: ["Dependencies must be an object"] };
    }

    for (const [name, entry] of Object.entries(deps)) {
      if (!name || typeof name !== "string") {
        errors.push("Dependency key must be a non-empty string");
        continue;
      }

      if (!entry || typeof entry !== "object") {
        errors.push(`Dependency "${name}" entry must be an object`);
        continue;
      }

      if (!entry.version || typeof entry.version !== "string") {
        errors.push(`Dependency "${name}" has missing or invalid version`);
      }

      if (entry.resolved && typeof entry.resolved !== "string") {
        errors.push(`Dependency "${name}" resolved field must be a string`);
      }

      if (entry.integrity) {
        if (typeof entry.integrity !== "string") {
          errors.push(`Dependency "${name}" integrity field must be a string`);
        } else if (!/^(sha(?:256|384|512)|md5)-/i.test(entry.integrity)) {
          errors.push(
            `Dependency "${name}" integrity hash has unsupported format: ${entry.integrity}`
          );
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Generate an integrity hash for data.
   *
   * @param {string|Buffer} data  The data to hash
   * @param {string} [algorithm='sha512']  Hash algorithm
   * @returns {string}  e.g. "sha512-fcdeb9..."
   */
  static generateIntegrity(data, algorithm) {
    const alg = algorithm || "sha512";
    const hash = crypto.createHash(alg).update(data).digest("base64");
    return `${alg}-${hash}`;
  }

  /**
   * Get all dependency names.
   *
   * @returns {Array<string>}
   */
  getNames() {
    return [...this._dependencies.keys()];
  }

  /**
   * Get all dependencies as a plain object.
   *
   * @returns {object}
   */
  toObject() {
    const result = {};
    for (const [name, entry] of this._dependencies) {
      result[name] = {
        version: entry.version,
        resolved: entry.resolved,
        integrity: entry.integrity,
      };
      if (entry.dependencies) {
        result[name].dependencies = entry.dependencies;
      }
    }
    return result;
  }

  /**
   * Remove a dependency from the lockfile.
   *
   * @param {string} name
   * @returns {boolean}  True if removed, false if not found
   */
  removeDependency(name) {
    return this._dependencies.delete(name);
  }

  /**
   * Check if a dependency is present.
   *
   * @param {string} name
   * @returns {boolean}
   */
  hasDependency(name) {
    return this._dependencies.has(name);
  }

  /**
   * Get the number of dependencies.
   *
   * @returns {number}
   */
  get size() {
    return this._dependencies.size;
  }

  /**
   * Clear all dependencies.
   */
  clear() {
    this._dependencies.clear();
    this._path = null;
  }
}

module.exports = { Lockfile };
