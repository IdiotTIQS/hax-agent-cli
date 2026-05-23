"use strict";

// ---------------------------------------------------------------------------
// VirtualEnv — detect, create, activate, and interrogate virtual/container
// environments for reproducible agent execution.
// ---------------------------------------------------------------------------

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// -- Constants ---------------------------------------------------------------

const ENV_TYPES = Object.freeze({
  NODE: "NODE",
  PYTHON: "PYTHON",
  DOCKER: "DOCKER",
  NIX: "NIX",
});

const VENV_INDICATOR_FILES = [".venv", "venv", "pyvenv.cfg"];
const CONDA_INDICATOR_DIRS = ["conda-meta"];
const CONDA_INDICATOR_FILES = ["environment.yml", "environment.yaml"];
const NVM_INDICATOR_FILES = [".nvmrc", ".node-version"];
const DOCKER_INDICATOR_FILES = [
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  ".dockerignore",
];
const DOCKER_RUNTIME_INDICATORS = ["/.dockerenv"];
const NIX_INDICATOR_FILES = [
  "flake.nix",
  "shell.nix",
  "default.nix",
  "flake.lock",
];

// -- Error class -------------------------------------------------------------

class VirtualEnvError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "VirtualEnvError";
    this.code = code;
    this.details = details || {};
  }
}

// -- Helpers -----------------------------------------------------------------

/**
 * Check whether a file or directory exists at the given path.
 * @param {string} p
 * @returns {boolean}
 */
function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Given a `root` directory, walk it looking for a candidate file or directory
 * whose basename matches an item in `candidates`. Returns the full path of the
 * first match or null.
 *
 * @param {string} root
 * @param {string[]} candidates
 * @returns {string|null}
 */
function findIndicator(root, candidates) {
  for (const candidate of candidates) {
    const full = path.join(root, candidate);
    if (exists(full)) return full;
  }
  return null;
}

/**
 * Walk up from `startDir` until a candidate is found or the filesystem root
 * is reached. Returns the matching path or null.
 *
 * @param {string} startDir
 * @param {string[]} candidates
 * @returns {string|null}
 */
function findUp(startDir, candidates) {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    const match = findIndicator(dir, candidates);
    if (match) return match;
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Try to extract a version string by running `command` with `args`.
 * Returns the trimmed stdout of the first line, or null on failure.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {string|null}
 */
function getVersion(command, args = ["--version"]) {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      return result.stdout.trim().split(/\r?\n/)[0];
    }
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Filter out sensitive env vars (tokens, keys, secrets).
 */
function isSensitiveEnvVar(name) {
  const upper = name.toUpperCase();
  return (
    upper.includes("TOKEN") ||
    upper.includes("SECRET") ||
    upper.includes("KEY") ||
    upper.includes("PASSWORD") ||
    upper.includes("PASSPHRASE") ||
    upper.includes("CREDENTIAL")
  );
}

/**
 * List globally installed npm packages by parsing `npm ls -g --depth=0 --json`.
 * Returns a simplified array of { name, version } or null on failure.
 */
function getNpmGlobalPackages() {
  try {
    const result = spawnSync("npm", ["ls", "-g", "--depth=0", "--json"], {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      const parsed = JSON.parse(result.stdout);
      const deps = parsed.dependencies || {};
      return Object.entries(deps).map(([name, info]) => ({
        name,
        version: info.version || "unknown",
      }));
    }
    return [];
  } catch (_) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// VirtualEnv class
// ---------------------------------------------------------------------------

class VirtualEnv {
  /**
   * @param {object} [options]
   * @param {boolean} [options.autoDetect=true] — run detection on construction
   */
  constructor(options = {}) {
    this._types = ENV_TYPES;
    this._originalEnv = null;
    this._activeEnv = null;
    this._autoDetect = options.autoDetect !== false;
  }

  /**
   * Detect a virtual environment starting from the given root directory.
   * Supports VENV, CONDA, NVM, DOCKER, and NIX types.
   *
   * @param {string} [root] — directory to search from (default: process.cwd())
   * @returns {{ type: string, path: string|null, name: string|null, detected: boolean, indicators: string[] }}
   */
  detect(root = process.cwd()) {
    const resolved = path.resolve(root);
    const indicators = [];

    // 1. Check environment variable hints
    if (process.env.CONDA_PREFIX || process.env.CONDA_DEFAULT_ENV) {
      indicators.push("CONDA_PREFIX=" + (process.env.CONDA_PREFIX || ""));
      return {
        type: this._types.PYTHON,
        path: process.env.CONDA_PREFIX || resolved,
        name: process.env.CONDA_DEFAULT_ENV || "base",
        detected: true,
        runtime: "conda",
        indicators,
      };
    }

    if (process.env.VIRTUAL_ENV) {
      indicators.push("VIRTUAL_ENV=" + process.env.VIRTUAL_ENV);
      return {
        type: this._types.PYTHON,
        path: process.env.VIRTUAL_ENV,
        name: path.basename(process.env.VIRTUAL_ENV),
        detected: true,
        runtime: "venv",
        indicators,
      };
    }

    if (process.env.NVM_DIR || process.env.NVM_BIN) {
      indicators.push(
        "NVM_DIR=" + (process.env.NVM_DIR || process.env.NVM_BIN || "")
      );
      return {
        type: this._types.NODE,
        path: process.env.NVM_DIR || resolved,
        name: process.env.NVM_DIR
          ? path.basename(process.env.NVM_DIR)
          : "nvm",
        detected: true,
        runtime: "nvm",
        indicators,
      };
    }

    // 2. Check filesystem indicators — exact directory first (higher priority),
    //    then walk up the tree so that files placed directly in the requested
    //    directory take precedence over ancestor indicators.

    // -- Docker (exact dir)
    let dockerMatch = findIndicator(resolved, DOCKER_INDICATOR_FILES);
    if (dockerMatch) {
      indicators.push(dockerMatch);
      return {
        type: this._types.DOCKER,
        path: dockerMatch,
        name: path.basename(dockerMatch),
        detected: true,
        runtime: "docker",
        indicators,
      };
    }

    // -- Nix (exact dir)
    let nixMatch = findIndicator(resolved, NIX_INDICATOR_FILES);
    if (nixMatch) {
      indicators.push(nixMatch);
      return {
        type: this._types.NIX,
        path: nixMatch,
        name: path.basename(nixMatch),
        detected: true,
        runtime: "nix",
        indicators,
      };
    }

    // -- Node nvm (exact dir)
    let nvmMatch = findIndicator(resolved, NVM_INDICATOR_FILES);
    if (nvmMatch) {
      let nodeVersion = null;
      try {
        nodeVersion = fs.readFileSync(nvmMatch, "utf8").trim();
      } catch (_) { /* ignore */ }
      indicators.push(nvmMatch);
      return {
        type: this._types.NODE,
        path: nvmMatch,
        name: nodeVersion ? `node@${nodeVersion}` : "node",
        detected: true,
        runtime: "nvm",
        nodeVersion,
        indicators,
      };
    }

    // -- Python venv (exact dir)
    let venvMatch = findIndicator(resolved, VENV_INDICATOR_FILES);
    if (venvMatch) {
      const venvDir = path.basename(venvMatch) === "pyvenv.cfg"
        ? path.dirname(venvMatch)
        : venvMatch;
      indicators.push(venvMatch);
      return {
        type: this._types.PYTHON,
        path: venvDir,
        name: path.basename(venvDir),
        detected: true,
        runtime: "venv",
        indicators,
      };
    }

    // -- Python conda (exact dir)
    let condaDirMatch = findIndicator(resolved, CONDA_INDICATOR_DIRS);
    let condaFileMatch = findIndicator(resolved, CONDA_INDICATOR_FILES);
    if (condaDirMatch || condaFileMatch) {
      indicators.push(condaDirMatch || condaFileMatch);
      return {
        type: this._types.PYTHON,
        path: condaDirMatch
          ? path.dirname(condaDirMatch)
          : path.dirname(condaFileMatch),
        name: condaDirMatch
          ? path.basename(path.dirname(condaDirMatch))
          : "conda",
        detected: true,
        runtime: "conda",
        indicators,
      };
    }

    // 3. Walk up the directory tree for ancestor indicators (lower priority)
    // -- Python venv (ancestor)
    venvMatch = findUp(resolved, VENV_INDICATOR_FILES);
    if (venvMatch) {
      const venvDir = path.basename(venvMatch) === "pyvenv.cfg"
        ? path.dirname(venvMatch)
        : venvMatch;
      indicators.push(venvMatch);
      return {
        type: this._types.PYTHON,
        path: venvDir,
        name: path.basename(venvDir),
        detected: true,
        runtime: "venv",
        indicators,
      };
    }

    // -- Python conda (ancestor)
    condaDirMatch = findUp(resolved, CONDA_INDICATOR_DIRS);
    condaFileMatch = findUp(resolved, CONDA_INDICATOR_FILES);
    if (condaDirMatch || condaFileMatch) {
      indicators.push(condaDirMatch || condaFileMatch);
      return {
        type: this._types.PYTHON,
        path: condaDirMatch
          ? path.dirname(condaDirMatch)
          : path.dirname(condaFileMatch),
        name: condaDirMatch
          ? path.basename(path.dirname(condaDirMatch))
          : "conda",
        detected: true,
        runtime: "conda",
        indicators,
      };
    }

    // -- Node nvm (ancestor)
    nvmMatch = findUp(resolved, NVM_INDICATOR_FILES);
    if (nvmMatch) {
      let nodeVersion = null;
      try {
        nodeVersion = fs.readFileSync(nvmMatch, "utf8").trim();
      } catch (_) { /* ignore */ }
      indicators.push(nvmMatch);
      return {
        type: this._types.NODE,
        path: nvmMatch,
        name: nodeVersion ? `node@${nodeVersion}` : "node",
        detected: true,
        runtime: "nvm",
        nodeVersion,
        indicators,
      };
    }

    // -- Docker (ancestor)
    dockerMatch = findUp(resolved, DOCKER_INDICATOR_FILES);
    if (dockerMatch) {
      indicators.push(dockerMatch);
      return {
        type: this._types.DOCKER,
        path: dockerMatch,
        name: path.basename(dockerMatch),
        detected: true,
        runtime: "docker",
        indicators,
      };
    }

    // Check for running inside Docker
    for (const ind of DOCKER_RUNTIME_INDICATORS) {
      if (exists(ind)) {
        indicators.push(ind);
        return {
          type: this._types.DOCKER,
          path: ind,
          name: "docker-container",
          detected: true,
          runtime: "docker",
          insideContainer: true,
          indicators,
        };
      }
    }

    // -- Nix (ancestor)
    nixMatch = findUp(resolved, NIX_INDICATOR_FILES);
    if (nixMatch) {
      indicators.push(nixMatch);
      return {
        type: this._types.NIX,
        path: nixMatch,
        name: path.basename(nixMatch),
        detected: true,
        runtime: "nix",
        indicators,
      };
    }

    // 3. No environment detected
    return {
      type: null,
      path: null,
      name: null,
      detected: false,
      runtime: null,
      indicators: [],
    };
  }

  /**
   * Create a new virtual environment of the given type.
   *
   * @param {string} type — one of NODE, PYTHON, DOCKER, NIX
   * @param {object} [options]
   * @param {string} [options.path] — where to create the environment
   * @param {string} [options.name] — environment name
   * @param {string} [options.pythonVersion] — Python version (for PYTHON type)
   * @param {string} [options.nodeVersion] — Node version (for NODE type)
   * @param {string} [options.baseImage] — Docker base image (for DOCKER type)
   * @param {string[]} [options.packages] — packages to preinstall
   * @returns {{ type: string, path: string, name: string, created: boolean, commands: string[] }}
   */
  create(type, options = {}) {
    const norm = type.toUpperCase();
    if (!ENV_TYPES[norm]) {
      throw new VirtualEnvError(
        "VENV_INVALID_TYPE",
        `Unknown environment type: ${type}. Valid types: ${Object.keys(ENV_TYPES).join(", ")}`,
        { type },
      );
    }

    const envPath = options.path
      ? path.resolve(options.path)
      : path.join(process.cwd(), `.hax-${norm.toLowerCase()}-env`);

    const name = options.name || path.basename(envPath);
    const commands = [];

    switch (norm) {
      case "PYTHON": {
        const pyVersion = options.pythonVersion || "3";
        // Prefer venv over virtualenv (stdlib since 3.3)
        commands.push(
          `python${pyVersion} -m venv ${escapeArg(envPath)}`,
        );
        if (options.packages && options.packages.length > 0) {
          const pip = path.join(
            envPath,
            process.platform === "win32" ? "Scripts\\pip.exe" : "bin/pip",
          );
          commands.push(
            `${escapeArg(pip)} install ${options.packages.map(escapeArg).join(" ")}`,
          );
        }
        break;
      }

      case "NODE": {
        const nodeVersion = options.nodeVersion || process.versions.node;
        commands.push(`nvm install ${nodeVersion}`);
        commands.push(`nvm alias ${name} ${nodeVersion}`);
        commands.push(`nvm use ${name}`);
        if (options.packages && options.packages.length > 0) {
          commands.push(
            `npm install -g ${options.packages.map(escapeArg).join(" ")}`,
          );
        }
        break;
      }

      case "DOCKER": {
        const image = options.baseImage || "node:18-alpine";
        const pkg = (options.packages || [])
          .map((p) => `RUN npm install -g ${p}`)
          .join("\n");
        const dockerfilePath = path.join(envPath, "Dockerfile");
        commands.push(
          `mkdir -p ${escapeArg(envPath)}`,
        );
        commands.push(`docker build -t ${name} -f ${escapeArg(dockerfilePath)} .`);
        break;
      }

      case "NIX": {
        commands.push(
          `mkdir -p ${escapeArg(envPath)}`,
        );
        commands.push(`cd ${escapeArg(envPath)} && nix flake init`);
        break;
      }

      default:
        throw new VirtualEnvError(
          "VENV_NOT_IMPLEMENTED",
          `Environment type creation not implemented: ${norm}`,
          { type: norm },
        );
    }

    return {
      type: norm,
      path: envPath,
      name,
      created: true,
      commands,
    };
  }

  /**
   * Prepare environment variables for the given environment info object.
   * Stores the original environment so it can be restored later.
   *
   * @param {object} env — environment descriptor (as returned by detect or create)
   * @returns {{ env: object, originalEnv: object, activated: boolean }}
   */
  activate(env) {
    if (!env || !env.type) {
      throw new VirtualEnvError(
        "VENV_INVALID_ENV",
        "Cannot activate: invalid or missing environment descriptor",
        { env },
      );
    }

    // Save original state before mutating
    if (!this._originalEnv) {
      this._originalEnv = {
        PATH: process.env.PATH,
        VIRTUAL_ENV: process.env.VIRTUAL_ENV,
        CONDA_PREFIX: process.env.CONDA_PREFIX,
        CONDA_DEFAULT_ENV: process.env.CONDA_DEFAULT_ENV,
        NVM_DIR: process.env.NVM_DIR,
        NVM_BIN: process.env.NVM_BIN,
        NODE_PATH: process.env.NODE_PATH,
        PYTHONPATH: process.env.PYTHONPATH,
        PIP_REQUIRE_VIRTUALENV: process.env.PIP_REQUIRE_VIRTUALENV,
      };
    }

    const newEnv = { ...process.env };

    switch (env.type) {
      case "PYTHON": {
        if (env.path) {
          newEnv.VIRTUAL_ENV = env.path;
          const binDir = process.platform === "win32"
            ? path.join(env.path, "Scripts")
            : path.join(env.path, "bin");
          newEnv.PATH = binDir + path.delimiter + (newEnv.PATH || "");
        }
        break;
      }

      case "NODE": {
        if (env.path) {
          newEnv.NVM_DIR = env.path;
          newEnv.NVM_BIN = env.path;
          newEnv.PATH = env.path + path.delimiter + (newEnv.PATH || "");
        }
        break;
      }

      case "DOCKER": {
        // Docker activation is informational — set markers
        newEnv.HAX_DOCKER_ENV = env.name || "true";
        newEnv.HAX_ENV_TYPE = "DOCKER";
        break;
      }

      case "NIX": {
        if (env.path) {
          newEnv.NIX_PATH = env.path;
          newEnv.HAX_ENV_TYPE = "NIX";
        }
        break;
      }

      default:
        break;
    }

    newEnv.HAX_ENV_ACTIVE = "true";
    this._activeEnv = env;

    return {
      env: newEnv,
      originalEnv: this._originalEnv,
      activated: true,
    };
  }

  /**
   * Restore the original environment variables that were saved on activation.
   * @returns {{ restored: boolean, originalEnv: object|null }}
   */
  deactivate() {
    if (!this._originalEnv) {
      return { restored: false, originalEnv: null };
    }

    // Restore original vars to process.env
    const original = this._originalEnv;
    const keys = Object.keys(original);
    for (const key of keys) {
      if (original[key] !== undefined) {
        process.env[key] = original[key];
      } else {
        delete process.env[key];
      }
    }

    delete process.env.HAX_ENV_ACTIVE;
    delete process.env.HAX_ENV_TYPE;
    delete process.env.HAX_DOCKER_ENV;

    this._originalEnv = null;
    this._activeEnv = null;

    return { restored: true, originalEnv: original };
  }

  /**
   * Return metadata about an environment.
   *
   * @param {object} env — environment descriptor (from detect or create)
   * @returns {{ type: string, path: string|null, name: string|null, runtime: string|null, os: string, arch: string, nodeVersion: string, pythonVersion: string|null, insideContainer: boolean, detected: boolean }}
   */
  getInfo(env) {
    // If the caller provided an env descriptor with type info, use it directly.
    // Otherwise, auto-detect from the given path (or cwd).
    const hasExplicitType = env && env.type && env.path;

    const detected = hasExplicitType
      ? env
      : (this._autoDetect ? this.detect((env && env.path) || process.cwd()) : (env || {}));

    const info = {
      type: (detected && detected.type) || null,
      path: (detected && detected.path) || null,
      name: (detected && detected.name) || null,
      runtime: (detected && detected.runtime) || null,
      os: os.platform(),
      arch: os.arch(),
      nodeVersion: process.versions.node,
      pythonVersion: getVersion("python3") || getVersion("python") || null,
      insideContainer: (detected && detected.insideContainer) || false,
      detected: (detected && detected.detected) || hasExplicitType || false,
      hostname: os.hostname(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      indicators: (detected && detected.indicators) || [],
    };

    return info;
  }

  /**
   * Check whether the current process is running in an isolated environment.
   *
   * Heuristics include:
   *  - The HAX_ENV_ACTIVE env variable
   *  - Presence of /.dockerenv
   *  - Running inside a recognised virtualenv/conda prefix
   *
   * @returns {boolean}
   */
  isIsolated() {
    // Our own marker
    if (process.env.HAX_ENV_ACTIVE === "true") return true;

    // Docker container indicator
    if (exists("/.dockerenv")) return true;

    // Check /proc/1/cgroup on Linux for docker/container indicators
    if (process.platform === "linux") {
      try {
        const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
        if (
          cgroup.includes("docker") ||
          cgroup.includes("kubepods") ||
          cgroup.includes("containerd") ||
          cgroup.includes("lxc")
        ) {
          return true;
        }
      } catch (_) { /* not available */ }
    }

    // Python virtualenv
    if (process.env.VIRTUAL_ENV && exists(process.env.VIRTUAL_ENV)) return true;

    // Conda
    if (process.env.CONDA_PREFIX && exists(process.env.CONDA_PREFIX)) return true;

    // Nix
    if (process.env.IN_NIX_SHELL || process.env.NIX_BUILD_TOP) return true;

    return false;
  }
}

// -- Private helpers ---------------------------------------------------------

function escapeArg(arg) {
  if (process.platform === "win32") {
    // Basic Windows argument quoting
    if (/[\s"]/.test(arg)) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
  }
  // POSIX single-quote escaping (replace ' with '\'')
  if (/[\s'$"\\]/.test(arg)) {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
  return arg;
}

// ---------------------------------------------------------------------------

module.exports = { VirtualEnv, VirtualEnvError, ENV_TYPES };
