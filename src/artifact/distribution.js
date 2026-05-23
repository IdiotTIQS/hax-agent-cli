"use strict";

/**
 * distribution.js — DistributionManager for pushing artifacts to multiple
 * distribution channels (local dir, npm registry, docker registry,
 * GitHub Releases, or custom endpoints).
 *
 *   const { DistributionManager } = require("./artifact/distribution");
 *   const dm = new DistributionManager();
 *   dm.addChannel("local", { type: "local_dir", path: "./dist" });
 *   dm.addChannel("npm", { type: "npm_registry", registry: "https://registry.npmjs.org" });
 *   dm.distribute(artifact, ["local", "npm"]);
 *   dm.getDistributionStatus(artifact);
 *   dm.sync("local");
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Channel handlers
// ---------------------------------------------------------------------------

const CHANNEL_HANDLERS = {
  local_dir: localDirHandler,
  npm_registry: npmRegistryHandler,
  docker_registry: dockerRegistryHandler,
  github_release: githubReleaseHandler,
  custom: customHandler,
};

// ---------------------------------------------------------------------------
// DistributionManager
// ---------------------------------------------------------------------------

class DistributionManager {
  constructor() {
    /** @type {Map<string, object>} channel name → channel config */
    this._channels = new Map();

    /** @type {Map<string, object[]>} artifact key → distribution records */
    this._distributions = new Map();
  }

  // --- public API ---

  /**
   * Add a distribution channel.
   *
   * @param {string} name — channel name
   * @param {object} config
   * @param {"local_dir"|"npm_registry"|"docker_registry"|"github_release"|"custom"} config.type
   * @param {string} [config.path]      — for local_dir
   * @param {string} [config.registry]  — for npm_registry / docker_registry
   * @param {string} [config.url]       — for github_release / custom
   * @param {object} [config.auth]      — credentials (token, username, password)
   * @param {object} [config.options]   — type-specific options
   * @returns {object} the channel
   */
  addChannel(name, config = {}) {
    if (!name || typeof name !== "string") {
      throw new Error("Channel name is required");
    }
    if (!config.type) {
      throw new Error("Channel type is required");
    }

    const validTypes = Object.keys(CHANNEL_HANDLERS);
    if (!validTypes.includes(config.type)) {
      throw new Error(
        `Unknown channel type: ${config.type}. Valid types: ${validTypes.join(", ")}`
      );
    }

    const channel = {
      name,
      type: config.type,
      config,
      status: "ready",
      lastSync: null,
    };

    this._channels.set(name, channel);
    return channel;
  }

  /**
   * Remove a distribution channel.
   *
   * @param {string} name
   * @returns {boolean}
   */
  removeChannel(name) {
    return this._channels.delete(name);
  }

  /**
   * Get a channel by name.
   *
   * @param {string} name
   * @returns {object|null}
   */
  getChannel(name) {
    return this._channels.get(name) || null;
  }

  /**
   * List all registered channels.
   *
   * @returns {object[]}
   */
  listChannels() {
    return [...this._channels.values()];
  }

  /**
   * Distribute an artifact to one or more channels.
   *
   * @param {object} artifact — { name, version, type, files, metadata, checksums, createdAt }
   * @param {string[]} channels — channel names to push to
   * @param {object} [options]
   * @param {boolean} [options.dryRun=false] — simulate without actually pushing
   * @param {number} [options.timeout=30000] — per-channel timeout in ms
   * @returns {object} distribution results
   */
  distribute(artifact, channels, options = {}) {
    if (!artifact || !artifact.name || !artifact.version) {
      throw new Error("Invalid artifact: must have name and version");
    }
    if (!Array.isArray(channels) || channels.length === 0) {
      throw new Error("At least one channel name is required");
    }

    const dryRun = options.dryRun === true;
    const results = { artifact: artifactKey(artifact), channels: {} };

    for (const channelName of channels) {
      const channel = this._channels.get(channelName);
      if (!channel) {
        results.channels[channelName] = {
          status: "error",
          error: `Channel not found: ${channelName}`,
        };
        continue;
      }

      try {
        const handler = CHANNEL_HANDLERS[channel.type];
        if (!handler) {
          results.channels[channelName] = {
            status: "error",
            error: `No handler for channel type: ${channel.type}`,
          };
          continue;
        }

        if (dryRun) {
          results.channels[channelName] = {
            status: "dry_run",
            message: `Would distribute to ${channelName} (${channel.type})`,
          };
        } else {
          const outcome = handler(artifact, channel);
          channel.lastSync = new Date().toISOString();
          channel.status = "active";
          results.channels[channelName] = outcome;

          // Record the distribution
          this._recordDistribution(artifact, channelName, outcome);
        }
      } catch (err) {
        results.channels[channelName] = {
          status: "error",
          error: err.message,
        };
      }
    }

    return results;
  }

  /**
   * Get the distribution status for a given artifact.
   *
   * @param {object} artifact
   * @returns {object} map of channel → status
   */
  getDistributionStatus(artifact) {
    const key = artifactKey(artifact);
    const records = this._distributions.get(key) || [];

    const status = {};
    for (const rec of records) {
      status[rec.channel] = {
        status: rec.status,
        timestamp: rec.timestamp,
        channelType: this._channels.get(rec.channel)?.type || "unknown",
      };
    }

    // Also include channels the artifact has NOT been distributed to
    for (const [name, ch] of this._channels) {
      if (!status[name]) {
        status[name] = {
          status: "not_distributed",
          timestamp: null,
          channelType: ch.type,
        };
      }
    }

    return status;
  }

  /**
   * Sync a channel — verify all distributed artifacts are still present.
   *
   * @param {string} channelName
   * @returns {object} sync results { channel, artifactsChecked, missing, present }
   */
  sync(channelName) {
    const channel = this._channels.get(channelName);
    if (!channel) {
      throw new Error(`Channel not found: ${channelName}`);
    }

    const missing = [];
    const present = [];
    let artifactsChecked = 0;

    for (const [key, records] of this._distributions) {
      const chanRecord = records.find((r) => r.channel === channelName);
      if (!chanRecord) continue;

      artifactsChecked++;

      // Verify based on channel type
      const verified = this._verifyDistribution(chanRecord, channel);
      if (verified) {
        present.push(key);
      } else {
        missing.push(key);
      }
    }

    channel.lastSync = new Date().toISOString();
    channel.status = missing.length === 0 ? "synced" : "partial";

    return {
      channel: channelName,
      artifactsChecked,
      missing,
      present,
      status: missing.length === 0 ? "synced" : "partial",
    };
  }

  // --- internal ---

  _recordDistribution(artifact, channelName, outcome) {
    const key = artifactKey(artifact);
    if (!this._distributions.has(key)) {
      this._distributions.set(key, []);
    }
    this._distributions.get(key).push({
      channel: channelName,
      status: outcome.status,
      timestamp: new Date().toISOString(),
      details: outcome,
    });
  }

  _verifyDistribution(record, channel) {
    const handler = CHANNEL_HANDLERS[channel.type];
    if (!handler) return false;

    try {
      // Use the handler in verify mode
      const result = handler(
        { name: record.details?.name, version: record.details?.version },
        channel,
        { verify: true }
      );
      return result.status === "present";
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Channel handler implementations
// ---------------------------------------------------------------------------

/**
 * Local directory handler: copies artifact files to a target directory.
 */
function localDirHandler(artifact, channel, opts = {}) {
  const targetDir = channel.config.path;
  if (!targetDir) {
    return { status: "error", error: "local_dir requires config.path" };
  }

  const destDir = path.resolve(targetDir, artifact.name, artifact.version);

  if (opts.verify) {
    const manifestPath = path.join(destDir, "manifest.json");
    const exists = fs.existsSync(manifestPath);
    return {
      status: exists ? "present" : "missing",
      name: artifact.name,
      version: artifact.version,
    };
  }

  fs.mkdirSync(destDir, { recursive: true });

  // Write manifest
  const manifest = { ...artifact };
  delete manifest.files;
  fs.writeFileSync(
    path.join(destDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  // Copy files
  if (Array.isArray(artifact.files)) {
    const filesDir = path.join(destDir, "files");
    fs.mkdirSync(filesDir, { recursive: true });
    for (const f of artifact.files) {
      const src = path.resolve(f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(filesDir, path.basename(f)));
      }
    }
  }

  return {
    status: "success",
    path: destDir,
    name: artifact.name,
    version: artifact.version,
  };
}

/**
 * npm registry handler: simulates npm publish (actual publish via child_process).
 */
function npmRegistryHandler(artifact, channel, opts = {}) {
  if (opts.verify) {
    // In verify mode, check if a tarball proxy exists
    return {
      status: "unknown",
      name: artifact.name,
      version: artifact.version,
      note: "npm registry verification requires network access",
    };
  }

  const registry = channel.config.registry || "https://registry.npmjs.org";

  // Simulate: in a real implementation, spawn `npm publish`
  return {
    status: "success",
    registry,
    package: `${artifact.name}@${artifact.version}`,
    name: artifact.name,
    version: artifact.version,
    note: "Simulated publish — replace with actual npm publish in production",
  };
}

/**
 * Docker registry handler: simulates docker push.
 */
function dockerRegistryHandler(artifact, channel, opts = {}) {
  if (opts.verify) {
    return {
      status: "unknown",
      name: artifact.name,
      version: artifact.version,
      note: "docker registry verification requires network access",
    };
  }

  const registry = channel.config.registry || "docker.io";
  const tag = `${registry}/${artifact.name}:${artifact.version}`;

  return {
    status: "success",
    registry,
    tag,
    name: artifact.name,
    version: artifact.version,
    note: "Simulated push — replace with actual docker push in production",
  };
}

/**
 * GitHub Releases handler: simulates creating a GitHub Release.
 */
function githubReleaseHandler(artifact, channel, opts = {}) {
  if (opts.verify) {
    return {
      status: "unknown",
      name: artifact.name,
      version: artifact.version,
      note: "github release verification requires API access",
    };
  }

  const repoUrl = channel.config.url || channel.config.repo || "";
  const token = channel.config.auth?.token ? "***" : null;

  return {
    status: "success",
    repo: repoUrl,
    tag: `v${artifact.version}`,
    name: artifact.name,
    version: artifact.version,
    note: "Simulated release — replace with actual gh release create in production",
  };
}

/**
 * Custom channel handler: calls a user-provided function or logs the payload.
 */
function customHandler(artifact, channel, opts = {}) {
  if (opts.verify) {
    return {
      status: "unknown",
      name: artifact.name,
      version: artifact.version,
      note: "custom channel verification depends on implementation",
    };
  }

  const handlerFn = channel.config.handler;

  if (typeof handlerFn === "function") {
    try {
      const result = handlerFn(artifact, channel.config);
      return { status: "success", custom: result, name: artifact.name, version: artifact.version };
    } catch (err) {
      return { status: "error", error: err.message, name: artifact.name, version: artifact.version };
    }
  }

  // No handler function — return the payload for manual inspection
  return {
    status: "pending",
    name: artifact.name,
    version: artifact.version,
    payload: { artifact, channel: channel.config },
    note: "No handler function provided; payload returned for manual processing",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function artifactKey(artifact) {
  return `${artifact.name}@${artifact.version}`;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  DistributionManager,
};
