"use strict";

// Context source types recognized by the selector.
const CONTEXT_SOURCES = Object.freeze([
  "files",
  "git",
  "deps",
  "history",
  "project",
  "errors",
  "decisions",
]);

/**
 * Relevance weights for scoring different dimensions of a context item.
 * Higher weight = more important when matching against a query.
 */
const RELEVANCE_WEIGHTS = {
  labelMatch: 15,        // Query tokens appear in context label
  contentMatch: 10,      // Query tokens appear in context content
  exactPhrase: 25,       // Exact query phrase match
  sourceRelevance: 8,    // Source type matches query intent
  recency: 5,            // Recently generated context
  specificity: 12,       // Specific/rare tokens match
};

// Default diversifier: max items per source type before spreading.
const DEFAULT_MAX_PER_SOURCE = 3;

/**
 * Selects relevant context blocks from an available pool, scored against a
 * user query and constrained by a token budget.
 */
class ContextSelector {
  /**
   * @param {{ maxPerSource?: number }} [options]
   */
  constructor(options = {}) {
    this.maxPerSource = Number.isSafeInteger(options.maxPerSource) && options.maxPerSource > 0
      ? options.maxPerSource
      : DEFAULT_MAX_PER_SOURCE;
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Select the most relevant context blocks for a query.
   *
   * @param {string} query - The user query to match against
   * @param {Array<{
   *   id?: string,
   *   label: string,
   *   content: string,
   *   source?: string,
   *   priority?: number,
   *   timestamp?: number|Date,
   *   tags?: string[],
   * }>} available - Pool of available context blocks
   * @param {{ maxResults?: number, budget?: number, diversify?: boolean }} [options]
   * @returns {{
   *   selected: Array<{
   *     id?: string, label: string, content: string, source?: string,
   *     score: number, priority?: number, timestamp?: number
   *   }>,
   *   discarded: number,
   *   budgetUsed: number,
   *   reason: string
   * }}
   */
  selectContext(query, available, options = {}) {
    const av = Array.isArray(available) ? available : [];
    const maxResults = Number.isSafeInteger(options.maxResults) && options.maxResults > 0
      ? options.maxResults
      : 10;
    const shouldDiversify = options.diversify !== false;

    if (av.length === 0) {
      return { selected: [], discarded: 0, budgetUsed: 0, reason: "no_available_context" };
    }

    const queryStr = String(query || "");
    if (queryStr.trim().length === 0) {
      // No query: fall back to priority ordering
      const sorted = this.prioritizeContexts(av, "");
      const selected = sorted.slice(0, maxResults);
      return { selected, discarded: av.length - selected.length, budgetUsed: 0, reason: "no_query_fallback" };
    }

    // Score and rank
    const scored = av.map(item => ({
      ...item,
      score: this.scoreRelevance(item, queryStr),
    }));

    // Filter out zero/near-zero score items
    const relevant = scored.filter(s => s.score > 0);
    if (relevant.length === 0) {
      // Return top items by priority (query didn't match anything)
      const top = av.slice(0, maxResults).map(item => ({ ...item, score: 0 }));
      return { selected: top, discarded: av.length - top.length, budgetUsed: 0, reason: "no_matches" };
    }

    // Diversify
    let ranked = shouldDiversify ? this.diversifyContexts(relevant) : relevant;

    if (options.budget !== undefined) {
      ranked = this.filterByBudget(ranked, options.budget);
    }

    const selected = ranked.slice(0, maxResults);
    return {
      selected,
      discarded: av.length - selected.length,
      budgetUsed: this._sumTokens(selected.map(s => s.content)),
      reason: "scored_and_selected",
    };
  }

  /**
   * Score how relevant a context item is to the query.
   *
   * @param {{ label: string, content: string, source?: string, tags?: string[], timestamp?: number|Date }} context
   * @param {string} query
   * @returns {number}
   */
  scoreRelevance(context, query) {
    if (!context || !query) return 0;

    const queryLower = query.toLowerCase().trim();
    if (queryLower.length === 0) return context.priority || 0;

    const labelLower = (context.label || "").toLowerCase();
    const contentLower = (context.content || "").toLowerCase();
    const tokens = this._tokenize(queryLower);

    if (tokens.length === 0) return context.priority || 0;

    let score = 0;

    // Label match: premium for context labels aligning with query
    for (const token of tokens) {
      if (labelLower.includes(token)) {
        score += RELEVANCE_WEIGHTS.labelMatch;
      }
    }

    // Content match
    for (const token of tokens) {
      if (contentLower.includes(token)) {
        score += RELEVANCE_WEIGHTS.contentMatch;
      }
    }

    // Exact phrase match
    if (labelLower.includes(queryLower) || contentLower.includes(queryLower)) {
      score += RELEVANCE_WEIGHTS.exactPhrase;
    }

    // Source relevance: certain sources align with certain query intents
    if (context.source) {
      score += this._scoreSourceMatch(context.source, queryLower, tokens);
    }

    // Specificity bonus: longer / rarer tokens that match get extra weight
    const longTokens = tokens.filter(t => t.length >= 5);
    for (const token of longTokens) {
      if (contentLower.includes(token)) {
        score += RELEVANCE_WEIGHTS.specificity;
      }
    }

    // Recency bonus
    if (context.timestamp) {
      const age = Date.now() - new Date(context.timestamp).getTime();
      if (age < 3600_000) score += RELEVANCE_WEIGHTS.recency;       // < 1 hour
      else if (age < 86400_000) score += Math.floor(RELEVANCE_WEIGHTS.recency / 2); // < 1 day
    }

    // Tag bonuses
    if (context.tags && Array.isArray(context.tags)) {
      const tagLower = context.tags.map(t => String(t).toLowerCase());
      for (const token of tokens) {
        if (tagLower.some(t => t.includes(token))) {
          score += Math.floor(RELEVANCE_WEIGHTS.labelMatch / 2);
        }
      }
    }

    return score;
  }

  /**
   * Filter contexts to stay within a token budget (chars-based estimate).
   *
   * @param {Array<{ content: string, score: number }>} contexts - Already sorted by relevance
   * @param {number} budget - Token budget
   * @returns {Array<{ content: string, score: number }>}
   */
  filterByBudget(contexts, budget) {
    if (!Array.isArray(contexts) || contexts.length === 0) return [];
    if (!Number.isFinite(budget) || budget <= 0) return contexts;

    const result = [];
    let used = 0;

    for (const ctx of contexts) {
      const tokens = this._estimateTokens(ctx.content || "");
      if (used + tokens <= budget) {
        result.push(ctx);
        used += tokens;
      } else {
        break;
      }
    }

    return result;
  }

  /**
   * Diversify context selection to avoid over-representation from a single source.
   * Preserves highest-scoring items and spreads across sources.
   *
   * @param {Array<{ source?: string, score: number }>} contexts - Scored contexts
   * @returns {Array<{ source?: string, score: number }>}
   */
  diversifyContexts(contexts) {
    if (!Array.isArray(contexts) || contexts.length === 0) return [];

    // Sort by score descending first
    const sorted = [...contexts].sort((a, b) => b.score - a.score);

    // Group by source
    const bySource = Object.create(null);
    const noSource = [];

    for (const ctx of sorted) {
      const src = ctx.source || "__unspecified__";
      if (!bySource[src]) bySource[src] = [];
      bySource[src].push(ctx);
      if (src === "__unspecified__") noSource.push(ctx);
    }

    // Interleave: round-robin across sources, taking highest-scored from each
    const result = [];
    const sourceKeys = Object.keys(bySource);

    // Sort source keys so that sources with highest-top-score come first
    sourceKeys.sort((a, b) => bySource[b][0].score - bySource[a][0].score);

    const indices = Object.create(null);
    for (const key of sourceKeys) indices[key] = 0;

    let added = true;
    while (added) {
      added = false;
      for (const key of sourceKeys) {
        if (indices[key] < bySource[key].length && indices[key] < this.maxPerSource) {
          result.push(bySource[key][indices[key]]);
          indices[key] += 1;
          added = true;
        }
      }
    }

    // Append any remaining items that exceed maxPerSource
    for (const key of sourceKeys) {
      while (indices[key] < bySource[key].length) {
        result.push(bySource[key][indices[key]]);
        indices[key] += 1;
      }
    }

    return result;
  }

  /**
   * Prioritize context items for a given query.
   * Combines relevance scoring with explicit priority field.
   *
   * @param {Array<{ priority?: number, label: string, content: string }>} contexts
   * @param {string} query
   * @returns {Array<{ priority: number, score: number, label: string, content: string }>}
   */
  prioritizeContexts(contexts, query) {
    if (!Array.isArray(contexts)) return [];

    const items = contexts.map(ctx => {
      const relevance = this.scoreRelevance(ctx, query);
      // Blend explicit priority (0-255 if set) with computed relevance
      const explicit = typeof ctx.priority === "number" ? ctx.priority : 0;
      const combined = explicit * 5 + relevance;
      return { ...ctx, score: relevance, priority: explicit, _combined: combined };
    });

    items.sort((a, b) => b._combined - a._combined || b.priority - a.priority);
    return items;
  }

  // ── Internal helpers ───────────────────────────────────────

  /**
   * Score how well a context source matches query intent keywords.
   * @param {string} source
   * @param {string} queryLower
   * @param {string[]} tokens
   * @returns {number}
   */
  _scoreSourceMatch(source, queryLower, tokens) {
    const sourceIntentKeywords = {
      files: ["file", "code", "module", "import", "export", "function", "class", "src", "component"],
      git: ["commit", "diff", "branch", "merge", "push", "pull", "stash", "change", "modify", "git"],
      deps: ["dependency", "package", "library", "version", "install", "npm", "pip", "cargo", "update"],
      history: ["history", "previous", "before", "last", "conversation", "chat", "earlier", "said", "asked"],
      project: ["project", "structure", "architecture", "overview", "stack", "tech"],
      errors: ["error", "bug", "crash", "exception", "fail", "fix", "debug", "stack trace", "traceback"],
      decisions: ["decision", "choice", "pattern", "convention", "rule", "standard", "why", "reason"],
    };

    const keywords = sourceIntentKeywords[source];
    if (!keywords) return 0;

    let score = 0;
    for (const keyword of keywords) {
      if (queryLower.includes(keyword)) score += 2;
      if (tokens.includes(keyword)) score += 1;
    }

    return score;
  }

  _tokenize(text) {
    const raw = (String(text).match(/[a-z0-9_$.-]+|[一-鿿]{2,}/g) || [])
      .map(t => t.toLowerCase())
      .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
    return [...new Set(raw)];
  }

  _estimateTokens(text) {
    return Math.ceil(String(text || "").length / 4);
  }

  _sumTokens(contents) {
    return contents.reduce((sum, c) => sum + this._estimateTokens(c), 0);
  }
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "how", "what", "why",
  "when", "where", "can", "you", "please", "fix", "bug", "issue", "file",
  "project", "code", "in", "on", "to", "of", "is", "a", "an", "be", "it",
  "or", "as", "at", "by", "my", "we", "are", "do",
]);

module.exports = {
  ContextSelector,
  CONTEXT_SOURCES,
  RELEVANCE_WEIGHTS,
};
