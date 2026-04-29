#!/usr/bin/env node

const readline = require('readline');
const { loadSettings, updateUserSettings } = require('./config');
const { appendTranscriptEntry, createSessionId, listSessions } = require('./memory');
const { createProvider } = require('./providers');
const { createAuthRefactorTeam } = require('./teams/auth-refactor');
const { formatTeamPlan } = require('./formatters/team-plan');
const { createLocalToolRegistry } = require('./tools');

const agents = [
  { name: 'explore', description: 'Map code paths and summarize findings.' },
  { name: 'implement', description: 'Make focused code changes.' },
  { name: 'review', description: 'Check changes for bugs and regressions.' },
  { name: 'test', description: 'Run validation and report failures.' },
];

const slashCommands = {
  help: {
    description: 'Show slash commands',
    run: showShellHelp,
  },
  exit: {
    description: 'Exit the interactive shell',
    run: exitShell,
  },
  clear: {
    description: 'Clear the terminal screen',
    run: clearShell,
  },
  tools: {
    description: 'List available tools',
    run: showTools,
  },
  agents: {
    description: 'List available agents',
    run: showAgents,
  },
  models: {
    description: 'List available models',
    run: showModels,
  },
  model: {
    description: 'Show or switch the active model',
    run: switchModel,
  },
  'api-url': {
    description: 'Show or switch the API base URL',
    run: switchApiUrl,
  },
  'api-key': {
    description: 'Show or switch the API key',
    run: switchApiKey,
  },
};

const commands = {
  help: {
    description: 'Show available commands',
    run: () => showHelp(),
  },
  chat: {
    description: 'Start the interactive agent shell',
    run: () => runShell(),
  },
  models: {
    description: 'List available provider models',
    run: runModelsCommand,
  },
  team: {
    description: 'Create an agent team plan',
    run: runTeamCommand,
  },
};

async function main(argv) {
  const [commandName = 'chat', ...args] = argv;

  if (commandName === '-h' || commandName === '--help') {
    showHelp();
    return;
  }

  const command = commands[commandName];

  if (!command) {
    console.error(`Unknown command: ${commandName}`);
    showHelp();
    process.exitCode = 1;
    return;
  }

  await command.run(args);
}

async function runModelsCommand() {
  const settings = loadSettings();
  const provider = createProvider(settings.agent, process.env);
  await printModels(provider, createOutput(process.stdout));
}

function runTeamCommand(args) {
  const [teamName] = args;

  if (teamName !== 'auth-refactor') {
    console.error('Usage: hax-agent team auth-refactor');
    process.exitCode = 1;
    return;
  }

  const team = createAuthRefactorTeam();
  console.log(formatTeamPlan(team));
}

async function runShell() {
  const settings = loadSettings();
  const provider = createProvider(settings.agent, process.env);
  const output = createOutput(process.stdout);
  const session = {
    id: createSessionId(),
    messages: loadRecentMessages(settings),
    provider,
    settings,
    toolRegistry: createLocalToolRegistry({
      root: process.cwd(),
      shellPolicy: settings.tools?.shell,
    }),
    shouldExit: false,
    isStreaming: false,
    pendingExit: false,
    responseAbortController: null,
    responseRenderer: null,
    responseInterrupted: false,
  };
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'You: ',
    terminal: Boolean(process.stdin.isTTY),
  });

  initializeShellScreen(output);
  output.writeLine('Hax Agent');
  output.writeLine('Ask me anything. Use /help for controls or /exit to quit.');
  if (provider.name === 'mock' || provider.name === 'local') {
    output.writeLine('Local mock mode is active. Set /api-url and /api-key to chat with a real model.');
  }
  promptShell(rl, output, session);

  function handleInterrupt() {
    if (session.isStreaming) {
      session.isStreaming = false;
      session.responseInterrupted = true;
      session.pendingExit = false;
      session.responseAbortController?.abort();
      session.responseRenderer?.interrupt();
      if (process.env.HAX_AGENT_TEST_EXIT_ON_INTERRUPT === '1') {
        rl.close();
      } else {
        promptShell(rl, output, session);
      }
      return;
    }

    if (session.pendingExit) {
      output.writeLine('\nGoodbye.');
      rl.close();
      return;
    }

    session.pendingExit = true;
    clearPromptFrame(output);
    output.writeLine('\nUse /exit to quit, or press Ctrl+C again to exit.');
    promptShell(rl, output, session);
  }

  rl.on('SIGINT', handleInterrupt);
  process.on('SIGINT', handleInterrupt);
  if (process.env.HAX_AGENT_TEST_EXIT_ON_INTERRUPT === '1') {
    process.on('SIGTERM', handleInterrupt);
  }
  rl.on('close', () => {
    process.off('SIGINT', handleInterrupt);
    process.off('SIGTERM', handleInterrupt);
  });

  for await (const input of rl) {
    const line = input.trim();

    if (!line) {
      promptShell(rl, output, session);
      continue;
    }

    session.pendingExit = false;
    clearPromptFrame(output);

    if (line.startsWith('/')) {
      await handleSlashCommand(line, { output, session, rl });
    } else {
      writeUserMessage(output, line);
      await handleChatMessage(line, { output, session });
    }

    if (session.shouldExit) {
      rl.close();
      break;
    }

    promptShell(rl, output, session);
  }
}

function initializeShellScreen(output) {
  if (output.isInteractive()) {
    output.clear();
    output.resetConversationCursor();
    reservePromptArea(output);
  }
}

function promptShell(rl, output, session) {
  if (!output.isInteractive()) {
    rl.setPrompt('You: ');
    rl.prompt();
    return;
  }

  rl.setPrompt('You ▸ ');
  reservePromptArea(output);
  renderPromptFrame(output, session);
  rl.prompt(true);
}

function reservePromptArea(output) {
  if (!output.isInteractive()) {
    return;
  }

  const stream = process.stdout;
  const rows = stream.rows || 0;

  if (rows < 4) {
    return;
  }

  readline.cursorTo(stream, 0, rows - 4);
  stream.write('\n\n\n');
}

function renderPromptFrame(output, session) {
  if (!output.isInteractive()) {
    return;
  }

  const stream = process.stdout;
  const rows = stream.rows || 0;
  const topLine = formatPromptLine(stream.columns || 80, formatShellStatus(session));
  const bottomLine = formatPromptLine(stream.columns || 80);

  if (rows < 4) {
    output.writeLine(topLine);
    return;
  }

  readline.cursorTo(stream, 0, rows - 3);
  readline.clearLine(stream, 0);
  stream.write(topLine);
  readline.cursorTo(stream, 0, rows - 2);
  readline.clearLine(stream, 0);
  readline.cursorTo(stream, 0, rows - 1);
  readline.clearLine(stream, 0);
  stream.write(bottomLine);
  readline.cursorTo(stream, 0, rows - 2);
}

function clearPromptFrame(output) {
  if (!output.isInteractive()) {
    return;
  }

  const stream = process.stdout;
  const rows = stream.rows || 0;

  if (rows < 4) {
    output.clearTransient();
    return;
  }

  for (const row of [rows - 3, rows - 2, rows - 1]) {
    readline.cursorTo(stream, 0, row);
    readline.clearLine(stream, 0);
  }

  readline.cursorTo(stream, 0, rows - 4);
}

function formatPromptLine(columns, label = '') {
  const width = Math.max(20, Math.min(Number(columns) || 80, 120));
  const line = '─'.repeat(width);

  if (!label) {
    return line;
  }

  const text = ` ${label} `;
  return `${text}${line}`.slice(0, width);
}

function formatShellStatus(session) {
  const provider = session.provider?.name || 'provider';
  const model = session.provider?.model || 'model';
  return `${provider} · ${model}`;
}

function writeUserMessage(output, content) {
  if (!output.isInteractive()) {
    return;
  }

  output.writeLine(`\nYou: ${content}`);
}

async function handleSlashCommand(line, context) {
  const [commandName, ...args] = line.slice(1).split(/\s+/);
  const command = slashCommands[commandName];

  if (!command) {
    context.output.writeLine(`Unknown slash command: /${commandName}`);
    context.output.writeLine('Type /help for available commands.');
    return;
  }

  await command.run({ ...context, args });
}

async function handleChatMessage(content, { output, session }) {
  const userMessage = { role: 'user', content };
  const abortController = new AbortController();
  const renderer = createResponseRenderer(output);
  let assistantText = '';

  session.messages.push(userMessage);
  session.isStreaming = true;
  session.responseInterrupted = false;
  session.responseAbortController = abortController;
  session.responseRenderer = renderer;
  renderer.startWaiting();

  try {
    let toolLimitReached = false;

    for await (const chunk of session.provider.stream({
      messages: session.messages,
      toolRegistry: session.toolRegistry,
      signal: abortController.signal,
    })) {
      if (session.responseInterrupted) {
        break;
      }

      if (chunk.type === 'text') {
        assistantText += chunk.delta;
        renderer.writeText(chunk.delta);
        if (process.env.HAX_AGENT_TEST_INTERRUPT_AFTER_TEXT === '1') {
          session.responseInterrupted = true;
          abortController.abort();
          renderer.interrupt();
          break;
        }
      } else if (chunk.type === 'thinking') {
        renderer.thinking(chunk);
      } else if (chunk.type === 'tool_start') {
        renderer.startTool(chunk);
      } else if (chunk.type === 'tool_result') {
        renderer.finishTool(chunk);
      } else if (chunk.type === 'tool_limit') {
        toolLimitReached = true;
        renderer.notice(`Tool turn limit reached after ${chunk.maxToolTurns} turns. Continuing automatically...`);
      }
    }

    if (toolLimitReached && !session.responseInterrupted) {
      renderer.notice('Continuing with the next batch of tool calls...');
      for await (const chunk of session.provider.stream({
        messages: session.messages,
        toolRegistry: session.toolRegistry,
        signal: abortController.signal,
      })) {
        if (session.responseInterrupted) {
          break;
        }

        if (chunk.type === 'text') {
          assistantText += chunk.delta;
          renderer.writeText(chunk.delta);
          if (process.env.HAX_AGENT_TEST_INTERRUPT_AFTER_TEXT === '1') {
            session.responseInterrupted = true;
            abortController.abort();
            renderer.interrupt();
            break;
          }
        } else if (chunk.type === 'thinking') {
          renderer.thinking(chunk);
        } else if (chunk.type === 'tool_start') {
          renderer.startTool(chunk);
        } else if (chunk.type === 'tool_result') {
          renderer.finishTool(chunk);
        } else if (chunk.type === 'tool_limit') {
          renderer.notice('Tool turn limit reached again. Ask me to continue if you need more.');
        }
      }
    }
  } catch (error) {
    if (session.responseInterrupted || error?.name === 'AbortError') {
      session.messages.pop();
      return;
    }

    renderer.fail(formatProviderError(error, session.provider));
    session.messages.pop();
    return;
  } finally {
    session.isStreaming = false;
    session.responseAbortController = null;
    session.responseRenderer = null;
  }

  if (session.responseInterrupted) {
    session.messages.pop();
    return;
  }

  renderer.complete();
  session.messages.push({ role: 'assistant', content: assistantText });
  appendTranscriptEntry(session.id, userMessage, session.settings);
  appendTranscriptEntry(session.id, { role: 'assistant', content: assistantText }, session.settings);
}

function loadRecentMessages(settings) {
  const [latestSession] = listSessions(settings);

  if (!latestSession) {
    return [];
  }

  const limit = settings.prompts?.maxTranscriptMessages || settings.sessions?.transcriptLimit || 20;

  return latestSession.entries()
    .filter((entry) => entry.role === 'user' || entry.role === 'assistant')
    .slice(-limit)
    .map((entry) => ({ role: entry.role, content: entry.content || '' }));
}

function showShellHelp({ output }) {
  output.writeLine('Slash commands:');
  for (const [name, command] of Object.entries(slashCommands)) {
    output.writeLine(`  /${name.padEnd(8)} ${command.description}`);
  }
}

function exitShell({ output, session }) {
  session.shouldExit = true;
  output.writeLine('Goodbye.');
}

function clearShell({ output, session }) {
  session.messages = [];
  session.id = createSessionId();
  output.clear();
  output.writeLine('Context cleared.');
}

function showTools({ output, session }) {
  output.writeLine('Available tools:');
  for (const tool of session.toolRegistry.list()) {
    output.writeLine(`  ${tool.name.padEnd(10)} ${tool.description}`);
  }
}

async function showModels({ output, session }) {
  session.availableModels = await printModels(session.provider, output);
}

async function switchModel({ args, output, session }) {
  const [selection] = args;

  if (!selection) {
    output.writeLine(`Current model: ${session.provider.model || 'unknown'}`);
    output.writeLine('Usage: /model <model-id-or-number>');
    return;
  }

  const model = resolveModelSelection(selection, session.availableModels || []);
  session.provider.setModel(model);
  output.writeLine(`Switched model to ${session.provider.model}`);
}

async function switchApiUrl({ args, output, session }) {
  const [apiUrl] = args;

  if (!apiUrl) {
    output.writeLine(`Current API URL: ${session.provider.apiUrl || 'default'}`);
    output.writeLine('Usage: /api-url <base-url>');
    return;
  }

  session.provider.setApiUrl(apiUrl);
  persistAgentSettings({ apiUrl: session.provider.apiUrl });
  session.availableModels = undefined;
  output.writeLine(`Switched API URL to ${session.provider.apiUrl || 'default'}`);
}

async function switchApiKey({ args, output, session }) {
  const [apiKey] = args;

  if (!apiKey) {
    output.writeLine(`API key: ${session.provider.apiKey ? 'set' : 'not set'}`);
    output.writeLine('Usage: /api-key <key>');
    return;
  }

  if (session.provider.name === 'mock' || session.provider.name === 'local') {
    session.provider = createProvider({
      provider: 'anthropic',
      apiKey,
      apiUrl: session.provider.apiUrl,
      model: session.provider.model,
    }, process.env);
  } else {
    session.provider.setApiKey(apiKey);
  }

  persistAgentSettings({
    provider: session.provider.name,
    apiKey: session.provider.apiKey,
    apiUrl: session.provider.apiUrl,
    model: session.provider.model,
  });
  session.availableModels = undefined;
  output.writeLine(`API key set for ${session.provider.name}.`);
}

function persistAgentSettings(agentSettings) {
  updateUserSettings({ agent: agentSettings });
}

function showAgents({ output }) {
  output.writeLine('Available agents:');
  for (const agent of agents) {
    output.writeLine(`  ${agent.name.padEnd(10)} ${agent.description}`);
  }
}

async function printModels(provider, output) {
  const models = await provider.listModels();

  output.writeLine(`Available models for ${provider.name}:`);
  models.forEach((model, index) => {
    const marker = model.id === provider.model ? '*' : ' ';
    const label = model.name && model.name !== model.id ? ` (${model.name})` : '';
    output.writeLine(` ${marker} ${String(index + 1).padStart(2)}. ${model.id}${label}`);
  });

  return models;
}

function resolveModelSelection(selection, models) {
  const modelNumber = Number(selection);

  if (Number.isInteger(modelNumber) && modelNumber > 0 && modelNumber <= models.length) {
    return models[modelNumber - 1].id;
  }

  return selection;
}

function createResponseRenderer(output) {
  const useDynamicTerminal = output.isInteractive();
  const spinnerFrames = ['-', '\\', '|', '/'];
  let spinnerTimer = null;
  let spinnerIndex = 0;
  let assistantStarted = false;
  let textStarted = false;
  let lineOpen = false;
  let lineBuffer = '';

  function writeAssistantPrefix() {
    if (!assistantStarted) {
      clearTransient();
      output.write('\nAssistant: ');
      assistantStarted = true;
      lineOpen = true;
      lineBuffer = '';
    }
  }

  function flushLineBuffer() {
    if (lineBuffer.length === 0) return;
    output.write(renderInlineSimple(lineBuffer));
    lineBuffer = '';
  }

  function startSpinner(label) {
    if (!useDynamicTerminal) {
      return;
    }

    stopSpinner();
    output.writeTransient(`${spinnerFrames[spinnerIndex]} ${label}`);
    spinnerTimer = setInterval(() => {
      spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
      output.writeTransient(`${spinnerFrames[spinnerIndex]} ${label}`);
    }, 120);
  }

  function stopSpinner() {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  }

  function clearTransient() {
    stopSpinner();
    if (useDynamicTerminal) {
      output.clearTransient();
    }
  }

  function writeToolLine(text) {
    if (lineOpen) {
      output.writeLine('');
      lineOpen = false;
    } else if (!assistantStarted) {
      output.writeLine('');
      assistantStarted = true;
    }

    output.writeLine(text);
  }

  return {
    startWaiting() {
      if (useDynamicTerminal) {
        startSpinner('Assistant is thinking...');
      } else {
        writeAssistantPrefix();
      }
    },
    writeText(delta) {
      writeAssistantPrefix();
      textStarted = true;
      lineBuffer += delta;

      const parts = lineBuffer.split('\n');
      for (let i = 0; i < parts.length - 1; i++) {
        output.write(renderInlineSimple(parts[i]));
        output.write('\n');
      }
      lineBuffer = parts[parts.length - 1];
      lineOpen = true;
    },
    thinking(chunk) {
      if (useDynamicTerminal) {
        startSpinner(chunk.summary || 'Assistant is thinking...');
        return;
      }

      writeToolLine(`[thinking] ${chunk.summary || 'Thinking...'}`);
    },
    startTool(chunk) {
      const toolLine = formatToolStart(chunk);

      if (useDynamicTerminal) {
        if (lineOpen) {
          output.writeLine('');
          lineOpen = false;
        } else if (!assistantStarted) {
          output.writeLine('');
          assistantStarted = true;
        }
        startSpinner(toolLine);
        return;
      }

      writeToolLine(`${toolLine} running`);
    },
    finishTool(chunk) {
      clearTransient();
      const modificationNotice = formatFileModificationNotice(chunk);

      if (modificationNotice) {
        for (const line of modificationNotice) {
          writeToolLine(line);
        }
      } else {
        writeToolLine(formatToolResult(chunk));
      }

      if (chunk.repeatedInvalid && chunk.showNotice) {
        writeToolLine('  Same invalid call failed twice; asking the model to choose different input.');
      }
    },
    notice(message) {
      clearTransient();
      writeToolLine(`  ${message}`);
    },
    complete() {
      clearTransient();
      if (!assistantStarted) {
        output.writeLine('\nAssistant:');
        return;
      }
      flushLineBuffer();
      if (lineOpen) {
        output.writeLine('');
        lineOpen = false;
      }
    },
    fail(message) {
      clearTransient();
      flushLineBuffer();
      output.writeLine(message);
    },
    interrupt() {
      clearTransient();
      flushLineBuffer();
      output.writeLine('\nInterrupted response.');
    },
  };
}

function formatToolStart(chunk) {
  const displayInput = chunk.displayInput || summarizeToolInput(chunk.name, chunk.input);
  const label = toToolLabel(chunk.name);
  const attemptLabel = chunk.attempt && chunk.attempt > 1 ? ` (attempt ${chunk.attempt})` : '';
  if (!displayInput) return `[tool] ${label}${attemptLabel}`;
  return `[tool] ${label}${attemptLabel}(${displayInput})`;
}

function formatToolResult(chunk) {
  const duration = formatDuration(chunk.durationMs);
  const lines = [];
  const name = chunk.name;
  const input = chunk.input || {};

  if (chunk.isError) {
    const code = chunk.errorCode && chunk.errorCode !== 'TOOL_ERROR' ? `${chunk.errorCode}: ` : '';
    const message = chunk.error ? `${code}${chunk.error}` : `${code}tool failed`;
    const errorDetail = formatToolErrorDetail(name, input, message);
    lines.push(`  ✗ Failed${duration}`);
    lines.push(...errorDetail.split('\n').map((line) => `    ${line}`));
    return lines.join('\n');
  }

  const detail = formatToolSuccessDetail(chunk);

  lines.push(`  ✓ Done${duration}`);
  if (detail) {
    lines.push(...detail.split('\n').map((line) => `    ${line}`));
  }

  return lines.join('\n');
}

function formatToolSuccessDetail(chunk) {
  const data = chunk.data || {};
  const name = chunk.name;

  if (name === 'file.read') {
    const lineCount = (data.content || '').split('\n').length;
    return `${toDisplayPath(data.path)} · ${formatBytes(data.bytes)} · ${lineCount} ${pluralize('line', lineCount)}`;
  }

  if (name === 'file.write') {
    const action = data.overwritten ? 'Updated' : 'Created';
    const change = data.change;
    if (change && change.operation === 'update') {
      const parts = [];
      if (change.added > 0) parts.push(`+${change.added}`);
      if (change.removed > 0) parts.push(`-${change.removed}`);
      return `${action} ${toDisplayPath(data.path)} · ${formatBytes(data.bytes)} (${parts.join(', ')})`;
    }
    return `${action} ${toDisplayPath(data.path)} · ${formatBytes(data.bytes)}`;
  }

  if (name === 'file.glob') {
    const matchCount = Array.isArray(data.matches) ? data.matches.length : 0;
    const truncated = data.truncated ? ' (truncated)' : '';
    return `${matchCount} ${pluralize('file', matchCount)} matched${truncated}`;
  }

  if (name === 'file.search') {
    const matchCount = Array.isArray(data.matches) ? data.matches.length : 0;
    const fileCount = new Set(Array.isArray(data.matches) ? data.matches.map((m) => m.path) : []).size;
    const truncated = data.truncated ? ' (truncated)' : '';
    return `${matchCount} ${pluralize('match', matchCount)} in ${fileCount} ${pluralize('file', fileCount)}${truncated}`;
  }

  if (name === 'shell.run') {
    const parts = [];
    if (data.exitCode !== null && data.exitCode !== undefined) {
      parts.push(`exit ${data.exitCode}`);
    }
    if (data.signal) {
      parts.push(`signal ${data.signal}`);
    }
    if (data.timedOut) {
      parts.push('timed out');
    }
    const status = parts.length > 0 ? ` (${parts.join(', ')})` : '';
    if (data.stdout) {
      const output = data.stdout.trim();
      if (output.length > 0) {
        const preview = output.length > 200 ? `${output.slice(0, 197)}...` : output;
        return `exit ${data.exitCode || 0}${status}\n    └─ stdout: ${preview}`;
      }
    }
    if (data.stderr) {
      const errOut = data.stderr.trim();
      if (errOut.length > 0) {
        const preview = errOut.length > 200 ? `${errOut.slice(0, 197)}...` : errOut;
        return `exit ${data.exitCode || 0}${status}\n    └─ stderr: ${preview}`;
      }
    }
    return `completed${status}`;
  }

  return '';
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

function toDisplayPath(filePath) {
  return normalizeSlashes(String(filePath || ''));
}

function normalizeSlashes(value) {
  return value.replace(/\//g, '\\');
}

function formatToolErrorDetail(name, input, message) {
  const lines = [];

  if (name === 'file.read') {
    const displayPath = input.path ? toDisplayPath(input.path) : '(no path provided)';
    lines.push(`└─ FileRead(${displayPath}) → ${message}`);
    if (!input.path) {
      lines.push('  Hint: provide a valid file path relative to the workspace root');
    }
    return lines.join('\n');
  }

  if (name === 'file.write') {
    const displayPath = input.path ? toDisplayPath(input.path) : '(no path provided)';
    lines.push(`└─ FileWrite(${displayPath}) → ${message}`);
    if (!input.path) {
      lines.push('  Hint: provide a valid file path');
    }
    return lines.join('\n');
  }

  if (name === 'file.glob') {
    const pattern = input.pattern || '(default: **)';
    lines.push(`└─ FileGlob(pattern: ${pattern}) → ${message}`);
    return lines.join('\n');
  }

  if (name === 'file.search') {
    const query = input.query || '(empty)';
    lines.push(`└─ FileSearch(query: "${query}") → ${message}`);
    return lines.join('\n');
  }

  if (name === 'shell.run') {
    const cmd = input.command || '(no command)';
    lines.push(`└─ ShellRun(${cmd}) → ${message}`);
    return lines.join('\n');
  }

  return `└─ ${message}`;
}

function formatFileModificationNotice(chunk) {
  if (chunk.name !== 'file.write' || chunk.isError || !chunk.data?.path || !chunk.data?.change) {
    return null;
  }

  const change = chunk.data.change;
  const action = change.operation === 'create' ? 'Create' : 'Update';
  const lines = [
    `${action}(${formatDisplayPath(chunk.data.path)})`,
    `  ⎿  ${formatChangeSummary(change)}`,
  ];

  for (const item of Array.isArray(change.preview) ? change.preview : []) {
    lines.push(`      ${String(item.line).padStart(4)} ${item.marker || '+'}${item.text || ''}`);
  }

  return lines;
}

function formatChangeSummary(change) {
  const parts = [];

  if (change.added > 0) {
    parts.push(`Added ${change.added} ${pluralize('line', change.added)}`);
  }

  if (change.removed > 0) {
    parts.push(`Removed ${change.removed} ${pluralize('line', change.removed)}`);
  }

  if (parts.length === 0) {
    const changed = Number.isFinite(change.changed) && change.changed > 0 ? change.changed : 1;
    parts.push(`Modified ${changed} ${pluralize('line', changed)}`);
  }

  return parts.join(', ');
}

function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}

function formatDisplayPath(filePath) {
  return String(filePath).replace(/\//g, '\\');
}

function summarizeToolInput(name, input) {
  if (!input || typeof input !== 'object') {
    return '';
  }

  const value = input;

  if (name === 'file.read') {
    return joinInputParts([formatInputPart('file', value.path), formatInputPart('maxBytes', value.maxBytes)]);
  }

  if (name === 'file.write') {
    return joinInputParts([
      formatInputPart('file', value.path),
      formatInputPart('chars', typeof value.content === 'string' ? value.content.length : undefined),
      formatInputPart('maxBytes', value.maxBytes),
    ]);
  }

  if (name === 'file.glob') {
    return joinInputParts([
      formatInputPart('pattern', value.pattern),
      formatInputPart('cwd', value.cwd),
      formatInputPart('maxResults', value.maxResults),
    ]);
  }

  if (name === 'file.search') {
    return joinInputParts([
      formatInputPart('query', value.query),
      formatInputPart('path', value.path),
      formatInputPart('glob', value.glob),
      formatInputPart('regex', value.regex),
    ]);
  }

  if (name === 'shell.run') {
    const command = [value.command, ...(Array.isArray(value.args) ? value.args : [])].filter(Boolean).join(' ');
    return joinInputParts([
      formatInputPart('command', command),
      formatInputPart('cwd', value.cwd),
      formatInputPart('timeoutMs', value.timeoutMs),
    ]);
  }

  return joinInputParts(Object.entries(value)
    .filter(([key, item]) => isDisplayableInput(key, item))
    .slice(0, 3)
    .map(([key, item]) => formatInputPart(key, item)));
}

function isDisplayableInput(key, value) {
  return !/key|token|secret|password|content|env/i.test(key) &&
    (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean');
}

function formatInputPart(key, value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const text = String(value).replace(/\s+/g, ' ');
  const truncated = text.length > 80 ? `${text.slice(0, 77)}...` : text;
  return `${key}: ${truncated}`;
}

function joinInputParts(parts) {
  return parts.filter(Boolean).join(', ');
}

function toToolLabel(name) {
  return String(name || 'tool')
    .split('.')
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(' ');
}

function formatDuration(durationMs) {
  return Number.isFinite(durationMs) ? ` in ${durationMs}ms` : '';
}

function formatProviderError(error, provider) {
  const message = error?.message || String(error);

  if (provider.name === 'anthropic' && /\b(401|403|forbidden|unauthorized)\b/i.test(message)) {
    return `${message}\nCheck /api-key and /api-url, then try again.`;
  }

  return message;
}

function getDisplayWidth(char) {
  const codePoint = char.codePointAt(0);

  if (codePoint === undefined) {
    return 0;
  }

  if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return 0;
  }

  return isWideCodePoint(codePoint) ? 2 : 1;
}

function isWideCodePoint(codePoint) {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  );
}

function createOutput(stream) {
  let conversationRow = 0;
  let conversationColumn = 0;

  const ANSI_ESCAPE_REGEX = /\x1B\[[0-?]*[ -/]*[@-~]/g;

  function writeToConversation(text) {
    if (!stream.isTTY || !process.stdin.isTTY) {
      stream.write(text);
      return;
    }

    const rows = stream.rows || 0;
    const columns = stream.columns || 0;
    const promptAreaRows = 4;
    const maxConversationRow = Math.max(0, rows - promptAreaRows);

    if (conversationRow >= maxConversationRow) {
      stopSpinner();
      stream.write(text);
      const plainText = text.replace(ANSI_ESCAPE_REGEX, '');
      const newLines = (plainText.match(/\n/g) || []).length;
      conversationRow = maxConversationRow + newLines;
      const lastLine = plainText.split('\n').pop();
      conversationColumn = calculateDisplayWidth(lastLine);
      return;
    }

    if (conversationColumn > 0) {
      readline.cursorTo(stream, conversationColumn, conversationRow);
    }

    stream.write(text);

    const plainText = text.replace(ANSI_ESCAPE_REGEX, '');
    let col = conversationColumn;
    let row = conversationRow;

    for (const char of plainText) {
      if (char === '\n') {
        row += 1;
        col = 0;
        continue;
      }

      col += getDisplayWidth(char);

      if (col >= columns) {
        row += 1;
        col = col % columns;
      }
    }

    conversationRow = row;
    conversationColumn = col;

    readline.cursorTo(stream, 0, rows >= 4 ? rows - 2 : Math.max(0, conversationRow));
  }

  function calculateDisplayWidth(str) {
    let width = 0;
    for (const char of String(str || '')) {
      width += getDisplayWidth(char);
    }
    return width;
  }

  function scrollConversationRegion(maxConversationRow) {
    const bottom = maxConversationRow + 1;

    stream.write(`\x1b[1;${bottom}r`);
    readline.cursorTo(stream, 0, maxConversationRow);
    stream.write('\n');
    stream.write('\x1b[r');
    conversationRow = maxConversationRow;
  }

  return {
    write(text) {
      writeToConversation(text);
    },
    writeLine(text = '') {
      writeToConversation(`${text}\n`);
    },
    clear() {
      stream.write('\x1Bc');
    },
    resetConversationCursor() {
      conversationRow = 0;
      conversationColumn = 0;
    },
    clearTransient() {
      if (!this.isInteractive()) {
        return;
      }

      readline.clearLine(stream, 0);
      readline.cursorTo(stream, 0);
    },
    writeTransient(text) {
      if (!this.isInteractive()) {
        return;
      }

      readline.clearLine(stream, 0);
      readline.cursorTo(stream, 0);
      stream.write(text);
    },
    isInteractive() {
      return Boolean(stream.isTTY && process.stdin.isTTY);
    },
    async streamText(text) {
      const chunks = text.match(/\S+\s*/g) || [''];

      for (const chunk of chunks) {
        stream.write(chunk);
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
  };
}

function showHelp() {
  console.log(`hax-agent\n\nUsage:\n  hax-agent\n  hax-agent chat\n  hax-agent help\n  hax-agent models\n  hax-agent team auth-refactor\n\nCommands:\n  chat                  ${commands.chat.description}\n  help                  ${commands.help.description}\n  models                ${commands.models.description}\n  team auth-refactor    Create agents and parallel tasks for auth refactoring\n\nInteractive slash commands:\n  /help /exit /clear /tools /agents /models /model <model-id> /api-url <base-url> /api-key <key>`);
}

// ANSI color codes for terminal rendering
const ANSI = {
  reset: '\x1B[0m',
  bold: '\x1B[1m',
  dim: '\x1B[2m',
  italic: '\x1B[3m',
  underline: '\x1B[4m',
  code: '\x1B[38;5;141m',
  heading: '\x1B[1;36m',
  link: '\x1B[4;34m',
  list: '\x1B[33m',
  hr: '\x1B[90m',
  boldText: '\x1B[1;37m',
};

function renderInlineSimple(text) {
  if (!text) return '';

  let result = text;
  let cursor = 0;
  let output = '';

  while (cursor < result.length) {
    const remaining = result.slice(cursor);

    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch && boldMatch.index === 0 && boldMatch[1].length > 0) {
      output += `${ANSI.bold}${boldMatch[1]}${ANSI.reset}`;
      cursor += boldMatch[0].length;
      continue;
    }

    const italicMatch = remaining.match(/^\*(.+?)\*/);
    if (italicMatch && italicMatch.index === 0 && italicMatch[1].length > 0 && !remaining.startsWith('**')) {
      output += `${ANSI.italic}${italicMatch[1]}${ANSI.reset}`;
      cursor += italicMatch[0].length;
      continue;
    }

    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch && codeMatch.index === 0) {
      output += `${ANSI.code}${codeMatch[1]}${ANSI.reset}`;
      cursor += codeMatch[0].length;
      continue;
    }

    const linkMatch = remaining.match(/^\[(.+?)\]\(.+?\)/);
    if (linkMatch && linkMatch.index === 0) {
      output += `${ANSI.underline}${linkMatch[1]}${ANSI.reset}`;
      cursor += linkMatch[0].length;
      continue;
    }

    if (result[cursor] === '*' || result[cursor] === '`' || result[cursor] === '[') {
      output += result[cursor];
      cursor += 1;
      continue;
    }

    const nextSpecial = result.slice(cursor).search(/[*`\[]/);
    if (nextSpecial === -1) {
      output += result.slice(cursor);
      break;
    } else if (nextSpecial > 0) {
      output += result.slice(cursor, cursor + nextSpecial);
      cursor += nextSpecial;
    } else {
      output += result[cursor];
      cursor += 1;
    }
  }

  return output;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
