const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AgentEngine, AgentEventType, readGoalStatus } = require('../src/agent-engine');
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
      ...(options.settings || {}),
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

test('agent engine marks empty tool preambles as failed instead of completed', async () => {
  const provider = {
    name: 'capture',
    model: 'mock-large',
    async *stream() {
      yield { type: 'text', delta: '让我继续深入查看关键文件。' };
      yield { type: 'tool_limit', reason: 'empty_tool_preamble', maxToolTurns: 2 };
      yield { type: 'text', delta: '\n\nI stopped because the model repeatedly said it would inspect the project, but it did not call any available tool.' };
    },
  };
  const { engine, session } = createEngine({ provider });

  const events = await collect(engine.sendMessage('检查当前项目'));

  assert.equal(events.some((event) => event.type === AgentEventType.completed), false);
  const failed = events.find((event) => event.type === AgentEventType.failed);
  assert.equal(failed.error.code, 'EMPTY_TOOL_PREAMBLE');
  assert.match(failed.partialAssistantMessage.content, /继续深入查看关键文件/);
  assert.deepEqual(session.messages, []);
});

test('agent engine sends only budgeted context to the provider', async () => {
  const captured = [];
  const provider = {
    name: 'capture',
    model: 'mock-large',
    async *stream(request) {
      captured.push(request);
      yield { type: 'text', delta: 'ok' };
      yield { type: 'usage', inputTokens: 10, outputTokens: 1 };
    },
  };
  const { engine, session } = createEngine({ provider });
  session.settings.context = {
    windowTokens: 120,
    reserveOutputTokens: 20,
    charsPerToken: 4,
  };
  session.messages = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${index}: ${'x'.repeat(120)}`,
  }));

  const events = await collect(engine.sendMessage('latest'));

  assert.ok(captured[0].messages.length < session.messages.length);
  assert.equal(captured[0].messages.at(-1).content, 'latest');
  assert.ok(events[0].context.droppedMessages > 0);
  assert.equal(session.messages.at(-2).content, 'latest');
  assert.equal(session.messages.at(-1).content, 'ok');
});

test('agent engine injects custom instructions and relevant file context into provider system prompt', async () => {
  const captured = [];
  const provider = {
    name: 'capture',
    model: 'mock-large',
    async *stream(request) {
      captured.push(request);
      yield { type: 'text', delta: 'ok' };
      yield { type: 'usage', inputTokens: 10, outputTokens: 1 };
    },
  };
  const { engine, projectRoot, session } = createEngine({
    provider,
    settings: {
      instructions: { custom: 'Always mention tradeoffs.' },
      fileContext: {
        enabled: true,
        maxFiles: 2,
        maxIndexFiles: 20,
        maxFileSize: 10000,
        maxBytesPerFile: 1000,
        maxTotalBytes: 2000,
      },
    },
  });
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'src', 'streaming.js'), 'export const desktopStreaming = true;\n');
  fs.writeFileSync(path.join(projectRoot, 'src', 'theme.js'), 'export const theme = "blue";\n');

  const events = await collect(engine.sendMessage('fix desktop streaming'));

  assert.match(captured[0].system, /Always mention tradeoffs\./);
  assert.match(captured[0].system, /src\/streaming\.js/);
  assert.match(captured[0].system, /desktopStreaming/);
  assert.equal(events[0].context.fileContext.includedFiles, 1);
  assert.deepEqual(session.messages.map((message) => message.content), ['fix desktop streaming', 'ok']);
});

test('agent engine injects active goal into provider system prompt', async () => {
  const captured = [];
  const provider = {
    name: 'capture',
    model: 'mock-large',
    async *stream(request) {
      captured.push(request);
      yield { type: 'text', delta: 'ok' };
      yield { type: 'usage', inputTokens: 10, outputTokens: 1 };
    },
  };
  const { engine, session } = createEngine({ provider });
  session.goal = {
    enabled: true,
    text: 'make tests pass before stopping',
    createdAt: new Date().toISOString(),
  };

  await collect(engine.sendMessage('continue'));

  assert.match(captured[0].system, /<active-goal>/);
  assert.match(captured[0].system, /make tests pass before stopping/);
});

test('agent engine continues active goals until completion status', async () => {
  const captured = [];
  const responses = [
    'made progress\nGOAL_STATUS: continue',
    'done with evidence\nGOAL_STATUS: complete',
  ];
  const provider = {
    name: 'capture',
    model: 'mock-large',
    async *stream(request) {
      captured.push(request);
      yield { type: 'text', delta: responses[captured.length - 1] || 'extra\nGOAL_STATUS: complete' };
      yield { type: 'usage', inputTokens: 10, outputTokens: 1 };
    },
  };
  const { engine, session } = createEngine({ provider });
  session.goal = {
    enabled: true,
    text: 'finish the task',
    maxContinuations: 3,
    createdAt: new Date().toISOString(),
  };

  const events = await collect(engine.sendMessage('start'));
  const completed = events.filter((event) => event.type === AgentEventType.completed);

  assert.equal(captured.length, 2);
  assert.equal(completed.length, 2);
  assert.match(captured[1].messages.at(-1).content, /\[goal continuation\]/);
});

test('readGoalStatus extracts explicit goal status', () => {
  assert.equal(readGoalStatus('ok\nGOAL_STATUS: complete'), 'complete');
  assert.equal(readGoalStatus('blocked\nGOAL_STATUS: blocked'), 'blocked');
  assert.equal(readGoalStatus('no marker'), 'continue');
});
