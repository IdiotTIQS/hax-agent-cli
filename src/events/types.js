"use strict";

/**
 * Standard event name constants for the Hax Agent event system.
 *
 * Each domain groups events into an object for import convenience:
 *
 *   const { TOOL_EVENTS } = require('./events/types');
 *   bus.on(TOOL_EVENTS.EXECUTE, handler);
 *
 * Event names follow the pattern "domain.action" — segments are separated
 * by dots to support wildcard matching (e.g. "tool.*" matches "tool.execute").
 */

const TOOL_EVENTS = Object.freeze({
  /** A tool is about to execute. Data: { toolName, args, session } */
  EXECUTE: "tool.execute",
  /** A tool completed successfully. Data: { toolName, args, result, session, durationMs } */
  SUCCESS: "tool.success",
  /** A tool failed with an error. Data: { toolName, args, error, session, durationMs } */
  ERROR: "tool.error",
  /** A tool was blocked by the permissions system. Data: { toolName, permission, session } */
  PERMISSION_DENIED: "tool.permission_denied",
});

const SESSION_EVENTS = Object.freeze({
  /** A new session was created. Data: { session } */
  START: "session.start",
  /** A session ended (user exit or timeout). Data: { session, reason } */
  END: "session.end",
  /** A previous session was resumed. Data: { session } */
  RESUME: "session.resume",
  /** A session was fully cleared / destroyed. Data: { sessionId } */
  CLEAR: "session.clear",
});

const AGENT_EVENTS = Object.freeze({
  /** An agent turn (one request-response cycle) is starting. Data: { agent, messages, session } */
  TURN_START: "agent.turn_start",
  /** An agent turn completed. Data: { agent, messages, response, session, usage } */
  TURN_END: "agent.turn_end",
  /** An agent turn was interrupted by the user. Data: { agent, session } */
  INTERRUPT: "agent.interrupt",
  /** An agent-level error occurred. Data: { agent, error, session } */
  ERROR: "agent.error",
});

const PLUGIN_EVENTS = Object.freeze({
  /** A plugin was loaded and registered. Data: { plugin, source } */
  LOAD: "plugin.load",
  /** A plugin was unregistered. Data: { pluginName } */
  UNLOAD: "plugin.unload",
  /** A plugin hook threw an error. Data: { pluginName, hookName, error } */
  ERROR: "plugin.error",
});

const MEMORY_EVENTS = Object.freeze({
  /** A memory entry was written. Data: { key, namespace, session } */
  WRITE: "memory.write",
  /** A memory entry was read. Data: { key, namespace, value, session } */
  READ: "memory.read",
  /** A memory entry was deleted. Data: { key, namespace, session } */
  DELETE: "memory.delete",
  /** A memory search was performed. Data: { query, namespace, results, session } */
  SEARCH: "memory.search",
});

const CONFIG_EVENTS = Object.freeze({
  /** A config value changed. Data: { key, oldValue, newValue } */
  CHANGE: "config.change",
  /** Config was reloaded from disk. Data: { source, values } */
  RELOAD: "config.reload",
});

const PROVIDER_EVENTS = Object.freeze({
  /** The active AI provider was switched. Data: { from, to } */
  SWITCH: "provider.switch",
  /** A provider returned an error. Data: { provider, error, requestId } */
  ERROR: "provider.error",
  /** A provider is being rate-limited. Data: { provider, retryAfterMs, requestId } */
  RATE_LIMIT: "provider.rate_limit",
});

module.exports = {
  TOOL_EVENTS,
  SESSION_EVENTS,
  AGENT_EVENTS,
  PLUGIN_EVENTS,
  MEMORY_EVENTS,
  CONFIG_EVENTS,
  PROVIDER_EVENTS,
};
