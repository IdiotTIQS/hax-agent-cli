/**
 * app-preview.tsx — mock-engine harness for App smoke-testing (Stage F5).
 *
 * Renders <App> with a scripted mock engine that yields a fixed AgentEvent
 * sequence: turn.started → message.delta×2 → tool.start → tool.result →
 * turn.completed.
 *
 * Run with: npx tsx src/tui-ink/app-preview.tsx
 *
 * Verifies App mounts and unmounts without crashing outside a real TTY.
 *
 * ink's useInput requires a stdin that supports raw mode.  We use a
 * PassThrough stream with all the methods ink calls during mount:
 * isTTY, setRawMode, setEncoding, ref, unref, resume, pause.
 */

import React from "react";
import { render } from "ink";
import { PassThrough } from "stream";
import { App } from "./App.js";
import type { EngineHandle } from "./App.js";

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
// Render with mock stdin and auto-unmount
// ---------------------------------------------------------------------------

const { waitUntilExit, unmount } = render(
  <App
    engine={mockEngine}
    pm={{ mode: "normal" }}
    initialModel="mock-model"
    initialMode="normal"
    providerName="mock"
  />,
  {
    stdin: mockStdin as unknown as NodeJS.ReadStream,
    stdout: process.stdout,
    patchConsole: false,
    exitOnCtrlC: false,
  },
);

// Unmount after proving the component tree renders without errors.
setTimeout(() => {
  unmount();
}, 400);

await waitUntilExit();
process.stderr.write("\n[app-preview] App mounted and unmounted cleanly.\n");
process.exit(0);
