const fs = require('node:fs/promises');
const path = require('node:path');
const { ToolExecutionError } = require('./error');
const {
  DEFAULT_MAX_FILE_BYTES,
  requireString,
  readPositiveInteger,
  resolveWithinRoot,
  toWorkspacePath,
  statPath,
  readExistingFileContent,
  createFileChangeSummary,
} = require('./utils');

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

module.exports = { createWriteFileTool };
