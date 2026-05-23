"use strict";

/**
 * TimeEstimator — task duration estimation with complexity-based,
 * history-based, and file-based strategies, plus confidence intervals
 * and a learning feedback loop.
 *
 * Complements the EffortEstimator in planner/estimator.js by focusing
 * on wall-clock duration rather than abstract effort tiers.
 */

const { debug } = require('../debug');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default hours per complexity tier (best / expected / worst). */
const COMPLEXITY_HOURS = {
  S:  { best: 0.25, expected: 0.5,  worst: 1.5  },
  M:  { best: 1,    expected: 3,    worst: 8    },
  L:  { best: 4,    expected: 12,   worst: 24   },
  XL: { best: 16,   expected: 40,   worst: 80   },
};

/** File-based estimation: hours per file by action type. */
const FILE_ACTION_RATES = {
  read:       0.02,   // ~1 min per file
  edit:       0.15,   // ~9 min per file
  create:     0.3,    // ~18 min per file
  delete:     0.03,   // ~2 min per file
  analyze:    0.2,    // ~12 min per file
  refactor:   0.4,    // ~24 min per file
  test:       0.25,   // ~15 min per file
  build:      0.5,    // ~30 min per file
  review:     0.1,    // ~6 min per file
  integrate:  0.35,   // ~21 min per file
  document:   0.12,   // ~7 min per file
  default:    0.15,   // fallback
};

/** Minimum overhead per task (setup / context switching). */
const TASK_OVERHEAD_HOURS = 0.1;

/** Maximum multiplier cap for any factor. */
const MAX_MULTIPLIER = 5.0;

/** Default history window for similarity matching (most recent N tasks). */
const DEFAULT_HISTORY_WINDOW = 50;

/** Learning rate for trackActual feedback. */
const DEFAULT_LEARNING_RATE = 0.2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Compute cosine-like text similarity based on term overlap.
 * Returns a value in [0, 1].
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function similarity(a, b) {
  const tokensA = new Set(String(a || '').toLowerCase().split(/\W+/).filter(Boolean));
  const tokensB = new Set(String(b || '').toLowerCase().split(/\W+/).filter(Boolean));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  return intersection / Math.sqrt(tokensA.size * tokensB.size);
}

// ---------------------------------------------------------------------------
// TimeEstimator
// ---------------------------------------------------------------------------

class TimeEstimator {
  /**
   * @param {object} [options]
   * @param {object} [options.complexityHours]     - Override COMPLEXITY_HOURS tiers
   * @param {object} [options.fileActionRates]     - Override FILE_ACTION_RATES
   * @param {number} [options.taskOverhead=0.1]    - Minimum hours overhead per task
   * @param {number} [options.historyWindow=50]    - Max past tasks to consider
   * @param {number} [options.learningRate=0.2]    - Feedback learning rate (0-1)
   */
  constructor(options = {}) {
    this._complexityHours = Object.assign({}, COMPLEXITY_HOURS, options.complexityHours || {});
    this._fileActionRates = Object.assign({}, FILE_ACTION_RATES, options.fileActionRates || {});
    this._taskOverhead = Number(options.taskOverhead) || TASK_OVERHEAD_HOURS;
    this._historyWindow = Math.max(1, Number(options.historyWindow) || DEFAULT_HISTORY_WINDOW);
    this._learningRate = Math.min(1, Math.max(0, Number(options.learningRate) || DEFAULT_LEARNING_RATE));

    /**
     * Task history for learning: Array<{ task, actualHours, context }>
     */
    this._history = [];

    /**
     * Per-tier bias computed from tracking feedback.
     * e.g. { S: 1.1, M: 0.95, L: 1.2, XL: 1.0 }
     */
    this._tierBias = { S: 1.0, M: 1.0, L: 1.0, XL: 1.0 };
  }

  // ---- Primary API --------------------------------------------------------

  /**
   * Estimate total duration for a task using all available strategies
   * and returning the best composite estimate.
   *
   * @param {object} task    - Task descriptor { title, type, complexity, files, ... }
   * @param {object} [context={}]
   * @param {string} [context.strategy]       - 'complexity' | 'files' | 'history' | 'auto' (default)
   * @param {number} [context.fileCount]      - number of files involved
   * @param {string} [context.action]         - file action type (read/edit/create/etc.)
   * @param {object[]} [context.history]      - past task records for history-based estimation
   * @returns {{ hours: { best: number, expected: number, worst: number }, totalHours: number, strategy: string, confidence: object }}
   */
  estimate(task, context = {}) {
    const taskObj = task || {};
    const strategy = context.strategy || 'auto';

    let result;

    if (strategy === 'complexity') {
      result = this.estimateByComplexity(taskObj.complexity || this._inferComplexity(taskObj));
    } else if (strategy === 'files') {
      result = this.estimateByFiles(
        context.files || context.fileCount || 0,
        context.action || 'default'
      );
    } else if (strategy === 'history') {
      result = this.estimateByHistory(taskObj, context.history || this._history);
    } else {
      // 'auto': blend strategies, preferring the ones with strongest signal
      result = this._autoEstimate(taskObj, context);
    }

    const confidence = this.getConfidence(result);

    debug('time:estimator', `estimated "${taskObj.title || taskObj.name || 'unnamed'}": ${result.totalHours}h (${result.strategy}), confidence ${round2(confidence.level * 100)}%`);

    return {
      ...result,
      confidence,
    };
  }

  /**
   * Estimate duration based solely on a complexity tier.
   *
   * @param {'S'|'M'|'L'|'XL'} complexity
   * @returns {{ hours: { best: number, expected: number, worst: number }, totalHours: number, strategy: string }}
   */
  estimateByComplexity(complexity) {
    const tier = (complexity && this._complexityHours[complexity])
      ? complexity
      : 'M';

    const base = this._complexityHours[tier];
    const bias = this._tierBias[tier] || 1.0;

    const hours = {
      best: round2(base.best * bias),
      expected: round2(base.expected * bias),
      worst: round2(base.worst * bias),
    };

    return {
      hours,
      totalHours: round2(hours.expected + this._taskOverhead),
      strategy: 'complexity',
      complexity: tier,
      complexityBias: round2(bias),
    };
  }

  /**
   * Estimate duration based on similar past tasks.
   *
   * @param {object} task      - task to estimate
   * @param {object[]} history - array of { task, actualHours } records
   * @returns {{ hours: { best: number, expected: number, worst: number }, totalHours: number, strategy: string, matchCount: number, avgSimilarity: number }}
   */
  estimateByHistory(task, history = []) {
    const taskObj = task || {};
    const taskText = [taskObj.title || '', taskObj.type || '', taskObj.name || ''].join(' ');

    if (!Array.isArray(history) || history.length === 0) {
      return {
        hours: { best: 0, expected: 0, worst: 0 },
        totalHours: 0,
        strategy: 'history',
        matchCount: 0,
        avgSimilarity: 0,
      };
    }

    const recent = history.slice(-this._historyWindow);
    const matches = [];

    for (const record of recent) {
      const recText = [record.task?.title || '', record.task?.type || '', record.task?.name || ''].join(' ');
      const sim = similarity(taskText, recText);
      if (sim > 0) {
        matches.push({ sim, actualHours: record.actualHours || 0 });
      }
    }

    if (matches.length === 0) {
      return {
        hours: { best: 0, expected: 0, worst: 0 },
        totalHours: 0,
        strategy: 'history',
        matchCount: 0,
        avgSimilarity: 0,
      };
    }

    // Weighted average by similarity
    let totalWeight = 0;
    let weightedSum = 0;
    const actuals = [];

    for (const m of matches) {
      totalWeight += m.sim;
      weightedSum += m.sim * m.actualHours;
      actuals.push(m.actualHours);
    }

    // Sort actuals for percentile computation
    actuals.sort((a, b) => a - b);

    const expected = round2(totalWeight > 0 ? weightedSum / totalWeight : 0);
    const best = actuals[Math.floor(actuals.length * 0.1)] || actuals[0] || 0;
    const worst = actuals[Math.ceil(actuals.length * 0.9) - 1] || actuals[actuals.length - 1] || 0;
    const avgSim = round2(totalWeight / matches.length);

    return {
      hours: {
        best: round2(Math.min(best, expected)),
        expected,
        worst: round2(Math.max(worst, expected)),
      },
      totalHours: round2(expected + this._taskOverhead),
      strategy: 'history',
      matchCount: matches.length,
      avgSimilarity: round2(avgSim),
    };
  }

  /**
   * Estimate duration based on file count and action type.
   *
   * @param {number|Array} files  - number of files or array of file records
   * @param {string} [action='default'] - type of work being done on the files
   * @returns {{ hours: { best: number, expected: number, worst: number }, totalHours: number, strategy: string, fileCount: number, action: string }}
   */
  estimateByFiles(files, action = 'default') {
    const count = Array.isArray(files) ? files.length : Math.max(0, Number(files) || 0);
    const rate = this._fileActionRates[action] || this._fileActionRates.default;

    // Diminishing returns: sqrt dampening for large file counts
    const effective = count <= 5 ? count : 5 + Math.sqrt(count - 5);

    const base = round2(effective * rate) + this._taskOverhead;

    const hours = {
      best: round2(base * 0.5),
      expected: base,
      worst: round2(base * 2.5),
    };

    return {
      hours,
      totalHours: base,
      strategy: 'files',
      fileCount: count,
      action,
      ratePerFile: rate,
    };
  }

  /**
   * Compute confidence level for an estimate.
   *
   * @param {object} estimate - result from estimate / estimateByComplexity / etc.
   * @returns {{ level: number, interval: string, factors: object }}
   */
  getConfidence(estimate) {
    const est = estimate || {};
    const h = est.hours || {};

    // Wider spread = lower confidence
    const best = h.best || est.totalHours || 0;
    const worst = h.worst || est.totalHours || 0;
    const expected = h.expected || est.totalHours || 0;

    if (expected <= 0) {
      return { level: 0, interval: '0h', factors: { reason: 'no data' } };
    }

    const spreadRatio = (worst - best) / expected;

    let level;
    if (spreadRatio <= 1.0) level = 0.9;
    else if (spreadRatio <= 2.0) level = 0.75;
    else if (spreadRatio <= 4.0) level = 0.5;
    else if (spreadRatio <= 8.0) level = 0.3;
    else level = 0.15;

    // Penalise low-data strategies
    if (est.strategy === 'history' && (est.matchCount || 0) < 3) {
      level = Math.min(level, 0.3);
    } else if (est.strategy === 'history' && (est.matchCount || 0) < 10) {
      level = Math.min(level, 0.6);
    }

    // Boost for strategies with good signal
    if (est.strategy === 'files' && (est.fileCount || 0) > 0) {
      level = Math.min(1.0, level + 0.1);
    }

    const margin = round2((worst - best) / 2);

    return {
      level: round2(Math.min(1, Math.max(0, level))),
      interval: `${round2(expected - margin)}h – ${round2(expected + margin)}h`,
      factors: {
        spreadRatio: round2(spreadRatio),
        strategy: est.strategy || 'unknown',
        marginHours: margin,
      },
    };
  }

  /**
   * Record the actual duration of a completed task to improve future estimates.
   *
   * @param {object} estimate  - the estimate that was produced for this task
   * @param {number} actual    - actual hours taken
   * @returns {{ bias: number, adjustedBias: number, tier: string, variance: number }}
   */
  trackActual(estimate, actual) {
    const est = estimate || {};
    const expected = (est.hours && est.hours.expected) || est.totalHours || 0;
    const actualHours = Number(actual) || 0;

    if (expected <= 0 || actualHours <= 0) {
      return { bias: 1.0, adjustedBias: 1.0, tier: 'M', variance: 0 };
    }

    const variance = round2(actualHours - expected);
    const ratio = actualHours / expected;

    // Update per-tier bias using EWMA (exponentially weighted moving average)
    const tier = est.complexity || 'M';
    if (this._tierBias[tier] !== undefined) {
      const oldBias = this._tierBias[tier];
      const newBias = oldBias + this._learningRate * (ratio - oldBias);
      this._tierBias[tier] = round2(Math.max(0.3, Math.min(MAX_MULTIPLIER, newBias)));
    }

    // Record in history
    this._history.push({
      task: est.task || { title: est.title, type: est.type, complexity: est.complexity },
      actualHours,
      context: {
        strategy: est.strategy,
        complexity: est.complexity,
      },
    });

    // Trim history to window
    while (this._history.length > this._historyWindow) {
      this._history.shift();
    }

    debug('time:estimator', `track actual: expected=${expected}h, actual=${actualHours}h, variance=${variance}h, tier bias (${tier})=${this._tierBias[tier]}`);

    return {
      bias: round2(ratio),
      adjustedBias: this._tierBias[tier],
      tier,
      variance,
    };
  }

  /**
   * Get the current per-tier bias factors.
   * @returns {object}
   */
  get calibration() {
    return Object.assign({}, this._tierBias);
  }

  /**
   * Reset the learning history and tier biases.
   */
  reset() {
    this._history = [];
    this._tierBias = { S: 1.0, M: 1.0, L: 1.0, XL: 1.0 };
  }

  /**
   * Number of recorded history entries.
   * @returns {number}
   */
  get historySize() {
    return this._history.length;
  }

  // ---- Internal helpers ---------------------------------------------------

  /**
   * Auto-select the best estimation strategy based on available data.
   */
  _autoEstimate(taskObj, context) {
    const results = [];

    // Always include complexity estimate
    const complexity = taskObj.complexity || this._inferComplexity(taskObj);
    results.push(this.estimateByComplexity(complexity));

    // If we have file data, include file-based estimate
    const fileCount = context.files || context.fileCount || 0;
    if (fileCount > 0) {
      results.push(this.estimateByFiles(fileCount, context.action || 'default'));
    }

    // If we have history, include history-based estimate
    const history = context.history || this._history;
    if (Array.isArray(history) && history.length > 0) {
      const histResult = this.estimateByHistory(taskObj, history);
      if (histResult.matchCount > 0) {
        results.push(histResult);
      }
    }

    if (results.length === 1) {
      return results[0];
    }

    // Weight strategies by confidence
    let totalWeight = 0;
    let weightedExpected = 0;
    let weightedBest = 0;
    let weightedWorst = 0;

    const STRATEGY_WEIGHTS = {
      complexity: 1.0,
      files: 1.2,
      history: 0.8, // slightly less weight until many matches
    };

    for (const result of results) {
      const baseWeight = STRATEGY_WEIGHTS[result.strategy] || 1.0;
      const confidence = this.getConfidence(result);
      const weight = baseWeight * (confidence.level > 0 ? confidence.level : 0.5);

      const h = result.hours || {};
      totalWeight += weight;
      weightedExpected += weight * (h.expected || result.totalHours || 0);
      weightedBest += weight * (h.best || result.totalHours || 0);
      weightedWorst += weight * (h.worst || result.totalHours || 0);
    }

    if (totalWeight <= 0) {
      return results[0];
    }

    return {
      hours: {
        best: round2(weightedBest / totalWeight),
        expected: round2(weightedExpected / totalWeight),
        worst: round2(weightedWorst / totalWeight),
      },
      totalHours: round2(weightedExpected / totalWeight),
      strategy: 'auto',
      subEstimates: results.length,
    };
  }

  /**
   * Heuristically infer complexity from task properties.
   * @param {object} task
   * @returns {'S'|'M'|'L'|'XL'}
   */
  _inferComplexity(task) {
    if (task.complexity && this._complexityHours[task.complexity]) {
      return task.complexity;
    }

    if (task.effort && this._complexityHours[task.effort]) {
      return task.effort;
    }

    const text = [task.title || '', task.type || '', task.name || ''].join(' ').toLowerCase();

    const indicators = [
      { re: /\b(?:simple|trivial|minor|small|tiny|single|cosmetic|quick|easy)\b/, tier: 'S' },
      { re: /\b(?:moderate|medium|normal|few|some|update|change)\b/, tier: 'M' },
      { re: /\b(?:large|significant|major|complex|heavy|many|multiple|extensive|hard|difficult)\b/, tier: 'L' },
      { re: /\b(?:massive|huge|entire|rewrite|ground.?up|monumental|enormous)\b/, tier: 'XL' },
    ];

    for (const { re, tier } of indicators) {
      if (re.test(text)) return tier;
    }

    // Fallback: type-based heuristics
    const typeMap = {
      analyze: 'S', spec: 'S', plan: 'S', verify: 'S', cleanup: 'S',
      design: 'M', fix: 'M', test: 'M', extract: 'M', profile: 'M',
      implement: 'L', build: 'L', refactor: 'L', integrate: 'L',
      migrate: 'XL', rewrite: 'XL',
    };
    const type = (task.type || '').toLowerCase();
    if (typeMap[type]) return typeMap[type];

    return 'M';
  }
}

module.exports = {
  TimeEstimator,
  COMPLEXITY_HOURS,
  FILE_ACTION_RATES,
};
