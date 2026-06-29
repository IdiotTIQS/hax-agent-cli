/**
 * ApprovalPrompt — tool-permission approval UI (RISK 1 component).
 *
 * Renders when the engine is awaiting a PendingApproval promise.  The user
 * presses y/Enter, n, or a to resolve it.
 *
 * ─── RISK 1: deferred resolve ───────────────────────────────────────────────
 *
 * WHY: calling `approval.resolve(answer)` synchronously inside a useInput
 * handler resumes the suspended engine async-generator DURING ink's current
 * input/render cycle.  Ink dispatches useInput handlers while it is still
 * inside its own React reconciliation loop; resuming the generator at that
 * moment causes the generator to dispatch new state (via external setters in
 * App) that triggers a React state update *during* an existing render — a
 * "setState during render" class bug that produces dropped events, double
 * renders, and cursor-lock hangs.
 *
 * FIX: wrap the resolve call in `setImmediate(...)`.  setImmediate fires in
 * the next iteration of the Node.js event loop, AFTER the current I/O and
 * microtask phases complete — i.e. after ink has finished processing this
 * keypress cycle.  The engine then resumes cleanly in a fresh event-loop turn.
 *
 * This is the single most important correctness constraint in the F4 batch.
 * Do NOT remove the setImmediate wrapper.  Alternative: `setTimeout(fn, 0)`
 * also works; `queueMicrotask` does NOT work because microtasks run within
 * the same event-loop iteration (before I/O callbacks), so it would still be
 * "during" ink's reconciliation.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * After the user answers, the parent (F5 App reducer via set_approval action)
 * clears `pendingApproval`, which unmounts this component.  ApprovalPrompt
 * itself does NOT manage clearing — it only fires the deferred resolve.
 */

import React, { useRef } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import type { PendingApproval } from "../types.js";

export interface ApprovalPromptProps {
  /** Non-null while a tool is awaiting approval. */
  approval: PendingApproval;
}

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

  // isRawModeSupported is false when stdin is not a TTY (CI/pipe/debug).
  // Guard useInput to avoid "Raw mode not supported" throws in non-TTY environments.
  const { isRawModeSupported } = useStdin();

  // One-shot guard: only the first valid answer key resolves the approval.
  // Without this, two fast keypresses (e.g. "y" then "a") before the parent
  // clears pendingApproval would each enqueue a setImmediate resolve and call
  // approval.resolve twice. A native Promise ignores the second settle, but we
  // guard explicitly so the resolve callback itself fires exactly once.
  const resolvedRef = useRef(false);

  useInput((input, key) => {
    let answer: "approve" | "always" | "deny" | null = null;

    if (key.return || input.toLowerCase() === "y") {
      answer = "approve";
    } else if (input.toLowerCase() === "n") {
      answer = "deny";
    } else if (input.toLowerCase() === "a") {
      answer = "always";
    }

    if (answer === null) return;
    if (resolvedRef.current) return;
    resolvedRef.current = true;

    const resolved = answer; // capture for closure

    // ── RISK 1 deferred resolve ──────────────────────────────────────────────
    // Wrap in setImmediate so the engine generator resumes in the NEXT
    // Node.js event-loop iteration, after ink has finished its current
    // input/render cycle.  See module-level comment for full rationale.
    // DO NOT call approval.resolve(resolved) synchronously here.
    setImmediate(() => approval.resolve(resolved));
    // ────────────────────────────────────────────────────────────────────────
  }, { isActive: isRawModeSupported });

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

      <Box marginTop={1} marginLeft={2} flexDirection="row" gap={1}>
        <Text color="green">[Y]</Text>
        <Text color="gray">approve</Text>
        <Text color="gray">·</Text>
        <Text color="red">[n]</Text>
        <Text color="gray">deny</Text>
        <Text color="gray">·</Text>
        <Text color="yellow">[a]</Text>
        <Text color="gray">always allow</Text>
      </Box>
    </Box>
  );
}

export default ApprovalPrompt;
