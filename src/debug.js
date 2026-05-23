"use strict";

const isDebugEnabled = () => process.env.HAX_AGENT_DEBUG === '1';

// Provider API key patterns — matched against log output to prevent accidental exposure
const API_KEY_PATTERNS = [
  /sk-ant-api[0-9]{2}-[a-zA-Z0-9_-]{20,}/g,
  /sk-[a-zA-Z0-9]{20,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
];

function redactSecrets(str) {
  let result = str;
  for (const pattern of API_KEY_PATTERNS) {
    result = result.replace(pattern, '[REDACTED_API_KEY]');
  }
  return result;
}

function debug(namespace, ...args) {
  if (!isDebugEnabled()) return;
  const ts = new Date().toISOString().slice(11, 23);
  const message = redactSecrets(args.join(' '));
  process.stderr.write(`[debug ${ts} ${namespace}] ${message}\n`);
}

module.exports = { debug, isDebugEnabled };
