"use strict";

const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');

const {
  EffortEstimator,
  EFFORT_BASE,
} = require('../../src/planner/estimator');

describe('EffortEstimator', () => {
  describe('estimateTask', () => {
    it('estimates a simple task with low file count as S', () => {
      const estimator = new EffortEstimator();
      const result = estimator.estimateTask(
        { title: 'add a simple comment', type: 'document', effort: 'S' },
        { fileCount: 1 },
      );
      assert.strictEqual(result.tier, 'S');
      assert.ok(result.hours.expected < 2, `Expected < 2h, got ${result.hours.expected}`);
      assert.ok(result.hours.best <= result.hours.expected);
      assert.ok(result.hours.expected <= result.hours.worst);
    });

    it('estimates a complex implementation task as L', () => {
      const estimator = new EffortEstimator();
      const result = estimator.estimateTask(
        { title: 'build a complex distributed cache', type: 'implement', effort: 'L' },
        { fileCount: 15, linesChanged: 800, dependencyCount: 5 },
      );
      assert.strictEqual(result.tier, 'L');
      assert.ok(result.hours.expected > 5, `Expected > 5h for large task`);
    });

    it('applies file-count multipliers', () => {
      const estimator = new EffortEstimator();
      const small = estimator.estimateTask(
        { title: 'update config', type: 'implement', effort: 'M' },
        { fileCount: 1 },
      );
      const large = estimator.estimateTask(
        { title: 'update config', type: 'implement', effort: 'M' },
        { fileCount: 25 },
      );
      assert.ok(
        large.hours.expected > small.hours.expected,
        `Large file count (${large.hours.expected}h) should exceed small (${small.hours.expected}h)`,
      );
    });

    it('applies test-burden multipliers', () => {
      const estimator = new EffortEstimator();
      const low = estimator.estimateTask(
        { title: 'add feature', type: 'implement', effort: 'M' },
        { fileCount: 3, testBurden: 'low' },
      );
      const high = estimator.estimateTask(
        { title: 'add feature', type: 'implement', effort: 'M' },
        { fileCount: 3, testBurden: 'high' },
      );
      assert.ok(high.hours.expected > low.hours.expected);
    });

    it('applies dependency-complexity multipliers', () => {
      const estimator = new EffortEstimator();
      const none = estimator.estimateTask(
        { title: 'build component', type: 'implement', effort: 'M' },
        { fileCount: 3 },
      );
      const high = estimator.estimateTask(
        { title: 'build component', type: 'implement', effort: 'M' },
        { fileCount: 3, dependencyCount: 10 },
      );
      assert.ok(high.hours.expected > none.hours.expected);
    });

    it('caps lines-multiplier at 2x', () => {
      const estimator = new EffortEstimator();
      const result = estimator.estimateTask(
        { title: 'massive refactor', type: 'implement', effort: 'M' },
        { fileCount: 3, linesChanged: 5000 },
      );
      assert.ok(result.factors.linesMultiplier <= 2.0);
    });

    it('returns factor details for transparency', () => {
      const estimator = new EffortEstimator();
      const result = estimator.estimateTask(
        { title: 'build API endpoint', type: 'implement', effort: 'M' },
        { fileCount: 5, linesChanged: 200, testBurden: 'medium', dependencyCount: 3 },
      );
      assert.strictEqual(result.factors.fileCount, 5);
      assert.strictEqual(result.factors.fileTier, 'medium');
      assert.strictEqual(result.factors.testBurden, 'medium');
      assert.strictEqual(result.factors.dependencyCount, 3);
    });
  });

  describe('estimateProject', () => {
    it('aggregates multiple task estimates', () => {
      const estimator = new EffortEstimator();
      const tasks = [
        { title: 'design interface', type: 'design', effort: 'S' },
        { title: 'implement core', type: 'implement', effort: 'L' },
        { title: 'write tests', type: 'test', effort: 'M' },
      ];
      const result = estimator.estimateProject(tasks, { fileCount: 4 });

      assert.strictEqual(result.tasks.length, 3);
      assert.ok(result.aggregate.expected > 0);
      assert.ok(result.aggregate.best <= result.aggregate.expected);
      assert.ok(result.aggregate.expected <= result.aggregate.worst);
    });

    it('returns zero for empty task list', () => {
      const estimator = new EffortEstimator();
      const result = estimator.estimateProject([]);
      assert.strictEqual(result.aggregate.best, 0);
      assert.strictEqual(result.aggregate.expected, 0);
      assert.strictEqual(result.aggregate.worst, 0);
    });
  });

  describe('confidenceInterval', () => {
    it('computes best/expected/worst range', () => {
      const estimator = new EffortEstimator();
      const est1 = estimator.estimateTask({ title: 'task A', type: 'implement', effort: 'M' });
      const est2 = estimator.estimateTask({ title: 'task B', type: 'test', effort: 'S' });
      const ci = estimator.confidenceInterval([est1, est2]);

      assert.ok(ci.best > 0);
      assert.ok(ci.expected > ci.best);
      assert.ok(ci.worst >= ci.expected);
      assert.ok(ci.range.includes('h'));
    });

    it('returns zero for empty input', () => {
      const estimator = new EffortEstimator();
      const ci = estimator.confidenceInterval([]);
      assert.strictEqual(ci.expected, 0);
    });
  });

  describe('trackVsEstimate', () => {
    it('reports on-target when actual is within range', () => {
      const estimator = new EffortEstimator();
      const est = { hours: { best: 2, expected: 4, worst: 8 } };
      const result = estimator.trackVsEstimate(est, 5);
      assert.strictEqual(result.withinRange, true);
      assert.strictEqual(result.assessment, 'on target');
    });

    it('detects overruns', () => {
      const estimator = new EffortEstimator();
      const est = { hours: { best: 2, expected: 4, worst: 8 } };
      const result = estimator.trackVsEstimate(est, 20);
      assert.strictEqual(result.withinRange, false);
      assert.strictEqual(result.assessment, 'severely overrun');
    });

    it('detects tasks faster than expected', () => {
      const estimator = new EffortEstimator();
      const est = { hours: { best: 2, expected: 4, worst: 8 } };
      const result = estimator.trackVsEstimate(est, 1);
      assert.strictEqual(result.withinRange, false);
      assert.strictEqual(result.assessment, 'underestimated (faster than best case)');
    });

    it('computes percentage off', () => {
      const estimator = new EffortEstimator();
      const est = { hours: { best: 2, expected: 4, worst: 8 } };
      const result = estimator.trackVsEstimate(est, 8);
      assert.strictEqual(result.withinRange, true);
      assert.strictEqual(result.percentOff, 100);
    });
  });

  describe('resolveTier', () => {
    it('uses explicit task.effort tier when provided', () => {
      const estimator = new EffortEstimator();
      const result = estimator.estimateTask({ title: 'do work', type: 'implement', effort: 'XL' });
      assert.strictEqual(result.tier, 'XL');
    });

    it('falls back to keyword heuristics in title', () => {
      const estimator = new EffortEstimator();
      const result = estimator.estimateTask({ title: 'trivial one-line change' });
      assert.strictEqual(result.tier, 'S');
    });
  });
});
