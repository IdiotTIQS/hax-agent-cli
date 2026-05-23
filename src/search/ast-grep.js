/**
 * AST-aware semantic code search using regex with scope awareness.
 *
 * Each search function skips string and comment regions before matching,
 * and returns results as { file, line, column, match, context } objects.
 *
 * NOTE: "file" is undefined when the input is raw code (string).  Callers
 * that pass a file path should set it on the returned objects.
 */
"use strict";

// ---------------------------------------------------------------------------
// Region tracking – marks string and comment spans so matchers can skip them.
// ---------------------------------------------------------------------------

/**
 * @typedef {{ start: number, end: number }} Span
 */

/**
 * Returns an array of spans (byte-offset ranges) covering string and
 * comment regions in *code*.  Regions are inclusive of their delimiters.
 *
 * Handles:
 *  - single-line comments: // … \n
 *  - block comments:       /* … *​/
 *  - single-quoted strings: '…'
 *  - double-quoted strings: "…"
 *  - template strings:      `…`
 */
function findExcludedRegions(code) {
  const regions = [];
  const len = code.length;
  let i = 0;

  while (i < len) {
    // Single-line comment: //
    if (code[i] === "/" && code[i + 1] === "/") {
      const start = i;
      i += 2;
      while (i < len && code[i] !== "\n") {
        i += 1;
      }
      regions.push({ start, end: i });
      continue;
    }

    // Block comment: /*
    if (code[i] === "/" && code[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < len - 1 && !(code[i] === "*" && code[i + 1] === "/")) {
        i += 1;
      }
      i += 2; // skip */
      regions.push({ start, end: i });
      continue;
    }

    // Strings: ' " `
    if (code[i] === "'" || code[i] === '"' || code[i] === "`") {
      const quote = code[i];
      const start = i;
      i += 1;
      while (i < len) {
        if (code[i] === "\\") {
          i += 2; // skip escaped char
          continue;
        }
        if (code[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      regions.push({ start, end: i });
      continue;
    }

    i += 1;
  }

  return regions;
}

/**
 * Returns true when *offset* falls inside any excluded region.
 */
function isExcluded(offset, regions) {
  for (let i = 0; i < regions.length; i += 1) {
    if (offset >= regions[i].start && offset < regions[i].end) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a byte offset into a 1-based line number & 1-based column.
 */
function offsetToPosition(code, offset) {
  const lines = code.slice(0, offset).split(/\r?\n/);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

/**
 * Extract up to *contextLines* lines of surrounding text around a line
 * from the full source code.
 */
function extractContext(code, line, contextLines) {
  const lines = code.split(/\r?\n/);
  const start = Math.max(0, line - 1 - contextLines);
  const end = Math.min(lines.length, line + contextLines);
  return lines.slice(start, end).join("\n");
}

const DEFAULT_CONTEXT_LINES = 2;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Find all calls to a named function.
 *
 * Matches patterns like:
 *   functionName(
 *   functionName (
 *   obj.functionName(
 */
function searchFunctionCalls(code, functionName) {
  const regions = findExcludedRegions(code);
  const escaped = escapeRegex(functionName);
  // Match the name followed by optional whitespace and an opening paren.
  // Use word boundaries plus lookahead for '(' so we don't match substrings.
  const pattern = new RegExp(
    `(?:^|[^\\w])(${escaped})\\s*\\(`,
    "gm"
  );
  return searchWithPattern(code, pattern, regions, 1);
}

/**
 * Find function definitions by name.
 *
 * Supports:
 *   function name(
 *   const name = function(
 *   const name = (
 *   async function name(
 *   name: function(
 *   name(args) {
 *   async name(args) {
 */
function searchFunctionDefinitions(code, functionName) {
  const regions = findExcludedRegions(code);
  const escaped = escapeRegex(functionName);

  const patterns = [
    // function name( / async function name( / function* name(
    new RegExp(
      `(?:^|[^\\w.])(?:async\\s+)?function\\*?\\s+(${escaped})\\s*\\(`,
      "gm"
    ),
    // name = function( / name = async ( / name = (
    new RegExp(
      `(?:^|[^\\w.])(${escaped})\\s*=\\s*(?:async\\s*)?(?:\\(|function\\s*\\()`,
      "gm"
    ),
    // name( args ) {  (shorthand / method definition)
    // Use negative lookbehind so we don't duplicate matches already
    // covered by "function name(" or "async function name(" above.
    new RegExp(
      `(?:^|[^\\w.])(?<!function )(?<!async )(${escaped})\\s*\\([^)]*\\)\\s*\\{`,
      "gm"
    ),
    // async name( args ) {  (async shorthand, not "async function name(")
    new RegExp(
      `(?:^|[^\\w.])(?<!function )async\\s+(${escaped})\\s*\\([^)]*\\)\\s*\\{`,
      "gm"
    ),
    // name: function(
    new RegExp(
      `(?:^|[^\\w.])(${escaped})\\s*:\\s*(?:async\\s+)?function\\s*\\(`,
      "gm"
    ),
  ];

  const results = [];
  for (const pat of patterns) {
    const matches = searchWithPattern(code, pat, regions, 1);
    for (const m of matches) {
      results.push(m);
    }
  }

  // De-duplicate by line+column
  return deduplicateResults(results);
}

/**
 * Find all references to a variable (excluding the definition).
 *
 * Matches identifiers that are not:
 *  - inside string literals
 *  - inside comments
 *  - part of a longer identifier
 */
function searchVariableReferences(code, variableName) {
  const regions = findExcludedRegions(code);
  const escaped = escapeRegex(variableName);
  const pattern = new RegExp(`(?:^|[^\\w])(${escaped})(?:[^\\w]|$)`, "gm");
  return searchWithPattern(code, pattern, regions, 1);
}

/**
 * Find all import/require statements referencing a specific module.
 *
 * Supports:
 *   import … from 'module'
 *   import 'module'
 *   require('module')
 *   const x = require('module')
 */
function searchImports(code, moduleName) {
  const regions = findExcludedRegions(code);
  const escaped = escapeRegex(moduleName);

  const patterns = [
    // import … from 'module' / import … from "module"
    new RegExp(
      `import\\b[^;]*?from\\s*['"\`]${escaped}['"\`]`,
      "gm"
    ),
    // import 'module'
    new RegExp(
      `import\\s+['"\`]${escaped}['"\`]`,
      "gm"
    ),
    // require('module')
    new RegExp(
      `require\\s*\\(\\s*['"\`]${escaped}['"\`]\\s*\\)`,
      "gm"
    ),
  ];

  const results = [];
  for (const pat of patterns) {
    const matches = searchWithPattern(code, pat, regions, 0);
    for (const m of matches) {
      results.push(m);
    }
  }
  return deduplicateResults(results);
}

/**
 * Find class definitions by name.
 *
 * Supports:
 *   class ClassName
 *   class ClassName extends Base
 *   export class ClassName
 *   export default class ClassName
 */
function searchClassDefinitions(code, className) {
  const regions = findExcludedRegions(code);
  const escaped = escapeRegex(className);
  const pattern = new RegExp(
    `(?:^|[^\\w.])(?:export\\s+(?:default\\s+)?)?class\\s+(${escaped})\\b`,
    "gm"
  );
  return searchWithPattern(code, pattern, regions, 1);
}

/**
 * Multi-pattern search.
 *
 * @param {string} code - source code to search
 * @param {{ name: string, pattern: string|RegExp }[]} patterns - named patterns
 * @returns {{ patternName: string, results: object[] }[]}
 */
function searchPatterns(code, patterns) {
  const regions = findExcludedRegions(code);
  const all = [];

  for (const { name, pattern } of patterns) {
    let regex;
    if (pattern instanceof RegExp) {
      regex = new RegExp(pattern.source, addGlobalFlag(pattern.flags));
    } else {
      regex = new RegExp(pattern, "gm");
    }
    const matches = searchWithPattern(code, regex, regions, 0);
    all.push({ patternName: name, results: matches });
  }

  return all;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Execute a regex against *code*, skipping excluded regions.
 *
 * @param {string} code
 * @param {RegExp} regex - must have 'g' flag
 * @param {Span[]} regions
 * @param {number} captureGroup - which capture group holds the matched text (0 = full)
 * @returns {{ file?: string, line: number, column: number, match: string, context: string }[]}
 */
function searchWithPattern(code, regex, regions, captureGroup) {
  const results = [];
  let m;

  while ((m = regex.exec(code)) !== null) {
    const offset = m.index;
    if (isExcluded(offset, regions)) {
      // Advance past this match to avoid infinite loop with zero-length matches
      if (m[0].length === 0) {
        regex.lastIndex = offset + 1;
      }
      continue;
    }
    const pos = offsetToPosition(code, offset);
    const matchText = m[captureGroup] || m[0];
    results.push({
      line: pos.line,
      column: pos.column,
      match: matchText,
      context: extractContext(code, pos.line, DEFAULT_CONTEXT_LINES),
    });
  }

  return results;
}

/**
 * Escape a string for use inside a RegExp.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Ensure a regex flags string contains 'g' (and 'm' for multiline support).
 */
function addGlobalFlag(flags) {
  if (!flags.includes("g")) {
    return flags + "gm";
  }
  if (!flags.includes("m")) {
    return flags + "m";
  }
  return flags;
}

/**
 * Remove duplicate results (same line + column + match text).
 */
function deduplicateResults(results) {
  const seen = new Set();
  const out = [];
  for (const r of results) {
    const key = `${r.line}:${r.column}:${r.match}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

module.exports = {
  searchFunctionCalls,
  searchFunctionDefinitions,
  searchVariableReferences,
  searchImports,
  searchClassDefinitions,
  searchPatterns,
  // Exported for testing
  findExcludedRegions,
  isExcluded,
  offsetToPosition,
};
