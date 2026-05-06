const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://hax-agent.test/',
  });

  global.window = dom.window;
  global.document = dom.window.document;
  global.Node = dom.window.Node;
  global.Element = dom.window.Element;
  global.HTMLElement = dom.window.HTMLElement;
}

test('desktop markdown renders common markdown and custom code blocks', async () => {
  installDom();
  const { renderMarkdown } = await import('../desktop/renderer/src/markdown.mjs');

  const html = renderMarkdown([
    '# Title',
    '',
    'Hello **agent** with `code`.',
    '',
    '```js',
    'console.log("<safe>");',
    '```',
  ].join('\n'));

  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>agent<\/strong>/);
  assert.match(html, /class="code-block-wrap"/);
  assert.match(html, /data-copy="console\.log\(&quot;<safe>&quot;\);/);
});

test('desktop markdown sanitizes scripts, event handlers, unsafe links, and tool blocks', async () => {
  installDom();
  const { renderMarkdown } = await import('../desktop/renderer/src/markdown.mjs');

  const html = renderMarkdown([
    'Before',
    '<file.read>{"path":"secret.txt"}</file.read>',
    '[bad](javascript:alert(1))',
    '[good](https://example.com)',
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    'After',
  ].join('\n'));

  assert.doesNotMatch(html, /file\.read/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noreferrer noopener"/);
});

test('desktop markdown strips fullwidth DSML tool blocks', async () => {
  installDom();
  const { renderMarkdown } = await import('../desktop/renderer/src/markdown.mjs');

  const html = renderMarkdown([
    'Before',
    '<｜｜DSML｜｜tool_calls>',
    '<｜｜DSML｜｜invoke name="file.read">',
    '<｜｜DSML｜｜parameter name="filePath" string="true">./package.json</｜｜DSML｜｜parameter>',
    '</｜｜DSML｜｜invoke>',
    '</｜｜DSML｜｜tool_calls>',
    'After',
  ].join('\n'));

  assert.match(html, /Before/);
  assert.match(html, /After/);
  assert.doesNotMatch(html, /DSML/);
  assert.doesNotMatch(html, /file\.read/);
  assert.doesNotMatch(html, /package\.json/);
});
