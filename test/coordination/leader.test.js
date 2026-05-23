"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ELECTION_STATE, LeaderElection } = require("../../src/coordination/leader");

// ---- Registration ----

test("LeaderElection: register adds a node with correct fields", () => {
  const election = new LeaderElection();
  const node = election.register("node-1", 10);

  assert.equal(node.id, "node-1");
  assert.equal(node.priority, 10);
  assert.ok(typeof node.registeredAt === "string");
  assert.equal(election.getNodes().length, 1);
});

test("LeaderElection: register throws on empty or non-string nodeId", () => {
  const election = new LeaderElection();

  assert.throws(() => election.register(""), { message: /non-empty string/ });
  assert.throws(() => election.register(null), { message: /non-empty string/ });
  assert.throws(() => election.register(123), { message: /non-empty string/ });
});

test("LeaderElection: register throws on duplicate nodeId", () => {
  const election = new LeaderElection();
  election.register("node-1", 5);

  assert.throws(() => election.register("node-1", 10), { message: /already registered/ });
});

test("LeaderElection: register rejects non-integer priority", () => {
  const election = new LeaderElection();

  assert.throws(() => election.register("node-1", 3.14), { message: /safe integer/ });
  assert.throws(() => election.register("node-1", "high"), { message: /safe integer/ });
});

// ---- Election ----

test("LeaderElection: elect picks highest priority node (bully algorithm)", () => {
  const election = new LeaderElection();
  election.register("node-a", 1);
  election.register("node-b", 50);
  election.register("node-c", 10);

  const result = election.elect();

  assert.equal(result.leader, "node-b");
  assert.equal(result.priority, 50);
  assert.equal(result.term, 1);
  assert.equal(election.getLeader(), "node-b");
  assert.equal(election.isLeader("node-b"), true);
  assert.equal(election.isLeader("node-a"), false);
});

test("LeaderElection: elect breaks priority ties by lexicographic nodeId", () => {
  const election = new LeaderElection();
  election.register("node-z", 10);
  election.register("node-a", 10);
  election.register("node-m", 10);

  const result = election.elect();

  assert.equal(result.leader, "node-a"); // lexicographically smallest
});

test("LeaderElection: elect throws when no nodes are registered", () => {
  const election = new LeaderElection();

  assert.throws(() => election.elect(), { message: /No registered nodes/ });
});

test("LeaderElection: elect increments term on each call", () => {
  const election = new LeaderElection();
  election.register("node-1", 5);

  election.elect();
  assert.equal(election.getTerm(), 1);

  election.elect();
  assert.equal(election.getTerm(), 2);

  election.elect();
  assert.equal(election.getTerm(), 3);
});

// ---- Resignation ----

test("LeaderElection: resign steps down the current leader", () => {
  const election = new LeaderElection();
  election.register("node-1", 5);
  election.register("node-2", 3);
  election.elect();

  assert.equal(election.getLeader(), "node-1");

  const record = election.resign("node-1");

  assert.equal(record.previousLeader, "node-1");
  assert.equal(election.getLeader(), null);
  assert.equal(election.getState(), ELECTION_STATE.idle);
});

test("LeaderElection: resign throws when non-leader tries to resign", () => {
  const election = new LeaderElection();
  election.register("node-1", 5);
  election.register("node-2", 3);
  election.elect();

  assert.throws(() => election.resign("node-2"), { message: /not the leader/ });
});

// ---- Unregister ----

test("LeaderElection: unregister vacates leadership when leader is removed", () => {
  const election = new LeaderElection();
  election.register("node-1", 5);
  election.register("node-2", 3);
  election.elect();

  assert.equal(election.getLeader(), "node-1");

  election.unregister("node-1");
  assert.equal(election.getLeader(), null);
  assert.equal(election.getNodes().length, 1);
});

test("LeaderElection: unregister throws on unknown nodeId", () => {
  const election = new LeaderElection();

  assert.throws(() => election.unregister("ghost"), { message: /Unknown node/ });
});

// ---- Leader-change events ----

test("LeaderElection: onLeaderChange fires on election", (context) => {
  const election = new LeaderElection();
  election.register("node-1", 5);
  election.register("node-2", 10);

  const events = [];

  election.onLeaderChange((event) => {
    events.push(event);
  });

  election.elect();

  assert.equal(events.length, 1);
  assert.equal(events[0].newLeader, "node-2");
  assert.equal(events[0].previousLeader, null);
  assert.equal(events[0].reason, "elected");
  assert.equal(events[0].term, 1);
});

test("LeaderElection: onLeaderChange fires on resign", () => {
  const election = new LeaderElection();
  election.register("node-1", 5);
  election.elect();

  const events = [];

  election.onLeaderChange((event) => {
    events.push(event);
  });

  election.resign("node-1");

  assert.equal(events.length, 1);
  assert.equal(events[0].previousLeader, "node-1");
  assert.equal(events[0].newLeader, null);
  assert.equal(events[0].reason, "resigned");
});

test("LeaderElection: onLeaderChange fires on unregister of leader", () => {
  const election = new LeaderElection();
  election.register("node-1", 5);
  election.elect();

  const events = [];

  election.onLeaderChange((event) => {
    events.push(event);
  });

  election.unregister("node-1");

  assert.equal(events.length, 1);
  assert.equal(events[0].previousLeader, "node-1");
  assert.equal(events[0].newLeader, null);
  assert.equal(events[0].reason, "unregistered");
});

test("LeaderElection: onLeaderChange does NOT fire when same leader is re-elected", () => {
  const election = new LeaderElection();
  election.register("node-1", 5);
  election.elect();

  const events = [];

  election.onLeaderChange((event) => {
    events.push(event);
  });

  // Re-elect with same leader still highest
  election.elect();

  assert.equal(events.length, 0);
});

test("LeaderElection: onLeaderChange fires when new leader replaces old one", () => {
  const election = new LeaderElection();
  election.register("node-1", 5);
  election.register("node-2", 1);
  election.elect(); // node-1 wins

  // Add a higher priority node
  election.register("node-3", 20);

  const events = [];

  election.onLeaderChange((event) => {
    events.push(event);
  });

  election.elect(); // node-3 should win

  assert.equal(events.length, 1);
  assert.equal(events[0].previousLeader, "node-1");
  assert.equal(events[0].newLeader, "node-3");
  assert.equal(events[0].reason, "elected");
});

test("LeaderElection: offLeaderChange removes a handler", () => {
  const election = new LeaderElection();
  election.register("node-1", 5);

  const events = [];

  const handler = (event) => events.push(event);

  election.onLeaderChange(handler);
  election.offLeaderChange(handler);

  election.elect();

  assert.equal(events.length, 0);
});

test("LeaderElection: getNode returns a single node or null", () => {
  const election = new LeaderElection();
  election.register("node-1", 5);

  assert.deepEqual(election.getNode("node-1").id, "node-1");
  assert.equal(election.getNode("ghost"), null);
});
