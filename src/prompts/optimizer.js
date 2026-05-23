"use strict";

/**
 * Prompt optimizer — suggests and applies improvements to prompt templates
 * based on performance history, A/B experiment results, and heuristic rules.
 *
 * The optimizer analyses a prompt template alongside historical outcome data
 * (success rate, token cost, user satisfaction, tool accuracy) and proposes
 * concrete edits: shortening verbose sections, clarifying ambiguous
 * instructions, adding illustrative examples, restructuring for readability,
 * and specialising for a target domain.
 *
 * It also supports automated tuning — iteratively refining a template by
 * applying suggestions and re-evaluating against a held-out dataset.
 *
 * Usage
 * -----
 *   const opt = new PromptOptimizer();
 *   const suggestions = opt.suggestImprovements(templateFn, history);
 *   const improved = opt.autoTune(templateFn, 5);
 *   const comp = opt.compareVariants(variantA, variantB);
 *   const best = opt.getBestVariant(experimentResults);
 */

const { ABTestEngine } = require("./ab-test");

// ---------------------------------------------------------------------------
// Optimisation strategy identifiers
// ---------------------------------------------------------------------------

const Strategy = Object.freeze({
  SHORTEN: "shorten",
  CLARIFY: "clarify",
  ADD_EXAMPLES: "add_examples",
  RESTRUCTURE: "restructure",
  SPECIALIZE: "specialize",
});

const ALL_STRATEGIES = Object.values(Strategy);

// ---------------------------------------------------------------------------
// PromptOptimizer
// ---------------------------------------------------------------------------

class PromptOptimizer {
  /**
   * @param {object} [options]
   * @param {ABTestEngine} [options.abEngine] — Pre-configured A/B engine for
   *   running variant comparisons.
   * @param {number} [options.minImprovementThreshold=0.05] — Minimum
   *   composite-score improvement to consider a suggestion worthwhile.
   * @param {Array<string>} [options.enabledStrategies] — Subset of strategies
   *   to use.  Defaults to all.
   */
  constructor(options = {}) {
    this._abEngine = options.abEngine || new ABTestEngine();
    this._minImprovementThreshold =
      Number.isFinite(options.minImprovementThreshold) && options.minImprovementThreshold > 0
        ? options.minImprovementThreshold
        : 0.05;

    const enabled = Array.isArray(options.enabledStrategies) && options.enabledStrategies.length > 0
      ? options.enabledStrategies.filter((s) => ALL_STRATEGIES.includes(s))
      : ALL_STRATEGIES;
    this._enabledStrategies = enabled;
  }

  // -----------------------------------------------------------------------
  // suggestImprovements(template, history)
  // -----------------------------------------------------------------------

  /**
   * Analyse a prompt template against historical performance data and return
   * a ranked list of improvement suggestions.
   *
   * @param {Function|string} template  — A template function (ctx) => string
   *   or a raw prompt string.
   * @param {Array<object>} history     — Historical trial records, each with:
   *   { context: object, scores: { successRate?, tokenEfficiency?,
   *     userSatisfaction?, toolAccuracy? }, templateText: string }
   * @param {object} [options]
   * @param {object} [options.context]  — Context to pass when template is a function.
   * @returns {Array<object>} Ranked suggestions, each with:
   *   { strategy, description, before, after, estimatedImprovement }
   */
  suggestImprovements(template, history, options = {}) {
    const templateText = this._resolveTemplate(template, options.context || {});
    const suggestions = [];

    if (!Array.isArray(history) || history.length === 0) {
      // No history — return heuristic-only suggestions
      suggestions.push(...this._heuristicSuggestions(templateText));
      return suggestions;
    }

    // Score the template against history
    const baselineScore = this._computeHistoryScore(history);

    for (const strategy of this._enabledStrategies) {
      const results = this._applyStrategy(strategy, templateText, history, baselineScore);
      if (results.length > 0) {
        suggestions.push(...results);
      }
    }

    // Deduplicate and rank by estimated improvement (descending)
    const seen = new Set();
    const unique = [];
    for (const s of suggestions) {
      const key = `${s.strategy}|${s.description}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(s);
      }
    }

    unique.sort((a, b) => (b.estimatedImprovement || 0) - (a.estimatedImprovement || 0));

    return unique;
  }

  // -----------------------------------------------------------------------
  // autoTune(template, iterations)
  // -----------------------------------------------------------------------

  /**
   * Automatically refine a prompt template through iterative improvement.
   *
   * Each iteration: analyse current template → pick best suggestion → apply
   * it → re-evaluate.  Stops early if no suggestion meets the improvement
   * threshold.
   *
   * @param {Function|string} template  — Template function or raw prompt.
   * @param {number} iterations         — Maximum tuning iterations (default 5).
   * @param {object} [options]
   * @param {Array<object>} [options.history]  — Historical data to guide tuning.
   * @param {object} [options.context]         — Context for template functions.
   * @returns {object}
   *   { original, optimized, iterations, history: Array<{before,after,strategy}> }
   */
  autoTune(template, iterations, options = {}) {
    const maxIter = Number.isFinite(iterations) && iterations > 0
      ? Math.min(iterations, 20)
      : 5;
    const context = options.context || {};
    const history = Array.isArray(options.history) ? options.history : [];

    let current = this._resolveTemplate(template, context);
    const original = current;
    const tuningHistory = [];

    for (let i = 0; i < maxIter; i++) {
      const suggestions = this.suggestImprovements(current, history, { context });

      if (suggestions.length === 0) break;

      const best = suggestions[0];
      if (!best.after || best.after === current) break;
      if (best.estimatedImprovement < this._minImprovementThreshold) break;

      tuningHistory.push({
        iteration: i + 1,
        strategy: best.strategy,
        description: best.description,
        estimatedImprovement: best.estimatedImprovement,
        beforeLength: current.length,
        afterLength: best.after.length,
      });

      current = best.after;
    }

    return {
      original,
      optimized: current,
      iterations: tuningHistory.length,
      history: tuningHistory,
      originalLength: original.length,
      optimizedLength: current.length,
      lengthReduction: original.length - current.length,
      lengthReductionPercent:
        original.length > 0
          ? Math.round(((original.length - current.length) / original.length) * 1000) / 10
          : 0,
    };
  }

  // -----------------------------------------------------------------------
  // compareVariants(a, b)
  // -----------------------------------------------------------------------

  /**
   * Produce a detailed side-by-side comparison of two prompt variants.
   *
   * Each variant should be an object with shape:
   *   { name: string, template: string|Function,
   *     scores?: Array<object>, metadata?: object }
   *
   * @param {object} variantA
   * @param {object} variantB
   * @param {object} [options]
   * @param {object} [options.context]  — Context for template functions.
   * @returns {object}
   */
  compareVariants(variantA, variantB, options = {}) {
    const context = options.context || {};
    const textA = this._resolveTemplate(variantA.template, context);
    const textB = this._resolveTemplate(variantB.template, context);

    const comparison = {
      variantA: { name: variantA.name || "Variant A", length: textA.length },
      variantB: { name: variantB.name || "Variant B", length: textB.length },
      structural: {},
      content: {},
      scores: null,
    };

    // Structural comparison
    comparison.structural = this._compareStructure(textA, textB);
    comparison.content = this._compareContent(textA, textB);

    // Score-based comparison if both have scores
    if (
      Array.isArray(variantA.scores) &&
      variantA.scores.length > 0 &&
      Array.isArray(variantB.scores) &&
      variantB.scores.length > 0
    ) {
      comparison.scores = this._compareScoreDistributions(
        variantA.scores,
        variantB.scores
      );
    }

    return comparison;
  }

  // -----------------------------------------------------------------------
  // getBestVariant(experiment)
  // -----------------------------------------------------------------------

  /**
   * Determine the best-performing variant from an experiment result object.
   *
   * Accepts either:
   *   (a) An experiment name string — delegates to the internal A/B engine.
   *   (b) A results object of shape { variants: Array<{ name, compositeMean,
   *       trials, dimensions }> } from ABTestEngine.getResults().
   *
   * @param {string|object} experiment
   * @returns {object|null} { name, compositeMean, trials, dimensions } or null.
   */
  getBestVariant(experiment) {
    let results;

    if (typeof experiment === "string") {
      try {
        results = this._abEngine.getResults(experiment);
      } catch (_err) {
        return null;
      }
    } else if (experiment && Array.isArray(experiment.variants)) {
      results = experiment;
    } else {
      return null;
    }

    if (!results.variants || results.variants.length === 0) return null;

    // Already sorted by compositeMean descending in getResults
    const best = results.variants[0];

    return {
      name: best.name,
      compositeMean: best.compositeMean,
      trials: best.trials,
      dimensions: best.dimensions ? { ...best.dimensions } : {},
    };
  }

  // -----------------------------------------------------------------------
  // getAbEngine()
  // -----------------------------------------------------------------------

  /**
   * Return the underlying ABTestEngine instance for direct access.
   *
   * @returns {ABTestEngine}
   */
  getAbEngine() {
    return this._abEngine;
  }

  // -----------------------------------------------------------------------
  // Strategy applicators
  // -----------------------------------------------------------------------

  /**
   * Apply one optimisation strategy and return candidate suggestions.
   */
  _applyStrategy(strategy, templateText, history, baselineScore) {
    switch (strategy) {
      case Strategy.SHORTEN:
        return this._suggestShorten(templateText, history, baselineScore);
      case Strategy.CLARIFY:
        return this._suggestClarify(templateText, history, baselineScore);
      case Strategy.ADD_EXAMPLES:
        return this._suggestAddExamples(templateText, history, baselineScore);
      case Strategy.RESTRUCTURE:
        return this._suggestRestructure(templateText, history, baselineScore);
      case Strategy.SPECIALIZE:
        return this._suggestSpecialize(templateText, history, baselineScore);
      default:
        return [];
    }
  }

  /**
   * SHORTEN — Identify verbose sections and propose trimmed alternatives.
   */
  _suggestShorten(text, history, baselineScore) {
    const suggestions = [];

    // 1. Find long lines (>120 chars) that could be split or shortened
    const lines = text.split("\n");
    const longLineIndices = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 120) {
        longLineIndices.push(i);
      }
    }

    // Only suggest if there are multiple long lines
    if (longLineIndices.length >= 3) {
      const shortened = lines.map((line, idx) => {
        if (longLineIndices.includes(idx) && line.length > 160) {
          // Attempt to split on clause boundaries
          const splitPoints = this._findSplitPoints(line);
          if (splitPoints.length > 0) {
            const mid = splitPoints[Math.floor(splitPoints.length / 2)];
            return line.slice(0, mid).trim() + "\n  " + line.slice(mid).trim();
          }
          // Fallback: truncate filler words
          return this._trimVerbosePhrases(line);
        }
        return line;
      });

      suggestions.push({
        strategy: Strategy.SHORTEN,
        description: `Break ${longLineIndices.length} overly long lines (>120 chars) for readability`,
        before: text,
        after: shortened.join("\n"),
        estimatedImprovement: this._estimateImprovement(text, shortened.join("\n"), baselineScore),
      });
    }

    // 2. Remove redundant headings (e.g. repeated "##" sections)
    const headingCount = (text.match(/^#{1,3}\s+/gm) || []).length;
    if (headingCount > 5) {
      const deduped = this._deduplicateSectionHeadings(text);
      if (deduped !== text) {
        suggestions.push({
          strategy: Strategy.SHORTEN,
          description: `Consolidate ${headingCount} section headings — some appear redundant`,
          before: text,
          after: deduped,
          estimatedImprovement: this._estimateImprovement(text, deduped, baselineScore),
        });
      }
    }

    // 3. Remove excessive blank lines
    const blankLineCount = (text.match(/\n\s*\n/g) || []).length;
    if (blankLineCount > 10) {
      const compacted = text.replace(/\n{3,}/g, "\n\n");
      suggestions.push({
        strategy: Strategy.SHORTEN,
        description: `Remove excessive blank lines (${blankLineCount} found)`,
        before: text,
        after: compacted,
        estimatedImprovement: this._estimateImprovement(text, compacted, baselineScore),
      });
    }

    // 4. Replace verbose phrases with concise alternatives
    const trimmed = this._trimVerbosePhrases(text);
    if (trimmed !== text) {
      suggestions.push({
        strategy: Strategy.SHORTEN,
        description: "Replace verbose phrases with concise alternatives",
        before: text,
        after: trimmed,
        estimatedImprovement: this._estimateImprovement(text, trimmed, baselineScore),
      });
    }

    return suggestions;
  }

  /**
   * CLARIFY — Detect ambiguous or vague instructions and propose clearer wording.
   */
  _suggestClarify(text, history, baselineScore) {
    const suggestions = [];

    const ambiguousPatterns = [
      { pattern: /\bhandle\s+errors\b/i, suggestion: "Specify exact error types, logging format, and user-facing messages" },
      { pattern: /\bappropriate(ly)?\b/i, suggestion: "Replace 'appropriate(ly)' with specific criteria or metrics" },
      { pattern: /\bif necessary\b/i, suggestion: "Define conditions under which the action IS necessary" },
      { pattern: /\bwhen possible\b/i, suggestion: "Specify constraints that make the action impossible vs. possible" },
      { pattern: /\bas needed\b/i, suggestion: "Replace 'as needed' with concrete trigger conditions" },
      { pattern: /\bgood\b/i, suggestion: "Define 'good' with measurable criteria" },
      { pattern: /\brelevant\b/i, suggestion: "Define what makes content 'relevant' (scope, domain, keywords)" },
      { pattern: /\breasonable\b/i, suggestion: "Replace 'reasonable' with concrete limits or thresholds" },
    ];

    for (const { pattern, suggestion } of ambiguousPatterns) {
      const matches = (text.match(pattern) || []);
      if (matches.length > 0) {
        suggestions.push({
          strategy: Strategy.CLARIFY,
          description: `Clarify vague term "${matches[0]}" — ${suggestion}`,
          before: text,
          after: text, // Clarification requires human judgement; flag for review
          estimatedImprovement: Math.min(0.08, 0.02 * matches.length),
          requiresManualReview: true,
          matches,
        });
      }
    }

    // Detect missing action verbs at the start of bullet lists
    const bulletLines = text.match(/^[-*]\s+\w.*$/gm) || [];
    const vagueBullets = bulletLines.filter((line) =>
      /\b(consider|think about|be aware|understand|appreciate|note)\b/i.test(line)
    );
    if (vagueBullets.length > 0) {
      suggestions.push({
        strategy: Strategy.CLARIFY,
        description: `${vagueBullets.length} bullet points use weak verbs (consider/understand). Replace with actionable directives.`,
        before: text,
        after: text,
        estimatedImprovement: 0.04,
        requiresManualReview: true,
        vagueBullets,
      });
    }

    return suggestions;
  }

  /**
   * ADD_EXAMPLES — Identify sections that would benefit from concrete examples.
   */
  _suggestAddExamples(text, history, baselineScore) {
    const suggestions = [];

    // Detect sections that describe expected output formats without examples
    const formatSections = text.match(/##\s+(Output Format|Response Format|Expected Output)[\s\S]*?(?=##\s|$)/gi) || [];
    for (const section of formatSections) {
      if (!/example|sample|e\.g\.|```/i.test(section)) {
        const after = text.replace(
          section,
          section.trimEnd() +
            "\n\n### Example\n```\n[Provide a concrete example of the expected format]\n```\n"
        );
        suggestions.push({
          strategy: Strategy.ADD_EXAMPLES,
          description: "Output format section lacks concrete examples — add an illustrative sample",
          before: text,
          after,
          estimatedImprovement: this._estimateImprovement(text, after, baselineScore),
        });
      }
    }

    // Detect lists of rules/guidelines without examples
    const ruleSections = text.match(/###\s+\d+\.\s+\w[\s\S]*?(?=###|##|$)/gi) || [];
    let rulesWithoutExamples = 0;
    for (const section of ruleSections) {
      const lines = section.split("\n");
      const ruleLines = lines.filter((l) => l.trim().startsWith("- "));
      const hasExamples = lines.some((l) => /example|e\.g\.|i\.e\.|such as/i.test(l));
      if (ruleLines.length >= 3 && !hasExamples) {
        rulesWithoutExamples++;
      }
    }

    if (rulesWithoutExamples > 0) {
      suggestions.push({
        strategy: Strategy.ADD_EXAMPLES,
        description: `${rulesWithoutExamples} rule sections with 3+ rules lack examples — add e.g. illustrations`,
        before: text,
        after: text,
        estimatedImprovement: Math.min(0.06, 0.015 * rulesWithoutExamples),
        requiresManualReview: true,
      });
    }

    return suggestions;
  }

  /**
   * RESTRUCTURE — Reorganise content for better flow and scannability.
   */
  _suggestRestructure(text, history, baselineScore) {
    const suggestions = [];

    // 1. Detect mixed content: instructions interleaved with background
    const sections = this._parseSections(text);
    const instructionSections = sections.filter((s) =>
      /how to|steps?|process|protocol|do the following|you must/i.test(s.heading)
    );

    if (instructionSections.length >= 1) {
      // Check if instructions are at the end (preferred) or scattered
      const firstInstructionIdx = sections.findIndex((s) =>
        instructionSections.includes(s)
      );
      const lastIdx = sections.length - 1;
      if (firstInstructionIdx >= 0 && firstInstructionIdx < lastIdx - 1) {
        // Move all instruction sections to the end
        const nonInstruction = sections.filter((s) => !instructionSections.includes(s));
        const reordered = [...nonInstruction, ...instructionSections];
        const after = reordered
          .map((s) => (s.heading ? `## ${s.heading}\n${s.body}` : s.body))
          .join("\n\n");

        suggestions.push({
          strategy: Strategy.RESTRUCTURE,
          description: "Move instruction/process sections to the end for better flow.",
          before: text,
          after,
          estimatedImprovement: this._estimateImprovement(text, after, baselineScore),
        });
      }
    }

    // 2. Detect very long sections without sub-headings
    for (const section of sections) {
      const bodyLength = (section.body || "").length;
      const lineCount = (section.body || "").split("\n").length;
      if (bodyLength > 500 && lineCount > 15 && !/^#{1,4}\s/m.test(section.body)) {
        const subsectioned = this._autoSubsection(section.body);
        const after = text.replace(section.body, subsectioned);
        suggestions.push({
          strategy: Strategy.RESTRUCTURE,
          description: `Section "${section.heading}" is long (${bodyLength} chars) without sub-headings — add structure`,
          before: text,
          after,
          estimatedImprovement: this._estimateImprovement(text, after, baselineScore),
        });
        break; // One restructuring suggestion per call is enough
      }
    }

    // 3. Add a summary/TL;DR at the top if missing
    if (!/summary|overview|tl;dr/i.test(sections[0]?.heading || "") && text.length > 800) {
      const summaryBlock = "## Summary\n\n[Brief 2-3 sentence overview of the task and expected outcome]\n\n---\n\n";
      suggestions.push({
        strategy: Strategy.RESTRUCTURE,
        description: "Add a summary section at the top for quick orientation.",
        before: text,
        after: summaryBlock + text,
        estimatedImprovement: 0.03,
        requiresManualReview: true,
      });
    }

    return suggestions;
  }

  /**
   * SPECIALIZE — Tailor generic language to a specific domain or task type.
   */
  _suggestSpecialize(text, history, baselineScore) {
    const suggestions = [];

    // 1. Detect overly generic role descriptions
    const genericRolePatterns = [
      { pattern: /\byou are an? (AI|assistant|agent|expert)\b/i, suggestion: "Specify domain expertise (e.g., 'You are a security auditor specialising in web applications')" },
      { pattern: /\byour goal is to help\b/i, suggestion: "Replace generic 'help' with the specific output expected" },
      { pattern: /\bthe provided code\b/i, suggestion: "Name the specific module, file, or component being analysed" },
      { pattern: /\bthe specified\b/i, suggestion: "Replace 'the specified' with concrete references" },
    ];

    for (const { pattern, suggestion } of genericRolePatterns) {
      if (pattern.test(text)) {
        suggestions.push({
          strategy: Strategy.SPECIALIZE,
          description: suggestion,
          before: text,
          after: text,
          estimatedImprovement: 0.04,
          requiresManualReview: true,
        });
      }
    }

    // 2. Check if domain context is available in history
    if (history && history.length > 0) {
      const domains = new Set();
      for (const record of history) {
        const ctx = record.context || {};
        if (ctx.language) domains.add(`language:${ctx.language}`);
        if (ctx.framework) domains.add(`framework:${ctx.framework}`);
        if (ctx.domain) domains.add(`domain:${ctx.domain}`);
      }

      if (domains.size > 0) {
        const domainList = [...domains].join(", ");
        suggestions.push({
          strategy: Strategy.SPECIALIZE,
          description: `Tailor template to observed domains: ${domainList}`,
          before: text,
          after: text,
          estimatedImprovement: 0.05,
          requiresManualReview: true,
          domains: [...domains],
        });
      }
    }

    return suggestions;
  }

  // -----------------------------------------------------------------------
  // Heuristic suggestions (no history required)
  // -----------------------------------------------------------------------

  _heuristicSuggestions(text) {
    const suggestions = [];

    // Length check
    if (text.length > 2000) {
      suggestions.push({
        strategy: Strategy.SHORTEN,
        description: `Prompt is ${text.length} chars — consider shortening for token efficiency`,
        before: text,
        after: text,
        estimatedImprovement: 0.1,
        requiresManualReview: true,
      });
    }

    // Detect missing sections common to well-structured prompts
    if (!/##\s+(Output Format|Response Format)/i.test(text)) {
      suggestions.push({
        strategy: Strategy.ADD_EXAMPLES,
        description: "Missing output format specification — add expected response structure",
        before: text,
        after: text,
        estimatedImprovement: 0.06,
        requiresManualReview: true,
      });
    }

    // Check for action clarity
    if (!/\b(must|should|will|always|never|do not)\b/i.test(text)) {
      suggestions.push({
        strategy: Strategy.CLARIFY,
        description: "No clear directives found — add explicit 'must'/'should' instructions",
        before: text,
        after: text,
        estimatedImprovement: 0.05,
        requiresManualReview: true,
      });
    }

    return suggestions;
  }

  // -----------------------------------------------------------------------
  // Structural comparison
  // -----------------------------------------------------------------------

  _compareStructure(textA, textB) {
    const linesA = textA.split("\n").length;
    const linesB = textB.split("\n").length;
    const headingsA = (textA.match(/^#{1,4}\s+/gm) || []).length;
    const headingsB = (textB.match(/^#{1,4}\s+/gm) || []).length;
    const bulletA = (textA.match(/^[-*]\s/gm) || []).length;
    const bulletB = (textB.match(/^[-*]\s/gm) || []).length;
    const codeBlocksA = (textA.match(/```/g) || []).length / 2;
    const codeBlocksB = (textB.match(/```/g) || []).length / 2;
    const avgLineLenA = linesA > 0 ? Math.round((textA.length / linesA) * 10) / 10 : 0;
    const avgLineLenB = linesB > 0 ? Math.round((textB.length / linesB) * 10) / 10 : 0;

    return {
      totalLines: { a: linesA, b: linesB, delta: linesB - linesA },
      totalChars: { a: textA.length, b: textB.length, delta: textB.length - textA.length },
      headingCount: { a: headingsA, b: headingsB, delta: headingsB - headingsA },
      bulletCount: { a: bulletA, b: bulletB, delta: bulletB - bulletA },
      codeBlockCount: { a: codeBlocksA, b: codeBlocksB, delta: codeBlocksB - codeBlocksA },
      avgLineLength: { a: avgLineLenA, b: avgLineLenB, delta: Math.round((avgLineLenB - avgLineLenA) * 10) / 10 },
    };
  }

  /**
   * Content-level comparison using basic text metrics.
   */
  _compareContent(textA, textB) {
    const wordsA = this._tokenizeWords(textA);
    const wordsB = this._tokenizeWords(textB);

    const setA = new Set(wordsA.map((w) => w.toLowerCase()));
    const setB = new Set(wordsB.map((w) => w.toLowerCase()));

    const intersection = [...setA].filter((w) => setB.has(w));
    const union = new Set([...setA, ...setB]);

    const jaccardSimilarity =
      union.size > 0 ? Math.round((intersection.length / union.size) * 1000) / 10 : 0;

    const uniqueToA = [...setA].filter((w) => !setB.has(w));
    const uniqueToB = [...setB].filter((w) => !setA.has(w));

    // Estimate reading level using Automated Readability Index (ARI)
    const ariA = this._automatedReadabilityIndex(textA);
    const ariB = this._automatedReadabilityIndex(textB);

    return {
      jaccardSimilarity,
      uniqueWordCount: { a: setA.size, b: setB.size },
      uniqueToA: uniqueToA.slice(0, 30), // Top 30 to keep output manageable
      uniqueToB: uniqueToB.slice(0, 30),
      readability: {
        a: Math.round(ariA * 10) / 10,
        b: Math.round(ariB * 10) / 10,
      },
    };
  }

  /**
   * Compare score distributions between two variants.
   */
  _compareScoreDistributions(scoresA, scoresB) {
    const dimensions = ["successRate", "tokenEfficiency", "userSatisfaction", "toolAccuracy"];
    const comparison = {};

    for (const dim of dimensions) {
      const valsA = scoresA
        .map((s) => s[dim])
        .filter((v) => Number.isFinite(v));
      const valsB = scoresB
        .map((s) => s[dim])
        .filter((v) => Number.isFinite(v));

      if (valsA.length > 0 || valsB.length > 0) {
        const sumA = valsA.reduce((s, v) => s + v, 0);
        const sumB = valsB.reduce((s, v) => s + v, 0);
        const meanA = valsA.length > 0 ? sumA / valsA.length : 0;
        const meanB = valsB.length > 0 ? sumB / valsB.length : 0;

        comparison[dim] = {
          meanA: Math.round(meanA * 1000) / 1000,
          meanB: Math.round(meanB * 1000) / 1000,
          delta: Math.round((meanB - meanA) * 1000) / 1000,
          countA: valsA.length,
          countB: valsB.length,
        };
      }
    }

    return comparison;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  _resolveTemplate(template, context) {
    if (typeof template === "function") {
      try {
        const result = template(context);
        return typeof result === "string" ? result : String(result);
      } catch (_err) {
        return String(template);
      }
    }
    return String(template || "");
  }

  _computeHistoryScore(history) {
    if (!history || history.length === 0) return 0;

    let total = 0;
    let count = 0;
    const dims = ["successRate", "tokenEfficiency", "userSatisfaction", "toolAccuracy"];

    for (const record of history) {
      const scores = record.scores || {};
      let recordSum = 0;
      let recordCount = 0;
      for (const dim of dims) {
        if (Number.isFinite(scores[dim])) {
          recordSum += scores[dim];
          recordCount++;
        }
      }
      if (recordCount > 0) {
        total += recordSum / recordCount;
        count++;
      }
    }

    return count > 0 ? total / count : 0;
  }

  _estimateImprovement(before, after, baselineScore) {
    if (before === after) return 0;

    const beforeLen = before.length;
    const afterLen = after.length;

    // Token efficiency improvement (shorter = slightly better efficiency)
    let tokenGain = 0;
    if (beforeLen > 0 && afterLen < beforeLen) {
      const reductionRatio = (beforeLen - afterLen) / beforeLen;
      tokenGain = Math.min(0.03, reductionRatio * 0.05);
    }

    // If we have baseline scores, use them; otherwise rely on heuristics
    const baseGain = baselineScore > 0 ? 0.02 : 0.01;

    return Math.round((baseGain + tokenGain) * 1000) / 1000;
  }

  _findSplitPoints(line) {
    const points = [];
    // Look for natural split points: commas, semicolons, "and", "or"
    const delimiters = [", ", "; ", " and ", " or ", " but ", " however "];
    for (const delim of delimiters) {
      let idx = line.indexOf(delim);
      while (idx > 20 && idx < line.length - 20) {
        points.push(idx + delim.length);
        idx = line.indexOf(delim, idx + 1);
      }
    }
    points.sort((a, b) => a - b);
    return points;
  }

  _trimVerbosePhrases(text) {
    let result = text;
    const replacements = [
      [/\bin order to\b/gi, "to"],
      [/\bfor the purpose of\b/gi, "for"],
      [/\bdue to the fact that\b/gi, "because"],
      [/\bthe fact that\b/gi, "that"],
      [/\bin the event that\b/gi, "if"],
      [/\bat this point in time\b/gi, "now"],
      [/\ba number of\b/gi, "several"],
      [/\bthe majority of\b/gi, "most"],
      [/\bwith regard to\b/gi, "about"],
      [/\bwith respect to\b/gi, "about"],
      [/\bin the near future\b/gi, "soon"],
      [/\bin order to ensure that\b/gi, "to ensure"],
      [/\bmake sure that\b/gi, "ensure"],
      [/\bit is important to\b/gi, "must"],
      [/\bplease note that\b/gi, ""],
      [/\bit should be noted that\b/gi, ""],
      [/\bit is worth noting that\b/gi, ""],
    ];

    for (const [pattern, replacement] of replacements) {
      result = result.replace(pattern, replacement);
    }

    // Normalise whitespace
    result = result.replace(/[ \t]+/g, " ");
    result = result.replace(/[ \t]+\n/g, "\n");
    result = result.replace(/\n{3,}/g, "\n\n");

    return result.trim();
  }

  _deduplicateSectionHeadings(text) {
    const seen = new Set();
    const lines = text.split("\n");
    const result = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        const key = headingMatch[2].toLowerCase().trim();
        if (seen.has(key)) {
          // Skip duplicate heading and its content until next heading
          while (i + 1 < lines.length && !/^#{1,3}\s+/.test(lines[i + 1])) {
            i++;
          }
          continue;
        }
        seen.add(key);
      }
      result.push(line);
    }

    return result.join("\n");
  }

  _parseSections(text) {
    const lines = text.split("\n");
    const sections = [];
    let currentHeading = "";
    let currentBody = [];

    for (const line of lines) {
      const headingMatch = line.match(/^#{1,4}\s+(.+)/);
      if (headingMatch) {
        if (currentBody.length > 0 || currentHeading) {
          sections.push({
            heading: currentHeading,
            body: currentBody.join("\n").trim(),
          });
        }
        currentHeading = headingMatch[1];
        currentBody = [];
      } else {
        currentBody.push(line);
      }
    }

    if (currentBody.length > 0 || currentHeading) {
      sections.push({
        heading: currentHeading,
        body: currentBody.join("\n").trim(),
      });
    }

    return sections;
  }

  _autoSubsection(body) {
    const lines = body.split("\n");
    // Insert subsection headings every ~8-12 lines for readability
    const result = [];
    let counter = 1;

    for (let i = 0; i < lines.length; i++) {
      if (i > 0 && i % 10 === 0 && lines[i].trim().length > 0) {
        result.push(`#### Part ${counter}`);
        counter++;
      }
      result.push(lines[i]);
    }

    return result.join("\n");
  }

  _tokenizeWords(text) {
    return (text.match(/\b[a-z]{3,}\b/gi) || []).filter((w) => w.length > 2);
  }

  /**
   * Automated Readability Index.
   * ARI = 4.71 * (chars / words) + 0.5 * (words / sentences) - 21.43
   */
  _automatedReadabilityIndex(text) {
    const chars = text.replace(/\s/g, "").length;
    const words = (text.match(/\b\w+\b/g) || []).length;
    const sentences = (text.match(/[.!?]+/g) || []).length;

    if (words === 0 || sentences === 0) return 0;

    const ari = 4.71 * (chars / words) + 0.5 * (words / sentences) - 21.43;
    return Math.max(0, ari);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

PromptOptimizer.Strategy = Strategy;

module.exports = { PromptOptimizer, Strategy };
