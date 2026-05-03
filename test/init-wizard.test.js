const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  detectProviderDefault,
  hasProviderEnvironment,
  shouldRunFirstRunInit,
  getProviderApiUrl,
} = require('../src/init-wizard');

test('detectProviderDefault prefers explicit provider then API keys', () => {
  assert.equal(detectProviderDefault({ HAX_AGENT_PROVIDER: 'google', OPENAI_API_KEY: 'x' }), 'google');
  assert.equal(detectProviderDefault({ OPENAI_API_KEY: 'x' }), 'openai');
  assert.equal(detectProviderDefault({ GOOGLE_API_KEY: 'x' }), 'google');
  assert.equal(detectProviderDefault({ ANTHROPIC_API_KEY: 'x' }), 'anthropic');
  assert.equal(detectProviderDefault({}), 'anthropic');
});

test('hasProviderEnvironment detects provider configuration', () => {
  assert.equal(hasProviderEnvironment({}), false);
  assert.equal(hasProviderEnvironment({ OPENAI_API_KEY: 'x' }), true);
  assert.equal(hasProviderEnvironment({ HAX_AGENT_PROVIDER: 'openai' }), true);
});

test('getProviderApiUrl resolves provider-specific base URLs', () => {
  assert.equal(getProviderApiUrl({ HAX_AGENT_API_URL: 'https://proxy.test' }, 'openai'), 'https://proxy.test');
  assert.equal(getProviderApiUrl({ OPENAI_BASE_URL: 'https://openai.test' }, 'openai'), 'https://openai.test');
  assert.equal(getProviderApiUrl({ GOOGLE_BASE_URL: 'https://google.test' }, 'google'), 'https://google.test');
  assert.equal(getProviderApiUrl({ ANTHROPIC_BASE_URL: 'https://anthropic.test' }, 'anthropic'), 'https://anthropic.test');
  assert.equal(getProviderApiUrl({}, 'mock'), undefined);
});


test('shouldRunFirstRunInit only prompts in a clean interactive setup', () => {
  assert.equal(shouldRunFirstRunInit({
    env: {},
    args: [],
    isTTY: true,
    explicitSession: false,
    sources: [{ type: 'user', loaded: false }],
  }), true);

  assert.equal(shouldRunFirstRunInit({ env: {}, args: [], isTTY: false, sources: [] }), false);
  assert.equal(shouldRunFirstRunInit({ env: {}, args: ['--no-init'], isTTY: true, sources: [] }), false);
  assert.equal(shouldRunFirstRunInit({ env: { OPENAI_API_KEY: 'x' }, args: [], isTTY: true, sources: [] }), false);
  assert.equal(shouldRunFirstRunInit({ env: {}, args: [], isTTY: true, sources: [{ loaded: true }] }), false);
  assert.equal(shouldRunFirstRunInit({ env: { HAX_AGENT_SKIP_INIT: 'true' }, args: [], isTTY: true, sources: [] }), false);
});

test('manual init stores settings in the requested user settings path', async () => {
  const { runInitWizard } = require('../src/init-wizard');
  const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hax-agent-init-unit-'));
  const settingsPath = path.join(settingsDir, 'settings.json');
  const answers = ['3', 'key-google', 'https://google.example/v1', '', '1', '2', 'y'];

  await runInitWizard({
    ask: async () => answers.shift() || '',
    output: { write() {} },
    env: { HAX_AGENT_USER_SETTINGS: settingsPath },
  });

  const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(saved.setup.initialized, true);
  assert.equal(saved.agent.provider, 'google');
  assert.equal(saved.agent.apiKey, 'key-google');
  assert.equal(saved.agent.apiUrl, 'https://google.example/v1');
  assert.equal(saved.agent.model, 'gemini-2.5-flash-preview-05-20');
  assert.equal(saved.ui.locale, 'en');
  assert.equal(saved.permissions.mode, 'yolo');
  assert.equal(saved.memory.enabled, true);
});

test('manual init can use an injected selector for interactive choices', async () => {
  const { runInitWizard } = require('../src/init-wizard');
  const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hax-agent-init-select-'));
  const settingsPath = path.join(settingsDir, 'settings.json');
  const answers = ['key-openai', '', '', 'n'];
  const selections = {
    Provider: 'openai',
    Language: 'zh-CN',
    'Permission mode': 'normal',
    '权限模式': 'normal',
  };

  await runInitWizard({
    ask: async () => answers.shift() || '',
    select: async ({ name }) => selections[name],
    output: { write() {} },
    env: { HAX_AGENT_USER_SETTINGS: settingsPath },
  });

  const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(saved.agent.provider, 'openai');
  assert.equal(saved.agent.apiKey, 'key-openai');
  assert.equal(saved.agent.apiUrl, undefined);
  assert.equal(saved.agent.model, 'gpt-4.1');
  assert.equal(saved.ui.locale, 'zh-CN');
  assert.equal(saved.permissions.mode, 'normal');
  assert.equal(saved.memory.enabled, false);
});
