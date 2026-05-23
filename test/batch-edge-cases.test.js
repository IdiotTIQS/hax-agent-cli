/**
 * Edge-case tests for batch mode: readAllInput, parseBatchInput,
 * and formatBatchOutput (tested via runBatchMode with mocked engine).
 */
"use strict";

const assert = require("node:assert/strict");
const { PassThrough, Writable } = require("node:stream");
const test = require("node:test");

const { readAllInput, parseBatchInput } = require("../src/batch");

// ---------------------------------------------------------------------------
// readAllInput
// ---------------------------------------------------------------------------

test("readAllInput: reads piped stdin (non-TTY) in one chunk", async () => {
  // Simulate a piped stream: isTTY is false, data arrives as a single chunk.
  const stream = new PassThrough();
  stream.isTTY = false;

  const promise = readAllInput(stream);
  stream.write("hello piped world\n");
  stream.end();

  const result = await promise;
  assert.equal(result, "hello piped world\n");
});

test("readAllInput: reads piped stdin split across multiple chunks", async () => {
  const stream = new PassThrough();
  stream.isTTY = false;

  const promise = readAllInput(stream);
  stream.write("chunk one ");
  stream.write("chunk two ");
  stream.write("chunk three");
  stream.end();

  const result = await promise;
  assert.equal(result, "chunk one chunk two chunk three");
});

test("readAllInput: handles empty piped input", async () => {
  const stream = new PassThrough();
  stream.isTTY = false;

  const promise = readAllInput(stream);
  stream.end();

  const result = await promise;
  assert.equal(result, "");
});

test("readAllInput: rejects on stream error", async () => {
  const stream = new PassThrough();
  stream.isTTY = false;

  const promise = readAllInput(stream);
  stream.destroy(new Error("simulated stream failure"));

  await assert.rejects(promise, { message: "simulated stream failure" });
});

// ---------------------------------------------------------------------------
// parseBatchInput — single turn
// ---------------------------------------------------------------------------

test("parseBatchInput: single turn returns whole input as one element", () => {
  const result = parseBatchInput("Refactor the auth module to use JWT.");
  assert.equal(result.length, 1);
  assert.equal(result[0], "Refactor the auth module to use JWT.");
});

test("parseBatchInput: single turn with leading and trailing whitespace", () => {
  const result = parseBatchInput("  \n  Just one prompt here.  \n  ");
  assert.equal(result.length, 1);
  assert.equal(result[0], "Just one prompt here.");
});

// ---------------------------------------------------------------------------
// parseBatchInput — ---multi--- marker
// ---------------------------------------------------------------------------

test("parseBatchInput: ---multi--- splits lines into separate turns", () => {
  const input = [
    "---multi---",
    "First task: add logging to the auth module.",
    "Second task: write tests for the logging.",
    "Third task: update the documentation.",
  ].join("\n");

  const result = parseBatchInput(input);
  assert.equal(result.length, 3);
  assert.equal(result[0], "First task: add logging to the auth module.");
  assert.equal(result[1], "Second task: write tests for the logging.");
  assert.equal(result[2], "Third task: update the documentation.");
});

test("parseBatchInput: ---multi--- with blank lines between tasks", () => {
  const input = [
    "---multi---",
    "Task one.",
    "",
    "Task two.",
    "",
    "",
    "Task three.",
  ].join("\n");

  const result = parseBatchInput(input);
  assert.equal(result.length, 3);
  assert.equal(result[0], "Task one.");
  assert.equal(result[1], "Task two.");
  assert.equal(result[2], "Task three.");
});

test("parseBatchInput: ---multi--- with only whitespace lines", () => {
  const input = [
    "---multi---",
    "   ",
    "\t",
    "Only real task.",
  ].join("\n");

  const result = parseBatchInput(input);
  assert.equal(result.length, 1);
  assert.equal(result[0], "Only real task.");
});

test("parseBatchInput: ---multi--- with no tasks (only marker)", () => {
  const result = parseBatchInput("---multi---");
  assert.equal(result.length, 0);
});

// ---------------------------------------------------------------------------
// parseBatchInput — @@@multi@@@ marker
// ---------------------------------------------------------------------------

test("parseBatchInput: @@@multi@@@ splits lines into separate turns", () => {
  const input = [
    "@@@multi@@@",
    "Step 1: initialize the project.",
    "Step 2: configure the linter.",
    "Step 3: set up CI.",
  ].join("\n");

  const result = parseBatchInput(input);
  assert.equal(result.length, 3);
  assert.equal(result[0], "Step 1: initialize the project.");
  assert.equal(result[1], "Step 2: configure the linter.");
  assert.equal(result[2], "Step 3: set up CI.");
});

test("parseBatchInput: @@@multi@@@ with blank lines", () => {
  const input = "@@@multi@@@\n\nOnly task.\n\n";
  const result = parseBatchInput(input);
  assert.equal(result.length, 1);
  assert.equal(result[0], "Only task.");
});

test("parseBatchInput: @@@multi@@@ with no tasks", () => {
  const result = parseBatchInput("@@@multi@@@");
  assert.equal(result.length, 0);
});

// ---------------------------------------------------------------------------
// parseBatchInput — empty / whitespace-only
// ---------------------------------------------------------------------------

test("parseBatchInput: empty string returns empty array", () => {
  assert.deepEqual(parseBatchInput(""), []);
});

test("parseBatchInput: whitespace-only string returns empty array", () => {
  assert.deepEqual(parseBatchInput("   \n  \t  \n  "), []);
});

test("parseBatchInput: throws TypeError on null input", () => {
  assert.throws(
    () => parseBatchInput(null),
    { name: "TypeError", message: /Cannot read properties of null/ }
  );
});

test("parseBatchInput: throws TypeError on undefined input", () => {
  assert.throws(
    () => parseBatchInput(undefined),
    { name: "TypeError", message: /Cannot read properties of undefined/ }
  );
});

// ---------------------------------------------------------------------------
// parseBatchInput — mixed newlines (\r\n, \n)
// ---------------------------------------------------------------------------

test("parseBatchInput: handles Windows-style \\r\\n line endings", () => {
  const input = "---multi---\r\nTask alpha.\r\nTask beta.\r\nTask gamma.\r\n";
  const result = parseBatchInput(input);
  assert.equal(result.length, 3);
  assert.equal(result[0], "Task alpha.");
  assert.equal(result[1], "Task beta.");
  assert.equal(result[2], "Task gamma.");
});

test("parseBatchInput: handles mixed \\r\\n and \\n line endings", () => {
  const input = "---multi---\r\nTask 1.\nTask 2.\r\nTask 3.\n";
  const result = parseBatchInput(input);
  assert.equal(result.length, 3);
  assert.equal(result[0], "Task 1.");
  assert.equal(result[1], "Task 2.");
  assert.equal(result[2], "Task 3.");
});

test("parseBatchInput: @@@multi@@@ with \\r\\n line endings", () => {
  const input = "@@@multi@@@\r\nStep A.\r\nStep B.\r\n";
  const result = parseBatchInput(input);
  assert.equal(result.length, 2);
  assert.equal(result[0], "Step A.");
  assert.equal(result[1], "Step B.");
});

// ---------------------------------------------------------------------------
// parseBatchInput — edge cases
// ---------------------------------------------------------------------------

test("parseBatchInput: text containing marker string but not at start", () => {
  // The marker must be at the very start for multi-turn mode.
  const input = "Some text\n---multi---\nThis is not multi-turn.";
  const result = parseBatchInput(input);
  // Should be treated as single turn — entire input is one element.
  assert.equal(result.length, 1);
  assert.ok(result[0].includes("---multi---"));
});

test("parseBatchInput: text starting with whitespace then marker", () => {
  // Leading whitespace is trimmed, so the marker IS detected.
  const input = "  \n---multi---\nTask one.\nTask two.";
  const result = parseBatchInput(input);
  assert.equal(result.length, 2);
  assert.equal(result[0], "Task one.");
  assert.equal(result[1], "Task two.");
});

test("parseBatchInput: @@@multi@@@ with leading whitespace", () => {
  const input = "\t\n@@@multi@@@\nDo this.\nDo that.";
  const result = parseBatchInput(input);
  assert.equal(result.length, 2);
  assert.equal(result[0], "Do this.");
  assert.equal(result[1], "Do that.");
});

test("parseBatchInput: trailing carriage returns on single-turn input", () => {
  const input = "A single prompt with trailing \r\n\r\n";
  const result = parseBatchInput(input);
  assert.equal(result.length, 1);
  assert.equal(result[0], "A single prompt with trailing");
});

// ---------------------------------------------------------------------------
// runBatchMode integration tests (using require.cache injection to mock
// AgentEngine so no real API calls are made)
// ---------------------------------------------------------------------------

const path = require("node:path");
const agentEnginePath = require.resolve(
  path.join(__dirname, "..", "src", "agent-engine")
);
const batchPath = require.resolve(
  path.join(__dirname, "..", "src", "batch")
);

test("runBatchMode: raw output strips formatting footer", async () => {
  const savedAgentEngine = require.cache[agentEnginePath];

  // Inject a mock AgentEngine that yields synthetic deltas and completes.
  require.cache[agentEnginePath] = {
    id: agentEnginePath,
    filename: agentEnginePath,
    loaded: true,
    exports: {
      AgentEngine: class {
        constructor(opts) {
          this.session = opts.session;
          this.projectRoot = opts.projectRoot;
        }
        async *sendMessage(_content) {
          yield { type: "message.delta", delta: "Mock response." };
          yield { type: "message.delta", delta: " More text." };
          yield { type: "completed" };
        }
      },
    },
  };

  // Force a fresh load of batch.js so it picks up the mock.
  delete require.cache[batchPath];
  const batch = require("../src/batch");

  const capturedOutput = [];
  const mockStream = new Writable({
    write(chunk, _encoding, callback) {
      capturedOutput.push(chunk.toString());
      callback();
    },
  });

  try {
    const mockSession = {
      settings: { projectRoot: process.cwd() },
      costTracker: {
        inputTokens: 1500,
        outputTokens: 300,
        turnCount: 2,
        getCost() {
          return 0.0123;
        },
      },
      provider: { model: "claude-sonnet-4-20250514" },
    };

    const exitCode = await batch.runBatchMode({
      session: mockSession,
      input: createInputPassThrough("Test prompt."),
      output: mockStream,
      raw: true,
    });

    assert.equal(exitCode, 0);

    const output = capturedOutput.join("");
    assert.ok(output.includes("Mock response. More text."));
    assert.ok(!output.includes("---"));
    assert.ok(!output.includes("Tokens:"));
    assert.ok(!output.includes("Cost:"));
  } finally {
    // Restore original agent-engine and batch module.
    require.cache[agentEnginePath] = savedAgentEngine;
    delete require.cache[batchPath];
  }
});

test("runBatchMode: non-raw output includes token summary footer", async () => {
  const savedAgentEngine = require.cache[agentEnginePath];

  require.cache[agentEnginePath] = {
    id: agentEnginePath,
    filename: agentEnginePath,
    loaded: true,
    exports: {
      AgentEngine: class {
        constructor() {}
        async *sendMessage(_content) {
          yield { type: "message.delta", delta: "Hello from batch." };
          yield { type: "completed" };
        }
      },
    },
  };

  delete require.cache[batchPath];
  const batch = require("../src/batch");

  const capturedOutput = [];
  const mockStream = new Writable({
    write(chunk, _encoding, callback) {
      capturedOutput.push(chunk.toString());
      callback();
    },
  });

  try {
    const mockSession = {
      settings: { projectRoot: process.cwd() },
      costTracker: {
        inputTokens: 42,
        outputTokens: 7,
        turnCount: 1,
        getCost() {
          return 0.0005;
        },
      },
      provider: { model: "test-model" },
    };

    const exitCode = await batch.runBatchMode({
      session: mockSession,
      input: createInputPassThrough("Analyze this code."),
      output: mockStream,
      raw: false,
    });

    assert.equal(exitCode, 0);

    const output = capturedOutput.join("");
    assert.ok(output.includes("Hello from batch."));
    assert.ok(output.includes("---"));
    assert.ok(output.includes("Tokens:"));
    assert.ok(output.includes("Cost: $0.0005"));
  } finally {
    require.cache[agentEnginePath] = savedAgentEngine;
    delete require.cache[batchPath];
  }
});

test("runBatchMode: error on empty input", async () => {
  const savedAgentEngine = require.cache[agentEnginePath];

  // Inject a no-op mock so the require inside runBatchMode succeeds even
  // though we never reach the sendMessage loop.
  require.cache[agentEnginePath] = {
    id: agentEnginePath,
    filename: agentEnginePath,
    loaded: true,
    exports: {
      AgentEngine: class {
        constructor() {}
        async *sendMessage() {
          yield { type: "completed" };
        }
      },
    },
  };

  delete require.cache[batchPath];
  const batch = require("../src/batch");

  const capturedStderr = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    capturedStderr.push(String(chunk));
    return true;
  };

  try {
    const mockSession = {
      settings: { projectRoot: process.cwd() },
      costTracker: {
        inputTokens: 0,
        outputTokens: 0,
        turnCount: 0,
        getCost() { return 0; },
      },
      provider: {},
    };

    const exitCode = await batch.runBatchMode({
      session: mockSession,
      input: createInputPassThrough("   \n  "),
      output: new Writable({ write(_c, _e, cb) { cb(); } }),
      raw: true,
    });

    assert.equal(exitCode, 1);
    const stderr = capturedStderr.join("");
    assert.ok(stderr.includes("No input provided"));
  } finally {
    process.stderr.write = originalWrite;
    require.cache[agentEnginePath] = savedAgentEngine;
    delete require.cache[batchPath];
  }
});

test("runBatchMode: error when a turn fails", async () => {
  const savedAgentEngine = require.cache[agentEnginePath];

  require.cache[agentEnginePath] = {
    id: agentEnginePath,
    filename: agentEnginePath,
    loaded: true,
    exports: {
      AgentEngine: class {
        constructor() {}
        async *sendMessage(_content) {
          yield { type: "failed", error: { message: "API quota exceeded" } };
        }
      },
    },
  };

  delete require.cache[batchPath];
  const batch = require("../src/batch");

  const capturedStderr = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    capturedStderr.push(String(chunk));
    return true;
  };

  try {
    const mockSession = {
      settings: { projectRoot: process.cwd() },
      costTracker: {
        inputTokens: 10,
        outputTokens: 0,
        turnCount: 0,
        getCost() { return 0; },
      },
      provider: {},
    };

    const exitCode = await batch.runBatchMode({
      session: mockSession,
      input: createInputPassThrough("Some task."),
      output: new Writable({ write(_c, _e, cb) { cb(); } }),
      raw: true,
    });

    assert.equal(exitCode, 1);
    const stderr = capturedStderr.join("");
    assert.ok(stderr.includes("API quota exceeded"));
  } finally {
    process.stderr.write = originalWrite;
    require.cache[agentEnginePath] = savedAgentEngine;
    delete require.cache[batchPath];
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createInputPassThrough(text) {
  const stream = new PassThrough();
  stream.isTTY = false;
  stream.write(text);
  stream.end();
  return stream;
}
