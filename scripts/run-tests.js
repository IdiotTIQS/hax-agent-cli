import { spawn } from 'node:child_process';

const nodeArgs = [
  '--import', 'tsx',
  '--test',
  'test/smoke-test.test.ts',
  'test/public-api.test.ts',
  'test/pricing-fix.test.ts',
  'test/pricing-fallbacks.test.ts',
  'test/permissions-checker.test.ts',
  'test/cost-tracker.test.ts',
  'test/lsp.test.ts',
  'test/auth-manager.test.ts',
  'test/anthropic-provider.test.ts',
  'test/engine-system-prompt.test.ts',
  'test/engine-tool-result.test.ts',
  'test/tui-ink-markdown.test.ts',
  'test/tui-ink-completions.test.ts',
  'test/tui-ink-reducer.test.ts',
];

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
