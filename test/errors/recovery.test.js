/**
 * Tests for ErrorRecovery — recovery actions, plans, auto-recovery,
 * and eligibility checks.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { ErrorRecovery, ACTIONS, AUTO_RECOVERABLE } = require("../../src/shared/errors/recovery");
const { ToolExecutionError } = require("../../src/tools/error");

// ── ACTIONS constants ──────────────────────────────────────────────

describe("ACTIONS", () => {
  it("defines all five core actions plus extended actions", () => {
    assert.strictEqual(ACTIONS.RETRY, "RETRY");
    assert.strictEqual(ACTIONS.RETRY_WITH_BACKOFF, "RETRY_WITH_BACKOFF");
    assert.strictEqual(ACTIONS.CHECK_CONFIG, "CHECK_CONFIG");
    assert.strictEqual(ACTIONS.VALIDATE_INPUT, "VALIDATE_INPUT");
    assert.strictEqual(ACTIONS.ESCALATE, "ESCALATE");
    assert.strictEqual(ACTIONS.REDUCE_SCOPE, "REDUCE_SCOPE");
    assert.strictEqual(ACTIONS.TRY_ALTERNATIVE, "TRY_ALTERNATIVE");
    assert.strictEqual(ACTIONS.WAIT_AND_RETRY, "WAIT_AND_RETRY");
    assert.strictEqual(ACTIONS.CHECK_PERMISSIONS, "CHECK_PERMISSIONS");
    assert.strictEqual(ACTIONS.CHECK_NETWORK, "CHECK_NETWORK");
  });
});

// ── suggest ────────────────────────────────────────────────────────

describe("ErrorRecovery.suggest", () => {
  it("returns action with description for RETRY", () => {
    const result = ErrorRecovery.suggest(ACTIONS.RETRY);
    assert.strictEqual(result.action, "RETRY");
    assert.ok(result.description.includes("Retry the operation"));
  });

  it("returns action with description for ESCALATE", () => {
    const result = ErrorRecovery.suggest(ACTIONS.ESCALATE);
    assert.strictEqual(result.action, "ESCALATE");
    assert.ok(result.description.includes("Escalate"));
  });

  it("returns action with fallback description for unknown action", () => {
    const result = ErrorRecovery.suggest("NONEXISTENT");
    assert.strictEqual(result.action, "NONEXISTENT");
    assert.ok(result.description.includes("No description available"));
  });
});

// ── getRecoveryPlan ────────────────────────────────────────────────

describe("ErrorRecovery.getRecoveryPlan", () => {
  it("returns a multi-step plan for FETCH_FAILED", () => {
    const err = new ToolExecutionError("FETCH_FAILED", "timeout");
    const plan = ErrorRecovery.getRecoveryPlan(err);

    assert.ok(Array.isArray(plan));
    assert.ok(plan.length >= 2);
    // First step should be RETRY_WITH_BACKOFF for transient network errors
    assert.strictEqual(plan[0].action, ACTIONS.RETRY_WITH_BACKOFF);
    assert.ok(typeof plan[0].delayMs === "number");
    assert.ok(typeof plan[0].maxAttempts === "number");
    // Each step has step number
    assert.strictEqual(plan[0].step, 1);
  });

  it("returns a plan with VALIDATE_INPUT for PATH_NOT_FOUND", () => {
    const err = new ToolExecutionError("PATH_NOT_FOUND", "no such file");
    const plan = ErrorRecovery.getRecoveryPlan(err);

    assert.strictEqual(plan[0].action, ACTIONS.VALIDATE_INPUT);
    assert.ok(plan[0].hint.includes("file path"));
  });

  it("returns a plan for TEXT_NOT_FOUND with TRY_ALTERNATIVE step", () => {
    const err = new ToolExecutionError("TEXT_NOT_FOUND", "text not found");
    const plan = ErrorRecovery.getRecoveryPlan(err);

    const alternativeStep = plan.find((s) => s.action === ACTIONS.TRY_ALTERNATIVE);
    assert.ok(alternativeStep);
  });

  it("returns a plan for TOOL_NOT_FOUND with CHECK_CONFIG", () => {
    const err = new ToolExecutionError("TOOL_NOT_FOUND", "no tool");
    const plan = ErrorRecovery.getRecoveryPlan(err);

    const configStep = plan.find((s) => s.action === ACTIONS.CHECK_CONFIG);
    assert.ok(configStep);
  });

  it("returns fallback TOOL_ERROR plan for unknown code", () => {
    const err = { code: "UNKNOWN_CODE_XYZ", message: "what" };
    const plan = ErrorRecovery.getRecoveryPlan(err);

    assert.ok(Array.isArray(plan));
    // Fallback plan should end with ESCALATE
    assert.strictEqual(plan[plan.length - 1].action, ACTIONS.ESCALATE);
  });

  it("returns fallback plan for raw string error", () => {
    const plan = ErrorRecovery.getRecoveryPlan("just a string error");
    assert.ok(plan.length > 0);
    assert.strictEqual(plan[plan.length - 1].action, ACTIONS.ESCALATE);
  });

  it("returns correct plan for SHELL_SPAWN_ERROR", () => {
    const err = new ToolExecutionError("SHELL_SPAWN_ERROR", "spawn failed");
    const plan = ErrorRecovery.getRecoveryPlan(err);

    assert.strictEqual(plan[0].action, ACTIONS.VALIDATE_INPUT);
    assert.ok(plan[0].hint.includes("PATH"));
  });
});

// ── canAutoRecover ─────────────────────────────────────────────────

describe("ErrorRecovery.canAutoRecover", () => {
  it("returns true for FETCH_FAILED (transient)", () => {
    assert.strictEqual(ErrorRecovery.canAutoRecover("FETCH_FAILED"), true);
  });

  it("returns true for STOCK_TIMEOUT (transient)", () => {
    assert.strictEqual(ErrorRecovery.canAutoRecover("STOCK_TIMEOUT"), true);
  });

  it("returns true for HTTP_ERROR (transient)", () => {
    assert.strictEqual(ErrorRecovery.canAutoRecover("HTTP_ERROR"), true);
  });

  it("returns false for PERMISSION_DENIED (not transient)", () => {
    assert.strictEqual(ErrorRecovery.canAutoRecover("PERMISSION_DENIED"), false);
  });

  it("returns false for PATH_NOT_FOUND (not transient)", () => {
    assert.strictEqual(ErrorRecovery.canAutoRecover("PATH_NOT_FOUND"), false);
  });

  it("returns false for INVALID_ARGUMENT (not transient)", () => {
    assert.strictEqual(ErrorRecovery.canAutoRecover("INVALID_ARGUMENT"), false);
  });

  it("returns false for null/undefined/empty", () => {
    assert.strictEqual(ErrorRecovery.canAutoRecover(null), false);
    assert.strictEqual(ErrorRecovery.canAutoRecover(undefined), false);
    assert.strictEqual(ErrorRecovery.canAutoRecover(""), false);
  });
});

// ── autoRecover ────────────────────────────────────────────────────

describe("ErrorRecovery.autoRecover", () => {
  it("recovers on first retry for a transient error", async () => {
    let attempts = 0;
    const retryFn = async () => {
      attempts++;
      if (attempts === 1) throw new Error("transient");
      return { ok: true };
    };

    const err = new ToolExecutionError("FETCH_FAILED", "timeout");
    const result = await ErrorRecovery.autoRecover(err, { retryFn, timeoutMs: 5000 });

    assert.strictEqual(result.recovered, true);
    assert.deepEqual(result.result, { ok: true });
    assert.strictEqual(result.action, "RETRY_WITH_BACKOFF");
    assert.strictEqual(attempts, 2);
  });

  it("recovers with backoff on second attempt", async () => {
    let attempts = 0;
    const retryFn = async () => {
      attempts++;
      if (attempts <= 2) throw new Error("persistent");
      return { ok: true };
    };

    const err = new ToolExecutionError("FETCH_FAILED", "timeout");
    const result = await ErrorRecovery.autoRecover(err, { retryFn, timeoutMs: 5000 });

    assert.strictEqual(result.recovered, true);
    assert.strictEqual(result.action, "RETRY_WITH_BACKOFF");
    assert.strictEqual(attempts, 3);
  });

  it("fails auto-recovery when all retries are exhausted", async () => {
    const retryFn = async () => {
      throw new Error("always fails");
    };

    const err = new ToolExecutionError("FETCH_FAILED", "timeout");
    const result = await ErrorRecovery.autoRecover(err, { retryFn, timeoutMs: 5000 });

    assert.strictEqual(result.recovered, false);
    assert.strictEqual(result.action, "CHECK_NETWORK");
  });

  it("returns ESCALATE immediately for non-auto-recoverable code", async () => {
    const retryFn = async () => ({ ok: true });

    const err = new ToolExecutionError("PERMISSION_DENIED", "no access");
    const result = await ErrorRecovery.autoRecover(err, { retryFn, timeoutMs: 5000 });

    assert.strictEqual(result.recovered, false);
    assert.strictEqual(result.action, "ESCALATE");
    assert.ok(result.message.includes("not eligible"));
  });

  it("returns ESCALATE when no retryFn provided", async () => {
    const err = new ToolExecutionError("FETCH_FAILED", "timeout");
    const result = await ErrorRecovery.autoRecover(err, { timeoutMs: 5000 });

    assert.strictEqual(result.recovered, false);
    assert.strictEqual(result.action, "ESCALATE");
    assert.ok(result.message.includes("no retry function"));
  });

  it("aborts auto-recovery on timeout", async () => {
    const retryFn = async () => {
      // force retry path to timeout by ensuring first retry takes time
      throw new Error("fail");
    };

    // Use FETCH_FAILED which starts with RETRY_WITH_BACKOFF (delayMs: 500).
    // A 1ms timeout guarantees the deadline expires before the first retry.
    const err = new ToolExecutionError("FETCH_FAILED", "timeout");

    const result = await ErrorRecovery.autoRecover(err, {
      retryFn,
      timeoutMs: 1,
    });

    assert.strictEqual(result.recovered, false);
    assert.ok(result.message.includes("timed out"));
  });
});

// ── getAutoRecoverableCodes ────────────────────────────────────────

describe("ErrorRecovery.getAutoRecoverableCodes", () => {
  it("returns a sorted list of auto-recoverable codes", () => {
    const codes = ErrorRecovery.getAutoRecoverableCodes();
    assert.ok(Array.isArray(codes));
    assert.ok(codes.length > 0);
    assert.ok(codes.includes("FETCH_FAILED"));
    assert.ok(codes.includes("STOCK_TIMEOUT"));
  });
});

// ── getActions ─────────────────────────────────────────────────────

describe("ErrorRecovery.getActions", () => {
  it("returns a copy of ACTIONS with all values", () => {
    const actions = ErrorRecovery.getActions();
    assert.strictEqual(actions.RETRY, "RETRY");
    assert.strictEqual(actions.ESCALATE, "ESCALATE");
    // Should be a copy, not the same reference
    assert.notStrictEqual(actions, ACTIONS);
  });
});

// ── AUTO_RECOVERABLE set ───────────────────────────────────────────

describe("AUTO_RECOVERABLE", () => {
  it("contains only transient-type error codes", () => {
    const transientLike = ["TIMEOUT", "FETCH_FAILED", "HTTP_ERROR", "SEARCH_FAILED"];
    for (const code of AUTO_RECOVERABLE) {
      const isTransient = transientLike.some((t) => code.includes(t))
        || code.includes("ERROR")
        || code.includes("TIMEOUT");
      assert.ok(isTransient, `${code} should be a transient-type error`);
    }
  });
});
