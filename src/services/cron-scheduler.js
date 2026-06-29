import { EventEmitter } from "events";
class CronScheduler extends EventEmitter {
  constructor() { super(); this._jobs = new Map(); this._timer = null; }
  add(name, callback, intervalMs) { this._jobs.set(name, { callback, intervalMs, lastRun: 0 }); if (!this._timer) this._start(); return this; }
  remove(name) { this._jobs.delete(name); if (this._jobs.size === 0) this._stop(); }
  _start() { this._timer = setInterval(() => { const now = Date.now(); for (const [name, job] of this._jobs) { if (now - job.lastRun >= job.intervalMs) { job.lastRun = now; try { job.callback(); } catch (_) {} this.emit("tick", { name, time: now }); } } }, 1000); this._timer.unref(); }
  _stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
}
export { CronScheduler };
