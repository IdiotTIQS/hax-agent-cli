import React from "react";
import { render } from "ink";
import { App } from "./App.js";

/**
 * Standalone ink preview harness (Stage E smoke).
 *
 * Run with: `npx tsx src/tui-ink/dev-preview.tsx`
 * Renders the minimal <App> and unmounts shortly after, proving the ink
 * runtime works end-to-end. Not part of the CLI entry path.
 */
const { unmount, waitUntilExit } = render(<App name="HaxAgent" />);
setTimeout(() => unmount(), 150);
await waitUntilExit();
