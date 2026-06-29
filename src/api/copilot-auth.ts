interface CopilotAuthOptions {
  token?: string;
}

class CopilotAuth {
  private _token: string | null;
  private _deviceCode: string | null;

  constructor(o: CopilotAuthOptions = {}) {
    this._token = o.token || null;
    this._deviceCode = null;
  }

  async authenticate(): Promise<{ ok: boolean; error: string }> {
    return { ok: false, error: "GitHub Copilot OAuth requires interactive browser authentication" };
  }

  get isAuthenticated(): boolean {
    return !!this._token;
  }
}

export { CopilotAuth };
