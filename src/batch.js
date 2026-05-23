"use strict";

/**
 * Batch mode for non-interactive scripted usage.
 *
 * Usage:
 *   echo "refactor the auth module" | hax-agent --batch
 *   cat tasks.txt | hax-agent --batch --model claude-sonnet-4-20250514
 *   hax-agent --batch --input prompt.txt --output result.md
 *
 * In batch mode:
 *   - Reads input from stdin (or --input file), processes it, prints response, exits.
 *   - No ANSI colors, no prompts, no interactive features.
 *   - Exit code 0 on success, 1 on error.
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

/**
 * Run the agent in batch mode.
 *
 * @param {object} options
 * @param {object} options.session - Initialized Session
 * @param {object} options.settings - Resolved settings
 * @param {NodeJS.ReadStream} [options.input] - Input stream (defaults to stdin)
 * @param {NodeJS.WriteStream} [options.output] - Output stream (defaults to stdout)
 * @param {string} [options.inputFile] - Read input from file instead of stdin
 * @param {string} [options.outputFile] - Write response to file
 * @param {boolean} [options.raw] - If true, output raw text without formatting
 * @returns {Promise<number>} Exit code (0 = success, 1 = error)
 */
async function runBatchMode(options = {}) {
  const session = options.session;
  const inputStream = options.input || process.stdin;
  const outputStream = options.output || process.stdout;
  const raw = options.raw !== false;

  let inputContent = '';

  // Read input from file or stdin
  if (options.inputFile) {
    try {
      inputContent = fs.readFileSync(options.inputFile, 'utf8');
    } catch (error) {
      process.stderr.write(`Error reading input file: ${error.message}\n`);
      return 1;
    }
  } else {
    inputContent = await readAllInput(inputStream);
  }

  if (!inputContent.trim()) {
    process.stderr.write('Error: No input provided.\n');
    return 1;
  }

  // Process each non-empty line as a separate turn, or the whole input as one
  const turns = parseBatchInput(inputContent);

  let lastResponse = '';
  const { AgentEngine } = require('./agent-engine');
  const engine = new AgentEngine({
    session,
    projectRoot: session.settings?.projectRoot || process.cwd(),
  });

  for (const turn of turns) {
    if (!turn.trim()) continue;

    try {
      let assistantText = '';
      for await (const event of engine.sendMessage(turn)) {
        if (event.type === 'message.delta') {
          assistantText += event.delta;
        } else if (event.type === 'completed') {
          lastResponse = assistantText;
        } else if (event.type === 'failed') {
          process.stderr.write(`Error: ${event.error?.message || 'Unknown error'}\n`);
          return 1;
        }
      }
    } catch (error) {
      process.stderr.write(`Error: ${error.message}\n`);
      return 1;
    }
  }

  // Write output
  const outputText = raw ? lastResponse.trim() : formatBatchOutput(lastResponse, session);

  if (options.outputFile) {
    try {
      fs.mkdirSync(path.dirname(options.outputFile), { recursive: true });
      fs.writeFileSync(options.outputFile, outputText, 'utf8');
    } catch (error) {
      process.stderr.write(`Error writing output file: ${error.message}\n`);
      return 1;
    }
  } else {
    outputStream.write(outputText + '\n');
  }

  return 0;
}

/**
 * Read all text from a readable stream.
 */
function readAllInput(stream) {
  return new Promise((resolve, reject) => {
    // If stdin is piped, read all at once
    if (!stream.isTTY) {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
      return;
    }

    // Fallback: read line by line
    const lines = [];
    const rl = readline.createInterface({ input: stream });
    rl.on('line', (line) => lines.push(line));
    rl.on('close', () => resolve(lines.join('\n')));
    rl.on('error', reject);
  });
}

/**
 * Parse batch input into individual turn messages.
 * If the first line is "---multi---", each line is a separate turn.
 * Otherwise the entire input is one turn.
 */
function parseBatchInput(content) {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // If the content starts with the multi-turn marker, split by lines
  if (trimmed.startsWith('@@@multi@@@') || trimmed.startsWith('---multi---')) {
    return trimmed
      .split(/\r?\n/)
      .slice(1) // skip marker line
      .filter((line) => line.trim());
  }

  return [trimmed];
}

function formatBatchOutput(response, session) {
  const cost = session.costTracker.getCost(session.provider?.model);
  return [
    response.trim(),
    '',
    `---`,
    `Tokens: ${session.costTracker.inputTokens.toLocaleString()} in / ${session.costTracker.outputTokens.toLocaleString()} out`,
    `Turns: ${session.costTracker.turnCount}`,
    `Cost: $${cost.toFixed(4)}`,
  ].join('\n');
}

module.exports = { runBatchMode, readAllInput, parseBatchInput };
