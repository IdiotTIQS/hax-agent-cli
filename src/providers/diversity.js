"use strict";

class DiversityChecker {
  constructor(options = {}) {
    this._similarityThreshold = options.similarityThreshold ?? 0.7;
    this._echoChamberThreshold = options.echoChamberThreshold ?? 0.85;
    this._diversityScore = 0;
    this._lastMetrics = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  checkDiversity(responses) {
    if (!Array.isArray(responses) || responses.length === 0) {
      throw new Error("At least one response is required for diversity check");
    }

    const valid = this._filterValid(responses);
    if (valid.length < 2) {
      this._diversityScore = 0;
      this._lastMetrics = {
        diversityScore: 0,
        uniqueWordsRatio: 0,
        uniquePhrasesRatio: 0,
        perspectiveCount: 0,
        providerCount: valid.length,
        message: "Need at least 2 valid responses to measure diversity",
      };
      return this._lastMetrics;
    }

    const contents = valid.map((r) => this._getContent(r));

    // --- Lexical diversity: word-level overlap across providers ---
    const providerWordSets = valid.map((r, i) => {
      const words = contents[i]
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3);
      return new Set(words);
    });

    const allWordsUnion = new Set();
    for (const ws of providerWordSets) {
      for (const w of ws) allWordsUnion.add(w);
    }

    const wordOverlap = this._computeSetOverlap(providerWordSets);
    const uniqueWordsRatio =
      allWordsUnion.size > 0 ? 1 - wordOverlap.overlapRatio : 0;

    // --- Phrase-level diversity ---
    const providerPhraseSets = valid.map((r) => {
      const text = this._getContent(r).toLowerCase();
      return this._extractDiversityPhrases(text);
    });

    const phraseOverlap = this._computeSetOverlap(providerPhraseSets);
    const uniquePhrasesRatio =
      phraseOverlap.total > 0 ? 1 - phraseOverlap.overlapRatio : 0;

    // --- Perspective diversity ---
    const perspectiveCount = this._countPerspectives(contents);

    // --- Structural diversity ---
    const structureDiversity = this._computeStructureDiversity(contents);

    const diversityScore =
      Math.round(
        (uniqueWordsRatio * 0.25 +
          uniquePhrasesRatio * 0.25 +
          Math.min(1, perspectiveCount / valid.length) * 0.25 +
          structureDiversity * 0.25) *
          100,
      ) / 100;

    this._diversityScore = diversityScore;

    this._lastMetrics = {
      diversityScore,
      uniqueWordsRatio: Math.round(uniqueWordsRatio * 100) / 100,
      uniquePhrasesRatio: Math.round(uniquePhrasesRatio * 100) / 100,
      perspectiveCount,
      structureDiversity: Math.round(structureDiversity * 100) / 100,
      providerCount: valid.length,
      wordOverlap: Math.round(wordOverlap.overlapRatio * 100) / 100,
      phraseOverlap: Math.round(phraseOverlap.overlapRatio * 100) / 100,
    };

    return this._lastMetrics;
  }

  getDiversityScore() {
    return this._diversityScore;
  }

  isEchoChamber(responses) {
    if (!Array.isArray(responses) || responses.length < 2) {
      return {
        isEchoChamber: false,
        similarityScore: 0,
        providerCount: responses ? responses.length : 0,
        message: "Need at least 2 responses to detect echo chamber",
      };
    }

    const metrics = this.checkDiversity(responses);
    const similarityScore =
      Math.round((1 - metrics.diversityScore) * 100) / 100;

    return {
      isEchoChamber: similarityScore >= this._echoChamberThreshold,
      similarityScore,
      echoChamberThreshold: this._echoChamberThreshold,
      providerCount: metrics.providerCount,
      diversityScore: metrics.diversityScore,
      message:
        similarityScore >= this._echoChamberThreshold
          ? "Echo chamber detected: providers show very high agreement"
          : "Providers show sufficient diversity",
    };
  }

  suggestAlternative(responses) {
    if (!Array.isArray(responses) || responses.length === 0) {
      throw new Error("At least one response is required");
    }

    const valid = this._filterValid(responses);

    if (valid.length === 0) {
      return {
        alternative: "",
        reasoning: "No valid responses to base alternative on",
        providerCount: 0,
      };
    }

    const diversity =
      valid.length >= 2 ? this.checkDiversity(valid) : null;
    const allContent = valid.map((r) => this._getContent(r)).join(" ");

    const missingAngles = this._identifyMissingAngles(allContent);

    let alternative = "Alternative Perspective:\n";
    if (missingAngles.length > 0) {
      alternative +=
        "Consider exploring: " + missingAngles.join(", ") + ".\n";
    } else {
      alternative +=
        "Consider approaching from a different angle or discipline.\n";
    }

    if (diversity && diversity.diversityScore < 0.3) {
      alternative +=
        "Responses are highly similar; seek inputs from different paradigms or models.\n";
    }
    if (diversity) {
      alternative += `Current diversity score: ${diversity.diversityScore}.\n`;
    }

    return {
      alternative,
      reasoning:
        missingAngles.length > 0
          ? `Missing perspectives: ${missingAngles.join(", ")}`
          : "General diversification suggested",
      missingAngles,
      providerCount: valid.length,
      diversityScore: diversity ? diversity.diversityScore : null,
    };
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

  _computeSetOverlap(providerSets) {
    if (providerSets.length < 2) {
      const total = providerSets.length === 1 ? providerSets[0].size : 0;
      return { shared: 0, total, overlapRatio: total > 0 ? 0 : 0 };
    }

    let intersection = new Set(providerSets[0]);
    for (let i = 1; i < providerSets.length; i++) {
      intersection = new Set(
        [...intersection].filter((x) => providerSets[i].has(x)),
      );
    }

    const union = new Set();
    for (const set of providerSets) {
      for (const item of set) union.add(item);
    }

    return {
      shared: intersection.size,
      total: union.size,
      overlapRatio: union.size > 0 ? intersection.size / union.size : 0,
    };
  }

  _extractDiversityPhrases(text) {
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const phrases = new Set();
    for (const sent of sentences) {
      const clean = sent.toLowerCase().replace(/[^\w\s]/g, "").trim();
      if (clean.length >= 12) {
        phrases.add(clean);
      }
    }
    return phrases;
  }

  _countPerspectives(contents) {
    const perspectiveIndicators = [
      /however|but|although|on the other hand|alternatively|nevertheless/i,
      /first|second|third|finally|lastly|in conclusion/i,
      /for example|for instance|such as|specifically/i,
      /because|therefore|thus|consequently|as a result/i,
      /should|could|would|recommend|suggest|advise/i,
    ];

    let distinctMatches = 0;
    for (const content of contents) {
      for (const pattern of perspectiveIndicators) {
        if (pattern.test(content)) {
          distinctMatches += 1;
          break;
        }
      }
    }

    return distinctMatches;
  }

  _computeStructureDiversity(contents) {
    const lengths = contents.map((c) => c.length);
    const wordCounts = contents.map((c) => c.split(/\s+/).length);
    const sentenceCounts = contents.map(
      (c) => c.split(/[.!?]+/).filter((s) => s.trim().length > 0).length,
    );

    const lengthCV = this._coefficientOfVariance(lengths);
    const wordCV = this._coefficientOfVariance(wordCounts);
    const sentenceCV = this._coefficientOfVariance(sentenceCounts);

    return Math.min(1, (lengthCV + wordCV + sentenceCV) / 3);
  }

  _coefficientOfVariance(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean === 0) return 0;
    const variance =
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) /
      values.length;
    return Math.sqrt(variance) / mean;
  }

  _identifyMissingAngles(content) {
    const text = String(content || "").toLowerCase();
    const angles = [
      {
        keyword: "cost|price|expensive|cheap|budget|economic",
        label: "cost implications",
      },
      {
        keyword: "secur|privacy|protect|encrypt|auth|vulnerab",
        label: "security considerations",
      },
      {
        keyword: "scale|scalab|performance|throughput|latency",
        label: "scalability and performance",
      },
      {
        keyword: "user|ux|interface|experience|usability|accessib",
        label: "user experience",
      },
      {
        keyword: "risk|failure|danger|threat|hazard",
        label: "risk assessment",
      },
      {
        keyword: "future|long.?term|sustainable|maintainable|evolv",
        label: "long-term sustainability",
      },
      {
        keyword: "alternative|other option|different approach|another way",
        label: "alternative approaches",
      },
      {
        keyword: "ethic|fair|bias|discriminat|equit",
        label: "ethical considerations",
      },
    ];

    const missing = [];
    for (const angle of angles) {
      if (!new RegExp(angle.keyword, "i").test(text)) {
        missing.push(angle.label);
      }
    }

    return missing.slice(0, 5);
  }
}

module.exports = { DiversityChecker };
