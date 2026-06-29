/**
 * Background task manager.
 * Ported from OpenHarness tasks/manager.py
 *
 * Manages shell and agent subprocess tasks with output capture,
 * stdin forwarding, restart capability, and completion listeners.
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getTasksDir } from "../config/paths.js";
import { TaskRecord, TaskStatus, TaskType } from "./types.js";

class BackgroundTaskManager {
  constructor() {
    this._tasks = new Map();
    this._processes = new Map();
    this._completionListeners = [];
  }

  /** Start a background shell command task. */
  createShellTask(opts = {}) {
    const id = _taskId(opts.taskType || TaskType.LOCAL_BASH);
    const outputFile = path.join(getTasksDir(), `${id}.log`);
    fs.writeFileSync(outputFile, "", "utf-8");

    const record = new TaskRecord({
      id, type: opts.taskType || TaskType.LOCAL_BASH,
      status: TaskStatus.RUNNING, description: opts.description || "",
      cwd: opts.cwd || process.cwd(), outputFile,
      command: opts.command || null, argv: opts.argv || null,
      startedAt: Date.now(), createdAt: Date.now(),
      env: opts.env || null,
    });

    this._tasks.set(id, record);
    this._startProcess(id);
    return record;
  }

  /** Start a background agent task. */
  createAgentTask(opts = {}) {
    const argv = opts.argv || ["node", path.join(import.meta.dirname, "..", "cli.js"), "--batch", opts.prompt || ""];
    const record = this.createShellTask({
      taskType: opts.taskType || TaskType.LOCAL_AGENT,
      description: opts.description || "",
      cwd: opts.cwd || process.cwd(),
      argv, prompt: opts.prompt || "",
      env: opts.env || null,
    });
    return record;
  }

  getTask(id) { return this._tasks.get(id) || null; }

  listTasks(status) {
    const tasks = [...this._tasks.values()];
    return status ? tasks.filter(t => t.status === status) : tasks;
  }

  updateTask(id, updates = {}) {
    const task = this._tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    if (updates.description) task.description = updates.description;
    if (updates.progress !== undefined) task.metadata.progress = String(updates.progress);
    if (updates.statusNote) task.metadata.statusNote = updates.statusNote;
    return task;
  }

  /** Terminate a running task. */
  stopTask(id) {
    const task = this._tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    const proc = this._processes.get(id);
    if (proc && !proc.killed) {
      proc.kill("SIGTERM");
      setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 3000);
    }
    task.status = TaskStatus.KILLED;
    task.endedAt = Date.now();
    _notify(this._completionListeners, task);
    return task;
  }

  /** Write input to task stdin. */
  writeToTask(id, data) {
    const proc = this._processes.get(id);
    if (!proc || !proc.stdin || proc.killed) throw new Error(`Task ${id} is not writable`);
    proc.stdin.write(data + "\n");
  }

  /** Read task output file tail. */
  readTaskOutput(id, maxBytes = 12000) {
    const task = this._tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    try {
      const content = fs.readFileSync(task.outputFile, "utf-8");
      return content.length > maxBytes ? content.slice(-maxBytes) : content;
    } catch (_) { return ""; }
  }

  registerCompletionListener(fn) { this._completionListeners.push(fn); return () => { const i = this._completionListeners.indexOf(fn); if (i >= 0) this._completionListeners.splice(i, 1); }; }

  close() {
    for (const [id, proc] of this._processes) {
      try { if (!proc.killed) proc.kill(); } catch (_) {}
      try { if (proc.stdin && !proc.stdin.destroyed) proc.stdin.destroy(); } catch (_) {}
    }
    this._processes.clear();
  }

  _startProcess(id) {
    const task = this._tasks.get(id);
    if (!task) return;

    const argv = task.argv || (task.command ? ["cmd.exe", "/d", "/s", "/c", task.command] : null);
    if (!argv) return;

    const proc = spawn(argv[0], argv.slice(1), {
      cwd: task.cwd, stdio: ["pipe", "pipe", "pipe"],
      env: task.env ? { ...process.env, ...task.env } : process.env,
    });
    this._processes.set(id, proc);

    const outStream = fs.createWriteStream(task.outputFile, { flags: "a" });
    proc.stdout.pipe(outStream);
    proc.stderr.pipe(outStream);

    proc.on("exit", (code) => {
      task.returnCode = code;
      if (task.status !== TaskStatus.KILLED) task.status = code === 0 ? TaskStatus.COMPLETED : TaskStatus.FAILED;
      task.endedAt = Date.now();
      _notify(this._completionListeners, task);
      this._processes.delete(id);
    });

    proc.on("error", (err) => {
      task.status = TaskStatus.FAILED;
      task.endedAt = Date.now();
      task.metadata.error = err.message;
      _notify(this._completionListeners, task);
      this._processes.delete(id);
    });
  }
}

function _notify(listeners, task) {
  for (const fn of listeners) {
    try { fn(task); } catch (_) {}
  }
}

function _taskId(taskType) {
  const prefixes = { local_bash: "b", local_agent: "a", remote_agent: "r", in_process_teammate: "t", dream: "d" };
  const suffix = Math.random().toString(36).slice(2, 10);
  return `${prefixes[taskType] || "b"}${suffix}`;
}

export { BackgroundTaskManager };
