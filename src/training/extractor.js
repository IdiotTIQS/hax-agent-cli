"use strict";

/**
 * Training data extractors for HaxAgent session transcripts.
 *
 * Each function accepts an array of session objects (as returned by
 * listSessions()) and yields structured training examples ready for
 * formatting.
 */
const { listSessions } = require("../memory");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function loadSessions(sessions) {
  return sessions.map((session) => {
    const entries = typeof session.entries === "function" ? session.entries() : (session.entries || []);
    return { id: session.id, updatedAt: session.updatedAt, entries };
  });
}

function safeGet(obj, key, fallback) {
  if (obj && Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  return fallback;
}

function isToolEntry(entry) {
  return entry && entry.role === "tool";
}

function isAssistantEntry(entry) {
  return entry && entry.role === "assistant";
}

function isUserEntry(entry) {
  return entry && entry.role === "user";
}

function isToolError(entry) {
  return Boolean(isToolEntry(entry) && (entry.isError === true || entry.is_error === true || (entry.data && entry.data && entry.data.error)));
}

function getToolName(entry) {
  return safeGet(entry, "name", "unknown");
}

function getToolArgs(entry) {
  return safeGet(entry, "args", null) || safeGet(entry, "input", null) || null;
}

function getContent(entry) {
  const raw = safeGet(entry, "content", "");
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .filter((block) => block && block.type === "text")
      .map((block) => block.text || "")
      .join("\n");
  }
  return "";
}

function buildConversationContext(entries, endIndex, maxEntries) {
  const start = Math.max(0, endIndex - (maxEntries || 20));
  return entries.slice(start, endIndex).map(serializeEntry);
}

function serializeEntry(entry) {
  const out = { role: entry.role || "unknown" };
  const content = getContent(entry);
  if (content) out.content = content;
  if (entry.name) { out.name = entry.name; out.toolName = entry.name; }
  if (entry.toolCalls) out.toolCalls = entry.toolCalls;
  if (entry.isError) out.isError = true;
  if (entry.data !== undefined) out.data = entry.data;
  return out;
}

// ---------------------------------------------------------------------------
// extractToolUseExamples
// ---------------------------------------------------------------------------

/**
 * Extract tool call → tool result pairs from sessions.
 *
 * Each example captures the context leading up to a tool call, the tool call
 * itself (name + args), and the tool's result.
 *
 * @param {Array<object>} sessions - session objects from listSessions()
 * @returns {Array<object>}
 */
function extractToolUseExamples(sessions) {
  const examples = [];
  const loaded = loadSessions(sessions);

  for (const session of loaded) {
    const entries = session.entries;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // Look for assistant entries that precede a tool result
      if (!isAssistantEntry(entry)) continue;
      if (i + 1 >= entries.length) continue;

      // Find tool calls (either explicit toolCalls field, or next entry is tool)
      const toolCalls = safeGet(entry, "toolCalls", null);

      if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
        // Explicit toolCalls in the assistant message
        for (const tc of toolCalls) {
          // Find matching tool result
          const resultEntry = findMatchingToolResult(entries, i + 1, tc.name || tc.function?.name);
          examples.push({
            type: "tool_use",
            sessionId: session.id,
            context: buildConversationContext(entries, i, 10),
            assistantMessage: serializeEntry(entry),
            toolCall: {
              name: tc.name || (tc.function && tc.function.name) || "unknown",
              args: tc.args || (tc.function && tc.function.arguments) || tc.input || {},
            },
            toolResult: resultEntry ? serializeEntry(resultEntry) : null,
            timestamp: entry.timestamp || null,
          });
        }
      } else {
        // Implicit: tool result immediately follows assistant
        const nextEntry = entries[i + 1];
        if (isToolEntry(nextEntry)) {
          examples.push({
            type: "tool_use",
            sessionId: session.id,
            context: buildConversationContext(entries, i, 10),
            assistantMessage: serializeEntry(entry),
            toolCall: {
              name: getToolName(nextEntry),
              args: getToolArgs(nextEntry) || getToolArgs(entry) || {},
            },
            toolResult: serializeEntry(nextEntry),
            timestamp: entry.timestamp || null,
          });
        }
      }
    }
  }

  return examples;
}

function findMatchingToolResult(entries, startIndex, toolName) {
  for (let j = startIndex; j < Math.min(startIndex + 10, entries.length); j++) {
    const entry = entries[j];
    if (isToolEntry(entry) && (!toolName || getToolName(entry) === toolName || getToolName(entry) === "unknown")) {
      return entry;
    }
    // Stop at next user or assistant message (new turn)
    if (isUserEntry(entry) || (isAssistantEntry(entry) && !entry.toolCalls)) break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// extractConversationTurns
// ---------------------------------------------------------------------------

/**
 * Extract user → assistant turn pairs from sessions.
 *
 * @param {Array<object>} sessions - session objects from listSessions()
 * @returns {Array<object>}
 */
function extractConversationTurns(sessions) {
  const examples = [];
  const loaded = loadSessions(sessions);

  for (const session of loaded) {
    const entries = session.entries;
    let turnIndex = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!isUserEntry(entry)) continue;

      turnIndex++;
      const userMessage = getContent(entry);
      if (!userMessage) continue;

      // Collect all assistant + tool entries until next user message
      const assistantMessages = [];
      const toolEntries = [];
      let j = i + 1;

      while (j < entries.length && !isUserEntry(entries[j])) {
        const next = entries[j];
        if (isAssistantEntry(next)) {
          assistantMessages.push(serializeEntry(next));
        } else if (isToolEntry(next)) {
          toolEntries.push(serializeEntry(next));
        }
        j++;
      }

      if (assistantMessages.length > 0) {
        examples.push({
          type: "conversation_turn",
          sessionId: session.id,
          turnIndex,
          userMessage,
          assistantMessages,
          toolCalls: toolEntries,
          timestamp: entry.timestamp || null,
        });
      }

      // Move i forward to avoid re-processing
      i = j - 1;
    }
  }

  return examples;
}

// ---------------------------------------------------------------------------
// extractAgentWorkflows
// ---------------------------------------------------------------------------

/**
 * Extract multi-step agent workflows: user request → chain of tool calls
 * → final response.
 *
 * A workflow is a sequence of 2+ tool calls within a single user turn.
 *
 * @param {Array<object>} sessions - session objects from listSessions()
 * @returns {Array<object>}
 */
function extractAgentWorkflows(sessions) {
  const examples = [];
  const loaded = loadSessions(sessions);

  for (const session of loaded) {
    const entries = session.entries;

    for (let i = 0; i < entries.length; i++) {
      if (!isUserEntry(entries[i])) continue;

      const userMessage = getContent(entries[i]);
      if (!userMessage) continue;

      // Collect the full response chain until next user message
      const steps = [];
      let finalResponse = null;
      let j = i + 1;

      while (j < entries.length && !isUserEntry(entries[j])) {
        const entry = entries[j];
        if (isToolEntry(entry)) {
          steps.push({
            toolName: getToolName(entry),
            toolArgs: getToolArgs(entry),
            result: safeGet(entry, "data", null),
            isError: isToolError(entry),
          });
        } else if (isAssistantEntry(entry)) {
          const hasToolCalls = safeGet(entry, "toolCalls", null);
          if (!hasToolCalls || !Array.isArray(hasToolCalls) || hasToolCalls.length === 0) {
            // This is a "thinking/reasoning" or "final response" assistant message
            // Keep the last one as finalResponse
            finalResponse = serializeEntry(entry);
          }
        }
        j++;
      }

      // Only emit workflows with 2+ tool calls (multi-step)
      if (steps.length >= 2) {
        examples.push({
          type: "agent_workflow",
          sessionId: session.id,
          goal: userMessage,
          steps,
          finalResponse,
          stepCount: steps.length,
          timestamp: entries[i].timestamp || null,
        });
      }

      i = j - 1;
    }
  }

  return examples;
}

// ---------------------------------------------------------------------------
// extractErrorRecoveryExamples
// ---------------------------------------------------------------------------

/**
 * Extract error → retry → success recovery patterns.
 *
 * Looks for: tool call → error result → same/different tool call → success.
 *
 * @param {Array<object>} sessions - session objects from listSessions()
 * @returns {Array<object>}
 */
function extractErrorRecoveryExamples(sessions) {
  const examples = [];
  const loaded = loadSessions(sessions);

  for (const session of loaded) {
    const entries = session.entries;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!isToolError(entry)) continue;

      const errorToolName = getToolName(entry);
      const errorData = safeGet(entry, "data", null);

      // Search forward for a successful tool call with the same name
      for (let j = i + 1; j < Math.min(i + 20, entries.length); j++) {
        const next = entries[j];
        if (!isToolEntry(next)) continue;
        if (isToolError(next)) continue;

        const nextToolName = getToolName(next);
        // Match: same tool or a related tool (file.*, shell.*, etc.)
        const sameTool = nextToolName === errorToolName;
        const relatedTool = getToolFamily(errorToolName) === getToolFamily(nextToolName);

        if (sameTool || relatedTool) {
          examples.push({
            type: "error_recovery",
            sessionId: session.id,
            errorToolCall: {
              name: errorToolName,
              args: getToolArgs(entry),
            },
            errorResult: {
              data: errorData,
              isError: true,
            },
            recoveryToolCall: {
              name: nextToolName,
              args: getToolArgs(next),
            },
            recoveryResult: {
              data: safeGet(next, "data", null),
              isError: false,
            },
            recoveryStrategy: sameTool ? "retry_same_tool" : "retry_alternative_tool",
            context: buildConversationContext(entries, i, 10),
            timestamp: entry.timestamp || null,
          });
          break;
        }
      }
    }
  }

  return examples;
}

function getToolFamily(toolName) {
  if (!toolName) return "unknown";
  const dot = toolName.indexOf(".");
  return dot === -1 ? toolName : toolName.slice(0, dot);
}

// ---------------------------------------------------------------------------
// extractDecisionPoints
// ---------------------------------------------------------------------------

/**
 * Extract moments where the agent had to choose between multiple options.
 *
 * Detected via:
 *  - Assistant messages that contain multiple toolCalls (parallel dispatch)
 *  - Assistant messages whose content contains deliberation patterns
 *    (e.g. "I could either...", "There are two approaches...")
 *  - Tool calls followed by assistant messages that evaluate results before
 *    deciding the next step.
 *
 * @param {Array<object>} sessions - session objects from listSessions()
 * @returns {Array<object>}
 */
function extractDecisionPoints(sessions) {
  const examples = [];
  const loaded = loadSessions(sessions);

  const DELIBERATION_PATTERNS = [
    /\b(could either|two (ways|options|approaches|alternatives)|several (ways|options)|multiple (ways|options)|I (could|can) (either|choose)|let me (decide|think|consider|weigh)|on the one hand|alternatively|option (A|B|1|2)|either way)\b/i,
    /\b(first approach|second approach|plan A|plan B|option 1|option 2)\b/i,
    /\b(which (approach|tool|method|way|strategy)|what (approach|tool|method|way|strategy) should I use)\b/i,
  ];

  for (const session of loaded) {
    const entries = session.entries;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!isAssistantEntry(entry)) continue;

      const content = getContent(entry);
      const toolCalls = safeGet(entry, "toolCalls", null);

      // Case 1: Multiple parallel tool calls
      if (toolCalls && Array.isArray(toolCalls) && toolCalls.length >= 2) {
        examples.push({
          type: "decision_point",
          subtype: "parallel_tool_choice",
          sessionId: session.id,
          context: buildConversationContext(entries, i, 10),
          reasoning: content || "",
          options: toolCalls.map((tc) => ({
            toolName: tc.name || (tc.function && tc.function.name) || "unknown",
            args: tc.args || (tc.function && tc.function.arguments) || tc.input || {},
          })),
          chosenAction: "all_parallel",
          timestamp: entry.timestamp || null,
        });
        continue;
      }

      // Case 2: Deliberation patterns in content
      if (content && DELIBERATION_PATTERNS.some((pattern) => pattern.test(content))) {
        // Find what the agent actually did next
        const nextAction = findNextAction(entries, i);
        examples.push({
          type: "decision_point",
          subtype: "deliberation",
          sessionId: session.id,
          context: buildConversationContext(entries, i, 10),
          reasoning: content,
          options: extractOptionsFromContent(content),
          chosenAction: nextAction,
          timestamp: entry.timestamp || null,
        });
        continue;
      }

      // Case 3: Assistant evaluates tool result, then takes another action
      if (content && i > 0 && isToolEntry(entries[i - 1]) && i + 1 < entries.length) {
        const nextEntry = entries[i + 1];
        if (isToolEntry(nextEntry) || (isAssistantEntry(nextEntry) && safeGet(nextEntry, "toolCalls", null))) {
          examples.push({
            type: "decision_point",
            subtype: "result_evaluation",
            sessionId: session.id,
            context: buildConversationContext(entries, i, 5),
            priorResult: serializeEntry(entries[i - 1]),
            reasoning: content,
            nextAction: isToolEntry(nextEntry)
              ? { toolName: getToolName(nextEntry), args: getToolArgs(nextEntry) }
              : { toolCalls: safeGet(nextEntry, "toolCalls", []) },
            timestamp: entry.timestamp || null,
          });
        }
      }
    }
  }

  return examples;
}

function findNextAction(entries, index) {
  for (let j = index + 1; j < Math.min(index + 5, entries.length); j++) {
    const entry = entries[j];
    if (isToolEntry(entry)) {
      return { toolName: getToolName(entry), args: getToolArgs(entry) };
    }
    if (isAssistantEntry(entry)) {
      const tcs = safeGet(entry, "toolCalls", null);
      if (tcs && Array.isArray(tcs) && tcs.length > 0) {
        return { toolCalls: tcs };
      }
    }
  }
  return null;
}

function extractOptionsFromContent(content) {
  if (!content) return [];
  const options = [];

  // Look for numbered/bulleted options
  const numberedPattern = /(?:^|\n)\s*(?:(\d+)[\.\)]|[-*+])\s+(.+?)(?=\n\s*(?:\d+[\.\)]|[-*+])|\n\n|$)/gm;
  let match;
  while ((match = numberedPattern.exec(content)) !== null) {
    options.push(match[2].trim());
  }

  // Look for "either X or Y" patterns
  const eitherOrPattern = /either\s+(.+?)\s+or\s+(.+?)(?:\.|,|\s+and|\s+$)/gi;
  while ((match = eitherOrPattern.exec(content)) !== null) {
    if (!options.includes(match[1].trim())) options.push(match[1].trim());
    if (!options.includes(match[2].trim())) options.push(match[2].trim());
  }

  return options;
}

// ---------------------------------------------------------------------------
// module exports
// ---------------------------------------------------------------------------

module.exports = {
  extractToolUseExamples,
  extractConversationTurns,
  extractAgentWorkflows,
  extractErrorRecoveryExamples,
  extractDecisionPoints,
};
