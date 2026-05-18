const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const { config, memory } = require('../src');
const {
  createDesktopApprovalPrompt,
  normalizeSettingsUpdates,
  openExternalUrl,
  registerIpcHandlers,
  resolvePendingApproval,
  resolvePendingApprovalsForSession,
  shouldOpenDevTools,
} = require('../desktop/main/index.js');
const {
  migrateLegacySessionRecords,
  readSessionList,
  readGitDiff,
  readGitStatus,
  readWorkspaceFile,
  readWorkspaceTree,
  searchWorkspaceContent,
} = require('../src/desktop-services');

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

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  }
  return result;
}

test('desktop main registers IPC handlers and creates mock sessions', async () => {
  const projectRoot = createTempProject();
  const ipc = createFakeIpc();

  registerIpcHandlers(ipc);

  assert.ok(ipc.handlers.has('agent:createSession'));
  assert.ok(ipc.handlers.has('agent:resumeSession'));
  assert.ok(ipc.handlers.has('workspace:getSnapshot'));
  assert.ok(ipc.handlers.has('workspace:search'));
  assert.ok(ipc.handlers.has('workspace:readFile'));
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

test('desktop sendMessage retargets an existing session to the selected workspace', async () => {
  const firstProjectRoot = createTempProject();
  const secondProjectRoot = createTempProject();
  const ipc = createFakeIpc();
  const sentEvents = [];
  const event = {
    sender: {
      send(channel, payload) {
        sentEvents.push({ channel, payload });
      },
    },
  };

  fs.mkdirSync(path.join(firstProjectRoot, '.hax-agent'), { recursive: true });
  fs.writeFileSync(path.join(firstProjectRoot, '.hax-agent', 'settings.json'), JSON.stringify({
    agent: { provider: 'mock' },
  }));
  fs.mkdirSync(path.join(secondProjectRoot, '.hax-agent'), { recursive: true });
  fs.writeFileSync(path.join(secondProjectRoot, '.hax-agent', 'settings.json'), JSON.stringify({
    agent: { provider: 'mock' },
  }));

  registerIpcHandlers(ipc);
  const created = await ipc.handlers.get('agent:createSession')(null, {
    projectRoot: firstProjectRoot,
  });

  const result = await ipc.handlers.get('agent:sendMessage')(event, {
    sessionId: created.id,
    projectRoot: secondProjectRoot,
    content: 'Use the new workspace',
  });

  assert.equal(result.id, created.id);
  assert.equal(result.settings.projectRoot, path.resolve(secondProjectRoot));
  assert.ok(sentEvents.some(({ payload }) => payload?.type === 'turn.completed'));
});

test('desktop sendMessage maps full permission mode to backend yolo mode', async () => {
  const projectRoot = createTempProject();
  const ipc = createFakeIpc();
  const event = {
    sender: {
      send() {},
    },
  };

  fs.mkdirSync(path.join(projectRoot, '.hax-agent'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.hax-agent', 'settings.json'), JSON.stringify({
    agent: { provider: 'mock' },
    permissions: { mode: 'normal' },
  }));

  registerIpcHandlers(ipc);
  const created = await ipc.handlers.get('agent:createSession')(null, {
    projectRoot,
    permissionMode: 'normal',
  });

  const result = await ipc.handlers.get('agent:sendMessage')(event, {
    sessionId: created.id,
    content: 'Use full access for this turn',
    permissionMode: 'full',
  });

  assert.equal(created.permission.mode, 'normal');
  assert.equal(result.permission.mode, 'yolo');
});

test('desktop approval prompt sends a request and resolves from renderer response', async () => {
  const sentEvents = [];
  const sender = {
    send(channel, payload) {
      sentEvents.push({ channel, payload });
    },
  };
  const prompt = createDesktopApprovalPrompt(sender, { id: 'session-1' });
  const approvalPromise = prompt({
    toolName: 'file.write',
    toolArgs: { path: 'README.md', content: '# Test\n' },
    level: 'ask',
    description: 'Write README.md',
    toolKey: 'file.write',
  });
  const approval = sentEvents.find(({ channel }) => channel === 'approval:request').payload;

  assert.equal(approval.toolName, 'file.write');
  assert.equal(approval.level, 'ask');
  assert.equal(approval.sessionId, 'session-1');
  assert.equal(resolvePendingApproval(approval.id, 'approve').resolved, true);
  assert.equal(await approvalPromise, 'approve');
});

test('desktop approval prompt can be denied when a session is interrupted', async () => {
  const sentEvents = [];
  const sender = {
    send(channel, payload) {
      sentEvents.push({ channel, payload });
    },
  };
  const prompt = createDesktopApprovalPrompt(sender, { id: 'session-interrupt' });
  const approvalPromise = prompt({
    toolName: 'shell.run',
    toolArgs: { command: 'npm test' },
    level: 'ask',
    description: 'Run npm test',
    toolKey: 'shell.run:npm',
  });

  assert.equal(resolvePendingApprovalsForSession('session-interrupt', 'deny'), 1);
  assert.equal(await approvalPromise, 'deny');
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

test('desktop devtools open only when explicitly enabled', () => {
  const previous = process.env.HAX_AGENT_DESKTOP_DEVTOOLS;

  try {
    delete process.env.HAX_AGENT_DESKTOP_DEVTOOLS;
    assert.equal(shouldOpenDevTools(), false);

    process.env.HAX_AGENT_DESKTOP_DEVTOOLS = '0';
    assert.equal(shouldOpenDevTools(), false);

    process.env.HAX_AGENT_DESKTOP_DEVTOOLS = '1';
    assert.equal(shouldOpenDevTools(), true);
  } finally {
    if (previous === undefined) delete process.env.HAX_AGENT_DESKTOP_DEVTOOLS;
    else process.env.HAX_AGENT_DESKTOP_DEVTOOLS = previous;
  }
});

test('desktop workspace snapshot reads real files and hides mock transcripts', async () => {
  const projectRoot = createTempProject();
  const settings = config.loadSettings({ projectRoot, env: {} });
  settings.sessions.directory = path.join(projectRoot, 'sessions');
  const ipc = createFakeIpc();

  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'src', 'index.js'), 'console.log("hello");\n');
  fs.mkdirSync(path.join(projectRoot, '.hax-agent'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.hax-agent', 'hidden.txt'), 'hidden\n');
  fs.writeFileSync(path.join(projectRoot, '.hax-agent', 'settings.json'), JSON.stringify({
    sessions: { directory: settings.sessions.directory },
  }));

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
  settings.sessions.directory = path.join(projectRoot, 'sessions');

  memory.writeTranscript('summary-session', [
    { timestamp: new Date().toISOString(), role: 'user', content: 'Initial request' },
    { timestamp: new Date().toISOString(), role: 'assistant', content: 'OK' },
    { timestamp: new Date().toISOString(), role: 'user', content: 'Latest follow up' },
  ], settings);

  const [session] = readSessionList(settings);

  assert.equal(session.title, 'Initial request');
  assert.equal(session.preview, 'Latest follow up');
});

test('desktop migrates legacy project transcripts into the configured session directory', () => {
  const projectRoot = createTempProject();
  const settings = config.loadSettings({
    projectRoot,
    env: {},
    overrides: {
      sessions: { directory: path.join(projectRoot, 'global-sessions') },
    },
  });

  memory.writeTranscript('global-session', [
    { timestamp: new Date().toISOString(), role: 'user', content: 'Global chat' },
  ], settings);
  memory.writeTranscript('legacy-session', [
    { timestamp: new Date().toISOString(), role: 'user', content: 'Legacy chat' },
  ], {
    ...settings,
    sessions: { directory: path.join(projectRoot, '.hax-agent', 'sessions') },
  });

  const migration = migrateLegacySessionRecords(settings);
  const previews = readSessionList(settings).map((session) => session.preview);

  assert.deepEqual(migration, { migrated: 1, skipped: 0, failed: 0 });
  assert.ok(previews.includes('Global chat'));
  assert.ok(previews.includes('Legacy chat'));
  assert.deepEqual(memory.readTranscript('legacy-session', settings).map((entry) => entry.content), ['Legacy chat']);
});

test('desktop can resume migrated legacy project transcripts from the session list', async () => {
  const projectRoot = createTempProject();
  const ipc = createFakeIpc();
  const settings = config.loadSettings({
    projectRoot,
    env: {},
    overrides: {
      sessions: { directory: path.join(projectRoot, 'global-sessions') },
    },
  });

  memory.writeTranscript('legacy-session', [
    { timestamp: new Date().toISOString(), role: 'user', content: 'Open old chat' },
    { timestamp: new Date().toISOString(), role: 'assistant', content: 'Old answer' },
  ], {
    ...settings,
    sessions: { directory: path.join(projectRoot, '.hax-agent', 'sessions') },
  });

  registerIpcHandlers(ipc);
  const resumed = await ipc.handlers.get('agent:resumeSession')(null, {
    projectRoot,
    sessionId: 'legacy-session',
  });

  assert.match(resumed.id, /^legacy-session/);
  assert.deepEqual(resumed.messages.map((message) => message.content), ['Open old chat', 'Old answer']);
});

test('desktop unassigned sessions stay out of project groups', () => {
  const projectRoot = createTempProject();
  const settings = config.loadSettings({
    projectRoot,
    env: {},
    overrides: {
      sessions: { directory: path.join(projectRoot, 'sessions') },
      transcriptProjectRoot: '',
    },
  });

  memory.writeTranscript('unassigned-session', [
    { timestamp: new Date().toISOString(), role: 'user', content: 'Casual chat' },
  ], settings);

  const [session] = readSessionList(settings);

  assert.equal(session.preview, 'Casual chat');
  assert.equal(session.projectRoot, '');
  assert.equal(session.projectName, '未归属');
  assert.equal(session.projectScope, 'unassigned');
});

test('desktop session classification can disable current project scope', () => {
  const sessionDirectory = createTempProject();
  const settings = config.loadSettings({
    projectRoot: process.cwd(),
    env: {},
    overrides: {
      sessions: { directory: sessionDirectory },
    },
  });

  memory.writeTranscript('cwd-session', [
    { timestamp: new Date().toISOString(), role: 'user', content: 'Process cwd chat' },
  ], settings);

  const [session] = readSessionList(settings, { currentProjectRoot: '' });

  assert.equal(session.projectScope, 'other');
});

test('desktop settings updates normalize renderer form fields', () => {
  const workspace = createTempProject();
  assert.deepEqual(normalizeSettingsUpdates({
    provider: 'openai',
    model: 'gpt-4.1',
    temperature: 0.4,
    workspace,
  }), {
    agent: {
      provider: 'openai',
      model: 'gpt-4.1',
      temperature: 0.4,
    },
    desktop: {
      workspace,
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

test('desktop workspace content search finds text and skips ignored runtime folders', () => {
  const projectRoot = createTempProject();
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.hax-agent'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'src', 'index.js'), 'const needle = "visible";\n');
  fs.writeFileSync(path.join(projectRoot, '.hax-agent', 'secret.txt'), 'needle hidden\n');

  const result = searchWorkspaceContent(projectRoot, { query: 'needle' });

  assert.deepEqual(result.matches.map((match) => match.path), ['src/index.js']);
  assert.equal(result.matches[0].line, 1);
  assert.equal(result.truncated, false);
});

test('desktop workspace file preview reads text and rejects paths outside root', () => {
  const projectRoot = createTempProject();
  fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Hello\nLine two\n');

  const preview = readWorkspaceFile(projectRoot, { path: 'README.md' });

  assert.equal(preview.path, 'README.md');
  assert.equal(preview.lines[0].text, '# Hello');
  assert.throws(() => readWorkspaceFile(projectRoot, { path: '..\\outside.txt' }), /escapes workspace root/);
});

test('desktop git status lists changed files and reads file diff', async () => {
  const projectRoot = createTempProject();
  runGit(projectRoot, ['init']);
  runGit(projectRoot, ['config', 'user.email', 'test@example.com']);
  runGit(projectRoot, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(projectRoot, 'tracked.txt'), 'old\n');
  runGit(projectRoot, ['add', 'tracked.txt']);
  runGit(projectRoot, ['commit', '-m', 'initial']);
  fs.writeFileSync(path.join(projectRoot, 'tracked.txt'), 'old\nnew\n');
  fs.writeFileSync(path.join(projectRoot, 'fresh.txt'), 'hello\n');

  const status = await readGitStatus(projectRoot);
  const diff = await readGitDiff(projectRoot, { path: 'tracked.txt' });
  const untrackedDiff = await readGitDiff(projectRoot, { path: 'fresh.txt' });

  assert.equal(status.available, true);
  assert.ok(status.files.some((file) => file.path === 'tracked.txt' && file.status === 'modified'));
  assert.ok(status.files.some((file) => file.path === 'fresh.txt' && file.status === 'untracked'));
  assert.match(diff.diff, /\+new/);
  assert.match(untrackedDiff.diff, /new file mode/);
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
