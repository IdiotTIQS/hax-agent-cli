/**
 * CloneDetector — detects duplicated code across files.
 *
 * Provides three detection strategies:
 *   - Exact clones (hash-based block matching)
 *   - Near clones (token-sequence similarity)
 *   - Structural clones (normalized control-flow patterns)
 *
 * Uses only Node.js built-ins. No AST parser dependency.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MIN_LINES = 6;
const DEFAULT_MIN_TOKENS = 50;
const DEFAULT_SIMILARITY_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hex digest of a string.
 */
function sha256(input) {
  return crypto.createHash("sha256").update(input, "utf-8").digest("hex");
}

/**
 * Normalize whitespace: collapse all whitespace sequences to single spaces,
 * trim each line, remove blank lines.
 */
function normalizeWhitespace(code) {
  return code
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Strip single-line (//) and block (/ * ... * /) comments from source.
 * Accounts for strings and template literals to avoid false matches.
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

    // String escapes
    if (ch === "\\" && (inString || inTemplate)) {
      result.push(ch);
      if (i + 1 < code.length) {
        result.push(code[i + 1]);
        i++;
      }
      i++;
      continue;
    }

    // Template literal toggle
    if (ch === "`" && !inString) {
      inTemplate = !inTemplate;
      result.push(ch);
      i++;
      continue;
    }

    // String literal toggle
    if ((ch === "\"" || ch === "'") && !inTemplate) {
      if (!inString) {
        inString = true;
        stringChar = ch;
      } else if (ch === stringChar) {
        inString = false;
      }
      result.push(ch);
      i++;
      continue;
    }

    // Only check for comments when not inside a string
    if (!inString && !inTemplate) {
      // Single-line comment
      if (ch === "/" && next === "/") {
        i += 2;
        while (i < code.length && code[i] !== "\n") {
          i++;
        }
        // Preserve the newline
        if (i < code.length) {
          result.push("\n");
          i++;
        }
        continue;
      }

      // Block comment
      if (ch === "/" && next === "*") {
        i += 2;
        while (i < code.length - 1 && !(code[i] === "*" && code[i + 1] === "/")) {
          // Preserve newlines inside block comments for line tracking
          if (code[i] === "\n") {
            result.push("\n");
          }
          i++;
        }
        i += 2; // skip */
        continue;
      }
    }

    result.push(ch);
    i++;
  }

  return result.join("");
}

/**
 * Normalize identifiers: replace all user-defined identifiers with
 * generic placeholders like id_0, id_1, etc.
 * This preserves structural similarity while ignoring naming.
 */
function normalizeIdentifiers(code) {
  // Known keywords and built-ins to preserve
  const reserved = new Set([
    "break", "case", "catch", "class", "const", "continue", "debugger",
    "default", "delete", "do", "else", "export", "extends", "finally",
    "for", "function", "if", "import", "in", "instanceof", "let", "new",
    "of", "return", "super", "switch", "this", "throw", "try", "typeof",
    "var", "void", "while", "with", "yield", "async", "await", "from",
    "as", "static", "get", "set", "enum", "implements", "interface",
    "package", "private", "protected", "public",
    // Common globals / built-ins
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
  const inString = { val: false, quote: "" };
  const inTemplate = { val: false };
  const inComment = { single: false, block: false };

  const result = [];
  let i = 0;

  function getReplacement(ident) {
    if (reserved.has(ident)) return ident;
    if (!idMap.has(ident)) {
      idMap.set(ident, `id_${counter++}`);
    }
    return idMap.get(ident);
  }

  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1] || "";

    // Track string/comment state
    if (ch === "\\" && (inString.val || inTemplate.val)) {
      result.push(ch);
      if (i + 1 < code.length) { result.push(code[i + 1]); i++; }
      i++;
      continue;
    }

    if (ch === "`" && !inString.val && !inComment.single && !inComment.block) {
      inTemplate.val = !inTemplate.val;
      result.push(ch);
      i++;
      continue;
    }

    if ((ch === "\"" || ch === "'") && !inTemplate.val && !inComment.single && !inComment.block) {
      if (!inString.val) {
        inString.val = true;
        inString.quote = ch;
      } else if (ch === inString.quote) {
        inString.val = false;
      }
      result.push(ch);
      i++;
      continue;
    }

    if (inString.val || inTemplate.val) {
      result.push(ch);
      i++;
      continue;
    }

    // Comment tracking (not inside string/template)
    if (ch === "/" && next === "/" && !inComment.block) {
      inComment.single = true;
      result.push(ch, next);
      i += 2;
      continue;
    }
    if (inComment.single) {
      result.push(ch);
      if (ch === "\n") { inComment.single = false; }
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inComment.block = true;
      result.push(ch, next);
      i += 2;
      continue;
    }
    if (inComment.block) {
      result.push(ch);
      if (ch === "*" && next === "/") {
        result.push(next);
        inComment.block = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // Identifier matching
    if (/[a-zA-Z_$]/.test(ch)) {
      const start = i;
      i++;
      while (i < code.length && /[\w$]/.test(code[i])) {
        i++;
      }
      const ident = code.slice(start, i);
      result.push(getReplacement(ident));
      continue;
    }

    result.push(ch);
    i++;
  }

  return result.join("");
}

/**
 * Tokenize code into an array of significant tokens (keywords, operators,
 * identifiers). Ignores whitespace-only tokens.
 */
function tokenize(code) {
  const tokens = [];
  let i = 0;
  let inString = false;
  let stringChar = "";
  let inTemplate = false;

  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1] || "";

    // Skip whitespace
    if (!inString && !inTemplate && /\s/.test(ch)) {
      i++;
      continue;
    }

    // Escapes
    if (ch === "\\" && (inString || inTemplate)) {
      i += 2;
      continue;
    }

    // Template toggle
    if (ch === "`" && !inString) {
      inTemplate = !inTemplate;
      if (!inTemplate) tokens.push("TEMPLATE_END");
      else tokens.push("TEMPLATE_START");
      i++;
      continue;
    }

    // String toggle
    if ((ch === "\"" || ch === "'") && !inTemplate) {
      if (!inString) {
        inString = true;
        stringChar = ch;
      } else if (ch === stringChar) {
        inString = false;
      }
      tokens.push("STRING");
      i++;
      continue;
    }

    if (inString) { i++; continue; }

    // Template content — push as placeholder tokens
    if (inTemplate) {
      if (ch === "$" && next === "{") {
        tokens.push("EXPR_START");
        i += 2;
        continue;
      }
      if (ch === "}") {
        // Heuristic: if we're inside a template expression, } closes it
        tokens.push("EXPR_END");
        i++;
        continue;
      }
      i++;
      continue;
    }

    // Single-line comment
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }

    // Block comment
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < code.length - 1 && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_$]/.test(ch)) {
      const start = i;
      i++;
      while (i < code.length && /[\w$]/.test(code[i])) i++;
      tokens.push(code.slice(start, i));
      continue;
    }

    // Number
    if (/[0-9]/.test(ch)) {
      const start = i;
      i++;
      while (i < code.length && /[0-9a-fA-F.xX_]/ .test(code[i])) i++;
      tokens.push("NUM");
      continue;
    }

    // Punctuation/operators
    if ("{}()[];,.:".includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }

    // Three-char operators (check before two-char)
    const threeChar = ch + next + (code[i + 2] || "");
    if (["===", "!==", "**=", "<<=", ">>=", ">>>", "??="].includes(threeChar)) {
      tokens.push(threeChar);
      i += 3;
      continue;
    }

    // Multi-char operators (two chars)
    const twoChar = ch + next;
    if (["=>", "==", "!=", "<=", ">=", "&&", "||", "++", "--",
         "+=", "-=", "*=", "/=", "%=", "**", "<<", ">>",
         "??", "?.", "?."].includes(twoChar)) {
      tokens.push(twoChar);
      i += 2;
      continue;
    }

    // Single-char operators
    if ("=<>!+-*/%&|^~?".includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }

    // Catch-all for any other char
    tokens.push(ch);
    i++;
  }

  return tokens;
}

/**
 * Extract n-grams from an array of tokens.
 */
function extractNGrams(tokens, n) {
  const grams = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    grams.push(tokens.slice(i, i + n).join("\x00"));
  }
  return grams;
}

/**
 * Compute Jaccard similarity coefficient between two sets.
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Extract structural signature: keep only control-flow keywords, braces,
 * and their relative ordering. Replace everything else with placeholders.
 */
function structuralSignature(code) {
  const stripped = stripComments(code);

  // Extract structural tokens only
  const structuralKeywords = new Set([
    "if", "else", "for", "while", "do", "switch", "case", "break",
    "continue", "return", "throw", "try", "catch", "finally",
    "function", "class", "new", "await", "yield",
    "const", "let", "var", "export", "import", "default",
  ]);

  const tokens = tokenize(stripped);
  const structural = [];

  for (const tok of tokens) {
    if (structuralKeywords.has(tok)) {
      structural.push(tok);
    } else if (tok === "{" || tok === "}" || tok === "(" || tok === ")") {
      structural.push(tok);
    } else if (tok === ";" || tok === "," || tok === ":" || tok === "=>") {
      structural.push(tok);
    }
  }

  return structural;
}

/**
 * Build a normalized block signature for exact clone hashing.
 * Uses first line of block, last line, and structural tokens.
 */
function blockSignature(blockCode) {
  const normalized = normalizeWhitespace(blockCode);
  const hash = sha256(normalized);
  const structural = structuralSignature(blockCode).join("");
  const structuralHash = sha256(structural);
  return { hash, structuralHash, lineCount: blockCode.split("\n").length };
}

/**
 * Split code into overlapping or non-overlapping blocks of at least minLines.
 */
function splitIntoBlocks(content, minLines) {
  const lines = content.split("\n");
  const blocks = [];

  // Build non-blank blocks
  let currentStart = -1;
  let currentLines = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) {
      // Empty line: finish current block if large enough
      if (currentLines.length >= minLines) {
        blocks.push({
          startLine: currentStart + 1, // 1-indexed
          endLine: i,                 // inclusive
          code: currentLines.join("\n"),
        });
      }
      currentStart = -1;
      currentLines = [];
    } else {
      if (currentStart === -1) currentStart = i;
      currentLines.push(lines[i]);
    }
  }

  // Finish last block
  if (currentLines.length >= minLines) {
    blocks.push({
      startLine: currentStart + 1,
      endLine: lines.length,
      code: currentLines.join("\n"),
    });
  }

  // Also create overlapping windows for better coverage
  const overlapBlocks = [];
  if (lines.length >= minLines) {
    const stride = Math.max(1, Math.floor(minLines / 2));
    for (let start = 0; start + minLines <= lines.length; start += stride) {
      const blockLines = lines.slice(start, start + minLines);
      const nonBlank = blockLines.filter((l) => l.trim().length > 0);
      if (nonBlank.length >= Math.ceil(minLines / 2)) {
        overlapBlocks.push({
          startLine: start + 1,
          endLine: start + minLines,
          code: blockLines.join("\n"),
        });
      }
    }
  }

  return { contiguous: blocks, overlapping: overlapBlocks };
}

// ---------------------------------------------------------------------------
// CloneDetector
// ---------------------------------------------------------------------------

class CloneDetector {
  /**
   * @param {object} [options]
   * @param {number} [options.minLines=6] - minimum lines for a clone block
   * @param {number} [options.minTokens=50] - minimum tokens for a near clone
   * @param {number} [options.similarityThreshold=0.8] - threshold for near/structural similarity
   */
  constructor(options = {}) {
    this._options = {
      minLines: options.minLines || DEFAULT_MIN_LINES,
      minTokens: options.minTokens || DEFAULT_MIN_TOKENS,
      similarityThreshold: options.similarityThreshold || DEFAULT_SIMILARITY_THRESHOLD,
    };
    this._cloneGroups = [];
    this._stats = null;
    this._summary = "";
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Detect all types of code clones across a set of files.
   *
   * @param {Array<{path: string, content: string}>} files - array of file objects
   * @param {object} [options] - overrides for constructor options
   * @returns {{ groups: Array, stats: object, summary: string }}
   */
  detect(files, options = {}) {
    const opts = { ...this._options, ...options };
    this._options = opts;

    const exactClones = this.findExactClones(files);
    const nearClones = this.findNearClones(files);
    const structuralClones = this.findStructuralClones(files);

    // Merge all clone groups
    const allGroups = [
      ...exactClones.map((g) => ({ ...g, type: "exact" })),
      ...nearClones.map((g) => ({ ...g, type: "near" })),
      ...structuralClones.map((g) => ({ ...g, type: "structural" })),
    ];

    // Compute stats
    const totalBlocks = allGroups.reduce((sum, g) => sum + g.blocks.length, 0);
    const totalFiles = new Set();
    for (const g of allGroups) {
      for (const b of g.blocks) {
        totalFiles.add(b.filePath);
      }
    }

    const typeCounts = {};
    for (const g of allGroups) {
      typeCounts[g.type] = (typeCounts[g.type] || 0) + 1;
    }

    this._stats = {
      totalCloneGroups: allGroups.length,
      totalCloneBlocks: totalBlocks,
      affectedFiles: totalFiles.size,
      byType: typeCounts,
      exactGroups: exactClones.length,
      nearGroups: nearClones.length,
      structuralGroups: structuralClones.length,
      config: {
        minLines: opts.minLines,
        minTokens: opts.minTokens,
        similarityThreshold: opts.similarityThreshold,
      },
    };

    // Build summary
    const parts = [];
    if (exactClones.length > 0) parts.push(`${exactClones.length} exact`);
    if (nearClones.length > 0) parts.push(`${nearClones.length} near`);
    if (structuralClones.length > 0) parts.push(`${structuralClones.length} structural`);

    this._summary = parts.length > 0
      ? `Found ${allGroups.length} clone group(s) (${parts.join(", ")}) across ${totalFiles.size} file(s).`
      : "No code clones detected.";

    this._cloneGroups = allGroups;
    return { groups: allGroups, stats: this._stats, summary: this._summary };
  }

  /**
   * Find exact duplicate code blocks via hashing.
   * Builds a hash map of normalized blocks and groups identical hashes.
   *
   * @param {Array<{path: string, content: string}>} files
   * @returns {Array<{id: string, similarity: number, blocks: Array}>}
   */
  findExactClones(files) {
    const minLines = this._options.minLines;
    const hashMap = new Map(); // hash -> { blocks: [], ... }

    for (const file of files) {
      const { contiguous, overlapping } = splitIntoBlocks(file.content, minLines);

      // Only use contiguous non-blank blocks for exact matching
      for (const block of [...contiguous, ...overlapping]) {
        const sig = blockSignature(block.code);
        const key = sig.hash;

        if (!hashMap.has(key)) {
          hashMap.set(key, { blocks: [], structuralHash: sig.structuralHash, lineCount: sig.lineCount });
        }

        const entry = hashMap.get(key);
        // Avoid duplicate entries for the same file
        const alreadyPresent = entry.blocks.some(
          (b) => b.filePath === file.path && b.startLine === block.startLine
        );
        if (!alreadyPresent) {
          entry.blocks.push({
            filePath: file.path,
            startLine: block.startLine,
            endLine: block.endLine,
            lineCount: sig.lineCount,
            code: block.code,
          });
        }
      }
    }

    // Form groups from hashes with blocks from at least 2 distinct locations
    const groups = [];
    let groupId = 0;

    for (const [hash, entry] of hashMap) {
      // Need at least 2 blocks, and at least one is from a different file
      const uniqueFiles = new Set(entry.blocks.map((b) => b.filePath));
      const uniqueLocations = new Set(
        entry.blocks.map((b) => `${b.filePath}:${b.startLine}`)
      );

      if (uniqueLocations.size >= 2) {
        groups.push({
          id: `exact_${groupId++}_${hash.slice(0, 8)}`,
          similarity: 1.0,
          blocks: entry.blocks,
        });
      }
    }

    return groups;
  }

  /**
   * Find near-duplicate code blocks using token n-gram similarity.
   *
   * @param {Array<{path: string, content: string}>} files
   * @returns {Array<{id: string, similarity: number, blocks: Array}>}
   */
  findNearClones(files) {
    const minLines = this._options.minLines;
    const minTokens = this._options.minTokens;
    const threshold = this._options.similarityThreshold;

    // Extract tokenized blocks from all files
    const allBlocks = [];
    for (const file of files) {
      const { contiguous } = splitIntoBlocks(file.content, minLines);
      for (const block of contiguous) {
        const tokens = tokenize(block.code);
        if (tokens.length < minTokens) continue;

        allBlocks.push({
          filePath: file.path,
          startLine: block.startLine,
          endLine: block.endLine,
          lineCount: block.lineCount || block.code.split("\n").length,
          code: block.code,
          tokens,
          ngrams: new Set(extractNGrams(tokens, 3)),
        });
      }
    }

    // Compare blocks pairwise within and across files
    const groups = [];
    const seen = new Set();

    for (let i = 0; i < allBlocks.length; i++) {
      for (let j = i + 1; j < allBlocks.length; j++) {
        const a = allBlocks[i];
        const b = allBlocks[j];

        // Skip if either already grouped with matching quality
        const pairKey = `${a.filePath}:${a.startLine}|${b.filePath}:${b.startLine}`;
        if (seen.has(pairKey)) continue;

        const sim = jaccardSimilarity(a.ngrams, b.ngrams);

        if (sim >= threshold) {
          // Check if either block can join an existing group
          let matchedGroup = null;
          for (const group of groups) {
            if (
              group.blocks.some(
                (blk) =>
                  (blk.filePath === a.filePath && blk.startLine === a.startLine) ||
                  (blk.filePath === b.filePath && blk.startLine === b.startLine)
              )
            ) {
              matchedGroup = group;
              break;
            }
          }

          if (matchedGroup) {
            // Add missing block to existing group
            if (!matchedGroup.blocks.some(
              (blk) => blk.filePath === a.filePath && blk.startLine === a.startLine
            )) {
              matchedGroup.blocks.push({
                filePath: a.filePath,
                startLine: a.startLine,
                endLine: a.endLine,
                lineCount: a.lineCount,
                code: a.code,
              });
            }
            if (!matchedGroup.blocks.some(
              (blk) => blk.filePath === b.filePath && blk.startLine === b.startLine
            )) {
              matchedGroup.blocks.push({
                filePath: b.filePath,
                startLine: b.startLine,
                endLine: b.endLine,
                lineCount: b.lineCount,
                code: b.code,
              });
            }
            // Update similarity to the max seen
            matchedGroup.similarity = Math.max(matchedGroup.similarity, sim);
          } else {
            groups.push({
              id: `near_${groups.length}`,
              similarity: sim,
              blocks: [
                {
                  filePath: a.filePath,
                  startLine: a.startLine,
                  endLine: a.endLine,
                  lineCount: a.lineCount,
                  code: a.code,
                },
                {
                  filePath: b.filePath,
                  startLine: b.startLine,
                  endLine: b.endLine,
                  lineCount: b.lineCount,
                  code: b.code,
                },
              ],
            });
          }

          seen.add(pairKey);
        }
      }
    }

    // Filter groups to only those with blocks from distinct locations
    return groups.filter((g) => {
      const uniqueLocs = new Set(g.blocks.map((b) => `${b.filePath}:${b.startLine}`));
      return uniqueLocs.size >= 2;
    });
  }

  /**
   * Find structurally similar code blocks by comparing normalized
   * control-flow patterns.
   *
   * @param {Array<{path: string, content: string}>} files
   * @returns {Array<{id: string, similarity: number, blocks: Array}>}
   */
  findStructuralClones(files) {
    const minLines = this._options.minLines;
    const threshold = this._options.similarityThreshold;

    // Extract structural signatures for each block
    const allBlocks = [];
    for (const file of files) {
      const { contiguous } = splitIntoBlocks(file.content, minLines);
      for (const block of contiguous) {
        const structural = structuralSignature(block.code);
        if (structural.length < 5) continue; // not enough structure

        allBlocks.push({
          filePath: file.path,
          startLine: block.startLine,
          endLine: block.endLine,
          lineCount: block.lineCount || block.code.split("\n").length,
          code: block.code,
          structural,
          structStr: structural.join(""),
          ngrams: new Set(extractNGrams(structural, 3)),
        });
      }
    }

    const groups = [];
    const seen = new Set();

    for (let i = 0; i < allBlocks.length; i++) {
      for (let j = i + 1; j < allBlocks.length; j++) {
        const a = allBlocks[i];
        const b = allBlocks[j];

        const pairKey = `${a.filePath}:${a.startLine}|${b.filePath}:${b.startLine}`;
        if (seen.has(pairKey)) continue;

        const sim = jaccardSimilarity(a.ngrams, b.ngrams);

        // Also check exact structural string match
        const structMatch = a.structStr === b.structStr;

        if (sim >= threshold || structMatch) {
          // Check for existing group
          let matchedGroup = null;
          for (const group of groups) {
            if (
              group.blocks.some(
                (blk) =>
                  (blk.filePath === a.filePath && blk.startLine === a.startLine) ||
                  (blk.filePath === b.filePath && blk.startLine === b.startLine)
              )
            ) {
              matchedGroup = group;
              break;
            }
          }

          const effectiveSim = Math.max(sim, structMatch ? 1.0 : 0);

          if (matchedGroup) {
            if (!matchedGroup.blocks.some(
              (blk) => blk.filePath === a.filePath && blk.startLine === a.startLine
            )) {
              matchedGroup.blocks.push({
                filePath: a.filePath,
                startLine: a.startLine,
                endLine: a.endLine,
                lineCount: a.lineCount,
                code: a.code,
              });
            }
            if (!matchedGroup.blocks.some(
              (blk) => blk.filePath === b.filePath && blk.startLine === b.startLine
            )) {
              matchedGroup.blocks.push({
                filePath: b.filePath,
                startLine: b.startLine,
                endLine: b.endLine,
                lineCount: b.lineCount,
                code: b.code,
              });
            }
            matchedGroup.similarity = Math.max(matchedGroup.similarity, effectiveSim);
          } else {
            groups.push({
              id: `struct_${groups.length}`,
              similarity: effectiveSim,
              blocks: [
                {
                  filePath: a.filePath,
                  startLine: a.startLine,
                  endLine: a.endLine,
                  lineCount: a.lineCount,
                  code: a.code,
                },
                {
                  filePath: b.filePath,
                  startLine: b.startLine,
                  endLine: b.endLine,
                  lineCount: b.lineCount,
                  code: b.code,
                },
              ],
            });
          }

          seen.add(pairKey);
        }
      }
    }

    return groups.filter((g) => {
      const uniqueLocs = new Set(g.blocks.map((b) => `${b.filePath}:${b.startLine}`));
      return uniqueLocs.size >= 2;
    });
  }

  /**
   * Return all clone groups found by the last detect() call.
   *
   * @returns {Array<{id: string, type: string, similarity: number, blocks: Array}>}
   */
  getCloneGroups() {
    return [...this._cloneGroups];
  }
}

module.exports = {
  CloneDetector,
  sha256,
  stripComments,
  normalizeWhitespace,
  normalizeIdentifiers,
  tokenize,
  extractNGrams,
  jaccardSimilarity,
  structuralSignature,
  blockSignature,
  splitIntoBlocks,
};
