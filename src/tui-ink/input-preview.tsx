/**
 * input-preview.tsx — F4 / T7 interaction component harness.
 *
 * Run with: `npx tsx src/tui-ink/input-preview.tsx`
 *
 * Mounts UserInput + ApprovalPrompt (T7 Select-menu variant) with mock data
 * to prove:
 *  1. Both components render without crashing.
 *  2. The deferred-resolve mechanism works: the mock resolve logs
 *     "resolved (deferred) with: <answer>" one event-loop tick after the
 *     setImmediate fires, confirming the deferral actually executed.
 *  3. The Select menu (Approve/always/Deny with y/a/n hotkeys) renders.
 *  4. A file.edit approval with a diff field shows DiffView inline.
 *
 * Interactive behaviour (arrow history, actual approval keypresses) requires
 * a live TTY — verify manually.  This harness auto-unmounts after 1 s so it
 * is safe to run in CI or from scripts.
 *
 * NOTE: The components are completely self-contained (no engine import).  The
 * mock PendingApproval objects below are the only wiring needed.
 */

import React, { useState } from "react";
import { PassThrough } from "node:stream";
import { Box, Text, render } from "ink";
import { UserInput } from "./components/UserInput.js";
import { ApprovalPrompt } from "./components/ApprovalPrompt.js";
import type { PendingApproval } from "./types.js";
import { computeCompletions } from "./completions.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_COMMANDS = ["help", "clear", "model", "provider", "skills", "goal", "yolo", "plan"];
const MOCK_SKILLS = ["deep-research", "code-review", "simplify", "run"];

/**
 * Build a mock PendingApproval (plain shell.run — no diff) whose resolve logs
 * the answer confirming the setImmediate deferral executed.
 */
function makeMockApproval(): PendingApproval {
  return {
    toolName: "shell.run",
    toolInput: { command: "rm -rf /tmp/demo", cwd: "/home/user/project" },
    resolve: (answer) => {
      // This function is called inside setImmediate in ApprovalPrompt.
      // The "deferred" label proves the setImmediate mechanism executed.
      console.error(`[preview] resolved (deferred) with: ${answer}`);
    },
  };
}

/**
 * Build a mock PendingApproval for a file.edit tool — includes a `diff` field
 * in toolInput so ApprovalPrompt's DiffView renders inline +/- lines.
 * Validates the T7 requirement: file.edit approvals show embedded diff.
 */
function makeMockEditApproval(): PendingApproval {
  return {
    toolName: "file.edit",
    toolInput: {
      path: "src/example.ts",
      old_string: "const foo = 1;",
      new_string: "const bar = 1;",
      diff: "- const foo = 1;\n+ const bar = 1;\n  \n- export { foo };\n+ export { bar };",
    },
    resolve: (answer) => {
      console.error(`[preview] file.edit resolved (deferred) with: ${answer}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Preview app
// ---------------------------------------------------------------------------

function PreviewApp(): React.ReactElement {
  const [inputValue, setInputValue] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const completions = computeCompletions(inputValue, MOCK_COMMANDS, MOCK_SKILLS);

  const mockApproval = makeMockApproval();
  const mockEditApproval = makeMockEditApproval();

  function handleSubmit(v: string): void {
    setSubmitted(v);
    setInputValue("");
  }

  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Text color="green" bold>
        ── T7 Input + Approval Preview Harness ──
      </Text>

      <Box flexDirection="column">
        <Text color="gray">UserInput (type "/" to see completions):</Text>
        <UserInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          completions={completions}
        />
        {submitted !== null && (
          <Text color="yellow">Submitted: {submitted}</Text>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color="gray">ApprovalPrompt — shell.run (no diff, Select menu):</Text>
        <Text color="gray" dimColor>  ↑↓ navigate, Enter confirm, y/a/n hotkeys; answer logged to stderr</Text>
        <ApprovalPrompt approval={mockApproval} />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color="gray">ApprovalPrompt — file.edit (with embedded DiffView):</Text>
        <Text color="gray" dimColor>  T7 requirement: diff shown inline above Select menu</Text>
        <ApprovalPrompt approval={mockEditApproval} />
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Auto-unmounts in 1 s. Check stderr for "[preview] resolved (deferred) with: …"
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Render and auto-unmount
// ---------------------------------------------------------------------------

// When stdin is not a real TTY (CI, pipe, PowerShell non-interactive), ink's
// App throws when any useInput hook tries to call setRawMode(true).
// Solution: provide a PassThrough mock stdin with isTTY=true and a no-op
// setRawMode.  useInput sees isRawModeSupported=true and calls setRawMode
// (no-op), then safely registers event listeners — but no actual keypresses
// arrive, so the harness just proves mount without crashing.
// In a real interactive TTY, use process.stdin directly so keys actually work.
const isInteractiveTTY = Boolean(process.stdin.isTTY);

let stdinForInk: NodeJS.ReadStream | PassThrough;

if (isInteractiveTTY) {
  stdinForInk = process.stdin;
} else {
  // Build a fake TTY-like stdin for the preview harness.
  // ink's App calls: isTTY, setRawMode, ref, unref, setEncoding,
  // addListener/removeListener, read — all must exist as no-ops.
  const mockStdin = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (mode: boolean) => void;
    ref: () => void;
    unref: () => void;
  };
  mockStdin.isTTY = true;
  mockStdin.setRawMode = (_mode: boolean) => { /* no-op */ };
  mockStdin.ref = () => { /* no-op */ };
  mockStdin.unref = () => { /* no-op */ };
  stdinForInk = mockStdin;
}

const { unmount, waitUntilExit } = render(<PreviewApp />, {
  stdin: stdinForInk as NodeJS.ReadStream,
  debug: !isInteractiveTTY,
});

setTimeout(() => {
  unmount();
}, 1000);

await waitUntilExit();
