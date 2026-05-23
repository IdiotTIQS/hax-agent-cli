"use strict";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a short unique identifier.
 *
 * @returns {string}
 */
function generateId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `bridge_${ts}_${rand}`;
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
 * Determine whether a string looks like a decision the agent made.
 *
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeDecision(text) {
  const lower = String(text || "").toLowerCase();
  const patterns = [
    /\bdecided?\b/, /\bcho(?:se|ose)\b/, /\bselected?\b/, /\bplan\b/,
    /\bapproach\b/, /\bstrategy\b/, /\bimplement\b/,
    /\bconclusion\b/, /\bconfirmed\b/, /\bgo(?:ing)? with\b/,
    /\bfinal\b.*\b(?:plan|decision)\b/,
  ];
  return patterns.some((p) => p.test(lower));
}

/**
 * Determine whether a string looks like an open question.
 *
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeQuestion(text) {
  const lower = String(text || "").toLowerCase();
  if (/\?$/.test(lower.trim())) return true;
  const questionPatterns = [
    /\b(?:should|would|could|might|maybe|perhaps)\b/,
    /\b(?:unknown|unclear|not sure|not certain)\b/,
    /\b(?:how to|what about|what if|is it|are there|do we)\b/,
    /\b(?:pending|to determine|to decide|to confirm)\b/,
    /\b(?:left to|remain(?:ing|s) to|still need(?:s)? to)\b/,
  ];
  return questionPatterns.some((p) => p.test(lower));
}

/**
 * Determine whether content references a task.
 *
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeTask(text) {
  const lower = String(text || "").toLowerCase();
  const taskPatterns = [
    /\b(?:todo|to-do|task|action item|next step)\b/,
    /\bneed(?:s)? to\b/, /\bshould\b/,
    /\bmust\b/, /\bwill\b/,
    /\b(?:working on|currently|in progress)\b/,
  ];
  return taskPatterns.some((p) => p.test(lower));
}

/**
 * Extract potential file paths from message content.
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractFilePaths(text) {
  const content = String(text || "");
  const matches = content.match(/(?:[a-zA-Z]:[\\/]|\/|\.\/|\.\.\/|[\w\-.]+[\\/])[\w\-./\\]+\.\w{1,10}/g) || [];
  return [...new Set(matches)].slice(0, 50);
}

/**
 * Resolve the effective file set from a session — uses modifiedFiles Set if
 * available, otherwise falls back to scanning messages for paths.
 *
 * @param {object} session
 * @returns {string[]}
 */
function resolveModifiedFiles(session) {
  if (
    session.modifiedFiles instanceof Set &&
    session.modifiedFiles.size > 0
  ) {
    return [...session.modifiedFiles];
  }

  const messages = Array.isArray(session.messages) ? session.messages : [];
  const paths = new Set();
  for (const msg of messages) {
    for (const filePath of extractFilePaths(String(msg.content || ""))) {
      paths.add(filePath);
    }
    if (paths.size >= 50) break;
  }
  return [...paths];
}

/**
 * Resolve the agent state snapshot from a session object.
 *
 * Possible locations: session.state, session.contextStats, inline flags.
 *
 * @param {object} session
 * @returns {object}
 */
function resolveAgentState(session) {
  const state = {};

  if (session.state && typeof session.state === "object") {
    Object.assign(state, deepClone(session.state));
  }

  if (session.contextStats && typeof session.contextStats === "object") {
    state.contextStats = deepClone(session.contextStats);
  }

  // Boolean flags carried on the session itself.
  for (const flag of [
    "shouldExit",
    "isStreaming",
    "pendingExit",
    "responseInterrupted",
  ]) {
    if (typeof session[flag] === "boolean") {
      state[flag] = session[flag];
    }
  }

  return state;
}

// ---------------------------------------------------------------------------
// ContextBridge
// ---------------------------------------------------------------------------

class ContextBridge {
  /**
   * Bridge for transferring context between sessions.
   *
   * @param {object} [options]
   * @param {number} [options.maxSummaries=50] — cap on stored summaries
   * @param {number} [options.maxDecisions=200] — cap on extracted decisions
   * @param {number} [options.maxTasks=100] — cap on extracted tasks
   * @param {number} [options.maxQuestions=50] — cap on extracted questions
   */
  constructor(options = {}) {
    this.maxSummaries =
      Number.isFinite(options.maxSummaries) && options.maxSummaries > 0
        ? options.maxSummaries
        : 50;

    this.maxDecisions =
      Number.isFinite(options.maxDecisions) && options.maxDecisions > 0
        ? options.maxDecisions
        : 200;

    this.maxTasks =
      Number.isFinite(options.maxTasks) && options.maxTasks > 0
        ? options.maxTasks
        : 100;

    this.maxQuestions =
      Number.isFinite(options.maxQuestions) && options.maxQuestions > 0
        ? options.maxQuestions
        : 50;

    /** @private Map<string, object> summaries indexed by captured id */
    this._summaries = new Map();

    /** @private Array<string> insertion order for FIFO pruning */
    this._summaryOrder = [];
  }

  // -------------------------------------------------------------------------
  // capture(session) — captures essential context from a session
  // -------------------------------------------------------------------------

  /**
   * Capture the essential context from a session for transfer.
   *
   * Extracts: key decisions, active tasks, open questions, modified files,
   * agent state, metadata, and a conversation digest.
   *
   * @param {object} session
   * @param {Array<{role: string, content: string}>} [session.messages]
   * @param {string} [session.goal]
   * @param {string} [session.id]
   * @param {Set<string>} [session.modifiedFiles]
   * @param {object} [session.settings]
   * @param {object} [options]
   * @param {boolean} [options.enableSummaries=false] — store summary in bridge
   * @returns {object} Captured context object.
   */
  capture(session = {}, options = {}) {
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const now = Date.now();

    // --- key decisions ---
    const decisions = [];
    for (const msg of messages) {
      if (msg.role === "assistant" && looksLikeDecision(String(msg.content || ""))) {
        const text = String(msg.content);
        const snippet =
          text.length > 240
            ? text.slice(0, 237) + "..."
            : text;
        decisions.push(snippet);
        if (decisions.length >= this.maxDecisions) break;
      }
    }

    // --- active tasks ---
    const tasks = [];
    for (const msg of messages) {
      if (looksLikeTask(String(msg.content || ""))) {
        const text = String(msg.content);
        const snippet =
          text.length > 200
            ? text.slice(0, 197) + "..."
            : text;
        tasks.push(snippet);
        if (tasks.length >= this.maxTasks) break;
      }
    }

    // --- open questions ---
    const questions = [];
    for (const msg of messages) {
      if (looksLikeQuestion(String(msg.content || ""))) {
        const text = String(msg.content);
        const snippet =
          text.length > 200
            ? text.slice(0, 197) + "..."
            : text;
        questions.push(snippet);
        if (questions.length >= this.maxQuestions) break;
      }
    }

    // --- modified files ---
    const modifiedFiles = resolveModifiedFiles(session);

    // --- agent state ---
    const agentState = resolveAgentState(session);

    // --- conversation digest (last 3 exchanges) ---
    const digestMessages = [];
    for (let i = Math.max(0, messages.length - 6); i < messages.length; i += 1) {
      const msg = messages[i];
      const content =
        String(msg.content || "").length > 200
          ? String(msg.content).slice(0, 197) + "..."
          : String(msg.content);
      digestMessages.push({ role: msg.role, content });
    }

    const context = {
      sessionId: String(session.id || generateId()),
      goal: String(session.goal || ""),
      capturedAt: now,
      decisions,
      tasks,
      questions,
      modifiedFiles,
      agentState,
      digest: {
        messageCount: messages.length,
        lastMessages: digestMessages,
      },
      meta: {
        provider: session.provider?.name || "",
        model: session.provider?.model || session.agent?.model || "",
        turnCount: session.costTracker?.turnCount || 0,
        elapsedMs: now - (session.startTime || now),
      },
    };

    // Optionally store a summary in the bridge.
    if (options.enableSummaries) {
      this._storeSummary(context);
    }

    return deepClone(context);
  }

  // -------------------------------------------------------------------------
  // transfer(source, target) — transfers context from one session to another
  // -------------------------------------------------------------------------

  /**
   * Transfer context from a source session into a target session.
   *
   * The target session receives the source's decisions, tasks, questions, and
   * file awareness.  A system-context message is prepended so the agent in the
   * new session understands what was happening.
   *
   * @param {object} source — a raw session object or a previously captured context
   * @param {object} target — the destination session object (mutated in place)
   * @param {object} [options]
   * @param {boolean} [options.preserveGoal=false] — keep target's existing goal
   * @param {boolean} [options.injectSystemMessage=true] — prepend context message
   * @returns {object} The target session (same reference).
   */
  transfer(source, target = {}, options = {}) {
    // Resolve source: if it looks like a session object (has .messages), capture
    // it; otherwise assume it is already a captured context.
    let context;
    // Detect source type: a captured context has decisions/tasks/questions;
    // a raw session has messages.
    const isCapturedContext =
      Array.isArray(source.decisions) ||
      Array.isArray(source.tasks) ||
      Array.isArray(source.questions);
    const isRawSession = Array.isArray(source.messages) && source.messages.length > 0;

    if (isCapturedContext) {
      context = deepClone(source);
    } else if (isRawSession || source.goal !== undefined) {
      context = this.capture(source);
    } else {
      context = deepClone(source);
    }

    const opts = {
      preserveGoal: options.preserveGoal === true,
      injectSystemMessage: options.injectSystemMessage !== false,
    };

    // --- merge goal ---
    if (!opts.preserveGoal || !target.goal) {
      if (context.goal) {
        if (target.goal && target.goal !== context.goal) {
          target.goal = `${context.goal} (continued: ${target.goal})`;
        } else {
          target.goal = context.goal;
        }
      }
    }

    // --- merge modified files ---
    if (context.modifiedFiles.length > 0) {
      if (!(target.modifiedFiles instanceof Set)) {
        target.modifiedFiles = new Set();
      }
      for (const filePath of context.modifiedFiles) {
        target.modifiedFiles.add(filePath);
      }
    }

    // --- merge agent state ---
    if (context.agentState && Object.keys(context.agentState).length > 0) {
      if (!target.state || typeof target.state !== "object") {
        target.state = {};
      }
      for (const [key, value] of Object.entries(context.agentState)) {
        if (!(key in target.state)) {
          target.state[key] = value;
        }
      }
    }

    // --- store transfer metadata on target ---
    if (!target.transferredContext) {
      target.transferredContext = [];
    }
    target.transferredContext.push({
      fromSession: context.sessionId,
      at: Date.now(),
      decisions: context.decisions.length,
      tasks: context.tasks.length,
      questions: context.questions.length,
    });

    // --- inject system message ---
    if (
      opts.injectSystemMessage &&
      Array.isArray(target.messages)
    ) {
      const systemContent = this._buildTransferMessage(context);
      target.messages.unshift({
        role: "system",
        content: systemContent,
      });
    }

    return target;
  }

  // -------------------------------------------------------------------------
  // merge(contexts) — merges multiple session contexts
  // -------------------------------------------------------------------------

  /**
   * Merge multiple captured contexts into a single unified view.
   *
   * Useful when several sessions worked on the same problem or when you want
   * a combined overview of a multi-session effort.
   *
   * @param {Array<object>} contexts — array of captured context objects
   * @param {object} [options]
   * @param {boolean} [options.deduplicate=true] — remove duplicate entries
   * @param {number} [options.maxDecisions=200] — cap on merged decisions
   * @param {number} [options.maxTasks=100] — cap on merged tasks
   * @param {number} [options.maxQuestions=50] — cap on merged questions
   * @returns {object} Merged context object.
   */
  merge(contexts = [], options = {}) {
    const opts = {
      deduplicate: options.deduplicate !== false,
      maxDecisions:
        Number.isFinite(options.maxDecisions) && options.maxDecisions > 0
          ? options.maxDecisions
          : this.maxDecisions,
      maxTasks:
        Number.isFinite(options.maxTasks) && options.maxTasks > 0
          ? options.maxTasks
          : this.maxTasks,
      maxQuestions:
        Number.isFinite(options.maxQuestions) && options.maxQuestions > 0
          ? options.maxQuestions
          : this.maxQuestions,
    };

    const arr = Array.isArray(contexts) ? contexts : [];
    const now = Date.now();

    const decisions = [];
    const tasks = [];
    const questions = [];
    const fileSet = new Set();
    const sessionIds = [];
    const goals = [];
    const allAgentStates = [];
    let totalMessageCount = 0;
    let totalTurns = 0;

    for (const ctx of arr) {
      if (!ctx) continue;

      if (ctx.sessionId) sessionIds.push(ctx.sessionId);
      if (ctx.goal) goals.push(ctx.goal);
      if (ctx.digest?.messageCount) totalMessageCount += ctx.digest.messageCount;
      if (ctx.meta?.turnCount) totalTurns += ctx.meta.turnCount;

      for (const d of Array.isArray(ctx.decisions) ? ctx.decisions : []) {
        if (decisions.length < opts.maxDecisions) decisions.push(d);
      }
      for (const t of Array.isArray(ctx.tasks) ? ctx.tasks : []) {
        if (tasks.length < opts.maxTasks) tasks.push(t);
      }
      for (const q of Array.isArray(ctx.questions) ? ctx.questions : []) {
        if (questions.length < opts.maxQuestions) questions.push(q);
      }
      for (const filePath of Array.isArray(ctx.modifiedFiles) ? ctx.modifiedFiles : []) {
        fileSet.add(filePath);
      }
      if (ctx.agentState) allAgentStates.push(ctx.agentState);
    }

    // Deduplicate if requested.
    const uniqueDecisions = opts.deduplicate
      ? [...new Set(decisions)]
      : decisions;
    const uniqueTasks = opts.deduplicate
      ? [...new Set(tasks)]
      : tasks;
    const uniqueQuestions = opts.deduplicate
      ? [...new Set(questions)]
      : questions;

    // Re-prioritise tasks by putting those appearing in uniqueQuestions
    // AFTER those that don't — questions stay last.
    const questionSet = new Set(uniqueQuestions.map((s) => s.toLowerCase()));
    const taskPriority = [];
    const taskDeferred = [];
    for (const task of uniqueTasks) {
      if (questionSet.has(task.toLowerCase())) {
        taskDeferred.push(task);
      } else {
        taskPriority.push(task);
      }
    }
    const reorderedTasks = [...taskPriority, ...taskDeferred].slice(0, opts.maxTasks);

    // Merge agent states — later states override earlier ones on key conflict.
    const mergedAgentState = {};
    for (const state of allAgentStates) {
      Object.assign(mergedAgentState, state);
    }

    const merged = {
      sessionIds,
      goals: [...new Set(goals)],
      mergedAt: now,
      sourceCount: arr.length,
      decisions: uniqueDecisions.slice(0, opts.maxDecisions),
      tasks: reorderedTasks,
      questions: uniqueQuestions.slice(0, opts.maxQuestions),
      modifiedFiles: [...fileSet].slice(0, 100),
      agentState: mergedAgentState,
      meta: {
        totalMessages: totalMessageCount,
        totalTurns,
      },
    };

    return deepClone(merged);
  }

  // -------------------------------------------------------------------------
  // summarize(context) — creates a compact context summary
  // -------------------------------------------------------------------------

  /**
   * Create a compact, human-readable summary of a context.
   *
   * Designed to be injected into system prompts or displayed to the user when
   * resuming a session.
   *
   * @param {object} context — a captured or merged context object
   * @param {object} [options]
   * @param {number} [options.maxLength=600] — approximate character cap
   * @param {boolean} [options.markdown=true] — use markdown formatting
   * @returns {string} Compact summary string.
   */
  summarize(context = {}, options = {}) {
    const maxLength =
      Number.isFinite(options.maxLength) && options.maxLength > 0
        ? options.maxLength
        : 600;

    const markdown = options.markdown !== false;
    const ctx = context || {};

    const sections = [];

    // Goal
    if (ctx.goals && ctx.goals.length > 0) {
      const goalsText = ctx.goals.map((g) => g).join("; ");
      sections.push(markdown
        ? `**Goal:** ${goalsText}`
        : `Goal: ${goalsText}`
      );
    } else if (ctx.goal) {
      sections.push(markdown
        ? `**Goal:** ${ctx.goal}`
        : `Goal: ${ctx.goal}`
      );
    }

    // Session info
    const ids = ctx.sessionIds || (ctx.sessionId ? [ctx.sessionId] : []);
    if (ids.length > 0) {
      const idList = ids.length > 3
        ? ids.slice(0, 3).join(", ") + ` (+${ids.length - 3} more)`
        : ids.join(", ");
      sections.push(markdown
        ? `**Sessions:** ${idList}`
        : `Sessions: ${idList}`
      );
    }

    // Key decisions (first 3–5, depending on space)
    const decisions = Array.isArray(ctx.decisions) ? ctx.decisions : [];
    if (decisions.length > 0) {
      const maxItems = Math.min(decisions.length, 5);
      const items = decisions.slice(0, maxItems);
      if (markdown) {
        sections.push(
          `**Decisions:**\n${items.map((d) => `  - ${d}`).join("\n")}`
        );
      } else {
        sections.push(`Decisions:\n${items.map((d) => `  - ${d}`).join("\n")}`);
      }
    }

    // Active tasks (first 3–5)
    const tasks = Array.isArray(ctx.tasks) ? ctx.tasks : [];
    if (tasks.length > 0) {
      const maxItems = Math.min(tasks.length, 5);
      const items = tasks.slice(0, maxItems);
      if (markdown) {
        sections.push(
          `**Tasks:**\n${items.map((t) => `  - ${t}`).join("\n")}`
        );
      } else {
        sections.push(`Tasks:\n${items.map((t) => `  - ${t}`).join("\n")}`);
      }
    }

    // Open questions (first 3)
    const questions = Array.isArray(ctx.questions) ? ctx.questions : [];
    if (questions.length > 0) {
      const maxItems = Math.min(questions.length, 3);
      const items = questions.slice(0, maxItems);
      if (markdown) {
        sections.push(
          `**Questions:**\n${items.map((q) => `  - ${q}`).join("\n")}`
        );
      } else {
        sections.push(`Questions:\n${items.map((q) => `  - ${q}`).join("\n")}`);
      }
    }

    // Modified files (max 5)
    const files = Array.isArray(ctx.modifiedFiles) ? ctx.modifiedFiles : [];
    if (files.length > 0) {
      const fileList =
        files.length > 5
          ? files.slice(0, 5).join(", ") + ` (+${files.length - 5} more)`
          : files.join(", ");
      sections.push(markdown
        ? `**Files:** ${fileList}`
        : `Files: ${fileList}`
      );
    }

    // Meta: message count, turns
    const meta = ctx.meta || {};
    if (ctx.digest?.messageCount || meta.totalMessages || meta.totalTurns) {
      const mc = ctx.digest?.messageCount || meta.totalMessages || 0;
      const tc = meta.totalTurns || ctx.meta?.turnCount || 0;
      sections.push(
        `${mc} messages, ${tc} turns`
      );
    }

    let summary = sections.join(markdown ? "\n\n" : "\n");

    // Truncate to maxLength if needed, preserving structural integrity.
    if (summary.length > maxLength) {
      const decisionSection = sections.find((s) =>
        s.startsWith("**Decisions:") || s.startsWith("Decisions:")
      );
      const taskSection = sections.find((s) =>
        s.startsWith("**Tasks:") || s.startsWith("Tasks:")
      );
      const questionSection = sections.find((s) =>
        s.startsWith("**Questions:") || s.startsWith("Questions:")
      );

      // Keep intro sections, progressively shorten content sections.
      const introSections = sections.filter(
        (s) =>
          s.startsWith("**Goal:") ||
          s.startsWith("Goal:") ||
          s.startsWith("**Sessions:") ||
          s.startsWith("Sessions:") ||
          s.startsWith("**Files:") ||
          s.startsWith("Files:") ||
          /^\d+ messages/.test(s)
      );

      const contentSections = [];
      if (decisionSection) {
        const lines = decisionSection.split("\n");
        contentSections.push(lines.slice(0, 3).join("\n"));
      }
      if (taskSection) {
        const lines = taskSection.split("\n");
        contentSections.push(lines.slice(0, 3).join("\n"));
      }
      if (questionSection) {
        const lines = questionSection.split("\n");
        contentSections.push(lines.slice(0, 2).join("\n"));
      }

      summary = [...introSections, ...contentSections].join(
        markdown ? "\n\n" : "\n"
      );

      // Final hard truncation.
      if (summary.length > maxLength) {
        summary = summary.slice(0, maxLength - 3) + "...";
      }
    }

    // Optionally store this summary if the context has a sessionId.
    if (
      options.enableSummaries &&
      (ctx.sessionId || (ctx.sessionIds && ctx.sessionIds.length > 0))
    ) {
      this._storeSummary({ ...deepClone(ctx), _summaryText: summary });
    }

    return summary;
  }

  // -------------------------------------------------------------------------
  // getStoredSummaries()
  // -------------------------------------------------------------------------

  /**
   * Return summaries previously stored via capture/summarize with
   * enableSummaries: true.
   *
   * @param {object} [options]
   * @param {number} [options.limit] — max entries to return
   * @returns {Array<object>} Summaries newest-first.
   */
  getStoredSummaries(options = {}) {
    const limit =
      Number.isFinite(options.limit) && options.limit > 0
        ? options.limit
        : Infinity;

    const entries = [];
    for (let i = this._summaryOrder.length - 1; i >= 0 && entries.length < limit; i -= 1) {
      const id = this._summaryOrder[i];
      const summary = this._summaries.get(id);
      if (summary) entries.push(deepClone(summary));
    }
    return entries;
  }

  // -------------------------------------------------------------------------
  // clear()
  // -------------------------------------------------------------------------

  /**
   * Remove all stored summaries.
   */
  clear() {
    this._summaries.clear();
    this._summaryOrder = [];
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Build the system-level context message injected during transfer.
   *
   * @param {object} context
   * @returns {string}
   * @private
   */
  _buildTransferMessage(context) {
    const summary = this.summarize(context, { maxLength: 500, markdown: false });
    return (
      `[This session continues from a previous session (${context.sessionId}). ` +
      `Prior context summary follows.]\n\n${summary}`
    );
  }

  /**
   * Store a summary entry with FIFO pruning.
   *
   * @param {object} context
   * @private
   */
  _storeSummary(context) {
    const id = context.sessionId || generateId();

    if (this._summaries.size >= this.maxSummaries) {
      const oldestId = this._summaryOrder.shift();
      if (oldestId) this._summaries.delete(oldestId);
    }

    const existingIdx = this._summaryOrder.indexOf(id);
    if (existingIdx >= 0) {
      this._summaryOrder.splice(existingIdx, 1);
    }

    this._summaries.set(id, context);
    this._summaryOrder.push(id);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ContextBridge,
  generateId,
  deepClone,
  looksLikeDecision,
  looksLikeQuestion,
  looksLikeTask,
  extractFilePaths,
  resolveModifiedFiles,
  resolveAgentState,
};
