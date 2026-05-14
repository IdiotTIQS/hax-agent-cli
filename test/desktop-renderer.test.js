const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { compileScript, compileTemplate, parse } = require('@vue/compiler-sfc');

const projectRoot = path.resolve(__dirname, '..');
const rendererSrc = path.join(projectRoot, 'desktop', 'renderer', 'src');
const componentCache = new Map();
let copiedText = '';
let openedExternalUrl = '';

installDom();
const { mount } = require('@vue/test-utils');

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://hax-agent.test/',
  });

  global.window = dom.window;
  global.document = dom.window.document;
  global.Node = dom.window.Node;
  global.Element = dom.window.Element;
  global.HTMLElement = dom.window.HTMLElement;
  global.SVGElement = dom.window.SVGElement;
  global.navigator = dom.window.navigator;
  global.crypto = dom.window.crypto;
  global.window.navigator.clipboard = {
    async writeText(value) {
      copiedText = value;
    },
  };
  global.navigator.clipboard = global.window.navigator.clipboard;
  global.window.haxAgent = {
    async openExternal(value) {
      openedExternalUrl = value;
    },
  };
}

async function loadComponent(relativePath) {
  const filename = path.join(rendererSrc, relativePath);
  return loadVueComponent(filename);
}

async function loadVueComponent(filename) {
  const normalized = path.normalize(filename);
  if (componentCache.has(normalized)) return componentCache.get(normalized);

  const promise = compileVueComponent(normalized);
  componentCache.set(normalized, promise);
  return promise;
}

async function compileVueComponent(filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { descriptor } = parse(source, { filename });
  const id = path.relative(rendererSrc, filename).replace(/[^\w]/g, '_');
  const script = compileScript(descriptor, { id });
  const template = compileTemplate({
    source: descriptor.template.content,
    filename,
    id,
    compilerOptions: {
      bindingMetadata: script.bindings,
    },
  });

  if (template.errors.length > 0) {
    throw new Error(template.errors.map(String).join('\n'));
  }

  const imports = {};
  let scriptCode = await rewriteImports(script.content, filename, imports);
  let templateCode = await rewriteImports(template.code, filename, imports);

  scriptCode = scriptCode.replace(/\bexport\s+default\b/, 'const __sfc__ =');
  templateCode = templateCode.replace(/\bexport\s+function\s+render\b/, 'function render');

  const module = { exports: {} };
  const code = [
    scriptCode,
    templateCode,
    '__sfc__.render = render;',
    'module.exports.default = __sfc__;',
  ].join('\n');

  vm.runInNewContext(code, {
    require,
    module,
    exports: module.exports,
    __imports: imports,
    window: global.window,
    navigator: global.navigator,
    URL,
    setTimeout,
    clearTimeout,
  }, { filename });

  return module.exports.default;
}

async function rewriteImports(code, importer, imports) {
  let rewritten = code.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?/g,
    (_match, names) => `const {${toDestructureSpecifiers(names)}} = require('vue');`
  );

  rewritten = await replaceAsync(
    rewritten,
    /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.vue)['"];?/g,
    async (_match, localName, specifier) => {
      const resolved = resolveImport(importer, specifier);
      imports[specifier] = { default: await loadVueComponent(resolved) };
      return `const ${localName} = __imports[${JSON.stringify(specifier)}].default;`;
    }
  );

  rewritten = await replaceAsync(
    rewritten,
    /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+\.mjs)['"];?/g,
    async (_match, names, specifier) => {
      const resolved = resolveImport(importer, specifier);
      imports[specifier] = await import(pathToFileURL(resolved).href);
      return `const {${toDestructureSpecifiers(names)}} = __imports[${JSON.stringify(specifier)}];`;
    }
  );

  return rewritten;
}

function toDestructureSpecifiers(names) {
  return names
    .split(',')
    .map((name) => name.trim().replace(/\s+as\s+/g, ': '))
    .filter(Boolean)
    .join(', ');
}

function resolveImport(importer, specifier) {
  if (specifier.startsWith('.')) {
    return path.resolve(path.dirname(importer), specifier);
  }
  throw new Error(`Unsupported component test import: ${specifier}`);
}

async function replaceAsync(value, pattern, replacer) {
  const matches = [...value.matchAll(pattern)];
  const replacements = await Promise.all(matches.map((match) => replacer(...match)));
  let index = 0;
  return value.replace(pattern, () => replacements[index++]);
}

test('ChatArea renders sanitized markdown and supports code copy', async () => {
  const ChatArea = await loadComponent(path.join('components', 'ChatArea.vue'));
  copiedText = '';
  openedExternalUrl = '';
  const wrapper = mount(ChatArea, {
    props: {
      messages: [{
        id: 'm1',
        role: 'assistant',
        content: '**bold** [site](https://example.com)\n\n<script>alert(1)</script>\n\n```txt\ncopy me\n```',
        createdAt: new Date('2026-05-04T00:00:00.000Z'),
        turn: 1,
      }],
      toolCalls: [],
    },
    attachTo: document.body,
  });

  assert.match(wrapper.html(), /<strong>bold<\/strong>/);
  assert.doesNotMatch(wrapper.html(), /<script>/i);
  assert.equal(wrapper.find('.code-block-btn').exists(), true);

  await wrapper.find('.code-block-btn').trigger('click');
  assert.equal(copiedText, 'copy me');

  await wrapper.find('a.markdown-link').trigger('click');
  assert.equal(openedExternalUrl, 'https://example.com');

  wrapper.unmount();
});

test('ChatArea shows output dots while assistant stream is still active', async () => {
  const ChatArea = await loadComponent(path.join('components', 'ChatArea.vue'));
  const wrapper = mount(ChatArea, {
    props: {
      messages: [{
        id: 'm1',
        role: 'assistant',
        content: 'Partial answer',
        createdAt: new Date('2026-05-04T00:00:00.000Z'),
        turn: 1,
      }],
      toolCalls: [],
      isThinking: false,
      isStreaming: true,
    },
  });

  assert.equal(wrapper.find('.thinking-indicator.streaming').exists(), true);
  assert.match(wrapper.text(), /输出中/);
  assert.equal(wrapper.findAll('.thinking-dots span').length, 3);

  wrapper.unmount();
});

test('FileTreeNode collapses directories and files have no expand button', async () => {
  const FileTreeNode = await loadComponent(path.join('components', 'FileTreeNode.vue'));
  const wrapper = mount(FileTreeNode, {
    props: {
      depth: 0,
      node: {
        name: 'src',
        path: 'src',
        type: 'directory',
        children: [{ name: 'index.js', path: 'src/index.js', type: 'file' }],
      },
    },
  });

  assert.equal(wrapper.find('button.tree-toggle').exists(), true);
  assert.match(wrapper.text(), /index\.js/);

  await wrapper.find('button.tree-toggle').trigger('click');
  assert.doesNotMatch(wrapper.text(), /index\.js/);

  const fileWrapper = mount(FileTreeNode, {
    props: { node: { name: 'README.md', path: 'README.md', type: 'file' } },
  });

  assert.equal(fileWrapper.find('button.tree-toggle').exists(), false);
  assert.equal(fileWrapper.find('.tree-toggle.placeholder').exists(), true);

  await fileWrapper.find('.file-tree-item').trigger('click');
  assert.deepEqual(fileWrapper.emitted('select')[0], ['README.md']);
});

test('RightPanel displays token and cost metrics', async () => {
  const RightPanel = await loadComponent(path.join('components', 'RightPanel.vue'));
  const wrapper = mount(RightPanel, {
    props: {
      activeTab: 'summary',
      tokenUsed: 12345,
      cost: '$0.1234',
      toolCalls: [{ id: 't1' }],
    },
  });

  assert.match(wrapper.text(), /12,345/);
  assert.match(wrapper.text(), /\$0\.1234/);
  assert.match(wrapper.text(), /普通对话/);
  assert.doesNotMatch(wrapper.text(), /2\/3/);
});

test('RightPanel shows git changes and emits selected file', async () => {
  const RightPanel = await loadComponent(path.join('components', 'RightPanel.vue'));
  const wrapper = mount(RightPanel, {
    props: {
      activeTab: 'git',
      gitBranch: 'main',
      gitFiles: [
        { path: 'src/index.js', status: 'modified' },
        { path: 'README.md', status: 'untracked' },
      ],
      selectedGitFile: 'src/index.js',
      selectedGitDiff: {
        path: 'src/index.js',
        diff: 'diff --git a/src/index.js b/src/index.js\n@@ -1 +1 @@\n-old\n+new',
      },
    },
  });

  assert.match(wrapper.text(), /src\/index\.js/);
  assert.match(wrapper.text(), /\+new/);

  await wrapper.findAll('.git-file-item')[1].trigger('click');
  assert.deepEqual(wrapper.emitted('select-git-file')[0], ['README.md']);
});

test('RightPanel emits git assist actions for selected diff', async () => {
  const RightPanel = await loadComponent(path.join('components', 'RightPanel.vue'));
  const wrapper = mount(RightPanel, {
    props: {
      activeTab: 'git',
      selectedGitFile: 'src/index.js',
      selectedGitDiff: {
        path: 'src/index.js',
        diff: 'diff --git a/src/index.js b/src/index.js\n+new',
      },
    },
  });

  const buttons = wrapper.findAll('.git-action-btn');
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].attributes('disabled'), undefined);

  await buttons[0].trigger('click');
  await buttons[1].trigger('click');

  assert.deepEqual(wrapper.emitted('git-assist').map((event) => event[0]), ['explain', 'commit']);
  wrapper.unmount();
});

test('RightPanel disables git assist actions without a diff', async () => {
  const RightPanel = await loadComponent(path.join('components', 'RightPanel.vue'));
  const wrapper = mount(RightPanel, {
    props: {
      activeTab: 'git',
      selectedGitFile: 'src/index.js',
      selectedGitDiff: { path: 'src/index.js', diff: '' },
    },
  });

  assert.equal(wrapper.find('.git-action-btn').attributes('disabled'), '');
  wrapper.unmount();
});

test('TopBar shows the active session workspace scope', async () => {
  const TopBar = await loadComponent(path.join('components', 'TopBar.vue'));
  const wrapper = mount(TopBar, {
    props: {
      title: '会话 abc12345',
      scopeLabel: '当前工作区: HaxAgent',
      scopeTitle: 'E:\\HaxAgent',
      models: [],
    },
  });

  assert.match(wrapper.text(), /会话 abc12345/);
  assert.match(wrapper.text(), /当前工作区: HaxAgent/);
  assert.equal(wrapper.find('.topbar-scope').attributes('title'), 'E:\\HaxAgent');

  wrapper.unmount();
});

test('Sidebar groups sessions by project scope', async () => {
  const Sidebar = await loadComponent(path.join('components', 'Sidebar.vue'));
  const wrapper = mount(Sidebar, {
    props: {
      sessions: [
        { id: 'a', preview: 'Current task', messageCount: 2, projectScope: 'current', projectName: 'HaxAgent' },
        { id: 'b', preview: 'Other task', messageCount: 4, projectScope: 'other', projectName: 'OtherProject' },
        { id: 'c', preview: 'Loose chat', messageCount: 1, projectScope: 'unassigned', projectName: '未归属' },
      ],
      activeId: 'a',
      fileTree: [],
      activeNav: 'chat',
    },
  });

  assert.match(wrapper.text(), /当前项目/);
  assert.match(wrapper.text(), /其他项目/);
  assert.match(wrapper.text(), /未归属对话/);
});

test('Sidebar groups all sessions before applying per-group limits', async () => {
  const Sidebar = await loadComponent(path.join('components', 'Sidebar.vue'));
  const sessions = [
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `other-${index}`,
      preview: `Other ${index}`,
      messageCount: 1,
      projectScope: 'other',
      projectName: 'OtherProject',
    })),
    { id: 'current-late', preview: 'Late current task', messageCount: 2, projectScope: 'current', projectName: 'HaxAgent' },
    { id: 'loose-late', preview: 'Late loose chat', messageCount: 1, projectScope: 'unassigned', projectName: '未归属' },
  ];
  const wrapper = mount(Sidebar, {
    props: {
      sessions,
      fileTree: [],
      activeNav: 'chat',
    },
  });

  assert.match(wrapper.text(), /Late current task/);
  assert.match(wrapper.text(), /Late loose chat/);
  assert.doesNotMatch(wrapper.text(), /Other 11/);
});

test('ApprovalModal emits approval decisions', async () => {
  const ApprovalModal = await loadComponent(path.join('components', 'ApprovalModal.vue'));
  const wrapper = mount(ApprovalModal, {
    props: {
      request: {
        id: 'approval-1',
        toolName: 'file.write',
        toolKey: 'file.write',
        level: 'ask',
        description: 'Write README.md',
        toolArgs: { path: 'README.md', content: '# Test\n' },
      },
    },
    attachTo: document.body,
  });

  assert.match(document.body.textContent, /允许这次工具调用/);
  assert.match(document.body.textContent, /file\.write/);

  const buttons = document.body.querySelectorAll('.approval-actions button');
  buttons[buttons.length - 1].click();
  await wrapper.vm.$nextTick();

  assert.deepEqual(wrapper.emitted('decide')[0], ['approve']);
  wrapper.unmount();
});
