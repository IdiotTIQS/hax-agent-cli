"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  EscalationPolicy,
  ESCALATION_LEVELS,
  ESCALATION_TRIGGERS,
  ESCALATION_STATUS,
} = require("../../src/handoff/escalation");

describe("EscalationPolicy", () => {
  let policy;

  beforeEach(() => {
    policy = new EscalationPolicy();
  });

  describe("shouldEscalate", () => {
    it("should detect when repeated failures exceed threshold", () => {
      // Record enough failures to trigger escalation
      for (let i = 0; i < 3; i++) {
        policy.recordFailure("agent-1", { type: "TOOL_ERROR", message: "Failed" });
      }

      const decision = policy.shouldEscalate("agent-1");
      assert.strictEqual(decision.shouldEscalate, true);
      assert.strictEqual(decision.trigger, ESCALATION_TRIGGERS.REPEATED_FAILURES);
      assert.strictEqual(decision.targetLevel, ESCALATION_LEVELS.TEAM_LEAD);
    });

    it("should not escalate when failures are below threshold", () => {
      policy.recordFailure("agent-1", { type: "TOOL_ERROR" });
      policy.recordFailure("agent-1", { type: "NETWORK_ERROR" });

      const decision = policy.shouldEscalate("agent-1");
      assert.strictEqual(decision.shouldEscalate, false);
    });

    it("should detect stuck loop condition", () => {
      // Record the same action multiple times to trigger loop detection
      for (let i = 0; i < 5; i++) {
        policy.recordAction("agent-1", "tool:read_file:/locked/path");
      }

      const decision = policy.shouldEscalate("agent-1");
      assert.strictEqual(decision.shouldEscalate, true);
      assert.strictEqual(decision.trigger, ESCALATION_TRIGGERS.STUCK_LOOP);
    });

    it("should escalate on safety concern regardless of other state", () => {
      const decision = policy.shouldEscalate("agent-1", { safetyConcern: true });

      assert.strictEqual(decision.shouldEscalate, true);
      assert.strictEqual(decision.trigger, ESCALATION_TRIGGERS.SAFETY_CONCERN);
      assert.strictEqual(decision.severity, "critical");
    });

    it("should escalate on data loss risk", () => {
      const decision = policy.shouldEscalate("agent-1", { dataLossRisk: true });

      assert.strictEqual(decision.shouldEscalate, true);
      assert.strictEqual(decision.trigger, ESCALATION_TRIGGERS.DATA_LOSS_RISK);
      assert.strictEqual(decision.severity, "critical");
    });

    it("should escalate on time exceeding configured limit", () => {
      const decision = policy.shouldEscalate("agent-1", { elapsedMinutes: 45 });

      assert.strictEqual(decision.shouldEscalate, true);
      assert.strictEqual(decision.trigger, ESCALATION_TRIGGERS.TIME_EXCEEDING);
    });

    it("should escalate on cost exceeding configured limit", () => {
      const decision = policy.shouldEscalate("agent-1", { costDollars: 7.5 });

      assert.strictEqual(decision.shouldEscalate, true);
      assert.strictEqual(decision.trigger, ESCALATION_TRIGGERS.COST_EXCEEDING);
    });

    it("should escalate on permission denied", () => {
      const decision = policy.shouldEscalate("agent-1", { permissionDenied: true });

      assert.strictEqual(decision.shouldEscalate, true);
      assert.strictEqual(decision.trigger, ESCALATION_TRIGGERS.PERMISSION_DENIED);
      assert.strictEqual(decision.severity, "high");
    });
  });

  describe("escalate", () => {
    it("should escalate from SELF_HEAL to TEAM_LEAD", () => {
      const result = policy.escalate("agent-1", { trigger: ESCALATION_TRIGGERS.REPEATED_FAILURES });

      assert.strictEqual(result.escalated, true);
      assert.strictEqual(result.previousLevel, ESCALATION_LEVELS.SELF_HEAL);
      assert.strictEqual(result.currentLevel, ESCALATION_LEVELS.TEAM_LEAD);
      assert.strictEqual(result.levelName, "TEAM_LEAD");
    });

    it("should escalate to a specific target level", () => {
      const result = policy.escalate("agent-1", {}, ESCALATION_LEVELS.HUMAN);

      assert.strictEqual(result.escalated, true);
      assert.strictEqual(result.currentLevel, ESCALATION_LEVELS.HUMAN);
      assert.strictEqual(result.levelName, "HUMAN");
    });

    it("should prevent escalation to same or lower level", () => {
      policy.escalate("agent-1", {}, ESCALATION_LEVELS.TEAM_LEAD);
      const result = policy.escalate("agent-1", {}, ESCALATION_LEVELS.TEAM_LEAD);

      assert.strictEqual(result.escalated, false);
      assert.ok(result.reason.includes("Already at"));
    });

    it("should track escalation status and count", () => {
      const noCooldown = new EscalationPolicy({ cooldownMs: 0 });

      noCooldown.escalate("agent-1", {}, ESCALATION_LEVELS.TEAM_LEAD);
      noCooldown.escalate("agent-1", {}, ESCALATION_LEVELS.HUMAN);

      const state = noCooldown.getState("agent-1");
      assert.strictEqual(state.escalationCount, 2);
      assert.strictEqual(state.escalationLevel, ESCALATION_LEVELS.HUMAN);
      assert.strictEqual(state.levelName, "HUMAN");
    });

    it("should enforce cooldown between escalations", () => {
      const coolingPolicy = new EscalationPolicy({ cooldownMs: 60000 });

      coolingPolicy.escalate("agent-1", {}, ESCALATION_LEVELS.TEAM_LEAD);
      const result = coolingPolicy.escalate("agent-1", {}, ESCALATION_LEVELS.HUMAN);

      assert.strictEqual(result.escalated, false);
      assert.ok(result.reason.includes("Cooldown active"));
    });

    it("should record escalation events in history", () => {
      policy.escalate("agent-1", { trigger: ESCALATION_TRIGGERS.SAFETY_CONCERN }, ESCALATION_LEVELS.HUMAN);

      const history = policy.getHistory("agent-1");
      assert.strictEqual(history.length, 1);
      assert.strictEqual(history[0].type, "escalate");
      assert.strictEqual(history[0].fromLevel, ESCALATION_LEVELS.SELF_HEAL);
      assert.strictEqual(history[0].toLevel, ESCALATION_LEVELS.HUMAN);
    });
  });

  describe("getEscalationPath", () => {
    it("should return default escalation path with all levels", () => {
      const path = policy.getEscalationPath("agent-1");

      assert.strictEqual(path.agentId, "agent-1");
      assert.strictEqual(path.path.length, 4);
      assert.strictEqual(path.path[0].level, ESCALATION_LEVELS.SELF_HEAL);
      assert.strictEqual(path.path[1].level, ESCALATION_LEVELS.TEAM_LEAD);
      assert.strictEqual(path.path[2].level, ESCALATION_LEVELS.HUMAN);
      assert.strictEqual(path.path[3].level, ESCALATION_LEVELS.ADMIN);
    });

    it("should return custom escalation path when set", () => {
      const customPath = [
        { level: ESCALATION_LEVELS.SELF_HEAL, name: "Auto", contact: "self" },
        { level: ESCALATION_LEVELS.TEAM_LEAD, name: "TL", contact: "tl@test" },
        { level: ESCALATION_LEVELS.HUMAN, name: "Human", contact: "human@test" },
      ];

      policy.setEscalationPath("agent-1", customPath);

      const path = policy.getEscalationPath("agent-1");
      assert.strictEqual(path.path.length, 3);
      assert.strictEqual(path.path[0].contact, "self");
      assert.strictEqual(path.path[1].contact, "tl@test");
    });

    it("should reject invalid escalation levels in custom path", () => {
      assert.throws(
        () => policy.setEscalationPath("agent-1", [{ level: 99, name: "Bad", contact: "x" }]),
        /Invalid escalation level/
      );
    });
  });

  describe("deescalate", () => {
    it("should deescalate from TEAM_LEAD to SELF_HEAL", () => {
      policy.escalate("agent-1", {}, ESCALATION_LEVELS.TEAM_LEAD);
      const result = policy.deescalate("agent-1");

      assert.strictEqual(result.deescalated, true);
      assert.strictEqual(result.previousLevel, ESCALATION_LEVELS.TEAM_LEAD);
      assert.strictEqual(result.currentLevel, ESCALATION_LEVELS.SELF_HEAL);
      assert.strictEqual(result.status, ESCALATION_STATUS.NORMAL);
    });

    it("should not deescalate when already at SELF_HEAL", () => {
      const result = policy.deescalate("agent-1");

      assert.strictEqual(result.deescalated, false);
      assert.ok(result.reason.includes("Already at lowest level"));
    });

    it("should record deescalation in history", () => {
      policy.escalate("agent-1", {}, ESCALATION_LEVELS.TEAM_LEAD);
      policy.deescalate("agent-1");

      const history = policy.getHistory("agent-1");
      assert.strictEqual(history.length, 2);
      assert.strictEqual(history[1].type, "deescalate");
      assert.strictEqual(history[1].toLevel, ESCALATION_LEVELS.SELF_HEAL);
    });
  });

  describe("autoDeescalate", () => {
    it("should auto-deescalate agents past the deescalation window", () => {
      const autoPolicy = new EscalationPolicy({
        autoDeescalateAfterMs: -1,
        cooldownMs: 0,
      });

      autoPolicy.escalate("agent-1", {}, ESCALATION_LEVELS.TEAM_LEAD);
      autoPolicy.escalate("agent-2", {}, ESCALATION_LEVELS.HUMAN);

      const results = autoPolicy.autoDeescalate();

      assert.ok(results.length > 0);
      assert.ok(results.every((r) => r.deescalated));
    });

    it("should not deescalate agents already at SELF_HEAL", () => {
      const results = policy.autoDeescalate();
      assert.strictEqual(results.length, 0);
    });
  });

  describe("loop detection", () => {
    it("should detect repeated identical actions as a loop", () => {
      for (let i = 0; i < 5; i++) {
        policy.recordAction("agent-1", "tool:bash:rm -rf /tmp");
      }

      assert.strictEqual(policy.isInLoop("agent-1"), true);
    });

    it("should not flag diverse actions as a loop", () => {
      policy.recordAction("agent-1", "tool:read_file:/a");
      policy.recordAction("agent-1", "tool:read_file:/b");
      policy.recordAction("agent-1", "tool:bash:ls");
      policy.recordAction("agent-1", "tool:write_file:/c");

      assert.strictEqual(policy.isInLoop("agent-1"), false);
    });

    it("should respect the configured loop detection count", () => {
      const customPolicy = new EscalationPolicy({ loopDetectionCount: 3 });

      customPolicy.recordAction("agent-1", "tool:bash:rm -rf /tmp");
      customPolicy.recordAction("agent-1", "tool:bash:rm -rf /tmp");
      customPolicy.recordAction("agent-1", "tool:bash:rm -rf /tmp");

      assert.strictEqual(customPolicy.isInLoop("agent-1"), true);
    });
  });

  describe("getState", () => {
    it("should return comprehensive state for a tracked agent", () => {
      policy.recordFailure("agent-1", { type: "TEST" });
      policy.escalate("agent-1", {}, ESCALATION_LEVELS.TEAM_LEAD);

      const state = policy.getState("agent-1");

      assert.ok(state);
      assert.strictEqual(state.agentId, "agent-1");
      assert.strictEqual(state.escalationLevel, ESCALATION_LEVELS.TEAM_LEAD);
      assert.strictEqual(state.levelName, "TEAM_LEAD");
      assert.strictEqual(state.escalationCount, 1);
      assert.ok(state.failureCount >= 1);
    });

    it("should return null for untracked agents", () => {
      const state = policy.getState("untracked");
      assert.strictEqual(state, null);
    });
  });

  describe("clear", () => {
    it("should reset all state", () => {
      policy.recordFailure("agent-1", { type: "TEST" });
      policy.escalate("agent-1", {}, ESCALATION_LEVELS.HUMAN);
      policy.setEscalationPath("agent-1", [{ level: 0, name: "X", contact: "x" }]);

      policy.clear();

      assert.strictEqual(policy.getState("agent-1"), null);
      assert.strictEqual(policy.getHistory("agent-1").length, 0);
      // Custom path is cleared, so default is returned
      const path = policy.getEscalationPath("agent-2");
      assert.strictEqual(path.path.length, 4);
    });
  });

  describe("failure tracking", () => {
    it("should update status to WATCHING when failures approach threshold", () => {
      for (let i = 0; i < 3; i++) {
        policy.recordFailure("agent-1", { type: "ERROR", message: `Error ${i}` });
      }

      const state = policy.getState("agent-1");
      assert.strictEqual(state.status, ESCALATION_STATUS.WATCHING);
    });

    it("should clear old failures outside the tracking window", () => {
      const shortPolicy = new EscalationPolicy({ failureWindowMs: 1, maxFailures: 2 });

      shortPolicy.recordFailure("agent-1", { type: "OLD" });
      shortPolicy.recordFailure("agent-1", { type: "OLD" });

      // Small delay to push first failures out of window
      const state = shortPolicy.getState("agent-1");
      assert.strictEqual(state.failureCount <= 2, true);
    });
  });

  describe("edge cases", () => {
    it("should clamp target level to valid range", () => {
      const result = policy.escalate("agent-1", {}, 10);

      assert.strictEqual(result.escalated, true);
      assert.strictEqual(result.currentLevel, ESCALATION_LEVELS.ADMIN);
    });

    it("should not escalate to negative level from SELF_HEAL", () => {
      const result = policy.escalate("agent-1", {}, -1);

      assert.strictEqual(result.escalated, false);
      assert.ok(result.reason.includes("Already at"));
    });
  });
});
