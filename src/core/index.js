"use strict";

/**
 * Core Module — unified exports
 *
 * Provides all core modules through a single entry point:
 * - messages: StandardMessage, ContentBlock types, stream events
 * - permissions: PermissionChecker, PermissionMode
 * - api: ProviderAdapter, AnthropicProviderAdapter, OpenAIProviderAdapter
 * - memory: Compaction functions, token estimation
 */

const messages = require("./messages/types");
const permissions = require("./permissions/checker");
const api = require("./api/provider-adapter");
const memory = require("./memory/compaction");

module.exports = {
  messages,
  permissions,
  api,
  memory,
};
