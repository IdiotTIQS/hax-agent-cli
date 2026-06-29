/** Local agent task facade. Ported from OpenHarness tasks/local_agent_task.py */
// default-import-destructure: tasks/manager.js is still CJS until B5 (ESM named-import of CJS fails under plain node)
import taskManagerMod from "./manager.js";
const { BackgroundTaskManager } = taskManagerMod;

let _defaultMgr = null;
function getDefaultTaskManager() { if (!_defaultMgr) _defaultMgr = new BackgroundTaskManager(); return _defaultMgr; }

function spawnLocalAgentTask(opts = {}) {
  return getDefaultTaskManager().createAgentTask({
    prompt: opts.prompt, description: opts.description || opts.prompt?.slice(0, 100) || "agent",
    cwd: opts.cwd || process.cwd(), model: opts.model || null, env: opts.env || null,
  });
}

export { spawnLocalAgentTask, getDefaultTaskManager };
