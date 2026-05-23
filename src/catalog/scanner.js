"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * ModuleScanner — scans and catalogs all project modules.
 *
 * Produces a structured module catalog including:
 *   - every .js file (module) under a root directory
 *   - what each module imports (require() calls)
 *   - what each module exports (module.exports / exports.*)
 *   - JSDoc block annotations when present
 *   - lines-of-code counts
 *
 * From this raw data the scanner derives:
 *   - a full module → imports graph
 *   - orphan modules (imported by no one)
 *   - most-used modules (highest in-degree)
 *   - aggregate statistics (total files, LOC, etc.)
 */

class ModuleScanner {
  constructor() {
    this._modules = new Map(); // absolutePath → ModuleInfo
    this._index = new Map();   // relativePath → absolutePath (for fast lookup)
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  /**
   * Recursively scan a root directory for .js modules, parse their
   * require() / module.exports / JSDoc metadata, and populate the
   * internal catalog.
   *
   * @param {string} root — absolute path to the project root
   * @param {object} [opts]
   * @param {boolean} [opts.skipNodeModules=true] — skip node_modules/
   * @param {string[]} [opts.excludeDirs=[]] — additional dir names to skip
   * @returns {ModuleScanner} this (chainable)
   */
  scan(root, opts = {}) {
    const skipNodeModules = opts.skipNodeModules !== false;
    const excludeDirs = new Set([
      ...(skipNodeModules ? ["node_modules"] : []),
      ...(opts.excludeDirs || []),
    ]);

    this._modules.clear();
    this._index.clear();

    this._walk(root, root, excludeDirs);

    // After all files are loaded, resolve relative require() paths to
    // the actual absolute paths of known modules.
    for (const [, info] of this._modules) {
      info._resolvedImports = new Set();
      for (const raw of info._rawImports) {
        const resolved = this._resolveImport(raw, info.path);
        if (resolved) {
          info.imports.push(resolved);
          info._resolvedImports.add(resolved);
        }
      }
    }

    return this;
  }

  /**
   * Return the module graph as an adjacency map:
   *   { [relativeModulePath]: string[] of relative paths it imports }
   *
   * @returns {object}
   */
  getModuleGraph() {
    const graph = {};
    for (const [, info] of this._modules) {
      const key = this._relative(info.path);
      const imports = [];
      for (const abs of info.imports) {
        imports.push(this._relative(abs));
      }
      graph[key] = imports;
    }
    return graph;
  }

  /**
   * Return modules that have zero inbound imports (i.e. nothing else in
   * the project `require()`s them).
   *
   * Entry-point candidates (cli.js, index.js, bin scripts) are excluded
   * from the orphan list by default because they are the natural "roots".
   *
   * @param {object} [opts]
   * @param {boolean} [opts.includeEntryPoints=false]
   * @returns {ModuleInfo[]}
   */
  getOrphanModules(opts = {}) {
    const inDegree = this._buildInDegree();
    const entryNames = opts.includeEntryPoints
      ? new Set()
      : new Set(["cli.js", "index.js", "desktop-main.js"]);

    const orphans = [];
    for (const [, info] of this._modules) {
      const key = this._relative(info.path);
      if ((inDegree.get(key) || 0) === 0 && !entryNames.has(path.basename(info.path))) {
        orphans.push(this._toPublicInfo(info));
      }
    }
    orphans.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return orphans;
  }

  /**
   * Return modules sorted by inbound import count (most depended-on first).
   *
   * @param {number} [limit=10]
   * @returns {{ relativePath: string, importCount: number, exporter: boolean }[]}
   */
  getMostUsedModules(limit = 10) {
    const inDegree = this._buildInDegree();
    const entries = [];
    for (const [, info] of this._modules) {
      const key = this._relative(info.path);
      const count = inDegree.get(key) || 0;
      if (count > 0) {
        entries.push({
          relativePath: key,
          importCount: count,
          exporter: info.exports.length > 0,
        });
      }
    }
    entries.sort((a, b) => b.importCount - a.importCount);
    return entries.slice(0, limit);
  }

  /**
   * Aggregate module-level statistics.
   *
   * @returns {{ totalModules: number, totalLinesOfCode: number,
   *             totalExports: number, totalImports: number,
   *             modulesWithJSDoc: number, avgLinesPerModule: number }}
   */
  getModuleStats() {
    let totalLoc = 0;
    let totalExports = 0;
    let totalImports = 0;
    let modulesWithJSDoc = 0;

    for (const [, info] of this._modules) {
      totalLoc += info.linesOfCode;
      totalExports += info.exports.length;
      totalImports += info.imports.length;
      if (info.jsdoc && info.jsdoc.trim().length > 0) {
        modulesWithJSDoc++;
      }
    }

    const totalModules = this._modules.size;
    return {
      totalModules,
      totalLinesOfCode: totalLoc,
      totalExports,
      totalImports,
      modulesWithJSDoc,
      avgLinesPerModule:
        totalModules > 0 ? Math.round((totalLoc / totalModules) * 10) / 10 : 0,
    };
  }

  /**
   * Return the raw catalog data — every module with its full metadata.
   *
   * @returns {ModuleInfo[]}
   */
  getAllModules() {
    const list = [];
    for (const [, info] of this._modules) {
      list.push(this._toPublicInfo(info));
    }
    list.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return list;
  }

  // -------------------------------------------------------------------
  // Internal: file-system walker
  // -------------------------------------------------------------------

  /**
   * Recursively walk `dir`, collecting .js files.
   */
  _walk(dir, root, excludeDirs) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        if (entry.name.startsWith(".") && entry.name !== "..") continue;
        this._walk(full, root, excludeDirs);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".js")) {
        this._processFile(full, root);
      }
    }
  }

  /**
   * Parse a single .js file and register it in the catalog.
   */
  _processFile(absPath, root) {
    let raw;
    try {
      raw = fs.readFileSync(absPath, "utf8");
    } catch {
      return;
    }

    const rel = this._relative(absPath, root);
    const linesOfCode = raw.split("\n").filter((l) => l.trim().length > 0).length;
    const rawImports = this._parseRequires(raw);
    const exports = this._parseExports(raw);
    const jsdoc = this._parseJSDoc(raw);

    const info = {
      path: absPath,
      relativePath: rel,
      linesOfCode,
      imports: [],              // filled later (resolved absolute paths)
      _rawImports: rawImports,  // raw require() argument strings
      _resolvedImports: new Set(),
      exports,
      jsdoc,
    };

    this._modules.set(absPath, info);
    this._index.set(rel, absPath);
  }

  // -------------------------------------------------------------------
  // Parsers
  // -------------------------------------------------------------------

  /**
   * Extract all require()-style imports.
   *
   * Handles:
   *   require('foo') / require("foo")
   *   require(`foo`)        (template literals — skipped if interpolated)
   *   const x = require(...)
   *   const { a, b } = require(...)
   */
  _parseRequires(source) {
    const imports = [];
    // Match require( with optional whitespace, then single/double quote, capture content
    const re =
      /require\s*\(\s*(['"])([^'"]+\.[jJ][sS]|[^'"]+)\1\s*\)/g;
    let m;
    while ((m = re.exec(source)) !== null) {
      let arg = m[2];

      // Skip Node builtins and node: protocol
      if (
        arg.startsWith("node:") ||
        [
          "fs",
          "path",
          "os",
          "http",
          "https",
          "crypto",
          "stream",
          "events",
          "util",
          "url",
          "buffer",
          "child_process",
          "assert",
          "net",
          "tls",
          "dns",
          "readline",
          "cluster",
          "vm",
          "zlib",
          "querystring",
          "string_decoder",
          "tty",
          "dgram",
          "timers",
          "module",
          "process",
          "v8",
          "worker_threads",
          "perf_hooks",
          "inspector",
          "trace_events",
        ].includes(arg)
      ) {
        continue;
      }

      // Normalize: strip .js extension for matching
      if (arg.endsWith(".js") || arg.endsWith(".JS")) {
        arg = arg.slice(0, -3);
      }

      // Resolve to known module
      imports.push(arg);
    }
    return imports;
  }

  /**
   * Extract exports metadata.
   *
   * Detects patterns:
   *   module.exports = { a, b, c }
   *   module.exports = FuncOrClass
   *   module.exports.xxx = ...
   *   exports.xxx = ...
   *   module.exports = require(...) // re-export
   */
  _parseExports(source) {
    const exports = [];

    // module.exports = { a, b, c }
    const assignedObj = source.match(
      /module\.exports\s*=\s*\{([^}]*)\}/
    );
    if (assignedObj) {
      const body = assignedObj[1];
      // Match identifiers (including spread: ...foo)
      const names = body.match(/\.\.\.(\w+)|\b(\w+)\s*(?=[,\s\n\r}])/g);
      if (names) {
        for (const n of names) {
          const clean = n.replace(/\.\.\./, "").trim();
          if (clean && !exports.includes(clean)) {
            exports.push(clean);
          }
        }
      }
    }

    // module.exports = <singleExport>
    const singleExport = source.match(
      /module\.exports\s*=\s*(?!\{)(?:require\s*\(\s*|class\s+(\w+)|function\s+(\w+)|(\w+)\s*[,;]?)/
    );
    if (singleExport && singleExport[0]) {
      const name =
        singleExport[1] || singleExport[2] || singleExport[3];
      if (name && !exports.includes(name)) {
        exports.push(name);
      }
    }

    // exports.xxx = ...
    let m;
    const propRe = /(?:module\.)?exports\.(\w+)\s*=/g;
    while ((m = propRe.exec(source)) !== null) {
      if (!exports.includes(m[1])) {
        exports.push(m[1]);
      }
    }

    // module.exports = { /* from other files */ ...runtime }
    // We already handle this above via the {...} regex, but also check for
    // re-export patterns like module.expoerts = require('./other')
    const reExport = source.match(
      /module\.exports\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/
    );
    if (reExport) {
      exports.push(`[re-exports: ${reExport[1]}]`);
    }

    return exports;
  }

  /**
   * Extract the first JSDoc block comment for a module-level description.
   *
   * Returns the content between /** and * / (concatenated, stripped of * prefixes).
   */
  _parseJSDoc(source) {
    const re = /\/\*\*([\s\S]*?)\*\//;
    const match = re.exec(source);
    if (!match) return "";

    const body = match[1];
    // Clean up each line
    const lines = body
      .split("\n")
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .filter((l) => l.length > 0 && l !== "/");

    return lines.join("\n").trim();
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  /**
   * Compute the in-degree (how many modules import a given module) for every module.
   */
  _buildInDegree() {
    const inDegree = new Map();
    for (const [, info] of this._modules) {
      const targetKey = this._relative(info.path);
      if (!inDegree.has(targetKey)) inDegree.set(targetKey, 0);
      for (const imp of info.imports) {
        const impKey = this._relative(imp);
        inDegree.set(impKey, (inDegree.get(impKey) || 0) + 1);
      }
    }
    return inDegree;
  }

  /**
   * Try to resolve a raw require() argument to an absolute path in the catalog.
   *
   * Handles:
   *   ./foo          → relative to importing file
   *   ../foo         → relative to importing file
   *   src/foo        → project-relative (treated as ./src/foo from root)
   *   @scope/pkg     → external package (return null)
   *   package-name   → external package (return null)
   */
  _resolveImport(rawArg, importerPath) {
    // External packages (no / or . prefix or @scope)
    if (!rawArg.startsWith(".") && !rawArg.startsWith("/")) {
      // Could be org-relative like "src/config" — resolve from root
      // We try: relative to importer, then relative to root
      // First, check if it resolves relative to the importer
      const fromImporter = path.resolve(
        path.dirname(importerPath),
        rawArg + ".js"
      );
      if (this._modules.has(fromImporter)) return fromImporter;
      return null; // external package — not in our catalog
    }

    // Relative path
    const candidate = path.resolve(
      path.dirname(importerPath),
      rawArg + ".js"
    );

    if (this._modules.has(candidate)) return candidate;

    // Try without .js extension (some require calls omit it but still resolve)
    // Also try index.js inside the directory
    const asDir = path.resolve(
      path.dirname(importerPath),
      rawArg,
      "index.js"
    );
    if (this._modules.has(asDir)) return asDir;

    return null;
  }

  /**
   * Compute the relative path of absPath against the internal root.
   *
   * We store the root implicitly as the common prefix derived from scanned
   * modules, but for consistent output we use the project root captured
   * during scan.
   */
  _relative(absPath, rootOverride) {
    if (!this._scanRoot && rootOverride) {
      this._scanRoot = rootOverride;
    }
    const base = rootOverride || this._scanRoot || process.cwd();
    let rel = path.relative(base, absPath);
    // Normalize to forward slashes
    rel = rel.replace(/\\/g, "/");
    return rel;
  }

  /**
   * Convert internal ModuleInfo to a safe public representation.
   */
  _toPublicInfo(info) {
    return {
      path: info.path,
      relativePath: info.relativePath,
      linesOfCode: info.linesOfCode,
      imports: info.imports.map((a) => this._relative(a)),
      exports: [...info.exports],
      jsdoc: info.jsdoc,
    };
  }
}

module.exports = { ModuleScanner };
