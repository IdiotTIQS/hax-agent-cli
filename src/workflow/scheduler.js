"use strict";

const { EventEmitter } = require("node:events");

const TRIGGER_TYPES = {
  ON_PUSH: "onPush",
  ON_SCHEDULE: "onSchedule",
  ON_PR: "onPR",
  ON_DEMAND: "onDemand",
  ON_FILE_CHANGE: "onFileChange",
};

const TRIGGER_TYPE_SET = new Set(Object.values(TRIGGER_TYPES));

const STATUS = {
  SCHEDULED: "scheduled",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  PAUSED: "paused",
};

const TERMINAL_STATUSES = new Set([
  STATUS.COMPLETED,
  STATUS.FAILED,
  STATUS.CANCELLED,
]);

// Ref: https://en.wikipedia.org/wiki/Cron#CRON_expression
// Supports: minute hour day-of-month month day-of-week
const CRON_RE = /^(\*(\/\d+)?|\d+(-\d+)?(\/\d+)?|\d+(,\d+)*)\s+(\*(\/\d+)?|\d+(-\d+)?(\/\d+)?|\d+(,\d+)*)\s+(\*(\/\d+)?|\d+(-\d+)?(\/\d+)?|\d+(,\d+)*)\s+(\*(\/\d+)?|\d+(-\d+)?(\/\d+)?|\d+(,\d+)*)\s+(\*(\/\d+)?|\d+(-\d+)?(\/\d+)?|\d+(,\d+)*)$/;

class WorkflowScheduler extends EventEmitter {
  constructor() {
    super();
    this._scheduled = new Map();   // id -> scheduled entry
    this._history = [];            // list of historical entries (newest last)
    this._running = new Map();     // id -> currently running entry
    this._counter = 0;
    this._timers = new Map();      // id -> setTimeout handle
  }

  // ---- Scheduling ----

  /**
   * Schedule a workflow with a trigger configuration.
   * @param {object} workflow - Workflow definition { name, steps, ... }
   * @param {object} trigger
   *   { type: 'onPush'|'onSchedule'|'onPR'|'onDemand'|'onFileChange',
   *     config: { ... trigger-specific options ... },
   *     name?: string,
   *     priority?: number,
   *     maxRetries?: number,
   *     timeout?: number }
   * @returns {object} The scheduled entry metadata.
   */
  schedule(workflow, trigger) {
    if (!workflow || typeof workflow !== "object") {
      throw new Error("Workflow must be an object.");
    }
    if (typeof workflow.name !== "string" || workflow.name.trim().length === 0) {
      throw new Error("Workflow must have a non-empty name.");
    }
    if (!Array.isArray(workflow.steps)) {
      throw new Error("Workflow must have a steps array.");
    }

    // Normalize trigger
    const normalizedTrigger = this._normalizeTrigger(trigger);

    const id = `sched-${Date.now().toString(36)}-${++this._counter}`;
    const now = new Date().toISOString();

    const entry = {
      id,
      name: typeof trigger.name === "string" ? trigger.name : `Scheduled: ${workflow.name}`,
      workflowName: workflow.name,
      workflow: cloneWorkflow(workflow),
      trigger: normalizedTrigger,
      status: STATUS.SCHEDULED,
      priority: Number.isSafeInteger(trigger.priority) ? trigger.priority : 0,
      maxRetries: Number.isSafeInteger(trigger.maxRetries) && trigger.maxRetries >= 0
        ? trigger.maxRetries
        : 3,
      timeout: Number.isSafeInteger(trigger.timeout) && trigger.timeout > 0
        ? trigger.timeout
        : 600_000,
      retryCount: 0,
      createdAt: now,
      scheduledAt: now,
      startedAt: null,
      completedAt: null,
      duration: null,
      error: null,
      metadata: trigger.metadata || {},
    };

    // If cron schedule, compute next run time
    if (normalizedTrigger.type === TRIGGER_TYPES.ON_SCHEDULE && normalizedTrigger.cron) {
      entry.nextRunAt = this._computeNextCron(normalizedTrigger.cron);
    } else {
      entry.nextRunAt = null;
    }

    if (normalizedTrigger.type === TRIGGER_TYPES.ON_DEMAND) {
      // onDemand starts immediately
      entry.status = STATUS.RUNNING;
      entry.startedAt = now;
      this._running.set(id, entry);
      // Emit event for external executor
      this.emit("workflow.triggered", { id, entry, type: "onDemand" });
    }

    this._scheduled.set(id, entry);
    this.emit("workflow.scheduled", { id, entry });

    return this._describe(id);
  }

  /**
   * Manually trigger a scheduled workflow to run now.
   * @param {string} id
   * @returns {object|false} Entry or false if not found.
   */
  triggerNow(id) {
    const entry = this._scheduled.get(id);
    if (!entry) return false;

    if (this._running.has(id)) return false;

    const now = new Date().toISOString();
    entry.status = STATUS.RUNNING;
    entry.startedAt = now;
    this._running.set(id, entry);

    this.emit("workflow.triggered", {
      id,
      entry: this._describe(id),
      type: "manual",
    });

    return this._describe(id);
  }

  // ---- Query ----

  /**
   * List all upcoming (non-terminal) scheduled workflows.
   * @returns {Array<object>}
   */
  getUpcoming() {
    const upcoming = [];
    for (const [, entry] of this._scheduled) {
      if (!TERMINAL_STATUSES.has(entry.status)) {
        upcoming.push(this._describe(entry.id));
      }
    }
    upcoming.sort((a, b) => {
      // Sort by next run time if available, then by priority
      if (a.nextRunAt && b.nextRunAt) return a.nextRunAt.localeCompare(b.nextRunAt);
      if (a.nextRunAt) return -1;
      if (b.nextRunAt) return 1;
      return (b.priority || 0) - (a.priority || 0);
    });
    return upcoming;
  }

  /**
   * Return execution history with status and duration.
   * @param {object} [options]
   *   { limit?: number, offset?: number, status?: string, workflowName?: string }
   * @returns {Array<object>}
   */
  getHistory(options = {}) {
    let results = [...this._history];

    // Also include entries from _scheduled that have completed/failed/cancelled
    // but are not yet in history (flushed on getHistory to avoid duplicates)
    for (const [, entry] of this._scheduled) {
      if (TERMINAL_STATUSES.has(entry.status)) {
        results.push(this._describe(entry.id));
      }
    }

    if (options.workflowName) {
      results = results.filter((r) => r.workflowName === options.workflowName);
    }
    if (options.status) {
      results = results.filter((r) => r.status === options.status);
    }

    results.sort((a, b) => (b.completedAt || b.createdAt || "").localeCompare(a.completedAt || a.createdAt || ""));

    const offset = Number.isSafeInteger(options.offset) && options.offset >= 0 ? options.offset : 0;
    const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : 50;

    return results.slice(offset, offset + limit);
  }

  /**
   * Get a single scheduled entry by id.
   * @param {string} id
   * @returns {object|undefined}
   */
  get(id) {
    const entry = this._scheduled.get(id);
    if (!entry) return undefined;
    return this._describe(id);
  }

  /**
   * Count scheduled workflows by status.
   * @returns {object}
   */
  stats() {
    const byStatus = {};
    const byTrigger = {};
    let total = 0;

    for (const [, entry] of this._scheduled) {
      byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
      byTrigger[entry.trigger.type] = (byTrigger[entry.trigger.type] || 0) + 1;
      total += 1;
    }

    const historyCounts = {};
    for (const h of this._history) {
      historyCounts[h.status] = (historyCounts[h.status] || 0) + 1;
    }

    return {
      total,
      byStatus,
      byTrigger,
      running: this._running.size,
      historyTotal: this._history.length,
      historyByStatus: historyCounts,
    };
  }

  // ---- Lifecycle ----

  /**
   * Mark a workflow execution as complete.
   * @param {string} id
   * @param {object} [result]
   * @returns {boolean}
   */
  complete(id, result = null) {
    const entry = this._scheduled.get(id);
    if (!entry) return false;

    entry.status = STATUS.COMPLETED;
    entry.completedAt = new Date().toISOString();
    if (entry.startedAt) {
      entry.duration = new Date(entry.completedAt) - new Date(entry.startedAt);
    }
    entry.result = result;

    this._running.delete(id);
    this._archive(entry);
    this.emit("workflow.completed", { id, entry: this._describe(id) });

    return true;
  }

  /**
   * Mark a workflow execution as failed.
   * @param {string} id
   * @param {Error|object} error
   * @returns {boolean}
   */
  fail(id, error) {
    const entry = this._scheduled.get(id);
    if (!entry) return false;

    const serialized = serializeErrorSched(error);

    // Retry logic
    if (entry.retryCount < entry.maxRetries) {
      entry.retryCount += 1;
      entry.error = serialized;
      entry.status = STATUS.SCHEDULED;
      entry.startedAt = null;
      this._running.delete(id);
      this.emit("workflow.retrying", {
        id,
        entry: this._describe(id),
        attempt: entry.retryCount,
        maxRetries: entry.maxRetries,
        error: serialized,
      });
      return true;
    }

    entry.status = STATUS.FAILED;
    entry.completedAt = new Date().toISOString();
    if (entry.startedAt) {
      entry.duration = new Date(entry.completedAt) - new Date(entry.startedAt);
    }
    entry.error = serialized;

    this._running.delete(id);
    this._archive(entry);
    this.emit("workflow.failed", { id, entry: this._describe(id), error: serialized });

    return true;
  }

  /**
   * Cancel a scheduled or running workflow.
   * @param {string} id
   * @returns {boolean}
   */
  cancel(id) {
    const entry = this._scheduled.get(id);
    if (!entry) return false;

    if (TERMINAL_STATUSES.has(entry.status)) {
      return false;
    }

    entry.status = STATUS.CANCELLED;
    entry.completedAt = new Date().toISOString();
    if (entry.startedAt) {
      entry.duration = new Date(entry.completedAt) - new Date(entry.startedAt);
    }

    // Clear any active timer
    const timer = this._timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(id);
    }

    this._running.delete(id);
    this._archive(entry);
    this.emit("workflow.cancelled", { id, entry: this._describe(id) });

    return true;
  }

  /**
   * Pause a scheduled workflow (prevent it from triggering).
   * @param {string} id
   * @returns {boolean}
   */
  pause(id) {
    const entry = this._scheduled.get(id);
    if (!entry) return false;

    if (TERMINAL_STATUSES.has(entry.status) || entry.status === STATUS.PAUSED) {
      return false;
    }

    entry.status = STATUS.PAUSED;
    entry.pausedAt = new Date().toISOString();
    this.emit("workflow.paused", { id, entry: this._describe(id) });

    return true;
  }

  /**
   * Resume a paused workflow.
   * @param {string} id
   * @returns {boolean}
   */
  resume(id) {
    const entry = this._scheduled.get(id);
    if (!entry || entry.status !== STATUS.PAUSED) return false;

    entry.status = STATUS.SCHEDULED;
    entry.pausedAt = null;
    this.emit("workflow.resumed", { id, entry: this._describe(id) });

    return true;
  }

  /**
   * Remove a scheduled entry entirely.
   * @param {string} id
   * @returns {boolean}
   */
  remove(id) {
    const timer = this._timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(id);
    }

    this._running.delete(id);
    return this._scheduled.delete(id);
  }

  /**
   * Clear all scheduled entries and history.
   */
  clear() {
    for (const [id, timer] of this._timers) {
      clearTimeout(timer);
    }
    this._timers.clear();
    this._scheduled.clear();
    this._running.clear();
    this._history = [];
    this._counter = 0;
  }

  // ---- Internal helpers ----

  _normalizeTrigger(trigger) {
    if (!trigger || typeof trigger !== "object") {
      throw new Error("Trigger must be an object.");
    }

    const type = typeof trigger.type === "string" ? trigger.type.trim() : "";
    if (!TRIGGER_TYPE_SET.has(type)) {
      throw new Error(
        `Invalid trigger type: "${type}". Must be one of: ${[...TRIGGER_TYPE_SET].join(", ")}.`,
      );
    }

    const config = { ...(trigger.config || {}) };

    const result = { type, config };

    if (type === TRIGGER_TYPES.ON_SCHEDULE) {
      let cronExpr = config.cron || config.expression || config.schedule || "";
      if (typeof cronExpr !== "string" || !CRON_RE.test(cronExpr.trim())) {
        throw new Error(
          `onSchedule trigger requires a valid cron expression. Got: "${cronExpr}".`,
        );
      }
      result.cron = cronExpr.trim();
    }

    if (type === TRIGGER_TYPES.ON_PUSH) {
      result.branch = config.branch || "*";
    }

    if (type === TRIGGER_TYPES.ON_PR) {
      result.targetBranch = config.targetBranch || "*";
      result.sourceBranch = config.sourceBranch || "*";
    }

    if (type === TRIGGER_TYPES.ON_FILE_CHANGE) {
      result.paths = Array.isArray(config.paths) ? config.paths : (config.path ? [config.path] : ["*"]);
      if (result.paths.length === 0) result.paths = ["*"];
    }

    return result;
  }

  _computeNextCron(cronExpr) {
    // Simple cron calculator — computes the next matching minute/hour slot
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return null;

    const now = new Date();
    const [minField, hourField, domField, monthField, dowField] = parts;

    // For simplicity, find next matching minute within the next 24 hours
    const candidates = [];

    for (let offset = 0; offset <= 1440; offset++) {
      const candidate = new Date(now.getTime() + offset * 60_000);
      candidate.setSeconds(0, 0);

      if (
        matchesField(candidate.getMinutes(), minField) &&
        matchesField(candidate.getHours(), hourField) &&
        matchesField(candidate.getDate(), domField) &&
        matchesField(candidate.getMonth() + 1, monthField) &&
        matchesField(candidate.getDay(), dowField)
      ) {
        if (candidate.getTime() > now.getTime()) {
          return candidate.toISOString();
        }
      }
    }

    // Fallback: return 1 minute from now
    return new Date(now.getTime() + 60_000).toISOString();
  }

  _describe(id) {
    const entry = this._scheduled.get(id);
    if (!entry) return undefined;

    return {
      id: entry.id,
      name: entry.name,
      workflowName: entry.workflowName,
      trigger: entry.trigger,
      status: entry.status,
      priority: entry.priority,
      retryCount: entry.retryCount,
      maxRetries: entry.maxRetries,
      timeout: entry.timeout,
      createdAt: entry.createdAt,
      scheduledAt: entry.scheduledAt,
      startedAt: entry.startedAt,
      completedAt: entry.completedAt,
      duration: entry.duration,
      nextRunAt: entry.nextRunAt,
      pausedAt: entry.pausedAt || null,
      error: entry.error,
      result: entry.result,
      metadata: entry.metadata,
      stepCount: entry.workflow ? entry.workflow.steps.length : 0,
    };
  }

  _archive(entry) {
    this._history.push({
      id: entry.id,
      name: entry.name,
      workflowName: entry.workflowName,
      trigger: entry.trigger,
      status: entry.status,
      priority: entry.priority,
      retryCount: entry.retryCount,
      createdAt: entry.createdAt,
      startedAt: entry.startedAt,
      completedAt: entry.completedAt,
      duration: entry.duration,
      error: entry.error,
      result: entry.result,
      metadata: entry.metadata,
    });
  }
}

// ---- Cron field matching ----

function matchesField(value, field) {
  if (field === "*") return true;

  const parts = field.split(",");

  for (const part of parts) {
    if (part.includes("/")) {
      const [range, step] = part.split("/");
      const stepNum = Number(step);
      if (range === "*" && value % stepNum === 0) return true;
    } else if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (value >= start && value <= end) return true;
    } else {
      if (Number(part) === value) return true;
    }
  }

  return false;
}

// ---- Helpers ----

function cloneWorkflow(workflow) {
  return JSON.parse(JSON.stringify(workflow));
}

function serializeErrorSched(err) {
  if (err instanceof Error) {
    return {
      name: err.name || "Error",
      message: err.message,
      stack: err.stack,
      code: err.code,
    };
  }
  if (err && typeof err === "object") {
    return { name: "Error", message: String(err.message || JSON.stringify(err)) };
  }
  return { name: "Error", message: String(err || "Unknown error") };
}

module.exports = {
  WorkflowScheduler,
  TRIGGER_TYPES,
  STATUS,
};
