"use strict";

// ---------------------------------------------------------------------------
// EnvironmentSnapshot — capture, persist, compare, and restore the full
// execution environment so agents can reproduce results deterministically.
// ---------------------------------------------------------------------------

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// -- Error class -------------------------------------------------------------

class SnapshotError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "SnapshotError";
    this.code = code;
    this.details = details || {};
  }
}

// -- Constants ---------------------------------------------------------------

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /key/i,
  /password/i,
  /passphrase/i,
  /credential/i,
  /auth/i,
  /cert/i,
  /pem/i,
  /private/i,
];

const DEFAULT_CAPTURE_OPTIONS = {
  captureEnvVars: true,
  capturePath: true,
  captureNodeVersion: true,
  captureNpmGlobal: true,
  captureNpmLocal: true,
  captureSystemInfo: true,
  capturePython: true,
  maskSensitive: true,
};

// -- Helpers -----------------------------------------------------------------

/**
 * Check whether an environment variable name looks sensitive.
 */
function isSensitive(name) {
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(name));
}

/**
 * Mask a value by replacing most characters with asterisks.
 */
function maskValue(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  if (value.length <= 6) return "***";
  return value.slice(0, 3) + "***" + value.slice(-3);
}

/**
 * Filter and optionally mask environment variables.
 */
function captureEnvVars(maskSensitive) {
  const vars = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue;
    if (maskSensitive && isSensitive(key)) {
      vars[key] = maskValue(val);
    } else {
      vars[key] = val;
    }
  }
  return vars;
}

/**
 * Capture the PATH as an array of directories.
 */
function capturePath() {
  return (process.env.PATH || "").split(path.delimiter).filter(Boolean);
}

/**
 * Try running `npm ls --json --depth=0` in the given cwd.
 * Returns an array of { name, version } objects.
 */
function captureNpmLocal(cwd) {
  try {
    const result = spawnSync("npm", ["ls", "--json", "--depth=0"], {
      cwd,
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      const parsed = JSON.parse(result.stdout);
      return flattenDeps(parsed.dependencies);
    }
    return [];
  } catch (_) {
    return [];
  }
}

function flattenDeps(deps) {
  if (!deps || typeof deps !== "object") return [];
  return Object.entries(deps).map(([name, info]) => ({
    name,
    version: info.version || "unknown",
  }));
}

/**
 * Try listing globally installed npm packages.
 */
function captureNpmGlobal() {
  try {
    const result = spawnSync("npm", ["ls", "-g", "--json", "--depth=0"], {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      const parsed = JSON.parse(result.stdout);
      return flattenDeps(parsed.dependencies);
    }
    return [];
  } catch (_) {
    return [];
  }
}

/**
 * Capture Python-related info.
 */
function capturePython() {
  let pythonVersion = null;
  let pipPackages = [];

  try {
    const ver = spawnSync(
      process.platform === "win32" ? "python" : "python3",
      ["--version"],
      { encoding: "utf8", timeout: 5_000, windowsHide: true },
    );
    if (ver.status === 0 && ver.stdout) {
      pythonVersion = ver.stdout.trim();
    }
  } catch (_) { /* no python */ }

  if (pythonVersion) {
    try {
      const pip = spawnSync(
        process.platform === "win32" ? "pip" : "pip3",
        ["list", "--format=json"],
        { encoding: "utf8", timeout: 10_000, windowsHide: true },
      );
      if (pip.status === 0 && pip.stdout) {
        const list = JSON.parse(pip.stdout);
        pipPackages = list.map((p) => ({ name: p.name, version: p.version }));
      }
    } catch (_) { /* pip failed */ }
  }

  return { pythonVersion, pipPackages };
}

// ---------------------------------------------------------------------------
// EnvironmentSnapshot class
// ---------------------------------------------------------------------------

class EnvironmentSnapshot {
  /**
   * @param {object} [data] — pre-existing snapshot data to restore from
   */
  constructor(data) {
    this._data = data || null;
  }

  /**
   * Capture the current environment state.
   *
   * @param {object} [options]
   * @param {boolean} [options.captureEnvVars=true]
   * @param {boolean} [options.capturePath=true]
   * @param {boolean} [options.captureNodeVersion=true]
   * @param {boolean} [options.captureNpmGlobal=true]
   * @param {boolean} [options.captureNpmLocal=true]
   * @param {boolean} [options.captureSystemInfo=true]
   * @param {boolean} [options.capturePython=true]
   * @param {boolean} [options.maskSensitive=true]
   * @param {string} [options.cwd] — directory for local npm scan (default: process.cwd())
   * @returns {object}
   */
  capture(options = {}) {
    const opts = { ...DEFAULT_CAPTURE_OPTIONS, ...options };
    const cwd = opts.cwd || process.cwd();

    const snapshot = {
      capturedAt: new Date().toISOString(),
      meta: {
        snapshotVersion: 1,
      },
    };

    // -- System info
    if (opts.captureSystemInfo) {
      snapshot.system = {
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        hostname: os.hostname(),
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        uptime: os.uptime(),
        homeDir: os.homedir(),
        tmpDir: os.tmpdir(),
        endianness: os.endianness(),
      };
    }

    // -- Node version
    if (opts.captureNodeVersion) {
      snapshot.node = {
        version: process.version,
        versions: { ...process.versions },
        execPath: process.execPath,
      };
    }

    // -- Environment variables
    if (opts.captureEnvVars) {
      snapshot.env = captureEnvVars(opts.maskSensitive);
    }

    // -- PATH
    if (opts.capturePath) {
      snapshot.path = capturePath();
    }

    // -- npm global packages
    if (opts.captureNpmGlobal) {
      snapshot.npmGlobal = captureNpmGlobal();
    }

    // -- npm local packages
    if (opts.captureNpmLocal) {
      snapshot.npmLocal = captureNpmLocal(cwd);
    }

    // -- Python
    if (opts.capturePython) {
      snapshot.python = capturePython();
    }

    this._data = snapshot;
    return snapshot;
  }

  /**
   * Compare two snapshots and return a detailed diff.
   *
   * @param {object} snapshotA — baseline snapshot
   * @param {object} snapshotB — current/new snapshot
   * @returns {object}
   */
  compare(snapshotA, snapshotB) {
    const a = snapshotA || {};
    const b = snapshotB || {};

    const diff = {
      identical: true,
      sections: {},
    };

    // -- System
    if (a.system && b.system) {
      const systemDiff = {};
      for (const key of Object.keys({ ...a.system, ...b.system })) {
        if (a.system[key] !== b.system[key]) {
          systemDiff[key] = { from: a.system[key], to: b.system[key] };
        }
      }
      diff.sections.system = systemDiff;
      if (Object.keys(systemDiff).length > 0) diff.identical = false;
    } else if (a.system || b.system) {
      diff.sections.system = { from: !!a.system, to: !!b.system };
      diff.identical = false;
    }

    // -- Node version
    if (a.node && b.node) {
      diff.sections.node = {};
      if (a.node.version !== b.node.version) {
        diff.sections.node.version = { from: a.node.version, to: b.node.version };
        diff.identical = false;
      }
    } else if (a.node || b.node) {
      diff.sections.node = { from: !!a.node, to: !!b.node };
      diff.identical = false;
    }

    // -- Env vars
    if (a.env && b.env) {
      diff.sections.env = diffEnvVars(a.env, b.env);
      if (
        diff.sections.env.added.length > 0 ||
        diff.sections.env.removed.length > 0 ||
        diff.sections.env.modified.length > 0
      ) {
        diff.identical = false;
      }
    }

    // -- PATH
    if (a.path && b.path) {
      const pathDiff = diffArrays(a.path, b.path);
      diff.sections.path = pathDiff;
      if (pathDiff.added.length > 0 || pathDiff.removed.length > 0) {
        diff.identical = false;
      }
    }

    // -- npm global packages
    if (a.npmGlobal && b.npmGlobal) {
      diff.sections.npmGlobal = diffPackages(a.npmGlobal, b.npmGlobal);
      if (
        diff.sections.npmGlobal.added.length > 0 ||
        diff.sections.npmGlobal.removed.length > 0 ||
        diff.sections.npmGlobal.modified.length > 0
      ) {
        diff.identical = false;
      }
    }

    // -- npm local packages
    if (a.npmLocal && b.npmLocal) {
      diff.sections.npmLocal = diffPackages(a.npmLocal, b.npmLocal);
      if (
        diff.sections.npmLocal.added.length > 0 ||
        diff.sections.npmLocal.removed.length > 0 ||
        diff.sections.npmLocal.modified.length > 0
      ) {
        diff.identical = false;
      }
    }

    // -- Python
    if (a.python && b.python) {
      diff.sections.python = {};
      if (a.python.pythonVersion !== b.python.pythonVersion) {
        diff.sections.python.pythonVersion = {
          from: a.python.pythonVersion,
          to: b.python.pythonVersion,
        };
        diff.identical = false;
      }
      diff.sections.python.pipPackages = diffPackages(
        a.python.pipPackages || [],
        b.python.pipPackages || [],
      );
      if (
        diff.sections.python.pipPackages.added.length > 0 ||
        diff.sections.python.pipPackages.removed.length > 0 ||
        diff.sections.python.pipPackages.modified.length > 0
      ) {
        diff.identical = false;
      }
    }

    return diff;
  }

  /**
   * Check whether the current environment has drifted from the snapshot
   * and return a list of warnings.
   *
   * @param {object} snapshot — a previously captured snapshot
   * @returns {{ drifted: boolean, warnings: string[], diff: object }}
   */
  restore(snapshot) {
    if (!snapshot) {
      throw new SnapshotError(
        "SNAPSHOT_INVALID",
        "Cannot restore from null or undefined snapshot",
      );
    }

    const current = this.capture();
    const diff = this.compare(snapshot, current);

    const warnings = [];
    const d = diff.sections;

    if (d.system && Object.keys(d.system).length > 0) {
      warnings.push(
        `System information has changed: ${Object.keys(d.system).join(", ")}`,
      );
    }

    if (d.node && d.node.version) {
      warnings.push(
        `Node version changed from ${d.node.version.from} to ${d.node.version.to}`,
      );
    }

    if (d.env) {
      if (d.env.added.length > 0) {
        warnings.push(
          `${d.env.added.length} environment variable(s) added: ${d.env.added.join(", ")}`,
        );
      }
      if (d.env.removed.length > 0) {
        warnings.push(
          `${d.env.removed.length} environment variable(s) removed: ${d.env.removed.join(", ")}`,
        );
      }
      if (d.env.modified.length > 0) {
        warnings.push(
          `${d.env.modified.length} environment variable(s) modified: ${d.env.modified.join(", ")}`,
        );
      }
    }

    if (d.path) {
      if (d.path.added.length > 0) {
        warnings.push(
          `${d.path.added.length} PATH entries added: ${d.path.added.join(", ")}`,
        );
      }
      if (d.path.removed.length > 0) {
        warnings.push(
          `${d.path.removed.length} PATH entries removed: ${d.path.removed.join(", ")}`,
        );
      }
    }

    if (d.npmGlobal) {
      if (d.npmGlobal.added.length > 0) {
        warnings.push(
          `${d.npmGlobal.added.length} global npm package(s) added`,
        );
      }
      if (d.npmGlobal.removed.length > 0) {
        warnings.push(
          `${d.npmGlobal.removed.length} global npm package(s) removed`,
        );
      }
      if (d.npmGlobal.modified.length > 0) {
        warnings.push(
          `${d.npmGlobal.modified.length} global npm package(s) version changed`,
        );
      }
    }

    if (d.npmLocal) {
      if (d.npmLocal.added.length > 0) {
        warnings.push(
          `${d.npmLocal.added.length} local npm package(s) added`,
        );
      }
      if (d.npmLocal.removed.length > 0) {
        warnings.push(
          `${d.npmLocal.removed.length} local npm package(s) removed`,
        );
      }
      if (d.npmLocal.modified.length > 0) {
        warnings.push(
          `${d.npmLocal.modified.length} local npm package(s) version changed`,
        );
      }
    }

    return {
      drifted: warnings.length > 0,
      warnings,
      diff,
    };
  }

  /**
   * Save the current snapshot to a JSON file.
   *
   * @param {string} filePath — destination path
   * @returns {boolean}
   */
  save(filePath) {
    if (!this._data) {
      throw new SnapshotError(
        "SNAPSHOT_EMPTY",
        "No snapshot data to save — call capture() first",
      );
    }
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(this._data, null, 2), "utf8");
    return true;
  }

  /**
   * Load a snapshot from a JSON file.
   *
   * @param {string} filePath — source path
   * @returns {object} the loaded snapshot data
   */
  load(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new SnapshotError(
        "SNAPSHOT_NOT_FOUND",
        `Snapshot file not found: ${filePath}`,
        { filePath },
      );
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    this._data = data;
    return data;
  }

  /**
   * Generate a lockfile-like structure from a snapshot's package data.
   * Outputs a JSON object compatible with package-lock.json conventions
   * for the packages recorded in the snapshot.
   *
   * @param {object} snapshot — a snapshot previously captured or loaded
   * @returns {object}
   */
  lockfileFromSnapshot(snapshot) {
    if (!snapshot) {
      throw new SnapshotError(
        "SNAPSHOT_INVALID",
        "Cannot generate lockfile from null or undefined snapshot",
      );
    }

    const lockfile = {
      name: "hax-agent-environment",
      version: "1.0.0",
      lockfileVersion: 2,
      requires: true,
      generatedAt: new Date().toISOString(),
      generatedFrom: snapshot.capturedAt || "unknown",
      packages: {},
      metadata: {
        nodeVersion: (snapshot.node && snapshot.node.version) || null,
        platform: (snapshot.system && snapshot.system.platform) || null,
        arch: (snapshot.system && snapshot.system.arch) || null,
      },
    };

    // Merge local + global packages
    const allPkgs = [
      ...(snapshot.npmLocal || []),
      ...(snapshot.npmGlobal || []),
    ];

    // Deduplicate by name (local wins if same name)
    const seen = new Set();
    for (const pkg of allPkgs) {
      if (seen.has(pkg.name)) continue;
      seen.add(pkg.name);
      lockfile.packages[`node_modules/${pkg.name}`] = {
        version: pkg.version,
        resolved: `https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-${pkg.version.replace(/^[\^~]/, "")}.tgz`,
        integrity: null,
      };
    }

    return lockfile;
  }
}

// -- Internal diff helpers ---------------------------------------------------

function diffEnvVars(a, b) {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  const added = keysB.filter((k) => !(k in a));
  const removed = keysA.filter((k) => !(k in b));
  const common = keysA.filter((k) => k in b);
  const modified = common
    .filter((k) => a[k] !== b[k])
    .map((k) => ({ key: k, from: a[k], to: b[k] }));
  return { added, removed, modified };
}

function diffArrays(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const added = b.filter((item) => !setA.has(item));
  const removed = a.filter((item) => !setB.has(item));
  return { added, removed };
}

function diffPackages(a, b) {
  const mapA = new Map(a.map((p) => [p.name, p.version]));
  const mapB = new Map(b.map((p) => [p.name, p.version]));
  const namesA = new Set(mapA.keys());
  const namesB = new Set(mapB.keys());

  const added = [...namesB]
    .filter((n) => !namesA.has(n))
    .map((n) => ({ name: n, version: mapB.get(n) }));

  const removed = [...namesA]
    .filter((n) => !namesB.has(n))
    .map((n) => ({ name: n, version: mapA.get(n) }));

  const modified = [...namesA]
    .filter((n) => namesB.has(n) && mapA.get(n) !== mapB.get(n))
    .map((n) => ({ name: n, from: mapA.get(n), to: mapB.get(n) }));

  return { added, removed, modified };
}

// ---------------------------------------------------------------------------

module.exports = { EnvironmentSnapshot, SnapshotError };
