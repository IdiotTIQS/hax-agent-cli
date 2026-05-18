export function formatElapsed(milliseconds) {
  const seconds = Math.floor(Math.max(0, Number(milliseconds || 0)) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function createLogEntry(label, type = 'info', options = {}) {
  const idFactory = options.idFactory || (() => crypto.randomUUID());
  const nowFactory = options.nowFactory || (() => new Date());
  return {
    id: idFactory(),
    label,
    time: nowFactory(),
    type,
  };
}

export function prependLimited(list, item, limit) {
  return [item, ...(Array.isArray(list) ? list : [])].slice(0, limit);
}

export function createChatMessage(role, content, options = {}) {
  const idFactory = options.idFactory || (() => crypto.randomUUID());
  const nowFactory = options.nowFactory || (() => new Date());
  return {
    id: idFactory(),
    role,
    content: String(content ?? ''),
    createdAt: nowFactory(),
    turn: options.turn || 0,
    ...(options.extra || {}),
  };
}

export function createRunState(state, overrides = {}) {
  const presets = {
    idle: {
      isBusy: false,
      isThinking: false,
      isStreaming: false,
      activeAssistantId: '',
      statusState: 'idle',
    },
    thinking: {
      isBusy: true,
      isThinking: true,
      isStreaming: false,
      activeAssistantId: '',
      statusState: 'thinking',
    },
    running: {
      isBusy: true,
      isThinking: false,
      isStreaming: true,
      statusState: 'running',
    },
    toolRunning: {
      isBusy: true,
      isThinking: false,
      isStreaming: false,
      statusState: 'running',
    },
    error: {
      isBusy: false,
      isThinking: false,
      isStreaming: false,
      activeAssistantId: '',
      statusState: 'error',
    },
  };

  return {
    ...(presets[state] || presets.idle),
    ...overrides,
  };
}

export function accumulateTokenUsage(currentValue, event) {
  const inputTokens = typeof event?.inputTokens === 'number' ? event.inputTokens : 0;
  const outputTokens = typeof event?.outputTokens === 'number' ? event.outputTokens : 0;
  return Number(currentValue || 0) + inputTokens + outputTokens;
}

export function toBackendPermissionMode(mode) {
  return mode === 'full' ? 'yolo' : 'normal';
}
