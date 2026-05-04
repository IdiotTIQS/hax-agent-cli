const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AgentEngine, AgentEventType } = require('../src/agent-engine');
const { MockProvider } = require('../src/providers');
const { Session } = require('../src/session');
const { ToolRegistry } = require('../src/tools');
const { PermissionManager } = require('../src/permissions');

function createEngine(options = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hax-agent-engine-'));
  const session = new Session({
    provider: options.provider || new MockProvider({
      response: 'hello from mock',
      toolTrace: options.toolTrace === true,
    }),
    settings: {
      projectRoot,
      sessions: { directory: path.join(projectRoot, '.hax-agent', 'sessions') },
    },
    toolRegistry: options.toolRegistry || new ToolRegistry({ root: projectRoot }),
    permissionManager: new PermissionManager({ mode: 'yolo' }),
  });

  return {
    projectRoot,
    session,
    engine: new AgentEngine({
      session,
      projectRoot,
      env: options.env || {},
    }),
  };
}

async function collect(iterable) {
  const events = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

test('agent engine emits GUI-friendly events for a chat turn', async () => {
  const { engine, session } = createEngine();

  const events = await collect(engine.sendMessage('hello'));
  const eventTypes = events.map((event) => event.type);

  assert.equal(eventTypes[0], AgentEventType.started);
  assert.ok(eventTypes.includes(AgentEventType.messageDelta));
  assert.equal(eventTypes.at(-1), AgentEventType.completed);
  assert.equal(events.at(-1).assistantMessage.content, 'hello from mock');
  assert.equal(events.at(-1).usage.inputTokens, 1200);
  assert.equal(events.at(-1).status.tokens, events.at(-1).usage.inputTokens + events.at(-1).usage.outputTokens);
  assert.deepEqual(session.messages.map((message) => message.role), ['user', 'assistant']);
});

test('agent engine preserves structured tool events without provider type collisions', async () => {
  const { engine, session } = createEngine({ toolTrace: true });

  const events = await collect(engine.sendMessage('trace tools'));
  const toolStart = events.find((event) => event.type === AgentEventType.toolStart);
  const toolResult = events.find((event) => event.type === AgentEventType.toolResult);

  assert.equal(toolStart.name, 'file.read');
  assert.deepEqual(toolStart.input, { path: 'README.md' });
  assert.equal(toolResult.name, 'file.read');
  assert.equal(toolResult.isError, false);
  assert.equal(session.costTracker.toolCallCount, 2);
});

test('agent engine interruption does not persist partial assistant messages', async () => {
  const { engine, session } = createEngine({
    env: { HAX_AGENT_TEST_INTERRUPT_AFTER_TEXT: '1' },
  });

  const events = await collect(engine.sendMessage('interrupt me'));

  assert.ok(events.some((event) => event.type === AgentEventType.interrupted));
  assert.equal(events.some((event) => event.type === AgentEventType.completed), false);
  assert.deepEqual(session.messages, []);
});
