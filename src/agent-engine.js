"use strict";

const { appendTranscriptEntry } = require("./memory");
const {
  buildSkillSystemPrompt,
  getSkillsForSession,
  matchSkillByIntent,
} = require("./skills/intent-matcher");
const { loadAllSkills, createSkillifySkill, recordSkillUsage } = require("./skills");

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
});

class AgentEngine {
  constructor(options = {}) {
    if (!options.session) {
      throw new TypeError("AgentEngine requires a session");
    }

    this.session = options.session;
    this.env = options.env || process.env;
    this.projectRoot = options.projectRoot || options.session.settings?.projectRoot || process.cwd();
  }

  sendMessage(content, options = {}) {
    return this._runUserMessage(String(content || ""), options);
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

    yield* this._runProviderTurn({
      content,
      userMessage: { role: "user", content },
      system: buildSkillSystemPrompt(skills),
      persistTranscript: options.persistTranscript !== false,
      interruptionTestEnabled: this.env.HAX_AGENT_TEST_INTERRUPT_AFTER_TEXT === "1",
    });
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
    const turnInputTokens = session.costTracker.inputTokens;
    const turnOutputTokens = session.costTracker.outputTokens;

    session.toolRegistry.resetSingleCallTracking();
    session.messages.push(userMessage);
    session.isStreaming = true;
    session.responseInterrupted = false;
    session.responseAbortController = abortController;
    session.responseRenderer = null;

    yield createEvent(AgentEventType.started, {
      userMessage,
      skill: serializeSkill(options.skill),
    }, session);

    try {
      for await (const chunk of session.provider.stream({
        messages: session.messages,
        toolRegistry: session.toolRegistry,
        signal: abortController.signal,
        system: options.system,
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

        if (event) {
          yield event;
        }

        if (chunk.type === "text" && options.interruptionTestEnabled) {
          session.responseInterrupted = true;
          yield createEvent(AgentEventType.interrupted, {
            reason: "test_interrupt_after_text",
          }, session);
          break;
        }
      }
    } catch (error) {
      if (session.responseInterrupted || error?.name === "AbortError") {
        session.messages.pop();
        yield createEvent(AgentEventType.interrupted, {
          reason: error?.name === "AbortError" ? "abort" : "interrupt",
        }, session);
        return;
      }

      session.messages.pop();
      yield createEvent(AgentEventType.failed, {
        error: serializeError(error),
        provider: serializeProvider(session.provider),
      }, session);
      return;
    } finally {
      session.isStreaming = false;
      session.responseAbortController = null;
      session.responseRenderer = null;
    }

    if (session.responseInterrupted) {
      session.messages.pop();
      return;
    }

    const turnUsage = {
      inputTokens: session.costTracker.inputTokens - turnInputTokens,
      outputTokens: session.costTracker.outputTokens - turnOutputTokens,
    };
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
      return createEvent(AgentEventType.toolStart, {
        ...withoutProviderType(chunk),
      }, session);
    }

    if (chunk.type === "tool_result") {
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

function serializeProvider(provider) {
  if (!provider) return null;

  return {
    name: provider.name,
    model: provider.model,
    apiUrl: provider.apiUrl,
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

function serializeError(error) {
  return {
    name: error?.name || "Error",
    code: error?.code || null,
    message: error?.message || String(error || "Unknown error"),
    stack: error?.stack || null,
  };
}

module.exports = {
  AgentEngine,
  AgentEventType,
};
