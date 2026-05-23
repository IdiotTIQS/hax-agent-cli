"use strict";

/**
 * Configuration migration system.
 *
 * As HaxAgent evolves, the config format may change.  This module applies
 * incremental, versioned transforms so user configs stay compatible.
 *
 * Each migration function receives the config object and returns it
 * (mutated or replaced).  Unknown keys are always preserved.
 */

// ---------------------------------------------------------------------------
// Config versioning
// ---------------------------------------------------------------------------

/**
 * The latest config format version this codebase understands.
 * Bump this whenever you add a new migration step.
 */
const LATEST_CONFIG_VERSION = 4;

/**
 * Detect which config-format version a config object follows.
 *
 * Heuristics (in order):
 *  4  - has `context.autoCompact` AND `tools.file`
 *  3  - has `tools.shell.maxBuffer` OR `agent.maxToolTurns`
 *  2  - has `agent.maxTurns` (legacy name)
 *  1  - has `agent.model` but no `context` section
 *  0  - empty object (never migrated)
 *
 * @param {object} config
 * @returns {number} detected version
 */
function detectConfigVersion(config) {
  if (!config || typeof config !== 'object' || Object.keys(config).length === 0) {
    return 0;
  }

  // v4: has `context.autoCompact` and `tools.file`
  if (
    config.context &&
    typeof config.context === 'object' &&
    'autoCompact' in config.context &&
    config.tools &&
    typeof config.tools === 'object' &&
    config.tools.file &&
    typeof config.tools.file === 'object'
  ) {
    return 4;
  }

  // v3: has `tools.shell.maxBuffer` or `agent.maxToolTurns`
  if (
    (config.tools && config.tools.shell && 'maxBuffer' in config.tools.shell) ||
    (config.agent && 'maxToolTurns' in config.agent)
  ) {
    return 3;
  }

  // v2: has `agent.maxTurns`
  if (config.agent && 'maxTurns' in config.agent) {
    return 2;
  }

  // v1: basic shape with agent.model
  if (config.agent && 'model' in config.agent) {
    return 1;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Individual migrations
// ---------------------------------------------------------------------------

/**
 * v0 -> v1: Bootstrap — add `agent.model` default if missing.
 */
function migrate0to1(config) {
  if (!config.agent) config.agent = {};
  if (!config.agent.model) config.agent.model = 'claude-sonnet-4-20250514';
  if (!config.agent.name) config.agent.name = 'hax-agent';
  return config;
}

/**
 * v1 -> v2: Rename `agent.maxTurns` -> `agent.maxToolTurns`.
 */
function migrate1to2(config) {
  if (config.agent && 'maxTurns' in config.agent) {
    config.agent.maxToolTurns = config.agent.maxTurns;
    delete config.agent.maxTurns;
  }
  // Ensure default if neither exists
  if (config.agent && !('maxToolTurns' in config.agent)) {
    config.agent.maxToolTurns = 20;
  }
  return config;
}

/**
 * v2 -> v3: Split `tools.shell` out of flat tools, add `maxBuffer`.
 */
function migrate2to3(config) {
  if (!config.tools) config.tools = {};

  // Flattened shell settings from v2 might live on tools directly
  if (typeof config.tools.shell !== 'object') {
    const shell = {};
    if (typeof config.tools.enabled === 'boolean') {
      shell.enabled = config.tools.enabled;
      delete config.tools.enabled;
    }
    if (typeof config.tools.timeoutMs === 'number') {
      shell.timeoutMs = config.tools.timeoutMs;
      delete config.tools.timeoutMs;
    }
    shell.maxBuffer = shell.maxBuffer || 52_428_800;
    if (typeof config.tools.maxBuffer === 'number') {
      shell.maxBuffer = config.tools.maxBuffer;
      delete config.tools.maxBuffer;
    }
    config.tools.shell = shell;
  }

  if (typeof config.tools.shell !== 'object') {
    config.tools.shell = {};
  }
  if (!('maxBuffer' in config.tools.shell)) {
    config.tools.shell.maxBuffer = 52_428_800;
  }
  if (!('enabled' in config.tools.shell)) {
    config.tools.shell.enabled = true;
  }
  if (!('timeoutMs' in config.tools.shell)) {
    config.tools.shell.timeoutMs = 10_000;
  }

  return config;
}

/**
 * v3 -> v4: Add `tools.file` section, `context.autoCompact`, `permissions.persistPath`.
 */
function migrate3to4(config) {
  // tools.file
  if (!config.tools) config.tools = {};
  if (!config.tools.file || typeof config.tools.file !== 'object') {
    config.tools.file = { maxBytes: 512_000, allowedPaths: ['*'] };
  }

  // context.autoCompact
  if (!config.context) config.context = {};
  if (!('autoCompact' in config.context)) {
    config.context.autoCompact = false;
  }

  // permissions.persistPath
  if (!config.permissions) config.permissions = {};
  if (!('persistPath' in config.permissions)) {
    config.permissions.persistPath = undefined;
  }

  return config;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Ordered list of { from, to, fn } migration steps.
 */
const MIGRATIONS = Object.freeze([
  { from: 0, to: 1, fn: migrate0to1, description: 'Bootstrap — add agent.model default' },
  { from: 1, to: 2, fn: migrate1to2, description: 'Rename agent.maxTurns -> agent.maxToolTurns' },
  { from: 2, to: 3, fn: migrate2to3, description: 'Split tools.shell out, add maxBuffer' },
  { from: 3, to: 4, fn: migrate3to4, description: 'Add tools.file, context.autoCompact, permissions.persistPath' },
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a config needs migration to reach the latest version.
 * @param {object} config
 * @returns {boolean}
 */
function needsMigration(config) {
  return detectConfigVersion(config) < LATEST_CONFIG_VERSION;
}

/**
 * Migrate a config from one version to another.
 *
 * The config object is deep-cloned at the start so the original is never
 * mutated.  Unknown keys are preserved throughout.
 *
 * @param {object} config - the config object to migrate
 * @param {number} [fromVersion] - starting version (auto-detected if omitted)
 * @param {number} [toVersion] - target version (defaults to LATEST_CONFIG_VERSION)
 * @returns {{ config: object, applied: Array<{from:number,to:number,description:string}> }}
 */
function migrateConfig(config, fromVersion, toVersion) {
  const from = fromVersion !== undefined ? fromVersion : detectConfigVersion(config);
  const to = toVersion !== undefined ? toVersion : LATEST_CONFIG_VERSION;

  if (from < 0 || to > LATEST_CONFIG_VERSION) {
    throw new Error(
      `Invalid migration range: ${from} -> ${to}. Supported: 0 – ${LATEST_CONFIG_VERSION}`,
    );
  }

  if (from >= to) {
    return { config: JSON.parse(JSON.stringify(config)), applied: [] };
  }

  // Deep clone to avoid mutating caller's object
  let current = JSON.parse(JSON.stringify(config));
  const applied = [];

  // Find the chain of migrations needed
  const needed = MIGRATIONS.filter((m) => m.from >= from && m.to <= to);

  for (const migration of needed) {
    current = migration.fn(current);
    applied.push({ from: migration.from, to: migration.to, description: migration.description });
  }

  return { config: current, applied };
}

module.exports = {
  LATEST_CONFIG_VERSION,
  MIGRATIONS,
  detectConfigVersion,
  needsMigration,
  migrateConfig,
};
