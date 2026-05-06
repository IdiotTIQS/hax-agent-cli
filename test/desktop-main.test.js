const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { config, memory } = require('../src');
const {
  normalizeSettingsUpdates,
  openExternalUrl,
  readSessionList,
  readWorkspaceTree,
  registerIpcHandlers,
} = require('../desktop/main/index.js');

function createTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hax-agent-desktop-'));
}

function createFakeIpc() {
  const handlers = new Map();

  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };
}

test('desktop main registers IPC handlers and creates mock sessions', async () => {
  const projectRoot = createTempProject();
  const ipc = createFakeIpc();

  registerIpcHandlers(ipc);

  assert.ok(ipc.handlers.has('agent:createSession'));
  assert.ok(ipc.handlers.has('agent:resumeSession'));
  assert.ok(ipc.handlers.has('workspace:getSnapshot'));
  assert.ok(ipc.handlers.has('skills:getSnapshot'));
  assert.ok(ipc.handlers.has('tools:getSnapshot'));
  assert.ok(ipc.handlers.has('permissions:getSnapshot'));
  assert.ok(ipc.handlers.has('team:getSnapshot'));
  assert.ok(ipc.handlers.has('shell:openExternal'));

  const created = await ipc.handlers.get('agent:createSession')(null, {
    projectRoot,
    settings: { agent: { provider: 'mock' } },
  });

  assert.equal(typeof created.id, 'string');
  assert.equal(created.provider.name, 'mock');
  assert.ok(created.settings.agent.apiKey === undefined || created.settings.agent.apiKey === '***');
});

test('desktop external links only open http and https URLs', async () => {
  const opened = [];
  const opener = {
    async openExternal(url) {
      opened.push(url);
    },
  };

  const result = await openExternalUrl('https://example.com/path', opener);

  assert.deepEqual(result, { opened: true, url: 'https://example.com/path' });
  assert.deepEqual(opened, ['https://example.com/path']);
  await assert.rejects(() => openExternalUrl('javascript:alert(1)', opener), /Unsupported external URL protocol/);
  await assert.rejects(() => openExternalUrl('file:///etc/passwd', opener), /Unsupported external URL protocol/);
});

test('desktop workspace snapshot reads real files and hides mock transcripts', async () => {
  const projectRoot = createTempProject();
  const settings = config.loadSettings({ projectRoot, env: {} });
  const ipc = createFakeIpc();

  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'src', 'index.js'), 'console.log("hello");\n');
  fs.mkdirSync(path.join(projectRoot, '.hax-agent'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.hax-agent', 'hidden.txt'), 'hidden\n');

  memory.writeTranscript('real-session', [
    { timestamp: new Date().toISOString(), role: 'user', content: 'Build a UI' },
    { timestamp: new Date().toISOString(), role: 'assistant', content: 'Done.' },
  ], settings);
  memory.writeTranscript('mock-session', [
    { timestamp: new Date().toISOString(), role: 'user', content: 'first message' },
    {
      timestamp: new Date().toISOString(),
      role: 'assistant',
      content: 'I’m in local mock mode right now, so I can’t answer with a real model yet.',
    },
  ], settings);

  registerIpcHandlers(ipc);
  const snapshot = await ipc.handlers.get('workspace:getSnapshot')(null, { projectRoot });

  assert.equal(snapshot.projectRoot, path.resolve(projectRoot));
  assert.ok(snapshot.fileTree.some((node) => node.name === 'src'));
  assert.equal(snapshot.fileTree.some((node) => node.name === '.hax-agent'), false);
  assert.deepEqual(snapshot.sessions.map((session) => session.preview), ['Build a UI']);
});

test('desktop session list summarizes latest useful user message', () => {
  const projectRoot = createTempProject();
  const settings = config.loadSettings({ projectRoot, env: {} });

  memory.writeTranscript('summary-session', [
    { timestamp: new Date().toISOString(), role: 'user', content: 'Initial request' },
    { timestamp: new Date().toISOString(), role: 'assistant', content: 'OK' },
    { timestamp: new Date().toISOString(), role: 'user', content: 'Latest follow up' },
  ], settings);

  const [session] = readSessionList(settings);

  assert.equal(session.title, 'Initial request');
  assert.equal(session.preview, 'Latest follow up');
});

test('desktop settings updates normalize renderer form fields', () => {
  assert.deepEqual(normalizeSettingsUpdates({
    provider: 'openai',
    model: 'gpt-4.1',
    temperature: 0.4,
    workspace: 'ignored',
  }), {
    agent: {
      provider: 'openai',
      model: 'gpt-4.1',
      temperature: 0.4,
    },
  });
});

test('desktop workspace tree keeps files as leaves', () => {
  const projectRoot = createTempProject();
  fs.mkdirSync(path.join(projectRoot, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'nested', 'file.txt'), 'x');

  const tree = readWorkspaceTree(projectRoot);
  const nested = tree.find((node) => node.name === 'nested');
  const file = nested.children.find((node) => node.name === 'file.txt');

  assert.equal(nested.type, 'directory');
  assert.equal(file.type, 'file');
  assert.equal('children' in file, false);
});

test('desktop insight snapshots expose skills, tools, permissions, and teams', async () => {
  const projectRoot = createTempProject();
  const settings = config.loadSettings({ projectRoot, env: {} });
  const ipc = createFakeIpc();

  fs.mkdirSync(path.join(projectRoot, '.hax-agent', 'skills', 'demo-skill'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.hax-agent', 'skills', 'demo-skill', 'SKILL.md'), `---\nname: demo-skill\ndescription: Demo skill\nallowed-tools:\n  - file.read\n---\n# Demo Skill\nUse when demoing the UI.\n`);

  fs.mkdirSync(path.join(projectRoot, '.hax-agent'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.hax-agent', 'permissions.json'), JSON.stringify({
    mode: 'ask',
    alwaysAllow: ['file.read'],
    alwaysDeny: ['file.delete'],
  }, null, 2));

  fs.mkdirSync(path.join(projectRoot, '.hax-agent', 'teams'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.hax-agent', 'teams', 'demo.json'), JSON.stringify({
    version: 1,
    teamName: 'demo',
    mission: 'Demo mission',
    leadAgentId: 'lead@demo',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    members: [],
    tasks: [],
    messages: [],
    runs: [],
  }, null, 2));

  registerIpcHandlers(ipc);

  const skills = await ipc.handlers.get('skills:getSnapshot')(null, { projectRoot });
  const tools = await ipc.handlers.get('tools:getSnapshot')(null, { projectRoot });
  const permissions = await ipc.handlers.get('permissions:getSnapshot')(null, { projectRoot });
  const teams = await ipc.handlers.get('team:getSnapshot')(null, { projectRoot });

  assert.ok(skills.total >= 1);
  assert.ok(skills.skills.some((skill) => skill.name === 'skillify'));
  assert.ok(tools.total > 0);
  assert.equal(permissions.mode, 'ask');
  assert.ok(Array.isArray(permissions.toolPermissions));
  assert.ok(Array.isArray(teams.teams));
  assert.ok(teams.teams.some((team) => team.name === 'demo'));
});
