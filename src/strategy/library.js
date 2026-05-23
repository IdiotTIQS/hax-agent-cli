"use strict";

/**
 * Pre-built strategy library for HaxAgent.
 *
 * Each strategy conforms to:
 *   { name, type, config, evaluate(context), execute(context) }
 *
 * Strategy types (from registry STRATEGY_CATEGORIES):
 *   toolSelection, taskPlanning, errorRecovery, contextManagement, responseFormatting
 */

const STRATEGY_LIBRARY = Object.freeze([
  // ── toolSelection ──────────────────────────────────────────
  {
    name: "ConservativeRepair",
    type: "toolSelection",
    config: Object.freeze({
      maxChanges: 3,
      preferReadOnly: true,
      requireConfirmation: true,
      backupBeforeChange: true,
      riskTolerance: 0.2,
    }),

    evaluate(context) {
      if (!context) return 0.5;
      // high score for safe, low-risk environments
      let score = 0.5;
      if (context.riskLevel === "low") score += 0.3;
      if (context.needsAudit) score += 0.2;
      if (context.riskLevel === "high") score -= 0.2;
      if (context.preferSpeed) score -= 0.3;
      return Math.max(0, Math.min(1, score));
    },

    async execute(context) {
      const tools = this._selectSafeTools(context);
      if (tools.length === 0) {
        throw new Error("ConservativeRepair: no safe tools available");
      }
      return {
        strategy: "ConservativeRepair",
        tools,
        config: { ...this.config },
        approach: "minimal_changes_maximum_safety",
      };
    },

    _selectSafeTools(context) {
      const available = (context && context.availableTools) || [];
      const readOnlyTools = ["read", "grep", "glob", "search", "list", "stat", "diff"];
      return available.filter(
        (t) => readOnlyTools.includes(String(t).toLowerCase())
      );
    },
  },

  // ── taskPlanning ───────────────────────────────────────────
  {
    name: "AggressiveOptimize",
    type: "taskPlanning",
    config: Object.freeze({
      boldRefactoring: true,
      acceptRisk: true,
      maxSteps: 20,
      skipVerification: false,
      parallelizeSubtasks: true,
      riskTolerance: 0.8,
    }),

    evaluate(context) {
      if (!context) return 0.5;
      let score = 0.5;
      if (context.preferSpeed) score += 0.4;
      if (context.riskLevel === "high") score -= 0.3;
      if (context.largeScope) score += 0.2;
      if (context.needsAudit) score -= 0.25;
      return Math.max(0, Math.min(1, score));
    },

    async execute(context) {
      const steps = this._generateSteps(context);
      const results = [];
      for (const step of steps) {
        results.push({ step, status: "planned" });
      }
      return {
        strategy: "AggressiveOptimize",
        steps,
        results,
        config: { ...this.config },
        approach: "bold_refactoring_accept_risk",
      };
    },

    _generateSteps(context) {
      const task = (context && context.task) || "unknown";
      return [
        `Analyze ${task} for optimization surface area`,
        `Apply aggressive refactoring to ${task}`,
        `Inline and simplify redundancies`,
        `Verify core functionality intact`,
      ];
    },
  },

  // ── taskPlanning ───────────────────────────────────────────
  {
    name: "ExploreFirst",
    type: "taskPlanning",
    config: Object.freeze({
      maxExplorationDepth: 5,
      collectContext: true,
      buildMentalModel: true,
      delayAction: true,
      riskTolerance: 0.4,
    }),

    evaluate(context) {
      if (!context) return 0.5;
      let score = 0.5;
      if (context.complexDomain) score += 0.3;
      if (context.unfamiliarCodebase) score += 0.25;
      if (context.preferSpeed) score -= 0.3;
      if (context.simpleTask) score -= 0.2;
      return Math.max(0, Math.min(1, score));
    },

    async execute(context) {
      const explorationPlan = this._buildExplorationPlan(context);
      return {
        strategy: "ExploreFirst",
        explorationPlan,
        config: { ...this.config },
        approach: "understand_deeply_before_acting",
      };
    },

    _buildExplorationPlan(context) {
      const target = (context && context.task) || "codebase";
      return [
        { phase: "map", action: `Map the structure of ${target}` },
        { phase: "trace", action: `Trace key dependencies in ${target}` },
        { phase: "understand", action: `Build mental model of ${target}` },
        { phase: "act", action: `Execute changes based on understanding` },
      ];
    },
  },

  // ── taskPlanning ───────────────────────────────────────────
  {
    name: "IncrementalDelivery",
    type: "taskPlanning",
    config: Object.freeze({
      stepSize: "small",
      verifyEachStep: true,
      rollbackOnFailure: true,
      maxBatchSize: 1,
      riskTolerance: 0.3,
    }),

    evaluate(context) {
      if (!context) return 0.5;
      let score = 0.5;
      if (context.needsAudit) score += 0.3;
      if (context.productionEnvironment) score += 0.25;
      if (context.preferSpeed) score -= 0.2;
      if (context.riskToleranceLow) score += 0.2;
      return Math.max(0, Math.min(1, score));
    },

    async execute(context) {
      const steps = this._decomposeIntoSlices(context);
      const results = [];
      for (const step of steps) {
        results.push({ step, verified: false, status: "pending" });
      }
      return {
        strategy: "IncrementalDelivery",
        slices: results,
        config: { ...this.config },
        approach: "small_steps_verify_each",
      };
    },

    _decomposeIntoSlices(context) {
      const task = (context && context.task) || "task";
      return [
        `Slice 1: Setup and validation for ${task}`,
        `Slice 2: Core implementation of ${task}`,
        `Slice 3: Testing and verification of ${task}`,
        `Slice 4: Cleanup and documentation for ${task}`,
      ];
    },
  },

  // ── taskPlanning ───────────────────────────────────────────
  {
    name: "ParallelInvestigate",
    type: "taskPlanning",
    config: Object.freeze({
      maxParallelBranches: 5,
      mergeStrategy: "best",
      timeoutPerBranchMs: 30000,
      independentOnly: true,
      riskTolerance: 0.5,
    }),

    evaluate(context) {
      if (!context) return 0.5;
      let score = 0.5;
      if (context.searchSpaceWide) score += 0.35;
      if (context.canParallelize) score += 0.25;
      if (context.resourceConstrained) score -= 0.3;
      if (context.linearDependency) score -= 0.4;
      return Math.max(0, Math.min(1, score));
    },

    async execute(context) {
      const branches = this._forkBranches(context);
      // simulate parallel exploration
      const results = branches.map((b) => ({
        branch: b.name,
        finding: `Explored: ${b.path}`,
        confidence: b.confidence,
      }));
      return {
        strategy: "ParallelInvestigate",
        branches: results,
        config: { ...this.config },
        approach: "explore_multiple_paths_simultaneously",
      };
    },

    _forkBranches(context) {
      const count = Math.min(
        this.config.maxParallelBranches,
        (context && context.branchCount) || 3
      );
      const branches = [];
      for (let i = 0; i < count; i += 1) {
        branches.push({
          name: `branch-${i + 1}`,
          path: `path/to/solution-${i + 1}`,
          confidence: 0.5 + Math.random() * 0.4,
        });
      }
      return branches;
    },
  },

  // ── errorRecovery ──────────────────────────────────────────
  {
    name: "FallbackChain",
    type: "errorRecovery",
    config: Object.freeze({
      chain: ["primary", "secondary", "tertiary", "fallback"],
      propagateAfterExhaustion: true,
      logEachFallback: true,
      riskTolerance: 0.6,
    }),

    evaluate(context) {
      if (!context) return 0.5;
      let score = 0.5;
      if (context.criticalOperation) score += 0.3;
      if (context.hasFallbacks) score += 0.25;
      if (context.singlePointOfFailure) score += 0.2;
      return Math.max(0, Math.min(1, score));
    },

    async execute(context) {
      const chain = this.config.chain.slice();
      const results = [];
      let lastError = null;

      for (const step of chain) {
        results.push({ step, attempted: true });
        // In practice, each step would be an actual operation.
        // Here we simulate: primary fails, secondary succeeds.
        if (step === "secondary") {
          return {
            strategy: "FallbackChain",
            resolvedBy: step,
            chain: results,
            config: { ...this.config },
            approach: "try_a_if_fail_try_b_if_fail_try_c",
          };
        }
        lastError = new Error(`${step} failed`);
      }

      if (lastError) {
        throw new Error(`FallbackChain exhausted: ${lastError.message}`);
      }
    },
  },

  // ── responseFormatting ─────────────────────────────────────
  {
    name: "MajorityVote",
    type: "responseFormatting",
    config: Object.freeze({
      voterCount: 3,
      acceptThreshold: 0.6,
      tieBreaker: "first",
      maxRoundMs: 30000,
      riskTolerance: 0.4,
    }),

    evaluate(context) {
      if (!context) return 0.5;
      let score = 0.5;
      if (context.needsConsensus) score += 0.35;
      if (context.highStakes) score += 0.2;
      if (context.preferSpeed) score -= 0.3;
      return Math.max(0, Math.min(1, score));
    },

    async execute(context) {
      const voterCount = this.config.voterCount;
      const votes = [];

      // simulate N approaches voting on the result
      for (let i = 0; i < voterCount; i += 1) {
        votes.push({
          voter: `approach-${i + 1}`,
          choice: this._generateVote(context, i),
          confidence: 0.6 + Math.random() * 0.35,
        });
      }

      // tally votes
      const tally = {};
      for (const v of votes) {
        tally[v.choice] = (tally[v.choice] || 0) + 1;
      }

      // find consensus
      const totalVotes = votes.length;
      const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
      const [winner, winnerCount] = sorted[0];
      const ratio = winnerCount / totalVotes;

      const consensus = ratio >= this.config.acceptThreshold;

      return {
        strategy: "MajorityVote",
        votes,
        tally,
        winner,
        winnerCount,
        consensus,
        config: { ...this.config },
        approach: "run_n_approaches_pick_consensus",
      };
    },

    _generateVote(context, index) {
      const options = (context && context.options) || ["option-a", "option-b", "option-c"];
      // deterministic-ish selection with variation
      if (index === 0) return options[0];
      if (index === 1 && options.length > 1) return options[1];
      return options[Math.min(index, options.length - 1)];
    },
  },
]);

/**
 * Look up a strategy by name.
 *
 * @param {string} name
 * @returns {object|null}
 */
function getStrategy(name) {
  return STRATEGY_LIBRARY.find((s) => s.name === name) || null;
}

/**
 * Get all strategies of a specific type.
 *
 * @param {string} type — one of STRATEGY_CATEGORIES
 * @returns {Array<object>}
 */
function getStrategiesByType(type) {
  return STRATEGY_LIBRARY.filter((s) => s.type === type);
}

/**
 * Get all strategy names.
 *
 * @returns {Array<string>}
 */
function getStrategyNames() {
  return STRATEGY_LIBRARY.map((s) => s.name);
}

module.exports = {
  STRATEGY_LIBRARY,
  getStrategy,
  getStrategiesByType,
  getStrategyNames,
};
