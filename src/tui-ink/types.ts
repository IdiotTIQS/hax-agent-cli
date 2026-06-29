/**
 * Typed foundation for the ink TUI rewrite (Stage F).
 *
 * Exports:
 *  - AgentEvent       — discriminated union matching EVERY event shape the
 *                       AgentEngine async generator yields (11 types, verified
 *                       against src/engine/agent.ts yield sites).
 *  - ToolCallState    — per-tool-call UI state accumulated while a turn runs.
 *  - ConversationMessage — committed turn for the message history list.
 *  - AppState         — the ink reducer state (F5 will implement the reducer).
 *  - AppAction        — discriminated union of all reducer actions.
 *  - PendingApproval  — drives the engine's awaited approval Promise.
 *  - createInitialState — factory helper for bootstrapping AppState.
 *
 * NO React components, NO engine changes — types only.
 */

// ---------------------------------------------------------------------------
// Shared sub-type
// ---------------------------------------------------------------------------

/** Error detail carried by tool.result and PendingApproval. */
export interface ToolErrorDetail {
  code?: string;
  message: string;
}

// ---------------------------------------------------------------------------
// AgentEvent — discriminated union (11 cases)
// ---------------------------------------------------------------------------

/** Engine yielded when a new user turn begins. */
export interface TurnStartedEvent {
  type: "turn.started";
  sessionId: string;
}

/** Incremental assistant text token. */
export interface MessageDeltaEvent {
  type: "message.delta";
  delta: string;
}

/**
 * Re-yielded raw StreamChunk for extended thinking.
 * delta is the incremental thinking text; summary may appear as a block.
 */
export interface ThinkingEvent {
  type: "thinking";
  delta?: string;
  summary?: string;
}

/** Token-usage report (emitted mid-stream at line 393 and end-of-turn at 418). */
export interface UsageEvent {
  type: "usage";
  inputTokens: number;
  outputTokens: number;
}

/** Transient compaction / status notice (lines 397, 410). */
export interface StatusEvent {
  type: "status";
  message: string;
}

/** A tool call is about to execute (line 468). */
export interface ToolStartEvent {
  type: "tool.start";
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool call completed (line 484).
 * Permission-denied variant (lines 455/461): isError=true,
 * error.code="PERMISSION_DENIED", no data/durationMs.
 */
export interface ToolResultEvent {
  type: "tool.result";
  name: string;
  isError: boolean;
  data?: unknown;
  error?: ToolErrorDetail;
  durationMs?: number;
}

/** The assistant turn finished cleanly (line 425). */
export interface TurnCompletedEvent {
  type: "turn.completed";
  text: string;
  usage: unknown;
  context: string;
}

/** Turn was aborted via session.interrupt() (line 322). */
export interface TurnInterruptedEvent {
  type: "turn.interrupted";
}

/** Turn failed with an error (lines 323, 404, 415). */
export interface TurnFailedEvent {
  type: "turn.failed";
  error: { message: string };
}

/** Tool-call limit reached; engine stopped the loop (line 502). */
export interface ToolLimitEvent {
  type: "tool.limit";
  maxToolTurns: number;
}

/**
 * All events the AgentEngine async generator can yield.
 * Discriminated on the `type` field — use exhaustive switches.
 */
export type AgentEvent =
  | TurnStartedEvent
  | MessageDeltaEvent
  | ThinkingEvent
  | UsageEvent
  | StatusEvent
  | ToolStartEvent
  | ToolResultEvent
  | TurnCompletedEvent
  | TurnInterruptedEvent
  | TurnFailedEvent
  | ToolLimitEvent;

// ---------------------------------------------------------------------------
// ToolCallState
// ---------------------------------------------------------------------------

/** UI state for one tool call accumulated during an active turn. */
export interface ToolCallState {
  name: string;
  input: Record<string, unknown>;
  status: "running" | "done" | "error";
  data?: unknown;
  error?: ToolErrorDetail;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// ConversationMessage
// ---------------------------------------------------------------------------

/** A committed turn stored in the message history. */
export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
}

// ---------------------------------------------------------------------------
// PendingApproval
// ---------------------------------------------------------------------------

/**
 * Drives the engine's awaited approval Promise.
 * The ink UI renders an approval prompt; the user's choice calls resolve().
 */
export interface PendingApproval {
  toolName: string;
  toolInput: Record<string, unknown>;
  resolve: (answer: "approve" | "always" | "deny") => void;
}

// ---------------------------------------------------------------------------
// AppState
// ---------------------------------------------------------------------------

/**
 * Complete reducer state for the ink TUI.
 * F5 will implement the reducer that mutates this via AppAction events.
 */
export interface AppState {
  /** Committed turns (user + assistant) shown in the message history. */
  messages: ConversationMessage[];

  /** True while the engine generator is running. */
  isStreaming: boolean;

  /** Cumulative token counts for the cost/status display. */
  inputTokens: number;
  outputTokens: number;

  /** Monotonic counters. */
  turnCount: number;
  toolCallCount: number;

  /** Accumulated assistant text delta for the current (in-progress) turn. */
  currentTurnText: string;

  /** Accumulated thinking/reasoning text for the current turn. */
  currentThinking: string;

  /** Tool calls active or completed in the current turn. */
  currentTools: ToolCallState[];

  /**
   * True between turn.started and the first message.delta (or tool.start).
   * Drives the "waiting…" spinner.
   */
  isWaiting: boolean;

  /** Non-null when the turn ended in an error. Cleared on the next turn. */
  currentError: string | null;

  /** True when the active turn was interrupted by the user. */
  isInterrupted: boolean;

  /** Transient compaction/status notice; displayed briefly then cleared. */
  statusMessage: string | null;

  // --- Session metadata (displayed in the status bar) ---
  permissionMode: string;
  model: string;
  providerName: string;
  /** Estimated cost in USD derived from token counts + model pricing. */
  cost: number;

  /** Non-null when the engine is awaiting a tool-permission answer. */
  pendingApproval: PendingApproval | null;
}

// ---------------------------------------------------------------------------
// AppAction — reducer actions
// ---------------------------------------------------------------------------

/** Wraps any AgentEvent for the reducer to interpret. */
export interface EngineEventAction {
  type: "engine_event";
  event: AgentEvent;
}

/** User submitted a message in the input box. */
export interface SubmitInputAction {
  type: "submit_input";
  text: string;
}

/** Switch permission mode (normal / yolo / plan / fullauto). */
export interface SetModeAction {
  type: "set_mode";
  mode: string;
}

/** Install or clear the pending tool-approval prompt. */
export interface SetApprovalAction {
  type: "set_approval";
  approval: PendingApproval | null;
}

/** Clear all messages and reset turn state (like /clear). */
export interface ClearAction {
  type: "clear";
}

/** User pressed the interrupt key (Ctrl-C / Escape during streaming). */
export interface InterruptAction {
  type: "interrupt";
}

/**
 * Fired synchronously when the engine starts a new user turn
 * (before the first engine_event arrives) so the UI can show
 * the spinner immediately.
 */
export interface TurnStartAction {
  type: "turn_start";
}

/** Update session metadata shown in the status bar. */
export interface UpdateMetaAction {
  type: "update_meta";
  model?: string;
  providerName?: string;
  permissionMode?: string;
}

/**
 * All actions the ink reducer handles.
 * Discriminated on the `type` field — exhaustive switches required.
 */
export type AppAction =
  | EngineEventAction
  | SubmitInputAction
  | SetModeAction
  | SetApprovalAction
  | ClearAction
  | InterruptAction
  | TurnStartAction
  | UpdateMetaAction;

// ---------------------------------------------------------------------------
// createInitialState helper
// ---------------------------------------------------------------------------

/**
 * Factory for bootstrapping AppState.
 *
 * @param partial - optional overrides (e.g. model/provider from settings).
 * @returns a fully-initialised AppState ready to hand to useReducer.
 *
 * @example
 *   const [state, dispatch] = useReducer(appReducer, createInitialState({ model: "claude-3-5-sonnet" }));
 */
export function createInitialState(partial: Partial<AppState> = {}): AppState {
  return {
    messages: [],
    isStreaming: false,
    inputTokens: 0,
    outputTokens: 0,
    turnCount: 0,
    toolCallCount: 0,
    currentTurnText: "",
    currentThinking: "",
    currentTools: [],
    isWaiting: false,
    currentError: null,
    isInterrupted: false,
    statusMessage: null,
    permissionMode: "normal",
    model: "",
    providerName: "",
    cost: 0,
    pendingApproval: null,
    ...partial,
  };
}
