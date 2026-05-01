const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');
const { AnthropicProvider, MockProvider } = require('../src/providers');
const { OpenAIProvider } = require('../src/providers/openai-provider');
const { ToolRegistry, createLocalToolRegistry, createWebFetchTool, createWebSearchTool, createFileEditTool, createReadDirectoryTool, ToolExecutionError } = require('../src/tools');

test('mock provider explains local mock mode conversationally', async () => {
  const provider = new MockProvider({ model: 'mock-a' });

  const response = await provider.chat({ prompt: 'hi' });

  assert.equal(response.content, 'I’m in local mock mode right now, so I can’t answer with a real model yet. You said: hi');
});

test('mock provider exposes and switches runtime configuration', async () => {
  const provider = new MockProvider({ model: 'mock-a' });

  assert.deepEqual(await provider.listModels(), [{ id: 'mock-a', name: 'mock-a' }]);
  assert.equal(provider.setModel('mock-b'), 'mock-b');
  assert.equal(provider.setApiUrl('https://example.test/v1'), 'https://example.test/v1');
  assert.equal(provider.setApiKey('test-key'), 'test-key');
  assert.deepEqual(await provider.listModels(), [{ id: 'mock-b', name: 'mock-b' }]);
});

test('anthropic provider stores runtime configuration', () => {
  const provider = new AnthropicProvider({
    client: {},
    apiKey: 'test-key',
    apiUrl: 'https://example.test/v1',
  });

  assert.equal(provider.apiKey, 'test-key');
  assert.equal(provider.apiUrl, 'https://example.test/v1');
});

test('file write reports inserted line preview without marking unchanged lines', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-agent-tools-'));
  const registry = createLocalToolRegistry({ root });
  await fs.writeFile(path.join(root, 'README.md'), '# Hax Agent CLI\n\nBody\n', 'utf8');

  const result = await registry.execute('file.write', {
    path: 'README.md',
    content: '123123111\n# Hax Agent CLI\n\nBody\n',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.change, {
    operation: 'update',
    added: 1,
    removed: 0,
    changed: 1,
    preview: [{ line: 1, marker: '+', text: '123123111' }],
  });
});

test('shell tool runs commands allowed by policy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-agent-tools-'));
  const registry = createLocalToolRegistry({
    root,
    shellPolicy: {
      enabled: true,
      allowedCommands: ['node'],
    },
  });

  const result = await registry.execute('shell.run', {
    command: process.execPath,
    args: ['-e', 'process.stdout.write("ok")'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.exitCode, 0);
  assert.equal(result.data.stdout, 'ok');
});

test('anthropic provider creates Claude Code style request defaults', () => {
  const provider = new AnthropicProvider({ client: {} });
  const request = provider.createRequest({ prompt: 'build this' });

  assert.equal(request.model, 'claude-opus-4-7');
  assert.match(request.system, /professional AI coding assistant/);
  assert.match(request.system, /Never call file\.read with an empty path/);
  assert.deepEqual(request.thinking, { type: 'adaptive', display: 'summarized' });
  assert.deepEqual(request.output_config, { effort: 'xhigh' });
});

test('anthropic provider appends caller system prompt to tool guidance', () => {
  const provider = new AnthropicProvider({ client: {} });
  const request = provider.createRequest({ prompt: 'build this', system: 'Prefer concise replies.' });

  assert.match(request.system, /Never call file\.read with an empty path/);
  assert.match(request.system, /Prefer concise replies\./);
});

test('anthropic provider maps listed API models', async () => {
  const provider = new AnthropicProvider({
    client: {
      models: {
        async list() {
          return {
            data: [
              { id: 'claude-opus-4-7', display_name: 'Claude Opus 4.7' },
              { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
            ],
          };
        },
      },
    },
  });

  assert.deepEqual(await provider.listModels(), [
    { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  ]);
});

test('anthropic provider executes local tools and returns final text', async () => {
  const requests = [];
  const registry = new ToolRegistry();
  registry.register({
    name: 'file.write',
    description: 'Write a file.',
    inputSchema: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
    },
    async execute(args) {
      return { path: args.path, bytes: args.content.length };
    },
  });

  const provider = new AnthropicProvider({
    client: {
      messages: {
        async create(request) {
          requests.push(request);

          if (requests.length === 1) {
            return {
              id: 'msg-tool',
              model: 'claude-opus-4-7',
              content: [
                { type: 'text', text: 'I’ll write that file.' },
                { type: 'tool_use', id: 'toolu_1', name: 'file_write', input: { path: 'README.md', content: '# Test' } },
              ],
              usage: null,
            };
          }

          return {
            id: 'msg-final',
            model: 'claude-opus-4-7',
            content: [{ type: 'text', text: 'Done.' }],
            usage: null,
          };
        },
      },
    },
  });

  const response = await provider.chat({ prompt: 'write a readme', toolRegistry: registry });

  assert.equal(response.content, 'Done.');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].tools[0].name, 'file_write');
  const [toolResult] = requests[1].messages.at(-1).content;
  const toolResultContent = JSON.parse(toolResult.content);

  assert.equal(toolResult.type, 'tool_result');
  assert.equal(toolResult.tool_use_id, 'toolu_1');
  assert.equal(toolResult.is_error, false);
  assert.equal(toolResultContent.type, 'tool_result');
  assert.equal(toolResultContent.toolName, 'file.write');
  assert.equal(toolResultContent.ok, true);
  assert.deepEqual(toolResultContent.data, { path: 'README.md', bytes: 6 });
});

test('anthropic provider streams text while executing local tools', async () => {
  const requests = [];
  const registry = new ToolRegistry();
  registry.register({
    name: 'file.write',
    description: 'Write a file.',
    inputSchema: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
    },
    async execute(args) {
      return { path: args.path, bytes: args.content.length };
    },
  });

  const provider = new AnthropicProvider({
    client: {
      messages: {
        stream(request) {
          requests.push(request);

          if (requests.length === 1) {
            return createMessageStream([
              { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private reasoning must stay hidden' } },
              { type: 'content_block_delta', delta: { type: 'text_delta', text: 'I’ll write that file.' } },
            ], {
              id: 'msg-tool',
              model: 'claude-opus-4-7',
              content: [
                { type: 'text', text: 'I’ll write that file.' },
                { type: 'tool_use', id: 'toolu_1', name: 'file_write', input: { path: 'README.md', content: '# Test' } },
              ],
              usage: null,
            });
          }

          return createMessageStream([
            { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done.' } },
          ], {
            id: 'msg-final',
            model: 'claude-opus-4-7',
            content: [{ type: 'text', text: 'Done.' }],
            usage: null,
          });
        },
      },
    },
  });

  const chunks = [];
  for await (const chunk of provider.stream({ prompt: 'write a readme', toolRegistry: registry })) {
    chunks.push(chunk);
  }

  assert.equal(chunks[0].type, 'thinking');
  assert.equal(chunks[0].summary, 'Thinking...');
  assert.doesNotMatch(JSON.stringify(chunks[0]), /private reasoning/);
  assert.equal(chunks[1].type, 'text');
  assert.equal(chunks[1].delta, 'I’ll write that file.');
  assert.equal(chunks[2].type, 'tool_start');
  assert.equal(chunks[2].name, 'file.write');
  assert.deepEqual(chunks[2].input, { path: 'README.md', content: '# Test' });
  assert.equal(chunks[2].displayInput, 'file: README.md, chars: 6');
  assert.equal(chunks[2].attempt, 1);
  assert.equal(chunks[2].turn, 1);
  assert.equal(chunks[3].type, 'tool_result');
  assert.equal(chunks[3].name, 'file.write');
  assert.equal(chunks[3].isError, false);
  assert.deepEqual(chunks[3].data, { path: 'README.md', bytes: 6 });
  assert.equal(chunks[3].attempt, 1);
  assert.equal(chunks[3].turn, 1);
  assert.equal(chunks[4].type, 'text');
  assert.equal(chunks[4].delta, 'Done.');
  assert.equal(requests.length, 2);
  const [toolResult] = requests[1].messages.at(-1).content;

  assert.equal(toolResult.type, 'tool_result');
  assert.equal(toolResult.tool_use_id, 'toolu_1');
});

test('anthropic provider reports streaming tool errors with reasons', async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: 'file.read',
    description: 'Read a file.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' } },
    },
    async execute() {
      const error = new Error('path must be a non-empty string.');
      error.code = 'INVALID_ARGUMENT';
      throw error;
    },
  });

  const provider = new AnthropicProvider({
    client: {
      messages: {
        stream() {
          return createMessageStream([], {
            id: 'msg-tool',
            model: 'claude-opus-4-7',
            content: [{ type: 'tool_use', id: 'toolu_1', name: 'file_read', input: {} }],
            usage: null,
          });
        },
      },
    },
  });

  const chunks = [];
  for await (const chunk of provider.stream({ prompt: 'read without path', toolRegistry: registry, maxToolTurns: 1 })) {
    chunks.push(chunk);
  }

  assert.equal(chunks[0].type, 'tool_start');
  assert.equal(chunks[0].name, 'file.read');
  assert.deepEqual(chunks[0].input, {});
  assert.equal(chunks[0].attempt, 1);
  assert.equal(chunks[0].turn, 1);
  assert.equal(chunks[1].type, 'tool_result');
  assert.equal(chunks[1].name, 'file.read');
  assert.equal(chunks[1].isError, true);
  assert.equal(chunks[1].error, 'path must be a non-empty string.');
  assert.equal(chunks[1].errorCode, 'INVALID_ARGUMENT');
  assert.equal(chunks[1].attempt, 1);
  assert.equal(chunks[1].turn, 1);
});

test('anthropic provider feeds repeated invalid streaming tool calls back to the model', async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: 'file.read',
    description: 'Read a file.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' } },
    },
    async execute() {
      const error = new Error('path must be a non-empty string.');
      error.code = 'INVALID_ARGUMENT';
      throw error;
    },
  });

  const provider = new AnthropicProvider({
    client: {
      messages: {
        stream() {
          return createMessageStream([], {
            id: 'msg-tool',
            model: 'claude-opus-4-7',
            content: [{ type: 'tool_use', id: 'toolu_1', name: 'file_read', input: {} }],
            usage: null,
          });
        },
      },
    },
  });

  const chunks = [];
  for await (const chunk of provider.stream({ prompt: 'read forever without path', toolRegistry: registry, maxToolTurns: 5 })) {
    chunks.push(chunk);
  }

  const repeatedErrors = chunks.filter((chunk) =>
    chunk.type === 'tool_result' &&
    chunk.name === 'file.read' &&
    chunk.isError === true &&
    /failed repeatedly/.test(chunk.error || '')
  );

  assert.equal(chunks.filter((chunk) => chunk.type === 'tool_start').length, 2);
  assert.equal(repeatedErrors.length, 1);
  assert.equal(repeatedErrors[0].attempt, 3);
  assert.equal(repeatedErrors[0].repeatedInvalid, true);
  assert.equal(repeatedErrors[0].showNotice, true);
  assert.deepEqual(chunks.at(-1), {
    type: 'tool_limit',
    reason: 'repeated_invalid_tool_call',
    maxToolTurns: 3,
  });
  assert.equal(chunks.some((chunk) => chunk.type === 'text' && /Stopped repeated invalid tool call/.test(chunk.delta)), false);
});

test('anthropic provider reports when streaming tool turns are exhausted', async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: 'file.read',
    description: 'Read a file.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' } },
    },
    async execute() {
      return { content: 'test' };
    },
  });

  const provider = new AnthropicProvider({
    client: {
      messages: {
        stream() {
          return createMessageStream([], {
            id: 'msg-tool',
            model: 'claude-opus-4-7',
            content: [{ type: 'tool_use', id: 'toolu_1', name: 'file_read', input: { path: 'package.json' } }],
            usage: null,
          });
        },
      },
    },
  });

  const chunks = [];
  for await (const chunk of provider.stream({ prompt: 'read forever', toolRegistry: registry, maxToolTurns: 1 })) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks.at(-1), {
    type: 'tool_limit',
    reason: 'max_tool_turns',
    maxToolTurns: 1,
  });
});

test('web fetch tool validates URL scheme', async () => {
  const tool = createWebFetchTool();

  try {
    await tool.execute({ url: 'ftp://example.com' });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.code, 'INVALID_URL');
  }
});

test('web fetch tool validates URL is not empty', async () => {
  const tool = createWebFetchTool();

  try {
    await tool.execute({ url: '' });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.code, 'INVALID_ARGUMENT');
  }
});

test('web fetch tool fetches from a local server', async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<html><body><h1>Hello</h1><p>World</p></body></html>');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: `http://127.0.0.1:${port}` });

    assert.equal(result.url, `http://127.0.0.1:${port}/`);
    assert.equal(result.truncated, false);
    assert.match(result.content, /Hello/);
    assert.match(result.content, /World/);
  } finally {
    server.close();
  }
});

test('web fetch tool converts HTML to plain text', async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<div><h1>Title</h1><p>Line one</p><p>Line two</p></div>');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: `http://127.0.0.1:${port}` });

    assert.match(result.content, /Title/);
    assert.match(result.content, /Line one/);
    assert.match(result.content, /Line two/);
    assert.doesNotMatch(result.content, /<[^>]+>/);
  } finally {
    server.close();
  }
});

test('web fetch tool truncates large responses', async () => {
  const bigContent = '<html><body>' + 'x'.repeat(1000) + '</body></html>';
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(bigContent);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: `http://127.0.0.1:${port}`, maxBodyBytes: 200 });

    assert.equal(result.truncated, true);
    assert.ok(result.content.length <= 200);
  } finally {
    server.close();
  }
});

test('web fetch tool follows redirects', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/old') {
      res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/new` });
      res.end();
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html><body>Final page</body></html>');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: `http://127.0.0.1:${port}/old` });

    assert.match(result.content, /Final page/);
  } finally {
    server.close();
  }
});

test('web fetch tool reports HTTP errors', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const tool = createWebFetchTool();
    try {
      await tool.execute({ url: `http://127.0.0.1:${port}` });
      assert.fail('should have thrown');
    } catch (error) {
      assert.equal(error.code, 'HTTP_ERROR');
      assert.match(error.message, /404/);
    }
  } finally {
    server.close();
  }
});

test('web fetch tool is registered in local tool registry', () => {
  const registry = createLocalToolRegistry({ root: process.cwd() });
  const tools = registry.list();
  const webFetch = tools.find((t) => t.name === 'web.fetch');

  assert.ok(webFetch);
  assert.match(webFetch.description, /Fetch/);
  assert.ok(webFetch.inputSchema.required.includes('url'));
});

test('web search tool validates query', async () => {
  const tool = createWebSearchTool();

  try {
    await tool.execute({ query: '' });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.code, 'INVALID_ARGUMENT');
  }
});

test('web search tool is registered in local tool registry', () => {
  const registry = createLocalToolRegistry({ root: process.cwd() });
  const tools = registry.list();
  const webSearch = tools.find((t) => t.name === 'web.search');

  assert.ok(webSearch);
  assert.match(webSearch.description, /search/i);
  assert.ok(webSearch.inputSchema.required.includes('query'));
});

test('file edit tool replaces existing text in file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-agent-edit-'));
  const filePath = path.join(root, 'test.txt');
  await fs.writeFile(filePath, 'Hello World\nSecond line\nThird line\n');

  const tool = createFileEditTool();
  const result = await tool.execute({
    path: filePath,
    oldStr: 'Second line',
    newStr: 'Replaced line',
  }, { root });

  assert.equal(result.changed, true);
  assert.equal(result.applied, true);
  assert.equal(result.oldLines, 1);
  assert.equal(result.newLines, 1);

  const content = await fs.readFile(filePath, 'utf8');
  assert.equal(content, 'Hello World\nReplaced line\nThird line\n');
});

test('file edit tool throws when text not found', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-agent-edit-'));
  const filePath = path.join(root, 'test.txt');
  await fs.writeFile(filePath, 'Hello World\n');

  const tool = createFileEditTool();

  try {
    await tool.execute({
      path: filePath,
      oldStr: 'NonExistentText',
      newStr: 'Replacement',
    }, { root });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.code, 'TEXT_NOT_FOUND');
  }
});

test('file edit tool throws on ambiguous text', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-agent-edit-'));
  const filePath = path.join(root, 'test.txt');
  await fs.writeFile(filePath, 'line A\nline B\nline A\n');

  const tool = createFileEditTool();

  try {
    await tool.execute({
      path: filePath,
      oldStr: 'line A\n',
      newStr: 'replaced\n',
    }, { root });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.code, 'AMBIGUOUS_TEXT');
  }
});

test('file edit tool supports dry run', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-agent-edit-'));
  const filePath = path.join(root, 'test.txt');
  const originalContent = 'Hello World\nOriginal line\n';
  await fs.writeFile(filePath, originalContent);

  const tool = createFileEditTool();
  const result = await tool.execute({
    path: filePath,
    oldStr: 'Original line\n',
    newStr: 'New line\n',
    dryRun: true,
  }, { root });

  assert.equal(result.changed, true);
  assert.equal(result.applied, false);
  assert.ok(result.diff.includes('- Original line'));
  assert.ok(result.diff.includes('+ New line'));

  const content = await fs.readFile(filePath, 'utf8');
  assert.equal(content, originalContent);
});

test('file edit tool is registered in local tool registry', () => {
  const registry = createLocalToolRegistry({ root: process.cwd() });
  const tools = registry.list();
  const fileEdit = tools.find((t) => t.name === 'file.edit');

  assert.ok(fileEdit);
  assert.match(fileEdit.description, /edit/i);
  assert.ok(fileEdit.inputSchema.required.includes('oldStr'));
  assert.ok(fileEdit.inputSchema.required.includes('newStr'));
});

test('read directory tool lists directory contents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-agent-readdir-'));
  await fs.writeFile(path.join(root, 'file1.txt'), 'content1');
  await fs.writeFile(path.join(root, 'file2.js'), 'content2');
  await fs.mkdir(path.join(root, 'subdir'));
  await fs.writeFile(path.join(root, 'subdir', 'nested.txt'), 'nested');

  const tool = createReadDirectoryTool();
  const result = await tool.execute({ path: root }, { root });

  assert.equal(result.path, '.');
  assert.ok(result.entries.length >= 3);
  assert.ok(result.entries.some((e) => e.name === 'file1.txt' && e.type === 'file'));
  assert.ok(result.entries.some((e) => e.name === 'subdir' && e.type === 'directory'));
});

test('read directory tool excludes hidden files by default', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-agent-readdir-'));
  await fs.writeFile(path.join(root, 'visible.txt'), 'content');
  await fs.writeFile(path.join(root, '.hidden'), 'hidden');

  const tool = createReadDirectoryTool();
  const result = await tool.execute({ path: root }, { root });

  assert.ok(result.entries.every((e) => !e.name.startsWith('.')));
});

test('read directory tool includes hidden files when requested', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-agent-readdir-'));
  await fs.writeFile(path.join(root, 'visible.txt'), 'content');
  await fs.writeFile(path.join(root, '.hidden'), 'hidden');

  const tool = createReadDirectoryTool();
  const result = await tool.execute({ path: root, includeHidden: true }, { root });

  assert.ok(result.entries.some((e) => e.name === '.hidden'));
});

test('read directory tool throws for non-existent directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hax-agent-readdir-'));
  const tool = createReadDirectoryTool();

  try {
    await tool.execute({ path: path.join(root, 'nonexistent') }, { root });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.code, 'PATH_NOT_FOUND');
  }
});

test('read directory tool is registered in local tool registry', () => {
  const registry = createLocalToolRegistry({ root: process.cwd() });
  const tools = registry.list();
  const readDir = tools.find((t) => t.name === 'file.readDirectory');

  assert.ok(readDir);
  assert.match(readDir.description, /directory/i);
  assert.ok(readDir.inputSchema.required.includes('path'));
});

test('openai provider preserves tool results and forces text after repeated single-call tool request', async () => {
  const requests = [];
  let executions = 0;
  const registry = new ToolRegistry();

  registry.register({
    name: 'web.fetch',
    description: 'Fetch a URL.',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: { url: { type: 'string' } },
    },
    async execute() {
      executions += 1;
      return { url: 'https://www.baidu.com', title: 'Baidu home page' };
    },
  });

  const provider = new OpenAIProvider({
    client: {
      chat: {
        completions: {
          create(request) {
            requests.push(request);

            if (requests.length === 1 || requests.length === 2) {
              return createOpenAIStream([
                {
                  choices: [{
                    delta: {
                      tool_calls: [{
                        index: 0,
                        id: `call_${requests.length}`,
                        type: 'function',
                        function: { name: 'web_fetch', arguments: '{"url":"https://www.baidu.com"}' },
                      }],
                    },
                  }],
                },
              ]);
            }

            return createOpenAIStream([
              { choices: [{ delta: { content: 'Baidu is a Chinese search engine.' } }] },
            ]);
          },
        },
      },
    },
  });

  const chunks = [];
  for await (const chunk of provider.stream({ prompt: 'webfetch baidu.com', toolRegistry: registry, maxToolTurns: 5 })) {
    chunks.push(chunk);
  }

  assert.equal(executions, 1);
  assert.equal(requests.length, 3);
  assert.equal(requests[2].tool_choice, 'none');
  assert.equal(chunks.filter((chunk) => chunk.type === 'tool_start').length, 1);
  assert.equal(chunks.filter((chunk) => chunk.type === 'tool_result').length, 1);
  assert.equal(chunks.at(-1).type, 'text');
  assert.equal(chunks.at(-1).delta, 'Baidu is a Chinese search engine.');

  const secondRequestToolMessage = requests[1].messages.find((message) => message.role === 'tool');
  assert.ok(secondRequestToolMessage);
  assert.equal(secondRequestToolMessage.tool_call_id, 'call_1');
  assert.match(secondRequestToolMessage.content, /Baidu home page/);
});

function createOpenAIStream(events) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

function createMessageStream(events, finalMessage) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
    async finalMessage() {
      return finalMessage;
    },
  };
}
