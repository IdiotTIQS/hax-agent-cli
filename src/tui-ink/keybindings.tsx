/**
 * keybindings.tsx — global keyboard shortcut hook for the ink TUI.
 *
 * Exports a single hook: `useGlobalKeybindings(opts)`.
 *
 * ─── useInput precedence / multi-consumer model ──────────────────────────────
 *
 * Ink allows multiple concurrent useInput consumers; each receives every
 * keypress — there is no "capture" or "stop propagation".  This means:
 *
 *  1. UserInput's TextInput (via ink-text-input) handles: printable chars,
 *     Left/Right cursor, Backspace/Delete, Enter (submit), Ctrl+A/E/U/K (line
 *     editing).
 *  2. UserInput's own useInput handles: ArrowUp/ArrowDown (history), active
 *     only while `isActive: !disabled`.
 *  3. ApprovalPrompt's useInput handles: y/n/a/Enter for approval answers,
 *     active only while ApprovalPrompt is mounted.
 *  4. THIS hook handles: Shift+Tab, Ctrl+L, Ctrl+C — global hotkeys.
 *
 * Conflict-avoidance strategy (enforced by the F5 App):
 *  - This hook is mounted unconditionally by App but its `isActive` option
 *    should be set to `!isApprovalVisible` — when ApprovalPrompt is shown,
 *    global hotkeys are suspended so Ctrl+C doesn't interrupt a pending tool.
 *  - UserInput passes `focus={false}` / isActive=false when `disabled`, so
 *    TextInput goes silent during streaming.
 *  - ApprovalPrompt is only mounted when pendingApproval != null; when
 *    unmounted its useInput is removed, restoring normal key routing.
 *
 * F5 is responsible for conditional mounting / isActive gating.  This hook
 * just defines the bindings and accepts opts.isActive to forward to useInput.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useInput, useStdin } from "ink";

export interface GlobalKeybindingOpts {
  /** Shift+Tab → cycle permission mode (normal → yolo → plan → fullauto). */
  onCycleMode: () => void;
  /** Ctrl+L → clear the message history (like /clear). */
  onClear: () => void;
  /**
   * Ctrl+C → interrupt the current stream or (if idle) exit.
   * F5 decides the interrupt-vs-exit / double-Ctrl-C logic.
   */
  onInterrupt: () => void;
  /** When true the hook is active; when false all bindings are suspended. */
  isActive?: boolean;
}

/**
 * Register global keyboard shortcuts for the ink TUI.
 *
 * Mount this hook once in the top-level App component (F5).
 * Pass `isActive={!pendingApproval}` to suspend while approval is pending.
 *
 * @example
 *   useGlobalKeybindings({
 *     onCycleMode: () => dispatch({ type: "set_mode", mode: nextMode }),
 *     onClear: () => dispatch({ type: "clear" }),
 *     onInterrupt: () => dispatch({ type: "interrupt" }),
 *     isActive: !state.pendingApproval,
 *   });
 */
export function useGlobalKeybindings({
  onCycleMode,
  onClear,
  onInterrupt,
  isActive = true,
}: GlobalKeybindingOpts): void {
  // isRawModeSupported is false when stdin is not a TTY (CI/pipe/debug).
  // Guard useInput to avoid "Raw mode not supported" throws.
  const { isRawModeSupported } = useStdin();

  useInput(
    (_input, key) => {
      // Shift+Tab — cycle permission mode.
      // ink reports Shift+Tab as key.shift === true AND key.tab === true.
      if (key.shift && key.tab) {
        onCycleMode();
        return;
      }

      // Ctrl+L — clear screen / history.
      // ink reports Ctrl+letter combos via key.ctrl + the letter in _input.
      if (key.ctrl && _input === "l") {
        onClear();
        return;
      }

      // Ctrl+C — interrupt or exit.
      // ink reports this as key.ctrl + _input === "c".
      if (key.ctrl && _input === "c") {
        onInterrupt();
        return;
      }
    },
    { isActive: isActive && isRawModeSupported },
  );
}
