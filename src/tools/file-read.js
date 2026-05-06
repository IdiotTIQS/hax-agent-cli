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

module.exports = { createReadFileTool };
