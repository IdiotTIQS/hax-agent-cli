"use strict";

const { estimateMessageTokens } = require("../context-window");
const { ImportanceScorer } = require("../preserve/importance");
const { ContextPruner } = require("./strategies");

// ---------------------------------------------------------------------------
// PruningEvaluator
// ---------------------------------------------------------------------------

class PruningEvaluator {
  /**
   * @param {object} [options]
   * @param {ImportanceScorer} [options.scorer]
   * @param {ContextPruner} [options.pruner]
   */
  constructor(options = {}) {
    this.scorer = options.scorer || new ImportanceScorer();
    this.pruner = options.pruner || new ContextPruner({ scorer: this.scorer });
    this._lastEval = null;
  }

  // -----------------------------------------------------------------------
  // evaluate(original, pruned)
  // -----------------------------------------------------------------------

  /**
   * Evaluate the quality of a pruning operation by comparing the original
   * and pruned message sets across multiple dimensions.
   *
   * @param {Array<{role: string, content: string}>} original
   * @param {Array<{role: string, content: string}>} pruned
   * @returns {{
   *   retentionRate: number,
   *   tokenReduction: number,
   *   informationLoss: number,
   *   recencyBias: number,
   *   domainLoss: number,
   *   overallScore: number,
   *   details: object
   * }}
   */
  evaluate(original, pruned) {
    const orig = Array.isArray(original) ? original : [];
    const prn = Array.isArray(pruned) ? pruned : [];

    if (orig.length === 0) {
      this._lastEval = this._zeroEval();
      return this._lastEval;
    }

    const retentionRate = this.getRetentionRate(orig, prn);
    const tokenReduction = this._getTokenReduction(orig, prn);
    const informationLoss = this.getInformationLoss(orig, prn);
    const recencyBias = this._getRecencyBias(orig, prn);
    const domainLoss = this._getDomainLoss(orig, prn);
    const importanceShift = this._getImportanceShift(orig, prn);

    // Overall score: higher is better (opposite of informationLoss).
    const overallScore = Math.max(0, Math.min(1,
      retentionRate * 0.20 +
      tokenReduction * 0.15 +
      (1 - informationLoss) * 0.30 +
      (1 - domainLoss) * 0.15 +
      Math.max(0, 1 - Math.abs(importanceShift)) * 0.10 +
      recencyBias * 0.10,
    ));

    this._lastEval = {
      retentionRate: Math.round(retentionRate * 1000) / 1000,
      tokenReduction: Math.round(tokenReduction * 1000) / 1000,
      informationLoss: Math.round(informationLoss * 1000) / 1000,
      recencyBias: Math.round(recencyBias * 1000) / 1000,
      domainLoss: Math.round(domainLoss * 1000) / 1000,
      importanceShift: Math.round(importanceShift * 1000) / 1000,
      overallScore: Math.round(overallScore * 1000) / 1000,
      details: {
        originalCount: orig.length,
        prunedCount: prn.length,
        originalTokens: this._totalTokens(orig),
        prunedTokens: this._totalTokens(prn),
      },
    };

    return this._lastEval;
  }

  // -----------------------------------------------------------------------
  // getRetentionRate()
  // -----------------------------------------------------------------------

  /**
   * What percentage of messages was kept.
   *
   * @param {Array<{role: string, content: string}>} original
   * @param {Array<{role: string, content: string}>} pruned
   * @returns {number} 0–1
   */
  getRetentionRate(original, pruned) {
    const orig = Array.isArray(original) ? original : [];
    const prn = Array.isArray(pruned) ? pruned : [];
    if (orig.length === 0) return 1;
    return prn.length / orig.length;
  }

  // -----------------------------------------------------------------------
  // getInformationLoss()
  // -----------------------------------------------------------------------

  /**
   * Estimate how much semantic information was lost during pruning.
   * Uses importance-weighted message count comparison.
   *
   * A value of 0 means no loss; 1 means all information was lost.
   *
   * @param {Array<{role: string, content: string}>} original
   * @param {Array<{role: string, content: string}>} pruned
   * @returns {number} 0–1
   */
  getInformationLoss(original, pruned) {
    const orig = Array.isArray(original) ? original : [];
    const prn = Array.isArray(pruned) ? pruned : [];

    if (orig.length === 0) return 0;
    if (prn.length === 0) return 1;

    // Total importance score of original messages.
    const origScored = this.scorer.scoreBatch(orig);
    const origTotalImportance = origScored.reduce((sum, s) => sum + s.score, 0);

    if (origTotalImportance === 0) {
      // No importance detected; fall back to count-based loss.
      return 1 - (prn.length / orig.length);
    }

    // Build a quick lookup for pruned message identity.
    const prunedSet = new Set(prn);
    let keptImportance = 0;

    // Messages in original that appear in pruned.
    for (const { message, score, index } of origScored) {
      // Use reference equality first, then content+role as fallback.
      if (prunedSet.has(message)) {
        keptImportance += score;
      } else {
        // Check by content match.
        const found = prn.some(
          (pm) => pm.role === message.role && pm.content === message.content,
        );
        if (found) keptImportance += score;
      }
    }

    const loss = 1 - (keptImportance / origTotalImportance);
    return Math.max(0, Math.min(1, loss));
  }

  // -----------------------------------------------------------------------
  // compare(strategies, messages, budget)
  // -----------------------------------------------------------------------

  /**
   * Compare multiple pruning strategies against the same input. Runs a
   * full evaluation (retention, information loss, recency bias, domain loss)
   * for each strategy and returns ranked results.
   *
   * @param {string[]} [strategies] — strategy names to compare;
   *   defaults to ["fifo", "importance", "hybrid", "domain"]
   * @param {Array<{role: string, content: string}>} messages
   * @param {number} budget — token budget
   * @returns {Array<{
   *   strategy: string,
   *   retained: number,
   *   retentionRate: number,
   *   informationLoss: number,
   *   overallScore: number,
   *   messages: Array,
   *   stats: object,
   * }>}
   */
  compare(strategies, messages, budget) {
    const stratList = Array.isArray(strategies) && strategies.length > 0
      ? strategies
      : ["fifo", "importance", "hybrid", "domain"];

    const msgs = Array.isArray(messages) ? messages : [];
    const tokenBudget = Math.max(1, Number.isFinite(budget) ? budget : 0);

    const results = [];

    for (const strategy of stratList) {
      const { messages: pruned, stats } = this.pruner.prune(msgs, tokenBudget, strategy);
      const evaluation = this.evaluate(msgs, pruned);

      results.push({
        strategy,
        retained: pruned.length,
        retentionRate: evaluation.retentionRate,
        informationLoss: evaluation.informationLoss,
        overallScore: evaluation.overallScore,
        evaluation,
        messages: pruned,
        stats,
      });
    }

    // Sort by overallScore descending (best first).
    results.sort((a, b) => b.overallScore - a.overallScore);

    return results;
  }

  // -----------------------------------------------------------------------
  // getBestStrategy(messages, budget)
  // -----------------------------------------------------------------------

  /**
   * Recommend the best pruning strategy for the given input.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {number} budget
   * @returns {{
   *   strategy: string,
   *   overallScore: number,
   *   retentionRate: number,
   *   informationLoss: number,
   *   messages: Array,
   *   stats: object,
   * }}
   */
  getBestStrategy(messages, budget) {
    const msgs = Array.isArray(messages) ? messages : [];
    if (msgs.length === 0) {
      return {
        strategy: "none",
        overallScore: 0,
        retentionRate: 0,
        informationLoss: 1,
        messages: [],
        stats: {},
      };
    }

    const comparison = this.compare(null, msgs, budget);
    if (comparison.length === 0) {
      return {
        strategy: "none",
        overallScore: 0,
        retentionRate: 0,
        informationLoss: 1,
        messages: [],
        stats: {},
      };
    }

    const best = comparison[0];
    return {
      strategy: best.strategy,
      overallScore: best.overallScore,
      retentionRate: best.retentionRate,
      informationLoss: best.informationLoss,
      messages: best.messages,
      stats: best.stats,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  _totalTokens(messages) {
    return (Array.isArray(messages) ? messages : []).reduce(
      (sum, msg) => sum + estimateMessageTokens(msg),
      0,
    );
  }

  _getTokenReduction(original, pruned) {
    const orig = Array.isArray(original) ? original : [];
    const prn = Array.isArray(pruned) ? pruned : [];
    const origTokens = this._totalTokens(orig);
    if (origTokens === 0) return 0;
    const prunedTokens = this._totalTokens(prn);
    return Math.max(0, Math.min(1, 1 - prunedTokens / origTokens));
  }

  _getRecencyBias(original, pruned) {
    const orig = Array.isArray(original) ? original : [];
    const prn = Array.isArray(pruned) ? pruned : [];

    if (orig.length === 0) return 1;

    // Higher recency bias = pruned set leans toward recent messages.
    // This is good: we want to keep recent context.
    const origRecencySum = orig.reduce((sum, _, i) => sum + (i / Math.max(1, orig.length - 1)), 0);
    const origAvgRecency = origRecencySum / orig.length;

    const prunedSet = new Set(prn);
    const prunedIndices = [];
    for (let i = 0; i < orig.length; i += 1) {
      if (prunedSet.has(orig[i])) prunedIndices.push(i);
    }

    if (prunedIndices.length === 0) return 0;

    const prunedRecencySum = prunedIndices.reduce(
      (sum, idx) => sum + (idx / Math.max(1, orig.length - 1)),
      0,
    );
    const prunedAvgRecency = prunedRecencySum / prunedIndices.length;

    // Bias = how much more recent the pruned set is (clamped 0–1).
    return Math.max(0, Math.min(1, prunedAvgRecency / Math.max(0.01, origAvgRecency)));
  }

  _getDomainLoss(original, pruned) {
    const orig = Array.isArray(original) ? original : [];
    const prn = Array.isArray(pruned) ? pruned : [];

    const origDomains = new Set();
    for (const msg of orig) {
      const domains = this._classifyDomains(msg);
      for (const d of domains) origDomains.add(d);
    }

    if (origDomains.size === 0) return 0;

    const keptDomains = new Set();
    for (const msg of prn) {
      const domains = this._classifyDomains(msg);
      for (const d of domains) keptDomains.add(d);
    }

    return Math.max(0, Math.min(1, 1 - keptDomains.size / origDomains.size));
  }

  _getImportanceShift(original, pruned) {
    const orig = Array.isArray(original) ? original : [];
    const prn = Array.isArray(pruned) ? pruned : [];

    if (orig.length === 0 || prn.length === 0) return 0;

    const origAvg = this.scorer.scoreBatch(orig).reduce((sum, s) => sum + s.score, 0) / orig.length;
    const prunedAvg = this.scorer.scoreBatch(prn).reduce((sum, s) => sum + s.score, 0) / prn.length;

    return origAvg > 0 ? (prunedAvg - origAvg) / origAvg : 0;
  }

  _classifyDomains(message) {
    // Minimal inline domain detection to avoid circular dependency concerns.
    const text = String(message?.content || "").toLowerCase();
    const domains = new Set();

    const patterns = {
      code: [/\bfunction\b/, /\bconst\b/, /\bclass\b/, /\bimport\b/, /\bapi\b/, /\bcode\b/],
      planning: [/\bplan\b/, /\bgoal\b/, /\bstrategy\b/, /\btask\b/, /\bfeature\b/],
      debugging: [/\berror\b/, /\bbug\b/, /\bfix\b/, /\bdebug\b/, /\bissue\b/],
      analysis: [/\banalysis\b/, /\breview\b/, /\btest\b/, /\bperformance\b/, /\bmetric\b/],
    };

    for (const [domain, pats] of Object.entries(patterns)) {
      if (pats.some((p) => p.test(text))) domains.add(domain);
    }

    if (domains.size === 0) domains.add("general");
    return domains;
  }

  _zeroEval() {
    return {
      retentionRate: 1,
      tokenReduction: 0,
      informationLoss: 0,
      recencyBias: 0,
      domainLoss: 0,
      importanceShift: 0,
      overallScore: 1,
      details: { originalCount: 0, prunedCount: 0, originalTokens: 0, prunedTokens: 0 },
    };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { PruningEvaluator };
