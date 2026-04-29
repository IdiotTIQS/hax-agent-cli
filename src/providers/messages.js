"use strict";

const VALID_ROLES = new Set(["system", "user", "assistant", "tool"]);

function normalizeMessages(input) {
  const messages = Array.isArray(input) ? input : [input];

  return messages
    .flatMap((message) => normalizeMessage(message))
    .filter((message) => message.content.length > 0 || message.toolCalls.length > 0);
}

function normalizeMessage(message) {
  if (message == null) {
    return [];
  }

  if (typeof message === "string") {
    return [createMessage("user", message)];
  }

  if (Array.isArray(message)) {
    return normalizeMessages(message);
  }

  if (typeof message !== "object") {
    return [createMessage("user", String(message))];
  }

  const role = normalizeRole(message.role);
  const content = normalizeContent(message.content);
  const toolCalls = normalizeToolCalls(message.toolCalls || message.tool_calls);

  return [
    {
      role,
      content,
      toolCalls,
      name: normalizeOptionalString(message.name),
      metadata: normalizeMetadata(message.metadata),
    },
  ];
}

function createMessage(role, content) {
  return {
    role,
    content: normalizeContent(content),
    toolCalls: [],
    name: undefined,
    metadata: {},
  };
}

function normalizeRole(role) {
  const normalizedRole = typeof role === "string" ? role.trim().toLowerCase() : "user";
  return VALID_ROLES.has(normalizedRole) ? normalizedRole : "user";
}

function normalizeContent(content) {
  if (content == null) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map(normalizeContentPart).filter(Boolean).join("");
  }

  if (typeof content === "object") {
    return normalizeContentPart(content);
  }

  return String(content);
}

function normalizeContentPart(part) {
  if (part == null) {
    return "";
  }

  if (typeof part === "string") {
    return part;
  }

  if (typeof part !== "object") {
    return String(part);
  }

  if (typeof part.text === "string") {
    return part.text;
  }

  if (typeof part.content === "string") {
    return part.content;
  }

  if (typeof part.value === "string") {
    return part.value;
  }

  return "";
}

function normalizeToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls
    .filter((toolCall) => toolCall && typeof toolCall === "object")
    .map((toolCall) => ({
      id: normalizeOptionalString(toolCall.id),
      name: normalizeOptionalString(toolCall.name || toolCall.function?.name),
      arguments: normalizeToolArguments(toolCall.arguments || toolCall.function?.arguments),
    }));
}

function normalizeToolArguments(args) {
  if (args == null) {
    return {};
  }

  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch (_error) {
      return args;
    }
  }

  return args;
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeMetadata(metadata) {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? { ...metadata } : {};
}

module.exports = {
  normalizeMessages,
};
