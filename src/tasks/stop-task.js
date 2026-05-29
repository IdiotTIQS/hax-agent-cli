"use strict";
/** Stop task command. Ported from OpenHarness tasks/stop_task.py */
const { BackgroundTaskManager } = require("./manager");

function stopTask(taskId, mgr) {
  const manager = mgr || (global.__backgroundTaskManager || null);
  if (!manager) throw new Error("No task manager available");
  return manager.stopTask(taskId);
}

module.exports = { stopTask };
