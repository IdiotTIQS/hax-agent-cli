"use strict";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a short unique identifier.  Combines a timestamp with random hex
 * so the chance of collision within a single process is negligible.
 *
 * @returns {string}
 */
function generateId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `ckpt_${ts}_${rand}`;
}

/**
 * Deep-clone simple JSON-serialisable values (messages, state objects, etc.).
 *
 * @param {*} value
 * @returns {*}
 */
function deepClone(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

/**
 * Build a lightweight message summary (first sentence per role, truncated).
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {string}
 */
function buildMessageSummary(messages) {
  const msgs = Array.isArray(messages) ? messages : [];
  if (msgs.length === 0) return "(empty)";

  const lines = [];
  const seen = new Set(["system"]);

  for (const msg of msgs) {
    const role = msg?.role || "unknown";
    const content = String(msg?.content || "");
    const firstSentence = content.split(/[.!?]\s+/)[0].trim();
    const snippet = firstSentence.length > 120
      ? firstSentence.slice(0, 117) + "..."
      : firstSentence;

    if (role === "system" && !seen.has(role)) {
      lines.push(`System: ${snippet}`);
      seen.add(role);
    } else if (role !== "system") {
      lines.push(`${role}: ${snippet}`);
    }
  }

  // Limit summary to 10 lines to keep checkpoint metadata lean.
  const capped = lines.slice(0, 10);
  if (lines.length > 10) capped.push(`...and ${lines.length - 10} more messages.`);
  return capped.join(" | ");
}

// ---------------------------------------------------------------------------
// ContextRestorer
// ---------------------------------------------------------------------------

class ContextRestorer {
  /**
   * @param {object} [options]
   * @param {number} [options.maxCheckpoints=50] — cap on stored checkpoints
   * @param {boolean} [options.autoPrune=true] — auto-delete oldest when cap hit
   */
  constructor(options = {}) {
    this.maxCheckpoints =
      Number.isFinite(options.maxCheckpoints) && options.maxCheckpoints > 0
        ? options.maxCheckpoints
        : 50;

    this.autoPrune = options.autoPrune !== false;

    /** @private Map<string, object> */
    this._checkpoints = new Map();

    /** @private Array<string> — insertion order for FIFO pruning */
    this._order = [];
  }

  // -----------------------------------------------------------------------
  // saveCheckpoint(context)
  // -----------------------------------------------------------------------

  /**
   * Save a context checkpoint.
   *
   * @param {object} context
   * @param {string} [context.id] — optional pre-assigned id
   * @param {Array<{role: string, content: string}>} [context.messages]
   * @param {string} [context.goal]
   * @param {object} [context.state]
   * @param {string} [context.summary]
   * @param {object} [context.meta] — arbitrary extra metadata
   * @returns {{ id: string, checkpoint: object }} The saved checkpoint.
   */
  saveCheckpoint(context = {}) {
    const now = Date.now();
    const id = typeof context.id === "string" && context.id.trim()
      ? context.id.trim()
      : generateId();

    const messages = deepClone(context.messages || []);
    const summary = typeof context.summary === "string"
      ? context.summary
      : buildMessageSummary(messages);

    const checkpoint = {
      id,
      timestamp: now,
      messages,
      goal: String(context.goal || ""),
      state: deepClone(context.state || {}),
      summary,
      meta: deepClone(context.meta || {}),
    };

    // Prune if we have hit the cap.
    if (this.autoPrune && this._checkpoints.size >= this.maxCheckpoints) {
      const oldestId = this._order.shift();
      if (oldestId) this._checkpoints.delete(oldestId);
    }

    // Remove existing entry with the same id (overwrite semantics).
    const existingIdx = this._order.indexOf(id);
    if (existingIdx >= 0) {
      this._order.splice(existingIdx, 1);
    }

    this._checkpoints.set(id, checkpoint);
    this._order.push(id);

    return { id, checkpoint: deepClone(checkpoint) };
  }

  // -----------------------------------------------------------------------
  // restoreCheckpoint(id)
  // -----------------------------------------------------------------------

  /**
   * Restore a previously saved checkpoint.
   *
   * @param {string} id
   * @returns {object|null} The checkpoint object, or null if not found.
   */
  restoreCheckpoint(id) {
    const key = String(id || "").trim();
    if (!key) return null;

    const checkpoint = this._checkpoints.get(key);
    return checkpoint ? deepClone(checkpoint) : null;
  }

  // -----------------------------------------------------------------------
  // listCheckpoints()
  // -----------------------------------------------------------------------

  /**
   * List all available checkpoints.
   *
   * @param {object} [options]
   * @param {number} [options.limit] — max entries to return
   * @param {boolean} [options.metadataOnly=false] — return only id/timestamp
   * @returns {Array<object>} Checkpoints sorted newest-first.
   */
  listCheckpoints(options = {}) {
    const metadataOnly = options.metadataOnly === true;
    const limit = Number.isFinite(options.limit) && options.limit > 0
      ? options.limit
      : Infinity;

    const entries = [];

    // Walk insertion order backwards (newest first).
    for (let i = this._order.length - 1; i >= 0 && entries.length < limit; i -= 1) {
      const id = this._order[i];
      const cp = this._checkpoints.get(id);
      if (!cp) continue;

      if (metadataOnly) {
        entries.push({
          id: cp.id,
          timestamp: cp.timestamp,
          goal: cp.goal,
          summary: cp.summary,
        });
      } else {
        entries.push(deepClone(cp));
      }
    }

    return entries;
  }

  // -----------------------------------------------------------------------
  // deleteCheckpoint(id)
  // -----------------------------------------------------------------------

  /**
   * Remove a checkpoint.
   *
   * @param {string} id
   * @returns {boolean} True if a checkpoint was deleted.
   */
  deleteCheckpoint(id) {
    const key = String(id || "").trim();
    if (!key) return false;

    const removed = this._checkpoints.delete(key);
    if (removed) {
      const idx = this._order.indexOf(key);
      if (idx >= 0) this._order.splice(idx, 1);
    }
    return removed;
  }

  // -----------------------------------------------------------------------
  // createAutoCheckpoint(session)
  // -----------------------------------------------------------------------

  /**
   * Automatically create a checkpoint at a decision point in a session.
   *
   * Decision points are identified when:
   *   - A user message follows 2+ assistant messages (multiple reasoning steps)
   *   - The latest assistant message contains decision language
   *   - The user explicitly asks to proceed or confirm
   *
   * @param {object} session
   * @param {Array<{role: string, content: string}>} session.messages
   * @param {string} [session.goal]
   * @param {object} [session.state]
   * @param {object} [options]
   * @param {boolean} [options.force=false] — always create, skip decision detection
   * @returns {{ id: string, checkpoint: object } | null} The checkpoint or null
   *   if no decision point was detected.
   */
  createAutoCheckpoint(session = {}, options = {}) {
    const messages = Array.isArray(session.messages) ? session.messages : [];
    if (messages.length === 0) return null;

    const force = options.force === true;

    if (!force && !this._isDecisionPoint(messages)) {
      return null;
    }

    return this.saveCheckpoint({
      messages,
      goal: String(session.goal || ""),
      state: session.state || {},
      summary: `Auto-checkpoint at ${new Date().toISOString()}`,
      meta: {
        autoGenerated: true,
        messageCount: messages.length,
        forced: force,
      },
    });
  }

  // -----------------------------------------------------------------------
  // count()
  // -----------------------------------------------------------------------

  /**
   * Return the number of stored checkpoints.
   *
   * @returns {number}
   */
  count() {
    return this._checkpoints.size;
  }

  // -----------------------------------------------------------------------
  // clear()
  // -----------------------------------------------------------------------

  /**
   * Remove all checkpoints.
   */
  clear() {
    this._checkpoints.clear();
    this._order = [];
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Detect whether the current conversation state represents a decision point.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @returns {boolean}
   * @private
   */
  _isDecisionPoint(messages) {
    if (messages.length < 3) return false;

    const last = messages[messages.length - 1];
    const secondLast = messages[messages.length - 2];
    const thirdLast = messages[messages.length - 3];

    // Pattern: user -> assistant -> assistant -> (current user message)
    // In a typical decision point: assistant replies with a plan or decision,
    // user confirms or gives follow-up.

    const lastIsUser = last.role === "user";
    const lastIsAssistant = last.role === "assistant";

    // Case 1: latest is a user message following at least one assistant message
    // that contains decision language.
    if (lastIsUser && secondLast.role === "assistant") {
      const secondLastContent = String(secondLast.content || "").toLowerCase();
      const decisionPatterns = [
        /\bdecided?\b/, /\bchose\b/, /\bselected?\b/, /\bplan\b/,
        /\bapproach\b/, /\bstrategy\b/, /\bimplement\b/, /\bgo(?:ing)? with\b/,
        /\bconclusion\b/, /\bconfirmed\b/, /\bfinal\b.*\b(?:plan|decision)\b/,
      ];
      if (decisionPatterns.some((p) => p.test(secondLastContent))) {
        return true;
      }

      // Also trigger if the user confirms.
      const lastContent = String(last.content || "").toLowerCase();
      const confirmPatterns = [
        /\bok\b/, /\bgo ahead\b/, /\byes\b/, /\bproceed\b/,
        /\bsounds good\b/, /\bthat works\b/, /\bdo it\b/,
      ];
      if (confirmPatterns.some((p) => p.test(lastContent)) && messages.length >= 4) {
        return true;
      }
    }

    // Case 2: latest is an assistant message with decision language, preceded
    // by a user message that asked for a decision.
    if (lastIsAssistant && secondLast.role === "user") {
      const lastContent = String(last.content || "").toLowerCase();
      const decisionPatterns = [
        /\bdecided?\b/, /\bplan\b/, /\bapproach\b/, /\bstrategy\b/,
        /\bimplement\b.*\bwill\b/, /\bchose\b/, /\bfinal\b/,
      ];
      if (decisionPatterns.some((p) => p.test(lastContent))) {
        return true;
      }

      // Also recognize multi-step reasoning chains.
      if (
        thirdLast.role === "assistant" &&
        lastContent.length > 200
      ) {
        return true;
      }
    }

    return false;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ContextRestorer,
  generateId,
  buildMessageSummary,
};
