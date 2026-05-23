"use strict";

/**
 * WorkScheduler — priority-based work scheduling with deadline awareness,
 * conflict detection, capacity utilisation tracking, and configurable
 * working-hour windows.
 *
 * Designed to sit between the CronScheduler (scheduler/cron.js) and the
 * task queue, providing schedule optimisation and time-block management.
 */

const { debug } = require('../debug');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default working hours: 09:00–17:00 */
const DEFAULT_WORK_START = 9;
const DEFAULT_WORK_END = 17;

/** Minimum slot granularity in minutes. */
const SLOT_GRANULARITY_MINUTES = 15;

/** Priority levels and their scheduling weights. */
const PRIORITY_WEIGHTS = {
  critical: 100,
  high:     50,
  medium:   20,
  low:      5,
  none:     1,
};

/** Day-of-week names for display. */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Clamp a Date to the working-hour window for its day.
 * @param {Date} date
 * @param {number} workStart  - hour (0-23)
 * @param {number} workEnd    - hour (0-23)
 * @returns {Date}
 */
function clampToWorkingHours(date, workStart, workEnd) {
  const d = new Date(date);
  const hour = d.getHours();

  if (hour < workStart) {
    d.setHours(workStart, 0, 0, 0);
  } else if (hour >= workEnd) {
    d.setHours(workEnd - 1, 59, 59, 999);
  }

  return d;
}

/**
 * Get the start-of-day timestamp for a given date.
 * @param {Date} date
 * @returns {number}
 */
function startOfDay(date, workStart) {
  const d = new Date(date);
  d.setHours(workStart, 0, 0, 0);
  return d.getTime();
}

/**
 * Get the end-of-day timestamp for a given date.
 * @param {Date} date
 * @returns {number}
 */
function endOfDay(date, workEnd) {
  const d = new Date(date);
  d.setHours(workEnd, 0, 0, 0);
  return d.getTime();
}

/**
 * Get the date key (YYYY-MM-DD) for bucketing.
 * @param {Date|number} date
 * @returns {string}
 */
function dateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Add working hours to a date, skipping non-working time.
 *
 * @param {Date} start
 * @param {number} hours   - hours to add
 * @param {number} workStart
 * @param {number} workEnd
 * @returns {Date}
 */
function addWorkingHours(start, hours, workStart, workEnd) {
  const workMsPerDay = (workEnd - workStart) * 60 * 60 * 1000;
  let remaining = hours * 60 * 60 * 1000;
  const cursor = new Date(start);

  // Clamp to working window
  clampToWorkingHours(cursor, workStart, workEnd);

  while (remaining > 0) {
    const dayEnd = endOfDay(cursor, workEnd);

    // Time left in current working day
    const timeLeftToday = dayEnd - cursor.getTime();

    if (timeLeftToday >= remaining) {
      cursor.setTime(cursor.getTime() + remaining);
      remaining = 0;
    } else {
      // Consume rest of today, move to next work day
      remaining -= timeLeftToday;
      cursor.setTime(cursor.getTime() + timeLeftToday);
      // Advance to next day at workStart
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(workStart, 0, 0, 0);
    }
  }

  return cursor;
}

// ---------------------------------------------------------------------------
// WorkScheduler
// ---------------------------------------------------------------------------

class WorkScheduler {
  /**
   * @param {object} [options]
   * @param {number} [options.workStart=9]        - Working day start hour (0-23)
   * @param {number} [options.workEnd=17]         - Working day end hour (0-23)
   * @param {number} [options.slotMinutes=15]     - Granularity for scheduling
   * @param {boolean} [options.allowOverlap=false] - Allow overlapping schedules
   */
  constructor(options = {}) {
    this._workStart = Number(options.workStart) || DEFAULT_WORK_START;
    this._workEnd = Number(options.workEnd) || DEFAULT_WORK_END;
    this._slotMinutes = Math.max(1, Number(options.slotMinutes) || SLOT_GRANULARITY_MINUTES);
    this._allowOverlap = Boolean(options.allowOverlap);

    if (this._workStart >= this._workEnd) {
      throw new Error('workStart must be before workEnd');
    }

    /**
     * Scheduled tasks: Array<{
     *   id: string,
     *   task: object,
     *   scheduledStart: number (timestamp ms),
     *   scheduledEnd: number,
     *   deadline: number|null,
     *   priority: string,
     *   estimatedHours: number,
     *   status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled',
     * }>
     */
    this._schedule = [];

    /** Counter for generating unique schedule IDs. */
    this._idCounter = 0;
  }

  // ---- Configuration -------------------------------------------------------

  /**
   * Set the working hours window.
   *
   * @param {number} start - Hour (0-23)
   * @param {number} end   - Hour (0-23)
   */
  setWorkingHours(start, end) {
    if (start >= end) throw new Error('start must be before end');
    this._workStart = Number(start);
    this._workEnd = Number(end);
    debug('time:scheduler', `working hours set to ${this._workStart}:00–${this._workEnd}:00`);
  }

  /**
   * Get current working hours.
   * @returns {{ start: number, end: number }}
   */
  getWorkingHours() {
    return { start: this._workStart, end: this._workEnd };
  }

  // ---- Scheduling ----------------------------------------------------------

  /**
   * Schedule a task considering priority, estimated duration, and deadline.
   *
   * @param {object} task     - task descriptor { title, type, priority, estimatedHours, ... }
   * @param {Date|number|null} [deadline=null] - deadline timestamp or Date
   * @returns {{ scheduled: object, conflicted: boolean }}
   */
  scheduleTask(task, deadline = null) {
    const taskObj = task || {};
    const deadlineTs = deadline
      ? (deadline instanceof Date ? deadline.getTime() : Number(deadline))
      : null;
    const priority = taskObj.priority || 'medium';
    const estimatedHours = Number(taskObj.estimatedHours) || 1;

    // Determine earliest feasible start time
    const now = Date.now();
    let slotStart = clampToWorkingHours(new Date(now), this._workStart, this._workEnd);

    if (!this._allowOverlap) {
      slotStart = this._findNextFreeSlot(slotStart, estimatedHours, deadlineTs);
    }

    const slotEnd = addWorkingHours(slotStart, estimatedHours, this._workStart, this._workEnd);

    // Check deadline feasibility
    let conflicted = false;
    if (deadlineTs && slotEnd.getTime() > deadlineTs) {
      // Try to squeeze it in — if impossible, flag conflict
      const latestStart = new Date(deadlineTs - estimatedHours * 60 * 60 * 1000);
      const clampedLatest = clampToWorkingHours(latestStart, this._workStart, this._workEnd);

      if (clampedLatest.getTime() < now) {
        // Impossible to meet deadline
        conflicted = true;
        // Schedule as early as possible anyway
        slotStart.setTime(clampToWorkingHours(new Date(now), this._workStart, this._workEnd).getTime());
      } else {
        slotStart = this._findNextFreeSlot(slotStart, estimatedHours, deadlineTs);
        conflicted = addWorkingHours(slotStart, estimatedHours, this._workStart, this._workEnd).getTime() > deadlineTs;
      }
    }

    const scheduledEnd = addWorkingHours(slotStart, estimatedHours, this._workStart, this._workEnd);

    const entry = {
      id: `sched-${++this._idCounter}`,
      task: taskObj,
      scheduledStart: slotStart.getTime(),
      scheduledEnd: scheduledEnd.getTime(),
      deadline: deadlineTs,
      priority,
      estimatedHours,
      status: 'scheduled',
    };

    this._schedule.push(entry);

    debug('time:scheduler', `scheduled "${taskObj.title || taskObj.name || entry.id}" at ${slotStart.toISOString()} (${estimatedHours}h, priority=${priority}, conflicted=${conflicted})`);

    return { scheduled: entry, conflicted };
  }

  /**
   * View the schedule for a given timeframe.
   *
   * @param {'day'|'week'} [timeframe='day']
   * @param {Date|number} [from=now]   - reference point
   * @returns {object}
   */
  getSchedule(timeframe = 'day', from = Date.now()) {
    const ref = from instanceof Date ? from : new Date(from);
    const end = new Date(ref);

    if (timeframe === 'day') {
      end.setDate(end.getDate() + 1);
    } else if (timeframe === 'week') {
      end.setDate(end.getDate() + 7);
    }

    const refTs = ref.getTime();
    const endTs = end.getTime();

    const items = this._schedule
      .filter((s) => s.scheduledStart < endTs && s.scheduledEnd > refTs && s.status !== 'cancelled')
      .sort((a, b) => a.scheduledStart - b.scheduledStart);

    // Bucket by day
    const byDay = {};
    for (const item of items) {
      const key = dateKey(item.scheduledStart);
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(this._serialize(item));
    }

    const totalHours = round2(
      items.reduce((sum, s) => sum + (s.status === 'cancelled' ? 0 : s.estimatedHours), 0)
    );

    const utilization = this.getUtilization(timeframe, from);

    return {
      timeframe,
      from: ref.toISOString(),
      to: end.toISOString(),
      totalTasks: items.length,
      totalHours,
      utilization,
      byDay,
    };
  }

  /**
   * Reorder the schedule to optimise for priority and deadline proximity.
   *
   * Algorithm: sort by deadlined tasks first (earliest deadline first),
   * then by priority weight, then by estimated duration (shortest first
   * for throughput).
   *
   * @returns {object} schedule summary after optimisation
   */
  optimizeSchedule() {
    const now = Date.now();

    // Only reorder future, non-completed tasks
    const future = this._schedule.filter((s) => s.scheduledStart > now && s.status === 'scheduled');
    const past = this._schedule.filter((s) => s.scheduledStart <= now || s.status !== 'scheduled');

    // Scoring function: lower score = schedule earlier
    const score = (s) => {
      const prioWeight = PRIORITY_WEIGHTS[s.priority] || PRIORITY_WEIGHTS.medium;
      let deadlineUrgency = 0;
      if (s.deadline) {
        const hoursUntilDeadline = (s.deadline - now) / (1000 * 60 * 60);
        deadlineUrgency = hoursUntilDeadline <= 0 ? 10000 : 1000 / Math.max(0.5, hoursUntilDeadline);
      }
      // Invert priority so higher priority = lower score
      const prioScore = 1000 / Math.max(1, prioWeight);
      return prioScore + s.estimatedHours - deadlineUrgency;
    };

    future.sort((a, b) => score(a) - score(b));

    // Recompute start times sequentially
    let cursor = new Date(Math.max(now, ...past
      .filter((s) => s.status === 'scheduled')
      .map((s) => s.scheduledEnd)));
    cursor = clampToWorkingHours(cursor, this._workStart, this._workEnd);

    for (const item of future) {
      const slot = this._findNextFreeSlot(cursor, item.estimatedHours, item.deadline);
      item.scheduledStart = slot.getTime();
      item.scheduledEnd = addWorkingHours(slot, item.estimatedHours, this._workStart, this._workEnd).getTime();
      cursor = new Date(item.scheduledEnd);
    }

    this._schedule = [...past, ...future];

    debug('time:scheduler', `optimised schedule: ${future.length} tasks reordered`);

    return this.getSchedule('week', now);
  }

  /**
   * Detect scheduling conflicts (overlaps and deadline misses).
   *
   * @returns {object[]} array of conflict descriptions
   */
  detectConflicts() {
    const now = Date.now();
    const active = this._schedule.filter((s) => s.status !== 'cancelled');
    const sorted = [...active].sort((a, b) => a.scheduledStart - b.scheduledStart);
    const conflicts = [];

    // Check for overlapping tasks
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].scheduledStart >= sorted[i].scheduledEnd) break; // no more overlaps possible

        const overlapMinutes = round2(
          (Math.min(sorted[i].scheduledEnd, sorted[j].scheduledEnd) - sorted[j].scheduledStart)
          / (1000 * 60)
        );

        if (overlapMinutes > 0) {
          conflicts.push({
            type: 'overlap',
            severity: overlapMinutes > 60 ? 'high' : overlapMinutes > 15 ? 'medium' : 'low',
            taskA: this._serialize(sorted[i]),
            taskB: this._serialize(sorted[j]),
            overlapMinutes,
            detail: `Tasks "${sorted[i].task.title || sorted[i].id}" and "${sorted[j].task.title || sorted[j].id}" overlap by ${overlapMinutes} minutes`,
          });
        }
      }
    }

    // Check for deadline misses
    for (const item of active) {
      if (item.deadline && item.scheduledEnd > item.deadline) {
        const overdueMinutes = round2((item.scheduledEnd - item.deadline) / (1000 * 60));
        conflicts.push({
          type: 'deadline_miss',
          severity: overdueMinutes > 120 ? 'high' : overdueMinutes > 30 ? 'medium' : 'low',
          task: this._serialize(item),
          overdueMinutes,
          detail: `Task "${item.task.title || item.id}" scheduled to finish ${overdueMinutes} minutes past deadline`,
        });
      }

      // Also check if task start is already past deadline
      if (item.deadline && item.deadline < now && item.status === 'scheduled') {
        conflicts.push({
          type: 'deadline_passed',
          severity: 'critical',
          task: this._serialize(item),
          overdueMinutes: round2((now - item.deadline) / (1000 * 60)),
          detail: `Deadline for "${item.task.title || item.id}" has already passed`,
        });
      }
    }

    return conflicts;
  }

  /**
   * Calculate capacity utilization for a given timeframe.
   *
   * @param {'day'|'week'} [timeframe='day']
   * @param {Date|number} [from=now]
   * @returns {{ percentage: number, scheduledHours: number, availableHours: number }}
   */
  getUtilization(timeframe = 'day', from = Date.now()) {
    const ref = from instanceof Date ? from : new Date(from);
    const end = new Date(ref);
    const workHoursPerDay = this._workEnd - this._workStart;

    if (timeframe === 'day') {
      end.setDate(end.getDate() + 1);
    } else if (timeframe === 'week') {
      end.setDate(end.getDate() + 7);
    }

    const daysInPeriod = Math.max(1, (end.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24));
    const availableHours = daysInPeriod * workHoursPerDay;

    const refTs = ref.getTime();
    const endTs = end.getTime();

    const scheduledHours = this._schedule
      .filter((s) => s.status !== 'cancelled' && s.scheduledStart < endTs && s.scheduledEnd > refTs)
      .reduce((sum, s) => sum + s.estimatedHours, 0);

    const percentage = availableHours > 0 ? round2((scheduledHours / availableHours) * 100) : 0;

    return {
      percentage,
      scheduledHours: round2(scheduledHours),
      availableHours: round2(availableHours),
    };
  }

  /**
   * Cancel a scheduled task.
   *
   * @param {string} scheduleId - the id from the scheduled entry
   * @returns {boolean} true if found and cancelled
   */
  cancel(scheduleId) {
    const entry = this._schedule.find((s) => s.id === scheduleId);
    if (!entry) return false;
    entry.status = 'cancelled';
    debug('time:scheduler', `cancelled ${scheduleId}`);
    return true;
  }

  /**
   * Mark a scheduled task as completed.
   *
   * @param {string} scheduleId
   * @returns {boolean}
   */
  complete(scheduleId) {
    const entry = this._schedule.find((s) => s.id === scheduleId);
    if (!entry) return false;
    entry.status = 'completed';
    debug('time:scheduler', `completed ${scheduleId}`);
    return true;
  }

  /**
   * Get the schedule at the current priority level (for integration).
   * @param {string} [priority]
   * @returns {object[]}
   */
  getScheduledTasks(priority = null) {
    const active = this._schedule.filter((s) => s.status === 'scheduled');
    const filtered = priority ? active.filter((s) => s.priority === priority) : active;
    return filtered.sort((a, b) => a.scheduledStart - b.scheduledStart).map((s) => this._serialize(s));
  }

  /**
   * Get the number of currently scheduled tasks.
   * @returns {number}
   */
  get scheduledCount() {
    return this._schedule.filter((s) => s.status === 'scheduled').length;
  }

  /**
   * Get all tasks in the schedule.
   * @returns {object[]}
   */
  get all() {
    return this._schedule.map((s) => this._serialize(s));
  }

  /**
   * Clear the entire schedule.
   */
  clear() {
    this._schedule = [];
    this._idCounter = 0;
  }

  // ---- Internal helpers ---------------------------------------------------

  /**
   * Find the next available time slot for a task of given duration.
   *
   * @param {Date} from         - earliest start time
   * @param {number} hours      - task duration in hours
   * @param {number|null} deadlineTs - optional deadline
   * @returns {Date}
   */
  _findNextFreeSlot(from, hours, deadlineTs) {
    const active = this._schedule.filter((s) => s.status !== 'cancelled');
    const cursor = new Date(from);

    // Max iterations prevent infinite loops
    const MAX_DAYS = 365;
    for (let day = 0; day < MAX_DAYS; day++) {
      const cursorEnd = addWorkingHours(new Date(cursor), hours, this._workStart, this._workEnd);

      // Check overlap with any existing scheduled task
      const overlaps = active.some((existing) => {
        if (existing.status === 'completed') return false;
        return cursor.getTime() < existing.scheduledEnd &&
               cursorEnd.getTime() > existing.scheduledStart;
      });

      if (!overlaps) {
        return cursor;
      }

      // Check if we've already blown the deadline
      if (deadlineTs && cursorEnd.getTime() > deadlineTs) {
        return new Date(Math.min(cursor.getTime(), deadlineTs));
      }

      // Move to the end of the first overlapping task
      const earliestOverlapEnd = active
        .filter((e) => cursor.getTime() < e.scheduledEnd && cursorEnd.getTime() > e.scheduledStart)
        .reduce((min, e) => Math.max(min, e.scheduledEnd), cursor.getTime());

      cursor.setTime(earliestOverlapEnd);
      clampToWorkingHours(cursor, this._workStart, this._workEnd);
    }

    return cursor;
  }

  /**
   * Serialize a schedule entry for external consumption.
   * @param {object} entry
   * @returns {object}
   */
  _serialize(entry) {
    return {
      id: entry.id,
      task: entry.task && entry.task.title ? entry.task.title : (entry.task || {}),
      scheduledStart: new Date(entry.scheduledStart).toISOString(),
      scheduledEnd: new Date(entry.scheduledEnd).toISOString(),
      deadline: entry.deadline ? new Date(entry.deadline).toISOString() : null,
      priority: entry.priority,
      estimatedHours: entry.estimatedHours,
      status: entry.status,
    };
  }
}

module.exports = {
  WorkScheduler,
  PRIORITY_WEIGHTS,
  DEFAULT_WORK_START,
  DEFAULT_WORK_END,
};
