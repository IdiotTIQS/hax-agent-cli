"use strict";

/**
 * Training data formatters for HaxAgent.
 *
 * Convert extracted training examples into industry-standard training formats:
 * OpenAI chat, Anthropic Messages, prompt/completion pairs, and JSONL.
 */

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const ALLOWED_ROLES = new Set(["user", "assistant", "system", "tool", "function"]);
const REQUIRED_FIELDS_BY_TYPE = {
  conversation_turn: ["userMessage", "assistantMessages"],
  tool_use: ["toolCall", "toolResult"],
  agent_workflow: ["goal", "steps"],
  error_recovery: ["errorToolCall", "recoveryToolCall"],
  decision_point: ["reasoning"],
};

function isString(v) {
  return typeof v === "string";
}

function isNonEmptyString(v) {
  return isString(v) && v.trim().length > 0;
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isArray(v) {
  return Array.isArray(v);
}

// ---------------------------------------------------------------------------
// toOpenAIChatFormat
// ---------------------------------------------------------------------------

/**
 * Format extracted examples as OpenAI chat completion messages.
 *
 * Output shape:
 *   { messages: [{ role, content, ... }] }
 *
 * @param {Array<object>} examples - extracted training examples
 * @returns {Array<object>} array of { messages } objects
 */
function toOpenAIChatFormat(examples) {
  const formatted = [];

  for (const ex of examples) {
    switch (ex.type) {
      case "conversation_turn":
        formatted.push(formatConversationTurnOpenAI(ex));
        break;
      case "tool_use":
        formatted.push(formatToolUseOpenAI(ex));
        break;
      case "agent_workflow":
        formatted.push(formatAgentWorkflowOpenAI(ex));
        break;
      case "error_recovery":
        formatted.push(formatErrorRecoveryOpenAI(ex));
        break;
      case "decision_point":
        formatted.push(formatDecisionPointOpenAI(ex));
        break;
      default:
        formatted.push(formatGenericOpenAI(ex));
    }
  }

  return formatted.filter(Boolean);
}

function formatConversationTurnOpenAI(ex) {
  const msgs = [];

  // Build context from previous messages if available
  if (ex.context && isArray(ex.context)) {
    for (const ctx of ex.context) {
      const role = mapRole(ctx.role);
      const content = ctx.content || JSON.stringify(ctx);
      msgs.push({ role, content });
    }
  }

  msgs.push({ role: "user", content: ex.userMessage });

  for (const am of ex.assistantMessages) {
    const msg = { role: "assistant" };
    if (am.content) msg.content = am.content;
    if (am.toolCalls && am.toolCalls.length > 0) {
      msg.tool_calls = am.toolCalls.map((tc) => ({
        id: tc.id || generateCallId(),
        type: "function",
        function: {
          name: tc.name || tc.function?.name || "unknown",
          arguments: typeof (tc.args || tc.function?.arguments) === "string"
            ? tc.args || tc.function.arguments
            : JSON.stringify(tc.args || tc.function?.arguments || {}),
        },
      }));
    }
    msgs.push(msg);
  }

  for (const tc of (ex.toolCalls || [])) {
    msgs.push({
      role: "tool",
      tool_call_id: tc.id || generateCallId(),
      content: typeof tc.data === "string" ? tc.data : JSON.stringify(tc.data || {}),
    });
  }

  return { messages: msgs };
}

function formatToolUseOpenAI(ex) {
  const msgs = [];

  if (ex.context && isArray(ex.context)) {
    for (const ctx of ex.context) {
      msgs.push({ role: mapRole(ctx.role), content: ctx.content || JSON.stringify(ctx) });
    }
  }

  // Assistant message with tool call
  const toolCall = ex.toolCall || {};
  const callId = generateCallId();

  msgs.push({
    role: "assistant",
    content: ex.assistantMessage?.content || null,
    tool_calls: [{
      id: callId,
      type: "function",
      function: {
        name: toolCall.name || "unknown",
        arguments: typeof toolCall.args === "string" ? toolCall.args : JSON.stringify(toolCall.args || {}),
      },
    }],
  });

  // Tool result
  if (ex.toolResult) {
    msgs.push({
      role: "tool",
      tool_call_id: callId,
      content: typeof ex.toolResult.data === "string"
        ? ex.toolResult.data
        : JSON.stringify(ex.toolResult.data || {}),
    });
  }

  return { messages: msgs };
}

function formatAgentWorkflowOpenAI(ex) {
  const msgs = [];

  msgs.push({ role: "user", content: ex.goal });

  for (const step of (ex.steps || [])) {
    const callId = generateCallId();
    msgs.push({
      role: "assistant",
      content: null,
      tool_calls: [{
        id: callId,
        type: "function",
        function: {
          name: step.toolName || "unknown",
          arguments: JSON.stringify(step.toolArgs || {}),
        },
      }],
    });
    msgs.push({
      role: "tool",
      tool_call_id: callId,
      content: typeof step.result === "string" ? step.result : JSON.stringify(step.result || {}),
    });
  }

  if (ex.finalResponse) {
    msgs.push({
      role: "assistant",
      content: ex.finalResponse.content || "",
    });
  }

  return { messages: msgs };
}

function formatErrorRecoveryOpenAI(ex) {
  const msgs = [];

  if (ex.context && isArray(ex.context)) {
    for (const ctx of ex.context) {
      msgs.push({ role: mapRole(ctx.role), content: ctx.content || JSON.stringify(ctx) });
    }
  }

  // Failed tool call + error
  const errorCallId = generateCallId();
  msgs.push({
    role: "assistant",
    content: null,
    tool_calls: [{
      id: errorCallId,
      type: "function",
      function: {
        name: ex.errorToolCall?.name || "unknown",
        arguments: JSON.stringify(ex.errorToolCall?.args || {}),
      },
    }],
  });
  msgs.push({
    role: "tool",
    tool_call_id: errorCallId,
    content: JSON.stringify({
      error: ex.errorResult?.data || "Tool call failed",
      isError: true,
    }),
  });

  // Retry tool call + success
  const retryCallId = generateCallId();
  msgs.push({
    role: "assistant",
    content: null,
    tool_calls: [{
      id: retryCallId,
      type: "function",
      function: {
        name: ex.recoveryToolCall?.name || "unknown",
        arguments: JSON.stringify(ex.recoveryToolCall?.args || {}),
      },
    }],
  });
  msgs.push({
    role: "tool",
    tool_call_id: retryCallId,
    content: typeof ex.recoveryResult?.data === "string"
      ? ex.recoveryResult.data
      : JSON.stringify(ex.recoveryResult?.data || {}),
  });

  return { messages: msgs };
}

function formatDecisionPointOpenAI(ex) {
  const msgs = [];

  if (ex.context && isArray(ex.context)) {
    for (const ctx of ex.context) {
      msgs.push({ role: mapRole(ctx.role), content: ctx.content || JSON.stringify(ctx) });
    }
  }

  msgs.push({
    role: "assistant",
    content: ex.reasoning || "Let me think about how to approach this.",
  });

  return { messages: msgs };
}

function formatGenericOpenAI(ex) {
  const msgs = [{ role: "user", content: JSON.stringify(ex) }];
  return { messages: msgs };
}

function mapRole(role) {
  if (!role) return "user";
  const r = role.toLowerCase();
  if (ALLOWED_ROLES.has(r)) return r;
  if (r === "tool") return "tool";
  return "user";
}

let _callIdCounter = 0;
function generateCallId() {
  _callIdCounter += 1;
  return `call_${String(_callIdCounter).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// toAnthropicMessagesFormat
// ---------------------------------------------------------------------------

/**
 * Format extracted examples as Anthropic Messages API format.
 *
 * Output shape:
 *   { messages: [{ role, content: [...] }], tools?: [...] }
 *
 * @param {Array<object>} examples - extracted training examples
 * @returns {Array<object>} array of Anthropic-formatted messages
 */
function toAnthropicMessagesFormat(examples) {
  const formatted = [];

  for (const ex of examples) {
    switch (ex.type) {
      case "conversation_turn":
        formatted.push(formatConversationTurnAnthropic(ex));
        break;
      case "tool_use":
        formatted.push(formatToolUseAnthropic(ex));
        break;
      case "agent_workflow":
        formatted.push(formatAgentWorkflowAnthropic(ex));
        break;
      case "error_recovery":
        formatted.push(formatErrorRecoveryAnthropic(ex));
        break;
      case "decision_point":
        formatted.push(formatDecisionPointAnthropic(ex));
        break;
      default:
        formatted.push(formatGenericAnthropic(ex));
    }
  }

  return formatted.filter(Boolean);
}

function makeAnthropicUserMessage(text) {
  return { role: "user", content: [{ type: "text", text: String(text || "") }] };
}

function makeAnthropicAssistantMessage(text) {
  const content = [];
  if (text) content.push({ type: "text", text: String(text) });
  return { role: "assistant", content };
}

function makeAnthropicToolUse(id, name, input) {
  return {
    type: "tool_use",
    id: id || generateCallId(),
    name: name || "unknown",
    input: isObject(input) ? input : (isString(input) ? tryParseJson(input) || { raw: input } : {}),
  };
}

function makeAnthropicToolResult(toolUseId, content, isError) {
  return {
    type: "tool_result",
    tool_use_id: toolUseId || generateCallId(),
    content: isString(content)
      ? [{ type: "text", text: content }]
      : [{ type: "text", text: JSON.stringify(content || {}) }],
    is_error: Boolean(isError),
  };
}

function tryParseJson(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

function formatConversationTurnAnthropic(ex) {
  const msgs = [];

  if (ex.context && isArray(ex.context)) {
    for (const ctx of ex.context) {
      const role = ctx.role === "assistant" ? "assistant" : "user";
      msgs.push(makeAnthropicUserMessage(ctx.content || JSON.stringify(ctx)));
    }
  }

  msgs.push(makeAnthropicUserMessage(ex.userMessage));

  for (const am of ex.assistantMessages) {
    const assistantContent = [];

    if (am.content) {
      assistantContent.push({ type: "text", text: am.content });
    }

    if (am.toolCalls && am.toolCalls.length > 0) {
      for (const tc of am.toolCalls) {
        const name = tc.name || tc.function?.name || "unknown";
        const input = tc.args || tc.function?.arguments || tc.input || {};
        assistantContent.push(makeAnthropicToolUse(tc.id || generateCallId(), name, input));
      }
    }

    msgs.push({ role: "assistant", content: assistantContent.length > 0 ? assistantContent : [{ type: "text", text: "" }] });
  }

  // Tool results
  if (ex.toolCalls && ex.toolCalls.length > 0) {
    const toolResultContent = [];
    for (const tc of ex.toolCalls) {
      const resultText = typeof tc.data === "string" ? tc.data : JSON.stringify(tc.data || {});
      toolResultContent.push(makeAnthropicToolResult(tc.id || generateCallId(), resultText, tc.isError));
    }
    msgs.push({ role: "user", content: toolResultContent });
  }

  return { messages: msgs };
}

function formatToolUseAnthropic(ex) {
  const msgs = [];

  if (ex.context && isArray(ex.context)) {
    for (const ctx of ex.context) {
      msgs.push(makeAnthropicUserMessage(ctx.content || JSON.stringify(ctx)));
    }
  }

  const callId = generateCallId();
  const toolCall = ex.toolCall || {};

  msgs.push({
    role: "assistant",
    content: [
      ...(ex.assistantMessage?.content ? [{ type: "text", text: ex.assistantMessage.content }] : []),
      makeAnthropicToolUse(callId, toolCall.name || "unknown", toolCall.args || {}),
    ],
  });

  if (ex.toolResult) {
    const resultText = typeof ex.toolResult.data === "string"
      ? ex.toolResult.data
      : JSON.stringify(ex.toolResult.data || {});
    msgs.push({
      role: "user",
      content: [makeAnthropicToolResult(callId, resultText, ex.toolResult.isError)],
    });
  }

  return { messages: msgs };
}

function formatAgentWorkflowAnthropic(ex) {
  const msgs = [];

  msgs.push(makeAnthropicUserMessage(ex.goal));

  for (const step of (ex.steps || [])) {
    const callId = generateCallId();
    msgs.push({
      role: "assistant",
      content: [makeAnthropicToolUse(callId, step.toolName || "unknown", step.toolArgs || {})],
    });

    const resultText = typeof step.result === "string" ? step.result : JSON.stringify(step.result || {});
    msgs.push({
      role: "user",
      content: [makeAnthropicToolResult(callId, resultText, step.isError)],
    });
  }

  if (ex.finalResponse) {
    msgs.push(makeAnthropicAssistantMessage(ex.finalResponse.content || ""));
  }

  return { messages: msgs };
}

function formatErrorRecoveryAnthropic(ex) {
  const msgs = [];

  if (ex.context && isArray(ex.context)) {
    for (const ctx of ex.context) {
      msgs.push(makeAnthropicUserMessage(ctx.content || JSON.stringify(ctx)));
    }
  }

  const errorCallId = generateCallId();
  msgs.push({
    role: "assistant",
    content: [makeAnthropicToolUse(errorCallId, ex.errorToolCall?.name || "unknown", ex.errorToolCall?.args || {})],
  });
  msgs.push({
    role: "user",
    content: [makeAnthropicToolResult(errorCallId, JSON.stringify(ex.errorResult?.data || {}), true)],
  });

  const retryCallId = generateCallId();
  msgs.push({
    role: "assistant",
    content: [makeAnthropicToolUse(retryCallId, ex.recoveryToolCall?.name || "unknown", ex.recoveryToolCall?.args || {})],
  });
  msgs.push({
    role: "user",
    content: [makeAnthropicToolResult(retryCallId,
      typeof ex.recoveryResult?.data === "string" ? ex.recoveryResult.data : JSON.stringify(ex.recoveryResult?.data || {}),
      false)],
  });

  return { messages: msgs };
}

function formatDecisionPointAnthropic(ex) {
  const msgs = [];

  if (ex.context && isArray(ex.context)) {
    for (const ctx of ex.context) {
      msgs.push(makeAnthropicUserMessage(ctx.content || JSON.stringify(ctx)));
    }
  }

  msgs.push(makeAnthropicAssistantMessage(ex.reasoning || "Let me consider the options."));

  return { messages: msgs };
}

function formatGenericAnthropic(ex) {
  return {
    messages: [
      makeAnthropicUserMessage(JSON.stringify(ex)),
      makeAnthropicAssistantMessage(""),
    ],
  };
}

// ---------------------------------------------------------------------------
// toCompletionFormat
// ---------------------------------------------------------------------------

/**
 * Format extracted examples as prompt/completion pairs.
 *
 * Output shape:
 *   { prompt: string, completion: string }
 *
 * @param {Array<object>} examples - extracted training examples
 * @returns {Array<object>} array of { prompt, completion } objects
 */
function toCompletionFormat(examples) {
  const formatted = [];

  for (const ex of examples) {
    switch (ex.type) {
      case "conversation_turn":
        formatted.push(formatConversationTurnCompletion(ex));
        break;
      case "tool_use":
        formatted.push(formatToolUseCompletion(ex));
        break;
      case "agent_workflow":
        formatted.push(formatAgentWorkflowCompletion(ex));
        break;
      case "error_recovery":
        formatted.push(formatErrorRecoveryCompletion(ex));
        break;
      case "decision_point":
        formatted.push(formatDecisionPointCompletion(ex));
        break;
      default:
        formatted.push({ prompt: JSON.stringify(ex), completion: "" });
    }
  }

  return formatted.filter(Boolean);
}

function formatConversationTurnCompletion(ex) {
  const promptParts = [];

  if (ex.context && isArray(ex.context)) {
    for (const ctx of ex.context) {
      promptParts.push(`${ctx.role}: ${ctx.content || ""}`);
    }
  }

  promptParts.push(`user: ${ex.userMessage}`);

  const completionParts = [];
  for (const am of ex.assistantMessages) {
    completionParts.push(`assistant: ${am.content || ""}`);
    if (am.toolCalls && am.toolCalls.length > 0) {
      for (const tc of am.toolCalls) {
        const name = tc.name || tc.function?.name || "unknown";
        completionParts.push(`[tool_call: ${name}(${JSON.stringify(tc.args || tc.function?.arguments || {})})]`);
      }
    }
  }

  return {
    prompt: promptParts.join("\n"),
    completion: completionParts.join("\n"),
  };
}

function formatToolUseCompletion(ex) {
  const promptParts = [];

  if (ex.context && isArray(ex.context)) {
    for (const ctx of ex.context) {
      promptParts.push(`${ctx.role}: ${ctx.content || ""}`);
    }
  }

  promptParts.push(`assistant: ${ex.assistantMessage?.content || ""}`);

  const toolCall = ex.toolCall || {};
  const completionParts = [
    `[tool_call: ${toolCall.name || "unknown"}(${JSON.stringify(toolCall.args || {})})]`,
    `[tool_result: ${typeof ex.toolResult?.data === "string" ? ex.toolResult.data.slice(0, 500) : JSON.stringify(ex.toolResult?.data || {}).slice(0, 500)}]`,
  ];

  return {
    prompt: promptParts.join("\n"),
    completion: completionParts.join("\n"),
  };
}

function formatAgentWorkflowCompletion(ex) {
  const stepsText = (ex.steps || []).map((step, idx) => {
    const resultPreview = typeof step.result === "string"
      ? step.result.slice(0, 200)
      : JSON.stringify(step.result || {}).slice(0, 200);
    return `Step ${idx + 1}: ${step.toolName}(${JSON.stringify(step.toolArgs || {})}) -> ${resultPreview}${step.isError ? " [ERROR]" : ""}`;
  }).join("\n");

  return {
    prompt: `user: ${ex.goal}`,
    completion: stepsText + (ex.finalResponse ? `\nassistant: ${ex.finalResponse.content || ""}` : ""),
  };
}

function formatErrorRecoveryCompletion(ex) {
  return {
    prompt: `tool_call: ${ex.errorToolCall?.name || "unknown"}(${JSON.stringify(ex.errorToolCall?.args || {})})\ntool_result (error): ${JSON.stringify(ex.errorResult?.data || {})}`,
    completion: `assistant: Retrying...\n[tool_call: ${ex.recoveryToolCall?.name || "unknown"}(${JSON.stringify(ex.recoveryToolCall?.args || {})})]\n[tool_result (success): ${JSON.stringify(ex.recoveryResult?.data || {}).slice(0, 500)}]`,
  };
}

function formatDecisionPointCompletion(ex) {
  return {
    prompt: (ex.context || []).map((c) => `${c.role}: ${c.content || ""}`).join("\n"),
    completion: `assistant: ${ex.reasoning || ""}`,
  };
}

// ---------------------------------------------------------------------------
// toJsonl
// ---------------------------------------------------------------------------

/**
 * Serialize examples as newline-delimited JSON (JSONL).
 *
 * @param {Array<object>} examples - extracted or formatted training examples
 * @param {object} [options]
 * @param {boolean} [options.pretty=false] - pretty-print each JSON record
 * @returns {string} JSONL string
 */
function toJsonl(examples, options = {}) {
  const pretty = options.pretty === true;
  return examples
    .map((ex) => (pretty ? JSON.stringify(ex, null, 2) : JSON.stringify(ex)))
    .join("\n") + (examples.length > 0 ? "\n" : "");
}

// ---------------------------------------------------------------------------
// splitTrainValTest
// ---------------------------------------------------------------------------

/**
 * Split examples into training, validation, and test sets.
 *
 * @param {Array<object>} examples - array of training examples
 * @param {object} [ratios] - { train: 0.8, val: 0.1, test: 0.1 }
 * @returns {{ train: Array, val: Array, test: Array }}
 */
function splitTrainValTest(examples, ratios = {}) {
  if (!isArray(examples) || examples.length === 0) {
    return { train: [], val: [], test: [] };
  }

  const trainRatio = typeof ratios.train === "number" ? ratios.train : 0.8;
  const valRatio = typeof ratios.val === "number" ? ratios.val : 0.1;
  const testRatio = typeof ratios.test === "number" ? ratios.test : 0.1;
  const total = trainRatio + valRatio + testRatio;

  if (total <= 0 || total > 1.0001) {
    throw new Error(
      `Ratios must sum to <= 1.0 (train=${trainRatio}, val=${valRatio}, test=${testRatio}, total=${total})`
    );
  }

  // Shuffle deterministically using a seeded approach
  const shuffled = [...examples];
  fisherYatesShuffle(shuffled);

  const n = shuffled.length;
  const trainEnd = Math.round(n * trainRatio);
  const valEnd = Math.round(n * (trainRatio + valRatio));

  return {
    train: shuffled.slice(0, trainEnd),
    val: shuffled.slice(trainEnd, valEnd),
    test: shuffled.slice(valEnd),
  };
}

function fisherYatesShuffle(arr) {
  // Simple pseudo-random shuffle with a fixed seed for reproducibility
  let seed = 42;
  function rand() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---------------------------------------------------------------------------
// validateExamples
// ---------------------------------------------------------------------------

/**
 * Validate a set of training examples for format consistency, required
 * fields, and token limits.
 *
 * @param {Array<object>} examples - training examples to validate
 * @param {object} [options]
 * @param {number} [options.maxTokens=8000] - maximum estimated token count per example
 * @param {boolean} [options.strict=false] - throw on first error instead of collecting all
 * @returns {{ valid: boolean, errors: Array<{ index: number, message: string, example: object }>, warnings: Array<{ index: number, message: string }> }}
 */
function validateExamples(examples, options = {}) {
  const maxTokens = typeof options.maxTokens === "number" && options.maxTokens > 0 ? options.maxTokens : 8000;
  const strict = options.strict === true;
  const result = { valid: true, errors: [], warnings: [] };

  if (!isArray(examples)) {
    return { valid: false, errors: [{ index: -1, message: "examples must be an array", example: null }], warnings: [] };
  }

  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];

    if (strict && result.errors.length > 0) break;

    // Check it is an object
    if (!isObject(ex)) {
      result.valid = false;
      result.errors.push({ index: i, message: `example[${i}] is not an object (got ${typeof ex})`, example: ex });
      if (strict) break;
      continue;
    }

    // Check type field
    const exType = ex.type;
    if (!isNonEmptyString(exType)) {
      result.errors.push({ index: i, message: `example[${i}] is missing required field "type"`, example: ex });
      result.valid = false;
      if (strict) break;
    }

    // Check required fields by type
    const required = REQUIRED_FIELDS_BY_TYPE[exType] || [];
    for (const field of required) {
      if (ex[field] === undefined || ex[field] === null) {
        result.errors.push({
          index: i,
          message: `example[${i}] (type="${exType}") is missing required field "${field}"`,
          example: ex,
        });
        result.valid = false;
        if (strict) break;
      }
    }

    // Check type-specific constraints
    if (exType === "conversation_turn") {
      if (!isArray(ex.assistantMessages) || ex.assistantMessages.length === 0) {
        result.errors.push({
          index: i,
          message: `example[${i}] conversation_turn must have non-empty assistantMessages`,
          example: ex,
        });
        result.valid = false;
      }
    }

    if (exType === "agent_workflow") {
      if (!isArray(ex.steps) || ex.steps.length < 2) {
        result.errors.push({
          index: i,
          message: `example[${i}] agent_workflow must have at least 2 steps`,
          example: ex,
        });
        result.valid = false;
      }
    }

    if (exType === "error_recovery") {
      if (!ex.errorResult || ex.errorResult.isError !== true) {
        result.errors.push({
          index: i,
          message: `example[${i}] error_recovery must have errorResult with isError=true`,
          example: ex,
        });
        result.valid = false;
      }
    }

    // Token limit check (rough estimation: ~4 chars per token)
    const serialized = JSON.stringify(ex);
    const estimatedTokens = Math.ceil(serialized.length / 4);
    if (estimatedTokens > maxTokens) {
      result.warnings.push({
        index: i,
        message: `example[${i}] estimated ${estimatedTokens} tokens exceeds limit of ${maxTokens}`,
      });
    }

    // Content length sanity check
    checkContentLengths(ex, i, result);
  }

  return result;
}

function checkContentLengths(example, index, result) {
  const tooLongThreshold = 100000; // 100k chars

  function checkField(obj, path) {
    if (!obj) return;
    if (isString(obj) && obj.length > tooLongThreshold) {
      result.warnings.push({
        index,
        message: `example[${index}] field "${path}" is ${obj.length} chars (very large)`,
      });
    } else if (isArray(obj)) {
      obj.forEach((item, idx) => checkField(item, `${path}[${idx}]`));
    } else if (isObject(obj)) {
      Object.keys(obj).forEach((key) => checkField(obj[key], path ? `${path}.${key}` : key));
    }
  }

  checkField(example, "");
}

// ---------------------------------------------------------------------------
// module exports
// ---------------------------------------------------------------------------

module.exports = {
  toOpenAIChatFormat,
  toAnthropicMessagesFormat,
  toCompletionFormat,
  toJsonl,
  splitTrainValTest,
  validateExamples,
};
