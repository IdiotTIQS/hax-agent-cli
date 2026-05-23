"use strict";

/**
 * Shared serialization helpers used across the agent engine and desktop IPC layer.
 * Extracted to eliminate duplication between agent-engine.js and desktop/main/index.js.
 */

function serializeProvider(provider) {
  if (!provider) return null;

  return {
    name: provider.name,
    model: provider.model,
    apiUrl: provider.apiUrl,
  };
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    code: error?.code || null,
    message: error?.message || String(error || "Unknown error"),
    stack: error?.stack || null,
  };
}

function serializeSkill(skill) {
  if (!skill) return null;

  return {
    name: skill.name,
    displayName: skill.displayName || skill.name,
    description: skill.description || "",
    source: skill.source || null,
  };
}

function serializeProviderIssue(issue) {
  if (issue?.reason === "empty_tool_preamble") {
    return {
      name: "ProviderToolUseError",
      code: "EMPTY_TOOL_PREAMBLE",
      message: "The model repeatedly said it would inspect or gather more context, but it did not call an available tool.",
      stack: null,
    };
  }

  return {
    name: "ProviderToolUseError",
    code: issue?.reason || "PROVIDER_TOOL_LIMIT",
    message: "The provider stopped before completing the requested tool workflow.",
    stack: null,
  };
}

function isTerminalToolLimitReason(reason) {
  return reason === "empty_tool_preamble";
}

module.exports = {
  serializeProvider,
  serializeError,
  serializeSkill,
  serializeProviderIssue,
  isTerminalToolLimitReason,
};
