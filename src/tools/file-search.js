const fs = require('node:fs/promises');
const { ToolExecutionError } = require('./error');
const {
  DEFAULT_MAX_FILE_BYTES,
  requireString,
  readPositiveInteger,
  resolveWithinRoot,
  toWorkspacePath,
  statPath,
} = require('./utils');
const { collectGlobMatches } = require('./file-glob');

function createSearchTool() {
  return {
    name: 'file.search',
    description: 'Search text files inside the workspace root. Files up to 50MB are searched by default — do NOT restrict maxFileBytes for normal source code.',
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
        maxFileBytes: { type: 'number', default: DEFAULT_MAX_FILE_BYTES, description: 'Max bytes per file. Default 50MB. Omit for normal files.' },
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

module.exports = { createSearchTool, collectSearchFiles, createLineMatcher };
