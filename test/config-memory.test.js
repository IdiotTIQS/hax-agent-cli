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
  assert.equal(resolved.settings.memory.maxItems, 5);
  assert.equal(resolved.settings.sessions.transcriptLimit, 10);
  assert.equal(resolved.settings.memory.directory, path.join(projectRoot, 'state', 'memory'));
  assert.deepEqual(resolved.sources.map((source) => source.loaded), [true, true]);
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
  const settings = config.loadSettings({ projectRoot, env: {} });

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
