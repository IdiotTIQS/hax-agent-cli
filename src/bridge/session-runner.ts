import { spawn } from "child_process";
class SessionHandle { constructor(o) { this.process = o.process; this.cwd = o.cwd; this.startedAt = o.startedAt || Date.now(); } }
function spawnSession(opts) { const proc = spawn(opts.command, { shell: true, cwd: opts.cwd || process.cwd(), stdio: "pipe" }); return Promise.resolve(new SessionHandle({ process: proc, cwd: opts.cwd, startedAt: Date.now() })); }
export { SessionHandle, spawnSession };
