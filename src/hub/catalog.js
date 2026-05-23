/**
 * AgentCatalog — Publish, search, and manage agent/team/skill/config items
 * in a local catalog for the HaxAgent marketplace and sharing hub.
 *
 *   const catalog = new AgentCatalog();
 *   catalog.publish({ type: "agent", name: "my-agent", ... });
 *   catalog.search("code review");
 *   catalog.list({ type: "agent", category: "CODE_REVIEW" });
 *
 * Catalog item format:
 *   { id, type, name, version, author, description, tags, category,
 *     rating, downloads, createdAt, updatedAt, content }
 */
"use strict";

const VALID_TYPES = Object.freeze(["agent", "team", "skill", "config"]);
const VALID_CATEGORIES = Object.freeze([
  "CODE_GEN",
  "CODE_REVIEW",
  "TESTING",
  "DEVOPS",
  "SECURITY",
  "DATA",
  "DOCS",
  "REFACTORING",
  "DEBUGGING",
  "CUSTOM",
]);

let _nextId = 1;

function _generateId() {
  const id = `item-${String(_nextId).padStart(6, "0")}`;
  _nextId += 1;
  return id;
}

function _now() {
  return new Date().toISOString();
}

function _normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => String(t).trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

function _validateItem(item) {
  if (!item || typeof item !== "object") {
    throw new Error("Item must be an object");
  }
  if (typeof item.name !== "string" || !item.name.trim()) {
    throw new Error("Item name is required");
  }
  if (!VALID_TYPES.includes(item.type)) {
    throw new Error(
      `Invalid item type "${item.type}". Expected one of: ${VALID_TYPES.join(", ")}`,
    );
  }
  if (
    item.category !== undefined &&
    item.category !== null &&
    !VALID_CATEGORIES.includes(item.category)
  ) {
    throw new Error(
      `Invalid category "${item.category}". Expected one of: ${VALID_CATEGORIES.join(", ")}`,
    );
  }
  if (item.rating !== undefined && item.rating !== null) {
    if (typeof item.rating !== "number" || item.rating < 0 || item.rating > 5) {
      throw new Error("Rating must be a number between 0 and 5");
    }
  }
  if (item.downloads !== undefined && item.downloads !== null) {
    if (!Number.isSafeInteger(item.downloads) || item.downloads < 0) {
      throw new Error("Downloads must be a non-negative integer");
    }
  }
}

class AgentCatalog {
  constructor() {
    /** @type {Map<string, object>} */
    this._items = new Map();
  }

  // -------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------

  /**
   * Publish an agent, team, skill, or config to the catalog.
   *
   * @param {object} item
   * @param {string} item.type      - "agent" | "team" | "skill" | "config"
   * @param {string} item.name      - Display name
   * @param {string} [item.version] - Semantic version (defaults to "0.1.0")
   * @param {string} [item.author]  - Author identifier
   * @param {string} [item.description]
   * @param {Array<string>} [item.tags]
   * @param {string} [item.category]
   * @param {number} [item.rating]
   * @param {number} [item.downloads]
   * @param {object} [item.content] - Arbitrary payload (agent definition, team config, etc.)
   * @returns {object} The published item with id and timestamps
   */
  publish(item) {
    _validateItem(item);

    const id = _generateId();
    const now = _now();

    const normalized = Object.freeze({
      id,
      type: item.type,
      name: item.name.trim(),
      version: item.version || "0.1.0",
      author: item.author || "anonymous",
      description: String(item.description || "").trim(),
      tags: Object.freeze(_normalizeTags(item.tags)),
      category: item.category || null,
      rating: item.rating ?? 0,
      downloads: item.downloads ?? 0,
      createdAt: now,
      updatedAt: now,
      content: item.content !== undefined ? Object.freeze({ ...item.content }) : null,
    });

    this._items.set(id, normalized);
    return normalized;
  }

  /**
   * Remove a published item from the catalog.
   *
   * @param {string} id
   * @returns {boolean} True if the item was removed
   */
  unpublish(id) {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("Item id is required");
    }
    return this._items.delete(id);
  }

  /**
   * Re-publish (update) an existing item by id. Preserves the original
   * createdAt but updates all other fields and bumps updatedAt.
   *
   * @param {string} id
   * @param {object} updates - Fields to update
   * @returns {object} The updated item
   */
  update(id, updates) {
    const existing = this._items.get(id);
    if (!existing) {
      throw new Error(`Item "${id}" not found`);
    }
    if (!updates || typeof updates !== "object") {
      throw new Error("Updates must be an object");
    }

    // Build a merged item then validate
    const merged = {
      type: updates.type !== undefined ? updates.type : existing.type,
      name: updates.name !== undefined ? updates.name : existing.name,
      version: updates.version !== undefined ? updates.version : existing.version,
      author: updates.author !== undefined ? updates.author : existing.author,
      description: updates.description !== undefined ? updates.description : existing.description,
      tags: updates.tags !== undefined ? updates.tags : [...existing.tags],
      category: updates.category !== undefined ? updates.category : existing.category,
      rating: updates.rating !== undefined ? updates.rating : existing.rating,
      downloads: updates.downloads !== undefined ? updates.downloads : existing.downloads,
      content: updates.content !== undefined
        ? { ...existing.content, ...updates.content }
        : { ...existing.content },
    };

    _validateItem(merged);

    const now = _now();
    const normalized = Object.freeze({
      id,
      type: merged.type,
      name: merged.name.trim(),
      version: merged.version || "0.1.0",
      author: merged.author || "anonymous",
      description: String(merged.description).trim(),
      tags: Object.freeze(_normalizeTags(merged.tags)),
      category: merged.category || null,
      rating: merged.rating ?? 0,
      downloads: merged.downloads ?? 0,
      createdAt: existing.createdAt,
      updatedAt: now,
      content: merged.content !== null ? Object.freeze({ ...merged.content }) : null,
    });

    this._items.set(id, normalized);
    return normalized;
  }

  // -------------------------------------------------------------------------
  // Retrieval
  // -------------------------------------------------------------------------

  /**
   * Get a specific item by id.
   *
   * @param {string} id
   * @returns {object|null}
   */
  getItem(id) {
    if (typeof id !== "string" || !id.trim()) {
      return null;
    }
    return this._items.get(id) || null;
  }

  /**
   * Get all items in the catalog.
   *
   * @returns {Array<object>}
   */
  getAll() {
    return Array.from(this._items.values());
  }

  /**
   * Get the total number of items.
   *
   * @returns {number}
   */
  count() {
    return this._items.size;
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  /**
   * Search catalog items by name, description, tags, or author.
   *
   * Matching is case-insensitive. Query terms are split on whitespace
   * and items must match ALL terms against any searchable field.
   *
   * @param {string} query - Search terms
   * @returns {Array<object>} Matching items sorted by relevance
   */
  search(query) {
    if (typeof query !== "string" || !query.trim()) {
      return [];
    }

    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const results = [];

    for (const item of this._items.values()) {
      const haystack = [
        item.name.toLowerCase(),
        item.description.toLowerCase(),
        item.author.toLowerCase(),
        ...item.tags,
      ].join(" ");

      const matchCount = terms.filter((term) => haystack.includes(term)).length;

      if (matchCount === terms.length) {
        results.push({ item, score: matchCount });
      }
    }

    // Sort descending by score, then by name
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.item.name.localeCompare(b.item.name);
    });

    return results.map((r) => r.item);
  }

  // -------------------------------------------------------------------------
  // List / filter
  // -------------------------------------------------------------------------

  /**
   * List catalog items with optional filtering and sorting.
   *
   * @param {object} [options]
   * @param {string} [options.type]     - Filter by type
   * @param {string} [options.category] - Filter by category
   * @param {string} [options.sortBy]   - "name" | "rating" | "downloads" | "createdAt" | "updatedAt"
   * @param {string} [options.order]    - "asc" | "desc" (default "desc")
   * @param {number} [options.limit]    - Max items to return
   * @param {number} [options.offset]   - Skip N items (for pagination)
   * @returns {Array<object>}
   */
  list(options = {}) {
    let items = Array.from(this._items.values());

    // Filter by type
    if (options.type && VALID_TYPES.includes(options.type)) {
      items = items.filter((item) => item.type === options.type);
    }

    // Filter by category
    if (options.category && VALID_CATEGORIES.includes(options.category)) {
      items = items.filter((item) => item.category === options.category);
    }

    // Sort
    const sortBy = options.sortBy || "updatedAt";
    const order = options.order === "asc" ? "asc" : "desc";

    items.sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];

      if (sortBy === "name") {
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
        const cmp = aVal.localeCompare(bVal);
        return order === "asc" ? cmp : -cmp;
      }

      if (typeof aVal === "string") aVal = new Date(aVal).getTime();
      if (typeof bVal === "string") bVal = new Date(bVal).getTime();

      aVal = Number(aVal) || 0;
      bVal = Number(bVal) || 0;

      return order === "asc" ? aVal - bVal : bVal - aVal;
    });

    // Pagination
    const offset = Math.max(0, options.offset || 0);
    const limit = options.limit !== undefined ? Math.max(0, options.limit) : undefined;

    if (offset > 0) {
      items = items.slice(offset);
    }
    if (limit !== undefined) {
      items = items.slice(0, limit);
    }

    return items;
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  /**
   * Get catalog statistics: totals by type and category.
   *
   * @returns {object} { total, byType, byCategory }
   */
  stats() {
    const byType = {};
    const byCategory = {};

    for (const item of this._items.values()) {
      byType[item.type] = (byType[item.type] || 0) + 1;
      const cat = item.category || "uncategorized";
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }

    return {
      total: this._items.size,
      byType,
      byCategory,
    };
  }
}

AgentCatalog.VALID_TYPES = VALID_TYPES;
AgentCatalog.VALID_CATEGORIES = VALID_CATEGORIES;

module.exports = { AgentCatalog, VALID_TYPES, VALID_CATEGORIES };
