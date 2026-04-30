const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { URL } = require('node:url');

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_MAX_RESULTS = 1000;
const IGNORED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', '.hg', '.svn']);

class ToolExecutionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ToolExecutionError';
    this.code = code;
    this.details = details;
  }
}

class ToolRegistry {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.cwd());
    this.tools = new Map();
  }

  register(tool) {
    if (!tool || typeof tool !== 'object') {
      throw new ToolExecutionError('INVALID_TOOL', 'Tool must be an object.');
    }

    if (!isNonEmptyString(tool.name)) {
      throw new ToolExecutionError('INVALID_TOOL_NAME', 'Tool name must be a non-empty string.');
    }

    if (typeof tool.execute !== 'function') {
      throw new ToolExecutionError('INVALID_TOOL_EXECUTOR', `Tool "${tool.name}" must provide an execute function.`);
    }

    if (this.tools.has(tool.name)) {
      throw new ToolExecutionError('DUPLICATE_TOOL', `Tool "${tool.name}" is already registered.`);
    }

    this.tools.set(tool.name, {
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || null,
      execute: tool.execute,
    });

    return this;
  }

  list() {
    return Array.from(this.tools.values(), (tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async execute(name, args = {}, context = {}) {
    const startedAt = Date.now();

    try {
      if (!isNonEmptyString(name)) {
        throw new ToolExecutionError('INVALID_TOOL_NAME', 'Tool name must be a non-empty string.');
      }

      assertPlainObject(args, 'Tool arguments');
      const tool = this.tools.get(name);

      if (!tool) {
        throw new ToolExecutionError('TOOL_NOT_FOUND', `Tool "${name}" is not registered.`);
      }

      const data = await tool.execute(args, {
        ...context,
        root: this.root,
        registry: this,
      });

      return serializeToolResult({
        toolName: name,
        ok: true,
        data,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      return serializeToolResult({
        toolName: name,
        ok: false,
        error,
        durationMs: Date.now() - startedAt,
      });
    }
  }
}

function createLocalToolRegistry(options = {}) {
  const registry = new ToolRegistry({ root: options.root });
  const shellPolicy = normalizeShellPolicy(options.shellPolicy);

  registry
    .register(createReadFileTool())
    .register(createWriteFileTool())
    .register(createGlobTool())
    .register(createSearchTool())
    .register(createShellTool(shellPolicy))
    .register(createWebFetchTool())
    .register(createWebSearchTool())
    .register(createFileEditTool())
    .register(createReadDirectoryTool());

  return registry;
}

function createReadFileTool() {
  return {
    name: 'file.read',
    description: 'Read a UTF-8 text file inside the workspace root.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string' },
        encoding: { type: 'string', default: 'utf8' },
        maxBytes: { type: 'number', default: DEFAULT_MAX_FILE_BYTES },
      },
    },
    async execute(args, context) {
      const filePath = requireString(args.path, 'path');
      const encoding = args.encoding === undefined ? 'utf8' : requireString(args.encoding, 'encoding');
      const maxBytes = readPositiveInteger(args.maxBytes, DEFAULT_MAX_FILE_BYTES, 'maxBytes');

      if (!Buffer.isEncoding(encoding)) {
        throw new ToolExecutionError('INVALID_ENCODING', `Unsupported file encoding: ${encoding}`);
      }

      const resolvedPath = resolveWithinRoot(context.root, filePath);
      const stats = await statPath(resolvedPath);

      if (!stats.isFile()) {
        throw new ToolExecutionError('NOT_A_FILE', `Path is not a file: ${filePath}`);
      }

      if (stats.size > maxBytes) {
        throw new ToolExecutionError('FILE_TOO_LARGE', `File exceeds maxBytes (${maxBytes}).`, {
          bytes: stats.size,
          maxBytes,
        });
      }

      return {
        path: toWorkspacePath(context.root, resolvedPath),
        bytes: stats.size,
        encoding,
        content: await fs.readFile(resolvedPath, { encoding }),
      };
    },
  };
}

function createWriteFileTool() {
  return {
    name: 'file.write',
    description: 'Write a UTF-8 text file inside the workspace root.',
    inputSchema: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        encoding: { type: 'string', default: 'utf8' },
        overwrite: { type: 'boolean', default: true },
        createParentDirectories: { type: 'boolean', default: false },
        maxBytes: { type: 'number', default: DEFAULT_MAX_FILE_BYTES },
      },
    },
    async execute(args, context) {
      const filePath = requireString(args.path, 'path');
      const content = requireString(args.content, 'content');
      const encoding = args.encoding === undefined ? 'utf8' : requireString(args.encoding, 'encoding');
      const overwrite = args.overwrite !== false;
      const createParentDirectories = args.createParentDirectories === true;
      const maxBytes = readPositiveInteger(args.maxBytes, DEFAULT_MAX_FILE_BYTES, 'maxBytes');

      if (!Buffer.isEncoding(encoding)) {
        throw new ToolExecutionError('INVALID_ENCODING', `Unsupported file encoding: ${encoding}`);
      }

      const bytes = Buffer.byteLength(content, encoding);

      if (bytes > maxBytes) {
        throw new ToolExecutionError('CONTENT_TOO_LARGE', `Content exceeds maxBytes (${maxBytes}).`, {
          bytes,
          maxBytes,
        });
      }

      const resolvedPath = resolveWithinRoot(context.root, filePath);
      const parentPath = resolveWithinRoot(context.root, path.dirname(filePath));
      const previousContent = await readExistingFileContent(resolvedPath, encoding);

      if (createParentDirectories) {
        await fs.mkdir(parentPath, { recursive: true });
      } else {
        const parentStats = await statPath(parentPath);

        if (!parentStats.isDirectory()) {
          throw new ToolExecutionError('PARENT_NOT_DIRECTORY', `Parent path is not a directory: ${path.dirname(filePath)}`);
        }
      }

      await fs.writeFile(resolvedPath, content, {
        encoding,
        flag: overwrite ? 'w' : 'wx',
      });

      return {
        path: toWorkspacePath(context.root, resolvedPath),
        bytes,
        encoding,
        overwritten: previousContent !== null,
        change: createFileChangeSummary(previousContent, content),
      };
    },
  };
}

function createGlobTool() {
  return {
    name: 'file.glob',
    description: 'List files matching a glob pattern inside the workspace root.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', default: '**/*' },
        cwd: { type: 'string', default: '.' },
        includeDirectories: { type: 'boolean', default: false },
        maxResults: { type: 'number', default: DEFAULT_MAX_RESULTS },
      },
    },
    async execute(args, context) {
      const pattern = args.pattern === undefined ? '**/*' : requireString(args.pattern, 'pattern');
      const cwd = args.cwd === undefined ? '.' : requireString(args.cwd, 'cwd');
      const includeDirectories = args.includeDirectories === true;
      const maxResults = readPositiveInteger(args.maxResults, DEFAULT_MAX_RESULTS, 'maxResults');
      const matches = await collectGlobMatches({
        root: context.root,
        cwd,
        pattern,
        includeDirectories,
        maxResults,
      });

      return {
        pattern,
        cwd: toWorkspacePath(context.root, resolveWithinRoot(context.root, cwd)),
        matches: matches.items,
        truncated: matches.truncated,
      };
    },
  };
}

function createSearchTool() {
  return {
    name: 'file.search',
    description: 'Search text files inside the workspace root.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        path: { type: 'string', default: '.' },
        glob: { type: 'string', default: '**/*' },
        regex: { type: 'boolean', default: false },
        caseSensitive: { type: 'boolean', default: true },
        maxResults: { type: 'number', default: 100 },
        maxFileBytes: { type: 'number', default: DEFAULT_MAX_FILE_BYTES },
      },
    },
    async execute(args, context) {
      const query = requireString(args.query, 'query');
      const searchPath = args.path === undefined ? '.' : requireString(args.path, 'path');
      const glob = args.glob === undefined ? '**/*' : requireString(args.glob, 'glob');
      const useRegex = args.regex === true;
      const caseSensitive = args.caseSensitive !== false;
      const maxResults = readPositiveInteger(args.maxResults, 100, 'maxResults');
      const maxFileBytes = readPositiveInteger(args.maxFileBytes, DEFAULT_MAX_FILE_BYTES, 'maxFileBytes');
      const matcher = createLineMatcher(query, { useRegex, caseSensitive });
      const files = await collectSearchFiles({
        root: context.root,
        searchPath,
        glob,
        maxResults: Math.max(maxResults * 10, maxResults),
      });
      const matches = [];

      for (const file of files.items) {
        if (matches.length >= maxResults) {
          break;
        }

        const resolvedPath = resolveWithinRoot(context.root, file.path);
        const stats = await statPath(resolvedPath);

        if (!stats.isFile() || stats.size > maxFileBytes) {
          continue;
        }

        const content = await fs.readFile(resolvedPath, { encoding: 'utf8' });

        if (content.includes('\0')) {
          continue;
        }

        const lines = content.split(/\r?\n/);

        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          const column = matcher(line);

          if (column !== -1) {
            matches.push({
              path: file.path,
              line: index + 1,
              column: column + 1,
              text: line,
            });
          }

          if (matches.length >= maxResults) {
            break;
          }
        }
      }

      return {
        query,
        path: toWorkspacePath(context.root, resolveWithinRoot(context.root, searchPath)),
        glob,
        regex: useRegex,
        caseSensitive,
        matches,
        truncated: matches.length >= maxResults || files.truncated,
      };
    },
  };
}

function createShellTool(policy) {
  return {
    name: 'shell.run',
    description: 'Run an allowlisted local command without shell interpolation.',
    inputSchema: {
      type: 'object',
      required: ['command'],
      properties: {
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' }, default: [] },
        cwd: { type: 'string', default: '.' },
        timeoutMs: { type: 'number' },
      },
    },
    execute(args, context) {
      const command = requireString(args.command, 'command');
      const commandArgs = args.args === undefined ? [] : args.args;
      const cwd = args.cwd === undefined ? '.' : requireString(args.cwd, 'cwd');
      const timeoutMs = readPositiveInteger(args.timeoutMs, policy.timeoutMs, 'timeoutMs');

      if (!policy.enabled) {
        throw new ToolExecutionError('SHELL_DISABLED', 'Shell execution is disabled by policy.');
      }

      if (!Array.isArray(commandArgs) || !commandArgs.every((item) => typeof item === 'string')) {
        throw new ToolExecutionError('INVALID_SHELL_ARGS', 'Shell args must be an array of strings.');
      }

      assertCommandAllowed(command, policy);

      return runCommand({
        command,
        args: commandArgs,
        cwd: resolveWithinRoot(context.root, cwd),
        root: context.root,
        timeoutMs,
        maxBuffer: policy.maxBuffer,
        env: policy.env,
      });
    },
  };
}

function createWebFetchTool() {
  const DEFAULT_TIMEOUT_MS = 30_000;
  const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

  return {
    name: 'web.fetch',
    description: 'Fetch the content of a specific URL and convert HTML to plain text. Only supports HTTP and HTTPS URLs. IMPORTANT: Only fetch the URL the user explicitly requested. Do NOT automatically fetch links found in the response content.',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'The URL to fetch. Must start with http:// or https://' },
        method: { type: 'string', description: 'HTTP method (GET or POST)', default: 'GET' },
        maxBodyBytes: { type: 'number', description: 'Maximum response body size in bytes', default: DEFAULT_MAX_BODY_BYTES },
        timeoutMs: { type: 'number', description: 'Request timeout in milliseconds', default: DEFAULT_TIMEOUT_MS },
        maxRetries: { type: 'number', description: 'Maximum number of retry attempts on failure', default: 2 },
      },
    },
    async execute(args) {
      const url = requireString(args.url, 'url');
      const method = args.method === undefined ? 'GET' : requireString(args.method, 'method');
      const maxBodyBytes = readPositiveInteger(args.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, 'maxBodyBytes');
      const timeoutMs = readPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs');
      const maxRetries = readPositiveInteger(args.maxRetries, 2, 'maxRetries');

      const parsedUrl = parseAndValidateUrl(url);

      let lastError;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const { body, truncated: bodyTruncated } = await fetchUrl({ parsedUrl, method, maxBodyBytes, timeoutMs });
          const plainText = htmlToPlainText(body);
          const links = extractPageLinks(body, parsedUrl, 20);

          return {
            url: parsedUrl.href,
            status: 200,
            contentType: 'text/html',
            content: plainText,
            truncated: bodyTruncated,
            linksFound: links,
            note: links.length > 0
              ? `Found ${links.length} links. Only fetch additional pages if the user explicitly requests it.`
              : undefined,
          };
        } catch (error) {
          lastError = error;
          if (error.code === 'HTTP_ERROR' || error.code === 'INVALID_URL') {
            throw error;
          }
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      const message = lastError?.message || 'Unknown fetch error';
      throw new ToolExecutionError('FETCH_FAILED', `Failed to fetch ${url}: ${message}`);
    },
  };
}

function parseAndValidateUrl(urlString) {
  const trimmed = urlString.trim();

  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    throw new ToolExecutionError('INVALID_URL', 'URL must start with http:// or https://');
  }

  try {
    return new URL(trimmed);
  } catch (error) {
    throw new ToolExecutionError('INVALID_URL', `Invalid URL: ${error.message}`);
  }
}

async function fetchUrl({ parsedUrl, method, maxBodyBytes, timeoutMs }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await globalThis.fetch(parsedUrl.href, {
      method: method.toUpperCase(),
      headers: {
        'User-Agent': 'HaxAgent/1.3.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ToolExecutionError('HTTP_ERROR', `HTTP ${response.status}: ${response.statusText || 'Error'}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    let buffer = Buffer.from(arrayBuffer);

    const truncated = buffer.length >= maxBodyBytes;
    if (buffer.length > maxBodyBytes) {
      buffer = buffer.slice(0, maxBodyBytes);
    }

    return { body: buffer.toString('utf8'), truncated };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleRedirect(location, method, maxBodyBytes, timeoutMs, originalTimeoutId) {
  clearTimeout(originalTimeoutId);

  let redirectUrl;
  try {
    redirectUrl = new URL(location);
  } catch {
    throw new ToolExecutionError('INVALID_REDIRECT', `Invalid redirect URL: ${location}`);
  }

  return fetchUrl({ parsedUrl: redirectUrl, method, maxBodyBytes, timeoutMs });
}

function htmlToPlainText(html) {
  if (!html) return '';

  let text = html;

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)/gi, '\n\n');
  text = text.replace(/<(hr|\/tr)/gi, '\n');

  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');

  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  text = text.replace(/&[a-zA-Z]+;/g, ' ');

  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s+/g, '\n');
  text = text.replace(/\s*\n\s*\n\s*/g, '\n\n');

  return text.trim();
}

function extractPageLinks(html, baseUrl, maxLinks) {
  const links = [];
  const seen = new Set();
  const hrefRegex = /href\s*=\s*["'](.*?)["']/gi;
  let match;

  while ((match = hrefRegex.exec(html)) !== null && links.length < maxLinks) {
    let href = match[1];

    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) {
      continue;
    }

    let resolvedUrl;
    try {
      if (href.startsWith('//')) {
        resolvedUrl = new URL(baseUrl.protocol + href);
      } else if (href.startsWith('/')) {
        resolvedUrl = new URL(href, baseUrl);
      } else if (href.startsWith('http')) {
        resolvedUrl = new URL(href);
      } else {
        resolvedUrl = new URL(href, baseUrl);
      }
    } catch {
      continue;
    }

    const urlKey = resolvedUrl.href.split('#')[0];
    if (seen.has(urlKey)) {
      continue;
    }
    seen.add(urlKey);

    if (resolvedUrl.hostname === baseUrl.hostname || resolvedUrl.hostname === 'www.' + baseUrl.hostname.replace('www.', '')) {
      links.push(resolvedUrl.href);
    }
  }

  return links;
}

function createWebSearchTool() {
  const DEFAULT_MAX_RESULTS = 10;
  const DEFAULT_TIMEOUT_MS = 15_000;

  return {
    name: 'web.search',
    description: 'Search the web for information. Returns relevant search results with titles, URLs, and snippets.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'The search query string' },
        maxResults: { type: 'number', description: 'Maximum number of results to return', default: DEFAULT_MAX_RESULTS },
        timeoutMs: { type: 'number', description: 'Request timeout in milliseconds', default: DEFAULT_TIMEOUT_MS },
      },
    },
    async execute(args) {
      const query = requireString(args.query, 'query');
      const maxResults = readPositiveInteger(args.maxResults, DEFAULT_MAX_RESULTS, 'maxResults');
      const timeoutMs = readPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs');

      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const parsedUrl = new URL(searchUrl);

      const { body: html } = await fetchUrl({
        parsedUrl,
        method: 'GET',
        maxBodyBytes: 2 * 1024 * 1024,
        timeoutMs,
      });

      const results = parseDuckDuckgoResults(html, maxResults);

      return {
        query,
        results,
        resultCount: results.length,
      };
    },
  };
}

function parseDuckDuckgoResults(html, maxResults) {
  const results = [];
  const resultRegex = /<a[^>]*class="[^"]*result[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
  let match;

  while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
    const url = match[1].replace(/https?:\/\/duckduckgo\.com\/l\/\?uddg=/, '').replace(/[&?]at=.*/, '');
    const title = htmlToPlainText(match[2]).trim();

    if (title && url.startsWith('http')) {
      results.push({ title, url });
    }
  }

  if (results.length === 0) {
    const simpleLinks = html.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/gi) || [];
    for (const tag of simpleLinks.slice(0, maxResults)) {
      const urlMatch = tag.match(/href="(https?:\/\/[^"]+)"/);
      const titleMatch = tag.match(/>([^<]+)</);
      if (urlMatch && titleMatch) {
        const title = titleMatch[1].trim();
        if (title.length > 3 && !title.toLowerCase().includes('duckduckgo')) {
          results.push({ title, url: urlMatch[1] });
        }
      }
    }
  }

  return results.slice(0, maxResults);
}

function createFileEditTool() {
  return {
    name: 'file.edit',
    description: 'Precisely edit a file by replacing a specific section of text. Shows a diff preview before applying changes.',
    inputSchema: {
      type: 'object',
      required: ['path', 'oldStr', 'newStr'],
      properties: {
        path: { type: 'string', description: 'The file path to edit' },
        oldStr: { type: 'string', description: 'The exact text to find and replace' },
        newStr: { type: 'string', description: 'The new text to replace with' },
        encoding: { type: 'string', description: 'File encoding', default: 'utf8' },
        dryRun: { type: 'boolean', description: 'If true, show diff without applying changes', default: false },
      },
    },
    async execute(args, context) {
      const filePath = requireString(args.path, 'path');
      const oldStr = requireString(args.oldStr, 'oldStr');
      const newStr = requireString(args.newStr, 'newStr');
      const encoding = args.encoding === undefined ? 'utf8' : requireString(args.encoding, 'encoding');
      const dryRun = args.dryRun === true;

      if (!Buffer.isEncoding(encoding)) {
        throw new ToolExecutionError('INVALID_ENCODING', `Unsupported file encoding: ${encoding}`);
      }

      if (oldStr === newStr) {
        return {
          path: toWorkspacePath(context.root, path.resolve(context.root, filePath)),
          changed: false,
          message: 'oldStr and newStr are identical, no changes needed.',
        };
      }

      const resolvedPath = path.resolve(context.root, filePath);
      const content = await fs.readFile(resolvedPath, { encoding });

      const firstIndex = content.indexOf(oldStr);

      if (firstIndex === -1) {
        throw new ToolExecutionError('TEXT_NOT_FOUND', `Could not find the exact text in ${filePath}. The text must match exactly (including whitespace and newlines).`);
      }

      const lastIndex = content.lastIndexOf(oldStr);

      if (firstIndex !== lastIndex) {
        throw new ToolExecutionError('AMBIGUOUS_TEXT', `The exact text appears multiple times in ${filePath}. Make oldStr more specific to uniquely identify the location.`);
      }

      const updatedContent = content.replace(oldStr, newStr);

      const diff = generateDiff(oldStr, newStr);

      if (!dryRun) {
        await fs.writeFile(resolvedPath, updatedContent, { encoding });
      }

      const oldLines = oldStr.split(/\r?\n/).length;
      const newLines = newStr.split(/\r?\n/).length;

      return {
        path: toWorkspacePath(context.root, resolvedPath),
        changed: true,
        applied: !dryRun,
        diff,
        oldLines,
        newLines,
        summary: generateEditSummary(oldLines, newLines),
      };
    },
  };
}

function generateDiff(oldStr, newStr) {
  const oldLines = oldStr.split(/\r?\n/);
  const newLines = newStr.split(/\r?\n/);

  const diff = [];
  const maxLines = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLines; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : null;
    const newLine = i < newLines.length ? newLines[i] : null;

    if (oldLine !== newLine) {
      if (oldLine !== null) {
        diff.push(`- ${oldLine}`);
      }
      if (newLine !== null) {
        diff.push(`+ ${newLine}`);
      }
    }
  }

  return diff.join('\n');
}

function generateEditSummary(oldLines, newLines) {
  const added = Math.max(0, newLines - oldLines);
  const removed = Math.max(0, oldLines - newLines);

  if (oldLines === newLines) {
    return `Replaced ${oldLines} line${oldLines !== 1 ? 's' : ''}.`;
  }

  const parts = [];
  if (removed > 0) parts.push(`Removed ${removed} line${removed !== 1 ? 's' : ''}`);
  if (added > 0) parts.push(`Added ${added} line${added !== 1 ? 's' : ''}`);

  return parts.join(', ') + '.';
}

function createReadDirectoryTool() {
  const DEFAULT_MAX_ENTRIES = 200;

  return {
    name: 'file.readDirectory',
    description: 'Read the contents of a directory, listing files and subdirectories with their types and sizes.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'The directory path to read' },
        recursive: { type: 'boolean', description: 'Whether to list subdirectories recursively', default: false },
        maxEntries: { type: 'number', description: 'Maximum number of entries to return', default: DEFAULT_MAX_ENTRIES },
        includeHidden: { type: 'boolean', description: 'Whether to include hidden files (starting with .)', default: false },
      },
    },
    async execute(args, context) {
      const dirPath = requireString(args.path, 'path');
      const recursive = args.recursive === true;
      const maxEntries = readPositiveInteger(args.maxEntries, DEFAULT_MAX_ENTRIES, 'maxEntries');
      const includeHidden = args.includeHidden === true;

      const resolvedPath = path.resolve(context.root, dirPath);

      if (resolvedPath === context.root || resolvedPath.startsWith(context.root + path.sep)) {
        // Inside root
      } else {
        throw new ToolExecutionError('PATH_OUTSIDE_ROOT', `Directory path escapes workspace root: ${dirPath}`);
      }

      let stat;
      try {
        stat = await fs.stat(resolvedPath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw new ToolExecutionError('PATH_NOT_FOUND', `Directory does not exist: ${dirPath}`);
        }
        throw error;
      }

      if (!stat.isDirectory()) {
        throw new ToolExecutionError('NOT_A_DIRECTORY', `Path is not a directory: ${dirPath}`);
      }

      const entries = recursive
        ? await readDirectoryRecursive(resolvedPath, context.root, includeHidden, maxEntries)
        : await readDirectoryFlat(resolvedPath, context.root, includeHidden);

      const truncated = entries.length >= maxEntries;
      const listedEntries = entries.slice(0, maxEntries);

      return {
        path: toWorkspacePath(context.root, resolvedPath),
        entries: listedEntries,
        totalEntries: entries.length,
        truncated,
        recursive,
      };
    },
  };
}

async function readDirectoryFlat(dirPath, root, includeHidden) {
  const entries = [];

  const items = await fs.readdir(dirPath, { withFileTypes: true });

  for (const item of items) {
    if (!includeHidden && item.name.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(dirPath, item.name);
    const relativePath = toWorkspacePath(root, fullPath);

    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }

    entries.push({
      name: item.name,
      path: relativePath,
      type: item.isDirectory() ? 'directory' : 'file',
      size: item.isFile() ? stat.size : undefined,
    });
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

async function readDirectoryRecursive(dirPath, root, includeHidden, maxEntries) {
  const entries = [];
  const queue = [{ dir: dirPath, depth: 0 }];

  while (queue.length > 0 && entries.length < maxEntries) {
    const { dir: currentDir, depth } = queue.shift();

    if (depth > 5) continue;

    const items = await fs.readdir(currentDir, { withFileTypes: true });

    for (const item of items) {
      if (!includeHidden && item.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(currentDir, item.name);
      const relativePath = toWorkspacePath(root, fullPath);

      if (item.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(item.name)) {
          continue;
        }

        entries.push({
          name: item.name,
          path: relativePath,
          type: 'directory',
        });

        queue.push({ dir: fullPath, depth: depth + 1 });
      } else {
        let stat;
        try {
          stat = await fs.stat(fullPath);
        } catch {
          continue;
        }

        entries.push({
          name: item.name,
          path: relativePath,
          type: 'file',
          size: stat.size,
        });
      }
    }
  }

  return entries;
}

function resolveWithinRoot(root, requestedPath) {
  const value = requireString(requestedPath, 'path');
  const resolvedPath = path.resolve(root, value);
  const relativePath = path.relative(root, resolvedPath);

  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return resolvedPath;
  }

  throw new ToolExecutionError('PATH_OUTSIDE_ROOT', `Path escapes workspace root: ${value}`);
}

function toWorkspacePath(root, resolvedPath) {
  const relativePath = path.relative(root, resolvedPath);
  return relativePath === '' ? '.' : normalizeSlashes(relativePath);
}

async function statPath(filePath) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new ToolExecutionError('PATH_NOT_FOUND', `Path does not exist: ${filePath}`);
    }

    throw error;
  }
}

async function readExistingFileContent(filePath, encoding) {
  try {
    const stats = await fs.stat(filePath);

    if (!stats.isFile()) {
      return null;
    }

    return await fs.readFile(filePath, { encoding });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

function createFileChangeSummary(previousContent, nextContent) {
  const previousLines = splitLines(previousContent || '');
  const nextLines = splitLines(nextContent || '');
  const diff = createLineDiff(previousLines, nextLines);

  return {
    operation: previousContent === null ? 'create' : 'update',
    added: diff.added,
    removed: diff.removed,
    changed: diff.preview.length,
    preview: diff.preview.slice(0, 8),
  };
}

function createLineDiff(previousLines, nextLines) {
  let prefixLength = 0;

  while (
    prefixLength < previousLines.length &&
    prefixLength < nextLines.length &&
    previousLines[prefixLength] === nextLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;

  while (
    suffixLength < previousLines.length - prefixLength &&
    suffixLength < nextLines.length - prefixLength &&
    previousLines[previousLines.length - 1 - suffixLength] === nextLines[nextLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const removedLines = previousLines.slice(prefixLength, previousLines.length - suffixLength);
  const addedLines = nextLines.slice(prefixLength, nextLines.length - suffixLength);
  const preview = addedLines.map((line, index) => ({
    line: prefixLength + index + 1,
    marker: '+',
    text: line,
  }));

  return {
    added: addedLines.length,
    removed: removedLines.length,
    preview,
  };
}

function splitLines(content) {
  if (content.length === 0) {
    return [];
  }

  return content.replace(/\r\n/g, '\n').split('\n');
}

async function collectGlobMatches(options) {
  const cwdPath = resolveWithinRoot(options.root, options.cwd);
  const stats = await statPath(cwdPath);

  if (!stats.isDirectory()) {
    throw new ToolExecutionError('NOT_A_DIRECTORY', `Glob cwd is not a directory: ${options.cwd}`);
  }

  const matcher = globToMatcher(options.pattern);
  const items = [];
  let truncated = false;

  async function walk(currentPath, relativePath) {
    if (items.length >= options.maxResults) {
      truncated = true;
      return;
    }

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (items.length >= options.maxResults) {
        truncated = true;
        return;
      }

      if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }

      const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const entryPath = path.join(currentPath, entry.name);
      const type = entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file';

      if ((type !== 'directory' || options.includeDirectories) && matcher(entryRelativePath)) {
        items.push({ path: toWorkspacePath(options.root, entryPath), type });
      }

      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(entryPath, entryRelativePath);
      }
    }
  }

  await walk(cwdPath, '');

  return { items, truncated };
}

async function collectSearchFiles(options) {
  const resolvedPath = resolveWithinRoot(options.root, options.searchPath);
  const stats = await statPath(resolvedPath);

  if (stats.isFile()) {
    return {
      items: [{ path: toWorkspacePath(options.root, resolvedPath), type: 'file' }],
      truncated: false,
    };
  }

  if (!stats.isDirectory()) {
    throw new ToolExecutionError('NOT_SEARCHABLE', `Search path is not a file or directory: ${options.searchPath}`);
  }

  return collectGlobMatches({
    root: options.root,
    cwd: options.searchPath,
    pattern: options.glob,
    includeDirectories: false,
    maxResults: options.maxResults,
  });
}

function globToMatcher(pattern) {
  const normalizedPattern = normalizeSlashes(pattern || '**/*').replace(/^\.\//, '');
  let source = '^';

  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index];
    const next = normalizedPattern[index + 1];
    const afterNext = normalizedPattern[index + 2];

    if (char === '*' && next === '*' && afterNext === '/') {
      source += '(?:.*\/)?';
      index += 2;
    } else if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeRegExp(char);
    }
  }

  const expression = new RegExp(`${source}$`);
  return (value) => expression.test(normalizeSlashes(value));
}

function createLineMatcher(query, options) {
  if (!options.useRegex) {
    const needle = options.caseSensitive ? query : query.toLocaleLowerCase();

    return (line) => {
      const haystack = options.caseSensitive ? line : line.toLocaleLowerCase();
      return haystack.indexOf(needle);
    };
  }

  let expression;

  try {
    expression = new RegExp(query, options.caseSensitive ? '' : 'i');
  } catch (error) {
    throw new ToolExecutionError('INVALID_REGEX', error.message);
  }

  return (line) => {
    const match = expression.exec(line);
    return match ? match.index : -1;
  };
}

function normalizeShellPolicy(policy = {}) {
  const allowedCommands = Array.isArray(policy.allowedCommands) ? policy.allowedCommands : [];

  return {
    enabled: policy.enabled === true,
    allowedCommands: new Set(allowedCommands.map(normalizeCommandName)),
    timeoutMs: readPositiveInteger(policy.timeoutMs, 10_000, 'timeoutMs'),
    maxBuffer: readPositiveInteger(policy.maxBuffer, DEFAULT_MAX_FILE_BYTES, 'maxBuffer'),
    env: policy.env && typeof policy.env === 'object' ? { ...process.env, ...policy.env } : process.env,
  };
}

function assertCommandAllowed(command, policy) {
  if (!policy.allowedCommands.has(normalizeCommandName(command))) {
    throw new ToolExecutionError('COMMAND_NOT_ALLOWED', `Command is not allowed by policy: ${command}`);
  }
}

function runCommand(options) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let outputExceeded = false;
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = appendOutput(stdout, chunk, options.maxBuffer);
      outputExceeded = outputExceeded || stdout.length >= options.maxBuffer;

      if (outputExceeded) {
        child.kill('SIGTERM');
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr = appendOutput(stderr, chunk, options.maxBuffer);
      outputExceeded = outputExceeded || stderr.length >= options.maxBuffer;

      if (outputExceeded) {
        child.kill('SIGTERM');
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout);

      resolve({
        command: options.command,
        args: options.args,
        cwd: toWorkspacePath(options.root, options.cwd),
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        outputExceeded,
      });
    });
  });
}

function appendOutput(current, chunk, maxBuffer) {
  const next = current + chunk.toString('utf8');
  return next.length > maxBuffer ? next.slice(0, maxBuffer) : next;
}

function serializeToolResult(result) {
  const serialized = {
    type: 'tool_result',
    toolName: result.toolName || null,
    ok: result.ok === true,
    durationMs: Number.isFinite(result.durationMs) ? result.durationMs : null,
  };

  if (serialized.ok) {
    serialized.data = toJsonSafe(result.data);
  } else {
    serialized.error = serializeError(result.error);
  }

  return serialized;
}

function stringifyToolResult(result) {
  return JSON.stringify(serializeToolResult(result), null, 2);
}

function serializeError(error) {
  if (!error || typeof error !== 'object') {
    return {
      code: 'TOOL_ERROR',
      message: String(error || 'Unknown tool error.'),
    };
  }

  return {
    code: error.code || 'TOOL_ERROR',
    message: error.message || 'Unknown tool error.',
    details: toJsonSafe(error.details),
  };
}

function toJsonSafe(value, seen = new WeakSet()) {
  if (value === undefined) {
    return null;
  }

  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafe(item, seen));
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonSafe(item, seen)]));
  }

  return String(value);
}

function requireString(value, name) {
  if (!isNonEmptyString(value)) {
    throw new ToolExecutionError('INVALID_ARGUMENT', `${name} must be a non-empty string.`);
  }

  return value;
}

function readPositiveInteger(value, fallback, name) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ToolExecutionError('INVALID_LIMIT', `${name} must be a positive safe integer.`);
  }

  return value;
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolExecutionError('INVALID_ARGUMENT', `${name} must be an object.`);
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, '/');
}

function normalizeCommandName(command) {
  const trimmed = command.trim();
  const hasPathSeparator = trimmed.includes('/') || trimmed.includes('\\');
  const base = hasPathSeparator ? trimmed : trimmed.split(/\s+/)[0];
  return path.basename(base).replace(/\.exe$/i, '').toLocaleLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

module.exports = {
  ToolExecutionError,
  ToolRegistry,
  createLocalToolRegistry,
  createReadFileTool,
  createWriteFileTool,
  createGlobTool,
  createSearchTool,
  createShellTool,
  createWebFetchTool,
  createWebSearchTool,
  createFileEditTool,
  createReadDirectoryTool,
  serializeToolResult,
  stringifyToolResult,
};
