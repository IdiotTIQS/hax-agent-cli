"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

/**
 * Dev Tooling: Project Init
 *
 * Utilities for initializing a HaxAgent project structure, verifying
 * project validity, and reading project metadata.
 */

const HAX_DIR = ".hax-agent";

const DEFAULT_CONFIG = {
  agent: {
    name: "hax-agent",
    model: "claude-sonnet-4-20250514",
    maxTurns: 20,
    temperature: 0.2,
  },
  memory: {
    enabled: true,
    maxItems: 20,
  },
  sessions: {
    transcriptLimit: 100,
  },
  context: {
    enabled: true,
    reserveOutputTokens: 8192,
  },
  fileContext: {
    enabled: true,
    maxFiles: 8,
    maxIndexFiles: 2000,
  },
  permissions: {
    mode: "normal",
  },
};

const DEFAULT_GITIGNORE_ENTRIES = [
  "",
  "# Hax Agent",
  ".hax-agent/sessions/",
  ".hax-agent/logs/",
  ".hax-agent/memory/",
];

// ── Project Init ─────────────────────────────────────────────────────────────

/**
 * Initialize a HaxAgent project in the given directory.
 *
 * Creates `.hax-agent/` with subdirectories (plugins, skills, sessions,
 * logs, memory), a default config.json, and appends entries to .gitignore
 * if present.
 *
 * @param {string} dir - Project root directory
 * @param {object} [options] - Options
 * @param {object} [options.config] - Custom config overrides (merged with defaults)
 * @param {boolean} [options.force] - Overwrite existing config
 * @param {boolean} [options.skipGitignore] - Do not modify .gitignore
 * @returns {{ created: string[], skipped: string[], configPath: string }}
 */
function initProject(dir, options = {}) {
  const root = path.resolve(dir);
  const created = [];
  const skipped = [];

  // Create .hax-agent directory
  const haxDir = path.join(root, HAX_DIR);
  if (!fs.existsSync(haxDir)) {
    fs.mkdirSync(haxDir, { recursive: true });
    created.push(haxDir);
  }

  // Sub-directories
  const subdirs = ["plugins", "skills", "sessions", "logs", "memory"];
  for (const sub of subdirs) {
    const subPath = path.join(haxDir, sub);
    if (!fs.existsSync(subPath)) {
      fs.mkdirSync(subPath, { recursive: true });
      created.push(subPath);
    } else {
      skipped.push(subPath);
    }
  }

  // Default config
  const configPath = path.join(haxDir, "config.json");
  const mergedConfig = deepMerge(DEFAULT_CONFIG, options.config || {});
  if (fs.existsSync(configPath) && !options.force) {
    skipped.push(configPath);
  } else {
    fs.writeFileSync(configPath, JSON.stringify(mergedConfig, null, 2) + "\n", "utf-8");
    created.push(configPath);
  }

  // .gitignore entries
  if (!options.skipGitignore) {
    const gitignorePath = path.join(root, ".gitignore");
    appendGitignore(gitignorePath, DEFAULT_GITIGNORE_ENTRIES, created);
  }

  return { created, skipped, configPath };
}

// ── Verify Project ───────────────────────────────────────────────────────────

/**
 * Check that a project directory has a valid HaxAgent structure.
 *
 * @param {string} dir - Project root directory
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function verifyProject(dir) {
  const root = path.resolve(dir);
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(root)) {
    errors.push(`Project directory does not exist: ${root}`);
    return { valid: false, errors, warnings };
  }

  if (!fs.statSync(root).isDirectory()) {
    errors.push(`Path is not a directory: ${root}`);
    return { valid: false, errors, warnings };
  }

  // Check .hax-agent directory
  const haxDir = path.join(root, HAX_DIR);
  if (!fs.existsSync(haxDir)) {
    errors.push(`Missing ${HAX_DIR}/ directory. Run project init first.`);
    return { valid: false, errors, warnings };
  }

  if (!fs.statSync(haxDir).isDirectory()) {
    errors.push(`${HAX_DIR} is not a directory.`);
    return { valid: false, errors, warnings };
  }

  // Check config.json
  const configPath = path.join(haxDir, "config.json");
  if (!fs.existsSync(configPath)) {
    warnings.push("Missing config.json in .hax-agent/");
  } else {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      JSON.parse(raw);
    } catch (err) {
      errors.push(`config.json is invalid JSON: ${err.message}`);
    }
  }

  // Check expected subdirs
  const expectedSubdirs = ["plugins", "skills", "sessions", "logs", "memory"];
  for (const sub of expectedSubdirs) {
    const subPath = path.join(haxDir, sub);
    if (!fs.existsSync(subPath)) {
      warnings.push(`Missing sub-directory: ${HAX_DIR}/${sub}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ── Project Info ─────────────────────────────────────────────────────────────

/**
 * Read project metadata from a HaxAgent project directory.
 *
 * @param {string} dir - Project root directory
 * @returns {{ name: string, type: string, git: object|null, haxAgentVersion: string|null, config: object|null }}
 */
function getProjectInfo(dir) {
  const root = path.resolve(dir);

  // Project name from directory or package.json
  let name = path.basename(root);
  let type = "unknown";
  let haxAgentVersion = null;
  let config = null;

  // Check package.json
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.name) name = pkg.name;
      if (pkg.private) type = "private";
      if (pkg.dependencies && pkg.dependencies["hax-agent"]) {
        haxAgentVersion = pkg.dependencies["hax-agent"];
      }
      if (pkg.devDependencies && pkg.devDependencies["hax-agent"]) {
        haxAgentVersion = pkg.devDependencies["hax-agent"];
      }
    } catch (_) { /* ignore invalid package.json */ }
  }

  // Determine project type from common markers
  if (type === "unknown") {
    if (fs.existsSync(path.join(root, "package.json"))) {
      type = "node";
    }
    if (fs.existsSync(path.join(root, "tsconfig.json"))) {
      type = "typescript";
    }
    if (fs.existsSync(path.join(root, "Cargo.toml"))) {
      type = "rust";
    }
    if (fs.existsSync(path.join(root, "go.mod"))) {
      type = "go";
    }
    if (fs.existsSync(path.join(root, "requirements.txt")) || fs.existsSync(path.join(root, "pyproject.toml"))) {
      type = "python";
    }
  }

  // Load HaxAgent config
  const configPath = path.join(root, HAX_DIR, "config.json");
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (_) { /* ignore */ }
  }

  // Git info
  const git = getGitInfo(root);

  return {
    name,
    type,
    git,
    haxAgentVersion,
    config,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deep-merge two plain objects (source into target).
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const [key, val] of Object.entries(source)) {
    if (isPlainObject(val) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], val);
    } else {
      result[key] = val;
    }
  }

  return result;
}

function isPlainObject(val) {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

/**
 * Append entries to .gitignore if they are not already present.
 */
function appendGitignore(gitignorePath, entries, created) {
  let existing = "";
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, "utf-8");
  }

  const lines = existing.split(/\r?\n/);
  const toAdd = entries.filter((entry) => {
    // Skip empty lines — they are only for formatting
    if (entry.trim() === "") {
      return !lines.includes("");
    }
    return !lines.some((line) => line.trim() === entry.trim());
  });

  if (toAdd.length > 0) {
    const content = existing.endsWith("\n") ? existing : existing + (existing.length > 0 ? "\n" : "");
    fs.writeFileSync(gitignorePath, content + toAdd.join("\n") + "\n", "utf-8");
    created.push(gitignorePath);
  }
}

/**
 * Read git info for a directory.
 */
function getGitInfo(root) {
  try {
    const gitDir = path.join(root, ".git");
    if (!fs.existsSync(gitDir)) return null;

    let branch = null;
    let remoteUrl = null;
    let lastCommit = null;

    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: root,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch (_) { /* not a git repo or no commits */ }

    try {
      remoteUrl = execSync("git remote get-url origin", {
        cwd: root,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch (_) { /* no origin remote */ }

    try {
      lastCommit = execSync("git log -1 --format=%H", {
        cwd: root,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch (_) { /* no commits */ }

    return { branch: branch || null, remoteUrl: remoteUrl || null, lastCommit: lastCommit || null };
  } catch (_) {
    return null;
  }
}

module.exports = {
  initProject,
  verifyProject,
  getProjectInfo,
  HAX_DIR,
  DEFAULT_CONFIG,
};
