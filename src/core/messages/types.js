"use strict";

/**
 * Standardized Message Types — ported from OpenHarness engine/messages.py
 *
 * Provides typed message models (StandardMessage, ContentBlock discriminated unions)
 * and stream event types. Eliminates the "plain JS object" gap vs OpenHarness's
 * Pydantic-based ConversationMessage + ContentBlock union.
 */

// === Content Block Types ===

const ContentBlockType = {
  TEXT: "text",
  IMAGE: "image",
  TOOL_USE: "tool_use",
  TOOL_RESULT: "tool_result",
  THINKING: "thinking",
};

/**
 * TextBlock — plain text content
 * @typedef {Object} TextBlock
 * @property {"text"} type
 * @property {string} text
 */
function createTextBlock(text) {
  return { type: ContentBlockType.TEXT, text: String(text) };
}

/**
 * ImageBlock — base64-encoded image
 * @typedef {Object} ImageBlock
 * @property {"image"} type
 * @property {string} source_type — "base64"
 * @property {string} media_type — e.g. "image/png"
 * @property {string} data — base64-encoded data
 */
function createImageBlock(base64Data, mediaType = "image/png") {
  return {
    type: ContentBlockType.IMAGE,
    source_type: "base64",
    media_type: mediaType,
    data: base64Data,
  };
}

/**
 * ToolUseBlock — LLM requests a tool call
 * @typedef {Object} ToolUseBlock
 * @property {"tool_use"} type
 * @property {string} id — unique tool_use ID
 * @property {string} name — tool name
 * @property {Object} input — tool arguments
 */
function createToolUseBlock(id, name, input = {}) {
  return { type: ContentBlockType.TOOL_USE, id, name, input };
}

/**
 * ToolResultBlock — result from a tool execution
 * @typedef {Object} ToolResultBlock
 * @property {"tool_result"} type
 * @property {string} tool_use_id — matches ToolUseBlock.id
 * @property {string} content — result text
 * @property {boolean} [is_error] — whether the tool call failed
 */
function createToolResultBlock(toolUseId, content, isError = false) {
  return {
    type: ContentBlockType.TOOL_RESULT,
    tool_use_id: toolUseId,
    content: String(content),
    is_error: isError,
  };
}

/**
 * ThinkingBlock — reasoning/thinking content (Claude extended thinking)
 * @typedef {Object} ThinkingBlock
 * @property {"thinking"} type
 * @property {string} thinking — reasoning content
 */
function createThinkingBlock(thinking) {
  return { type: ContentBlockType.THINKING, thinking: String(thinking) };
}

// === Standard Message ===

const MessageRole = {
  USER: "user",
  ASSISTANT: "assistant",
  SYSTEM: "system",
};

/**
 * StandardMessage — typed conversation message
 *
 * Mirrors OpenHarness's ConversationMessage(BaseModel):
 * - role: "user" | "assistant"
 * - content: list[ContentBlock] (discriminated by type)
 *
 * @typedef {Object} StandardMessage
 * @property {"user"|"assistant"} role
 * @property {Array<TextBlock|ImageBlock|ToolUseBlock|ToolResultBlock|ThinkingBlock>} content
 * @property {Object} [metadata] — optional metadata (model, usage, timestamp)
 */
class StandardMessage {
  constructor(o = {}) {
    this.role = o.role || MessageRole.USER;
    this.content = o.content || [];
    this.metadata = o.metadata || {};
  }

  /** Get all text content concatenated */
  get text() {
    return this.content
      .filter((c) => c.type === ContentBlockType.TEXT)
      .map((c) => c.text)
      .join("");
  }

  /** Get all tool_use blocks */
  get toolUses() {
    return this.content.filter((c) => c.type === ContentBlockType.TOOL_USE);
  }

  /** Get all tool_result blocks */
  get toolResults() {
    return this.content.filter((c) => c.type === ContentBlockType.TOOL_RESULT);
  }

  /** Get all image blocks */
  get images() {
    return this.content.filter((c) => c.type === ContentBlockType.IMAGE);
  }

  /** Check if this message contains any tool calls */
  get hasToolUses() {
    return this.content.some((c) => c.type === ContentBlockType.TOOL_USE);
  }

  /** Quick factory: user message with text */
  static user(text) {
    return new StandardMessage({
      role: MessageRole.USER,
      content: [createTextBlock(text)],
    });
  }

  /** Quick factory: assistant message with text */
  static assistant(text) {
    return new StandardMessage({
      role: MessageRole.ASSISTANT,
      content: [createTextBlock(text)],
    });
  }

  /** Quick factory: tool result message */
  static toolResult(toolUseId, result, isError = false) {
    return new StandardMessage({
      role: MessageRole.USER,
      content: [createToolResultBlock(toolUseId, result, isError)],
    });
  }

  /**
   * Convert to Anthropic API format
   * @returns {Object} { role, content }
   */
  toAnthropicFormat() {
    const content = this.content.map((block) => {
      switch (block.type) {
        case ContentBlockType.TEXT:
          return { type: "text", text: block.text };
        case ContentBlockType.TOOL_USE:
          return { type: "tool_use", id: block.id, name: block.name, input: block.input };
        case ContentBlockType.TOOL_RESULT:
          return {
            type: "tool_result",
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
          };
        case ContentBlockType.IMAGE:
          return {
            type: "image",
            source: { type: block.source_type, media_type: block.media_type, data: block.data },
          };
        default:
          return { type: "text", text: JSON.stringify(block) };
      }
    });
    return { role: this.role, content };
  }

  /**
   * Convert to OpenAI API format
   * Returns a plain { role, content } object. Tool calls/results are handled
   * separately by the OpenAI adapter (tool_calls / tool role).
   */
  toOpenAIFormat() {
    let textContent = "";
    const toolCalls = [];

    for (const block of this.content) {
      switch (block.type) {
        case ContentBlockType.TEXT:
          textContent += block.text;
          break;
        case ContentBlockType.TOOL_USE:
          toolCalls.push({
            id: block.id,
            type: "function",
            function: { name: block.name, arguments: JSON.stringify(block.input) },
          });
          break;
        // tool_result blocks are sent as separate role="tool" messages by the adapter
        default:
          break;
      }
    }

    const result = { role: this.role };
    if (textContent) result.content = textContent;
    if (toolCalls.length > 0) result.tool_calls = toolCalls;
    return result;
  }

  /**
   * Convert to a compact serializable form for persistence
   */
  toJSON() {
    return {
      role: this.role,
      content: this.content,
      metadata: this.metadata,
    };
  }

  /**
   * Restore from serialized JSON
   */
  static fromJSON(json) {
    return new StandardMessage(json);
  }

  /**
   * Estimate token count for this message
   * Uses character-based heuristic with CJK awareness (~1.5 chars/token for Latin, ~0.6 for CJK)
   */
  estimateTokens() {
    let count = 0;
    for (const block of this.content) {
      if (block.type === ContentBlockType.TEXT) {
        count += estimateTextTokens(block.text);
      } else if (block.type === ContentBlockType.TOOL_USE) {
        count += 20; // overhead for tool call structure
        count += estimateTextTokens(JSON.stringify(block.input));
      } else if (block.type === ContentBlockType.TOOL_RESULT) {
        count += estimateTextTokens(block.content);
      } else if (block.type === ContentBlockType.IMAGE) {
        count += 200; // approximate image token cost
      }
    }
    return count;
  }
}

// === Stream Event Types ===

const StreamEventType = {
  // Text streaming
  TEXT_DELTA: "text_delta",
  THINKING_DELTA: "thinking_delta",

  // Tool lifecycle
  TOOL_USE_START: "tool_use_start",
  TOOL_USE_DELTA: "tool_use_delta",
  TOOL_USE_COMPLETE: "tool_use_complete",
  TOOL_EXECUTION_STARTED: "tool_execution_started",
  TOOL_EXECUTION_COMPLETED: "tool_execution_completed",

  // Message lifecycle
  MESSAGE_START: "message_start",
  MESSAGE_COMPLETE: "message_complete",
  ASSISTANT_TURN_COMPLETE: "assistant_turn_complete",

  // System events
  USAGE: "usage",
  ERROR: "error",
  RETRY: "retry",
  COMPACT_PROGRESS: "compact_progress",
  STATUS: "status",
};

/**
 * Create a standardized stream event
 */
function createStreamEvent(type, data = {}) {
  return { type, ...data, timestamp: data.timestamp || Date.now() };
}

// === Helper: Token Estimation ===

/**
 * Estimate token count for a text string.
 * Uses CJK-aware heuristic: CJK characters ~0.6 tokens/char, Latin ~0.25 tokens/char.
 */
function estimateTextTokens(text) {
  if (!text) return 0;
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (
      (code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified
      (code >= 0x3400 && code <= 0x4DBF) || // CJK Extension A
      (code >= 0x3000 && code <= 0x303F) || // CJK Symbols
      (code >= 0xFF00 && code <= 0xFFEF) || // Fullwidth forms
      (code >= 0x20000 && code <= 0x2A6DF)   // CJK Extension B
    ) {
      tokens += 0.6;
    } else if (code > 127) {
      tokens += 0.4; // Other non-ASCII
    } else {
      tokens += 0.25; // ASCII/Latin
    }
  }
  return Math.ceil(tokens) + 4; // +4 for message overhead
}

/**
 * Estimate total tokens for a list of messages
 */
function estimateMessageTokens(messages) {
  return messages.reduce((sum, m) => {
    if (m instanceof StandardMessage) return sum + m.estimateTokens();
    if (typeof m.estimateTokens === "function") return sum + m.estimateTokens();
    return sum + estimateTextTokens(JSON.stringify(m));
  }, 0);
}

// === Helper: Sanitize conversation ===

/**
 * Sanitize a conversation by removing empty/duplicate messages
 * and ensuring tool_use/tool_result pairing integrity.
 */
function sanitizeConversation(messages) {
  const result = [];
  const pendingToolUseIds = new Set();

  for (const msg of messages) {
    const m = msg instanceof StandardMessage ? msg : new StandardMessage({ role: msg.role, content: msg.content || [] });

    // Skip empty messages
    if (!m.content || m.content.length === 0) continue;

    // Track tool_use IDs for pairing validation
    for (const block of m.content) {
      if (block.type === ContentBlockType.TOOL_USE) {
        pendingToolUseIds.add(block.id);
      }
    }

    // Validate tool_result has a matching tool_use
    const validContent = m.content.filter((block) => {
      if (block.type === ContentBlockType.TOOL_RESULT) {
        if (!pendingToolUseIds.has(block.tool_use_id)) return false;
        pendingToolUseIds.delete(block.tool_use_id);
      }
      return true;
    });

    if (validContent.length > 0) {
      result.push(new StandardMessage({ role: m.role, content: validContent, metadata: m.metadata }));
    }
  }

  return result;
}

// === Helper: Create image from file path ===

const fs = require("fs");
const path = require("path");

/**
 * Create an ImageBlock from a local file path.
 * Reads the file and base64-encodes it.
 */
function createImageFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mediaTypes = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };
  const mediaType = mediaTypes[ext] || "image/png";
  const data = fs.readFileSync(filePath).toString("base64");
  return createImageBlock(data, mediaType);
}

// === Message Conversion Helpers ===

/**
 * Convert a list of StandardMessages to Anthropic API format
 */
function toAnthropicMessages(messages) {
  return messages.map((m) =>
    m instanceof StandardMessage ? m.toAnthropicFormat() : { role: m.role, content: m.content }
  );
}

/**
 * Convert a list of StandardMessages to OpenAI API format
 */
function toOpenAIMessages(messages, systemPrompt = null) {
  const result = [];
  if (systemPrompt) {
    result.push({ role: "system", content: String(systemPrompt) });
  }
  for (const m of messages) {
    const standard = m instanceof StandardMessage ? m : new StandardMessage({ role: m.role, content: m.content });
    const formatted = standard.toOpenAIFormat();
    if (formatted.content || formatted.tool_calls) {
      result.push(formatted);
    }
  }
  return result;
}

// === Exports ===

module.exports = {
  // Types
  ContentBlockType,
  MessageRole,
  StreamEventType,

  // Classes
  StandardMessage,

  // Block factories
  createTextBlock,
  createImageBlock,
  createToolUseBlock,
  createToolResultBlock,
  createThinkingBlock,

  // Stream events
  createStreamEvent,

  // Helpers
  estimateTextTokens,
  estimateMessageTokens,
  sanitizeConversation,
  createImageFromPath,
  toAnthropicMessages,
  toOpenAIMessages,
};
