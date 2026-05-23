"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isWindows, isMacOS } = require("./detect");

// ---------------------------------------------------------------------------
// Env-var expansion
// ---------------------------------------------------------------------------

/**
 * Expand environment variable references in a string.
 *
 * Supports both POSIX (`$VAR`, `${VAR}`) and Windows (`%VAR%`) syntax.
 * Unknown variables are left untouched.  Nested lookups are NOT supported.
 *
 * @param {string} text
 * @param {object} [env=process.env] — environment dictionary to resolve against
 * @returns {string}
 */
function expandEnvVars(text, env = process.env) {
  if (typeof text !== "string" || text.length === 0) return text;

  let result = text;

  // Expand ${VAR} and $VAR (POSIX) — longest match first.
  result = result.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, name) => {
    return name in env ? String(env[name]) : `\${${name}}`;
  });

  result = result.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    return name in env ? String(env[name]) : `$${name}`;
  });

  // Expand %VAR% (Windows) — only when on Windows or text contains % delimiters.
  if (isWindows() || text.includes("%")) {
    result = result.replace(/%([a-zA-Z_][a-zA-Z0-9_]*)%/g, (_, name) => {
      return name in env ? String(env[name]) : `%${name}%`;
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// PATH inspection
// ---------------------------------------------------------------------------

/**
 * Return the system PATH as an array of normalised directories.
 *
 * Uses the platform-appropriate delimiter: `;` on Windows, `:` on Unix.
 *
 * @param {object} [env=process.env] — environment to read PATH from
 * @returns {string[]}
 */
function getEnvPaths(env = process.env) {
  const raw = env.PATH || env.Path || env.path || "";
  if (typeof raw !== "string") return [];

  return raw
    .split(path.delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean)
    .map((dir) => path.normalize(dir));
}

/**
 * Search the system PATH for an executable by name.
 *
 * On Windows also checks the common executable extensions (`.exe`, `.cmd`, `.bat`,
 * `.com`) automatically if the name does not already include an extension.
 *
 * @param {string} name — executable name (e.g. `"node"`, `"python"`)
 * @param {object} [options]
 * @param {object} [options.env=process.env] — environment for PATH lookup
 * @returns {string|null} — full path to the executable, or null if not found
 */
function findExecutable(name, options = {}) {
  if (typeof name !== "string" || name.length === 0) return null;

  const env = options.env || process.env;
  const dirs = getEnvPaths(env);
  const hasExt = path.extname(name).length > 0;

  // On Windows, try known extensions when not already specified.
  const extensions = isWindows() && !hasExt
    ? [".exe", ".cmd", ".bat", ".com", ""]
    : [""];

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext);
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) return candidate;
      } catch (_) { /* not found */ }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Default editors / browsers
// ---------------------------------------------------------------------------

/**
 * Return the default text editor command for the current platform.
 *
 * Order of precedence:
 *   1. `EDITOR` environment variable
 *   2. `VISUAL` environment variable
 *   3. Platform default:
 *      - Windows: `notepad.exe`
 *      - macOS:   `open -t`
 *      - Linux:   `nano` (or `vi` as ultimate fallback)
 *
 * @returns {string} — the editor command (may include arguments)
 */
function getEditor() {
  if (process.env.EDITOR) return process.env.EDITOR;
  if (process.env.VISUAL) return process.env.VISUAL;

  if (isWindows()) return "notepad.exe";
  if (isMacOS()) return "open -t";
  return "nano";
}

/**
 * Return the default browser command for the current platform.
 *
 * Order of precedence:
 *   1. `BROWSER` environment variable
 *   2. Platform default:
 *      - Windows: `start`
 *      - macOS:   `open`
 *      - Linux:   `xdg-open`
 *      - Other:   `xdg-open`
 *
 * @returns {string}
 */
function getBrowser() {
  if (process.env.BROWSER) return process.env.BROWSER;

  if (isWindows()) return "start";
  if (isMacOS()) return "open";
  return "xdg-open";
}

// ---------------------------------------------------------------------------
// Environment-override resolution (HAX_AGENT_* shadow layer)
// ---------------------------------------------------------------------------

/**
 * Apply `HAX_AGENT_*` environment variables on top of a settings object.
 *
 * This mirrors the config-override logic in `src/config.js` and is intended
 * for use when the full config machinery is unavailable or when multiple
 * layers at runtime need a single canonical resolution.
 *
 * Supported keys (subset — extend as needed):
 *   HAX_AGENT_PROVIDER           → agent.provider
 *   HAX_AGENT_MODEL              → agent.model
 *   HAX_AGENT_API_KEY            → agent.apiKey
 *   HAX_AGENT_API_URL            → agent.apiUrl
 *   HAX_AGENT_MAX_TURNS          → agent.maxTurns
 *   HAX_AGENT_TEMPERATURE        → agent.temperature
 *   HAX_AGENT_MEMORY_ENABLED     → memory.enabled
 *   HAX_AGENT_SHELL_ENABLED      → tools.shell.enabled
 *   HAX_AGENT_SHELL_TIMEOUT_MS   → tools.shell.timeoutMs
 *   HAX_AGENT_SHELL_MAX_BUFFER   → tools.shell.maxBuffer
 *   HAX_AGENT_DEBUG              → debug (boolean)
 *   AI_PROVIDER                  → agent.provider (fallback)
 *   ANTHROPIC_API_KEY            → agent.apiKey (fallback)
 *   OPENAI_API_KEY               → agent.apiKey (fallback)
 *
 * @param {object} settings — base settings object
 * @param {object} [env=process.env] — environment to read overrides from
 * @returns {object} — new settings object with overrides applied
 */
function resolveEnvOverrides(settings = {}, env = process.env) {
  const overrides = {};

  // --- Agent ---
  const provider = env.HAX_AGENT_PROVIDER || env.AI_PROVIDER;
  if (provider) setNested(overrides, "agent.provider", provider);

  if (env.HAX_AGENT_MODEL) setNested(overrides, "agent.model", env.HAX_AGENT_MODEL);

  const apiKey = env.HAX_AGENT_API_KEY || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY;
  if (apiKey) setNested(overrides, "agent.apiKey", apiKey);

  if (env.HAX_AGENT_API_URL) setNested(overrides, "agent.apiUrl", env.HAX_AGENT_API_URL);

  if (env.HAX_AGENT_MAX_TURNS) {
    const val = parseInt(env.HAX_AGENT_MAX_TURNS, 10);
    if (Number.isFinite(val)) setNested(overrides, "agent.maxTurns", val);
  }

  if (env.HAX_AGENT_TEMPERATURE) {
    const val = parseFloat(env.HAX_AGENT_TEMPERATURE);
    if (Number.isFinite(val)) setNested(overrides, "agent.temperature", val);
  }

  // --- Tools shell ---
  if (env.HAX_AGENT_SHELL_ENABLED !== undefined) {
    setNested(overrides, "tools.shell.enabled", parseBool(env.HAX_AGENT_SHELL_ENABLED));
  }

  if (env.HAX_AGENT_SHELL_TIMEOUT_MS) {
    const val = parseInt(env.HAX_AGENT_SHELL_TIMEOUT_MS, 10);
    if (Number.isFinite(val)) setNested(overrides, "tools.shell.timeoutMs", val);
  }

  if (env.HAX_AGENT_SHELL_MAX_BUFFER) {
    const val = parseInt(env.HAX_AGENT_SHELL_MAX_BUFFER, 10);
    if (Number.isFinite(val)) setNested(overrides, "tools.shell.maxBuffer", val);
  }

  // --- Memory ---
  if (env.HAX_AGENT_MEMORY_ENABLED !== undefined) {
    setNested(overrides, "memory.enabled", parseBool(env.HAX_AGENT_MEMORY_ENABLED));
  }

  // --- Debug ---
  if (env.HAX_AGENT_DEBUG !== undefined) {
    setNested(overrides, "debug", parseBool(env.HAX_AGENT_DEBUG));
  }

  return deepMerge(settings, overrides);
}

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

/**
 * Perform light-weight environment checks and return a diagnostic report.
 *
 * @param {object} [options]
 * @param {object} [options.env=process.env] — environment to validate against
 * @returns {{ ok: boolean, warnings: string[], errors: string[] }}
 */
function validateEnv(options = {}) {
  const env = options.env || process.env;
  const errors = [];
  const warnings = [];

  // Node.js version
  const major = parseInt(process.version.slice(1).split(".")[0], 10);
  if (major < 18) {
    errors.push(`Node.js >= 18 required; found ${process.version}`);
  } else if (major < 20) {
    warnings.push(`Node.js ${process.version} is nearing end-of-life; consider upgrading to 20+`);
  }

  // Home directory
  try {
    const home = os.homedir();
    if (!home || home.trim() === "") {
      errors.push("Could not determine home directory");
    } else {
      try {
        fs.accessSync(home, fs.constants.R_OK);
      } catch (_) {
        warnings.push(`Home directory "${home}" is not readable`);
      }
    }
  } catch (_) {
    errors.push("Could not determine home directory");
  }

  // Temp directory
  try {
    const tmp = os.tmpdir();
    if (!tmp || tmp.trim() === "") {
      errors.push("Could not determine temp directory");
    }
  } catch (_) {
    errors.push("Could not determine temp directory");
  }

  // PATH
  const pathEntries = getEnvPaths(env);
  if (pathEntries.length === 0) {
    warnings.push("PATH environment variable is empty or not set");
  }

  // Platform-specific checks
  if (isWindows()) {
    // ComSpec or COMSPEC is typically required on Windows
    const comspec = env.ComSpec || env.COMSPEC;
    if (!comspec) {
      warnings.push("Neither ComSpec nor COMSPEC environment variable is set");
    }
  }

  return {
    ok: errors.length === 0,
    warnings,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Set a nested property using a dotted key path.
 *
 * @example setNested(obj, "a.b.c", 42) → obj.a.b.c === 42
 */
function setNested(obj, keyPath, value) {
  const keys = keyPath.split(".");
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
}

function deepMerge(base, overrides) {
  const result = { ...base };

  for (const key of Object.keys(overrides)) {
    const val = overrides[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val) && typeof result[key] === "object" && result[key] !== null && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], val);
    } else {
      result[key] = val;
    }
  }

  return result;
}

function parseBool(val) {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  const s = String(val).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  throw new TypeError(`"${val}" must be a boolean value (true/false, 1/0, yes/no, on/off)`);
}

module.exports = {
  expandEnvVars,
  getEnvPaths,
  findExecutable,
  getEditor,
  getBrowser,
  resolveEnvOverrides,
  validateEnv,
};
