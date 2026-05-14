const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  config,
  context,
  memory,
} = require('../src');
const { CostTracker, Session } = require('../src/session');

function createTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hax-agent-'));
}

test('resolves settings from defaults, JSON files, env, and overrides', () => {
  const projectRoot = createTempProject();
  const userSettingsPath = path.join(projectRoot, 'user-settings.json');
  const projectSettingsPath = path.join(projectRoot, 'project-settings.json');

  fs.writeFileSync(userSettingsPath, JSON.stringify({ agent: { model: 'user-model' }, memory: { maxItems: 5 } }));
  fs.writeFileSync(projectSettingsPath, JSON.stringify({ agent: { name: 'project-agent' }, sessions: { transcriptLimit: 10 } }));

  const resolved = config.resolveSettings({
    projectRoot,
    userSettingsPath,
    projectSettingsPath,
    env: {
      HAX_AGENT_MODEL: 'env-model',
      HAX_AGENT_API_URL: 'https://example.test/v1',
      HAX_AGENT_LOCALE: 'ru',
      HAX_AGENT_MEMORY_DIR: 'state/memory',
      HAX_AGENT_CONTEXT_WINDOW_TOKENS: '1000000',
      HAX_AGENT_CONTEXT_RESERVE_OUTPUT_TOKENS: '32768',
      HAX_AGENT_INSTRUCTIONS: 'Always explain tradeoffs.',
      HAX_AGENT_FILE_CONTEXT_ENABLED: 'false',
      HAX_AGENT_FILE_CONTEXT_MAX_FILES: '3',
      HAX_AGENT_UPDATES_AUTO_INSTALL: 'true',
    },
    overrides: {
      agent: { maxTurns: 7 },
    },
  });

  assert.equal(resolved.settings.agent.name, 'project-agent');
  assert.equal(resolved.settings.agent.model, 'env-model');
  assert.equal(resolved.settings.agent.apiKey, undefined);
  assert.equal(resolved.settings.agent.apiUrl, 'https://example.test/v1');
  assert.equal(resolved.settings.ui.locale, 'ru');
  assert.equal(resolved.settings.agent.maxTurns, 7);
  assert.equal(resolved.settings.updates.autoInstall, true);
  assert.equal(resolved.settings.context.windowTokens, 1000000);
  assert.equal(resolved.settings.context.reserveOutputTokens, 32768);
  assert.equal(resolved.settings.instructions.custom, 'Always explain tradeoffs.');
  assert.equal(resolved.settings.fileContext.enabled, false);
  assert.equal(resolved.settings.fileContext.maxFiles, 3);
  assert.equal(resolved.settings.memory.maxItems, 5);
  assert.equal(resolved.settings.sessions.transcriptLimit, 10);
  assert.equal(resolved.settings.memory.directory, path.join(projectRoot, 'state', 'memory'));
  assert.deepEqual(resolved.sources.map((source) => source.loaded), [true, true]);
});

test('defaults runtime storage to the app data directory', () => {
  const projectRoot = createTempProject();
  const resolved = config.resolveSettings({
    projectRoot,
    userSettingsPath: path.join(projectRoot, 'missing-user.json'),
    projectSettingsPath: path.join(projectRoot, 'missing-project.json'),
    env: {},
  });

  assert.equal(resolved.settings.sessions.directory, config.defaultSessionDirectory());
  assert.equal(resolved.settings.memory.directory, config.defaultMemoryDirectory());
  assert.equal(resolved.settings.sessions.directory.includes(`${path.sep}.hax-agent${path.sep}`), false);
});

test('updates user settings on disk', () => {
  const projectRoot = createTempProject();
  const userSettingsPath = path.join(projectRoot, 'user-settings.json');

  const saved = config.updateUserSettings({
    agent: {
      provider: 'anthropic',
      apiKey: 'test-key',
      apiUrl: 'https://example.test/v1',
    },
  }, {
    userSettingsPath,
  });
  const settings = config.loadSettings({ projectRoot, userSettingsPath, env: {} });

  assert.equal(saved.path, userSettingsPath);
  assert.equal(settings.agent.provider, 'anthropic');
  assert.equal(settings.agent.apiKey, 'test-key');
  assert.equal(settings.agent.apiUrl, 'https://example.test/v1');
});

test('stores and reads persistent memories and session transcripts', () => {
  const projectRoot = createTempProject();
  const settings = config.loadSettings({
    projectRoot,
    env: {},
    overrides: {
      memory: { directory: path.join(projectRoot, 'memory') },
      sessions: { directory: path.join(projectRoot, 'sessions') },
    },
  });

  const storedMemory = memory.writeMemory('preference', 'Use concise answers.', settings);
  const loadedMemory = memory.readMemory('preference', settings);

  assert.equal(storedMemory.name, 'preference');
  assert.equal(loadedMemory.content, 'Use concise answers.');
  assert.deepEqual(memory.listMemories(settings).map((item) => item.name), ['preference']);

  const sessionId = memory.createSessionId(new Date('2026-04-28T10:00:00.000Z'));
  memory.appendTranscriptEntry(sessionId, { role: 'user', content: 'hello' }, settings);
  memory.appendTranscriptEntry(sessionId, { role: 'assistant', content: 'hi' }, settings);

  assert.deepEqual(memory.readTranscript(sessionId, settings).map((entry) => entry.content), ['hello', 'hi']);
  assert.equal(memory.listSessions(settings).length, 1);
  assert.equal(memory.listSessions(settings)[0].metadata().projectRoot, projectRoot);
});

test('appends to resumed transcript ids without adding another hash suffix', () => {
  const projectRoot = createTempProject();
  const settings = config.loadSettings({
    projectRoot,
    env: {},
    overrides: {
      sessions: { directory: path.join(projectRoot, 'sessions') },
    },
  });
  const sessionId = memory.createSessionId(new Date('2026-04-28T10:00:00.000Z'));

  memory.appendTranscriptEntry(sessionId, { role: 'user', content: 'first' }, settings);
  const storedSessionId = memory.listSessions(settings)[0].id;
  memory.appendTranscriptEntry(storedSessionId, { role: 'assistant', content: 'second' }, settings);

  assert.equal(memory.listSessions(settings).length, 1);
  assert.deepEqual(memory.readTranscript(storedSessionId, settings).map((entry) => entry.content), ['first', 'second']);
});

test('cost tracker accepts camelCase usage and model family pricing fallbacks', () => {
  const tracker = new CostTracker();

  tracker.addUsage({ inputTokens: 1000, outputTokens: 500 }, 'claude-sonnet-4-6');

  assert.equal(tracker.inputTokens, 1000);
  assert.equal(tracker.outputTokens, 500);
  assert.ok(tracker.getCost('claude-sonnet-4-6') > 0);
});

test('status line shows sub-percent context usage with token counts', () => {
  const session = new Session({
    provider: { name: 'mock', model: 'claude-sonnet-4-20250514' },
    settings: { projectRoot: 'E:\\HaxAgent' },
    permissionManager: { mode: 'yolo' },
  });
  session.contextStats = {
    inputTokens: 700,
    budgetTokens: 191808,
  };

  const plain = session.getStatusLine().replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');

  assert.match(plain, /\[░░░░░░░░\] <1% 700\/191\.8k ·/);
});

test('assembles prompt context from settings, memory, transcript, and user prompt', () => {
  const settings = config.loadSettings({
    projectRoot: createTempProject(),
    env: {},
    overrides: {
      prompts: { maxTranscriptMessages: 1 },
    },
  });

  const promptContext = context.buildPromptContext({
    settings,
    instructions: 'Act as a coding agent.',
    memories: [{ name: 'style', content: 'Be direct.' }],
    transcript: [
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'recent' },
    ],
    userPrompt: 'next',
  });

  assert.match(promptContext.systemPrompt, /## Instructions/);
  assert.match(promptContext.systemPrompt, /style: Be direct\./);
  assert.doesNotMatch(promptContext.systemPrompt, /user: old/);
  assert.deepEqual(promptContext.messages, [
    { role: 'assistant', content: 'recent' },
    { role: 'user', content: 'next' },
  ]);
});
