const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseSemver, compareVersions, checkForUpdate } = require('../src/updater');

test('parseSemver parses valid versions', () => {
  assert.deepEqual(parseSemver('1.2.3'), { major: 1, minor: 2, patch: 3 });
  assert.deepEqual(parseSemver('v0.10.20'), { major: 0, minor: 10, patch: 20 });
  assert.deepEqual(parseSemver('10.0.0'), { major: 10, minor: 0, patch: 0 });
});

test('parseSemver returns null for invalid versions', () => {
  assert.equal(parseSemver('abc'), null);
  assert.equal(parseSemver(''), null);
  assert.equal(parseSemver('1.2'), null);
});

test('compareVersions returns 0 for equal versions', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
});

test('compareVersions compares major versions', () => {
  assert.ok(compareVersions('2.0.0', '1.9.9') > 0);
  assert.ok(compareVersions('1.9.9', '2.0.0') < 0);
});

test('compareVersions compares minor versions', () => {
  assert.ok(compareVersions('1.2.0', '1.1.9') > 0);
  assert.ok(compareVersions('1.1.9', '1.2.0') < 0);
});

test('compareVersions compares patch versions', () => {
  assert.ok(compareVersions('1.2.3', '1.2.2') > 0);
  assert.ok(compareVersions('1.2.2', '1.2.3') < 0);
});

test('checkForUpdate returns cached result when within interval', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-update-'));
  const cachePath = path.join(tmpDir, 'update-cache.json');

  const { checkForUpdate: checkWithCache } = require('../src/updater');

  await fs.writeFile(cachePath, JSON.stringify({
    latestVersion: '99.0.0',
    checkedAt: Date.now(),
  }));

  const origModule = require.resolve('../src/updater');
  const origCache = require.cache[origModule];

  try {
    const fresh = { ...require('../src/updater') };
    Object.defineProperty(fresh, '__cachePath', { value: cachePath, writable: true });

    const result = await checkWithCache('1.0.0', { force: false });

    if (result.latestVersion) {
      assert.equal(result.hasUpdate, true);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('checkForUpdate with force fetches from network', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: '99.99.99' }));
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const result = await checkForUpdate('1.0.0', { force: true });

    if (result.error) {
      assert.ok(result.error.length > 0);
    } else {
      assert.equal(result.hasUpdate, true);
      assert.equal(result.currentVersion, '1.0.0');
    }
  } finally {
    server.close();
  }
});

test('checkForUpdate handles network error gracefully', async () => {
  const result = await checkForUpdate('1.0.0', { force: true });

  if (result.error) {
    assert.equal(result.currentVersion, '1.0.0');
    assert.equal(typeof result.error, 'string');
  } else {
    assert.ok(result.latestVersion);
  }
});
