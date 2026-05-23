'use strict';

// Cross-platform test runner — finds all *.test.js files and runs them via node --test.
// npm scripts with quoted globs fail on Linux CI because the shell doesn't
// expand them, and Node 18 --test doesn't support ** globs.
//
// Usage: node scripts/run-tests.js [prefix-filter]

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const prefix = process.argv[2] || '';

function collectTestFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTestFiles(full));
    } else if (entry.name.endsWith('.test.js') || entry.name.endsWith('.smoke.js')) {
      results.push(full);
    }
  }
  return results;
}

const testDir = path.join(__dirname, '..', 'test');
let files = collectTestFiles(testDir).map(f => path.relative(process.cwd(), f));

if (prefix) {
  const normalized = prefix.replace(/\\/g, '/');
  files = files.filter(f => f.replace(/\\/g, '/').startsWith(normalized));
}

if (files.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

const nodeArgs = ['--test'];

// --test-timeout kills individual tests that leak async resources.
// Supported since Node 20.10.  Ignored (with warning) on older versions.
const major = parseInt(process.versions.node.split('.')[0], 10);
const minor = parseInt(process.versions.node.split('.')[1], 10);
if (major > 20 || (major === 20 && minor >= 10)) {
  nodeArgs.push('--test-timeout=15000');
}

nodeArgs.push(...files);

const cp = spawn(process.execPath, nodeArgs, {
  stdio: 'inherit',
  shell: false,
});

// Global safety net: kill the entire process tree after 5 minutes.
// Some test files hang in teardown even with --test-timeout.
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
