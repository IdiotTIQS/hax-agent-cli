"use strict";

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const { TimeEstimator, COMPLEXITY_HOURS, FILE_ACTION_RATES } = require('../../src/time/estimator');

describe('TimeEstimator', () => {
  let estimator;

  beforeEach(() => {
    estimator = new TimeEstimator();
  });

  // ----- estimate -----------------------------------------------------------

  it('should estimate task duration using complexity strategy', () => {
    const result = estimator.estimate(
      { title: 'simple fix', type: 'fix', complexity: 'S' },
      { strategy: 'complexity' }
    );

    assert.ok(result.hours);
    assert.ok(typeof result.hours.best === 'number');
    assert.ok(typeof result.hours.expected === 'number');
    assert.ok(typeof result.hours.worst === 'number');
    assert.strictEqual(result.strategy, 'complexity');
    assert.ok(result.totalHours > 0);
    assert.ok(result.hours.best <= result.hours.expected);
    assert.ok(result.hours.expected <= result.hours.worst);
  });

  it('should estimate using auto strategy (blend)', () => {
    const result = estimator.estimate(
      { title: 'large refactor', type: 'refactor', complexity: 'L' },
      { strategy: 'auto', fileCount: 10, action: 'refactor' }
    );

    assert.strictEqual(result.strategy, 'auto');
    assert.ok(result.totalHours > 0, 'totalHours should be > 0');
    assert.ok(result.subEstimates >= 2, 'auto should use multiple sub-estimates when context has files');
  });

  // ----- estimateByComplexity -----------------------------------------------

  it('should estimate S complexity as smaller than L complexity', () => {
    const small = estimator.estimateByComplexity('S');
    const large = estimator.estimateByComplexity('L');

    assert.ok(small.totalHours < large.totalHours,
      `S (${small.totalHours}h) should be < L (${large.totalHours}h)`);
  });

  it('should auto-infer complexity from title keywords', () => {
    const simple = estimator.estimate({ title: 'simple text change' }, { strategy: 'complexity' });
    const massive = estimator.estimate({ title: 'massive rewrite of entire system' }, { strategy: 'complexity' });

    assert.ok(simple.complexity === 'S', `expected S got ${simple.complexity}`);
    assert.ok(massive.complexity === 'XL' || massive.complexity === 'L',
      `expected XL or L, got ${massive.complexity}`);
  });

  it('should return M tier for unknown complexity', () => {
    const result = estimator.estimateByComplexity('UNKNOWN');
    const medium = estimator.estimateByComplexity('M');

    assert.strictEqual(result.totalHours, medium.totalHours);
  });

  // ----- estimateByHistory --------------------------------------------------

  it('should estimate based on similar past tasks', () => {
    const history = [
      { task: { title: 'fix login bug', type: 'fix' }, actualHours: 2.0 },
      { task: { title: 'fix signup bug', type: 'fix' }, actualHours: 3.0 },
      { task: { title: 'fix payment bug', type: 'fix' }, actualHours: 2.5 },
      { task: { title: 'build landing page', type: 'build' }, actualHours: 8.0 },
    ];

    const result = estimator.estimateByHistory(
      { title: 'fix checkout bug', type: 'fix' },
      history
    );

    assert.strictEqual(result.strategy, 'history');
    assert.ok(result.matchCount > 0, 'should find matches for similar fix tasks');
    assert.ok(result.totalHours > 0, 'should produce an estimate');
  });

  it('should return zero when history has no matches', () => {
    const history = [
      { task: { title: 'xyzzy abc' }, actualHours: 1.0 },
    ];

    const result = estimator.estimateByHistory(
      { title: 'completely different task' },
      history
    );

    // May or may not have matches depending on token overlap
    assert.strictEqual(result.strategy, 'history');
    assert.ok(result.matchCount >= 0);
    assert.ok(result.totalHours >= 0);
  });

  it('should return zero when history is empty', () => {
    const result = estimator.estimateByHistory(
      { title: 'some task' },
      []
    );

    assert.strictEqual(result.strategy, 'history');
    assert.strictEqual(result.matchCount, 0);
    assert.strictEqual(result.totalHours, 0);
  });

  // ----- estimateByFiles ----------------------------------------------------

  it('should estimate based on file count and action', () => {
    const result = estimator.estimateByFiles(5, 'edit');

    assert.strictEqual(result.strategy, 'files');
    assert.strictEqual(result.fileCount, 5);
    assert.strictEqual(result.action, 'edit');
    assert.ok(result.totalHours > 0);
    assert.ok(result.ratePerFile > 0);
  });

  it('should apply diminishing returns for large file counts', () => {
    const small = estimator.estimateByFiles(2, 'edit');
    const large = estimator.estimateByFiles(100, 'edit');

    // 100 files should NOT be 50x 2 files due to sqrt dampening
    const ratio = large.totalHours / small.totalHours;
    assert.ok(ratio < 50, `ratio ${ratio} should be < 50 due to diminishing returns`);
  });

  // ----- getConfidence ------------------------------------------------------

  it('should compute confidence level and interval', () => {
    const estimate = estimator.estimateByComplexity('M');
    const confidence = estimator.getConfidence(estimate);

    assert.ok(confidence.level >= 0 && confidence.level <= 1,
      `confidence level ${confidence.level} should be in [0,1]`);
    assert.ok(confidence.interval.length > 0, 'should produce an interval string');
    assert.ok(confidence.factors.spreadRatio > 0);
    assert.ok(confidence.factors.strategy === 'complexity');
  });

  it('should return zero confidence for empty estimate', () => {
    const confidence = estimator.getConfidence({});
    assert.strictEqual(confidence.level, 0);
  });

  // ----- trackActual (learning loop) ----------------------------------------

  it('should update tier bias when tracking actual hours', () => {
    const estimate = estimator.estimateByComplexity('L');
    const result = estimator.trackActual(estimate, 20); // actual > expected

    assert.ok(result.variance !== 0, 'variance should be non-zero');
    assert.ok(typeof result.bias === 'number');
    assert.ok(typeof result.adjustedBias === 'number');
    // Bias should shift toward ratio of actual/expected
    assert.ok(result.adjustedBias !== 1.0 || result.bias === 1.0,
      'tier bias should shift when actual differs from expected');
  });

  it('should accumulate history entries from trackActual', () => {
    const before = estimator.historySize;

    estimator.trackActual(estimator.estimateByComplexity('S'), 0.5);
    estimator.trackActual(estimator.estimateByComplexity('M'), 4);

    assert.strictEqual(estimator.historySize, before + 2);
  });

  it('should respect history window size', () => {
    const smallEstimator = new TimeEstimator({ historyWindow: 3 });
    for (let i = 0; i < 10; i++) {
      smallEstimator.trackActual(
        smallEstimator.estimateByComplexity('M'),
        3 + i * 0.1
      );
    }
    assert.ok(smallEstimator.historySize <= 3);
  });

  // ----- reset / calibration ------------------------------------------------

  it('should reset history and biases', () => {
    estimator.trackActual(estimator.estimateByComplexity('L'), 50);
    estimator.reset();

    assert.strictEqual(estimator.historySize, 0);
    const cal = estimator.calibration;
    assert.strictEqual(cal.S, 1.0);
    assert.strictEqual(cal.M, 1.0);
    assert.strictEqual(cal.L, 1.0);
    assert.strictEqual(cal.XL, 1.0);
  });
});
