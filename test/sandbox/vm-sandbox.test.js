'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  createSandbox,
  runInSandbox,
  captureOutput,
  WHITELISTED_GLOBALS,
  BLOCKED_GLOBALS,
} = require('../../src/sandbox/vm-sandbox');

// ---------------------------------------------------------------------------
// captureOutput
// ---------------------------------------------------------------------------

test('captureOutput creates a console-like object', () => {
  const con = captureOutput();
  assert.strictEqual(typeof con.log, 'function');
  assert.strictEqual(typeof con.warn, 'function');
  assert.strictEqual(typeof con.error, 'function');
  assert.strictEqual(typeof con.info, 'function');
  assert.strictEqual(typeof con.debug, 'function');
  assert.ok(Array.isArray(con._stdout));
  assert.ok(Array.isArray(con._stderr));
});

test('captureOutput captures log calls to stdout', () => {
  const con = captureOutput();
  con.log('hello', 'world');
  con.info('info message');
  assert.strictEqual(con._stdout.length, 2);
  assert.strictEqual(con._stdout[0], 'hello world');
  assert.strictEqual(con._stdout[1], 'info message');
  assert.strictEqual(con._stderr.length, 0);
});

test('captureOutput captures warn/error to stderr', () => {
  const con = captureOutput();
  con.warn('warning');
  con.error(new Error('fail'));
  assert.strictEqual(con._stdout.length, 0);
  assert.strictEqual(con._stderr.length, 2);
  assert.strictEqual(con._stderr[0], 'warning');
  assert.ok(con._stderr[1].includes('fail'));
});

test('captureOutput serializes non-string arguments', () => {
  const con = captureOutput();
  con.log({ a: 1 });
  con.log([1, 2, 3]);
  con.log(42);
  assert.strictEqual(con._stdout[0], '{"a":1}');
  assert.strictEqual(con._stdout[1], '[1,2,3]');
  assert.strictEqual(con._stdout[2], '42');
});

// ---------------------------------------------------------------------------
// createSandbox
// ---------------------------------------------------------------------------

test('createSandbox includes whitelisted globals', () => {
  const sandbox = createSandbox();
  assert.strictEqual(sandbox.JSON, JSON);
  assert.strictEqual(sandbox.Math, Math);
  assert.strictEqual(sandbox.Date, Date);
  assert.strictEqual(sandbox.Buffer, Buffer);
  assert.strictEqual(sandbox.TextEncoder, TextEncoder);
  assert.strictEqual(sandbox.TextDecoder, TextDecoder);
  assert.strictEqual(sandbox.Promise, Promise);
});

test('createSandbox blocks dangerous globals', () => {
  const sandbox = createSandbox();
  assert.strictEqual(sandbox.require, undefined);
  assert.strictEqual(sandbox.process, undefined);
  assert.strictEqual(sandbox.global, undefined);
  assert.strictEqual(sandbox.module, undefined);
  assert.strictEqual(sandbox.exports, undefined);
  assert.strictEqual(sandbox.__dirname, undefined);
  assert.strictEqual(sandbox.__filename, undefined);
});

test('createSandbox provides captured console', () => {
  const sandbox = createSandbox();
  assert.ok(sandbox.console);
  assert.strictEqual(typeof sandbox.console.log, 'function');
  assert.strictEqual(typeof sandbox.console.error, 'function');
});

test('createSandbox injects extra modules', () => {
  const fakeModule = { doStuff: () => 'ok' };
  const sandbox = createSandbox({ modules: { mylib: fakeModule } });
  assert.strictEqual(sandbox.mylib, fakeModule);
});

test('createSandbox injects extra globals', () => {
  const sandbox = createSandbox({ globals: { answer: 42 } });
  assert.strictEqual(sandbox.answer, 42);
});

test('createSandbox does not allow overriding blocked globals via modules', () => {
  const sandbox = createSandbox({ modules: { process: {}, require: () => {} } });
  assert.strictEqual(sandbox.process, undefined);
  assert.strictEqual(sandbox.require, undefined);
});

// ---------------------------------------------------------------------------
// runInSandbox
// ---------------------------------------------------------------------------

test('runInSandbox executes simple code', () => {
  const sandbox = createSandbox();
  const result = runInSandbox('2 + 2', sandbox);
  assert.strictEqual(result.result, 4);
  assert.ok(result.cpuUsage);
  assert.ok(typeof result.memoryDelta === 'number');
});

test('runInSandbox captures console.log output', () => {
  const sandbox = createSandbox();
  const result = runInSandbox('console.log("hello"); console.log("world");', sandbox);
  assert.strictEqual(result.result, undefined);
  assert.deepStrictEqual(result.output.stdout, ['hello', 'world']);
  assert.deepStrictEqual(result.output.stderr, []);
});

test('runInSandbox captures console.error output', () => {
  const sandbox = createSandbox();
  const result = runInSandbox('console.error("oops"); console.warn("careful");', sandbox);
  assert.deepStrictEqual(result.output.stderr, ['oops', 'careful']);
  assert.deepStrictEqual(result.output.stdout, []);
});

test('runInSandbox blocks require', () => {
  const sandbox = createSandbox();
  assert.throws(
    () => runInSandbox('require("fs")', sandbox),
    (err) => err.message.includes('require is not defined') || err.code === 'SANDBOX_ERROR',
  );
});

test('runInSandbox blocks process access', () => {
  const sandbox = createSandbox();
  // process is undefined, so process.cwd() should throw
  assert.throws(
    () => runInSandbox('process.cwd()', sandbox),
    (err) => err.message.includes('Cannot read') || err.message.includes('undefined') || err.code === 'SANDBOX_ERROR',
  );
});

test('runInSandbox uses whitelisted globals correctly', () => {
  const sandbox = createSandbox();
  const result = runInSandbox('JSON.stringify({ a: Math.max(1, 2) })', sandbox);
  assert.strictEqual(result.result, '{"a":2}');
});

test('runInSandbox enforces timeout on infinite loops', () => {
  const sandbox = createSandbox();
  assert.throws(
    () => runInSandbox('while(true) {}', sandbox, 500),
    (err) => err.code === 'SANDBOX_TIMEOUT',
  );
});

test('runInSandbox handles syntax errors gracefully', () => {
  const sandbox = createSandbox();
  assert.throws(
    () => runInSandbox('{{{', sandbox),
    (err) => err.code === 'SANDBOX_ERROR' || err.message.includes('SyntaxError'),
  );
});

test('runInSandbox tracks memory and CPU usage', () => {
  const sandbox = createSandbox();
  const result = runInSandbox('const x = new Array(100).fill(0); x', sandbox);
  assert.ok(result.cpuUsage.user >= 0);
  assert.ok(result.cpuUsage.system >= 0);
  assert.ok(typeof result.memoryDelta === 'number');
  assert.strictEqual(result.timedOut, false);
});

test('runInSandbox returns result for complex code', () => {
  const sandbox = createSandbox();
  const code = `
    let sum = 0;
    for (let i = 0; i < 100; i++) sum += i;
    sum;
  `;
  const result = runInSandbox(code, sandbox);
  assert.strictEqual(result.result, 4950);
});

test('runInSandbox rejects non-string code', () => {
  const sandbox = createSandbox();
  assert.throws(
    () => runInSandbox(null, sandbox),
    (err) => err.code === 'SANDBOX_INVALID_CODE',
  );
  assert.throws(
    () => runInSandbox(123, sandbox),
    (err) => err.code === 'SANDBOX_INVALID_CODE',
  );
});

test('runInSandbox isolates each execution', () => {
  const sandboxA = createSandbox();
  runInSandbox('var secret = "a";', sandboxA);

  const sandboxB = createSandbox();
  // secret should not leak from sandboxA
  assert.throws(
    () => runInSandbox('secret', sandboxB),
    (err) => err.message.includes('secret is not defined') || err.code === 'SANDBOX_ERROR',
  );
});

test('runInSandbox supports Promise (but sync execution)', () => {
  const sandbox = createSandbox();
  const result = runInSandbox('Promise.resolve(42)', sandbox);
  // The result is a Promise object (since execution is synchronous)
  assert.ok(result.result instanceof Promise);
});

// ---------------------------------------------------------------------------
// WHITELISTED_GLOBALS / BLOCKED_GLOBALS
// ---------------------------------------------------------------------------

test('WHITELISTED_GLOBALS contains expected built-ins', () => {
  assert.ok('JSON' in WHITELISTED_GLOBALS);
  assert.ok('Math' in WHITELISTED_GLOBALS);
  assert.ok('Date' in WHITELISTED_GLOBALS);
  assert.ok('Buffer' in WHITELISTED_GLOBALS);
  assert.ok('Array' in WHITELISTED_GLOBALS);
  assert.ok('Object' in WHITELISTED_GLOBALS);
  assert.ok('Promise' in WHITELISTED_GLOBALS);
});

test('BLOCKED_GLOBALS contains dangerous globals', () => {
  assert.ok(BLOCKED_GLOBALS.has('require'));
  assert.ok(BLOCKED_GLOBALS.has('process'));
  assert.ok(BLOCKED_GLOBALS.has('global'));
  assert.ok(BLOCKED_GLOBALS.has('module'));
  assert.ok(BLOCKED_GLOBALS.has('__dirname'));
  assert.ok(BLOCKED_GLOBALS.has('__filename'));
});
