"use strict";

const isDebugEnabled = () => process.env.HAX_AGENT_DEBUG === '1';

function debug(namespace, ...args) {
  if (!isDebugEnabled()) return;
  const ts = new Date().toISOString().slice(11, 23);
  process.stderr.write(`[debug ${ts} ${namespace}] ${args.join(' ')}\n`);
}

module.exports = { debug, isDebugEnabled };
