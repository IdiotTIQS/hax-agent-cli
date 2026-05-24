const fs = require('node:fs/promises');
const path = require('node:path');
const { ToolExecutionError } = require('./error');
const {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_FILE_OP_TIMEOUT_MS,
  requireString,
  readPositiveInteger,
  resolveWithinRootSafe,
  toWorkspacePath,
  statPath,
  withTimeout,
  readExistingFileContent,
  createFileChangeSummary,
} = require('./utils');

function createWriteFileTool() {
  return {
    name: 'file.write',
    description: 'Write a UTF-8 text file inside the workspace root. Default limit is 50MB.',
    inputSchema: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        encoding: { type: 'string', default: 'utf8' },
        overwrite: { type: 'boolean', default: true },
        createParentDirectories: { type: 'boolean', default: false },
        maxBytes: { type: 'number', default: DEFAULT_MAX_FILE_BYTES, description: 'Max content bytes. Default 50MB.' },
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

      const resolvedPath = await resolveWithinRootSafe(context.root, filePath);
      const parentPath = await resolveWithinRootSafe(context.root, path.dirname(filePath));
      let previousContent = null;
      if (context.undoStack) {
        previousContent = await withTimeout(readExistingFileContent(resolvedPath, encoding), DEFAULT_FILE_OP_TIMEOUT_MS, `read ${filePath}`);
      }

      if (createParentDirectories) {
        await withTimeout(fs.mkdir(parentPath, { recursive: true }), DEFAULT_FILE_OP_TIMEOUT_MS, `mkdir ${path.dirname(filePath)}`);
      } else {
        const parentStats = await withTimeout(statPath(parentPath), DEFAULT_FILE_OP_TIMEOUT_MS, `stat dir ${path.dirname(filePath)}`);

        if (!parentStats.isDirectory()) {
          throw new ToolExecutionError('PARENT_NOT_DIRECTORY', `Parent path is not a directory: ${path.dirname(filePath)}`);
        }
      }

      await withTimeout(fs.writeFile(resolvedPath, content, {
        encoding,
        flag: overwrite ? 'w' : 'wx',
      }), DEFAULT_FILE_OP_TIMEOUT_MS, `write ${filePath}`);

      if (context.undoStack) {
        context.undoStack.push({
          toolName: 'file.write',
          filePath: resolvedPath,
          originalContent: previousContent || '',
          newContent: content,
          description: `${previousContent !== null ? 'Overwrite' : 'Create'} ${path.basename(filePath)}`,
        });
      }

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
