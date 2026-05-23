'use strict';

// Cross-platform test runner — finds all *.test.js (and optionally *.smoke.js)
// files and runs them via node --test.
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
  files = files.filter(f => f.startsWith(prefix));
}

if (files.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

const cp = spawn(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  shell: false,
});

cp.on('exit', (code) => process.exit(code || 0));
