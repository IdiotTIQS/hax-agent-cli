const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SLASH_COMMANDS, getSlashCommandSuggestion, getSubcommandSuggestion, listCommandHandlerNames } = require('../src/commands');
const { formatPastedInputBadge, formatPastedInputSummary, shouldRunPasteAsCommandBatch } = require('../src/paste-utils');
const { ResponseRenderer, MarkdownRenderer } = require('../src/renderer');

const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function createIsolatedEnv(overrides = {}) {
  const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hax-agent-cli-'));
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hax-agent-storage-'));

  return {
    ...process.env,
    HAX_AGENT_USER_SETTINGS: path.join(settingsDir, 'settings.json'),
    HAX_AGENT_MEMORY_DIR: path.join(storageDir, 'memory'),
    HAX_AGENT_SESSION_DIR: path.join(storageDir, 'sessions'),
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
  const result = runCli([], { input: '/exit\n' });
  const plain = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(plain, /Hax Agent/);
  assert.match(plain, /Type \/help for commands/);
  assert.match(plain, /Local mock mode is active/);
  assert.equal(result.stderr, '');
});

test('shows help with the help command', () => {
  const result = runCli(['help']);
  const plain = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(plain, /hax-agent/);
  assert.match(plain, /hax-agent init/);
  assert.match(plain, /hax-agent models/);
  assert.match(plain, /hax-agent team auth-refactor/);
  assert.equal(result.stderr, '');
});

test('runs the init wizard and saves settings', () => {
  const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hax-agent-init-'));
  const settingsPath = path.join(settingsDir, 'settings.json');
  const result = spawnSync(process.execPath, [cliPath, 'init'], {
    encoding: 'utf8',
    env: createIsolatedEnv({ HAX_AGENT_USER_SETTINGS: settingsPath }),
    input: 'n\n2\nsk-test\nhttps://api.example.test/v1\ncustom-model\ny\n\n8192\nn\n\n1\n1\nn\n',
  });
  const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Hax Agent setup/);
  assert.match(result.stdout, /Setup complete/);
  assert.equal(saved.setup.initialized, true);
  assert.equal(saved.agent.provider, 'openai');
  assert.equal(saved.agent.apiKey, 'sk-test');
  assert.equal(saved.agent.apiUrl, 'https://api.example.test/v1');
  assert.equal(saved.agent.model, 'custom-model');
  assert.equal(saved.ui.locale, 'en');
  assert.equal(saved.permissions.mode, 'normal');
  assert.equal(saved.memory.enabled, false);
  assert.equal(saved.context.enabled, true);
  assert.equal(saved.context.reserveOutputTokens, 8192);
  assert.equal(saved.fileContext.enabled, false);
  assert.equal(result.stderr, '');
});

test('lists available models for the configured provider', () => {
  const result = runCli(['models']);
  const plain = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(plain, /Available Models for mock/);
  assert.match(plain, /claude-sonnet-4-20250514/);
  assert.equal(result.stderr, '');
});

test('switches models in the interactive shell', () => {
  const result = runCli([], {
    input: '/models\n/model 1\n/model custom-model\n/exit\n',
  });
  const plain = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(plain, /Available Models for mock/);
  assert.match(plain, /Switched model to claude-sonnet-4-20250514/);
  assert.match(plain, /Switched model to custom-model/);
  assert.equal(result.stderr, '');
});

test('goal command sets, shows, and clears the active goal', () => {
  const result = runCli([], {
    input: '/goal --max 2 make tests pass\n/goal status\n/goal clear\n/exit\n',
  });
  const plain = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(plain, /Goal set: make tests pass/);
  assert.match(plain, /active: make tests pass/);
  assert.match(plain, /max continuations: 2/);
  assert.match(plain, /Goal cleared/);
  assert.doesNotMatch(plain, /Command not implemented: \/goal/);
  assert.equal(result.stderr, '');
});

test('all declared slash commands are wired to the active command handler', () => {
  const wiredCommands = new Set(listCommandHandlerNames());

  const missing = SLASH_COMMANDS
    .map((command) => command.name)
    .filter((name) => !wiredCommands.has(name));

  assert.deepEqual(missing, []);
});

test('switches API URL in the interactive shell', () => {
  const result = runCli([], {
    input: '/api-url\n/api-url https://example.test/v1\n/api-url\n/exit\n',
  });
  const plain = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(plain, /Current API URL: default/);
  assert.match(plain, /Switched API URL to https:\/\/example\.test\/v1/);
  assert.match(plain, /Current API URL: https:\/\/example\.test\/v1/);
  assert.equal(result.stderr, '');
});

test('switches API key and provider in the interactive shell', () => {
  const result = runCli([], {
    input: '/api-key\n/api-key test-key\n/api-key\n/exit\n',
  });
  const plain = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(plain, /API key: not set/);
  assert.match(plain, /API key set for anthropic\./);
  assert.match(plain, /API key: set/);
  assert.equal(result.stderr, '');
});

test('keeps shell alive after provider request failures', () => {
  const result = runCli([], {
    env: {
      HAX_AGENT_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'test-key',
      ANTHROPIC_BASE_URL: 'https://example.invalid',
      HAX_AGENT_API_URL: 'https://example.invalid',
    },
    input: 'hi\n/api-url\n/exit\n',
  });
  const plain = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(plain, /Assistant/);
  assert.match(plain, /Current API URL: https:\/\/example\.invalid/);
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
  assert.match(stripAnsi(first.stdout), /Interrupted/);
  assert.match(stripAnsi(second.stdout), /You said: second message/);
  assert.doesNotMatch(stripAnsi(second.stdout), /first message/);
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
  const plain = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(plain, /File Read/);
  assert.match(plain, /README\.md/);
  assert.match(plain, /in 3ms/);
  assert.match(plain, /Update\(README\.md\)/);
  assert.match(plain, /Added 1 line/);
  assert.match(plain, /\+ # Test/);
  assert.match(plain, /read the readme/);
  assert.equal(result.stderr, '');
});

test('shell tool running status renders once without spinner flood', () => {
  const writes = [];
  const stream = {
    isTTY: true,
    rows: 24,
    columns: 100,
    write(data) {
      writes.push(data);
    },
    on() {},
    off() {},
  };
  const screen = {
    stream,
    columns: 100,
    isTTY() { return true; },
    write(data) { stream.write(data); },
  };
  const renderer = new ResponseRenderer(screen, new MarkdownRenderer(100));

  renderer.startTool({
    name: 'shell.run',
    input: {
      command: 'node',
      args: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'install'],
    },
  });

  const plain = stripAnsi(writes.join(''));
  assert.equal((plain.match(/Running Shell Run/g) || []).length, 1);
  assert.equal(plain.includes('\r'), false);
});

test('shows status for each prompt without treating it as user input', () => {
  const result = runCli([], {
    input: 'first message\nsecond message\n/exit\n',
  });
  const plain = stripAnsi(result.stdout);
  const statusLines = plain.match(/mock · claude-sonnet-4-20250514 · \$\d+\.\d{4} · \d+ turns · \d+s · YOLO/g) || [];

  assert.equal(result.status, 0);
  assert.ok(statusLines.length >= 3);
  assert.match(plain, /You said: first message/);
  assert.match(plain, /You said: second message/);
  for (const line of plain.split(/\r?\n/).filter((entry) => entry.includes('You said:'))) {
    assert.doesNotMatch(line, /mock · claude-sonnet-4-20250514/);
  }
  assert.equal(result.stderr, '');
});

test('keeps pasted prose as one chat message instead of splitting on newlines', () => {
  const pasted = [
    '狼回头，不是报恩，就是报仇！',
    '第1章 萧默',
    '',
    '“爷爷，一路走好！”',
    '> 棺前的一张铜镜倒影出了萧默的身影。',
    '洪荒神尊',
  ].join('\n');

  assert.equal(shouldRunPasteAsCommandBatch(pasted), false);
});

test('detects pasted command batches for multi-command automation', () => {
  assert.equal(shouldRunPasteAsCommandBatch('/models\n/model 1\n/exit'), true);
  assert.equal(shouldRunPasteAsCommandBatch('!pwd\n/config'), true);
  assert.equal(shouldRunPasteAsCommandBatch('/models\nplain text'), false);
});

test('formats pasted input as a compact echo summary', () => {
  const pasted = '第1章 萧默\n\n“爷爷，一路走好！”\n洪荒神尊';
  assert.equal(formatPastedInputSummary(pasted), `Pasted 4 lines, ${pasted.length} chars`);
  assert.match(formatPastedInputBadge(pasted), /\x1B\[100m\x1B\[97m Pasted 4 lines,/);
});

test('clear resets the active chat context', () => {
  const result = runCli([], {
    input: 'first message\n/clear\nsecond message\n/exit\n',
  });
  const plain = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(plain, /Context cleared/);
  assert.doesNotMatch(plain, /You said: first message[\s\S]*You said: first message/);
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
  const plain = stripAnsi(result.stderr);

  assert.equal(result.status, 1);
  assert.match(plain, /Unknown command: unknown/);
  assert.match(stripAnsi(result.stdout), /Usage/);
});

test('suggests close top-level commands', () => {
  const result = runCli(['modles']);
  const plain = stripAnsi(result.stderr);

  assert.equal(result.status, 1);
  assert.match(plain, /Unknown command: modles/);
  assert.match(plain, /Did you mean: hax-agent models\?/);
});

test('suggests close slash commands in the interactive shell', () => {
  const result = runCli([], {
    input: '/modle\n/exit\n',
  });
  const plain = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(plain, /Unknown command: \/modle/);
  assert.match(plain, /Did you mean \/model\?/);
  assert.equal(result.stderr, '');
});

test('suggests close slash commands across the command set', () => {
  const cases = [
    ['modle', 'model'],
    ['contxt', 'context'],
    ['cahce', 'context'],
    ['provder', 'provider'],
    ['langauge', 'language'],
    ['permissons', 'permissions'],
    ['resuem', 'resume'],
    ['sesions', 'sessions'],
    ['docter', 'doctor'],
    ['updtae', 'update'],
    ['memroy', 'memory'],
    ['skils', 'skills'],
    ['skilify', 'skillify'],
    ['gaol', 'goal'],
    ['agnts', 'agents'],
    ['apiurl', 'api-url'],
    ['apikey', 'api-key'],
  ];

  for (const [input, expected] of cases) {
    assert.equal(getSlashCommandSuggestion(input), expected);
  }
});

test('suggests close slash subcommands', () => {
  const cases = [
    ['permissions', 'stats', '/permissions status'],
    ['permissions', 'rest', '/permissions reset'],
    ['permissions', 'mdoe', '/permissions mode'],
    ['context', 'stats', '/context status'],
    ['context', 'widnow', '/context window'],
    ['context', 'resreve', '/context reserve'],
    ['context', 'chrars-per-token', '/context chars-per-token'],
    ['cache', 'atuo', '/cache auto'],
    ['memory', 'lsit', '/memory list'],
    ['memory', 'raed', '/memory read'],
    ['memory', 'delte', '/memory delete'],
    ['skills', 'usgae', '/skills usage'],
    ['team', 'agnets', '/team agents'],
    ['team', 'stats', '/team status'],
    ['team', 'spwan', '/team spawn'],
    ['team', 'inbx', '/team inbox'],
  ];

  for (const [command, input, expected] of cases) {
    assert.equal(getSubcommandSuggestion(command, input), expected);
  }
});

test('context command updates cache budget settings', () => {
  const env = createSharedCliEnv();
  const result = runCliWithEnv([], env, {
    input: '/context window 1m\n/context reserve 32k\n/cache status\n/exit\n',
  });
  const plain = stripAnsi(result.stdout);
  const saved = JSON.parse(fs.readFileSync(env.HAX_AGENT_USER_SETTINGS, 'utf8'));

  assert.equal(result.status, 0);
  assert.match(plain, /Context window set to 1m/);
  assert.match(plain, /Reserved output tokens set to 32k/);
  assert.match(plain, /Input budget:\s+968k/);
  assert.equal(saved.context.windowTokens, 1_000_000);
  assert.equal(saved.context.reserveOutputTokens, 32_000);
});

test('rejects missing team name with usage guidance', () => {
  const result = runCli(['team']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: hax-agent team/);
  assert.equal(result.stdout, '');
});

test('switches language in the interactive shell', () => {
  const result = runCli([], {
    input: '/language\n/language zh-CN\n/config\n/language zh-TW\n/config\n/language ru\n/config\n/exit\n',
  });
  const plain = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(plain, /Current language: English \(en\)/);
  assert.match(plain, /语言已切换为 中文简体 \(zh-CN\)/);
  assert.match(plain, /语言:\s+中文简体 \(zh-CN\)/);
  assert.match(plain, /語言已切換為 中文繁體（台灣地區） \(zh-TW\)/);
  assert.match(plain, /語言:\s+中文繁體（台灣地區） \(zh-TW\)/);
  assert.match(plain, /Язык переключен на Русский \(ru\)/);
  assert.match(plain, /Язык:\s+Русский \(ru\)/);
  assert.equal(result.stderr, '');
});

test('update command checks without installing by default', () => {
  const result = runCli([], {
    input: '/update\n/exit\n',
  });
  const plain = stripAnsi(result.stdout);

  assert.equal(result.status, 0);
  assert.match(plain, /Checking for updates/);
  assert.doesNotMatch(plain, /Updating\.\.\./);
  assert.equal(result.stderr, '');
});
