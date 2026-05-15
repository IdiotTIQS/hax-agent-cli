const fs = require('node:fs/promises');
const path = require('node:path');
const { ToolExecutionError } = require('./error');
const {
  IGNORED_DIRECTORY_NAMES,
  requireString,
  readPositiveInteger,
  resolveWithinRoot,
  toWorkspacePath,
  statPath,
} = require('./utils');

function createReadDirectoryTool() {
  const DEFAULT_MAX_ENTRIES = 200;

  return {
    name: 'file.readDirectory',
    description: 'Read the contents of a directory, listing files and subdirectories with their types and sizes. IMPORTANT: Only read directories relevant to the user\'s request. Do NOT recursively traverse the entire filesystem or large directories like node_modules.',
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

      const resolvedPath = resolveWithinRoot(context.root, dirPath);
      const stat = await statPath(resolvedPath);

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
        entryCount: listedEntries.length,
        note: 'DIRECTORY LISTING COMPLETE. You now have the directory contents. Use this information to answer the user. Do NOT call file.readDirectory again for the same or parent directories.',
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

module.exports = { createReadDirectoryTool };
