"use strict";

/**
 * A/B test engine for prompt variants.
 *
 * Runs controlled experiments comparing different prompt templates or
 * strategies and reports which variant performs best across configurable
 * scoring dimensions: success rate, token efficiency, user satisfaction,
 * and tool accuracy.
 *
 * Trials are recorded per experiment and per variant. Variants are selected
 * using weighted randomisation so each variant receives a fair share of
 * trials. Once an experiment collects enough data the engine can declare a
 * statistically-significant winner via Welchʼs t-test.
 *
 * Usage
 * -----
 *   const engine = new ABTestEngine();
 *   engine.createExperiment("greeting-tone", [
 *     { name: "formal",   template: "Dear user, ..." },
 *     { name: "casual",   template: "Hey there! ..." },
 *   ]);
 *   const result = engine.run("greeting-tone", { userId: 1 });
 *   // ... collect scores via engine.recordScore(...)
 *   console.log(engine.getWinner("greeting-tone"));
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple seeded PRNG (mulberry32) so trials are reproducible when a seed
 * is supplied, yet default to Math.random when none is given.
 */
function createRng(seed) {
  if (seed === undefined || seed === null) {
    return Math.random;
  }
  let s = (seed >>> 0) || 1;
  return function mulberry32() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle using the supplied rng.
 */
function fisherYatesShuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Calculate mean of an array of numbers.
 */
function mean(values) {
  if (!values || values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

/**
 * Calculate sample variance (unbiased estimator, n-1 denominator).
 */
function variance(values) {
  if (!values || values.length < 2) return 0;
  const m = mean(values);
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - m;
    sumSq += d * d;
  }
  return sumSq / (values.length - 1);
}

/**
 * Welchʼs t-test for two independent samples with unequal variances.
 *
 * Returns { t, df, pValue } where pValue is the two-tailed probability.
 */
function welchTTest(sampleA, sampleB) {
  const nA = sampleA.length;
  const nB = sampleB.length;
  if (nA < 2 || nB < 2) return { t: 0, df: 0, pValue: 1 };

  const mA = mean(sampleA);
  const mB = mean(sampleB);
  const vA = variance(sampleA);
  const vB = variance(sampleB);

  const se = Math.sqrt(vA / nA + vB / nB);
  if (se === 0) return { t: 0, df: nA + nB - 2, pValue: 1 };

  const t = (mA - mB) / se;

  // Welch-Satterthwaite degrees of freedom
  const num = (vA / nA + vB / nB) ** 2;
  const den = ((vA / nA) ** 2) / (nA - 1) + ((vB / nB) ** 2) / (nB - 1);
  const df = den === 0 ? nA + nB - 2 : num / den;

  // Compute two-tailed p-value via regularised incomplete beta function
  const pValue = tDistributionPValue(Math.abs(t), df);

  return { t, df, pValue };
}

/**
 * Two-tailed p-value for t-distribution.
 *
 * Uses the regularised incomplete beta function approximation based on
 * Abramowitz & Stegun 26.7.1 with Press et al. continued fraction.
 */
function tDistributionPValue(t, df) {
  if (df <= 0) return 1;
  const x = df / (df + t * t);
  const p = incompleteBeta(x, df / 2, 0.5);
  // Clamp to [0, 1] to avoid floating-point artefacts
  return Math.max(0, Math.min(1, p));
}

/**
 * Regularised incomplete beta function I_x(a,b) via continued fraction.
 *
 * Lentzʼs algorithm as described in Numerical Recipes, §6.4.
 */
function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use the smaller of x and 1-x to reduce iterations for the continued fraction.
  const mirror = x > (a + 1) / (a + b + 2);
  const xx = mirror ? 1 - x : x;

  // Front factor: x^a * (1-x)^b / (a * B(a,b))
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  let front = Math.exp(Math.log(xx) * a + Math.log(1 - xx) * b - lnBeta) / a;

  // Lentz continued fraction for I_x(a,b)
  let f = 1;
  let c = 1;
  let d = 1 - (a + b) * xx / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  f = d;

  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;

    // d_{2m}
    let d2m = m * (b - m) * xx / ((a + m2 - 1) * (a + m2));
    d = 1 + d2m * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + d2m / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    f *= c * d;

    // d_{2m+1}
    let d2m1 = -(a + m) * (a + b + m) * xx / ((a + m2) * (a + m2 + 1));
    d = 1 + d2m1 * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + d2m1 / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = c * d;
    f *= del;

    if (Math.abs(del - 1) < 1e-12) break;
  }

  const result = front * (f - 1);

  // Apply mirror transformation if needed
  return mirror ? 1 - result : result;
}

/**
 * Log-gamma function (ln Γ(x)) using Stirlingʼs approximation.
 */
function lnGamma(x) {
  if (x <= 0) return NaN;
  if (x < 0.5) {
    // Reflection formula
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }

  // Stirling series
  const s = [
    1.000000000190015,
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    1.208650973866179e-3,
    -5.395239384953e-6,
  ];

  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = s[0];
  for (let i = 1; i < s.length; i++) {
    y += 1;
    ser += s[i] / y;
  }
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

// ---------------------------------------------------------------------------
// ABTestEngine
// ---------------------------------------------------------------------------

/**
 * Internal scoring dimension weights.  Can be overridden per experiment.
 */
const DEFAULT_WEIGHTS = Object.freeze({
  successRate: 0.40,
  tokenEfficiency: 0.25,
  userSatisfaction: 0.20,
  toolAccuracy: 0.15,
});

const SCORE_DIMENSIONS = Object.freeze([
  "successRate",
  "tokenEfficiency",
  "userSatisfaction",
  "toolAccuracy",
]);

/**
 * @typedef {object} VariantDef
 * @property {string} name          — Unique name within the experiment.
 * @property {string} template      — The prompt template string.
 * @property {object} [metadata]    — Arbitrary metadata attached to the variant.
 * @property {number} [weight]      — Relative weight for random selection (default 1).
 */

/**
 * @typedef {object} TrialRecord
 * @property {string} variantName
 * @property {object} context       — Snapshot of the context passed to run().
 * @property {number} timestamp
 * @property {object|null} scores   — Scores assigned after the trial completes.
 */

/**
 * @typedef {object} VariantStats
 * @property {string}   name
 * @property {number}   trials
 * @property {number}   compositeMean
 * @property {number}   compositeStdDev
 * @property {number[]} compositeScores
 * @property {{ mean: number, stdDev: number }} successRate
 * @property {{ mean: number, stdDev: number }} tokenEfficiency
 * @property {{ mean: number, stdDev: number }} userSatisfaction
 * @property {{ mean: number, stdDev: number }} toolAccuracy
 */

class ABTestEngine {
  /**
   * @param {object} [options]
   * @param {number} [options.significanceLevel=0.05]  — alpha threshold for t-test.
   * @param {number} [options.minTrialsPerVariant=10]  — minimum trials before
   *   a winner can be declared.
   * @param {object} [options.defaultWeights]
   */
  constructor(options = {}) {
    this._significanceLevel = Number.isFinite(options.significanceLevel)
      ? options.significanceLevel
      : 0.05;
    this._minTrialsPerVariant = Number.isFinite(options.minTrialsPerVariant)
      ? Math.max(1, options.minTrialsPerVariant)
      : 10;

    const userWeights = options.defaultWeights || {};
    this._defaultWeights = {};
    for (const dim of SCORE_DIMENSIONS) {
      this._defaultWeights[dim] = Number.isFinite(userWeights[dim])
        ? userWeights[dim]
        : DEFAULT_WEIGHTS[dim];
    }

    /** @type {Map<string, object>}  name → experiment descriptor */
    this._experiments = new Map();
  }

  // -----------------------------------------------------------------------
  // createExperiment(name, variants)
  // -----------------------------------------------------------------------

  /**
   * Define a new A/B experiment.
   *
   * @param {string} name — Unique experiment identifier.
   * @param {VariantDef[]} variants — Array of variant definitions (min 2).
   * @param {object} [options]
   * @param {object} [options.weights]     — Per-experiment scoring weights.
   * @param {number} [options.seed]        — RNG seed for reproducibility.
   * @returns {object} The created experiment descriptor.
   * @throws {Error} If name already exists or fewer than 2 variants.
   */
  createExperiment(name, variants, options = {}) {
    if (this._experiments.has(name)) {
      throw new Error(`Experiment "${name}" already exists.`);
    }

    if (!Array.isArray(variants) || variants.length < 2) {
      throw new Error(
        `Experiment "${name}" requires at least 2 variants, got ${variants ? variants.length : 0}.`
      );
    }

    // Validate variant uniqueness
    const seen = new Set();
    for (const v of variants) {
      if (!v.name || typeof v.name !== "string") {
        throw new Error(`Each variant in experiment "${name}" must have a string "name".`);
      }
      if (seen.has(v.name)) {
        throw new Error(`Duplicate variant name "${v.name}" in experiment "${name}".`);
      }
      if (typeof v.template !== "string") {
        throw new Error(`Variant "${v.name}" in experiment "${name}" requires a string "template".`);
      }
      seen.add(v.name);
    }

    // Build per-dimension weights, falling back to engine defaults
    const expWeights = options.weights || {};
    const weights = {};
    for (const dim of SCORE_DIMENSIONS) {
      weights[dim] = Number.isFinite(expWeights[dim])
        ? expWeights[dim]
        : this._defaultWeights[dim];
    }

    const experiment = {
      name,
      variants: variants.map((v) => ({
        name: v.name,
        template: v.template,
        metadata: v.metadata || {},
        weight: Number.isFinite(v.weight) && v.weight > 0 ? v.weight : 1,
      })),
      weights,
      trials: [],
      active: true,
      createdAt: Date.now(),
      seed: options.seed !== undefined ? options.seed : null,
      rng: createRng(options.seed),
    };

    this._experiments.set(name, experiment);
    return experiment;
  }

  // -----------------------------------------------------------------------
  // run(name, context)
  // -----------------------------------------------------------------------

  /**
   * Run a single trial, selecting a variant based on weighted randomisation.
   *
   * Returns the selected variant descriptor plus a trial ID so the caller
   * can later `recordScore` with the matching ID.
   *
   * @param {string} name — Experiment name.
   * @param {object} [context] — Arbitrary context for the trial (e.g. user id).
   * @returns {{ variant: VariantDef, trialId: number, experiment: string }}
   * @throws {Error} If experiment not found or inactive.
   */
  run(name, context = {}) {
    const experiment = this._experiments.get(name);
    if (!experiment) {
      throw new Error(`Experiment "${name}" not found.`);
    }
    if (!experiment.active) {
      throw new Error(`Experiment "${name}" is no longer active.`);
    }

    const variant = this._selectVariant(experiment);

    const trialId = experiment.trials.length + 1;
    const trial = {
      variantName: variant.name,
      context: { ...context },
      timestamp: Date.now(),
      scores: null,
      id: trialId,
    };

    experiment.trials.push(trial);

    return {
      variant: {
        name: variant.name,
        template: variant.template,
        metadata: { ...variant.metadata },
      },
      trialId,
      experiment: name,
    };
  }

  // -----------------------------------------------------------------------
  // recordScore(name, trialId, scores)
  // -----------------------------------------------------------------------

  /**
   * Record outcome scores for a completed trial.
   *
   * Each score dimension is optional — only provided values are recorded.
   * Dimensions: successRate (0-1), tokenEfficiency (0-1), userSatisfaction (0-1),
   * toolAccuracy (0-1).
   *
   * @param {string} name — Experiment name.
   * @param {number} trialId — Trial identifier from a prior run().
   * @param {object} scores
   * @param {number} [scores.successRate]        — 0 to 1.
   * @param {number} [scores.tokenEfficiency]    — 0 to 1.
   * @param {number} [scores.userSatisfaction]   — 0 to 1.
   * @param {number} [scores.toolAccuracy]       — 0 to 1.
   * @returns {object} The updated trial record.
   * @throws {Error} If experiment or trial not found, or if scores already set.
   */
  recordScore(name, trialId, scores = {}) {
    const experiment = this._experiments.get(name);
    if (!experiment) {
      throw new Error(`Experiment "${name}" not found.`);
    }

    const trial = experiment.trials.find((t) => t.id === trialId);
    if (!trial) {
      throw new Error(`Trial ${trialId} not found in experiment "${name}".`);
    }
    if (trial.scores !== null) {
      throw new Error(
        `Trial ${trialId} in experiment "${name}" already has scores recorded.`
      );
    }

    const clamped = {};
    for (const dim of SCORE_DIMENSIONS) {
      if (scores[dim] !== undefined && scores[dim] !== null) {
        const v = Number(scores[dim]);
        if (Number.isFinite(v)) {
          clamped[dim] = Math.max(0, Math.min(1, v));
        }
      }
    }

    trial.scores = clamped;
    return trial;
  }

  // -----------------------------------------------------------------------
  // getResults(name)
  // -----------------------------------------------------------------------

  /**
   * Compute detailed statistical results for an experiment.
   *
   * @param {string} name
   * @returns {object}
   * @throws {Error} If experiment not found.
   */
  getResults(name) {
    const experiment = this._experiments.get(name);
    if (!experiment) {
      throw new Error(`Experiment "${name}" not found.`);
    }

    const stats = this._computeStats(experiment);
    const pairwise = this._pairwiseComparisons(experiment, stats);

    // Build a ranked list of variants by composite score
    const ranked = stats.map((s) => ({
      name: s.name,
      trials: s.trials,
      compositeMean: s.compositeMean,
      dimensions: {},
    }));

    for (const s of stats) {
      const entry = ranked.find((r) => r.name === s.name);
      if (!entry) continue;
      for (const dim of SCORE_DIMENSIONS) {
        entry.dimensions[dim] = {
          mean: s[dim].mean,
          stdDev: s[dim].stdDev,
        };
      }
    }

    ranked.sort((a, b) => b.compositeMean - a.compositeMean);

    return {
      experiment: experiment.name,
      active: experiment.active,
      totalTrials: experiment.trials.length,
      scoredTrials: experiment.trials.filter((t) => t.scores !== null).length,
      variants: ranked,
      pairwiseComparisons: pairwise,
      createdAt: experiment.createdAt,
    };
  }

  // -----------------------------------------------------------------------
  // getWinner(name)
  // -----------------------------------------------------------------------

  /**
   * Determine the statistically significant winner of an experiment.
   *
   * Uses Welchʼs t-test comparing the top-ranked variant against each
   * rival.  Returns the winner only when the p-value is below the
   * significance threshold for all pairwise comparisons and each variant
   * meets the minimum trial count.
   *
   * @param {string} name
   * @returns {object|null} Winner descriptor, or null if no clear winner.
   * @throws {Error} If experiment not found.
   */
  getWinner(name) {
    const experiment = this._experiments.get(name);
    if (!experiment) {
      return null;
    }

    const results = this.getResults(name);

    // Require minimum trials
    for (const v of results.variants) {
      if (v.trials < this._minTrialsPerVariant) return null;
    }

    if (results.variants.length < 2) return null;

    const winner = results.variants[0];
    const rivals = results.variants.slice(1);

    // Winner must be significantly better than every rival
    let allSignificant = true;
    const pValues = [];

    for (const rival of rivals) {
      const comp = results.pairwiseComparisons.find(
        (c) =>
          (c.variantA === winner.name && c.variantB === rival.name) ||
          (c.variantA === rival.name && c.variantB === winner.name)
      );
      if (!comp) {
        allSignificant = false;
        continue;
      }
      pValues.push({ rival: rival.name, pValue: comp.pValue, significant: comp.significant });
      if (!comp.significant) allSignificant = false;
    }

    if (!allSignificant) return null;

    return {
      experiment: experiment.name,
      winner: winner.name,
      compositeMean: winner.compositeMean,
      margin: winner.compositeMean - (results.variants[1] ? results.variants[1].compositeMean : 0),
      pValues,
      significanceLevel: this._significanceLevel,
      totalTrials: results.totalTrials,
      confidence: "statistically significant",
    };
  }

  // -----------------------------------------------------------------------
  // getAllExperiments()
  // -----------------------------------------------------------------------

  /**
   * Return summaries of all experiments (active and completed).
   *
   * @returns {Array<object>}
   */
  getAllExperiments() {
    const summaries = [];
    for (const [, experiment] of this._experiments) {
      const results = this.getResults(experiment.name);
      const winner = this.getWinner(experiment.name);
      summaries.push({
        name: experiment.name,
        active: experiment.active,
        variantCount: experiment.variants.length,
        totalTrials: results.totalTrials,
        scoredTrials: results.scoredTrials,
        topVariant: results.variants.length > 0 ? results.variants[0].name : null,
        winner: winner ? winner.winner : null,
        createdAt: experiment.createdAt,
      });
    }
    return summaries;
  }

  // -----------------------------------------------------------------------
  // deactivateExperiment(name)
  // -----------------------------------------------------------------------

  /**
   * Mark an experiment as inactive.  No further trials can be run.
   *
   * @param {string} name
   * @returns {object} The experiment descriptor.
   */
  deactivateExperiment(name) {
    const experiment = this._experiments.get(name);
    if (!experiment) {
      throw new Error(`Experiment "${name}" not found.`);
    }
    experiment.active = false;
    return experiment;
  }

  // -----------------------------------------------------------------------
  // reactivateExperiment(name)
  // -----------------------------------------------------------------------

  /**
   * Re-activate a previously deactivated experiment.
   *
   * @param {string} name
   * @returns {object} The experiment descriptor.
   */
  reactivateExperiment(name) {
    const experiment = this._experiments.get(name);
    if (!experiment) {
      throw new Error(`Experiment "${name}" not found.`);
    }
    experiment.active = true;
    return experiment;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Weighted random variant selection.
   */
  _selectVariant(experiment) {
    const totalWeight = experiment.variants.reduce((s, v) => s + v.weight, 0);
    let roll = experiment.rng() * totalWeight;
    for (const variant of experiment.variants) {
      roll -= variant.weight;
      if (roll <= 0) return variant;
    }
    // Fallback (floating-point edge case)
    return experiment.variants[experiment.variants.length - 1];
  }

  /**
   * Compute per-variant statistics from scored trials.
   */
  _computeStats(experiment) {
    const scored = experiment.trials.filter((t) => t.scores !== null);
    const byVariant = new Map();

    for (const variant of experiment.variants) {
      byVariant.set(variant.name, []);
    }

    for (const trial of scored) {
      const bucket = byVariant.get(trial.variantName);
      if (bucket) bucket.push(trial.scores);
    }

    const stats = [];
    for (const variant of experiment.variants) {
      const scoresList = byVariant.get(variant.name) || [];
      const dimStats = {};

      for (const dim of SCORE_DIMENSIONS) {
        const vals = scoresList
          .map((s) => s[dim])
          .filter((v) => Number.isFinite(v));
        dimStats[dim] = {
          mean: vals.length > 0 ? mean(vals) : 0,
          stdDev: vals.length > 1 ? Math.sqrt(variance(vals)) : 0,
          count: vals.length,
        };
      }

      // Composite score per trial, then aggregate
      const compositeScores = scoresList.map((s) => {
        let composite = 0;
        let totalW = 0;
        for (const dim of SCORE_DIMENSIONS) {
          if (Number.isFinite(s[dim])) {
            composite += s[dim] * experiment.weights[dim];
            totalW += experiment.weights[dim];
          }
        }
        return totalW > 0 ? composite / totalW : 0;
      });

      const compositeMean = compositeScores.length > 0 ? mean(compositeScores) : 0;
      const compositeStdDev =
        compositeScores.length > 1 ? Math.sqrt(variance(compositeScores)) : 0;

      stats.push({
        name: variant.name,
        trials: scoresList.length,
        compositeMean: Math.round(compositeMean * 10000) / 10000,
        compositeStdDev: Math.round(compositeStdDev * 10000) / 10000,
        compositeScores,
        ...dimStats,
      });
    }

    return stats;
  }

  /**
   * Pairwise Welch t-test comparisons between all variant pairs.
   */
  _pairwiseComparisons(experiment, stats) {
    const comparisons = [];
    for (let i = 0; i < stats.length; i++) {
      for (let j = i + 1; j < stats.length; j++) {
        const a = stats[i];
        const b = stats[j];
        if (a.compositeScores.length < 2 || b.compositeScores.length < 2) {
          comparisons.push({
            variantA: a.name,
            variantB: b.name,
            t: 0,
            df: 0,
            pValue: 1,
            significant: false,
            note: "insufficient data for t-test",
          });
          continue;
        }

        const { t, df, pValue } = welchTTest(a.compositeScores, b.compositeScores);

        comparisons.push({
          variantA: a.name,
          variantB: b.name,
          t: Math.round(t * 10000) / 10000,
          df: Math.round(df * 100) / 100,
          pValue: Math.round(pValue * 10000) / 10000,
          significant: pValue < this._significanceLevel,
        });
      }
    }
    return comparisons;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

ABTestEngine.DEFAULT_WEIGHTS = DEFAULT_WEIGHTS;
ABTestEngine.SCORE_DIMENSIONS = SCORE_DIMENSIONS;

module.exports = { ABTestEngine };
