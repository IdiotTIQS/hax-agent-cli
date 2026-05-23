"use strict";

/**
 * Background task scheduler bridge.
 *
 * Wires CronScheduler + TaskQueue + TaskWorker together and registers
 * recurring maintenance tasks (health check, memory optimisation,
 * session cleanup). Returns the trio so other modules can enqueue
 * ad-hoc tasks or inspect the pipeline.
 */

const { CronScheduler } = require("../scheduler/cron");
const { TaskQueue } = require("../scheduler/queue");
const { TaskWorker } = require("../scheduler/worker");
const { debug } = require("../debug");

/** @type {WeakMap<object, object>} session -> { scheduler, queue, worker } */
const _instances = new WeakMap();

/**
 * Default task executor used by the background worker.
 *
 * In a real deployment you would swap this for a router that dispatches
 * based on `task.type`.  Right now every background task just logs its
 * execution and emits an event on the session bus when available.
 *
 * @param {object} task
 * @param {object} _ctx - injected context (session reference)
 * @returns {Promise<*>}
 */
function defaultExecutor(task) {
  return new Promise((resolve) => {
    const name = task.name || task.type || "background";
    debug("scheduler:bg", `running "${name}" (${task.id})`);

    // If a session reference is stashed on the task data, emit an event.
    const session = task._session;
    if (session && session.eventBus) {
      try {
        session.eventBus.emit("scheduler:task.run", {
          taskId: task.id,
          taskName: name,
          taskType: task.type,
          timestamp: new Date().toISOString(),
        });
      } catch (_) { /* best-effort */ }
    }

    // Minimal delay to give the event loop a breath (health-check style).
    setImmediate(() => resolve({ ok: true, task: name }));
  });
}

/**
 * Wire up the scheduler, queue, and worker for a session.
 *
 * Registers three recurring maintenance tasks:
 *   - health-check   every 5 minutes
 *   - memory-optimise every 30 minutes
 *   - session-cleanup every hour
 *
 * @param {object} session - The CLI Session object (must have .eventBus)
 * @returns {{ scheduler: CronScheduler, queue: TaskQueue, worker: TaskWorker }}
 */
function setupBackgroundTasks(session) {
  // One scheduler stack per session (WeakMap so it's cleaned up with the session).
  const existing = _instances.get(session);
  if (existing) return existing;

  const queue = new TaskQueue();
  const scheduler = new CronScheduler({
    enqueue: (task) => {
      try {
        queue.enqueue(task);
      } catch (err) {
        debug("scheduler:bg", `enqueue failed: ${err.message}`);
      }
    },
    tickInterval: 10_000, // check every 10 s — fine for background tasks
  });

  const worker = new TaskWorker({
    queue,
    executor: (task) => defaultExecutor(task, session),
    concurrency: 1,
    pollInterval: 1_000,
    maxRetries: 1,
    timeout: 30_000,
  });

  const helper = (type, name) => ({
    type,
    name,
    _session: session,
  });

  // ---- recurring maintenance tasks ----

  scheduler.schedule("*/5 * * * *", helper("health-check", "bg.health"));
  scheduler.schedule("*/30 * * * *", helper("memory-optimise", "bg.memory"));
  scheduler.schedule("0 * * * *", helper("session-cleanup", "bg.cleanup"));

  // ---- start the loop ----
  scheduler.start();
  worker.start();

  const trio = { scheduler, queue, worker };
  _instances.set(session, trio);

  debug("scheduler:bg", "background tasks initialised");
  return trio;
}

/**
 * Retrieve the scheduler stack previously created for a session,
 * or undefined if setupBackgroundTasks was never called.
 *
 * @param {object} session
 * @returns {{ scheduler: CronScheduler, queue: TaskQueue, worker: TaskWorker } | undefined}
 */
function getBackgroundTasks(session) {
  return _instances.get(session);
}

/**
 * Gracefully tear down background processing for a session.
 *
 * - Stops the cron scheduler (no more jobs will fire).
 * - Stops the worker (waits for in-flight tasks to finish).
 * - Removes the association from the WeakMap.
 *
 * @param {object} session
 * @returns {Promise<void>}
 */
async function teardownBackgroundTasks(session) {
  const trio = _instances.get(session);
  if (!trio) return;

  trio.scheduler.stop();
  await trio.worker.stop();
  _instances.delete(session);

  debug("scheduler:bg", "background tasks torn down");
}

module.exports = {
  setupBackgroundTasks,
  getBackgroundTasks,
  teardownBackgroundTasks,
};
