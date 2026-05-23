"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { HeartbeatManager } = require("../../src/coordination/heartbeat");

// ---- Heartbeat reception ----

test("HeartbeatManager: receiveHeartbeat marks a node alive and records timestamp", () => {
  const mgr = new HeartbeatManager({ timeoutMs: 5000 });
  const record = mgr.receiveHeartbeat("node-1");

  assert.equal(record.id, "node-1");
  assert.equal(record.status, "alive");
  assert.ok(record.lastHeartbeat > 0);
  assert.equal(record.history.length, 1);
});

test("HeartbeatManager: receiveHeartbeat updates an existing node", () => {
  const mgr = new HeartbeatManager({ timeoutMs: 5000 });
  mgr.receiveHeartbeat("node-1");
  const record = mgr.receiveHeartbeat("node-1");

  assert.equal(record.status, "alive");
  assert.equal(record.history.length, 2);
});

test("HeartbeatManager: receiveHeartbeat stores optional metadata", () => {
  const mgr = new HeartbeatManager({ timeoutMs: 5000 });
  const record = mgr.receiveHeartbeat("node-1", { cpu: 45, mem: 2000 });

  assert.deepEqual(record.metadata, { cpu: 45, mem: 2000 });
});

test("HeartbeatManager: receiveHeartbeat throws on empty nodeId", () => {
  const mgr = new HeartbeatManager();

  assert.throws(() => mgr.receiveHeartbeat(""), { message: /non-empty string/ });
  assert.throws(() => mgr.receiveHeartbeat(null), { message: /non-empty string/ });
});

// ---- Alive / Dead detection ----

test("HeartbeatManager: getAliveNodes returns nodes that have not timed out", () => {
  const fakeNow = [1000];

  const mgr = new HeartbeatManager({ timeoutMs: 5000 });
  mgr.setClock(() => fakeNow[0]);

  mgr.receiveHeartbeat("node-1"); // lastHeartbeat = 1000
  mgr.receiveHeartbeat("node-2"); // lastHeartbeat = 1000

  assert.equal(mgr.getAliveNodes().length, 2);
  assert.equal(mgr.getAliveCount(), 2);
  assert.equal(mgr.isAlive("node-1"), true);
  assert.equal(mgr.isAlive("node-2"), true);

  // Advance clock past timeout
  fakeNow[0] = 7000;

  const alive = mgr.getAliveNodes();
  assert.equal(alive.length, 0);
  assert.equal(mgr.getAliveCount(), 0);
  assert.equal(mgr.isAlive("node-1"), false);
  assert.equal(mgr.isAlive("node-2"), false);
});

test("HeartbeatManager: getDeadNodes returns timed-out nodes", () => {
  const fakeNow = [5000];

  const mgr = new HeartbeatManager({ timeoutMs: 2000 });
  mgr.setClock(() => fakeNow[0]);

  mgr.receiveHeartbeat("node-1"); // at 5000

  fakeNow[0] = 8000; // 3000 ms later > 2000 timeout

  const dead = mgr.getDeadNodes();

  assert.equal(dead.length, 1);
  assert.equal(dead[0].id, "node-1");
  assert.equal(dead[0].status, "dead");
  assert.ok(dead[0].downAt > 0);
});

test("HeartbeatManager: isAlive returns false for unknown nodes", () => {
  const mgr = new HeartbeatManager();

  assert.equal(mgr.isAlive("ghost"), false);
});

// ---- Node-down events ----

test("HeartbeatManager: onNodeDown fires when a node times out", () => {
  const fakeNow = [1000];

  const mgr = new HeartbeatManager({ timeoutMs: 1000 });
  mgr.setClock(() => fakeNow[0]);

  mgr.receiveHeartbeat("node-1");

  const downEvents = [];

  mgr.onNodeDown((event) => {
    downEvents.push(event);
  });

  fakeNow[0] = 3000; // beyond timeout

  // Trigger evaluation
  mgr.getAliveNodes();

  assert.equal(downEvents.length, 1);
  assert.equal(downEvents[0].nodeId, "node-1");
  assert.ok(typeof downEvents[0].downAt === "number");
});

test("HeartbeatManager: offNodeDown removes a handler", () => {
  const fakeNow = [1000];

  const mgr = new HeartbeatManager({ timeoutMs: 500 });
  mgr.setClock(() => fakeNow[0]);

  mgr.receiveHeartbeat("node-1");

  const downEvents = [];

  const handler = (event) => downEvents.push(event);

  mgr.onNodeDown(handler);
  mgr.offNodeDown(handler);

  fakeNow[0] = 3000;

  mgr.getAliveNodes();

  assert.equal(downEvents.length, 0);
});

// ---- Start / Stop ----

test("HeartbeatManager: start and stop control the evaluation loop", () => {
  const mgr = new HeartbeatManager({ timeoutMs: 10000 });

  assert.equal(mgr.isRunning(), false);

  mgr.start("local-node", 500);
  assert.equal(mgr.isRunning(), true);

  mgr.stop();
  assert.equal(mgr.isRunning(), false);
});

test("HeartbeatManager: start ensures the local node exists as alive", () => {
  const mgr = new HeartbeatManager({ timeoutMs: 10000 });
  mgr.start("local-node", 500);

  assert.equal(mgr.isAlive("local-node"), true);
  assert.equal(mgr.getNode("local-node").status, "alive");

  mgr.stop();
});

test("HeartbeatManager: start throws when already running", () => {
  const mgr = new HeartbeatManager();
  mgr.start("node-1", 500);

  assert.throws(() => mgr.start("node-2", 500), { message: /already running/ });

  mgr.stop();
});

// ---- Cleanup of dead nodes ----

test("HeartbeatManager: dead nodes are purged after cleanup threshold", () => {
  const fakeNow = [1000];

  const mgr = new HeartbeatManager({ timeoutMs: 1000, cleanupThresholdMs: 5000 });
  mgr.setClock(() => fakeNow[0]);

  mgr.receiveHeartbeat("node-1"); // at 1000

  // Time out the node
  fakeNow[0] = 3000;
  mgr.getAliveNodes(); // evaluates, node-1 dies at 3000

  assert.equal(mgr.getDeadNodes().length, 1);

  // Advance past cleanup threshold
  fakeNow[0] = 9000; // 6000 ms past downAt (3000) > cleanupThreshold (5000)
  mgr.getAliveNodes(); // evaluates, purges dead node

  assert.equal(mgr.getDeadNodes().length, 0);
  assert.equal(mgr.getNode("node-1"), null);
});

// ---- getNode / removeNode ----

test("HeartbeatManager: getNode returns null for unknown nodes", () => {
  const mgr = new HeartbeatManager();

  assert.equal(mgr.getNode("ghost"), null);
});

test("HeartbeatManager: removeNode deletes a node from tracking", () => {
  const mgr = new HeartbeatManager();
  mgr.receiveHeartbeat("node-1");

  assert.ok(mgr.getNode("node-1"));

  mgr.removeNode("node-1");
  assert.equal(mgr.getNode("node-1"), null);
});

// ---- History buffer ----

test("HeartbeatManager: heartbeat history is capped at configured size", () => {
  const mgr = new HeartbeatManager({ timeoutMs: 5000, historySize: 3 });

  for (let i = 0; i < 10; i++) {
    mgr.receiveHeartbeat("node-1");
  }

  const record = mgr.getNode("node-1");
  assert.equal(record.history.length, 3);
});

// ---- getAllNodes ----

test("HeartbeatManager: getAllNodes returns all tracked nodes regardless of status", () => {
  const fakeNow = [1000];

  const mgr = new HeartbeatManager({ timeoutMs: 500 });
  mgr.setClock(() => fakeNow[0]);

  mgr.receiveHeartbeat("alive-node");   // lastHeartbeat = 1000
  mgr.receiveHeartbeat("dying-node");   // lastHeartbeat = 1000

  // Advance time past timeout: both would die at this point
  fakeNow[0] = 2000;
  mgr.getAliveNodes(); // both timed out — both are dead now

  // Re-heartbeat "alive-node" at 2000 so it comes back
  mgr.receiveHeartbeat("alive-node");

  // Advance again so dying-node has been dead for a while, alive-node is fine
  fakeNow[0] = 2500;

  const all = mgr.getAllNodes();

  assert.equal(all.length, 2);
  assert.ok(all.some((n) => n.id === "alive-node" && n.status === "alive"));
  assert.ok(all.some((n) => n.id === "dying-node" && n.status === "dead"));
});

// ---- Default timeout ----

test("HeartbeatManager: uses default timeout of 10000 ms", () => {
  const mgr = new HeartbeatManager();

  assert.equal(mgr.getTimeout(), 10000);
});
