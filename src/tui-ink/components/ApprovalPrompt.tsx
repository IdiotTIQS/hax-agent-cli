/**
 * ApprovalPrompt — tool-permission approval UI (RISK 1 component).
 *
 * Renders when the engine is awaiting a PendingApproval promise.  The user
 * navigates a Select menu (↑↓ / Enter) or presses a hotkey (y/a/n) to resolve.
 *
 * ─── RISK 1: deferred resolve ───────────────────────────────────────────────
 *
 * WHY: calling `approval.resolve(answer)` synchronously inside a Select
 * onSelect handler resumes the suspended engine async-generator DURING ink's
 * current input/render cycle.  Ink dispatches useInput handlers while it is
 * still inside its own React reconciliation loop; resuming the generator at
 * that moment causes the generator to dispatch new state (via external setters
 * in App) that triggers a React state update *during* an existing render — a
 * "setState during render" class bug that produces dropped events, double
 * renders, and cursor-lock hangs.
 *
 * FIX: wrap the resolve call in `setImmediate(...)`.  setImmediate fires in
 * the next iteration of the Node.js event loop, AFTER the current I/O and
 * microtask phases complete — i.e. after ink has finished processing this
 * keypress cycle.  The engine then resumes cleanly in a fresh event-loop turn.
 *
 * This is the single most important correctness constraint in the F4/T7 batch.
 * Do NOT remove the setImmediate wrapper.  Alternative: `setTimeout(fn, 0)`
 * also works; `queueMicrotask` does NOT work because microtasks run within
 * the same event-loop iteration (before I/O callbacks), so it would still be
 * "during" ink's reconciliation.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * After the user answers, the parent (F5 App reducer via set_approval action)
 * clears `pendingApproval`, which unmounts this component.  ApprovalPrompt
 * itself does NOT manage clearing — it only fires the deferred resolve.
 *
 * ─── resolvedRef guard ──────────────────────────────────────────────────────
 *
 * The one-shot `resolvedRef` prevents double-resolution: if the user presses
 * a hotkey then Enter before ink re-renders (or the menu onSelect fires twice
 * due to rapid input), only the first call to onSelect proceeds.  A native
 * Promise ignores the second settle, but we guard explicitly so the resolve
 * callback itself fires exactly once.
 * ────────────────────────────────────────────────────────────────────────────
 */

import React, { useRef } from "react";
import { Box, Text } from "ink";
import type { PendingApproval, ToolCallState } from "../types.js";
import { Select, type SelectItem } from "../ui/index.js";
import { DiffView } from "./DiffView.js";

export interface ApprovalPromptProps {
  /** Non-null while a tool is awaiting approval. */
  approval: PendingApproval;
}

/** Menu items for the approval Select — y/a/n hotkeys. */
const ITEMS: SelectItem[] = [
  { label: "Approve", value: "approve", hotkey: "y" },
  { label: "Approve & always allow this tool", value: "always", hotkey: "a" },
  { label: "Deny", value: "deny", hotkey: "n" },
];

/** Summarise the tool input for display — first 80 chars of JSON. */
function summariseInput(input: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(input);
    return json.length > 80 ? json.slice(0, 77) + "…" : json;
  } catch {
    return "";
  }
}

export function ApprovalPrompt({
  approval,
}: ApprovalPromptProps): React.ReactElement {
  const detail = summariseInput(approval.toolInput);

  // One-shot guard: only the first valid answer resolves the approval.
  // Without this, two fast keypresses (e.g. hotkey then Enter) before the
  // parent clears pendingApproval would each enqueue a setImmediate resolve
  // and call approval.resolve twice. A native Promise ignores the second
  // settle, but we guard explicitly so the resolve callback fires exactly once.
  const resolvedRef = useRef(false);

  // Build a synthetic ToolCallState so DiffView can render a pending edit's
  // diff. For non-diff tools this returns null (DiffView is a no-op).
  const asTool: ToolCallState = {
    name: approval.toolName,
    input: approval.toolInput,
    status: "running",
    data: approval.toolInput,
  };

  const onSelect = (value: string): void => {
    // One-shot guard — prevent double-resolve on rapid input.
    if (resolvedRef.current) return;
    // Only proceed for valid answer values.
    if (value !== "approve" && value !== "always" && value !== "deny") return;
    resolvedRef.current = true;

    const answer = value as "approve" | "always" | "deny";

    // ── RISK 1 deferred resolve ──────────────────────────────────────────────
    // Wrap in setImmediate so the engine generator resumes in the NEXT
    // Node.js event-loop iteration, after ink has finished its current
    // input/render cycle.  See module-level comment for full rationale.
    // DO NOT call approval.resolve(answer) synchronously here.
    setImmediate(() => approval.resolve(answer));
    // ────────────────────────────────────────────────────────────────────────
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
    >
      <Box flexDirection="row" gap={1}>
        <Text color="yellow" bold>
          ?
        </Text>
        <Text color="white" bold>
          Approve tool:
        </Text>
        <Text color="cyan" bold>
          {approval.toolName}
        </Text>
      </Box>

      {detail.length > 0 && (
        <Box marginLeft={2}>
          <Text color="gray" dimColor>
            {detail}
          </Text>
        </Box>
      )}

      {/* DiffView: shows +/- diff for file.edit tools; null for others */}
      <DiffView tool={asTool} />

      <Box marginTop={1} marginLeft={1}>
        <Select items={ITEMS} onSelect={onSelect} isFocused />
      </Box>
    </Box>
  );
}

export default ApprovalPrompt;
