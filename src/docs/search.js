"use strict";

/**
 * Full-text search and fuzzy matching engine for the HaxAgent documentation browser.
 *
 * buildSearchIndex(docs)  — tokenizes doc entries into a searchable index
 * search(query, index)    — ranks entries by relevance to the query
 * fuzzyMatch(query, candidates) — finds closest matches tolerating typos
 * getSuggestions(query, index)  — returns autocomplete suggestions
 */

/**
 * Build a searchable index from an array of doc entries.
 * Each entry is tokenized into lowercase words with source tracking.
 *
 * @param {Array<{id: string, title: string, description: string, [key: string]: any}>} docs
 * @returns {{ entries: Array, tokens: Map<string, Array<{entryIndex: number, field: string}>> }}
 */
function buildSearchIndex(docs) {
  const entries = [];
  const tokens = new Map();

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    entries.push({
      id: doc.id,
      title: doc.title,
      description: doc.description || "",
      usage: doc.usage || "",
      examples: doc.examples || [],
      seeAlso: doc.seeAlso || [],
    });

    // Tokenize each searchable field
    const fields = ["title", "description", "usage"];
    for (const field of fields) {
      const text = field === "examples" ? flattenExamples(doc.examples) : String(doc[field] || "");
      const words = tokenize(text);
      for (const word of words) {
        let postingList = tokens.get(word);
        if (!postingList) {
          postingList = [];
          tokens.set(word, postingList);
        }
        // Avoid duplicate entries for the same field+word
        if (!postingList.some((p) => p.entryIndex === i && p.field === field)) {
          postingList.push({ entryIndex: i, field });
        }
      }
    }

    // Index examples separately
    if (Array.isArray(doc.examples)) {
      for (let ei = 0; ei < doc.examples.length; ei++) {
        const words = tokenize(doc.examples[ei]);
        for (const word of words) {
          let postingList = tokens.get(word);
          if (!postingList) {
            postingList = [];
            tokens.set(word, postingList);
          }
          if (!postingList.some((p) => p.entryIndex === i && p.field === ("example-" + ei))) {
            postingList.push({ entryIndex: i, field: "example-" + ei });
          }
        }
      }
    }

    // Index settings paths for configuration docs
    if (Array.isArray(doc.settings)) {
      for (const setting of doc.settings) {
        const settingWords = tokenize(setting.path + " " + (setting.description || "") + " " + (setting.env || ""));
        for (const word of settingWords) {
          let postingList = tokens.get(word);
          if (!postingList) {
            postingList = [];
            tokens.set(word, postingList);
          }
          if (!postingList.some((p) => p.entryIndex === i && p.field === "settings")) {
            postingList.push({ entryIndex: i, field: "settings" });
          }
        }
      }
    }
  }

  return { entries, tokens };
}

/**
 * Search the index for entries matching the query.
 * Returns results ranked by relevance score.
 *
 * @param {string} query - The search query
 * @param {{ entries: Array, tokens: Map }} index - The search index from buildSearchIndex
 * @param {{ limit?: number }} [options]
 * @returns {Array<{entry: object, score: number, matchedTerms: string[]}>}
 */
function search(query, index, options = {}) {
  const limit = options.limit || 20;
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) return [];

  // Score each entry
  const scored = new Map(); // entryIndex -> { score, matchedTerms }

  for (const queryToken of queryTokens) {
    // Exact matches
    const postings = index.tokens.get(queryToken);
    if (postings) {
      for (const posting of postings) {
        const existing = scored.get(posting.entryIndex);
        const fieldWeight = getFieldWeight(posting.field);
        if (existing) {
          existing.score += fieldWeight;
          if (!existing.matchedTerms.includes(queryToken)) {
            existing.matchedTerms.push(queryToken);
          }
        } else {
          scored.set(posting.entryIndex, {
            score: fieldWeight,
            matchedTerms: [queryToken],
          });
        }
      }
    }

    // Prefix matches (for partial typing)
    for (const [indexToken, postings] of index.tokens) {
      if (indexToken === queryToken) continue;
      if (indexToken.startsWith(queryToken)) {
        for (const posting of postings) {
          const existing = scored.get(posting.entryIndex);
          const fieldWeight = getFieldWeight(posting.field) * 0.5; // Lower weight for prefix matches
          if (existing) {
            existing.score += fieldWeight;
          } else {
            scored.set(posting.entryIndex, {
              score: fieldWeight,
              matchedTerms: [],
            });
          }
        }
      }
    }

    // Fuzzy matches: if queryToken is at least 4 chars, try to match similar tokens
    if (queryToken.length >= 4) {
      for (const [indexToken, postings] of index.tokens) {
        if (indexToken === queryToken || indexToken.startsWith(queryToken)) continue;
        // Quick pre-filter: skip if length difference is too large
        if (Math.abs(indexToken.length - queryToken.length) > 3) continue;
        // Check if tokens share a common prefix of at least 2 chars
        const commonPrefix = getCommonPrefix(queryToken, indexToken);
        if (commonPrefix >= 2 && indexToken.length >= 3) {
          for (const posting of postings) {
            const existing = scored.get(posting.entryIndex);
            const fieldWeight = getFieldWeight(posting.field) * 0.25; // Low weight for fuzzy
            if (existing) {
              existing.score += fieldWeight;
            } else {
              scored.set(posting.entryIndex, {
                score: fieldWeight,
                matchedTerms: [],
              });
            }
          }
        }
      }
    }
  }

  // Sort by score descending
  const results = [];
  for (const [entryIndex, info] of scored) {
    results.push({
      entry: index.entries[entryIndex],
      score: info.score,
      matchedTerms: info.matchedTerms,
    });
  }

  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

/**
 * Fuzzy match query against a list of candidate strings.
 * Uses Levenshtein distance to find the closest matches.
 * Handles typos gracefully.
 *
 * @param {string} query - The user's query (possibly misspelled)
 * @param {string[]} candidates - List of candidate strings to match against
 * @param {{ threshold?: number, limit?: number }} [options]
 * @returns {Array<{candidate: string, distance: number, score: number}>}
 */
function fuzzyMatch(query, candidates, options = {}) {
  const threshold = options.threshold || 3;
  const limit = options.limit || 10;
  const normalizedQuery = query.toLowerCase().trim();

  if (!normalizedQuery) return [];
  if (!candidates.length) return [];

  const scored = [];

  for (const candidate of candidates) {
    const normalizedCandidate = candidate.toLowerCase();
    const distance = levenshteinDistance(normalizedQuery, normalizedCandidate);

    if (distance <= threshold || normalizedCandidate.includes(normalizedQuery)) {
      const maxLen = Math.max(normalizedQuery.length, normalizedCandidate.length);
      const score = 1 - distance / maxLen;
      scored.push({ candidate, distance, score });
    }
  }

  // Sort by score descending, then distance ascending
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.distance - b.distance;
  });

  return scored.slice(0, limit);
}

/**
 * Get autocomplete suggestions based on a partial query.
 * Returns titles and IDs that start with or contain the query.
 *
 * @param {string} query - Partial input from user
 * @param {{ entries: Array, tokens: Map }} index - The search index
 * @param {{ limit?: number }} [options]
 * @returns {Array<{id: string, title: string, reason: string}>}
 */
function getSuggestions(query, index, options = {}) {
  const limit = options.limit || 8;
  const normalized = query.toLowerCase().trim();

  if (!normalized) return [];

  const suggestions = [];
  const seen = new Set();

  for (const entry of index.entries) {
    const titleLower = entry.title.toLowerCase();
    const descLower = entry.description.toLowerCase();

    // Title starts with query (highest priority)
    if (titleLower.startsWith(normalized)) {
      suggestions.push({ id: entry.id, title: entry.title, reason: "title", priority: 0 });
      seen.add(entry.id);
    }
    // Title contains query
    else if (titleLower.includes(normalized)) {
      suggestions.push({ id: entry.id, title: entry.title, reason: "title-contains", priority: 1 });
      seen.add(entry.id);
    }
    // Description contains query
    else if (descLower.includes(normalized)) {
      suggestions.push({ id: entry.id, title: entry.title, reason: "description", priority: 2 });
      seen.add(entry.id);
    }
  }

  // Sort by priority then alphabetically
  suggestions.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.title.localeCompare(b.title);
  });

  // Deduplicate by id
  const unique = [];
  const seenIds = new Set();
  for (const s of suggestions) {
    if (!seenIds.has(s.id)) {
      seenIds.add(s.id);
      unique.push(s);
    }
  }

  return unique.slice(0, limit);
}

/**
 * Tokenize a string into lowercase alphanumeric tokens.
 */
function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿\s_-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Flatten examples array into a single searchable string.
 */
function flattenExamples(examples) {
  if (!Array.isArray(examples)) return "";
  return examples.join(" ");
}

/**
 * Calculate the Levenshtein edit distance between two strings.
 */
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;

  // Early exit for empty strings
  if (m === 0) return n;
  if (n === 0) return m;

  // Use single row optimization for memory efficiency
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev]; // swap buffers
  }

  return prev[n];
}

/**
 * Get the length of the common prefix between two strings.
 */
function getCommonPrefix(a, b) {
  const minLen = Math.min(a.length, b.length);
  let i = 0;
  while (i < minLen && a[i] === b[i]) i++;
  return i;
}

/**
 * Weight multiplier for different search fields.
 * Title matches are most important, description next, then examples/usage.
 */
function getFieldWeight(field) {
  if (field === "title") return 3;
  if (field === "description") return 2;
  if (field === "usage") return 1.5;
  if (field === "settings") return 1.5;
  return 1;
}

module.exports = {
  buildSearchIndex,
  search,
  fuzzyMatch,
  getSuggestions,
  tokenize,
  levenshteinDistance,
};
