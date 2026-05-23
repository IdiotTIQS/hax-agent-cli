"use strict";

/**
 * Task Integration Bridge
 *
 * Wires the orphan `src/tasks/resolver.js` (TaskResolver) and
 * `src/tasks/tracker.js` (TaskTracker) modules into the existing
 * `src/teams/runtime.js` (TeamRuntime) system.
 *
 * Intent: consume a team plan, convert it into a dependency-aware
 * task graph, track execution progress via events, and export status
 * in display-ready form.
 */

const { TaskResolver } = require("../tasks/resolver");
const { TaskTracker, STATUS } = require("../tasks/tracker");
const { TeamRuntime } = require("../teams/runtime");

// ---------------------------------------------------------------------------
// createTeamTasks
// ---------------------------------------------------------------------------

/**
 * Convert a team plan (from a TeamRuntime snapshot or planner output) into
 * a TaskResolver graph plus a TaskTracker for live progress monitoring.
 *
 * @param {object} teamConfig
 * @param {object} teamConfig.plan     - team plan object (must have .tasks[])
 * @param {object} [teamConfig.runtime] - optional TeamRuntime instance for live state
 * @returns {{ resolver: TaskResolver, tracker: TaskTracker, graph: object }}
 */
function createTeamTasks(teamConfig) {
  if (!teamConfig || !teamConfig.plan) {
    throw new TypeError("teamConfig.plan is required");
  }

  const plan = teamConfig.plan;
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];

  if (tasks.length === 0) {
    throw new Error("Team plan has no tasks to convert into a task graph");
  }

  const resolver = new TaskResolver();
  const tracker = new TaskTracker();

  for (const task of tasks) {
    // Register in the dependency resolver
    resolver.addTask({
      id: task.id,
      title: task.title || task.id,
      dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
    });

    // Register in the live tracker (seeds initial PENDING state)
    tracker._registerTask({ id: task.id, title: task.title });
  }

  // Pre-validate the graph
  const validation = resolver.resolve();

  // Build a human-readable graph summary
  const graph = {
    tasks: resolver.getAllTasks(),
    executionOrder: validation.valid ? resolver.getExecutionOrder().map((t) => t.id) : [],
    parallelGroups: validation.valid ? resolver.getParallelGroups().map((g) => g.map((t) => t.id)) : [],
    criticalPath: validation.valid ? resolver.getCriticalPath().path.map((t) => t.id) : [],
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
  };

  return { resolver, tracker, graph };
}

// ---------------------------------------------------------------------------
// trackTeamProgress
// ---------------------------------------------------------------------------

/**
 * Wire a TeamRuntime execution into a TaskTracker so lifecycle events
 * (start / complete / fail / block) are emitted in real time.
 *
 * Listens for progress changes on the runtime by polling the snapshot at
 * a configurable interval, syncing state into the tracker.
 *
 * @param {TeamRuntime} teamRuntime - active team runtime instance
 * @param {TaskTracker} taskTracker - pre-configured tracker
 * @param {object} [options]
 * @param {number} [options.pollIntervalMs] - how often to sample runtime state (default 500)
 * @param {boolean} [options.autoStart]     - immediately begin polling (default true)
 * @returns {{ stop: function, tracker: TaskTracker }}
 */
function trackTeamProgress(teamRuntime, taskTracker, options) {
  if (!teamRuntime || typeof teamRuntime.snapshot !== "function") {
    throw new TypeError("teamRuntime must be a TeamRuntime instance");
  }
  if (!taskTracker || typeof taskTracker.start !== "function") {
    throw new TypeError("taskTracker must be a TaskTracker instance");
  }

  const opts = {
    pollIntervalMs: options && options.pollIntervalMs ? options.pollIntervalMs : 500,
    autoStart: options ? options.autoStart !== false : true,
  };

  const synced = new Set();
  let intervalId = null;

  function syncTaskState(task) {
    const id = task.id;

    // Already synced this task at its current status — skip
    const key = `${id}:${task.status}`;
    if (synced.has(key)) return;
    synced.add(key);

    switch (task.status) {
      case "in_progress":
        taskTracker.start(id);
        break;
      case "completed":
        taskTracker.complete(id, task.result);
        break;
      case "failed":
        taskTracker.fail(id, task.error);
        break;
      case "pending":
        // Already tracked as PENDING from registration; nothing to do.
        break;
      default:
        break;
    }
  }

  function tick() {
    let snapshot;
    try {
      snapshot = teamRuntime.snapshot();
    } catch (_err) {
      // Runtime may not be ready (no active team); skip silently.
      return;
    }

    if (!snapshot || !Array.isArray(snapshot.tasks)) return;

    for (const task of snapshot.tasks) {
      syncTaskState(task);
    }

    // Also check for blocked tasks
    const ready = [];
    const blocked = [];
    try {
      const progress = teamRuntime.getProgress();
      // Tasks that are pending but have unmet dependencies are blocked
      for (const task of snapshot.tasks) {
        if (task.status === "pending") {
          const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
          const allResolved = deps.every((depId) => {
            const dep = snapshot.tasks.find((t) => t.id === depId);
            return dep && dep.status === "completed";
          });
          if (deps.length > 0 && !allResolved) {
            taskTracker.block(task.id, "Waiting for dependencies: " + deps.join(", "));
          }
        }
      }
    } catch (_err) {
      // Best-effort blocking detection
    }
  }

  // Immediate first sync
  tick();

  if (opts.autoStart) {
    intervalId = setInterval(tick, opts.pollIntervalMs);
    if (intervalId && typeof intervalId === "object" && intervalId.unref) {
      intervalId.unref();
    }
  }

  return {
    /** Stop polling. The tracker retains its last state. */
    stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    tracker: taskTracker,
  };
}

// ---------------------------------------------------------------------------
// exportTaskStatus
// ---------------------------------------------------------------------------

/**
 * Export the current state of a TaskTracker in display-friendly form.
 *
 * @param {TaskTracker} tracker
 * @returns {{ tasks: object[], progress: object, summary: string }}
 */
function exportTaskStatus(tracker) {
  if (!tracker || typeof tracker.getStatus !== "function") {
    throw new TypeError("tracker must be a TaskTracker instance");
  }

  const tasks = tracker.getStatus();
  const progress = tracker.getProgress();

  const statusLabels = {
    pending: "Pending",
    in_progress: "In Progress",
    completed: "Completed",
    failed: "Failed",
    blocked: "Blocked",
  };

  const summaryLines = [
    `Tasks: ${progress.done}/${progress.total} done (${progress.percent}%)`,
  ];
  if (progress.inProgress > 0) summaryLines.push(`${progress.inProgress} in progress`);
  if (progress.failed > 0) summaryLines.push(`${progress.failed} failed`);
  if (progress.blocked > 0) summaryLines.push(`${progress.blocked} blocked`);

  return {
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      statusLabel: statusLabels[task.status] || task.status,
      result: task.result,
      error: task.error ? (task.error.message || String(task.error)) : null,
      reason: task.reason || null,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    })),
    progress,
    summary: summaryLines.join(", "),
  };
}

module.exports = {
  createTeamTasks,
  trackTeamProgress,
  exportTaskStatus,
};
