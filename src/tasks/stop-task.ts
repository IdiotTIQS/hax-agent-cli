/** Stop task command. Ported from OpenHarness tasks/stop_task.py */
import { BackgroundTaskManager } from "./manager.js";

interface GlobalWithTaskManager {
  __backgroundTaskManager?: BackgroundTaskManager;
}

function stopTask(taskId: string, mgr?: BackgroundTaskManager | null): unknown {
  const manager = mgr || ((global as unknown as GlobalWithTaskManager).__backgroundTaskManager || null);
  if (!manager) throw new Error("No task manager available");
  return manager.stopTask(taskId);
}

export { stopTask };
