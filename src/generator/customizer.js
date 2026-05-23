"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * ProjectCustomizer
 *
 * Applies post-generation customizations to a generated project.  Use this
 * after compose() to add dependencies, scripts, tool configurations, or
 * perform deep merges of config files.
 *
 * Supported operations:
 *   - addDependency(name, version)        — add an npm/pip/cargo dependency
 *   - addDevDependency(name, version)     — add a devDependency
 *   - addScript(name, command)             — add a package.json script
 *   - configureTool(tool, config)          — add/update tool config file
 *   - mergeConfig(base, override)          — deep-merge two config objects
 *   - applyEnvVars(vars)                   — set/update .env variables
 *   - customize(projectDir, options)       — apply all queued customizations
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deep-merge two objects.  Arrays are merged by deduplicating objects
 * keyed by "name" (otherwise concatenated).  Later values override.
 *
 * @param {object} base
 * @param {object} override
 * @returns {object}
 */
function deepMerge(base, override) {
  if (!override || typeof override !== "object") return base;

  const result = {};
  const allKeys = new Set([...Object.keys(base || {}), ...Object.keys(override)]);

  for (const key of allKeys) {
    const bVal = base ? base[key] : undefined;
    const oVal = override[key];

    if (oVal !== undefined) {
      if (Array.isArray(bVal) && Array.isArray(oVal)) {
        // Merge arrays.  For arrays of named objects, deduplicate by "name"
        // with override items winning.  For everything else, concatenate.
        const allNamed = [...bVal, ...oVal].every(
          (item) => item && typeof item === "object" && typeof item.name === "string"
        );
        if (allNamed) {
          const seen = new Set();
          const merged = [];
          // Process base first, then overrides (overrides replace dupes)
          for (const item of bVal) {
            seen.add(item.name);
            merged.push(item);
          }
          for (const item of oVal) {
            const idx = merged.findIndex((m) => m.name === item.name);
            if (idx >= 0) {
              merged[idx] = item; // override wins
            } else {
              merged.push(item);
            }
          }
          result[key] = merged;
        } else {
          result[key] = [...bVal, ...oVal];
        }
      } else if (bVal !== null && typeof bVal === "object" && !Array.isArray(bVal) &&
                 oVal !== null && typeof oVal === "object" && !Array.isArray(oVal)) {
        result[key] = deepMerge(bVal, oVal);
      } else {
        result[key] = oVal;
      }
    } else {
      if (bVal !== undefined) result[key] = bVal;
    }
  }

  return result;
}

/**
 * Read a JSON file, returning an empty object if it doesn't exist or is invalid.
 *
 * @param {string} filePath
 * @returns {object}
 */
function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

/**
 * Write a JSON file with consistent formatting.
 *
 * @param {string} filePath
 * @param {object} data
 */
function writeJSON(filePath, data) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Parse a .env file into a key-value map.  Lines starting with # or empty
 * lines are skipped.
 *
 * @param {string} content
 * @returns {Object<string, string>}
 */
function parseEnvContent(content) {
  const vars = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key) vars[key] = value;
    }
  }
  return vars;
}

/**
 * Serialize a key-value map back to .env content, sorted by key.
 *
 * @param {Object<string, string>} vars
 * @returns {string}
 */
function serializeEnvContent(vars) {
  const keys = Object.keys(vars).sort();
  const lines = [];
  for (const key of keys) {
    lines.push(`${key}=${vars[key]}`);
  }
  return lines.join("\n") + "\n";
}

// ── ProjectCustomizer ────────────────────────────────────────────────────────

class ProjectCustomizer {
  /**
   * Create a new customizer.  All operations are queued and applied when
   * customize() is called.
   *
   * @param {object} [options]
   * @param {string} [options.packageManager="npm"]  — "npm" | "yarn" | "pnpm" | "pip" | "cargo"
   */
  constructor(options = {}) {
    /** @type {string} */
    this._packageManager = options.packageManager || "npm";

    /** @type {Array<{ name: string, version: string }>} */
    this._depsToAdd = [];

    /** @type {Array<{ name: string, version: string }>} */
    this._devDepsToAdd = [];

    /** @type {Array<{ name: string, command: string }>} */
    this._scriptsToAdd = [];

    /** @type {Array<{ tool: string, config: object }>} */
    this._toolsToConfig = [];

    /** @type {Array<{ key: string, value: string }>} */
    this._envVarsToSet = [];
  }

  // ---------------------------------------------------------------------------
  // addDependency(name, version)
  // ---------------------------------------------------------------------------

  /**
   * Queue an npm/pip/cargo dependency to add.
   *
   * @param {string} name     — package name
   * @param {string} version  — version specifier (e.g. "^1.0.0", ">=2.0")
   * @returns {this}
   */
  addDependency(name, version) {
    if (!name || typeof name !== "string") {
      throw new TypeError("ProjectCustomizer.addDependency: name must be a non-empty string");
    }
    if (!version || typeof version !== "string") {
      throw new TypeError("ProjectCustomizer.addDependency: version must be a non-empty string");
    }
    this._depsToAdd.push({ name, version });
    return this;
  }

  // ---------------------------------------------------------------------------
  // addDevDependency(name, version)
  // ---------------------------------------------------------------------------

  /**
   * Queue a devDependency to add.
   *
   * @param {string} name
   * @param {string} version
   * @returns {this}
   */
  addDevDependency(name, version) {
    if (!name || typeof name !== "string") {
      throw new TypeError("ProjectCustomizer.addDevDependency: name must be a non-empty string");
    }
    if (!version || typeof version !== "string") {
      throw new TypeError("ProjectCustomizer.addDevDependency: version must be a non-empty string");
    }
    this._devDepsToAdd.push({ name, version });
    return this;
  }

  // ---------------------------------------------------------------------------
  // addScript(name, command)
  // ---------------------------------------------------------------------------

  /**
   * Queue a package.json script to add.
   *
   * @param {string} name     — script name (e.g. "deploy")
   * @param {string} command  — script command (e.g. "node deploy.js")
   * @returns {this}
   */
  addScript(name, command) {
    if (!name || typeof name !== "string") {
      throw new TypeError("ProjectCustomizer.addScript: name must be a non-empty string");
    }
    if (!command || typeof command !== "string") {
      throw new TypeError("ProjectCustomizer.addScript: command must be a non-empty string");
    }
    this._scriptsToAdd.push({ name, command });
    return this;
  }

  // ---------------------------------------------------------------------------
  // configureTool(tool, config)
  // ---------------------------------------------------------------------------

  /**
   * Queue a tool configuration override.  Supported tools:
   *   - "eslint"   -> .eslintrc.json
   *   - "jest"     -> jest.config.js (can only add/replace top-level keys)
   *   - "tsconfig" -> tsconfig.json
   *   - "prettier" -> .prettierrc
   *   - "custom-<filename>" -> any JSON file
   *
   * @param {string} tool   — tool identifier
   * @param {object} config — configuration to deep-merge into the tool's file
   * @returns {this}
   */
  configureTool(tool, config) {
    if (!tool || typeof tool !== "string") {
      throw new TypeError("ProjectCustomizer.configureTool: tool must be a non-empty string");
    }
    if (!config || typeof config !== "object") {
      throw new TypeError("ProjectCustomizer.configureTool: config must be an object");
    }
    this._toolsToConfig.push({ tool, config });
    return this;
  }

  // ---------------------------------------------------------------------------
  // setEnvVar(key, value)
  // ---------------------------------------------------------------------------

  /**
   * Queue an environment variable to set in .env.
   *
   * @param {string} key
   * @param {string} value
   * @returns {this}
   */
  setEnvVar(key, value) {
    if (!key || typeof key !== "string") {
      throw new TypeError("ProjectCustomizer.setEnvVar: key must be a non-empty string");
    }
    this._envVarsToSet.push({ key, value: String(value) });
    return this;
  }

  // ---------------------------------------------------------------------------
  // mergeConfig(base, override)
  // ---------------------------------------------------------------------------

  /**
   * Deep-merge two configuration objects.  This is a public utility method
   * exposed for external use or testing.
   *
   * @param {object} base
   * @param {object} override
   * @returns {object}
   */
  mergeConfig(base, override) {
    return deepMerge(base, override);
  }

  // ---------------------------------------------------------------------------
  // customize(projectDir, options)
  // ---------------------------------------------------------------------------

  /**
   * Apply all queued customizations to the project at `projectDir`.
   * This modifies files on disk in-place.
   *
   * Callers should pass the `projectDir` returned by compose().
   *
   * @param {string} projectDir    — absolute path to the project directory
   * @param {object} [options]     — additional overrides
   * @returns {{ modified: string[], scriptsAdded: string[], depsAdded: string[], devDepsAdded: string[] }}
   */
  customize(projectDir, options = {}) {
    if (!projectDir || typeof projectDir !== "string") {
      throw new TypeError("ProjectCustomizer.customize: projectDir must be a non-empty string");
    }

    // Ensure projectDir exists
    if (!fs.existsSync(projectDir)) {
      throw new Error(`ProjectCustomizer.customize: project directory does not exist: "${projectDir}"`);
    }

    const modified = [];
    const scriptsAdded = [];
    const depsAdded = [];
    const devDepsAdded = [];

    // ── Apply package.json changes ─────────────────────────────────────────

    const pkgPath = path.join(projectDir, "package.json");
    if (this._depsToAdd.length > 0 || this._devDepsToAdd.length > 0 || this._scriptsToAdd.length > 0) {
      const pkg = readJSON(pkgPath);

      if (this._depsToAdd.length > 0) {
        pkg.dependencies = pkg.dependencies || {};
        for (const d of this._depsToAdd) {
          pkg.dependencies[d.name] = d.version;
          depsAdded.push(`${d.name}@${d.version}`);
        }
      }

      if (this._devDepsToAdd.length > 0) {
        pkg.devDependencies = pkg.devDependencies || {};
        for (const d of this._devDepsToAdd) {
          pkg.devDependencies[d.name] = d.version;
          devDepsAdded.push(`${d.name}@${d.version}`);
        }
      }

      if (this._scriptsToAdd.length > 0) {
        pkg.scripts = pkg.scripts || {};
        for (const s of this._scriptsToAdd) {
          pkg.scripts[s.name] = s.command;
          scriptsAdded.push(`${s.name}: ${s.command}`);
        }
      }

      writeJSON(pkgPath, pkg);
      modified.push("package.json");
    }

    // ── Apply tool configurations ──────────────────────────────────────────

    const toolFileMap = {
      eslint: ".eslintrc.json",
      tsconfig: "tsconfig.json",
      prettier: ".prettierrc",
    };

    for (const { tool, config } of this._toolsToConfig) {
      let toolPath;

      if (tool.startsWith("custom-")) {
        toolPath = path.join(projectDir, tool.slice(7));
      } else if (toolFileMap[tool]) {
        toolPath = path.join(projectDir, toolFileMap[tool]);
      } else {
        // Unknown tool — skip
        continue;
      }

      const existing = readJSON(toolPath);
      const merged = deepMerge(existing, config);
      writeJSON(toolPath, merged);
      modified.push(path.basename(toolPath));
    }

    // ── Apply .env changes ────────────────────────────────────────────────

    if (this._envVarsToSet.length > 0) {
      const envPath = path.join(projectDir, ".env");
      let envVars = {};

      if (fs.existsSync(envPath)) {
        const raw = fs.readFileSync(envPath, "utf-8");
        envVars = parseEnvContent(raw);
      }

      for (const { key, value } of this._envVarsToSet) {
        envVars[key] = value;
      }

      fs.writeFileSync(envPath, serializeEnvContent(envVars), "utf-8");
      modified.push(".env");
    }

    // ── Apply any extra file overrides from options ────────────────────────

    if (options.files && typeof options.files === "object") {
      for (const [fp, content] of Object.entries(options.files)) {
        const absPath = path.join(projectDir, fp);
        const parent = path.dirname(absPath);
        fs.mkdirSync(parent, { recursive: true });
        fs.writeFileSync(absPath, String(content), "utf-8");
        modified.push(fp);
      }
    }

    return { modified, scriptsAdded, depsAdded, devDepsAdded };
  }

  // ---------------------------------------------------------------------------
  // reset()
  // ---------------------------------------------------------------------------

  /**
   * Clear all queued customizations.
   *
   * @returns {this}
   */
  reset() {
    this._depsToAdd = [];
    this._devDepsToAdd = [];
    this._scriptsToAdd = [];
    this._toolsToConfig = [];
    this._envVarsToSet = [];
    return this;
  }

  // ---------------------------------------------------------------------------
  // Accessors for testing / inspection
  // ---------------------------------------------------------------------------

  /** @returns {number} */
  get pendingDeps() { return this._depsToAdd.length; }

  /** @returns {number} */
  get pendingDevDeps() { return this._devDepsToAdd.length; }

  /** @returns {number} */
  get pendingScripts() { return this._scriptsToAdd.length; }

  /** @returns {number} */
  get pendingTools() { return this._toolsToConfig.length; }

  /** @returns {number} */
  get pendingEnvVars() { return this._envVarsToSet.length; }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  ProjectCustomizer,
  deepMerge,
  readJSON,
  writeJSON,
  parseEnvContent,
  serializeEnvContent,
};
