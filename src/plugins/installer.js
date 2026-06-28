"use strict";

/**
 * Plugin Installer - download, install, update, and uninstall plugins.
 * Ported from OpenHarness plugins/installer.py pattern.
 *
 * Supports:
 * - Local directory installation
 * - Git repository cloning
 * - NPM package installation (plugins published as npm packages)
 * - Version checking and updates
 * - Dependency resolution
 * - Install/uninstall lifecycle
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { validatePluginManifest, securityAudit } = require("./schema");

// === Plugin Installer ===

class PluginInstaller {
  constructor(options = {}) {
    this._pluginsDir = options.pluginsDir || path.join(
      process.env.HOME || process.env.USERPROFILE || ".",
      ".haxagent", "plugins"
    );
    this._registry = options.registry || [];
  }

  /**
   * Install a plugin from a local directory.
   * @param {string} sourceDir - path to plugin directory containing plugin.json
   * @param {Object} options
   * @param {boolean} [options.trust=false] - trust the plugin (skip security warnings)
   * @returns {Object} { ok, plugin, warnings }
   */
  installFromDir(sourceDir, options = {}) {
    if (!fs.existsSync(sourceDir)) {
      return { ok: false, error: `Source directory not found: ${sourceDir}` };
    }

    const manifestPath = path.join(sourceDir, "plugin.json");
    if (!fs.existsSync(manifestPath)) {
      return { ok: false, error: `No plugin.json found in ${sourceDir}` };
    }

    // Parse manifest
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch (err) {
      return { ok: false, error: `Invalid plugin.json: ${err.message}` };
    }

    // Validate
    const validation = validatePluginManifest(manifest);
    if (!validation.valid) {
      return { ok: false, error: `Invalid manifest:\n${validation.toString()}`, validation };
    }

    // Security audit
    if (!options.trust) {
      const audit = securityAudit(manifest);
      if (audit.risk === "high") {
        return {
          ok: false,
          error: `Plugin has high security risk:\n${audit.reasons.join("\n")}\nUse {trust: true} to install anyway.`,
          audit,
        };
      }
    }

    // Target directory
    const pluginName = manifest.name;
    const targetDir = path.join(this._pluginsDir, pluginName);

    // Check if already installed
    if (fs.existsSync(targetDir)) {
      return {
        ok: false,
        error: `Plugin "${pluginName}" already installed. Use update() to upgrade.`,
        installed: true,
      };
    }

    try {
      // Copy files
      this._copyDir(sourceDir, targetDir);

      // Install NPM dependencies if specified
      if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
        this._installNpmDeps(targetDir, manifest.dependencies);
      }

      // Register in installed list
      this._registerPlugin(manifest);

      return {
        ok: true,
        plugin: { name: pluginName, version: manifest.version, path: targetDir },
        warnings: validation.warnings.length ? validation.warnings : null,
      };
    } catch (err) {
      // Clean up on failure
      try { this._removeDir(targetDir); } catch (_) {}
      return { ok: false, error: `Install failed: ${err.message}` };
    }
  }

  /**
   * Install a plugin from a git repository.
   * @param {string} repoUrl - git URL
   * @param {Object} options
   * @returns {Object}
   */
  installFromGit(repoUrl, options = {}) {
    const tmpDir = path.join(this._pluginsDir, ".tmp", `clone_${Date.now().toString(36)}`);

    try {
      if (!fs.existsSync(path.dirname(tmpDir))) {
        fs.mkdirSync(path.dirname(tmpDir), { recursive: true });
      }

      // Clone
      const branch = options.branch || "main";
      execSync(`git clone --depth 1 --branch ${branch} ${repoUrl} "${tmpDir}"`, {
        encoding: "utf-8", timeout: 60000, stdio: "pipe",
      });

      // Install from cloned dir
      const result = this.installFromDir(tmpDir, options);

      // Cleanup tmp
      this._removeDir(tmpDir);

      return result;
    } catch (err) {
      try { this._removeDir(tmpDir); } catch (_) {}
      return { ok: false, error: `Git install failed: ${err.message}` };
    }
  }

  /**
   * Install a plugin from an NPM package.
   * @param {string} packageName - npm package name
   * @param {Object} options
   * @returns {Object}
   */
  installFromNpm(packageName, options = {}) {
    const targetDir = path.join(this._pluginsDir, packageName.replace("/", "-"));

    try {
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

      // npm install into target dir (package only, no deps of deps)
      execSync(`npm install ${packageName} --prefix "${targetDir}" --no-save`, {
        encoding: "utf-8", timeout: 120000, stdio: "pipe",
      });

      // Find plugin.json in node_modules
      const pkgDir = path.join(targetDir, "node_modules", packageName);
      if (!fs.existsSync(pkgDir)) {
        throw new Error("Package installed but plugin directory not found");
      }

      return this.installFromDir(pkgDir, options);
    } catch (err) {
      try { this._removeDir(targetDir); } catch (_) {}
      return { ok: false, error: `NPM install failed: ${err.message}` };
    }
  }

  /**
   * Uninstall a plugin by name.
   * @param {string} name
   * @returns {Object}
   */
  uninstall(name) {
    const targetDir = path.join(this._pluginsDir, name);

    if (!fs.existsSync(targetDir)) {
      return { ok: false, error: `Plugin "${name}" not installed` };
    }

    try {
      // Read manifest for cleanup info
      const manifestPath = path.join(targetDir, "plugin.json");
      let manifest = null;
      if (fs.existsSync(manifestPath)) {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      }

      // Remove directory
      this._removeDir(targetDir);

      // Remove from registry
      this._unregisterPlugin(name);

      return { ok: true, name, removed: true };
    } catch (err) {
      return { ok: false, error: `Uninstall failed: ${err.message}` };
    }
  }

  /**
   * Update a plugin to the latest version.
   * @param {string} name
   * @returns {Object}
   */
  update(name) {
    const targetDir = path.join(this._pluginsDir, name);

    if (!fs.existsSync(targetDir)) {
      return { ok: false, error: `Plugin "${name}" not installed` };
    }

    // Check if it's a git repo
    const gitDir = path.join(targetDir, ".git");
    if (fs.existsSync(gitDir)) {
      try {
        execSync("git pull", { cwd: targetDir, encoding: "utf-8", timeout: 30000 });
        return { ok: true, name, updated: true, method: "git pull" };
      } catch (err) {
        return { ok: false, error: `Git pull failed: ${err.message}` };
      }
    }

    return { ok: false, error: "Update not supported for this plugin (not a git repo). Reinstall to update." };
  }

  /**
   * List all installed plugins with their manifests.
   * @returns {Array}
   */
  list() {
    if (!fs.existsSync(this._pluginsDir)) return [];

    try {
      const dirs = fs.readdirSync(this._pluginsDir);
      return dirs
        .filter((d) => {
          const mp = path.join(this._pluginsDir, d, "plugin.json");
          return fs.existsSync(mp);
        })
        .map((d) => {
          try {
            const manifest = JSON.parse(
              fs.readFileSync(path.join(this._pluginsDir, d, "plugin.json"), "utf-8")
            );
            return {
              name: manifest.name || d,
              version: manifest.version || "0.0.0",
              description: manifest.description || "",
              path: path.join(this._pluginsDir, d),
              trust: manifest.haxAgent?.trust || null,
            };
          } catch (_) {
            return { name: d, version: "unknown", description: "" };
          }
        });
    } catch (_) {
      return [];
    }
  }

  /**
   * Check if a plugin is installed.
   */
  isInstalled(name) {
    return fs.existsSync(path.join(this._pluginsDir, name, "plugin.json"));
  }

  // === Private ===

  _copyDir(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules and .git
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        this._copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  _removeDir(dir) {
    if (!fs.existsSync(dir)) return;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  _installNpmDeps(targetDir, deps) {
    const depList = Object.entries(deps).map(([name, ver]) => `${name}@${ver}`).join(" ");
    execSync(`npm install ${depList} --prefix "${targetDir}" --no-save --production`, {
      encoding: "utf-8", timeout: 120000, stdio: "pipe",
    });
  }

  _registerPlugin(manifest) {
    const regPath = path.join(this._pluginsDir, "installed.json");
    let installed = [];
    if (fs.existsSync(regPath)) {
      try { installed = JSON.parse(fs.readFileSync(regPath, "utf-8")); } catch (_) {}
    }
    installed.push({
      name: manifest.name,
      version: manifest.version,
      installedAt: new Date().toISOString(),
      source: manifest.repository || "local",
    });
    fs.writeFileSync(regPath, JSON.stringify(installed, null, 2));
  }

  _unregisterPlugin(name) {
    const regPath = path.join(this._pluginsDir, "installed.json");
    if (!fs.existsSync(regPath)) return;
    try {
      const installed = JSON.parse(fs.readFileSync(regPath, "utf-8"));
      const filtered = installed.filter((p) => p.name !== name);
      fs.writeFileSync(regPath, JSON.stringify(filtered, null, 2));
    } catch (_) {}
  }
}

module.exports = { PluginInstaller };
