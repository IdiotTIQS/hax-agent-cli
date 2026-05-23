/**
 * Search query parser — converts user-facing search strings into structured
 * filter ASTs with support for AND/OR combinators, negation, and
 * autocomplete suggestions.
 */
"use strict";

// ---------------------------------------------------------------------------
// Known filter keys and their aliases
// ---------------------------------------------------------------------------

const FILTER_KEYS = new Map([
  ["file", ["file", "f", "path", "p"]],
  ["func", ["func", "fn", "function", "def"]],
  ["class", ["class", "cls", "c"]],
  ["lang", ["lang", "language", "l"]],
  ["content", ["content", "body", "text", "contains"]],
  ["exclude", ["exclude", "not", "ignore"]],
  ["type", ["type", "kind", "t"]],
  ["ext", ["ext", "extension"]],
]);

// Reverse map: alias → canonical key
const ALIAS_TO_KEY = new Map();
for (const [canonical, aliases] of FILTER_KEYS) {
  for (const a of aliases) {
    ALIAS_TO_KEY.set(a, canonical);
  }
}

const KNOWN_KEYS = new Set(ALIAS_TO_KEY.keys());

// ---------------------------------------------------------------------------
// QueryParser
// ---------------------------------------------------------------------------

class QueryParser {
  constructor() {
    this.filterKeys = FILTER_KEYS;
    this.aliasMap = ALIAS_TO_KEY;
  }

  /**
   * Parse a query string into an AST.
   *
   * @param {string} query - raw query string
   * @returns {object} AST with shape:
   *   { type: "query", groups: [{ type: "and", filters: [...], freeText: "" }], operator: "and"|"or" }
   */
  parse(query) {
    if (typeof query !== "string" || query.trim().length === 0) {
      return { type: "query", groups: [], operator: "and", original: query || "" };
    }

    // Split on OR (word-boundary, case-insensitive)
    const orParts = splitOr(query);

    const groups = orParts.map((part) => {
      const tokens = tokenizeQuery(part);
      const filters = [];
      const freeTextParts = [];

      for (const tok of tokens) {
        if (tok.type === "filter") {
          filters.push({
            type: "filter",
            key: canonicalizeKey(tok.key),
            rawKey: tok.key,
            value: tok.value,
            negate: tok.negate,
          });
        } else if (tok.type === "text") {
          freeTextParts.push(tok.value);
        }
      }

      return {
        type: "and",
        filters,
        freeText: freeTextParts.join(" "),
      };
    });

    const effectiveGroups = groups.filter(
      (g) => g.filters.length > 0 || g.freeText.length > 0,
    );

    return {
      type: "query",
      groups: effectiveGroups,
      operator: effectiveGroups.length > 1 ? "or" : "and",
      original: query,
    };
  }

  /**
   * Produce a human-readable explanation of what the query does.
   *
   * @param {string} query
   * @returns {string}
   */
  explain(query) {
    const ast = this.parse(query);

    if (ast.groups.length === 0) {
      return "Empty query — will match nothing.";
    }

    const parts = ast.groups.map((group, idx) => {
      const clauses = [];

      if (group.freeText) {
        clauses.push(`containing "${group.freeText}"`);
      }

      for (const f of group.filters) {
        const label = filterLabel(f.key);
        const action = f.negate ? `excluding ${label}` : `where ${label}`;
        clauses.push(`${action} is "${f.value}"`);
      }

      if (clauses.length === 0) {
        return "(empty group)";
      }

      let text = "Search " + clauses.join(", ");
      if (ast.groups.length > 1) {
        text = `(${idx + 1}) ${text}`;
      }
      return text;
    });

    if (ast.operator === "or") {
      return parts.join("\n  OR\n");
    }

    return parts.join("\n  AND\n");
  }

  /**
   * Generate query suggestions based on partial input.
   *
   * @param {string} query - partial query typed so far
   * @returns {{ suggestions: string[], hint: string }}
   */
  suggest(query) {
    if (!query || query.trim().length === 0) {
      return {
        suggestions: [
          "file:*.js",
          "func:name",
          "class:Name",
          "lang:js",
          "content:pattern",
          "-exclude:dir",
        ],
        hint: "Type a filter like file:, func:, class:, or free text.",
      };
    }

    const trimmed = query.trim();
    const suggestions = [];

    // Check if the query ends with a partial filter key (e.g. "fu", "cla")
    const lastColon = trimmed.lastIndexOf(":");
    const lastSpace = Math.max(
      trimmed.lastIndexOf(" "),
      trimmed.lastIndexOf("\t"),
    );

    if (lastColon > lastSpace) {
      // User has typed "key:value" — suggest values?  Or key is complete.
      // If the key is incomplete, the colon hasn't been typed yet, so
      // we handle that below.
      const keyPart = trimmed.slice(lastSpace + 1, lastColon).replace(/^-/, "");
      const valuePart = trimmed.slice(lastColon + 1);

      if (valuePart.length === 0) {
        // key: — suggest example values
        const canon = canonicalizeKey(keyPart);
        suggestions.push(...valueHints(canon));
      } else {
        // key:partialValue — no completion for values yet
        suggestions.push(`${trimmed}  (press Enter to search)`);
      }

      return {
        suggestions: suggestions.length > 0 ? suggestions : [trimmed],
        hint: suggestions.length > 0
          ? `Completions for ${canonicalizeKey(keyPart)}:`
          : "Type a value for the filter.",
      };
    }

    // Check if the last word is a partial filter key (no colon yet)
    const lastWord = trimmed.slice(lastSpace + 1);
    const negate = lastWord.startsWith("-");
    const partial = negate ? lastWord.slice(1) : lastWord;

    if (partial.length >= 1) {
      // Find matching filter keys
      for (const alias of KNOWN_KEYS) {
        if (alias.startsWith(partial.toLowerCase()) && alias !== partial) {
          const prefix = negate ? "-" : "";
          suggestions.push(`${trimmed.slice(0, lastSpace + 1)}${prefix}${alias}:`);
        }
      }
    }

    if (suggestions.length === 0) {
      // General suggestions
      const lastUpper = trimmed === trimmed.toUpperCase() && trimmed.length <= 4;
      if (lastUpper && /^[A-Z]+$/.test(trimmed) && !KNOWN_KEYS.has(trimmed.toLowerCase())) {
        // Might be trying OR — show OR usage
        suggestions.push(`${trimmed} OR file:`);
        suggestions.push(`${trimmed} OR func:`);
        suggestions.push(`${trimmed} OR class:`);
      } else if (trimmed.endsWith(" OR") || trimmed.endsWith(" or")) {
        suggestions.push(`${trimmed} file:*.js`);
        suggestions.push(`${trimmed} func:`);
        suggestions.push(`${trimmed} class:`);
      } else {
        // Add common filter suggestions
        suggestions.push(`${trimmed} file:`);
        suggestions.push(`${trimmed} func:`);
        suggestions.push(`${trimmed} class:`);
      }
    }

    return {
      suggestions: suggestions.slice(0, 8),
      hint: partial.length > 0
        ? `Filter key completions for "${partial}":`
        : "Available filters: file:, func:, class:, lang:, content:, -exclude:, type:, ext:",
    };
  }

  /**
   * Return the list of known filter keys (canonical names).
   *
   * @returns {string[]}
   */
  getKnownFilters() {
    return [...new Set([...FILTER_KEYS.keys()])];
  }

  /**
   * Return whether *key* is a recognised filter key (canonical or alias).
   *
   * @param {string} key
   * @returns {boolean}
   */
  isKnownKey(key) {
    return KNOWN_KEYS.has(key.toLowerCase());
  }
}

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

/**
 * Tokenize a single AND-group (no OR inside).
 *
 * Returns an array of token objects:
 *   { type: "filter", key, value, negate: boolean }
 *   { type: "text", value }
 *
 * @param {string} part
 * @returns {object[]}
 */
function tokenizeQuery(part) {
  const tokens = [];
  let i = 0;
  const len = part.length;

  while (i < len) {
    // Skip whitespace
    if (part[i] === " " || part[i] === "\t") {
      i += 1;
      continue;
    }

    // Quoted string
    if (part[i] === '"' || part[i] === "'") {
      const quote = part[i];
      i += 1;
      let val = "";
      while (i < len && part[i] !== quote) {
        if (part[i] === "\\" && i + 1 < len) {
          i += 1;
          val += part[i];
        } else {
          val += part[i];
        }
        i += 1;
      }
      i += 1; // skip closing quote

      // Peek ahead: if followed by ':' and we're at a token boundary, treat as filter value
      // But quoted strings are normally free text
      tokens.push({ type: "text", value: val });
      continue;
    }

    // Try to match a filter: [-](key):(value)
    const remaining = part.slice(i);
    const filterMatch = remaining.match(
      /^(-?)([A-Za-z_][A-Za-z0-9_-]*):(?:"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|(\S+))?/,
    );

    if (filterMatch) {
      const negate = filterMatch[1] === "-";
      const key = filterMatch[2];
      const quotedDouble = filterMatch[3];
      const quotedSingle = filterMatch[4];
      const bareValue = filterMatch[5];

      let value;
      if (quotedDouble !== undefined) {
        value = quotedDouble.replace(/\\"/g, '"');
      } else if (quotedSingle !== undefined) {
        value = quotedSingle.replace(/\\'/g, "'");
      } else if (bareValue !== undefined) {
        value = bareValue;
      } else {
        // key: with no value — treat as incomplete
        value = "";
      }

      if (isKnownFilterKey(key) || value !== undefined) {
        tokens.push({
          type: "filter",
          key,
          value: value !== undefined ? value : "",
          negate,
        });
        i += filterMatch[0].length;
        continue;
      }
    }

    // Plain word
    const wordMatch = remaining.match(/^(\S+)/);
    if (wordMatch) {
      tokens.push({ type: "text", value: wordMatch[1] });
      i += wordMatch[0].length;
      continue;
    }

    i += 1;
  }

  return tokens;
}

/**
 * Split a query string on standalone "OR" (word-boundary, case-insensitive).
 *
 * @param {string} query
 * @returns {string[]}
 */
function splitOr(query) {
  // Split on \bOR\b (case insensitive), but not inside quotes
  const parts = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;
  let i = 0;

  while (i < query.length) {
    const ch = query[i];

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      i += 1;
      continue;
    }

    if (!inDouble && !inSingle) {
      const rest = query.slice(i);
      const orMatch = rest.match(/^(?:\s+or\s+|\s+OR\s+)/);
      if (orMatch) {
        parts.push(current.trim());
        current = "";
        i += orMatch[0].length;
        continue;
      }
    }

    current += ch;
    i += 1;
  }

  if (current.trim().length > 0 || parts.length === 0) {
    parts.push(current.trim());
  }

  return parts.filter((p) => p.length > 0);
}

/**
 * Check if *key* is a known filter alias.
 */
function isKnownFilterKey(key) {
  return ALIAS_TO_KEY.has(key.toLowerCase());
}

/**
 * Map an alias to its canonical key. Returns the key unchanged if unknown.
 */
function canonicalizeKey(key) {
  return ALIAS_TO_KEY.get(key.toLowerCase()) || key.toLowerCase();
}

/**
 * Human-readable label for a filter key.
 */
function filterLabel(key) {
  const labels = {
    file: "file path",
    func: "function name",
    class: "class name",
    lang: "language",
    content: "content",
    exclude: "path pattern",
    type: "symbol type",
    ext: "file extension",
  };
  return labels[key] || key;
}

/**
 * Example value hints for a canonical filter key.
 */
function valueHints(canonical) {
  const hints = {
    file: ["file:*.js", "file:src/**", 'file:"my file.js"'],
    func: ["func:handleClick", "func:createServer", "func:init"],
    class: ["class:MyComponent", "class:BaseClass"],
    lang: ["lang:js", "lang:ts", "lang:py", "lang:go"],
    content: ["content:TODO", 'content:"error handling"'],
    exclude: ["-exclude:node_modules", "-exclude:.git", "-exclude:*.test.*"],
    type: ["type:function", "type:class", "type:variable", "type:import"],
    ext: ["ext:.js", "ext:.ts", "ext:.json"],
  };
  return hints[canonical] || [`${canonical}:<value>`];
}

module.exports = { QueryParser, tokenizeQuery, splitOr };
