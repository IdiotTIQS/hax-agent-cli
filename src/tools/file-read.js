const fs = require('node:fs/promises');
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
} = require('./utils');

function createReadFileTool() {
  return {
    name: 'file.read',
    description: 'Read a UTF-8 text file inside the workspace root. Default limit is 50MB — do NOT pass a small maxBytes unless the file is known to be huge (e.g. logs, data dumps). For normal source files just omit maxBytes. Use offset/limit to read specific line ranges.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string' },
        encoding: { type: 'string', default: 'utf8' },
        maxBytes: { type: 'number', default: DEFAULT_MAX_FILE_BYTES, description: 'Maximum bytes to read. Default 50MB (52428800). Only set this for huge files — omit for normal source code.' },
        offset: { type: 'number', description: 'Line number to start reading from (1-indexed). Default 1.' },
        limit: { type: 'number', description: 'Maximum lines to return. Default 500, max 2000.' },
      },
    },
    async execute(args, context) {
      const filePath = requireString(args.path, 'path');
      const encoding = args.encoding === undefined ? 'utf8' : requireString(args.encoding, 'encoding');
      const maxBytes = readPositiveInteger(args.maxBytes, DEFAULT_MAX_FILE_BYTES, 'maxBytes');
      const offset = typeof args.offset === 'number' && args.offset > 0 ? Math.floor(args.offset) : 1;
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(2000, Math.floor(args.limit)) : 500;

      if (!Buffer.isEncoding(encoding)) {
        throw new ToolExecutionError('INVALID_ENCODING', `Unsupported file encoding: ${encoding}`);
      }

      const resolvedPath = await resolveWithinRootSafe(context.root, filePath);
      const stats = await withTimeout(statPath(resolvedPath), DEFAULT_FILE_OP_TIMEOUT_MS, `stat ${filePath}`);

      if (!stats.isFile()) {
        throw new ToolExecutionError('NOT_A_FILE', `Path is not a file: ${filePath}`);
      }

      let content;
      let truncated = false;
      let truncatedNote = null;

      if (stats.size > maxBytes) {
        // Auto-truncate: read the first maxBytes instead of rejecting
        const fd = await fs.open(resolvedPath, 'r');
        try {
          const buf = Buffer.alloc(maxBytes);
          const { bytesRead } = await fd.read(buf, 0, maxBytes, 0);
          content = buf.toString(encoding, 0, bytesRead);
          truncated = true;
          truncatedNote = `File is ${stats.size} bytes, showing first ${bytesRead} bytes.`;
        } finally {
          await fd.close();
        }
      } else {
        content = await fs.readFile(resolvedPath, { encoding });
      }

      // Apply line-based offset/limit
      const allLines = content.split(/\r?\n/);
      const totalLines = allLines.length;
      const startIdx = Math.max(0, offset - 1);
      const endIdx = Math.min(totalLines, startIdx + limit);
      const selectedLines = allLines.slice(startIdx, endIdx);

      // Line-numbered output
      const numbered = selectedLines.map((line, i) =>
        `${String(startIdx + i + 1).padStart(4)}|${line}`
      ).join('\n');

      return {
        path: toWorkspacePath(context.root, resolvedPath),
        bytes: stats.size,
        encoding,
        content: numbered,
        totalLines,
        offset: startIdx + 1,
        limit: selectedLines.length,
        ...(truncated ? { truncated, truncatedNote } : {}),
      };
    },
  };
}

module.exports = { createReadFileTool };
