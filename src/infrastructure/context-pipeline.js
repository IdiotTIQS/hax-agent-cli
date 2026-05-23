"use strict";

const { TokenBudget } = require("../tokens/budget");
const { ImportanceScorer } = require("../preserve/importance");
const { ContextSummarizer } = require("../preserve/summarizer");
const {
  compactMessages,
  buildCompactMessages,
} = require("../context-compaction");
const {
  ContextScheduler,
  estimateTokens,
  messageTokens,
} = require("../optimizer/context-scheduler");

// ---------------------------------------------------------------------------
// ContextPipeline
// ---------------------------------------------------------------------------

class ContextPipeline {
  /**
   * @param {object} [options]
   * @param {TokenBudget} [options.tokenBudget]
   * @param {ImportanceScorer} [options.importanceScorer]
   * @param {ContextSummarizer} [options.contextSummarizer]
   * @param {ContextScheduler} [options.contextScheduler]
   * @param {number} [options.maxContextWindow=200000]
   * @param {number} [options.compactionThreshold=0.75] — fraction of window at
   *   which compaction triggers (0-1).
   * @param {number} [options.compactionPreserveCount=20]
   * @param {object} [options.importanceOptions] — passed to ImportanceScorer
   * @param {object} [options.summarizerOptions] — passed to ContextSummarizer
   * @param {object} [options.schedulerOptions] — passed to ContextScheduler
   */
  constructor(options = {}) {
    this.tokenBudget = options.tokenBudget || new TokenBudget();
    this.importanceScorer =
      options.importanceScorer ||
      new ImportanceScorer(options.importanceOptions);
    this.contextSummarizer =
      options.contextSummarizer ||
      new ContextSummarizer(options.summarizerOptions);
    this.contextScheduler =
      options.contextScheduler ||
      new ContextScheduler(options.schedulerOptions);

    this.maxContextWindow = Number.isFinite(options.maxContextWindow)
      ? options.maxContextWindow
      : 200_000;
    this.compactionThreshold =
      Number.isFinite(options.compactionThreshold)
        ? options.compactionThreshold
        : 0.75;
    this.compactionPreserveCount =
      Number.isFinite(options.compactionPreserveCount)
        ? options.compactionPreserveCount
        : 20;

    /** @private */
    this._lastPreTurn = null;
    /** @private */
    this._compactionLog = [];
    /** @private */
    this._turnCount = 0;
  }

  // -----------------------------------------------------------------------
  // preTurn(session, options)
  // -----------------------------------------------------------------------

  /**
   * Called before each provider turn.
   *
   * - Allocates the token budget if not yet initialised.
   * - Estimates total message tokens and checks against the compaction
   *   threshold.
   * - If over threshold, uses {@link compactMessages} to split conversation
   *   into summary / preserve zones, scores the summary zone with
   *   {@link ImportanceScorer}, generates a context card via
   *   {@link ContextSummarizer}, and rebuilds the message list.
   * - Runs {@link ContextScheduler#schedule} to verify the final selection
   *   fits within the budget window.
   * - Stores result on the session for downstream access.
   *
   * @param {object} session
   * @param {object} [turnOptions]
   * @param {string} [turnOptions.content] — the user message for this turn
   * @returns {object} pre-turn state snapshot
   */
  preTurn(session, turnOptions = {}) {
    this._turnCount += 1;

    const messages = Array.isArray(session.messages)
      ? session.messages
      : [];
    const totalTokens = this._estimateTotalTokens(messages);

    // Lazily allocate the budget on first call.
    const budget = this.tokenBudget.getBudget();
    if (budget.totalTokens === 0) {
      this.tokenBudget.allocate(this.maxContextWindow);
    }

    // ---- compaction gate ------------------------------------------------
    let compacted = false;
    let compactionSummary = null;
    const usageRatio =
      this.maxContextWindow > 0 ? totalTokens / this.maxContextWindow : 0;

    if (
      usageRatio >= this.compactionThreshold &&
      messages.length > this.compactionPreserveCount
    ) {
      const { summaryZone, preserveZone } = compactMessages(messages, {
        preserveCount: this.compactionPreserveCount,
      });

      if (summaryZone.length > 0) {
        // Identify critical messages via importance scoring.
        const scored = this.importanceScorer.scoreBatch(summaryZone);
        const criticalMessages = scored
          .filter((entry) => entry.score >= 0.55)
          .map((entry) => entry.message);

        // Build a human-readable context card from the stale zone.
        compactionSummary = this.contextSummarizer.createContextCard(
          summaryZone,
        );

        // Rebuild the message list: summary injected + preserve zone.
        session.messages = buildCompactMessages(
          messages,
          compactionSummary,
          this.compactionPreserveCount,
        );

        compacted = true;

        this._compactionLog.push({
          timestamp: Date.now(),
          turn: this._turnCount,
          originalCount: messages.length,
          compactedCount: session.messages.length,
          summaryZoneCount: summaryZone.length,
          preserveZoneCount: preserveZone.length,
          criticalCount: criticalMessages.length,
          summaryPreview: compactionSummary.slice(0, 200),
        });
      }
    }

    // ---- scheduler gate -------------------------------------------------
    const schedule = this.contextScheduler.schedule(
      Array.isArray(session.messages) ? session.messages : [],
      this.maxContextWindow,
      { query: turnOptions.content },
    );

    // ---- store snapshot -------------------------------------------------
    this._lastPreTurn = {
      timestamp: Date.now(),
      turn: this._turnCount,
      messageCount: Array.isArray(session.messages)
        ? session.messages.length
        : 0,
      estimatedTokens: totalTokens,
      compacted,
      compactionSummary,
      schedule: {
        included: schedule.included.length,
        dropped: schedule.dropped.length,
        summarized: schedule.summarized.length,
        totalTokens: schedule.totalTokens,
        budget: schedule.budget,
      },
      budget: this.tokenBudget.getBudget(),
    };

    // Attach to session so other components (e.g. status line) can inspect.
    session._contextPipeline = this._lastPreTurn;

    return this._lastPreTurn;
  }

  // -----------------------------------------------------------------------
  // postTurn(session, turnResult)
  // -----------------------------------------------------------------------

  /**
   * Called after a provider turn completes (success, error, or interrupt).
   *
   * Updates the token budget with actual consumption and clears per-turn
   * state.
   *
   * @param {object} session
   * @param {object} [turnResult]
   * @param {object} [turnResult.usage] — { inputTokens, outputTokens }
   * @param {string} [turnResult.status] — "completed" | "error" | "interrupted"
   * @returns {object} updated budget snapshot
   */
  postTurn(session, turnResult = {}) {
    const usage = turnResult.usage || {};
    const inputTokens = Number.isFinite(usage.inputTokens)
      ? usage.inputTokens
      : 0;
    const outputTokens = Number.isFinite(usage.outputTokens)
      ? usage.outputTokens
      : 0;

    // Consume from the relevant budget categories.
    if (inputTokens > 0) {
      this.tokenBudget.consume("conversation", inputTokens);
    }
    if (outputTokens > 0) {
      this.tokenBudget.consume("output", outputTokens);
    }

    // Clear soft state.
    this._lastPreTurn = null;
    if (session._contextPipeline) {
      delete session._contextPipeline;
    }

    return this.tokenBudget.getBudget();
  }

  // -----------------------------------------------------------------------
  // getBudget()
  // -----------------------------------------------------------------------

  /** @returns {object} Current budget snapshot from {@link TokenBudget#getBudget}. */
  getBudget() {
    return this.tokenBudget.getBudget();
  }

  // -----------------------------------------------------------------------
  // reset()
  // -----------------------------------------------------------------------

  /** Reset all state (budget, compaction log, turn counter). */
  reset() {
    this.tokenBudget = new TokenBudget();
    this._lastPreTurn = null;
    this._compactionLog = [];
    this._turnCount = 0;
    return this;
  }

  // -----------------------------------------------------------------------
  // getCompactionLog()
  // -----------------------------------------------------------------------

  /** @returns {Array<object>} List of compaction events. */
  getCompactionLog() {
    return [...this._compactionLog];
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** @private */
  _estimateTotalTokens(messages) {
    let total = 0;
    for (const msg of messages) {
      total += this._estimateMessageTokens(msg);
    }
    return total;
  }

  /** @private */
  _estimateMessageTokens(msg) {
    if (!msg) return 0;
    return (
      8 +
      estimateTokens(
        String(msg.content ?? ""),
        this.contextScheduler.charsPerToken,
      ) +
      estimateTokens(
        String(msg.role || "user"),
        this.contextScheduler.charsPerToken,
      )
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ContextPipeline instance (the "context manager").
 *
 * @param {object} [options] — forwarded to {@link ContextPipeline}
 * @returns {ContextPipeline}
 */
function createContextManager(options = {}) {
  return new ContextPipeline(options);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ContextPipeline,
  createContextManager,
};
