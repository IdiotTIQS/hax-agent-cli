import React from "react";
import { render } from "ink";
import { App } from "./App.js";

/**
 * Standalone ink preview harness (Stage E/F5 smoke).
 *
 * Run with: `npx tsx src/tui-ink/dev-preview.tsx`
 * Renders <App> with a no-op mock engine, proves the ink runtime works.
 * Not part of the CLI entry path.
 */

const mockEngine = {
  async *sendMessage(_text: string) {
    // No events — idle engine for smoke testing.
  },
  interrupt() {},
};

const { unmount, waitUntilExit } = render(
  <App
    engine={mockEngine}
    pm={{ mode: "normal" }}
    initialModel="mock-model"
    initialMode="normal"
    providerName="mock"
  />,
);
setTimeout(() => unmount(), 150);
await waitUntilExit();
