"use strict";

const PRIORITY_LEVELS = Object.freeze({
  low: 10,
  normal: 50,
  high: 80,
  critical: 100,
});

class MessageThread {
  constructor(threadId) {
    this._threadId = threadId;
    this._messages = [];
  }

  get threadId() {
    return this._threadId;
  }

  get messages() {
    return this._messages.map(deepClone);
  }

  get length() {
    return this._messages.length;
  }

  get rootMessage() {
    return this._messages.length > 0 ? deepClone(this._messages[0]) : null;
  }

  get latestMessage() {
    return this._messages.length > 0 ? deepClone(this._messages[this._messages.length - 1]) : null;
  }

  _addMessage(message) {
    this._messages.push(message);
  }
}

class AgentMailbox {
  constructor(options = {}) {
    this._inboxes = new Map();
    this._threads = new Map();
    this._sequence = 0;
    this._defaultPriority = normalizePriority(options.defaultPriority, PRIORITY_LEVELS.normal);
  }

  /**
   * Register an agent so they can receive messages.
   */
  registerAgent(agentId) {
    requireString(agentId, 'agentId');

    if (!this._inboxes.has(agentId)) {
      this._inboxes.set(agentId, []);
    }
  }

  /**
   * Return the list of registered agent IDs.
   */
  get agents() {
    return Array.from(this._inboxes.keys());
  }

  /**
   * Send a direct message from one agent to another.
   *
   * @param {string} from
   * @param {string} to
   * @param {object|string} message - Either a message object or a plain string body.
   * @returns {object} The created message record.
   */
  send(from, to, message) {
    requireString(from, 'from');
    requireString(to, 'to');

    this.registerAgent(from);
    this.registerAgent(to);

    const normalized = this._normalizeMessage(from, to, message);
    const record = this._createMessage(normalized);

    this._inboxes.get(to).push(record);

    return deepClone(record);
  }

  /**
   * Broadcast a message to all registered agents except the sender.
   *
   * @param {string} from
   * @param {object|string} message
   * @param {string[]} [exclude] - Additional agent IDs to exclude.
   * @returns {object[]} Array of created message records.
   */
  broadcast(from, message, exclude = []) {
    requireString(from, 'from');

    this.registerAgent(from);

    const excludeSet = new Set([from, ...normalizeList(exclude)]);
    const recipients = Array.from(this._inboxes.keys()).filter((agentId) => !excludeSet.has(agentId));
    const results = [];

    for (const to of recipients) {
      results.push(this.send(from, to, message));
    }

    return results;
  }

  /**
   * Get all messages for an agent (both read and unread), newest first.
   */
  inbox(agentId) {
    requireString(agentId, 'agentId');

    const messages = this._inboxes.get(agentId);
    if (!messages) {
      return [];
    }

    return messages
      .map(deepClone)
      .sort((a, b) => {
        const timeDiff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        if (timeDiff !== 0) {
          return timeDiff;
        }
        // Tiebreak by sequence number (newest = highest id number)
        const aSeq = parseInt(a.id.replace('msg-', ''), 10) || 0;
        const bSeq = parseInt(b.id.replace('msg-', ''), 10) || 0;
        return bSeq - aSeq;
      });
  }

  /**
   * Mark a specific message as read for a given agent.
   * @returns {object|null} The updated message, or null if not found.
   */
  markRead(agentId, messageId) {
    requireString(agentId, 'agentId');
    requireString(messageId, 'messageId');

    const messages = this._inboxes.get(agentId);
    if (!messages) {
      return null;
    }

    const message = messages.find((m) => m.id === messageId);
    if (!message) {
      return null;
    }

    message.read = new Date().toISOString();
    return deepClone(message);
  }

  /**
   * Mark all messages for an agent as read.
   * @returns {number} Number of messages marked read.
   */
  markAllRead(agentId) {
    requireString(agentId, 'agentId');

    const messages = this._inboxes.get(agentId);
    if (!messages) {
      return 0;
    }

    const now = new Date().toISOString();
    let count = 0;

    for (const message of messages) {
      if (!message.read) {
        message.read = now;
        count++;
      }
    }

    return count;
  }

  /**
   * Get the count of unread messages for an agent.
   */
  getUnreadCount(agentId) {
    requireString(agentId, 'agentId');

    const messages = this._inboxes.get(agentId);
    if (!messages) {
      return 0;
    }

    return messages.filter((m) => !m.read).length;
  }

  /**
   * Reply to an existing message, creating or continuing a thread.
   *
   * @param {string} from
   * @param {string} replyToMessageId - The message being replied to.
   * @param {object|string} message
   * @returns {object} The created reply message record.
   */
  reply(from, replyToMessageId, message) {
    requireString(from, 'from');
    requireString(replyToMessageId, 'replyToMessageId');

    const original = this._findMessage(replyToMessageId);
    if (!original) {
      throw new Error(`Unknown message: ${replyToMessageId}`);
    }

    const threadId = original.threadId || original.id;
    const to = original.from;

    this.registerAgent(from);
    this.registerAgent(to);

    const normalized = this._normalizeMessage(from, to, message, { threadId });
    const record = this._createMessage(normalized);

    // Store in thread
    let thread = this._threads.get(threadId);
    if (!thread) {
      thread = new MessageThread(threadId);
      // Always add the original message as the foundation of the thread
      thread._addMessage(original);
      this._threads.set(threadId, thread);
    }
    thread._addMessage(record);

    this._inboxes.get(to).push(record);

    return deepClone(record);
  }

  /**
   * Get the thread for a given thread ID.
   * @returns {MessageThread|null}
   */
  getThread(threadId) {
    requireString(threadId, 'threadId');

    const thread = this._threads.get(threadId);
    return thread || null;
  }

  /**
   * Get all threads.
   * @returns {MessageThread[]}
   */
  getAllThreads() {
    return Array.from(this._threads.values());
  }

  /**
   * Delete a message from an agent's inbox.
   * @returns {boolean} Whether the message was found and removed.
   */
  deleteMessage(agentId, messageId) {
    requireString(agentId, 'agentId');
    requireString(messageId, 'messageId');

    const messages = this._inboxes.get(agentId);
    if (!messages) {
      return false;
    }

    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) {
      return false;
    }

    messages.splice(idx, 1);
    return true;
  }

  /**
   * Get all messages (across all inboxes) matching a filter.
   *
   * @param {object} [filter]
   * @param {string} [filter.from]
   * @param {string} [filter.to]
   * @param {string} [filter.priority] - 'low', 'normal', 'high', 'critical'
   * @param {boolean} [filter.unreadOnly]
   * @param {string} [filter.threadId]
   * @returns {object[]}
   */
  query(filter = {}) {
    const results = [];

    for (const messages of this._inboxes.values()) {
      for (const message of messages) {
        if (filter.from && message.from !== filter.from) {
          continue;
        }
        if (filter.to && message.to !== filter.to) {
          continue;
        }
        if (filter.priority && message.priority !== filter.priority) {
          continue;
        }
        if (filter.unreadOnly && message.read) {
          continue;
        }
        if (filter.threadId && message.threadId !== filter.threadId) {
          continue;
        }
        results.push(deepClone(message));
      }
    }

    return results.sort((a, b) => {
      const timeDiff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }
      const aSeq = parseInt(a.id.replace('msg-', ''), 10) || 0;
      const bSeq = parseInt(b.id.replace('msg-', ''), 10) || 0;
      return bSeq - aSeq;
    });
  }

  /**
   * Clear all inboxes, threads, and reset sequence.
   */
  clear() {
    this._inboxes.clear();
    this._threads.clear();
    this._sequence = 0;
  }

  // ---- Internal ----

  _normalizeMessage(from, to, message, overrides = {}) {
    const base = typeof message === 'string' ? { body: message } : (message && typeof message === 'object' ? message : {});
    const priority = normalizePriority(base.priority, this._defaultPriority);

    return {
      from,
      to,
      subject: String(base.subject || '').trim(),
      body: String(base.body || '').trim(),
      priority,
      threadId: overrides.threadId || base.threadId || null,
      metadata: deepClone(base.metadata || {}),
    };
  }

  _createMessage(normalized) {
    const priorityLabel = Object.keys(PRIORITY_LEVELS).find((k) => PRIORITY_LEVELS[k] === normalized.priority) || 'normal';

    return {
      id: `msg-${++this._sequence}`,
      from: normalized.from,
      to: normalized.to,
      subject: normalized.subject,
      body: normalized.body,
      priority: priorityLabel,
      priorityLevel: normalized.priority,
      timestamp: new Date().toISOString(),
      threadId: normalized.threadId,
      read: null,
      metadata: normalized.metadata,
    };
  }

  _findMessage(messageId) {
    for (const messages of this._inboxes.values()) {
      const found = messages.find((m) => m.id === messageId);
      if (found) {
        return found;
      }
    }
    return null;
  }
}

// ---- Helpers ----

function deepClone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
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

function normalizePriority(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }
  const key = String(value).toLowerCase();
  if (PRIORITY_LEVELS[key] !== undefined) {
    return PRIORITY_LEVELS[key];
  }
  return fallback;
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

module.exports = {
  AgentMailbox,
  MessageThread,
  PRIORITY_LEVELS,
};
