const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { _electron: electron } = require('playwright-core');

const projectRoot = path.resolve(__dirname, '..');

test('desktop app launches built renderer and exposes preload bridge', async (t) => {
  const distIndex = path.join(projectRoot, 'desktop', 'renderer', 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    t.skip('desktop renderer is not built; run npm run desktop:build first');
    return;
  }

  const electronPath = require('electron');
  const app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(projectRoot, 'desktop', 'main', 'index.js')],
    cwd: projectRoot,
    env: {
      ...process.env,
      HAX_AGENT_DESKTOP_MODE: 'production',
      HAX_AGENT_PROVIDER: 'mock',
    },
  });

  t.after(async () => {
    await app.close();
  });

  const window = await app.firstWindow();
  await window.waitForSelector('.sidebar-brand', { timeout: 15_000 });

  const bridge = await window.evaluate(() => ({
    title: document.title,
    hasCreateSession: typeof window.haxAgent?.createSession === 'function',
    hasOpenExternal: typeof window.haxAgent?.openExternal === 'function',
    hasSnapshot: typeof window.haxAgent?.getWorkspaceSnapshot === 'function',
    text: document.body.innerText,
  }));

  assert.match(bridge.title, /Hax Agent/);
  assert.equal(bridge.hasCreateSession, true);
  assert.equal(bridge.hasOpenExternal, true);
  assert.equal(bridge.hasSnapshot, true);
  assert.match(bridge.text, /Hax Agent/);
});
