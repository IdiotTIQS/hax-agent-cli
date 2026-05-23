"use strict";

/**
 * Optimization strategies controlling how aggressively text is trimmed.
 *
 *   AGGRESSIVE  — removes most filler, condenses heavily, may lose nuance.
 *   MODERATE    — balanced trimming with reasonable preservation.
 *   CONSERVATIVE — minimal changes, only removes clear redundancies.
 */
const Strategy = Object.freeze({
  AGGRESSIVE: "aggressive",
  MODERATE: "moderate",
  CONSERVATIVE: "conservative",
});

const DEFAULT_STRATEGY = Strategy.MODERATE;
const DEFAULT_CHARS_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Redundant phrase / filler patterns
// ---------------------------------------------------------------------------

const FILLER_PATTERNS = [
  /\b(in order to)\b/gi,
  /\b(it is important to note that)\b/gi,
  /\b(it should be noted that)\b/gi,
  /\b(please note that)\b/gi,
  /\b(it is worth noting that)\b/gi,
  /\b(it is worth mentioning that)\b/gi,
  /\b(it goes without saying that)\b/gi,
  /\b(needless to say,?\s*)/gi,
  /\b(as a matter of fact,?\s*)/gi,
  /\b(as mentioned (?:above|previously|earlier),?\s*)/gi,
  /\b(for the purpose of)\b/gi,
  /\b(in the event that)\b/gi,
  /\b(in the process of)\b/gi,
  /\b(on the grounds that)\b/gi,
  /\b(with regard to)\b/gi,
  /\b(with respect to)\b/gi,
  /\b(in relation to)\b/gi,
  /\b(in connection with)\b/gi,
  /\b(due to the fact that)\b/gi,
  /\b(owing to the fact that)\b/gi,
  /\b(the fact that)\b/gi,
  /\b(despite the fact that)\b/gi,
  /\b(in spite of the fact that)\b/gi,
  /\b(regardless of the fact that)\b/gi,
  /\b(at this point in time)\b/gi,
  /\b(at the present time)\b/gi,
  /\b(at the current time)\b/gi,
  /\b(in the near future)\b/gi,
  /\b(in the not-too-distant future)\b/gi,
  /\b(first and foremost,?\s*)/gi,
  /\b(last but not least,?\s*)/gi,
  /\b(all things considered,?\s*)/gi,
  /\b(that being said,?\s*)/gi,
  /\b(with that being said,?\s*)/gi,
  /\b(having said that,?\s*)/gi,
  /\b(to be honest,?\s*)/gi,
  /\b(to tell you the truth,?\s*)/gi,
  /\b(frankly speaking,?\s*)/gi,
  /\b(honestly speaking,?\s*)/gi,
  /\b(I would like to)\b/gi,
  /\b(I want to)\b/gi,
  /\b(I would argue that)\b/gi,
  /\b(I believe that)\b/gi,
  /\b(I think that)\b/gi,
  /\b(in my opinion,?\s*)/gi,
  /\b(from my perspective,?\s*)/gi,
  /\b(it seems to me that)\b/gi,
  /\b(it appears that)\b/gi,
  /\b(as far as I(?: am|'m) concerned,?\s*)/gi,
  /\b(as far as I can tell,?\s*)/gi,
  /\b(for what it'?s worth,?\s*)/gi,
];

const AGGRESSIVE_FILLER_PATTERNS = [
  /\b(I would like to)\b/gi,
  /\b(I want to)\b/gi,
  /\b(I would argue that)\b/gi,
  /\b(I believe that)\b/gi,
  /\b(I think that)\b/gi,
  /\b(in my opinion,?\s*)/gi,
  /\b(from my perspective,?\s*)/gi,
  /\b(it seems to me that)\b/gi,
  /\b(it appears that)\b/gi,
  /\b(for what it'?s worth,?\s*)/gi,
  /\b(to be honest,?\s*)/gi,
  /\b(frankly,?\s*)/gi,
  /\b(honestly,?\s*)/gi,
  /\b(actually,?\s*)/gi,
  /\b(basically,?\s*)/gi,
  /\b(essentially,?\s*)/gi,
  /\b(literally,?\s*)/gi,
  /\b(just[,.]?\s*)/gi,
  /\b(really[,.]?\s*)/gi,
  /\b(very[,.]?\s*)/gi,
  /\b(quite[,.]?\s*)/gi,
  /\b(rather[,.]?\s*)/gi,
  /\b(somewhat[,.]?\s*)/gi,
  /\b(perhaps[,.]?\s*)/gi,
  /\b(maybe[,.]?\s*)/gi,
  /\b(possibly[,.]?\s*)/gi,
  /\b(probably[,.]?\s*)/gi,
  /\b(certainly[,.]?\s*)/gi,
  /\b(definitely[,.]?\s*)/gi,
  /\b(obviously[,.]?\s*)/gi,
  /\b(of course,?\s*)/gi,
  /\b(a lot of)\b/gi,
  /\b(a number of)\b/gi,
  /\b(the majority of)\b/gi,
  /\b(a large number of)\b/gi,
  /\b(a wide variety of)\b/gi,
  /\b(a great deal of)\b/gi,
];

const REDUNDANT_PHRASE_MAP = new Map([
  [/\bin order to\b/i, "to"],
  [/\bfor the purpose of\b/i, "for"],
  [/\bin the event that\b/i, "if"],
  [/\bdue to the fact that\b/i, "because"],
  [/\bthe fact that\b/i, "that"],
  [/\bdespite the fact that\b/i, "although"],
  [/\bregardless of the fact that\b/i, "although"],
  [/\bat this point in time\b/i, "now"],
  [/\bat the present time\b/i, "now"],
  [/\bin the near future\b/i, "soon"],
  [/\ba number of\b/i, "several"],
  [/\bthe majority of\b/i, "most"],
  [/\ba lot of\b/i, "many"],
  [/\ba large number of\b/i, "many"],
  [/\bwith regard to\b/i, "about"],
  [/\bwith respect to\b/i, "about"],
  [/\bin relation to\b/i, "about"],
  [/\bin connection with\b/i, "about"],
  [/\bon the grounds that\b/i, "because"],
  [/\bin the process of\b/i, "while"],
  [/\bowing to the fact that\b/i, "because"],
  [/\bin spite of the fact that\b/i, "although"],
  [/\bat the current time\b/i, "now"],
  [/\ba wide variety of\b/i, "various"],
  [/\ba great deal of\b/i, "much"],
]);

// ---------------------------------------------------------------------------
// Instruction compression patterns
// ---------------------------------------------------------------------------

const INSTRUCTION_COMPRESSIONS = [
  { pattern: /\b(make sure that|ensure that|guarantee that)\b/gi, replacement: "ensure " },
  { pattern: /\b(you should|you need to|you must|you have to|you ought to)\b/gi, replacement: "must " },
  { pattern: /\b(please\s+)/gi, replacement: "" },
  { pattern: /\b(kindly\s+)/gi, replacement: "" },
  { pattern: /\b(do not\s+)/gi, replacement: "don't " },
  { pattern: /\b(is not\s+)/gi, replacement: "isn't " },
  { pattern: /\b(are not\s+)/gi, replacement: "aren't " },
  { pattern: /\b(cannot\s+)/gi, replacement: "can't " },
  { pattern: /\b(will not\s+)/gi, replacement: "won't " },
  { pattern: /\b(it is necessary to)\b/gi, replacement: "must" },
  { pattern: /\b(it is required that)\b/gi, replacement: "must" },
  { pattern: /\b(it is recommended that)\b/gi, replacement: "should" },
  { pattern: /\b(it is advised that)\b/gi, replacement: "should" },
  { pattern: /\b(it is suggested that)\b/gi, replacement: "should" },
  { pattern: /\b(it is possible to)\b/gi, replacement: "can" },
  { pattern: /\b(it is possible that)\b/gi, replacement: "may" },
  { pattern: /\b(the following\s+steps?\s*(?:are|should be|must be)\s*(?:taken|followed)?[:\s]*)/gi, replacement: "" },
  { pattern: /\b(as follows[:\s]*)/gi, replacement: ": " },
  { pattern: /\b(such as)\b/gi, replacement: "e.g." },
  { pattern: /\b(for example,?\s*)/gi, replacement: "e.g. " },
  { pattern: /\b(that is to say,?\s*)/gi, replacement: "i.e. " },
  { pattern: /\b(in other words,?\s*)/gi, replacement: "i.e. " },
  { pattern: /\b(for instance,?\s*)/gi, replacement: "e.g. " },
];

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Estimate token count for a string using a simple chars-per-token heuristic.
 *
 * @param {string} text
 * @param {number} [charsPerToken=4]
 * @returns {number}
 */
function estimateTokens(text, charsPerToken) {
  const cpt = Number.isFinite(charsPerToken) && charsPerToken > 0
    ? charsPerToken
    : DEFAULT_CHARS_PER_TOKEN;
  const t = String(text ?? "").trim();
  if (!t) return 0;
  return Math.max(1, Math.ceil(t.length / cpt));
}

// ---------------------------------------------------------------------------
// TokenOptimizer
// ---------------------------------------------------------------------------

class TokenOptimizer {
  /**
   * @param {object} [options]
   * @param {string} [options.strategy="moderate"]
   * @param {number} [options.charsPerToken=4]
   */
  constructor(options = {}) {
    this.strategy = Object.values(Strategy).includes(options.strategy)
      ? options.strategy
      : DEFAULT_STRATEGY;
    this.charsPerToken = Number.isFinite(options.charsPerToken) && options.charsPerToken > 0
      ? options.charsPerToken
      : DEFAULT_CHARS_PER_TOKEN;
  }

  // -----------------------------------------------------------------------
  // optimize(prompt, options)
  // -----------------------------------------------------------------------

  /**
   * Optimize a prompt (string or message-like object) for token efficiency.
   *
   * @param {string|object} prompt
   * @param {object} [options]
   * @param {string} [options.strategy]     — override instance strategy
   * @param {number} [options.tokenBudget]   — soft budget; if exceeded,
   *   content prioritization is triggered
   * @param {Array<{heading: string, content: string}>} [options.sections]
   *   Section list for `prioritizeContent`.  When omitted, the prompt text
   *   is split heuristically.
   * @param {boolean} [options.instructions=false]
   *   Treat the prompt as instructions and apply instruction compression.
   * @param {number} [options.charsPerToken]
   * @returns {{ optimized: string, savedTokens: number, originalTokens: number,
   *             optimizedTokens: number, savingsPercent: number, steps: string[] }}
   */
  optimize(prompt, options = {}) {
    const strategy = Object.values(Strategy).includes(options.strategy)
      ? options.strategy
      : this.strategy;
    const cpt = Number.isFinite(options.charsPerToken) && options.charsPerToken > 0
      ? options.charsPerToken
      : this.charsPerToken;

    const originalText = this._extractText(prompt);
    const originalTokens = estimateTokens(originalText, cpt);

    const steps = [];
    let text = originalText;

    // Step 1: trim redundancy (always applied, intensity varies by strategy)
    if (strategy !== Strategy.CONSERVATIVE) {
      const afterTrim = this.trimRedundancy(text, { strategy, charsPerToken: cpt });
      if (afterTrim !== text) {
        steps.push("trimRedundancy");
        text = afterTrim;
      }
    }

    // Step 2: compress instructions when requested
    if (options.instructions) {
      const afterCompress = this.compressInstructions(text, { strategy, charsPerToken: cpt });
      if (afterCompress !== text) {
        steps.push("compressInstructions");
        text = afterCompress;
      }
    }

    // Step 3: prioritize content when a token budget is provided
    if (Number.isFinite(options.tokenBudget) && options.tokenBudget > 0) {
      const sections = Array.isArray(options.sections) && options.sections.length > 0
        ? options.sections
        : this._splitIntoSections(text);
      const prioritized = this.prioritizeContent(sections, options.tokenBudget, {
        strategy,
        charsPerToken: cpt,
      });
      if (prioritized !== text) {
        steps.push("prioritizeContent");
        text = prioritized;
      }
    }

    const optimizedTokens = estimateTokens(text, cpt);
    const savedTokens = Math.max(0, originalTokens - optimizedTokens);
    const savingsPercent = originalTokens > 0
      ? Math.round((savedTokens / originalTokens) * 1000) / 10
      : 0;

    return {
      optimized: text,
      savedTokens,
      originalTokens,
      optimizedTokens,
      savingsPercent,
      steps,
    };
  }

  // -----------------------------------------------------------------------
  // trimRedundancy(text)
  // -----------------------------------------------------------------------

  /**
   * Remove redundant phrases, filler words, and weak qualifiers.
   *
   * @param {string} text
   * @param {object} [options]
   * @param {string} [options.strategy]
   * @param {number} [options.charsPerToken]
   * @returns {string}
   */
  trimRedundancy(text, options = {}) {
    const strategy = Object.values(Strategy).includes(options.strategy)
      ? options.strategy
      : this.strategy;

    let result = String(text ?? "");

    // Stage 1: exact redundant phrase replacements (all strategies)
    for (const [pattern, replacement] of REDUNDANT_PHRASE_MAP) {
      result = this._replacePhrase(result, pattern, replacement);
    }

    // Stage 2: regex filler patterns (moderate + aggressive)
    if (strategy === Strategy.MODERATE || strategy === Strategy.AGGRESSIVE) {
      for (const pattern of FILLER_PATTERNS) {
        result = result.replace(pattern, "");
      }
    }

    // Stage 3: aggressive-only patterns
    if (strategy === Strategy.AGGRESSIVE) {
      for (const pattern of AGGRESSIVE_FILLER_PATTERNS) {
        result = result.replace(pattern, "");
      }
    }

    // Stage 4: collapse multiple spaces and normalize punctuation
    result = result.replace(/[ \t]+/g, " ");
    result = result.replace(/[ \t]+\n/g, "\n");
    result = result.replace(/\n{3,}/g, "\n\n");
    result = result.replace(/[ \t]+$/gm, "");
    result = result.replace(/^[ \t]+/gm, "");

    // Remove empty lines that result from filler removal
    result = result.replace(/\n\s*\n\s*\n/g, "\n\n");

    return result.trim();
  }

  // -----------------------------------------------------------------------
  // compressInstructions(text)
  // -----------------------------------------------------------------------

  /**
   * Condense verbose instruction blocks into tighter directives.
   *
   * @param {string} text
   * @param {object} [options]
   * @param {string} [options.strategy]
   * @param {number} [options.charsPerToken]
   * @returns {string}
   */
  compressInstructions(text, options = {}) {
    const strategy = Object.values(Strategy).includes(options.strategy)
      ? options.strategy
      : this.strategy;

    let result = String(text ?? "");

    // Apply all compressions for moderate and aggressive
    if (strategy !== Strategy.CONSERVATIVE) {
      for (const { pattern, replacement } of INSTRUCTION_COMPRESSIONS) {
        result = result.replace(pattern, replacement);
      }
    }

    // Aggressive: also contract "do not" → "don't", "is not" → "isn't", etc.
    if (strategy === Strategy.AGGRESSIVE) {
      result = result.replace(/\b(do +not)\b/gi, "don't");
      result = result.replace(/\b(is +not)\b/gi, "isn't");
      result = result.replace(/\b(are +not)\b/gi, "aren't");
      result = result.replace(/\b(will +not)\b/gi, "won't");
      result = result.replace(/\b(can +not)\b/gi, "can't");
      result = result.replace(/\b(should +not)\b/gi, "shouldn't");
      result = result.replace(/\b(would +not)\b/gi, "wouldn't");
      result = result.replace(/\b(could +not)\b/gi, "couldn't");
      result = result.replace(/\b(has +not)\b/gi, "hasn't");
      result = result.replace(/\b(have +not)\b/gi, "haven't");
      result = result.replace(/\b(does +not)\b/gi, "doesn't");
      result = result.replace(/\b(did +not)\b/gi, "didn't");
    }

    // Normalize whitespace
    result = result.replace(/[ \t]+/g, " ");
    result = result.replace(/\n{3,}/g, "\n\n");
    result = result.replace(/[ \t]+$/gm, "");

    return result.trim();
  }

  // -----------------------------------------------------------------------
  // prioritizeContent(sections, budget)
  // -----------------------------------------------------------------------

  /**
   * Select highest-priority content sections that fit within a token budget.
   *
   * Sections are expected to have a `heading` string and a `content` string,
   * plus an optional numeric `priority` (lower = more important, defaults to 50).
   *
   * @param {Array<{heading: string, content: string, priority?: number}>} sections
   * @param {number} budget — token budget
   * @param {object} [options]
   * @param {string} [options.strategy]
   * @param {number} [options.charsPerToken]
   * @returns {string} Reassembled content of selected sections.
   */
  prioritizeContent(sections, budget, options = {}) {
    const cpt = Number.isFinite(options.charsPerToken) && options.charsPerToken > 0
      ? options.charsPerToken
      : this.charsPerToken;

    if (!Array.isArray(sections) || sections.length === 0) {
      return "";
    }

    const budgetTokens = Math.max(1, Number.isFinite(budget) ? budget : 0);

    // Score each section and sort by priority (ascending: lower priority number = kept first).
    const scored = sections.map((s, i) => {
      const heading = String(s.heading ?? "");
      const content = String(s.content ?? "");
      const priority = Number.isFinite(s.priority) ? s.priority : 50;
      const totalText = heading ? heading + "\n" + content : content;
      const tokens = estimateTokens(totalText, cpt);
      // Tie-break by original index so sort is stable.
      return { heading, content, priority, tokens, totalText, index: i };
    });

    scored.sort((a, b) => a.priority - b.priority || a.index - b.index);

    let remaining = budgetTokens;
    const selected = [];

    for (const item of scored) {
      if (remaining >= item.tokens) {
        selected.push(item);
        remaining -= item.tokens;
        continue;
      }
      // Partial inclusion: try to fit a truncated version.
      if (remaining > 0 && item.tokens > 0) {
        const ratio = remaining / item.tokens;
        // Only keep partial if we can fit at least 50 % of the content.
        if (ratio >= 0.5) {
          const maxChars = Math.max(1, Math.floor(remaining * cpt));
          const truncated = this._truncateToCharBudget(item.totalText, maxChars);
          selected.push({ ...item, totalText: truncated, tokens: estimateTokens(truncated, cpt) });
        }
        break;
      }
      break;
    }

    // Rebuild in priority order with headings as section markers.
    const rebuilt = selected
      .sort((a, b) => a.index - b.index)
      .map((s) => (s.heading ? `${s.heading}\n${s.totalText}` : s.totalText))
      .join("\n\n");

    return rebuilt;
  }

  // -----------------------------------------------------------------------
  // estimateSavings(original, optimized)
  // -----------------------------------------------------------------------

  /**
   * Estimate tokens saved between original and optimized text.
   *
   * @param {string} original
   * @param {string} optimized
   * @param {number} [charsPerToken]
   * @returns {{ savedTokens: number, originalTokens: number, optimizedTokens: number,
   *             savingsPercent: number }}
   */
  estimateSavings(original, optimized, charsPerToken) {
    const cpt = Number.isFinite(charsPerToken) && charsPerToken > 0
      ? charsPerToken
      : this.charsPerToken;

    const originalTokens = estimateTokens(original, cpt);
    const optimizedTokens = estimateTokens(optimized, cpt);
    const savedTokens = Math.max(0, originalTokens - optimizedTokens);
    const savingsPercent = originalTokens > 0
      ? Math.round((savedTokens / originalTokens) * 1000) / 10
      : 0;

    return {
      savedTokens,
      originalTokens,
      optimizedTokens,
      savingsPercent,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  _extractText(prompt) {
    if (typeof prompt === "string") return prompt;
    if (!prompt) return "";
    if (typeof prompt.content === "string") return prompt.content;
    if (typeof prompt.text === "string") return prompt.text;
    return String(prompt);
  }

  _replacePhrase(text, pattern, replacement) {
    // Find the phrase as a standalone phrase (word-boundary delimited) and
    // replace it preserving surrounding whitespace.
    const regex = typeof pattern === "string"
      ? new RegExp(`\\b${this._escapeRegExp(pattern)}\\b`, "gi")
      : pattern;
    return text.replace(regex, replacement);
  }

  _escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  _splitIntoSections(text) {
    // Heuristic splitting: headings (lines ending with ":" or "##" markdown) or
    // double-newline-separated blocks.
    const lines = (text ?? "").split("\n");
    const sections = [];
    let currentHeading = "";
    let currentContent = [];
    let priority = 50;

    for (const line of lines) {
      // Detect headings: markdown H1-H3, or lines ending with ":" with short length
      const isMdHeading = /^#{1,3}\s+/.test(line);
      const isLabelHeading = /^[A-Z][A-Za-z\s]{3,40}:\s*$/.test(line.trim());

      if (isMdHeading || isLabelHeading) {
        if (currentContent.length > 0) {
          sections.push({
            heading: currentHeading,
            content: currentContent.join("\n"),
            priority,
          });
        }
        currentHeading = line.replace(/^#{1,3}\s+/, "").replace(/:$/, "").trim();
        currentContent = [];
        priority = isMdHeading ? 20 : 40; // markdown headings get higher priority
      } else {
        currentContent.push(line);
      }
    }

    // Flush final section
    if (currentContent.length > 0 || currentHeading) {
      sections.push({
        heading: currentHeading,
        content: currentContent.join("\n"),
        priority,
      });
    }

    // If no headings detected, split by double newlines
    if (sections.length <= 1 && currentContent.length > 0 && !currentHeading) {
      const parts = text.split(/\n\n+/);
      return parts.map((part, i) => ({
        heading: "",
        content: part.trim(),
        priority: 40 + i * 10,
      }));
    }

    return sections;
  }

  _truncateToCharBudget(text, maxChars) {
    const t = String(text ?? "");
    if (t.length <= maxChars) return t;
    const suffix = "\n\n[Content trimmed to fit budget.]";
    const keep = Math.max(1, maxChars - suffix.length);
    return t.slice(0, keep) + suffix;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

TokenOptimizer.Strategy = Strategy;

module.exports = {
  TokenOptimizer,
  Strategy,
  estimateTokens,
};
