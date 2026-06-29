const StreamEventType = { TEXT_DELTA:"text_delta",THINKING_DELTA:"thinking_delta",TOOL_USE_START:"tool_use_start",TOOL_USE_DELTA:"tool_use_delta",TOOL_USE_COMPLETE:"tool_use_complete",TOOL_EXECUTION_STARTED:"tool_execution_started",TOOL_EXECUTION_COMPLETED:"tool_execution_completed",MESSAGE_START:"message_start",MESSAGE_COMPLETE:"message_complete",ASSISTANT_TURN_COMPLETE:"assistant_turn_complete",USAGE:"usage",ERROR:"error",RETRY:"retry",STATUS:"status" };
class AssistantTextDelta { constructor(t) { this.type=StreamEventType.TEXT_DELTA; this.text=t; } }
class AssistantTurnComplete { constructor(o={}) { this.type=StreamEventType.ASSISTANT_TURN_COMPLETE; this.text=o.text||""; this.usage=o.usage||null; } }
export { StreamEventType, AssistantTextDelta, AssistantTurnComplete };
