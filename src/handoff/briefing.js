"use strict";

const { HANDOFF_REASONS } = require("./protocol");

class HandoffBriefing {
  constructor(options = {}) {
    this._maxHistoryItems = options.maxHistoryItems || 20;
    this._maxOptionItems = options.maxOptionItems || 10;
    this._includeTimestamps = options.includeTimestamps !== false;
    this._locale = options.locale || "en";
  }

  /**
   * Generate a comprehensive briefing for the human based on a handoff.
   *
   * @param {object} handoff - The handoff record
   * @param {object} [sessionData] - Optional session context
   * @returns {object} Structured briefing
   */
  generateBriefing(handoff, sessionData = null) {
    if (!handoff) {
      throw new Error("handoff is required");
    }

    const briefing = {
      handoffId: handoff.id,
      generatedAt: new Date().toISOString(),
      summary: this._buildSummary(handoff, sessionData),
      currentTask: this._extractCurrentTask(handoff, sessionData),
      blocker: this.explainBlocker(handoff),
      whatTried: this._extractWhatTried(handoff, sessionData),
      whatNeeded: this._determineWhatNeeded(handoff),
      options: this.listOptions(handoff),
      filesModified: this._extractModifiedFiles(sessionData),
      urgency: this._assessUrgency(handoff),
      historyContext: this.summarizeContext(sessionData),
    };

    return briefing;
  }

  /**
   * Summarize what has happened so far in the session.
   *
   * @param {object} [session] - Session data object
   * @returns {object} Summary of session history
   */
  summarizeContext(session) {
    if (!session) {
      return { available: false, message: "No session data provided" };
    }

    const summary = {
      available: true,
      sessionId: session.id || "unknown",
      turnCount: session.costTracker?.turnCount || (session.messages ? session.messages.length : 0),
      elapsedTime: session.getElapsedTime ? session.getElapsedTime() : "unknown",
      estimatedCost: session.costTracker
        ? "$" + (session.costTracker.getCost(session.provider?.model) || 0).toFixed(4)
        : "unknown",
      recentActivity: [],
      goal: session.goal?.text || null,
    };

    // Extract recent messages
    if (session.messages && Array.isArray(session.messages)) {
      const recentMessages = session.messages.slice(-this._maxHistoryItems);
      for (const msg of recentMessages) {
        summary.recentActivity.push({
          role: msg.role || "unknown",
          content: this._truncate(String(msg.content || ""), 200),
          timestamp: this._includeTimestamps ? msg.timestamp || null : null,
        });
      }
    }

    // Extract tool calls
    if (session.costTracker) {
      summary.toolCallCount = session.costTracker.toolCallCount || 0;
      summary.inputTokens = session.costTracker.inputTokens || 0;
      summary.outputTokens = session.costTracker.outputTokens || 0;
    }

    // Modified files
    if (session.modifiedFiles && session.modifiedFiles instanceof Set) {
      summary.filesModified = Array.from(session.modifiedFiles);
    }

    return summary;
  }

  /**
   * Explain what the agent is stuck on in human-readable form.
   *
   * @param {object} handoff - The handoff record
   * @returns {object} Blocker explanation
   */
  explainBlocker(handoff) {
    if (!handoff) {
      throw new Error("handoff is required");
    }

    const blocker = {
      reason: handoff.reason,
      type: this._categorizeBlocker(handoff.reason),
      description: this._describeBlocker(handoff),
      severity: this._blockerSeverity(handoff.reason),
    };

    // Extract problem details from context
    if (handoff.context) {
      if (handoff.context.blockerDescription) {
        blocker.problem = handoff.context.blockerDescription;
      }
      if (handoff.context.error) {
        blocker.error = {
          message: handoff.context.error.message || String(handoff.context.error),
          code: handoff.context.error.code || null,
          stack: handoff.context.error.stack || null,
        };
      }
      if (handoff.context.stuckAt) {
        blocker.stuckAt = handoff.context.stuckAt;
      }
      if (handoff.context.attemptCount) {
        blocker.attempts = handoff.context.attemptCount;
      }
    }

    return blocker;
  }

  /**
   * List possible actions the human can take to resolve the handoff.
   *
   * @param {object} handoff - The handoff record
   * @returns {object[]} Array of option objects
   */
  listOptions(handoff) {
    if (!handoff) {
      throw new Error("handoff is required");
    }

    const options = [];

    switch (handoff.reason) {
      case HANDOFF_REASONS.BLOCKED:
        options.push(
          {
            id: "unblock",
            label: "Provide instructions to unblock",
            description: "Give the agent specific guidance on how to proceed past the blocker",
            requiresInput: true,
          },
          {
            id: "skip",
            label: "Skip the current task",
            description: "Tell the agent to skip this task and move to the next one",
            requiresInput: false,
          },
          {
            id: "retry",
            label: "Retry with different approach",
            description: "Ask the agent to try an alternative approach",
            requiresInput: true,
          },
          {
            id: "takeover",
            label: "Take over manually",
            description: "The human will handle this task directly",
            requiresInput: false,
          }
        );
        break;

      case HANDOFF_REASONS.APPROVAL_NEEDED:
        options.push(
          {
            id: "approve",
            label: "Approve",
            description: "Approve the agent's proposed action and let it proceed",
            requiresInput: false,
          },
          {
            id: "approve_with_changes",
            label: "Approve with changes",
            description: "Approve but with modified instructions",
            requiresInput: true,
          },
          {
            id: "deny",
            label: "Deny",
            description: "Reject the proposed action and provide alternative direction",
            requiresInput: true,
          },
          {
            id: "request_more_info",
            label: "Request more information",
            description: "Ask the agent to provide more details before deciding",
            requiresInput: true,
          }
        );
        break;

      case HANDOFF_REASONS.UNCERTAIN:
        options.push(
          {
            id: "clarify",
            label: "Provide clarification",
            description: "Help the agent understand the ambiguous situation",
            requiresInput: true,
          },
          {
            id: "decide",
            label: "Make the decision",
            description: "Make a definitive choice on the agent's behalf",
            requiresInput: true,
          },
          {
            id: "explore_all",
            label: "Explore all options",
            description: "Ask the agent to enumerate and evaluate all possibilities",
            requiresInput: false,
          },
          {
            id: "conservative",
            label: "Choose safest approach",
            description: "Instruct the agent to take the most conservative path",
            requiresInput: false,
          }
        );
        break;

      case HANDOFF_REASONS.LIMIT_REACHED:
        options.push(
          {
            id: "extend",
            label: "Extend limits",
            description: "Increase the agent's resource limits and let it continue",
            requiresInput: true,
          },
          {
            id: "summarize",
            label: "Summarize and continue",
            description: "Ask the agent to summarize progress and continue in a new context",
            requiresInput: false,
          },
          {
            id: "split",
            label: "Split into sub-tasks",
            description: "Break the remaining work into smaller, manageable chunks",
            requiresInput: true,
          },
          {
            id: "pause",
            label: "Pause and schedule",
            description: "Pause the task and schedule it for later completion",
            requiresInput: false,
          }
        );
        break;

      case HANDOFF_REASONS.ESCALATION:
        options.push(
          {
            id: "acknowledge",
            label: "Acknowledge escalation",
            description: "Accept the escalation and begin handling it",
            requiresInput: false,
          },
          {
            id: "redirect",
            label: "Redirect to specialist",
            description: "Route the issue to a more specialized agent or team",
            requiresInput: true,
          },
          {
            id: "downgrade",
            label: "Downgrade priority",
            description: "Reduce the urgency and handle as a normal task",
            requiresInput: false,
          },
          {
            id: "emergency_stop",
            label: "Emergency stop",
            description: "Immediately halt all agent operations",
            requiresInput: false,
          }
        );
        break;

      case HANDOFF_REASONS.CHECKPOINT:
        options.push(
          {
            id: "review_and_continue",
            label: "Review and continue",
            description: "Review the checkpoint and let the agent proceed",
            requiresInput: false,
          },
          {
            id: "review_and_adjust",
            label: "Review with adjustments",
            description: "Review the checkpoint and provide adjusted instructions",
            requiresInput: true,
          },
          {
            id: "rollback",
            label: "Rollback to earlier state",
            description: "Revert to a previous checkpoint and restart from there",
            requiresInput: true,
          },
          {
            id: "finalize",
            label: "Finalize and complete",
            description: "Accept the current state as final and end the task",
            requiresInput: false,
          }
        );
        break;

      default:
        options.push(
          {
            id: "generic_resolve",
            label: "Resolve",
            description: "Provide a general resolution",
            requiresInput: true,
          },
          {
            id: "dismiss",
            label: "Dismiss",
            description: "Dismiss the handoff and return to autonomous operation",
            requiresInput: false,
          }
        );
        break;
    }

    return options.slice(0, this._maxOptionItems);
  }

  /**
   * Generate context for the agent to resume operation after human response.
   *
   * @param {object} handoff - The handoff record
   * @param {object} response - The human's response
   * @returns {object} Resume context for the agent
   */
  generateResumeContext(handoff, response) {
    if (!handoff) {
      throw new Error("handoff is required");
    }
    if (!response) {
      throw new Error("response is required");
    }

    const resumeContext = {
      handoffId: handoff.id,
      generatedAt: new Date().toISOString(),
      originalReason: handoff.reason,
      humanDecision: response.decision || response.action || response.option || null,
      instructions: response.instructions || null,
      approval: response.approved !== false,
      additionalContext: response.context || response.additionalContext || {},
      warnings: [],
      nextSteps: [],
    };

    // Generate warnings based on the response type
    if (response.approved === false) {
      resumeContext.warnings.push(
        "Human denied the proposed action. Do not retry without explicit instruction."
      );
    }

    if (response.overrideSafety === true) {
      resumeContext.warnings.push(
        "Human overrode safety checks. Proceed with caution."
      );
    }

    // Generate next steps based on the reason and response
    switch (handoff.reason) {
      case HANDOFF_REASONS.BLOCKED:
        resumeContext.nextSteps.push(
          "Apply the provided instructions to unblock the task",
          "Report progress after the next step"
        );
        break;

      case HANDOFF_REASONS.APPROVAL_NEEDED:
        if (response.approved) {
          resumeContext.nextSteps.push(
            "Proceed with the approved action",
            "Report results upon completion"
          );
        } else {
          resumeContext.nextSteps.push(
            "Follow the alternative instructions provided",
            "Do not attempt the denied action again"
          );
        }
        break;

      case HANDOFF_REASONS.UNCERTAIN:
        resumeContext.nextSteps.push(
          "Apply the human's decision to resolve ambiguity",
          "Proceed with renewed confidence"
        );
        break;

      case HANDOFF_REASONS.LIMIT_REACHED:
        resumeContext.nextSteps.push(
          "Continue with the updated limits or approach",
          "Monitor resource usage and report if limits are approached again"
        );
        break;

      case HANDOFF_REASONS.ESCALATION:
        resumeContext.nextSteps.push(
          "Follow the escalation resolution instructions",
          "Report status after each major action"
        );
        break;

      case HANDOFF_REASONS.CHECKPOINT:
        resumeContext.nextSteps.push(
          "Continue from the confirmed checkpoint",
          "Report at the next milestone"
        );
        break;

      default:
        resumeContext.nextSteps.push(
          "Resume operation with the provided guidance"
        );
        break;
    }

    return resumeContext;
  }

  // ---- Internal ----

  _buildSummary(handoff, sessionData) {
    const agent = handoff.agentId || "unknown-agent";
    const reason = (handoff.reason || "UNKNOWN").toLowerCase().replace(/_/g, " ");
    const time = handoff.requestedAt || new Date().toISOString();

    let summary = `Agent "${agent}" requested a handoff at ${time} due to: ${reason}.`;

    if (sessionData?.goal?.text) {
      summary += ` Current goal: "${sessionData.goal.text}".`;
    }

    if (handoff.context?.message) {
      summary += ` ${handoff.context.message}`;
    }

    return summary;
  }

  _extractCurrentTask(handoff, sessionData) {
    const task = {
      description: handoff.context?.currentTask || handoff.context?.task || null,
      status: handoff.context?.taskStatus || "in_progress",
      progress: handoff.context?.progress || null,
    };

    if (!task.description && sessionData?.goal?.text) {
      task.description = sessionData.goal.text;
    }

    if (!task.description && sessionData?.goal?.enabled) {
      task.description = "Working on goal-based task";
    }

    return task;
  }

  _extractWhatTried(handoff, sessionData) {
    const tried = [];

    if (handoff.context?.whatTried && Array.isArray(handoff.context.whatTried)) {
      for (const attempt of handoff.context.whatTried) {
        tried.push(typeof attempt === "string" ? attempt : attempt.description || String(attempt));
      }
    } else if (handoff.context?.whatTried) {
      tried.push(String(handoff.context.whatTried));
    }

    // Infer from session if available
    if (tried.length === 0 && sessionData?.messages) {
      const lastMessages = sessionData.messages.slice(-5);
      for (const msg of lastMessages) {
        if (msg.role === "assistant" && msg.content) {
          tried.push(this._truncate(String(msg.content), 150));
        }
      }
    }

    if (tried.length === 0) {
      tried.push("No specific attempt details available");
    }

    return tried;
  }

  _determineWhatNeeded(handoff) {
    const needed = {
      type: this._neededType(handoff.reason),
      specifics: handoff.context?.whatNeeded || null,
    };

    if (!needed.specifics) {
      switch (handoff.reason) {
        case HANDOFF_REASONS.BLOCKED:
          needed.specifics = "Guidance on how to proceed past the current obstacle";
          break;
        case HANDOFF_REASONS.APPROVAL_NEEDED:
          needed.specifics = "Human approval to proceed with the proposed action";
          break;
        case HANDOFF_REASONS.UNCERTAIN:
          needed.specifics = "Clarification or a decision from a human operator";
          break;
        case HANDOFF_REASONS.LIMIT_REACHED:
          needed.specifics = "Extended limits or a revised approach to continue within constraints";
          break;
        case HANDOFF_REASONS.ESCALATION:
          needed.specifics = "Higher-level intervention to handle a critical situation";
          break;
        case HANDOFF_REASONS.CHECKPOINT:
          needed.specifics = "Human review and confirmation before proceeding further";
          break;
        default:
          needed.specifics = "Human intervention to resolve the situation";
          break;
      }
    }

    return needed;
  }

  _extractModifiedFiles(sessionData) {
    if (!sessionData) {
      return [];
    }

    const files = [];

    if (sessionData.modifiedFiles instanceof Set) {
      for (const f of sessionData.modifiedFiles) {
        files.push(String(f));
      }
    } else if (Array.isArray(sessionData.modifiedFiles)) {
      for (const f of sessionData.modifiedFiles) {
        files.push(String(f));
      }
    }

    return files;
  }

  _assessUrgency(handoff) {
    const urgencyLevels = {
      [HANDOFF_REASONS.ESCALATION]: "critical",
      [HANDOFF_REASONS.BLOCKED]: "high",
      [HANDOFF_REASONS.APPROVAL_NEEDED]: "medium",
      [HANDOFF_REASONS.UNCERTAIN]: "medium",
      [HANDOFF_REASONS.LIMIT_REACHED]: "low",
      [HANDOFF_REASONS.CHECKPOINT]: "low",
    };

    return {
      level: urgencyLevels[handoff.reason] || "medium",
      escalated: handoff.metadata?.escalationLevel > 0 || false,
      timeSensitive: handoff.context?.urgent === true,
      requestedAt: handoff.requestedAt,
    };
  }

  _categorizeBlocker(reason) {
    const categories = {
      [HANDOFF_REASONS.BLOCKED]: "technical",
      [HANDOFF_REASONS.APPROVAL_NEEDED]: "authorization",
      [HANDOFF_REASONS.UNCERTAIN]: "knowledge_gap",
      [HANDOFF_REASONS.LIMIT_REACHED]: "resource",
      [HANDOFF_REASONS.ESCALATION]: "process",
      [HANDOFF_REASONS.CHECKPOINT]: "process",
    };
    return categories[reason] || "unknown";
  }

  _describeBlocker(handoff) {
    const descriptions = {
      [HANDOFF_REASONS.BLOCKED]: "The agent encountered an obstacle it cannot resolve autonomously",
      [HANDOFF_REASONS.APPROVAL_NEEDED]: "The agent needs human authorization before proceeding",
      [HANDOFF_REASONS.UNCERTAIN]: "The agent is uncertain about the correct course of action",
      [HANDOFF_REASONS.LIMIT_REACHED]: "The agent has reached its operational limits",
      [HANDOFF_REASONS.ESCALATION]: "The situation has been escalated for human attention",
      [HANDOFF_REASONS.CHECKPOINT]: "The agent has reached a checkpoint and requires review",
    };
    return descriptions[handoff.reason] || "Unknown blocker condition";
  }

  _blockerSeverity(reason) {
    const severities = {
      [HANDOFF_REASONS.ESCALATION]: 4,
      [HANDOFF_REASONS.BLOCKED]: 3,
      [HANDOFF_REASONS.APPROVAL_NEEDED]: 2,
      [HANDOFF_REASONS.UNCERTAIN]: 2,
      [HANDOFF_REASONS.LIMIT_REACHED]: 2,
      [HANDOFF_REASONS.CHECKPOINT]: 1,
    };
    return severities[reason] || 2;
  }

  _neededType(reason) {
    const types = {
      [HANDOFF_REASONS.BLOCKED]: "guidance",
      [HANDOFF_REASONS.APPROVAL_NEEDED]: "authorization",
      [HANDOFF_REASONS.UNCERTAIN]: "decision",
      [HANDOFF_REASONS.LIMIT_REACHED]: "resource_extension",
      [HANDOFF_REASONS.ESCALATION]: "intervention",
      [HANDOFF_REASONS.CHECKPOINT]: "review",
    };
    return types[reason] || "intervention";
  }

  _truncate(text, maxLength) {
    if (!text || text.length <= maxLength) return text || "";
    return text.slice(0, maxLength - 3) + "...";
  }
}

module.exports = {
  HandoffBriefing,
};
