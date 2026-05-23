"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { analyzeCodebase, getProjectType, getKeyFiles } = require("./codebase-analyzer");
const { analyzeDependencies } = require("./dependency-analyzer");

const MAX_FILES_IN_TREE = 200;
const MAX_TREE_DEPTH = 5;
const MAX_SUMMARY_FILES = 50;

const RELEVANCE_WEIGHTS = {
  filenameMatch: 30,
  pathTokenMatch: 20,
  contentContains: 5,
  entryPoint: 15,
  configFile: 10,
  testFile: -5,
  recentlyModified: 8,
};

/**
 * Builds a structured context for LLM consumption about a project.
 * @param {string} root - Project root directory
 * @param {object} [options] - Builder options
 * @param {boolean} [options.includeDeps=true] - Include dependency info
 * @param {boolean} [options.includeTree=true] - Include file tree
 * @param {boolean} [options.includeStats=true] - Include git stats
 * @param {number} [options.maxTreeFiles=200] - Max files in tree
 * @returns {Promise<object>} Structured project context
 */
async function buildProjectContext(root, options = {}) {
  const resolved = path.resolve(root);
  const includeDeps = options.includeDeps !== false;
  const includeTree = options.includeTree !== false;
  const includeStats = options.includeStats !== false;
  const maxTreeFiles = options.maxTreeFiles || MAX_FILES_IN_TREE;

  const [codebase, deps, projectType, keyFiles] = await Promise.all([
    analyzeCodebase(resolved),
    includeDeps ? analyzeDependencies(resolved) : null,
    getProjectType(resolved),
    getKeyFiles(resolved),
  ]);

  const tree = includeTree
    ? await buildFileTree(resolved, maxTreeFiles, MAX_TREE_DEPTH)
    : [];

  const context = {
    project: {
      root: resolved,
      type: projectType,
      name: path.basename(resolved),
      languages: Object.keys(codebase.languages),
    },
    overview: {
      totalFiles: codebase.summary.totalFiles,
      totalLines: codebase.summary.totalLines,
      testFiles: codebase.testFileCount,
      estimatedCoverage: codebase.estimatedTestCoverage,
      docFiles: codebase.docFileCount,
      entryPoints: keyFiles.entryPoints,
      configFiles: keyFiles.configFiles,
      mainSourceDirs: keyFiles.mainSourceDirs,
    },
    dependencies: deps ? formatDepSummary(deps) : null,
    fileTree: tree,
  };

  return context;
}

/**
 * Selects files relevant to a query using heuristic matching.
 * @param {string} root - Project root directory
 * @param {string} query - Query string to match against files
 * @param {object} [options] - Selection options
 * @param {number} [options.maxResults=10] - Maximum files to return
 * @param {boolean} [options.includeContent=false] - Include file content snippets
 * @returns {Promise<Array<object>>} Array of relevant file objects sorted by relevance
 */
async function selectRelevantFiles(root, query, options = {}) {
  const resolved = path.resolve(root);
  const maxResults = Number.isSafeInteger(options.maxResults) && options.maxResults > 0
    ? options.maxResults
    : 10;
  const includeContent = !!options.includeContent;
  const queryLower = String(query || "").toLowerCase();
  const queryTokens = tokenize(queryLower);

  if (queryTokens.length === 0) return [];

  const files = await scanProjectFiles(resolved);
  const scored = [];

  for (const file of files) {
    const score = computeRelevanceScore(file, queryTokens, queryLower);
    if (score > 0) {
      scored.push({ ...file, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.relative.localeCompare(b.relative));
  const selected = scored.slice(0, maxResults);

  if (includeContent) {
    for (const file of selected) {
      try {
        const content = await fs.readFile(file.absolute, "utf8");
        file.snippet = createContextSnippet(content, queryTokens);
      } catch (_error) {
        file.snippet = "";
      }
    }
  }

  return selected.map(f => ({
    path: f.relative,
    score: f.score,
    extension: f.ext,
    snippet: f.snippet || "",
  }));
}

/**
 * Summarizes the contents of a directory.
 * @param {string} root - Project root directory
 * @param {string} dir - Target directory (relative to root or absolute)
 * @returns {Promise<object>} Directory summary
 */
async function summarizeDirectory(root, dir) {
  const resolved = path.resolve(root);
  const targetDir = path.isAbsolute(dir) ? dir : path.join(resolved, dir);

  let stats;
  try {
    stats = await fs.stat(targetDir);
    if (!stats.isDirectory()) {
      return { error: `Not a directory: ${dir}` };
    }
  } catch (_error) {
    return { error: `Directory not found: ${dir}` };
  }

  const files = [];
  const subdirs = [];
  let totalSize = 0;

  let entries;
  try {
    entries = await fs.readdir(targetDir, { withFileTypes: true });
  } catch (_error) {
    return { error: `Cannot read directory: ${dir}` };
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      subdirs.push({ name: entry.name });
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      let size = 0;
      try {
        const st = await fs.stat(path.join(targetDir, entry.name));
        size = st.size;
        totalSize += size;
      } catch (_error) { /* skip */ }

      files.push({
        name: entry.name,
        ext,
        size,
      });
    }
  }

  if (files.length > MAX_SUMMARY_FILES) {
    files.length = MAX_SUMMARY_FILES;
  }

  // Group files by extension
  const byExtension = Object.create(null);
  for (const f of files) {
    const ext = f.ext || "(no extension)";
    byExtension[ext] = (byExtension[ext] || 0) + 1;
  }

  return {
    directory: normalizeSlashes(path.relative(resolved, targetDir)) || ".",
    stats: {
      fileCount: files.length,
      subdirCount: subdirs.length,
      totalSizeBytes: totalSize,
    },
    subdirectories: subdirs.map(d => d.name),
    topFiles: files.slice(0, 20).map(f => ({
      name: f.name,
      size: f.size,
    })),
    byExtension,
  };
}

// --- Internal helpers ---

async function buildFileTree(root, maxFiles, maxDepth) {
  const tree = [];
  const ignored = new Set([
    "node_modules", ".git", "dist", "build", "coverage", ".next",
    ".nuxt", "out", "target", "vendor", "__pycache__", ".venv",
    "venv", ".tox", ".idea", ".vscode", ".hax-agent", ".cache",
  ]);

  async function walk(dirPath, depth, parent) {
    if (depth > maxDepth || tree.length >= maxFiles) return;

    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (_error) {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (tree.length >= maxFiles) break;
      if (entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".") && entry.name.length > 1 && entry.name !== ".env.example" && entry.name !== ".gitignore") continue;

      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) continue;
        const node = { name: entry.name, type: "directory", children: [] };
        if (parent) {
          parent.children.push(node);
        } else {
          tree.push(node);
        }
        await walk(path.join(dirPath, entry.name), depth + 1, node);
        // Remove empty directories
        if (node.children.length === 0) {
          if (parent) {
            parent.children.pop();
          } else {
            tree.pop();
          }
        }
      } else {
        const node = {
          name: entry.name,
          type: "file",
          ext: path.extname(entry.name).toLowerCase(),
        };
        if (parent) {
          parent.children.push(node);
        } else {
          tree.push(node);
        }
      }
    }
  }

  await walk(root, 0, null);
  return tree;
}

async function scanProjectFiles(root) {
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
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        files.push({
          absolute: fullPath,
          relative: normalizeSlashes(path.relative(root, fullPath)),
          ext,
          name: entry.name,
        });
      }
    }
  }

  return files;
}

function computeRelevanceScore(file, queryTokens, queryLower) {
  let score = 0;
  const fileNameLower = file.name.toLowerCase();
  const pathLower = file.relative.toLowerCase();

  // Filename match
  for (const token of queryTokens) {
    if (fileNameLower.includes(token)) {
      score += RELEVANCE_WEIGHTS.filenameMatch;
    }
    if (pathLower.includes(token)) {
      score += RELEVANCE_WEIGHTS.pathTokenMatch;
    }
  }

  // Entry point bonus
  if (["index.js", "index.ts", "main.js", "main.ts", "app.js", "cli.js", "main.py", "main.rs", "main.go"].includes(file.name)) {
    score += RELEVANCE_WEIGHTS.entryPoint;
  }

  // Config file bonus
  if (isLikelyConfig(file.name)) {
    score += RELEVANCE_WEIGHTS.configFile;
  }

  // Test file penalty (less relevant for queries unless query is about testing)
  if (/\.(test|spec)\./.test(fileNameLower) || fileNameLower.includes("__tests__")) {
    if (!/test|spec|coverage|jest|mocha/.test(queryLower)) {
      score += RELEVANCE_WEIGHTS.testFile;
    }
  }

  return score;
}

function createContextSnippet(content, queryTokens) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let bestLine = 0;
  let bestScore = 0;

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    let lineScore = 0;
    for (const token of queryTokens) {
      if (lower.includes(token)) lineScore += 1;
    }
    if (lineScore > bestScore) {
      bestScore = lineScore;
      bestLine = i;
    }
  }

  const start = Math.max(0, bestLine - 10);
  const end = Math.min(lines.length, bestLine + 15);

  let snippet = lines.slice(start, end).join("\n").trim();
  if (Buffer.byteLength(snippet, "utf8") > 2000) {
    snippet = snippet.slice(0, 2000) + "\n[truncated]";
  }

  return snippet;
}

function formatDepSummary(depAnalysis) {
  if (!depAnalysis) return null;
  const summary = [];
  for (const [ecosystem, deps] of Object.entries(depAnalysis.ecosystems || {})) {
    if (deps && typeof deps === "object") {
      const count = Object.keys(deps).length;
      if (count > 0) {
        summary.push({
          ecosystem,
          dependencyCount: count,
          highlights: Object.keys(deps).slice(0, 10),
        });
      }
    }
  }
  return summary.length > 0 ? summary : null;
}

function tokenize(value) {
  return (String(value).match(/[a-z0-9_$.-]+|[一-鿿]{2,}/g) || [])
    .map(t => t.toLowerCase())
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t))
    .slice(0, 32);
}

function isLikelyConfig(fileName) {
  const lower = fileName.toLowerCase();
  const configPatterns = [
    "package.json", "tsconfig.json", "vite.config.", "webpack.config.",
    "eslint", "prettier", "jest.config.", "babel.config.",
    "pyproject.toml", "cargo.toml", "go.mod", ".gitignore",
    "dockerfile", "makefile", ".env",
  ];
  return configPatterns.some(p => lower.includes(p));
}

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "how", "what", "why",
  "when", "where", "can", "you", "please", "fix", "bug", "issue", "file",
  "project", "code", "in", "on", "to", "of", "is", "a", "an", "be", "it",
  "or", "as", "at", "by", "my", "we", "are", "do", "does", "has", "had",
]);

module.exports = {
  buildProjectContext,
  selectRelevantFiles,
  summarizeDirectory,
};
