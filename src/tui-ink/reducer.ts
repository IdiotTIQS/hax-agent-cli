/**
 * reducer.ts — pure AppState reducer for the ink TUI (Stage F5).
 *
 * This is THE single place the AgentEvent switch lives.  It replaces the
 * three duplicated switch blocks in cli.ts (runInteractive chat, skill
 * handler, and auto-prompt handler).
 *
 * Rules:
 *  - PURE — no side effects, no async, no imports from engine or React.
 *  - Every AppAction case must be handled.
 *  - AgentEvent cases handled exhaustively inside engine_event.
 *  - Use immutable spread patterns; never mutate state in-place.
 */

import type {
  AppState,
  AppAction,
  AgentEvent,
  ToolCallState,
  ConversationMessage,
  CommittedTurn,
} from "./types.js";

import { createInitialState } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Update the last running tool whose name matches event.name.
 * Searches from the end so the most-recent call is resolved first,
 * which is the correct behaviour when the same tool is called twice in
 * one turn.
 */
function resolveRunningTool(
  tools: ToolCallState[],
  name: string,
  patch: Partial<ToolCallState>,
): ToolCallState[] {
  // Find last index with status "running" and matching name.
  let idx = -1;
  for (let i = tools.length - 1; i >= 0; i--) {
    if (tools[i].name === name && tools[i].status === "running") {
      idx = i;
      break;
    }
  }
  if (idx === -1) return tools; // no matching running tool — defensive
  return tools.map((t, i) => (i === idx ? { ...t, ...patch } : t));
}

/**
 * Commit currentTurnText as an assistant message (if non-empty).
 */
function commitAssistant(
  messages: ConversationMessage[],
  text: string,
): ConversationMessage[] {
  if (!text.trim()) return messages;
  return [...messages, { role: "assistant" as const, text }];
}

// ---------------------------------------------------------------------------
// handleEngineEvent — inner switch for engine_event
// ---------------------------------------------------------------------------

function handleEngineEvent(state: AppState, event: AgentEvent): AppState {
  switch (event.type) {
    case "turn.started":
      return { ...state, isWaiting: true };

    case "message.delta":
      return {
        ...state,
        isWaiting: false,
        currentTurnText: state.currentTurnText + (event.delta ?? ""),
      };

    case "thinking":
      return {
        ...state,
        currentThinking: state.currentThinking + (event.delta ?? ""),
      };

    case "tool.start":
      return {
        ...state,
        isWaiting: false,
        currentTools: [
          ...state.currentTools,
          {
            name: event.name,
            input: event.input,
            status: "running",
          } satisfies ToolCallState,
        ],
        toolCallCount: state.toolCallCount + 1,
      };

    case "tool.result": {
      const status =
        event.isError ||
        (event.error &&
          (event.error as { code?: string }).code === "PERMISSION_DENIED")
          ? "error"
          : "done";
      const updatedTools = resolveRunningTool(state.currentTools, event.name, {
        status,
        data: event.data,
        error: event.error,
        durationMs: event.durationMs,
      });
      return { ...state, currentTools: updatedTools };
    }

    case "usage":
      return {
        ...state,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      };

    case "status":
      return { ...state, statusMessage: event.message };

    case "turn.completed": {
      const usageAny = event.usage as
        | { inputTokens?: number; outputTokens?: number }
        | null
        | undefined;
      const committed: CommittedTurn = {
        userText: state.pendingUserText,
        assistantText: state.currentTurnText,
        thinking: state.currentThinking,
        tools: state.currentTools,
        interrupted: false,
        error: null,
      };
      return {
        ...state,
        committedTurns: [...state.committedTurns, committed],
        messages: commitAssistant(state.messages, state.currentTurnText),
        isStreaming: false,
        isWaiting: false,
        turnCount: state.turnCount + 1,
        currentTurnText: "",
        currentThinking: "",
        currentTools: [],
        statusMessage: null,
        inputTokens: usageAny?.inputTokens ?? state.inputTokens,
        outputTokens: usageAny?.outputTokens ?? state.outputTokens,
      };
    }

    case "turn.interrupted": {
      const committed: CommittedTurn = {
        userText: state.pendingUserText,
        assistantText: state.currentTurnText,
        thinking: state.currentThinking,
        tools: state.currentTools,
        interrupted: true,
        error: null,
      };
      return {
        ...state,
        committedTurns: [...state.committedTurns, committed],
        isInterrupted: true,
        isStreaming: false,
        isWaiting: false,
        messages: commitAssistant(state.messages, state.currentTurnText),
        currentTurnText: "",
        currentThinking: "",
        currentTools: [],
      };
    }

    case "turn.failed": {
      const committed: CommittedTurn = {
        userText: state.pendingUserText,
        assistantText: state.currentTurnText,
        thinking: state.currentThinking,
        tools: state.currentTools,
        interrupted: false,
        error: event.error.message,
      };
      return {
        ...state,
        committedTurns: [...state.committedTurns, committed],
        currentError: event.error.message,
        isStreaming: false,
        isWaiting: false,
      };
    }

    case "tool.limit":
      return { ...state, statusMessage: "Tool limit reached" };

    default: {
      // Exhaustiveness check — TypeScript will error if a case is missing.
      const _exhaustive: never = event;
      void _exhaustive;
      return state;
    }
  }
}

// ---------------------------------------------------------------------------
// reducer
// ---------------------------------------------------------------------------

/**
 * Pure reducer: maps (AppState, AppAction) → AppState.
 * All engine events arrive as { type: "engine_event", event } wrappers.
 *
 * @param state  - current AppState (from useReducer or unit tests)
 * @param action - dispatched AppAction
 * @returns      - new AppState (or the same reference if nothing changed)
 */
export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    // ── Engine event wrapper ────────────────────────────────────────────────
    case "engine_event":
      return handleEngineEvent(state, action.event);

    // ── User submitted a message ────────────────────────────────────────────
    // App dispatches this BEFORE starting the engine loop so the UI shows
    // the user bubble and spinner immediately.
    case "turn_start":
      return {
        ...state,
        isStreaming: true,
        isWaiting: true,
        currentTurnText: "",
        currentThinking: "",
        currentTools: [],
        currentError: null,
        isInterrupted: false,
        statusMessage: null,
      };

    // submit_input pushes the user message into history; App drives the engine.
    case "submit_input":
      return {
        ...state,
        pendingUserText: action.text,
        messages: [
          ...state.messages,
          { role: "user" as const, text: action.text },
        ],
      };

    // ── Permission mode switch ──────────────────────────────────────────────
    case "set_mode":
      return { ...state, permissionMode: action.mode };

    // ── Approval bridge ─────────────────────────────────────────────────────
    case "set_approval":
      return { ...state, pendingApproval: action.approval };

    // ── Clear history ───────────────────────────────────────────────────────
    case "clear":
      return {
        ...createInitialState({
          model: state.model,
          permissionMode: state.permissionMode,
          providerName: state.providerName,
        }),
      };

    // ── Interrupt ───────────────────────────────────────────────────────────
    // Side effect (engine.interrupt()) is in App; reducer only marks state.
    case "interrupt":
      return { ...state, isInterrupted: true };

    // ── Metadata update ─────────────────────────────────────────────────────
    case "update_meta":
      return {
        ...state,
        model: action.model ?? state.model,
        providerName: action.providerName ?? state.providerName,
        permissionMode: action.permissionMode ?? state.permissionMode,
      };

    // ── Manual commit (App may not use this; kept for completeness) ──────────
    case "commit_turn": {
      const committed: CommittedTurn = {
        userText: state.pendingUserText,
        assistantText: state.currentTurnText,
        thinking: state.currentThinking,
        tools: state.currentTools,
        interrupted: false,
        error: null,
      };
      return {
        ...state,
        committedTurns: [...state.committedTurns, committed],
        currentTurnText: "",
        currentThinking: "",
        currentTools: [],
      };
    }

    // ── Detail mode toggle ───────────────────────────────────────────────────
    case "toggle_detail":
      return { ...state, detailMode: !state.detailMode };

    // ── Command palette ──────────────────────────────────────────────────────
    case "open_palette":
      return { ...state, commandPalette: { open: true, query: action.query } };

    case "update_palette":
      return {
        ...state,
        commandPalette: state.commandPalette
          ? { ...state.commandPalette, query: action.query }
          : { open: true, query: action.query },
      };

    case "close_palette":
      return { ...state, commandPalette: null };

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

export default reducer;
