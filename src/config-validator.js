"use strict";

/**
 * Configuration validator — validates the merged settings object
 * against expected types, ranges, and constraints.
 *
 * Returns an array of validation issues (empty = valid).
 * Each issue: { path: string, message: string, severity: 'error' | 'warning' }
 */

const RULES = [
  {
    path: ['agent', 'name'],
    rule: (v) => typeof v === 'string' && v.trim().length > 0,
    message: 'agent.name must be a non-empty string',
  },
  {
    path: ['agent', 'model'],
    rule: (v) => typeof v === 'string' && v.trim().length > 0,
    message: 'agent.model must be a non-empty string',
  },
  {
    path: ['agent', 'maxTurns'],
    rule: (v) => Number.isSafeInteger(v) && v > 0 && v <= 1000,
    message: 'agent.maxTurns must be an integer between 1 and 1000',
  },
  {
    path: ['agent', 'temperature'],
    rule: (v) => Number.isFinite(v) && v >= 0 && v <= 2,
    message: 'agent.temperature must be a number between 0 and 2',
  },
  {
    path: ['agent', 'apiKey'],
    rule: (v) => v === undefined || (typeof v === 'string' && v.trim().length > 0),
    message: 'agent.apiKey must be a non-empty string when set',
  },
  {
    path: ['agent', 'apiUrl'],
    rule: (v) => v === undefined || (typeof v === 'string' && isValidUrl(v)),
    message: 'agent.apiUrl must be a valid URL when set',
  },
  {
    path: ['memory', 'enabled'],
    rule: (v) => typeof v === 'boolean',
    message: 'memory.enabled must be a boolean',
  },
  {
    path: ['memory', 'maxItems'],
    rule: (v) => Number.isSafeInteger(v) && v > 0 && v <= 10000,
    message: 'memory.maxItems must be an integer between 1 and 10000',
  },
  {
    path: ['sessions', 'transcriptLimit'],
    rule: (v) => Number.isSafeInteger(v) && v > 0 && v <= 100_000,
    message: 'sessions.transcriptLimit must be an integer between 1 and 100000',
  },
  {
    path: ['context', 'enabled'],
    rule: (v) => typeof v === 'boolean',
    message: 'context.enabled must be a boolean',
  },
  {
    path: ['context', 'windowTokens'],
    rule: (v) => v === undefined || (Number.isSafeInteger(v) && v > 0),
    message: 'context.windowTokens must be a positive integer when set',
  },
  {
    path: ['context', 'reserveOutputTokens'],
    rule: (v) => Number.isSafeInteger(v) && v > 0,
    message: 'context.reserveOutputTokens must be a positive integer',
  },
  {
    path: ['context', 'charsPerToken'],
    rule: (v) => Number.isFinite(v) && v > 0 && v <= 100,
    message: 'context.charsPerToken must be a positive number <= 100',
  },
  {
    path: ['fileContext', 'enabled'],
    rule: (v) => typeof v === 'boolean',
    message: 'fileContext.enabled must be a boolean',
  },
  {
    path: ['fileContext', 'maxFiles'],
    rule: (v) => Number.isSafeInteger(v) && v > 0 && v <= 100,
    message: 'fileContext.maxFiles must be an integer between 1 and 100',
  },
  {
    path: ['fileContext', 'maxIndexFiles'],
    rule: (v) => Number.isSafeInteger(v) && v > 0 && v <= 100_000,
    message: 'fileContext.maxIndexFiles must be an integer between 1 and 100000',
  },
  {
    path: ['fileContext', 'maxFileSize'],
    rule: (v) => Number.isSafeInteger(v) && v > 0,
    message: 'fileContext.maxFileSize must be a positive integer',
  },
  {
    path: ['fileContext', 'maxBytesPerFile'],
    rule: (v) => Number.isSafeInteger(v) && v > 0,
    message: 'fileContext.maxBytesPerFile must be a positive integer',
  },
  {
    path: ['fileContext', 'maxTotalBytes'],
    rule: (v) => Number.isSafeInteger(v) && v > 0,
    message: 'fileContext.maxTotalBytes must be a positive integer',
  },
  {
    path: ['permissions', 'mode'],
    rule: (v) => ['normal', 'yolo'].includes(v),
    message: 'permissions.mode must be "normal" or "yolo"',
  },
  {
    path: ['tools', 'shell', 'enabled'],
    rule: (v) => typeof v === 'boolean',
    message: 'tools.shell.enabled must be a boolean',
  },
  {
    path: ['tools', 'shell', 'timeoutMs'],
    rule: (v) => Number.isSafeInteger(v) && v > 0 && v <= 600_000,
    message: 'tools.shell.timeoutMs must be an integer between 1 and 600000',
  },
  {
    path: ['tools', 'shell', 'maxBuffer'],
    rule: (v) => Number.isSafeInteger(v) && v > 0,
    message: 'tools.shell.maxBuffer must be a positive integer',
  },
  {
    path: ['ui', 'locale'],
    rule: (v) => typeof v === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(v),
    message: 'ui.locale must be a valid locale string (e.g. "en", "zh-CN")',
  },
];

/**
 * Validate a settings object against the defined rules.
 * @param {object} settings
 * @returns {Array<{ path: string, message: string, severity: string }>}
 */
function validateSettings(settings = {}) {
  const issues = [];

  for (const rule of RULES) {
    const value = getNestedValue(settings, rule.path);

    try {
      if (!rule.rule(value, settings)) {
        issues.push({
          path: rule.path.join('.'),
          message: rule.message,
          severity: rule.severity || 'error',
        });
      }
    } catch (error) {
      issues.push({
        path: rule.path.join('.'),
        message: `Validation error: ${error.message}`,
        severity: 'error',
      });
    }
  }

  return issues;
}

/**
 * Validate settings and throw if critical issues exist.
 * @param {object} settings
 * @param {{ strict?: boolean }} [options]
 * @returns {Array<{ path: string, message: string, severity: string }>} warnings only
 */
function assertValidSettings(settings, options = {}) {
  const issues = validateSettings(settings);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  if (errors.length > 0) {
    const message = errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
    throw new Error(`Configuration validation failed:\n${message}`);
  }

  if (options.strict && warnings.length > 0) {
    const message = warnings.map((w) => `  ${w.path}: ${w.message}`).join('\n');
    throw new Error(`Configuration has warnings:\n${message}`);
  }

  return warnings;
}

/**
 * @param {object} obj
 * @param {string[]} path
 * @returns {any}
 */
function getNestedValue(obj, path) {
  let cursor = obj;

  for (const segment of path) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') {
      return undefined;
    }

    cursor = cursor[segment];
  }

  return cursor;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isValidUrl(value) {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol);
  } catch (_) {
    return false;
  }
}

module.exports = { RULES, assertValidSettings, validateSettings };
