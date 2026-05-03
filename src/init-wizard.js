const readline = require('node:readline');
const { updateUserSettings } = require('./config');

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-4-20250514' },
  { value: 'openai', label: 'OpenAI (GPT)', defaultModel: 'gpt-4.1' },
  { value: 'google', label: 'Google (Gemini)', defaultModel: 'gemini-2.5-flash-preview-05-20' },
  { value: 'mock', label: 'Mock local mode', defaultModel: 'mock-local' },
];

const PERMISSION_MODES = [
  { value: 'normal', label: 'Normal - ask before write, delete, private web fetch, and risky shell tools' },
  { value: 'yolo', label: 'YOLO - auto-approve tool calls' },
];

const ANSI = Object.freeze({
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  clearLine: '\x1b[2K',
  cursorUp: (count) => `\x1b[${count}A`,
  cursorToStart: '\r',
  inverse: '\x1b[7m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
});

function shouldRunFirstRunInit(options = {}) {
  const env = options.env || process.env;

  if (!options.isTTY) return false;
  if (options.explicitSession) return false;
  if (Array.isArray(options.args) && options.args.includes('--no-init')) return false;
  if (readBooleanEnv(env.HAX_AGENT_SKIP_INIT) === true) return false;

  const loadedSources = (options.sources || []).filter((source) => source.loaded);
  if (loadedSources.length > 0) return false;

  if (hasProviderEnvironment(env)) return false;

  return true;
}

async function runInitWizard(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const env = options.env || process.env;
  const { question, close } = createQuestioner({ input, output, ask: options.ask });
  const selector = createSelector({
    input,
    output,
    select: options.select,
    interactive: Boolean(input?.isTTY && output?.isTTY && !options.ask),
  });

  try {
    output.write('\nHax Agent setup\n');
    output.write('Configure a provider, default model, permissions, and memory.\n\n');

    if (options.promptToStart) {
      const answer = await question('Run setup now? [Y/n] ');
      if (!readYesNo(answer, true)) {
        const saved = updateUserSettings({ setup: { initialized: true } }, { env });
        output.write(`Setup skipped. Saved preference to ${saved.path}\n\n`);
        return { skipped: true, path: saved.path };
      }
      output.write('\n');
    }

    const provider = await chooseOption(question, output, {
      name: 'Provider',
      options: PROVIDERS,
      defaultValue: detectProviderDefault(env),
      selector,
    });

  const providerInfo = PROVIDERS.find((item) => item.value === provider);
  const detectedApiKey = getProviderApiKey(env, provider);
  const detectedApiUrl = getProviderApiUrl(env, provider);
  let apiKey;
  let apiUrl;

  if (provider !== 'mock') {
    const keyHint = detectedApiKey
      ? 'API key detected in environment. Leave blank to keep using it.'
      : 'Leave blank to configure it later with /api-key.';
    output.write(`${keyHint}\n`);
    apiKey = (await question(`${providerInfo.label} API key: `)).trim();

    const urlHint = detectedApiUrl
      ? `API base URL [${detectedApiUrl}]: `
      : 'API base URL [official default]: ';
    apiUrl = (await question(urlHint)).trim();
  }

    const modelInput = (await question(`Default model [${providerInfo.defaultModel}]: `)).trim();
    const model = modelInput || providerInfo.defaultModel;

    const permissionMode = await chooseOption(question, output, {
      name: 'Permission mode',
      options: PERMISSION_MODES,
      defaultValue: 'normal',
      selector,
    });

    const memoryAnswer = await question('Enable session memory? [Y/n] ');
    const memoryEnabled = readYesNo(memoryAnswer, true);

    const updates = {
      setup: { initialized: true },
      agent: { provider, model },
      permissions: { mode: permissionMode },
      memory: { enabled: memoryEnabled },
    };

  if (apiKey) {
    updates.agent.apiKey = apiKey;
  }
  if (apiUrl) {
    updates.agent.apiUrl = apiUrl;
  }

    const saved = updateUserSettings(updates, { env });
    output.write(`\nSetup complete. Saved settings to ${saved.path}\n`);
    output.write('Start chatting with hax-agent, or adjust later with /provider, /model, /api-key, and /permissions.\n\n');

    return {
      saved: true,
      path: saved.path,
      settings: updates,
    };
  } finally {
    close();
  }
}

function createSelector(options) {
  if (typeof options.select === 'function') {
    return options.select;
  }

  if (!options.interactive) {
    return null;
  }

  return (selectOptions) => chooseOptionWithArrows({
    ...selectOptions,
    input: options.input,
    output: options.output,
  });
}

function createQuestioner(options) {
  if (typeof options.ask === 'function') {
    return {
      question: options.ask,
      close: () => {},
    };
  }

  if (options.input?.isTTY) {
    const rl = readline.createInterface({ input: options.input, output: options.output });
    return {
      question: (prompt) => new Promise((resolve) => rl.question(prompt, resolve)),
      close: () => rl.close(),
    };
  }

  const answers = readAllInput(options.input).then((content) => normalizeAnswerLines(content));
  let index = 0;

  return {
    question: async (prompt) => {
      options.output.write(prompt);
      const lines = await answers;
      const answer = index < lines.length ? lines[index] : '';
      index += 1;
      return answer;
    },
    close: () => {},
  };
}

function readAllInput(input) {
  return new Promise((resolve, reject) => {
    let content = '';
    input.setEncoding?.('utf8');
    input.on('data', (chunk) => { content += chunk; });
    input.on('end', () => resolve(content));
    input.on('error', reject);
    input.resume?.();
  });
}

function normalizeAnswerLines(content) {
  if (!content) return [];
  return String(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

async function chooseOption(question, output, options) {
  const choices = options.options;
  const defaultIndex = Math.max(0, choices.findIndex((choice) => choice.value === options.defaultValue));

  if (options.selector) {
    return options.selector({
      name: options.name,
      options: choices,
      defaultIndex,
    });
  }

  output.write(`${options.name}:\n`);
  choices.forEach((choice, index) => {
    const marker = index === defaultIndex ? '*' : ' ';
    output.write(`  ${index + 1}. ${marker} ${choice.label}\n`);
  });

  while (true) {
    const answer = (await question(`Choose ${options.name.toLowerCase()} [${defaultIndex + 1}]: `)).trim().toLowerCase();
    if (!answer) return choices[defaultIndex].value;

    const numeric = Number(answer);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) {
      return choices[numeric - 1].value;
    }

    const matched = choices.find((choice) => choice.value === answer || choice.label.toLowerCase().startsWith(answer));
    if (matched) return matched.value;

    output.write(`Please choose 1-${choices.length} or one of: ${choices.map((choice) => choice.value).join(', ')}.\n`);
  }
}

function chooseOptionWithArrows(options) {
  const input = options.input;
  const output = options.output;
  const choices = options.options;
  let selectedIndex = options.defaultIndex;

  return new Promise((resolve) => {
    const wasRaw = input.isRaw;

    readline.emitKeypressEvents(input);
    if (input.setRawMode) input.setRawMode(true);
    input.resume?.();

    output.write(`${options.name}:\n`);
    output.write(`${ANSI.dim}Use ↑/↓ and Enter. Press 1-${choices.length} for quick select.${ANSI.reset}\n`);
    output.write(ANSI.hideCursor);

    function render() {
      for (let index = 0; index < choices.length; index += 1) {
        const choice = choices[index];
        const active = index === selectedIndex;
        const prefix = active ? '›' : ' ';
        const line = active
          ? `${ANSI.inverse} ${prefix} ${choice.label} ${ANSI.reset}`
          : ` ${prefix} ${choice.label}`;
        output.write(`${ANSI.clearLine}${ANSI.cursorToStart}${line}\n`);
      }
    }

    function rerender() {
      output.write(ANSI.cursorUp(choices.length));
      render();
    }

    function cleanup(value) {
      input.removeListener('keypress', onKeypress);
      if (input.setRawMode) input.setRawMode(Boolean(wasRaw));
      output.write(ANSI.showCursor);
      output.write('\n');
      resolve(value);
    }

    function onKeypress(char, key = {}) {
      if (key.name === 'up') {
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        rerender();
        return;
      }

      if (key.name === 'down' || key.name === 'tab') {
        selectedIndex = (selectedIndex + 1) % choices.length;
        rerender();
        return;
      }

      if (key.name === 'return') {
        cleanup(choices[selectedIndex].value);
        return;
      }

      if (key.ctrl && key.name === 'c') {
        cleanup(choices[selectedIndex].value);
        process.kill(process.pid, 'SIGINT');
        return;
      }

      const numeric = Number(char);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) {
        selectedIndex = numeric - 1;
        rerender();
        cleanup(choices[selectedIndex].value);
      }
    }

    render();
    input.on('keypress', onKeypress);
  });
}

function detectProviderDefault(env = process.env) {
  const explicit = String(env.HAX_AGENT_PROVIDER || env.AI_PROVIDER || '').trim().toLowerCase();
  if (PROVIDERS.some((provider) => provider.value === explicit)) return explicit;
  if (env.OPENAI_API_KEY) return 'openai';
  if (env.GOOGLE_API_KEY || env.GEMINI_API_KEY) return 'google';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'anthropic';
}

function hasProviderEnvironment(env = process.env) {
  return Boolean(
    env.HAX_AGENT_PROVIDER ||
    env.AI_PROVIDER ||
    env.ANTHROPIC_API_KEY ||
    env.OPENAI_API_KEY ||
    env.GOOGLE_API_KEY ||
    env.GEMINI_API_KEY
  );
}

function getProviderApiKey(env, provider) {
  if (provider === 'openai') return env.OPENAI_API_KEY;
  if (provider === 'google') return env.GOOGLE_API_KEY || env.GEMINI_API_KEY;
  if (provider === 'anthropic') return env.ANTHROPIC_API_KEY;
  return undefined;
}

function getProviderApiUrl(env, provider) {
  if (env.HAX_AGENT_API_URL) return env.HAX_AGENT_API_URL;
  if (provider === 'openai') return env.OPENAI_BASE_URL;
  if (provider === 'google') return env.GOOGLE_BASE_URL;
  if (provider === 'anthropic') return env.ANTHROPIC_BASE_URL;
  return undefined;
}

function readYesNo(value, defaultValue) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ['y', 'yes', '1', 'true', 'on'].includes(normalized);
}

function readBooleanEnv(value) {
  if (value === undefined || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

module.exports = {
  PROVIDERS,
  PERMISSION_MODES,
  shouldRunFirstRunInit,
  runInitWizard,
  detectProviderDefault,
  hasProviderEnvironment,
  getProviderApiUrl,
};
