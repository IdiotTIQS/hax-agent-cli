"use strict";

/**
 * SkillRecommender — recommends skills based on context, query relevance,
 * skill similarity, and learned usage patterns.
 *
 * Scoring dimensions:
 *   - Name match (exact/partial substring, weighted)
 *   - Description match (keyword overlap)
 *   - Tag overlap (shared tags between query-derived tokens and skill tags)
 *   - Usage frequency (how often the skill has been invoked)
 *   - Success rate (ratio of successful invocations)
 */

const { recordSkillUsage, getSkillUsageStats } = require('./usage');

// ── Scoring weights ─────────────────────────────────────────────────────────
const SCORE_WEIGHTS = Object.freeze({
  nameMatch: 0.30,
  descriptionMatch: 0.25,
  tagOverlap: 0.20,
  usageFrequency: 0.15,
  successRate: 0.10,
});

// ── Similarity / chain lookup tables ────────────────────────────────────────
const RELATED_SKILLS = Object.freeze({
  'code-review': ['debug', 'write-tests', 'refactor', 'security-review'],
  debug: ['code-review', 'write-tests', 'optimize', 'explain-code'],
  refactor: ['code-review', 'write-tests', 'optimize', 'document'],
  'write-tests': ['code-review', 'debug', 'refactor', 'ci-cd'],
  document: ['explain-code', 'refactor', 'code-review'],
  deploy: ['ci-cd', 'write-tests', 'security-review'],
  'security-review': ['code-review', 'deploy', 'audit-log'],
  optimize: ['debug', 'refactor', 'benchmark'],
  analyze: ['debug', 'optimize', 'benchmark'],
  'explain-code': ['document', 'refactor', 'code-review'],
});

const SKILL_CHAINS = Object.freeze({
  'add-feature': ['code-review', 'write-tests', 'refactor', 'deploy'],
  'fix-bug': ['debug', 'write-tests', 'code-review', 'deploy'],
  'onboard-project': ['explain-code', 'document', 'code-review'],
  'improve-performance': ['analyze', 'optimize', 'benchmark', 'code-review'],
  'security-audit': ['security-review', 'debug', 'code-review', 'deploy'],
  'full-ci': ['write-tests', 'code-review', 'refactor', 'deploy'],
  migrate: ['analyze', 'refactor', 'write-tests', 'deploy'],
});

// ── Constructor ─────────────────────────────────────────────────────────────

class SkillRecommender {
  /**
   * @param {object} [options]
   * @param {boolean} [options.trackHistory=true] — learn from recommendations made
   * @param {number}  [options.minScore=0.1] — minimum score to include in results
   */
  constructor(options = {}) {
    this._trackHistory = options.trackHistory !== false;
    this._minScore = typeof options.minScore === 'number' ? options.minScore : 0.1;

    /** @type {Map<string, {count: number, lastUsedAt: number}>} */
    this._usagePatterns = new Map();

    /** @type {Map<string, number>} — skill name → success ratio (0–1) */
    this._successRates = new Map();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Recommend skills matching a natural-language query.
   *
   * @param {string} query — user's request or task description
   * @param {Array<object>} availableSkills — list of skill objects (shape from registry.list())
   * @returns {Array<object>} ranked list of { skill, score, reasons: string[] }
   */
  recommend(query, availableSkills) {
    if (!query || !availableSkills || availableSkills.length === 0) {
      return [];
    }

    const ranked = this.rankByRelevance(query, availableSkills);

    return ranked.filter((entry) => entry.score >= this._minScore);
  }

  /**
   * Rank skills by relevance to a query. Returns all skills with scores,
   * sorted highest-first. Does not apply minScore filtering.
   *
   * @param {string} query
   * @param {Array<object>} skills
   * @returns {Array<{ skill: object, score: number, reasons: string[] }>}
   */
  rankByRelevance(query, skills) {
    const normalizedQuery = query.toLowerCase().trim();
    const queryWords = new Set(
      normalizedQuery.replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter(Boolean)
    );
    const queryTokens = this._tokenize(normalizedQuery);

    const maxUsage = this._maxUsageCount(skills);

    const results = skills.map((skill) => {
      const nameLower = (skill.name || '').toLowerCase();
      const descLower = (skill.description || '').toLowerCase();
      const tags = Array.isArray(skill.tags) ? skill.tags.map((t) => t.toLowerCase()) : [];

      const reasons = [];

      // ── 1. Name match ──
      let nameScore = 0;
      if (nameLower === normalizedQuery) {
        nameScore = 1.0;
        reasons.push('exact name match');
      } else if (nameLower.includes(normalizedQuery) || normalizedQuery.includes(nameLower)) {
        nameScore = 0.7;
        reasons.push('partial name match');
      } else {
        // Word-level overlap in name
        const nameWords = nameLower.split(/[^a-z0-9]+/).filter(Boolean);
        const overlap = nameWords.filter((w) => queryWords.has(w)).length;
        if (overlap > 0) {
          nameScore = Math.min(0.5, overlap / Math.max(nameWords.length, 1));
          reasons.push('name word overlap');
        }
      }

      // ── 2. Description match ──
      let descScore = 0;
      const descMatches = queryTokens.filter((t) => descLower.includes(t));
      if (descMatches.length > 0) {
        descScore = Math.min(1, descMatches.length / Math.max(queryTokens.length, 1));
        reasons.push('description match');
      }

      // ── 3. Tag overlap ──
      let tagScore = 0;
      const tagMatches = tags.filter((t) => queryTokens.includes(t) || normalizedQuery.includes(t));
      if (tagMatches.length > 0) {
        tagScore = Math.min(1, tagMatches.length / Math.max(tags.length || 1, 1));
        reasons.push('tag overlap');
      }

      // ── 4. Usage frequency ──
      let freqScore = 0;
      const usageCount = skill.usageCount || 0;
      if (usageCount > 0 && maxUsage > 0) {
        freqScore = Math.min(1, usageCount / Math.max(maxUsage, 1));
        if (freqScore > 0.5) reasons.push('frequently used');
      }

      // ── 5. Success rate ──
      let successScore = this._successRates.get(skill.name) || 0.5; // neutral default
      if (successScore > 0.8) reasons.push('high success rate');

      // ── Composite score ──
      const score =
        nameScore * SCORE_WEIGHTS.nameMatch +
        descScore * SCORE_WEIGHTS.descriptionMatch +
        tagScore * SCORE_WEIGHTS.tagOverlap +
        freqScore * SCORE_WEIGHTS.usageFrequency +
        successScore * SCORE_WEIGHTS.successRate;

      return { skill, score: Math.round(score * 1000) / 1000, reasons };
    });

    // Sort descending by score, then by usage count as tiebreaker
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.skill.usageCount || 0) - (a.skill.usageCount || 0);
    });

    // Track search hits via the existing usage module
    if (this._trackHistory && results.length > 0) {
      recordSkillUsage(results[0].skill.name);
    }

    return results;
  }

  /**
   * Find skills related to a given skill (by name or skill object).
   *
   * @param {string|object} skill — skill name string or skill object with .name
   * @returns {Array<string>} list of related skill names
   */
  getSimilarSkills(skill) {
    const name = typeof skill === 'string' ? skill.toLowerCase() : (skill.name || '').toLowerCase();
    if (!name) return [];

    // Direct lookup
    const direct = RELATED_SKILLS[name] || [];

    // Also look for reciprocal relationships (skills that list `name` as related)
    const reciprocal = [];
    for (const [key, related] of Object.entries(RELATED_SKILLS)) {
      if (key !== name && related.includes(name) && !direct.includes(key)) {
        reciprocal.push(key);
      }
    }

    return [...direct, ...reciprocal];
  }

  /**
   * Suggest a sequence of skills for a complex task.
   *
   * @param {string} task — task name (e.g., "add-feature", "fix-bug", "security-audit")
   *                       or a free-text description
   * @param {Array<object>} [availableSkills] — optionally filter to installed skills
   * @returns {{ chain: Array<string>, alternatives: Array<Array<string>> }}
   */
  getSkillChain(task) {
    const key = task.toLowerCase().trim();

    // Direct chain lookup
    const chain = SKILL_CHAINS[key] || [];

    // If no exact chain, try fuzzy matching
    if (chain.length === 0) {
      const tokens = this._tokenize(key);
      let bestChain = null;
      let bestOverlap = 0;

      for (const [chainKey, steps] of Object.entries(SKILL_CHAINS)) {
        const chainTokens = new Set(this._tokenize(chainKey));
        const overlap = tokens.filter((t) => chainTokens.has(t)).length;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestChain = steps;
        }
      }

      if (bestOverlap > 0 && bestChain) {
        return { chain: bestChain, alternatives: this._buildAlternatives(bestChain) };
      }

      return { chain: [], alternatives: [] };
    }

    return { chain, alternatives: this._buildAlternatives(chain) };
  }

  /**
   * Learn from a skill usage record to improve future recommendations.
   *
   * @param {{ skill: string, success: boolean, duration?: number, query?: string }} usage
   */
  learn(usage) {
    if (!usage || !usage.skill) return;

    const skillName = usage.skill;

    // Track usage pattern
    const existing = this._usagePatterns.get(skillName) || { count: 0, lastUsedAt: 0 };
    existing.count += 1;
    existing.lastUsedAt = Date.now();
    this._usagePatterns.set(skillName, existing);

    // Track success rate (exponential moving average)
    const currentRate = this._successRates.get(skillName) || 0.5;
    const successVal = usage.success ? 1 : 0;
    // Smoothing factor: weight recent results more but keep history
    const alpha = 0.2;
    const newRate = currentRate + alpha * (successVal - currentRate);
    this._successRates.set(skillName, Math.round(newRate * 1000) / 1000);

    // Record via existing usage module
    recordSkillUsage(skillName);
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /** @private Tokenize a string into meaningful lowercase tokens. */
  _tokenize(str) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .split(/[\s-]+/)
      .filter((t) => t.length > 0);
  }

  /** @private Find the maximum usage count among a list of skills. */
  _maxUsageCount(skills) {
    let max = 0;
    for (const s of skills) {
      if ((s.usageCount || 0) > max) max = s.usageCount;
    }
    return max;
  }

  /** @private Build alternative chains for a given chain. */
  _buildAlternatives(chain) {
    const alternatives = [];
    for (let i = 0; i < chain.length; i++) {
      const similar = this.getSimilarSkills(chain[i]);
      if (similar.length > 0) {
        const alt = [...chain];
        alt[i] = similar[0]; // substitute with most relevant similar
        alternatives.push(alt);
      }
    }
    return alternatives;
  }
}

// ── Convenience exports ─────────────────────────────────────────────────────

/**
 * Quick one-shot recommendation without constructing an instance.
 */
function recommendSkills(query, availableSkills, options) {
  return new SkillRecommender(options).recommend(query, availableSkills);
}

/**
 * Quick one-shot ranking.
 */
function rankSkills(query, skills, options) {
  return new SkillRecommender(options).rankByRelevance(query, skills);
}

module.exports = {
  SkillRecommender,
  recommendSkills,
  rankSkills,
  SCORE_WEIGHTS,
  RELATED_SKILLS,
  SKILL_CHAINS,
};
