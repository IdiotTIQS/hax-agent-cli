"use strict";

const { ChatProvider, createTextChunk } = require("./chat-provider");
const { normalizeMessages } = require("./messages");

class MockProvider extends ChatProvider {
  constructor(options = {}) {
    super({ name: options.name || "mock", model: options.model || "mock-local" });
    this.delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 0;
    this.response = options.response;
    this.toolTrace = options.toolTrace === true;
  }

  async chat(request = {}) {
    const messages = normalizeMessages(request.messages || request.prompt || "");
    const content = resolveMockContent(this.response, messages);

    return {
      id: `mock-${Date.now()}`,
      provider: this.name,
      model: request.model || this.model,
      role: "assistant",
      content,
      usage: {
        inputTokens: estimateTokens(messages.map((message) => message.content).join("\n")),
        outputTokens: estimateTokens(content),
      },
      raw: null,
    };
  }

  async *stream(request = {}) {
    const response = await this.chat(request);
    const chunks = response.content.length > 0 ? response.content.split(/(\s+)/).filter(Boolean) : [""];

    if (this.toolTrace) {
      yield {
        type: "thinking",
        summary: "Thinking...",
      };
      yield {
        type: "tool_start",
        name: "file.read",
        input: { path: "README.md" },
        displayInput: "file: README.md",
        attempt: 1,
        turn: 1,
      };
      yield {
        type: "tool_result",
        name: "file.read",
        isError: false,
        durationMs: 3,
        attempt: 1,
        turn: 1,
      };
      yield {
        type: "tool_start",
        name: "file.write",
        input: { path: "README.md", content: "# Test\n" },
        displayInput: "file: README.md, chars: 7",
        attempt: 1,
        turn: 1,
      };
      yield {
        type: "tool_result",
        name: "file.write",
        isError: false,
        durationMs: 4,
        data: {
          path: "README.md",
          bytes: 7,
          change: {
            operation: "update",
            added: 1,
            removed: 0,
            changed: 1,
            preview: [{ line: 1, marker: "+", text: "# Test" }],
          },
        },
        attempt: 1,
        turn: 1,
      };
    }

    for (const chunk of chunks) {
      if (this.delayMs > 0) {
        await delay(this.delayMs);
      }

      yield createTextChunk(chunk);
    }

    yield {
      type: "usage",
      inputTokens: 1200,
      outputTokens: chunks.length * 50,
    };
  }
}

function resolveMockContent(response, messages) {
  if (typeof response === "function") {
    return String(response(messages));
  }

  if (typeof response === "string") {
    return response.replace(/{{count}}/g, String(messages.length));
  }

  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const prompt = lastUserMessage ? lastUserMessage.content : "";

  return prompt.length > 0
    ? `I’m in local mock mode right now, so I can’t answer with a real model yet. You said: ${prompt}`
    : "I’m in local mock mode right now. Set an API key to chat with a real model.";
}

function estimateTokens(text) {
  const trimmedText = String(text || "").trim();
  return trimmedText.length === 0 ? 0 : Math.ceil(trimmedText.length / 4);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  MockProvider,
};
