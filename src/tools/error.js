/**
 * Replace absolute paths rooted at `workspaceRoot` with relative equivalents.
 * This prevents leaking internal file system structure in error messages.
 * @param {string} message - The message to sanitize
 * @param {string} workspaceRoot - The project workspace root path
 * @returns {string}
 */
function sanitizePath(message, workspaceRoot) {
  if (!workspaceRoot || !message) return message;
  // Normalize both the root and the message path separators for consistent matching
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');
  // Match the root path with either slash style, possibly followed by a separator
  const escapedRoot = normalizedRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedRoot.replace(/\//g, '[/\\\\]') + '[/\\\\]?', 'g');
  return message.replace(regex, '.');
}

class ToolExecutionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ToolExecutionError';
    this.code = code;
    this.details = details;
  }
}

module.exports = { ToolExecutionError, sanitizePath };
