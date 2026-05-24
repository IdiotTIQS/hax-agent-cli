"use strict";

const { spawn } = require('node:child_process');
const path = require('node:path');
const { ToolExecutionError } = require('./error');

/**
 * CLI test harness — spawns the HaxAgent CLI and sends commands/text to it.
 * Returns captured output so the caller can verify behavior.
 */

const CLI_ENTRY = path.join(__dirname, '..', 'cli.js');
const DEFAULT_TIMEOUT_MS = 30_000;

function createCliTestTool() {
  return {
    name: 'CliTest',
    description: 'Test the HaxAgent CLI by spawning it in a subprocess, sending input lines, and capturing the output. Use this to verify CLI behavior such as slash commands (/config, /help), chat messages, paste handling, and rendering.',
    inputSchema: {
      type: 'object',
      required: ['inputs'],
      properties: {
        inputs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lines of input to send to the CLI. Each string is sent as a line (like typing it and pressing Enter).',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the CLI process. Defaults to the current working directory.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Maximum time to wait for the CLI to produce output after the last input. Default 15000ms.',
        },
      },
    },
    async execute(args) {
      const inputs = Array.isArray(args.inputs) ? args.inputs.filter(s => typeof s === 'string') : [];
      if (inputs.length === 0) {
        throw new ToolExecutionError('INVALID_INPUT', 'At least one input line is required.');
      }

      const cwd = typeof args.cwd === 'string' ? path.resolve(args.cwd) : process.cwd();
      const timeoutMs = Number.isFinite(args.timeoutMs) ? args.timeoutMs : DEFAULT_TIMEOUT_MS;

      const cp = spawn(process.execPath, [CLI_ENTRY, '--no-color'], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      });

      let stdout = '';
      let stderr = '';
      cp.stdout.setEncoding('utf8');
      cp.stderr.setEncoding('utf8');

      cp.stdout.on('data', (d) => { stdout += d; });
      cp.stderr.on('data', (d) => { stderr += d; });

      // Send inputs with a short delay between each to let the CLI process them
      for (const line of inputs) {
        await sleep(300);
        if (cp.exitCode !== null) break;
        cp.stdin.write(line + '\n');
      }

      // Wait for output to settle
      const result = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          cp.kill('SIGTERM');
          setTimeout(() => { if (cp.exitCode === null) cp.kill('SIGKILL'); }, 2000);
          resolve({ timedOut: true });
        }, timeoutMs);

        cp.on('exit', (code) => {
          clearTimeout(timer);
          resolve({ exitCode: code });
        });
      });

      // Strip ANSI escape codes for clean output
      const clean = (s) => s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B\[\?25[hl]/g, '');

      return {
        inputs,
        exitCode: result.exitCode ?? null,
        timedOut: result.timedOut || false,
        stdout: clean(stdout),
        stderr: clean(stderr),
        snippet: clean(stdout).split('\n').slice(-30).join('\n'),
      };
    },
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { createCliTestTool };
