'use strict';

const { SandboxPolicy, ResourceLimits } = require('./policy');
const { SandboxExecutor, SandboxError } = require('./executor');
const { createSandbox, runInSandbox, captureOutput, WHITELISTED_GLOBALS, BLOCKED_GLOBALS } = require('./vm-sandbox');

module.exports = {
  SandboxPolicy,
  ResourceLimits,
  SandboxExecutor,
  SandboxError,
  createSandbox,
  runInSandbox,
  captureOutput,
  WHITELISTED_GLOBALS,
  BLOCKED_GLOBALS,
};
