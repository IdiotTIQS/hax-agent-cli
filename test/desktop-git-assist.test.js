const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

async function loadGitAssist() {
  return import(pathToFileURL(path.join(__dirname, '..', 'desktop', 'renderer', 'src', 'git-assist.mjs')).href);
}

test('buildGitAssistPrompt creates focused prompts for git assistant actions', async () => {
  const { buildGitAssistPrompt } = await loadGitAssist();
  const base = {
    filePath: 'src/index.js',
    diff: 'diff --git a/src/index.js b/src/index.js\n+new behavior',
  };

  assert.match(buildGitAssistPrompt({ ...base, intent: 'commit' }), /Conventional Commits/);
  assert.match(buildGitAssistPrompt({ ...base, intent: 'pr' }), /Summary、Changes、Test Plan、Risks/);
  assert.match(buildGitAssistPrompt({ ...base, intent: 'review' }), /Correctness、Tests、Security、Maintainability/);
  assert.match(buildGitAssistPrompt({ ...base, intent: 'explain' }), /这次变更改变了什么行为/);
  assert.match(buildGitAssistPrompt({ ...base, intent: 'unknown' }), /请解释下面这个 Git diff/);
  assert.equal(buildGitAssistPrompt({ ...base, diff: '' }), '');
});

test('getGitAssistLabels returns user-facing progress labels', async () => {
  const { getGitAssistLabels } = await loadGitAssist();

  assert.deepEqual(getGitAssistLabels('pr'), ['生成 PR 描述', 'PR 描述已生成', 'PR 描述生成失败']);
  assert.deepEqual(getGitAssistLabels('unknown'), ['解释 diff', 'Diff 解释完成', 'Diff 解释失败']);
});
