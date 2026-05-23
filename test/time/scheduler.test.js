"use strict";

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const { WorkScheduler } = require('../../src/time/scheduler');

describe('WorkScheduler', () => {
  let scheduler;

  beforeEach(() => {
    scheduler = new WorkScheduler();
  });

  // ----- Constructor / configuration ----------------------------------------

  it('should initialise with default working hours', () => {
    const hours = scheduler.getWorkingHours();
    assert.strictEqual(hours.start, 9);
    assert.strictEqual(hours.end, 17);
  });

  it('should reject invalid working hours', () => {
    assert.throws(() => {
      scheduler.setWorkingHours(17, 9); // start > end
    });
  });

  it('should configure custom working hours', () => {
    scheduler.setWorkingHours(8, 18);
    const hours = scheduler.getWorkingHours();
    assert.strictEqual(hours.start, 8);
    assert.strictEqual(hours.end, 18);
  });

  // ----- scheduleTask -------------------------------------------------------

  it('should schedule a task and return the scheduled entry', () => {
    const { scheduled, conflicted } = scheduler.scheduleTask({
      title: 'Review PR',
      type: 'review',
      priority: 'high',
      estimatedHours: 2,
    });

    assert.ok(scheduled.id, 'should have an id');
    assert.strictEqual(scheduled.priority, 'high');
    assert.strictEqual(scheduled.estimatedHours, 2);
    assert.strictEqual(scheduled.status, 'scheduled');
    assert.ok(scheduled.scheduledStart < scheduled.scheduledEnd);
    assert.strictEqual(conflicted, false);
  });

  it('should schedule a task with a deadline', () => {
    const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow
    const { scheduled, conflicted } = scheduler.scheduleTask(
      { title: 'Bug fix', priority: 'critical', estimatedHours: 1 },
      deadline
    );

    assert.strictEqual(scheduled.deadline, deadline.getTime());
    assert.strictEqual(conflicted, false);
  });

  it('should flag conflict when task cannot meet deadline', () => {
    const pastDeadline = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    const { conflicted } = scheduler.scheduleTask(
      { title: 'Impossible task', priority: 'critical', estimatedHours: 40 },
      pastDeadline
    );

    assert.strictEqual(conflicted, true);
  });

  it('should avoid overlapping schedules by default', () => {
    const { scheduled: first } = scheduler.scheduleTask({
      title: 'Task A', priority: 'medium', estimatedHours: 4,
    });

    const { scheduled: second } = scheduler.scheduleTask({
      title: 'Task B', priority: 'medium', estimatedHours: 4,
    });

    // Second task should start after first ends (or at least not overlap)
    assert.ok(
      second.scheduledStart >= first.scheduledEnd,
      `second start (${second.scheduledStart}) should be >= first end (${first.scheduledEnd})`
    );
  });

  // ----- getSchedule --------------------------------------------------------

  it('should return day schedule', () => {
    scheduler.scheduleTask({ title: 'Task 1', priority: 'medium', estimatedHours: 2 });
    scheduler.scheduleTask({ title: 'Task 2', priority: 'low', estimatedHours: 1 });

    const schedule = scheduler.getSchedule('day');

    assert.strictEqual(schedule.timeframe, 'day');
    assert.ok(schedule.totalTasks >= 2);
    assert.ok(schedule.totalHours > 0);
    assert.ok(schedule.utilization.percentage >= 0);
  });

  it('should return week schedule', () => {
    scheduler.scheduleTask({ title: 'Week task', priority: 'high', estimatedHours: 3 });

    const schedule = scheduler.getSchedule('week');

    assert.strictEqual(schedule.timeframe, 'week');
    assert.ok(schedule.totalTasks >= 1);
  });

  it('should bucket tasks by day', () => {
    scheduler.scheduleTask({ title: 'Today task', priority: 'medium', estimatedHours: 2 });

    const schedule = scheduler.getSchedule('day');
    assert.ok(Object.keys(schedule.byDay).length > 0, 'should have at least one day bucket');
  });

  // ----- optimizeSchedule ---------------------------------------------------

  it('should optimize schedule by priority and deadline', () => {
    // Schedule tasks in suboptimal order: low priority first
    scheduler.scheduleTask({ title: 'Low prio', priority: 'low', estimatedHours: 2 });
    scheduler.scheduleTask({ title: 'Critical', priority: 'critical', estimatedHours: 1 });

    const before = scheduler.getSchedule('week');
    const optimized = scheduler.optimizeSchedule();

    assert.strictEqual(optimized.timeframe, 'week');
    assert.ok(optimized.totalTasks >= 2, 'should still have all tasks after optimization');
  });

  // ----- detectConflicts ----------------------------------------------------

  it('should detect deadline misses', () => {
    const deadline = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now
    scheduler.scheduleTask(
      { title: 'Should miss deadline', priority: 'high', estimatedHours: 8 },
      deadline
    );

    const conflicts = scheduler.detectConflicts();
    const deadlineConflicts = conflicts.filter((c) => c.type === 'deadline_miss');
    assert.ok(deadlineConflicts.length > 0, 'should detect deadline miss');
  });

  it('should detect overlapping tasks when overlap is forced', () => {
    // Use scheduler that allows overlap
    const overlapScheduler = new WorkScheduler({ allowOverlap: true });

    // Schedule at the same start time by scheduling tasks that can overlap
    overlapScheduler.scheduleTask({ title: 'A', priority: 'medium', estimatedHours: 2 });
    overlapScheduler.scheduleTask({ title: 'B', priority: 'medium', estimatedHours: 2 });

    const conflicts = overlapScheduler.detectConflicts();
    const overlapConflicts = conflicts.filter((c) => c.type === 'overlap');
    assert.ok(overlapConflicts.length > 0, 'should detect overlaps when overlap is allowed');
  });

  it('should return empty conflicts for a clean schedule', () => {
    scheduler.scheduleTask({ title: 'Clean task', priority: 'medium', estimatedHours: 1 });

    const conflicts = scheduler.detectConflicts();
    // Should have no deadline_miss conflicts for tasks without deadlines
    const deadlineMisses = conflicts.filter((c) => c.type === 'deadline_miss');
    assert.strictEqual(deadlineMisses.length, 0);
  });

  // ----- getUtilization -----------------------------------------------------

  it('should calculate utilization percentage', () => {
    scheduler.scheduleTask({ title: 'Util task', priority: 'medium', estimatedHours: 4 });

    const utilization = scheduler.getUtilization('day');
    assert.ok(utilization.percentage > 0, 'should have positive utilization');
    assert.ok(utilization.percentage <= 100, 'should not exceed 100%');
    assert.ok(utilization.scheduledHours > 0);
    assert.ok(utilization.availableHours > 0);
  });

  it('should return zero utilization for empty schedule', () => {
    const utilization = scheduler.getUtilization('day');
    assert.strictEqual(utilization.percentage, 0);
    assert.strictEqual(utilization.scheduledHours, 0);
    assert.ok(utilization.availableHours > 0);
  });

  // ----- cancel / complete / clear ------------------------------------------

  it('should cancel a scheduled task', () => {
    const { scheduled } = scheduler.scheduleTask({ title: 'Cancel me', estimatedHours: 1 });
    const success = scheduler.cancel(scheduled.id);

    assert.strictEqual(success, true);
    assert.strictEqual(scheduler.scheduledCount, 0);
  });

  it('should complete a scheduled task', () => {
    const { scheduled } = scheduler.scheduleTask({ title: 'Complete me', estimatedHours: 1 });
    const success = scheduler.complete(scheduled.id);

    assert.strictEqual(success, true);
  });

  it('should clear the entire schedule', () => {
    scheduler.scheduleTask({ title: 'A', estimatedHours: 1 });
    scheduler.scheduleTask({ title: 'B', estimatedHours: 1 });
    scheduler.clear();

    assert.strictEqual(scheduler.scheduledCount, 0);
    assert.strictEqual(scheduler.all.length, 0);
  });
});
