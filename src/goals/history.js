"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * GoalHistory -- persistent archival and analysis of completed or abandoned
 * goals.
 *
 * Stores each finished goal as one JSON line in .hax-agent/goal-history.jsonl
 * and provides querying, statistics, insights, and streak tracking over
 * the historical record.
 */

const DEFAULT_HISTORY_PATH = ".hax-agent/goal-history.jsonl";

class GoalHistory {
  /**
   * @param {object} [options={}]
   * @param {string} [options.filePath] - path to the history JSONL file
   * @param {boolean} [options.autoCommit=true] - write to disk on every record()
   */
  constructor(options = {}) {
    this._filePath = options.filePath || DEFAULT_HISTORY_PATH;
    this._autoCommit = options.autoCommit !== false;
  }

  // ---- Persistence ----------------------------------------------------------

  /**
   * Archive a completed or abandoned goal.
   *
   * @param {object} goal - a goal snapshot (as returned by GoalTracker)
   * @returns {object} the record that was written
   */
  record(goal) {
    if (!goal || typeof goal !== "object") {
      throw new Error("Goal must be a non-null object.");
    }
    if (!goal.id || !goal.title) {
      throw new Error("Goal must have at least an id and title.");
    }

    const record = {
      id: goal.id,
      title: goal.title,
      description: goal.description || "",
      status: goal.status || "completed",
      priority: goal.priority || "medium",
      deadline: goal.deadline || null,
      deadlineMet: goal.deadline && goal.completedAt
        ? new Date(goal.completedAt) <= new Date(goal.deadline)
        : null,
      createdAt: goal.createdAt || new Date().toISOString(),
      completedAt: goal.completedAt || new Date().toISOString(),
      progress: goal.progress || { total: 0, completed: 0, percent: 0 },
      milestoneCount: Array.isArray(goal.milestones) ? goal.milestones.length : 0,
      milestonesCompleted: Array.isArray(goal.milestones)
        ? goal.milestones.filter(
            (m) => m.status === "completed" || m.status === "skipped",
          ).length
        : 0,
      subGoalCount: Array.isArray(goal.subGoals) ? goal.subGoals.length : 0,
      archivedAt: new Date().toISOString(),
    };

    if (this._autoCommit) {
      this._appendToFile(record);
    }

    return record;
  }

  /**
   * Query the goal history with optional filters.
   *
   * @param {object} [options={}]
   * @param {string} [options.status] - filter by status ("completed" or "abandoned")
   * @param {string} [options.priority] - filter by priority
   * @param {number} [options.limit] - max records to return
   * @param {number} [options.offset] - skip first N records
   * @param {boolean} [options.ascending=false] - sort by archivedAt ascending
   * @returns {object[]} matching history records
   */
  getHistory(options = {}) {
    const records = this._readAll();

    let filtered = records;

    if (options.status) {
      filtered = filtered.filter((r) => r.status === options.status);
    }
    if (options.priority) {
      filtered = filtered.filter((r) => r.priority === options.priority);
    }

    if (!options.ascending) {
      filtered.reverse();
    }

    const offset = options.offset || 0;
    const limit = options.limit;
    if (limit !== undefined) {
      return filtered.slice(offset, offset + limit);
    }
    return filtered.slice(offset);
  }

  /**
   * Compute aggregate statistics over the entire goal history.
   *
   * @returns {{
   *   totalGoals: number,
   *   completed: number,
   *   abandoned: number,
   *   completionRate: number,
   *   avgCompletionTimeMs: number|null,
   *   avgMilestones: number,
   *   byPriority: object,
   *   deadlineMetRate: number|null
   * }}
   */
  getStats() {
    const records = this._readAll();
    if (records.length === 0) {
      return {
        totalGoals: 0,
        completed: 0,
        abandoned: 0,
        completionRate: 0,
        avgCompletionTimeMs: null,
        avgMilestones: 0,
        byPriority: {},
        deadlineMetRate: null,
      };
    }

    const completed = records.filter((r) => r.status === "completed");
    const abandoned = records.filter((r) => r.status === "abandoned");
    const completionRate = Math.round((completed.length / records.length) * 100);

    // Average completion time (for goals with both createdAt and completedAt)
    let avgCompletionTimeMs = null;
    const times = [];
    for (const r of completed) {
      if (r.createdAt && r.completedAt) {
        const duration = new Date(r.completedAt) - new Date(r.createdAt);
        if (duration >= 0) times.push(duration);
      }
    }
    if (times.length > 0) {
      avgCompletionTimeMs = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    }

    const avgMilestones = records.length > 0
      ? Math.round((records.reduce((sum, r) => sum + r.milestoneCount, 0) / records.length) * 10) / 10
      : 0;

    // By priority breakdown
    const byPriority = {};
    for (const r of records) {
      const p = r.priority;
      if (!byPriority[p]) {
        byPriority[p] = { total: 0, completed: 0, abandoned: 0 };
      }
      byPriority[p].total += 1;
      if (r.status === "completed") {
        byPriority[p].completed += 1;
      } else {
        byPriority[p].abandoned += 1;
      }
    }

    // Deadline met rate (for goals that had a deadline and were completed)
    let deadlineMetRate = null;
    const withDeadline = completed.filter((r) => r.deadlineMet !== null);
    if (withDeadline.length > 0) {
      const met = withDeadline.filter((r) => r.deadlineMet === true).length;
      deadlineMetRate = Math.round((met / withDeadline.length) * 100);
    }

    return {
      totalGoals: records.length,
      completed: completed.length,
      abandoned: abandoned.length,
      completionRate,
      avgCompletionTimeMs,
      avgMilestones,
      byPriority,
      deadlineMetRate,
    };
  }

  /**
   * Derive insight patterns from the historical record.
   *
   * @returns {object} insights object with patterns keyed by dimension
   */
  getInsights() {
    const records = this._readAll();
    if (records.length === 0) {
      return {
        totalAnalyzed: 0,
        successByPriority: {},
        averageMilestonesForSuccess: null,
        averageMilestonesForFailure: null,
        commonPhases: [],
        recommendation: "Not enough data for insights.",
      };
    }

    const completed = records.filter((r) => r.status === "completed");
    const abandoned = records.filter((r) => r.status === "abandoned");

    // Success rate by priority
    const byPriority = {};
    for (const r of records) {
      const p = r.priority;
      if (!byPriority[p]) {
        byPriority[p] = { total: 0, completed: 0 };
      }
      byPriority[p].total += 1;
      if (r.status === "completed") {
        byPriority[p].completed += 1;
      }
    }
    const successByPriority = {};
    for (const [p, data] of Object.entries(byPriority)) {
      successByPriority[p] = {
        total: data.total,
        completed: data.completed,
        rate: Math.round((data.completed / data.total) * 100),
      };
    }

    // Average milestones comparison
    const avgMsSuccess = completed.length > 0
      ? Math.round(
          (completed.reduce((s, r) => s + r.milestoneCount, 0) / completed.length) * 10,
        ) / 10
      : null;

    const avgMsFailure = abandoned.length > 0
      ? Math.round(
          (abandoned.reduce((s, r) => s + r.milestoneCount, 0) / abandoned.length) * 10,
        ) / 10
      : null;

    // Common phases (most frequent title words among completed goals)
    const wordFreq = new Map();
    for (const r of completed) {
      const words = r.title.toLowerCase().split(/\s+/);
      for (const w of words) {
        if (w.length < 3) continue;
        wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
      }
    }
    const commonPhases = [...wordFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word, count]) => ({ word, count }));

    // Generate a simple recommendation
    let recommendation = "";
    if (completed.length > 0 && abandoned.length > 0) {
      if (avgMsSuccess !== null && avgMsFailure !== null && avgMsFailure > avgMsSuccess) {
        recommendation = "Consider breaking goals into fewer milestones — "
          + `successful goals average ${avgMsSuccess} milestones vs ${avgMsFailure} for abandoned ones.`;
      } else {
        recommendation = `Completion rate is ${Math.round((completed.length / records.length) * 100)}%. `
          + "Review abandoned goals to identify blockers.";
      }
    } else if (completed.length > 0) {
      recommendation = "All goals have been completed successfully. Consider raising ambition.";
    } else {
      recommendation = "No completed goals yet. Focus on finishing one goal at a time.";
    }

    return {
      totalAnalyzed: records.length,
      successByPriority,
      averageMilestonesForSuccess: avgMsSuccess,
      averageMilestonesForFailure: avgMsFailure,
      commonPhases,
      recommendation,
    };
  }

  /**
   * Calculate the current streak of consecutive successfully completed goals.
   * Ordered by archivedAt (most recent first).
   *
   * @returns {{ current: number, longest: number }}
   */
  getStreak() {
    const records = this._readAll();

    if (records.length === 0) {
      return { current: 0, longest: 0 };
    }

    // Sort by archivedAt ascending to compute streaks
    const sorted = [...records].sort(
      (a, b) => new Date(a.archivedAt) - new Date(b.archivedAt),
    );

    let longest = 0;
    let currentRun = 0;

    for (const r of sorted) {
      if (r.status === "completed") {
        currentRun += 1;
        if (currentRun > longest) {
          longest = currentRun;
        }
      } else {
        currentRun = 0;
      }
    }

    // Compute backwards from the end to get the current (most recent) streak
    let current = 0;
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      if (sorted[i].status === "completed") {
        current += 1;
      } else {
        break;
      }
    }

    return { current, longest };
  }

  /**
   * Return the total number of archived records.
   *
   * @returns {number}
   */
  count() {
    return this._readAll().length;
  }

  /**
   * Clear all history records (irreversible).
   *
   * @returns {number} number of records removed
   */
  clear() {
    const records = this._readAll();
    const count = records.length;
    try {
      fs.unlinkSync(this._filePath);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    return count;
  }

  // ---- Internal -------------------------------------------------------------

  _appendToFile(record) {
    const dir = path.dirname(this._filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const line = JSON.stringify(record) + "\n";
    fs.appendFileSync(this._filePath, line, "utf8");
  }

  _readAll() {
    try {
      const raw = fs.readFileSync(this._filePath, "utf8");
      if (!raw.trim()) return [];
      return raw
        .trim()
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }
}

module.exports = {
  GoalHistory,
  DEFAULT_HISTORY_PATH,
};
