const fs = require('node:fs/promises');
const path = require('node:path');
const { ToolExecutionError } = require('./error');
const {
  requireString,
  resolveWithinRoot,
  toWorkspacePath,
  statPath,
} = require('./utils');

function createDeleteFileTool() {
  return {
    name: 'file.delete',
    description: 'Delete a file inside the workspace root. The file is moved to .hax-agent/trash/ by default for recovery.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'The file path to delete' },
        permanent: { type: 'boolean', description: 'If true, permanently delete instead of moving to trash', default: false },
      },
    },
    async execute(args, context) {
      const filePath = requireString(args.path, 'path');
      const permanent = args.permanent === true;

      const resolvedPath = resolveWithinRoot(context.root, filePath);
      const stats = await statPath(resolvedPath);

      if (!stats.isFile()) {
        throw new ToolExecutionError('NOT_A_FILE', `Path is not a file: ${filePath}`);
      }

      if (permanent) {
        await fs.unlink(resolvedPath);
      } else {
        const trashDir = path.join(context.root, '.hax-agent', 'trash');
        await fs.mkdir(trashDir, { recursive: true });
        const baseName = path.basename(filePath);
        const timestamp = Date.now();
        const trashPath = path.join(trashDir, `${timestamp}-${baseName}`);
        await fs.rename(resolvedPath, trashPath);
      }

      return {
        path: toWorkspacePath(context.root, resolvedPath),
        deleted: true,
        permanent,
        bytes: stats.size,
      };
    },
  };
}

module.exports = { createDeleteFileTool };
