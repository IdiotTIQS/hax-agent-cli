"use strict";

/**
 * Cron-based scheduler for recurring and one-shot task scheduling.
 *
 * Supports:
 *   - 5-field standard cron expressions (minute hour dom month dow)
 *   - One-shot scheduling at a specific Date
 *   - Recurring interval scheduling (every N ms)
 *
 * No persistence — schedules live in memory.  Use Queue + worker for execution.
 */

const { debug } = require('../debug');

// ---------------------------------------------------------------------------
// Cron parser — 5-field standard
//   field:    minute   hour   day-of-month   month   day-of-week
//   range:    0-59     0-23   1-31           1-12    0-6 (0=Sun)
// ---------------------------------------------------------------------------

const FIELD_RANGES = [
  { name: 'minute',      min: 0,  max: 59  },
  { name: 'hour',        min: 0,  max: 23  },
  { name: 'dayOfMonth',  min: 1,  max: 31  },
  { name: 'month',       min: 1,  max: 12  },
  { name: 'dayOfWeek',   min: 0,  max: 6   },
];

/**
 * Parse a single cron field into a Set of allowed values.
 *
 * Supports:
 *   *          — every value
 *   N          — exact value
 *   N-M        — range inclusive
 *   N-M/S      — range with step
 *   N,M,O      — list
 *   star/N    - step syntax (every N from min)
 *
 * @param {string} field
 * @param {number} min
 * @param {number} max
 * @returns {Set<number>}
 */
function parseField(field, min, max) {
  const values = new Set();

  const parts = String(field).split(',');
  for (const part of parts) {
    const trimmed = part.trim();

    // Step syntax:  */5   or   1-30/5
    const stepMatch = trimmed.match(/^(.+)\/(\d+)$/);
    let range = trimmed;
    let step = 1;

    if (stepMatch) {
      range = stepMatch[1];
      step = parseInt(stepMatch[2], 10);
      if (step < 1) step = 1;
    }

    if (range === '*') {
      for (let v = min; v <= max; v += step) {
        values.add(v);
      }
    } else if (range.includes('-')) {
      const [loStr, hiStr] = range.split('-');
      const lo = parseInt(loStr, 10);
      const hi = parseInt(hiStr, 10);
      for (let v = lo; v <= hi; v += step) {
        if (v >= min && v <= max) values.add(v);
      }
    } else {
      const v = parseInt(range, 10);
      if (!isNaN(v) && v >= min && v <= max) {
        values.add(v);
      }
    }
  }

  return values;
}

/**
 * Parse a 5-field cron expression into an object with a Set for each field.
 *
 * @param {string} expression - "minute hour dom month dow"
 * @returns {object} { minute: Set, hour: Set, dayOfMonth: Set, month: Set, dayOfWeek: Set }
 * @throws {Error} if the expression is malformed.
 */
function parseCron(expression) {
  const fields = String(expression).trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression "${expression}": expected 5 fields, got ${fields.length}`);
  }

  const result = {};
  for (let i = 0; i < 5; i += 1) {
    const { name, min, max } = FIELD_RANGES[i];
    result[name] = parseField(fields[i], min, max);
  }

  return result;
}

/**
 * Check whether a parsed cron schedule matches a given date.
 *
 * @param {object} schedule - Parsed cron (output of parseCron)
 * @param {Date} date
 * @returns {boolean}
 */
function cronMatches(schedule, date) {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1; // JS months are 0-indexed
  const dow = date.getDay();         // 0=Sun

  return (
    schedule.minute.has(minute) &&
    schedule.hour.has(hour) &&
    schedule.dayOfMonth.has(dom) &&
    schedule.month.has(month) &&
    schedule.dayOfWeek.has(dow)
  );
}

/**
 * Find the next Date after `from` that matches a parsed cron schedule.
 *
 * Uses a minute-by-minute scan capped at 2 years ahead to avoid infinite loops.
 *
 * @param {object} schedule
 * @param {Date} [from]
 * @returns {Date|null}
 */
function nextCronDate(schedule, from) {
  const MAX_ITERATIONS = 2 * 366 * 24 * 60; // ~2 years of minutes

  const cursor = from ? new Date(from.getTime()) : new Date();
  cursor.setSeconds(0, 0); // start at :00 of the current minute
  cursor.setMinutes(cursor.getMinutes() + 1); // start from next minute

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    if (cronMatches(schedule, cursor)) {
      return cursor;
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Job management
// ---------------------------------------------------------------------------

let _jobIdCounter = 0;

class CronScheduler {
  /**
   * @param {object} [options]
   * @param {Function} [options.enqueue] - Called as enqueue(task) to submit a job
   * @param {number} [options.tickInterval=1000] - Granularity of the internal timer (ms)
   */
  constructor(options = {}) {
    /**
     * Map<jobId, {
     *   id: string,
     *   type: 'cron' | 'at' | 'every',
     *   task: object,
     *   cronExpr?: string,
     *   cronParsed?: object,
     *   at?: number,       // timestamp (ms) for one-shot
     *   every?: number,    // interval ms for recurring
     *   nextRun: number,   // timestamp of next scheduled run (ms)
     *   lastRun: number|null,
     *   active: boolean,
     * }>
     */
    this._jobs = new Map();
    this._enqueue = typeof options.enqueue === 'function' ? options.enqueue : null;
    this._tickInterval = Math.max(100, Number(options.tickInterval) || 1000);

    this._timer = null;
    this._running = false;
  }

  /**
   * @param {Function} fn - enqueue function to be used when firing jobs
   */
  setEnqueue(fn) {
    this._enqueue = fn;
  }

  /**
   * Start the internal tick loop.
   */
  start() {
    if (this._running) return;
    this._running = true;
    debug('scheduler:cron', 'scheduler started');
    this._tick();
  }

  /**
   * Stop the internal tick loop.  Scheduled jobs are preserved.
   */
  stop() {
    this._running = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    debug('scheduler:cron', 'scheduler stopped');
  }

  /**
   * Schedule a task to run on a cron expression.
   *
   * @param {string} cronExpression - 5-field cron "m h dom mon dow"
   * @param {object} task           - Task object (passed to enqueue when fired)
   * @returns {string} jobId
   */
  schedule(cronExpression, task) {
    const parsed = parseCron(cronExpression);
    const now = Date.now();
    const nextDate = nextCronDate(parsed, new Date(now));

    const job = {
      id: `cron-${++_jobIdCounter}`,
      type: 'cron',
      task,
      cronExpr: cronExpression,
      cronParsed: parsed,
      nextRun: nextDate ? nextDate.getTime() : null,
      lastRun: null,
      active: true,
    };

    this._jobs.set(job.id, job);
    debug('scheduler:cron', `scheduled ${job.id}: "${cronExpression}", next=${nextDate ? nextDate.toISOString() : 'never'}`);
    return job.id;
  }

  /**
   * Schedule a one-shot task at a specific Date.
   *
   * @param {Date|number} date - Date or timestamp (ms)
   * @param {object} task
   * @returns {string} jobId
   */
  scheduleAt(date, task) {
    const timestamp = typeof date === 'number' ? date : date.getTime();
    if (timestamp <= Date.now()) {
      throw new Error('scheduleAt requires a future date');
    }

    const job = {
      id: `at-${++_jobIdCounter}`,
      type: 'at',
      task,
      at: timestamp,
      nextRun: timestamp,
      lastRun: null,
      active: true,
    };

    this._jobs.set(job.id, job);
    debug('scheduler:cron', `scheduled ${job.id} at ${new Date(timestamp).toISOString()}`);
    return job.id;
  }

  /**
   * Schedule a recurring interval task.
   *
   * @param {number} ms       - Interval in milliseconds
   * @param {object} task
   * @returns {string} jobId
   */
  scheduleEvery(ms, task) {
    if (ms < 1) throw new Error('interval must be >= 1 ms');

    const now = Date.now();

    const job = {
      id: `every-${++_jobIdCounter}`,
      type: 'every',
      task,
      every: ms,
      nextRun: now + ms,
      lastRun: null,
      active: true,
    };

    this._jobs.set(job.id, job);
    debug('scheduler:cron', `scheduled ${job.id} every ${ms}ms`);
    return job.id;
  }

  /**
   * Cancel a scheduled job.
   *
   * @param {string} jobId
   * @returns {boolean} true if the job existed and was cancelled.
   */
  cancel(jobId) {
    const existed = this._jobs.has(jobId);
    if (existed) {
      const job = this._jobs.get(jobId);
      job.active = false;
      this._jobs.delete(jobId);
      debug('scheduler:cron', `cancelled ${jobId}`);
    }
    return existed;
  }

  /**
   * List all scheduled jobs.
   *
   * @param {object} [options]
   * @param {boolean} [options.activeOnly=true] - If true, only return active jobs.
   * @returns {object[]}
   */
  list(options = {}) {
    const activeOnly = options.activeOnly !== false;
    const results = [];

    for (const job of this._jobs.values()) {
      if (activeOnly && !job.active) continue;
      results.push({
        id: job.id,
        type: job.type,
        cronExpr: job.cronExpr || null,
        at: job.at || null,
        every: job.every || null,
        nextRun: job.nextRun ? new Date(job.nextRun).toISOString() : null,
        lastRun: job.lastRun ? new Date(job.lastRun).toISOString() : null,
        active: job.active,
        taskName: job.task.name || job.task.type || '',
      });
    }

    return results;
  }

  /**
   * Get the next run time for a job.
   *
   * @param {string} jobId
   * @returns {Date|null}
   */
  getNextRun(jobId) {
    const job = this._jobs.get(jobId);
    if (!job || job.nextRun === null) return null;
    return new Date(job.nextRun);
  }

  /**
   * Get the number of active jobs.
   * @returns {number}
   */
  get jobCount() {
    return this._jobs.size;
  }

  // ---- internals ----

  _tick() {
    if (!this._running) return;

    const now = Date.now();
    const dueJobs = [];

    for (const job of this._jobs.values()) {
      if (!job.active) continue;
      if (job.nextRun !== null && job.nextRun <= now) {
        dueJobs.push(job);
      }
    }

    // Fire due jobs.
    for (const job of dueJobs) {
      this._fire(job, now);
    }

    // Schedule next tick.
    const next = this._nextWakeup(now);
    const delay = Math.max(0, Math.min(next - now, this._tickInterval));

    this._timer = setTimeout(() => this._tick(), delay);
  }

  /**
   * Execute a due job.
   * @param {object} job
   * @param {number} now
   */
  _fire(job, now) {
    job.lastRun = now;

    // Enqueue the task.
    if (this._enqueue) {
      this._enqueue(job.task);
    }

    // Schedule next run.
    switch (job.type) {
      case 'cron': {
        const next = nextCronDate(job.cronParsed, new Date(now));
        job.nextRun = next ? next.getTime() : null;

        // If no future match exists, deactivate.
        if (!job.nextRun) {
          job.active = false;
        }
        break;
      }

      case 'at':
        // One-shot — deactivate after firing.
        job.nextRun = null;
        job.active = false;
        this._jobs.delete(job.id);
        break;

      case 'every':
        job.nextRun = now + job.every;
        break;
    }

    debug('scheduler:cron', `fired ${job.id}`);
  }

  /**
   * Find the earliest nextRun across all active jobs.
   * @param {number} now
   * @returns {number} timestamp
   */
  _nextWakeup(now) {
    let earliest = now + this._tickInterval;

    for (const job of this._jobs.values()) {
      if (job.active && job.nextRun !== null && job.nextRun < earliest) {
        earliest = job.nextRun;
      }
    }

    return earliest;
  }
}

module.exports = { CronScheduler, parseCron, parseField, cronMatches, nextCronDate, FIELD_RANGES };
