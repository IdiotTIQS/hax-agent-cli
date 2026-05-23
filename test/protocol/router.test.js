'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MessageRouter,
  STRATEGY,
  createRouter,
  normalizeAgent,
} = require('../../src/protocol/router');

// ---- Helpers ----

function registerDefaultAgents(router) {
  router.registerAgent({ name: 'architect', role: 'architect', capabilities: ['plan', 'design'] });
  router.registerAgent({ name: 'reviewer', role: 'reviewer', capabilities: ['review', 'audit'] });
  router.registerAgent({ name: 'tester', role: 'tester', capabilities: ['test', 'verify', 'lint'] });
  router.registerAgent({ name: 'security', role: 'security-reviewer', capabilities: ['audit', 'vulnerability-scan'] });
  router.registerAgent({ name: 'docs-writer', role: 'docs-writer', capabilities: ['write', 'document'] });
}

// ---- Tests ----

test('registerAgent adds an agent to the routing table', () => {
  const router = new MessageRouter();

  const agent = router.registerAgent({
    name: 'architect',
    role: 'architect',
    capabilities: ['plan', 'design'],
  });

  assert.equal(agent.name, 'architect');
  assert.equal(agent.role, 'architect');
  assert.deepEqual(agent.capabilities, ['plan', 'design']);
  assert.deepEqual(router.agents, ['architect']);
});

test('registerAgent throws on duplicate agent name', () => {
  const router = new MessageRouter();
  router.registerAgent({ name: 'architect', role: 'architect' });

  assert.throws(
    () => router.registerAgent({ name: 'architect', role: 'reviewer' }),
    { message: /Duplicate agent/ }
  );
});

test('registerAgent throws on missing or empty name', () => {
  const router = new MessageRouter();

  assert.throws(
    () => router.registerAgent({ role: 'tester' }),
    { message: /non-empty string/ }
  );

  assert.throws(
    () => router.registerAgent({ name: '', role: 'tester' }),
    { message: /non-empty string/ }
  );
});

test('unregisterAgent removes an agent and returns true', () => {
  const router = new MessageRouter();
  router.registerAgent({ name: 'tester', role: 'tester' });

  assert.equal(router.unregisterAgent('tester'), true);
  assert.deepEqual(router.agents, []);
});

test('unregisterAgent returns false for unknown agent', () => {
  const router = new MessageRouter();

  assert.equal(router.unregisterAgent('nonexistent'), false);
});

test('route uses direct strategy when message has explicit "to" field', () => {
  const router = new MessageRouter();
  registerDefaultAgents(router);

  const result = router.route({ to: 'reviewer', body: 'Please review this.' });

  assert.equal(result.strategy, STRATEGY.DIRECT);
  assert.deepEqual(result.recipients, ['reviewer']);
  assert.ok(result.reason.includes('direct'));
});

test('route returns empty recipients for direct strategy when target not found', () => {
  const router = new MessageRouter();
  registerDefaultAgents(router);

  const result = router.route({ to: 'ghost-agent', body: 'Hello?' });

  assert.equal(result.strategy, STRATEGY.DIRECT);
  assert.deepEqual(result.recipients, []);
  assert.ok(result.reason.includes('not found'));
});

test('route uses role-based strategy when preferredRole matches an agent', () => {
  const router = new MessageRouter();
  registerDefaultAgents(router);

  const result = router.route({
    preferredRole: 'tester',
    body: 'Run the integration tests.',
  });

  assert.equal(result.strategy, STRATEGY.ROLE_BASED);
  assert.deepEqual(result.recipients, ['tester']);
});

test('route infers role from intent when no preferredRole is given', () => {
  const router = new MessageRouter();
  registerDefaultAgents(router);

  const result = router.route({
    intent: 'Please test the new authentication flow.',
  });

  assert.equal(result.strategy, STRATEGY.ROLE_BASED);
  assert.deepEqual(result.recipients, ['tester']);
  assert.ok(result.reason.includes('inferred role'));
});

test('route uses capability-based strategy when requiredCapabilities are specified', () => {
  const router = new MessageRouter();
  registerDefaultAgents(router);

  const result = router.route({
    requiredCapabilities: ['vulnerability-scan'],
    body: 'Scan for vulnerabilities.',
  });

  assert.equal(result.strategy, STRATEGY.CAPABILITY_BASED);
  assert.deepEqual(result.recipients, ['security']);
  assert.ok(result.reason.includes('capability match'));
});

test('route falls back to broadcast when no other strategy matches', () => {
  const router = new MessageRouter();
  registerDefaultAgents(router);

  const result = router.route({
    body: 'General announcement for the team.',
  });

  assert.equal(result.strategy, STRATEGY.BROADCAST);
  assert.equal(result.recipients.length, 5, 'all agents should be recipients');
  assert.ok(result.reason.includes('broadcast'));
});

test('route returns empty when no agents are registered', () => {
  const router = new MessageRouter();

  const result = router.route({ body: 'Hello?' });

  assert.equal(result.strategy, null);
  assert.deepEqual(result.recipients, []);
  assert.equal(result.reason, 'no agents registered');
});

test('broadcast filters recipients by role', () => {
  const router = new MessageRouter();
  registerDefaultAgents(router);

  const result = router.broadcast(
    { id: 'msg-1', body: 'All reviewers, please check the code.' },
    null,
    { role: 'reviewer' }
  );

  assert.deepEqual(result.recipients, ['reviewer']);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.totalAgents, 5);
});

test('broadcast filters recipients by capabilities', () => {
  const router = new MessageRouter();
  registerDefaultAgents(router);

  const result = router.broadcast(
    { id: 'msg-2', body: 'Anyone who can audit, check this.' },
    null,
    { capabilities: ['audit'] }
  );

  assert.deepEqual(result.recipients, ['reviewer', 'security']);
  assert.equal(result.matchedCount, 2);
});

test('broadcast filters by status and excludes specific agents', () => {
  const router = new MessageRouter();
  router.registerAgent({ name: 'alice', role: 'reviewer', capabilities: ['review'], status: 'idle' });
  router.registerAgent({ name: 'bob', role: 'reviewer', capabilities: ['review'], status: 'busy' });
  router.registerAgent({ name: 'carol', role: 'tester', capabilities: ['test'], status: 'idle' });

  const result = router.broadcast(
    { id: 'msg-3', body: 'Urgent review.' },
    null,
    { status: 'idle', exclude: ['carol'] }
  );

  assert.deepEqual(result.recipients, ['alice']);
  assert.equal(result.matchedCount, 1);
  assert.deepEqual(result.excluded, ['carol']);
});

test('getRoutingTable returns full routing state and counters', () => {
  const router = new MessageRouter();
  registerDefaultAgents(router);

  // Perform a few routes to populate counters
  router.route({ to: 'tester', body: 'test 1' });
  router.route({ to: 'reviewer', body: 'test 2' });
  router.route({ preferredRole: 'architect', body: 'test 3' });
  router.route({ body: 'broadcast me' });

  const table = router.getRoutingTable();

  assert.equal(table.agentCount, 5);
  assert.equal(table.agents.length, 5);
  assert.equal(table.defaultStrategy, STRATEGY.DIRECT);
  assert.equal(table.totalRoutes, 4);
  assert.equal(table.routeCounts[STRATEGY.DIRECT], 2);
  assert.equal(table.routeCounts[STRATEGY.ROLE_BASED], 1);
  assert.equal(table.routeCounts[STRATEGY.BROADCAST], 1);
});

test('resetCounters clears route counts but preserves agents', () => {
  const router = new MessageRouter();
  registerDefaultAgents(router);

  router.route({ to: 'tester', body: 'test' });
  router.route({ to: 'reviewer', body: 'test' });

  assert.equal(router.getRoutingTable().totalRoutes, 2);

  router.resetCounters();

  const table = router.getRoutingTable();
  assert.equal(table.totalRoutes, 0);
  assert.equal(table.routeCounts[STRATEGY.DIRECT], 0);
  assert.equal(table.agentCount, 5, 'agents should be preserved after reset');
});

test('route accepts an override list of agents instead of registered ones', () => {
  const router = new MessageRouter();

  // No registered agents, but we pass an override list
  const result = router.route(
    { to: 'helper', body: 'Help needed.' },
    [
      { name: 'helper', role: 'implementer', capabilities: ['code'] },
      { name: 'watcher', role: 'reviewer', capabilities: ['audit'] },
    ]
  );

  assert.equal(result.strategy, STRATEGY.DIRECT);
  assert.deepEqual(result.recipients, ['helper']);
});

test('broadcast respects an override agent list', () => {
  const router = new MessageRouter();

  const result = router.broadcast(
    { id: 'msg-5', body: 'Hello.' },
    [
      { name: 'alpha', role: 'tester', capabilities: ['test'], status: 'idle' },
      { name: 'beta', role: 'reviewer', capabilities: ['review'], status: 'busy' },
      { name: 'gamma', role: 'tester', capabilities: ['test'], status: 'idle' },
    ],
    { status: 'idle', exclude: ['gamma'] }
  );

  assert.deepEqual(result.recipients, ['alpha']);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.totalAgents, 3);
});

test('normalizeAgent throws on invalid agent input', () => {
  assert.throws(() => normalizeAgent(null), { message: /non-null object/ });
  assert.throws(() => normalizeAgent({}), { message: /non-empty string/ });
  assert.throws(() => normalizeAgent({ name: '' }), { message: /non-empty string/ });
});

test('createRouter is a convenience factory and accepts defaultStrategy', () => {
  const router = createRouter();
  assert.ok(router instanceof MessageRouter);

  const broadcastRouter = createRouter({ defaultStrategy: STRATEGY.BROADCAST });
  assert.equal(broadcastRouter.getRoutingTable().defaultStrategy, STRATEGY.BROADCAST);

  // Invalid strategy falls back to DIRECT
  const unknownStrategy = createRouter({ defaultStrategy: 'invalid' });
  assert.equal(unknownStrategy.getRoutingTable().defaultStrategy, STRATEGY.DIRECT);
});
