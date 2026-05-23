"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Recognized monorepo tool configs at the root level
const MONOREPO_CONFIG_FILES = [
  "pnpm-workspace.yaml",
  "lerna.json",
  "nx.json",
  "turbo.json",
  "rush.json",
];

const PACKAGE_JSON = "package.json";
const WORKSPACE_ARRAY_KEYS = ["workspaces", "packages"];

/**
 * Manages monorepo workspace structures, supporting npm workspaces,
 * pnpm, yarn workspaces, lerna, nx, and turborepo.
 */
class MonorepoManager {
  /**
   * @param {string} root - Monorepo root directory
   */
  constructor(root) {
    this.root = path.resolve(root);
  }

  // ── Detection ────────────────────────────────────────────

  /**
   * Detect whether a directory is a monorepo and which tool it uses.
   * @param {string} [root] - Directory to check (defaults to constructor root)
   * @returns {object} detection result with type and config details
   */
  detectMonorepo(root) {
    const resolved = root ? path.resolve(root) : this.root;

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return { isMonorepo: false, type: null, configFile: null, root: resolved };
    }

    const rootPkg = this._readJson(path.join(resolved, PACKAGE_JSON));

    // Check dedicated monorepo config files first
    if (fs.existsSync(path.join(resolved, "pnpm-workspace.yaml"))) {
      return {
        isMonorepo: true,
        type: "pnpm",
        configFile: "pnpm-workspace.yaml",
        root: resolved,
      };
    }

    if (fs.existsSync(path.join(resolved, "lerna.json"))) {
      return {
        isMonorepo: true,
        type: "lerna",
        configFile: "lerna.json",
        root: resolved,
      };
    }

    if (fs.existsSync(path.join(resolved, "nx.json"))) {
      return {
        isMonorepo: true,
        type: "nx",
        configFile: "nx.json",
        root: resolved,
        projectJsonPattern: this._getNxWorkspacePattern(resolved),
      };
    }

    if (fs.existsSync(path.join(resolved, "turbo.json"))) {
      return {
        isMonorepo: true,
        type: "turborepo",
        configFile: "turbo.json",
        root: resolved,
      };
    }

    if (fs.existsSync(path.join(resolved, "rush.json"))) {
      return {
        isMonorepo: true,
        type: "rush",
        configFile: "rush.json",
        root: resolved,
      };
    }

    // Check for npm/yarn workspaces via package.json
    if (rootPkg && this._hasWorkspaceField(rootPkg)) {
      const type = fs.existsSync(path.join(resolved, "yarn.lock"))
        ? "yarn"
        : fs.existsSync(path.join(resolved, "pnpm-lock.yaml"))
          ? "pnpm"
          : "npm";

      return {
        isMonorepo: true,
        type,
        configFile: PACKAGE_JSON,
        workspacesKey: rootPkg.workspaces ? "workspaces" : "workspaces.packages",
        root: resolved,
      };
    }

    // Heuristic: packages/ directory with package.json files
    const packagesDir = path.join(resolved, "packages");
    if (fs.existsSync(packagesDir) && fs.statSync(packagesDir).isDirectory()) {
      const subs = this._listDirectories(packagesDir);
      const hasSubPackages = subs.some((s) =>
        fs.existsSync(path.join(packagesDir, s, PACKAGE_JSON)),
      );
      if (hasSubPackages) {
        return {
          isMonorepo: true,
          type: "heuristic",
          configFile: null,
          pattern: "packages/*",
          root: resolved,
        };
      }
    }

    const appsDir = path.join(resolved, "apps");
    if (fs.existsSync(appsDir) && fs.statSync(appsDir).isDirectory()) {
      const subs = this._listDirectories(appsDir);
      const hasSubApps = subs.some((s) =>
        fs.existsSync(path.join(appsDir, s, PACKAGE_JSON)),
      );
      if (hasSubApps) {
        return {
          isMonorepo: true,
          type: "heuristic",
          configFile: null,
          pattern: "apps/*",
          root: resolved,
        };
      }
    }

    return { isMonorepo: false, type: null, configFile: null, root: resolved };
  }

  // ── Workspace listing ─────────────────────────────────────

  /**
   * List all workspaces (packages) in the monorepo.
   * Supports npm, pnpm, yarn, lerna, nx, turborepo.
   * @param {string} [root] - Monorepo root
   * @returns {Array<object>} array of workspace entries with name, path, version
   */
  getWorkspaces(root) {
    const resolved = root ? path.resolve(root) : this.root;
    const detection = this.detectMonorepo(resolved);

    if (!detection.isMonorepo) {
      return [];
    }

    const workspaces = [];

    // Collect glob patterns from package.json workspaces field
    const rootPkg = this._readJson(path.join(resolved, PACKAGE_JSON));
    const patterns = this._getWorkspacePatterns(rootPkg, detection.type);

    // Collect packages from lerna.json
    if (detection.type === "lerna") {
      const lerna = this._readJson(path.join(resolved, "lerna.json"));
      if (lerna && lerna.packages && Array.isArray(lerna.packages)) {
        patterns.push(...lerna.packages);
      }
    }

    // Collect packages from nx.json project.json pattern
    if (detection.type === "nx") {
      patterns.push("packages/*", "apps/*", "libs/*", "tools/*");
    }

    // Collect from turbine
    if (detection.type === "turborepo") {
      patterns.push("apps/*", "packages/*");
    }

    // Default patterns if nothing else found
    if (patterns.length === 0) {
      patterns.push("packages/*", "apps/*");
    }

    // Deduplicate
    const uniquePatterns = [...new Set(patterns)];

    for (const pattern of uniquePatterns) {
      const matches = this._expandGlobPattern(resolved, pattern);
      for (const match of matches) {
        const pkgJson = this._readJson(path.join(resolved, match, PACKAGE_JSON));
        if (pkgJson && pkgJson.name) {
          workspaces.push({
            name: pkgJson.name,
            path: path.join(resolved, match),
            relativePath: match,
            version: pkgJson.version || "0.0.0",
            private: !!pkgJson.private,
            dependencies: pkgJson.dependencies || {},
            devDependencies: pkgJson.devDependencies || {},
            peerDependencies: pkgJson.peerDependencies || {},
          });
        }
      }
    }

    return workspaces;
  }

  // ── Dependency graph ──────────────────────────────────────

  /**
   * Build a cross-package dependency graph for all workspaces.
   * @param {string} [root] - Monorepo root
   * @returns {object} adjacency map of package -> dependent packages
   */
  getDependencyGraph(root) {
    const resolved = root ? path.resolve(root) : this.root;
    const workspaces = this.getWorkspaces(resolved);

    // Build a name -> workspace map
    const nameMap = new Map();
    for (const ws of workspaces) {
      nameMap.set(ws.name, ws);
    }

    // Build adjacency: for each package, list which other workspace
    // packages it depends on (its internal dependencies)
    const graph = Object.create(null);

    for (const ws of workspaces) {
      graph[ws.name] = graph[ws.name] || [];
      const allDeps = {
        ...ws.dependencies,
        ...ws.devDependencies,
        ...ws.peerDependencies,
      };

      for (const depName of Object.keys(allDeps)) {
        if (nameMap.has(depName)) {
          graph[ws.name].push(depName);
        }
      }
    }

    // Also build reverse adjacency (dependents)
    const reverse = Object.create(null);
    for (const ws of workspaces) {
      reverse[ws.name] = reverse[ws.name] || [];
    }
    for (const [pkg, deps] of Object.entries(graph)) {
      for (const dep of deps) {
        if (reverse[dep]) {
          reverse[dep].push(pkg);
        }
      }
    }

    return {
      root: resolved,
      packages: workspaces.map((w) => w.name),
      dependencies: graph,
      dependents: reverse,
    };
  }

  // ── Affected packages ─────────────────────────────────────

  /**
   * Determine which packages are affected by a set of changed files.
   * Uses the dependency graph to find both directly changed packages
   * and their transitive dependents.
   * @param {string[]} changedFiles - Array of changed file paths (relative to root)
   * @param {string} [root] - Monorepo root
   * @returns {string[]} names of affected packages in topological order
   */
  getAffectedPackages(changedFiles, root) {
    const resolved = root ? path.resolve(root) : this.root;
    const graph = this.getDependencyGraph(resolved);
    const workspaces = this.getWorkspaces(resolved);

    // Map workspace name to its relative path
    const wsPathMap = new Map();
    for (const ws of workspaces) {
      wsPathMap.set(ws.name, ws.relativePath);
    }

    // Find directly affected packages (files changed inside their directory)
    const directlyAffected = new Set();

    for (const file of changedFiles) {
      // normalize slashes for cross-platform
      const normalized = file.replace(/\\/g, "/");
      for (const ws of workspaces) {
        const relPath = ws.relativePath.replace(/\\/g, "/");
        if (normalized.startsWith(relPath + "/") || normalized === relPath) {
          directlyAffected.add(ws.name);
          break;
        }
      }
    }

    // If a root config file changed, consider everything affected
    for (const file of changedFiles) {
      const normalized = file.replace(/\\/g, "/");
      const basename = normalized.split("/").pop();
      if (MONOREPO_CONFIG_FILES.includes(basename) || basename === PACKAGE_JSON) {
        if (!normalized.includes("/")) {
          // Root-level config changed -> all packages affected
          return graph.packages;
        }
      }
    }

    // Walk dependents transitively
    const affected = new Set(directlyAffected);
    const queue = [...directlyAffected];

    while (queue.length > 0) {
      const pkg = queue.shift();
      const dependents = graph.dependents[pkg] || [];
      for (const dep of dependents) {
        if (!affected.has(dep)) {
          affected.add(dep);
          queue.push(dep);
        }
      }
    }

    // If nothing is affected, return empty
    if (affected.size === 0) {
      return [];
    }

    // Return in topological order
    const order = this.getBuildOrder(Array.from(affected), resolved);
    return order;
  }

  // ── Build order ───────────────────────────────────────────

  /**
   * Compute topological build order for a set of packages.
   * Packages with no internal dependencies come first.
   * @param {string[]} [packages] - Subset of packages to order (defaults to all)
   * @param {string} [root] - Monorepo root
   * @returns {string[]} package names in build order
   */
  getBuildOrder(packages, root) {
    const resolved = root ? path.resolve(root) : this.root;
    const graph = this.getDependencyGraph(resolved);
    const targetSet = packages && packages.length > 0
      ? new Set(packages)
      : new Set(graph.packages);

    // Filter graph to only target packages
    const filteredDeps = Object.create(null);
    for (const pkg of targetSet) {
      filteredDeps[pkg] = (graph.dependencies[pkg] || []).filter((d) =>
        targetSet.has(d),
      );
    }

    // Kahn's algorithm for topological sort
    const inDegree = Object.create(null);
    for (const pkg of targetSet) {
      inDegree[pkg] = 0;
    }
    for (const pkg of targetSet) {
      for (const dep of filteredDeps[pkg]) {
        inDegree[pkg] = (inDegree[pkg] || 0) + 1;
      }
    }

    const queue = [];
    for (const [pkg, degree] of Object.entries(inDegree)) {
      if (degree === 0) {
        queue.push(pkg);
      }
    }

    const order = [];
    while (queue.length > 0) {
      queue.sort(); // stable alphabetical order for determinism
      const current = queue.shift();
      order.push(current);

      // Reduce in-degree for packages that depend on current
      for (const pkg of targetSet) {
        if (filteredDeps[pkg].includes(current)) {
          inDegree[pkg] -= 1;
          if (inDegree[pkg] === 0) {
            queue.push(pkg);
          }
        }
      }
    }

    // Detect cycles: if we couldn't order all packages, there's a cycle
    if (order.length < targetSet.size) {
      const remaining = [...targetSet].filter((p) => !order.includes(p));
      // Add remaining packages at the end (cyclic dependencies)
      order.push(...remaining);
    }

    return order;
  }

  // ── Internal helpers ──────────────────────────────────────

  _readJson(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      return JSON.parse(content);
    } catch (_error) {
      return null;
    }
  }

  _hasWorkspaceField(pkg) {
    if (Array.isArray(pkg.workspaces)) return true;
    if (pkg.workspaces && typeof pkg.workspaces === "object") {
      return Array.isArray(pkg.workspaces.packages);
    }
    return false;
  }

  _getWorkspacePatterns(rootPkg, monorepoType) {
    const patterns = [];

    if (!rootPkg) return patterns;

    // npm / yarn workspaces
    if (Array.isArray(rootPkg.workspaces)) {
      patterns.push(...rootPkg.workspaces);
    } else if (rootPkg.workspaces && Array.isArray(rootPkg.workspaces.packages)) {
      patterns.push(...rootPkg.workspaces.packages);
    }

    // pnpm-workspace.yaml is parsed separately, but add heuristic patterns
    if (monorepoType === "pnpm" && patterns.length === 0) {
      patterns.push("packages/*", "apps/*");
    }

    return patterns;
  }

  _getNxWorkspacePattern(rootDir) {
    const nxJson = this._readJson(path.join(rootDir, "nx.json"));
    if (nxJson && nxJson.workspaceLayout) {
      const layout = nxJson.workspaceLayout;
      const parts = [];
      if (layout.appsDir) parts.push(layout.appsDir + "/*");
      if (layout.libsDir) parts.push(layout.libsDir + "/*");
      return parts.length > 0 ? parts : ["packages/*", "apps/*"];
    }
    return ["packages/*", "apps/*"];
  }

  _expandGlobPattern(rootDir, pattern) {
    const results = [];
    const normalized = pattern.replace(/\\/g, "/");

    // Handle simple globs like "packages/*", "apps/*", "lib/*"
    const starIndex = normalized.indexOf("*");

    if (starIndex === -1) {
      // Literal path — check if it's a directory with package.json
      const p = path.join(rootDir, normalized);
      if (fs.existsSync(path.join(p, PACKAGE_JSON))) {
        results.push(normalized);
      }
      return results;
    }

    const prefix = normalized.substring(0, starIndex);
    const suffix = normalized.substring(starIndex + 1);

    // Strip trailing separator if present
    const cleanPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    const fullPrefix = path.join(rootDir, cleanPrefix);

    if (!fs.existsSync(fullPrefix)) {
      return results;
    }

    let entries;
    try {
      entries = fs.readdirSync(fullPrefix, { withFileTypes: true });
    } catch (_error) {
      return results;
    }

    const suffixClean = suffix.startsWith("/") ? suffix.slice(1) : suffix;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;

      if (suffixClean.length === 0) {
        // Simple "prefix/*" pattern
        const pkgPath = path.join(fullPrefix, entry.name, PACKAGE_JSON);
        if (fs.existsSync(pkgPath)) {
          results.push(path.posix.join(cleanPrefix, entry.name));
        }
      } else if (suffixClean.startsWith("package.json")) {
        // "prefix/*/package.json" pattern
        const pkgPath = path.join(fullPrefix, entry.name, PACKAGE_JSON);
        if (fs.existsSync(pkgPath)) {
          results.push(path.posix.join(cleanPrefix, entry.name));
        }
      }
    }

    return results;
  }

  _listDirectories(dirPath) {
    try {
      return fs.readdirSync(dirPath, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name);
    } catch (_error) {
      return [];
    }
  }
}

module.exports = {
  MonorepoManager,
  MONOREPO_CONFIG_FILES,
};
