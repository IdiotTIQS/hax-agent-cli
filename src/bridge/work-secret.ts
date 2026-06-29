class WorkSecret {
  version: number;
  sessionIngressToken: string;
  apiBaseUrl: string;

  constructor(o: { version?: number; sessionIngressToken?: string; apiBaseUrl?: string }) {
    this.version = o.version || 1;
    this.sessionIngressToken = o.sessionIngressToken || "";
    this.apiBaseUrl = o.apiBaseUrl || "";
  }

  static decode(encoded: string): WorkSecret | null {
    try {
      const data = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8")) as {
        version?: number;
        session_ingress_token?: string;
        api_base_url?: string;
      };
      return new WorkSecret({
        version: data.version,
        sessionIngressToken: data.session_ingress_token,
        apiBaseUrl: data.api_base_url,
      });
    } catch (_) { return null; }
  }

  encode(): string {
    return Buffer.from(JSON.stringify({
      version: this.version,
      session_ingress_token: this.sessionIngressToken,
      api_base_url: this.apiBaseUrl,
    })).toString("base64");
  }
}

export { WorkSecret };
