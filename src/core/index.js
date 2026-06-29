/**
 * Core Module - unified exports
 *
 * Provides all core modules through a single entry point:
 * - messages: StandardMessage, ContentBlock types, stream events
 * - permissions: PermissionChecker, PermissionMode
 * - api: ProviderAdapter, AnthropicProviderAdapter, OpenAIProviderAdapter
 * - memory: Compaction functions, token estimation
 */

import * as messages from "./messages/types.js";
import * as permissions from "./permissions/checker.js";
import * as api from "./api/provider-adapter.js";
import * as memory from "./memory/compaction.js";

export { messages, permissions, api, memory };
