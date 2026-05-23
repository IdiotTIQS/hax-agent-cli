"use strict";

/**
 * manager.js — ArtifactManager for versioned, checksummed artifact storage
 * and retrieval with pluggable storage backends.
 *
 *   const { ArtifactManager } = require("./artifact/manager");
 *   const mgr = new ArtifactManager({ backend: "directory", basePath: "./artifacts" });
 *   const art = mgr.create("my-report", ["report.json", "data.csv"], { type: "report" });
 *   mgr.publish(art);
 *   const list = mgr.list({ type: "report" });
 *   const dl   = mgr.download("my-report", "1.0.0");
 *   mgr.delete("my-report", "1.0.0");
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Storage backends
// ---------------------------------------------------------------------------

/**
 * Local / in-memory backend — stores artifacts as plain objects.
 * Useful for ephemeral sessions and testing.
 */
class LocalBackend {
  constructor() {
    this._store = new Map();
  }

  _key(name, version) {
    return `${name}@${version}`;
  }

  save(artifact) {
    this._store.set(this._key(artifact.name, artifact.version), artifact);
  }

  get(name, version) {
    return this._store.get(this._key(name, version)) || null;
  }

  list(filter = {}) {
    const entries = [...this._store.values()];
    return applyFilter(entries, filter);
  }

  delete(name, version) {
    return this._store.delete(this._key(name, version));
  }

  exists(name, version) {
    return this._store.has(this._key(name, version));
  }
}

/**
 * Directory backend — persists each artifact as a JSON manifest plus file
 * copies inside a versioned directory tree.
 *
 * Layout:
 *   <basePath>/<name>/<version>/manifest.json
 *   <basePath>/<name>/<version>/files/<relative...>
 */
class DirectoryBackend {
  constructor(basePath) {
    this.basePath = path.resolve(basePath);
    fs.mkdirSync(this.basePath, { recursive: true });
  }

  _artifactDir(name, version) {
    return path.join(this.basePath, sanitizePath(name), sanitizePath(version));
  }

  save(artifact) {
    const dir = this._artifactDir(artifact.name, artifact.version);
    fs.mkdirSync(dir, { recursive: true });

    // Write manifest
    const manifest = { ...artifact };
    delete manifest.files;
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8"
    );

    // Copy files
    const filesDir = path.join(dir, "files");
    for (const f of artifact.files) {
      const src = path.resolve(f);
      const dest = path.join(filesDir, path.basename(f));
      if (fs.existsSync(src)) {
        fs.mkdirSync(filesDir, { recursive: true });
        fs.copyFileSync(src, dest);
      }
    }
  }

  get(name, version) {
    const dir = this._artifactDir(name, version);
    const manifestPath = path.join(dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) return null;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const filesDir = path.join(dir, "files");
    const files = fs.existsSync(filesDir)
      ? fs.readdirSync(filesDir).map((f) => path.join(filesDir, f))
      : [];

    return { ...manifest, files };
  }

  list(filter = {}) {
    const basePath = this.basePath;
    const results = [];

    if (!fs.existsSync(basePath)) return results;

    const names = fs.readdirSync(basePath, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const nameEntry of names) {
      const nameDir = path.join(basePath, nameEntry.name);
      const versions = fs.readdirSync(nameDir, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const verEntry of versions) {
        const manifestPath = path.join(nameDir, verEntry.name, "manifest.json");
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            const filesDir = path.join(nameDir, verEntry.name, "files");
            const files = fs.existsSync(filesDir)
              ? fs.readdirSync(filesDir).map((f) => path.join(filesDir, f))
              : [];
            results.push({ ...manifest, files });
          } catch {
            // skip corrupt manifests
          }
        }
      }
    }

    return applyFilter(results, filter);
  }

  delete(name, version) {
    const dir = this._artifactDir(name, version);
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }

  exists(name, version) {
    return fs.existsSync(
      path.join(this._artifactDir(name, version), "manifest.json")
    );
  }
}

// ---------------------------------------------------------------------------
// Filter helper
// ---------------------------------------------------------------------------

function applyFilter(entries, filter) {
  let results = entries;
  if (filter.name) {
    results = results.filter((a) => a.name === filter.name);
  }
  if (filter.type) {
    results = results.filter((a) => a.type === filter.type);
  }
  if (filter.version) {
    results = results.filter((a) => a.version === filter.version);
  }
  if (filter.before) {
    const before = new Date(filter.before).getTime();
    results = results.filter(
      (a) => new Date(a.createdAt).getTime() < before
    );
  }
  if (filter.after) {
    const after = new Date(filter.after).getTime();
    results = results.filter(
      (a) => new Date(a.createdAt).getTime() > after
    );
  }
  if (typeof filter.limit === "number" && filter.limit > 0) {
    results = results.slice(0, filter.limit);
  }
  return results;
}

// ---------------------------------------------------------------------------
// ArtifactManager
// ---------------------------------------------------------------------------

class ArtifactManager {
  /**
   * @param {object} [options]
   * @param {"local"|"directory"} [options.backend="local"]
   * @param {string} [options.basePath="./artifacts"]  — for directory backend
   */
  constructor(options = {}) {
    const backend = options.backend || "local";
    if (backend === "directory") {
      this._store = new DirectoryBackend(options.basePath || "./artifacts");
    } else {
      this._store = new LocalBackend();
    }
    this._backendType = backend;
  }

  // --- public API ---

  /**
   * Create an artifact from the given file paths.
   *
   * @param {string} name       — artifact name (e.g. "hax-report")
   * @param {string[]} files    — absolute or relative file paths to include
   * @param {object} [options]
   * @param {string} [options.version]   — semver string (auto-incremented if omitted)
   * @param {string} [options.type]      — artifact type: "report", "export", "plugin", "bundle"
   * @param {object} [options.metadata]  — arbitrary key-value metadata
   * @returns {object} artifact
   */
  create(name, files, options = {}) {
    if (!name || typeof name !== "string") {
      throw new Error("Artifact name is required and must be a string");
    }

    const version = options.version || this._nextVersion(name);
    const now = new Date().toISOString();

    const checksums = {};
    for (const f of files) {
      const resolved = path.resolve(f);
      checksums[path.basename(f)] = fs.existsSync(resolved)
        ? computeChecksum(resolved)
        : "MISSING";
    }

    const artifact = {
      name,
      version,
      type: options.type || "generic",
      files: files.map((f) => path.resolve(f)),
      metadata: options.metadata || {},
      checksums,
      createdAt: now,
    };

    return artifact;
  }

  /**
   * Publish (persist) an artifact to the storage backend.
   *
   * @param {object} artifact
   * @returns {object} the stored artifact
   */
  publish(artifact) {
    if (!artifact || !artifact.name || !artifact.version) {
      throw new Error("Invalid artifact: must have name and version");
    }
    this._store.save(artifact);
    return artifact;
  }

  /**
   * Download / retrieve an artifact by name and version.
   *
   * @param {string} name
   * @param {string} version
   * @returns {object|null} the artifact, or null if not found
   */
  download(name, version) {
    if (!name || !version) {
      throw new Error("download requires name and version");
    }
    return this._store.get(name, version);
  }

  /**
   * List artifacts matching an optional filter.
   *
   * @param {object} [filter]
   * @param {string} [filter.name]
   * @param {string} [filter.type]
   * @param {string} [filter.version]
   * @param {string} [filter.before]   — ISO date string
   * @param {string} [filter.after]    — ISO date string
   * @param {number} [filter.limit]
   * @returns {object[]}
   */
  list(filter = {}) {
    return this._store.list(filter);
  }

  /**
   * Delete an artifact by name and version.
   *
   * @param {string} name
   * @param {string} version
   * @returns {boolean} true if deleted, false if not found
   */
  delete(name, version) {
    if (!name || !version) {
      throw new Error("delete requires name and version");
    }
    return this._store.delete(name, version);
  }

  /**
   * Check whether an artifact exists.
   *
   * @param {string} name
   * @param {string} version
   * @returns {boolean}
   */
  exists(name, version) {
    return this._store.exists(name, version);
  }

  // --- internal ---

  /**
   * Auto-compute the next patch version for a given artifact name.
   * If no prior artifacts exist, starts at "0.0.1".
   */
  _nextVersion(name) {
    const existing = this._store.list({ name });
    if (existing.length === 0) return "0.0.1";

    let latest = existing[0];
    for (const a of existing) {
      if (compareVersions(a.version, latest.version) > 0) {
        latest = a;
      }
    }

    const parts = latest.version.split(".").map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    }

    return "0.0.1";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeChecksum(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(data).digest("hex");
  } catch {
    return null;
  }
}

function sanitizePath(segment) {
  return segment.replace(/[<>:"/\\|?*\x00]/g, "_");
}

/**
 * Simple semver-like comparison for auto-versioning.
 * Returns -1, 0, or 1.
 */
function compareVersions(a, b) {
  const pa = (a || "0.0.0").split(".").map(Number);
  const pb = (b || "0.0.0").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ArtifactManager,
  LocalBackend,
  DirectoryBackend,
};
