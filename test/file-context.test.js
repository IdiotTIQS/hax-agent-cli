const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildFileContext, tokenize } = require('../src/file-context');

function createTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hax-agent-file-context-'));
}

test('tokenize extracts useful English and Chinese terms', () => {
  assert.deepEqual(tokenize('Fix desktop streaming in Sidebar.vue 当前项目'), [
    'desktop',
    'streaming',
    'sidebar',
    'vue',
    '当前项目',
  ]);
});

test('buildFileContext ranks relevant project files and ignores dependency folders', async () => {
  const projectRoot = createTempProject();
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'src', 'streaming.js'),
    'export function streamDesktopOutput() {\n  return "desktop streaming renderer";\n}\n',
  );
  fs.writeFileSync(
    path.join(projectRoot, 'src', 'unrelated.js'),
    'export const color = "blue";\n',
  );
  fs.writeFileSync(
    path.join(projectRoot, 'node_modules', 'pkg', 'streaming.js'),
    'this dependency file should not be indexed\n',
  );

  const result = await buildFileContext({
    projectRoot,
    settings: {
      projectRoot,
      fileContext: {
        enabled: true,
        maxFiles: 2,
        maxIndexFiles: 50,
        maxFileSize: 10000,
        maxBytesPerFile: 1000,
        maxTotalBytes: 2000,
      },
    },
    query: 'desktop streaming output bug',
  });

  assert.equal(result.files[0].path, 'src/streaming.js');
  assert.match(result.systemPrompt, /src\/streaming\.js/);
  assert.match(result.systemPrompt, /desktop streaming renderer/);
  assert.doesNotMatch(result.systemPrompt, /node_modules/);
});

test('buildFileContext returns empty context when disabled', async () => {
  const projectRoot = createTempProject();
  fs.writeFileSync(path.join(projectRoot, 'README.md'), 'desktop streaming\n');

  const result = await buildFileContext({
    projectRoot,
    settings: { projectRoot, fileContext: { enabled: false } },
    query: 'desktop streaming',
  });

  assert.deepEqual(result.files, []);
  assert.equal(result.systemPrompt, '');
});
