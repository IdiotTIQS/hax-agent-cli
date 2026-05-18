export function upsertToolCallState(toolCalls, event, options = {}) {
  const currentToolCalls = Array.isArray(toolCalls) ? toolCalls : [];
  const name = event.name ?? event.tool ?? 'tool';
  const attempt = event.attempt ?? 0;
  const turn = event.turn ?? options.currentTurn ?? 0;
  const id = event.id ?? event.toolCallId ?? event.callId ?? event.tool_use_id ?? `${name}:${attempt}:${turn}`;
  const nextToolCalls = currentToolCalls.map((toolCall) => ({ ...toolCall }));
  let existingIndex = nextToolCalls.findIndex((toolCall) => toolCall.id === id);

  if (existingIndex === -1 && (event.status === 'done' || event.status === 'failed')) {
    existingIndex = nextToolCalls.findIndex((toolCall) => toolCall.name === name && toolCall.status === 'running');
  }

  const patch = createToolCallPatch(event, {
    id,
    name,
    turn,
    doneLabel: options.doneLabel || 'Done',
    errorLabel: options.errorLabel || 'Error',
    now: options.now || new Date(),
  });

  if (existingIndex === -1) {
    return [patch, ...nextToolCalls].slice(0, options.limit || 20);
  }

  nextToolCalls[existingIndex] = {
    ...nextToolCalls[existingIndex],
    ...patch,
  };
  return nextToolCalls;
}

function createToolCallPatch(event, context) {
  const isResult = event.type === 'tool.result';

  return {
    id: context.id,
    name: context.name,
    status: event.status ?? (isResult ? (event.isError ? 'failed' : 'done') : 'running'),
    summary: isResult
      ? `${event.isError ? context.errorLabel : context.doneLabel} - ${event.durationMs ?? '?'}ms`
      : (event.displayInput ?? event.summary ?? ''),
    input: stringifyToolValue(event.input),
    output: isResult && event.data
      ? stringifyToolValue(event.data)
      : (event.error ? String(event.error) : ''),
    turn: context.turn,
    updatedAt: context.now,
  };
}

function stringifyToolValue(value) {
  if (!value) return '';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}
