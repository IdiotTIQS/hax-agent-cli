"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { HandoffBriefing } = require("../../src/handoff/briefing");
const { HANDOFF_REASONS } = require("../../src/handoff/protocol");

describe("HandoffBriefing", () => {
  let briefing;
  let sampleHandoff;
  let sampleSession;

  beforeEach(() => {
    briefing = new HandoffBriefing();

    sampleHandoff = {
      id: "handoff-1",
      agentId: "agent-7",
      reason: HANDOFF_REASONS.BLOCKED,
      status: "PENDING",
      requestedAt: "2026-05-22T10:30:00.000Z",
      context: {
        message: "Cannot access required configuration file",
        blockerDescription: "Permission denied when reading /etc/hax/config.json",
        currentTask: "Initialize project configuration",
        taskStatus: "blocked",
        whatTried: [
          "Attempted to read config with default permissions",
          "Tried alternate path /opt/hax/config.json",
          "Checked file ownership and permissions",
        ],
        attemptCount: 3,
        error: {
          message: "EACCES: permission denied",
          code: "EACCES",
        },
        stuckAt: "config initialization",
      },
      metadata: { attempt: 1, escalationLevel: 0 },
    };

    sampleSession = {
      id: "session-42",
      goal: { text: "Set up HaxAgent production environment", enabled: true },
      messages: [
        { role: "user", content: "Initialize the project configuration" },
        { role: "assistant", content: "I'll start by reading the config file..." },
        { role: "assistant", content: "I encountered a permission issue with /etc/hax/config.json" },
      ],
      costTracker: {
        turnCount: 3,
        toolCallCount: 5,
        inputTokens: 1200,
        outputTokens: 800,
        getCost: () => 0.042,
      },
      modifiedFiles: new Set(["/etc/hax/config.json.bak", "/tmp/hax-debug.log"]),
      getElapsedTime: () => "1m30s",
    };
  });

  describe("generateBriefing", () => {
    it("should produce a comprehensive briefing structure", () => {
      const result = briefing.generateBriefing(sampleHandoff, sampleSession);

      assert.ok(result.handoffId);
      assert.ok(result.generatedAt);
      assert.ok(result.summary);
      assert.ok(result.currentTask);
      assert.ok(result.blocker);
      assert.ok(result.whatTried);
      assert.ok(result.whatNeeded);
      assert.ok(result.options);
      assert.ok(result.filesModified);
      assert.ok(result.urgency);
      assert.ok(result.historyContext);
    });

    it("should generate a meaningful summary", () => {
      const result = briefing.generateBriefing(sampleHandoff, sampleSession);

      assert.ok(result.summary.includes("agent-7"));
      assert.ok(result.summary.includes("blocked"));
      assert.ok(result.summary.includes("Set up HaxAgent production environment"));
    });

    it("should include current task information", () => {
      const result = briefing.generateBriefing(sampleHandoff, sampleSession);

      assert.strictEqual(result.currentTask.description, "Initialize project configuration");
      assert.strictEqual(result.currentTask.status, "blocked");
    });

    it("should extract what the agent tried", () => {
      const result = briefing.generateBriefing(sampleHandoff, sampleSession);

      assert.strictEqual(result.whatTried.length, 3);
      assert.ok(result.whatTried[0].includes("default permissions"));
      assert.ok(result.whatTried[1].includes("alternate path"));
    });

    it("should extract modified files from session", () => {
      const result = briefing.generateBriefing(sampleHandoff, sampleSession);

      assert.ok(result.filesModified.includes("/etc/hax/config.json.bak"));
      assert.ok(result.filesModified.includes("/tmp/hax-debug.log"));
    });

    it("should throw when handoff is null or undefined", () => {
      assert.throws(() => briefing.generateBriefing(null), /handoff is required/);
      assert.throws(() => briefing.generateBriefing(undefined), /handoff is required/);
    });

    it("should work without session data", () => {
      const result = briefing.generateBriefing(sampleHandoff);

      assert.ok(result.summary);
      assert.strictEqual(result.historyContext.available, false);
      assert.strictEqual(result.historyContext.message, "No session data provided");
      assert.strictEqual(result.filesModified.length, 0);
    });
  });

  describe("summarizeContext", () => {
    it("should summarize session context with turn count and cost", () => {
      const result = briefing.summarizeContext(sampleSession);

      assert.ok(result.available);
      assert.strictEqual(result.sessionId, "session-42");
      assert.strictEqual(result.turnCount, 3);
      assert.strictEqual(result.elapsedTime, "1m30s");
      assert.strictEqual(result.estimatedCost, "$0.0420");
      assert.strictEqual(result.goal, "Set up HaxAgent production environment");
    });

    it("should extract recent activity from messages", () => {
      const result = briefing.summarizeContext(sampleSession);

      assert.ok(Array.isArray(result.recentActivity));
      assert.ok(result.recentActivity.length > 0);
      assert.strictEqual(result.recentActivity[0].role, "user");
    });

    it("should handle null session gracefully", () => {
      const result = briefing.summarizeContext(null);

      assert.strictEqual(result.available, false);
      assert.ok(result.message);
    });

    it("should include tool call and token stats", () => {
      const result = briefing.summarizeContext(sampleSession);

      assert.strictEqual(result.toolCallCount, 5);
      assert.strictEqual(result.inputTokens, 1200);
      assert.strictEqual(result.outputTokens, 800);
    });
  });

  describe("explainBlocker", () => {
    it("should explain blocker with category and severity", () => {
      const result = briefing.explainBlocker(sampleHandoff);

      assert.strictEqual(result.reason, HANDOFF_REASONS.BLOCKED);
      assert.strictEqual(result.type, "technical");
      assert.ok(result.description);
      assert.strictEqual(result.severity, 3);
    });

    it("should include error details when present", () => {
      const result = briefing.explainBlocker(sampleHandoff);

      assert.strictEqual(result.error.code, "EACCES");
      assert.strictEqual(result.error.message, "EACCES: permission denied");
      assert.strictEqual(result.attempts, 3);
      assert.strictEqual(result.stuckAt, "config initialization");
    });

    it("should categorize different reason types correctly", () => {
      const approvalHandoff = { ...sampleHandoff, reason: HANDOFF_REASONS.APPROVAL_NEEDED, context: {} };
      const escalationHandoff = { ...sampleHandoff, reason: HANDOFF_REASONS.ESCALATION, context: {} };
      const limitHandoff = { ...sampleHandoff, reason: HANDOFF_REASONS.LIMIT_REACHED, context: {} };

      assert.strictEqual(briefing.explainBlocker(approvalHandoff).type, "authorization");
      assert.strictEqual(briefing.explainBlocker(escalationHandoff).type, "process");
      assert.strictEqual(briefing.explainBlocker(limitHandoff).type, "resource");
    });
  });

  describe("listOptions", () => {
    it("should provide blocking-specific options for BLOCKED reason", () => {
      const options = briefing.listOptions(sampleHandoff);

      assert.ok(options.length > 0);
      assert.ok(options.some((o) => o.id === "unblock"));
      assert.ok(options.some((o) => o.id === "skip"));
      assert.ok(options.some((o) => o.id === "retry"));
      assert.ok(options.some((o) => o.id === "takeover"));
    });

    it("should provide approval-specific options for APPROVAL_NEEDED", () => {
      const handoff = { ...sampleHandoff, reason: HANDOFF_REASONS.APPROVAL_NEEDED };
      const options = briefing.listOptions(handoff);

      assert.ok(options.some((o) => o.id === "approve"));
      assert.ok(options.some((o) => o.id === "deny"));
      assert.ok(options.some((o) => o.id === "request_more_info"));
    });

    it("should provide uncertainty-specific options for UNCERTAIN", () => {
      const handoff = { ...sampleHandoff, reason: HANDOFF_REASONS.UNCERTAIN };
      const options = briefing.listOptions(handoff);

      assert.ok(options.some((o) => o.id === "clarify"));
      assert.ok(options.some((o) => o.id === "decide"));
      assert.ok(options.some((o) => o.id === "conservative"));
    });

    it("should provide limit-specific options for LIMIT_REACHED", () => {
      const handoff = { ...sampleHandoff, reason: HANDOFF_REASONS.LIMIT_REACHED };
      const options = briefing.listOptions(handoff);

      assert.ok(options.some((o) => o.id === "extend"));
      assert.ok(options.some((o) => o.id === "summarize"));
    });

    it("should provide escalation-specific options for ESCALATION", () => {
      const handoff = { ...sampleHandoff, reason: HANDOFF_REASONS.ESCALATION };
      const options = briefing.listOptions(handoff);

      assert.ok(options.some((o) => o.id === "acknowledge"));
      assert.ok(options.some((o) => o.id === "emergency_stop"));
    });

    it("should provide checkpoint-specific options for CHECKPOINT", () => {
      const handoff = { ...sampleHandoff, reason: HANDOFF_REASONS.CHECKPOINT };
      const options = briefing.listOptions(handoff);

      assert.ok(options.some((o) => o.id === "review_and_continue"));
      assert.ok(options.some((o) => o.id === "finalize"));
    });

    it("should mark options that require human input", () => {
      const options = briefing.listOptions(sampleHandoff);

      const unblockOption = options.find((o) => o.id === "unblock");
      assert.strictEqual(unblockOption.requiresInput, true);

      const skipOption = options.find((o) => o.id === "skip");
      assert.strictEqual(skipOption.requiresInput, false);
    });
  });

  describe("generateResumeContext", () => {
    it("should build resume context from handoff and human response", () => {
      const response = {
        decision: "skip_task",
        instructions: "Skip config init and proceed to dependency install",
        approved: true,
      };
      const context = briefing.generateResumeContext(sampleHandoff, response);

      assert.strictEqual(context.handoffId, "handoff-1");
      assert.strictEqual(context.originalReason, HANDOFF_REASONS.BLOCKED);
      assert.strictEqual(context.humanDecision, "skip_task");
      assert.strictEqual(context.instructions, "Skip config init and proceed to dependency install");
      assert.strictEqual(context.approval, true);
      assert.ok(context.nextSteps.length > 0);
    });

    it("should include warnings when human denies approval", () => {
      const response = { approved: false, decision: "deny" };
      const context = briefing.generateResumeContext(sampleHandoff, response);

      assert.ok(context.warnings.length > 0);
      assert.ok(context.warnings.some((w) => w.includes("denied")));
    });

    it("should include warnings for safety overrides", () => {
      const response = { approved: true, overrideSafety: true };
      const context = briefing.generateResumeContext(sampleHandoff, response);

      assert.ok(context.warnings.some((w) => w.includes("safety")));
    });

    it("should include next steps tailored to handoff reason", () => {
      const response = { approved: true };
      const context = briefing.generateResumeContext(sampleHandoff, response);

      assert.ok(context.nextSteps.some((s) => s.includes("unblock")));
    });
  });
});
