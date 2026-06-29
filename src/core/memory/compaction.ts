/**
 * Conversation Compaction - ported from OpenHarness services/compact/
 *
 * Provides multi-tier compaction strategies to manage token budget:
 *
 * 1. Micro Compact - cheap cleanup of stale tool results
 * 2. Context Collapse - deterministic text truncation
 * 3. Full Compact - LLM-based summarization of older messages
 * 4. Auto Compact - triggered before API calls when threshold exceeded
 * 5. Reactive Compact - triggered when API returns "context too long"
 *
 * Key invariants:
 * - Never split a tool_use/tool_result pair
 * - Always preserve the most recent N messages
 * - Always preserve session-critical context (goals, memories, key files)
 */

import { estimateMessageTokens } from "../messages/types.js";

// === Compaction Types ===

const CompactionType = {
  MICRO: "micro",
  FULL: "full",
  REACTIVE: "reactive",
  AUTO: "auto",
} as const;

// === Message shape accepted by compaction functions ===

/** Loosely typed message — covers both StandardMessage instances and plain objects */
interface CompactMessage {
  role?: string;
  content?: unknown;
  _isSummary?: boolean;
  _isContext?: boolean;
  estimateTokens?: () => number;
  [key: string]: unknown;
}

// === Compaction Progress Event ===

interface CompactionProgressOptions {
  type?: string;
  messagesBefore?: number;
  messagesAfter?: number;
  tokensBefore?: number;
  tokensAfter?: number;
  durationMs?: number;
}

class CompactionProgressEvent {
  type: string;
  compactType: string;
  messagesBefore: number;
  messagesAfter: number;
  tokensBefore: number;
  tokensAfter: number;
  durationMs: number;

  constructor(o: CompactionProgressOptions = {}) {
    this.type = "compact_progress";
    this.compactType = o.type || CompactionType.AUTO;
    this.messagesBefore = o.messagesBefore || 0;
    this.messagesAfter = o.messagesAfter || 0;
    this.tokensBefore = o.tokensBefore || 0;
    this.tokensAfter = o.tokensAfter || 0;
    this.durationMs = o.durationMs || 0;
  }
}

// === Compaction State ===

interface CompactionStateOptions {
  rounds?: number;
  lastCompactAt?: number | null;
  autoCompactThreshold?: number;
  microCompactThreshold?: number;
  maxContextTokens?: number;
}

class CompactionState {
  rounds: number;
  lastCompactAt: number | null;
  autoCompactThreshold: number;
  microCompactThreshold: number;
  maxContextTokens: number;
  compactionTypes: string[];

  constructor(o: CompactionStateOptions = {}) {
    this.rounds = o.rounds || 0;
    this.lastCompactAt = o.lastCompactAt || null;
    this.autoCompactThreshold = o.autoCompactThreshold || 0.7; // fraction of max context
    this.microCompactThreshold = o.microCompactThreshold || 0.5;
    this.maxContextTokens = o.maxContextTokens || 200000;
    this.compactionTypes = [];
  }
}

// === Token Estimation (CJK-aware) ===

/**
 * Estimate tokens for a single message using CJK-aware heuristic.
 */
function estimateMessageTokenCount(msg: CompactMessage): number {
  if (typeof msg.estimateTokens === "function") {
    return msg.estimateTokens();
  }
  const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content || "");
  return estimateCJKTokens(content) + 4; // +4 overhead
}

/**
 * Estimate tokens with CJK awareness.
 * CJK characters ≈ 0.6 tokens, Latin ≈ 0.25 tokens, other ≈ 0.4 tokens.
 */
function estimateCJKTokens(text: string | null | undefined): number {
  if (!text) return 0;
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK Unified
      (code >= 0x3400 && code <= 0x4DBF) ||   // CJK Extension A
      (code >= 0xF900 && code <= 0xFAFF) ||   // CJK Compatibility
      (code >= 0x3000 && code <= 0x303F) ||   // CJK Symbols
      (code >= 0xFF00 && code <= 0xFFEF)      // Fullwidth forms
    ) {
      tokens += 0.6;
    } else if (code > 127) {
      tokens += 0.4;
    } else {
      tokens += 0.25;
    }
  }
  return Math.ceil(tokens);
}

/**
 * Estimate total tokens for a list of messages.
 */
function estimateTotalTokens(messages: CompactMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokenCount(m), 0);
}

// === Micro Compact ===

interface MicroCompactOptions {
  keepRecent?: number;
}

interface MicroCompactResult {
  messages: CompactMessage[];
  removedCount: number;
  tokenSavings: number;
}

/**
 * Remove stale tool results while preserving conversation context.
 *
 * Clears tool_result content for tool calls older than `keepRecent` turns,
 * replacing them with a stub result to maintain pairing integrity.
 *
 * @param messages - conversation messages
 * @param options
 * @param options.keepRecent - number of most recent messages to preserve
 */
function microCompact(messages: CompactMessage[], options: MicroCompactOptions = {}): MicroCompactResult {
  const keepRecent = options.keepRecent || 6;
  const startTokens = estimateTotalTokens(messages);

  if (messages.length <= keepRecent) {
    return { messages: [...messages], removedCount: 0, tokenSavings: 0 };
  }

  const presplit = splitPreservingToolPairs(messages);

  // Messages to compact (all except last keepRecent)
  const compactTargets = presplit.slice(0, Math.max(0, presplit.length - keepRecent));
  const preserved = presplit.slice(Math.max(0, presplit.length - keepRecent));

  let removedCount = 0;

  // Compact: clear tool result content, keep stubs
  const compacted = compactTargets.map((group) => {
    if (Array.isArray(group)) {
      // Tool pair group - clear result content, keep stubs
      return group.map((msg) => {
        const content = Array.isArray(msg.content) ? msg.content as CompactMessage[] : [msg.content as CompactMessage];
        const newContent = content.map((block) => {
          if (typeof block === "object" && block !== null) {
            const b = block as Record<string, unknown>;
            if (b.type === "tool_result" || b.tool_use_id) {
              removedCount++;
              return {
                ...b,
                content: "[result cleared by micro-compaction]",
                is_error: false,
              };
            }
          }
          return block;
        });
        return { ...msg, content: newContent };
      });
    }
    return group; // Single message, keep as-is
  });

  const result = [...compacted.flat(), ...preserved.flat()];
  const endTokens = estimateTotalTokens(result);

  return {
    messages: result,
    removedCount,
    tokenSavings: Math.max(0, startTokens - endTokens),
  };
}

// === Context Collapse ===

interface ContextCollapseOptions {
  maxTokens?: number;
  keepRecent?: number;
}

interface ContextCollapseResult {
  messages: CompactMessage[];
  truncated: boolean;
}

/**
 * Deterministic text truncation - truncates older messages' text content
 * to stay under a target token budget.
 *
 * @param messages
 * @param options
 * @param options.maxTokens - target max tokens
 * @param options.keepRecent - most recent messages preserved in full
 */
function contextCollapse(messages: CompactMessage[], options: ContextCollapseOptions = {}): ContextCollapseResult {
  const maxTokens = options.maxTokens || 100000;
  const keepRecent = options.keepRecent || 6;

  if (messages.length <= keepRecent) {
    return { messages: [...messages], truncated: false };
  }

  const presplit = splitPreservingToolPairs(messages);
  const preserved = presplit.slice(-keepRecent).flat();
  const older = presplit.slice(0, -keepRecent).flat();

  const preservedTokens = estimateTotalTokens(preserved);
  const budget = maxTokens - preservedTokens;

  if (budget <= 0) {
    // Even preserved messages exceed budget - must discard older entirely
    return { messages: preserved, truncated: true };
  }

  const olderTokens = estimateTotalTokens(older);
  if (olderTokens <= budget) {
    return { messages: messages, truncated: false };
  }

  // Truncate older messages proportionally
  const ratio = budget / olderTokens;
  const truncated = older.map((msg) => {
    const content = Array.isArray(msg.content)
      ? msg.content as Array<Record<string, unknown>>
      : [{ type: "text", text: String(msg.content || "") }];
    const newContent = content.map((block) => {
      if (block.type === "text" || typeof block === "string") {
        const text = typeof block === "string" ? block : String(block.text || "");
        const maxLen = Math.floor(text.length * ratio);
        return typeof block === "string"
          ? text.slice(0, maxLen) + "...[truncated]"
          : { ...block, text: text.slice(0, maxLen) + "...[truncated]" };
      }
      return block;
    });
    return { ...msg, content: newContent };
  });

  return {
    messages: [...truncated, ...preserved],
    truncated: true,
  };
}

// === Split: Preserve Tool Use/Result Pairs ===

/**
 * Group messages into "rounds" where tool_use/tool_result pairs are kept together.
 */
function splitPreservingToolPairs(messages: CompactMessage[]): Array<CompactMessage | CompactMessage[]> {
  const groups: Array<CompactMessage | CompactMessage[]> = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    // Check if this is a user message that looks like tool results
    if (
      msg.role === "user" &&
      Array.isArray(msg.content) &&
      (msg.content as Array<Record<string, unknown>>).some((c) => c.type === "tool_result" || c.tool_use_id)
    ) {
      // This is a tool result message - find the preceding assistant message with tool_use
      if (i > 0 && groups.length > 0) {
        const prevGroup = groups[groups.length - 1];
        const prev = Array.isArray(prevGroup) ? prevGroup[prevGroup.length - 1] : prevGroup;
        if (
          prev.role === "assistant" &&
          (Array.isArray(prev.content)
            ? (prev.content as Array<Record<string, unknown>>).some((c) => c.type === "tool_use" || c.name)
            : false)
        ) {
          // Merge this tool result with the previous assistant tool_use message
          if (Array.isArray(prevGroup)) {
            (prevGroup as CompactMessage[]).push(msg);
            i++;
            continue;
          } else {
            groups[groups.length - 1] = [prevGroup, msg];
            i++;
            continue;
          }
        }
      }
    }

    // Check if this is an assistant message with tool_use
    if (
      msg.role === "assistant" &&
      Array.isArray(msg.content) &&
      (msg.content as Array<Record<string, unknown>>).some((c) => c.type === "tool_use" || (c.name && c.input))
    ) {
      // Look ahead for tool result messages
      const pair: CompactMessage[] = [msg];
      let j = i + 1;
      while (j < messages.length) {
        const next = messages[j];
        if (
          next.role === "user" &&
          Array.isArray(next.content) &&
          (next.content as Array<Record<string, unknown>>).some((c) => c.type === "tool_result" || c.tool_use_id)
        ) {
          pair.push(next);
          j++;
        } else {
          break;
        }
      }
      groups.push(pair);
      i = j;
      continue;
    }

    groups.push(msg);
    i++;
  }

  return groups;
}

// === Group by Prompt Round ===

/**
 * Group messages by user prompt round.
 * Each round starts with a user message (not tool_result) and includes the assistant response.
 */
function groupByPromptRound(messages: CompactMessage[]): CompactMessage[][] {
  const rounds: CompactMessage[][] = [];
  let currentRound: CompactMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "user" && !isToolResultMessage(msg)) {
      if (currentRound.length > 0) {
        rounds.push(currentRound);
      }
      currentRound = [msg];
    } else {
      currentRound.push(msg);
    }
  }

  if (currentRound.length > 0) {
    rounds.push(currentRound);
  }

  return rounds;
}

function isToolResultMessage(msg: CompactMessage): boolean {
  if (!Array.isArray(msg.content)) return false;
  return (msg.content as Array<Record<string, unknown>>).every(
    (c) => c.type === "tool_result" || c.tool_use_id
  );
}

// === Full Compact (LLM-based) ===

interface FullCompactOptions {
  summarize?: (msgs: CompactMessage[], maxTokens: number) => Promise<string>;
  keepRecent?: number;
  maxSummaryTokens?: number;
}

interface FullCompactResult {
  messages: CompactMessage[];
  summary: string | null;
  tokenSavings: number;
}

/**
 * Use LLM to summarize older messages, preserving key facts.
 */
async function fullCompact(messages: CompactMessage[], options: FullCompactOptions = {}): Promise<FullCompactResult> {
  const keepRecent = options.keepRecent || 6;
  const maxSummaryTokens = options.maxSummaryTokens || 2000;

  if (!options.summarize || messages.length <= keepRecent) {
    return {
      messages: [...messages],
      summary: null,
      tokenSavings: 0,
    };
  }

  const presplit = splitPreservingToolPairs(messages);
  const preserved = presplit.slice(-keepRecent).flat();
  const toSummarize = presplit.slice(0, -keepRecent).flat();

  if (toSummarize.length === 0) {
    return {
      messages: preserved,
      summary: null,
      tokenSavings: 0,
    };
  }

  const startTokens = estimateTotalTokens(messages);

  try {
    const summary = await options.summarize(toSummarize, maxSummaryTokens);

    // Prepend summary as a system context message
    const summaryMsg: CompactMessage = {
      role: "user",
      content: `[Previous conversation summary]\n${summary}`,
      _isSummary: true,
    };

    const result = [summaryMsg, ...preserved];
    const endTokens = estimateTotalTokens(result);

    return {
      messages: result,
      summary,
      tokenSavings: Math.max(0, startTokens - endTokens),
    };
  } catch (_err) {
    // Fallback to micro compact — summary is null to satisfy FullCompactResult shape
    const fallback = microCompact(messages, { keepRecent });
    return { messages: fallback.messages, summary: null, tokenSavings: fallback.tokenSavings };
  }
}

// === Auto Compact ===

interface AutoCompactOptions {
  state?: CompactionState;
  summarize?: (msgs: CompactMessage[], maxTokens: number) => Promise<string>;
  maxContextTokens?: number;
}

interface AutoCompactResult {
  messages: CompactMessage[];
  event: CompactionProgressEvent | null;
}

/**
 * Check if auto-compaction is needed and perform it.
 * Triggered when estimated tokens exceed a fraction of max context.
 */
async function autoCompactIfNeeded(messages: CompactMessage[], options: AutoCompactOptions = {}): Promise<AutoCompactResult> {
  const state = options.state || new CompactionState();
  const maxContextTokens = options.maxContextTokens || state.maxContextTokens || 200000;

  const currentTokens = estimateTotalTokens(messages);
  const microThreshold = Math.floor(maxContextTokens * state.microCompactThreshold);
  const autoThreshold = Math.floor(maxContextTokens * state.autoCompactThreshold);

  // No compaction needed
  if (currentTokens <= microThreshold) {
    return { messages, event: null };
  }

  const startedAt = Date.now();
  let result: { messages: CompactMessage[] };
  let compactType: string;

  if (currentTokens <= autoThreshold) {
    // Micro compact only
    result = microCompact(messages);
    compactType = CompactionType.MICRO;
  } else if (options.summarize) {
    // Full compact
    result = await fullCompact(messages, { summarize: options.summarize });
    compactType = CompactionType.FULL;
  } else {
    // Fallback to micro
    result = microCompact(messages);
    compactType = CompactionType.AUTO;
  }

  state.rounds++;
  state.lastCompactAt = Date.now();
  state.compactionTypes.push(compactType);

  const endTokens = estimateTotalTokens(result.messages);
  const event = new CompactionProgressEvent({
    type: compactType,
    messagesBefore: messages.length,
    messagesAfter: result.messages.length,
    tokensBefore: currentTokens,
    tokensAfter: endTokens,
    durationMs: Date.now() - startedAt,
  });

  return { messages: result.messages, event };
}

// === Reactive Compact ===

interface ReactiveCompactOptions {
  summarize?: (msgs: CompactMessage[], maxTokens: number) => Promise<string>;
  maxContextTokens?: number;
}

interface ReactiveCompactResult {
  messages: CompactMessage[];
  event: CompactionProgressEvent;
}

/**
 * Compact when API returns "context too long" error.
 * More aggressive than auto-compact.
 */
async function reactiveCompact(messages: CompactMessage[], options: ReactiveCompactOptions = {}): Promise<ReactiveCompactResult> {
  const startedAt = Date.now();
  const startTokens = estimateTotalTokens(messages);

  // Aggressive: keep only recent 4, full compact the rest
  let result: { messages: CompactMessage[] };
  if (options.summarize) {
    result = await fullCompact(messages, { summarize: options.summarize, keepRecent: 4 });
  } else {
    result = microCompact(messages, { keepRecent: 4 });
  }

  // If still too large, context collapse
  const maxTokens = options.maxContextTokens || 150000;
  const afterTokens = estimateTotalTokens(result.messages);
  if (afterTokens > maxTokens) {
    result = contextCollapse(result.messages, { maxTokens, keepRecent: 4 });
  }

  const endTokens = estimateTotalTokens(result.messages);
  const event = new CompactionProgressEvent({
    type: CompactionType.REACTIVE,
    messagesBefore: messages.length,
    messagesAfter: result.messages.length,
    tokensBefore: startTokens,
    tokensAfter: endTokens,
    durationMs: Date.now() - startedAt,
  });

  return { messages: result.messages, event };
}

// === Context Window Helpers ===

/**
 * Get max context window tokens for a model.
 */
function getContextWindow(model: string | null | undefined): number {
  const windows: Record<string, number> = {
    // Anthropic
    "claude-sonnet-4-20250514": 200000,
    "claude-opus-4-20250514": 200000,
    "claude-haiku-3-5-20241022": 200000,
    "claude-3-5-sonnet-20241022": 200000,
    "claude-3-opus-20240229": 200000,
    "claude-3-haiku-20240307": 200000,
    // OpenAI
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "gpt-4-turbo": 128000,
    "gpt-4": 8192,
    "gpt-3.5-turbo": 16385,
    "o1": 200000,
    "o1-mini": 128000,
    "o3-mini": 200000,
    // DeepSeek
    "deepseek-chat": 65536,
    "deepseek-reasoner": 65536,
    // Google
    "gemini-2.5-pro": 1048576,
    "gemini-2.0-flash": 1048576,
    "gemini-1.5-pro": 2097152,
  };

  if (model && windows[model]) return windows[model];
  // Try partial match
  if (model) {
    for (const [key, val] of Object.entries(windows)) {
      if (model.includes(key) || key.includes(model)) return val;
    }
  }
  return 200000; // default
}

/**
 * Get the recommended auto-compaction threshold for a model.
 * Default: 70% of max context window.
 */
function getAutocompactThreshold(model: string | null | undefined): number {
  return Math.floor(getContextWindow(model) * 0.7);
}

// === Structured Context Attachment ===

interface StructuredContextAttachments {
  activeGoal?: string;
  recentFiles?: string[];
  memoryKeys?: string[];
}

/**
 * Attach persistent structured context across compaction boundaries.
 * Preserved data: active goal, recent files, session memory keys.
 */
function attachStructuredContext(messages: CompactMessage[], attachments: StructuredContextAttachments = {}): CompactMessage[] {
  if (!attachments.activeGoal && !attachments.recentFiles?.length && !attachments.memoryKeys?.length) {
    return messages;
  }

  const parts: string[] = [];
  if (attachments.activeGoal) {
    parts.push(`Active Goal: ${attachments.activeGoal}`);
  }
  if (attachments.recentFiles?.length) {
    parts.push(`Recent Files: ${attachments.recentFiles.join(", ")}`);
  }
  if (attachments.memoryKeys?.length) {
    parts.push(`Session Memory: ${attachments.memoryKeys.slice(0, 5).join(", ")}`);
  }

  const contextMsg: CompactMessage = {
    role: "user",
    content: [{ type: "text", text: `[Session Context]\n${parts.join("\n")}` }],
    _isContext: true,
  };

  // Check if there's already a context message and replace it
  const existingIdx = messages.findIndex((m) => m._isContext);
  if (existingIdx >= 0) {
    const result = [...messages];
    result[existingIdx] = contextMsg;
    return result;
  }

  return [contextMsg, ...messages];
}

// === Exports ===

export {
  CompactionType,
  CompactionProgressEvent,
  CompactionState,

  // Core functions
  microCompact,
  contextCollapse,
  fullCompact,
  autoCompactIfNeeded,
  reactiveCompact,

  // Helpers
  splitPreservingToolPairs,
  groupByPromptRound,
  attachStructuredContext,
  estimateTotalTokens,
  estimateCJKTokens,
  estimateMessageTokenCount,
  getContextWindow,
  getAutocompactThreshold,
};

export type {
  CompactMessage,
  CompactionProgressOptions,
  CompactionStateOptions,
  MicroCompactOptions,
  MicroCompactResult,
  ContextCollapseOptions,
  ContextCollapseResult,
  FullCompactOptions,
  FullCompactResult,
  AutoCompactOptions,
  AutoCompactResult,
  ReactiveCompactOptions,
  ReactiveCompactResult,
  StructuredContextAttachments,
};
