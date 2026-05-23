"use strict";

const { EventEmitter } = require("node:events");

/**
 * GoalTracker -- in-memory goal tracking with milestones, sub-goals,
 * and progress visualization.
 *
 * Maintains a registry of goals, supports hierarchical decomposition
 * (sub-goals), milestone tracking, and manual/automatic progress
 * computation.  Emits lifecycle events for external observers.
 */

const VALID_GOAL_STATUSES = new Set(["active", "completed", "abandoned", "paused"]);
const VALID_PRIORITIES = new Set(["low", "medium", "high", "critical"]);
const VALID_MILESTONE_STATUSES = new Set(["pending", "inProgress", "completed", "blocked", "skipped"]);

class GoalTracker extends EventEmitter {
  constructor() {
    super();
    this._goals = new Map();
  }

  // ---- Goal lifecycle -------------------------------------------------------

  /**
   * Register a new goal.
   *
   * @param {object} goal - partial or full goal descriptor
   *   { title: string, description?: string, milestones?: object[],
   *     subGoals?: object[], status?: string, priority?: string,
   *     deadline?: string }
   * @param {object} [options={}] - extra options forwarded from caller
   * @returns {object} the created goal snapshot
   */
  setGoal(goal, options = {}) {
    if (!goal || typeof goal !== "object") {
      throw new Error("Goal must be a non-null object.");
    }
    if (!goal.title || typeof goal.title !== "string" || goal.title.trim().length === 0) {
      throw new Error("Goal must have a non-empty string title.");
    }

    const id = goal.id || this._nextId();
    if (this._goals.has(id)) {
      throw new Error(`A goal with id "${id}" already exists. Use updateProgress() or addMilestone() to modify.`);
    }

    const now = new Date().toISOString();
    const status = VALID_GOAL_STATUSES.has(goal.status) ? goal.status : "active";
    const priority = VALID_PRIORITIES.has(goal.priority) ? goal.priority : "medium";

    const milestones = Array.isArray(goal.milestones)
      ? goal.milestones.map((m, i) => this._normalizeMilestone(m, i))
      : [];

    const subGoals = Array.isArray(goal.subGoals)
      ? goal.subGoals.map((sg, i) => this._normalizeSubGoal(sg, i))
      : [];

    const entry = {
      id,
      title: goal.title.trim(),
      description: typeof goal.description === "string" ? goal.description.trim() : "",
      milestones,
      subGoals,
      status,
      priority,
      deadline: goal.deadline || null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      manualProgress: null,
    };

    this._goals.set(id, entry);
    this.emit("goal.created", { id, title: entry.title, priority: entry.priority });

    return this._snapshot(entry);
  }

  // ---- Milestones -----------------------------------------------------------

  /**
   * Append a milestone to an existing goal.
   *
   * @param {string} goalId
   * @param {object} milestone - { title: string, dueDate?: string, notes?: string }
   * @returns {object} updated goal snapshot
   */
  addMilestone(goalId, milestone) {
    const goal = this._get(goalId);
    if (!milestone || typeof milestone !== "object" || !milestone.title) {
      throw new Error("Milestone must be an object with a string title.");
    }

    const idx = goal.milestones.length;
    const entry = this._normalizeMilestone(milestone, idx);
    goal.milestones.push(entry);
    goal.updatedAt = new Date().toISOString();

    this.emit("milestone.added", { goalId, milestoneId: entry.id, title: entry.title });
    return this._snapshot(goal);
  }

  /**
   * Update the status of a milestone.
   *
   * @param {string} goalId
   * @param {string} milestoneId
   * @param {string} status - one of pending|inProgress|completed|blocked|skipped
   * @returns {object} updated goal snapshot
   */
  markMilestone(goalId, milestoneId, status) {
    const goal = this._get(goalId);
    const ms = this._getMilestone(goal, milestoneId);

    if (!VALID_MILESTONE_STATUSES.has(status)) {
      throw new Error(`Invalid milestone status "${status}". Must be one of: ${[...VALID_MILESTONE_STATUSES].join(", ")}`);
    }

    const now = new Date().toISOString();
    if (status === "completed" || status === "skipped") {
      ms.completedAt = now;
    } else if (status === "inProgress") {
      ms.startedAt = ms.startedAt || now;
    }

    ms.status = status;
    goal.updatedAt = now;

    this.emit("milestone.updated", { goalId, milestoneId, status });

    // Auto-update sub-goal status if all milestones of a sub-goal are done
    this._recalculateSubGoalStatuses(goal);

    // Auto-transition goal to completed if all milestones are done
    this._checkGoalCompletion(goal);

    return this._snapshot(goal);
  }

  // ---- Sub-goals ------------------------------------------------------------

  /**
   * Add a sub-goal to break the goal into smaller pieces.
   *
   * @param {string} goalId
   * @param {object} subGoal - { title: string, description?: string, milestones?: object[] }
   * @returns {object} updated goal snapshot
   */
  addSubGoal(goalId, subGoal) {
    const goal = this._get(goalId);
    if (!subGoal || typeof subGoal !== "object" || !subGoal.title) {
      throw new Error("Sub-goal must be an object with a string title.");
    }

    const idx = goal.subGoals.length;
    const entry = this._normalizeSubGoal(subGoal, idx);
    goal.subGoals.push(entry);
    goal.updatedAt = new Date().toISOString();

    this.emit("subgoal.added", { goalId, subGoalId: entry.id, title: entry.title });
    return this._snapshot(goal);
  }

  // ---- Progress -------------------------------------------------------------

  /**
   * Manually set a progress percentage override for a goal.
   * If omitted, progress is derived from milestone completion.
   *
   * @param {string} goalId
   * @param {number} percent - integer 0-100
   * @returns {object} updated goal snapshot
   */
  updateProgress(goalId, percent) {
    const goal = this._get(goalId);
    if (typeof percent !== "number" || Number.isNaN(percent) || percent < 0 || percent > 100) {
      throw new Error("Progress percent must be a number between 0 and 100.");
    }

    goal.manualProgress = Math.round(percent);
    goal.updatedAt = new Date().toISOString();

    // Auto-transition if progress reaches 100
    if (goal.manualProgress >= 100) {
      goal.status = "completed";
      goal.completedAt = goal.completedAt || new Date().toISOString();
      this.emit("goal.completed", { goalId: goal.id, title: goal.title });
    }

    this.emit("progress.updated", { goalId, percent: goal.manualProgress });
    return this._snapshot(goal);
  }

  /**
   * Return a detailed progress snapshot for a goal.
   *
   * @param {string} goalId
   * @returns {{ total: number, completed: number, percent: number,
   *             milestones: object[], currentPhase: string|null,
   *             bySubGoal: object[] }}
   */
  getProgress(goalId) {
    const goal = this._get(goalId);

    // Use manual override if set
    if (goal.manualProgress !== null) {
      return {
        total: 100,
        completed: goal.manualProgress,
        percent: goal.manualProgress,
        milestones: goal.milestones.map((m) => this._serializeMilestone(m)),
        currentPhase: this._currentPhase(goal),
        bySubGoal: goal.subGoals.map((sg) => this._serializeSubGoal(sg)),
      };
    }

    const msTotal = goal.milestones.length;
    const msCompleted = goal.milestones.filter(
      (m) => m.status === "completed" || m.status === "skipped",
    ).length;
    const percent = msTotal > 0 ? Math.round((msCompleted / msTotal) * 100) : 0;

    return {
      total: msTotal,
      completed: msCompleted,
      percent,
      milestones: goal.milestones.map((m) => this._serializeMilestone(m)),
      currentPhase: this._currentPhase(goal),
      bySubGoal: goal.subGoals.map((sg) => this._serializeSubGoal(sg)),
    };
  }

  /**
   * Check whether every milestone of a goal is completed (or skipped).
   *
   * @param {string} goalId
   * @returns {boolean}
   */
  isComplete(goalId) {
    const goal = this._get(goalId);
    if (goal.status === "completed") return true;
    if (goal.manualProgress !== null) return goal.manualProgress >= 100;
    if (goal.milestones.length === 0) return false;

    return goal.milestones.every(
      (m) => m.status === "completed" || m.status === "skipped",
    );
  }

  // ---- Query helpers --------------------------------------------------------

  /**
   * Return a goal's full snapshot.
   *
   * @param {string} goalId
   * @returns {object}
   */
  getGoal(goalId) {
    return this._snapshot(this._get(goalId));
  }

  /**
   * List all tracked goal IDs.
   *
   * @returns {string[]}
   */
  listGoals() {
    return [...this._goals.keys()];
  }

  /**
   * List goal summaries for all tracked goals, optionally filtered by status.
   *
   * @param {string} [status] - optional filter
   * @returns {object[]}
   */
  listGoalSummaries(status) {
    const summaries = [];
    for (const goal of this._goals.values()) {
      if (status && goal.status !== status) continue;
      summaries.push({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        priority: goal.priority,
        percent: this.getProgress(goal.id).percent,
        deadline: goal.deadline,
      });
    }
    return summaries;
  }

  /**
   * Change goal status manually (e.g. pause, resume, abandon).
   *
   * @param {string} goalId
   * @param {string} status - one of active|completed|abandoned|paused
   * @returns {object} updated goal snapshot
   */
  setStatus(goalId, status) {
    const goal = this._get(goalId);
    if (!VALID_GOAL_STATUSES.has(status)) {
      throw new Error(`Invalid status "${status}". Must be one of: ${[...VALID_GOAL_STATUSES].join(", ")}`);
    }

    const now = new Date().toISOString();
    goal.status = status;
    goal.updatedAt = now;
    if (status === "completed") {
      goal.completedAt = goal.completedAt || now;
    }

    this.emit("status.changed", { goalId, status });
    if (status === "completed") {
      this.emit("goal.completed", { goalId: goal.id, title: goal.title });
    }

    return this._snapshot(goal);
  }

  /**
   * Remove a goal from tracking entirely.
   *
   * @param {string} goalId
   * @returns {boolean}
   */
  removeGoal(goalId) {
    const existed = this._goals.delete(goalId);
    if (existed) {
      this.emit("goal.removed", { goalId });
    }
    return existed;
  }

  // ---- Internal -------------------------------------------------------------

  _get(goalId) {
    const goal = this._goals.get(goalId);
    if (!goal) {
      throw new Error(`Goal not found: ${goalId}`);
    }
    return goal;
  }

  _getMilestone(goal, milestoneId) {
    const ms = goal.milestones.find((m) => m.id === milestoneId);
    if (!ms) {
      throw new Error(`Milestone "${milestoneId}" not found in goal "${goal.id}".`);
    }
    return ms;
  }

  _normalizeMilestone(m, idx) {
    return {
      id: m.id || `ms-${Date.now().toString(36)}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      title: String(m.title || `Milestone ${idx + 1}`),
      status: VALID_MILESTONE_STATUSES.has(m.status) ? m.status : "pending",
      dueDate: m.dueDate || null,
      completedAt: m.completedAt || null,
      startedAt: m.startedAt || null,
      notes: typeof m.notes === "string" ? m.notes : "",
      subGoalId: typeof m.subGoalId === "string" ? m.subGoalId : null,
    };
  }

  _normalizeSubGoal(sg, idx) {
    return {
      id: sg.id || `sg-${Date.now().toString(36)}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      title: String(sg.title || `Sub-goal ${idx + 1}`),
      description: typeof sg.description === "string" ? sg.description : "",
      status: VALID_GOAL_STATUSES.has(sg.status) ? sg.status : "active",
      completedAt: sg.completedAt || null,
    };
  }

  _recalculateSubGoalStatuses(goal) {
    for (const sg of goal.subGoals) {
      const sgMilestones = goal.milestones.filter((m) => m.subGoalId === sg.id);
      if (sgMilestones.length === 0) continue;

      const allDone = sgMilestones.every(
        (m) => m.status === "completed" || m.status === "skipped",
      );
      if (allDone && sg.status !== "completed") {
        sg.status = "completed";
        sg.completedAt = new Date().toISOString();
        this.emit("subgoal.completed", { goalId: goal.id, subGoalId: sg.id, title: sg.title });
      } else if (!allDone && sg.status === "completed") {
        sg.status = "active";
        sg.completedAt = null;
      }
    }
  }

  _checkGoalCompletion(goal) {
    if (goal.milestones.length === 0) return;
    const allDone = goal.milestones.every(
      (m) => m.status === "completed" || m.status === "skipped",
    );
    if (allDone && goal.status === "active") {
      goal.status = "completed";
      goal.completedAt = new Date().toISOString();
      this.emit("goal.completed", { goalId: goal.id, title: goal.title });
    }
  }

  _currentPhase(goal) {
    const active = goal.milestones.find((m) => m.status === "inProgress");
    if (active) return active.title;

    const pending = goal.milestones.find((m) => m.status === "pending");
    if (pending) return pending.title;

    if (goal.milestones.length > 0) {
      const last = goal.milestones[goal.milestones.length - 1];
      if (last.status === "completed" || last.status === "skipped") {
        return "all complete";
      }
    }

    return null;
  }

  _serializeMilestone(m) {
    return {
      id: m.id,
      title: m.title,
      status: m.status,
      dueDate: m.dueDate,
      completedAt: m.completedAt,
      startedAt: m.startedAt,
      notes: m.notes,
      subGoalId: m.subGoalId,
    };
  }

  _serializeSubGoal(sg) {
    return {
      id: sg.id,
      title: sg.title,
      description: sg.description,
      status: sg.status,
      completedAt: sg.completedAt,
    };
  }

  _snapshot(goal) {
    return {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      milestones: goal.milestones.map((m) => this._serializeMilestone(m)),
      subGoals: goal.subGoals.map((sg) => this._serializeSubGoal(sg)),
      status: goal.status,
      priority: goal.priority,
      deadline: goal.deadline,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      completedAt: goal.completedAt,
      manualProgress: goal.manualProgress,
      progress: this._computeGoalProgress(goal),
    };
  }

  _computeGoalProgress(goal) {
    if (goal.manualProgress !== null) {
      return {
        total: 100,
        completed: goal.manualProgress,
        percent: goal.manualProgress,
      };
    }
    const total = goal.milestones.length;
    const completed = goal.milestones.filter(
      (m) => m.status === "completed" || m.status === "skipped",
    ).length;
    return {
      total,
      completed,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  _nextId() {
    return `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

module.exports = {
  GoalTracker,
  VALID_GOAL_STATUSES,
  VALID_PRIORITIES,
  VALID_MILESTONE_STATUSES,
};
