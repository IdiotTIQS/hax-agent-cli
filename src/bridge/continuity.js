"use strict";

const { ContextBridge } = require("./transfer");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a short unique identifier.
 *
 * @returns {string}
 */
function generateContinuityId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `cont_${ts}_${rand}`;
}

/**
 * Deep-clone simple JSON-serialisable values.
 *
 * @param {*} value
 * @returns {*}
 */
function deepClone(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

/**
 * Compute a lightweight diff between two string arrays.
 * Returns { added: string[], removed: string[], unchanged: string[] }.
 *
 * @param {string[]} a
 * @param {string[]} b
 * @returns {{ added: string[], removed: string[], unchanged: string[] }}
 */
function diffStringArrays(a, b) {
  const setA = new Set(Array.isArray(a) ? a : []);
  const setB = new Set(Array.isArray(b) ? b : []);

  const added = [];
  const removed = [];
  const unchanged = [];

  for (const item of setB) {
    if (setA.has(item)) {
      unchanged.push(item);
    } else {
      added.push(item);
    }
  }
  for (const item of setA) {
    if (!setB.has(item)) {
      removed.push(item);
    }
  }

  return { added, removed, unchanged };
}

// ---------------------------------------------------------------------------
// ContinuityManager
// ---------------------------------------------------------------------------

class ContinuityManager {
  /**
   * Manages continuity across sessions so the user can pick up where they
   * left off, even across restarts.
   *
   * @param {object} [options]
   * @param {number} [options.maxCheckpoints=50] — max stored checkpoints
   * @param {number} [options.maxChainLength=100] — max linked sessions
   * @param {boolean} [options.autoCheckpointOnClose=true]
   * @param {boolean} [options.autoCheckpointOnGoal=true]
   * @param {boolean} [options.autoCheckpointOnError=true]
   */
  constructor(options = {}) {
    this.maxCheckpoints =
      Number.isFinite(options.maxCheckpoints) && options.maxCheckpoints > 0
        ? options.maxCheckpoints
        : 50;

    this.maxChainLength =
      Number.isFinite(options.maxChainLength) && options.maxChainLength > 0
        ? options.maxChainLength
        : 100;

    this.autoCheckpointOnClose = options.autoCheckpointOnClose !== false;
    this.autoCheckpointOnGoal = options.autoCheckpointOnGoal !== false;
    this.autoCheckpointOnError = options.autoCheckpointOnError !== false;

    /** @private ContextBridge for context capture/transfer */
    this._bridge = options.bridge || new ContextBridge();

    /** @private Map<string, object> checkpoint storage */
    this._checkpoints = new Map();

    /** @private Array<string> insertion order for FIFO pruning */
    this._order = [];

    /**
     * Continuity chain — an ordered list of session IDs that are logically
     * linked (e.g., the same task carried across multiple sessions).
     *
     * @private Array<{ sessionId: string, linkedAt: number }>
     */
    this._chain = [];
  }

  // -------------------------------------------------------------------------
  // checkpoint(session) — creates a continuity checkpoint
  // -------------------------------------------------------------------------

  /**
   * Create a continuity checkpoint from a session.
   *
   * The checkpoint includes the captured context plus metadata about the
   * session lifecycle state (close status, goal completion, error).
   *
   * @param {object} session — a session object (must have messages, goal, etc.)
   * @param {object} [options]
   * @param {string} [options.reason="manual"] — why the checkpoint was created:
   *        "manual", "close", "goal", "error"
   * @param {string} [options.error] — error message (when reason is "error")
   * @returns {{ id: string, checkpoint: object }} The saved checkpoint.
   */
  checkpoint(session = {}, options = {}) {
    const now = Date.now();
    const reason =
      typeof options.reason === "string" && options.reason.trim()
        ? options.reason.trim()
        : "manual";

    // Capture the session context.
    const context = this._bridge.capture(session);

    // Generate a continuity-specific id.
    const id = generateContinuityId();

    const checkpointObj = {
      id,
      sessionId: context.sessionId,
      createdAt: now,
      reason,
      error: typeof options.error === "string" ? options.error : null,
      goal: context.goal,
      context,
    };

    // Prune if at capacity.
    if (this._checkpoints.size >= this.maxCheckpoints) {
      const oldestId = this._order.shift();
      if (oldestId) this._checkpoints.delete(oldestId);
    }

    this._checkpoints.set(id, checkpointObj);
    this._order.push(id);

    // Link to continuity chain.
    this._linkToChain(context.sessionId);

    return { id, checkpoint: deepClone(checkpointObj) };
  }

  // -------------------------------------------------------------------------
  // autoCheckpoint(session, reason, error?) — convenience wrapper
  // -------------------------------------------------------------------------

  /**
   * Attempt an auto-checkpoint based on configured rules.
   *
   * Does nothing if the corresponding auto flag is disabled.
   *
   * @param {object} session
   * @param {string} reason — "close", "goal", "error"
   * @param {string} [error]
   * @returns {{ id: string, checkpoint: object } | null}
   */
  autoCheckpoint(session = {}, reason, error) {
    const flagMap = {
      close: this.autoCheckpointOnClose,
      goal: this.autoCheckpointOnGoal,
      error: this.autoCheckpointOnError,
    };

    if (!flagMap[reason]) return null;

    return this.checkpoint(session, { reason, error });
  }

  // -------------------------------------------------------------------------
  // resume(sessionId) — prepares context for resuming
  // -------------------------------------------------------------------------

  /**
   * Prepare context so a session can be resumed.
   *
   * Finds the most recent checkpoint matching the given sessionId (or the
   * latest checkpoint overall if sessionId is omitted) and returns a resume
   * package: the captured context plus a compact summary suitable for
   * injecting into a system prompt.
   *
   * @param {string} [sessionId] — optional session ID to resume from
   * @returns {object|null} Resume package, or null if no checkpoint found.
   *   Shape: { checkpoint, summary, context }
   */
  resume(sessionId) {
    let checkpointObj = null;

    if (sessionId) {
      // Walk newest-first for the latest matching this session.
      for (let i = this._order.length - 1; i >= 0; i -= 1) {
        const ckpt = this._checkpoints.get(this._order[i]);
        if (ckpt && ckpt.sessionId === sessionId) {
          checkpointObj = ckpt;
          break;
        }
      }
    }

    // Fall back to the latest checkpoint overall.
    if (!checkpointObj && this._order.length > 0) {
      const latestId = this._order[this._order.length - 1];
      checkpointObj = this._checkpoints.get(latestId) || null;
    }

    if (!checkpointObj) return null;

    const context = deepClone(checkpointObj.context);
    const summary = this._bridge.summarize(context);

    return {
      checkpoint: deepClone(checkpointObj),
      summary,
      context,
    };
  }

  // -------------------------------------------------------------------------
  // getContinuityChain() — history of linked sessions
  // -------------------------------------------------------------------------

  /**
   * Return the full continuity chain — the ordered list of linked session
   * IDs showing the history of the current workflow.
   *
   * @returns {Array<{ sessionId: string, linkedAt: number }>}
   */
  getContinuityChain() {
    return [...this._chain];
  }

  // -------------------------------------------------------------------------
  // compare(checkpointA, checkpointB) — diff between checkpoints
  // -------------------------------------------------------------------------

  /**
   * Compare two checkpoints and return what changed.
   *
   * @param {string|object} checkpointA — id or checkpoint object
   * @param {string|object} checkpointB — id or checkpoint object
   * @returns {object|null} Diff object, or null if either checkpoint is missing.
   *   Shape: {
   *     a: { id, timestamp },
   *     b: { id, timestamp },
   *     goalChanged: boolean,
   *     decisions: { added, removed, unchanged },
   *     tasks: { added, removed, unchanged },
   *     questions: { added, removed, unchanged },
   *     files: { added, removed, unchanged },
   *     messageCountDelta: number,
   *   }
   */
  compare(checkpointA, checkpointB) {
    const ckptA = this._resolveCheckpoint(checkpointA);
    const ckptB = this._resolveCheckpoint(checkpointB);

    if (!ckptA || !ckptB) return null;

    const ctxA = ckptA.context || {};
    const ctxB = ckptB.context || {};

    const goalA = String(ctxA.goal || "");
    const goalB = String(ctxB.goal || "");

    const decisionsDiff = diffStringArrays(ctxA.decisions || [], ctxB.decisions || []);
    const tasksDiff = diffStringArrays(ctxA.tasks || [], ctxB.tasks || []);
    const questionsDiff = diffStringArrays(ctxA.questions || [], ctxB.questions || []);
    const filesDiff = diffStringArrays(ctxA.modifiedFiles || [], ctxB.modifiedFiles || []);

    const msgCountA = ctxA.digest?.messageCount || 0;
    const msgCountB = ctxB.digest?.messageCount || 0;

    return {
      a: { id: ckptA.id, timestamp: ckptA.createdAt },
      b: { id: ckptB.id, timestamp: ckptB.createdAt },
      goalChanged: goalA !== goalB,
      goalA: goalA || null,
      goalB: goalB || null,
      decisions: decisionsDiff,
      tasks: tasksDiff,
      questions: questionsDiff,
      files: filesDiff,
      messageCountDelta: msgCountB - msgCountA,
    };
  }

  // -------------------------------------------------------------------------
  // listCheckpoints()
  // -------------------------------------------------------------------------

  /**
   * List all stored checkpoints.
   *
   * @param {object} [options]
   * @param {number} [options.limit] — max entries
   * @param {boolean} [options.metadataOnly=false] — return only id/timestamp/reason
   * @returns {Array<object>} Checkpoints newest-first.
   */
  listCheckpoints(options = {}) {
    const metadataOnly = options.metadataOnly === true;
    const limit =
      Number.isFinite(options.limit) && options.limit > 0
        ? options.limit
        : Infinity;

    const entries = [];
    for (let i = this._order.length - 1; i >= 0 && entries.length < limit; i -= 1) {
      const ckpt = this._checkpoints.get(this._order[i]);
      if (!ckpt) continue;

      if (metadataOnly) {
        entries.push({
          id: ckpt.id,
          sessionId: ckpt.sessionId,
          createdAt: ckpt.createdAt,
          reason: ckpt.reason,
          goal: ckpt.goal,
        });
      } else {
        entries.push(deepClone(ckpt));
      }
    }
    return entries;
  }

  // -------------------------------------------------------------------------
  // getCheckpoint(id)
  // -------------------------------------------------------------------------

  /**
   * Retrieve a single checkpoint by id.
   *
   * @param {string} id
   * @returns {object|null}
   */
  getCheckpoint(id) {
    const key = String(id || "").trim();
    if (!key) return null;
    const ckpt = this._checkpoints.get(key);
    return ckpt ? deepClone(ckpt) : null;
  }

  // -------------------------------------------------------------------------
  // deleteCheckpoint(id)
  // -------------------------------------------------------------------------

  /**
   * Remove a checkpoint.
   *
   * @param {string} id
   * @returns {boolean}
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

  // -------------------------------------------------------------------------
  // count()
  // -------------------------------------------------------------------------

  /**
   * Return the number of stored checkpoints.
   *
   * @returns {number}
   */
  count() {
    return this._checkpoints.size;
  }

  // -------------------------------------------------------------------------
  // clear()
  // -------------------------------------------------------------------------

  /**
   * Remove all checkpoints and reset the chain.
   */
  clear() {
    this._checkpoints.clear();
    this._order = [];
    this._chain = [];
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Resolve a checkpoint argument to its canonical checkpoint object.
   *
   * @param {string|object} arg
   * @returns {object|null}
   * @private
   */
  _resolveCheckpoint(arg) {
    if (!arg) return null;

    // If given an id string, look it up.
    if (typeof arg === "string") {
      return this._checkpoints.get(arg) || null;
    }

    // If given a checkpoint-like object, use its id to look it up (ensures
    // we get the canonical stored version).
    if (typeof arg.id === "string") {
      return this._checkpoints.get(arg.id) || null;
    }

    return null;
  }

  /**
   * Add a session to the continuity chain.
   *
   * @param {string} sessionId
   * @private
   */
  _linkToChain(sessionId) {
    if (!sessionId) return;

    // Don't add duplicates in sequence.
    if (
      this._chain.length > 0 &&
      this._chain[this._chain.length - 1].sessionId === sessionId
    ) {
      return;
    }

    this._chain.push({ sessionId, linkedAt: Date.now() });

    // Prune if over the max chain length.
    while (this._chain.length > this.maxChainLength) {
      this._chain.shift();
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ContinuityManager,
  generateContinuityId,
  deepClone,
  diffStringArrays,
};
