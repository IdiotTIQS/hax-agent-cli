/**
 * Shared test fixtures — realistic sample data for HaxAgent tests.
 *
 * Every function is deterministic (given the same inputs it returns the same
 * data) so tests don't need external files or databases.
 */
"use strict";

// ---------------------------------------------------------------------------
// sampleMessages
// ---------------------------------------------------------------------------

/**
 * Generate N realistic chat messages, alternating user/assistant.
 *
 * @param {number} [n=10] - number of messages to generate
 * @param {object} [options]
 * @param {string} [options.topic="code review"] - topic seeded into messages
 * @param {boolean} [options.includeToolUse=false] - include tool_use messages
 * @param {boolean} [options.includeSystem=false] - prepend a system message
 * @returns {Array<{role:string, content:string}>} array of message objects
 */
function sampleMessages(n = 10, options = {}) {
  const topic = options.topic || "code review";
  const messages = [];

  if (options.includeSystem) {
    messages.push({
      role: "system",
      content: `You are a helpful coding assistant. You are discussing: ${topic}.`,
    });
  }

  for (let i = 0; i < n; i += 1) {
    if (i % 2 === 0) {
      messages.push({
        role: "user",
        content: sampleUserMessage(i / 2, topic),
      });
    } else {
      messages.push({
        role: "assistant",
        content: sampleAssistantMessage(Math.floor(i / 2), topic, options.includeToolUse),
      });
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// sampleToolResults
// ---------------------------------------------------------------------------

/**
 * Sample results for common HaxAgent tools.
 *
 * @returns {object} map of tool name to sample result objects
 */
function sampleToolResults() {
  return Object.freeze({
    "file.read": {
      toolName: "file.read",
      ok: true,
      data: {
        path: "/project/src/index.js",
        bytes: 2847,
        content: `"use strict";\n\nconst { createProvider } = require("./providers");\n\nfunction main() {\n  const provider = createProvider();\n  console.log("Ready.");\n}\n\nmodule.exports = { main };\n`,
        encoding: "utf8",
      },
      durationMs: 3,
      timestamp: new Date().toISOString(),
    },

    "file.write": {
      toolName: "file.write",
      ok: true,
      data: {
        path: "/project/src/index.js",
        bytes: 2900,
        change: {
          operation: "update",
          added: 2,
          removed: 0,
          changed: 2,
          preview: [
            { line: 5, marker: "+", text: '  console.log("Ready with HaxAgent.");' },
            { line: 6, marker: "+", text: "  return provider;" },
          ],
        },
      },
      durationMs: 4,
      timestamp: new Date().toISOString(),
    },

    "file.glob": {
      toolName: "file.glob",
      ok: true,
      data: {
        pattern: "src/**/*.js",
        count: 47,
        files: [
          "src/index.js",
          "src/config.js",
          "src/session.js",
          "src/providers/index.js",
          "src/providers/chat-provider.js",
          "src/tools/index.js",
          "src/tools/registry.js",
          "src/tools/file-read.js",
          "src/tools/file-write.js",
          "src/tools/shell.js",
        ],
        truncatedCount: 37,
      },
      durationMs: 8,
      timestamp: new Date().toISOString(),
    },

    "file.search": {
      toolName: "file.search",
      ok: true,
      data: {
        query: "createProvider",
        count: 3,
        results: [
          { file: "src/index.js", line: 3, content: 'const { createProvider } = require("./providers");' },
          { file: "src/providers/factory.js", line: 19, content: "function createProvider(config = {}, env = process.env) {" },
          { file: "test/providers.test.js", line: 12, content: "const { createProvider } = require(\"../src/providers\");" },
        ],
      },
      durationMs: 15,
      timestamp: new Date().toISOString(),
    },

    "shell.run": {
      toolName: "shell.run",
      ok: true,
      data: {
        command: "npm test",
        exitCode: 0,
        stdout: "> hax-agent@1.4.1 test\n> node --test\n\nok 1 - ...\nok 2 - ...\n# pass 42\n# fail 0\n",
        stderr: "",
        killed: false,
        timedOut: false,
      },
      durationMs: 1234,
      timestamp: new Date().toISOString(),
    },

    "file.edit": {
      toolName: "file.edit",
      ok: true,
      data: {
        path: "/project/src/config.js",
        changes: [{ oldText: "maxTurns: 20", newText: "maxTurns: 30" }],
        found: true,
      },
      durationMs: 5,
      timestamp: new Date().toISOString(),
    },

    "file.readdir": {
      toolName: "file.readdir",
      ok: true,
      data: {
        path: "/project/src",
        entries: [
          { name: "index.js", type: "file" },
          { name: "config.js", type: "file" },
          { name: "session.js", type: "file" },
          { name: "providers", type: "directory" },
          { name: "tools", type: "directory" },
        ],
      },
      durationMs: 2,
      timestamp: new Date().toISOString(),
    },

    // error result example
    "file.read.error": {
      toolName: "file.read",
      ok: false,
      data: {
        path: "/project/src/nonexistent.js",
        error: "PATH_NOT_FOUND",
        message: "Path does not exist on the filesystem",
      },
      durationMs: 1,
      timestamp: new Date().toISOString(),
    },
  });
}

// ---------------------------------------------------------------------------
// sampleSessionTranscript
// ---------------------------------------------------------------------------

/**
 * A complete session transcript with entries (metadata + user/assistant/tool messages).
 *
 * @param {object} [options]
 * @param {string} [options.sessionId] - session identifier
 * @param {number} [options.turns=3] - number of user-assistant turn pairs
 * @returns {Array<object>} array of transcript entries in order
 */
function sampleSessionTranscript(options = {}) {
  const sessionId = options.sessionId || "session-test-001";
  const turns = Math.max(1, options.turns || 3);
  const entries = [];
  const baseTime = new Date("2025-06-15T10:00:00Z");

  entries.push({
    type: "session.meta",
    sessionId,
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    startedAt: baseTime.toISOString(),
  });

  for (let t = 0; t < turns; t += 1) {
    const turnTime = new Date(baseTime.getTime() + t * 60000);

    entries.push({
      type: "message",
      role: "user",
      content: sampleUserMessage(t, "code review"),
      timestamp: turnTime.toISOString(),
      turn: t + 1,
    });

    entries.push({
      type: "message",
      role: "assistant",
      content: sampleAssistantMessage(t, "code review", t === 0),
      timestamp: new Date(turnTime.getTime() + 3000).toISOString(),
      turn: t + 1,
      usage: {
        inputTokens: 800 + t * 100,
        outputTokens: 400 + t * 50,
      },
    });

    if (t === 0) {
      entries.push({
        type: "tool.start",
        name: "file.read",
        input: { path: "/project/src/index.js" },
        timestamp: new Date(turnTime.getTime() + 1000).toISOString(),
        turn: 1,
        attempt: 1,
      });
      entries.push({
        type: "tool.result",
        name: "file.read",
        data: { path: "/project/src/index.js", bytes: 2847, content: "use strict;\n..." },
        isError: false,
        durationMs: 3,
        timestamp: new Date(turnTime.getTime() + 1500).toISOString(),
        turn: 1,
        attempt: 1,
      });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// sampleMemories
// ---------------------------------------------------------------------------

/**
 * Generate N sample memory entries with namespaces and tags.
 *
 * @param {number} [n=5] - number of memory entries
 * @param {object} [options]
 * @param {string} [options.namespace="default"] - namespace prefix
 * @returns {Array<object>} array of memory record objects
 */
function sampleMemories(n = 5, options = {}) {
  const namespace = options.namespace || "default";
  const entries = [];
  const baseTime = new Date("2025-06-01T00:00:00Z");

  const templates = [
    {
      name: "project-setup",
      content: "Project uses Node.js 20+, CommonJS modules, and node:test runner.",
      tags: ["setup", "node", "commonjs"],
    },
    {
      name: "api-pattern",
      content: "All modules export via module.exports = { ... } pattern. No default exports.",
      tags: ["convention", "exports", "style"],
    },
    {
      name: "error-handling",
      content: "Tool errors use ToolExecutionError with codes from error-codes.js. Always include a message.",
      tags: ["error", "tools", "convention"],
    },
    {
      name: "test-pattern",
      content: "Tests use node:test with node:assert/strict. Each test file is independent.",
      tags: ["testing", "convention", "node"],
    },
    {
      name: "dependencies",
      content: "No external runtime dependencies beyond Node.js built-ins.",
      tags: ["deps", "setup"],
    },
  ];

  for (let i = 0; i < Math.min(n, templates.length); i += 1) {
    const t = templates[i];
    const createdAt = new Date(baseTime.getTime() + i * 86400000).toISOString();
    entries.push({
      name: t.name,
      namespace: i === 0 ? "global" : namespace,
      tags: t.tags,
      content: t.content,
      createdAt,
      updatedAt: createdAt,
    });
  }

  // If n > templates.length, generate generic entries
  for (let i = templates.length; i < n; i += 1) {
    const createdAt = new Date(baseTime.getTime() + i * 86400000).toISOString();
    entries.push({
      name: `memory-entry-${i + 1}`,
      namespace,
      tags: ["auto", `tag-${i}`],
      content: `Auto-generated test memory entry number ${i + 1}.`,
      createdAt,
      updatedAt: createdAt,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// sampleAgentDefinitions
// ---------------------------------------------------------------------------

/**
 * Sample agent team configurations (matching BUILT_IN_AGENTS shape).
 *
 * @returns {Array<object>} array of agent definition objects
 */
function sampleAgentDefinitions() {
  return [
    {
      agentType: "general-purpose",
      name: "general-purpose",
      role: "General teammate for broad coding tasks and follow-up work.",
      whenToUse: "Use when no more specialized teammate is a better fit.",
      tools: ["file.read", "file.glob", "file.search", "shell.run", "file.write"],
      color: "magenta",
      prompt: "You are a general-purpose coding teammate in an agent team.",
    },
    {
      agentType: "explore",
      name: "explore",
      role: "Maps code paths, dependencies, conventions, and hidden constraints.",
      whenToUse: "Use before implementation when the relevant files or architecture are unclear.",
      tools: ["file.read", "file.glob", "file.search", "shell.run"],
      color: "cyan",
      prompt: "You are an exploration specialist in an agent team. Do not modify files.",
    },
    {
      agentType: "implementer",
      name: "implementer",
      role: "Makes focused code changes following existing project conventions.",
      whenToUse: "Use when the desired change is understood and ready to implement.",
      tools: ["file.read", "file.glob", "file.search", "shell.run", "file.write"],
      color: "green",
      prompt: "You are an implementation specialist in an agent team. Make focused changes.",
    },
    {
      agentType: "reviewer",
      name: "reviewer",
      role: "Reviews code for regressions, correctness, maintainability, and UX issues.",
      whenToUse: "Use after implementation or before risky changes.",
      tools: ["file.read", "file.glob", "file.search", "shell.run"],
      color: "yellow",
      prompt: "You are a code review specialist. Do not modify files.",
    },
    {
      agentType: "test-runner",
      name: "test-runner",
      role: "Finds and runs the right validation commands, then explains failures.",
      whenToUse: "Use when changes need verification or test failures need triage.",
      tools: ["file.read", "file.glob", "file.search", "shell.run"],
      color: "red",
      prompt: "You are a validation specialist in an agent team.",
    },
  ];
}

// ---------------------------------------------------------------------------
// sampleConfig
// ---------------------------------------------------------------------------

/**
 * A full, realistic configuration object suitable for integration tests.
 *
 * @param {object} [overrides] - merged on top of the base config
 * @returns {object} full configuration object
 */
function sampleConfig(overrides = {}) {
  const config = {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: "sk-ant-test-key-000000000000000000000000",
    apiUrl: undefined,
    maxTokens: 8192,
    maxTurns: 20,
    temperature: 0.2,
    projectRoot: "/project",
    memoryDirectory: "/project/.hax-agent/memory",
    sessionDirectory: "/project/.hax-agent/sessions",
    locale: "en",
    settings: {
      agent: {
        name: "hax-agent",
        model: "claude-sonnet-4-20250514",
        maxTurns: 20,
        temperature: 0.2,
      },
      memory: {
        enabled: true,
        maxItems: 20,
      },
      sessions: {
        transcriptLimit: 100,
      },
      prompts: {
        includeSettings: true,
        includeMemory: true,
        includeTranscript: true,
      },
      context: {
        enabled: true,
        reserveOutputTokens: 8192,
        charsPerToken: 4,
      },
      fileContext: {
        enabled: true,
        maxFiles: 8,
        maxFileSize: 512000,
        maxBytesPerFile: 32000,
        maxTotalBytes: 120000,
      },
      permissions: {
        mode: "normal",
      },
      tools: {
        shell: {
          enabled: true,
          timeoutMs: 10000,
          maxBuffer: 52428800,
        },
      },
    },
  };

  return deepMerge(config, overrides);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sampleUserMessage(index, topic) {
  const messages = [
    `Can you help me review the code in src/index.js? I'm concerned about the ${topic} flow.`,
    `What about the error handling? Are there any places where exceptions might not be caught?`,
    `Can you also check if all the file operations have proper path validation?`,
    `Run the tests and let me know if anything fails for the ${topic} module.`,
    `Can you refactor the ${topic} logic into a separate module?`,
    `Write a test for the edge case where the input is an empty array.`,
    `What's the memory impact of loading the entire file into a string?`,
    `Is there a race condition in the async tool execution flow?`,
    `Add JSDoc comments to all exported functions in the ${topic} module.`,
    `Can you check the git history for recent changes to ${topic}?`,
  ];
  return messages[index % messages.length];
}

function sampleAssistantMessage(index, topic, includeToolUse) {
  const responses = [
    `I've reviewed src/index.js. The ${topic} flow looks solid overall. The main entry point handles provider creation correctly, and the exports are clean. One suggestion: consider adding input validation at the module boundary.`,
    `Looking at the error handling, I found a few areas to improve:\n\n1. The provider creation in factory.js doesn't catch invalid model names\n2. Shell tool execution could leak process handles on timeout\n3. File read doesn't validate encoding before attempting to read\n\nI'd recommend adding try/catch blocks in these three locations.`,
    `I've checked all file operations for path validation. Here's the summary:\n\n- file.read: uses realpath, catches ENOENT - good\n- file.write: validates parent directory exists - good\n- file.glob: resolves root but doesn't check it exists - needs fix\n- shell.run: cwd is resolved but not validated - needs fix`,
    `All tests pass. Here's the detailed output:\n\n\`\`\`\nok 1 - file.read resolves path\nok 2 - file.read handles encoding\nok 3 - file.write creates parent dirs\n...\n# pass 42\n# fail 0\n\`\`\`\n\nNo failures detected. Coverage is at 87% for the ${topic} module.`,
    `Here's the refactored ${topic} module. I extracted the core logic into a separate file and kept the original as a thin wrapper for backward compatibility.

Changes:
- Created src/${topic.replace(/\s+/g, "-")}/core.js with the extracted logic
- Updated index.js to re-export from the new module
- All existing tests pass without modification
- New test file added for the core module`,
    `I've added a test for the empty array edge case. The test covers:\n\n1. Passing an empty array directly\n2. Passing undefined (which defaults to empty)\n3. Passing null (which should throw)\n4. Nested empty arrays\n\nAll edge cases are now handled correctly.`,
    `Memory analysis for the file-reading approach:\n\nCurrent: loads entire file into a string (O(n) memory where n = file size)\n\nThe 512KB maxFileSize cap provides a reasonable upper bound. For a typical 50KB source file at 4 chars/token, that's about 12.5K tokens consumed.`,
    `I found no race conditions in the async tool execution flow. Each tool invocation runs in sequence within a turn, and the undo stack's push/undo operations are synchronous. However, I'd recommend auditing the shell.run tool for concurrent spawn issues.`,
    `I've added JSDoc comments to all 12 exported functions. Each comment includes:\n- @param types for all parameters\n- @returns type and description\n- @throws for known error conditions\n\nThe documentation is now complete and consistent with the project style.`,
    `Git history for ${topic} changes:\n\n\`\`\`\n6a5978e - refactor(tools): extract ${topic} validation into shared helper\nc8b7674 - fix(${topic}): handle null input gracefully\n956db08 - feat(${topic}): add path normalization\n\`\`\`\n\nLast 3 commits all look clean with clear messages.`,
  ];

  let response = responses[index % responses.length];
  if (includeToolUse && index === 0) {
    response = `Let me start by reading the file.\n\n[Tool: file.read] Result: {"path":"/project/src/index.js","bytes":2847}\n\n` + response;
  }

  return response;
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (override[key] && typeof override[key] === "object" && !Array.isArray(override[key]) && base[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  sampleMessages,
  sampleToolResults,
  sampleSessionTranscript,
  sampleMemories,
  sampleAgentDefinitions,
  sampleConfig,
};
