"use strict";

const { strict: assert } = require('node:assert');
const { describe, it, beforeEach } = require('node:test');

const { ProgressTracker } = require('../../src/planner/progress');

describe('ProgressTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new ProgressTracker();
  });

  describe('createPlan', () => {
    it('creates a plan and returns a snapshot', () => {
      const tasks = [
        { id: 'T1', title: 'Design schema' },
        { id: 'T2', title: 'Implement schema', dependsOn: ['T1'] },
      ];
      const plan = tracker.createPlan('build a REST API', tasks);

      assert.ok(plan.planId.startsWith('plan-'));
      assert.strictEqual(plan.goal, 'build a REST API');
      assert.strictEqual(Object.keys(plan.tasks).length, 2);
      assert.strictEqual(plan.tasks.T1.status, 'pending');
      assert.strictEqual(plan.tasks.T2.dependsOn.length, 1);
      assert.strictEqual(plan.tasks.T2.dependsOn[0], 'T1');
    });

    it('throws on empty goal', () => {
      assert.throws(() => tracker.createPlan('', []), /Goal must be a non-empty string/);
    });

    it('throws on non-array tasks', () => {
      assert.throws(() => tracker.createPlan('do stuff', 'not an array'), /Tasks must be an array/);
    });

    it('throws on tasks missing an id', () => {
      assert.throws(
        () => tracker.createPlan('do stuff', [{ title: 'no id' }]),
        /Every task must have a string "id"/,
      );
    });

    it('emits plan.created event', () => {
      let emitted = null;
      tracker.on('plan.created', (evt) => { emitted = evt; });
      tracker.createPlan('test goal', [{ id: 'T1', title: 'task 1' }]);
      assert.ok(emitted);
      assert.strictEqual(emitted.goal, 'test goal');
      assert.strictEqual(emitted.taskCount, 1);
    });
  });

  describe('markInProgress', () => {
    it('transitions a pending task to inProgress', () => {
      tracker.createPlan('test', [{ id: 'T1', title: 'task' }]);
      const planId = tracker.listPlans()[0];

      const updated = tracker.markInProgress(planId, 'T1');
      assert.strictEqual(updated.tasks.T1.status, 'inProgress');
      assert.ok(updated.tasks.T1.startedAt);
    });

    it('emits task.start event', () => {
      let emitted = null;
      tracker.on('task.start', (evt) => { emitted = evt; });
      tracker.createPlan('test', [{ id: 'T1', title: 'task' }]);
      const planId = tracker.listPlans()[0];
      tracker.markInProgress(planId, 'T1');
      assert.ok(emitted);
      assert.strictEqual(emitted.taskId, 'T1');
    });
  });

  describe('markComplete', () => {
    it('transitions a task to complete and updates timestamp', () => {
      tracker.createPlan('test', [{ id: 'T1', title: 'task' }]);
      const planId = tracker.listPlans()[0];
      tracker.markInProgress(planId, 'T1');
      const updated = tracker.markComplete(planId, 'T1');

      assert.strictEqual(updated.tasks.T1.status, 'complete');
      assert.ok(updated.tasks.T1.completedAt);
    });

    it('emits task.complete event', () => {
      let emitted = null;
      tracker.on('task.complete', (evt) => { emitted = evt; });
      tracker.createPlan('test', [{ id: 'T1', title: 'task' }]);
      const planId = tracker.listPlans()[0];
      tracker.markComplete(planId, 'T1');
      assert.ok(emitted);
      assert.strictEqual(emitted.taskId, 'T1');
    });

    it('emits plan.complete when last task finishes', () => {
      let emitted = null;
      tracker.on('plan.complete', (evt) => { emitted = evt; });
      tracker.createPlan('test', [
        { id: 'T1', title: 'task 1' },
        { id: 'T2', title: 'task 2' },
      ]);
      const planId = tracker.listPlans()[0];
      tracker.markComplete(planId, 'T1');
      tracker.markComplete(planId, 'T2');
      assert.ok(emitted);
      assert.strictEqual(emitted.totalTasks, 2);
    });
  });

  describe('getProgress', () => {
    it('reports zero progress for a fresh plan', () => {
      tracker.createPlan('test', [
        { id: 'T1', title: 'task 1' },
        { id: 'T2', title: 'task 2', dependsOn: ['T1'] },
      ]);
      const planId = tracker.listPlans()[0];
      const progress = tracker.getProgress(planId);

      assert.strictEqual(progress.total, 2);
      assert.strictEqual(progress.done, 0);
      assert.strictEqual(progress.pending, 2);
      assert.strictEqual(progress.percent, 0);
    });

    it('reports 50% after completing one of two tasks', () => {
      tracker.createPlan('test', [
        { id: 'T1', title: 'task 1' },
        { id: 'T2', title: 'task 2' },
      ]);
      const planId = tracker.listPlans()[0];
      tracker.markComplete(planId, 'T1');
      const progress = tracker.getProgress(planId);

      assert.strictEqual(progress.done, 1);
      assert.strictEqual(progress.percent, 50);
    });

    it('reports 100% after all done', () => {
      tracker.createPlan('test', [
        { id: 'T1', title: 'task 1' },
        { id: 'T2', title: 'task 2' },
      ]);
      const planId = tracker.listPlans()[0];
      tracker.markComplete(planId, 'T1');
      tracker.markComplete(planId, 'T2');
      const progress = tracker.getProgress(planId);

      assert.strictEqual(progress.done, 2);
      assert.strictEqual(progress.percent, 100);
    });
  });

  describe('getBlockedTasks', () => {
    it('returns tasks with unmet dependencies', () => {
      tracker.createPlan('test', [
        { id: 'T1', title: 'Design', dependsOn: [] },
        { id: 'T2', title: 'Implement', dependsOn: ['T1'] },
        { id: 'T3', title: 'Test', dependsOn: ['T2'] },
      ]);
      const planId = tracker.listPlans()[0];
      const blocked = tracker.getBlockedTasks(planId);

      // T2 and T3 should be blocked (T1 not done)
      const blockedIds = blocked.map((t) => t.id);
      assert.ok(blockedIds.includes('T2'));
      assert.ok(blockedIds.includes('T3'));

      // T1 should not be blocked
      assert.ok(!blockedIds.includes('T1'));
    });

    it('returns explicitly blocked tasks', () => {
      tracker.createPlan('test', [{ id: 'T1', title: 'blocked task' }]);
      const planId = tracker.listPlans()[0];
      tracker.markBlocked(planId, 'T1', 'waiting for API key');
      const blocked = tracker.getBlockedTasks(planId);

      assert.strictEqual(blocked.length, 1);
      assert.strictEqual(blocked[0].id, 'T1');
    });
  });

  describe('getNextTasks', () => {
    it('returns pending tasks with all dependencies met', () => {
      tracker.createPlan('test', [
        { id: 'T1', title: 'Design' },
        { id: 'T2', title: 'Implement', dependsOn: ['T1'] },
        { id: 'T3', title: 'Deploy', dependsOn: ['T2'] },
      ]);
      const planId = tracker.listPlans()[0];
      const next = tracker.getNextTasks(planId);

      // Only T1 should be ready
      assert.strictEqual(next.length, 1);
      assert.strictEqual(next[0].id, 'T1');
    });

    it('respects the limit parameter', () => {
      tracker.createPlan('test', [
        { id: 'T1', title: 'A' },
        { id: 'T2', title: 'B' },
        { id: 'T3', title: 'C' },
      ]);
      const planId = tracker.listPlans()[0];
      const next = tracker.getNextTasks(planId, 2);

      assert.ok(next.length <= 2);
    });

    it('returns tasks after dependencies are completed', () => {
      tracker.createPlan('test', [
        { id: 'T1', title: 'Design' },
        { id: 'T2', title: 'Implement', dependsOn: ['T1'] },
        { id: 'T3', title: 'Test', dependsOn: ['T2'] },
      ]);
      const planId = tracker.listPlans()[0];
      tracker.markComplete(planId, 'T1');
      const next = tracker.getNextTasks(planId);

      assert.strictEqual(next.length, 1);
      assert.strictEqual(next[0].id, 'T2');
    });
  });

  describe('getCriticalPath', () => {
    it('returns the longest dependency chain', () => {
      tracker.createPlan('test', [
        { id: 'T1', title: 'A' },
        { id: 'T2', title: 'B', dependsOn: ['T1'] },
        { id: 'T3', title: 'C', dependsOn: ['T2'] },
        { id: 'T4', title: 'D' },
      ]);
      const planId = tracker.listPlans()[0];
      const path = tracker.getCriticalPath(planId);

      // Longest chain is T1 -> T2 -> T3 (length 3)
      assert.strictEqual(path.length, 3);
      assert.strictEqual(path[0], 'T1');
      assert.strictEqual(path[1], 'T2');
      assert.strictEqual(path[2], 'T3');
    });

    it('returns a single task when no dependencies exist', () => {
      tracker.createPlan('test', [{ id: 'T1', title: 'solo' }]);
      const planId = tracker.listPlans()[0];
      const path = tracker.getCriticalPath(planId);

      assert.strictEqual(path.length, 1);
      assert.strictEqual(path[0], 'T1');
    });
  });

  describe('getTimeline', () => {
    it('returns chronological entries for start and complete events', () => {
      tracker.createPlan('test', [{ id: 'T1', title: 'task' }]);
      const planId = tracker.listPlans()[0];
      tracker.markInProgress(planId, 'T1');
      tracker.markComplete(planId, 'T1');

      const timeline = tracker.getTimeline(planId);
      assert.strictEqual(timeline.length, 2);
      assert.strictEqual(timeline[0].event, 'start');
      assert.strictEqual(timeline[1].event, 'complete');
      assert.ok(new Date(timeline[0].timestamp) <= new Date(timeline[1].timestamp));
    });

    it('returns empty array when no tasks have started', () => {
      tracker.createPlan('test', [{ id: 'T1', title: 'task' }]);
      const planId = tracker.listPlans()[0];
      const timeline = tracker.getTimeline(planId);

      assert.strictEqual(timeline.length, 0);
    });
  });

  describe('markBlocked and cancelTask', () => {
    it('marks a task as blocked with a reason', () => {
      tracker.createPlan('test', [{ id: 'T1', title: 'task' }]);
      const planId = tracker.listPlans()[0];
      const updated = tracker.markBlocked(planId, 'T1', 'missing credentials');

      assert.strictEqual(updated.tasks.T1.status, 'blocked');
    });

    it('cancels a task', () => {
      tracker.createPlan('test', [{ id: 'T1', title: 'task' }]);
      const planId = tracker.listPlans()[0];
      const updated = tracker.cancelTask(planId, 'T1');

      assert.strictEqual(updated.tasks.T1.status, 'cancelled');
      assert.ok(updated.tasks.T1.completedAt);
    });
  });

  describe('resetTask', () => {
    it('resets a completed task back to pending', () => {
      tracker.createPlan('test', [{ id: 'T1', title: 'task' }]);
      const planId = tracker.listPlans()[0];
      tracker.markComplete(planId, 'T1');
      const updated = tracker.resetTask(planId, 'T1');

      assert.strictEqual(updated.tasks.T1.status, 'pending');
      assert.strictEqual(updated.tasks.T1.startedAt, null);
      assert.strictEqual(updated.tasks.T1.completedAt, null);
    });
  });

  describe('listPlans and removePlan', () => {
    it('lists and removes plans', () => {
      tracker.createPlan('plan A', [{ id: 'T1', title: 'a' }]);
      tracker.createPlan('plan B', [{ id: 'T1', title: 'b' }]);

      const all = tracker.listPlans();
      assert.strictEqual(all.length, 2);

      const removed = tracker.removePlan(all[0]);
      assert.strictEqual(removed, true);

      const remaining = tracker.listPlans();
      assert.strictEqual(remaining.length, 1);
    });
  });
});
