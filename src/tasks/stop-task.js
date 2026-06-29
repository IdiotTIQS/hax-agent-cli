/** Stop task command. Ported from OpenHarness tasks/stop_task.py */
// default-import-destructure: tasks/manager.js is still CJS until B5 (ESM named-import of CJS fails under plain node)
import taskManagerMod from "./manager.js";
const { BackgroundTaskManager } = taskManagerMod;

function stopTask(taskId, mgr) {
  const manager = mgr || (global.__backgroundTaskManager || null);
  if (!manager) throw new Error("No task manager available");
  return manager.stopTask(taskId);
}

export { stopTask };
