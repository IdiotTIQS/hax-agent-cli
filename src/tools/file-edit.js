const fs = require('node:fs/promises');
const path = require('node:path');
const { ToolExecutionError } = require('./error');
const {
  DEFAULT_FILE_OP_TIMEOUT_MS,
  requireString,
  toWorkspacePath,
  withTimeout,
} = require('./utils');

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
      const content = await withTimeout(fs.readFile(resolvedPath, { encoding }), DEFAULT_FILE_OP_TIMEOUT_MS, `read ${filePath}`);

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
        await withTimeout(fs.writeFile(resolvedPath, updatedContent, { encoding }), DEFAULT_FILE_OP_TIMEOUT_MS, `write ${filePath}`);
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

module.exports = { createFileEditTool };
