#!/usr/bin/env node
// scripts/smoke-esm.js — CommonJS build script (runs before ESM migration completes)
// Smoke-tests a batch of .js files by importing each through tsx to catch load-time errors.
// Usage: node scripts/smoke-esm.js <dir-or-file> [...]
// Prints: OK <file> / FAIL <file>; exits non-zero if any failed.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

/**
 * Recursively collect all .js files under a directory, or return [filePath] for a single file.
 * @param {string} target - absolute or relative path to a file or directory
 * @returns {string[]} absolute file paths
 */
function collectFiles(target) {
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) {
    console.error(`smoke-esm: path not found: ${abs}`);
    return [];
  }
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    return abs.endsWith('.js') ? [abs] : [];
  }
  // Directory: recurse
  const results = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const full = path.join(abs, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Import a single file via tsx and report OK/FAIL.
 * Writes a tiny runner script to a temp file to avoid shell-quoting issues with
 * file:// URLs on Windows (the colon and slashes get mangled when passed via -e through shell:true).
 * @param {string} absFile - absolute path to the .js file
 * @returns {boolean} true if load succeeded
 */
function smokeFile(absFile) {
  const fileUrl = pathToFileURL(absFile).href;
  // Write the runner to a temp .mjs so tsx gets it via a file arg (no shell quoting of the URL).
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `smoke-esm-runner-${process.pid}-${Date.now()}.mjs`);
  // The runner is ESM (.mjs) so dynamic import() works naturally.
  const code = [
    `import(${JSON.stringify(fileUrl)})`,
    `  .then(() => process.exit(0))`,
    `  .catch(e => { console.error(e); process.exit(1); })`,
  ].join('\n');

  try {
    fs.writeFileSync(tmpFile, code, 'utf8');
    // We use tsx so that ESM and CJS .js files both load regardless of package.json "type".
    const result = spawnSync(
      'npx',
      ['--yes', 'tsx', tmpFile],
      {
        cwd: path.resolve(__dirname, '..'),
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        // shell:true is required on Windows so that npx resolves to npx.cmd via PATH
        shell: true,
        // Give each file up to 30 seconds — tsx startup is slow on first cold run
        timeout: 30000,
      }
    );

    const ok = result.status === 0 && result.error == null;
    if (ok) {
      console.log(`OK   ${absFile}`);
    } else {
      const stderr = (result.stderr || '').trim();
      const stdout = (result.stdout || '').trim();
      console.error(`FAIL ${absFile}`);
      if (stderr) console.error(`     stderr: ${stderr.split('\n')[0]}`);
      if (stdout) console.error(`     stdout: ${stdout.split('\n')[0]}`);
      if (result.error) console.error(`     spawn error: ${result.error.message}`);
    }
    return ok;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore cleanup errors */ }
  }
}

// --- main ---
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/smoke-esm.js <dir-or-file> [...]');
  process.exit(1);
}

const files = args.flatMap(collectFiles);
if (files.length === 0) {
  console.error('smoke-esm: no .js files found for the given arguments');
  process.exit(1);
}

console.log(`smoke-esm: testing ${files.length} file(s)...\n`);
let failures = 0;
for (const f of files) {
  if (!smokeFile(f)) failures++;
}

console.log(`\nsmoke-esm: ${files.length - failures}/${files.length} passed`);
if (failures > 0) {
  console.error(`smoke-esm: ${failures} file(s) failed`);
  process.exit(1);
}
process.exit(0);
