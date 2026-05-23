"use strict";

/**
 * TimeAnalytics — productivity analytics engine.
 *
 * Tracks time spent per task/phase, computes productivity metrics,
 * identifies bottlenecks, and generates timesheets.
 *
 * Integrates with TimeEstimator for tracking estimation accuracy
 * and WorkScheduler for schedule-level analytics.
 */

const { debug } = require('../debug');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Recognised task phases (ordered for typical workflow). */
const STANDARD_PHASES = [
  'analysis',
  'planning',
  'design',
  'implementation',
  'testing',
  'review',
  'integration',
  'deployment',
  'documentation',
  'verification',
  'cleanup',
  'waiting',    // blocked or waiting on external dependency
  'context',    // context switching / ramp-up
  'other',
];

/** Default productivity metric thresholds. */
const PRODUCTIVITY_THRESHOLDS = {
  low:  0.3,   // < 30% of scheduled time spent on productive phases
  high: 0.75,  // > 75% is considered high productivity
};

/** Bottleneck identification thresholds (in hours). */
const BOTTLENECK_THRESHOLD = {
  slowPhaseFactor: 2.0,    // phase taking > 2x the average is a bottleneck
  maxWaitingHours: 2.0,    // more than 2h waiting is flagged
  minTaskCount: 3,         // need at least 3 tasks for reliable bottleneck detection
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Get a date key for bucketing (YYYY-MM-DD).
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

// ---------------------------------------------------------------------------
// TimeAnalytics
// ---------------------------------------------------------------------------

class TimeAnalytics {
  /**
   * @param {object} [options]
   * @param {string[]} [options.phases]               - custom phase list
   * @param {object} [options.bottleneckThresholds]    - override BOTTLENECK_THRESHOLD
   * @param {object} [options.productivityThresholds]  - override PRODUCTIVITY_THRESHOLDS
   */
  constructor(options = {}) {
    this._phases = Array.isArray(options.phases) ? options.phases : [...STANDARD_PHASES];
    this._bottleneck = Object.assign({}, BOTTLENECK_THRESHOLD, options.bottleneckThresholds || {});
    this._productivity = Object.assign({}, PRODUCTIVITY_THRESHOLDS, options.productivityThresholds || {});

    /**
     * Time records: Array<{
     *   taskId: string,
     *   phase: string,
     *   duration: number,     // hours
     *   timestamp: number,    // when the record was made (ms)
     *   metadata: object,     // arbitrary extra data
     * }>
     */
    this._records = [];

    /**
     * Task metadata: Map<taskId, { title, type, complexity, createdAt, completedAt }>
     */
    this._taskMeta = new Map();
  }

  // ---- Recording -----------------------------------------------------------

  /**
   * Record time spent on a task phase.
   *
   * @param {string} taskId        - unique task identifier
   * @param {string} phase         - phase name (one of STANDARD_PHASES or custom)
   * @param {number} duration      - hours spent
   * @param {object} [metadata={}] - optional extra data
   */
  trackTime(taskId, phase, duration, metadata = {}) {
    if (!taskId || duration <= 0) return;

    const record = {
      taskId: String(taskId),
      phase: String(phase).toLowerCase(),
      duration: round2(Number(duration)),
      timestamp: metadata.timestamp || Date.now(),
      metadata: Object.assign({}, metadata),
    };

    this._records.push(record);

    // Register task metadata if not present
    if (!this._taskMeta.has(record.taskId)) {
      this._taskMeta.set(record.taskId, {
        title: metadata.title || '',
        type: metadata.type || '',
        complexity: metadata.complexity || '',
        createdAt: record.timestamp,
        completedAt: null,
      });
    }

    if (metadata.completed && this._taskMeta.has(record.taskId)) {
      const meta = this._taskMeta.get(record.taskId);
      meta.completedAt = metadata.completedAt || record.timestamp;
      if (metadata.title) meta.title = metadata.title;
      if (metadata.type) meta.type = metadata.type;
    }

    debug('time:analytics', `tracked ${record.taskId} / ${record.phase}: ${record.duration}h`);
  }

  // ---- Time breakdown ------------------------------------------------------

  /**
   * Get time breakdown by phase for a specific task.
   *
   * @param {string} taskId
   * @returns {{ taskId: string, totalHours: number, phases: object, phaseCount: number }}
   */
  getTimeBreakdown(taskId) {
    const records = this._records.filter((r) => r.taskId === taskId);

    const phases = {};
    let totalHours = 0;

    for (const r of records) {
      const phase = r.phase;
      if (!phases[phase]) {
        phases[phase] = { hours: 0, records: 0, percentage: 0 };
      }
      phases[phase].hours = round2(phases[phase].hours + r.duration);
      phases[phase].records += 1;
      totalHours += r.duration;
    }

    // Compute percentages
    for (const key of Object.keys(phases)) {
      phases[key].percentage = totalHours > 0
        ? round2((phases[key].hours / totalHours) * 100)
        : 0;
    }

    return {
      taskId,
      totalHours: round2(totalHours),
      phases,
      phaseCount: Object.keys(phases).length,
    };
  }

  /**
   * Get a breakdown across all recorded tasks.
   *
   * @returns {object} phase-level aggregation
   */
  _getGlobalBreakdown() {
    const phases = {};
    let totalHours = 0;

    for (const r of this._records) {
      if (!phases[r.phase]) {
        phases[r.phase] = { hours: 0, records: 0 };
      }
      phases[r.phase].hours += r.duration;
      phases[r.phase].records += 1;
      totalHours += r.duration;
    }

    for (const key of Object.keys(phases)) {
      phases[key].percentage = totalHours > 0
        ? round2((phases[key].hours / totalHours) * 100)
        : 0;
    }

    return { phases, totalHours: round2(totalHours) };
  }

  // ---- Productivity stats --------------------------------------------------

  /**
   * Compute productivity statistics for a given timeframe.
   *
   * @param {'day'|'week'|'month'|'all'} [timeframe='all']
   * @param {Date|number} [ref=now]  - reference point
   * @returns {{
   *   timeframe: string,
   *   totalHours: number,
   *   taskCount: number,
   *   phasesBreakdown: object,
   *   productiveHours: number,
   *   waitingHours: number,
   *   contextSwitchHours: number,
   *   productivityScore: number,
   *   tasksPerDay: number,
   *   avgTaskDuration: number
   * }}
   */
  getProductivityStats(timeframe = 'all', ref = Date.now()) {
    const records = this._filterByTimeframe(timeframe, ref);
    const uniqueTaskIds = new Set();
    let totalHours = 0;
    let productiveHours = 0;
    let waitingHours = 0;
    let contextSwitchHours = 0;

    const phases = {};

    for (const r of records) {
      totalHours += r.duration;
      uniqueTaskIds.add(r.taskId);

      // Phase accounting
      if (!phases[r.phase]) {
        phases[r.phase] = { hours: 0, records: 0 };
      }
      phases[r.phase].hours = round2(phases[r.phase].hours + r.duration);
      phases[r.phase].records += 1;

      // Productive phases: anything except waiting, context, other
      if (r.phase === 'waiting') {
        waitingHours += r.duration;
      } else if (r.phase === 'context') {
        contextSwitchHours += r.duration;
      } else if (r.phase !== 'other') {
        productiveHours += r.duration;
      } else {
        // 'other' is neutral — count half toward productive
        productiveHours += r.duration * 0.5;
      }
    }

    const taskCount = uniqueTaskIds.size;
    const productivityScore = totalHours > 0
      ? round2(Math.min(1, productiveHours / totalHours))
      : 0;

    // Days in period for task/day calculation
    let daysInPeriod = 1;
    if (timeframe === 'day') daysInPeriod = 1;
    else if (timeframe === 'week') daysInPeriod = 7;
    else if (timeframe === 'month') daysInPeriod = 30;
    else {
      // 'all' — compute from actual record span
      const timestamps = records.map((r) => r.timestamp).filter(Boolean);
      if (timestamps.length > 1) {
        const min = Math.min(...timestamps);
        const max = Math.max(...timestamps);
        daysInPeriod = Math.max(1, (max - min) / (1000 * 60 * 60 * 24));
      }
    }

    // Compute percentages for each phase
    for (const key of Object.keys(phases)) {
      phases[key].percentage = totalHours > 0
        ? round2((phases[key].hours / totalHours) * 100)
        : 0;
    }

    return {
      timeframe,
      totalHours: round2(totalHours),
      taskCount,
      phasesBreakdown: phases,
      productiveHours: round2(productiveHours),
      waitingHours: round2(waitingHours),
      contextSwitchHours: round2(contextSwitchHours),
      productivityScore,
      tasksPerDay: round2(taskCount / daysInPeriod),
      avgTaskDuration: taskCount > 0 ? round2(totalHours / taskCount) : 0,
    };
  }

  // ---- Bottleneck detection ------------------------------------------------

  /**
   * Identify bottlenecks across a set of tasks.
   *
   * Detects:
   *   - Slow phases (taking disproportionately long)
   *   - Waiting / blocked time
   *   - Tasks with excessive duration relative to their complexity
   *
   * @param {object[]} [tasks=[]] - optional task descriptors with { id, complexity, estimatedHours }
   * @returns {{ bottlenecks: object[], summary: string }}
   */
  identifyBottlenecks(tasks = []) {
    const bottlenecks = [];
    const taskIds = new Set(this._records.map((r) => r.taskId));
    const totalTasks = Math.max(taskIds.size, tasks.length);

    if (totalTasks < this._bottleneck.minTaskCount) {
      return { bottlenecks, summary: 'Insufficient data for bottleneck analysis.' };
    }

    // 1. Per-phase average across all tasks
    const phaseTotals = {};
    const phaseCounts = {};
    for (const r of this._records) {
      if (!phaseTotals[r.phase]) {
        phaseTotals[r.phase] = 0;
        phaseCounts[r.phase] = 0;
      }
      phaseTotals[r.phase] += r.duration;
      phaseCounts[r.phase] += 1;
    }

    const phaseAverages = {};
    for (const phase of Object.keys(phaseTotals)) {
      phaseAverages[phase] = phaseTotals[phase] / phaseCounts[phase];
    }

    // Overall average duration per phase
    const allPhaseValues = Object.values(phaseAverages);
    const overallAvgPhase = allPhaseValues.length > 0
      ? allPhaseValues.reduce((a, b) => a + b, 0) / allPhaseValues.length
      : 0;

    // 2. Flag phases that are disproportionately slow
    for (const [phase, avg] of Object.entries(phaseAverages)) {
      if (overallAvgPhase > 0 && avg > overallAvgPhase * this._bottleneck.slowPhaseFactor) {
        bottlenecks.push({
          type: 'slow_phase',
          phase,
          avgHours: round2(avg),
          overallAvgHours: round2(overallAvgPhase),
          factor: round2(avg / overallAvgPhase),
          detail: `Phase "${phase}" averages ${round2(avg)}h, which is ${round2(avg / overallAvgPhase)}x the overall phase average of ${round2(overallAvgPhase)}h`,
        });
      }
    }

    // 3. Identify excessive waiting time by task
    for (const taskId of taskIds) {
      const waiting = this._records
        .filter((r) => r.taskId === taskId && r.phase === 'waiting')
        .reduce((sum, r) => sum + r.duration, 0);

      if (waiting > this._bottleneck.maxWaitingHours) {
        bottlenecks.push({
          type: 'excessive_waiting',
          taskId,
          waitingHours: round2(waiting),
          detail: `Task "${taskId}" spent ${round2(waiting)}h waiting (threshold: ${this._bottleneck.maxWaitingHours}h)`,
        });
      }
    }

    // 4. Check tasks against their estimates (if provided)
    for (const task of tasks) {
      if (!task.id) continue;
      const breakdown = this.getTimeBreakdown(task.id);
      if (breakdown.totalHours > 0 && task.estimatedHours) {
        const ratio = breakdown.totalHours / task.estimatedHours;
        if (ratio > this._bottleneck.slowPhaseFactor) {
          bottlenecks.push({
            type: 'time_overrun',
            taskId: task.id,
            estimatedHours: task.estimatedHours,
            actualHours: breakdown.totalHours,
            factor: round2(ratio),
            detail: `Task "${task.id || task.title}" took ${breakdown.totalHours}h vs estimated ${task.estimatedHours}h (${round2(ratio)}x)`,
          });
        }
      }
    }

    // 5. Summary
    let summary;
    if (bottlenecks.length === 0) {
      summary = 'No significant bottlenecks detected.';
    } else {
      const byType = {};
      for (const b of bottlenecks) {
        if (!byType[b.type]) byType[b.type] = 0;
        byType[b.type] += 1;
      }
      summary = `Found ${bottlenecks.length} bottlenecks: ` +
        Object.entries(byType).map(([t, c]) => `${c} ${t.replace(/_/g, ' ')}`).join(', ');
    }

    return { bottlenecks, summary };
  }

  // ---- Time distribution ---------------------------------------------------

  /**
   * Get time distribution across multiple tasks.
   *
   * @param {string[]} [taskIds]  - specific task IDs, or all if omitted
   * @returns {{
   *   totalHours: number,
   *   taskCount: number,
   *   byPhase: object,
   *   byTask: object,
   *   largestConsumer: object|null
   * }}
   */
  getTimeDistribution(taskIds = null) {
    const records = taskIds
      ? this._records.filter((r) => taskIds.includes(r.taskId))
      : this._records;

    const byPhase = {};
    const byTask = {};
    let totalHours = 0;

    for (const r of records) {
      totalHours += r.duration;

      // By phase
      if (!byPhase[r.phase]) {
        byPhase[r.phase] = { hours: 0, records: 0 };
      }
      byPhase[r.phase].hours = round2(byPhase[r.phase].hours + r.duration);
      byPhase[r.phase].records += 1;

      // By task
      if (!byTask[r.taskId]) {
        byTask[r.taskId] = { hours: 0, records: 0, phases: {} };
      }
      byTask[r.taskId].hours = round2(byTask[r.taskId].hours + r.duration);
      byTask[r.taskId].records += 1;
      if (!byTask[r.taskId].phases[r.phase]) {
        byTask[r.taskId].phases[r.phase] = 0;
      }
      byTask[r.taskId].phases[r.phase] = round2(
        byTask[r.taskId].phases[r.phase] + r.duration
      );
    }

    // Percentages by phase
    for (const key of Object.keys(byPhase)) {
      byPhase[key].percentage = totalHours > 0
        ? round2((byPhase[key].hours / totalHours) * 100)
        : 0;
    }

    // Percentages by task
    for (const key of Object.keys(byTask)) {
      byTask[key].percentage = totalHours > 0
        ? round2((byTask[key].hours / totalHours) * 100)
        : 0;

      // Phase percentages within task
      for (const phase of Object.keys(byTask[key].phases)) {
        byTask[key].phasePercentages = byTask[key].phasePercentages || {};
        byTask[key].phasePercentages[phase] = byTask[key].hours > 0
          ? round2((byTask[key].phases[phase] / byTask[key].hours) * 100)
          : 0;
      }
    }

    // Identify largest consumer
    let largestConsumer = null;
    let maxHours = 0;
    for (const [taskId, data] of Object.entries(byTask)) {
      if (data.hours > maxHours) {
        maxHours = data.hours;
        const meta = this._taskMeta.get(taskId);
        largestConsumer = {
          taskId,
          hours: data.hours,
          percentage: data.percentage,
          title: (meta && meta.title) || '',
        };
      }
    }

    return {
      totalHours: round2(totalHours),
      taskCount: Object.keys(byTask).length,
      byPhase,
      byTask,
      largestConsumer,
    };
  }

  // ---- Timesheet generation ------------------------------------------------

  /**
   * Generate a timesheet report for a given timeframe.
   *
   * @param {'day'|'week'|'month'|'all'} [timeframe='week']
   * @param {Date|number} [ref=now]
   * @returns {{
   *   generatedAt: string,
   *   timeframe: string,
   *   from: string,
   *   to: string,
   *   totalHours: number,
   *   taskCount: number,
   *   recordCount: number,
   *   byDay: object,
   *   byPhase: object,
   *   byTask: object,
   *   productivity: object
   * }}
   */
  generateTimesheet(timeframe = 'week', ref = Date.now()) {
    const records = this._filterByTimeframe(timeframe, ref);

    // Determine date range
    let fromDate, toDate;
    const timestamps = records.map((r) => r.timestamp).filter(Boolean);
    if (timestamps.length > 0) {
      fromDate = new Date(Math.min(...timestamps));
      toDate = new Date(Math.max(...timestamps));
    } else {
      fromDate = toDate = new Date(ref);
    }

    // Bucket by day
    const byDay = {};
    const byPhase = {};
    const byTask = {};
    let totalHours = 0;

    for (const r of records) {
      totalHours += r.duration;
      const day = dateKey(r.timestamp);

      // By day
      if (!byDay[day]) {
        byDay[day] = { hours: 0, records: 0, tasks: new Set() };
      }
      byDay[day].hours = round2(byDay[day].hours + r.duration);
      byDay[day].records += 1;
      byDay[day].tasks.add(r.taskId);

      // By phase
      if (!byPhase[r.phase]) {
        byPhase[r.phase] = { hours: 0, records: 0, percentage: 0 };
      }
      byPhase[r.phase].hours = round2(byPhase[r.phase].hours + r.duration);
      byPhase[r.phase].records += 1;

      // By task
      if (!byTask[r.taskId]) {
        const meta = this._taskMeta.get(r.taskId) || {};
        byTask[r.taskId] = { title: meta.title || r.taskId, hours: 0, records: 0, percentage: 0 };
      }
      byTask[r.taskId].hours = round2(byTask[r.taskId].hours + r.duration);
      byTask[r.taskId].records += 1;
    }

    // Post-process: convert tasks set to count, compute percentages
    for (const day of Object.keys(byDay)) {
      byDay[day].taskCount = byDay[day].tasks.size;
      delete byDay[day].tasks;
    }

    for (const key of Object.keys(byPhase)) {
      byPhase[key].percentage = totalHours > 0
        ? round2((byPhase[key].hours / totalHours) * 100)
        : 0;
    }

    for (const key of Object.keys(byTask)) {
      byTask[key].percentage = totalHours > 0
        ? round2((byTask[key].hours / totalHours) * 100)
        : 0;
    }

    const productivity = this.getProductivityStats(timeframe, ref);

    return {
      generatedAt: new Date().toISOString(),
      timeframe,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      totalHours: round2(totalHours),
      taskCount: Object.keys(byTask).length,
      recordCount: records.length,
      byDay,
      byPhase,
      byTask,
      productivity,
    };
  }

  /**
   * Get the total number of time records.
   * @returns {number}
   */
  get recordCount() {
    return this._records.length;
  }

  /**
   * Get all recorded task IDs.
   * @returns {string[]}
   */
  get taskIds() {
    return [...new Set(this._records.map((r) => r.taskId))];
  }

  /**
   * Get raw records (optionally filtered).
   * @param {object} [filters]
   * @param {string} [filters.taskId]
   * @param {string} [filters.phase]
   * @returns {object[]}
   */
  getRecords(filters = {}) {
    let records = this._records;
    if (filters.taskId) {
      records = records.filter((r) => r.taskId === filters.taskId);
    }
    if (filters.phase) {
      records = records.filter((r) => r.phase === filters.phase);
    }
    return records;
  }

  /**
   * Clear all records and task metadata.
   */
  clear() {
    this._records = [];
    this._taskMeta.clear();
  }

  // ---- Internal helpers ---------------------------------------------------

  /**
   * Filter records by timeframe.
   * @param {'day'|'week'|'month'|'all'} timeframe
   * @param {Date|number} ref
   * @returns {object[]}
   */
  _filterByTimeframe(timeframe, ref) {
    if (timeframe === 'all') return [...this._records];

    const refDate = ref instanceof Date ? ref : new Date(ref);
    const cutoff = new Date(refDate);

    if (timeframe === 'day') {
      cutoff.setHours(0, 0, 0, 0);
    } else if (timeframe === 'week') {
      cutoff.setDate(cutoff.getDate() - 7);
    } else if (timeframe === 'month') {
      cutoff.setMonth(cutoff.getMonth() - 1);
    }

    const cutoffTs = cutoff.getTime();
    return this._records.filter((r) => r.timestamp >= cutoffTs);
  }
}

module.exports = {
  TimeAnalytics,
  STANDARD_PHASES,
  PRODUCTIVITY_THRESHOLDS,
  BOTTLENECK_THRESHOLD,
};
