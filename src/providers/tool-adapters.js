"use strict";

function createOpenAIToolDefinitions(toolRegistry) {
  if (!toolRegistry || typeof toolRegistry.list !== "function") {
    return [];
  }

  return toolRegistry.list().map((tool) => ({
    type: "function",
    function: {
      name: toOpenAIToolName(tool.name),
      description: tool.description,
      parameters: tool.inputSchema || { type: "object", properties: {} },
    },
  }));
}

function createAnthropicToolDefinitions(toolRegistry) {
  if (!toolRegistry || typeof toolRegistry.list !== "function") {
    return [];
  }

  return toolRegistry.list().map((tool) => ({
    name: toAnthropicToolName(tool.name),
    description: tool.description,
    input_schema: tool.inputSchema || { type: "object", properties: {} },
  }));
}

function createGeminiToolDefinitions(toolRegistry) {
  if (!toolRegistry || typeof toolRegistry.list !== "function") {
    return [];
  }

  const functionDeclarations = toolRegistry.list().map((tool) => {
    const schema = tool.inputSchema || { type: "object", properties: {} };

    return {
      name: toGeminiToolName(tool.name),
      description: tool.description,
      parameters: normalizeSchemaForGemini(schema),
    };
  });

  return functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];
}

function normalizeSchemaForGemini(schema) {
  if (!schema || typeof schema !== "object") {
    return { type: "OBJECT" };
  }

  const normalized = {};

  if (schema.type) {
    normalized.type = String(schema.type).toUpperCase();
  }

  if (schema.description) {
    normalized.description = schema.description;
  }

  if (schema.properties) {
    normalized.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      normalized.properties[key] = normalizeSchemaForGemini(value);
    }
  }

  if (Array.isArray(schema.required)) {
    normalized.required = schema.required;
  }

  if (schema.items) {
    normalized.items = normalizeSchemaForGemini(schema.items);
  }

  if (schema.enum) {
    normalized.enum = schema.enum;
  }

  return normalized;
}

function toOpenAIToolName(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function toAnthropicToolName(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function toGeminiToolName(name) {
  return String(name).replace(/\./g, "_");
}

function toRegistryToolName(name) {
  return String(name).replace(/_/g, ".");
}

function parseToolInput(argumentsRaw) {
  if (!argumentsRaw) {
    return {};
  }

  try {
    return JSON.parse(argumentsRaw);
  } catch (_error) {
    return {};
  }
}

function createOpenAIToolResultBlock(toolCallId, isError, content) {
  return {
    tool_call_id: toolCallId,
    role: "tool",
    content: typeof content === "string" ? content : JSON.stringify(content),
  };
}

module.exports = {
  createAnthropicToolDefinitions,
  createGeminiToolDefinitions,
  createOpenAIToolDefinitions,
  createOpenAIToolResultBlock,
  normalizeSchemaForGemini,
  parseToolInput,
  toAnthropicToolName,
  toGeminiToolName,
  toOpenAIToolName,
  toRegistryToolName,
};
