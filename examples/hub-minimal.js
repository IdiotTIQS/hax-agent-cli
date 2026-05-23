/**
 * hub-minimal.js
 *
 * Minimal example: create an agent with only the core features.
 * Good for understanding the basics of the hub API.
 *
 * Run:  node examples/hub-minimal.js
 */

"use strict";

const { createAgent } = require("../src/hub");

// ─── Minimal settings ─────────────────────────────────────────────────

const settings = {
  agent: {
    name: "minimal-agent",
    model: "claude-sonnet-4-20250514",
    maxTurns: 5,
    temperature: 0.7,
  },
  memory: { enabled: true, maxItems: 10 },
  sessions: { transcriptLimit: 1000 },
  context: { enabled: true, windowTokens: 4000, reserveOutputTokens: 512, charsPerToken: 4 },
  fileContext: { enabled: true, maxFiles: 5, maxIndexFiles: 100, maxFileSize: 524288, maxBytesPerFile: 262144, maxTotalBytes: 1048576 },
  permissions: { mode: "normal" },
  tools: { shell: { enabled: true, timeoutMs: 10000, maxBuffer: 1048576 } },
  ui: { locale: "en" },
};

// ─── Create an agent with minimal options ─────────────────────────────

const {
  agent,
  toolRegistry,
  session,
  undoStack,
  pluginRegistry,
  rateLimiter,
  shutdown,
  compactionApi,
  cleanup,
} = createAgent({
  root: process.cwd(),
  settings,
  // Only enable the core subsystems:
  enablePlugins: false,
  enableUndo: true,
  enableRateLimit: false,
  enableRetry: false,
  enableShutdown: false,
  enableMemoryEviction: false,
  enableGoalPersistence: false,
  enableAutoCompact: false,
});

// ─── Quick inspection ─────────────────────────────────────────────────

console.log("=== Minimal Agent ===");
console.log(`Session ID   : ${session?.id || "n/a"}`);
console.log(`Tools        : ${toolRegistry ? toolRegistry.list().length : 0}`);
console.log(`Undo stack   : ${undoStack ? "enabled" : "disabled"}`);
console.log(`Plugins      : ${pluginRegistry ? "enabled" : "disabled"}`);
console.log(`Rate limiter : ${rateLimiter ? "enabled" : "disabled"}`);
console.log(`Shutdown     : ${shutdown ? "enabled" : "disabled"}`);
console.log(`Compaction   : ${compactionApi ? "enabled" : "disabled"}`);

// ─── Cleanup ──────────────────────────────────────────────────────────

const errors = cleanup();
if (errors.length > 0) {
  console.log(`Cleanup issues: ${errors.join(", ")}`);
} else {
  console.log("Cleanup complete.");
}
