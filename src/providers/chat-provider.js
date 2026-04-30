"use strict";

class ChatProvider {
  constructor(options = {}) {
    this.name = options.name || "provider";
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl;
  }

  async chat(_request) {
    throw new Error(`${this.name} does not implement chat()`);
  }

  stream(request) {
    return streamFromChat(this, request);
  }

  async listModels() {
    return this.model ? [{ id: this.model, name: this.model }] : [];
  }

  setModel(model) {
    const normalizedModel = String(model || "").trim();

    if (!normalizedModel) {
      throw new Error("Model is required");
    }

    this.model = normalizedModel;
    return this.model;
  }

  setApiUrl(apiUrl) {
    this.apiUrl = normalizeOptionalString(apiUrl);
    return this.apiUrl;
  }

  setApiKey(apiKey) {
    const normalizedApiKey = normalizeOptionalString(apiKey);

    if (!normalizedApiKey) {
      throw new Error("API key is required");
    }

    this.apiKey = normalizedApiKey;
    return this.apiKey;
  }
}

async function* streamFromChat(provider, request) {
  const response = await provider.chat(request);

  if (response && typeof response[Symbol.asyncIterator] === "function") {
    yield* response;
    return;
  }

  if (response && typeof response[Symbol.iterator] === "function" && typeof response !== "string") {
    for (const chunk of response) {
      yield chunk;
    }
    return;
  }

  yield createTextChunk(response?.content ?? response ?? "");
}

function createTextChunk(text) {
  return {
    type: "text",
    delta: String(text),
  };
}

function normalizeOptionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || undefined;
}

module.exports = {
  ChatProvider,
  createTextChunk,
  streamFromChat,
};
