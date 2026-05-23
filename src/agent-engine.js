"use strict";

const { EventBus } = require("./events/bus");
const { appendTranscriptEntry } = require("./memory");
const { prepareContextWindow } = require("./context-window");
const { buildFileContext } = require("./file-context");
const { debug } = require("./debug");
const {
  buildSkillSystemPrompt,
  getSkillsForSession,
  matchSkillByIntent,
} = require("./skills/intent-matcher");
const { loadAllSkills, createSkillifySkill, recordSkillUsage } = require("./skills");
const {
  serializeProvider,
  serializeError,
  serializeSkill,
  serializeProviderIssue,
  isTerminalToolLimitReason,
} = require("./shared/serialization");

// Optional observability integration — gracefully degrades if the module is missing.
let _getMetrics = null;
let _getTracer = null;
let _setupObservability = null;
try {
  const obs = require("./infrastructure/observability-setup");
  _getMetrics = obs.getMetrics;
  _getTracer = obs.getTracer;
  _setupObservability = obs.setupObservability;
} catch (_) {
  // observability-setup not available — metrics and tracing become no-ops.
}

// Optional personality system — gracefully degrades if modules are missing.
let _applyProfile = null;
let _getProfileByName = null;
let _applyStyle = null;
let _getStyleByName = null;
let _applyModifier = null;
let _getModifierByName = null;
let _clearModifiers = null;
let _activeModifiers = null;
try {
  const profiles = require("./personality/profiles");
  _applyProfile = profiles.applyProfile;
  _getProfileByName = function getProfileByName(name) {
    if (!name || typeof name !== "string") return null;
    const lower = name.toLowerCase();
    const found = profiles.ALL_PROFILES.find(function (p) {
      return p.name.toLowerCase() === lower;
    });
    return found || null;
  };
} catch (_) { /* personality profiles not available */ }

try {
  const styles = require("./personality/response-styles");
  _applyStyle = styles.applyStyle;
  _getStyleByName = styles.getStyleByName;
} catch (_) { /* response styles not available */ }

try {
  const modifiers = require("./personality/behavior-modifiers");
  _applyModifier = modifiers.applyModifier;
  _getModifierByName = modifiers.getModifierByName;
  _clearModifiers = modifiers.clearModifiers;
  _activeModifiers = modifiers.activeModifiers;
} catch (_) { /* behavior modifiers not available */ }

// Optional context management (compaction, budget, importance scoring).
// Gracefully degrades if the module is missing.
let _createContextManager = null;
try {
  _createContextManager = require("./infrastructure/context-pipeline").createContextManager;
} catch (_) {
  // context-pipeline not available — context management becomes a no-op.
}

const AgentEventType = Object.freeze({
  started: "turn.started",
  completed: "turn.completed",
  interrupted: "turn.interrupted",
  failed: "turn.failed",
  messageDelta: "message.delta",
  thinking: "thinking",
  toolStart: "tool.start",
  toolResult: "tool.result",
  toolLimit: "tool.limit",
  usage: "usage",
  skillStart: "skill.start",
  skillMatched: "skill.matched",
  blocked: "turn.blocked",
});

const DEFAULT_GOAL_CONTINUATIONS = 5;

class AgentEngine {
  constructor(options = {}) {
    if (!options.session) {
      throw new TypeError("AgentEngine requires a session");
    }

    this.session = options.session;
    this.env = options.env || process.env;
    this.projectRoot = options.projectRoot || options.session.settings?.projectRoot || process.cwd();
    this.eventBus = options.eventBus || (this.session && this.session.eventBus) || new EventBus();
    this.inputPipeline = options.inputPipeline || null;

    // Bootstrap observability (optional — degrades gracefully).
    this._obs = null;
    try {
      if (_setupObservability) {
        this._obs = _setupObservability({
          sessionId: options.session.id,
        });
      }
    } catch (_) {
      // Observability setup failed — non-fatal.
    }

    // Wire personality / response-style settings onto the session so they
    // persist across turns.  Settings passed to the constructor take
    // precedence only when the session does not already have them.
    if (!this.session.personality) {
      this.session.personality = {};
    }
    if (options.personality && !this.session.personality.activeProfile) {
      this.session.personality.activeProfile = options.personality;
    }
    if (options.style && !this.session.personality.activeStyle) {
      this.session.personality.activeStyle = options.style;
    }
    if (Array.isArray(options.modifiers) && !this.session.personality.activeModifiers) {
      this.session.personality.activeModifiers = [...options.modifiers];
    }

    // Bootstrap context management (optional — degrades gracefully).
    this._contextManager = null;
    try {
      if (_createContextManager) {
        this._contextManager = _createContextManager({
          maxContextWindow:
            this.session.settings?.context?.windowTokens || undefined,
        });
      }
    } catch (_) {
      // Context manager setup failed — non-fatal.
    }

    // Stack of active tool spans, pushed on tool_start, popped on tool_result.
    this._toolSpanStack = [];
  }

  sendMessage(content, options = {}) {
    let text = String(content || "");

    // Process through safety pipeline if configured
    if (this.inputPipeline) {
      try {
        const result = this.inputPipeline.processInput(text);
        if (result.blocked) {
          // Emit blocked event and return early
          const iter = this._emitBlocked(result);
          iter.next(); // trigger immediate emission
          return iter;
        }
        text = result.cleaned || text;
      } catch (_) { /* pipeline is best-effort */ }
    }

    return this._runUserMessage(text, options);
  }

  invokeSkill(skill, args = [], options = {}) {
    return this._runSkill(skill, args, options);
  }

  interrupt() {
    const session = this.session;
    session.responseInterrupted = true;
    if (session.responseAbortController) {
      session.responseAbortController.abort();
    }
  }

  async *_runUserMessage(content, options = {}) {
    const session = this.session;
    const explicitSkill = findExplicitSkill(content, session, this.projectRoot);

    if (explicitSkill) {
      recordSkillUsage(explicitSkill.skill.name);
      yield* this._runSkill(explicitSkill.skill, explicitSkill.args, {
        ...options,
        invokedBy: "slash",
      });
      return;
    }

    const skills = getSkillsForSession(this.projectRoot, session.messages);
    const intentMatchedSkill = options.disableIntentMatching
      ? null
      : matchSkillByIntent(content, skills);

    if (intentMatchedSkill) {
      recordSkillUsage(intentMatchedSkill.name);
      yield createEvent(AgentEventType.skillMatched, {
        skill: serializeSkill(intentMatchedSkill),
        invokedBy: "intent",
      }, session);
      yield* this._runSkill(intentMatchedSkill, [], {
        ...options,
        invokedBy: "intent",
      });
      return;
    }

    let completion = null;
    for await (const event of this._runProviderTurn({
      content,
      userMessage: { role: "user", content },
      system: buildSkillSystemPrompt(skills),
      persistTranscript: options.persistTranscript !== false,
      interruptionTestEnabled: this.env.HAX_AGENT_TEST_INTERRUPT_AFTER_TEXT === "1",
    })) {
      if (event.type === AgentEventType.completed) completion = event;
      yield event;
    }

    if (!shouldContinueGoal(session, completion?.assistantMessage?.content)) {
      return;
    }

    const maxContinuations = getGoalContinuationLimit(session);
    for (let index = 0; index < maxContinuations; index += 1) {
      const continuationContent = [
        "[goal continuation]",
        `Active goal: ${session.goal.text}`,
        "Continue working toward the active goal. Use tools and verification where useful. If the goal is complete, state the evidence and end with GOAL_STATUS: complete.",
      ].join("\n");

      let continuationCompletion = null;
      for await (const event of this._runProviderTurn({
        content: continuationContent,
        userMessage: { role: "user", content: continuationContent, internal: true },
        system: buildSkillSystemPrompt(skills),
        persistTranscript: false,
        interruptionTestEnabled: false,
      })) {
        if (event.type === AgentEventType.completed) continuationCompletion = event;
        yield event;
      }

      if (!shouldContinueGoal(session, continuationCompletion?.assistantMessage?.content)) {
        return;
      }
    }
  }

  async *_runSkill(skill, args = [], options = {}) {
    const session = this.session;

    yield createEvent(AgentEventType.skillStart, {
      skill: serializeSkill(skill),
      args: [...args],
      invokedBy: options.invokedBy || "manual",
    }, session);

    try {
      const promptBlocks = await skill.getPromptForCommand(args);
      const skillContent = promptBlocks.map((block) => block.text).join("\n");
      const otherSkills = getSkillsForSession(this.projectRoot, session.messages)
        .filter((candidate) => candidate.name !== skill.name);

      yield* this._runProviderTurn({
        content: skillContent,
        userMessage: { role: "user", content: skillContent },
        system: buildSkillSystemPrompt(otherSkills),
        persistTranscript: options.persistTranscript !== false,
        skill,
        interruptionTestEnabled: false,
      });
    } catch (error) {
      yield createEvent(AgentEventType.failed, {
        error: serializeError(error),
        skill: serializeSkill(skill),
      }, session);
    }
  }

  async *_runProviderTurn(options) {
    const session = this.session;
    const userMessage = options.userMessage;
    const abortController = new AbortController();
    let assistantText = "";
    let terminalProviderIssue = null;
    const turnInputTokens = session.costTracker.inputTokens;
    const turnOutputTokens = session.costTracker.outputTokens;

    session.toolRegistry.resetSingleCallTracking();

    // === CONTEXT PIPELINE: pre-turn compaction & budget check ===
    this._contextManager?.preTurn(session, { content: options.content });

    session.messages.push(userMessage);
    session.isStreaming = true;
    session.responseInterrupted = false;
    session.responseAbortController = abortController;
    session.responseRenderer = null;

    // Increment agent.turns counter (observability).
    try {
      const metrics = _getMetrics ? _getMetrics() : null;
      if (metrics) {
        metrics.get("agent.turns")?.inc();
      }
    } catch (_) { /* no-op */ }

    // Reset per-turn tool-span stack.
    this._toolSpanStack = [];

    const promptContext = await buildTurnSystemPrompt({
      baseSystem: options.system,
      settings: session.settings,
      session,
      projectRoot: this.projectRoot,
      query: options.content,
    });
    const contextWindow = prepareContextWindow({
      messages: session.messages,
      system: promptContext.system,
      settings: session.settings,
      model: session.provider?.model,
      outputTokens: options.maxTokens || session.provider?.maxTokens,
    });
    // Persist stats so the status line can display a context-usage meter
    session.contextStats = contextWindow.stats;

    yield createEvent(AgentEventType.started, {
      userMessage,
      skill: serializeSkill(options.skill),
      context: {
        ...contextWindow.stats,
        fileContext: promptContext.fileContext.stats,
      },
    }, session);

    this.eventBus.emit('agent:turn_start', {
      sessionId: session.id,
      content: options.content,
      skill: options.skill ? options.skill.name : null,
    });

    try {
      const maxToolTurns = session.settings?.agent?.maxTurns
        || session.settings?.agent?.maxToolTurns
        || 25;
      for await (const chunk of session.provider.stream({
        messages: contextWindow.messages,
        toolRegistry: session.toolRegistry,
        signal: abortController.signal,
        system: contextWindow.system,
        context: contextWindow.stats,
        maxToolTurns,
      })) {
        if (session.responseInterrupted) break;

        const event = this._applyProviderChunk(chunk, {
          assistantText,
          turnInputTokens,
          turnOutputTokens,
        });

        if (chunk.type === "text") {
          assistantText += chunk.delta;
        }

        if (chunk.type === "tool_limit" && isTerminalToolLimitReason(chunk.reason)) {
          terminalProviderIssue = {
            reason: chunk.reason,
            maxToolTurns: chunk.maxToolTurns,
          };
        }

        if (event) {
          yield event;
        }

        if (chunk.type === "text" && options.interruptionTestEnabled) {
          session.responseInterrupted = true;
          yield createEvent(AgentEventType.interrupted, {
            reason: "test_interrupt_after_text",
          }, session);
          this.eventBus.emit('agent:interrupt', {
            sessionId: session.id,
            reason: "test_interrupt_after_text",
          });
          break;
        }
      }
    } catch (error) {
      if (session.responseInterrupted || error?.name === "AbortError") {
        session.messages.pop();
        yield createEvent(AgentEventType.interrupted, {
          reason: error?.name === "AbortError" ? "abort" : "interrupt",
        }, session);
        this.eventBus.emit('agent:interrupt', {
          sessionId: session.id,
          reason: error?.name === "AbortError" ? "abort" : "interrupt",
        });
        this._contextManager?.postTurn(session, { status: 'interrupted' });
        return;
      }

      session.messages.pop();
      yield createEvent(AgentEventType.failed, {
        error: serializeError(error),
        provider: serializeProvider(session.provider),
      }, session);
      this.eventBus.emit('agent:error', {
        sessionId: session.id,
        error: error?.message || String(error),
        provider: serializeProvider(session.provider),
      });
      this._contextManager?.postTurn(session, { status: 'error' });
      return;
    } finally {
      session.isStreaming = false;
      session.responseAbortController = null;
      session.responseRenderer = null;
    }

    if (session.responseInterrupted) {
      session.messages.pop();
      this._contextManager?.postTurn(session, { status: 'interrupted' });
      return;
    }

    const turnUsage = {
      inputTokens: session.costTracker.inputTokens - turnInputTokens,
      outputTokens: session.costTracker.outputTokens - turnOutputTokens,
    };

    if (terminalProviderIssue) {
      session.messages.pop();
      yield createEvent(AgentEventType.failed, {
        error: serializeProviderIssue(terminalProviderIssue),
        partialAssistantMessage: { role: "assistant", content: assistantText },
        usage: turnUsage,
      }, session);
      this.eventBus.emit('agent:error', {
        sessionId: session.id,
        error: terminalProviderIssue.reason || 'tool_limit',
        terminal: true,
      });
      this._contextManager?.postTurn(session, {
        status: 'error',
        usage: turnUsage,
      });
      return;
    }

    const assistantMessage = { role: "assistant", content: assistantText };

    session.messages.push(assistantMessage);

    if (options.persistTranscript) {
      appendTranscriptEntry(session.id, userMessage, session.settings);
      appendTranscriptEntry(session.id, assistantMessage, session.settings);
    }

    yield createEvent(AgentEventType.completed, {
      assistantMessage,
      usage: turnUsage,
    }, session);

    this.eventBus.emit('agent:turn_end', {
      sessionId: session.id,
      usage: turnUsage,
    });

    this._contextManager?.postTurn(session, {
      status: 'completed',
      usage: turnUsage,
    });
  }

  _applyProviderChunk(chunk, state) {
    const session = this.session;

    if (chunk.type === "text") {
      return createEvent(AgentEventType.messageDelta, {
        delta: chunk.delta,
      }, session);
    }

    if (chunk.type === "thinking") {
      return createEvent(AgentEventType.thinking, {
        ...withoutProviderType(chunk),
      }, session);
    }

    if (chunk.type === "tool_start") {
      session.costTracker.addToolCall();
      this.eventBus.emit('agent:tool_call', {
        sessionId: session.id,
        toolName: chunk.name,
        toolArgs: chunk.args,
      });

      // Start a tracer span for this tool call.
      try {
        const tracer = _getTracer ? _getTracer() : null;
        if (tracer) {
          const span = tracer.startSpan(`tool.${chunk.name || "unknown"}`, {
            tags: { "tool.name": chunk.name || "unknown" },
          });
          if (span) {
            this._toolSpanStack.push(span);
          }
        }
      } catch (_) { /* no-op */ }

      return createEvent(AgentEventType.toolStart, {
        ...withoutProviderType(chunk),
      }, session);
    }

    if (chunk.type === "tool_result") {
      this.eventBus.emit('agent:tool_result', {
        sessionId: session.id,
        toolName: chunk.name,
        toolResult: chunk.result,
      });

      // Finish the tracer span for this tool call.
      try {
        const span = this._toolSpanStack.pop();
        if (span) {
          if (chunk.isError) {
            span.setTag("error", true);
            span.addEvent("tool.error", { toolName: chunk.name });
          }
          span.finish();
        }
      } catch (_) { /* no-op */ }

      return createEvent(AgentEventType.toolResult, {
        ...withoutProviderType(chunk),
      }, session);
    }

    if (chunk.type === "tool_limit") {
      return createEvent(AgentEventType.toolLimit, {
        ...withoutProviderType(chunk),
      }, session);
    }

    if (chunk.type === "usage") {
      session.costTracker.addUsage(chunk, session.provider.model);
      return createEvent(AgentEventType.usage, {
        ...withoutProviderType(chunk),
        turn: {
          inputTokens: session.costTracker.inputTokens - state.turnInputTokens,
          outputTokens: session.costTracker.outputTokens - state.turnOutputTokens,
        },
      }, session);
    }

    return null;
  }

  /**
   * Emit a blocked event when the safety pipeline rejects input.
   * Returns an async generator so the return type matches _runUserMessage.
   * @param {{ warnings: string[], threatLevel?: string }} result
   */
  async *_emitBlocked(result) {
    yield createEvent(AgentEventType.blocked, {
      reason: 'safety_pipeline',
      threatLevel: result.threatLevel || 'NONE',
      warnings: result.warnings || [],
    }, this.session);
  }
}

async function buildTurnSystemPrompt(options = {}) {
  const settings = options.settings || {};
  const blocks = [];
  const customInstructions = String(settings.instructions?.custom || "").trim();
  let fileContext = createEmptyFileContext();

  if (options.baseSystem) {
    blocks.push(String(options.baseSystem).trim());
  }

  if (customInstructions) {
    blocks.push([
      "<custom-instructions>",
      customInstructions,
      "</custom-instructions>",
    ].join("\n"));
  }

  const activeGoal = options.session?.goal?.enabled && options.session.goal.text
    ? String(options.session.goal.text).trim()
    : "";
  if (activeGoal) {
    blocks.push([
      "<active-goal>",
      `The user set a persistent goal for this session: ${activeGoal}`,
      "Keep working toward this goal across turns. Do not treat the current reply as finished until you have made concrete progress and verified the result where possible.",
      "At the end of each response, include a final line exactly as one of: GOAL_STATUS: complete, GOAL_STATUS: continue, or GOAL_STATUS: blocked.",
      "Use GOAL_STATUS: complete only when the goal is satisfied and you have stated the evidence. Use GOAL_STATUS: blocked only when you cannot proceed without new user input. The user can disable this mode with /goal clear.",
      "</active-goal>",
    ].join("\n"));
  }

  try {
    fileContext = await buildFileContext({
      settings,
      projectRoot: options.projectRoot,
      query: options.query,
    });
  } catch (error) {
    fileContext = {
      ...createEmptyFileContext(),
      stats: {
        ...createEmptyFileContext().stats,
        error: error?.message || String(error),
      },
    };
  }

  if (fileContext.systemPrompt) {
    blocks.push(fileContext.systemPrompt);
  }

  let system = blocks.filter(Boolean).join("\n\n");

  // Apply personality profile, response style, and behavior modifiers.
  // These are session-persistent settings that shape the agent's behavior
  // and output style for every turn.
  const session = options.session;
  if (session && session.personality) {
    const profileName = session.personality.activeProfile;
    const styleName = session.personality.activeStyle;
    const activeMods = session.personality.activeModifiers;

    if (profileName && _getProfileByName) {
      const profile = _getProfileByName(profileName);
      if (profile && _applyProfile) {
        system = _applyProfile(system, profile);
      }
    }

    if (styleName && _getStyleByName) {
      const style = _getStyleByName(styleName);
      if (style && _applyStyle) {
        system = _applyStyle(system, style);
      }
    }

    if (Array.isArray(activeMods) && activeMods.length > 0 && _applyModifier) {
      for (let i = 0; i < activeMods.length; i += 1) {
        system = _applyModifier(system, activeMods[i]);
      }
    }
  }

  return {
    system,
    fileContext,
  };
}

function withoutProviderType(chunk) {
  const { type, ...payload } = chunk;
  return payload;
}

function findExplicitSkill(content, session, projectRoot) {
  const skillMatch = String(content || "").match(/^\/(\S+)(?:\s+(.*))?$/);
  if (!skillMatch) return null;

  const skillName = skillMatch[1];
  const args = skillMatch[2] ? skillMatch[2].split(/\s+/) : [];
  const skills = loadAllSkills(projectRoot || process.cwd());
  const skillify = createSkillifySkill(session.messages);
  const allSkills = [skillify, ...skills];
  const skill = allSkills.find((candidate) => candidate.name === skillName && !candidate.isHidden);

  return skill ? { skill, args } : null;
}

function createEvent(type, payload, session) {
  return {
    type,
    sessionId: session.id,
    timestamp: new Date().toISOString(),
    provider: serializeProvider(session.provider),
    status: {
      isStreaming: session.isStreaming,
      cost: session.costTracker.getCost(session.provider?.model),
      turns: session.costTracker.turnCount,
      toolCalls: session.costTracker.toolCallCount,
      inputTokens: session.costTracker.inputTokens,
      outputTokens: session.costTracker.outputTokens,
      tokens: session.costTracker.inputTokens + session.costTracker.outputTokens,
    },
    ...payload,
  };
}

function createEmptyFileContext() {
  return {
    files: [],
    stats: {
      indexedFiles: 0,
      matchedFiles: 0,
      includedFiles: 0,
      bytes: 0,
    },
    systemPrompt: "",
  };
}

function shouldContinueGoal(session, assistantText = "") {
  if (!session.goal?.enabled || !session.goal.text) return false;
  const status = readGoalStatus(assistantText);
  return status !== "complete" && status !== "blocked";
}

function readGoalStatus(text = "") {
  const match = String(text || "").match(/GOAL_STATUS:\s*(complete|continue|blocked)\b/i);
  return match ? match[1].toLowerCase() : "continue";
}

function getGoalContinuationLimit(session) {
  const explicit = Number(session.goal?.maxContinuations);
  if (Number.isInteger(explicit) && explicit >= 0) return explicit;
  return DEFAULT_GOAL_CONTINUATIONS;
}

module.exports = {
  AgentEngine,
  AgentEventType,
  buildTurnSystemPrompt,
  readGoalStatus,
};
