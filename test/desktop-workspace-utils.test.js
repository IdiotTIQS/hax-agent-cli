const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

async function loadWorkspaceUtils() {
  return import(pathToFileURL(path.join(__dirname, '..', 'desktop', 'renderer', 'src', 'workspace-utils.mjs')).href);
}

test('workspace utilities flatten and summarize file trees', async () => {
  const { flattenTree, summarizeTree } = await loadWorkspaceUtils();
  const tree = [
    {
      name: 'src',
      type: 'directory',
      children: [
        { name: 'index.js', type: 'file' },
        {
          name: 'components',
          type: 'directory',
          children: [{ name: 'App.vue', type: 'file' }],
        },
      ],
    },
    { name: 'README.md', type: 'file' },
  ];

  assert.deepEqual(flattenTree(tree).map((node) => node.name), ['src', 'index.js', 'components', 'App.vue', 'README.md']);
  assert.deepEqual(summarizeTree(tree), { files: 3, directories: 2, depth: 2 });
});

test('workspace utilities compare and label paths consistently', async () => {
  const { normalizePathForCompare, pathBasename, pathsMatch } = await loadWorkspaceUtils();

  assert.equal(normalizePathForCompare('C:\\Work\\Project\\'), 'c:/work/project');
  assert.equal(pathsMatch('C:\\Work\\Project\\', 'c:/work/project'), true);
  assert.equal(pathsMatch('', 'c:/work/project'), false);
  assert.equal(pathBasename('C:\\Work\\Project', 'fallback'), 'Project');
  assert.equal(pathBasename('', 'fallback'), 'fallback');
});

test('workspace utilities normalize workspace and git snapshots', async () => {
  const { normalizeWorkspaceSnapshot, shouldClearSelectedGitFile } = await loadWorkspaceUtils();

  const snapshot = normalizeWorkspaceSnapshot({
    projectRoot: 'E:\\HaxAgent',
    fileTree: [{ name: 'README.md', type: 'file' }],
    sessions: [{ id: 's1' }],
    git: {
      branch: 'main',
      ahead: '2',
      behind: undefined,
      changed: '3',
      files: [{ path: 'src/index.js' }],
    },
  }, 'fallback');

  assert.equal(snapshot.projectRoot, 'E:\\HaxAgent');
  assert.deepEqual(snapshot.summary, { files: 1, directories: 0, depth: 0 });
  assert.deepEqual(snapshot.git, {
    branch: 'main',
    ahead: 2,
    behind: 0,
    changed: 3,
    files: [{ path: 'src/index.js' }],
  });
  assert.equal(shouldClearSelectedGitFile('src/index.js', snapshot.git.files), false);
  assert.equal(shouldClearSelectedGitFile('README.md', snapshot.git.files), true);
});

test('workspace utilities normalize content search results', async () => {
  const { createEmptyContentSearch, normalizeContentSearchResult } = await loadWorkspaceUtils();

  assert.deepEqual(createEmptyContentSearch(), { query: '', matches: [], scannedFiles: 0, truncated: false });
  assert.deepEqual(normalizeContentSearchResult({
    matches: 'bad',
    scannedFiles: '12',
    truncated: 1,
  }, 'needle'), {
    query: 'needle',
    matches: [],
    scannedFiles: 12,
    truncated: true,
  });
});
