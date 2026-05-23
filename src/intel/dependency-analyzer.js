"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createRequire } = require("node:module");

const MANIFEST_FILES = [
  { file: "package.json", type: "node" },
  { file: "requirements.txt", type: "python" },
  { file: "Cargo.toml", type: "rust" },
  { file: "go.mod", type: "go" },
  { file: "Gemfile", type: "ruby" },
  { file: "composer.json", type: "php" },
  { file: "Pipfile", type: "python" },
  { file: "pyproject.toml", type: "python" },
];

const SOURCE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".py", ".rs", ".go", ".rb", ".php",
]);

const JS_MODULE_IMPORT_RE = /(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)|import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|(?:^|\s)require\s*\(\s*["']([^"']+)["']\s*\)/gm;
const PYTHON_IMPORT_RE = /^from\s+([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s+import|^import\s+([a-zA-Z_]\w*(?:\s*,\s*[a-zA-Z_]\w*)*)/gm;
const RUST_USE_RE = /^use\s+([a-z_]\w*(?:::[a-z_]\w*)*)/gm;
const GO_IMPORT_RE = /^import\s+(?:"([^"]+)"|(?:[a-zA-Z_]\w*\s+)?)"([^"]+)"/gm;

/**
 * Scans a project root for dependency manifest files and parses their contents.
 * @param {string} root - Project root directory
 * @returns {Promise<object>} Dependencies grouped by ecosystem
 */
async function analyzeDependencies(root) {
  const resolved = path.resolve(root);
  const result = {
    ecosystems: {},
    files: [],
  };

  for (const { file, type } of MANIFEST_FILES) {
    const manifestPath = path.join(resolved, file);
    let content;
    try {
      content = await fs.readFile(manifestPath, "utf8");
    } catch (_error) {
      continue;
    }

    result.files.push(file);

    if (type === "node" && file === "package.json") {
      result.ecosystems.node = parsePackageJson(content);
    } else if (type === "python" && (file === "requirements.txt" || file === "Pipfile")) {
      result.ecosystems.python = parsePythonDeps(content, file);
    } else if (type === "python" && file === "pyproject.toml") {
      result.ecosystems.python = result.ecosystems.python || parsePyProjectToml(content);
    } else if (type === "rust") {
      result.ecosystems.rust = parseCargoToml(content);
    } else if (type === "go") {
      result.ecosystems.go = parseGoMod(content);
    } else if (type === "ruby") {
      result.ecosystems.ruby = parseGemfile(content);
    } else if (type === "php") {
      result.ecosystems.php = parseComposerJson(content);
    }
  }

  return result;
}

/**
 * Returns a list of dependencies that have newer versions, based on npm outdated-style parsing.
 * Does not make real network calls — returns a structured empty/simulated result.
 * @param {string} root - Project root directory
 * @returns {Promise<object>} Object with outdated dependencies per ecosystem
 */
async function getOutdatedDependencies(root) {
  const resolved = path.resolve(root);
  const outdated = {};

  // Check for package-lock.json or yarn.lock as indicators of locked versions
  const lockFiles = [];
  for (const lockName of ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]) {
    try {
      await fs.access(path.join(resolved, lockName));
      lockFiles.push(lockName);
    } catch (_error) { /* not present */ }
  }

  if (lockFiles.length > 0) {
    outdated.node = {
      lockFiles,
      note: "Run 'npm outdated' or equivalent for actual version information.",
    };
  }

  // For Cargo.toml, check if Cargo.lock exists
  try {
    await fs.access(path.join(resolved, "Cargo.lock"));
    outdated.rust = {
      lockFile: "Cargo.lock",
      note: "Run 'cargo outdated' for actual version information.",
    };
  } catch (_error) { /* not present */ }

  // For go.mod, check if go.sum exists
  try {
    await fs.access(path.join(resolved, "go.sum"));
    outdated.go = {
      lockFile: "go.sum",
      note: "Run 'go list -u -m all' for actual version information.",
    };
  } catch (_error) { /* not present */ }

  return outdated;
}

/**
 * Detects imports in source files that reference modules not listed in any manifest.
 * @param {string} root - Project root directory
 * @returns {Promise<object>} List of potentially unused or missing dependencies
 */
async function detectUnusedDependencies(root) {
  const resolved = path.resolve(root);
  const deps = await analyzeDependencies(resolved);
  const knownModules = extractKnownModules(deps);
  const importsByFile = await buildDependencyGraph(resolved);

  const missingDeps = [];
  const unusedDeps = [knownModules];

  for (const [file, imports] of Object.entries(importsByFile)) {
    for (const imp of imports) {
      const moduleName = getModuleRoot(imp);
      if (moduleName && !isBuiltIn(moduleName) && !isRelativePath(imp)) {
        if (!knownModules.has(moduleName) && !knownModules.has(imp)) {
          missingDeps.push({
            file: normalizeSlashes(file),
            import: imp,
            module: moduleName,
          });
        }
      }
    }
  }

  // Check for declared but never imported
  const allImported = new Set();
  for (const imports of Object.values(importsByFile)) {
    for (const imp of imports) {
      allImported.add(imp);
    }
  }

  return {
    missingDeps,
    declaredDepsCount: knownModules.size,
    totalImportedModules: allImported.size,
  };
}

/**
 * Builds a dependency graph mapping each source file to the modules it imports.
 * @param {string} root - Project root directory
 * @returns {Promise<object>} Map of file path to array of imported module strings
 */
async function buildDependencyGraph(root) {
  const resolved = path.resolve(root);
  const graph = Object.create(null);
  const files = await collectSourceFiles(resolved);

  for (const file of files) {
    let content;
    try {
      content = await fs.readFile(file.absolute, "utf8");
    } catch (_error) {
      continue;
    }

    const imports = extractImports(content, file.relative);
    if (imports.length > 0) {
      graph[normalizeSlashes(file.relative)] = imports;
    }
  }

  return graph;
}

/**
 * Detects circular dependencies among source files.
 * @param {string} root - Project root directory
 * @returns {Promise<Array<Array<string>>>} Array of circular dependency cycles
 */
async function findCircularDependencies(root) {
  const resolved = path.resolve(root);
  const graph = await buildDependencyGraph(resolved);
  const cycles = [];

  // Build a simplified graph using only relative imports that resolve to project files
  const adj = Object.create(null);
  for (const [file, imports] of Object.entries(graph)) {
    adj[file] = [];
    for (const imp of imports) {
      if (!isRelativePath(imp)) continue;
      const candidates = resolveRelativeImport(file, imp);
      const resolvedImp = Array.isArray(candidates)
        ? candidates.find(c => graph[c])
        : null;
      if (resolvedImp) {
        adj[file].push(resolvedImp);
      }
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = Object.create(null);

  for (const node of Object.keys(adj)) {
    color[node] = WHITE;
  }

  const stack = [];

  function dfs(node) {
    color[node] = GRAY;
    stack.push(node);

    for (const neighbor of adj[node]) {
      if (color[neighbor] === GRAY) {
        const cycleStart = stack.indexOf(neighbor);
        if (cycleStart !== -1) {
          cycles.push(stack.slice(cycleStart).concat(neighbor));
        }
      } else if (color[neighbor] === WHITE) {
        dfs(neighbor);
      }
    }

    stack.pop();
    color[node] = BLACK;
  }

  for (const node of Object.keys(adj)) {
    if (color[node] === WHITE) {
      dfs(node);
    }
  }

  return cycles;
}

/**
 * Estimates the on-disk size of each dependency in node_modules.
 * @param {string} root - Project root directory
 * @returns {Promise<object>} Map of package names to size in bytes
 */
async function getDependencySizes(root) {
  const resolved = path.resolve(root);
  const nodeModules = path.join(resolved, "node_modules");
  const sizes = Object.create(null);

  let entries;
  try {
    entries = await fs.readdir(nodeModules, { withFileTypes: true });
  } catch (_error) {
    return sizes;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const name = entry.name;
    if (name.startsWith("@")) {
      // Scoped package
      const scopePath = path.join(nodeModules, name);
      let scopedEntries;
      try {
        scopedEntries = await fs.readdir(scopePath, { withFileTypes: true });
      } catch (_error) {
        continue;
      }
      for (const se of scopedEntries) {
        if (!se.isDirectory() && !se.isSymbolicLink()) continue;
        const fullName = `${name}/${se.name}`;
        const size = await estimateDirSize(path.join(scopePath, se.name));
        sizes[fullName] = size;
      }
    } else {
      const size = await estimateDirSize(path.join(nodeModules, name));
      sizes[name] = size;
    }
  }

  return sizes;
}

// --- Internal helpers ---

function parsePackageJson(content) {
  try {
    const pkg = JSON.parse(content);
    const deps = {};
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      if (pkg[field] && typeof pkg[field] === "object") {
        for (const [name, version] of Object.entries(pkg[field])) {
          deps[name] = { version, type: field };
        }
      }
    }
    return deps;
  } catch (_error) {
    return {};
  }
}

function parsePythonDeps(content) {
  const deps = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*([><=!~]+.*)?$/);
    if (match) {
      deps[match[1].toLowerCase()] = { version: (match[2] || "*").trim(), type: "requirements" };
    }
  }
  return deps;
}

function parsePyProjectToml(content) {
  const deps = {};
  let inDeps = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[project]")) {
      inDeps = true;
      continue;
    }
    if (inDeps && trimmed.startsWith("dependencies")) {
      const depMatch = trimmed.match(/dependencies\s*=\s*\[/);
      if (depMatch) {
        // Simplified: capture any quoted names in the adjacent lines
        for (const [_, name] of trimmed.matchAll(/["']([a-zA-Z0-9_.-]+)/g)) {
          if (name !== "dependencies") {
            deps[name.toLowerCase()] = { version: "*", type: "dependencies" };
          }
        }
      }
    }
  }
  return deps;
}

function parseCargoToml(content) {
  const deps = {};
  let inDeps = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (/^\[dependencies\]/.test(trimmed)) {
      inDeps = true;
      continue;
    }
    if (inDeps) {
      if (trimmed.startsWith("[")) break;
      const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*(?:{.*version\s*=\s*["']([^"']+)["'].*}|["']([^"']+)["'])/);
      if (match) {
        deps[match[1]] = { version: match[2] || match[3] || "*", type: "dependencies" };
      }
    }
  }
  return deps;
}

function parseGoMod(content) {
  const deps = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("require")) continue;
    if (trimmed.startsWith("//")) continue;
    const match = trimmed.match(/^(\S+)\s+(v\S+)/);
    if (match) {
      deps[match[1]] = { version: match[2], type: "require" };
    }
  }
  return deps;
}

function parseGemfile(content) {
  const deps = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(/gem\s+["']([a-zA-Z0-9_-]+)["']\s*(?:,\s*["']([^"']*)["'])?/);
    if (match) {
      deps[match[1]] = { version: match[2] || "*", type: "gem" };
    }
  }
  return deps;
}

function parseComposerJson(content) {
  try {
    const composer = JSON.parse(content);
    const deps = {};
    if (composer.require) {
      for (const [name, version] of Object.entries(composer.require)) {
        deps[name] = { version, type: "require" };
      }
    }
    if (composer["require-dev"]) {
      for (const [name, version] of Object.entries(composer["require-dev"])) {
        deps[name] = { version, type: "require-dev" };
      }
    }
    return deps;
  } catch (_error) {
    return {};
  }
}

function extractKnownModules(depAnalysis) {
  const modules = new Set();
  for (const ecosystem of Object.values(depAnalysis.ecosystems)) {
    if (ecosystem && typeof ecosystem === "object") {
      for (const name of Object.keys(ecosystem)) {
        modules.add(name);
      }
    }
  }
  return modules;
}

async function collectSourceFiles(root) {
  const files = [];
  const ignored = new Set([
    "node_modules", ".git", "dist", "build", "coverage", ".next",
    ".nuxt", "out", "target", "vendor", "__pycache__", ".venv",
    ".hax-agent",
  ]);

  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    let entries;

    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (_error) {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!ignored.has(entry.name) && !entry.name.startsWith(".")) {
          pending.push(fullPath);
        }
        continue;
      }

      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push({
          absolute: fullPath,
          relative: path.relative(root, fullPath),
        });
      }
    }
  }

  return files;
}

function extractImports(content, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const imports = [];

  if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".ts" || ext === ".tsx" || ext === ".jsx") {
    const seen = new Set();
    for (const match of content.matchAll(JS_MODULE_IMPORT_RE)) {
      const mod = match[1] || match[2] || match[3];
      if (mod && !seen.has(mod)) {
        seen.add(mod);
        imports.push(mod);
      }
    }
  } else if (ext === ".py") {
    const seen = new Set();
    for (const match of content.matchAll(PYTHON_IMPORT_RE)) {
      const mod = match[1] || match[2];
      if (mod) {
        // Split comma-separated imports
        for (const part of mod.split(/\s*,\s*/)) {
          const trimmed = part.trim().split(/\s+/)[0];
          if (trimmed && !seen.has(trimmed)) {
            seen.add(trimmed);
            imports.push(trimmed);
          }
        }
      }
    }
  } else if (ext === ".rs") {
    const seen = new Set();
    for (const match of content.matchAll(RUST_USE_RE)) {
      const mod = match[1];
      if (mod && !seen.has(mod)) {
        seen.add(mod);
        imports.push(mod);
      }
    }
  } else if (ext === ".go") {
    const seen = new Set();
    for (const match of content.matchAll(GO_IMPORT_RE)) {
      const mod = match[1] || match[2];
      if (mod && !seen.has(mod)) {
        seen.add(mod);
        imports.push(mod);
      }
    }
  }

  return imports;
}

function getModuleRoot(importPath) {
  if (!importPath) return null;
  if (importPath.startsWith("@")) {
    const parts = importPath.split("/");
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return parts[0];
  }
  const parts = importPath.split("/");
  return parts[0];
}

function isBuiltIn(moduleName) {
  return isNodeBuiltIn(moduleName);
}

function isNodeBuiltIn(name) {
  const builtins = new Set([
    "assert", "buffer", "child_process", "cluster", "console", "crypto",
    "dgram", "dns", "events", "fs", "http", "https", "module", "net",
    "os", "path", "process", "querystring", "readline", "repl", "stream",
    "string_decoder", "timers", "tls", "tty", "url", "util", "v8", "vm",
    "zlib", "node:assert", "node:buffer", "node:child_process", "node:cluster",
    "node:console", "node:crypto", "node:dgram", "node:dns", "node:events",
    "node:fs", "node:http", "node:https", "node:module", "node:net",
    "node:os", "node:path", "node:process", "node:querystring", "node:readline",
    "node:repl", "node:stream", "node:string_decoder", "node:timers", "node:tls",
    "node:tty", "node:url", "node:util", "node:v8", "node:vm", "node:zlib",
  ]);
  return builtins.has(name);
}

function isRelativePath(importPath) {
  return importPath.startsWith("./") || importPath.startsWith("../");
}

function resolveRelativeImport(fromFile, importPath) {
  const fromDir = path.dirname(fromFile);
  const candidates = [
    normalizeSlashes(path.join(fromDir, importPath)),
    normalizeSlashes(`${path.join(fromDir, importPath)}.js`),
    normalizeSlashes(`${path.join(fromDir, importPath)}.ts`),
    normalizeSlashes(`${path.join(fromDir, importPath)}.mjs`),
    normalizeSlashes(`${path.join(fromDir, importPath)}.jsx`),
    normalizeSlashes(`${path.join(fromDir, importPath)}.tsx`),
    normalizeSlashes(`${path.join(fromDir, importPath)}/index.js`),
    normalizeSlashes(`${path.join(fromDir, importPath)}/index.ts`),
  ];
  return candidates;
}

async function estimateDirSize(dirPath) {
  let total = 0;
  const pending = [dirPath];

  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (_error) {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          pending.push(full);
        }
      } else if (entry.isFile()) {
        try {
          const st = await fs.stat(full);
          total += st.size;
        } catch (_error) { /* skip */ }
      }
    }
  }

  return total;
}

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

module.exports = {
  analyzeDependencies,
  getOutdatedDependencies,
  detectUnusedDependencies,
  buildDependencyGraph,
  findCircularDependencies,
  getDependencySizes,
};
