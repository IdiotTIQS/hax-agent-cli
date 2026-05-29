"use strict";
class CodexClient { constructor(o={}) { this.apiKey=o.apiKey||""; this.model=o.model||"codex"; }
  async *stream(req) { yield { type:"error", message:"Codex client requires GitHub Copilot subscription" }; }
}
module.exports = { CodexClient };
