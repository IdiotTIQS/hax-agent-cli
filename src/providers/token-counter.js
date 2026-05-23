"use strict";

const MESSAGE_OVERHEAD_TOKENS = 4;
const CONVERSATION_OVERHEAD_TOKENS = 3;
const DEFAULT_THRESHOLD = 0.85;

const MODEL_ENCODING_MAP = {
  "gpt-4": "cl100k_base",
  "gpt-4o": "o200k_base",
  "gpt-4o-mini": "o200k_base",
  "gpt-4.1": "o200k_base",
  "gpt-4.1-mini": "o200k_base",
  "gpt-4-turbo": "cl100k_base",
  "gpt-3.5-turbo": "cl100k_base",
  "claude-3-opus": "cl100k_base",
  "claude-3-5-sonnet": "cl100k_base",
  "claude-sonnet-4": "cl100k_base",
  "claude-opus-4": "cl100k_base",
  "claude-haiku-3-5": "cl100k_base",
  "claude-haiku-4": "cl100k_base",
  "gemini-1.5-pro": "cl100k_base",
  "gemini-2.5-pro": "cl100k_base",
  "gemini-2.5-flash": "cl100k_base",
  "text-embedding-3-small": "cl100k_base",
  "text-embedding-3-large": "cl100k_base",
  "text-embedding-ada-002": "r50k_base",
  "davinci-002": "p50k_base",
  "babbage-002": "p50k_base",
};

const DEFAULT_ENCODING = "cl100k_base";

function estimateTokens(text) {
  const content = String(text ?? "");
  return content.length === 0 ? 0 : Math.ceil(content.length / 4);
}

function estimateMessageTokens(message) {
  if (message == null) {
    return 0;
  }

  let tokenCount = MESSAGE_OVERHEAD_TOKENS;
  const content = typeof message.content === "string" ? message.content : "";

  if (Array.isArray(message.content)) {
    tokenCount += estimateTokens(
      message.content
        .map((part) => (typeof part === "string" ? part : part?.text ?? part?.content ?? ""))
        .join("")
    );
  } else {
    tokenCount += estimateTokens(content);
  }

  if (typeof message.name === "string" && message.name.length > 0) {
    tokenCount += estimateTokens(message.name) + 1;
  }

  if (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
    for (const toolCall of message.toolCalls) {
      if (toolCall == null) {
        continue;
      }
      tokenCount += estimateTokens(toolCall.name ?? toolCall.function?.name ?? "") + 3;
      const args = toolCall.arguments ?? toolCall.function?.arguments;
      if (typeof args === "string") {
        tokenCount += estimateTokens(args);
      } else if (args != null && typeof args === "object") {
        tokenCount += estimateTokens(JSON.stringify(args));
      }
    }
  }

  return tokenCount;
}

function estimateConversationTokens(messages) {
  if (!Array.isArray(messages)) {
    return 0;
  }

  let totalTokens = CONVERSATION_OVERHEAD_TOKENS;

  for (const message of messages) {
    totalTokens += estimateMessageTokens(message);
  }

  return totalTokens;
}

function countTokensWithTiktoken(text, model) {
  const content = String(text ?? "");

  if (content.length === 0) {
    return 0;
  }

  let tiktoken;
  try {
    tiktoken = require("tiktoken");
  } catch (_error) {
    return estimateTokens(content);
  }

  try {
    const encodingName = resolveEncodingName(model);
    const encoding = tiktoken.get_encoding(encodingName);
    const tokens = encoding.encode(content);
    encoding.free();
    return tokens.length;
  } catch (_error) {
    return estimateTokens(content);
  }
}

function isApproachingLimit(usedTokens, maxTokens, threshold) {
  const resolvedThreshold = Number.isFinite(threshold) ? threshold : DEFAULT_THRESHOLD;
  const resolvedMax = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 0;
  const resolvedUsed = Number.isFinite(usedTokens) && usedTokens >= 0 ? usedTokens : 0;

  if (resolvedMax === 0) {
    return false;
  }

  return resolvedUsed / resolvedMax >= resolvedThreshold;
}

function resolveEncodingName(model) {
  if (typeof model !== "string" || model.length === 0) {
    return DEFAULT_ENCODING;
  }

  const normalizedModel = model.trim().toLowerCase();
  return MODEL_ENCODING_MAP[normalizedModel] || DEFAULT_ENCODING;
}

module.exports = {
  estimateTokens,
  estimateMessageTokens,
  estimateConversationTokens,
  countTokensWithTiktoken,
  isApproachingLimit,
  MESSAGE_OVERHEAD_TOKENS,
  CONVERSATION_OVERHEAD_TOKENS,
  DEFAULT_THRESHOLD,
};
