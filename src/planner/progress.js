"use strict";

const { EventEmitter } = require("node:events");

/**
 * ProgressTracker -- runtime progress tracking for task plans.
 *
 * Maintains a live view of task completion state, exposes next-action
 * recommendations, critical-path analysis, and a chronological timeline.
 * Emits events so external observers can react to plan transitions.
 */

const VALID_STATUSES = new Set(["pending", "inProgress", "complete", "blocked", "cancelled"]);

class ProgressTracker extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._plans = new Map();
  }

  // ---- Plan lifecycle -----------------------------------------------------

  /**
   * Register a new plan with its goal and initial task list.
   *
   * @param {string} goal - natural-language goal description
   * @param {object[]} tasks - array of task descriptors
   *   Each task: { id: string, title: string, dependsOn?: string[], ... }
   * @param {object} [meta={}] - arbitrary metadata
   * @returns {object} the newly created plan snapshot
   */
  createPlan(goal, tasks, meta = {}) {
    if (!goal || typeof goal !== "string" || goal.trim().length === 0) {
      throw new Error("Goal must be a non-empty string.");
    }
    if (!Array.isArray(tasks)) {
      throw new Error("Tasks must be an array.");
    }

    const planId = this._nextPlanId();
    const now = new Date().toISOString();

    const state = {};
    for (const task of tasks) {
      if (!task.id || typeof task.id !== "string") {
        throw new Error(`Every task must have a string "id". Got: ${JSON.stringify(task)}`);
      }
      state[task.id] = {
        id: task.id,
        title: String(task.title || task.id),
        status: "pending",
        dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.slice() : [],
        startedAt: null,
        completedAt: null,
        meta: task.meta || {},
      };
    }

    const plan = {
      planId,
      goal: goal.trim(),
      tasks: state,
      taskOrder: tasks.map((t) => t.id),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      meta: Object.assign({}, meta),
    };

    this._plans.set(planId, plan);
    this.emit("plan.created", { planId, goal: plan.goal, taskCount: tasks.length });

    return this._snapshotPlan(plan);
  }

  // ---- Status transitions -------------------------------------------------

  /**
   * Mark a task as in-progress.
   *
   * @param {string} planId
   * @param {string} taskId
   * @returns {object} updated plan snapshot
   */
  markInProgress(planId, taskId) {
    return this._transition(planId, taskId, "inProgress");
  }

  /**
   * Mark a task as complete.
   *
   * @param {string} planId
   * @param {string} taskId
   * @returns {object} updated plan snapshot
   */
  markComplete(planId, taskId) {
    return this._transition(planId, taskId, "complete");
  }

  /**
   * Mark a task as blocked.
   *
   * @param {string} planId
   * @param {string} taskId
   * @param {string} [reason] - why it's blocked
   * @returns {object} updated plan snapshot
   */
  markBlocked(planId, taskId, reason) {
    const plan = this._getPlan(planId);
    const task = this._getTask(plan, taskId);
    task.blockedReason = String(reason || "Unspecified");
    return this._transition(planId, taskId, "blocked");
  }

  /**
   * Cancel a task (terminal, distinct from blocked).
   *
   * @param {string} planId
   * @param {string} taskId
   * @returns {object} updated plan snapshot
   */
  cancelTask(planId, taskId) {
    return this._transition(planId, taskId, "cancelled");
  }

  /**
   * Reset a task back to pending (useful for replanning).
   *
   * @param {string} planId
   * @param {string} taskId
   * @returns {object} updated plan snapshot
   */
  resetTask(planId, taskId) {
    const plan = this._getPlan(planId);
    const task = this._getTask(plan, taskId);
    task.status = "pending";
    task.startedAt = null;
    task.completedAt = null;
    plan.updatedAt = new Date().toISOString();
    this.emit("task.reset", { planId, taskId });
    return this._snapshotPlan(plan);
  }

  // ---- Queries ------------------------------------------------------------

  /**
   * Return a numeric progress summary.
   *
   * @param {string} planId
   * @returns {{ total: number, done: number, inProgress: number, pending: number, blocked: number, cancelled: number, percent: number }}
   */
  getProgress(planId) {
    const plan = this._getPlan(planId);
    const tasks = Object.values(plan.tasks);
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "complete").length;
    const inProgress = tasks.filter((t) => t.status === "inProgress").length;
    const pending = tasks.filter((t) => t.status === "pending").length;
    const blocked = tasks.filter((t) => t.status === "blocked").length;
    const cancelled = tasks.filter((t) => t.status === "cancelled").length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    return { total, done, inProgress, pending, blocked, cancelled, percent };
  }

  /**
   * Return tasks that cannot start because at least one dependency is
   * not yet complete.
   *
   * @param {string} planId
   * @returns {object[]}
   */
  getBlockedTasks(planId) {
    const plan = this._getPlan(planId);
    const result = [];

    for (const task of Object.values(plan.tasks)) {
      if (task.status === "blocked") {
        result.push(this._serializeTask(task));
        continue;
      }

      if (task.status !== "pending") continue;

      const unmet = task.dependsOn.filter((depId) => {
        const dep = plan.tasks[depId];
        return !dep || dep.status !== "complete";
      });

      if (unmet.length > 0) {
        result.push({
          ...this._serializeTask(task),
          unmetDependencies: unmet,
          effectiveStatus: "blocked",
        });
      }
    }

    return result;
  }

  /**
   * Suggest the next task(s) a worker should pick up.
   * Returns pending tasks whose dependencies are all satisfied,
   * sorted so that tasks on the critical path come first.
   *
   * @param {string} planId
   * @param {number} [limit=3] - max number of suggestions
   * @returns {object[]}
   */
  getNextTasks(planId, limit = 3) {
    const plan = this._getPlan(planId);
    const criticalIds = this._computeCriticalPath(plan);
    const criticalSet = new Set(criticalIds);
    const ready = [];

    for (const task of Object.values(plan.tasks)) {
      if (task.status !== "pending") continue;

      const allDepsMet = task.dependsOn.every((depId) => {
        const dep = plan.tasks[depId];
        return dep && dep.status === "complete";
      });

      if (allDepsMet) {
        ready.push(task);
      }
    }

    // Sort: critical-path tasks first, then by original taskOrder
    const orderIndex = new Map(plan.taskOrder.map((id, i) => [id, i]));
    ready.sort((a, b) => {
      const aCrit = criticalSet.has(a.id) ? 0 : 1;
      const bCrit = criticalSet.has(b.id) ? 0 : 1;
      if (aCrit !== bCrit) return aCrit - bCrit;
      return (orderIndex.get(a.id) || 0) - (orderIndex.get(b.id) || 0);
    });

    return ready.slice(0, limit).map((t) => this._serializeTask(t));
  }

  /**
   * Compute the critical path (longest chain of sequential dependencies).
   * Returns task IDs in execution order along the longest path.
   *
   * @param {string} planId
   * @returns {string[]}
   */
  getCriticalPath(planId) {
    const plan = this._getPlan(planId);
    return this._computeCriticalPath(plan);
  }

  /**
   * Build a chronological timeline of task status transitions.
   *
   * @param {string} planId
   * @returns {object[]} timeline entries sorted by timestamp
   */
  getTimeline(planId) {
    const plan = this._getPlan(planId);
    const entries = [];

    for (const task of Object.values(plan.tasks)) {
      if (task.startedAt) {
        entries.push({
          taskId: task.id,
          title: task.title,
          event: "start",
          timestamp: task.startedAt,
        });
      }
      if (task.completedAt) {
        entries.push({
          taskId: task.id,
          title: task.title,
          event: "complete",
          timestamp: task.completedAt,
        });
      }
    }

    entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return entries;
  }

  /**
   * Return the full plan object (useful for debugging / inspection).
   *
   * @param {string} planId
   * @returns {object}
   */
  getPlan(planId) {
    return this._snapshotPlan(this._getPlan(planId));
  }

  /**
   * List all plan IDs.
   *
   * @returns {string[]}
   */
  listPlans() {
    return [...this._plans.keys()];
  }

  /**
   * Remove a plan.
   *
   * @param {string} planId
   * @returns {boolean}
   */
  removePlan(planId) {
    return this._plans.delete(planId);
  }

  // ---- Internal -----------------------------------------------------------

  _transition(planId, taskId, newStatus) {
    const plan = this._getPlan(planId);
    const task = this._getTask(plan, taskId);
    const now = new Date().toISOString();

    if (newStatus === "inProgress") {
      task.startedAt = task.startedAt || now;
    }
    if (newStatus === "complete" || newStatus === "cancelled") {
      task.completedAt = now;
      if (!task.startedAt) {
        task.startedAt = now;
      }
    }
    task.status = newStatus;
    plan.updatedAt = now;

    // Emit events
    if (newStatus === "inProgress") {
      this.emit("task.start", { planId, taskId, task: this._serializeTask(task) });
    }
    if (newStatus === "complete") {
      this.emit("task.complete", { planId, taskId, task: this._serializeTask(task) });

      // Check plan-level completion
      const progress = this.getProgress(planId);
      if (progress.done === progress.total) {
        plan.completedAt = now;
        this.emit("plan.complete", {
          planId,
          goal: plan.goal,
          totalTasks: progress.total,
          completedAt: now,
        });
      }
    }
    if (newStatus === "blocked") {
      this.emit("task.blocked", {
        planId,
        taskId,
        reason: task.blockedReason || "Unspecified",
      });
    }
    if (newStatus === "cancelled") {
      this.emit("task.cancel", { planId, taskId });
    }

    return this._snapshotPlan(plan);
  }

  _computeCriticalPath(plan) {
    const tasks = plan.tasks;
    const ids = Object.keys(tasks);
    if (ids.length === 0) return [];

    // Build adjacency: a task "precedes" any task that depends on it
    const successors = new Map();
    for (const id of ids) {
      successors.set(id, []);
    }
    for (const task of Object.values(tasks)) {
      for (const depId of task.dependsOn) {
        const arr = successors.get(depId);
        if (arr && !arr.includes(task.id)) {
          arr.push(task.id);
        }
      }
    }

    // Longest-path memo
    const memo = new Map();

    const dfs = (id) => {
      if (memo.has(id)) return memo.get(id);
      let best = [];
      for (const succ of successors.get(id) || []) {
        const path = dfs(succ);
        if (path.length > best.length) {
          best = path;
        }
      }
      const result = [id, ...best];
      memo.set(id, result);
      return result;
    };

    let critical = [];
    for (const id of ids) {
      const path = dfs(id);
      if (path.length > critical.length) {
        critical = path;
      }
    }

    return critical;
  }

  _getPlan(planId) {
    const plan = this._plans.get(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }
    return plan;
  }

  _getTask(plan, taskId) {
    const task = plan.tasks[taskId];
    if (!task) {
      throw new Error(`Task not found in plan "${plan.planId}": ${taskId}`);
    }
    return task;
  }

  _serializeTask(task) {
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      dependsOn: task.dependsOn.slice(),
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    };
  }

  _snapshotPlan(plan) {
    const tasks = {};
    for (const [id, task] of Object.entries(plan.tasks)) {
      tasks[id] = this._serializeTask(task);
    }

    return {
      planId: plan.planId,
      goal: plan.goal,
      tasks,
      taskOrder: plan.taskOrder.slice(),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      completedAt: plan.completedAt,
      meta: Object.assign({}, plan.meta),
      progress: this._computeProgress(plan),
    };
  }

  _computeProgress(plan) {
    const tasks = Object.values(plan.tasks);
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "complete").length;
    return {
      total,
      done,
      inProgress: tasks.filter((t) => t.status === "inProgress").length,
      pending: tasks.filter((t) => t.status === "pending").length,
      blocked: tasks.filter((t) => t.status === "blocked").length,
      cancelled: tasks.filter((t) => t.status === "cancelled").length,
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }

  _nextPlanId() {
    return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

module.exports = {
  ProgressTracker,
  VALID_STATUSES,
};
