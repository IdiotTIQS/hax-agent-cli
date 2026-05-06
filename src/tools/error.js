class ToolExecutionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ToolExecutionError';
    this.code = code;
    this.details = details;
  }
}

module.exports = { ToolExecutionError };
