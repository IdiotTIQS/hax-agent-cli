"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { TeamCoordinator, TeamStates } = require("../../src/state/team-coordinator");
const { AgentLifecycle, AgentStates } = require("../../src/state/agent-lifecycle");

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function createLifecycle(agentId) {
  return new AgentLifecycle({ agentId });
}

/**
 * Advance an AgentLifecycle to the THINKING state so it counts as "active".
 */
function activateLifecycle(lifecycle) {
  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 10 });
  lifecycle.transition(AgentStates.THINKING);
}

/**
 * Advance an AgentLifecycle all the way to COMPLETED.
 */
function completeLifecycle(lifecycle) {
  lifecycle.transition(AgentStates.RECEIVING, { inputLength: 10 });
  lifecycle.transition(AgentStates.THINKING);
  lifecycle.transition(AgentStates.RESPONDING);
  lifecycle.transition(AgentStates.COMPLETED, { responseComplete: true });
}

// ------------------------------------------------------------------
// Initial state
// ------------------------------------------------------------------

test("TeamCoordinator: starts in ASSEMBLING state", () => {
  const coordinator = new TeamCoordinator({ teamId: "team-1" });
  assert.equal(coordinator.getCurrentState().name, TeamStates.ASSEMBLING);
});

test("TeamCoordinator: transition through full team lifecycle", () => {
  const coordinator = new TeamCoordinator();

  coordinator.transition(TeamStates.PLANNING);
  assert.equal(coordinator.getCurrentState().name, TeamStates.PLANNING);

  // PLANNING → EXECUTING requires at least one member
  coordinator.addMember("agent-1", createLifecycle("agent-1"));
  coordinator.transition(TeamStates.EXECUTING);
  assert.equal(coordinator.getCurrentState().name, TeamStates.EXECUTING);

  coordinator.transition(TeamStates.REVIEWING);
  assert.equal(coordinator.getCurrentState().name, TeamStates.REVIEWING);

  coordinator.transition(TeamStates.MERGING);
  assert.equal(coordinator.getCurrentState().name, TeamStates.MERGING);

  // MERGING → COMPLETED guarded by isBlocked
  coordinator.transition(TeamStates.COMPLETED);
  assert.equal(coordinator.getCurrentState().name, TeamStates.COMPLETED);
});

// ------------------------------------------------------------------
// Member management
// ------------------------------------------------------------------

test("TeamCoordinator: addMember registers an agent lifecycle", () => {
  const coordinator = new TeamCoordinator();
  const lifecycle = createLifecycle("agent-1");

  coordinator.addMember("agent-1", lifecycle);

  assert.equal(coordinator.memberCount, 1);
  assert.ok(coordinator.getMember("agent-1") !== null);
  assert.equal(coordinator.getMember("agent-1").lifecycle, lifecycle);
});

test("TeamCoordinator: addMember throws on empty agentId", () => {
  const coordinator = new TeamCoordinator();
  assert.throws(
    () => coordinator.addMember("", createLifecycle("x")),
    { message: /non-empty/ },
  );
});

test("TeamCoordinator: removeMember removes from tracking", () => {
  const coordinator = new TeamCoordinator();
  coordinator.addMember("agent-1", createLifecycle("agent-1"));
  assert.equal(coordinator.memberCount, 1);

  coordinator.removeMember("agent-1");
  assert.equal(coordinator.memberCount, 0);
  assert.equal(coordinator.getMember("agent-1"), null);
});

// ------------------------------------------------------------------
// getTeamState
// ------------------------------------------------------------------

test("TeamCoordinator: getTeamState aggregates member states", () => {
  const coordinator = new TeamCoordinator();
  const a1 = createLifecycle("agent-1");
  const a2 = createLifecycle("agent-2");

  coordinator.addMember("agent-1", a1);
  coordinator.addMember("agent-2", a2);
  activateLifecycle(a1); // a1 → THINKING

  const teamState = coordinator.getTeamState();

  assert.equal(teamState.teamState, TeamStates.ASSEMBLING);
  assert.equal(teamState.memberCount, 2);
  assert.equal(teamState.members["agent-1"], AgentStates.THINKING);
  assert.equal(teamState.members["agent-2"], AgentStates.IDLE);
});

// ------------------------------------------------------------------
// Blocked / Bottlenecks
// ------------------------------------------------------------------

test("TeamCoordinator: isBlocked returns true when any member is in error", () => {
  const coordinator = new TeamCoordinator();
  const a1 = createLifecycle("agent-1");
  coordinator.addMember("agent-1", a1);

  activateLifecycle(a1);
  a1.transition(AgentStates.ERROR);

  assert.equal(coordinator.isBlocked(), true);
});

test("TeamCoordinator: isBlocked returns false when all members are healthy", () => {
  const coordinator = new TeamCoordinator();
  coordinator.addMember("agent-1", createLifecycle("agent-1"));
  coordinator.addMember("agent-2", createLifecycle("agent-2"));

  assert.equal(coordinator.isBlocked(), false);
});

test("TeamCoordinator: getBottlenecks identifies interrupted and error members", () => {
  const coordinator = new TeamCoordinator();
  const a1 = createLifecycle("agent-1");
  const a2 = createLifecycle("agent-2");
  const a3 = createLifecycle("agent-3");

  coordinator.addMember("agent-1", a1);
  coordinator.addMember("agent-2", a2);
  coordinator.addMember("agent-3", a3);

  activateLifecycle(a1);
  a1.transition(AgentStates.ERROR);

  activateLifecycle(a2);
  a2.transition(AgentStates.INTERRUPTED);

  const bottlenecks = coordinator.getBottlenecks();
  assert.equal(bottlenecks.length, 2);

  const errorAgent = bottlenecks.find((b) => b.agentId === "agent-1");
  assert.equal(errorAgent.state, AgentStates.ERROR);

  const interruptedAgent = bottlenecks.find((b) => b.agentId === "agent-2");
  assert.equal(interruptedAgent.state, AgentStates.INTERRUPTED);
});

// ------------------------------------------------------------------
// Progress
// ------------------------------------------------------------------

test("TeamCoordinator: getProgress categorises members correctly", () => {
  const coordinator = new TeamCoordinator();

  const idle   = createLifecycle("idle-agent");
  const active = createLifecycle("active-agent");
  const done   = createLifecycle("done-agent");
  const failed = createLifecycle("failed-agent");

  coordinator.addMember("idle-agent", idle);
  coordinator.addMember("active-agent", active);
  coordinator.addMember("done-agent", done);
  coordinator.addMember("failed-agent", failed);

  activateLifecycle(active);            // active → THINKING
  completeLifecycle(done);              // done → COMPLETED
  activateLifecycle(failed);
  failed.transition(AgentStates.ERROR); // failed → ERROR

  const progress = coordinator.getProgress();

  assert.equal(progress.total, 4);
  assert.equal(progress.active, 1);     // active-agent
  assert.equal(progress.completed, 1);  // done-agent
  assert.equal(progress.failed, 1);     // failed-agent
  // idle-agent is neither active, waiting, completed, nor failed
  assert.equal(progress.waiting, 0);
});

test("TeamCoordinator: getProgress counts waiting_tool as waiting", () => {
  const coordinator = new TeamCoordinator();
  const waiter = createLifecycle("waiter");
  coordinator.addMember("waiter", waiter);

  activateLifecycle(waiter);
  waiter.transition(AgentStates.TOOL_CALL, { hasTools: true });
  waiter.transition(AgentStates.WAITING_TOOL);

  const progress = coordinator.getProgress();
  assert.equal(progress.waiting, 1);
});

// ------------------------------------------------------------------
// Coordinate
// ------------------------------------------------------------------

test("TeamCoordinator: coordinate returns suggestions for blocked members", () => {
  const coordinator = new TeamCoordinator();
  const a1 = createLifecycle("agent-1");
  const a2 = createLifecycle("agent-2");

  coordinator.addMember("agent-1", a1);
  coordinator.addMember("agent-2", a2);

  activateLifecycle(a1);
  a1.transition(AgentStates.ERROR);

  activateLifecycle(a2);
  a2.transition(AgentStates.INTERRUPTED);

  const result = coordinator.coordinate();

  assert.equal(result.blocked, true);
  assert.equal(result.suggestions.length, 2);

  const resetSuggestion = result.suggestions.find((s) => s.agentId === "agent-1");
  assert.equal(resetSuggestion.action, "reset");

  const resumeSuggestion = result.suggestions.find((s) => s.agentId === "agent-2");
  assert.equal(resumeSuggestion.action, "resume");
});

// ------------------------------------------------------------------
// Guards on team transitions
// ------------------------------------------------------------------

test("TeamCoordinator: guard blocks PLANNING → EXECUTING when no members exist", () => {
  const coordinator = new TeamCoordinator();
  coordinator.transition(TeamStates.PLANNING);

  assert.equal(
    coordinator.canTransition(TeamStates.EXECUTING),
    false,
  );
});

test("TeamCoordinator: guard blocks MERGING → COMPLETED when members are blocked", () => {
  const coordinator = new TeamCoordinator();
  const a1 = createLifecycle("agent-1");
  coordinator.addMember("agent-1", a1);
  activateLifecycle(a1);
  a1.transition(AgentStates.ERROR);

  coordinator.transition(TeamStates.PLANNING);
  coordinator.transition(TeamStates.EXECUTING);
  coordinator.transition(TeamStates.REVIEWING);
  coordinator.transition(TeamStates.MERGING);

  assert.equal(coordinator.isBlocked(), true);
  assert.equal(
    coordinator.canTransition(TeamStates.COMPLETED),
    false,
  );
});

// ------------------------------------------------------------------
// Reset
// ------------------------------------------------------------------

test("TeamCoordinator: reset clears members and returns to ASSEMBLING", () => {
  const coordinator = new TeamCoordinator();
  coordinator.addMember("agent-1", createLifecycle("agent-1"));
  coordinator.addMember("agent-2", createLifecycle("agent-2"));
  coordinator.transition(TeamStates.PLANNING);
  coordinator.transition(TeamStates.EXECUTING);

  coordinator.reset();

  assert.equal(coordinator.getCurrentState().name, TeamStates.ASSEMBLING);
  assert.equal(coordinator.memberCount, 0);
});
