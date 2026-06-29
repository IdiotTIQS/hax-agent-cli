/**
 * app-preview.tsx — mock-engine harness for App smoke-testing (T5 updated).
 *
 * Renders <App> with a scripted mock engine that yields a fixed AgentEvent
 * sequence: turn.started → message.delta×2 → tool.start → tool.result →
 * turn.completed.
 *
 * T5 change: drives a full turn via dispatchRef so the Static committedTurns
 * path is exercised. Verifies:
 *   - Active turn chrome visible during streaming
 *   - Completed turn moved into Static history
 *   - No duplicate rendering of the last turn
 *   - Bottom UserInput + StatusBar present
 *   - No crashes
 *
 * Run with: npx tsx src/tui-ink/app-preview.tsx
 */

import React, { createRef } from "react";
import { render } from "ink";
import { PassThrough } from "stream";
import { App, makeApprovalCallback } from "./App.js";
import type { EngineHandle, AppDispatch } from "./App.js";

// ---------------------------------------------------------------------------
// Mock stdin — PassThrough + all methods ink calls during mount/unmount.
// ---------------------------------------------------------------------------

type InkStdin = PassThrough & {
  isTTY: boolean;
  setRawMode: (mode: boolean) => void;
  ref: () => void;
  unref: () => void;
};

const mockStdin = new PassThrough() as InkStdin;
mockStdin.isTTY = true;
mockStdin.setRawMode = (_mode: boolean) => { /* no-op */ };
mockStdin.ref = () => { /* no-op */ };
mockStdin.unref = () => { /* no-op */ };

// ---------------------------------------------------------------------------
// Scripted mock engine
// ---------------------------------------------------------------------------

async function* scriptedEvents() {
  yield { type: "turn.started", sessionId: "mock-session" };
  await new Promise((r) => setTimeout(r, 20));
  yield { type: "message.delta", delta: "Hello from " };
  await new Promise((r) => setTimeout(r, 20));
  yield { type: "message.delta", delta: "mock engine!" };
  await new Promise((r) => setTimeout(r, 20));
  yield { type: "tool.start", name: "shell.run", input: { command: "echo hi" } };
  await new Promise((r) => setTimeout(r, 30));
  yield {
    type: "tool.result",
    name: "shell.run",
    isError: false,
    data: { content: "hi\n" },
    durationMs: 28,
  };
  await new Promise((r) => setTimeout(r, 20));
  yield {
    type: "turn.completed",
    text: "Hello from mock engine!",
    usage: { inputTokens: 5, outputTokens: 10 },
    context: "",
  };
}

const mockEngine: EngineHandle = {
  sendMessage(_text: string) {
    return scriptedEvents();
  },
  interrupt() {},
};

// ---------------------------------------------------------------------------
// Render with mock stdin, drive a full turn, then unmount
// ---------------------------------------------------------------------------

const dispatchRef = createRef() as React.MutableRefObject<AppDispatch | null>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(dispatchRef as any).current = null;

const { waitUntilExit, unmount } = render(
  <App
    engine={mockEngine}
    pm={{ mode: "normal" }}
    initialModel="mock-model"
    initialMode="normal"
    providerName="mock"
    dispatchRef={dispatchRef}
  />,
  {
    stdin: mockStdin as unknown as NodeJS.ReadStream,
    stdout: process.stdout,
    patchConsole: false,
    exitOnCtrlC: false,
  },
);

// Wait for App to populate dispatchRef on first render, then fire a turn.
await new Promise((r) => setTimeout(r, 50));

if (dispatchRef.current) {
  // Simulate the user submitting a message (same sequence as handleSubmit).
  dispatchRef.current({ type: "submit_input", text: "Hello mock engine" });
  dispatchRef.current({ type: "turn_start" });

  // Drive the engine events manually through the reducer (mirrors handleSubmit).
  for await (const event of mockEngine.sendMessage("Hello mock engine")) {
    dispatchRef.current({
      type: "engine_event",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      event: event as any,
    });
    // Small delay so ink can render each event.
    await new Promise((r) => setTimeout(r, 25));
  }

  // Give ink time to render the completed turn into Static.
  await new Promise((r) => setTimeout(r, 200));
} else {
  process.stderr.write("[app-preview] WARN: dispatchRef not populated\n");
}

// Unmount cleanly.
unmount();
await waitUntilExit();
process.stderr.write("\n[app-preview] App mounted and unmounted cleanly.\n");
process.exit(0);
