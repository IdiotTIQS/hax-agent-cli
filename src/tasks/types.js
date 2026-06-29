/**
 * Task data models.
 * Ported from OpenHarness tasks/types.py
 */

const TaskType = { LOCAL_BASH: "local_bash", LOCAL_AGENT: "local_agent", REMOTE_AGENT: "remote_agent", IN_PROCESS_TEAMMATE: "in_process_teammate", DREAM: "dream" };
const TaskStatus = { PENDING: "pending", RUNNING: "running", COMPLETED: "completed", FAILED: "failed", KILLED: "killed" };

class TaskRecord {
  constructor(o = {}) {
    this.id = o.id || "";
    this.type = o.type || TaskType.LOCAL_BASH;
    this.status = o.status || TaskStatus.PENDING;
    this.description = o.description || "";
    this.cwd = o.cwd || process.cwd();
    this.outputFile = o.outputFile || "";
    this.command = o.command || null;
    this.prompt = o.prompt || null;
    this.createdAt = o.createdAt || Date.now();
    this.startedAt = o.startedAt || null;
    this.endedAt = o.endedAt || null;
    this.returnCode = o.returnCode || null;
    this.metadata = o.metadata || {};
    this.env = o.env || null;
    this.argv = o.argv || null;
  }
}

export { TaskType, TaskStatus, TaskRecord };
