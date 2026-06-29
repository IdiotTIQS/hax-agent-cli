import { spawn, ChildProcess } from "child_process";

interface SessionHandleOptions {
  process: ChildProcess;
  cwd?: string;
  startedAt?: number;
}

interface SpawnSessionOptions {
  command: string;
  cwd?: string;
}

class SessionHandle {
  process: ChildProcess;
  cwd: string;
  startedAt: number;

  constructor(o: SessionHandleOptions) {
    this.process = o.process;
    this.cwd = o.cwd || "";
    this.startedAt = o.startedAt || Date.now();
  }
}

function spawnSession(opts: SpawnSessionOptions): Promise<SessionHandle> {
  const proc = spawn(opts.command, { shell: true, cwd: opts.cwd || process.cwd(), stdio: "pipe" });
  return Promise.resolve(new SessionHandle({ process: proc, cwd: opts.cwd, startedAt: Date.now() }));
}

export { SessionHandle, spawnSession };
