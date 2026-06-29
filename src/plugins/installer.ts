/**
 * Plugin Installer - download, install, update, and uninstall plugins.
 * Ported from OpenHarness plugins/installer.py pattern.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { validatePluginManifest, securityAudit } from "./schema.js";

interface PluginInstallerOptions {
  pluginsDir?: string;
  registry?: unknown[];
}

interface InstallOptions {
  trust?: boolean;
  branch?: string;
}

interface InstallResult {
  ok: boolean;
  error?: string;
  validation?: unknown;
  audit?: unknown;
  installed?: boolean;
  plugin?: { name: string; version: string; path: string };
  warnings?: unknown[] | null;
  name?: string;
  removed?: boolean;
  updated?: boolean;
  method?: string;
}

interface InstalledPlugin {
  name: string;
  version: string;
  description: string;
  path: string;
  trust?: unknown;
}

interface InstalledRecord {
  name: string;
  version: string;
  installedAt: string;
  source: string;
}

interface PluginManifestRaw {
  name?: string;
  version?: string;
  description?: string;
  dependencies?: Record<string, string>;
  haxAgent?: { trust?: unknown };
  repository?: string;
  [key: string]: unknown;
}

// === Plugin Installer ===

class PluginInstaller {
  private _pluginsDir: string;
  private _registry: unknown[];

  constructor(options: PluginInstallerOptions = {}) {
    this._pluginsDir = options.pluginsDir || path.join(
      process.env.HOME || process.env.USERPROFILE || ".",
      ".haxagent", "plugins"
    );
    this._registry = options.registry || [];
  }

  /**
   * Install a plugin from a local directory.
   */
  installFromDir(sourceDir: string, options: InstallOptions = {}): InstallResult {
    if (!fs.existsSync(sourceDir)) {
      return { ok: false, error: `Source directory not found: ${sourceDir}` };
    }

    const manifestPath = path.join(sourceDir, "plugin.json");
    if (!fs.existsSync(manifestPath)) {
      return { ok: false, error: `No plugin.json found in ${sourceDir}` };
    }

    let manifest: PluginManifestRaw;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as PluginManifestRaw;
    } catch (err) {
      return { ok: false, error: `Invalid plugin.json: ${(err as Error).message}` };
    }

    const validation = validatePluginManifest(manifest);
    if (!validation.valid) {
      return { ok: false, error: `Invalid manifest:\n${validation.toString()}`, validation };
    }

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

    const pluginName = manifest.name!;
    const targetDir = path.join(this._pluginsDir, pluginName);

    if (fs.existsSync(targetDir)) {
      return {
        ok: false,
        error: `Plugin "${pluginName}" already installed. Use update() to upgrade.`,
        installed: true,
      };
    }

    try {
      this._copyDir(sourceDir, targetDir);

      if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
        this._installNpmDeps(targetDir, manifest.dependencies);
      }

      this._registerPlugin(manifest);

      return {
        ok: true,
        plugin: { name: pluginName, version: manifest.version || "0.0.0", path: targetDir },
        warnings: validation.warnings.length ? validation.warnings : null,
      };
    } catch (err) {
      try { this._removeDir(targetDir); } catch (_) {}
      return { ok: false, error: `Install failed: ${(err as Error).message}` };
    }
  }

  /**
   * Install a plugin from a git repository.
   */
  installFromGit(repoUrl: string, options: InstallOptions = {}): InstallResult {
    const tmpDir = path.join(this._pluginsDir, ".tmp", `clone_${Date.now().toString(36)}`);

    try {
      if (!fs.existsSync(path.dirname(tmpDir))) {
        fs.mkdirSync(path.dirname(tmpDir), { recursive: true });
      }

      const branch = options.branch || "main";
      execSync(`git clone --depth 1 --branch ${branch} ${repoUrl} "${tmpDir}"`, {
        encoding: "utf-8", timeout: 60000, stdio: "pipe",
      });

      const result = this.installFromDir(tmpDir, options);
      this._removeDir(tmpDir);
      return result;
    } catch (err) {
      try { this._removeDir(tmpDir); } catch (_) {}
      return { ok: false, error: `Git install failed: ${(err as Error).message}` };
    }
  }

  /**
   * Install a plugin from an NPM package.
   */
  installFromNpm(packageName: string, options: InstallOptions = {}): InstallResult {
    const targetDir = path.join(this._pluginsDir, packageName.replace("/", "-"));

    try {
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

      execSync(`npm install ${packageName} --prefix "${targetDir}" --no-save`, {
        encoding: "utf-8", timeout: 120000, stdio: "pipe",
      });

      const pkgDir = path.join(targetDir, "node_modules", packageName);
      if (!fs.existsSync(pkgDir)) {
        throw new Error("Package installed but plugin directory not found");
      }

      return this.installFromDir(pkgDir, options);
    } catch (err) {
      try { this._removeDir(targetDir); } catch (_) {}
      return { ok: false, error: `NPM install failed: ${(err as Error).message}` };
    }
  }

  /**
   * Uninstall a plugin by name.
   */
  uninstall(name: string): InstallResult {
    const targetDir = path.join(this._pluginsDir, name);

    if (!fs.existsSync(targetDir)) {
      return { ok: false, error: `Plugin "${name}" not installed` };
    }

    try {
      this._removeDir(targetDir);
      this._unregisterPlugin(name);
      return { ok: true, name, removed: true };
    } catch (err) {
      return { ok: false, error: `Uninstall failed: ${(err as Error).message}` };
    }
  }

  /**
   * Update a plugin to the latest version.
   */
  update(name: string): InstallResult {
    const targetDir = path.join(this._pluginsDir, name);

    if (!fs.existsSync(targetDir)) {
      return { ok: false, error: `Plugin "${name}" not installed` };
    }

    const gitDir = path.join(targetDir, ".git");
    if (fs.existsSync(gitDir)) {
      try {
        execSync("git pull", { cwd: targetDir, encoding: "utf-8", timeout: 30000 });
        return { ok: true, name, updated: true, method: "git pull" };
      } catch (err) {
        return { ok: false, error: `Git pull failed: ${(err as Error).message}` };
      }
    }

    return { ok: false, error: "Update not supported for this plugin (not a git repo). Reinstall to update." };
  }

  /**
   * List all installed plugins with their manifests.
   */
  list(): InstalledPlugin[] {
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
            ) as PluginManifestRaw;
            return {
              name: manifest.name || d,
              version: manifest.version || "0.0.0",
              description: manifest.description || "",
              path: path.join(this._pluginsDir, d),
              trust: manifest.haxAgent?.trust || null,
            };
          } catch (_) {
            return { name: d, version: "unknown", description: "", path: path.join(this._pluginsDir, d) };
          }
        });
    } catch (_) {
      return [];
    }
  }

  /**
   * Check if a plugin is installed.
   */
  isInstalled(name: string): boolean {
    return fs.existsSync(path.join(this._pluginsDir, name, "plugin.json"));
  }

  // === Private ===

  private _copyDir(src: string, dest: string): void {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        this._copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  private _removeDir(dir: string): void {
    if (!fs.existsSync(dir)) return;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  private _installNpmDeps(targetDir: string, deps: Record<string, string>): void {
    const depList = Object.entries(deps).map(([name, ver]) => `${name}@${ver}`).join(" ");
    execSync(`npm install ${depList} --prefix "${targetDir}" --no-save --production`, {
      encoding: "utf-8", timeout: 120000, stdio: "pipe",
    });
  }

  private _registerPlugin(manifest: PluginManifestRaw): void {
    const regPath = path.join(this._pluginsDir, "installed.json");
    let installed: InstalledRecord[] = [];
    if (fs.existsSync(regPath)) {
      try { installed = JSON.parse(fs.readFileSync(regPath, "utf-8")) as InstalledRecord[]; } catch (_) {}
    }
    installed.push({
      name: manifest.name || "",
      version: manifest.version || "0.0.0",
      installedAt: new Date().toISOString(),
      source: manifest.repository || "local",
    });
    fs.writeFileSync(regPath, JSON.stringify(installed, null, 2));
  }

  private _unregisterPlugin(name: string): void {
    const regPath = path.join(this._pluginsDir, "installed.json");
    if (!fs.existsSync(regPath)) return;
    try {
      const installed = JSON.parse(fs.readFileSync(regPath, "utf-8")) as InstalledRecord[];
      const filtered = installed.filter((p) => p.name !== name);
      fs.writeFileSync(regPath, JSON.stringify(filtered, null, 2));
    } catch (_) {}
  }
}

export { PluginInstaller };
