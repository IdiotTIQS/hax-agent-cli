const MessageRole = Object.freeze({
  system: 'system',
  user: 'user',
  assistant: 'assistant',
  tool: 'tool',
});

function createMessage(input) {
  const message = input || {};
  requireEnum(message.role, MessageRole, 'message.role');
  requireString(message.content, 'message.content');

  return Object.freeze({
    id: message.id || createId('msg'),
    role: message.role,
    content: message.content,
    name: message.name || null,
    createdAt: toIsoString(message.createdAt || new Date(), 'message.createdAt'),
    metadata: Object.freeze({ ...(message.metadata || {}) }),
  });
}

function createSystemMessage(content, metadata) {
  return createMessage({ role: MessageRole.system, content, metadata });
}

function createUserMessage(content, metadata) {
  return createMessage({ role: MessageRole.user, content, metadata });
}

function createAssistantMessage(content, metadata) {
  return createMessage({ role: MessageRole.assistant, content, metadata });
}

function createToolMessage(name, content, metadata) {
  requireString(name, 'message.name');

  return createMessage({ role: MessageRole.tool, name, content, metadata });
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toIsoString(value, name) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${name} must be a valid date`);
  }

  return date.toISOString();
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function requireEnum(value, options, name) {
  if (!Object.values(options).includes(value)) {
    throw new TypeError(`${name} must be one of: ${Object.values(options).join(', ')}`);
  }
}

module.exports = {
  MessageRole,
  createAssistantMessage,
  createMessage,
  createSystemMessage,
  createToolMessage,
  createUserMessage,
};
