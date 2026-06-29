/** Bridge configuration types. Ported from OpenHarness bridge/types.py */

const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

interface WorkDataOptions {
  type?: string;
  id?: string;
}

class WorkData {
  type: string;
  id: string;

  constructor(o: WorkDataOptions = {}) {
    this.type = o.type || "session";
    this.id = o.id || "";
  }
}

interface WorkSecretOptions {
  version?: number;
  sessionIngressToken?: string;
  apiBaseUrl?: string;
}

class WorkSecret {
  version: number;
  sessionIngressToken: string;
  apiBaseUrl: string;

  constructor(o: WorkSecretOptions = {}) {
    this.version = o.version || 1;
    this.sessionIngressToken = o.sessionIngressToken || "";
    this.apiBaseUrl = o.apiBaseUrl || "";
  }
}

interface BridgeConfigOptions {
  dir?: string;
  machineName?: string;
  maxSessions?: number;
  verbose?: boolean;
  sessionTimeoutMs?: number;
}

class BridgeConfig {
  dir: string;
  machineName: string;
  maxSessions: number;
  verbose: boolean;
  sessionTimeoutMs: number;

  constructor(o: BridgeConfigOptions = {}) {
    this.dir = o.dir || "";
    this.machineName = o.machineName || "";
    this.maxSessions = o.maxSessions || 1;
    this.verbose = !!o.verbose;
    this.sessionTimeoutMs = o.sessionTimeoutMs || DEFAULT_SESSION_TIMEOUT_MS;
  }
}

export { DEFAULT_SESSION_TIMEOUT_MS, WorkData, WorkSecret, BridgeConfig };
