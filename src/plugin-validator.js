"use strict";

const { PLUGIN_HOOK_NAMES } = require('./plugins');

/**
 * Plugin schema validator.
 *
 * Validates plugin module shape before registration.
 * Returns detailed validation results so users can debug errors.
 */

const VALID_HOOK_NAMES = new Set(PLUGIN_HOOK_NAMES);

/**
 * Validate a plugin object before registration.
 *
 * @param {object} plugin - The plugin module exports
 * @returns {{ valid: boolean, errors: Array<{ path: string, message: string }>, warnings: Array<{ path: string, message: string }> }}
 */
function validatePlugin(plugin) {
  const errors = [];
  const warnings = [];

  if (!plugin || typeof plugin !== 'object') {
    errors.push({ path: '', message: 'Plugin must be an object' });
    return { valid: false, errors, warnings };
  }

  if (Array.isArray(plugin)) {
    errors.push({ path: '', message: 'Plugin must be an object, not an array' });
    return { valid: false, errors, warnings };
  }

  // Validate name (required)
  if (typeof plugin.name !== 'string' || !plugin.name.trim()) {
    errors.push({ path: 'name', message: 'Plugin name is required and must be a non-empty string' });
  } else if (plugin.name.length > 64) {
    warnings.push({ path: 'name', message: 'Plugin name is longer than 64 characters' });
  } else if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/.test(plugin.name) && plugin.name.length >= 3) {
    warnings.push({
      path: 'name',
      message: 'Plugin name should use only alphanumeric characters, dots, hyphens, and underscores',
    });
  }

  // Validate version (optional)
  if (plugin.version !== undefined) {
    if (typeof plugin.version !== 'string') {
      errors.push({ path: 'version', message: 'Plugin version must be a string (e.g., "1.0.0")' });
    } else if (!/^\d+\.\d+\.\d+/.test(plugin.version)) {
      warnings.push({ path: 'version', message: 'Plugin version does not follow semver (e.g., "1.0.0")' });
    }
  }

  // Validate hooks
  if (plugin.hooks !== undefined) {
    if (typeof plugin.hooks !== 'object' || Array.isArray(plugin.hooks)) {
      errors.push({ path: 'hooks', message: 'hooks must be an object mapping hook names to functions' });
    } else {
      const seenHooks = new Set();

      for (const [hookName, hookFn] of Object.entries(plugin.hooks)) {
        if (!VALID_HOOK_NAMES.has(hookName)) {
          errors.push({
            path: `hooks.${hookName}`,
            message: `Unknown hook "${hookName}". Valid hooks: ${PLUGIN_HOOK_NAMES.join(', ')}`,
          });
          continue;
        }

        if (seenHooks.has(hookName)) {
          warnings.push({
            path: `hooks.${hookName}`,
            message: `Duplicate hook "${hookName}" — only the last one will be used`,
          });
        }
        seenHooks.add(hookName);

        if (typeof hookFn !== 'function') {
          errors.push({
            path: `hooks.${hookName}`,
            message: `Hook "${hookName}" must be a function, got ${typeof hookFn}`,
          });
          continue;
        }

        // Check function arity
        if (hookFn.length === 0) {
          warnings.push({
            path: `hooks.${hookName}`,
            message: `Hook "${hookName}" expects no parameters. Hooks should accept a context argument.`,
          });
        }
      }
    }
  }

  // Validate dependencies (optional metadata)
  if (plugin.metadata !== undefined) {
    if (typeof plugin.metadata !== 'object' || Array.isArray(plugin.metadata)) {
      warnings.push({ path: 'metadata', message: 'metadata should be a plain object' });
    }
  }

  // Validate description (optional)
  if (plugin.description !== undefined && typeof plugin.description !== 'string') {
    warnings.push({ path: 'description', message: 'description should be a string' });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Assert that a plugin is valid, throwing on the first error.
 *
 * @param {object} plugin
 * @throws {Error} If validation fails
 */
function assertValidPlugin(plugin) {
  const result = validatePlugin(plugin);
  if (!result.valid) {
    const message = result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
    throw new Error(`Plugin validation failed:\n${message}`);
  }
}

/**
 * Format validation results for display.
 *
 * @param {{ errors: Array, warnings: Array }} result
 * @returns {string}
 */
function formatPluginValidationResult(result) {
  const parts = [];

  if (result.errors.length > 0) {
    parts.push(`Errors (${result.errors.length}):`);
    for (const error of result.errors) {
      parts.push(`  ✖ ${error.path}: ${error.message}`);
    }
  }

  if (result.warnings.length > 0) {
    if (parts.length > 0) parts.push('');
    parts.push(`Warnings (${result.warnings.length}):`);
    for (const warning of result.warnings) {
      parts.push(`  ⚠ ${warning.path}: ${warning.message}`);
    }
  }

  if (parts.length === 0) {
    return 'Plugin is valid.';
  }

  return parts.join('\n');
}

module.exports = {
  PLUGIN_HOOK_NAMES,
  assertValidPlugin,
  formatPluginValidationResult,
  validatePlugin,
};
