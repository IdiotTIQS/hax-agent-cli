const fs = require('node:fs/promises');
const path = require('node:path');
const { ToolExecutionError } = require('./error');
const {
  DEFAULT_MAX_RESULTS,
  IGNORED_DIRECTORY_NAMES,
  requireString,
  readPositiveInteger,
  normalizeSlashes,
  escapeRegExp,
  resolveWithinRootSafe,
  toWorkspacePath,
  statPath,
} = require('./utils');

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
        cwd: toWorkspacePath(context.root, await resolveWithinRootSafe(context.root, cwd)),
        matches: matches.items,
        truncated: matches.truncated,
      };
    },
  };
}

async function collectGlobMatches(options) {
  const cwdPath = await resolveWithinRootSafe(options.root, options.cwd);
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

module.exports = { createGlobTool, collectGlobMatches, globToMatcher };
