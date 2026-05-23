"use strict";

/**
 * Environment Detector for HaxAgent.
 *
 * Detects the runtime environment (local dev, CI, Docker, cloud VM, low-resource)
 * and recommends optimal configuration presets based on detected capabilities.
 */

const os = require("node:os");

// ---------------------------------------------------------------------------
// Environment type constants
// ---------------------------------------------------------------------------

const ENV_TYPES = Object.freeze({
  LOCAL_DEV: "local_dev",
  CI_PIPELINE: "ci_pipeline",
  DOCKER_CONTAINER: "docker_container",
  CLOUD_VM: "cloud_vm",
  LOW_RESOURCE: "low_resource",
});

// ---------------------------------------------------------------------------
// Known CI environment variable signatures
// ---------------------------------------------------------------------------

const CI_SIGNATURES = Object.freeze([
  { env: "CI", exact: true },            // Generic CI indicator
  { env: "GITHUB_ACTIONS" },              // GitHub Actions
  { env: "GITLAB_CI" },                   // GitLab CI
  { env: "JENKINS_HOME" },                // Jenkins
  { env: "TRAVIS" },                      // Travis CI
  { env: "CIRCLECI" },                    // CircleCI
  { env: "BUILDKITE" },                   // Buildkite
  { env: "DRONE" },                       // Drone CI
  { env: "TEAMCITY_VERSION" },            // TeamCity
  { env: "BITBUCKET_BUILD_NUMBER" },      // Bitbucket Pipelines
  { env: "APPVEYOR" },                    // AppVeyor
  { env: "AZURE_HTTP_USER_AGENT" },       // Azure Pipelines
  { env: "BAMBOO_WORKING_DIRECTORY" },    // Bamboo
  { env: "CODEBUILD_BUILD_ID" },          // AWS CodeBuild
  { env: "GO_SERVER_URL" },               // GoCD
  { env: "HUDSON_URL" },                  // Hudson
  { env: "WERCKER" },                     // Wercker
  { env: "SEMAPHORE" },                   // Semaphore CI
]);

// ---------------------------------------------------------------------------
// Known cloud VM environment variable signatures
// ---------------------------------------------------------------------------

const CLOUD_SIGNATURES = Object.freeze([
  { env: "AWS_EXECUTION_ENV" },             // AWS (Lambda, ECS, etc.)
  { env: "GCP_PROJECT" },                   // Google Cloud Platform
  { env: "GOOGLE_CLOUD_PROJECT" },          // GCP alternative
  { env: "KUBERNETES_SERVICE_HOST" },       // Kubernetes (any cloud)
  { env: "AZURE_FUNCTIONS_ENVIRONMENT" },   // Azure Functions
  { env: "WEBSITE_INSTANCE_ID" },           // Azure App Service
  { env: "CLOUD_RUN_JOB" },                 // GCP Cloud Run jobs
  { env: "ECS_CONTAINER_METADATA_URI" },    // AWS ECS
  { env: "HEROKU_APP_ID" },                // Heroku
  { env: "DYNO" },                          // Heroku dyno
  { env: "FLY_APP_NAME" },                  // Fly.io
  { env: "RENDER" },                        // Render
  { env: "RAILWAY_STATIC_URL" },            // Railway
  { env: "DIGITALOCEAN_AGENT" },            // DigitalOcean
]);

// ---------------------------------------------------------------------------
// Known Docker container indicators
// ---------------------------------------------------------------------------

const CONTAINER_FILES = [
  "/.dockerenv",                           // Docker
  "/run/.containerenv",                    // Podman
  "/proc/1/cgroup",                         // Check for docker/containerd in cgroup
];

// ---------------------------------------------------------------------------
// Resource thresholds
// ---------------------------------------------------------------------------

const RESOURCE_THRESHOLDS = Object.freeze({
  LOW_CPU_COUNT: 1,             // <= 1 CPU = low
  MODERATE_CPU_COUNT: 4,        // <= 4 CPU = moderate
  LOW_MEMORY_MB: 1024,          // <= 1 GB = low
  MODERATE_MEMORY_MB: 4096,     // <= 4 GB = moderate
  LOW_DISK_GB: 5,               // <= 5 GB free = low
});

// ---------------------------------------------------------------------------
// EnvironmentDetector
// ---------------------------------------------------------------------------

class EnvironmentDetector {
  /**
   * @param {object} [opts]
   * @param {Function} [opts.readFileSync]  — file reader (for testing)
   * @param {object}   [opts.env]           — environment variables (defaults to process.env)
   */
  constructor(opts = {}) {
    /** @type {Function} */
    this._readFileSync = opts.readFileSync || null;
    /** @type {object} */
    this._env = opts.env || null;
    /** @type {object|null} */
    this._detectionResult = null;
  }

  /**
   * Get the effective environment variables. Uses provided env or process.env.
   * @returns {object}
   * @private
   */
  _getEnv() {
    if (this._env !== null) {
      return this._env;
    }
    // Dynamic require so tests that mock process.env work correctly
    return process.env;
  }

  /**
   * Read a file if it exists, returning its content or null.
   * @param {string} filePath
   * @returns {string|null}
   * @private
   */
  _tryReadFile(filePath) {
    if (this._readFileSync) {
      return this._readFileSync(filePath);
    }
    try {
      const fs = require("node:fs");
      return fs.readFileSync(filePath, "utf8");
    } catch (_err) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // detect() — detects current environment capabilities
  // ---------------------------------------------------------------------------

  /**
   * Detect the current runtime environment type and capabilities.
   *
   * @returns {{
   *   envType: string,
   *   isCI: boolean,
   *   isDocker: boolean,
   *   isCloud: boolean,
   *   isLowResource: boolean,
   *   details: {
   *     ciPlatform: string|null,
   *     cloudPlatform: string|null,
   *     containerRuntime: string|null,
   *   },
   *   capabilities: object,
   *   resourceLimits: object,
   *   timestamp: string,
   * }}
   */
  detect() {
    const env = this._getEnv();
    const now = new Date().toISOString();

    // ------- CI detection -------
    const ciResult = this._detectCI(env);
    const isCI = ciResult.isCI;

    // ------- Docker/container detection -------
    const containerResult = this._detectContainer(env);
    const isDocker = containerResult.isDocker;

    // ------- Cloud detection -------
    const cloudResult = this._detectCloud(env);
    const isCloud = cloudResult.isCloud;

    // ------- Resource limits -------
    const resourceLimits = this.getResourceLimits();
    const isLowResource = resourceLimits.tier === "low";

    // ------- Determine primary environment type -------
    let envType;
    if (isLowResource) {
      envType = ENV_TYPES.LOW_RESOURCE;
    } else if (isCI) {
      envType = ENV_TYPES.CI_PIPELINE;
    } else if (isDocker) {
      envType = ENV_TYPES.DOCKER_CONTAINER;
    } else if (isCloud) {
      envType = ENV_TYPES.CLOUD_VM;
    } else {
      envType = ENV_TYPES.LOCAL_DEV;
    }

    this._detectionResult = {
      envType,
      isCI,
      isDocker,
      isCloud,
      isLowResource,
      details: {
        ciPlatform: ciResult.platform,
        cloudPlatform: cloudResult.platform,
        containerRuntime: containerResult.runtime,
      },
      capabilities: this._getCapabilities(isCI, isDocker, isCloud, resourceLimits),
      resourceLimits,
      timestamp: now,
    };

    return this._detectionResult;
  }

  // ---------------------------------------------------------------------------
  // recommendForEnv(env) — recommends config for environment
  // ---------------------------------------------------------------------------

  /**
   * Recommend an optimal configuration preset for a given environment description.
   *
   * @param {object} [envDescription] — optional environment description (from detect())
   *   If omitted, detect() is called internally.
   * @returns {{
   *   recommendedPreset: string,
   *   envType: string,
   *   overrides: object,
   *   rationale: string,
   * }}
   */
  recommendForEnv(envDescription) {
    const desc = envDescription || this.detect();

    const { envType, isCI, isDocker, isCloud, isLowResource, resourceLimits } = desc;

    let recommendedPreset;
    let overrides = {};
    let rationale;

    switch (envType) {
      case ENV_TYPES.LOCAL_DEV: {
        recommendedPreset = "coding";
        rationale = "Local development environment detected. Using the 'coding' preset with moderate tool turns and auto-compaction for an interactive development experience.";
        overrides = {
          permissions: { mode: "normal" },
          context: { autoCompact: true, threshold: 0.8 },
        };
        break;
      }

      case ENV_TYPES.CI_PIPELINE: {
        recommendedPreset = "ci";
        rationale = "CI pipeline environment detected. Using the 'ci' preset with YOLO permissions, longer shell timeouts, and aggressive auto-compaction for unattended operation.";
        overrides = {
          permissions: { mode: "yolo" },
          context: { autoCompact: true, threshold: 0.85 },
          tools: { shell: { timeoutMs: 120_000 } },
          ui: { theme: "dark" }, // irrelevant in CI but clean default
        };
        break;
      }

      case ENV_TYPES.DOCKER_CONTAINER: {
        recommendedPreset = "autonomous";
        rationale = "Docker container environment detected. Using the 'autonomous' preset with elevated tool turns since containers are ephemeral and isolated.";
        overrides = {
          permissions: { mode: "auto" },
          context: { autoCompact: true, threshold: 0.75 },
          memory: { enabled: true, maxEntries: 30 },
        };
        break;
      }

      case ENV_TYPES.CLOUD_VM: {
        recommendedPreset = "autonomous";
        rationale = "Cloud VM environment detected. Using the 'autonomous' preset with adjustments for cloud resource elasticity.";
        overrides = {
          permissions: { mode: "auto" },
          context: { autoCompact: true, threshold: 0.8 },
          tools: { shell: { timeoutMs: 60_000 } },
        };
        break;
      }

      case ENV_TYPES.LOW_RESOURCE: {
        recommendedPreset = "chat";
        rationale = "Low-resource environment detected. Using the 'chat' preset with minimal tool turns, disabled shell, and aggressive memory caps to conserve system resources.";
        overrides = {
          agent: { maxToolTurns: 3 },
          tools: { shell: { enabled: false } },
          permissions: { mode: "ask" },
          context: { autoCompact: true, threshold: 0.6, reserveOutputTokens: 2048 },
          memory: { maxEntries: 5 },
          fileContext: { enabled: false },
        };
        break;
      }

      default: {
        recommendedPreset = "coding";
        rationale = "Unknown environment. Falling back to the 'coding' preset as a safe default.";
        break;
      }
    }

    // Blend resource-aware overrides
    if (resourceLimits) {
      if (resourceLimits.memoryTotalMB < RESOURCE_THRESHOLDS.MODERATE_MEMORY_MB) {
        overrides.memory = { ...(overrides.memory || {}), maxEntries: 10 };
        overrides.fileContext = { ...(overrides.fileContext || {}), maxFiles: 4 };
      }
      if (resourceLimits.cpuCount <= RESOURCE_THRESHOLDS.LOW_CPU_COUNT) {
        overrides.agent = { ...(overrides.agent || {}), maxToolTurns: Math.min(overrides.agent?.maxToolTurns || 10, 5) };
      }
    }

    return {
      recommendedPreset,
      envType,
      overrides,
      rationale,
    };
  }

  // ---------------------------------------------------------------------------
  // isCI() — detect CI environment
  // ---------------------------------------------------------------------------

  /**
   * Check if the current environment is a CI pipeline.
   *
   * @returns {boolean}
   */
  isCI() {
    return this._detectCI(this._getEnv()).isCI;
  }

  // ---------------------------------------------------------------------------
  // isDocker() — detect Docker/container environment
  // ---------------------------------------------------------------------------

  /**
   * Check if the current environment is running inside a Docker container.
   *
   * @returns {boolean}
   */
  isDocker() {
    return this._detectContainer(this._getEnv()).isDocker;
  }

  // ---------------------------------------------------------------------------
  // isCloud() — detect cloud VM environment
  // ---------------------------------------------------------------------------

  /**
   * Check if the current environment is running on a cloud VM/platform.
   *
   * @returns {boolean}
   */
  isCloud() {
    return this._detectCloud(this._getEnv()).isCloud;
  }

  // ---------------------------------------------------------------------------
  // getResourceLimits() — CPU, memory, disk detection
  // ---------------------------------------------------------------------------

  /**
   * Detect system resource limits: CPU count, total memory, free memory,
   * and free disk space on the current working directory.
   *
   * Default values are used when OS detection is unavailable.
   *
   * @returns {{
   *   cpuCount: number,
   *   cpuModel: string,
   *   memoryTotalMB: number,
   *   memoryFreeMB: number,
   *   diskFreeGB: number,
   *   platform: string,
   *   tier: string,
   * }}
   */
  getResourceLimits() {
    let cpuCount = 0;
    let cpuModel = "unknown";
    let memoryTotalMB = 0;
    let memoryFreeMB = 0;

    try {
      const cpus = os.cpus();
      cpuCount = cpus.length;
      cpuModel = cpus.length > 0 ? cpus[0].model : "unknown";
    } catch (_e) {
      cpuCount = 1;
    }

    try {
      memoryTotalMB = Math.round(os.totalmem() / (1024 * 1024));
      memoryFreeMB = Math.round(os.freemem() / (1024 * 1024));
    } catch (_e) {
      memoryTotalMB = 512;
      memoryFreeMB = 256;
    }

    let diskFreeGB = 10; // optimistic default
    try {
      const cwd = process.cwd();
      // Use a simple stat-based approach; avoid heavy dependencies
      const { execSync } = require("node:child_process");
      if (process.platform === "win32") {
        const stdout = execSync(`wmic logicaldisk where "DeviceID='${cwd[0]}:'" get FreeSpace`, { encoding: "utf8", timeout: 3000 });
        const match = stdout.match(/\d+/);
        if (match) diskFreeGB = Math.round((parseInt(match[0], 10) / (1024 * 1024 * 1024)) * 100) / 100;
      } else {
        const stdout = execSync(`df -k "${cwd}"`, { encoding: "utf8", timeout: 3000 });
        const lines = stdout.trim().split("\n");
        if (lines.length > 1) {
          const parts = lines[1].split(/\s+/);
          // Available (or 4th column = available in KB)
          const availIdx = parts.length >= 4 ? 3 : parts.length - 1;
          diskFreeGB = Math.round((parseInt(parts[availIdx], 10) / (1024 * 1024)) * 100) / 100;
        }
      }
    } catch (_e) {
      // Silently fall back to default
    }

    const tier =
      cpuCount <= RESOURCE_THRESHOLDS.LOW_CPU_COUNT ||
      memoryTotalMB <= RESOURCE_THRESHOLDS.LOW_MEMORY_MB ||
      diskFreeGB <= RESOURCE_THRESHOLDS.LOW_DISK_GB
        ? "low"
        : cpuCount <= RESOURCE_THRESHOLDS.MODERATE_CPU_COUNT ||
            memoryTotalMB <= RESOURCE_THRESHOLDS.MODERATE_MEMORY_MB
          ? "moderate"
          : "high";

    return {
      cpuCount,
      cpuModel,
      memoryTotalMB,
      memoryFreeMB,
      diskFreeGB,
      platform: process.platform,
      tier,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Detect CI environment from env vars.
   * @param {object} env
   * @returns {{ isCI: boolean, platform: string|null }}
   * @private
   */
  _detectCI(env) {
    for (const sig of CI_SIGNATURES) {
      if (hasOwn(env, sig.env)) {
        if (sig.exact) {
          // exact: truthy means CI (e.g., CI=true)
          if (isTruthyEnv(env[sig.env])) {
            return { isCI: true, platform: sig.env };
          }
        } else {
          // presence of the variable is enough
          return { isCI: true, platform: sig.env };
        }
      }
    }
    return { isCI: false, platform: null };
  }

  /**
   * Detect Docker/container environment.
   * @param {object} env
   * @returns {{ isDocker: boolean, runtime: string|null }}
   * @private
   */
  _detectContainer(env) {
    // Check for container env var indicators
    const hasKubernetesEnv = hasOwn(env, "KUBERNETES_SERVICE_HOST");
    if (isTruthyEnv(env["DOCKER_CONTAINER"]) || hasKubernetesEnv) {
      const runtime = hasKubernetesEnv ? "kubernetes" : "docker";
      return { isDocker: true, runtime };
    }

    // Check container marker files
    if (this._tryReadFile("/.dockerenv") !== null) {
      return { isDocker: true, runtime: "docker" };
    }

    if (this._tryReadFile("/run/.containerenv") !== null) {
      return { isDocker: true, runtime: "podman" };
    }

    // Check cgroup for docker/containerd/kubepods
    const cgroupContent = this._tryReadFile("/proc/1/cgroup");
    if (cgroupContent !== null) {
      if (cgroupContent.includes("docker") || cgroupContent.includes("containerd")) {
        return { isDocker: true, runtime: "docker" };
      }
      if (cgroupContent.includes("kubepods")) {
        return { isDocker: true, runtime: "kubernetes" };
      }
    }

    return { isDocker: false, runtime: null };
  }

  /**
   * Detect cloud platform from env vars.
   * @param {object} env
   * @returns {{ isCloud: boolean, platform: string|null }}
   * @private
   */
  _detectCloud(env) {
    for (const sig of CLOUD_SIGNATURES) {
      if (hasOwn(env, sig.env)) {
        return { isCloud: true, platform: sig.env };
      }
    }

    // Check for cloud metadata endpoints (lightweight: just check hostname hints)
    const hostname = (env["HOSTNAME"] || "").toLowerCase();
    if (hostname.includes("ip-") && hostname.includes("compute")) {
      return { isCloud: true, platform: "AWS_EC2" };
    }

    return { isCloud: false, platform: null };
  }

  /**
   * Determine capabilities based on environment properties.
   * @param {boolean} isCI
   * @param {boolean} isDocker
   * @param {boolean} isCloud
   * @param {object} resourceLimits
   * @returns {object}
   * @private
   */
  _getCapabilities(isCI, isDocker, isCloud, resourceLimits) {
    return {
      interactive: !isCI,
      persistentStorage: !isCI,
      networkAccess: true,
      shellAvailable: true,
      memoryConstrained: resourceLimits.tier === "low",
      cpuConstrained: resourceLimits.cpuCount <= RESOURCE_THRESHOLDS.LOW_CPU_COUNT,
      diskConstrained: resourceLimits.diskFreeGB <= RESOURCE_THRESHOLDS.LOW_DISK_GB,
      containerized: isDocker,
      ephemeral: isCI || isCloud,
    };
  }
}

// ---------------------------------------------------------------------------
// Helper: safe property check on plain objects
// ---------------------------------------------------------------------------

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// ---------------------------------------------------------------------------
// Helper: interpret env var value as truthy/falsy for flags
// ---------------------------------------------------------------------------

function isTruthyEnv(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "" || s === "on";
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  EnvironmentDetector,
  ENV_TYPES,
  CI_SIGNATURES,
  CLOUD_SIGNATURES,
  RESOURCE_THRESHOLDS,
};
