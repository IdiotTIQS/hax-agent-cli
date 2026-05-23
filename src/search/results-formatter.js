/**
 * Search results formatter — renders match arrays into human-readable text
 * with multiple layout options and ANSI-colour highlighting.
 */
"use strict";

// ---------------------------------------------------------------------------
// ANSI escape codes
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const RED = "\x1b[31m";
const BLUE = "\x1b[34m";
const BG_YELLOW = "\x1b[43m";
const BG_BLACK = "\x1b[40m";

// ---------------------------------------------------------------------------
// ResultsFormatter
// ---------------------------------------------------------------------------

class ResultsFormatter {
  /**
   * @param {object} [options]
   * @param {boolean} [options.useColor=true] - enable ANSI colour output
   * @param {number} [options.contextLines=2] - context lines for detailed view
   * @param {boolean} [options.showScores=false] - include score in output
   * @param {number} [options.maxLineWidth=120] - truncate long lines
   */
  constructor(options) {
    const opts = options || {};
    this.useColor = opts.useColor !== false;
    this.contextLines = opts.contextLines !== undefined ? opts.contextLines : 2;
    this.showScores = opts.showScores === true;
    this.maxLineWidth = opts.maxLineWidth || 120;
  }

  // -----------------------------------------------------------------------
  // Format methods
  // -----------------------------------------------------------------------

  /**
   * Compact one-line-per-result format.
   *
   * @param {object[]} results - array of { file, line, column, match, score?, context? }
   * @returns {string}
   */
  formatBrief(results) {
    if (!results || results.length === 0) {
      return this._dim("(no results)");
    }

    const lines = results.map((r, idx) => {
      const num = String(idx + 1).padStart(3, " ");
      const loc = `${r.file || "?"}:${r.line || "?"}:${r.column || "?"}`;
      const match = r.match ? ` ${this._bold(r.match)}` : "";
      const score = this.showScores && typeof r.score === "number"
        ? this._dim(` [${r.score.toFixed(1)}]`)
        : "";
      return `${this._dim(num)} ${this._cyan(loc)}${match}${score}`;
    });

    return lines.join("\n");
  }

  /**
   * Detailed format with context snippets around each match.
   *
   * @param {object[]} results
   * @returns {string}
   */
  formatDetailed(results) {
    if (!results || results.length === 0) {
      return this._dim("(no results)");
    }

    const blocks = results.map((r, idx) => {
      const header = this._header(r, idx);
      const parts = [header];

      if (r.match) {
        parts.push(`  ${this._dim("match:")}   ${this._highlight(r.match)}`);
      }

      if (r.context) {
        const ctxLines = r.context.split(/\r?\n/);
        parts.push(`  ${this._dim("context:")}`);
        for (const cl of ctxLines) {
          const truncated = truncateLine(cl, this.maxLineWidth);
          parts.push(`    ${this._dim("|")} ${truncated}`);
        }
      }

      if (this.showScores && typeof r.score === "number") {
        parts.push(`  ${this._dim("score:")}  ${r.score.toFixed(2)}`);
      }

      return parts.join("\n");
    });

    return blocks.join(`\n${this._dim("─".repeat(60))}\n`);
  }

  /**
   * Results grouped by file, with sub-grouping by type if available.
   *
   * @param {object[]} results
   * @returns {string}
   */
  formatGrouped(results) {
    if (!results || results.length === 0) {
      return this._dim("(no results)");
    }

    const byFile = groupBy(results, (r) => r.file || "(unknown)");
    const fileNames = [...byFile.keys()].sort();

    const blocks = [];

    for (const file of fileNames) {
      const fileResults = byFile.get(file);
      const fileHeader = `${this._bold(this._green(file))} ${this._dim(`(${fileResults.length} match${fileResults.length !== 1 ? "es" : ""})`)}`;
      blocks.push(fileHeader);

      // Sub-group by type (kind) if present
      const byType = groupBy(fileResults, (r) => r.kind || r.type || "");
      const typeKeys = [...byType.keys()].sort();

      if (typeKeys.length > 1 || (typeKeys.length === 1 && typeKeys[0] !== "")) {
        for (const kind of typeKeys) {
          const kindResults = byType.get(kind);
          blocks.push(`  ${this._dim(`[${kind}]`)}`);
          for (const r of kindResults) {
            blocks.push(`    ${this._loc(r)}  ${this._highlight(r.match || "")}`);
          }
        }
      } else {
        for (const r of fileResults) {
          blocks.push(`  ${this._loc(r)}  ${this._highlight(r.match || "")}`);
        }
      }
    }

    return blocks.join("\n");
  }

  /**
   * Statistical summary of results.
   *
   * @param {object[]} results
   * @returns {string}
   */
  formatSummary(results) {
    if (!results || results.length === 0) {
      return this._dim("(no results — nothing to summarise)");
    }

    const fileSet = new Set();
    const typeCounts = new Map();
    const scores = [];
    let minLine = Infinity;
    let maxLine = 0;

    for (const r of results) {
      if (r.file) fileSet.add(r.file);
      if (typeof r.score === "number") scores.push(r.score);
      if (typeof r.line === "number") {
        if (r.line < minLine) minLine = r.line;
        if (r.line > maxLine) maxLine = r.line;
      }
      const kind = r.kind || r.type || "(match)";
      typeCounts.set(kind, (typeCounts.get(kind) || 0) + 1);
    }

    const avgScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : null;

    const lines = [
      `${this._bold("Results Summary")}`,
      `${this._dim("─".repeat(40))}`,
      `  Total matches:    ${results.length}`,
      `  Unique files:     ${fileSet.size}`,
    ];

    if (avgScore !== null) {
      const maxScore = Math.max(...scores);
      const minScore = Math.min(...scores);
      lines.push(`  Avg score:        ${avgScore.toFixed(2)}`);
      lines.push(`  Score range:      ${minScore.toFixed(2)} – ${maxScore.toFixed(2)}`);
    }

    if (minLine <= maxLine) {
      lines.push(`  Line range:       ${minLine} – ${maxLine}`);
    }

    if (typeCounts.size > 0) {
      lines.push(`  By type:`);
      for (const [kind, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
        const pct = ((count / results.length) * 100).toFixed(0);
        lines.push(`    ${kind.padEnd(16)} ${count} ${this._dim(`(${pct}%)`)}`);
      }
    }

    if (fileSet.size <= 15) {
      lines.push(`  Files:`);
      for (const f of [...fileSet].sort()) {
        const count = results.filter((r) => r.file === f).length;
        lines.push(`    ${f} ${this._dim(`(${count})`)}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Highlight all occurrences of query terms in *text* using ANSI colours.
   *
   * The query string is split into individual terms (ignoring filter syntax),
   * and each term match in *text* is wrapped in yellow colour codes.
   *
   * @param {string} text - the text to highlight
   * @param {string} query - the query whose terms should be highlighted
   * @returns {string}
   */
  highlightMatches(text, query) {
    if (!text || !query) return text || "";
    if (!this.useColor) return text;

    // Extract searchable terms from the query (skip filter syntax)
    const terms = extractQueryTerms(query);
    if (terms.length === 0) return text;

    // Build a single regex that matches any term (word boundaries, case-insensitive)
    const escaped = terms.map((t) => escapeRegex(t));
    // Sort by length descending so longer terms match before shorter substrings
    escaped.sort((a, b) => b.length - a.length);
    const pattern = new RegExp(`(${escaped.join("|")})`, "gi");

    return text.replace(pattern, (match) => {
      return `${YELLOW}${BOLD}${match}${RESET}`;
    });
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Format a single result header line.
   */
  _header(r, idx) {
    const num = `#${idx + 1}`;
    const loc = `${r.file || "?"}:${r.line || "?"}:${r.column || "?"}`;
    return `${this._bold(num)}  ${this._cyan(loc)}`;
  }

  /**
   * Format a location string (line:column).
   */
  _loc(r) {
    const line = String(r.line || "?").padStart(4, " ");
    const col = String(r.column || "?").padStart(3, " ");
    return `${this._dim(`${line}:${col}`)}`;
  }

  _bold(text) {
    return this.useColor ? `${BOLD}${text}${RESET}` : text;
  }

  _dim(text) {
    return this.useColor ? `${DIM}${text}${RESET}` : text;
  }

  _cyan(text) {
    return this.useColor ? `${CYAN}${text}${RESET}` : text;
  }

  _green(text) {
    return this.useColor ? `${GREEN}${text}${RESET}` : text;
  }

  _highlight(text) {
    return this.useColor ? `${YELLOW}${BOLD}${text}${RESET}` : text;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Group an array by a key function.  Returns a Map.
 */
function groupBy(arr, fn) {
  const map = new Map();
  for (const item of arr) {
    const key = fn(item);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(item);
  }
  return map;
}

/**
 * Truncate a line to *maxLen*, appending "…" when truncated.
 */
function truncateLine(line, maxLen) {
  if (line.length <= maxLen) return line;
  return line.slice(0, maxLen - 1) + "…";
}

/**
 * Extract plain-text search terms from a query string, stripping out
 * filter syntax like `key:value` or `-key:value`.
 */
function extractQueryTerms(query) {
  // Remove quoted strings first (extract their content as terms)
  const quotedTerms = [];
  const deQuoted = query.replace(/"((?:\\"|[^"])*)"/g, (_, inner) => {
    quotedTerms.push(inner.replace(/\\"/g, '"'));
    return " ";
  }).replace(/'((?:\\'|[^'])*)'/g, (_, inner) => {
    quotedTerms.push(inner.replace(/\\'/g, "'"));
    return " ";
  });

  // Remove filter syntax: -key:value, key:value
  const cleaned = deQuoted.replace(/-?[A-Za-z_][A-Za-z0-9_-]*:\S*/g, " ");

  // Split remaining text into words
  const words = cleaned.split(/[\s,;]+/).filter(Boolean);

  // Combine
  const all = [...quotedTerms, ...words];

  // Deduplicate (case-insensitive)
  const seen = new Set();
  return all.filter((t) => {
    const lower = t.toLowerCase();
    if (seen.has(lower) || lower.length < 2) return false;
    seen.add(lower);
    return true;
  });
}

/**
 * Escape regex meta-characters in a string.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { ResultsFormatter, extractQueryTerms, highlightMatches: (text, query, useColor) => {
  const fmt = new ResultsFormatter({ useColor: useColor !== false });
  return fmt.highlightMatches(text, query);
}};
