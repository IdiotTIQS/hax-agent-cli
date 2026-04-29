const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

function createIsolatedEnv(overrides = {}) {
  const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hax-agent-cli-'));

  return {
    ...process.env,
    HAX_AGENT_USER_SETTINGS: path.join(settingsDir, 'settings.json'),
    HAX_AGENT_PROVIDER: '',
    ANTHROPIC_API_KEY: '',
    HAX_AGENT_API_URL: '',
    ANTHROPIC_BASE_URL: '',
    ...overrides,
  };
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: createIsolatedEnv(options.env),
    input: options.input,
  });
}

function createSharedCliEnv(overrides = {}) {
  const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hax-agent-cli-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hax-agent-project-'));

  return createIsolatedEnv({
    HAX_AGENT_USER_SETTINGS: path.join(settingsDir, 'settings.json'),
    HAX_AGENT_PROJECT_ROOT: projectRoot,
    ...overrides,
  });
}

function runCliWithEnv(args, env, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env,
    input: options.input,
  });
}

test('starts the interactive shell by default', () => {
  const result = runCli([]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Hax Agent/);
  assert.match(result.stdout, /Ask me anything\. Use \/help for controls or \/exit to quit\./);
  assert.match(result.stdout, /Local mock mode is active/);
  assert.equal(result.stderr, '');
});

test('shows help with the help command', () => {
  const result = runCli(['help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /hax-agent/);
  assert.match(result.stdout, /hax-agent models/);
  assert.match(result.stdout, /hax-agent team auth-refactor/);
  assert.equal(result.stderr, '');
});

test('lists available models for the configured provider', () => {
  const result = runCli(['models']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Available models for mock:/);
  assert.match(result.stdout, /claude-opus-4-7/);
  assert.equal(result.stderr, '');
});

test('switches models in the interactive shell', () => {
  const result = runCli([], {
    input: '/models\n/model 1\n/model custom-model\n/exit\n',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Available models for mock:/);
  assert.match(result.stdout, /Switched model to claude-opus-4-7/);
  assert.match(result.stdout, /Switched model to custom-model/);
  assert.equal(result.stderr, '');
});

test('switches API URL in the interactive shell', () => {
  const result = runCli([], {
    input: '/api-url\n/api-url https://example.test/v1\n/api-url\n/exit\n',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Current API URL: default/);
  assert.match(result.stdout, /Switched API URL to https:\/\/example\.test\/v1/);
  assert.match(result.stdout, /Current API URL: https:\/\/example\.test\/v1/);
  assert.equal(result.stderr, '');
});

test('switches API key and provider in the interactive shell', () => {
  const result = runCli([], {
    input: '/api-key\n/api-key test-key\n/api-key\n/exit\n',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /API key: not set/);
  assert.match(result.stdout, /API key set for anthropic\./);
  assert.match(result.stdout, /API key: set/);
  assert.equal(result.stderr, '');
});

test('keeps shell alive after provider request failures', () => {
  const result = runCli([], {
    env: {
      HAX_AGENT_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'test-key',
      ANTHROPIC_BASE_URL: 'https://example.invalid',
    },
    input: 'hi\n/api-url\n/exit\n',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Assistant: /);
  assert.match(result.stdout, /Current API URL: https:\/\/example\.invalid/);
  assert.equal(result.stderr, '');
});

test('loads recent chat context across shell restarts', () => {
  const env = createSharedCliEnv({
    HAX_AGENT_MOCK_RESPONSE: 'loaded {{count}} messages',
  });
  const first = runCliWithEnv([], env, { input: 'first message\n/exit\n' });
  const second = runCliWithEnv([], env, { input: 'second message\n/exit\n' });

  assert.equal(first.status, 0);
  assert.equal(second.status, 0);
  assert.match(first.stdout, /loaded 1 messages/);
  assert.match(second.stdout, /loaded 3 messages/);
  assert.equal(first.stderr, '');
  assert.equal(second.stderr, '');
});

test('interruption stops saving partial assistant context', () => {
  const interruptedEnv = createSharedCliEnv({
    HAX_AGENT_TEST_INTERRUPT_AFTER_TEXT: '1',
  });
  const normalEnv = {
    ...interruptedEnv,
    HAX_AGENT_TEST_INTERRUPT_AFTER_TEXT: '',
  };
  const first = runCliWithEnv([], interruptedEnv, { input: 'first message\n/exit\n' });
  const second = runCliWithEnv([], normalEnv, { input: 'second message\n/exit\n' });

  assert.equal(first.status, 0);
  assert.equal(second.status, 0);
  assert.match(first.stdout, /Interrupted response\./);
  assert.match(second.stdout, /You said: second message/);
  assert.doesNotMatch(second.stdout, /first message/);
  assert.equal(first.stderr, '');
  assert.equal(second.stderr, '');
});

test('renders structured tool activity in the interactive shell', () => {
  const result = runCli([], {
    env: {
      HAX_AGENT_MOCK_TOOL_TRACE: '1',
    },
    input: 'read the readme\n/exit\n',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /\[thinking\] Thinking\.\.\./);
  assert.match(result.stdout, /\[tool\] File Read\(file: README\.md\) running/);
  assert.match(result.stdout, /Done in 3ms/);
  assert.match(result.stdout, /Update\(README\.md\)/);
  assert.match(result.stdout, /⎿  Added 1 line/);
  assert.match(result.stdout, /1 \+# Test/);
  assert.match(result.stdout, /You said: read the readme/);
  assert.equal(result.stderr, '');
});

test('clear resets the active chat context', () => {
  const result = runCli([], {
    input: 'first message\n/clear\nsecond message\n/exit\n',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Context cleared\./);
  assert.doesNotMatch(result.stdout, /You said: first message[\s\S]*You said: first message/);
  assert.equal(result.stderr, '');
});

test('prints the auth refactor team plan', () => {
  const result = runCli(['team', 'auth-refactor']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Team: auth-refactor/);
  assert.match(result.stdout, /- A7 \[sequential\] Merge compatible boundaries/);
  assert.equal(result.stderr, '');
});

test('rejects unknown commands', () => {
  const result = runCli(['unknown']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command: unknown/);
  assert.match(result.stdout, /Usage:/);
});

test('rejects missing team name with usage guidance', () => {
  const result = runCli(['team']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: hax-agent team auth-refactor/);
  assert.equal(result.stdout, '');
});
