"use strict";

/**
 * Fuzzy search engine for the HaxAgent command palette.
 *
 * FuzzySearcher provides scored fuzzy matching across command palette items,
 * with support for exact, prefix, substring, and fuzzy (Levenshtein) matching.
 * Results are ranked by relevance and returned with match metadata for
 * highlighting.
 */

/**
 * Calculate the Levenshtein edit distance between two strings.
 * Uses a single-row optimization for memory efficiency.
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * Get the length of the common prefix between two strings.
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Length of common prefix
 */
function getCommonPrefix(a, b) {
  const minLen = Math.min(a.length, b.length);
  let i = 0;
  while (i < minLen && a[i] === b[i]) i++;
  return i;
}

/**
 * Tokenize a string into lowercase alphanumeric tokens.
 *
 * @param {string} text - Input string
 * @returns {string[]} Array of tokens
 */
function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.一-鿿\s_/-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Find all indices where a query substring appears in a target string.
 *
 * @param {string} target - The target string to search in
 * @param {string} query - The query to find
 * @param {boolean} [caseSensitive=false]
 * @returns {Array<{start: number, end: number}>} Array of match ranges
 */
function findMatchRanges(target, query, caseSensitive) {
  const ranges = [];
  if (!query || !target) return ranges;

  const t = caseSensitive ? target : target.toLowerCase();
  const q = caseSensitive ? query : query.toLowerCase();

  let pos = 0;
  while (pos < t.length) {
    const idx = t.indexOf(q, pos);
    if (idx === -1) break;
    ranges.push({ start: idx, end: idx + q.length });
    pos = idx + 1;
  }

  return ranges;
}

/**
 * Fuzzy search engine for command palette items.
 *
 * @example
 *   const searcher = new FuzzySearcher();
 *   const results = searcher.search("file read", items);
 *   // => [{ item, score, matchedFields, matchRanges }, ...]
 */
class FuzzySearcher {
  /**
   * @param {object} [options]
   * @param {boolean} [options.caseSensitive=false]
   * @param {number} [options.minQueryLength=1] - Minimum query length to trigger search
   * @param {number} [options.maxResults=50] - Maximum results to return
   * @param {number} [options.fuzzyThreshold=3] - Max Levenshtein distance for fuzzy matches
   */
  constructor(options = {}) {
    this.caseSensitive = options.caseSensitive || false;
    this.minQueryLength = options.minQueryLength || 1;
    this.maxResults = options.maxResults || 50;
    this.fuzzyThreshold = options.fuzzyThreshold || 3;
  }

  /**
   * Fuzzy search items by query string.
   * Filters, scores, and ranks items. Returns scored results.
   *
   * @param {string} query - The search query
   * @param {Array<{id: string, name: string, description?: string, category?: string, keywords?: string[]}>} items - Items to search
   * @returns {Array<{item: object, score: number, matchedFields: string[], matchRanges: object}>}
   */
  search(query, items) {
    const filtered = this.filter(items, query);
    const ranked = this.rank(filtered, query);
    return ranked.slice(0, this.maxResults);
  }

  /**
   * Filter items by query string.
   * Returns all items that match at least one query token in name, description,
   * category, or keywords.
   *
   * @param {Array<object>} items - Items to filter
   * @param {string} query - Query string
   * @returns {Array<object>} Matching items
   */
  filter(items, query) {
    if (!query || query.trim().length < this.minQueryLength) {
      return items.slice(0, this.maxResults);
    }

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return items.slice(0, this.maxResults);

    const results = [];

    for (const item of items) {
      if (this._itemMatchesTokens(item, queryTokens)) {
        results.push(item);
      }
    }

    // If no exact token matches, try fuzzy matching on names
    if (results.length === 0 && queryTokens.length === 1) {
      for (const item of items) {
        const name = this.caseSensitive ? item.name : item.name.toLowerCase();
        const q = this.caseSensitive ? queryTokens[0] : queryTokens[0].toLowerCase();
        const distance = levenshteinDistance(q, name);
        if (distance <= this.fuzzyThreshold && name.length >= 2) {
          results.push(item);
        }
      }
    }

    return results;
  }

  /**
   * Check if an item matches a set of query tokens.
   *
   * @param {object} item - Palette item
   * @param {string[]} queryTokens - Tokenized query
   * @returns {boolean}
   */
  _itemMatchesTokens(item, queryTokens) {
    const name = this.caseSensitive ? item.name : item.name.toLowerCase();
    const desc = this.caseSensitive ? (item.description || "") : (item.description || "").toLowerCase();
    const cat = this.caseSensitive ? (item.category || "") : (item.category || "").toLowerCase();
    const kw = (item.keywords || []).map((k) =>
      this.caseSensitive ? k : k.toLowerCase()
    );

    // Check if ALL query tokens match somewhere
    for (const token of queryTokens) {
      const inName = name.includes(token);
      const inDesc = desc.includes(token);
      const inCat = cat.includes(token);
      const inKW = kw.some((k) => k.includes(token));

      // Also check fuzzy match on name
      let fuzzyNameMatch = false;
      if (!inName && !inDesc && !inCat && !inKW && token.length >= 2) {
        const distance = levenshteinDistance(token, name);
        fuzzyNameMatch = distance <= this.fuzzyThreshold && name.length >= 2;
      }

      if (!inName && !inDesc && !inCat && !inKW && !fuzzyNameMatch) {
        return false;
      }
    }

    return true;
  }

  /**
   * Rank items by relevance to the query.
   * Scoring strategy:
   *   - Exact name match: 100
   *   - Name starts with query: 90
   *   - Word starts with query: 80
   *   - Substring match in name: 60
   *   - Substring match in description: 40
   *   - Substring match in category: 30
   *   - Keyword match: 25
   *   - Fuzzy match on name: 20 + (similarity * 30)
   *   - Bonus per matched token: +5
   *
   * @param {Array<object>} items - Items to rank (already filtered)
   * @param {string} query - Query string
   * @returns {Array<{item: object, score: number, matchedFields: string[], matchRanges: object}>}
   */
  rank(items, query) {
    if (!query || query.trim().length === 0) {
      return items.map((item, i) => ({
        item,
        score: items.length - i,
        matchedFields: [],
        matchRanges: {},
      }));
    }

    const queryTokens = tokenize(query);
    const normalizedQuery = this.caseSensitive ? query : query.toLowerCase();

    const scored = items.map((item) => {
      const name = this.caseSensitive ? item.name : item.name.toLowerCase();
      const desc = this.caseSensitive ? (item.description || "") : (item.description || "").toLowerCase();
      const cat = this.caseSensitive ? (item.category || "") : (item.category || "").toLowerCase();
      const keywords = (item.keywords || []).map((k) =>
        this.caseSensitive ? k : k.toLowerCase()
      );

      let score = 0;
      const matchedFields = [];
      const matchRanges = {};

      // Exact name match (highest priority)
      if (name === normalizedQuery) {
        score += 100;
        matchedFields.push("name");
        matchRanges.name = [{ start: 0, end: name.length }];
      }
      // Name starts with query
      else if (name.startsWith(normalizedQuery)) {
        score += 90 - Math.min((name.length - normalizedQuery.length), 30);
        matchedFields.push("name");
        matchRanges.name = [{ start: 0, end: normalizedQuery.length }];
      }
      // Check if any WORD in name starts with query
      else {
        const nameWords = name.split(/[\s_/-]+/).filter(Boolean);
        let wordPrefixMatched = false;
        for (const word of nameWords) {
          if (word.startsWith(normalizedQuery)) {
            score += 80;
            wordPrefixMatched = true;
            break;
          }
        }
        if (wordPrefixMatched) {
          matchedFields.push("name");
          const ranges = findMatchRanges(item.name, query, this.caseSensitive);
          if (ranges.length > 0) matchRanges.name = ranges;
        }
      }

      // Substring match in name
      if (!matchedFields.includes("name") && name.includes(normalizedQuery)) {
        score += 60;
        matchedFields.push("name");
        const ranges = findMatchRanges(item.name, query, this.caseSensitive);
        if (ranges.length > 0) matchRanges.name = ranges;
      }

      // Substring match in description
      if (desc.includes(normalizedQuery)) {
        score += 40;
        matchedFields.push("description");
      }

      // Substring match in category
      if (cat.includes(normalizedQuery)) {
        score += 30;
        matchedFields.push("category");
      }

      // Keyword matches
      let keywordMatched = false;
      for (const kw of keywords) {
        if (kw.includes(normalizedQuery)) {
          keywordMatched = true;
          break;
        }
      }
      if (keywordMatched) {
        score += 25;
        matchedFields.push("keywords");
      }

      // Fuzzy match on name (Levenshtein) for typo tolerance
      if (!matchedFields.includes("name") && normalizedQuery.length >= 2) {
        const distance = levenshteinDistance(normalizedQuery, name);
        if (distance <= this.fuzzyThreshold && name.length >= 2) {
          const maxLen = Math.max(normalizedQuery.length, name.length);
          const similarity = 1 - distance / maxLen;
          score += 20 + similarity * 30;
          matchedFields.push("name");
        }
      }

      // Bonus for each token matched (multi-word queries)
      let tokenMatches = 0;
      for (const token of queryTokens) {
        if (
          name.includes(token) ||
          desc.includes(token) ||
          cat.includes(token) ||
          keywords.some((k) => k.includes(token))
        ) {
          tokenMatches++;
        }
      }
      score += tokenMatches * 5;

      // Small bonus for having a category
      if (item.category) {
        score += 1;
      }

      return {
        item,
        score: Math.max(0, score),
        matchedFields,
        matchRanges,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // If multiple items have the same score, sort alphabetically by name
    for (let i = 0; i < scored.length - 1; i++) {
      if (scored[i].score === scored[i + 1].score) {
        const start = i;
        while (
          i < scored.length - 1 &&
          scored[i].score === scored[i + 1].score
        ) {
          i++;
        }
        const end = i + 1;
        const slice = scored.slice(start, end);
        slice.sort((a, b) => a.item.name.localeCompare(b.item.name));
        for (let j = start; j < end; j++) {
          scored[j] = slice[j - start];
        }
      }
    }

    return scored;
  }

  /**
   * Highlight matching characters in an item's name for the given query.
   * Returns an object with the original text and an array of match ranges.
   *
   * @param {object} item - The palette item
   * @param {string} query - The search query
   * @returns {{ text: string, matches: Array<{start: number, end: number}> }}
   */
  highlight(item, query) {
    if (!query || !item || !item.name) {
      return { text: item ? item.name : "", matches: [] };
    }

    const name = item.name;
    const normalizedName = this.caseSensitive ? name : name.toLowerCase();
    const normalizedQuery = this.caseSensitive ? query : query.toLowerCase();

    // Collect all match ranges
    const allRanges = [];

    // Direct substring matches
    const directRanges = findMatchRanges(name, query, this.caseSensitive);
    allRanges.push(...directRanges);

    // Token-based matches
    const queryTokens = tokenize(query);
    for (const token of queryTokens) {
      const ranges = findMatchRanges(name, token, this.caseSensitive);
      allRanges.push(...ranges);
    }

    // Merge overlapping ranges
    const merged = mergeRanges(allRanges);

    return {
      text: name,
      matches: merged,
    };
  }

  /**
   * Get autocomplete suggestions based on a partial query.
   * Returns items whose name could be completed from the query prefix.
   *
   * @param {string} query - Partial input
   * @param {Array<object>} items - Available items
   * @param {object} [options]
   * @param {number} [options.limit=8] - Max suggestions
   * @returns {Array<{item: object, completion: string, reason: string}>}
   */
  getSuggestions(query, items, options = {}) {
    const limit = options.limit || 8;
    const normalizedQuery = this.caseSensitive ? query.trim() : query.trim().toLowerCase();

    if (!normalizedQuery || normalizedQuery.length < 1) return [];

    const suggestions = [];

    for (const item of items) {
      const name = this.caseSensitive ? item.name : item.name.toLowerCase();

      if (name.startsWith(normalizedQuery)) {
        suggestions.push({
          item,
          completion: item.name,
          reason: "prefix",
          priority: 0,
        });
      } else if (name.includes(normalizedQuery)) {
        suggestions.push({
          item,
          completion: item.name,
          reason: "contains",
          priority: 1,
        });
      } else {
        // Check keyword-based suggestions
        const keywords = (item.keywords || []).map((k) =>
          this.caseSensitive ? k : k.toLowerCase()
        );
        const keywordMatch = keywords.find((k) => k.startsWith(normalizedQuery));
        if (keywordMatch) {
          suggestions.push({
            item,
            completion: keywordMatch,
            reason: "keyword",
            priority: 2,
          });
        }
      }
    }

    // Sort by priority then alphabetically
    suggestions.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.completion.localeCompare(b.completion);
    });

    // Deduplicate by item id
    const seen = new Set();
    const unique = [];
    for (const s of suggestions) {
      if (!seen.has(s.item.id)) {
        seen.add(s.item.id);
        unique.push(s);
      }
    }

    return unique.slice(0, limit);
  }
}

/**
 * Merge overlapping and adjacent match ranges.
 *
 * @param {Array<{start: number, end: number}>} ranges
 * @returns {Array<{start: number, end: number}>}
 */
function mergeRanges(ranges) {
  if (ranges.length === 0) return [];

  const sorted = ranges.slice().sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];

    // Overlapping or adjacent (within 1 char)
    if (curr.start <= last.end + 1) {
      last.end = Math.max(last.end, curr.end);
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

module.exports = {
  FuzzySearcher,
  levenshteinDistance,
  tokenize,
  findMatchRanges,
  mergeRanges,
};
