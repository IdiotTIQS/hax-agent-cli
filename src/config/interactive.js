"use strict";

/**
 * Interactive configuration editor and validator for HaxAgent.
 *
 * NOTE: The `edit()` method is designed for programmatic consumption — it
 * returns prompt descriptors rather than actually reading from stdin.  A UI
 * layer (CLI, desktop) can use these descriptors to render input prompts.
 */

const { ALL_SECTIONS, lookupEntry, flattenSchema, validateEntry } = require('./schema');

// ---------------------------------------------------------------------------
// ConfigEditor
// ---------------------------------------------------------------------------

class ConfigEditor {
  /**
   * @param {object} currentConfig - the current config to diff/validate against
   */
  constructor(currentConfig = {}) {
    this._config = currentConfig;
  }

  /**
   * Return prompt descriptors for interactively editing a section.
   *
   * Each descriptor:
   *   { key, type, currentValue, description, choices, min, max, envVar }
   *
   * The caller iterates over the descriptors, presents them to the user,
   * collects answers, and rebuilds the config object.
   *
   * @param {string} section - section name (e.g. 'agent', 'tools', 'ui')
   * @returns {Array<object>} prompt descriptors
   */
  edit(section) {
    const entries = ALL_SECTIONS[section];
    if (!entries) return [];

    return entries.map((entry) => {
      let currentValue = undefined;

      if (entry.key.includes('.')) {
        const parts = entry.key.split('.');
        let cursor = this._config;
        for (const part of parts) {
          if (cursor && typeof cursor === 'object') cursor = cursor[part];
          else { cursor = undefined; break; }
        }
        currentValue = cursor;
      } else {
        const sec = this._config[section];
        if (sec && typeof sec === 'object') {
          currentValue = sec[entry.key];
        }
      }

      return {
        key: entry.key,
        path: `${section}.${entry.key}`,
        type: entry.type,
        currentValue,
        default: entry.default,
        description: entry.description,
        choices: entry.choices,
        min: entry.min,
        max: entry.max,
        envVar: entry.envVar,
      };
    });
  }

  /**
   * Produce a human-readable diff between two configs.
   *
   * @param {object} oldConfig
   * @param {object} newConfig
   * @returns {Array<{path:string, kind:'added'|'removed'|'changed', oldValue:*, newValue:*}>}
   */
  diff(oldConfig, newConfig) {
    const changes = [];

    const flatEntries = flattenSchema();

    for (const entry of flatEntries) {
      const oldValue = getByPath(oldConfig, entry.path);
      const newValue = getByPath(newConfig, entry.path);

      if (oldValue === undefined && newValue !== undefined) {
        changes.push({ path: entry.path, kind: 'added', oldValue: undefined, newValue });
      } else if (oldValue !== undefined && newValue === undefined) {
        changes.push({ path: entry.path, kind: 'removed', oldValue, newValue: undefined });
      } else if (oldValue !== newValue) {
        if (typeof oldValue === 'object' && typeof newValue === 'object') {
          if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            changes.push({ path: entry.path, kind: 'changed', oldValue, newValue });
          }
        } else {
          changes.push({ path: entry.path, kind: 'changed', oldValue, newValue });
        }
      }
    }

    // Also surface completely unknown keys (forward-compat)
    const unknownKeys = findUnknownKeys(oldConfig, newConfig);
    for (const key of unknownKeys) {
      const oldV = getByPath(oldConfig, key);
      const newV = getByPath(newConfig, key);
      changes.push({ path: key, kind: 'changed', oldValue: oldV, newValue: newV });
    }

    return changes;
  }

  /**
   * Explain a single setting.
   *
   * @param {string} settingPath - dotted path like "agent.model"
   * @returns {object|null} { key, type, default, description, envVar, choices, currentValue }
   */
  explain(settingPath) {
    const entry = lookupEntry(settingPath);
    if (!entry) return null;

    return {
      key: settingPath,
      type: entry.type,
      default: entry.default,
      description: entry.description,
      envVar: entry.envVar,
      choices: entry.choices,
      currentValue: getByPath(this._config, settingPath),
    };
  }

  /**
   * Validate the entire config against the schema.
   *
   * @param {object} config
   * @returns {Array<{path:string, message:string}>} list of validation errors
   */
  validateFull(config) {
    const errors = [];
    const flat = flattenSchema();

    for (const entry of flat) {
      const value = getByPath(config, entry.path);
      const err = validateEntry(entry, value);
      if (err) {
        errors.push({ path: entry.path, message: err });
      }
    }

    return errors;
  }

  /**
   * Suggest fixes for common configuration issues.
   *
   * @param {object} config
   * @returns {Array<{severity:'error'|'warn'|'info', path:string, message:string, suggestion:string}>}
   */
  suggestFixes(config) {
    const suggestions = [];

    // Check for missing API key
    const apiKey = getByPath(config, 'agent.apiKey');
    if (!apiKey) {
      suggestions.push({
        severity: 'error',
        path: 'agent.apiKey',
        message: 'No API key configured',
        suggestion: 'Set ANTHROPIC_API_KEY (env var) or configure agent.apiKey in settings.json',
      });
    }

    // Check for yolo mode warning
    const permissionsMode = getByPath(config, 'permissions.mode');
    if (permissionsMode === 'yolo') {
      suggestions.push({
        severity: 'warn',
        path: 'permissions.mode',
        message: 'Permissions mode is "yolo" — all actions auto-approved',
        suggestion: 'Consider using "normal" or "auto" mode for safer operation',
      });
    }

    // Check for very high maxToolTurns
    const maxToolTurns = getByPath(config, 'agent.maxToolTurns');
    if (typeof maxToolTurns === 'number' && maxToolTurns > 50) {
      suggestions.push({
        severity: 'warn',
        path: 'agent.maxToolTurns',
        message: `maxToolTurns is ${maxToolTurns} (high) — may cause long-running loops`,
        suggestion: 'Consider a lower value (25-50) unless running autonomous tasks',
      });
    }

    // Check for low reserveOutputTokens
    const reserveOutputTokens = getByPath(config, 'context.reserveOutputTokens');
    if (typeof reserveOutputTokens === 'number' && reserveOutputTokens < 4096) {
      suggestions.push({
        severity: 'info',
        path: 'context.reserveOutputTokens',
        message: `reserveOutputTokens (${reserveOutputTokens}) may be too low for complex responses`,
        suggestion: 'Consider setting to at least 4096-8192 for best results',
      });
    }

    // Check shell timeout too short
    const shellTimeout = getByPath(config, 'tools.shell.timeoutMs');
    if (typeof shellTimeout === 'number' && shellTimeout < 5000) {
      suggestions.push({
        severity: 'warn',
        path: 'tools.shell.timeoutMs',
        message: `Shell timeout (${shellTimeout}ms) is very short`,
        suggestion: 'Consider at least 10000ms to avoid timeouts on slow commands',
      });
    }

    // Check file.maxBytes
    const fileMaxBytes = getByPath(config, 'tools.file.maxBytes');
    if (typeof fileMaxBytes === 'number' && fileMaxBytes > 10_485_760) {
      suggestions.push({
        severity: 'info',
        path: 'tools.file.maxBytes',
        message: `file.maxBytes is ${fileMaxBytes} (${(fileMaxBytes / 1_048_576).toFixed(1)}MB) — may cause context overflow`,
        suggestion: 'Consider a lower value unless you specifically need large file reads',
      });
    }

    // Check if memory is disabled with eviction policy set
    const memEnabled = getByPath(config, 'memory.enabled');
    const memEviction = getByPath(config, 'memory.evictionPolicy');
    if (memEnabled === false && memEviction) {
      suggestions.push({
        severity: 'info',
        path: 'memory.enabled',
        message: 'Memory is disabled but eviction policy is configured',
        suggestion: 'Enable memory to use eviction, or ignore this if intentional',
      });
    }

    return suggestions;
  }

  /**
   * Export a config object as shell environment variable assignments.
   *
   * @param {object} config
   * @returns {string} shell script lines (export VAR=VALUE)
   */
  exportEnvVars(config) {
    const lines = [];
    const flat = flattenSchema();

    for (const entry of flat) {
      const value = getByPath(config, entry.path);
      if (value === undefined || value === null) continue;

      const envVar = entry.envVar;
      if (!envVar) continue;

      // Detect the canonical env var: use the first one listed if multiple
      const primaryVar = envVar.includes('||') ? envVar : envVar;
      const varName = typeof primaryVar === 'string' && primaryVar.includes('||')
        ? primaryVar.split('||')[0].trim()
        : primaryVar;

      let shellValue;
      if (typeof value === 'boolean') {
        shellValue = value ? '1' : '0';
      } else if (Array.isArray(value)) {
        shellValue = value.join(',');
      } else if (typeof value === 'object') {
        shellValue = JSON.stringify(value);
      } else {
        shellValue = String(value);
      }

      // Only export the first var name from the list
      const names = varName.split('||')[0].trim();
      lines.push(`export ${names}="${shellValue.replace(/"/g, '\\"')}"`);
    }

    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get a nested value by dotted path.
 */
function getByPath(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let cursor = obj;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

/**
 * Find paths present in either object that are NOT in the schema.
 */
function findUnknownKeys(oldObj, newObj) {
  const keys = new Set();
  collectKeys(oldObj, '', keys);
  collectKeys(newObj, '', keys);

  const flatSchema = flattenSchema();
  const schemaPaths = new Set(flatSchema.map((e) => e.path));

  return [...keys].filter((k) => !schemaPaths.has(k) && k !== '');
}

function collectKeys(obj, prefix, set) {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      collectKeys(value, fullKey, set);
    } else {
      set.add(fullKey);
    }
  }
}

module.exports = { ConfigEditor };
