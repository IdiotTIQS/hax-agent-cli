"use strict";

/**
 * EffortEstimator -- quantitative effort estimation for task graphs.
 *
 * Analyses task type, scope indicators (file count, line delta, test
 * burden), and dependency complexity to produce per-task and aggregate
 * estimates with confidence intervals.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base hours per effort tier (best / expected / worst). */
const EFFORT_BASE = {
  S: { best: 0.5, expected: 1, worst: 3 },
  M: { best: 2, expected: 4, worst: 8 },
  L: { best: 6, expected: 16, worst: 32 },
  XL: { best: 24, expected: 40, worst: 80 },
};

/** Complexity multipliers based on indicators. */
const MULTIPLIERS = {
  fileCount: {
    low: 0.8,     // 0-2 files
    medium: 1.0,  // 3-8 files
    high: 1.5,    // 9-20 files
    extreme: 2.0, // 21+ files
  },
  testBurden: {
    none: 0.8,
    low: 1.0,
    medium: 1.3,
    high: 1.8,
  },
  dependencyComplexity: {
    none: 0.9,
    low: 1.0,     // 1-2 deps
    medium: 1.3,  // 3-5 deps
    high: 1.6,    // 6+ deps
  },
};

/** Type-based adjustment -- some task types inherently cost more. */
const TYPE_MULTIPLIER = {
  analyze: 0.7,
  audit: 0.7,
  plan: 0.6,
  spec: 0.6,
  design: 1.0,
  implement: 1.2,
  build: 1.1,
  fix: 0.8,
  extract: 1.0,
  test: 1.0,
  verify: 0.6,
  integrate: 1.3,
  document: 0.5,
  cleanup: 0.4,
  profile: 0.7,
  reproduce: 0.5,
  isolate: 1.0,
  hypothesize: 0.4,
  review: 0.6,
};

// ---------------------------------------------------------------------------
// EffortEstimator
// ---------------------------------------------------------------------------

class EffortEstimator {
  constructor(opts = {}) {
    this._base = Object.assign({}, EFFORT_BASE, opts.baseEffort || {});
    this._multipliers = JSON.parse(JSON.stringify(MULTIPLIERS));
    if (opts.multipliers) {
      Object.assign(this._multipliers.fileCount, opts.multipliers.fileCount || {});
      Object.assign(this._multipliers.testBurden, opts.multipliers.testBurden || {});
      Object.assign(this._multipliers.dependencyComplexity, opts.multipliers.dependencyComplexity || {});
    }
    this._typeMultiplier = Object.assign({}, TYPE_MULTIPLIER, opts.typeMultiplier || {});
  }

  // ---- Primary API --------------------------------------------------------

  /**
   * Estimate effort for a single task.
   *
   * @param {object} task - task descriptor (at minimum { title?, type?, effort? })
   * @param {object} [context={}]
   * @param {number} [context.fileCount]       - how many files are affected
   * @param {number} [context.linesChanged]    - estimated line delta
   * @param {'none'|'low'|'medium'|'high'} [context.testBurden='low'] - testing overhead
   * @param {number} [context.dependencyCount] - number of task dependencies
   * @returns {{ tier: string, hours: { best: number, expected: number, worst: number }, totalHours: number, factors: object }}
   */
  estimateTask(task, context = {}) {
    const taskObj = task || {};

    // Determine base tier
    const tier = this._resolveTier(taskObj);

    // Base hours
    const base = this._base[tier] || this._base.M;

    // File-count multiplier
    const fileCount = Math.max(0, Number(context.fileCount) || 0);
    const fileTier = fileCount <= 2 ? "low" : fileCount <= 8 ? "medium" : fileCount <= 20 ? "high" : "extreme";
    const fileMult = this._multipliers.fileCount[fileTier] || 1.0;

    // Lines-changed adjustment (smooth: +10% per 100 lines, capped at 2x)
    const linesChanged = Math.max(0, Number(context.linesChanged) || 0);
    const linesMult = Math.min(2.0, 1.0 + linesChanged / 1000);

    // Test-burden multiplier
    const testBurden = context.testBurden || "low";
    const testMult = this._multipliers.testBurden[testBurden] || 1.0;

    // Dependency complexity
    const depCount = Math.max(0, Number(context.dependencyCount) || (Array.isArray(taskObj.dependsOn) ? taskObj.dependsOn.length : 0));
    const depTier = depCount <= 0 ? "none" : depCount <= 2 ? "low" : depCount <= 5 ? "medium" : "high";
    const depMult = this._multipliers.dependencyComplexity[depTier] || 1.0;

    // Type multiplier
    const typeMult = this._typeMultiplier[taskObj.type] || 1.0;

    // Combined multiplier
    const combinedMult = fileMult * linesMult * testMult * depMult * typeMult;

    const hours = {
      best: round2(base.best * combinedMult),
      expected: round2(base.expected * combinedMult),
      worst: round2(base.worst * combinedMult),
    };

    const totalHours = round2(hours.expected);

    return {
      tier,
      hours,
      totalHours,
      factors: {
        fileCount,
        fileTier,
        fileMultiplier: fileMult,
        linesChanged,
        linesMultiplier: round2(linesMult),
        testBurden,
        testMultiplier: testMult,
        dependencyCount: depCount,
        dependencyTier: depTier,
        dependencyMultiplier: depMult,
        typeMultiplier: typeMult,
        combinedMultiplier: round2(combinedMult),
      },
    };
  }

  /**
   * Aggregate estimates across a project (array of tasks).
   *
   * @param {object[]} tasks
   * @param {object} [context] - default context applied to each task
   * @returns {{ tasks: object[], aggregate: { best: number, expected: number, worst: number } }}
   */
  estimateProject(tasks, context = {}) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return { tasks: [], aggregate: { best: 0, expected: 0, worst: 0 } };
    }

    const estimates = tasks.map((task) => this.estimateTask(task, context));
    const aggregate = estimates.reduce(
      (acc, est) => ({
        best: round2(acc.best + est.hours.best),
        expected: round2(acc.expected + est.hours.expected),
        worst: round2(acc.worst + est.hours.worst),
      }),
      { best: 0, expected: 0, worst: 0 },
    );

    return { tasks: estimates, aggregate };
  }

  /**
   * Compute a confidence interval from an array of effort estimates.
   *
   * @param {{ hours: { best: number, expected: number, worst: number } }[]} estimates
   * @returns {{ best: number, expected: number, worst: number, range: string }}
   */
  confidenceInterval(estimates) {
    if (!Array.isArray(estimates) || estimates.length === 0) {
      return { best: 0, expected: 0, worst: 0, range: "0h" };
    }

    let best = 0;
    let expected = 0;
    let worst = 0;

    for (const est of estimates) {
      // Support both { hours: {...} } and { ... } shapes
      const h = est.hours || est;
      best += h.best || 0;
      expected += h.expected || 0;
      worst += h.worst || 0;
    }

    return {
      best: round2(best),
      expected: round2(expected),
      worst: round2(worst),
      range: `${round2(best)}h – ${round2(worst)}h`,
    };
  }

  /**
   * Compare an estimate with actual effort, returning variance metrics.
   *
   * @param {{ hours: { best: number, expected: number, worst: number } }} estimate
   * @param {number} actualHours
   * @returns {{ variance: number, percentOff: number, withinRange: boolean, assessment: string }}
   */
  trackVsEstimate(estimate, actualHours) {
    const h = (estimate && estimate.hours) ? estimate.hours : (estimate || {});
    const best = h.best || 0;
    const expected = h.expected || 0;
    const worst = h.worst || 0;
    const actual = Number(actualHours) || 0;

    const variance = round2(actual - expected);
    const percentOff = expected > 0 ? round2(Math.abs(variance) / expected * 100) : 0;
    const withinRange = actual >= best && actual <= worst;

    let assessment = "on target";
    if (!withinRange && actual < best) assessment = "underestimated (faster than best case)";
    else if (!withinRange && actual > worst * 1.5) assessment = "severely overrun";
    else if (!withinRange && actual > worst) assessment = "overrun";

    return { variance, percentOff, withinRange, assessment };
  }

  // ---- Internal helpers ---------------------------------------------------

  /**
   * Resolve the effort tier from a task object.
   * Uses explicit `task.effort`, or keyword heuristics from title/type.
   */
  _resolveTier(task) {
    if (task.effort && typeof task.effort === "string" && this._base[task.effort]) {
      return task.effort;
    }

    const text = [
      task.title || "",
      task.type || "",
      task.name || "",
    ].join(" ").toLowerCase();

    const indicators = [
      { re: /simple|trivial|minor|small|tiny|single|cosmetic/, tier: "S" },
      { re: /moderate|medium|few|some|update|change/, tier: "M" },
      { re: /large|significant|major|complex|many|multiple|extensive/, tier: "L" },
      { re: /massive|huge|entire|rewrite|ground\s*up|monumental/, tier: "XL" },
    ];

    for (const { re, tier } of indicators) {
      if (re.test(text)) return tier;
    }

    // Fallback based on type heuristics
    const quickTypes = { analyze: "S", spec: "S", design: "M", plan: "S",
      implement: "L", build: "L", test: "M", verify: "S", document: "S",
      integrate: "M", fix: "M", extract: "M", cleanup: "S", profile: "M" };
    if (task.type && quickTypes[task.type]) return quickTypes[task.type];

    return "M";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  EffortEstimator,
  EFFORT_BASE,
  MULTIPLIERS,
  TYPE_MULTIPLIER,
};
