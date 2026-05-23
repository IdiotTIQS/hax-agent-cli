"use strict";

const MERGE_STRATEGIES = Object.freeze({
  UNION: "UNION",
  INTERSECTION: "INTERSECTION",
  MAJORITY: "MAJORITY",
  WEIGHTED: "WEIGHTED",
  BEST_QUALITY: "BEST_QUALITY",
});

/**
 * Represents a single point (claim, finding, or sentence) extracted from an
 * outcome so that it can be compared and merged across agents.
 */
class ExtractedPoint {
  constructor(text, sourceIndex, sourceProvider, weight) {
    this.text = text;
    this.sourceIndex = Number.isSafeInteger(sourceIndex) ? sourceIndex : -1;
    this.sourceProvider = sourceProvider || "unknown";
    this.weight = Number.isFinite(weight) ? weight : 1;
    this.normalizedKey = _normalizeKey(text);
  }
}

/**
 * OutcomeMerger merges outcomes produced by multiple agents by extracting
 * comparable points and applying a chosen merge strategy.
 */
class OutcomeMerger {
  /**
   * @param {object} [options]
   * @param {number} [options.majorityThreshold]  Ratio (0-1) defining
   *   "majority" for the MAJORITY strategy.  Default: 0.5.
   * @param {number} [options.minPointLength]     Minimum character length
   *   for a sentence to be considered a point.  Default: 10.
   * @param {number} [options.similarityThreshold]  Jaccard threshold for
   *   considering two points the same.  Default: 0.6.
   */
  constructor(options = {}) {
    this._majorityThreshold =
      Number.isFinite(options.majorityThreshold) && options.majorityThreshold > 0 && options.majorityThreshold <= 1
        ? options.majorityThreshold
        : 0.5;
    this._minPointLength =
      Number.isSafeInteger(options.minPointLength) && options.minPointLength >= 4
        ? options.minPointLength
        : 10;
    this._similarityThreshold =
      Number.isFinite(options.similarityThreshold) && options.similarityThreshold > 0 && options.similarityThreshold <= 1
        ? options.similarityThreshold
        : 0.6;
    this._history = [];
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Merge multiple agent outcomes using the given strategy.
   *
   * @param {Array<object>} outcomes  Each outcome must have at minimum a
   *   `content` string.  Optional fields: `provider`, `confidence`, `agentId`,
   *   `weight`, `quality`.
   * @param {string} [strategy="UNION"]  One of the MERGE_STRATEGIES values.
   * @returns {object} A merge result containing the unified content and
   *   metadata about the merge.
   */
  merge(outcomes, strategy = MERGE_STRATEGIES.UNION) {
    if (!Array.isArray(outcomes) || outcomes.length === 0) {
      throw new Error("At least one outcome is required for merging");
    }
    if (!_isValidStrategy(strategy)) {
      throw new Error(
        `Unknown merge strategy: ${strategy}. Valid: ${Object.values(MERGE_STRATEGIES).join(", ")}`,
      );
    }

    const normalized = this._normalizeOutcomes(outcomes);
    const points = this._extractPoints(normalized);
    const clusters = this._clusterPoints(points);
    const conflicts = this._detectConflicts(clusters, normalized.length);

    let selected;
    switch (strategy) {
      case MERGE_STRATEGIES.UNION:
        selected = this._applyUnion(clusters);
        break;
      case MERGE_STRATEGIES.INTERSECTION:
        selected = this._applyIntersection(clusters, normalized.length);
        break;
      case MERGE_STRATEGIES.MAJORITY:
        selected = this._applyMajority(clusters, normalized.length);
        break;
      case MERGE_STRATEGIES.WEIGHTED:
        selected = this._applyWeighted(clusters, normalized);
        break;
      case MERGE_STRATEGIES.BEST_QUALITY:
        selected = this._applyBestQuality(clusters, normalized);
        break;
      default:
        selected = this._applyUnion(clusters);
    }

    const result = {
      content: this._buildContent(selected),
      strategy,
      outcomeCount: outcomes.length,
      totalPointsExtracted: points.length,
      pointsIncluded: selected.length,
      uniqueClusters: clusters.length,
      conflictCount: conflicts.length,
      conflicts,
      sources: this._buildSources(normalized, selected, clusters),
      confidence: this._calculateConfidence(normalized, selected, clusters, strategy),
      timestamp: Date.now(),
    };

    this._history.push({ ...result });
    return result;
  }

  /**
   * Identify and resolve conflicts across outcomes.
   *
   * @param {Array<object>} outcomes
   * @returns {object} Conflict resolution report.
   */
  resolveConflicts(outcomes) {
    if (!Array.isArray(outcomes) || outcomes.length < 2) {
      return {
        conflicts: [],
        resolutions: [],
        resolved: 0,
        unresolved: 0,
        totalConflicts: 0,
        message: outcomes.length < 2 ? "Need at least 2 outcomes to detect conflicts" : "No outcomes provided",
      };
    }

    const normalized = this._normalizeOutcomes(outcomes);
    const points = this._extractPoints(normalized);
    const clusters = this._clusterPoints(points);
    const conflicts = this._detectConflicts(clusters, normalized.length);

    const resolutions = [];
    for (const conflict of conflicts) {
      const resolution = this._resolveConflict(conflict, normalized);
      resolutions.push(resolution);
    }

    const resolved = resolutions.filter((r) => r.resolved).length;
    const unresolved = resolutions.length - resolved;

    return {
      conflicts: conflicts.map((c) => ({
        topic: c.topic,
        viewpoints: c.viewpoints.map((v) => ({
          text: v.text,
          providers: v.providers,
          weight: v.weight,
        })),
        severity: c.severity,
      })),
      resolutions: resolutions.map((r) => ({
        topic: r.topic,
        resolved: r.resolved,
        resolution: r.resolution,
        method: r.method,
        confidence: r.confidence,
      })),
      resolved,
      unresolved,
      totalConflicts: conflicts.length,
    };
  }

  /**
   * Extract the common ground (agreed-upon points) across all outcomes.
   *
   * @param {Array<object>} outcomes
   * @returns {object} Common ground report.
   */
  extractCommonGround(outcomes) {
    if (!Array.isArray(outcomes) || outcomes.length === 0) {
      throw new Error("At least one outcome is required");
    }

    const normalized = this._normalizeOutcomes(outcomes);
    const points = this._extractPoints(normalized);
    const clusters = this._clusterPoints(points);

    const common = [];
    const partial = [];
    const unique = [];

    for (const cluster of clusters) {
      const providerCount = new Set(cluster.members.map((m) => m.sourceProvider)).size;
      if (providerCount === normalized.length) {
        common.push(cluster);
      } else if (providerCount >= Math.ceil(normalized.length / 2)) {
        partial.push(cluster);
      } else {
        unique.push(cluster);
      }
    }

    const commonText = common.map((c) => c.representative.text).join(". ");
    const agreementRatio =
      clusters.length > 0
        ? Math.round((common.length / clusters.length) * 100) / 100
        : 0;

    return {
      commonGround: commonText ? commonText + (commonText.endsWith(".") ? "" : ".") : "",
      agreementRatio,
      commonPoints: common.map((c) => ({
        text: c.representative.text,
        providerCount: new Set(c.members.map((m) => m.sourceProvider)).size,
        totalMentions: c.members.length,
        strength: c.members.length / normalized.length,
      })),
      partialAgreement: partial.map((c) => ({
        text: c.representative.text,
        providerCount: new Set(c.members.map((m) => m.sourceProvider)).size,
      })),
      uniquePoints: unique.map((c) => ({
        text: c.representative.text,
        provider: c.representative.sourceProvider,
      })),
      totalClusters: clusters.length,
      outcomeCount: normalized.length,
    };
  }

  /**
   * Generate a single unified outcome from multiple outcomes.
   * Uses a heuristic blend of intersection and weighted strategies.
   *
   * @param {Array<object>} outcomes
   * @returns {object} Unified outcome.
   */
  generateUnified(outcomes) {
    if (!Array.isArray(outcomes) || outcomes.length === 0) {
      throw new Error("At least one outcome is required for unification");
    }

    const normalized = this._normalizeOutcomes(outcomes);
    const points = this._extractPoints(normalized);
    const clusters = this._clusterPoints(points);

    // Stage 1: Common ground (appears in all outcomes) — highest priority
    const commonGround = [];
    const majorityPoints = [];
    const minorityPoints = [];

    for (const cluster of clusters) {
      const providerCount = new Set(cluster.members.map((m) => m.sourceProvider)).size;
      if (providerCount === normalized.length) {
        commonGround.push(cluster);
      } else if (providerCount >= Math.ceil(normalized.length / 2)) {
        majorityPoints.push(cluster);
      } else {
        minorityPoints.push(cluster);
      }
    }

    // Build the unified text with sections
    const sections = [];

    if (commonGround.length > 0) {
      sections.push(
        "Consensus Points:\n" +
          commonGround.map((c) => `- ${c.representative.text}`).join("\n"),
      );
    }

    if (majorityPoints.length > 0) {
      sections.push(
        "\nMajority View:\n" +
          majorityPoints.map((c) => `- ${c.representative.text}`).join("\n"),
      );
    }

    if (minorityPoints.length > 0) {
      sections.push(
        "\nMinority / Unique Views:\n" +
          minorityPoints.map((c) => `- ${c.representative.text} (${c.representative.sourceProvider})`).join("\n"),
      );
    }

    const unifiedContent = sections.join("\n");

    return {
      content: unifiedContent,
      outcomeCount: normalized.length,
      commonGroundCount: commonGround.length,
      majorityCount: majorityPoints.length,
      minorityCount: minorityPoints.length,
      totalPoints: clusters.length,
      confidence: this._calculateConfidence(normalized, clusters, clusters, "unified"),
      sources: normalized.map((o) => ({
        provider: o.provider,
        pointsContributed:
          clusters.filter((c) =>
            c.members.some((m) => m.sourceIndex === o._index),
          ).length,
      })),
      timestamp: Date.now(),
    };
  }

  /**
   * Return a shallow copy of the merge history.
   */
  getHistory() {
    return [...this._history];
  }

  /**
   * Clear all history entries.
   */
  clearHistory() {
    this._history = [];
  }

  // ---------------------------------------------------------------------------
  // Private: normalisation & point extraction
  // ---------------------------------------------------------------------------

  _normalizeOutcomes(outcomes) {
    return outcomes.map((o, i) => {
      const content = _getContent(o);
      return {
        _index: i,
        content,
        provider: o.provider || o.agentId || `agent-${i + 1}`,
        confidence: Number.isFinite(o.confidence) ? o.confidence : 1,
        weight: Number.isFinite(o.weight) ? o.weight : 1,
        quality: Number.isFinite(o.quality) ? o.quality : 0.5,
        original: o,
      };
    });
  }

  _extractPoints(normalized) {
    const points = [];
    for (const entry of normalized) {
      const sentences = _extractSentences(entry.content);
      for (const sent of sentences) {
        if (sent.length >= this._minPointLength) {
          points.push(
            new ExtractedPoint(
              sent,
              entry._index,
              entry.provider,
              entry.weight,
            ),
          );
        }
      }
    }
    return points;
  }

  _clusterPoints(points) {
    const clusters = [];
    const assigned = new Set();

    for (let i = 0; i < points.length; i++) {
      if (assigned.has(i)) continue;

      const cluster = { members: [points[i]], representative: points[i] };
      assigned.add(i);

      for (let j = i + 1; j < points.length; j++) {
        if (assigned.has(j)) continue;
        if (_jaccardSimilarity(points[i].normalizedKey, points[j].normalizedKey) >= this._similarityThreshold) {
          cluster.members.push(points[j]);
          assigned.add(j);
        }
      }

      // The representative is the member with the longest text (most detail)
      if (cluster.members.length > 1) {
        cluster.representative = cluster.members.reduce((best, m) =>
          m.text.length > best.text.length ? m : best,
        );
      }

      clusters.push(cluster);
    }

    // Sort by member count descending (more agreement = first)
    clusters.sort((a, b) => b.members.length - a.members.length);
    return clusters;
  }

  // ---------------------------------------------------------------------------
  // Private: conflict detection & resolution
  // ---------------------------------------------------------------------------

  _detectConflicts(clusters, outcomeCount) {
    const conflicts = [];

    for (const cluster of clusters) {
      if (cluster.members.length >= 2) {
        // Check for contradictory sentiments within a cluster
        const sentiments = this._classifySentiments(cluster.members.map((m) => m.text));
        const uniqueSentiments = new Set(sentiments.map((s) => s.label));
        if (uniqueSentiments.size > 1) {
          const viewpoints = [];
          for (let i = 0; i < cluster.members.length; i++) {
            const member = cluster.members[i];
            const sentiment = sentiments[i];
            viewpoints.push({
              text: member.text,
              providers: [member.sourceProvider],
              weight: member.weight,
              sentiment: sentiment.label,
              sentimentScore: sentiment.score,
            });
          }

          conflicts.push({
            topic: cluster.representative.text,
            viewpoints,
            sentimentVariation: Array.from(uniqueSentiments),
            severity: this._calculateConflictSeverity(sentiments),
            cluster: cluster.representative.normalizedKey,
          });
        }
      }
    }

    return conflicts;
  }

  _classifySentiments(texts) {
    const positiveWords = new Set([
      "good", "great", "excellent", "positive", "beneficial", "successful",
      "effective", "improvement", "advantage", "recommend", "support",
      "agree", "correct", "best", "optimal", "enhanced", "better", "yes",
      "should", "must", "will", "definitely", "certainly",
    ]);
    const negativeWords = new Set([
      "bad", "poor", "negative", "harmful", "ineffective", "failure",
      "disadvantage", "avoid", "reject", "oppose", "disagree", "incorrect",
      "worst", "worse", "problem", "issue", "risk", "danger", "no",
      "not", "never", "cannot", "unlikely",
    ]);

    return texts.map((text) => {
      const words = text.toLowerCase().split(/\s+/);
      let pos = 0;
      let neg = 0;
      for (const word of words) {
        if (positiveWords.has(word)) pos++;
        if (negativeWords.has(word)) neg++;
      }
      const total = pos + neg;
      const score = total > 0 ? (pos - neg) / total : 0;
      return {
        label: score > 0.1 ? "positive" : score < -0.1 ? "negative" : "neutral",
        score,
      };
    });
  }

  _calculateConflictSeverity(sentiments) {
    const labels = sentiments.map((s) => s.label);
    const uniqueLabels = new Set(labels);
    if (uniqueLabels.has("positive") && uniqueLabels.has("negative")) return "high";
    if (uniqueLabels.size > 1) return "medium";
    return "low";
  }

  _resolveConflict(conflict, normalized) {
    const viewpoints = conflict.viewpoints;
    // Try weighted consensus: preference toward the viewpoint with most weight
    const weightedVotes = {};
    for (const vp of viewpoints) {
      const key = vp.sentiment;
      if (!weightedVotes[key]) weightedVotes[key] = { weight: 0, texts: [] };
      weightedVotes[key].weight += vp.weight;
      weightedVotes[key].texts.push(vp.text);
    }

    const entries = Object.entries(weightedVotes).sort((a, b) => b[1].weight - a[1].weight);

    let resolved = entries.length > 1;
    let method = "weighted_consensus";
    let resolution = "";

    if (entries.length === 1) {
      resolved = true;
      method = "unanimous";
      resolution = entries[0][1].texts[0];
    } else {
      const top = entries[0];
      const second = entries[1];
      const margin = (top[1].weight - second[1].weight) / Math.max(1, top[1].weight + second[1].weight);

      if (margin >= 0.3) {
        resolution = top[1].texts[0];
      } else {
        resolved = false;
        resolution = `Conflicting views: ${entries.map((e) => `[${e[0]}] ${e[1].texts[0]}`).join(" vs ")}`;
      }
    }

    const confidence = resolved ? Math.min(1, weightedVotes[Object.keys(weightedVotes)[0]].weight / normalized.length) : 0.3;

    return {
      topic: conflict.topic,
      resolved,
      resolution,
      method,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: strategy implementations
  // ---------------------------------------------------------------------------

  _applyUnion(clusters) {
    return clusters.map((c) => c.representative);
  }

  _applyIntersection(clusters, outcomeCount) {
    return clusters
      .filter((c) => {
        const providers = new Set(c.members.map((m) => m.sourceProvider));
        return providers.size === outcomeCount;
      })
      .map((c) => c.representative);
  }

  _applyMajority(clusters, outcomeCount) {
    const threshold = Math.max(1, Math.ceil(outcomeCount * this._majorityThreshold));
    return clusters
      .filter((c) => {
        const providers = new Set(c.members.map((m) => m.sourceProvider));
        return providers.size >= threshold;
      })
      .map((c) => c.representative);
  }

  _applyWeighted(clusters, normalized) {
    // Score each cluster by the sum of its members' weights
    const scored = clusters.map((c) => {
      const totalWeight = c.members.reduce((sum, m) => sum + m.weight, 0);
      const providerCount = new Set(c.members.map((m) => m.sourceProvider)).size;
      const averageConfidence =
        c.members.reduce((sum, m) => {
          const entry = normalized[m.sourceIndex];
          return sum + (entry ? entry.confidence : 1);
        }, 0) / Math.max(1, c.members.length);

      return {
        cluster: c,
        score: totalWeight * providerCount * averageConfidence,
      };
    });

    // Sort by weighted score descending; take clusters above median score
    scored.sort((a, b) => b.score - a.score);
    const medianScore =
      scored.length > 0
        ? scored[Math.floor(scored.length / 2)].score
        : 0;

    return scored
      .filter((s) => s.score >= medianScore || scored.length <= 2)
      .map((s) => s.cluster.representative);
  }

  _applyBestQuality(clusters, normalized) {
    // Rank outcomes by a composite quality indicator
    const ranked = normalized
      .map((entry) => ({
        ...entry,
        contribution: clusters.filter((c) =>
          c.members.some((m) => m.sourceIndex === entry._index),
        ).length,
      }))
      .sort((a, b) => {
        const aScore = a.confidence * a.quality * (1 + Math.log(1 + a.contribution));
        const bScore = b.confidence * b.quality * (1 + Math.log(1 + b.contribution));
        return bScore - aScore;
      });

    const best = ranked[0];
    // Select points where the best-quality agent is represented
    return clusters
      .filter((c) => c.members.some((m) => m.sourceIndex === best._index))
      .map((c) => c.representative);
  }

  // ---------------------------------------------------------------------------
  // Private: result assembly
  // ---------------------------------------------------------------------------

  _buildContent(selected) {
    if (selected.length === 0) return "";
    return selected.map((p) => p.text).join(". ") + ".";
  }

  _buildSources(normalized, selected, clusters) {
    return normalized.map((entry) => {
      const contributed = selected.filter((p) => p.sourceIndex === entry._index);
      return {
        provider: entry.provider,
        pointsContributed: contributed.length,
        totalPoints: selected.length > 0 ? Math.round((contributed.length / selected.length) * 100) / 100 : 0,
        confidence: entry.confidence,
        weight: entry.weight,
        quality: entry.quality,
      };
    });
  }

  _calculateConfidence(normalized, selected, clusters, strategy) {
    if (selected.length === 0) return 0;

    // Higher confidence when:
    // - Selected points account for a good proportion of clusters
    // - Points come from more providers
    // - Average outcome confidence is high

    const clusterRatio = Math.min(1, selected.length / Math.max(1, clusters.length));
    const providerDiversity =
      new Set(selected.map((p) => p.sourceProvider)).size / Math.max(1, normalized.length);
    const avgConfidence =
      normalized.reduce((s, e) => s + e.confidence, 0) / Math.max(1, normalized.length);

    const confidence = clusterRatio * 0.4 + providerDiversity * 0.3 + avgConfidence * 0.3;
    return Math.round(confidence * 100) / 100;
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

function _normalizeKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function _getContent(outcome) {
  if (!outcome) return "";
  return String(
    outcome.response?.content ||
      outcome.content ||
      outcome.text ||
      outcome.message ||
      "",
  );
}

function _extractSentences(content) {
  const text = String(content || "");
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function _jaccardSimilarity(a, b) {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  const union = new Set([...setA, ...setB]);
  return intersection / union.size;
}

function _isValidStrategy(strategy) {
  return Object.values(MERGE_STRATEGIES).includes(strategy);
}

module.exports = {
  OutcomeMerger,
  ExtractedPoint,
  MERGE_STRATEGIES,
};
