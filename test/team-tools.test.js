const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

const { registerAgentTeamTools } = require('../src/teams/tools');
const { createTeamRuntime } = require('../src/teams/runtime');
const { ToolRegistry } = require('../src/tools');

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-agent-test-'));
  return dir;
}

test('registerAgentTeamTools registers all team tools', () => {
  const registry = new ToolRegistry();
  registerAgentTeamTools(registry, { settings: {} });

  const tools = registry.list();
  const toolNames = tools.map(t => t.name);

  assert.ok(toolNames.includes('agent.team.status'), 'should register agent.team.status');
  assert.ok(toolNames.includes('agent.spawn'), 'should register agent.spawn');
  assert.ok(toolNames.includes('agent.task'), 'should register agent.task');
  assert.ok(toolNames.includes('agent.team.run'), 'should register agent.team.run');
  assert.ok(toolNames.includes('agent.send'), 'should register agent.send');
});

test('agent.team.status returns team snapshot', async () => {
  const registry = new ToolRegistry();
  const tempDir = await createTempDir();
  
  registerAgentTeamTools(registry, { 
    settings: {}, 
    projectRoot: tempDir 
  });

  const result = await registry.execute('agent.team.status', { team_name: 'default' });
  
  assert.ok(result.ok, 'should execute successfully');
  assert.ok(result.data, 'should return data');
  assert.equal(result.data.teamName, 'default', 'should have correct team name');
});

test('agent.spawn creates a teammate and task', async () => {
  const registry = new ToolRegistry();
  const tempDir = await createTempDir();
  
  registerAgentTeamTools(registry, { 
    settings: {}, 
    projectRoot: tempDir 
  });

  const result = await registry.execute('agent.spawn', {
    name: 'test-agent',
    prompt: 'Test task for the agent',
    team_name: 'default',
  });
  
  assert.ok(result.ok, 'should execute successfully');
  assert.equal(result.data.status, 'teammate_spawned', 'should spawn teammate');
  assert.equal(result.data.name, 'test-agent', 'should have correct agent name');
  assert.ok(result.data.task_id, 'should create a task');
});

test('agent.task adds a task to team board', async () => {
  const registry = new ToolRegistry();
  const tempDir = await createTempDir();
  
  registerAgentTeamTools(registry, { 
    settings: {}, 
    projectRoot: tempDir 
  });

  const result = await registry.execute('agent.task', {
    title: 'Test Task',
    prompt: 'Test prompt',
    team_name: 'default',
  });
  
  assert.ok(result.ok, 'should execute successfully');
  assert.equal(result.data.status, 'task_added', 'should add task');
  assert.ok(result.data.task, 'should return task object');
  assert.equal(result.data.task.title, 'Test Task', 'should have correct task title');
});

test('agent.send sends a message to teammate', async () => {
  const registry = new ToolRegistry();
  const tempDir = await createTempDir();
  
  registerAgentTeamTools(registry, { 
    settings: {}, 
    projectRoot: tempDir 
  });

  // First spawn an agent
  await registry.execute('agent.spawn', {
    name: 'test-agent',
    prompt: 'Test task',
    team_name: 'default',
  });

  const result = await registry.execute('agent.send', {
    to: 'test-agent',
    message: 'Hello from main agent',
    team_name: 'default',
  });
  
  assert.ok(result.ok, 'should execute successfully');
  assert.ok(result.data, 'should return message data');
});

test('team tools work with custom runtime factory', async () => {
  const registry = new ToolRegistry();
  const tempDir = await createTempDir();
  
  const customRuntimeFactory = () => createTeamRuntime({
    settings: {},
    projectRoot: tempDir,
  });

  registerAgentTeamTools(registry, { 
    settings: {}, 
    projectRoot: tempDir,
    runtimeFactory: customRuntimeFactory,
  });

  const result = await registry.execute('agent.team.status', { team_name: 'default' });
  
  assert.ok(result.ok, 'should execute successfully');
  assert.equal(result.data.teamName, 'default', 'should have correct team name');
});
