'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { SandboxExecutor, SandboxError } = require('../../src/sandbox/executor');
const { SandboxPolicy } = require('../../src/sandbox/policy');

// ---------------------------------------------------------------------------
// Construction & defaults
// ---------------------------------------------------------------------------

test('SandboxExecutor constructs with defaults', () => {
  const executor = new SandboxExecutor();
  assert.ok(executor.getPolicy() instanceof SandboxPolicy);
  assert.strictEqual(executor.getPolicy().name, 'STRICT');
  const stats = executor.getStats();
  assert.strictEqual(stats.totalExecutions, 0);
  assert.strictEqual(stats.totalShellExecutions, 0);
  assert.strictEqual(stats.totalErrors, 0);
  assert.strictEqual(stats.totalTimeouts, 0);
});

test('SandboxExecutor accepts a custom policy', () => {
  const executor = new SandboxExecutor({ policy: SandboxPolicy.UNRESTRICTED });
  assert.strictEqual(executor.getPolicy().name, 'UNRESTRICTED');
});

// ---------------------------------------------------------------------------
// setPolicy / getPolicy
// ---------------------------------------------------------------------------

test('setPolicy replaces active policy', () => {
  const executor = new SandboxExecutor();
  assert.strictEqual(executor.getPolicy().name, 'STRICT');
  executor.setPolicy(SandboxPolicy.READ_ONLY);
  assert.strictEqual(executor.getPolicy().name, 'READ_ONLY');
});

test('setPolicy rejects non-SandboxPolicy values', () => {
  const executor = new SandboxExecutor();
  assert.throws(() => executor.setPolicy({}), { name: 'TypeError' });
  assert.throws(() => executor.setPolicy(null), { name: 'TypeError' });
});

// ---------------------------------------------------------------------------
// run — basic JS execution
// ---------------------------------------------------------------------------

test('run executes simple code', () => {
  const executor = new SandboxExecutor({ policy: SandboxPolicy.UNRESTRICTED });
  const result = executor.run('2 + 2');
  assert.strictEqual(result.result, 4);
  assert.ok(result.cpuUsage);
  assert.ok(typeof result.memoryDelta === 'number');
});

test('run captures console output', () => {
  const executor = new SandboxExecutor({ policy: SandboxPolicy.UNRESTRICTED });
  const result = executor.run('console.log("a"); console.warn("b");');
  assert.strictEqual(result.output.stdout[0], 'a');
  assert.strictEqual(result.output.stderr[0], 'b');
});

// ---------------------------------------------------------------------------
// run — STRICT policy blocks everything
// ---------------------------------------------------------------------------

test('run with STRICT policy blocks fs access', () => {
  const executor = new SandboxExecutor({ policy: SandboxPolicy.STRICT });
  assert.throws(
    () => executor.run('fs.readFileSync("test")'),
    (err) => err.message.includes('fs is not defined') || err.code === 'SANDBOX_ERROR',
  );
});

// ---------------------------------------------------------------------------
// run — timeout enforcement
// ---------------------------------------------------------------------------

test('run enforces timeout on infinite loops', () => {
  const executor = new SandboxExecutor({
    policy: SandboxPolicy.UNRESTRICTED,
    defaultTimeoutMs: 500,
  });
  assert.throws(
    () => executor.run('while(true) {}'),
    (err) => err instanceof SandboxError && err.code === 'SANDBOX_TIMEOUT',
  );
});

test('run timeout can be overridden per call', () => {
  const executor = new SandboxExecutor({
    policy: SandboxPolicy.UNRESTRICTED,
    defaultTimeoutMs: 500,
  });
  // A call with a longer timeout should still succeed
  const result = executor.run('42', { timeoutMs: 5000 });
  assert.strictEqual(result.result, 42);
});

// ---------------------------------------------------------------------------
// run — output size enforcement
// ---------------------------------------------------------------------------

test('run enforces maxOutput on captured console', () => {
  const executor = new SandboxExecutor({
    policy: SandboxPolicy.UNRESTRICTED,
    defaultMaxOutput: 100,
  });
  assert.throws(
    () => {
      // Generate a lot of console output
      executor.run('for (let i = 0; i < 50; i++) console.log("x".repeat(50));');
    },
    (err) => err instanceof SandboxError && err.code === 'SANDBOX_OUTPUT_EXCEEDED',
  );
});

// ---------------------------------------------------------------------------
// run — memory enforcement
// ---------------------------------------------------------------------------

test('run enforces memory limit', () => {
  const policy = new SandboxPolicy('low-mem', {
    allowedModules: ['*'],
    allowedCommands: ['*'],
    allowedDomains: ['*'],
    resourceLimits: { maxMemory: 1024 }, // 1 KiB — extremely low
  });
  const executor = new SandboxExecutor({ policy });
  // Allocating a large array should exceed the memory limit
  assert.throws(
    () => executor.run('new Array(100000).fill(0)'),
    (err) => err instanceof SandboxError && err.code === 'SANDBOX_MEMORY_EXCEEDED',
  );
});

// ---------------------------------------------------------------------------
// run — module injection via policy
// ---------------------------------------------------------------------------

test('run injects allowed modules', () => {
  const policy = new SandboxPolicy('fs-only', {
    allowedModules: ['fs', 'path'],
  });
  const executor = new SandboxExecutor({ policy });
  // fs is allowed — should be available
  const result = executor.run('typeof fs');
  assert.strictEqual(result.result, 'object');
  // path is allowed
  const result2 = executor.run('typeof path');
  assert.strictEqual(result2.result, 'object');
  // os is NOT allowed — should be undefined
  const result3 = executor.run('typeof os');
  assert.strictEqual(result3.result, 'undefined');
});

// ---------------------------------------------------------------------------
// runShell
// ---------------------------------------------------------------------------

test('runShell executes an allowed command', async () => {
  const executor = new SandboxExecutor({ policy: SandboxPolicy.UNRESTRICTED });
  // node is universally available
  const result = await executor.runShell('node', { args: ['-e', 'process.stdout.write("hello")'] });

  assert.strictEqual(typeof result.exitCode, 'number');
  assert.strictEqual(result.timedOut, false);
  // On success, exit code should be 0 and stdout should contain our message
  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.stdout.includes('hello'));
});

test('runShell rejects forbidden commands', async () => {
  const executor = new SandboxExecutor({ policy: SandboxPolicy.STRICT });
  await assert.rejects(
    () => executor.runShell('ls'),
    (err) => err instanceof SandboxError && err.code === 'SHELL_COMMAND_DENIED',
  );
});

test('runShell rejects empty command', async () => {
  const executor = new SandboxExecutor({ policy: SandboxPolicy.UNRESTRICTED });
  await assert.rejects(
    () => executor.runShell(''),
    (err) => err instanceof SandboxError && err.code === 'SHELL_INVALID_COMMAND',
  );
});

test('runShell with READ_ONLY allows node but not rm', async () => {
  const executor = new SandboxExecutor({ policy: SandboxPolicy.READ_ONLY });
  // node is in the READ_ONLY whitelist on all platforms
  const result = await executor.runShell('node', { args: ['-e', '42'] });
  assert.strictEqual(result.exitCode, 0);

  // rm is NOT allowed
  await assert.rejects(
    () => executor.runShell('rm'),
    (err) => err instanceof SandboxError && err.code === 'SHELL_COMMAND_DENIED',
  );
});

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------

test('getStats tracks cumulative execution counts', () => {
  const executor = new SandboxExecutor({ policy: SandboxPolicy.UNRESTRICTED });
  executor.run('1');
  executor.run('2');
  executor.run('3');

  const stats = executor.getStats();
  assert.strictEqual(stats.totalExecutions, 3);
  assert.strictEqual(stats.totalErrors, 0);
  assert.strictEqual(stats.totalTimeouts, 0);
  assert.ok(stats.totalCpuUser >= 0);
  assert.ok(stats.totalOutputBytes >= 0);
  assert.ok(stats.lastExecutionAt !== null);
});

test('getStats tracks errors and timeouts', () => {
  const executor = new SandboxExecutor({
    policy: SandboxPolicy.UNRESTRICTED,
    defaultTimeoutMs: 300,
  });

  // First call succeeds
  executor.run('1');

  // Second call times out
  assert.throws(() => executor.run('while(true) {}'));

  // Third call throws a runtime error
  assert.throws(() => executor.run('throw new Error("fail")'));

  const stats = executor.getStats();
  assert.strictEqual(stats.totalExecutions, 3);
  assert.strictEqual(stats.totalErrors, 2);
  assert.strictEqual(stats.totalTimeouts, 1);
});

test('getStats tracks shell execution stats', async () => {
  const executor = new SandboxExecutor({ policy: SandboxPolicy.UNRESTRICTED });
  await executor.runShell('node', { args: ['-e', '1'] });

  const stats = executor.getStats();
  assert.strictEqual(stats.totalShellExecutions, 1);
});

// ---------------------------------------------------------------------------
// resetStats
// ---------------------------------------------------------------------------

test('resetStats zeros all counters', () => {
  const executor = new SandboxExecutor({ policy: SandboxPolicy.UNRESTRICTED });
  executor.run('1');
  executor.run('2');
  assert.strictEqual(executor.getStats().totalExecutions, 2);

  executor.resetStats();
  const stats = executor.getStats();
  assert.strictEqual(stats.totalExecutions, 0);
  assert.strictEqual(stats.totalErrors, 0);
  assert.strictEqual(stats.totalTimeouts, 0);
  assert.strictEqual(stats.totalCpuUser, 0);
  assert.strictEqual(stats.totalMemoryAllocated, 0);
});

// ---------------------------------------------------------------------------
// SandboxError
// ---------------------------------------------------------------------------

test('SandboxError has code and details', () => {
  const err = new SandboxError('TEST_CODE', 'test message', { key: 'val' });
  assert.strictEqual(err.name, 'SandboxError');
  assert.strictEqual(err.code, 'TEST_CODE');
  assert.strictEqual(err.message, 'test message');
  assert.deepStrictEqual(err.details, { key: 'val' });
  assert.ok(err instanceof Error);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('run handles empty code', () => {
  const executor = new SandboxExecutor({ policy: SandboxPolicy.UNRESTRICTED });
  const result = executor.run('');
  assert.strictEqual(result.result, undefined);
  assert.deepStrictEqual(result.output.stdout, []);
  assert.deepStrictEqual(result.output.stderr, []);
});

test('run with DEVELOPMENT policy allows crypto module', () => {
  const executor = new SandboxExecutor({ policy: SandboxPolicy.DEVELOPMENT });
  const result = executor.run('typeof crypto');
  // crypto should be injected since it is in the DEVELOPMENT allowed list
  assert.strictEqual(result.result, 'object');
});

test('run isolates globals between executions', () => {
  const executor = new SandboxExecutor({ policy: SandboxPolicy.UNRESTRICTED });
  executor.run('var x = 99;');
  // In a fresh sandbox, x should not exist
  assert.throws(
    () => executor.run('x + 1'),
    (err) => err.message.includes('x is not defined') || err.code === 'SANDBOX_ERROR',
  );
});

test('run with custom global injection', () => {
  const executor = new SandboxExecutor({ policy: SandboxPolicy.STRICT });
  const result = executor.run('myVal * 2', { globals: { myVal: 21 } });
  assert.strictEqual(result.result, 42);
});
