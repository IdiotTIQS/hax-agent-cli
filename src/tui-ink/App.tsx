/**
 * App.tsx — ink TUI root component (Stage F5).
 *
 * Responsibilities:
 *  1. Owns the AppState via useReducer(reducer, createInitialState()).
 *  2. Drives the engine's async-generator event stream per submitted turn.
 *  3. Bridges the engine approvalCallback → React state via a Promise/dispatch
 *     pattern (RISK 1 — see approval bridge section below).
 *  4. Composes all F3 / F4 components into the full TUI layout.
 *  5. Wires global keybindings (F4 useGlobalKeybindings).
 *
 * ─── Approval Bridge (RISK 1) ─────────────────────────────────────────────
 *
 * The engine's approvalCallback is constructed BEFORE App renders (in
 * run.tsx).  It needs to dispatch set_approval into App's reducer.  Since
 * App owns the dispatch via useReducer internally, we expose it through an
 * optional `dispatchRef` prop:  App assigns dispatchRef.current = dispatch
 * during render (safe: this is a ref mutation, not a state mutation).
 *
 * run.tsx creates a makeApprovalCallback(dispatchRef) and passes the same
 * dispatchRef to App.  On first render App populates the ref; thereafter the
 * approval callback always targets the current dispatch.
 *
 * The wrappedResolve given to ApprovalPrompt:
 *   (answer) => {
 *     engineResolve(answer);          // unblock the engine generator
 *     dispatch(set_approval(null));   // unmount ApprovalPrompt
 *   }
 * ApprovalPrompt fires it via setImmediate (F4) — after ink's render cycle.
 *
 * ─── TextStream optimisation note ─────────────────────────────────────────
 *
 * For F5 we accept the simple full-text re-render on every message.delta.
 * In practice ink batches renders within a single event-loop tick, so
 * per-delta re-renders are fast for typical token rates.  No line-buffer
 * optimisation added; documented here for F6 if needed.
 */

import React, { useReducer, useState, useRef, useCallback } from "react";
import { Box, Text, Static } from "ink";

import { reducer } from "./reducer.js";
import { createInitialState } from "./types.js";
import type { AppState, PendingApproval } from "./types.js";

import {
  StatusBar,
  SpinnerLine,
  ThinkingBlock,
  TextStream,
  ToolList,
} from "./components/index.js";
import { UserInput } from "./components/UserInput.js";
import { ApprovalPrompt } from "./components/ApprovalPrompt.js";
import { ConversationTurn } from "./components/ConversationTurn.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { useGlobalKeybindings } from "./keybindings.js";
import { computeCompletions } from "./completions.js";

export { reducer };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal engine interface — matches AgentEngine without importing it directly. */
export interface EngineHandle {
  sendMessage(text: string): AsyncIterable<Record<string, unknown>>;
  interrupt(): void;
}

export type AppDispatch = React.Dispatch<Parameters<typeof reducer>[1]>;

export interface AppProps {
  engine: EngineHandle;
  /** Permission manager for mode cycling (pm.mode is mutated for readline compat). */
  pm: { mode: string };
  initialModel?: string;
  initialMode?: string;
  providerName?: string;
  /** Slash command names for completions (no leading /). */
  commandNames?: string[];
  /** Skill names for completions (no leading /). */
  skillNames?: string[];
  /**
   * Optional external ref that App will populate with its dispatch function.
   * Used by run.tsx to wire the approvalCallback (constructed before render)
   * into the reducer after first render.
   */
  dispatchRef?: React.MutableRefObject<AppDispatch | null>;
}

// (CommittedMessage removed in T5 — ConversationTurn renders full turn snapshots)

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App({
  engine,
  pm,
  initialModel = "",
  initialMode = "normal",
  providerName = "",
  commandNames = [],
  skillNames = [],
  dispatchRef,
}: AppProps): React.ReactElement {
  // ── Reducer ───────────────────────────────────────────────────────────────
  const [state, dispatch] = useReducer(
    reducer,
    createInitialState({
      model: initialModel,
      permissionMode: initialMode,
      providerName,
    }),
  );

  // Expose dispatch to the external dispatchRef (for approval bridge).
  // Safe: ref mutations during render don't cause re-renders.
  if (dispatchRef) {
    dispatchRef.current = dispatch;
  }

  // ── Controlled input value ────────────────────────────────────────────────
  const [inputValue, setInputValue] = useState("");

  // ── Turn-overlap guard ────────────────────────────────────────────────────
  const isStreamingRef = useRef(false);

  // ── Spinner start time ────────────────────────────────────────────────────
  const spinnerStartRef = useRef(Date.now());

  // ── Permission mode cycling ───────────────────────────────────────────────
  const modes = ["normal", "yolo", "plan", "full_auto"] as const;

  const handleCycleMode = useCallback(() => {
    const idx = modes.indexOf(state.permissionMode as typeof modes[number]);
    const next = modes[(idx + 1) % modes.length];
    pm.mode = next;
    dispatch({ type: "set_mode", mode: next });
  }, [state.permissionMode, pm]);

  // ── Submit handler ────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (isStreamingRef.current) return;

      setInputValue("");
      spinnerStartRef.current = Date.now();

      // Optimistic: push user message + start spinner immediately.
      dispatch({ type: "submit_input", text: trimmed });
      dispatch({ type: "turn_start" });

      isStreamingRef.current = true;

      try {
        for await (const event of engine.sendMessage(trimmed)) {
          // Cast via unknown to satisfy the discriminated union.
          // The engine yields objects matching AgentEvent shapes exactly.
          dispatch({
            type: "engine_event",
            event: event as unknown as Parameters<typeof reducer>[1] extends
              { type: "engine_event"; event: infer E } ? E : never,
          });
        }
      } catch (err) {
        dispatch({
          type: "engine_event",
          event: {
            type: "turn.failed",
            error: { message: (err as Error).message ?? "Unknown error" },
          },
        });
      } finally {
        isStreamingRef.current = false;
      }
    },
    [engine],
  );

  // ── Global keybindings ────────────────────────────────────────────────────
  // Disable when approval prompt OR command palette is open (both are modal).
  useGlobalKeybindings({
    onCycleMode: handleCycleMode,
    onClear: () => dispatch({ type: "clear" }),
    onInterrupt: () => {
      engine.interrupt();
      dispatch({ type: "interrupt" });
    },
    isActive: !state.pendingApproval && !state.commandPalette?.open,
  });

  // ── Completions ───────────────────────────────────────────────────────────
  const completions = computeCompletions(inputValue, commandNames, skillNames);

  // ── Command palette input handler ─────────────────────────────────────────
  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);
      if (value.startsWith("/")) {
        // Open or update the palette query as the user types.
        if (state.commandPalette?.open) {
          dispatch({ type: "update_palette", query: value });
        } else {
          dispatch({ type: "open_palette", query: value });
        }
      } else if (state.commandPalette?.open) {
        // User cleared the "/" prefix — close the palette.
        dispatch({ type: "close_palette" });
      }
    },
    [state.commandPalette],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column">
      {/* ── Section 1: Committed turns (Static prevents re-rendering old turns) ── */}
      <Static items={state.committedTurns}>
        {(turn, i) => (
          <ConversationTurn key={i} turn={turn} detail={state.detailMode} />
        )}
      </Static>

      {/* ── Section 2: Active turn chrome ─────────────────────────────────── */}
      <Box flexDirection="column">
        {state.currentThinking ? (
          <ThinkingBlock text={state.currentThinking} />
        ) : null}

        {state.currentTools.length > 0 ? (
          <ToolList tools={state.currentTools} detail={state.detailMode} />
        ) : null}

        {state.currentTurnText ? (
          <TextStream text={state.currentTurnText} />
        ) : null}

        {state.isWaiting ? (
          <SpinnerLine
            startTime={spinnerStartRef.current}
            tokenCount={state.inputTokens + state.outputTokens}
          />
        ) : null}
      </Box>

      {/* ── Overlay: tool approval prompt ─────────────────────────────────── */}
      {state.pendingApproval ? (
        <ApprovalPrompt approval={state.pendingApproval} />
      ) : null}

      {/* ── Error line ────────────────────────────────────────────────────── */}
      {state.currentError ? (
        <Box marginTop={1}>
          <Text color="red">{"Error: " + state.currentError}</Text>
        </Box>
      ) : null}

      {/* ── Transient status message ──────────────────────────────────────── */}
      {state.statusMessage ? (
        <Box>
          <Text dimColor>{state.statusMessage}</Text>
        </Box>
      ) : null}

      {/* ── Section 3: Bottom bar (input + status) ────────────────────────── */}
      <Box flexDirection="column">
        {/* Command palette: shown above input when open and no approval pending */}
        {state.commandPalette?.open && !state.pendingApproval ? (
          <CommandPalette
            query={state.commandPalette.query}
            commandNames={commandNames}
            skillNames={skillNames}
            onPick={(value) => {
              setInputValue(value + " ");
              dispatch({ type: "close_palette" });
            }}
            onClose={() => dispatch({ type: "close_palette" })}
          />
        ) : null}
        <UserInput
          value={inputValue}
          onChange={handleInputChange}
          onSubmit={handleSubmit}
          disabled={state.isStreaming || !!state.pendingApproval}
          completions={completions}
          promptLabel={state.isStreaming ? "… " : "> "}
        />
        <StatusBar
          model={state.model}
          mode={state.permissionMode}
          inputTokens={state.inputTokens}
          outputTokens={state.outputTokens}
          cost={state.cost}
          turnCount={state.turnCount}
        />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// makeApprovalCallback
// ---------------------------------------------------------------------------

/**
 * Build an approvalCallback for AgentEngine that bridges through App's reducer.
 *
 * Call this BEFORE render(<App dispatchRef={ref} />) and pass the callback to
 * AgentEngine.  App populates `ref.current = dispatch` on first render so the
 * callback always targets the live dispatch.
 *
 * @param dispatchRef - mutable ref that App will populate with its dispatch.
 * @returns approvalCallback matching AgentEngine's expected signature.
 */
export function makeApprovalCallback(
  dispatchRef: React.MutableRefObject<AppDispatch | null>,
): (toolName: string, toolInput: Record<string, unknown>) => Promise<"approve" | "always" | "deny"> {
  return (toolName: string, toolInput: Record<string, unknown>) =>
    new Promise<"approve" | "always" | "deny">((engineResolve) => {
      const wrappedResolve = (answer: "approve" | "always" | "deny") => {
        // Unblock the engine generator.
        engineResolve(answer);
        // Clear pendingApproval to unmount ApprovalPrompt.
        dispatchRef.current?.({ type: "set_approval", approval: null });
      };

      const approval: PendingApproval = { toolName, toolInput, resolve: wrappedResolve };
      dispatchRef.current?.({ type: "set_approval", approval });
    });
}

export default App;
