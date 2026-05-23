/**
 * RootCauseAnalyzer — analyzes performance regressions to identify likely
 * causes using multiple strategies: delta analysis, correlation with code
 * changes, test bisection, and expert rules.
 *
 * Produces structured root cause analysis (RCA) reports with remediation
 * suggestions.
 */
"use strict";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STRATEGIES = Object.freeze({
  DELTA_ANALYSIS: "delta-analysis",
  CORRELATION:    "correlation",
  BISECTION:      "bisection",
  EXPERT_RULES:   "expert-rules",
});

const CONFIDENCE_LEVELS = Object.freeze({
  HIGH:    "high",
  MEDIUM:  "medium",
  LOW:     "low",
  UNKNOWN: "unknown",
});

// ---------------------------------------------------------------------------
// Expert rules
// ---------------------------------------------------------------------------

/**
 * A rule matches on a regression + context and returns a hypothesis or null.
 *
 * @typedef {object} ExpertRule
 * @property {string}   id
 * @property {function} test - (regression, context) => boolean
 * @property {string}   cause - explanation
 * @property {string}   confidence - CONFIDENCE_LEVEL
 */

const EXPERT_RULES = [
  {
    id: "ER-001",
    test: (reg) => reg.metric === "memoryPeak" || reg.metric === "memoryAvg",
    cause: "Likely memory leak or retained object references in recently modified code. Check for closures holding large objects, undisposed event listeners, or growing caches.",
    confidence: CONFIDENCE_LEVELS.HIGH,
  },
  {
    id: "ER-002",
    test: (reg) => reg.metric === "cost" && reg.changePct > 50,
    cause: "Model or API pricing change, larger prompt contexts, or increased token consumption per call. Verify model selection and prompt templates for unintended bloat.",
    confidence: CONFIDENCE_LEVELS.MEDIUM,
  },
  {
    id: "ER-003",
    test: (reg) => (reg.metric === "p99" || reg.metric === "max") && reg.changePct > 30,
    cause: "Tail-latency regression likely caused by intermittent blocking operations (GC pauses, I/O contention, or lock contention). Profile worst-case execution paths.",
    confidence: CONFIDENCE_LEVELS.HIGH,
  },
  {
    id: "ER-004",
    test: (reg) => reg.metric === "errorRate" && reg.changePct > 10,
    cause: "Increased error rate suggests recently introduced bugs, timeout configuration changes, or upstream dependency instability. Diff error-handling paths in recent commits.",
    confidence: CONFIDENCE_LEVELS.HIGH,
  },
  {
    id: "ER-005",
    test: (reg) => reg.metric === "opsPerSec" && reg.changePct > 20,
    cause: "Throughput drop often results from added synchronization, heavier per-operation work, or resource starvation. Compare per-iteration workload between versions.",
    confidence: CONFIDENCE_LEVELS.MEDIUM,
  },
  {
    id: "ER-006",
    test: (reg) => reg.metric === "avg" && reg.changePct > 10 && reg.changePct < 30,
    cause: "Moderate latency increase across the board. May be due to dependency upgrades, runtime changes, or accumulated overhead from multiple small changes.",
    confidence: CONFIDENCE_LEVELS.MEDIUM,
  },
  {
    id: "ER-007",
    test: (reg) => (reg.metric === "tokensTotal" || reg.metric === "tokensInput") && reg.changePct > 15,
    cause: "Input token growth suggests prompts are growing larger. Check for verbose system prompts, duplicated context, or expanded tool definitions.",
    confidence: CONFIDENCE_LEVELS.HIGH,
  },
  {
    id: "ER-008",
    test: (reg) => reg.metric === "tokensOutput" && reg.changePct > 15,
    cause: "Output token growth may indicate the model is producing longer, less concise responses. Consider adjusting temperature, max_tokens, or system prompt instructions.",
    confidence: CONFIDENCE_LEVELS.MEDIUM,
  },
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute weighted relevance score between a regression and a code change.
 *
 * @param {object} regression
 * @param {object} change - { file, lines, type, description, timestamp }
 * @returns {number} relevance 0-1
 */
function computeRelevance(regression, change) {
  let score = 0;

  const file = (change.file || "").toLowerCase();
  const desc = (change.description || "").toLowerCase();
  const type = (change.type || "").toLowerCase();
  const metric = (regression.metric || "").toLowerCase();

  // File path signals
  if (metric.includes("memory") || metric === "memorypeak" || metric === "memoryavg") {
    if (/cache|buffer|pool|store|collect/i.test(file)) score += 0.4;
    if (/alloc|mem|gc|heap/i.test(file)) score += 0.5;
  }

  if (metric.includes("token") || metric === "tokensinput" || metric === "tokensoutput" || metric === "tokenstotal") {
    if (/prompt|template|system|context/i.test(file)) score += 0.4;
    if (/token|usage|model/i.test(file)) score += 0.5;
  }

  if (metric === "cost") {
    if (/model|api|provider|pricing/i.test(file)) score += 0.5;
  }

  if (metric === "errorrate") {
    if (/error|catch|retry|fallback/i.test(file)) score += 0.4;
    if (/validate|guard|assert/i.test(file)) score += 0.3;
  }

  if (metric === "opsPerSec" || metric.includes("ops")) {
    if (/pool|concurrent|parallel|batch|async/i.test(file)) score += 0.4;
  }

  if (metric.includes("avg") || metric.includes("p50") || metric.includes("p95") || metric.includes("p99")) {
    if (/hot|loop|sort|parse|serialize|encode|decode/i.test(file)) score += 0.3;
  }

  // Change type signals
  if (type === "refactor" && score < 0.3) score += 0.15;
  if (type === "dependency-upgrade") score += 0.3;
  if (type === "new-feature") score += 0.2;
  if (type === "optimization") score -= 0.3; // optimizations usually improve perf

  // Description keyword matching
  const keywords = metric.replace(/[^a-z]/g, " ").split(/\s+/).filter(Boolean);
  if (keywords.some((k) => desc.includes(k))) score += 0.25;

  return Math.min(1, Math.max(0, score));
}

/**
 * Perform a simple bisection over an ordered list of tests to narrow down
 * which test (or range) is responsible for the regression signal.
 *
 * @param {{ name: string, regressionSignal: number }[]} tests
 * @param {number} threshold - minimum signal to consider
 * @returns {{ culprit: string|null, range: [number, number], candidates: string[] }}
 */
function bisectTests(tests, threshold) {
  if (!Array.isArray(tests) || tests.length === 0) {
    return { culprit: null, range: [0, 0], candidates: [] };
  }

  // Sort by signal descending so the strongest regression is first
  const sorted = [...tests].sort((a, b) => (b.regressionSignal || 0) - (a.regressionSignal || 0));

  const candidates = sorted
    .filter((t) => t.regressionSignal >= threshold)
    .map((t) => t.name);

  if (candidates.length === 0) {
    return { culprit: null, range: [0, tests.length - 1], candidates: [] };
  }

  if (candidates.length === 1) {
    return { culprit: candidates[0], range: [0, 0], candidates };
  }

  // Find the range of indices in the sorted array where signals exceed threshold
  const indices = [];
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].regressionSignal >= threshold) {
      indices.push(i);
    }
  }

  return {
    culprit: candidates[0], // strongest signal (first in sorted order)
    range: [indices[0], indices[indices.length - 1]],
    candidates,
  };
}

/**
 * Compute per-metric deltas between baseline and current.
 */
function computeDeltas(baseline, current) {
  const deltas = {};
  const allKeys = new Set([
    ...Object.keys(baseline || {}),
    ...Object.keys(current || {}),
  ]);

  for (const key of allKeys) {
    const base = Number(baseline && baseline[key]);
    const curr = Number(current && current[key]);
    if (Number.isFinite(base) && Number.isFinite(curr) && base !== 0) {
      deltas[key] = {
        baseline: base,
        current: curr,
        absolute: curr - base,
        percent: ((curr - base) / Math.abs(base)) * 100,
      };
    }
  }

  return deltas;
}

/**
 * Sort deltas by absolute percentage change descending, return top N.
 */
function topChangedMetrics(deltas, n = 5) {
  return Object.entries(deltas)
    .sort((a, b) => Math.abs(b[1].percent) - Math.abs(a[1].percent))
    .slice(0, n)
    .map(([key, val]) => ({ metric: key, ...val }));
}

// ---------------------------------------------------------------------------
// RootCauseAnalyzer
// ---------------------------------------------------------------------------

class RootCauseAnalyzer {
  /**
   * @param {object} [options]
   * @param {object[]} [options.rules] - additional expert rules to register
   * @param {number} [options.correlationThreshold] - minimum relevance to flag (default 0.3)
   * @param {number} [options.bisectionThreshold] - regression signal threshold for bisection (default 0.05)
   */
  constructor(options = {}) {
    this._rules = [...EXPERT_RULES, ...(Array.isArray(options.rules) ? options.rules : [])];
    this._correlationThreshold = Number.isFinite(options.correlationThreshold)
      ? options.correlationThreshold : 0.3;
    this._bisectionThreshold = Number.isFinite(options.bisectionThreshold)
      ? options.bisectionThreshold : 0.05;
  }

  // ---------------------------------------------------------------------------
  // Analysis strategies
  // ---------------------------------------------------------------------------

  /**
   * Run all applicable analysis strategies on a regression and produce a
   * consolidated root cause analysis.
   *
   * @param {object} regression - single regression entry { metric, changePct, ... }
   * @param {object} context - additional context
   * @param {object} [context.baseline] - full baseline result
   * @param {object} [context.current] - full current result
   * @param {object[]} [context.changes] - recent code changes
   * @param {object[]} [context.tests] - individual test results for bisection
   * @returns {object} analysis result
   */
  analyze(regression, context = {}) {
    if (!regression || !regression.metric) {
      return {
        regression: null,
        hypotheses: [],
        confidence: CONFIDENCE_LEVELS.UNKNOWN,
        summary: "Invalid or missing regression data.",
      };
    }

    const strategies = [];
    const hypotheses = [];

    // 1. Delta analysis
    if (context.baseline && context.current) {
      const deltaResult = this._deltaAnalysis(regression, context.baseline, context.current);
      strategies.push({ strategy: STRATEGIES.DELTA_ANALYSIS, ...deltaResult });
      hypotheses.push(...deltaResult.hypotheses);
    }

    // 2. Correlation with code changes
    if (Array.isArray(context.changes) && context.changes.length > 0) {
      const corrResult = this.correlateChanges(regression, context.changes);
      strategies.push({ strategy: STRATEGIES.CORRELATION, ...corrResult });
      hypotheses.push(...corrResult.hypotheses);
    }

    // 3. Expert rules
    if (this._rules.length > 0) {
      const expertResult = this._applyExpertRules(regression, context);
      strategies.push({ strategy: STRATEGIES.EXPERT_RULES, ...expertResult });
      hypotheses.push(...expertResult.hypotheses);
    }

    // 4. Bisection (if test-level data available)
    if (Array.isArray(context.tests) && context.tests.length > 0) {
      const bisectResult = this._bisectionAnalysis(regression, context.tests);
      strategies.push({ strategy: STRATEGIES.BISECTION, ...bisectResult });
      hypotheses.push(...bisectResult.hypotheses);
    }

    // Consolidate: sort by confidence, deduplicate
    const consolidated = this._consolidateHypotheses(hypotheses);
    const overallConfidence = this._computeOverallConfidence(consolidated);

    return {
      regression,
      strategies,
      hypotheses: consolidated,
      confidence: overallConfidence,
      summary: this._buildSummary(regression, consolidated),
      analyzedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Correlation
  // ---------------------------------------------------------------------------

  /**
   * Correlate a regression with a list of recent code changes to identify
   * which changes are most likely responsible.
   *
   * @param {object} regression
   * @param {object[]} changes - [{ file, lines, type, description, timestamp, author, commit }]
   * @returns {object} { correlations, hypotheses }
   */
  correlateChanges(regression, changes) {
    if (!Array.isArray(changes)) {
      return { correlations: [], hypotheses: [] };
    }

    const correlations = changes
      .map((change) => ({
        change,
        relevance: computeRelevance(regression, change),
      }))
      .filter((c) => c.relevance >= this._correlationThreshold)
      .sort((a, b) => b.relevance - a.relevance);

    const hypotheses = correlations.slice(0, 3).map((c) => ({
      cause: `Code change in "${c.change.file || "unknown"}" (${c.change.description || c.change.type || "unlabeled"}) is correlated with the regression.`,
      strategy: STRATEGIES.CORRELATION,
      confidence: c.relevance >= 0.7 ? CONFIDENCE_LEVELS.HIGH
        : c.relevance >= 0.5 ? CONFIDENCE_LEVELS.MEDIUM
        : CONFIDENCE_LEVELS.LOW,
      evidence: c,
    }));

    return { correlations, hypotheses };
  }

  // ---------------------------------------------------------------------------
  // Bisection (narrowing down)
  // ---------------------------------------------------------------------------

  /**
   * Narrow down the cause of a regression by bisecting test results.
   * Tests should include a `regressionSignal` value indicating how strongly
   * each test exhibits the regression.
   *
   * @param {object} regression
   * @param {object[]} tests - [{ name, regressionSignal, ... }]
   * @returns {object} { result, hypotheses }
   */
  narrowDown(regression, tests) {
    if (!Array.isArray(tests) || tests.length === 0) {
      return { result: null, hypotheses: [] };
    }

    const sorted = [...tests].sort((a, b) =>
      (b.regressionSignal || 0) - (a.regressionSignal || 0)
    );

    const result = bisectTests(sorted, this._bisectionThreshold);
    const hypotheses = [];

    if (result.culprit) {
      hypotheses.push({
        cause: `Test "${result.culprit}" shows the strongest regression signal (${sorted.find((t) => t.name === result.culprit)?.regressionSignal || "?"}). Investigate the code path exercised by this test.`,
        strategy: STRATEGIES.BISECTION,
        confidence: result.candidates.length === 1
          ? CONFIDENCE_LEVELS.HIGH
          : CONFIDENCE_LEVELS.MEDIUM,
        evidence: result,
      });
    }

    if (result.candidates.length > 1) {
      hypotheses.push({
        cause: `${result.candidates.length} tests in range [${result.range[0]}, ${result.range[1]}] show regression signals above the threshold. The issue may span multiple code paths.`,
        strategy: STRATEGIES.BISECTION,
        confidence: CONFIDENCE_LEVELS.MEDIUM,
        evidence: result,
      });
    }

    return { result, hypotheses };
  }

  // ---------------------------------------------------------------------------
  // Remediation
  // ---------------------------------------------------------------------------

  /**
   * Suggest a remediation based on the regression and its analysis.
   *
   * @param {object} regression
   * @param {object} [analysis] - output from analyze()
   * @returns {object} { suggestions, priority }
   */
  suggestFix(regression, analysis) {
    const suggestions = [];
    const metric = (regression.metric || "").toLowerCase();

    // Build suggestions from highest-confidence hypotheses
    if (analysis && Array.isArray(analysis.hypotheses)) {
      const topped = analysis.hypotheses
        .filter((h) => h.confidence === CONFIDENCE_LEVELS.HIGH)
        .slice(0, 2);
      for (const h of topped) {
        suggestions.push({
          action: h.cause,
          source: h.strategy,
          confidence: h.confidence,
        });
      }
    }

    // Always include metric-specific generic suggestions
    const genericFixes = this._getGenericFixes(metric);
    for (const fix of genericFixes) {
      if (!suggestions.some((s) => s.action === fix)) {
        suggestions.push({
          action: fix,
          source: "best-practice",
          confidence: CONFIDENCE_LEVELS.MEDIUM,
        });
      }
    }

    const severity = regression.severity || "minor";
    const priority = severity === "critical" || severity === "major" ? "immediate" : "planned";

    return { suggestions, priority };
  }

  // ---------------------------------------------------------------------------
  // RCA Report
  // ---------------------------------------------------------------------------

  /**
   * Generate a comprehensive root cause analysis report.
   *
   * @param {object} regression
   * @param {object} [context] - same context as analyze()
   * @returns {object} structured RCA report
   */
  generateRCAReport(regression, context = {}) {
    const analysis = this.analyze(regression, context);
    const fix = this.suggestFix(regression, analysis);

    return {
      reportVersion: "1.0",
      generatedAt: new Date().toISOString(),
      regression: {
        metric: regression.metric,
        label: regression.label || regression.metric,
        severity: regression.severity || "unknown",
        change: `${regression.changePct > 0 ? "+" : ""}${regression.changePct?.toFixed(2) || "?"}%`,
        baseline: regression.baseline,
        current: regression.current,
        detectedAt: regression.detectedAt || null,
      },
      analysis: {
        hypotheses: analysis.hypotheses,
        confidence: analysis.confidence,
        strategiesApplied: analysis.strategies.map((s) => s.strategy),
      },
      remediation: {
        suggestions: fix.suggestions,
        priority: fix.priority,
      },
      context: {
        changesCount: Array.isArray(context.changes) ? context.changes.length : 0,
        testsCount: Array.isArray(context.tests) ? context.tests.length : 0,
        hasBaselineData: !!(context.baseline),
        hasCurrentData: !!(context.current),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Strategy parameter management
  // ---------------------------------------------------------------------------

  /**
   * Set the correlation threshold (minimum relevance to flag a change).
   * @param {number} value - 0 to 1
   */
  setCorrelationThreshold(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError("Correlation threshold must be between 0 and 1.");
    }
    this._correlationThreshold = value;
  }

  /**
   * Set the bisection signal threshold.
   * @param {number} value
   */
  setBisectionThreshold(value) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError("Bisection threshold must be a non-negative number.");
    }
    this._bisectionThreshold = value;
  }

  /**
   * Register additional expert rules.
   * @param {object[]} rules - array of { id, test, cause, confidence }
   */
  addRules(rules) {
    if (!Array.isArray(rules)) {
      throw new TypeError("addRules expects an array of rule objects.");
    }
    for (const rule of rules) {
      if (!rule.id || typeof rule.test !== "function" || !rule.cause) {
        throw new TypeError(`Invalid rule: each rule needs id, test (function), and cause.`);
      }
    }
    this._rules.push(...rules);
  }

  // ---------------------------------------------------------------------------
  // Private: strategies
  // ---------------------------------------------------------------------------

  _deltaAnalysis(regression, baseline, current) {
    const deltas = computeDeltas(baseline, current);
    const top = topChangedMetrics(deltas, 5);

    const hypotheses = top.map((d) => ({
      cause: `Metric "${d.metric}" changed by ${d.percent.toFixed(1)}% (${d.baseline} → ${d.current}). ${d.metric === regression.metric ? "This is the primary regressed metric." : "This is a secondary affected metric that may be related."}`,
      strategy: STRATEGIES.DELTA_ANALYSIS,
      confidence: d.metric === regression.metric ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MEDIUM,
      evidence: d,
    }));

    return { deltas, topChanges: top, hypotheses };
  }

  _applyExpertRules(regression, context) {
    const matches = this._rules
      .filter((rule) => {
        try {
          return rule.test(regression, context);
        } catch (_) {
          return false;
        }
      })
      .map((rule) => ({
        cause: rule.cause,
        strategy: STRATEGIES.EXPERT_RULES,
        confidence: rule.confidence,
        evidence: { ruleId: rule.id },
      }));

    return {
      matchedRules: matches.map((m) => m.evidence.ruleId),
      hypotheses: matches,
    };
  }

  _bisectionAnalysis(regression, tests) {
    const narrowed = this.narrowDown(regression, tests);
    return narrowed;
  }

  // ---------------------------------------------------------------------------
  // Private: consolidation
  // ---------------------------------------------------------------------------

  _consolidateHypotheses(hypotheses) {
    const seen = new Set();
    const result = [];

    // Sort: HIGH > MEDIUM > LOW > UNKNOWN, then deduplicate by cause text
    const sorted = [...hypotheses].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2, unknown: 3 };
      return (order[a.confidence] || 99) - (order[b.confidence] || 99);
    });

    for (const h of sorted) {
      const key = h.cause.slice(0, 120);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(h);
      }
    }

    return result.slice(0, 10); // Cap at 10 hypotheses
  }

  _computeOverallConfidence(hypotheses) {
    if (hypotheses.length === 0) return CONFIDENCE_LEVELS.UNKNOWN;

    const hasHigh = hypotheses.some((h) => h.confidence === CONFIDENCE_LEVELS.HIGH);
    const hasMedium = hypotheses.some((h) => h.confidence === CONFIDENCE_LEVELS.MEDIUM);

    if (hasHigh) return CONFIDENCE_LEVELS.HIGH;
    if (hasMedium) return CONFIDENCE_LEVELS.MEDIUM;
    return CONFIDENCE_LEVELS.LOW;
  }

  _buildSummary(regression, hypotheses) {
    if (hypotheses.length === 0) {
      return `No root cause hypotheses could be generated for the ${regression.metric} regression. Consider providing more context (code changes, test-level data).`;
    }

    const topCause = hypotheses[0];
    return `Most likely cause (${topCause.confidence} confidence): ${topCause.cause}`;
  }

  _getGenericFixes(metric) {
    const fixes = {
      avg: "Profile the benchmark workload with a CPU profiler to identify new or slower code paths.",
      p50: "Inspect median-case performance paths. Look for added work in the common-case code.",
      p95: "Check for intermittent blocking operations such as GC pauses, I/O, or lock contention.",
      p99: "Tail latency often indicates resource starvation. Check connection pools, thread pools, and timeout configurations.",
      max: "Investigate worst-case execution paths. Consider adding timeout guards or circuit breakers.",
      min: "Even minimum latency regressions suggest baseline overhead increased. Check startup or initialization code.",
      stddev: "Increased variance suggests inconsistent performance. Check for non-deterministic code paths or external dependencies.",
      opsPerSec: "Throughput drops usually trace to heavier per-operation cost. Benchmark individual operations.",
      tokensTotal: "Review prompt construction logic. Consider caching, truncation, or streaming strategies.",
      tokensInput: "Audit system prompts and context assembly. Remove redundant or unused context.",
      tokensOutput: "Consider tightening response instructions or reducing max_tokens.",
      cost: "Re-evaluate model selection. Consider tiered routing or caching to reduce API costs.",
      errorRate: "Review error logs, add integration tests, and consider implementing retry with exponential backoff.",
      memoryPeak: "Use heap snapshots to identify large allocations. Check for undisposed resources.",
      memoryAvg: "Monitor steady-state memory usage. Check for accumulating caches or unbound collections.",
    };

    return fixes[metric] ? [fixes[metric]] : [];
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  RootCauseAnalyzer,
  STRATEGIES,
  CONFIDENCE_LEVELS,
  EXPERT_RULES,
  bisectTests,
  computeRelevance,
};
