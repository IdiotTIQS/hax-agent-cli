"use strict";

/**
 * Knowledge & memory management bridge.
 *
 * Wires KnowledgeAccumulator, KnowledgeCurator, MemoryOptimizer, and
 * MemoryArchiver into the session lifecycle.  Called once per session
 * from cli.js after the session object is fully constructed.
 *
 * Responsibilities:
 *   - Session start:  recall cross-session knowledge for context
 *   - Session end:    extract knowledge from completed conversation,
 *                     accumulate into the knowledge base, deduplicate
 *                     and prune periodically
 *   - Session end:    analyse the filesystem memory store, archive
 *                     stale / low-value memories
 */

// ---------------------------------------------------------------------------
// Module-level singletons (lazy-initialized on first call)
// ---------------------------------------------------------------------------

let _accumulator = null;
let _curator = null;
let _optimizer = null;
let _archiver = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wire knowledge accumulation, cross-session recall, and periodic memory
 * optimisation into the session lifecycle.
 *
 * @param {object} session  The CLI session object — must have at least
 *   { id, messages, eventBus, settings }.
 * @returns {{ accumulator: object|null, curator: object|null,
 *             optimizer: object|null, archiver: object|null }}
 */
function setupKnowledgeManagement(session) {
  if (!session || !session.id) return _emptyResult();

  // --- Lazy-init singletons ------------------------------------------------

  if (!_accumulator) {
    try {
      const { KnowledgeAccumulator } = require("../knowledge/accumulator");
      _accumulator = new KnowledgeAccumulator({ maxItems: 10000 });
      const { KnowledgeCurator } = require("../knowledge/curator");
      _curator = new KnowledgeCurator(_accumulator);
    } catch (_) {
      /* knowledge subsystem not available */
    }
  }

  if (!_optimizer) {
    try {
      const { MemoryOptimizer } = require("../memory/optimizer");
      _optimizer = new MemoryOptimizer();
      const { MemoryArchiver } = require("../memory/archiver");
      _archiver = new MemoryArchiver();
    } catch (_) {
      /* memory optimisation not available */
    }
  }

  // --- Session start: recall relevant cross-session knowledge ---------------

  _recallRelevantKnowledge(session);

  // --- Register session:end handler via EventBus ----------------------------

  if (session.eventBus && typeof session.eventBus.on === "function") {
    session.eventBus.on("session:end", () => {
      _extractAndAccumulateKnowledge(session);
      _optimizeMemoryStore(session);
    });
  }

  return {
    accumulator: _accumulator,
    curator: _curator,
    optimizer: _optimizer,
    archiver: _archiver,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a short context string from the last few user messages and use it
 * to query the knowledge base for relevant past knowledge.
 *
 * Results are stored on `session._recalledKnowledge` for optional use by
 * the agent / prompt builder.
 */
function _recallRelevantKnowledge(session) {
  if (!_accumulator || _accumulator.size === 0) return;

  try {
    const context = _buildContextText(session);
    if (!context) return;

    const relevant = _accumulator.recall(context, {
      limit: 10,
      confidenceMin: 0.4,
    });

    if (relevant.length > 0) {
      session._recalledKnowledge = relevant;
    }
  } catch (_) {
    /* best-effort */
  }
}

/**
 * Join the last few user messages into a single search string.
 */
function _buildContextText(session) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const userMessages = messages.filter(function (m) {
    return m.role === "user";
  });
  if (userMessages.length === 0) return "";

  return userMessages
    .slice(-5)
    .map(function (m) { return m.content || ""; })
    .join(" ");
}

/**
 * Extract knowledge items from the completed session and add them to the
 * persistent knowledge base.  Runs a lightweight dedup + prune cycle every
 * 50 items to keep the store healthy without blocking shutdown.
 */
function _extractAndAccumulateKnowledge(session) {
  if (!_accumulator) return;

  try {
    const entries = _buildExtractionEntries(session);
    if (entries.length === 0) return;

    const items = _accumulator.learn({
      id: session.id,
      entries: entries,
    });

    if (items.length > 0) {
      _accumulator.accumulate(items);
    }

    // Periodic maintenance (best-effort, synchronous — runs inline at exit)
    if (_curator && _accumulator.size > 0 && _accumulator.size % 50 === 0) {
      _curator.deduplicate();
      _curator.prune({ maxAgeDays: 90, minConfidence: 0.1 });
    }
  } catch (_) {
    /* best-effort — never let extraction errors block session exit */
  }
}

/**
 * Map session messages to the { content, timestamp } shape that the
 * KnowledgeAccumulator expects for its entry objects.
 */
function _buildExtractionEntries(session) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const entries = [];

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var role = msg.role || "";
    if (role !== "user" && role !== "assistant") continue;
    var content = msg.content;
    if (typeof content !== "string" || !content.trim()) continue;

    entries.push({
      content: content,
      role: role,
      timestamp: msg.timestamp || null,
    });
  }

  return entries;
}

/**
 * Analyse the filesystem memory store and archive stale or redundant
 * memories when efficiency drops below 70 %.
 */
function _optimizeMemoryStore(session) {
  if (!_optimizer || !_archiver) return;

  try {
    /* Dynamic require avoids circular init issues at module load time */
    var memoryModule = require("../memory");
    if (typeof memoryModule.listMemories !== "function") return;

    var memories = memoryModule.listMemories(session.settings);
    if (!Array.isArray(memories) || memories.length === 0) return;

    var analysis = _optimizer.analyze(memories);

    /* Only take action when the store is notably unhealthy */
    if (analysis.efficiencyScore >= 70 && analysis.totalMemories < 50) return;

    /* Archive old / low-importance memories rather than deleting them */
    var archiveCandidates = [];
    for (var i = 0; i < memories.length; i++) {
      var m = memories[i];
      if (_isArchiveCandidate(m)) {
        archiveCandidates.push(m);
      }
    }

    if (archiveCandidates.length > 0) {
      _archiver.archive(archiveCandidates);
    }

    /* Prune old archives (keep max 50, remove archives older than 90 days) */
    _archiver.pruneArchives();
  } catch (_) {
    /* best-effort */
  }
}

/**
 * Determine whether a memory record is a candidate for archival.
 * Archives memories older than 30 days or those tagged as transient.
 */
function _isArchiveCandidate(memory) {
  if (!memory) return false;

  var now = Date.now();
  var updatedAt = memory.updatedAt || memory.createdAt;
  if (updatedAt) {
    var ageMs = now - new Date(updatedAt).getTime();
    var ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > 30) return true;
  }

  var tags = Array.isArray(memory.tags) ? memory.tags : [];
  for (var i = 0; i < tags.length; i++) {
    var t = String(tags[i]).toLowerCase();
    if (t === "transient" || t === "low-priority" || t === "archive") {
      return true;
    }
  }

  return false;
}

function _emptyResult() {
  return { accumulator: null, curator: null, optimizer: null, archiver: null };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { setupKnowledgeManagement };
