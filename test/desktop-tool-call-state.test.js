const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

async function loadToolCallState() {
  return import(pathToFileURL(path.join(__dirname, '..', 'desktop', 'renderer', 'src', 'tool-call-state.mjs')).href);
}

test('tool call state inserts running calls and caps history', async () => {
  const { upsertToolCallState } = await loadToolCallState();
  const existing = Array.from({ length: 20 }, (_item, index) => ({ id: `old-${index}`, name: 'old' }));

  const next = upsertToolCallState(existing, {
    type: 'tool.start',
    name: 'file.read',
    input: { path: 'README.md' },
    displayInput: 'README.md',
  }, {
    currentTurn: 3,
    now: new Date('2026-05-16T00:00:00.000Z'),
  });

  assert.equal(next.length, 20);
  assert.equal(next[0].name, 'file.read');
  assert.equal(next[0].status, 'running');
  assert.equal(next[0].turn, 3);
  assert.match(next[0].input, /README.md/);
  assert.equal(next.at(-1).id, 'old-18');
});

test('tool call state merges results into a matching running call', async () => {
  const { upsertToolCallState } = await loadToolCallState();
  const current = [{
    id: 'file.read:0:2',
    name: 'file.read',
    status: 'running',
  }];

  const next = upsertToolCallState(current, {
    type: 'tool.result',
    name: 'file.read',
    status: 'done',
    durationMs: 12,
    data: { bytes: 42 },
  }, {
    doneLabel: '完成',
    currentTurn: 2,
    now: new Date('2026-05-16T00:00:00.000Z'),
  });

  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'file.read:0:2');
  assert.equal(next[0].status, 'done');
  assert.equal(next[0].summary, '完成 - 12ms');
  assert.match(next[0].output, /42/);
});

test('tool call state records failed result details', async () => {
  const { upsertToolCallState } = await loadToolCallState();

  const [failed] = upsertToolCallState([], {
    type: 'tool.result',
    name: 'shell.run',
    isError: true,
    durationMs: 7,
    error: 'exit 1',
  }, {
    errorLabel: '错误',
  });

  assert.equal(failed.status, 'failed');
  assert.equal(failed.summary, '错误 - 7ms');
  assert.equal(failed.output, 'exit 1');
});
