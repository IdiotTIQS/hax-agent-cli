"use strict";

// ---------------------------------------------------------------------------
// ReproductionEngine — generate deterministic reproduction recipes
// (Dockerfile, setup scripts, Nix flakes) from environment descriptors
// so every agent run is reproducible.
// ---------------------------------------------------------------------------

const os = require("node:os");
const path = require("node:path");

// -- Error class -------------------------------------------------------------

class ReproductionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ReproductionError";
    this.code = code;
    this.details = details || {};
  }
}

// -- Constants ---------------------------------------------------------------

const SUPPORTED_OS = ["linux", "macos", "windows"];

/**
 * Map Node.js os.platform() values to recipe OS names.
 */
function normalizeOS(raw) {
  const map = {
    win32: "windows",
    darwin: "macos",
    linux: "linux",
  };
  return map[raw] || raw;
}

// ---------------------------------------------------------------------------
// ReproductionEngine class
// ---------------------------------------------------------------------------

class ReproductionEngine {
  constructor() {
    this._recipes = new Map();
  }

  /**
   * Create a structured reproduction recipe from an environment descriptor.
   *
   * @param {object} environment — environment info (from VirtualEnv.getInfo,
   *   EnvironmentSnapshot.capture, or similar)
   * @param {object} [options]
   * @param {string} [options.name] — recipe name
   * @param {string} [options.description] — human-readable description
   * @returns {object} recipe
   */
  createRecipe(environment, options = {}) {
    if (!environment || typeof environment !== "object") {
      throw new ReproductionError(
        "REPRO_INVALID_ENV",
        "Cannot create recipe from null or invalid environment descriptor",
      );
    }

    const osName = normalizeOS(environment.os || os.platform());
    const arch = environment.arch || os.arch();

    const runtime = {
      type: (environment.type || "node").toLowerCase(),
      name: (environment.runtime || "node").toLowerCase(),
      version: environment.nodeVersion || process.versions.node,
    };

    // Collect packages from the environment
    const packages = [];
    if (Array.isArray(environment.npmGlobal)) {
      for (const pkg of environment.npmGlobal) {
        packages.push({ name: pkg.name, version: pkg.version, scope: "global" });
      }
    }
    if (Array.isArray(environment.npmLocal)) {
      for (const pkg of environment.npmLocal) {
        packages.push({ name: pkg.name, version: pkg.version, scope: "local" });
      }
    }
    if (Array.isArray(environment.packages)) {
      for (const pkg of environment.packages) {
        if (!packages.some((p) => p.name === (pkg.name || pkg))) {
          packages.push({
            name: typeof pkg === "string" ? pkg : pkg.name,
            version: typeof pkg === "string" ? "latest" : pkg.version || "latest",
            scope: "explicit",
          });
        }
      }
    }

    // Collect env vars (non-sensitive subset)
    const envVars = {};
    if (environment.env && typeof environment.env === "object") {
      for (const [key, val] of Object.entries(environment.env)) {
        if (isSafeEnvVar(key)) {
          envVars[key] = val;
        }
      }
    }

    // Build setup steps
    const setupSteps = buildSetupSteps(osName, runtime, packages, envVars);

    const recipe = {
      name: options.name || environment.name || "hax-agent-env",
      description: options.description || "Auto-generated reproduction recipe",
      os: osName,
      arch,
      runtime,
      packages,
      envVars,
      setupSteps,
      generatedAt: new Date().toISOString(),
    };

    return recipe;
  }

  /**
   * Verify that the current environment matches a given recipe.
   *
   * @param {object} recipe — recipe object (from createRecipe)
   * @returns {{ matches: boolean, violations: string[], warnings: string[] }}
   */
  verifyEnvironment(recipe) {
    if (!recipe || typeof recipe !== "object") {
      throw new ReproductionError(
        "REPRO_INVALID_RECIPE",
        "Cannot verify: invalid or missing recipe",
      );
    }

    const violations = [];
    const warnings = [];

    // 1. Check OS
    const currentOS = normalizeOS(os.platform());
    const recipeOS = recipe.os;
    if (recipeOS && currentOS !== recipeOS) {
      violations.push(
        `OS mismatch: recipe expects "${recipeOS}", current is "${currentOS}"`,
      );
    } else if (recipeOS) {
      // Same OS — different arch?
      const currentArch = os.arch();
      if (recipe.arch && currentArch !== recipe.arch) {
        warnings.push(
          `Architecture differs: recipe expects "${recipe.arch}", current is "${currentArch}"`,
        );
      }
    }

    // 2. Check Node version
    if (recipe.runtime && recipe.runtime.type === "node" && recipe.runtime.version) {
      const currentVersion = process.versions.node;
      const expectedMajor = recipe.runtime.version.replace(/^v/, "").split(".")[0];
      const currentMajor = currentVersion.split(".")[0];
      if (expectedMajor !== currentMajor) {
        violations.push(
          `Node major version mismatch: recipe expects v${expectedMajor}.x, current is ${currentVersion}`,
        );
      } else if (recipe.runtime.version !== currentVersion) {
        warnings.push(
          `Node minor/patch differs: recipe expects ${recipe.runtime.version}, current is ${currentVersion}`,
        );
      }
    }

    // 3. Check required packages
    if (Array.isArray(recipe.packages)) {
      for (const pkg of recipe.packages) {
        if (pkg.required) {
          const installed = isPackageInstalled(pkg.name);
          if (!installed) {
            violations.push(
              `Required package not installed: ${pkg.name}@${pkg.version}`,
            );
          }
        }
      }
    }

    // 4. Check required env vars
    if (recipe.envVars && typeof recipe.envVars === "object") {
      for (const [key, expectedVal] of Object.entries(recipe.envVars)) {
        const isRequired = key.startsWith("HAX_") || key.startsWith("REQUIRED_");
        const currentVal = process.env[key];
        if (isRequired && currentVal === undefined) {
          violations.push(
            `Required environment variable missing: ${key}`,
          );
        } else if (currentVal !== undefined && currentVal !== expectedVal) {
          warnings.push(
            `Environment variable ${key} differs: expected "${expectedVal}", got "${currentVal}"`,
          );
        }
      }
    }

    return {
      matches: violations.length === 0,
      violations,
      warnings,
    };
  }

  /**
   * Generate a Dockerfile from an environment descriptor.
   *
   * @param {object} environment — environment descriptor
   * @param {object} [options]
   * @param {string} [options.baseImage] — override base image
   * @param {number} [options.nodeVersion] — override Node version
   * @returns {string}
   */
  generateDockerfile(environment, options = {}) {
    if (!environment || typeof environment !== "object") {
      throw new ReproductionError(
        "REPRO_INVALID_ENV",
        "Cannot generate Dockerfile from null or invalid environment descriptor",
      );
    }

    const nodeVersion = options.nodeVersion ||
      (environment.node && environment.node.version) ||
      (environment.nodeVersion) ||
      process.versions.node;

    // Strip leading 'v' if present
    const nodeVerClean = String(nodeVersion).replace(/^v/, "");

    const baseImage = options.baseImage || "node:${nodeVerClean}-alpine";
    const resolvedBase = baseImage.replace("${nodeVerClean}", nodeVerClean);

    // Collect packages
    const packages = [];
    if (Array.isArray(environment.npmGlobal)) {
      packages.push(...environment.npmGlobal);
    }
    if (Array.isArray(environment.npmLocal)) {
      packages.push(...environment.npmLocal);
    }
    if (Array.isArray(environment.packages)) {
      packages.push(
        ...environment.packages
          .filter((p) => typeof p === "string")
          .map((p) => ({ name: p, version: "latest" })),
      );
    }

    // Env vars (safe ones)
    const envLines = [];
    if (environment.env && typeof environment.env === "object") {
      for (const [key, val] of Object.entries(environment.env)) {
        if (isSafeEnvVar(key)) {
          envLines.push(`ENV ${key}=${val}`);
        }
      }
    }

    const lines = [];
    lines.push(`# Generated by HaxAgent ReproductionEngine`);
    lines.push(`# Generated at: ${new Date().toISOString()}`);
    lines.push(`FROM ${resolvedBase}`);
    lines.push("");
    lines.push("WORKDIR /app");
    lines.push("");

    if (envLines.length > 0) {
      lines.push("# Environment variables");
      lines.push(...envLines);
      lines.push("");
    }

    if (packages.length > 0) {
      lines.push("# Install packages");
      const pkgNames = packages.map((p) => `${p.name}@${p.version || "latest"}`);
      lines.push(`RUN npm install -g ${pkgNames.join(" ")}`);
      lines.push("");
    }

    lines.push("COPY . .");
    lines.push("");
    lines.push('CMD ["node"]');

    return lines.join("\n");
  }

  /**
   * Generate a shell setup script (setup.sh for Unix, setup.ps1 for Windows).
   *
   * @param {object} environment — environment descriptor
   * @param {object} [options]
   * @param {string} [options.target] — "unix" or "windows" (default: auto-detect)
   * @param {boolean} [options.includeComments=true]
   * @returns {string}
   */
  generateSetupScript(environment, options = {}) {
    if (!environment || typeof environment !== "object") {
      throw new ReproductionError(
        "REPRO_INVALID_ENV",
        "Cannot generate setup script from null or invalid environment descriptor",
      );
    }

    const isWindows = options.target === "windows" ||
      (options.target !== "unix" && os.platform() === "win32");

    if (isWindows) {
      return generatePowerShell(environment, options);
    }
    return generateBash(environment, options);
  }

  /**
   * Generate a Nix flake from an environment descriptor.
   *
   * @param {object} environment — environment descriptor
   * @param {object} [options]
   * @param {string} [options.description] — flake description
   * @param {string[]} [options.systemPackages] — additional system packages
   * @returns {string}
   */
  generateNixFlake(environment, options = {}) {
    if (!environment || typeof environment !== "object") {
      throw new ReproductionError(
        "REPRO_INVALID_ENV",
        "Cannot generate Nix flake from null or invalid environment descriptor",
      );
    }

    const nodeVersionRaw = environment.nodeVersion || process.versions.node;
    const nodeVersion = nodeVersionRaw.replace(/^v/, "");
    const description = options.description ||
      `HaxAgent reproducible environment (Node ${nodeVersion})`;

    // Collect packages
    const npmPackages = [];
    if (Array.isArray(environment.npmGlobal)) {
      npmPackages.push(...environment.npmGlobal.map((p) => p.name));
    }
    if (Array.isArray(environment.packages)) {
      npmPackages.push(
        ...environment.packages
          .filter((p) => typeof p === "string")
          .map((p) => p),
      );
    }

    const systemPackages = options.systemPackages || [];
    // Derive sensible system packages from environment
    if (environment.pythonVersion) {
      systemPackages.push("python3");
    }

    const systemPkgLines = [...systemPackages, `nodejs_${nodeVersion.split(".")[0]}`]
      .map((p) => `            ${p}`)
      .join("\n");

    const flake = `
# Generated by HaxAgent ReproductionEngine
# Generated at: ${new Date().toISOString()}

{
  description = "${description}";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        nodePkgs = with pkgs; [
${systemPkgLines}
        ];
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = nodePkgs;

          shellHook = '''';
            echo "HaxAgent reproducible shell (Node ${nodeVersion})"
          '''';
        };
      }
    );
}
`.trim();

    return flake;
  }
}

// -- Internal helpers --------------------------------------------------------

/**
 * Heuristic check for whether an env var name is safe to include in a recipe
 * (not a secret/token).
 */
function isSafeEnvVar(name) {
  const upper = name.toUpperCase();
  const blocked = [
    "TOKEN", "SECRET", "KEY", "PASSWORD", "PASSPHRASE",
    "CREDENTIAL", "PRIVATE", "AUTH",
  ];
  return !blocked.some((w) => upper.includes(w));
}

/**
 * Generate setup steps for the recipe.
 */
function buildSetupSteps(osName, runtime, packages, envVars) {
  const steps = [];

  if (osName === "windows") {
    steps.push("Open PowerShell as Administrator");
    if (runtime.type === "node") {
      steps.push(
        `Install Node.js ${runtime.version} via nvm-windows or official installer`,
      );
    }
    for (const pkg of packages) {
      steps.push(`npm install -g ${pkg.name}@${pkg.version}`);
    }
    for (const [key, val] of Object.entries(envVars)) {
      steps.push(`setx ${key} "${val}"`);
    }
  } else {
    if (runtime.type === "node") {
      steps.push(
        `Install Node.js ${runtime.version} (nvm recommended)`,
      );
      steps.push(`nvm install ${runtime.version}`);
      steps.push(`nvm use ${runtime.version}`);
    }
    for (const pkg of packages) {
      steps.push(`npm install -g ${pkg.name}@${pkg.version}`);
    }
    for (const [key, val] of Object.entries(envVars)) {
      steps.push(`export ${key}="${val}"`);
    }
  }

  return steps;
}

/**
 * Quick check if a package is globally installed (best-effort).
 */
function isPackageInstalled(name) {
  try {
    require.resolve(name);
    return true;
  } catch (_) {
    return false;
  }
}

// -- Script generators -------------------------------------------------------

function generateBash(environment, options) {
  const inc = options.includeComments !== false;
  const nodeVersion = environment.nodeVersion || process.versions.node;
  const lines = [];

  if (inc) {
    lines.push("#!/usr/bin/env bash");
    lines.push("# Generated by HaxAgent ReproductionEngine");
    lines.push(`# Generated at: ${new Date().toISOString()}`);
    lines.push("set -euo pipefail");
    lines.push("");
  }

  // Node
  lines.push("# Install Node.js");
  lines.push(`NODE_VERSION="${nodeVersion}"`);
  lines.push("if command -v nvm &> /dev/null; then");
  lines.push("  nvm install \"$NODE_VERSION\"");
  lines.push("  nvm use \"$NODE_VERSION\"");
  lines.push("elif command -v fnm &> /dev/null; then");
  lines.push("  fnm install \"$NODE_VERSION\"");
  lines.push("  fnm use \"$NODE_VERSION\"");
  lines.push("else");
  lines.push("  echo 'Warning: nvm or fnm not found. Please install Node.js manually.'");
  lines.push("fi");
  lines.push("");

  // Packages
  const packages = [];
  if (Array.isArray(environment.npmGlobal)) packages.push(...environment.npmGlobal);
  if (Array.isArray(environment.packages)) {
    for (const p of environment.packages) {
      if (typeof p === "string") packages.push({ name: p, version: "latest" });
    }
  }
  if (packages.length > 0) {
    lines.push("# Install global packages");
    for (const pkg of packages) {
      lines.push(`npm install -g ${pkg.name}@${pkg.version || "latest"}`);
    }
    lines.push("");
  }

  // Env vars
  if (environment.env && typeof environment.env === "object") {
    const safe = Object.entries(environment.env).filter(([k]) => isSafeEnvVar(k));
    if (safe.length > 0) {
      lines.push("# Environment variables");
      for (const [key, val] of safe) {
        lines.push(`export ${key}="${val}"`);
      }
      lines.push("");
    }
  }

  if (inc) {
    lines.push("echo 'HaxAgent environment setup complete.'");
  }

  return lines.join("\n");
}

function generatePowerShell(environment, options) {
  const inc = options.includeComments !== false;
  const nodeVersion = environment.nodeVersion || process.versions.node;
  const lines = [];

  if (inc) {
    lines.push("# Generated by HaxAgent ReproductionEngine");
    lines.push(`# Generated at: ${new Date().toISOString()}`);
    lines.push("");
  }

  lines.push("# Install Node.js");
  lines.push(`$nodeVersion = "${nodeVersion}"`);
  lines.push("if (Get-Command nvm -ErrorAction SilentlyContinue) {");
  lines.push("  nvm install $nodeVersion");
  lines.push("  nvm use $nodeVersion");
  lines.push("} elseif (Get-Command fnm -ErrorAction SilentlyContinue) {");
  lines.push("  fnm install $nodeVersion");
  lines.push("  fnm use $nodeVersion");
  lines.push("} else {");
  lines.push("  Write-Warning 'nvm-windows or fnm not found. Install Node.js manually.'");
  lines.push("}");
  lines.push("");

  // Packages
  const packages = [];
  if (Array.isArray(environment.npmGlobal)) packages.push(...environment.npmGlobal);
  if (Array.isArray(environment.packages)) {
    for (const p of environment.packages) {
      if (typeof p === "string") packages.push({ name: p, version: "latest" });
    }
  }
  if (packages.length > 0) {
    lines.push("# Install global packages");
    for (const pkg of packages) {
      lines.push(`npm install -g ${pkg.name}@${pkg.version || "latest"}`);
    }
    lines.push("");
  }

  // Env vars
  if (environment.env && typeof environment.env === "object") {
    const safe = Object.entries(environment.env).filter(([k]) => isSafeEnvVar(k));
    if (safe.length > 0) {
      lines.push("# Environment variables");
      for (const [key, val] of safe) {
        lines.push(`$env:${key} = "${val}"`);
        lines.push(`[Environment]::SetEnvironmentVariable("${key}", "${val}", "User")`);
      }
      lines.push("");
    }
  }

  if (inc) {
    lines.push("Write-Host 'HaxAgent environment setup complete.'");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------

module.exports = { ReproductionEngine, ReproductionError };
