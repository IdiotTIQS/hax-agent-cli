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
  const selected = latestTokens > budgetTokens
    ? [truncateMessageToBudget(latestMessage, budgetTokens, settings)]
    : [latestMessage];
  let usedTokens = Math.min(latestTokens, budgetTokens);

  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    const tokens = estimateMessageTokens(message, settings);

    if (usedTokens + tokens > budgetTokens) {
      continue;
    }

    selected.unshift(message);
    usedTokens += tokens;
  }

  return selected;
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

function inferModelContextWindowTokens(model) {
  const key = String(model || "").toLowerCase();

  if (/gpt-4\.1|gemini-2\.5|gemini-1\.5/.test(key)) {
    return 1_000_000;
  }

  if (/claude|sonnet|opus|haiku|gpt-4o|o3/.test(key)) {
    return 200_000;
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
