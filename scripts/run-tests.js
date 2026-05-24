'use strict';

// Cross-platform test runner — finds all *.test.js files and runs them via node --test.
// npm scripts with quoted globs fail on Linux CI because the shell doesn't
// expand them, and Node 18 --test doesn't support ** globs.
//
// Usage: node scripts/run-tests.js [prefix-filter]

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const useSerial = args.includes('--serial');
const prefix = args.filter(a => a !== '--serial')[0] || '';

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

if (useSerial) {
  // Run each test file in its own process to isolate global state
  runSerial(nodeArgs);
} else {
  runParallel(nodeArgs);
}

function runParallel(nodeArgs) {
  const cp = spawn(process.execPath, nodeArgs, {
    stdio: 'inherit',
    shell: false,
  });

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
}

async function runSerial(nodeArgs) {
  const files = [];
  const flags = [];
  for (const arg of nodeArgs) {
    if (arg.startsWith('--')) flags.push(arg);
    else files.push(arg);
  }

  let totalPass = 0;
  let totalFail = 0;
  let totalSkipped = 0;
  const failures = [];

  for (const file of files) {
    const cp = spawn(process.execPath, [...flags, file], {
      stdio: 'pipe',
      shell: false,
    });

    let stdout = '';
    cp.stdout.on('data', (d) => { stdout += d.toString(); });

    const exitCode = await new Promise((resolve) => {
      cp.on('exit', (code) => resolve(code || 0));
      cp.on('error', () => resolve(1));
    });

    // Parse TAP summary
    const passMatch = stdout.match(/# pass (\d+)/);
    const failMatch = stdout.match(/# fail (\d+)/);
    const skipMatch = stdout.match(/# skipped (\d+)/);

    const pass = passMatch ? parseInt(passMatch[1], 10) : 0;
    const fail = failMatch ? parseInt(failMatch[1], 10) : 0;
    const skipped = skipMatch ? parseInt(skipMatch[1], 10) : 0;

    totalPass += pass;
    totalFail += fail;
    totalSkipped += skipped;

    // Stream output if there are failures
    if (fail > 0 || exitCode !== 0) {
      failures.push(file);
      process.stdout.write(stdout);
    }

    // Show progress
    const label = path.basename(file);
    const status = fail === 0 && exitCode === 0 ? 'OK' : 'FAIL';
    process.stdout.write(`  ${status.padEnd(5)} ${label}  (${pass} pass, ${fail} fail${skipped > 0 ? ', ' + skipped + ' skip' : ''})\n`);
  }

  const totalTests = totalPass + totalFail;
  console.error(`\n1..${totalTests}`);
  console.error(`# tests ${totalTests}`);
  console.error(`# pass ${totalPass}`);
  console.error(`# fail ${totalFail}`);
  if (totalSkipped > 0) console.error(`# skipped ${totalSkipped}`);

  if (failures.length > 0) {
    console.error(`\n[run-tests --serial] ${failures.length} file(s) had failures:`);
    for (const f of failures) console.error(`  ${f}`);
  }

  process.exit(totalFail > 0 ? 1 : 0);
}
