interface CopilotClientOptions {
  apiKey?: string;
  model?: string;
}

interface StreamRequest {
  model?: string;
  [key: string]: unknown;
}

class CopilotClient {
  apiKey: string;
  model: string;

  constructor(o: CopilotClientOptions = {}) {
    this.apiKey = o.apiKey || "";
    this.model = o.model || "copilot";
  }

  async *stream(_req: StreamRequest): AsyncGenerator<{ type: string; message: string }> {
    yield { type: "error", message: "Copilot client requires GitHub Copilot subscription and OAuth setup" };
  }
}

export { CopilotClient };
