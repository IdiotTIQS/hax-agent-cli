"use strict";

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const { TimeAnalytics } = require('../../src/time/analytics');

describe('TimeAnalytics', () => {
  let analytics;

  beforeEach(() => {
    analytics = new TimeAnalytics();
  });

  // Helper to populate with realistic task data
  function populateSampleData() {
    analytics.trackTime('task-1', 'analysis', 1.5, { title: 'Login feature' });
    analytics.trackTime('task-1', 'implementation', 4.0);
    analytics.trackTime('task-1', 'testing', 2.0);
    analytics.trackTime('task-1', 'review', 0.5, { completed: true });

    analytics.trackTime('task-2', 'analysis', 0.5, { title: 'Bug fix' });
    analytics.trackTime('task-2', 'implementation', 1.5);
    analytics.trackTime('task-2', 'testing', 0.5, { completed: true });

    analytics.trackTime('task-3', 'planning', 2.0, { title: 'Refactor module' });
    analytics.trackTime('task-3', 'design', 1.0);
    analytics.trackTime('task-3', 'implementation', 6.0);
    analytics.trackTime('task-3', 'waiting', 3.0); // blocked
    analytics.trackTime('task-3', 'testing', 2.0, { completed: true });
  }

  // ----- trackTime ----------------------------------------------------------

  it('should record time entries', () => {
    analytics.trackTime('task-1', 'implementation', 2.5, { title: 'Test task' });

    assert.strictEqual(analytics.recordCount, 1);
    assert.deepStrictEqual(analytics.taskIds, ['task-1']);
  });

  it('should accumulate multiple entries for same task', () => {
    analytics.trackTime('task-1', 'implementation', 2);
    analytics.trackTime('task-1', 'testing', 1);
    analytics.trackTime('task-1', 'implementation', 3);

    assert.strictEqual(analytics.recordCount, 3);
    assert.strictEqual(analytics.taskIds.length, 1);
  });

  it('should ignore zero or negative durations', () => {
    analytics.trackTime('task-1', 'implementation', 0);
    analytics.trackTime('task-1', 'testing', -1);

    assert.strictEqual(analytics.recordCount, 0);
  });

  // ----- getTimeBreakdown ---------------------------------------------------

  it('should provide per-phase breakdown for a task', () => {
    populateSampleData();

    const breakdown = analytics.getTimeBreakdown('task-1');

    assert.strictEqual(breakdown.taskId, 'task-1');
    assert.ok(breakdown.totalHours > 0);
    assert.ok(breakdown.phases.analysis, 'should have analysis phase');
    assert.ok(breakdown.phases.implementation, 'should have implementation phase');
    assert.ok(breakdown.phases.testing, 'should have testing phase');

    // Check percentages sum to roughly 100
    const totalPercent = Object.values(breakdown.phases)
      .reduce((sum, p) => sum + p.percentage, 0);
    assert.ok(Math.abs(totalPercent - 100) < 1,
      `phase percentages (${totalPercent}) should sum to ~100`);
  });

  it('should return zero breakdown for unknown task', () => {
    const breakdown = analytics.getTimeBreakdown('nonexistent');

    assert.strictEqual(breakdown.totalHours, 0);
    assert.strictEqual(breakdown.phaseCount, 0);
  });

  // ----- getProductivityStats -----------------------------------------------

  it('should compute productivity statistics', () => {
    populateSampleData();

    const stats = analytics.getProductivityStats('all');

    assert.ok(stats.totalHours > 0, 'should have total hours');
    assert.ok(stats.taskCount > 0, 'should have task count');
    assert.ok(stats.productivityScore >= 0 && stats.productivityScore <= 1,
      `productivityScore ${stats.productivityScore} should be in [0,1]`);
    assert.ok(stats.tasksPerDay >= 0);
    assert.ok(stats.avgTaskDuration > 0);
    assert.ok(stats.phasesBreakdown, 'should have phases breakdown');
  });

  it('should filter by timeframe', () => {
    populateSampleData();

    const dayStats = analytics.getProductivityStats('day');
    const allStats = analytics.getProductivityStats('all');

    assert.ok(dayStats.totalHours <= allStats.totalHours,
      'day stats should have <= hours than all stats');
  });

  it('should return empty stats when no data', () => {
    const stats = analytics.getProductivityStats('all');

    assert.strictEqual(stats.totalHours, 0);
    assert.strictEqual(stats.taskCount, 0);
    assert.strictEqual(stats.productivityScore, 0);
  });

  // ----- identifyBottlenecks ------------------------------------------------

  it('should identify bottlenecks from task data', () => {
    populateSampleData();

    const { bottlenecks, summary } = analytics.identifyBottlenecks();

    assert.ok(Array.isArray(bottlenecks));
    assert.ok(typeof summary === 'string');

    // task-3 has 3h waiting — should be flagged
    const waitingBottleneck = bottlenecks.find((b) => b.type === 'excessive_waiting');
    assert.ok(waitingBottleneck, 'should detect excessive waiting on task-3');
    assert.ok(waitingBottleneck.waitingHours >= 3);
  });

  it('should not identify bottlenecks with insufficient data', () => {
    analytics.trackTime('task-1', 'implementation', 1);

    const { bottlenecks, summary } = analytics.identifyBottlenecks();

    assert.strictEqual(bottlenecks.length, 0);
    assert.ok(summary.includes('Insufficient'));
  });

  // ----- getTimeDistribution ------------------------------------------------

  it('should show time distribution across tasks', () => {
    populateSampleData();

    const distribution = analytics.getTimeDistribution();

    assert.ok(distribution.totalHours > 0);
    assert.ok(distribution.taskCount > 0);
    assert.ok(distribution.byPhase, 'should have byPhase');
    assert.ok(distribution.byTask, 'should have byTask');
    assert.ok(distribution.largestConsumer, 'should identify largest consumer');
    assert.ok(distribution.largestConsumer.hours > 0);
  });

  it('should filter distribution by specific task IDs', () => {
    populateSampleData();

    const distribution = analytics.getTimeDistribution(['task-1']);

    assert.strictEqual(distribution.taskCount, 1);
    assert.ok(distribution.byTask['task-1']);
    assert.strictEqual(distribution.byTask['task-2'], undefined);
  });

  // ----- generateTimesheet --------------------------------------------------

  it('should generate a timesheet report', () => {
    populateSampleData();

    const timesheet = analytics.generateTimesheet('all');

    assert.ok(timesheet.generatedAt, 'should have generation timestamp');
    assert.strictEqual(timesheet.timeframe, 'all');
    assert.ok(timesheet.totalHours > 0);
    assert.ok(timesheet.taskCount > 0);
    assert.ok(timesheet.recordCount > 0);
    assert.ok(timesheet.byDay, 'should have byDay');
    assert.ok(timesheet.byPhase, 'should have byPhase');
    assert.ok(timesheet.byTask, 'should have byTask');
    assert.ok(timesheet.productivity, 'should include productivity stats');
  });

  it('should generate empty timesheet when no data', () => {
    const timesheet = analytics.generateTimesheet('day');

    assert.strictEqual(timesheet.totalHours, 0);
    assert.strictEqual(timesheet.taskCount, 0);
    assert.strictEqual(timesheet.recordCount, 0);
  });

  // ----- getRecords / clear -------------------------------------------------

  it('should filter records by task and phase', () => {
    populateSampleData();

    const implRecords = analytics.getRecords({ phase: 'implementation' });
    assert.ok(implRecords.length > 0);
    assert.ok(implRecords.every((r) => r.phase === 'implementation'));

    const task1Records = analytics.getRecords({ taskId: 'task-1' });
    assert.ok(task1Records.length > 0);
    assert.ok(task1Records.every((r) => r.taskId === 'task-1'));
  });

  it('should clear all records', () => {
    populateSampleData();
    assert.ok(analytics.recordCount > 0);

    analytics.clear();
    assert.strictEqual(analytics.recordCount, 0);
    assert.strictEqual(analytics.taskIds.length, 0);
  });
});
