"use strict";

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  HandoffProtocol,
  HANDOFF_REASONS,
  HANDOFF_STATUS,
} = require("../../src/handoff/protocol");

describe("HandoffProtocol", () => {
  let protocol;

  beforeEach(() => {
    protocol = new HandoffProtocol();
  });

  describe("requestHandoff", () => {
    it("should create a pending handoff request", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.BLOCKED,
        { message: "Cannot read file" }
      );

      assert.ok(handoff.id.startsWith("handoff-"), "id should start with 'handoff-'");
      assert.strictEqual(handoff.agentId, "agent-1");
      assert.strictEqual(handoff.reason, HANDOFF_REASONS.BLOCKED);
      assert.strictEqual(handoff.status, HANDOFF_STATUS.PENDING);
      assert.ok(handoff.requestedAt, "should have requestedAt timestamp");
      assert.deepStrictEqual(handoff.context, { message: "Cannot read file" });
      assert.strictEqual(handoff.humanResponse, null);
      assert.strictEqual(handoff.metadata.attempt, 1);
    });

    it("should reject invalid handoff reasons", () => {
      assert.throws(
        () => protocol.requestHandoff("agent-1", "INVALID_REASON"),
        /Invalid handoff reason/
      );
    });

    it("should reject empty agent IDs", () => {
      assert.throws(
        () => protocol.requestHandoff("", HANDOFF_REASONS.BLOCKED),
        /must be a non-empty string/
      );
    });

    it("should increment attempt metadata for multiple requests from same agent", () => {
      protocol.requestHandoff("agent-1", HANDOFF_REASONS.BLOCKED);
      const second = protocol.requestHandoff("agent-1", HANDOFF_REASONS.UNCERTAIN);

      assert.strictEqual(second.metadata.attempt, 2);
    });

    it("should enforce max pending per agent limit", () => {
      const limited = new HandoffProtocol({ maxPendingPerAgent: 2 });

      limited.requestHandoff("agent-1", HANDOFF_REASONS.BLOCKED);
      limited.requestHandoff("agent-1", HANDOFF_REASONS.UNCERTAIN);

      assert.throws(
        () => limited.requestHandoff("agent-1", HANDOFF_REASONS.CHECKPOINT),
        /has 2 pending handoffs/
      );
    });
  });

  describe("executeHandoff", () => {
    it("should transition PENDING to ACCEPTED", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.APPROVAL_NEEDED
      );
      const executed = protocol.executeHandoff(handoff);

      assert.strictEqual(executed.status, HANDOFF_STATUS.ACCEPTED);
      assert.ok(executed.acceptedAt, "should set acceptedAt timestamp");
    });

    it("should accept handoff by string ID", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.CHECKPOINT
      );
      const executed = protocol.executeHandoff(handoff.id);

      assert.strictEqual(executed.id, handoff.id);
      assert.strictEqual(executed.status, HANDOFF_STATUS.ACCEPTED);
    });

    it("should set agent state to handed_off on execute", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.BLOCKED
      );
      protocol.executeHandoff(handoff);

      const state = protocol.getAgentState("agent-1");
      assert.strictEqual(state.state, "handed_off");
      assert.strictEqual(state.handoffId, handoff.id);
    });

    it("should reject execution when not in PENDING status", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.BLOCKED
      );
      protocol.executeHandoff(handoff);

      assert.throws(
        () => protocol.executeHandoff(handoff),
        /Cannot execute handoff.*current status is ACCEPTED/
      );
    });
  });

  describe("resumeFromHandoff", () => {
    it("should resolve an ACCEPTED handoff with human response", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.BLOCKED,
        { blockerDescription: "File locked" }
      );
      protocol.executeHandoff(handoff);

      const resumeContext = protocol.resumeFromHandoff(handoff, {
        decision: "unlock_file",
        instructions: "Use --force flag",
        approved: true,
      });

      assert.strictEqual(resumeContext.handoffId, handoff.id);
      assert.strictEqual(resumeContext.approved, true);
      assert.strictEqual(resumeContext.instructions, "Use --force flag");
      assert.ok(resumeContext.resumedAt, "should have resumedAt timestamp");

      const updated = protocol.getHandoff(handoff.id);
      assert.strictEqual(updated.status, HANDOFF_STATUS.RESOLVED);
      assert.ok(updated.resolvedAt);
    });

    it("should restore agent state to running on resume", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.BLOCKED
      );
      protocol.executeHandoff(handoff);
      protocol.resumeFromHandoff(handoff, { approved: true });

      const state = protocol.getAgentState("agent-1");
      assert.strictEqual(state.state, "running");
      assert.strictEqual(state.handoffId, null);
    });

    it("should reject resume of non-ACCEPTED handoff", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.BLOCKED
      );

      assert.throws(
        () => protocol.resumeFromHandoff(handoff, { approved: true }),
        /Cannot resume handoff.*current status is PENDING/
      );
    });
  });

  describe("rejectHandoff", () => {
    it("should reject a pending handoff", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.APPROVAL_NEEDED
      );
      const rejected = protocol.rejectHandoff(handoff.id, "Not authorized");

      assert.strictEqual(rejected.status, HANDOFF_STATUS.REJECTED);
      assert.ok(rejected.rejectedAt, "should set rejectedAt");
      assert.deepStrictEqual(rejected.humanResponse, {
        rejected: true,
        reason: "Not authorized",
      });
    });

    it("should reject an accepted handoff", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.APPROVAL_NEEDED
      );
      protocol.executeHandoff(handoff);
      const rejected = protocol.rejectHandoff(handoff.id, "Changed my mind");

      assert.strictEqual(rejected.status, HANDOFF_STATUS.REJECTED);
      // Agent state should be restored
      const state = protocol.getAgentState("agent-1");
      assert.strictEqual(state.state, "running");
    });

    it("should not reject an already resolved handoff", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.BLOCKED
      );
      protocol.executeHandoff(handoff);
      protocol.resumeFromHandoff(handoff, { approved: true });

      assert.throws(
        () => protocol.rejectHandoff(handoff.id, "Too late"),
        /Cannot reject handoff.*current status is RESOLVED/
      );
    });
  });

  describe("cancelHandoff", () => {
    it("should cancel a pending handoff", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.CHECKPOINT
      );
      const cancelled = protocol.cancelHandoff(handoff.id);

      assert.strictEqual(cancelled.status, HANDOFF_STATUS.CANCELLED);
      assert.ok(cancelled.cancelledAt);
    });

    it("should remove cancelled handoff from pending list", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.CHECKPOINT
      );
      protocol.cancelHandoff(handoff.id);

      assert.strictEqual(protocol.getPendingCount("agent-1"), 0);
    });

    it("should not cancel a resolved handoff", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.CHECKPOINT
      );
      protocol.executeHandoff(handoff);
      protocol.resumeFromHandoff(handoff, { approved: true });

      assert.throws(
        () => protocol.cancelHandoff(handoff.id),
        /Cannot cancel handoff.*current status is RESOLVED/
      );
    });
  });

  describe("prepareHandoff", () => {
    it("should package agent state into a snapshot", () => {
      protocol.requestHandoff("agent-1", HANDOFF_REASONS.BLOCKED);
      const snapshot = protocol.prepareHandoff("agent-1");

      assert.strictEqual(snapshot.agentId, "agent-1");
      assert.ok(snapshot.timestamp);
      assert.ok(snapshot.currentState);
      assert.ok(snapshot.activeHandoffId);
      assert.strictEqual(snapshot.pendingCount, 1);
      assert.ok(Array.isArray(snapshot.handoffHistory));
    });

    it("should throw for unknown agent", () => {
      assert.throws(
        () => protocol.prepareHandoff("nonexistent"),
        /Unknown agent/
      );
    });
  });

  describe("querying and statistics", () => {
    it("should get pending handoffs filtered by agent", () => {
      protocol.requestHandoff("agent-1", HANDOFF_REASONS.BLOCKED);
      protocol.requestHandoff("agent-2", HANDOFF_REASONS.APPROVAL_NEEDED);

      const pending1 = protocol.getPendingHandoffs("agent-1");
      assert.strictEqual(pending1.length, 1);
      assert.strictEqual(pending1[0].agentId, "agent-1");
    });

    it("should return all pending handoffs when agent not specified", () => {
      protocol.requestHandoff("agent-1", HANDOFF_REASONS.BLOCKED);
      protocol.requestHandoff("agent-2", HANDOFF_REASONS.APPROVAL_NEEDED);

      const allPending = protocol.getPendingHandoffs();
      assert.strictEqual(allPending.length, 2);
    });

    it("should query handoffs by reason", () => {
      protocol.requestHandoff("agent-1", HANDOFF_REASONS.BLOCKED);
      protocol.requestHandoff("agent-2", HANDOFF_REASONS.APPROVAL_NEEDED);

      const blocked = protocol.query({ reason: HANDOFF_REASONS.BLOCKED });
      assert.strictEqual(blocked.length, 1);
      assert.strictEqual(blocked[0].reason, HANDOFF_REASONS.BLOCKED);
    });

    it("should compute correct statistics", () => {
      const h1 = protocol.requestHandoff("agent-1", HANDOFF_REASONS.BLOCKED);
      protocol.executeHandoff(h1);
      protocol.resumeFromHandoff(h1, { approved: true });

      protocol.requestHandoff("agent-1", HANDOFF_REASONS.APPROVAL_NEEDED);
      // rejected

      const stats = protocol.getStats();
      assert.strictEqual(stats.total, 2);
      assert.strictEqual(stats.resolved, 1);
      assert.strictEqual(stats.pending, 1);
    });
  });

  describe("checkTimeouts", () => {
    it("should mark expired handoffs as TIMED_OUT", () => {
      const protocol = new HandoffProtocol({ defaultTimeoutMs: -1 });

      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.BLOCKED
      );

      // Negative timeout means every handoff has already expired
      const timedOut = protocol.checkTimeouts();

      assert.strictEqual(timedOut.length, 1);
      assert.strictEqual(timedOut[0].id, handoff.id);
      assert.strictEqual(timedOut[0].status, HANDOFF_STATUS.TIMED_OUT);
    });
  });

  describe("updateAgentState", () => {
    it("should create agent state if it does not exist", () => {
      protocol.updateAgentState("agent-3", { customField: "value" });

      const state = protocol.getAgentState("agent-3");
      assert.ok(state);
      assert.strictEqual(state.customField, "value");
      assert.strictEqual(state.state, "running");
    });

    it("should merge updates into existing state", () => {
      protocol.updateAgentState("agent-1", { version: "1.0" });
      protocol.updateAgentState("agent-1", { version: "2.0", extra: true });

      const state = protocol.getAgentState("agent-1");
      assert.strictEqual(state.version, "2.0");
      assert.strictEqual(state.extra, true);
    });
  });

  describe("rejectHandoff", () => {
    it("should require a non-empty rejection reason", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.APPROVAL_NEEDED
      );

      assert.throws(
        () => protocol.rejectHandoff(handoff.id, ""),
        /must be a non-empty string/
      );
    });
  });

  describe("immutability", () => {
    it("should return cloned objects, not internal references", () => {
      const handoff = protocol.requestHandoff(
        "agent-1",
        HANDOFF_REASONS.BLOCKED,
        { items: [1, 2, 3] }
      );

      handoff.context.items.push(4);

      const retrieved = protocol.getHandoff(handoff.id);
      assert.strictEqual(retrieved.context.items.length, 3);
    });
  });
});
