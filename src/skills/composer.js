"use strict";

const { SkillChain, CHAIN_TYPE, createChain, createParallel } = require("./chains");

/**
 * Recognised workflow patterns used by suggestChain() to map a human-
 * readable goal onto a chain structure.
 *
 * Each entry contains:
 *  - keywords: array of trigger words/phrases
 *  - steps: array of step descriptors — skill names or {skill, type} tuples
 *  - type: top-level chain type
 *  - description: human summary of the suggested pattern
 */
const KNOWN_PATTERNS = Object.freeze([
  // ── code workflow patterns ──────────────────────────────────
  {
    name: "code-review",
    keywords: ["code review", "review code", "pull request review", "pr review", "audit code"],
    steps: [
      { skill: "code-analyzer", type: CHAIN_TYPE.SEQUENCE },
      { skill: "lint-checker", type: CHAIN_TYPE.PARALLEL },
      { skill: "security-scanner", type: CHAIN_TYPE.PARALLEL },
      { skill: "review-summary", type: CHAIN_TYPE.SEQUENCE },
    ],
    description: "Runs code analysis and security scanning in parallel, then produces a review summary.",
  },
  {
    name: "refactor",
    keywords: ["refactor", "restructure", "clean up code", "technical debt"],
    steps: [
      { skill: "code-analyzer", type: CHAIN_TYPE.SEQUENCE },
      { skill: "refactor-engine", type: CHAIN_TYPE.SEQUENCE },
      { skill: "test-runner", type: CHAIN_TYPE.SEQUENCE },
      { skill: "lint-checker", type: CHAIN_TYPE.SEQUENCE },
    ],
    description: "Sequentially analyses, refactors, tests, and lints code to reduce technical debt.",
  },
  {
    name: "test-suite",
    keywords: ["run tests", "test suite", "unit tests", "integration tests", "validate"],
    steps: [
      { skill: "unit-test-runner", type: CHAIN_TYPE.PARALLEL },
      { skill: "integration-test-runner", type: CHAIN_TYPE.PARALLEL },
      { skill: "test-reporter", type: CHAIN_TYPE.SEQUENCE },
    ],
    description: "Runs unit and integration tests in parallel, then aggregates results.",
  },

  // ── deployment workflow patterns ────────────────────────────
  {
    name: "deploy",
    keywords: ["deploy", "release", "publish", "ship", "production deploy"],
    steps: [
      { skill: "build-project", type: CHAIN_TYPE.SEQUENCE },
      { skill: "test-runner", type: CHAIN_TYPE.SEQUENCE },
      { skill: "security-scanner", type: CHAIN_TYPE.PARALLEL },
      { skill: "deploy-target", type: CHAIN_TYPE.SEQUENCE },
      { skill: "health-check", type: CHAIN_TYPE.SEQUENCE },
    ],
    description: "Builds, tests, scans, deploys, and verifies — typical CI/CD pipeline.",
  },
  {
    name: "rollback",
    keywords: ["rollback", "revert deploy", "undo release", "back out"],
    steps: [
      { skill: "rollback-engine", type: CHAIN_TYPE.SEQUENCE },
      { skill: "health-check", type: CHAIN_TYPE.SEQUENCE },
      { skill: "notify-team", type: CHAIN_TYPE.SEQUENCE },
    ],
    description: "Reverses the last deployment, verifies stability, and notifies the team.",
  },

  // ── data workflow patterns ──────────────────────────────────
  {
    name: "data-pipeline",
    keywords: ["data pipeline", "etl", "extract transform load", "data processing", "ingest data"],
    steps: [
      { skill: "data-extractor", type: CHAIN_TYPE.SEQUENCE },
      { skill: "data-transformer", type: CHAIN_TYPE.SEQUENCE },
      { skill: "data-validator", type: CHAIN_TYPE.SEQUENCE },
      { skill: "data-loader", type: CHAIN_TYPE.SEQUENCE },
    ],
    description: "Classic ETL: extract, transform, validate, and load data.",
  },
  {
    name: "data-sync",
    keywords: ["sync data", "synchronize", "replicate data", "mirror data"],
    steps: [
      { skill: "source-reader", type: CHAIN_TYPE.SEQUENCE },
      { skill: "diff-engine", type: CHAIN_TYPE.SEQUENCE },
      { skill: "target-writer", type: CHAIN_TYPE.SEQUENCE },
    ],
    description: "Reads from source, computes diff, and writes changes to target.",
  },

  // ── documentation workflow patterns ─────────────────────────
  {
    name: "generate-docs",
    keywords: ["generate docs", "documentation", "api docs", "readme", "changelog"],
    steps: [
      { skill: "code-analyzer", type: CHAIN_TYPE.SEQUENCE },
      { skill: "docs-generator", type: CHAIN_TYPE.SEQUENCE },
      { skill: "format-checker", type: CHAIN_TYPE.SEQUENCE },
    ],
    description: "Analyses codebase, generates documentation, and checks formatting.",
  },

  // ── monitoring workflow patterns ────────────────────────────
  {
    name: "incident-response",
    keywords: ["incident", "outage", "downtime", "alert triage", "on-call"],
    steps: [
      { skill: "log-collector", type: CHAIN_TYPE.PARALLEL },
      { skill: "metric-scraper", type: CHAIN_TYPE.PARALLEL },
      { skill: "correlation-engine", type: CHAIN_TYPE.SEQUENCE },
      { skill: "incident-reporter", type: CHAIN_TYPE.SEQUENCE },
    ],
    description: "Gathers logs and metrics in parallel, correlates findings, and creates an incident report.",
  },
  {
    name: "health-check",
    keywords: ["health check", "status check", "is it up", "service status", "ping check"],
    steps: [
      { skill: "endpoint-checker", type: CHAIN_TYPE.PARALLEL },
      { skill: "aggregator", type: CHAIN_TYPE.SEQUENCE },
    ],
    description: "Checks all endpoints in parallel and produces an aggregated health report.",
  },

  // ── general workflow patterns ───────────────────────────────
  {
    name: "multi-step-analysis",
    keywords: ["analyze", "investigate", "diagnose", "troubleshoot", "debug issue"],
    steps: [
      { skill: "log-collector", type: CHAIN_TYPE.SEQUENCE },
      { skill: "pattern-detector", type: CHAIN_TYPE.SEQUENCE },
      { skill: "root-cause-analyzer", type: CHAIN_TYPE.SEQUENCE },
      { skill: "recommendation-engine", type: CHAIN_TYPE.SEQUENCE },
    ],
    description: "Sequential diagnostic pipeline: collect logs, detect patterns, find root cause, recommend fix.",
  },
]);

/**
 * Average expected durations (ms) for different skill categories — used
 * by `estimateChainDuration()`.
 */
const CATEGORY_DURATIONS = {
  // code
  "code-analyzer": 3_000,
  "lint-checker": 2_000,
  "security-scanner": 8_000,
  "review-summary": 1_500,
  "refactor-engine": 5_000,
  "test-runner": 10_000,
  "unit-test-runner": 6_000,
  "integration-test-runner": 12_000,
  "test-reporter": 1_000,

  // deployment
  "build-project": 30_000,
  "deploy-target": 15_000,
  "health-check": 3_000,
  "rollback-engine": 10_000,
  "notify-team": 500,

  // data
  "data-extractor": 5_000,
  "data-transformer": 4_000,
  "data-validator": 3_000,
  "data-loader": 6_000,
  "source-reader": 4_000,
  "diff-engine": 3_000,
  "target-writer": 5_000,

  // docs
  "docs-generator": 8_000,
  "format-checker": 1_500,

  // monitoring
  "log-collector": 3_000,
  "metric-scraper": 3_000,
  "correlation-engine": 2_000,
  "incident-reporter": 1_000,
  "endpoint-checker": 4_000,
  "aggregator": 500,

  // general
  "pattern-detector": 4_000,
  "root-cause-analyzer": 5_000,
  "recommendation-engine": 2_000,

  // default fallback
  _default: 5_000,
};

/**
 * Maximum size of the validation issue list returned by validateChain().
 */
const MAX_VALIDATION_ISSUES = 100;

/**
 * Chain kind rankings for the LRU-like optimisation cache.
 */
const OPTIMISATION_CACHE_MAX = 64;
const _optimisationCache = new Map();

// ────────────────────────────────────────────────────────────────
// SkillComposer — AI-assisted skill composition
// ────────────────────────────────────────────────────────────────
class SkillComposer {
  /**
   * @param {object} [options]
   * @param {Array<object>} [options.availableSkills] - Known skills for suggestion.
   * @param {boolean} [options.cacheOptimisations] - Cache optimisation results.
   */
  constructor(options = {}) {
    this._availableSkills = Array.isArray(options.availableSkills)
      ? options.availableSkills
      : [];
    this._cacheOptimisations = options.cacheOptimisations !== false;
  }

  // ── skill registry helpers ──────────────────────────────────

  /**
   * Set or update the list of available skills the composer knows about.
   *
   * @param {Array<object>} skills
   */
  setAvailableSkills(skills) {
    this._availableSkills = Array.isArray(skills) ? skills : [];
  }

  /**
   * Returns the currently registered skills.
   *
   * @returns {Array<object>}
   */
  getAvailableSkills() {
    return [...this._availableSkills];
  }

  /**
   * Look up a skill by name (exact match).
   *
   * @param {string} name
   * @returns {object|null}
   */
  _findSkill(name) {
    return this._availableSkills.find(
      (s) => s.name === name || s.displayName === name,
    ) || null;
  }

  // ── suggestion engine ───────────────────────────────────────

  /**
   * Suggest a skill chain for a given goal by matching against known
   * workflow patterns.
   *
   * @param {string} goal - Natural-language description of the goal.
   * @param {object} [options]
   * @param {number} [options.maxSuggestions=3] - Max patterns to return.
   * @param {boolean} [options.requireAvailable=false] - Only include patterns whose skills are available.
   * @returns {Array<{pattern: string, description: string, chain: SkillChain, confidence: number}>}
   */
  suggestChain(goal, options = {}) {
    const {
      maxSuggestions = 3,
      requireAvailable = false,
    } = options;

    if (!goal || typeof goal !== "string" || goal.trim().length === 0) {
      return [];
    }

    const query = goal.toLowerCase().trim();
    const scored = [];

    for (const pattern of KNOWN_PATTERNS) {
      let score = 0;

      // Keyword-based scoring
      for (const kw of pattern.keywords) {
        if (query.includes(kw.toLowerCase())) {
          score += kw.length; // longer matches get higher weight
          if (query.startsWith(kw.toLowerCase())) score += 20; // starts-with bonus
        }
      }

      // If the goal contains the pattern name itself
      if (query.includes(pattern.name.toLowerCase())) {
        score += 30;
      }

      // Availability check — penalise for missing skills
      let availabilityPenalty = 0;
      if (requireAvailable) {
        for (const step of pattern.steps) {
          if (!this._findSkill(step.skill)) {
            availabilityPenalty -= 50;
          }
        }
        // Require ALL skills to be available
        if (availabilityPenalty < 0) {
          score = Math.min(score, -1);
        }
      }

      if (score > 0) {
        scored.push({ pattern, score: score + availabilityPenalty });
      }
    }

    // Sort by descending score
    scored.sort((a, b) => b.score - a.score);

    // Take top N
    const top = scored.slice(0, maxSuggestions);

    // Normalise confidence to 0..1 range
    const maxScore = top.length ? Math.max(...top.map((s) => s.score)) : 1;

    return top.map(({ pattern }) => {
      const chain = this._patternToChain(pattern);
      return {
        pattern: pattern.name,
        description: pattern.description,
        chain,
        confidence: maxScore > 0 ? Math.min(1, pattern.keywords.length / Math.max(1, scored.length)) : 0.5,
      };
    });
  }

  // ── optimisation ────────────────────────────────────────────

  /**
   * Optimise a chain for execution efficiency.
   *
   * The optimiser looks for:
   *  1. Consecutive independent nodes that could run in parallel.
   *  2. Empty / no-op nodes that can be removed.
   *  3. Chains that can be flattened to reduce nesting.
   *
   * @param {SkillChain} chain
   * @returns {SkillChain} A new optimised chain (the original is not mutated).
   */
  optimizeChain(chain) {
    if (!(chain instanceof SkillChain)) {
      throw new TypeError("optimizeChain() expects a SkillChain instance.");
    }

    // Check cache
    const cacheKey = this._cacheKey(chain);
    if (this._cacheOptimisations && _optimisationCache.has(cacheKey)) {
      return _optimisationCache.get(cacheKey);
    }

    const optimized = new SkillChain({
      id: `opt-${chain.id}`,
      name: `optimized-${chain.name}`,
      timeout: chain._options.timeout,
      continueOnError: chain._options.continueOnError,
      maxIterations: chain._options.maxIterations,
    });

    optimized.type = chain.type;

    const flatNodes = this._flattenNodes(chain.nodes);
    const grouped = this._groupParallelisable(flatNodes);

    for (const group of grouped) {
      if (group.length === 1) {
        const single = group[0];
        if (single.children && single.children.length === 0 && !single.skill && !single.chain) {
          // Remove no-op nodes
          continue;
        }
        optimized.nodes.push(single);
      } else {
        // Multiple parallelisable nodes — wrap in a PARALLEL group
        optimized.parallel(group);
      }
    }

    // Cache the result
    if (this._cacheOptimisations) {
      _optimisationCache.set(cacheKey, optimized);
      if (_optimisationCache.size > OPTIMISATION_CACHE_MAX) {
        const firstKey = _optimisationCache.keys().next().value;
        _optimisationCache.delete(firstKey);
      }
    }

    return optimized;
  }

  // ── validation ──────────────────────────────────────────────

  /**
   * Validate a chain and return a list of issues.
   *
   * Checks performed:
   *  - Chain has at least one node.
   *  - All nodes have valid types.
   *  - Conditional / loop nodes have condition functions.
   *  - Fallback nodes have fallback definitions.
   *  - No circular references (chain nesting depth).
   *  - No duplicate node IDs.
   *
   * @param {SkillChain} chain
   * @returns {{ valid: boolean, issues: Array<{severity: string, nodeId: string, message: string}> }}
   */
  validateChain(chain) {
    if (!(chain instanceof SkillChain)) {
      return {
        valid: false,
        issues: [{
          severity: "error",
          nodeId: null,
          message: "Expected a SkillChain instance.",
        }],
      };
    }

    const issues = [];

    // Empty chain
    if (!chain.nodes || chain.nodes.length === 0) {
      issues.push({
        severity: "warning",
        nodeId: chain.id,
        message: "Chain has no nodes — it will pass input through unchanged.",
      });
    }

    // Validate nodes recursively
    const seenIds = new Set();
    this._validateNodes(chain.nodes, seenIds, issues, 0);

    // Truncate to max
    const truncated = issues.slice(0, MAX_VALIDATION_ISSUES);

    return {
      valid: truncated.every((i) => i.severity !== "error"),
      issues: truncated,
    };
  }

  // ── duration estimation ─────────────────────────────────────

  /**
   * Estimate the total execution duration (ms) for a given chain.
   *
   * The estimator respects chain types:
   *  - SEQUENCE: sum of children
   *  - PARALLEL: max of children
   *  - CONDITIONAL / LOOP / FALLBACK: uses the primary node's estimate
   *
   * @param {SkillChain} chain
   * @returns {{ total: number, breakdown: Array<{nodeId: string, estimate: number}> }}
   */
  estimateChainDuration(chain) {
    if (!(chain instanceof SkillChain)) {
      throw new TypeError("estimateChainDuration() expects a SkillChain instance.");
    }

    const breakdown = [];
    const total = this._estimateDuration(chain.nodes, breakdown);

    return { total, breakdown };
  }

  /**
   * Register a custom category duration for use in estimation.
   *
   * @param {string} skillName
   * @param {number} durationMs
   */
  setDurationEstimate(skillName, durationMs) {
    CATEGORY_DURATIONS[skillName] = Math.max(0, Number(durationMs) || 0);
  }

  /**
   * Return the current duration lookup table (shallow copy).
   *
   * @returns {object}
   */
  getDurationEstimates() {
    return { ...CATEGORY_DURATIONS };
  }

  // ── internal: pattern-to-chain ──────────────────────────────

  _patternToChain(pattern) {
    const chain = new SkillChain({ name: pattern.name });
    chain.type = CHAIN_TYPE.SEQUENCE;

    // Group consecutive steps by type so we can alternate sequence / parallel
    let i = 0;
    while (i < pattern.steps.length) {
      const step = pattern.steps[i];
      const stepType = step.type || CHAIN_TYPE.SEQUENCE;

      if (stepType === CHAIN_TYPE.PARALLEL) {
        // Collect all consecutive parallel steps
        const parallelSteps = [];
        while (i < pattern.steps.length && (pattern.steps[i].type || CHAIN_TYPE.SEQUENCE) === CHAIN_TYPE.PARALLEL) {
          const skillInfo = this._findSkill(pattern.steps[i].skill) || { name: pattern.steps[i].skill };
          parallelSteps.push({
            id: `suggested-${pattern.steps[i].skill}`,
            name: pattern.steps[i].skill,
            skill: skillInfo.handler || null,
            config: { skillName: pattern.steps[i].skill },
          });
          i++;
        }
        chain.parallel(parallelSteps);
      } else {
        // Sequential step
        const skillInfo = this._findSkill(step.skill) || { name: step.skill };
        chain.chain({
          id: `suggested-${step.skill}`,
          name: step.skill,
          skill: skillInfo.handler || null,
          config: { skillName: step.skill },
        });
        i++;
      }
    }

    return chain;
  }

  // ── internal: optimisation helpers ──────────────────────────

  _flattenNodes(nodes) {
    const result = [];
    for (const node of nodes) {
      // If the node is itself a parallel group, keep its children as-is but flatten
      if (node.type === CHAIN_TYPE.PARALLEL && node.children && node.children.length > 0) {
        // Parallel groups stay grouped
        result.push(node);
      } else if (node.chain) {
        // Flatten sub-chain nodes
        result.push(...this._flattenNodes(node.chain.nodes));
      } else {
        result.push(node);
      }
    }
    return result;
  }

  /**
   * Group consecutive nodes that could run in parallel.
   * Two nodes are parallelisable if:
   *  1. They do not depend on each other's output (we assume independence
   *     by default; a node that explicitly depends on the previous is flagged).
   *  2. They are both simple (no sub-chains with side effects).
   */
  _groupParallelisable(nodes) {
    if (nodes.length <= 1) return [nodes];

    const groups = [];
    let currentGroup = [nodes[0]];

    for (let i = 1; i < nodes.length; i++) {
      const prev = nodes[i - 1];
      const curr = nodes[i];

      // Can this node be parallelised with the previous one?
      const canParallelize =
        prev.type !== CHAIN_TYPE.PARALLEL &&
        curr.type !== CHAIN_TYPE.PARALLEL &&
        !curr._dependsOnPrevious &&
        !prev._affectsNext;

      if (canParallelize) {
        currentGroup.push(curr);
      } else {
        groups.push(currentGroup);
        currentGroup = [curr];
      }
    }

    groups.push(currentGroup);

    // Return groups as-is — the caller wraps multi-node groups in parallel()
    return groups;
  }

  _cacheKey(chain) {
    // Simple deterministic key based on node IDs
    const keys = chain.nodes.map((n) => n.id).join(",");
    return `${chain.id}|${keys}`;
  }

  // ── internal: validation helpers ────────────────────────────

  _validateNodes(nodes, seenIds, issues, depth) {
    if (depth > 50) {
      issues.push({
        severity: "error",
        nodeId: null,
        message: "Maximum chain nesting depth exceeded (50). Possible circular reference.",
      });
      return;
    }

    const validTypes = Object.values(CHAIN_TYPE);

    for (const node of nodes) {
      // Duplicate ID check
      if (seenIds.has(node.id)) {
        issues.push({
          severity: "error",
          nodeId: node.id,
          message: `Duplicate node ID "${node.id}".`,
        });
      } else {
        seenIds.add(node.id);
      }

      // Type check
      if (!validTypes.includes(node.type)) {
        issues.push({
          severity: "error",
          nodeId: node.id,
          message: `Invalid node type "${node.type}". Must be one of: ${validTypes.join(", ")}.`,
        });
      }

      // Type-specific checks
      if (node.type === CHAIN_TYPE.CONDITIONAL && typeof node._condition !== "function") {
        issues.push({
          severity: "error",
          nodeId: node.id,
          message: "CONDITIONAL node is missing its condition function.",
        });
      }

      if (node.type === CHAIN_TYPE.LOOP && typeof node._whileCondition !== "function") {
        issues.push({
          severity: "error",
          nodeId: node.id,
          message: "LOOP node is missing its while-condition function.",
        });
      }

      if (node.type === CHAIN_TYPE.FALLBACK && !node._fallback) {
        issues.push({
          severity: "warning",
          nodeId: node.id,
          message: "FALLBACK node has no fallback defined. It will throw on primary failure.",
        });
      }

      // No skill/handler and no children — is effectively a no-op
      if (!node.skill && !node.chain && (!node.children || node.children.length === 0)) {
        issues.push({
          severity: "info",
          nodeId: node.id,
          message: "Node has no handler, no sub-chain, and no children. It will pass input through.",
        });
      }

      // Recurse into children
      if (node.children && node.children.length) {
        this._validateNodes(node.children, seenIds, issues, depth + 1);
      }
    }
  }

  // ── internal: duration estimation helpers ───────────────────

  _estimateDuration(nodes, breakdown) {
    if (!nodes || nodes.length === 0) return 0;

    let total = 0;
    let maxInGroup = 0;

    for (const node of nodes) {
      let estimate = 0;

      if (node.chain instanceof SkillChain) {
        // Recurse into sub-chain
        const subEstimate = this._estimateDuration(node.chain.nodes, breakdown);
        estimate = subEstimate;
      } else if (node.skill && node.config && node.config.skillName) {
        // Named skill lookup
        estimate = CATEGORY_DURATIONS[node.config.skillName] || CATEGORY_DURATIONS._default;
      } else if (node.skill) {
        // Unknown handler — use default
        estimate = CATEGORY_DURATIONS._default;
      } else if (node.type === CHAIN_TYPE.PARALLEL && node.children && node.children.length) {
        // Parallel node: children run concurrently — take max, not sum
        let maxChild = 0;
        for (const child of node.children) {
          const childEst = this._estimateSingleNode(child);
          breakdown.push({ nodeId: child.id, estimate: childEst });
          if (childEst > maxChild) maxChild = childEst;
        }
        estimate = maxChild;
      } else if (node.children && node.children.length) {
        estimate = this._estimateDuration(node.children, breakdown);
      } else {
        // No-op or pass-through
        estimate = 100; // minimal overhead
      }

      breakdown.push({ nodeId: node.id, estimate });

      if (node.type === CHAIN_TYPE.PARALLEL) {
        maxInGroup = Math.max(maxInGroup, estimate);
      } else {
        // Flush any pending parallel group
        total += maxInGroup;
        maxInGroup = 0;
        total += estimate;
      }
    }

    // Flush remaining parallel group
    total += maxInGroup;

    return total;
  }

  /**
   * Estimate a single leaf node without recursing into children for
   * the top-level _estimateDuration loop.  Used when we need per-child
   * estimates inside a PARALLEL group (where we take max, not sum).
   *
   * @param {object} node
   * @returns {number}
   */
  _estimateSingleNode(node) {
    if (node.skill && node.config && node.config.skillName) {
      return CATEGORY_DURATIONS[node.config.skillName] || CATEGORY_DURATIONS._default;
    }
    if (node.skill) {
      return CATEGORY_DURATIONS._default;
    }
    if (node.children && node.children.length) {
      let maxChild = 0;
      for (const child of node.children) {
        const childEst = this._estimateSingleNode(child);
        if (childEst > maxChild) maxChild = childEst;
      }
      return maxChild;
    }
    return 100;
  }
}

// ────────────────────────────────────────────────────────────────
// Standalone convenience exports
// ────────────────────────────────────────────────────────────────

/**
 * Quick factory: create a SkillComposer pre-loaded with the given skills.
 *
 * @param {Array<object>} skills
 * @returns {SkillComposer}
 */
function createComposer(skills = []) {
  return new SkillComposer({ availableSkills: skills });
}

module.exports = {
  SkillComposer,
  KNOWN_PATTERNS,
  CATEGORY_DURATIONS,
  MAX_VALIDATION_ISSUES,
  createComposer,
};
