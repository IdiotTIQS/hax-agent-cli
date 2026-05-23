"use strict";

const fs = require("node:fs");
const path = require("node:path");

// ---- Regex patterns for import/require detection ----

const REQUIRE_RE = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
const IMPORT_FROM_RE = /import\s+[\s\S]*?\s+from\s+["']([^"']+)["']/g;
const IMPORT_SIDE_EFFECT_RE = /import\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
const EXPORT_FROM_RE = /export\s+(?:\{[^}]*\}|\*)\s+from\s+["']([^"']+)["']/g;

// ---- Regex patterns for export detection ----

const MODULE_EXPORTS_RE = /module\.exports\s*=\s*(\S[\s\S]*?)(?:;|\n\s*\n|$)/gm;
const EXPORTS_DOT_RE = /exports\.(\w+)\s*=/g;
const EXPORT_NAMED_RE = /export\s+(?:const|let|var|function|class|async\s+function|type|interface|enum)\s+(\w+)/g;
const EXPORT_DEFAULT_NAMED_RE = /export\s+default\s+(?:function|class|async\s+function)\s+(\w+)/g;
const HAS_EXPORT_DEFAULT_RE = /export\s+default\b/g;
const EXPORT_BRACE_RE = /export\s*\{\s*([^}]+)\s*\}/g;

// ---- Constants ----

const SOURCE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
]);

const POSSIBLE_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", "/index.js", "/index.ts", "/index.mjs"];

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next",
  ".nuxt", "out", "target", "vendor", "__pycache__", ".venv",
  ".hax-agent", ".claude",
]);

/**
 * Analyzes JavaScript/TypeScript module dependencies within a project.
 *
 * Parses require() and import statements across all source files to build
 * a directed dependency graph, detect circular dependencies, identify unused
 * modules, group modules into architectural layers, and compute per-module
 * metrics (size, complexity, fan-in, fan-out).
 */
class ModuleDependencyAnalyzer {
  constructor() {
    /** @type {Map<string, Set<string>>} filePath -> set of imported module paths */
    this._deps = new Map();
    /** @type {Map<string, Set<string>>} filePath -> set of files that import it */
    this._reverseDeps = new Map();
    /** @type {Map<string, Set<string>>} filePath -> set of exported names */
    this._exports = new Map();
    /** @type {Map<string, string[]>} filePath -> all raw import strings (including externals) */
    this._rawImports = new Map();
    /** @type {Set<string>} all discovered file paths (relative, normalized) */
    this._files = new Set();
    /** @type {string} the project root */
    this._root = "";
  }

  /**
   * Scans the project at `root`, parses all JS/TS files, and populates
   * the dependency graph.
   *
   * @param {string} root - Project root directory.
   * @param {object} [options={}]
   * @param {string[]} [options.extensions] - File extensions to include (default: .js,.mjs,.cjs,.ts,.tsx,.jsx).
   * @param {string[]} [options.ignoreDirs]  - Directory names to skip.
   * @param {string[]} [options.include]     - Glob-like subdirectory paths to restrict to.
   * @returns {ModuleDependencyAnalyzer} this (chainable)
   */
  analyze(root, options = {}) {
    const resolved = path.resolve(root);
    this._root = resolved;

    const extensions = options.extensions
      ? new Set(options.extensions.map((e) => e.startsWith(".") ? e : `.${e}`))
      : SOURCE_EXTENSIONS;

    const ignoreDirs = options.ignoreDirs
      ? new Set([...IGNORED_DIRS, ...options.ignoreDirs])
      : IGNORED_DIRS;

    const includeDirs = options.include || null;

    this._deps = new Map();
    this._reverseDeps = new Map();
    this._exports = new Map();
    this._rawImports = new Map();
    this._files = new Set();

    const allFiles = this._collectFiles(resolved, extensions, ignoreDirs, includeDirs);

    // Populate the full file set first so cross-file resolution works
    for (const relPath of allFiles) {
      this._files.add(relPath);
    }

    for (const relPath of allFiles) {
      const absPath = path.join(resolved, relPath);
      let content;
      try {
        content = fs.readFileSync(absPath, "utf8");
      } catch (_err) {
        continue;
      }

      const imports = this._extractImports(content);
      this._rawImports.set(relPath, imports);

      const resolvedImports = new Set();
      for (const imp of imports) {
        const resolvedPath = this._resolveImport(relPath, imp);
        if (resolvedPath && this._files.has(resolvedPath)) {
          resolvedImports.add(resolvedPath);
        }
      }

      this._deps.set(relPath, resolvedImports);

      // Build reverse dependency map
      if (!this._reverseDeps.has(relPath)) {
        this._reverseDeps.set(relPath, new Set());
      }

      // Extract exports
      const exportedNames = this._extractExports(content);
      this._exports.set(relPath, exportedNames);
    }

    // Populate reverse deps after all files are processed
    for (const [file, importedSet] of this._deps.entries()) {
      for (const target of importedSet) {
        if (!this._reverseDeps.has(target)) {
          this._reverseDeps.set(target, new Set());
        }
        this._reverseDeps.get(target).add(file);
      }
    }

    return this;
  }

  /**
   * Returns the directed import graph: for each file, the set of project
   * files it imports.
   *
   * @returns {Map<string, Set<string>>}
   */
  getImportGraph() {
    return this._deps;
  }

  /**
   * Returns what each module exports (named exports, default, etc.).
   *
   * @returns {Map<string, Set<string>>}
   */
  getExportGraph() {
    return this._exports;
  }

  /**
   * Detects circular dependencies using DFS coloring.
   *
   * @returns {string[][]} Array of cycles, each cycle is an ordered array
   *   of file paths.
   */
  findCircularDeps() {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map();
    const cycles = [];

    // Initialize colors
    for (const node of this._files) {
      color.set(node, WHITE);
    }

    // Build adjacency list from deps
    const adj = new Map();
    for (const [file, imports] of this._deps.entries()) {
      adj.set(file, [...imports]);
    }

    const stack = [];

    const dfs = (node) => {
      color.set(node, GRAY);
      stack.push(node);

      const neighbors = adj.get(node) || [];
      for (const neighbor of neighbors) {
        const neighborColor = color.get(neighbor);
        if (neighborColor === GRAY) {
          const cycleStart = stack.indexOf(neighbor);
          if (cycleStart !== -1) {
            const cycle = stack.slice(cycleStart);
            cycle.push(neighbor); // close the cycle
            cycles.push(cycle);
          }
        } else if (neighborColor === WHITE) {
          dfs(neighbor);
        }
      }

      stack.pop();
      color.set(node, BLACK);
    };

    for (const node of this._files) {
      if (color.get(node) === WHITE) {
        dfs(node);
      }
    }

    return cycles;
  }

  /**
   * Finds modules that exist in the project but are never imported by any
   * other module.
   *
   * @returns {string[]} Array of file paths that have zero dependents.
   */
  findUnusedModules() {
    const unused = [];
    for (const file of this._files) {
      const importers = this._reverseDeps.get(file);
      if (!importers || importers.size === 0) {
        unused.push(file);
      }
    }
    return unused;
  }

  /**
   * Groups modules into architectural layers by dependency direction.
   *
   * Layer 0: modules that import no other project modules (leaf nodes).
   * Layer N: modules that only import from layers < N.
   *
   * @returns {string[][]} Array of layers, each layer is an array of file paths.
   */
  getLayeredArchitecture() {
    // Compute in-degree (number of project deps each file has)
    const inDegree = new Map();
    for (const file of this._files) {
      inDegree.set(file, this._deps.has(file) ? this._deps.get(file).size : 0);
    }

    const layers = [];
    const assigned = new Set();
    let currentLayer = [];

    // Layer 0: files with no project dependencies
    for (const [file, degree] of inDegree.entries()) {
      if (degree === 0) {
        currentLayer.push(file);
      }
    }

    // Iterative layer assignment
    const remaining = new Set(this._files);

    while (currentLayer.length > 0) {
      layers.push([...currentLayer]);
      for (const f of currentLayer) {
        assigned.add(f);
        remaining.delete(f);
      }

      const nextLayer = [];
      for (const file of remaining) {
        const deps = this._deps.get(file) || new Set();
        // Check if ALL dependencies are in already assigned layers
        let allDepsAssigned = true;
        for (const dep of deps) {
          if (!assigned.has(dep)) {
            allDepsAssigned = false;
            break;
          }
        }
        if (allDepsAssigned && deps.size > 0) {
          nextLayer.push(file);
        }
      }

      if (nextLayer.length === 0 && remaining.size > 0) {
        // Possible circular dependency or disconnected component;
        // assign remaining to a final layer
        const stragglers = [...remaining];
        layers.push(stragglers);
        break;
      }

      currentLayer = nextLayer;
    }

    return layers;
  }

  /**
   * Computes per-module metrics: size (LOC), complexity estimate,
   * fan-in, and fan-out.
   *
   * @returns {object[]} Array of metric objects, one per module.
   */
  getModuleMetrics() {
    const metrics = [];

    for (const file of this._files) {
      const absPath = path.join(this._root, file);
      let content = "";
      try {
        content = fs.readFileSync(absPath, "utf8");
      } catch (_err) {
        // file no longer accessible
      }

      const lines = content ? content.split("\n").length : 0;
      const complexity = this._estimateComplexity(content);
      const fanIn = (this._reverseDeps.get(file) || new Set()).size;
      const fanOut = (this._deps.get(file) || new Set()).size;
      const rawImportCount = (this._rawImports.get(file) || []).length;

      metrics.push({
        file,
        size: lines,
        complexity,
        fanIn,
        fanOut,
        rawImportCount,
        instability: fanOut > 0 || fanIn > 0
          ? parseFloat((fanOut / (fanIn + fanOut)).toFixed(3))
          : 0,
      });
    }

    return metrics;
  }

  /**
   * Returns the set of all discovered file paths.
   *
   * @returns {Set<string>}
   */
  get files() {
    return this._files;
  }

  /**
   * Returns the raw imports for a given file (including externals).
   *
   * @param {string} file - Relative file path.
   * @returns {string[]}
   */
  getRawImports(file) {
    return this._rawImports.get(file) || [];
  }

  // ---- Private helpers ----

  /**
   * Recursively collects source files.
   */
  _collectFiles(root, extensions, ignoreDirs, includeDirs) {
    const results = [];
    const pending = [root];

    while (pending.length > 0) {
      const current = pending.pop();
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch (_err) {
        continue;
      }

      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;

        const fullPath = path.join(current, entry.name);
        const relative = path.relative(root, fullPath).replace(/\\/g, "/");

        if (entry.isDirectory()) {
          if (!ignoreDirs.has(entry.name) && !entry.name.startsWith(".")) {
            if (!includeDirs || this._matchesInclude(relative, includeDirs)) {
              pending.push(fullPath);
            }
          }
          continue;
        }

        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.has(ext)) {
            if (!includeDirs || this._matchesInclude(relative, includeDirs)) {
              results.push(relative);
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Checks if a relative path matches any include prefix.
   */
  _matchesInclude(relative, includeDirs) {
    for (const prefix of includeDirs) {
      const normalized = prefix.replace(/\\/g, "/");
      if (relative.startsWith(normalized) || normalized === "." || normalized === "") {
        return true;
      }
    }
    return false;
  }

  /**
   * Extracts all require() and import targets from file content.
   */
  _extractImports(content) {
    const imports = [];
    const seen = new Set();

    // require('...') / require("...")
    for (const match of content.matchAll(REQUIRE_RE)) {
      if (!seen.has(match[1])) {
        seen.add(match[1]);
        imports.push(match[1]);
      }
    }

    // import ... from '...'
    for (const match of content.matchAll(IMPORT_FROM_RE)) {
      if (match[1] && !seen.has(match[1])) {
        seen.add(match[1]);
        imports.push(match[1]);
      }
    }

    // import '...' (side-effect)
    for (const match of content.matchAll(IMPORT_SIDE_EFFECT_RE)) {
      if (match[1] && !seen.has(match[1])) {
        seen.add(match[1]);
        imports.push(match[1]);
      }
    }

    // import('...')
    for (const match of content.matchAll(DYNAMIC_IMPORT_RE)) {
      if (!seen.has(match[1])) {
        seen.add(match[1]);
        imports.push(match[1]);
      }
    }

    // export ... from '...'
    for (const match of content.matchAll(EXPORT_FROM_RE)) {
      if (!seen.has(match[1])) {
        seen.add(match[1]);
        imports.push(match[1]);
      }
    }

    return imports;
  }

  /**
   * Resolves a relative import path to a known project file.
   * Returns the normalized relative path or null if it resolves to
   * an external module or file not in the project.
   */
  _resolveImport(fromFile, importPath) {
    // Skip node builtins and bare specifiers (package imports)
    if (!importPath.startsWith("./") && !importPath.startsWith("../")) {
      return null;
    }

    const fromDir = path.dirname(fromFile);
    const joined = path.join(fromDir, importPath).replace(/\\/g, "/");

    // Direct match
    if (this._files.has(joined)) {
      return joined;
    }

    // Try with extensions and /index
    for (const ext of POSSIBLE_EXTENSIONS) {
      const candidate = joined + ext;
      if (this._files.has(candidate)) {
        return candidate;
      }
    }

    // Try without extension if it already has one and wasn't matched directly
    if (path.extname(joined) === "" && this._files.has(joined)) {
      return joined;
    }

    return null;
  }

  /**
   * Detects exported symbols from module content.
   */
  _extractExports(content) {
    const exports = new Set();

    // module.exports = <expression>
    for (const match of content.matchAll(MODULE_EXPORTS_RE)) {
      const value = (match[1] || "").trim();
      if (value.startsWith("{")) {
        // module.exports = { foo, bar, baz }
        for (const keyMatch of value.matchAll(/(\w+)\s*[:=]?\s*/g)) {
          const name = keyMatch[1];
          if (name && name !== "require" && name !== "module") {
            exports.add(name);
          }
        }
      } else {
        exports.add("(default)");
      }
    }

    // exports.foo = ...
    for (const match of content.matchAll(EXPORTS_DOT_RE)) {
      exports.add(match[1]);
    }

    // export const/let/var/function/class Foo (named, non-default)
    for (const match of content.matchAll(EXPORT_NAMED_RE)) {
      exports.add(match[1]);
    }

    // export default function foo() / export default class Foo
    let hasDefaultName = false;
    for (const match of content.matchAll(EXPORT_DEFAULT_NAMED_RE)) {
      if (match[1]) {
        exports.add(match[1]);
        hasDefaultName = true;
      }
    }

    // export default <expression> — unnamed default
    if (!hasDefaultName && HAS_EXPORT_DEFAULT_RE.test(content)) {
      exports.add("(default)");
    }

    // export { foo, bar as baz }
    for (const match of content.matchAll(EXPORT_BRACE_RE)) {
      const inside = match[1];
      for (const part of inside.split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) {
          exports.add(name);
        }
      }
    }

    return exports;
  }

  /**
   * Estimates cyclomatic-style complexity from branching constructs.
   */
  _estimateComplexity(content) {
    if (!content) return 0;

    let score = 0;

    // Count branching keywords
    const branchPatterns = [
      /\bif\s*\(/g,
      /\belse\s+if\s*\(/g,
      /\bfor\s*\(/g,
      /\bwhile\s*\(/g,
      /\bswitch\s*\(/g,
      /\bcase\s+/g,
      /\?\s*.*?\s*:/g, // ternary
      /\bcatch\s*\(/g,
      /\b\|\|/g,
      /\b&&/g,
    ];

    for (const re of branchPatterns) {
      const matches = content.match(re);
      if (matches) {
        score += matches.length;
      }
    }

    // Count function boundaries
    const funcPatterns = [
      /\bfunction\s+\w+\s*\(/g,
      /\(\s*(?:[\w\s,]*)\s*\)\s*=>\s*\{?/g,
      /\bclass\s+\w+/g,
    ];

    for (const re of funcPatterns) {
      const matches = content.match(re);
      if (matches) {
        score += matches.length;
      }
    }

    return score;
  }
}

module.exports = { ModuleDependencyAnalyzer };
