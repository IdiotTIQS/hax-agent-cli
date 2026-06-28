'use strict';

// Simple test runner: node --test test/smoke-test.test.js test/public-api.test.js
// Usage: node scripts/run-tests.js

const { spawn } = require('node:child_process');

const nodeArgs = ['--test', 'test/smoke-test.test.js', 'test/public-api.test.js', 'test/pricing-fix.test.js', 'test/pricing-fallbacks.test.js', 'test/permissions-checker.test.js', 'test/cost-tracker.test.js', 'test/anthropic-provider.test.js', 'test/engine-system-prompt.test.js', 'test/engine-tool-result.test.js'];

const major = parseInt(process.versions.node.split('.')[0], 10);
const minor = parseInt(process.versions.node.split('.')[1], 10);
if (major > 20 || (major === 20 && minor >= 10)) {
  nodeArgs.unshift('--test-timeout=15000');
}

const cp = spawn(process.execPath, nodeArgs, { stdio: 'inherit', shell: false });

const GLOBAL_TIMEOUT_MS = 300_000;
const killer = setTimeout(() => {
  console.error('\n[run-tests] Global timeout reached — aborting.\n');
  cp.kill('SIGTERM');
  setTimeout(() => cp.kill('SIGKILL'), 5000);
}, GLOBAL_TIMEOUT_MS);

cp.on('exit', (code) => {
  clearTimeout(killer);
  process.exit(code || 0);
});
