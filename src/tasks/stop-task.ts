/** Stop task command. Ported from OpenHarness tasks/stop_task.py */
import { BackgroundTaskManager } from "./manager.js";

function stopTask(taskId, mgr) {
  const manager = mgr || (global.__backgroundTaskManager || null);
  if (!manager) throw new Error("No task manager available");
  return manager.stopTask(taskId);
}

export { stopTask };
