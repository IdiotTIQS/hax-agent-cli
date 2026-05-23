/**
 * hub-usage.js
 *
 * Complete, well-commented example showing how to use the integration hub.
 *
 * Demonstrates:
 *   - Creating a fully-configured agent with all features enabled
 *   - Running a simple task via the AgentEngine
 *   - Proper cleanup
 *
 * Run:  node examples/hub-usage.js
 */

"use strict";

const path = require("node:path");
const { createAgent } = require("../src/hub");

// ─── 1. Define settings ───────────────────────────────────────────────
//
// These are the merged Hax Agent settings. In a real application these
// would come from config files, environment variables, and factory defaults.

const settings = {
  agent: {
    name: "hub-demo-agent",
    model: process.env.HAX_MODEL || "claude-sonnet-4-20250514",
    maxTurns: 20,
    temperature: 0.7,
  },
  memory: {
    enabled: true,
    maxItems: 50,
  },
  sessions: {
    transcriptLimit: 5000,
  },
  context: {
    enabled: true,
    windowTokens: 8000,
    reserveOutputTokens: 1024,
    charsPerToken: 4,
  },
  fileContext: {
    enabled: true,
    maxFiles: 10,
    maxIndexFiles: 500,
    maxFileSize: 1_048_576,
    maxBytesPerFile: 512_000,
    maxTotalBytes: 5_242_880,
  },
  permissions: {
    mode: "normal", // "normal" or "yolo"
  },
  tools: {
    shell: {
      enabled: true,
      timeoutMs: 30_000,
      maxBuffer: 10_485_760,
    },
  },
  ui: {
    locale: "en",
  },
};

// ─── 2. Create a provider ─────────────────────────────────────────────
//
// In production this would be a real LLM provider (e.g., Anthropic,
// OpenAI, or a local model). Here we construct one manually so the
// example runs without network calls.
//
// The hub itself is provider-agnostic — it wires whichever provider
// you pass through to the session and agent engine.

let provider = null;
try {
  const { resolveProvider } = require("../src/providers");
  provider = resolveProvider(settings);
} catch (_) {
  // If no provider module is available, the hub still works.
  // The agent will be created but cannot process LLM requests.
  console.log("[hub-usage] No LLM provider configured — running in demo mode.");
  provider = {
    name: "demo",
    model: "claude-sonnet-4-20250514",
  };
}

// ─── 3. Create a fully-configured agent via the hub ───────────────────

const projectRoot = process.cwd();

console.log("=== Creating agent with all features enabled ===");
console.log(`  Project root : ${projectRoot}`);
console.log(`  Provider     : ${provider.name}`);
console.log(`  Model        : ${provider.model}`);
console.log("");

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
  root: projectRoot,
  settings,
  provider,

  // Toggle individual subsystems:
  enablePlugins: true,        // Load plugins from ~/.haxagent/plugins, .hax-agent/plugins
  enableUndo: true,           // Track file edits for undo/redo
  enableRateLimit: true,      // Token-bucket rate limiting
  enableRetry: true,          // Auto-retry transient tool errors
  enableShutdown: true,       // Graceful shutdown on SIGINT/SIGTERM
  enableMemoryEviction: true, // Evict old memories when over limit
  enableGoalPersistence: true,// Save/restore goals across sessions
  enableAutoCompact: true,    // Context window compaction

  // Fine-tune subsystems:
  rateLimitOptions: {
    maxTokens: 60,
    refillRate: 2,
  },
  shutdownOptions: {
    timeoutMs: 10_000,
  },
});

// ─── 4. Inspect the assembled subsystems ──────────────────────────────

console.log("=== Subsystem status ===");
console.log(`  Agent engine     : ${agent ? "ready" : "not created"}`);
console.log(`  Session ID       : ${session?.id || "n/a"}`);
console.log(`  Tool registry    : ${toolRegistry ? `${toolRegistry.list().length} tools` : "not created"}`);
console.log(`  Plugin registry  : ${pluginRegistry ? `${pluginRegistry.list().length} plugins` : "not created"}`);
console.log(`  Undo stack       : ${undoStack ? (undoStack.canUndo() ? "has items" : "empty") : "disabled"}`);
console.log(`  Rate limiter     : ${rateLimiter ? "enabled" : "disabled"}`);
console.log(`  Shutdown manager : ${shutdown ? "enabled" : "disabled"}`);
console.log(`  Compaction api   : ${compactionApi ? "enabled" : "disabled"}`);
console.log("");

// ─── 5. Run a simple task ─────────────────────────────────────────────
//
// If the provider is a real LLM, the agent engine will process the
// message. With a demo/missing provider, the engine still exists but
// cannot generate responses.

async function main() {
  try {
    if (agent && provider.apiKey) {
      console.log("=== Running a task ===");
      console.log('  Prompt: "List the files in the current directory"');
      console.log("");

      let assistantText = "";
      for await (const event of agent.sendMessage(
        "List the files in the current directory"
      )) {
        if (event.type === "message.delta") {
          assistantText += event.delta;
          process.stdout.write(event.delta);
        } else if (event.type === "completed") {
          console.log("");
          console.log(`  [Task completed, ${assistantText.length} chars]`);
        } else if (event.type === "tool_call") {
          console.log(`\n  [Tool call: ${event.toolName}]`);
        } else if (event.type === "tool_result") {
          console.log(`  [Tool result: ${event.durationMs}ms]`);
        } else if (event.type === "failed") {
          console.error(`  [Error: ${event.error?.message}]`);
        }
      }
    } else {
      console.log(
        "[hub-usage] Skipping task — no API key configured. The agent is ready to use."
      );
      console.log(
        "  Set HAX_API_KEY to run with a real provider."
      );
    }
  } finally {
    // ── 6. Cleanup ──────────────────────────────────────────────────
    //
    // Always call cleanup() when done. It:
    //   - Fires onSessionEnd plugin hooks
    //   - Persists the current goal to disk
    //   - Drains the rate limiter queue
    //   - Clears the undo stack
    //   - Detaches signal handlers
    console.log("");
    console.log("=== Cleaning up ===");
    const cleanupErrors = cleanup();

    if (cleanupErrors.length === 0) {
      console.log("  All subsystems shut down cleanly.");
    } else {
      console.log(`  ${cleanupErrors.length} issues during cleanup:`);
      for (const err of cleanupErrors) {
        console.log(`    - ${err}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
