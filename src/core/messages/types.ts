/**
 * Standardized Message Types - ported from OpenHarness engine/messages.py
 *
 * Provides typed message models (StandardMessage, ContentBlock discriminated unions)
 * and stream event types. Eliminates the "plain JS object" gap vs OpenHarness's
 * Pydantic-based ConversationMessage + ContentBlock union.
 */

import fs from "fs";
import path from "path";

// === Content Block Types ===

const ContentBlockType = {
  TEXT: "text",
  IMAGE: "image",
  TOOL_USE: "tool_use",
  TOOL_RESULT: "tool_result",
  THINKING: "thinking",
} as const;

// === Content Block Interfaces ===

interface TextBlock {
  type: "text";
  text: string;
}

interface ImageBlock {
  type: "image";
  source_type: string;
  media_type: string;
  data: string;
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

function createTextBlock(text: string): TextBlock {
  return { type: ContentBlockType.TEXT, text: String(text) };
}

function createImageBlock(base64Data: string, mediaType = "image/png"): ImageBlock {
  return {
    type: ContentBlockType.IMAGE,
    source_type: "base64",
    media_type: mediaType,
    data: base64Data,
  };
}

function createToolUseBlock(id: string, name: string, input: Record<string, unknown> = {}): ToolUseBlock {
  return { type: ContentBlockType.TOOL_USE, id, name, input };
}

function createToolResultBlock(toolUseId: string, content: string | unknown, isError = false): ToolResultBlock {
  return {
    type: ContentBlockType.TOOL_RESULT,
    tool_use_id: toolUseId,
    content: String(content),
    is_error: isError,
  };
}

function createThinkingBlock(thinking: string): ThinkingBlock {
  return { type: ContentBlockType.THINKING, thinking: String(thinking) };
}

// === Standard Message ===

const MessageRole = {
  USER: "user",
  ASSISTANT: "assistant",
  SYSTEM: "system",
} as const;

interface MessageMetadata {
  model?: string;
  usage?: Record<string, number>;
  timestamp?: number;
  [key: string]: unknown;
}

interface StandardMessageOptions {
  role?: string;
  content?: ContentBlock[];
  metadata?: MessageMetadata;
}

// Typed result object for toOpenAIFormat
interface OpenAIMessage {
  role: string;
  content?: string;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
}

/**
 * StandardMessage - typed conversation message
 *
 * Mirrors OpenHarness's ConversationMessage(BaseModel):
 * - role: "user" | "assistant"
 * - content: list[ContentBlock] (discriminated by type)
 */
class StandardMessage {
  role: string;
  content: ContentBlock[];
  metadata: MessageMetadata;

  constructor(o: StandardMessageOptions = {}) {
    this.role = o.role || MessageRole.USER;
    this.content = o.content || [];
    this.metadata = o.metadata || {};
  }

  /** Get all text content concatenated */
  get text(): string {
    return this.content
      .filter((c) => c.type === ContentBlockType.TEXT)
      .map((c) => (c as TextBlock).text)
      .join("");
  }

  /** Get all tool_use blocks */
  get toolUses(): ToolUseBlock[] {
    return this.content.filter((c): c is ToolUseBlock => c.type === ContentBlockType.TOOL_USE);
  }

  /** Get all tool_result blocks */
  get toolResults(): ToolResultBlock[] {
    return this.content.filter((c): c is ToolResultBlock => c.type === ContentBlockType.TOOL_RESULT);
  }

  /** Get all image blocks */
  get images(): ImageBlock[] {
    return this.content.filter((c): c is ImageBlock => c.type === ContentBlockType.IMAGE);
  }

  /** Check if this message contains any tool calls */
  get hasToolUses(): boolean {
    return this.content.some((c) => c.type === ContentBlockType.TOOL_USE);
  }

  /** Quick factory: user message with text */
  static user(text: string): StandardMessage {
    return new StandardMessage({
      role: MessageRole.USER,
      content: [createTextBlock(text)],
    });
  }

  /** Quick factory: assistant message with text */
  static assistant(text: string): StandardMessage {
    return new StandardMessage({
      role: MessageRole.ASSISTANT,
      content: [createTextBlock(text)],
    });
  }

  /** Quick factory: tool result message */
  static toolResult(toolUseId: string, result: unknown, isError = false): StandardMessage {
    return new StandardMessage({
      role: MessageRole.USER,
      content: [createToolResultBlock(toolUseId, result, isError)],
    });
  }

  /**
   * Convert to Anthropic API format
   */
  toAnthropicFormat(): { role: string; content: unknown[] } {
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
   * Convert to OpenAI API format.
   * Returns a plain { role, content } object. Tool calls/results are handled
   * separately by the OpenAI adapter (tool_calls / tool role).
   */
  toOpenAIFormat(): OpenAIMessage {
    let textContent = "";
    const toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> = [];

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

    const result: OpenAIMessage = { role: this.role };
    if (textContent) result.content = textContent;
    if (toolCalls.length > 0) result.tool_calls = toolCalls;
    return result;
  }

  /**
   * Convert to a compact serializable form for persistence
   */
  toJSON(): { role: string; content: ContentBlock[]; metadata: MessageMetadata } {
    return {
      role: this.role,
      content: this.content,
      metadata: this.metadata,
    };
  }

  /**
   * Restore from serialized JSON
   */
  static fromJSON(json: StandardMessageOptions): StandardMessage {
    return new StandardMessage(json);
  }

  /**
   * Estimate token count for this message.
   * Uses character-based heuristic with CJK awareness (~1.5 chars/token for Latin, ~0.6 for CJK)
   */
  estimateTokens(): number {
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
} as const;

interface StreamEventData {
  timestamp?: number;
  [key: string]: unknown;
}

/**
 * Create a standardized stream event
 */
function createStreamEvent(type: string, data: StreamEventData = {}): StreamEventData & { type: string; timestamp: number } {
  return { type, ...data, timestamp: data.timestamp ?? Date.now() };
}

// === Helper: Token Estimation ===

/**
 * Estimate token count for a text string.
 * Uses CJK-aware heuristic: CJK characters ~0.6 tokens/char, Latin ~0.25 tokens/char.
 */
function estimateTextTokens(text: string | null | undefined): number {
  if (!text) return 0;
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
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

/** Shape accepted by estimateMessageTokens — loosely typed for interop */
interface MessageLike {
  estimateTokens?: () => number;
  role?: string;
  content?: unknown;
}

/**
 * Estimate total tokens for a list of messages
 */
function estimateMessageTokens(messages: MessageLike[]): number {
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
function sanitizeConversation(messages: MessageLike[]): StandardMessage[] {
  const result: StandardMessage[] = [];
  const pendingToolUseIds = new Set<string>();

  for (const msg of messages) {
    const m = msg instanceof StandardMessage
      ? msg
      : new StandardMessage({ role: msg.role, content: (msg.content as ContentBlock[]) || [] });

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

/**
 * Create an ImageBlock from a local file path.
 * Reads the file and base64-encodes it.
 */
function createImageFromPath(filePath: string): ImageBlock {
  const ext = path.extname(filePath).toLowerCase();
  const mediaTypes: Record<string, string> = {
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
function toAnthropicMessages(messages: MessageLike[]): unknown[] {
  return messages.map((m) =>
    m instanceof StandardMessage ? m.toAnthropicFormat() : { role: m.role, content: m.content }
  );
}

/**
 * Convert a list of StandardMessages to OpenAI API format
 */
function toOpenAIMessages(messages: MessageLike[], systemPrompt: string | null = null): unknown[] {
  const result: unknown[] = [];
  if (systemPrompt) {
    result.push({ role: "system", content: String(systemPrompt) });
  }
  for (const m of messages) {
    const standard = m instanceof StandardMessage
      ? m
      : new StandardMessage({ role: m.role, content: (m.content as ContentBlock[]) || [] });
    const formatted = standard.toOpenAIFormat();
    if (formatted.content || formatted.tool_calls) {
      result.push(formatted);
    }
  }
  return result;
}

// === Exports ===

export {
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

export type {
  ContentBlock,
  TextBlock,
  ImageBlock,
  ToolUseBlock,
  ToolResultBlock,
  ThinkingBlock,
  MessageMetadata,
  StandardMessageOptions,
  MessageLike,
  OpenAIMessage,
  StreamEventData,
};
