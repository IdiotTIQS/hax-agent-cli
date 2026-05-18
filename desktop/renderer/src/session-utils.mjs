export function serializeSessionId(value) {
  if (!value) return '';
  return value.id ?? value.sessionId ?? '';
}

export function extractSettingsPatch(payload) {
  const src = payload?.settings ?? payload;
  if (!src || typeof src !== 'object') return {};

  const agent = src.agent ?? src;
  const patch = {};
  if (agent.provider !== undefined) patch.provider = agent.provider;
  if (agent.model !== undefined) patch.model = agent.model;
  if (typeof agent.temperature === 'number') patch.temperature = agent.temperature;
  if (src.desktop?.workspace !== undefined || src.workspace !== undefined) {
    patch.workspace = src.desktop?.workspace ?? src.workspace ?? '';
  }
  if (src.ui?.locale) patch.locale = src.ui.locale;

  return patch;
}

export function createMessagesFromSession(sessionResult, options = {}) {
  const restored = Array.isArray(sessionResult?.messages) ? sessionResult.messages : [];
  const idFactory = options.idFactory || (() => crypto.randomUUID());
  const nowFactory = options.nowFactory || (() => new Date());

  if (restored.length === 0) {
    return {
      messages: [{
        id: idFactory(),
        role: 'assistant',
        content: options.emptyContent || '',
        createdAt: nowFactory(),
        turn: 0,
      }],
      currentTurn: 0,
    };
  }

  return {
    messages: restored.map((message, index) => ({
      id: idFactory(),
      role: message.role,
      content: message.content || '',
      createdAt: nowFactory(),
      turn: Math.floor(index / 2),
    })),
    currentTurn: Math.ceil(restored.length / 2),
  };
}

export function extractSessionStats(sessionResult) {
  const status = sessionResult?.status ?? sessionResult;
  if (!status) return {};

  const stats = {};
  if (typeof status.tokens === 'number') {
    stats.tokens = status.tokens;
  } else if (typeof status.inputTokens === 'number' || typeof status.outputTokens === 'number') {
    stats.tokens = Number(status.inputTokens || 0) + Number(status.outputTokens || 0);
  }
  if (typeof status.cost === 'number') stats.cost = `$${status.cost.toFixed(4)}`;
  if (typeof status.elapsed === 'string') stats.elapsed = status.elapsed;
  if (sessionResult?.provider?.model) stats.model = sessionResult.provider.model;

  return stats;
}
