"use strict";

const crypto = require("node:crypto");

// ── Knowledge types ──────────────────────────────────────────

const KNOWLEDGE_TYPES = Object.freeze({
  FACT: "fact",
  PATTERN: "pattern",
  DECISION: "decision",
  LESSON: "lesson",
  PREFERENCE: "preference",
});

// ── KnowledgeItem ────────────────────────────────────────────

class KnowledgeItem {
  /**
   * @param {string} type      - One of KNOWLEDGE_TYPES
   * @param {string} content   - The knowledge content
   * @param {object} [options]
   * @param {number} [options.confidence=0.5]    - 0..1
   * @param {string[]} [options.tags]            - Searchable tags
   * @param {string} [options.sourceSession]     - Session id that produced this
   * @param {string} [options.timestamp]         - ISO timestamp
   * @param {object} [options.metadata]          - Arbitrary extra data
   */
  constructor(type, content, options = {}) {
    this.id = `ki-${crypto.randomBytes(8).toString("hex")}`;
    this.type = normalizeKnowledgeType(type);
    this.content = String(content || "").trim();
    this.confidence = clampConfidence(options.confidence);
    this.tags = normalizeTags(options.tags);
    this.sourceSession = String(options.sourceSession || "");
    this.timestamp = options.timestamp || new Date().toISOString();
    this.metadata = options.metadata ? deepClone(options.metadata) : {};
  }
}

// ── KnowledgeAccumulator ─────────────────────────────────────

class KnowledgeAccumulator {
  /**
   * Accumulates knowledge extracted from sessions and provides
   * cross-session recall, synthesis, and topic analysis.
   *
   * @param {object} [options]
   * @param {number} [options.maxItems=10000]  - Max items before eviction
   */
  constructor(options = {}) {
    this._items = new Map();
    this._indexByTag = new Map();
    this._indexByType = new Map();
    this._maxItems = Number.isSafeInteger(options.maxItems) && options.maxItems > 0
      ? options.maxItems
      : 10000;
  }

  // ── learn ──────────────────────────────────────────────────

  /**
   * Extract knowledge items from a session object.
   *
   * A session should have { id, entries, metadata } where entries is an
   * array of objects each containing at least one text-bearing property
   * (text, content, or message) and optionally { type, role, timestamp }.
   *
   * @param {object} session
   * @param {string} session.id
   * @param {Array<object>} session.entries
   * @returns {KnowledgeItem[]} Extracted knowledge items
   */
  learn(session) {
    if (!session || !Array.isArray(session.entries)) {
      return [];
    }

    const sessionId = String(session.id || "");
    const items = [];

    for (const entry of session.entries) {
      const extracted = this._extractFromEntry(entry, sessionId);
      if (extracted) {
        items.push(extracted);
      }
    }

    return items;
  }

  /**
   * Attempt to extract a knowledge item from a single session entry.
   * Returns null when the entry does not contain extractable knowledge.
   */
  _extractFromEntry(entry, sessionId) {
    const text = entry?.text || entry?.content || entry?.message || "";
    if (typeof text !== "string" || !text.trim()) return null;

    const type = this._inferType(text);
    const tags = this._extractTags(text);
    const confidence = this._estimateConfidence(text, type);

    if (confidence < 0.3) return null;

    return new KnowledgeItem(type, text, {
      confidence,
      tags,
      sourceSession: sessionId,
      timestamp: entry.timestamp || new Date().toISOString(),
      metadata: { entryType: entry.type || entry.role || "unknown" },
    });
  }

  /** Heuristic type inference based on text content. */
  _inferType(text) {
    const t = text.toLowerCase();
    if (/\b(always|never|prefer|like|preference|favor|favourite|favorite)\b/.test(t)) {
      return KNOWLEDGE_TYPES.PREFERENCE;
    }
    if (/\b(learned|lesson|mistake|improved|should have|next time|takeaway|realised|realized)\b/.test(t)) {
      return KNOWLEDGE_TYPES.LESSON;
    }
    if (/\b(decided|chose|selected|opted|decision|choice|resolved|concluded)\b/.test(t)) {
      return KNOWLEDGE_TYPES.DECISION;
    }
    if (/\b(pattern|trend|usually|typically|often|consistently|repeatedly|every time)\b/.test(t)) {
      return KNOWLEDGE_TYPES.PATTERN;
    }
    return KNOWLEDGE_TYPES.FACT;
  }

  /** Extract hashtag-style tags from text. */
  _extractTags(text) {
    const tags = [];
    const hashtagRegex = /#(\w{2,30})/g;
    let match;
    while ((match = hashtagRegex.exec(text)) !== null) {
      tags.push(match[1].toLowerCase());
    }
    return [...new Set(tags)];
  }

  /** Estimate confidence of an extraction based on heuristics. */
  _estimateConfidence(text, type) {
    let confidence = 0.5;

    // Longer, more specific statements have higher confidence
    if (text.length > 50) confidence += 0.1;
    if (text.length > 100) confidence += 0.1;

    // Hashtags indicate structured knowledge
    if (/#\w+/.test(text)) confidence += 0.1;

    // Question marks lower confidence (speculative)
    if (/\?/.test(text)) confidence -= 0.2;

    // Exclamation marks indicate certainty
    if (/!/.test(text)) confidence += 0.05;

    // Code blocks suggest concrete knowledge
    if (/```|`[^`]+`/.test(text)) confidence += 0.1;

    return Math.max(0, Math.min(1, confidence));
  }

  // ── accumulate ─────────────────────────────────────────────

  /**
   * Add knowledge item(s) to the accumulator.
   *
   * Accepts a single KnowledgeItem, a plain { type, content, ... } object
   * (which is converted), or an array of either.
   *
   * @param {KnowledgeItem|object|Array<KnowledgeItem|object>} knowledge
   * @returns {KnowledgeItem[]} The stored items
   */
  accumulate(knowledge) {
    const items = Array.isArray(knowledge) ? knowledge : [knowledge];
    const stored = [];

    for (const candidate of items) {
      let item;
      if (candidate instanceof KnowledgeItem) {
        item = candidate;
      } else if (candidate && typeof candidate === "object") {
        item = new KnowledgeItem(
          candidate.type || KNOWLEDGE_TYPES.FACT,
          candidate.content || "",
          candidate
        );
      } else {
        continue;
      }

      if (item.content.length === 0) continue;

      stored.push(this._storeItem(item));
    }

    this._enforceMaxItems();
    return stored;
  }

  /** Internal store + index. */
  _storeItem(item) {
    this._items.set(item.id, item);

    // Type index
    if (!this._indexByType.has(item.type)) {
      this._indexByType.set(item.type, new Set());
    }
    this._indexByType.get(item.type).add(item.id);

    // Tag index
    for (const tag of item.tags) {
      if (!this._indexByTag.has(tag)) {
        this._indexByTag.set(tag, new Set());
      }
      this._indexByTag.get(tag).add(item.id);
    }

    return item;
  }

  /** Evict oldest items when exceeding maxItems. */
  _enforceMaxItems() {
    while (this._items.size > this._maxItems) {
      let oldest = null;
      for (const item of this._items.values()) {
        if (!oldest || item.timestamp < oldest.timestamp) {
          oldest = item;
        }
      }
      if (oldest) {
        this._removeFromIndexes(oldest);
        this._items.delete(oldest.id);
      }
    }
  }

  /** Remove an item from all indexes (caller is responsible for deleting from _items). */
  _removeFromIndexes(item) {
    const typeSet = this._indexByType.get(item.type);
    if (typeSet) {
      typeSet.delete(item.id);
      if (typeSet.size === 0) this._indexByType.delete(item.type);
    }
    for (const tag of item.tags) {
      const tagSet = this._indexByTag.get(tag);
      if (tagSet) {
        tagSet.delete(item.id);
        if (tagSet.size === 0) this._indexByTag.delete(tag);
      }
    }
  }

  // ── recall ─────────────────────────────────────────────────

  /**
   * Retrieve accumulated knowledge matching a query.
   *
   * @param {string|object} query - Free-text string or structured { type, tags, confidenceMin }
   * @param {object} [options]
   * @param {string} [options.type]           - Filter by knowledge type
   * @param {string[]} [options.tags]         - Filter items that have ANY of these tags
   * @param {number} [options.confidenceMin]  - Minimum confidence threshold
   * @param {string} [options.since]          - ISO timestamp lower bound
   * @param {number} [options.limit]          - Max results
   * @returns {KnowledgeItem[]} Matching items sorted by relevance (descending)
   */
  recall(query, options = {}) {
    let candidates;

    if (typeof query === "string" && query.trim().length > 0) {
      candidates = this._searchByText(query.trim());
    } else if (query && typeof query === "object") {
      candidates = this._searchByObject(query);
    } else {
      candidates = Array.from(this._items.values());
    }

    // Apply post-filters
    if (options.type) {
      const t = normalizeKnowledgeType(options.type);
      candidates = candidates.filter((item) => item.type === t);
    }
    if (Array.isArray(options.tags) && options.tags.length > 0) {
      candidates = candidates.filter((item) =>
        options.tags.some((tag) => item.tags.includes(tag))
      );
    }
    if (typeof options.confidenceMin === "number") {
      candidates = candidates.filter((item) => item.confidence >= options.confidenceMin);
    }
    if (typeof options.since === "string") {
      const sinceMs = new Date(options.since).getTime();
      if (!isNaN(sinceMs)) {
        candidates = candidates.filter((item) => new Date(item.timestamp).getTime() >= sinceMs);
      }
    }

    // Sort by relevance — items may carry a temp _score from _searchByText
    candidates.sort((a, b) => {
      const scoreA = (a._score || 0) + a.confidence * 5;
      const scoreB = (b._score || 0) + b.confidence * 5;
      return scoreB - scoreA;
    });

    // Clean up temp scoring
    for (const c of candidates) delete c._score;

    if (Number.isSafeInteger(options.limit) && options.limit > 0) {
      candidates = candidates.slice(0, options.limit);
    }

    return candidates;
  }

  /** Full-text search against content, tags, and type. */
  _searchByText(query) {
    const lower = query.toLowerCase();
    const tokens = lower.split(/\s+/).filter(Boolean);
    const results = [];

    for (const item of this._items.values()) {
      const content = item.content.toLowerCase();
      let score = 0;

      // Exact phrase match
      if (content.includes(lower)) {
        score += 30;
      }

      // Individual token matches
      for (const token of tokens) {
        if (content.includes(token)) score += 5;
        if (item.tags.some((tag) => tag.includes(token))) score += 10;
        if (item.type.includes(token)) score += 3;
      }

      if (score > 0) {
        item._score = score;
        results.push(item);
      }
    }

    return results;
  }

  /** Structured-object search. */
  _searchByObject(query) {
    let results = Array.from(this._items.values());

    if (query.type) {
      const t = normalizeKnowledgeType(query.type);
      results = results.filter((item) => item.type === t);
    }
    if (query.tags) {
      const tagList = Array.isArray(query.tags) ? query.tags : [query.tags];
      results = results.filter((item) => tagList.some((tag) => item.tags.includes(tag)));
    }
    if (typeof query.confidenceMin === "number") {
      results = results.filter((item) => item.confidence >= query.confidenceMin);
    }

    for (const item of results) {
      item._score = item.confidence * 10;
    }

    return results;
  }

  // ── synthesize ─────────────────────────────────────────────

  /**
   * Synthesize all accumulated knowledge related to a given topic.
   *
   * Aggregates items whose content or tags reference the topic, returning
   * a summary, confidence score, type breakdown, and the items themselves.
   *
   * @param {string} topic
   * @returns {object} { topic, summary, itemCount, confidence, types, items, firstSeen, lastSeen }
   */
  synthesize(topic) {
    requireString(topic, "topic");
    const lower = topic.toLowerCase();
    const relevant = [];

    for (const item of this._items.values()) {
      if (item.content.toLowerCase().includes(lower) ||
          item.tags.some((tag) => tag.includes(lower))) {
        relevant.push(item);
      }
    }

    if (relevant.length === 0) {
      return {
        topic,
        summary: "No knowledge accumulated on this topic.",
        itemCount: 0,
        confidence: 0,
        types: {},
        items: [],
        firstSeen: null,
        lastSeen: null,
      };
    }

    // Group by type
    const byType = {};
    for (const item of relevant) {
      if (!byType[item.type]) byType[item.type] = [];
      byType[item.type].push(item);
    }

    const typeSummaries = Object.entries(byType).map(([type, items]) =>
      `${items.length} ${type}${items.length !== 1 ? "s" : ""}`
    );

    const avgConfidence = relevant.reduce((sum, item) => sum + item.confidence, 0) / relevant.length;
    const sorted = [...relevant].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return {
      topic,
      summary: `Found ${relevant.length} knowledge item${relevant.length !== 1 ? "s" : ""} (${typeSummaries.join(", ")}) about "${topic}".`,
      itemCount: relevant.length,
      confidence: Math.round(avgConfidence * 100) / 100,
      types: Object.fromEntries(
        Object.entries(byType).map(([type, items]) => [type, items.length])
      ),
      items: relevant,
      firstSeen: sorted[0].timestamp,
      lastSeen: sorted[sorted.length - 1].timestamp,
    };
  }

  // ── getTopics ──────────────────────────────────────────────

  /**
   * Build a topic map with confidence scores from all accumulated knowledge.
   *
   * Topics are derived from tags attached to knowledge items. Each topic
   * entry includes count, average confidence, the types of knowledge that
   * reference it, and when it was last seen.
   *
   * @returns {object} { [topicName]: { count, confidence, types, lastSeen } }
   */
  getTopics() {
    const topics = new Map();

    for (const item of this._items.values()) {
      for (const tag of item.tags) {
        if (!topics.has(tag)) {
          topics.set(tag, {
            count: 0,
            confidenceSum: 0,
            types: new Set(),
            lastSeen: item.timestamp,
          });
        }
        const t = topics.get(tag);
        t.count++;
        t.confidenceSum += item.confidence;
        t.types.add(item.type);
        if (item.timestamp > t.lastSeen) t.lastSeen = item.timestamp;
      }
    }

    const result = {};
    for (const [name, info] of topics) {
      result[name] = {
        count: info.count,
        confidence: Math.round((info.confidenceSum / info.count) * 100) / 100,
        types: Array.from(info.types),
        lastSeen: info.lastSeen,
      };
    }

    return result;
  }

  // ── Utility accessors ──────────────────────────────────────

  /** Total number of stored knowledge items. */
  get size() {
    return this._items.size;
  }

  /** All stored items as an array (shallow copy). */
  get items() {
    return Array.from(this._items.values());
  }

  /** Remove all accumulated knowledge. */
  clear() {
    this._items.clear();
    this._indexByTag.clear();
    this._indexByType.clear();
  }
}

// ── Helpers ──────────────────────────────────────────────────

function normalizeKnowledgeType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  const valid = Object.values(KNOWLEDGE_TYPES);
  if (valid.includes(normalized)) return normalized;
  throw new Error(
    `Invalid knowledge type '${type}'. Must be one of: ${valid.join(", ")}`
  );
}

function clampConfidence(value) {
  if (value === undefined || value === null) return 0.5;
  const num = Number(value);
  if (isNaN(num)) return 0.5;
  return Math.max(0, Math.min(1, num));
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return [...new Set(
      tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    )];
  }
  if (typeof tags === "string") {
    return tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

function deepClone(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
}

// ── Exports ──────────────────────────────────────────────────

module.exports = {
  KNOWLEDGE_TYPES,
  KnowledgeAccumulator,
  KnowledgeItem,
  normalizeKnowledgeType,
};
