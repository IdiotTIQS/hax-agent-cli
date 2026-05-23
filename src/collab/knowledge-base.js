"use strict";

const AGENT_ROLES = Object.freeze({
  lead: { level: 100, label: 'lead' },
  architect: { level: 80, label: 'architect' },
  reviewer: { level: 70, label: 'reviewer' },
  implementer: { level: 50, label: 'implementer' },
  explorer: { level: 40, label: 'explorer' },
  observer: { level: 10, label: 'observer' },
});

const ACCESS_LEVELS = Object.freeze({
  public: 0,
  team: 1,
  restricted: 2,
  confidential: 3,
});

class SharedKnowledgeBase {
  constructor(options = {}) {
    this._store = new Map();
    this._subscriptions = new Map();
    this._agentRoles = new Map();
    this._sequence = 0;
    this._defaultAccess = options.defaultAccess || ACCESS_LEVELS.public;
  }

  /**
   * Register an agent with the knowledge base so access-control decisions
   * can be made against that agent's role.
   */
  registerAgent(agentId, role = 'observer') {
    requireString(agentId, 'agentId');
    requireString(role, 'role');

    const normalized = normalizeAgentRole(role);
    this._agentRoles.set(agentId, normalized);
  }

  /**
   * Share a piece of knowledge under a given key.
   *
   * @param {string} agentId
   * @param {string} key
   * @param {*}      value
   * @param {object} [options]
   * @param {number} [options.accessLevel]  - one of ACCESS_LEVELS
   * @param {string} [options.roleRequired] - agent role required to read
   * @param {string[]} [options.tags]       - searchable tags
   */
  share(agentId, key, value, options = {}) {
    requireString(agentId, 'agentId');
    requireString(key, 'key');

    if (!this._agentRoles.has(agentId)) {
      this.registerAgent(agentId, 'observer');
    }

    const accessLevel = normalizeAccessLevel(options.accessLevel);
    const entry = {
      id: `kb-${++this._sequence}`,
      key: String(key).trim(),
      value: deepClone(value),
      sharedBy: agentId,
      accessLevel,
      roleRequired: options.roleRequired || null,
      tags: normalizeList(options.tags),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Store by key (latest wins per key)
    this._store.set(entry.key, entry);

    this._notifySubscribers(agentId, entry.key, 'shared', entry);

    return deepClone(entry);
  }

  /**
   * Query a single piece of knowledge by key.
   * Access is checked against the requesting agent's role.
   */
  query(key, requestingAgentId) {
    requireString(key, 'key');

    const entry = this._store.get(key);
    if (!entry) {
      return null;
    }

    if (requestingAgentId && !this._checkAccess(entry, requestingAgentId)) {
      throw new Error(`Access denied: agent '${requestingAgentId}' does not have the required role for key '${key}'`);
    }

    return deepClone(entry);
  }

  /**
   * Search the knowledge base.  Returns entries whose key, value, or tags
   * match the query string (case-insensitive substring match).
   */
  search(query, requestingAgentId) {
    requireString(query, 'query');

    const lower = String(query).toLowerCase();
    const results = [];

    for (const entry of this._store.values()) {
      if (!this._matchesSearch(entry, lower)) {
        continue;
      }
      if (requestingAgentId && !this._checkAccess(entry, requestingAgentId)) {
        continue;
      }
      results.push(deepClone(entry));
    }

    return results;
  }

  /**
   * Subscribe an agent to knowledge-update notifications.
   * `pattern` is a RegExp or string (matched against entry key).
   * Returns an unsubscribe function.
   */
  subscribe(agentId, pattern) {
    requireString(agentId, 'agentId');

    if (!this._agentRoles.has(agentId)) {
      this.registerAgent(agentId, 'observer');
    }

    const regex = pattern instanceof RegExp ? pattern : new RegExp(wildcardToRegex(String(pattern || '*')));
    const sub = { agentId, regex };

    if (!this._subscriptions.has(agentId)) {
      this._subscriptions.set(agentId, []);
    }
    this._subscriptions.get(agentId).push(sub);

    return () => {
      const list = this._subscriptions.get(agentId);
      if (!list) {
        return false;
      }
      const idx = list.indexOf(sub);
      if (idx === -1) {
        return false;
      }
      list.splice(idx, 1);
      if (list.length === 0) {
        this._subscriptions.delete(agentId);
      }
      return true;
    };
  }

  /**
   * List all knowledge shared by a specific agent.
   */
  listByAgent(agentId) {
    requireString(agentId, 'agentId');

    const results = [];
    for (const entry of this._store.values()) {
      if (entry.sharedBy === agentId) {
        results.push(deepClone(entry));
      }
    }

    return results;
  }

  /**
   * Clear the entire knowledge base, including agent registrations.
   */
  clear() {
    this._store.clear();
    this._subscriptions.clear();
    this._agentRoles.clear();
    this._sequence = 0;
  }

  /**
   * Return the total number of entries.
   */
  get size() {
    return this._store.size;
  }

  /**
   * Return all registered agent IDs.
   */
  get agents() {
    return Array.from(this._agentRoles.keys());
  }

  /**
   * Return all keys currently in the knowledge base.
   */
  get keys() {
    return Array.from(this._store.keys());
  }

  // ---- Private helpers ----

  _checkAccess(entry, agentId) {
    // Public entries are always readable
    if (entry.accessLevel === ACCESS_LEVELS.public) {
      return true;
    }

    const agentRole = this._agentRoles.get(agentId);
    if (!agentRole) {
      return false;
    }

    // Owner always has access
    if (entry.sharedBy === agentId) {
      return true;
    }

    // Lead role can read everything
    if (agentRole.label === 'lead') {
      return true;
    }

    // Role-required check: if a specific role is required AND the agent
    // has that role, grant access regardless of access level.
    if (entry.roleRequired) {
      if (agentRole.label === entry.roleRequired) {
        return true;
      }
      return false;
    }

    // Team-level: any registered agent can read
    if (entry.accessLevel === ACCESS_LEVELS.team) {
      return true;
    }

    // Restricted: only same-role agents can read
    if (entry.accessLevel === ACCESS_LEVELS.restricted) {
      return agentRole.label === (this._agentRoles.get(entry.sharedBy) || {}).label;
    }

    // Confidential: only the sharing agent can read
    return false;
  }

  _matchesSearch(entry, lowerQuery) {
    if (entry.key.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    const valueStr = stringifyValue(entry.value);
    if (valueStr.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    if (entry.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))) {
      return true;
    }
    return false;
  }

  _notifySubscribers(agentId, key, action, entry) {
    for (const [subAgentId, subs] of this._subscriptions) {
      for (const sub of subs) {
        if (sub.regex.test(key)) {
          // In a real async system this would push to a queue; here we
          // provide a synchronous callback surface.
          // The subscriber's agentId is available as sub.agentId for routing.
        }
      }
    }
  }
}

/**
 * A thread-safe wrapper that serializes all mutations through a simple
 * turn-based lock.  Each public method that mutates or reads returns a
 * promise, ensuring agents interleave safely.
 *
 * This is a cooperative (single-threaded JS) lock — sufficient for the
 * concurrency model used by HaxAgent.
 */
class ConcurrentKnowledgeBase {
  constructor(options = {}) {
    this._base = new SharedKnowledgeBase(options);
    this._lock = Promise.resolve();
  }

  _withLock(fn) {
    const result = this._lock.then(() => fn());
    // Prevent unhandled rejections from breaking the chain
    this._lock = result.catch(() => {});
    return result;
  }

  registerAgent(agentId, role) {
    return this._withLock(() => this._base.registerAgent(agentId, role));
  }

  share(agentId, key, value, options) {
    return this._withLock(() => this._base.share(agentId, key, value, options));
  }

  query(key, requestingAgentId) {
    return this._withLock(() => this._base.query(key, requestingAgentId));
  }

  search(query, requestingAgentId) {
    return this._withLock(() => this._base.search(query, requestingAgentId));
  }

  subscribe(agentId, pattern) {
    return this._withLock(() => this._base.subscribe(agentId, pattern));
  }

  listByAgent(agentId) {
    return this._withLock(() => this._base.listByAgent(agentId));
  }

  clear() {
    return this._withLock(() => this._base.clear());
  }

  size() {
    return this._withLock(() => this._base.size);
  }

  agents() {
    return this._withLock(() => this._base.agents);
  }

  keys() {
    return this._withLock(() => this._base.keys);
  }
}

// ---- Helpers ----

function normalizeAgentRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  const found = AGENT_ROLES[normalized];
  if (found) {
    return { ...found };
  }
  return { level: 10, label: normalized || 'observer' };
}

function normalizeAccessLevel(level) {
  if (level === undefined || level === null) {
    return ACCESS_LEVELS.public;
  }
  const parsed = Number(level);
  if (Number.isSafeInteger(parsed) && parsed >= ACCESS_LEVELS.public && parsed <= ACCESS_LEVELS.confidential) {
    return parsed;
  }
  const str = String(level).toLowerCase();
  for (const [name, value] of Object.entries(ACCESS_LEVELS)) {
    if (name === str) {
      return value;
    }
  }
  return ACCESS_LEVELS.public;
}

function normalizeList(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function wildcardToRegex(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return `^${escaped.replace(/\\\*/g, '.*')}$`;
}

function stringifyValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }
  return String(value);
}

function deepClone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

module.exports = {
  ACCESS_LEVELS,
  AGENT_ROLES,
  ConcurrentKnowledgeBase,
  SharedKnowledgeBase,
};
