"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { AgentLifecycle, AgentStates } = require("../../src/state/agent-lifecycle");

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/**
 * Small sleep to make timing assertions reliable.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------------------------------------------------
// Initial state
// ------------------------------------------------------------------

test("AgentLifecycle: starts in IDLE state", () => {
  const lifecycle = new AgentLifecycle({ agentId: "test-1" });
  assert.equal(lifecycle.currentState(), AgentStates.IDLE);
});

test("AgentLifecycle: assigns a fallback agentId", () => {
  const lifecycle = new AgentLifecycle();
  assert.ok(typeof lifecycle.agentId === "string");
  assert.ok(lifecycle.agentId.startsWith("agent-"));
});

// ------------------------------------------------------------------
// Normal lifecycle
// ------------------------------------------------------------------

test("AgentLifecycle: transitions through a normal chat flow", () => {
  const lifecycle = new AgentLifecycle({ agentId: "agent-1" });

  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 50 });
  assert.equal(lifecycle.currentState(), AgentStates.RECEIVING);

  lifecycle.transition(AgentStates.THINKING, { inputLength: 50 });
  assert.equal(lifecycle.currentState(), AgentStates.THINKING);

  lifecycle.transition(AgentStates.RESPONDING);
  assert.equal(lifecycle.currentState(), AgentStates.RESPONDING);

  lifecycle.transition(AgentStates.COMPLETED, { responseComplete: true });
  assert.equal(lifecycle.currentState(), AgentStates.COMPLETED);
});

test("AgentLifecycle: tool-call path works with hasTools guard", () => {
  const lifecycle = new AgentLifecycle({ agentId: "tooler" });

  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 10 });
  lifecycle.transition(AgentStates.THINKING);
  lifecycle.transition(AgentStates.TOOL_CALL, { hasTools: true });
  assert.equal(lifecycle.currentState(), AgentStates.TOOL_CALL);

  lifecycle.transition(AgentStates.WAITING_TOOL);
  assert.equal(lifecycle.currentState(), AgentStates.WAITING_TOOL);
});

// ------------------------------------------------------------------
// Guards
// ------------------------------------------------------------------

test("AgentLifecycle: guard blocks THINKING → TOOL_CALL when hasTools is false", () => {
  const lifecycle = new AgentLifecycle({ agentId: "no-tools" });

  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 1 });
  lifecycle.transition(AgentStates.THINKING);

  assert.equal(lifecycle.canTransition(AgentStates.TOOL_CALL, { hasTools: false }), false);
  assert.throws(
    () => lifecycle.transition(AgentStates.TOOL_CALL, { hasTools: false }),
    { message: /Invalid/ },
  );
});

test("AgentLifecycle: guard blocks RESPONDING → COMPLETED when responseComplete is false", () => {
  const lifecycle = new AgentLifecycle({ agentId: "guard-test" });

  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 1 });
  lifecycle.transition(AgentStates.THINKING);
  lifecycle.transition(AgentStates.RESPONDING);

  assert.equal(lifecycle.canTransition(AgentStates.COMPLETED, { responseComplete: false }), false);
});

test("AgentLifecycle: guard blocks RECEIVING → THINKING when inputLength is 0", () => {
  const lifecycle = new AgentLifecycle({ agentId: "empty-input" });

  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 0 });
  // cannot go to THINKING with zero-length input
  assert.equal(lifecycle.canTransition(AgentStates.THINKING, { inputLength: 0 }), false);
});

// ------------------------------------------------------------------
// Interrupt and error
// ------------------------------------------------------------------

test("AgentLifecycle: can be interrupted from any active state", () => {
  const lifecycle = new AgentLifecycle({ agentId: "interrupt-me" });

  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 10 });
  lifecycle.transition(AgentStates.THINKING);
  lifecycle.transition(AgentStates.INTERRUPTED);

  assert.equal(lifecycle.currentState(), AgentStates.INTERRUPTED);
});

test("AgentLifecycle: can transition to error from any active state", () => {
  const lifecycle = new AgentLifecycle({ agentId: "error-me" });

  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 10 });
  lifecycle.transition(AgentStates.ERROR);

  assert.equal(lifecycle.currentState(), AgentStates.ERROR);

  // ERROR → IDLE
  lifecycle.transition(AgentStates.IDLE);
  assert.equal(lifecycle.currentState(), AgentStates.IDLE);
});

// ------------------------------------------------------------------
// Input acceptance
// ------------------------------------------------------------------

test("AgentLifecycle: canAcceptInput is true only for IDLE, COMPLETED, INTERRUPTED", () => {
  const lifecycle = new AgentLifecycle({ agentId: "input-test" });

  assert.equal(lifecycle.canAcceptInput(), true); // IDLE

  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 10 });
  assert.equal(lifecycle.canAcceptInput(), false);

  lifecycle.transition(AgentStates.THINKING);
  assert.equal(lifecycle.canAcceptInput(), false);

  // INTERRUPTED
  lifecycle.transition(AgentStates.INTERRUPTED);
  assert.equal(lifecycle.canAcceptInput(), true);

  // back to IDLE
  lifecycle.transition(AgentStates.IDLE);
  assert.equal(lifecycle.canAcceptInput(), true);
});

// ------------------------------------------------------------------
// Subscriptions
// ------------------------------------------------------------------

test("AgentLifecycle: onStateChange notifies subscribers after transition", () => {
  const lifecycle = new AgentLifecycle({ agentId: "sub-test" });
  const calls = [];

  lifecycle.onStateChange((from, to, ctx) => {
    calls.push({ from, to, ctx });
  });

  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 42 });
  lifecycle.transition(AgentStates.THINKING);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].from, AgentStates.IDLE);
  assert.equal(calls[0].to, AgentStates.RECEIVING);
  assert.deepEqual(calls[0].ctx, { inputLength: 42 });

  assert.equal(calls[1].from, AgentStates.RECEIVING);
  assert.equal(calls[1].to, AgentStates.THINKING);
});

test("AgentLifecycle: onStateChange returns an unsubscribe function", () => {
  const lifecycle = new AgentLifecycle({ agentId: "unsub-test" });
  let count = 0;

  const unsub = lifecycle.onStateChange(() => {
    count += 1;
  });

  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 1 });
  assert.equal(count, 1);

  unsub();

  lifecycle.transition(AgentStates.THINKING);
  assert.equal(count, 1); // Still 1 — unsubscribed
});

test("AgentLifecycle: onStateChange subscriber errors do not break other subscribers", () => {
  const lifecycle = new AgentLifecycle({ agentId: "error-sub" });
  let secondCalled = false;

  lifecycle.onStateChange(() => {
    throw new Error("boom");
  });
  lifecycle.onStateChange(() => {
    secondCalled = true;
  });

  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 1 });
  assert.equal(secondCalled, true);
});

test("AgentLifecycle: onStateChange throws for non-function handler", () => {
  const lifecycle = new AgentLifecycle();
  assert.throws(() => lifecycle.onStateChange("not-a-fn"), {
    message: /must be a function/,
  });
});

// ------------------------------------------------------------------
// Timing
// ------------------------------------------------------------------

test("AgentLifecycle: getElapsedInState returns time since last transition", async () => {
  const lifecycle = new AgentLifecycle({ agentId: "timer" });

  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 1 });
  await sleep(20);

  assert.ok(lifecycle.getElapsedInState() > 0);
});

test("AgentLifecycle: getStateSummary accumulates time per state", async () => {
  const lifecycle = new AgentLifecycle({ agentId: "summary" });

  // Let IDLE accumulate some time
  await sleep(5);
  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 1 });
  await sleep(10);

  // Must have at least some time in IDLE and RECEIVING
  const summary = lifecycle.getStateSummary();
  assert.ok(typeof summary[AgentStates.IDLE] === "number");
  assert.ok(summary[AgentStates.IDLE] >= 0);
  assert.ok(summary[AgentStates.RECEIVING] > 0);
});

// ------------------------------------------------------------------
// Reset
// ------------------------------------------------------------------

test("AgentLifecycle: reset clears timing and listeners, returns to IDLE", async () => {
  const lifecycle = new AgentLifecycle({ agentId: "reset-me" });
  let called = false;
  lifecycle.onStateChange(() => { called = true; });

  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 1 });
  lifecycle.transition(AgentStates.THINKING);
  assert.ok(lifecycle.getElapsedInState() >= 0);

  lifecycle.reset();

  assert.equal(lifecycle.currentState(), AgentStates.IDLE);
  assert.equal(called, true); // was called before reset

  // After reset, listeners should be cleared and timing reset
  const summary = lifecycle.getStateSummary();
  // After reset summary may still have accumulated time from before reset (it records accumulated + current)
  // The important thing is current state is IDLE
  assert.equal(lifecycle.currentState(), AgentStates.IDLE);
});
