const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AgentRegistry,
  AgentStatus,
  MessageRouter,
  TaskBoard,
  TaskStatus,
  createAgentTeam,
  executeParallel,
  executeReadyTasks,
} = require('../src/orchestration');

test('TaskBoard separates ready tasks from dependency-blocked tasks', () => {
  const board = new TaskBoard([
    { id: 'A1', title: 'Map contracts' },
    { id: 'A2', title: 'Review contracts', dependsOn: ['A1'] },
  ]);

  assert.deepEqual(board.getReadyTasks().map((task) => task.id), ['A1']);
  assert.deepEqual(board.getBlockedTasks().map((task) => task.id), ['A2']);

  board.startTask('A1', 'architect');
  board.completeTask('A1', 'contract map');

  assert.deepEqual(board.getReadyTasks().map((task) => task.id), ['A2']);
  assert.equal(board.getProgress().percentComplete, 50);
});

test('AgentRegistry assigns, releases, and marks agents offline', () => {
  const registry = new AgentRegistry([{ name: 'architect', role: 'Plans boundaries' }]);

  assert.equal(registry.getAgent('architect').status, AgentStatus.idle);
  assert.equal(registry.assignTask('architect', 'A1').currentTaskId, 'A1');
  assert.equal(registry.getAvailableAgents().length, 0);
  assert.equal(registry.releaseAgent('architect').status, AgentStatus.idle);
  assert.equal(registry.setOffline('architect').status, AgentStatus.offline);
});

test('MessageRouter sends, drains, broadcasts, and filters history', () => {
  const router = new MessageRouter(['architect', 'reviewer', 'tester']);

  const direct = router.send({ from: 'architect', to: 'reviewer', taskId: 'A1', body: 'ready' });
  const broadcast = router.broadcast({ from: 'architect', to: ['architect', 'reviewer', 'tester'], type: 'status', body: 'done' });

  assert.equal(direct.id, 'msg-1');
  assert.equal(broadcast.length, 2);
  assert.deepEqual(router.drain('reviewer').map((message) => message.id), ['msg-1', 'msg-2']);
  assert.deepEqual(router.drain('reviewer'), []);
  assert.deepEqual(router.history({ taskId: 'A1' }).map((message) => message.id), ['msg-1']);
  assert.equal(router.history({ agent: 'tester' }).length, 1);
});

test('executeParallel preserves result order and captures failures', async () => {
  const results = await executeParallel(
    ['one', 'two', 'three'],
    async (item) => {
      if (item === 'two') {
        throw new Error('nope');
      }

      return item.toUpperCase();
    },
    { concurrency: 2 },
  );

  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal(results[0].value, 'ONE');
  assert.equal(results[1].reason.message, 'nope');
  assert.equal(results[2].value, 'THREE');
});

test('executeReadyTasks runs available owner workers and completes tasks', async () => {
  const team = createAgentTeam({
    name: 'sample',
    agents: [{ name: 'architect', role: 'Plans boundaries' }],
    tasks: [{ id: 'A1', title: 'Map contracts', owner: 'architect' }],
  });

  const results = await executeReadyTasks(
    team.board,
    team.registry,
    {
      architect: async (task) => `completed ${task.id}`,
    },
  );

  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[0].value.result, 'completed A1');
  assert.equal(team.board.getTask('A1').status, TaskStatus.completed);
  assert.equal(team.registry.getAgent('architect').status, AgentStatus.idle);
});
