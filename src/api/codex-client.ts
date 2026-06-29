interface CodexClientOptions {
  apiKey?: string;
  model?: string;
}

interface StreamRequest {
  model?: string;
  [key: string]: unknown;
}

class CodexClient {
  apiKey: string;
  model: string;

  constructor(o: CodexClientOptions = {}) {
    this.apiKey = o.apiKey || "";
    this.model = o.model || "codex";
  }

  async *stream(_req: StreamRequest): AsyncGenerator<{ type: string; message: string }> {
    yield { type: "error", message: "Codex client requires GitHub Copilot subscription" };
  }
}

export { CodexClient };
