import { EventEmitter } from "events";

interface CronJob {
  callback: () => void;
  intervalMs: number;
  lastRun: number;
}

class CronScheduler extends EventEmitter {
  _jobs: Map<string, CronJob>;
  _timer: NodeJS.Timeout | null;

  constructor() { super(); this._jobs = new Map(); this._timer = null; }
  add(name: string, callback: () => void, intervalMs: number) { this._jobs.set(name, { callback, intervalMs, lastRun: 0 }); if (!this._timer) this._start(); return this; }
  remove(name: string) { this._jobs.delete(name); if (this._jobs.size === 0) this._stop(); }
  _start() { this._timer = setInterval(() => { const now = Date.now(); for (const [name, job] of this._jobs) { if (now - job.lastRun >= job.intervalMs) { job.lastRun = now; try { job.callback(); } catch (_) {} this.emit("tick", { name, time: now }); } } }, 1000); this._timer.unref(); }
  _stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
}
export { CronScheduler };
