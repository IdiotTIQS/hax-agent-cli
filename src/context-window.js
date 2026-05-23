"use strict";

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
const DEFAULT_RESERVE_OUTPUT_TOKENS = 8_192;
const DEFAULT_CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 8;
const SYSTEM_OVERHEAD_TOKENS = 32;

function prepareContextWindow(options = {}) {
  const settings = options.settings || {};
  const context = settings.context || {};
  const messages = Array.isArray(options.messages) ? options.messages : [];
  const system = String(options.system || "");

  if (context.enabled === false) {
    return {
      messages,
      system,
      stats: createStats({
        messages,
        system,
        settings,
        model: options.model,
        includedMessages: messages.length,
        droppedMessages: 0,
      }),
    };
  }

  const windowTokens = resolveContextWindowTokens(settings, options.model);
  const reserveOutputTokens = Math.max(
    positiveNumber(context.reserveOutputTokens, DEFAULT_RESERVE_OUTPUT_TOKENS),
    positiveNumber(options.outputTokens, 0),
  );
  const budgetTokens = Math.max(1, windowTokens - reserveOutputTokens);
  const systemTokens = estimateMessageTokens({ role: "system", content: system }, settings) + SYSTEM_OVERHEAD_TOKENS;
  const minimumMessageBudget = Math.max(1, Math.floor(budgetTokens * 0.25));
  const messageBudget = Math.max(minimumMessageBudget, budgetTokens - systemTokens);
  const selectedMessages = selectMessagesWithinBudget(messages, messageBudget, settings);
  const stats = createStats({
    messages: selectedMessages,
    system,
    settings,
    model: options.model,
    includedMessages: selectedMessages.length,
    droppedMessages: Math.max(0, messages.length - selectedMessages.length),
    windowTokens,
    budgetTokens,
    reserveOutputTokens,
    systemTokens,
  });

  return {
    messages: selectedMessages,
    system,
    stats,
  };
}

function selectMessagesWithinBudget(messages, budgetTokens, settings = {}) {
  if (messages.length === 0) {
    return [];
  }

  const latestMessage = messages[messages.length - 1];
  const latestTokens = estimateMessageTokens(latestMessage, settings);

  // Collect earlier messages that fit, walking backward.
  // older accumulates newest-first among the "older" slice.
  const older = [];
  let usedTokens = Math.min(latestTokens, budgetTokens);

  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    const tokens = estimateMessageTokens(message, settings);

    if (usedTokens + tokens > budgetTokens) {
      continue;
    }

    older.push(message);
    usedTokens += tokens;
  }

  // older is newest-first; reverse it to oldest-first and prepend latest.
  older.reverse();
  older.push(latestTokens > budgetTokens
    ? truncateMessageToBudget(latestMessage, budgetTokens, settings)
    : latestMessage);

  return older;
}

function truncateMessageToBudget(message, budgetTokens, settings = {}) {
  const charsPerToken = resolveCharsPerToken(settings);
  const role = message?.role || "user";
  const overheadTokens = MESSAGE_OVERHEAD_TOKENS + estimateTokens(role, settings);
  const contentBudgetTokens = Math.max(1, budgetTokens - overheadTokens);
  const maxChars = Math.max(1, Math.floor(contentBudgetTokens * charsPerToken));
  const content = stringifyContent(message?.content);
  const suffix = "\n\n[Context truncated to fit the configured token budget.]";
  const keepChars = Math.max(1, maxChars - suffix.length);

  return {
    ...message,
    content: `${content.slice(-keepChars)}${suffix}`,
  };
}

function createStats(options = {}) {
  const settings = options.settings || {};
  const inputTokens = estimateConversationTokens(options.messages || [], options.system || "", settings);
  const windowTokens = options.windowTokens || resolveContextWindowTokens(settings, options.model);
  const reserveOutputTokens = options.reserveOutputTokens || positiveNumber(settings.context?.reserveOutputTokens, DEFAULT_RESERVE_OUTPUT_TOKENS);
  const budgetTokens = options.budgetTokens || Math.max(1, windowTokens - reserveOutputTokens);

  return {
    windowTokens,
    budgetTokens,
    reserveOutputTokens,
    inputTokens,
    systemTokens: options.systemTokens || estimateTokens(options.system || "", settings),
    includedMessages: options.includedMessages || 0,
    droppedMessages: options.droppedMessages || 0,
    charsPerToken: resolveCharsPerToken(settings),
  };
}

function estimateConversationTokens(messages = [], system = "", settings = {}) {
  const systemTokens = system ? estimateMessageTokens({ role: "system", content: system }, settings) + SYSTEM_OVERHEAD_TOKENS : 0;
  const messageTokens = messages.reduce((total, message) => total + estimateMessageTokens(message, settings), 0);

  return systemTokens + messageTokens;
}

function estimateMessageTokens(message, settings = {}) {
  if (!message) return 0;
  return MESSAGE_OVERHEAD_TOKENS +
    estimateTokens(message.role || "user", settings) +
    estimateTokens(stringifyContent(message.content), settings) +
    estimateTokens(stringifyContent(message.name || ""), settings);
}

function estimateTokens(value, settings = {}) {
  const text = stringifyContent(value).trim();
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / resolveCharsPerToken(settings)));
}

function resolveContextWindowTokens(settings = {}, model) {
  const configured = positiveNumber(settings.context?.windowTokens, 0);
  if (configured > 0) return configured;
  return inferModelContextWindowTokens(model || settings.agent?.model);
}

// Pre-compiled regex-to-tokens mapping for inferModelContextWindowTokens.
// Ordered from most specific to most general so the first match wins.
const MODEL_WINDOW_MAP = [
  [/qwen(?:3\.[56])?-(?:plus|flash)|qwen3-coder-plus|qwen-deep-research/, 1_000_000],
  [/minimax-(?:text-01|m1)/, 1_000_000],
  [/gpt-5\.5|gpt-5\.4(?!.*(?:mini|nano))/, 1_050_000],
  [/deepseek-(?:v4|chat|reasoner)/, 1_000_000],
  [/kimi-k2(?:\.5|-0905|-turbo|-thinking)|moonshot-v1-256k|qwen3-(?:max|coder-next)|doubao-(?:seed-code|seed-2|seed-1-[68])|hunyuan-(?:turbos|a13b|hy3)/, 262_144],
  [/glm-(?:5|4\.7)|minimax-m2(?:\.5|\b)|minimax-m2\.1|baichuan4|baichuan-4|yi-.*(?:200k|long)/, 200_000],
  [/glm-4\.5|moonshot-v1-128k|kimi-k2-0711|yi-|hunyuan-(?:large|turbo)|doubao-pro-128k|doubao-.*128k/, 128_000],
  [/moonshot-v1-32k|doubao-(?:1[-.]5|pro|lite).*32k|doubao-.*32k/, 32_768],
  [/moonshot-v1-8k/, 8_192],
  [/claude-(?:opus-4-[67]|sonnet-4-6)|anthropic\.claude-(?:opus-4-[67]|sonnet-4-6)|gemini-(?:3|2\.5|2\.0|1\.5)|gpt-4\.1/, 1_000_000],
  [/gpt-5(?:\.[123])?(?:-|$)|gpt-5\.\d+-codex|gpt-5\.4-(?:mini|nano)|codex/, 400_000],
  [/deepseek-(?:v3|r1)|gpt-4o/, 128_000],
  [/claude|sonnet|opus|haiku|o[134](?:-|$)|o\d-mini/, 200_000],
];

function inferModelContextWindowTokens(model) {
  const key = String(model || "").toLowerCase();

  for (const [pattern, tokens] of MODEL_WINDOW_MAP) {
    if (pattern.test(key)) {
      return tokens;
    }
  }

  return DEFAULT_CONTEXT_WINDOW_TOKENS;
}

function resolveCharsPerToken(settings = {}) {
  return positiveNumber(settings.context?.charsPerToken, DEFAULT_CHARS_PER_TOKEN);
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringifyContent(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringifyContent).join("");
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    return JSON.stringify(value);
  }
  return String(value);
}

module.exports = {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  DEFAULT_RESERVE_OUTPUT_TOKENS,
  estimateConversationTokens,
  estimateMessageTokens,
  estimateTokens,
  inferModelContextWindowTokens,
  prepareContextWindow,
  resolveContextWindowTokens,
  selectMessagesWithinBudget,
};
