/** Bridge configuration types. Ported from OpenHarness bridge/types.py */
const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

class WorkData {
  constructor(o = {}) { this.type = o.type || "session"; this.id = o.id || ""; }
}

class WorkSecret {
  constructor(o = {}) { this.version = o.version || 1; this.sessionIngressToken = o.sessionIngressToken || ""; this.apiBaseUrl = o.apiBaseUrl || ""; }
}

class BridgeConfig {
  constructor(o = {}) { this.dir = o.dir || ""; this.machineName = o.machineName || ""; this.maxSessions = o.maxSessions || 1; this.verbose = !!o.verbose; this.sessionTimeoutMs = o.sessionTimeoutMs || DEFAULT_SESSION_TIMEOUT_MS; }
}

export { DEFAULT_SESSION_TIMEOUT_MS, WorkData, WorkSecret, BridgeConfig };
