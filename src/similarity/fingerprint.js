/**
 * CodeFingerprint — generates unique fingerprints for code artifacts.
 *
 * Produces content-addressable hashes combined with structural features
 * for efficient similarity comparison. Supports single files, directories,
 * and comparison between fingerprint sets.
 *
 * Fingerprint object shape:
 *   { hash, structuralHash, features: { lines, tokens, keywords, ... }, path }
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * SHA-256 hash of a string input.
 */
function sha256(input) {
  return crypto.createHash("sha256").update(input, "utf-8").digest("hex");
}

/**
 * Normalize whitespace: collapse all sequences to single spaces, trim lines,
 * remove blank lines.
 */
function normalizeWhitespace(code) {
  return code
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Strip comments from source code, preserving string literals.
 */
function stripComments(code) {
  const result = [];
  let i = 0;
  let inString = false;
  let stringChar = "";
  let inTemplate = false;

  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1] || "";

    if (ch === "\\" && (inString || inTemplate)) {
      result.push(ch, code[i + 1] || "");
      i += 2;
      continue;
    }

    if (ch === "`" && !inString) {
      inTemplate = !inTemplate;
      result.push(ch);
      i++;
      continue;
    }

    if ((ch === "\"" || ch === "'") && !inTemplate) {
      if (!inString) { inString = true; stringChar = ch; }
      else if (ch === stringChar) { inString = false; }
      result.push(ch);
      i++;
      continue;
    }

    if (!inString && !inTemplate) {
      if (ch === "/" && next === "/") {
        i += 2;
        while (i < code.length && code[i] !== "\n") i++;
        if (i < code.length) { result.push("\n"); i++; }
        continue;
      }
      if (ch === "/" && next === "*") {
        i += 2;
        while (i < code.length - 1 && !(code[i] === "*" && code[i + 1] === "/")) {
          if (code[i] === "\n") result.push("\n");
          i++;
        }
        i += 2;
        continue;
      }
    }

    result.push(ch);
    i++;
  }

  return result.join("");
}

/**
 * Normalize identifiers: replace all user identifiers with incrementing
 * generic placeholders. Preserves keywords, built-ins, and structure.
 */
function normalizeIdentifiers(code) {
  const reserved = new Set([
    "break", "case", "catch", "class", "const", "continue", "debugger",
    "default", "delete", "do", "else", "export", "extends", "finally",
    "for", "function", "if", "import", "in", "instanceof", "let", "new",
    "of", "return", "super", "switch", "this", "throw", "try", "typeof",
    "var", "void", "while", "with", "yield", "async", "await", "from",
    "as", "static", "get", "set",
    "console", "Math", "JSON", "Object", "Array", "String", "Number",
    "Boolean", "Symbol", "Map", "Set", "Promise", "Error", "Date", "RegExp",
    "parseInt", "parseFloat", "isNaN", "isFinite", "require", "module",
    "exports", "process", "Buffer", "setTimeout", "setInterval",
    "clearTimeout", "clearInterval", "globalThis", "global", "undefined",
    "null", "true", "false", "Infinity", "NaN",
    "__dirname", "__filename",
  ]);

  const idMap = new Map();
  let counter = 0;

  function replace(ident) {
    if (reserved.has(ident)) return ident;
    if (!idMap.has(ident)) idMap.set(ident, `id_${counter++}`);
    return idMap.get(ident);
  }

  const result = [];
  let i = 0;
  let inString = false;
  let sq = "";
  let inTpl = false;
  let inSingle = false;
  let inBlock = false;

  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1] || "";

    if (ch === "\\" && (inString || inTpl)) { result.push(ch, next); i += 2; continue; }
    if (ch === "`" && !inString && !inSingle && !inBlock) { inTpl = !inTpl; result.push(ch); i++; continue; }
    if ((ch === "\"" || ch === "'") && !inTpl && !inSingle && !inBlock) {
      if (!inString) { inString = true; sq = ch; }
      else if (ch === sq) { inString = false; }
      result.push(ch); i++; continue;
    }
    if (inString || inTpl) { result.push(ch); i++; continue; }

    if (ch === "/" && next === "/" && !inBlock) { inSingle = true; result.push(ch, next); i += 2; continue; }
    if (inSingle) { result.push(ch); if (ch === "\n") inSingle = false; i++; continue; }
    if (ch === "/" && next === "*") { inBlock = true; result.push(ch, next); i += 2; continue; }
    if (inBlock) { result.push(ch); if (ch === "*" && next === "/") { result.push(next); inBlock = false; i += 2; continue; } i++; continue; }

    if (/[a-zA-Z_$]/.test(ch)) {
      const start = i;
      i++;
      while (i < code.length && /[\w$]/.test(code[i])) i++;
      result.push(replace(code.slice(start, i)));
      continue;
    }

    result.push(ch);
    i++;
  }

  return result.join("");
}

/**
 * Extract a keyword frequency histogram from code.
 * Returns an object mapping keyword to occurrence count.
 */
function keywordHistogram(code) {
  const keywords = [
    "if", "else", "for", "while", "do", "switch", "case", "break",
    "continue", "return", "throw", "try", "catch", "finally",
    "function", "class", "new", "await", "async", "yield",
    "const", "let", "var", "import", "export", "default",
    "typeof", "instanceof", "delete", "void",
  ];

  const hist = {};
  for (const kw of keywords) {
    const regex = new RegExp("\\b" + kw + "\\b", "g");
    const count = (code.match(regex) || []).length;
    if (count > 0) {
      hist[kw] = count;
    }
  }
  return hist;
}

/**
 * Extract token count and compute a token distribution summary.
 */
function tokenStats(code) {
  // Simple tokenizer
  const tokens = [];
  let i = 0;
  let inString = false;
  let sq = "";
  let inTpl = false;

  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1] || "";

    if (/\s/.test(ch) && !inString && !inTpl) { i++; continue; }

    if (ch === "\\" && (inString || inTpl)) { i += 2; continue; }
    if (ch === "`" && !inString) { inTpl = !inTpl; tokens.push("TPL"); i++; continue; }
    if ((ch === "\"" || ch === "'") && !inTpl) {
      if (!inString) { inString = true; sq = ch; }
      else if (ch === sq) { inString = false; }
      tokens.push("STR"); i++; continue;
    }
    if (inString) { i++; continue; }
    if (inTpl) {
      if (ch === "$" && next === "{") { tokens.push("${"); i += 2; continue; }
      i++; continue;
    }

    // Comments
    if (ch === "/" && next === "/") { i += 2; while (i < code.length && code[i] !== "\n") i++; continue; }
    if (ch === "/" && next === "*") { i += 2; while (i < code.length - 1 && !(code[i] === "*" && code[i + 1] === "/")) i++; i += 2; continue; }

    if (/[a-zA-Z_$]/.test(ch)) {
      const start = i;
      i++;
      while (i < code.length && /[\w$]/.test(code[i])) i++;
      tokens.push(code.slice(start, i));
      continue;
    }

    if (/[0-9]/.test(ch)) {
      i++;
      while (i < code.length && /[0-9a-fA-F.xX_]/.test(code[i])) i++;
      tokens.push("NUM");
      continue;
    }

    if ("{}()[];,:.".includes(ch)) { tokens.push(ch); i++; continue; }

    // Three-char operators
    const three = ch + next + (code[i + 2] || "");
    if (["===", "!==", "**=", "<<=", ">>=", "??="].includes(three)) {
      tokens.push(three); i += 3; continue;
    }

    const two = ch + next;
    if (["=>", "==", "!=", "<=", ">=", "&&", "||", "++", "--",
         "+=", "-=", "*=", "/=", "%=", "**", "<<", ">>",
         "??", "?.", "?."].includes(two)) {
      tokens.push(two); i += 2; continue;
    }

    tokens.push(ch);
    i++;
  }

  return {
    total: tokens.length,
    unique: new Set(tokens).size,
    operatorCount: tokens.filter((t) => /^[+\-*/%&|^<>=!~?.]+$/.test(t) || t === "=>" || t === "??" || t === "?.").length,
    punctuationCount: tokens.filter((t) => /^[{}()[\];,:.]$/.test(t)).length,
    keywordCount: tokens.filter((t) => /^[a-z]+$/.test(t) && [
      "if", "else", "for", "while", "do", "switch", "case", "break",
      "continue", "return", "throw", "try", "catch", "finally",
      "function", "class", "new", "await", "async", "yield",
      "const", "let", "var", "import", "export", "default",
    ].includes(t)).length,
  };
}

/**
 * Walk a directory recursively, yielding file paths.
 */
function* walkDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      yield* walkDir(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

// ---------------------------------------------------------------------------
// Feature vector helpers
// ---------------------------------------------------------------------------

/**
 * Build a feature vector from code for comparison.
 */
function buildFeatureVector(fingerprint) {
  const f = fingerprint.features || {};
  const hist = f.keywordHistogram || {};

  // Normalized keyword frequencies
  const totalTokens = f.totalTokens || 1;
  const vec = [];

  const keywordOrder = [
    "if", "else", "for", "while", "do", "switch", "case",
    "return", "throw", "try", "catch", "function", "class",
    "new", "await", "async", "const", "let", "var", "import", "export",
  ];

  for (const kw of keywordOrder) {
    vec.push((hist[kw] || 0) / totalTokens);
  }

  // Line density features
  vec.push((f.lines || 0) / 1000); // normalized line count
  vec.push((f.uniqueTokens || 0) / Math.max(totalTokens, 1)); // token diversity
  vec.push((f.operatorCount || 0) / Math.max(totalTokens, 1));
  vec.push((f.punctuationCount || 0) / Math.max(totalTokens, 1));
  vec.push((f.keywordCount || 0) / Math.max(totalTokens, 1));

  return vec;
}

/**
 * Compute cosine similarity between two numeric vectors.
 */
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  if (magA === 0 && magB === 0) return 1;
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

// ---------------------------------------------------------------------------
// CodeFingerprint
// ---------------------------------------------------------------------------

class CodeFingerprint {
  /**
   * @param {object} [options]
   * @param {boolean} [options.preserveComments=false] - keep comments in normalization
   * @param {boolean} [options.preserveIdentifiers=false] - keep original identifiers
   * @param {string[]} [options.extensions] - file extensions to fingerprint in directories
   */
  constructor(options = {}) {
    this._options = {
      preserveComments: options.preserveComments || false,
      preserveIdentifiers: options.preserveIdentifiers || false,
      extensions: options.extensions || [
        ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs",
        ".py", ".java", ".go", ".rs", ".rb", ".php",
        ".c", ".cpp", ".h", ".hpp", ".cs", ".swift",
      ],
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Generate a fingerprint for a code string.
   *
   * Normalization steps:
   *   1. Strip comments (unless preserveComments is true)
   *   2. Normalize whitespace
   *   3. Normalize identifiers (unless preserveIdentifiers is true)
   *
   * The fingerprint includes:
   *   - hash: SHA-256 of the completely normalized code
   *   - structuralHash: SHA-256 of identifier-normalized code (ignores comments)
   *   - rawHash: SHA-256 of the original code
   *   - features: line count, token stats, keyword histogram
   *
   * @param {string} code - source code to fingerprint
   * @param {string} [filePath] - optional file path for context
   * @returns {{ hash: string, structuralHash: string, rawHash: string, features: object, path?: string }}
   */
  fingerprint(code, filePath) {
    if (typeof code !== "string") {
      throw new TypeError("code must be a string");
    }

    const lines = code.split("\n");
    const nonEmpty = lines.filter((l) => l.trim().length > 0);

    // Raw hash of the original content
    const rawHash = sha256(code);

    // Whitespace-normalized version
    const wsNormalized = normalizeWhitespace(code);

    // Without comments
    let noComments = wsNormalized;
    if (!this._options.preserveComments) {
      noComments = normalizeWhitespace(stripComments(code));
    }

    // Full normalization (comments stripped, identifiers normalized)
    let fullyNormalized = noComments;
    if (!this._options.preserveIdentifiers) {
      fullyNormalized = normalizeIdentifiers(noComments);
    }

    // Structural normalization (always strip comments, normalize identifiers)
    const structuralNormalized = normalizeIdentifiers(
      normalizeWhitespace(stripComments(code))
    );

    const hash = sha256(fullyNormalized);
    const structuralHash = sha256(structuralNormalized);
    const tokenInfo = tokenStats(code);
    const kwHist = keywordHistogram(code);

    const fp = {
      hash,
      structuralHash,
      rawHash,
      features: {
        lines: nonEmpty.length,
        totalLines: lines.length,
        totalTokens: tokenInfo.total,
        uniqueTokens: tokenInfo.unique,
        operatorCount: tokenInfo.operatorCount,
        punctuationCount: tokenInfo.punctuationCount,
        keywordCount: tokenInfo.keywordCount,
        keywordHistogram: kwHist,
        sizeBytes: Buffer.byteLength(code, "utf-8"),
      },
    };

    if (filePath) {
      fp.path = filePath;
    }

    return fp;
  }

  /**
   * Read a file from disk and generate its fingerprint.
   *
   * @param {string} filePath - absolute or relative path to the file
   * @returns {{ hash: string, structuralHash: string, rawHash: string, features: object, path: string }}
   * @throws {Error} if the file cannot be read
   */
  fingerprintFile(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    return this.fingerprint(content, filePath);
  }

  /**
   * Fingerprint all supported source files in a directory tree.
   *
   * @param {string} root - directory to scan
   * @returns {{ directory: string, fingerprints: Array, fileCount: number, skippedCount: number }}
   */
  fingerprintDirectory(root) {
    if (!fs.existsSync(root)) {
      throw new Error(`Directory not found: ${root}`);
    }

    const stat = fs.statSync(root);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${root}`);
    }

    const fingerprints = [];
    let skippedCount = 0;
    const exts = new Set(this._options.extensions.map((e) => e.toLowerCase()));

    for (const filePath of walkDir(root)) {
      const ext = path.extname(filePath).toLowerCase();
      if (!exts.has(ext)) {
        skippedCount++;
        continue;
      }

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const fp = this.fingerprint(content, filePath);
        fingerprints.push(fp);
      } catch {
        skippedCount++;
      }
    }

    return {
      directory: path.resolve(root),
      fingerprints,
      fileCount: fingerprints.length,
      skippedCount,
    };
  }

  /**
   * Compare two fingerprints and return a similarity score (0 to 1).
   *
   * Comparison strategy (in order of precedence):
   *   1. Exact hash match → 1.0 (identical after full normalization)
   *   2. Structural hash match → 0.95 (identical structure, different names)
   *   3. Feature vector cosine similarity → 0.0 - 0.9 (structural similarity)
   *
   * @param {object} a - first fingerprint
   * @param {object} b - second fingerprint
   * @returns {number} similarity score between 0 and 1
   */
  compare(a, b) {
    if (!a || !b) return 0;

    // Exact match after full normalization
    if (a.hash === b.hash) return 1.0;

    // Structural match
    if (a.structuralHash === b.structuralHash) return 0.95;

    // Feature vector cosine similarity
    const vecA = buildFeatureVector(a);
    const vecB = buildFeatureVector(b);
    const cos = cosineSimilarity(vecA, vecB);

    // Scale and clamp
    return Math.min(0.9, Math.max(0, cos));
  }

  /**
   * Find fingerprints similar to a target fingerprint within a candidate set.
   *
   * @param {object} fingerprint - target fingerprint to compare against
   * @param {Array<object>} candidates - array of fingerprints to search
   * @param {object} [options]
   * @param {number} [options.threshold=0.7] - minimum similarity to include in results
   * @param {number} [options.maxResults=10] - maximum number of results
   * @returns {Array<{fingerprint: object, similarity: number}>} sorted by similarity descending
   */
  findSimilar(fingerprint, candidates, options = {}) {
    const threshold = options.threshold != null ? options.threshold : 0.7;
    const maxResults = options.maxResults || 10;

    if (!fingerprint || !candidates || !Array.isArray(candidates)) {
      return [];
    }

    const results = [];

    for (const candidate of candidates) {
      // Skip self-comparison
      if (candidate.hash === fingerprint.hash) continue;
      if (candidate.path && fingerprint.path && candidate.path === fingerprint.path) continue;

      const sim = this.compare(fingerprint, candidate);
      if (sim >= threshold) {
        results.push({ fingerprint: candidate, similarity: sim });
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, maxResults);
  }
}

module.exports = {
  CodeFingerprint,
  sha256,
  stripComments,
  normalizeWhitespace,
  normalizeIdentifiers,
  keywordHistogram,
  tokenStats,
  walkDir,
  buildFeatureVector,
  cosineSimilarity,
};
