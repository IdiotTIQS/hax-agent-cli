"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { StateMachine } = require("../../src/state/fsm");

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function buildBasicFsm() {
  const fsm = new StateMachine({ initial: "idle" });
  fsm.addState("idle", {
    transitions: ["running"],
    entry() {
      fsm._idleEntry = (fsm._idleEntry || 0) + 1;
    },
    exit() {
      fsm._idleExit = (fsm._idleExit || 0) + 1;
    },
  });
  fsm.addState("running", {
    transitions: ["paused", "completed"],
    entry() {
      fsm._runEntry = (fsm._runEntry || 0) + 1;
    },
  });
  fsm.addState("paused", {
    transitions: ["running"],
  });
  fsm.addState("completed");
  return fsm;
}

// ------------------------------------------------------------------
// Core construction
// ------------------------------------------------------------------

test("StateMachine: constructor sets initial state", () => {
  const fsm = new StateMachine({ initial: "pending" });
  fsm.addState("pending");
  assert.equal(fsm.getCurrentState().name, "pending");
});

test("StateMachine: constructor without initial starts null", () => {
  const fsm = new StateMachine();
  assert.equal(fsm.getCurrentState(), null);
});

test("StateMachine: addState auto-sets initial when none is provided", () => {
  const fsm = new StateMachine();
  fsm.addState("first");
  assert.equal(fsm.getCurrentState().name, "first");
});

test("StateMachine: addState throws on empty name", () => {
  const fsm = new StateMachine();
  assert.throws(() => fsm.addState(""), { message: /non-empty/ });
  assert.throws(() => fsm.addState(42), { message: /non-empty/ });
});

// ------------------------------------------------------------------
// Transitions
// ------------------------------------------------------------------

test("StateMachine: transition moves between allowed states", () => {
  const fsm = buildBasicFsm();
  fsm.transition("running");
  assert.equal(fsm.getCurrentState().name, "running");
});

test("StateMachine: transition runs exit and entry actions", () => {
  const fsm = buildBasicFsm();

  fsm._idleEntry = 0;
  fsm._idleExit = 0;
  fsm._runEntry = 0;

  fsm.transition("running");

  assert.equal(fsm._idleExit, 1);
  assert.equal(fsm._runEntry, 1);
});

test("StateMachine: transition throws on invalid transition", () => {
  const fsm = buildBasicFsm();
  // idle → completed is not allowed
  assert.throws(
    () => fsm.transition("completed"),
    { message: /Invalid transition/ },
  );
});

test("StateMachine: canTransition returns true for allowed target", () => {
  const fsm = buildBasicFsm();
  assert.equal(fsm.canTransition("running"), true);
});

test("StateMachine: canTransition returns false for disallowed target", () => {
  const fsm = buildBasicFsm();
  assert.equal(fsm.canTransition("completed"), false);
});

test("StateMachine: canTransition returns false for unknown target", () => {
  const fsm = buildBasicFsm();
  assert.equal(fsm.canTransition("nonexistent"), false);
});

// ------------------------------------------------------------------
// Queries
// ------------------------------------------------------------------

test("StateMachine: getAvailableTransitions lists reachable states", () => {
  const fsm = buildBasicFsm();
  const available = fsm.getAvailableTransitions();
  assert.deepEqual(available, ["running"]);

  fsm.transition("running");
  assert.deepEqual(fsm.getAvailableTransitions(), ["paused", "completed"]);
});

test("StateMachine: getHistory records every transition", () => {
  const fsm = buildBasicFsm();
  // History starts with initial
  assert.equal(fsm.getHistory().length, 1);
  assert.equal(fsm.getHistory()[0].to, "idle");

  fsm.transition("running");
  fsm.transition("paused");

  const hist = fsm.getHistory();
  assert.equal(hist.length, 3);
  assert.equal(hist[1].from, "idle");
  assert.equal(hist[1].to, "running");
  assert.equal(hist[2].from, "running");
  assert.equal(hist[2].to, "paused");
});

test("StateMachine: getCurrentState reports elapsed time", () => {
  const fsm = buildBasicFsm();
  const info = fsm.getCurrentState();
  assert.ok(typeof info.elapsed === "number");
  assert.ok(info.elapsed >= 0);
});

// ------------------------------------------------------------------
// Reset
// ------------------------------------------------------------------

test("StateMachine: reset returns to initial state", () => {
  const fsm = buildBasicFsm();
  fsm.transition("running");
  fsm.transition("paused");
  assert.equal(fsm.getCurrentState().name, "paused");

  fsm.reset();
  assert.equal(fsm.getCurrentState().name, "idle");
});

test("StateMachine: reset adds a history entry", () => {
  const fsm = buildBasicFsm();
  const lenBefore = fsm.getHistory().length;
  fsm.reset();
  assert.equal(fsm.getHistory().length, lenBefore + 1);
  assert.equal(fsm.getHistory().at(-1).meta.reset, true);
});

// ------------------------------------------------------------------
// Wildcard transitions
// ------------------------------------------------------------------

test("StateMachine: wildcard from (*) allows transition from any state", () => {
  const fsm = new StateMachine({ initial: "a" });
  fsm.addState("a", { transitions: ["b"] });
  fsm.addState("b", { transitions: ["c"] });
  fsm.addState("c");
  fsm.addState("abort");

  // * → abort means any state can go to abort
  fsm.addTransition("*", "abort");

  assert.equal(fsm.canTransition("abort"), true); // from 'a'
  fsm.transition("abort");
  assert.equal(fsm.getCurrentState().name, "abort");
});

// ------------------------------------------------------------------
// Guards
// ------------------------------------------------------------------

test("StateMachine: guard that returns true permits the transition", () => {
  const fsm = new StateMachine({ initial: "start" });
  fsm.addState("start", { transitions: ["next"] });
  fsm.addState("next");
  fsm.addTransition("start", "next", () => true);

  assert.equal(fsm.canTransition("next"), true);
  fsm.transition("next");
  assert.equal(fsm.getCurrentState().name, "next");
});

test("StateMachine: guard that returns false blocks the transition", () => {
  const fsm = new StateMachine({ initial: "start" });
  fsm.addState("start", { transitions: ["next"] });
  fsm.addState("next");
  fsm.addTransition("start", "next", () => false);

  assert.equal(fsm.canTransition("next"), false);
  assert.throws(() => fsm.transition("next"), { message: /Invalid/ });
});

test("StateMachine: guard receives context object", () => {
  const fsm = new StateMachine({ initial: "start" });
  fsm.addState("start", { transitions: ["next"] });
  fsm.addState("next");

  let receivedContext = null;
  fsm.addTransition("start", "next", (ctx) => {
    receivedContext = ctx;
    return true;
  });

  fsm.transition("next", { user: "alice", role: "admin" });
  assert.deepEqual(receivedContext, { user: "alice", role: "admin" });
});

test("StateMachine: guard that throws is treated as blocked", () => {
  const fsm = new StateMachine({ initial: "start" });
  fsm.addState("start", { transitions: ["next"] });
  fsm.addState("next");
  fsm.addTransition("start", "next", () => {
    throw new Error("guard explosion");
  });

  assert.equal(fsm.canTransition("next"), false);
});

test("StateMachine: multiple guards use OR semantics (any pass = allowed)", () => {
  const fsm = new StateMachine({ initial: "start" });
  fsm.addState("start", { transitions: ["next"] });
  fsm.addState("next");

  // Two guards on the same path — first fails, second passes
  fsm.addTransition("start", "next", () => false);
  fsm.addTransition("start", "next", () => true);

  assert.equal(fsm.canTransition("next"), true);
  fsm.transition("next");
  assert.equal(fsm.getCurrentState().name, "next");
});

test("StateMachine: fluent API chains addState and addTransition", () => {
  const fsm = new StateMachine({ initial: "alpha" })
    .addState("alpha", { transitions: ["beta"] })
    .addState("beta")
    .addTransition("alpha", "beta", (ctx) => ctx.ready === true);

  assert.equal(fsm.canTransition("beta"), false);
  assert.equal(fsm.canTransition("beta", { ready: true }), true);
  fsm.transition("beta", { ready: true });
  assert.equal(fsm.getCurrentState().name, "beta");
});

// ------------------------------------------------------------------
// Edge cases
// ------------------------------------------------------------------

test("StateMachine: transition to self is not implicitly allowed", () => {
  const fsm = buildBasicFsm();
  // idle does not have a self-loop
  assert.equal(fsm.canTransition("idle"), false);
});

test("StateMachine: exit action failure does not block transition", () => {
  const fsm = new StateMachine({ initial: "start" });
  fsm.addState("start", {
    transitions: ["next"],
    exit() {
      throw new Error("exit failed");
    },
  });
  fsm.addState("next");

  // Should not throw
  fsm.transition("next");
  assert.equal(fsm.getCurrentState().name, "next");
});

test("StateMachine: entry action failure does not block transition", () => {
  const fsm = new StateMachine({ initial: "start" });
  fsm.addState("start", { transitions: ["next"] });
  fsm.addState("next", {
    entry() {
      throw new Error("entry failed");
    },
  });

  fsm.transition("next");
  assert.equal(fsm.getCurrentState().name, "next");
});
