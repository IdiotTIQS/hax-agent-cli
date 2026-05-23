"use strict";

const { estimateMessageTokens } = require("../context-window");
const { ImportanceScorer } = require("../preserve/importance");

// ---------------------------------------------------------------------------
// Domain classification
// ---------------------------------------------------------------------------

const DOMAIN_PATTERNS = {
  code: [
    /\bfunction\b/, /\bconst\b/, /\blet\b/, /\bvar\b/, /\bclass\b/,
    /\bimport\b/, /\bexport\b/, /\brequire\b/, /\bmodule\b/, /\breturn\b/,
    /\bapi\b/, /\bendpoint\b/, /\bfetch\b/, /\basync\b/, /\bawait\b/,
    /\bcomponent\b/, /\breact\b/, /\bnode\b/, /\bpython\b/, /\btypescript\b/,
    /\binterface\b/, /\btype\b/, /\bstring\b/, /\bnumber\b/, /\barray\b/,
    /\bobject\b/, /\bpromise\b/, /\bcallback\b/, /\bmiddleware\b/,
    /\b\.js\b/, /\b\.ts\b/, /\b\.json\b/, /\b\.py\b/,
    /\bcode\b/, /\brepository\b/, /\brefactor\b/, /\bsyntax\b/,
    /\bpattern\b/, /\barchitecture\b/, /\bdependency\b/,
  ],
  planning: [
    /\bplan\b/, /\bgoal\b/, /\bobjective\b/, /\bstrategy\b/, /\bapproach\b/,
    /\bdesign\b/, /\barchitecture\b/, /\broadmap\b/, /\bmilestone\b/,
    /\bpriority\b/, /\btimeline\b/, /\bdeadline\b/, /\bnext\b/,
    /\bstep\b/, /\btodo\b/, /\btask\b/, /\baction\b/, /\bfeature\b/,
    /\bimplement\b/, /\brelease\b/, /\bversion\b/, /\bscope\b/,
    /\brequirement\b/, /\bspecification\b/, /\boutline\b/, /\bproposal\b/,
  ],
  debugging: [
    /\berror\b/, /\bbug\b/, /\bfix\b/, /\bdebug\b/, /\btrace\b/,
    /\bstack\b/, /\bexception\b/, /\bfailure\b/, /\bcrash\b/, /\bbroken\b/,
    /\bissue\b/, /\bproblem\b/, /\bwrong\b/, /\bunexpected\b/,
    /\bworks\b/, /\bdoesn't\b/, /\bcannot\b/, /\bfailing\b/, /\bmisbehav/,
    /\blog\b/, /\bwarn\b/, /\bconsole\b/, /\binvestigate\b/,
  ],
  analysis: [
    /\banalysis\b/, /\banalyze\b/, /\breview\b/, /\bevaluate\b/,
    /\bcompare\b/, /\bperformance\b/, /\boptimization\b/, /\bbottleneck\b/,
    /\bmetric\b/, /\bmeasure\b/, /\bprofile\b/, /\bbenchmark\b/,
    /\btest\b/, /\bcoverage\b/, /\bquality\b/, /\bstandard\b/,
    /\breport\b/, /\bfinding\b/, /\bresult\b/, /\bconclusion\b/,
  ],
};

/**
 * Classify a message into zero or more domains based on its content.
 *
 * @param {{content: string}} message
 * @returns {Set<string>}
 */
function classifyMessageDomains(message) {
  const text = String(message?.content || "").toLowerCase();
  const domains = new Set();

  for (const [domain, patterns] of Object.entries(DOMAIN_PATTERNS)) {
    if (patterns.some((p) => p.test(text))) {
      domains.add(domain);
    }
  }

  // Default domain if nothing matched.
  if (domains.size === 0) {
    domains.add("general");
  }

  return domains;
}

// ---------------------------------------------------------------------------
// ContextPruner
// ---------------------------------------------------------------------------

class ContextPruner {
  /**
   * @param {object} [options]
   * @param {ImportanceScorer} [options.scorer] — custom importance scorer
   * @param {number} [options.minKeep=1] — minimum messages to always keep
   */
  constructor(options = {}) {
    this.scorer = options.scorer || new ImportanceScorer();
    this.minKeep = Math.max(1, Number.isFinite(options.minKeep) ? options.minKeep : 1);
    this._lastStrategy = null;
    this._lastQuality = null;
  }

  // -----------------------------------------------------------------------
  // prune(messages, budget, strategy)
  // -----------------------------------------------------------------------

  /**
   * Prune messages to fit within the token budget using the specified
   * strategy. Always keeps at least `minKeep` messages.
   *
   * Available strategies:
   *   - "fifo"       First-in-first-out: drops oldest first
   *   - "importance" Keeps highest-importance messages
   *   - "hybrid"     Mixes FIFO and importance
   *   - "domain"     Keeps per-domain diversity
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {number} budget — token budget
   * @param {string} [strategy="hybrid"] — strategy name
   * @returns {{ messages: Array, stats: object }}
   */
  prune(messages, budget, strategy = "hybrid") {
    const msgs = Array.isArray(messages) ? messages : [];
    if (msgs.length === 0) {
      this._lastStrategy = strategy;
      this._lastQuality = null;
      return { messages: [], stats: this._emptyStats(msgs.length) };
    }

    const tokenBudget = Math.max(1, Number.isFinite(budget) ? budget : 0);
    this._lastStrategy = strategy;

    let result;
    switch (strategy) {
      case "fifo":
        result = this.strategyFIFO(msgs, tokenBudget);
        break;
      case "importance":
        result = this.strategyImportance(msgs, tokenBudget);
        break;
      case "hybrid":
        result = this.strategyHybrid(msgs, tokenBudget);
        break;
      case "domain":
        result = this.strategyDomain(msgs, tokenBudget);
        break;
      default:
        result = this.strategyHybrid(msgs, tokenBudget);
    }

    this._lastQuality = this.estimateQuality(msgs, result.messages);
    return { messages: result.messages, stats: result.stats };
  }

  // -----------------------------------------------------------------------
  // strategyFIFO(messages, budget)
  // -----------------------------------------------------------------------

  /**
   * First-in-first-out: removes oldest messages until the remaining messages
   * fit within the token budget. Always keeps the most recent message.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {number} budget
   * @returns {{ messages: Array, stats: object }}
   */
  strategyFIFO(messages, budget) {
    const msgs = Array.isArray(messages) ? messages : [];
    if (msgs.length === 0) {
      return { messages: [], stats: this._emptyStats(0) };
    }

    const total = msgs.length;
    let usedTokens = 0;
    const kept = [];

    // Walk backward, collecting messages that fit.
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const tokens = estimateMessageTokens(msgs[i]);
      if (usedTokens + tokens <= budget || kept.length < this.minKeep) {
        kept.unshift(msgs[i]);
        usedTokens += tokens;
      } else {
        break;
      }
    }

    return {
      messages: kept,
      stats: {
        strategy: "fifo",
        originalCount: total,
        keptCount: kept.length,
        droppedCount: total - kept.length,
        budgetTokens: budget,
        usedTokens,
      },
    };
  }

  // -----------------------------------------------------------------------
  // strategyImportance(messages, budget)
  // -----------------------------------------------------------------------

  /**
   * Importance-based pruning: scores every message and keeps the highest-
   * scoring ones that fit within the token budget. Messages are returned
   * in their original order.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {number} budget
   * @returns {{ messages: Array, stats: object }}
   */
  strategyImportance(messages, budget) {
    const msgs = Array.isArray(messages) ? messages : [];
    if (msgs.length === 0) {
      return { messages: [], stats: this._emptyStats(0) };
    }

    const total = msgs.length;

    // Score all messages.
    const scored = this.scorer.scoreBatch(msgs);

    // Always keep the most recent message.
    const lastIdx = total - 1;
    const keepSet = new Set();
    let usedTokens = 0;

    const lastTokens = estimateMessageTokens(msgs[lastIdx]);
    keepSet.add(lastIdx);
    usedTokens = Math.min(lastTokens, budget);

    // Fill remaining budget with highest-scoring messages (excluding the last one).
    for (const { index } of scored) {
      if (keepSet.has(index)) continue;
      if (keepSet.size >= this.minKeep && usedTokens >= budget) break;

      const tokens = estimateMessageTokens(msgs[index]);
      if (usedTokens + tokens > budget && keepSet.size >= this.minKeep) continue;

      keepSet.add(index);
      usedTokens += tokens;
    }

    // Reconstruct in original order.
    const kept = msgs.filter((_, i) => keepSet.has(i));

    return {
      messages: kept,
      stats: {
        strategy: "importance",
        originalCount: total,
        keptCount: kept.length,
        droppedCount: total - kept.length,
        budgetTokens: budget,
        usedTokens,
        averageScore: kept.length > 0
          ? scored.filter((s) => keepSet.has(s.index)).reduce((sum, s) => sum + s.score, 0) / kept.length
          : 0,
      },
    };
  }

  // -----------------------------------------------------------------------
  // strategyHybrid(messages, budget)
  // -----------------------------------------------------------------------

  /**
   * Hybrid strategy: combines importance and recency. First reserves critical
   * messages (score >= critical threshold), then fills remaining budget with
   * the most recent remaining messages (FIFO from the tail).
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {number} budget
   * @returns {{ messages: Array, stats: object }}
   */
  strategyHybrid(messages, budget) {
    const msgs = Array.isArray(messages) ? messages : [];
    if (msgs.length === 0) {
      return { messages: [], stats: this._emptyStats(0) };
    }

    const total = msgs.length;
    const keepSet = new Set();
    let usedTokens = 0;

    // Phase 1: Reserve critical messages (score >= threshold).
    const scored = this.scorer.scoreBatch(msgs);
    const criticalThreshold = this.scorer.criticalThreshold || 0.55;

    for (const { index, score } of scored) {
      if (score >= criticalThreshold) {
        const tokens = estimateMessageTokens(msgs[index]);
        if (usedTokens + tokens <= budget || keepSet.size < this.minKeep) {
          keepSet.add(index);
          usedTokens += tokens;
        }
      }
    }

    // Phase 2: Fill remaining budget with most recent (FIFO from tail).
    for (let i = total - 1; i >= 0; i -= 1) {
      if (keepSet.has(i)) continue;
      const tokens = estimateMessageTokens(msgs[i]);
      if (usedTokens + tokens > budget) break;
      keepSet.add(i);
      usedTokens += tokens;
    }

    // Phase 3: Ensure minKeep (add from the end if needed).
    if (keepSet.size < this.minKeep) {
      for (let i = total - 1; i >= 0; i -= 1) {
        if (keepSet.has(i)) continue;
        keepSet.add(i);
        usedTokens += estimateMessageTokens(msgs[i]);
        if (keepSet.size >= this.minKeep) break;
      }
    }

    // Reconstruct in original order.
    const kept = msgs.filter((_, i) => keepSet.has(i));

    return {
      messages: kept,
      stats: {
        strategy: "hybrid",
        originalCount: total,
        keptCount: kept.length,
        droppedCount: total - kept.length,
        budgetTokens: budget,
        usedTokens,
        criticalKept: [...keepSet].filter((i) => {
          const s = scored.find((sc) => sc.index === i);
          return s && s.score >= criticalThreshold;
        }).length,
      },
    };
  }

  // -----------------------------------------------------------------------
  // strategyDomain(messages, budget)
  // -----------------------------------------------------------------------

  /**
   * Domain-diversity strategy: ensures representation from every detected
   * domain within the conversation. Allocates budget proportionally across
   * domains, then fills remaining with recency.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {number} budget
   * @returns {{ messages: Array, stats: object }}
   */
  strategyDomain(messages, budget) {
    const msgs = Array.isArray(messages) ? messages : [];
    if (msgs.length === 0) {
      return { messages: [], stats: this._emptyStats(0) };
    }

    const total = msgs.length;
    const keepSet = new Set();
    let usedTokens = 0;

    // Classify all messages into domains.
    const domainMap = new Map();
    for (let i = 0; i < msgs.length; i += 1) {
      const domains = classifyMessageDomains(msgs[i]);
      for (const domain of domains) {
        if (!domainMap.has(domain)) {
          domainMap.set(domain, []);
        }
        domainMap.get(domain).push(i);
      }
    }

    // Always keep the last message.
    const lastIdx = total - 1;
    keepSet.add(lastIdx);
    usedTokens = Math.min(estimateMessageTokens(msgs[lastIdx]), budget);

    const domainCount = domainMap.size;
    if (domainCount === 0) {
      return { messages: msgs, stats: this._emptyStats(total) };
    }

    // Allocate budget per domain, reserving some for the last message.
    const availableBudget = Math.max(1, budget - usedTokens);
    const perDomainBudget = Math.max(1, Math.floor(availableBudget / Math.max(1, domainCount)));

    // Pick best representative per domain.
    const scored = this.scorer.scoreBatch(msgs);
    const scoreMap = new Map();
    for (const { index, score } of scored) {
      scoreMap.set(index, score);
    }

    for (const [, indices] of domainMap) {
      // Sort indices within this domain by importance score descending.
      const candidates = indices
        .filter((i) => i !== lastIdx)
        .sort((a, b) => (scoreMap.get(b) || 0) - (scoreMap.get(a) || 0));

      let domainUsed = 0;
      for (const idx of candidates) {
        if (domainUsed >= perDomainBudget && keepSet.size >= this.minKeep) break;
        if (keepSet.has(idx)) continue;
        const tokens = estimateMessageTokens(msgs[idx]);
        if (usedTokens + tokens > budget) break;
        keepSet.add(idx);
        usedTokens += tokens;
        domainUsed += tokens;
      }
    }

    // Fill remaining budget with high-scoring messages.
    for (const { index } of scored) {
      if (keepSet.has(index)) continue;
      const tokens = estimateMessageTokens(msgs[index]);
      if (usedTokens + tokens > budget) continue;
      keepSet.add(index);
      usedTokens += tokens;
    }

    // Reconstruct in original order.
    const kept = msgs.filter((_, i) => keepSet.has(i));

    const keptDomains = new Set();
    for (let i = 0; i < kept.length; i += 1) {
      const domains = classifyMessageDomains(kept[i]);
      for (const d of domains) {
        keptDomains.add(d);
      }
    }

    return {
      messages: kept,
      stats: {
        strategy: "domain",
        originalCount: total,
        keptCount: kept.length,
        droppedCount: total - kept.length,
        budgetTokens: budget,
        usedTokens,
        domainsDetected: domainCount,
        domainsKept: keptDomains.size,
      },
    };
  }

  // -----------------------------------------------------------------------
  // estimateQuality(messages, pruned)
  // -----------------------------------------------------------------------

  /**
   * Estimate the quality loss of pruning. Returns a score 0–1 where 1 means
   * no quality loss (pruned set preserves all key characteristics).
   *
   * Factors considered:
   *   - Retention rate: what fraction of messages was kept
   *   - Recency preservation: how well the tail is preserved
   *   - Importance preservation: average importance of kept vs original
   *   - Domain coverage: how many domains are still represented
   *
   * @param {Array<{role: string, content: string}>} original
   * @param {Array<{role: string, content: string}>} pruned
   * @returns {{ score: number, factors: object }}
   */
  estimateQuality(original, pruned) {
    const orig = Array.isArray(original) ? original : [];
    const prn = Array.isArray(pruned) ? pruned : [];

    if (orig.length === 0) {
      return { score: 1, factors: { retention: 1, recency: 1, importance: 1, domain: 1 } };
    }

    if (prn.length === 0) {
      return { score: 0, factors: { retention: 0, recency: 0, importance: 0, domain: 0 } };
    }

    // Retention rate (weighted to tolerate moderate drops).
    const retention = prn.length / orig.length;
    const retentionScore = Math.min(1, retention * 1.5);

    // Recency preservation: how many of the last 5 are kept.
    const tailSize = Math.min(5, orig.length);
    const origTail = new Set(orig.slice(-tailSize).map((_, j) => orig.length - tailSize + j));
    const keptTailIndices = [];

    for (let j = orig.length - tailSize; j < orig.length; j += 1) {
      if (prn.includes(orig[j])) {
        keptTailIndices.push(j);
      }
    }

    const recencyScore = origTail.size > 0 ? keptTailIndices.length / origTail.size : 1;

    // Importance preservation.
    const origScores = this.scorer.scoreBatch(orig);
    const origAvgScore = origScores.reduce((s, sc) => s + sc.score, 0) / origScores.length;
    const prunedScores = this.scorer.scoreBatch(prn);
    const prunedAvgScore = prunedScores.length > 0
      ? prunedScores.reduce((s, sc) => s + sc.score, 0) / prunedScores.length
      : 0;
    const importanceScore = origAvgScore > 0
      ? Math.min(1, prunedAvgScore / origAvgScore)
      : 1;

    // Domain coverage.
    const origDomains = new Set();
    for (const msg of orig) {
      const domains = classifyMessageDomains(msg);
      for (const d of domains) origDomains.add(d);
    }

    const keptDomains = new Set();
    for (const msg of prn) {
      const domains = classifyMessageDomains(msg);
      for (const d of domains) keptDomains.add(d);
    }

    const domainScore = origDomains.size > 0 ? keptDomains.size / origDomains.size : 1;

    // Composite score (weighted average).
    const score = Math.min(1, Math.max(0,
      retentionScore * 0.25 +
      recencyScore * 0.30 +
      importanceScore * 0.25 +
      domainScore * 0.20,
    ));

    return {
      score: Math.round(score * 1000) / 1000,
      factors: {
        retention: Math.round(retentionScore * 1000) / 1000,
        recency: Math.round(recencyScore * 1000) / 1000,
        importance: Math.round(importanceScore * 1000) / 1000,
        domain: Math.round(domainScore * 1000) / 1000,
      },
    };
  }

  // -----------------------------------------------------------------------
  // compareStrategies(messages, budget)
  // -----------------------------------------------------------------------

  /**
   * Compare every available strategy against the same input.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {number} budget
   * @returns {Array<{ strategy: string, keptCount: number, quality: number, stats: object }>}
   */
  compareStrategies(messages, budget) {
    const strategies = ["fifo", "importance", "hybrid", "domain"];
    const results = [];

    for (const strategy of strategies) {
      const { messages: pruned, stats } = this.prune(messages, budget, strategy);
      const quality = this.estimateQuality(messages, pruned);
      results.push({
        strategy,
        keptCount: pruned.length,
        quality: quality.score,
        qualityFactors: quality.factors,
        stats,
      });
    }

    // Sort by quality descending.
    results.sort((a, b) => b.quality - a.quality);
    return results;
  }

  // -----------------------------------------------------------------------
  // selectBestStrategy(messages, budget)
  // -----------------------------------------------------------------------

  /**
   * Pick the best pruning strategy for the given input.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {number} budget
   * @returns {{ strategy: string, quality: number, messages: Array, stats: object }}
   */
  selectBestStrategy(messages, budget) {
    const comparison = this.compareStrategies(messages, budget);
    const best = comparison[0];
    const { messages: pruned, stats } = this.prune(messages, budget, best.strategy);

    return {
      strategy: best.strategy,
      quality: best.quality,
      messages: pruned,
      stats,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  _emptyStats(originalCount = 0) {
    return {
      strategy: this._lastStrategy || "unknown",
      originalCount,
      keptCount: 0,
      droppedCount: originalCount,
      budgetTokens: 0,
      usedTokens: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ContextPruner,
  classifyMessageDomains,
  DOMAIN_PATTERNS,
};
