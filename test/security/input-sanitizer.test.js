'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {
  sanitizeFilePath,
  sanitizeShellArg,
  sanitizeHtmlContent,
  sanitizeJsonString,
  validateUrl,
  validateEmail,
  redactSecrets,
  getDefaultSecretPatterns,
  isPrivateHost,
  isPrivateIPv4,
} = require('../../src/security/input-sanitizer');

// -------------------------------------------------------------------------
// sanitizeFilePath
// -------------------------------------------------------------------------

test('sanitizeFilePath removes path traversal sequences', () => {
  assert.strictEqual(
    path.normalize(sanitizeFilePath('foo/../../../etc/passwd')),
    path.normalize('foo/etc/passwd'),
  );
  assert.strictEqual(
    path.normalize(sanitizeFilePath('../../etc/passwd')),
    path.normalize('etc/passwd'),
  );
});

test('sanitizeFilePath removes null bytes', () => {
  const result = sanitizeFilePath('foo\x00bar\x00baz.txt');
  assert.strictEqual(result.includes('\x00'), false);
  assert.strictEqual(result, path.normalize('foobarbaz.txt'));
});

test('sanitizeFilePath normalizes backslashes and multiple slashes', () => {
  const result = sanitizeFilePath('foo\\\\bar///baz');
  assert.strictEqual(result, path.normalize('foo/bar/baz'));
});

test('sanitizeFilePath removes control characters', () => {
  const result = sanitizeFilePath('hello\x01\x02\x03world.txt');
  assert.strictEqual(result, 'helloworld.txt');
});

test('sanitizeFilePath throws on non-string input', () => {
  assert.throws(() => sanitizeFilePath(null), TypeError);
  assert.throws(() => sanitizeFilePath(123), TypeError);
  assert.throws(() => sanitizeFilePath({}), TypeError);
});

// -------------------------------------------------------------------------
// sanitizeShellArg
// -------------------------------------------------------------------------

test('sanitizeShellArg removes shell metacharacters', () => {
  assert.strictEqual(sanitizeShellArg('hello; rm -rf /'), 'hello rm -rf /');
  assert.strictEqual(sanitizeShellArg('$(whoami)'), 'whoami');
  assert.strictEqual(sanitizeShellArg('`id`'), 'id');
  assert.strictEqual(sanitizeShellArg('foo|bar'), 'foobar');
  assert.strictEqual(sanitizeShellArg('a&b'), 'ab');
});

test('sanitizeShellArg removes newlines and null bytes', () => {
  assert.strictEqual(sanitizeShellArg('hello\nworld'), 'hello world');
  assert.strictEqual(sanitizeShellArg('foo\x00bar'), 'foobar');
});

test('sanitizeShellArg collapses multiple spaces', () => {
  assert.strictEqual(sanitizeShellArg('echo   hello    world'), 'echo hello world');
});

// -------------------------------------------------------------------------
// sanitizeHtmlContent
// -------------------------------------------------------------------------

test('sanitizeHtmlContent removes script tags', () => {
  const result = sanitizeHtmlContent('<p>Hello</p><script>alert("xss")</script><div>World</div>');
  assert.strictEqual(result, '<p>Hello</p><div>World</div>');
});

test('sanitizeHtmlContent removes event handler attributes', () => {
  const result = sanitizeHtmlContent('<div onclick="alert(1)" class="foo">text</div>');
  assert.strictEqual(result, '<div class="foo">text</div>');
});

test('sanitizeHtmlContent removes javascript: URLs', () => {
  const result = sanitizeHtmlContent('<a href="javascript:alert(1)">click</a>');
  assert.strictEqual(result, '<a href="blocked:alert(1)">click</a>');
});

// -------------------------------------------------------------------------
// sanitizeJsonString
// -------------------------------------------------------------------------

test('sanitizeJsonString escapes backslash and quote', () => {
  assert.strictEqual(sanitizeJsonString('hello "world"'), 'hello \\"world\\"');
  assert.strictEqual(sanitizeJsonString('a\\b'), 'a\\\\b');
});

test('sanitizeJsonString escapes control characters', () => {
  const result = sanitizeJsonString('hello\x00world');
  assert.strictEqual(result, 'hello\\u0000world');
});

// -------------------------------------------------------------------------
// validateUrl
// -------------------------------------------------------------------------

test('validateUrl accepts valid HTTPS URLs', () => {
  const result = validateUrl('https://example.com/path?q=1');
  assert.strictEqual(result.valid, true);
  assert.ok(result.url instanceof URL);
});

test('validateUrl blocks file:// and data:// protocols', () => {
  assert.strictEqual(validateUrl('file:///etc/passwd').valid, false);
  assert.strictEqual(validateUrl('data:text/html,<script>alert(1)</script>').valid, false);
  assert.strictEqual(validateUrl('javascript:alert(1)').valid, false);
});

test('validateUrl blocks private and loopback IPs', () => {
  assert.strictEqual(validateUrl('http://127.0.0.1:3000').valid, false);
  assert.strictEqual(validateUrl('http://localhost:8080').valid, false);
  assert.strictEqual(validateUrl('http://192.168.1.1').valid, false);
  assert.strictEqual(validateUrl('http://10.0.0.1').valid, false);
  assert.strictEqual(validateUrl('http://[::1]/').valid, false);
});

test('validateUrl blocks malformed URLs', () => {
  assert.strictEqual(validateUrl('not-a-url').valid, false);
  assert.strictEqual(validateUrl('').valid, false);
  assert.strictEqual(validateUrl('http://').valid, false);
});

test('validateUrl blocks URLs with null bytes', () => {
  assert.strictEqual(validateUrl('http://example.com\x00/evil').valid, false);
});

// -------------------------------------------------------------------------
// validateEmail
// -------------------------------------------------------------------------

test('validateEmail accepts valid email addresses', () => {
  assert.strictEqual(validateEmail('user@example.com').valid, true);
  assert.strictEqual(validateEmail('user.name+tag@example.co.uk').valid, true);
});

test('validateEmail rejects invalid formats', () => {
  assert.strictEqual(validateEmail('not-an-email').valid, false);
  assert.strictEqual(validateEmail('@example.com').valid, false);
  assert.strictEqual(validateEmail('user@').valid, false);
  assert.strictEqual(validateEmail('').valid, false);
});

test('validateEmail rejects overly long addresses', () => {
  const longLocal = 'a'.repeat(65) + '@example.com';
  assert.strictEqual(validateEmail(longLocal).valid, false);
});

// -------------------------------------------------------------------------
// redactSecrets
// -------------------------------------------------------------------------

test('redactSecrets redacts API keys', () => {
  const text = 'My key is sk-abc123def456ghi789jkl012mno345pqr678stu901vwx';
  const result = redactSecrets(text);
  assert.strictEqual(result.includes('sk-abc123'), false);
  assert.ok(result.includes('***REDACTED***'));
});

test('redactSecrets redacts bearer tokens', () => {
  const result = redactSecrets('Authorization: Bearer abcDEF1234567890');
  assert.strictEqual(result.includes('abcDEF1234567890'), false);
});

test('redactSecrets redacts key=value secrets', () => {
  const result = redactSecrets('api_key="my-super-secret-key"');
  assert.strictEqual(result.includes('my-super-secret-key'), false);
});

test('getDefaultSecretPatterns returns a copy', () => {
  const patterns = getDefaultSecretPatterns();
  assert.ok(Array.isArray(patterns));
  assert.ok(patterns.length > 0);
  // Should be a copy, not the same reference
  assert.notStrictEqual(patterns, getDefaultSecretPatterns());
});

// -------------------------------------------------------------------------
// isPrivateHost / isPrivateIPv4
// -------------------------------------------------------------------------

test('isPrivateHost detects private and local addresses', () => {
  assert.strictEqual(isPrivateHost('localhost'), true);
  assert.strictEqual(isPrivateHost('127.0.0.1'), true);
  assert.strictEqual(isPrivateHost('192.168.1.100'), true);
  assert.strictEqual(isPrivateHost('10.20.30.40'), true);
  assert.strictEqual(isPrivateHost('172.16.0.1'), true);
  assert.strictEqual(isPrivateHost('8.8.8.8'), false);
  assert.strictEqual(isPrivateHost('example.com'), false);
});

test('isPrivateIPv4 detects private ranges correctly', () => {
  assert.strictEqual(isPrivateIPv4('10.0.0.1'), true);
  assert.strictEqual(isPrivateIPv4('127.0.0.1'), true);
  assert.strictEqual(isPrivateIPv4('192.168.1.1'), true);
  assert.strictEqual(isPrivateIPv4('172.16.0.1'), true);
  assert.strictEqual(isPrivateIPv4('169.254.1.1'), true);
  assert.strictEqual(isPrivateIPv4('8.8.8.8'), false);
  assert.strictEqual(isPrivateIPv4('1.1.1.1'), false);
});
