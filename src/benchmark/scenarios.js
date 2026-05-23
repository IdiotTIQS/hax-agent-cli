/**
 * Pre-built benchmark scenarios targeting commonly-measured subsystems:
 * tool execution, token estimation, file I/O, message processing, and
 * context-window budget selection.
 */
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { Benchmark } = require("./runner");
const {
  estimateTokens,
  estimateMessageTokens,
  estimateConversationTokens,
  prepareContextWindow,
  selectMessagesWithinBudget,
} = require("../context-window");
const {
  estimateTokens: providerEstimateTokens,
  estimateMessageTokens: providerEstimateMessageTokens,
} = require("../providers/token-counter");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @returns {string} path to a temporary directory (created on demand). */
async function ensureTempDir() {
  const dir = path.join(os.tmpdir(), `hax-bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/**
 * Benchmark a single tool execution.
 * @param {object} tool - tool object with { name, execute }
 * @param {object} args - arguments passed to tool.execute
 * @param {object} context - context passed to tool.execute
 * @param {number} [iterations=100] - measurement iterations
 * @returns {Promise<object>} benchmark result
 */
async function benchmarkToolExecution(tool, args, context, iterations = 100) {
  if (!tool || typeof tool.execute !== "function") {
    throw new TypeError("benchmarkToolExecution: tool must have an execute function.");
  }

  const bench = new Benchmark(`tool:${tool.name}`, async () => {
    await tool.execute(args, context);
  });

  return bench.run({ iterations });
}

/**
 * Benchmark token estimation functions against a batch of texts.
 * @param {string[]} texts - array of texts to estimate tokens for
 * @param {number} [iterations=100] - measurement iterations
 * @returns {Promise<object>} benchmark result
 */
async function benchmarkTokenEstimation(texts, iterations = 100) {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new TypeError("benchmarkTokenEstimation: texts must be a non-empty array of strings.");
  }

  const samples = texts.map((t) => String(t ?? ""));

  const bench = new Benchmark("token-estimation", async () => {
    for (const text of samples) {
      estimateTokens(text);
      providerEstimateTokens(text);
    }
  });

  return bench.run({ iterations });
}

/**
 * Benchmark common file-system operations: read, write, glob (via directory
 * listing), and file-search (via a simple grep-style scan).
 * @param {string} [root] - working directory; a temp dir is used when omitted
 * @param {number} [iterations=50] - measurement iterations (kept low to avoid
 *   excessive I/O in test suites)
 * @returns {Promise<object>} benchmark result
 */
async function benchmarkFileOperations(root, iterations = 50) {
  const workDir = root || await ensureTempDir();
  const testFile = path.join(workDir, "bench-test.txt");
  const content = "Hello, HaxAgent benchmark!\n".repeat(50);

  // Ensure the file exists so reads don't all fail.
  await fs.writeFile(testFile, content, "utf-8");

  const bench = new Benchmark("file-operations", async () => {
    // read
    await fs.readFile(testFile, "utf-8");
    // write (different file each iteration so reads stay consistent)
    const tmp = path.join(workDir, `tmp-${Math.random().toString(36).slice(2)}.txt`);
    await fs.writeFile(tmp, content, "utf-8");
    // directory listing
    await fs.readdir(workDir);
    // cleanup
    await fs.unlink(tmp);
  });

  const result = await bench.run({ iterations });

  // Best-effort cleanup; don't fail the benchmark.
  try { await fs.rm(workDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }

  return result;
}

/**
 * Benchmark message token estimation across a conversation transcript.
 * @param {object[]} messages - array of message objects { role, content }
 * @param {number} [iterations=100] - measurement iterations
 * @returns {Promise<object>} benchmark result
 */
async function benchmarkMessageProcessing(messages, iterations = 100) {
  if (!Array.isArray(messages)) {
    throw new TypeError("benchmarkMessageProcessing: messages must be an array.");
  }

  const bench = new Benchmark("message-processing", async () => {
    for (const msg of messages) {
      estimateMessageTokens(msg);
      providerEstimateMessageTokens(msg);
    }
    estimateConversationTokens(messages);
  });

  return bench.run({ iterations });
}

/**
 * Benchmark context-window budget selection (the prepareContextWindow
 * pipeline, which includes token estimation, message traversal, and
 * budget-aware truncation).
 * @param {object[]} messages - conversation messages
 * @param {number} budget - token budget for message selection
 * @param {number} [iterations=100] - measurement iterations
 * @returns {Promise<object>} benchmark result
 */
async function benchmarkContextBudget(messages, budget, iterations = 100) {
  if (!Array.isArray(messages)) {
    throw new TypeError("benchmarkContextBudget: messages must be an array.");
  }

  const bench = new Benchmark("context-budget", async () => {
    // Exercise the full pipeline: prepare + budget-driven selection.
    prepareContextWindow({
      messages,
      settings: { context: { windowTokens: budget + 8192 } },
      model: "claude-sonnet-4",
    });
    selectMessagesWithinBudget(messages, budget);
  });

  return bench.run({ iterations });
}

module.exports = {
  benchmarkToolExecution,
  benchmarkTokenEstimation,
  benchmarkFileOperations,
  benchmarkMessageProcessing,
  benchmarkContextBudget,
};
