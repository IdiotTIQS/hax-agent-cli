"use strict";

const FORMAT_ANTHROPIC = "anthropic";
const FORMAT_OPENAI = "openai";
const FORMAT_GOOGLE = "google";
const FORMAT_STANDARD = "standard";

const ALL_FORMATS = [FORMAT_ANTHROPIC, FORMAT_OPENAI, FORMAT_GOOGLE, FORMAT_STANDARD];

const CHUNK_TYPE_TEXT_DELTA = "text_delta";
const CHUNK_TYPE_TOOL_CALL = "tool_call";
const CHUNK_TYPE_THINKING = "thinking";
const CHUNK_TYPE_ERROR = "error";
const CHUNK_TYPE_METADATA = "metadata";

const ALL_CHUNK_TYPES = [
  CHUNK_TYPE_TEXT_DELTA,
  CHUNK_TYPE_TOOL_CALL,
  CHUNK_TYPE_THINKING,
  CHUNK_TYPE_ERROR,
  CHUNK_TYPE_METADATA,
];

/**
 * Maps each source->target format combination to a transformation function.
 * Each key is "source->target".
 */
const FORMAT_ADAPTERS = {
  "anthropic->standard": adaptAnthropicToStandard,
  "openai->standard": adaptOpenAIToStandard,
  "google->standard": adaptGoogleToStandard,
  "standard->standard": identityAdapter,
};

class StreamAdapter {
  constructor(options = {}) {
    this._defaultTarget = options.targetFormat || FORMAT_STANDARD;
    this._passthroughUnknown =
      options.passthroughUnknown !== false;
  }

  /**
   * Adapts a provider stream to the target format.
   * Returns an async generator yielding normalized chunks.
   *
   * @param {AsyncIterable} providerStream - the raw provider stream
   * @param {string} [targetFormat] - target format name ("anthropic"|"openai"|"google"|"standard")
   * @returns {AsyncIterable}
   */
  async *adapt(providerStream, targetFormat) {
    if (providerStream == null) {
      throw new Error("Provider stream is required");
    }

    const target = normalizeFormat(targetFormat || this._defaultTarget);

    for await (const chunk of providerStream) {
      const normalized = this.normalize(chunk, target);

      if (normalized === null) {
        continue;
      }

      if (target === FORMAT_STANDARD) {
        yield normalized;
      } else {
        yield denormalize(normalized, target);
      }
    }
  }

  /**
   * Normalizes a single chunk to the standard format.
   *
   * @param {*} chunk - raw chunk from any provider
   * @param {string} [targetFormat] - for format-specific behavior
   * @returns {object|null} normalized chunk, or null if the chunk should be skipped
   */
  normalize(chunk, targetFormat) {
    if (chunk == null) return null;

    const format = this.detectFormat(chunk);
    const target = normalizeFormat(targetFormat || this._defaultTarget);

    if (format === target) {
      return chunk;
    }

    const adapterKey = `${format}->${target}`;
    const adapterFn = FORMAT_ADAPTERS[adapterKey];

    if (adapterFn) {
      return adapterFn(chunk);
    }

    if (this._passthroughUnknown) {
      return normalizeChunkPassthrough(chunk);
    }

    return null;
  }

  /**
   * Auto-detects the format of a raw chunk.
   *
   * @param {*} chunk
   * @returns {string} format name
   */
  detectFormat(chunk) {
    if (chunk == null) return FORMAT_STANDARD;

    if (typeof chunk !== "object") {
      return FORMAT_STANDARD;
    }

    // Anthropic SSE events: { type: "content_block_delta" | "content_block_start" | ... }
    if (isAnthropicChunk(chunk)) {
      return FORMAT_ANTHROPIC;
    }

    // OpenAI SSE chunks: { choices: [...] }
    if (isOpenAIChunk(chunk)) {
      return FORMAT_OPENAI;
    }

    // Google chunks: { candidates: [...] }
    if (isGoogleChunk(chunk)) {
      return FORMAT_GOOGLE;
    }

    // Already standard: { type: "text_delta" | "tool_call" | ... }
    if (isStandardChunk(chunk)) {
      return FORMAT_STANDARD;
    }

    return FORMAT_STANDARD;
  }
}

// --- Format detection helpers ---

function isAnthropicChunk(chunk) {
  if (chunk.type === "content_block_delta") return true;
  if (chunk.type === "content_block_start") return true;
  if (chunk.type === "content_block_stop") return true;
  if (chunk.type === "message_start" || chunk.type === "message_delta" || chunk.type === "message_stop") return true;
  if (chunk.type === "ping") return true;
  if (chunk.type === "error" && chunk.error && typeof chunk.error.type === "string") return true;
  return false;
}

function isOpenAIChunk(chunk) {
  if (chunk.object === "chat.completion.chunk" || chunk.object === "chat.completion") return true;
  if (Array.isArray(chunk.choices)) return true;
  return false;
}

function isGoogleChunk(chunk) {
  if (Array.isArray(chunk.candidates)) return true;
  if (chunk.usageMetadata || chunk.modelVersion) return true;
  return false;
}

function isStandardChunk(chunk) {
  if (chunk.type && ALL_CHUNK_TYPES.includes(chunk.type)) return true;
  return false;
}

// --- Anthropic -> Standard ---

function adaptAnthropicToStandard(chunk) {
  const raw = chunk;

  // content_block_delta with text_delta
  if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
    return {
      type: CHUNK_TYPE_TEXT_DELTA,
      text: chunk.delta.text,
      index: chunk.index,
      raw,
    };
  }

  // content_block_delta with input_json_delta (tool call)
  if (chunk.type === "content_block_delta" && chunk.delta?.type === "input_json_delta") {
    return {
      type: CHUNK_TYPE_TOOL_CALL,
      partialJson: chunk.delta.partial_json,
      index: chunk.index,
      raw,
    };
  }

  // content_block_start with tool_use
  if (chunk.type === "content_block_start" && chunk.content_block?.type === "tool_use") {
    const block = chunk.content_block;
    return {
      type: CHUNK_TYPE_TOOL_CALL,
      name: block.name,
      id: block.id,
      input: block.input || {},
      index: chunk.index,
      raw,
    };
  }

  // content_block_start with text
  if (chunk.type === "content_block_start" && chunk.content_block?.type === "text") {
    const block = chunk.content_block;
    return {
      type: CHUNK_TYPE_TEXT_DELTA,
      text: block.text || "",
      index: chunk.index,
      raw,
    };
  }

  // thinking events
  if (chunk.type === "content_block_start" && chunk.content_block?.type === "thinking") {
    return {
      type: CHUNK_TYPE_THINKING,
      summary: chunk.content_block.thinking || "Thinking...",
      raw,
    };
  }

  if (chunk.type === "content_block_delta" && chunk.delta?.type === "thinking_delta") {
    return {
      type: CHUNK_TYPE_THINKING,
      summary: chunk.delta.thinking || "Thinking...",
      raw,
    };
  }

  // error events
  if (chunk.type === "error") {
    return {
      type: CHUNK_TYPE_ERROR,
      message: chunk.error?.message || String(chunk.error),
      code: chunk.error?.type || "UNKNOWN",
      raw,
    };
  }

  // message_start / metadata
  if (chunk.type === "message_start") {
    return {
      type: CHUNK_TYPE_METADATA,
      data: {
        message: chunk.message,
        model: chunk.message?.model,
        usage: chunk.message?.usage,
      },
      raw,
    };
  }

  if (chunk.type === "message_delta") {
    return {
      type: CHUNK_TYPE_METADATA,
      data: {
        usage: chunk.usage,
        stopReason: chunk.delta?.stop_reason,
        stopSequence: chunk.delta?.stop_sequence,
      },
      raw,
    };
  }

  return {
    type: CHUNK_TYPE_METADATA,
    data: {},
    raw,
  };
}

// --- OpenAI -> Standard ---

function adaptOpenAIToStandard(chunk) {
  const raw = chunk;

  if (!Array.isArray(chunk.choices)) {
    return {
      type: CHUNK_TYPE_METADATA,
      data: { usage: chunk.usage, id: chunk.id, model: chunk.model },
      raw,
    };
  }

  const choice = chunk.choices[0];
  if (!choice) {
    return { type: CHUNK_TYPE_METADATA, data: {}, raw };
  }

  const delta = choice.delta;

  // Text content
  if (delta?.content) {
    return {
      type: CHUNK_TYPE_TEXT_DELTA,
      text: delta.content,
      index: choice.index,
      finishReason: choice.finish_reason,
      raw,
    };
  }

  // Tool calls
  if (delta?.tool_calls) {
    const tc = delta.tool_calls[0];
    return {
      type: CHUNK_TYPE_TOOL_CALL,
      name: tc?.function?.name,
      id: tc?.id,
      arguments: tc?.function?.arguments,
      index: tc?.index,
      raw,
    };
  }

  // Thinking / reasoning tokens
  if (delta?.reasoning_content || delta?.reasoning) {
    return {
      type: CHUNK_TYPE_THINKING,
      summary: delta.reasoning_content || delta.reasoning,
      raw,
    };
  }

  // Finish
  if (choice.finish_reason) {
    return {
      type: CHUNK_TYPE_METADATA,
      data: {
        finishReason: choice.finish_reason,
        usage: chunk.usage,
      },
      raw,
    };
  }

  return {
    type: CHUNK_TYPE_METADATA,
    data: { usage: chunk.usage, id: chunk.id, model: chunk.model },
    raw,
  };
}

// --- Google -> Standard ---

function adaptGoogleToStandard(chunk) {
  const raw = chunk;

  if (!Array.isArray(chunk.candidates)) {
    if (chunk.usageMetadata) {
      return {
        type: CHUNK_TYPE_METADATA,
        data: {
          usage: chunk.usageMetadata,
          model: chunk.modelVersion,
        },
        raw,
      };
    }
    return { type: CHUNK_TYPE_METADATA, data: {}, raw };
  }

  const candidate = chunk.candidates[0];
  if (!candidate) {
    return { type: CHUNK_TYPE_METADATA, data: {}, raw };
  }

  const content = candidate.content;
  if (!content) {
    // Safety / finish reason
    if (candidate.finishReason) {
      return {
        type: CHUNK_TYPE_METADATA,
        data: {
          finishReason: candidate.finishReason,
          safetyRatings: candidate.safetyRatings,
        },
        raw,
      };
    }
    return { type: CHUNK_TYPE_METADATA, data: {}, raw };
  }

  const parts = content.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return { type: CHUNK_TYPE_METADATA, data: {}, raw };
  }

  const firstPart = parts[0];

  // Thought (thinking) — check before text since thought parts may have empty text
  if (firstPart.thought === true || (typeof firstPart.text === "string" && firstPart.text === "" && firstPart.thought !== false)) {
    return {
      type: CHUNK_TYPE_THINKING,
      summary: "Thinking...",
      raw,
    };
  }

  // Text
  if (typeof firstPart.text === "string") {
    const fullText = parts.map((p) => p.text || "").join("");
    return {
      type: CHUNK_TYPE_TEXT_DELTA,
      text: fullText,
      role: content.role,
      finishReason: candidate.finishReason,
      raw,
    };
  }

  // Function call
  if (firstPart.functionCall) {
    const fc = firstPart.functionCall;
    return {
      type: CHUNK_TYPE_TOOL_CALL,
      name: fc.name,
      input: fc.args || {},
      raw,
    };
  }

  return {
    type: CHUNK_TYPE_METADATA,
    data: {},
    raw,
  };
}

// --- Denormalize: standard -> target format ---

function denormalize(normalized, targetFormat) {
  switch (targetFormat) {
    case FORMAT_ANTHROPIC:
      return denormalizeToAnthropic(normalized);
    case FORMAT_OPENAI:
      return denormalizeToOpenAI(normalized);
    case FORMAT_GOOGLE:
      return denormalizeToGoogle(normalized);
    default:
      return normalized;
  }
}

function denormalizeToAnthropic(normalized) {
  const n = normalized;
  switch (n.type) {
    case CHUNK_TYPE_TEXT_DELTA:
      return {
        type: "content_block_delta",
        index: n.index ?? 0,
        delta: { type: "text_delta", text: n.text },
      };
    case CHUNK_TYPE_TOOL_CALL:
      return {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          name: n.name,
          id: n.id || "",
          input: n.input || {},
        },
      };
    case CHUNK_TYPE_THINKING:
      return {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: n.summary },
      };
    case CHUNK_TYPE_ERROR:
      return {
        type: "error",
        error: { type: n.code || "UNKNOWN", message: n.message },
      };
    case CHUNK_TYPE_METADATA:
      return { type: "message_start", message: n.data || {} };
    default:
      return n;
  }
}

function denormalizeToOpenAI(normalized) {
  const n = normalized;
  switch (n.type) {
    case CHUNK_TYPE_TEXT_DELTA:
      return {
        id: "",
        object: "chat.completion.chunk",
        choices: [{ index: n.index ?? 0, delta: { content: n.text } }],
      };
    case CHUNK_TYPE_TOOL_CALL:
      return {
        id: "",
        object: "chat.completion.chunk",
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              id: n.id || "",
              index: 0,
              function: { name: n.name, arguments: n.arguments || JSON.stringify(n.input || {}) },
            }],
          },
        }],
      };
    case CHUNK_TYPE_THINKING:
      return {
        id: "",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { reasoning_content: n.summary } }],
      };
    case CHUNK_TYPE_ERROR:
      return {
        id: "",
        object: "chat.completion.chunk",
        choices: [{ index: 0, finish_reason: "error", delta: {} }],
        error: { message: n.message, code: n.code },
      };
    case CHUNK_TYPE_METADATA:
      return {
        id: n.data?.id || "",
        object: "chat.completion.chunk",
        choices: [{ index: 0, finish_reason: n.data?.finishReason || null, delta: {} }],
        usage: n.data?.usage,
        model: n.data?.model,
      };
    default:
      return n;
  }
}

function denormalizeToGoogle(normalized) {
  const n = normalized;
  switch (n.type) {
    case CHUNK_TYPE_TEXT_DELTA:
      return {
        candidates: [{
          content: { role: n.role || "model", parts: [{ text: n.text }] },
          finishReason: n.finishReason,
        }],
      };
    case CHUNK_TYPE_TOOL_CALL:
      return {
        candidates: [{
          content: {
            role: "model",
            parts: [{
              functionCall: { name: n.name, args: n.input || {} },
            }],
          },
        }],
      };
    case CHUNK_TYPE_THINKING:
      return {
        candidates: [{
          content: { role: "model", parts: [{ text: "", thought: true }] },
        }],
      };
    case CHUNK_TYPE_ERROR:
      return {
        candidates: [{
          content: { role: "model", parts: [] },
          finishReason: "SAFETY",
          safetyRatings: [],
        }],
      };
    case CHUNK_TYPE_METADATA:
      return {
        candidates: [{ content: { role: "model", parts: [] } }],
        usageMetadata: n.data?.usage,
        modelVersion: n.data?.model,
      };
    default:
      return n;
  }
}

// --- Identity / passthrough ---

function identityAdapter(chunk) {
  return chunk;
}

function normalizeChunkPassthrough(chunk) {
  if (!chunk.type || !ALL_CHUNK_TYPES.includes(chunk.type)) {
    return {
      type: CHUNK_TYPE_TEXT_DELTA,
      text:
        typeof chunk === "string"
          ? chunk
          : chunk.text || chunk.delta || chunk.content || "",
      raw: chunk,
    };
  }
  return chunk;
}

function normalizeFormat(format) {
  const f = String(format || "").toLowerCase();
  if (ALL_FORMATS.includes(f)) return f;
  return FORMAT_STANDARD;
}

// --- Convenience: adapt a full stream ---

function adaptStream(providerStream, options = {}) {
  const adapter = new StreamAdapter(options);
  return adapter.adapt(providerStream, options.targetFormat);
}

module.exports = {
  StreamAdapter,
  adaptStream,
  FORMAT_ANTHROPIC,
  FORMAT_OPENAI,
  FORMAT_GOOGLE,
  FORMAT_STANDARD,
  CHUNK_TYPE_TEXT_DELTA,
  CHUNK_TYPE_TOOL_CALL,
  CHUNK_TYPE_THINKING,
  CHUNK_TYPE_ERROR,
  CHUNK_TYPE_METADATA,
  ALL_FORMATS,
  ALL_CHUNK_TYPES,
};
