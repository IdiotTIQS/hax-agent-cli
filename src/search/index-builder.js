/**
 * Inverted-index builder for code search.
 *
 * Provides a CodeIndex class that tokenises source files (camelCase,
 * PascalCase, snake_case splitting), builds an inverted index, and
 * supports fast full-text + structural queries with optional persistence.
 */
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const IGNORED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".hg",
  ".svn",
  "__pycache__",
  ".DS_Store",
  "dist",
  "build",
  ".next",
  "coverage",
]);

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

// ---------------------------------------------------------------------------
// CodeIndex
// ---------------------------------------------------------------------------

class CodeIndex {
  constructor() {
    /**
     * Inverted index: token → [{ file, line, column }]
     * @type {Map<string, { file: string, line: number, column: number }[]>}
     */
    this.index = new Map();

    /**
     * Full file-content cache keyed by path.
     * @type {Map<string, string>}
     */
    this.files = new Map();

    /**
     * Number of documents indexed.
     * @type {number}
     */
    this.documentCount = 0;
  }

  // -----------------------------------------------------------------------
  // Indexing
  // -----------------------------------------------------------------------

  /**
   * Index a single file.
   *
   * @param {string} filePath - logical file path (used as key)
   * @param {string} content  - source code content
   * @returns {{ tokens: number }} stats for this file
   */
  indexFile(filePath, content) {
    // Remove any previous entry for this path
    this.remove(filePath);

    const tokens = tokenize(content);
    const lines = content.split(/\r?\n/);

    // For each token, record occurrences
    const tokenPositions = new Map(); // token → [{ line, column }]
    for (const t of tokens) {
      if (!tokenPositions.has(t.token)) {
        tokenPositions.set(t.token, []);
      }
      tokenPositions.get(t.token).push({ line: t.line, column: t.column });
    }

    // Merge into global index
    for (const [token, positions] of tokenPositions) {
      if (!this.index.has(token)) {
        this.index.set(token, []);
      }
      const entries = this.index.get(token);
      for (const pos of positions) {
        entries.push({ file: filePath, line: pos.line, column: pos.column });
      }
    }

    this.files.set(filePath, content);
    this.documentCount += 1;

    return { tokens: tokens.length };
  }

  /**
   * Index an entire directory tree recursively.
   *
   * @param {string} root - root directory to scan
   * @param {object} [options]
   * @param {string} [options.glob] - glob pattern for files (default: **​/*.js, **​/*.ts, etc.)
   * @param {number} [options.maxFileBytes] - max bytes per file (default 5 MB)
   * @param {string[]} [options.extensions] - file extensions to include
   * @returns {Promise<{ indexed: number, skipped: number, totalTokens: number }>}
   */
  async indexDirectory(root, options) {
    const opts = options || {};
    const exts = opts.extensions || [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".json", ".vue", ".css", ".html"];
    const maxFileBytes = opts.maxFileBytes || DEFAULT_MAX_FILE_BYTES;

    let indexed = 0;
    let skipped = 0;
    let totalTokens = 0;

    const files = await collectFiles(root, exts);
    for (const filePath of files) {
      try {
        const stat = await fs.stat(filePath);
        if (stat.size > maxFileBytes) {
          skipped += 1;
          continue;
        }
        const content = await fs.readFile(filePath, "utf-8");
        const rel = path.relative(root, filePath).replace(/\\/g, "/");
        const stats = this.indexFile(rel, content);
        totalTokens += stats.tokens;
        indexed += 1;
      } catch (_err) {
        skipped += 1;
      }
    }

    return { indexed, skipped, totalTokens };
  }

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  /**
   * Search the index for tokens matching *query*.
   *
   * The query is split into individual tokens using the same tokeniser.
   * Results are ranked by term-frequency / inverse-document-frequency (TF-IDF)
   * so that files containing many occurrences of rare tokens score higher.
   *
   * @param {string} query - search query (space-separated terms)
   * @param {object} [options]
   * @param {number} [options.maxResults=50] - maximum results to return
   * @param {boolean} [options.context=false] - include surrounding context lines
   * @returns {{ file: string, line: number, column: number, score: number, context?: string }[]}
   */
  search(query, options) {
    const opts = options || {};
    const maxResults = opts.maxResults || 50;
    const includeContext = opts.context === true;
    const queryTokens = tokenizeSimple(query);

    if (queryTokens.length === 0) return [];

    // Collect candidate positions per file, compute TF-IDF scores
    const fileScores = new Map(); // file → score
    const fileMatches = new Map(); // file → [{ line, column }]

    for (const qToken of queryTokens) {
      const lower = qToken.toLowerCase();
      const postings = this.index.get(lower);
      if (!postings) continue;

      // IDF: log(totalDocs / docFreq)
      const docSet = new Set();
      for (const p of postings) {
        docSet.add(p.file);
      }
      const idf = Math.log(this.documentCount / docSet.size + 1);

      for (const p of postings) {
        // TF: count occurrences in this file
        const tf = countPostingsForFile(postings, p.file);

        const contrib = tf * idf;
        fileScores.set(p.file, (fileScores.get(p.file) || 0) + contrib);

        if (!fileMatches.has(p.file)) {
          fileMatches.set(p.file, []);
        }
        fileMatches.get(p.file).push({ line: p.line, column: p.column });
      }
    }

    // Flatten and sort
    const results = [];
    for (const [file, score] of fileScores) {
      const matches = fileMatches.get(file) || [];
      for (const m of matches) {
        results.push({
          file,
          line: m.line,
          column: m.column,
          score: Math.round(score * 100) / 100,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const sliced = results.slice(0, maxResults);

    // Optionally attach context
    if (includeContext) {
      for (const r of sliced) {
        const content = this.files.get(r.file);
        if (content) {
          r.context = extractContext(content, r.line, 2);
        }
      }
    }

    return sliced;
  }

  // -----------------------------------------------------------------------
  // Update & remove
  // -----------------------------------------------------------------------

  /**
   * Update the index for a file (remove old entry, index new content).
   */
  update(filePath, newContent) {
    this.remove(filePath);
    return this.indexFile(filePath, newContent);
  }

  /**
   * Remove a file from the index entirely.
   */
  remove(filePath) {
    // Remove entries from inverted index
    for (const [token, postings] of this.index) {
      const filtered = postings.filter((p) => p.file !== filePath);
      if (filtered.length === 0) {
        this.index.delete(token);
      } else {
        this.index.set(token, filtered);
      }
    }

    if (this.files.has(filePath)) {
      this.files.delete(filePath);
      this.documentCount = Math.max(0, this.documentCount - 1);
    }
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  /**
   * Save the index to a JSON file.
   *
   * @param {string} filePath - destination file path
   */
  async save(filePath) {
    const data = {
      documentCount: this.documentCount,
      index: Array.from(this.index.entries()),
      files: Array.from(this.files.entries()),
    };
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * Load the index from a JSON file (replaces current state).
   *
   * @param {string} filePath - source file path
   */
  async load(filePath) {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw);

    this.documentCount = data.documentCount || 0;
    this.index = new Map(data.index || []);
    this.files = new Map(data.files || []);
  }
}

// ---------------------------------------------------------------------------
// Tokenisation
// ---------------------------------------------------------------------------

/**
 * Tokenise source code text, splitting camelCase, PascalCase, and
 * snake_case identifiers.  Returns tokens with line/column info.
 *
 * @param {string} code
 * @returns {{ token: string, line: number, column: number }[]}
 */
function tokenize(code) {
  const lines = code.split(/\r?\n/);
  const tokens = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx];
    // Match identifiers (roughly: letters, digits, underscore, dollar)
    const idRe = /[A-Za-z_$][A-Za-z0-9_$]*/g;
    let m;
    while ((m = idRe.exec(line)) !== null) {
      const subTokens = splitIdentifier(m[0]);
      for (const st of subTokens) {
        tokens.push({
          token: st,
          line: lineIdx + 1,
          column: m.index + 1,
        });
      }
    }
  }

  return tokens;
}

/**
 * Simple tokenisation for query strings (no line/column).
 *
 * @param {string} text
 * @returns {string[]}
 */
function tokenizeSimple(text) {
  const tokens = [];
  const idRe = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  let m;
  while ((m = idRe.exec(text)) !== null) {
    const subTokens = splitIdentifier(m[0]);
    for (const st of subTokens) {
      tokens.push(st.toLowerCase());
    }
  }
  return tokens;
}

/**
 * Split a camelCase / PascalCase / snake_case identifier into constituent
 * lower-case parts.
 *
 * Examples:
 *   "fooBarBaz"    → ["foo", "bar", "baz"]
 *   "HTMLElement"  → ["html", "element"]
 *   "snake_case"   → ["snake", "case"]
 *   "SCREAM_CASE"  → ["scream", "case"]
 */
function splitIdentifier(ident) {
  const parts = [];

  // First split on underscores
  const underscoreParts = ident.split("_");

  for (const part of underscoreParts) {
    if (part.length === 0) continue;

    // Split camelCase / PascalCase
    const camelParts = part.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
    for (const cp of camelParts) {
      if (cp.length > 0) {
        parts.push(cp.toLowerCase());
      }
    }
  }

  return parts;
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

/**
 * Recursively collect all files matching the given extensions under *root*.
 */
async function collectFiles(root, extensions) {
  const extSet = new Set(extensions.map((e) => e.toLowerCase()));
  const results = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (_err) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIR_NAMES.has(entry.name)) continue;
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extSet.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  await walk(root);
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count how many postings in *list* belong to *file*.
 */
function countPostingsForFile(list, file) {
  let count = 0;
  for (const p of list) {
    if (p.file === file) count += 1;
  }
  return count;
}

/**
 * Extract context lines around a specific line number.
 */
function extractContext(code, line, contextLines) {
  const lines = code.split(/\r?\n/);
  const start = Math.max(0, line - 1 - contextLines);
  const end = Math.min(lines.length, line + contextLines);
  return lines.slice(start, end).join("\n");
}

module.exports = { CodeIndex, tokenize, tokenizeSimple, splitIdentifier };
