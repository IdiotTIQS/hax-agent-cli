"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const SOURCE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".py", ".rs", ".go", ".rb", ".php", ".java",
  ".c", ".cc", ".cpp", ".h", ".hpp", ".cs",
  ".swift", ".kt", ".scala", ".lua", ".sh",
  ".sql", ".css", ".scss", ".less", ".html",
  ".vue", ".svelte", ".json", ".xml", ".yaml", ".yml",
  ".toml", ".md", ".txt", ".graphql", ".proto",
]);

const TEST_PATTERNS = [
  /[\\/]test[\\/]/, /[\\/]tests[\\/]/, /[\\/]__tests__[\\/]/,
  /[\\/]spec[\\/]/, /\.test\./, /\.spec\./, /_test\./, /Test\./,
];

const DOC_PATTERNS = [
  /readme\.md$/i, /changelog\.md$/i, /contributing\.md$/i,
  /license(?:\.md|\.txt)?$/i, /\.github[\\/]/, /docs[\\/]/,
  /\.md$/, /\.rst$/,
];

const CONFIG_PATTERNS = [
  "package.json", "tsconfig.json", "vite.config.", "webpack.config.",
  ".eslintrc", ".prettierrc", "jest.config.", ".babelrc",
  "pyproject.toml", "setup.py", "setup.cfg", "Cargo.toml",
  "go.mod", "composer.json", "Gemfile", "Makefile", "Dockerfile",
  ".env.example", ".env", ".gitignore", ".eslintignore",
];

const ENTRY_POINT_NAMES = new Set([
  "index.js", "index.ts", "main.js", "main.ts", "app.js", "app.ts",
  "server.js", "server.ts", "cli.js", "cli.ts",
  "main.py", "app.py", "main.rs", "main.go",
]);

/**
 * Performs comprehensive analysis of a codebase directory.
 * @param {string} root - Project root directory
 * @param {object} [options] - Analysis options
 * @param {boolean} [options.includeNodeModules=false] - Whether to scan node_modules
 * @param {number} [options.maxFiles=10000] - Maximum files to analyze
 * @returns {Promise<object>} Comprehensive codebase analysis result
 */
async function analyzeCodebase(root, options = {}) {
  const resolved = path.resolve(root);
  const includeNodeModules = !!options.includeNodeModules;
  const maxFiles = Number.isSafeInteger(options.maxFiles) && options.maxFiles > 0
    ? options.maxFiles
    : 10000;

  const fileExtensions = new Map();
  const directoryStructure = Object.create(null);
  const testFiles = [];
  const docFiles = [];
  const configFiles = [];
  const entryPoints = [];
  const allFiles = [];
  let totalLines = 0;

  const ignored = buildIgnoredSet(includeNodeModules);

  const pending = [{
    dirPath: resolved,
    treeNode: directoryStructure,
  }];

  let fileCount = 0;

  while (pending.length > 0 && fileCount < maxFiles) {
    const { dirPath, treeNode } = pending.shift();
    let entries;

    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (_error) {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (fileCount >= maxFiles) break;
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) continue;
        treeNode[entry.name] = treeNode[entry.name] || Object.create(null);
        pending.push({
          dirPath: path.join(dirPath, entry.name),
          treeNode: treeNode[entry.name],
        });
      } else if (entry.isFile()) {
        fileCount += 1;
        const ext = path.extname(entry.name).toLowerCase();
        const relPath = normalizeSlashes(path.relative(resolved, path.join(dirPath, entry.name)));

        fileExtensions.set(ext, (fileExtensions.get(ext) || 0) + 1);

        let lineCount = 0;
        try {
          const content = await fs.readFile(path.join(dirPath, entry.name), "utf8");
          lineCount = content.split("\n").length;
          totalLines += lineCount;
        } catch (_error) { /* binary or unreadable */ }

        const fileInfo = { path: relPath, lines: lineCount, ext };

        allFiles.push(fileInfo);

        if (isTestFile(relPath)) {
          testFiles.push(fileInfo);
        }
        if (isDocFile(relPath)) {
          docFiles.push(fileInfo);
        }
        if (isConfigFile(relPath, entry.name)) {
          configFiles.push(fileInfo);
        }
        if (isEntryPoint(relPath, entry.name)) {
          entryPoints.push(fileInfo);
        }
      }
    }
  }

  const languages = detectLanguages(fileExtensions);

  return {
    projectRoot: resolved,
    summary: {
      totalFiles: fileCount,
      totalLines,
      extensionCount: fileExtensions.size,
      directoryCount: countDirs(directoryStructure),
      languageCount: Object.keys(languages).length,
    },
    filesByExtension: Object.fromEntries(
      [...fileExtensions.entries()].sort((a, b) => b[1] - a[1])
    ),
    languages,
    testFiles,
    testFileCount: testFiles.length,
    estimatedTestCoverage: fileCount > 0
      ? (testFiles.length / fileCount * 100).toFixed(1) + "%"
      : "0%",
    docFiles,
    docFileCount: docFiles.length,
    configFiles,
    entryPoints,
    directoryStructure: pruneEmptyDirs(directoryStructure),
  };
}

/**
 * Detects the type of project based on structure and files.
 * @param {string} root - Project root directory
 * @returns {Promise<string>} Project type string
 */
async function getProjectType(root) {
  const resolved = path.resolve(root);
  const files = new Set();
  const dirs = new Set();

  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        dirs.add(entry.name.toLowerCase());
      } else if (entry.isFile()) {
        files.add(entry.name.toLowerCase());
      }
    }
  } catch (_error) {
    return "unknown";
  }

  // Monorepo detection
  if (dirs.has("packages") || dirs.has("apps")) return "monorepo";
  if (files.has("lerna.json") || files.has("nx.json") || files.has("pnpm-workspace.yaml") || files.has("rush.json")) return "monorepo";
  if (files.has("turbo.json")) return "monorepo";

  // Web app detection
  if (files.has("next.config.js") || files.has("next.config.mjs") || files.has("next.config.ts")) return "web-app: Next.js";
  if (files.has("nuxt.config.js") || files.has("nuxt.config.ts")) return "web-app: Nuxt";
  if (files.has("svelte.config.js")) return "web-app: SvelteKit";
  if (files.has("vite.config.js") || files.has("vite.config.ts")) return "web-app: Vite";
  if (files.has("remix.config.js") || files.has("remix.config.ts")) return "web-app: Remix";
  if (files.has("astro.config.mjs") || files.has("astro.config.ts")) return "web-app: Astro";
  if (files.has("gatsby-config.js")) return "web-app: Gatsby";
  if (dirs.has("public") && (files.has("index.html") || files.has("package.json"))) return "web-app";

  // CLI detection
  if (files.has("package.json")) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(resolved, "package.json"), "utf8"));
      if (pkg.bin || (pkg.keywords && pkg.keywords.some(k => /cli/i.test(k)))) {
        return "cli";
      }
    } catch (_error) { /* ignore */ }
  }
  if (files.has("cli.js") || files.has("cli.ts")) return "cli";

  // Library detection
  if (files.has("package.json")) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(resolved, "package.json"), "utf8"));
      if (pkg.main || pkg.module || pkg.types || pkg.exports) {
        if (!pkg.scripts || !pkg.scripts.dev) return "library";
      }
    } catch (_error) { /* ignore */ }
  }

  // Language-specific project types
  if (files.has("cargo.toml")) return "rust";
  if (files.has("go.mod")) return "go";
  if (files.has("requirements.txt") || files.has("pyproject.toml") || files.has("setup.py")) return "python";
  if (files.has("gemfile")) return "ruby";
  if (files.has("composer.json")) return "php";

  if (files.has("package.json")) return "node";
  return "unknown";
}

/**
 * Identifies key files in the project: entry points, configs, main source directories.
 * @param {string} root - Project root directory
 * @returns {Promise<object>} Key files grouped by category
 */
async function getKeyFiles(root) {
  const resolved = path.resolve(root);
  const result = {
    entryPoints: [],
    configFiles: [],
    mainSourceDirs: [],
    manifestFiles: [],
    documentation: [],
  };

  let entries;
  try {
    entries = await fs.readdir(resolved, { withFileTypes: true });
  } catch (_error) {
    return result;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    const nameLower = entry.name.toLowerCase();

    if (entry.isDirectory()) {
      if (nameLower === "src" || nameLower === "lib" || nameLower === "app" || nameLower === "source") {
        result.mainSourceDirs.push(entry.name);
      }
      if (nameLower === "docs" || nameLower === "documentation") {
        result.documentation.push(entry.name);
      }
    }

    if (entry.isFile()) {
      if (ENTRY_POINT_NAMES.has(entry.name)) {
        result.entryPoints.push(entry.name);
      }
      if (isConfigFileEntry(entry.name)) {
        result.configFiles.push(entry.name);
      }
      if (["package.json", "requirements.txt", "Cargo.toml", "go.mod", "Gemfile", "composer.json", "pyproject.toml"].includes(entry.name)) {
        result.manifestFiles.push(entry.name);
      }
      if (DOC_PATTERNS.some(p => p.test(entry.name)) && !isConfigFileEntry(entry.name)) {
        result.documentation.push(entry.name);
      }
    }
  }

  return result;
}

/**
 * Retrieves Git statistics for a repository.
 * @param {string} root - Project root directory
 * @returns {Promise<object>} Git stats including recent commits, branches, contributors
 */
async function getGitStats(root) {
  const resolved = path.resolve(root);

  // Check if .git directory exists
  try {
    await fs.access(path.join(resolved, ".git"));
  } catch (_error) {
    return { available: false, reason: "Not a git repository" };
  }

  return {
    available: true,
    note: "Git stats require spawning 'git' process. Use child_process.execSync or similar for live data.",
    suggestedCommands: {
      recentCommits: "git log --oneline --since='2 weeks ago' --all",
      activeBranches: "git branch -a --sort=-committerdate | head -10",
      contributors: "git shortlog -sn --all",
      lineStats: "git log --numstat --since='1 month ago'",
    },
  };
}

// --- Internal helpers ---

function buildIgnoredSet(includeNodeModules) {
  const ignored = new Set([
    ".git", ".hg", ".svn", ".hax-agent",
    "dist", "build", "coverage", ".next", ".nuxt",
    ".vite", ".cache", "out", "target", "vendor",
    "__pycache__", ".venv", "venv", ".tox",
    ".idea", ".vscode", ".vs",
  ]);
  if (!includeNodeModules) {
    ignored.add("node_modules");
  }
  return ignored;
}

function countDirs(node) {
  let count = 0;
  for (const key of Object.keys(node)) {
    if (node[key] && typeof node[key] === "object" && key !== "type") {
      count += 1 + countDirs(node[key]);
    }
  }
  return count;
}

function isTestFile(filePath) {
  return TEST_PATTERNS.some(p => p.test(filePath));
}

function isDocFile(filePath) {
  return DOC_PATTERNS.some(p => p.test(filePath));
}

function isConfigFile(filePath, fileName) {
  const lower = fileName.toLowerCase();
  return CONFIG_PATTERNS.some(p => {
    if (typeof p === "string") return lower === p;
    return p.test(filePath) || p.test(lower);
  });
}

function isConfigFileEntry(fileName) {
  const lower = fileName.toLowerCase();
  return CONFIG_PATTERNS.some(p => {
    if (typeof p === "string") {
      return lower === p || lower.startsWith(p.replace(".", ""));
    }
    return p.test(lower);
  });
}

function isEntryPoint(filePath, fileName) {
  if (ENTRY_POINT_NAMES.has(fileName)) return true;
  // Check if it's in the root of the source directory
  const parts = normalizeSlashes(filePath).split("/");
  if (parts.length === 2 && parts[0] === "src" && ENTRY_POINT_NAMES.has(parts[1])) {
    return true;
  }
  return false;
}

function detectLanguages(fileExtensions) {
  const langMap = {
    ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
    ".jsx": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript",
    ".py": "Python", ".rs": "Rust", ".go": "Go",
    ".rb": "Ruby", ".php": "PHP", ".java": "Java",
    ".c": "C", ".cc": "C++", ".cpp": "C++", ".h": "C/C++", ".hpp": "C++",
    ".cs": "C#", ".swift": "Swift", ".kt": "Kotlin",
    ".scala": "Scala", ".lua": "Lua", ".sh": "Shell",
    ".sql": "SQL", ".css": "CSS", ".scss": "CSS", ".less": "CSS",
    ".html": "HTML", ".vue": "Vue", ".svelte": "Svelte",
    ".json": "JSON", ".xml": "XML", ".yaml": "YAML", ".yml": "YAML",
    ".toml": "TOML", ".md": "Markdown", ".txt": "Text",
    ".graphql": "GraphQL", ".proto": "Protobuf",
  };

  const languages = Object.create(null);

  for (const [ext, count] of fileExtensions.entries()) {
    const lang = langMap[ext] || ext.slice(1).toUpperCase();
    languages[lang] = (languages[lang] || 0) + count;
  }

  return languages;
}

function pruneEmptyDirs(node) {
  if (!node || typeof node !== "object") return node;

  for (const key of Object.keys(node)) {
    const child = node[key];
    if (typeof child === "object" && child !== null) {
      const pruned = pruneEmptyDirs(child);
      if (pruned && Object.keys(pruned).length === 0) {
        delete node[key];
      } else {
        node[key] = pruned;
      }
    }
  }

  return node;
}

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

module.exports = {
  analyzeCodebase,
  getProjectType,
  getKeyFiles,
  getGitStats,
};
