class CopilotClient { constructor(o={}) { this.apiKey=o.apiKey||""; this.model=o.model||"copilot"; }
  async *stream(req) { yield { type:"error", message:"Copilot client requires GitHub Copilot subscription and OAuth setup" }; }
}
export { CopilotClient };
