"use strict";

const SYNTHESIS_STRATEGIES = Object.freeze({
  BEST_FIRST: "BEST_FIRST",
  CONSENSUS: "CONSENSUS",
  MERGE_ALL: "MERGE_ALL",
  WEIGHTED_VOTE: "WEIGHTED_VOTE",
});

class ResponseSynthesizer {
  constructor(options = {}) {
    this._qualityWeights = {
      length: Number.isFinite(options.lengthWeight) ? options.lengthWeight : 0.2,
      structure: Number.isFinite(options.structureWeight) ? options.structureWeight : 0.2,
      uniqueness: Number.isFinite(options.uniquenessWeight) ? options.uniquenessWeight : 0.2,
      latency: Number.isFinite(options.latencyWeight) ? options.latencyWeight : 0.2,
      specificity: Number.isFinite(options.specificityWeight) ? options.specificityWeight : 0.2,
    };
    this._minConsensusRatio = options.minConsensusRatio ?? 0.5;
    this._history = [];
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  synthesize(responses, strategy = SYNTHESIS_STRATEGIES.CONSENSUS) {
    if (!Array.isArray(responses) || responses.length === 0) {
      throw new Error("At least one response is required for synthesis");
    }

    const valid = this._filterValid(responses);
    if (valid.length === 0) {
      return {
        content: "",
        strategy,
        providerCount: 0,
        sources: [],
        confidence: 0,
        message: "No valid responses to synthesize",
      };
    }

    const ranked = this.rankQuality(valid);
    let result;

    switch (strategy) {
      case SYNTHESIS_STRATEGIES.BEST_FIRST:
        result = this._synthesizeBestFirst(valid, ranked);
        break;
      case SYNTHESIS_STRATEGIES.CONSENSUS:
        result = this._synthesizeConsensus(valid, ranked);
        break;
      case SYNTHESIS_STRATEGIES.MERGE_ALL:
        result = this._synthesizeMergeAll(valid, ranked);
        break;
      case SYNTHESIS_STRATEGIES.WEIGHTED_VOTE:
        result = this._synthesizeWeightedVote(valid, ranked);
        break;
      default:
        throw new Error(`Unknown synthesis strategy: ${strategy}`);
    }

    this._history.push({ ...result, timestamp: Date.now() });
    return result;
  }

  extractConsensus(responses) {
    if (!Array.isArray(responses) || responses.length === 0) {
      throw new Error("At least one response is required for consensus extraction");
    }

    const valid = this._filterValid(responses);
    if (valid.length < 2) {
      return {
        consensus: valid.length === 1 ? this._getContent(valid[0]) : "",
        agreementLevel: valid.length === 1 ? 1 : 0,
        sharedPoints: [],
        providerCount: valid.length,
        message: valid.length < 2 ? "Need at least 2 responses for consensus" : "",
      };
    }

    const sentencesByProvider = valid.map((r) =>
      this._extractSentences(this._getContent(r)),
    );
    const sentenceProviders = new Map();

    for (let i = 0; i < sentencesByProvider.length; i++) {
      for (const sent of sentencesByProvider[i]) {
        const key = sent.toLowerCase().replace(/[^\w\s]/g, "").trim();
        if (key.length < 10) continue;
        if (!sentenceProviders.has(key)) {
          sentenceProviders.set(key, new Set());
        }
        sentenceProviders.get(key).add(valid[i].provider || "unknown");
      }
    }

    const consensusPoints = [];
    for (const [key, providers] of sentenceProviders) {
      if (providers.size >= Math.max(2, Math.ceil(valid.length * this._minConsensusRatio))) {
        consensusPoints.push({
          content: key,
          providerCount: providers.size,
          providers: Array.from(providers),
        });
      }
    }

    const agreementLevel =
      sentenceProviders.size > 0
        ? Math.round((consensusPoints.length / sentenceProviders.size) * 100) / 100
        : 0;

    return {
      consensus: consensusPoints.map((p) => p.content).join(". ") + (consensusPoints.length > 0 ? "." : ""),
      agreementLevel,
      sharedPoints: consensusPoints,
      providerCount: valid.length,
      totalUniqueSentences: sentenceProviders.size,
    };
  }

  resolveDisagreement(responses) {
    if (!Array.isArray(responses) || responses.length === 0) {
      throw new Error("At least one response is required for disagreement resolution");
    }

    const valid = this._filterValid(responses);
    if (valid.length < 2) {
      return {
        disagreements: [],
        resolution: valid.length === 1 ? this._getContent(valid[0]) : "",
        unresolvedCount: 0,
        providerCount: valid.length,
        message: "Need at least 2 responses to resolve disagreements",
      };
    }

    const keyPhrasesByProvider = valid.map((r) => ({
      provider: r.provider || "unknown",
      phrases: this._extractKeyPhrases(this._getContent(r)),
    }));

    const allPhrases = new Set();
    for (const entry of keyPhrasesByProvider) {
      for (const phrase of entry.phrases) {
        allPhrases.add(phrase);
      }
    }

    const phraseUsage = new Map();
    for (const phrase of allPhrases) {
      const providers = [];
      for (const entry of keyPhrasesByProvider) {
        if (entry.phrases.some((p) => this._phrasesSimilar(phrase, p))) {
          providers.push(entry.provider);
        }
      }
      phraseUsage.set(phrase, providers);
    }

    const disagreements = [];
    const agreedUpon = [];

    for (const [phrase, providers] of phraseUsage) {
      if (providers.length >= 2) {
        agreedUpon.push(phrase);
      } else if (providers.length === 1) {
        disagreements.push({
          phrase,
          claimedBy: providers[0],
          opposingView: this._findOpposingPhrase(phrase, keyPhrasesByProvider, providers[0]),
        });
      }
    }

    const resolutionLines = [];
    if (agreedUpon.length > 0) {
      resolutionLines.push("RESOLVED (Agreement):");
      for (const p of agreedUpon) {
        resolutionLines.push(`  - ${p}`);
      }
    }
    if (disagreements.length > 0) {
      resolutionLines.push("\nUNRESOLVED (Disagreements):");
      for (const d of disagreements) {
        const note = d.opposingView ? ` (contradicted by: ${d.opposingView})` : "";
        resolutionLines.push(`  - [${d.claimedBy}]: ${d.phrase}${note}`);
      }
    }
    const resolution = resolutionLines.join("\n") || "No disagreements found.";

    return {
      disagreements: disagreements.map((d) => ({
        phrase: d.phrase,
        claimedBy: d.claimedBy,
        opposingView: d.opposingView,
      })),
      resolution,
      unresolvedCount: disagreements.length,
      agreedCount: agreedUpon.length,
      providerCount: valid.length,
    };
  }

  rankQuality(responses) {
    if (!Array.isArray(responses) || responses.length === 0) {
      throw new Error("At least one response is required for quality ranking");
    }

    const scored = responses.map((response, index) => {
      const content = this._getContent(response);
      const metrics = this._computeQualityMetrics(content);
      const latencyMs = Number.isFinite(response.latencyMs) ? response.latencyMs : 0;

      const lengthScore = Math.min(1, metrics.length / 2000);
      const structureScore = metrics.structureScore;
      const uniquenessScore = metrics.uniquenessScore;
      const latencyScore =
        latencyMs > 0 ? Math.min(1, Math.max(0, 1 - latencyMs / 30000)) : 0.5;
      const specificityScore =
        metrics.wordCount > 0
          ? Math.min(1, metrics.uniqueWordCount / Math.max(1, metrics.wordCount))
          : 0;

      const totalScore =
        lengthScore * this._qualityWeights.length +
        structureScore * this._qualityWeights.structure +
        uniquenessScore * this._qualityWeights.uniqueness +
        latencyScore * this._qualityWeights.latency +
        specificityScore * this._qualityWeights.specificity;

      return {
        index,
        provider: response.provider || "unknown",
        content,
        scores: {
          length: Math.round(lengthScore * 100) / 100,
          structure: Math.round(structureScore * 100) / 100,
          uniqueness: Math.round(uniquenessScore * 100) / 100,
          latency: Math.round(latencyScore * 100) / 100,
          specificity: Math.round(specificityScore * 100) / 100,
        },
        totalScore: Math.round(totalScore * 1000) / 1000,
        response,
      };
    });

    scored.sort((a, b) => b.totalScore - a.totalScore);

    return scored.map((entry, rank) => ({
      ...entry,
      rank: rank + 1,
    }));
  }

  getHistory() {
    return [...this._history];
  }

  clearHistory() {
    this._history = [];
  }

  setWeights(weights) {
    if (weights && typeof weights === "object") {
      if (Number.isFinite(weights.length)) this._qualityWeights.length = weights.length;
      if (Number.isFinite(weights.structure)) this._qualityWeights.structure = weights.structure;
      if (Number.isFinite(weights.uniqueness)) this._qualityWeights.uniqueness = weights.uniqueness;
      if (Number.isFinite(weights.latency)) this._qualityWeights.latency = weights.latency;
      if (Number.isFinite(weights.specificity)) this._qualityWeights.specificity = weights.specificity;
    }
  }

  getWeights() {
    return { ...this._qualityWeights };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _filterValid(responses) {
    return responses.filter((r) => r.success !== false && !r.error);
  }

  _getContent(response) {
    if (!response) return "";
    return String(
      response.response?.content ||
        response.content ||
        response.text ||
        response.message ||
        "",
    );
  }

  _extractSentences(content) {
    const text = String(content || "");
    return text
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  _extractKeyPhrases(content) {
    const text = String(content || "").toLowerCase().replace(/[^\w\s]/g, " ");
    const words = text.split(/\s+/).filter((w) => w.length >= 4);

    const stopWords = new Set([
      "this", "that", "with", "from", "have", "were", "been", "when", "will",
      "would", "could", "should", "about", "which", "their", "there",
      "these", "those", "they", "them",
    ]);

    const wordFreq = {};
    for (const word of words) {
      if (stopWords.has(word)) continue;
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }

    const phrases = [];
    const sortedWords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    for (const [word] of sortedWords) {
      const wordIndex = text.indexOf(word);
      if (wordIndex >= 0) {
        const contextStart = Math.max(0, wordIndex - 30);
        const contextEnd = Math.min(text.length, wordIndex + word.length + 30);
        const context = text.substring(contextStart, contextEnd);
        const contextWords = context.split(/\s+/);
        if (contextWords.length >= 3) {
          const pivot = contextWords.indexOf(word);
          const startIdx = Math.max(0, pivot >= 0 ? pivot - 1 : 0);
          const endIdx = Math.min(contextWords.length, pivot >= 0 ? pivot + 2 : contextWords.length);
          const phrase = contextWords.slice(startIdx, endIdx).join(" ");
          if (phrase.length >= 6) {
            phrases.push(phrase);
          }
        }
      }
    }

    return [...new Set(phrases)].slice(0, 10);
  }

  _phrasesSimilar(a, b) {
    const aWords = new Set(a.toLowerCase().split(/\s+/));
    const bWords = new Set(b.toLowerCase().split(/\s+/));
    if (aWords.size === 0 || bWords.size === 0) return false;

    let intersection = 0;
    for (const w of aWords) {
      if (bWords.has(w)) intersection++;
    }

    const union = new Set([...aWords, ...bWords]);
    return intersection / union.size >= 0.5;
  }

  _findOpposingPhrase(phrase, providerPhrases, claimingProvider) {
    const words = new Set(phrase.toLowerCase().split(/\s+/));
    for (const entry of providerPhrases) {
      if (entry.provider === claimingProvider) continue;
      for (const otherPhrase of entry.phrases) {
        const otherWords = new Set(otherPhrase.toLowerCase().split(/\s+/));
        let overlap = 0;
        for (const w of words) {
          if (otherWords.has(w)) overlap++;
        }
        if (overlap >= 1 && !this._phrasesSimilar(phrase, otherPhrase)) {
          return `${entry.provider}: ${otherPhrase}`;
        }
      }
    }
    return null;
  }

  _computeQualityMetrics(content) {
    const text = String(content || "").trim();
    const words = text.length > 0 ? text.split(/\s+/) : [];
    const sentences = text.length > 0 ? text.split(/[.!?]+/).filter((s) => s.trim().length > 0) : [];
    const uniqueWords = new Set(words.map((w) => w.toLowerCase()));

    const avgWordLength =
      words.length > 0
        ? words.reduce((sum, w) => sum + w.length, 0) / words.length
        : 0;

    let structureScore = 0;
    if (sentences.length >= 2) structureScore += 0.3;
    if (sentences.length >= 3) structureScore += 0.2;
    if (text.includes("\n")) structureScore += 0.1;
    if (/^\s*(?:[*-]\s|(?:\d+[.)]\s))/m.test(text)) structureScore += 0.1;
    const letters = (text.match(/[a-zA-Z]/g) || []).length;
    if (letters > 0 && sentences.length > 0) {
      const wordsPerSentence = letters / 5 / sentences.length;
      if (wordsPerSentence >= 5 && wordsPerSentence <= 40) {
        structureScore += 0.3;
      }
    }
    structureScore = Math.min(1, structureScore);

    const uniquenessScore =
      words.length > 0 ? uniqueWords.size / words.length : 0;

    return {
      length: text.length,
      wordCount: words.length,
      sentenceCount: sentences.length,
      uniqueWordCount: uniqueWords.size,
      avgWordLength: Math.round(avgWordLength * 100) / 100,
      structureScore: Math.round(structureScore * 1000) / 1000,
      uniquenessScore: Math.round(uniquenessScore * 1000) / 1000,
    };
  }

  // ---------------------------------------------------------------------------
  // Strategy implementations
  // ---------------------------------------------------------------------------

  _synthesizeBestFirst(valid, ranked) {
    const best = ranked[0];
    return {
      content: best.content,
      strategy: SYNTHESIS_STRATEGIES.BEST_FIRST,
      primaryProvider: best.provider,
      providerCount: valid.length,
      sources: [
        { provider: best.provider, score: best.totalScore, rank: best.rank },
      ],
      confidence:
        ranked.length > 1
          ? Math.round((best.totalScore / Math.max(ranked[1].totalScore, 0.001)) * 100) / 100
          : 1,
    };
  }

  _synthesizeConsensus(valid, ranked) {
    const consensusResult = this.extractConsensus(valid);
    return {
      content: consensusResult.consensus || this._getContent(ranked[0].response),
      strategy: SYNTHESIS_STRATEGIES.CONSENSUS,
      agreementLevel: consensusResult.agreementLevel,
      providerCount: valid.length,
      sources: ranked.map((r) => ({
        provider: r.provider,
        score: r.totalScore,
        rank: r.rank,
      })),
      confidence: consensusResult.agreementLevel,
    };
  }

  _synthesizeMergeAll(valid, ranked) {
    const uniqueContents = new Map();
    for (const entry of ranked) {
      const content = this._getContent(entry.response);
      const key = content.toLowerCase().trim();
      if (!uniqueContents.has(key)) {
        uniqueContents.set(key, {
          content,
          provider: entry.provider,
          score: entry.totalScore,
        });
      }
    }

    const entries = Array.from(uniqueContents.values());
    const merged = entries
      .map((v, i) => `[Response ${i + 1} — ${v.provider}]\n${v.content}`)
      .join("\n\n---\n\n");

    return {
      content: merged,
      strategy: SYNTHESIS_STRATEGIES.MERGE_ALL,
      providerCount: valid.length,
      uniqueResponses: uniqueContents.size,
      sources: ranked.map((r) => ({
        provider: r.provider,
        score: r.totalScore,
        rank: r.rank,
      })),
      confidence: Math.min(1, uniqueContents.size / valid.length),
    };
  }

  _synthesizeWeightedVote(valid, ranked) {
    const totalScore = ranked.reduce((sum, r) => sum + r.totalScore, 0);
    const weights = ranked.map((r) => ({
      provider: r.provider,
      weight:
        totalScore > 0 ? Math.round((r.totalScore / totalScore) * 100) / 100 : 0,
      content: this._getContent(r.response),
    }));

    const majorityThreshold =
      valid.length > 0 ? Math.ceil(valid.length / 2) : 1;
    const sentenceVotes = this._countSentenceVotes(valid);

    const votedContent = [];
    for (const [sentence, voteCount] of sentenceVotes) {
      if (voteCount >= majorityThreshold) {
        votedContent.push(sentence);
      }
    }

    return {
      content:
        votedContent.length > 0
          ? votedContent.join(". ") + "."
          : this._getContent(ranked[0].response),
      strategy: SYNTHESIS_STRATEGIES.WEIGHTED_VOTE,
      weights,
      providerCount: valid.length,
      votedSentences: votedContent.length,
      sources: ranked.map((r) => ({
        provider: r.provider,
        score: r.totalScore,
        rank: r.rank,
        weight:
          weights.find((w) => w.provider === r.provider)?.weight || 0,
      })),
      confidence:
        votedContent.length > 0
          ? Math.min(1, votedContent.length / sentenceVotes.size)
          : 0.3,
    };
  }

  _countSentenceVotes(valid) {
    const voteMap = new Map();
    const allSentences = valid.map((r) =>
      this._extractSentences(this._getContent(r)),
    );

    for (const sentences of allSentences) {
      for (const sent of sentences) {
        const key = sent.toLowerCase().replace(/[^\w\s]/g, "").trim();
        if (key.length < 8) continue;
        voteMap.set(key, (voteMap.get(key) || 0) + 1);
      }
    }

    return new Map([...voteMap.entries()].sort((a, b) => b[1] - a[1]));
  }
}

module.exports = {
  ResponseSynthesizer,
  SYNTHESIS_STRATEGIES,
};
