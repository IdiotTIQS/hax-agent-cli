/** Local agent task facade. Ported from OpenHarness tasks/local_agent_task.py */
import { BackgroundTaskManager } from "./manager.js";
import { TaskRecord } from "./types.js";

let _defaultMgr: BackgroundTaskManager | null = null;

function getDefaultTaskManager(): BackgroundTaskManager {
  if (!_defaultMgr) _defaultMgr = new BackgroundTaskManager();
  return _defaultMgr;
}

interface LocalAgentTaskOptions {
  prompt?: string;
  description?: string;
  cwd?: string;
  model?: string | null;
  env?: Record<string, string> | null;
}

function spawnLocalAgentTask(opts: LocalAgentTaskOptions = {}): TaskRecord {
  return getDefaultTaskManager().createAgentTask({
    prompt: opts.prompt,
    description: opts.description || opts.prompt?.slice(0, 100) || "agent",
    cwd: opts.cwd || process.cwd(),
    model: opts.model || null,
    env: opts.env || null,
  });
}

export { spawnLocalAgentTask, getDefaultTaskManager };
