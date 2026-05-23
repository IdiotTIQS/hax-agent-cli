"use strict";

/**
 * SmokeTest — quick smoke tests for critical agent paths.
 *
 * Provides three test levels:
 *   - runQuick()    — fast critical-path test (< 1 second target)
 *   - runStandard() — standard smoke test suite
 *   - runFull()     — comprehensive smoke test
 *
 * Each level exercises a progressively larger set of checks:
 *   config load, tool registry init, session creation, file operations, memory CRUD.
 *
 * Result shape: { passed, failed, skipped, durationMs, criticalBlocked, results }
 * criticalBlocked is true when one or more tests tagged "critical" fail.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUICK_TESTS = Object.freeze([
  "config:load",
  "registry:init",
  "memory:write",
]);

const STANDARD_TESTS = Object.freeze([
  "config:load",
  "config:validate",
  "registry:init",
  "registry:register-tool",
  "session:create",
  "session:add-message",
  "memory:write",
  "memory:read",
  "memory:list",
  "memory:delete",
  "files:write",
  "files:read",
  "files:delete",
]);

const FULL_TESTS = Object.freeze([
  "config:load",
  "config:validate",
  "registry:init",
  "registry:register-tool",
  "registry:execute-tool",
  "registry:has-get",
  "session:create",
  "session:add-message",
  "session:get-transcript",
  "session:snapshot",
  "memory:write",
  "memory:read",
  "memory:list",
  "memory:search",
  "memory:delete",
  "files:write",
  "files:read",
  "files:delete",
  "plugins:register",
  "plugins:run-hook",
]);

const CRITICAL_TESTS = new Set([
  "config:load",
  "registry:init",
  "session:create",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowISO() {
  return new Date().toISOString();
}

/**
 * Build a result entry.
 */
function result(name, status, message, durationMs = 0, details = null) {
  return { name, status, message, durationMs, details, critical: CRITICAL_TESTS.has(name) };
}

/**
 * Time an async operation.
 */
async function timed(fn) {
  const start = process.hrtime.bigint();
  let value;
  let threw = false;
  try {
    value = await fn();
  } catch (e) {
    threw = true;
    value = e;
  }
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  return { elapsedMs: Math.round(elapsed * 100) / 100, value, threw };
}

// ---------------------------------------------------------------------------
// Test implementations
// ---------------------------------------------------------------------------

/**
 * All test implementations as a name→fn map.
 * Each fn receives a `ctx` object carrying dependencies.
 */
const TEST_IMPLS = {

  // ── Config ──────────────────────────────────────────────────
  "config:load"(ctx) {
    if (!ctx.settings || typeof ctx.settings !== "object") {
      throw new Error("Settings not provided or not an object");
    }
    return { agentName: ctx.settings.agent?.name || "(none)" };
  },

  "config:validate"(ctx) {
    const settings = ctx.settings;
    if (!settings.agent) throw new Error("settings.agent is missing");
    if (typeof settings.agent.model !== "string" || !settings.agent.model.trim()) {
      throw new Error("settings.agent.model is required");
    }
    if (!Number.isFinite(settings.agent.maxTurns) || settings.agent.maxTurns < 1) {
      throw new Error("settings.agent.maxTurns must be >= 1");
    }
    return { model: settings.agent.model, maxTurns: settings.agent.maxTurns };
  },

  // ── Tool Registry ───────────────────────────────────────────
  "registry:init"(ctx) {
    if (!ctx.toolRegistry || typeof ctx.toolRegistry !== "object") {
      throw new Error("Tool registry not provided or not an object");
    }
    return { type: typeof ctx.toolRegistry };
  },

  async "registry:register-tool"(ctx) {
    const reg = ctx.toolRegistry;
    if (typeof reg.register !== "function") {
      throw new Error("toolRegistry.register is not a function");
    }
    const toolName = `__smoke_tool_${Date.now()}__`;
    let executeCalled = false;

    reg.register({
      name: toolName,
      description: "Smoke test tool",
      execute: async () => { executeCalled = true; return { ok: true, smoke: true }; },
    });

    const found = typeof reg.has === "function" ? reg.has(toolName) : true;
    if (!found) throw new Error("Registered tool not found in registry");

    return { registered: true, name: toolName };
  },

  async "registry:execute-tool"(ctx) {
    const reg = ctx.toolRegistry;
    if (typeof reg.execute !== "function") {
      throw new Error("toolRegistry.execute is not a function");
    }
    const toolName = `__smoke_exec_${Date.now()}__`;
    reg.register({
      name: toolName,
      description: "Smoke exec test",
      execute: async (args) => ({ ok: true, args }),
    });
    const out = await reg.execute(toolName, { test: true });
    if (!out || out.ok !== true) throw new Error("Tool execution did not return ok=true");
    return { executed: true, name: toolName };
  },

  "registry:has-get"(ctx) {
    const reg = ctx.toolRegistry;
    if (typeof reg.has !== "function") throw new Error("toolRegistry.has is not a function");
    if (typeof reg.get !== "function") throw new Error("toolRegistry.get is not a function");

    const has = reg.has("nonexistent-smoke-tool");
    if (has) throw new Error("has() returned true for nonexistent tool");

    const got = reg.get("nonexistent-smoke-tool");
    if (got !== null && got !== undefined) throw new Error("get() returned value for nonexistent tool");

    return { hasWorks: true, getWorks: true };
  },

  // ── Session ─────────────────────────────────────────────────
  async "session:create"(ctx) {
    if (typeof ctx.createSession !== "function") {
      throw new Error("createSession not provided");
    }
    const session = ctx.createSession();
    if (!session || typeof session.id !== "string") {
      throw new Error("createSession() returned invalid session (missing id)");
    }
    return { sessionId: session.id };
  },

  async "session:add-message"(ctx) {
    if (typeof ctx.createSession !== "function") {
      throw new Error("createSession not provided");
    }
    const session = ctx.createSession();
    if (typeof session.addMessage !== "function") {
      throw new Error("session.addMessage is not a function");
    }
    session.addMessage({ role: "user", content: "Hello, smoke test!" });
    if (session.messages.length < 1) {
      throw new Error("Message not added to session");
    }
    return { messageCount: session.messages.length };
  },

  async "session:get-transcript"(ctx) {
    const session = ctx.createSession();
    session.addMessage({ role: "user", content: "Q" });
    session.addMessage({ role: "assistant", content: "A" });
    if (typeof session.getTranscript !== "function") {
      throw new Error("session.getTranscript is not a function");
    }
    const transcript = session.getTranscript();
    if (!transcript.includes("Q") || !transcript.includes("A")) {
      throw new Error("Transcript does not contain expected content");
    }
    return { transcriptLength: transcript.length };
  },

  async "session:snapshot"(ctx) {
    const session = ctx.createSession();
    if (typeof session.snapshot !== "function") {
      throw new Error("session.snapshot is not a function");
    }
    const snap = session.snapshot();
    if (!snap || typeof snap.id !== "string") {
      throw new Error("Snapshot missing id");
    }
    return { snapshotId: snap.id };
  },

  // ── Memory ──────────────────────────────────────────────────
  "memory:write"(ctx) {
    if (typeof ctx.writeMemory !== "function") {
      throw new Error("writeMemory not provided");
    }
    const key = `__smoke_mem_${Date.now()}__`;
    ctx.writeMemory(key, "smoke-test-value");
    // Store key in ctx so later steps can read/delete it
    ctx.__memKey = key;
    return { key, written: true };
  },

  "memory:read"(ctx) {
    if (typeof ctx.readMemory !== "function") {
      throw new Error("readMemory not provided");
    }
    if (!ctx.__memKey) {
      // Run write first if not done
      this["memory:write"](ctx);
    }
    const entry = ctx.readMemory(ctx.__memKey);
    if (!entry) throw new Error(`Memory key "${ctx.__memKey}" not found`);
    return { found: true, name: entry.name };
  },

  "memory:list"(ctx) {
    if (typeof ctx.listMemories !== "function") {
      throw new Error("listMemories not provided");
    }
    const list = ctx.listMemories();
    if (!Array.isArray(list)) throw new Error("listMemories did not return an array");
    return { count: list.length };
  },

  "memory:search"(ctx) {
    if (typeof ctx.searchMemories !== "function") {
      throw new Error("searchMemories not provided");
    }
    const results = ctx.searchMemories("smoke-test");
    if (!Array.isArray(results)) throw new Error("searchMemories did not return an array");
    return { resultCount: results.length };
  },

  "memory:delete"(ctx) {
    if (typeof ctx.deleteMemory !== "function") {
      throw new Error("deleteMemory not provided");
    }
    if (!ctx.__memKey) {
      this["memory:write"](ctx);
    }
    ctx.deleteMemory(ctx.__memKey);
    const after = ctx.readMemory ? ctx.readMemory(ctx.__memKey) : null;
    if (after) throw new Error("Memory entry still exists after delete");
    delete ctx.__memKey;
    return { deleted: true };
  },

  // ── File Operations ─────────────────────────────────────────
  async "files:write"(ctx) {
    const fs = ctx.fs;
    if (!fs || typeof fs.writeFile !== "function") {
      throw new Error("fs.writeFile not provided");
    }
    const content = `smoke-test-content-${Date.now()}`;
    ctx.__filePath = ctx.__filePath || `${ctx.tmpDir}/smoke-test-file.txt`;
    await fs.writeFile(ctx.__filePath, content, "utf8");
    ctx.__fileContent = content;
    return { path: ctx.__filePath, written: true };
  },

  async "files:read"(ctx) {
    const fs = ctx.fs;
    if (!ctx.__filePath) {
      await this["files:write"](ctx);
    }
    const data = await fs.readFile(ctx.__filePath, "utf8");
    if (!data || !data.includes("smoke-test-content")) {
      throw new Error("File content does not match expected value");
    }
    return { bytes: data.length };
  },

  async "files:delete"(ctx) {
    const fs = ctx.fs;
    if (!ctx.__filePath) {
      await this["files:write"](ctx);
    }
    await fs.unlink(ctx.__filePath);
    // Verify deleted
    let stillExists = false;
    try {
      await fs.access(ctx.__filePath);
      stillExists = true;
    } catch (_) { /* expected — file is gone */ }
    if (stillExists) throw new Error("File still exists after unlink");
    delete ctx.__filePath;
    return { deleted: true };
  },

  // ── Plugins ─────────────────────────────────────────────────
  "plugins:register"(ctx) {
    if (!ctx.pluginRegistry || typeof ctx.pluginRegistry.register !== "function") {
      throw new Error("pluginRegistry.register not provided");
    }
    const name = `__smoke_plugin_${Date.now()}__`;
    // Cleanup possible leftover
    try { ctx.pluginRegistry.unregister && ctx.pluginRegistry.unregister(name); } catch (_) {}
    ctx.pluginRegistry.register({ name, hooks: {} });
    const list = ctx.pluginRegistry.list();
    const found = list.some((p) => p.name === name);
    if (!found) throw new Error("Plugin not found after register");
    if (ctx.pluginRegistry.unregister) ctx.pluginRegistry.unregister(name);
    return { registered: true };
  },

  async "plugins:run-hook"(ctx) {
    const reg = ctx.pluginRegistry;
    if (!reg || typeof reg.runHook !== "function" || typeof reg.register !== "function") {
      throw new Error("pluginRegistry.runHook or register not provided");
    }
    let called = false;
    const name = `__smoke_hook_${Date.now()}__`;
    try { reg.unregister && reg.unregister(name); } catch (_) {}
    reg.register({ name, hooks: { beforeToolCall() { called = true; } } });
    await reg.runHook("beforeToolCall", { toolName: "smoke" });
    if (reg.unregister) reg.unregister(name);
    if (!called) throw new Error("Hook was not executed");
    return { hookCalled: true };
  },
};

// ---------------------------------------------------------------------------
// SmokeTest
// ---------------------------------------------------------------------------

class SmokeTest {
  /**
   * @param {object} ctx - dependencies injected by the caller
   * @param {object} [ctx.settings]         - settings object (e.g. from createMockSettings)
   * @param {object} [ctx.toolRegistry]     - ToolRegistry instance or mock
   * @param {function} [ctx.createSession]  - () => mock session
   * @param {function} [ctx.writeMemory]    - memory write function
   * @param {function} [ctx.readMemory]     - memory read function
   * @param {function} [ctx.listMemories]   - memory list function
   * @param {function} [ctx.searchMemories] - memory search function
   * @param {function} [ctx.deleteMemory]   - memory delete function
   * @param {object} [ctx.fs]              - fs-like object { writeFile, readFile, unlink, access }
   * @param {string} [ctx.tmpDir]          - temp directory for file tests
   * @param {object} [ctx.pluginRegistry]  - PluginRegistry instance or mock
   */
  constructor(ctx = {}) {
    this._ctx = { ...ctx };
    this._ctx.__memKey = null;
    this._ctx.__filePath = null;
    this._ctx.__fileContent = null;
  }

  // -----------------------------------------------------------------------
  // Public runners
  // -----------------------------------------------------------------------

  /**
   * Fast critical-path test. Targets < 1 second completion.
   * Only runs the QUICK_TESTS subset.
   *
   * @returns {Promise<object>} { passed, failed, skipped, durationMs, criticalBlocked, results }
   */
  async runQuick() {
    return this._runSuite(QUICK_TESTS);
  }

  /**
   * Standard smoke test suite covering all key subsystems.
   *
   * @returns {Promise<object>} { passed, failed, skipped, durationMs, criticalBlocked, results }
   */
  async runStandard() {
    return this._runSuite(STANDARD_TESTS);
  }

  /**
   * Comprehensive smoke test including extended checks.
   *
   * @returns {Promise<object>} { passed, failed, skipped, durationMs, criticalBlocked, results }
   */
  async runFull() {
    return this._runSuite(FULL_TESTS);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  async _runSuite(testNames) {
    const start = process.hrtime.bigint();
    const results = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let criticalBlocked = false;

    for (const name of testNames) {
      const fn = TEST_IMPLS[name];
      if (!fn) {
        results.push(result(name, "skip", "Test implementation not found", 0));
        skipped++;
        continue;
      }

      // Bind fn to TEST_IMPLS so that inter-test references (e.g. "memory:read"
      // calling "memory:write") resolve correctly.
      const boundFn = fn.bind(TEST_IMPLS);

      const { elapsedMs, threw, value } = await timed(() => boundFn(this._ctx));

      if (threw) {
        results.push(result(name, "fail", value.message || String(value), elapsedMs, { error: value.message }));
        failed++;
        if (CRITICAL_TESTS.has(name)) {
          criticalBlocked = true;
        }
      } else {
        results.push(result(name, "pass", `OK (${elapsedMs}ms)`, elapsedMs, value));
        passed++;
      }
    }

    const totalDurationMs = Math.round(
      (Number(process.hrtime.bigint() - start) / 1e6) * 100
    ) / 100;

    return {
      passed,
      failed,
      skipped,
      durationMs: totalDurationMs,
      criticalBlocked,
      timestamp: nowISO(),
      results,
    };
  }

  /**
   * Get the current context (useful for inspection in tests).
   * @returns {object}
   */
  getContext() {
    return { ...this._ctx };
  }

  /**
   * Update the context with additional properties.
   * @param {object} patch
   * @returns {SmokeTest} this instance for chaining
   */
  updateContext(patch) {
    Object.assign(this._ctx, patch);
    return this;
  }
}

module.exports = {
  SmokeTest,
  QUICK_TESTS,
  STANDARD_TESTS,
  FULL_TESTS,
  CRITICAL_TESTS,
  TEST_IMPLS,
};
