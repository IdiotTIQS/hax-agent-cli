'use strict';

const { createId, requireEnum, requireString, toIsoString } = require('./utils');

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

module.exports = {
  MessageRole,
  createAssistantMessage,
  createMessage,
  createSystemMessage,
  createToolMessage,
  createUserMessage,
};
