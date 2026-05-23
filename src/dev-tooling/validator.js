"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { PLUGIN_HOOK_NAMES } = require("../plugins");
const { parseFrontmatter } = require("../skills/parser");

/**
 * Dev Tooling: Validator
 *
 * Validates HaxAgent resource files: plugins, skills, agent definitions,
 * and configuration objects.
 *
 * Each validator returns: { valid: boolean, errors: string[] }
 */

// ── Plugin Validator ─────────────────────────────────────────────────────────

const VALID_HOOK_NAMES_SET = new Set(PLUGIN_HOOK_NAMES);

/**
 * Validate a plugin file structure is correct.
 *
 * Checks:
 *  - File exists and is loadable as a CommonJS module
 *  - Exports an object with required `name` and optional `hooks`
 *  - Every hook in `hooks` is a known hook name and a function
 *
 * @param {string} filePath - Absolute path to the plugin file
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validatePlugin(filePath) {
  const errors = [];
  const warnings = [];

  // Check file exists
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    errors.push(`Plugin file not found: ${resolved}`);
    return { valid: false, errors, warnings };
  }

  // Check extension
  const ext = path.extname(resolved);
  if (ext !== ".js" && ext !== ".cjs" && ext !== ".mjs") {
    warnings.push(`Unexpected plugin extension "${ext}". Expected .js, .cjs, or .mjs.`);
  }

  // Load module
  let plugin;
  try {
    // Clear require cache to ensure fresh load
    delete require.cache[require.resolve(resolved)];
    plugin = require(resolved);
  } catch (err) {
    errors.push(`Failed to load plugin module: ${err.message}`);
    return { valid: false, errors, warnings };
  }

  // Validate shape
  if (!plugin || typeof plugin !== "object") {
    errors.push("Plugin must export an object");
    return { valid: false, errors, warnings };
  }

  if (Array.isArray(plugin)) {
    errors.push("Plugin must export an object, not an array");
    return { valid: false, errors, warnings };
  }

  // name (required)
  if (typeof plugin.name !== "string" || !plugin.name.trim()) {
    errors.push("Plugin must have a non-empty `name` string property");
  } else if (plugin.name.length > 64) {
    warnings.push(`Plugin name "${plugin.name}" is longer than 64 characters`);
  }

  // version (optional, but check format)
  if (plugin.version !== undefined) {
    if (typeof plugin.version !== "string") {
      errors.push("Plugin version must be a string (e.g. \"1.0.0\")");
    } else if (!/^\d+\.\d+\.\d+/.test(plugin.version)) {
      warnings.push(`Plugin version "${plugin.version}" does not follow semver`);
    }
  }

  // hooks
  if (plugin.hooks !== undefined) {
    if (typeof plugin.hooks !== "object" || Array.isArray(plugin.hooks)) {
      errors.push("Plugin hooks must be an object mapping hook names to functions");
    } else {
      for (const [hookName, hookFn] of Object.entries(plugin.hooks)) {
        if (!VALID_HOOK_NAMES_SET.has(hookName)) {
          errors.push(`Unknown hook "${hookName}". Valid hooks: ${PLUGIN_HOOK_NAMES.join(", ")}`);
        } else if (typeof hookFn !== "function") {
          errors.push(`Hook "${hookName}" must be a function, got ${typeof hookFn}`);
        }
      }
    }
  }

  // description
  if (plugin.description !== undefined && typeof plugin.description !== "string") {
    warnings.push("Plugin description should be a string");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ── Skill Validator ──────────────────────────────────────────────────────────

const KNOWN_FRONTMATTER_KEYS = new Set([
  "name",
  "description",
  "arguments",
  "argument-hint",
  "when_to_use",
  "allowed-tools",
  "user-invocable",
  "context",
]);

/**
 * Validate a skill file (SKILL.md) frontmatter and structure.
 *
 * @param {string} filePath - Absolute path to the SKILL.md file
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateSkill(filePath) {
  const errors = [];
  const warnings = [];

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    errors.push(`Skill file not found: ${resolved}`);
    return { valid: false, errors, warnings };
  }

  const ext = path.extname(resolved);
  if (ext !== ".md") {
    warnings.push(`Skill file should have .md extension, got "${ext}"`);
  }

  let content;
  try {
    content = fs.readFileSync(resolved, "utf-8");
  } catch (err) {
    errors.push(`Failed to read skill file: ${err.message}`);
    return { valid: false, errors, warnings };
  }

  if (!content.trim()) {
    errors.push("Skill file is empty");
    return { valid: false, errors, warnings };
  }

  const { frontmatter, content: body } = parseFrontmatter(content);

  // Frontmatter must exist
  if (!content.startsWith("---")) {
    errors.push("Missing frontmatter (file must start with ---)");
    return { valid: false, errors, warnings };
  }

  // Required frontmatter fields
  if (!frontmatter.name || typeof frontmatter.name !== "string" || !frontmatter.name.trim()) {
    errors.push("Frontmatter `name` is required and must be a non-empty string");
  }

  if (!frontmatter.description || typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
    errors.push("Frontmatter `description` is required and must be a non-empty string");
  }

  // Unknown frontmatter keys
  for (const key of Object.keys(frontmatter)) {
    if (!KNOWN_FRONTMATTER_KEYS.has(key)) {
      warnings.push(`Unknown frontmatter key: "${key}"`);
    }
  }

  // Body content
  if (!body || !body.trim()) {
    warnings.push("Skill body is empty — add instructions after the frontmatter");
  }

  // user-invocable should be boolean-ish
  if (frontmatter["user-invocable"] !== undefined) {
    const val = frontmatter["user-invocable"];
    if (val !== "true" && val !== "false" && val !== true && val !== false) {
      warnings.push(`user-invocable should be "true" or "false", got "${val}"`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ── Agent Definition Validator ───────────────────────────────────────────────

/**
 * Validate an agent definition object.
 *
 * @param {string|object} agentDefOrPath - Either an agent definition object or a file path
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateAgentDef(agentDefOrPath) {
  const errors = [];
  const warnings = [];

  let def;

  if (typeof agentDefOrPath === "string") {
    const resolved = path.resolve(agentDefOrPath);
    if (!fs.existsSync(resolved)) {
      errors.push(`Agent definition file not found: ${resolved}`);
      return { valid: false, errors, warnings };
    }

    // Clear require cache
    delete require.cache[require.resolve(resolved)];
    try {
      def = require(resolved);
    } catch (err) {
      errors.push(`Failed to load agent definition: ${err.message}`);
      return { valid: false, errors, warnings };
    }
  } else if (typeof agentDefOrPath === "object" && agentDefOrPath !== null) {
    def = agentDefOrPath;
  } else {
    errors.push("Expected an object or file path string");
    return { valid: false, errors, warnings };
  }

  if (Array.isArray(def)) {
    errors.push("Agent definition must be an object, not an array");
    return { valid: false, errors, warnings };
  }

  // name (required)
  if (typeof def.name !== "string" || !def.name.trim()) {
    errors.push("Agent definition requires a non-empty `name` string");
  }

  // description (required)
  if (typeof def.description !== "string" || !def.description.trim()) {
    errors.push("Agent definition requires a non-empty `description` string");
  }

  // instructions
  if (def.instructions !== undefined) {
    if (typeof def.instructions === "string") {
      if (!def.instructions.trim()) {
        warnings.push("Agent instructions string is empty");
      }
    } else if (Array.isArray(def.instructions)) {
      if (def.instructions.length === 0) {
        warnings.push("Agent instructions array is empty");
      } else {
        for (let i = 0; i < def.instructions.length; i++) {
          if (typeof def.instructions[i] !== "string") {
            errors.push(`Agent instructions[${i}] must be a string`);
          }
        }
      }
    } else {
      errors.push("Agent instructions must be a string, array of strings, or undefined");
    }
  } else {
    warnings.push("Agent definition has no instructions");
  }

  // tools
  if (def.tools !== undefined) {
    if (!Array.isArray(def.tools)) {
      errors.push("Agent tools must be an array of tool name strings");
    } else {
      for (let i = 0; i < def.tools.length; i++) {
        if (typeof def.tools[i] !== "string") {
          errors.push(`Agent tools[${i}] must be a string`);
        }
      }
    }
  }

  // settings
  if (def.settings !== undefined) {
    if (typeof def.settings !== "object" || def.settings === null || Array.isArray(def.settings)) {
      errors.push("Agent settings must be a plain object");
    } else {
      if (def.settings.maxTurns !== undefined && (!Number.isSafeInteger(def.settings.maxTurns) || def.settings.maxTurns < 1)) {
        errors.push("settings.maxTurns must be a positive integer");
      }
      if (def.settings.temperature !== undefined && (typeof def.settings.temperature !== "number" || def.settings.temperature < 0 || def.settings.temperature > 2)) {
        errors.push("settings.temperature must be a number between 0 and 2");
      }
    }
  }

  // agents (sub-agents)
  if (def.agents !== undefined) {
    if (!Array.isArray(def.agents)) {
      errors.push("Agent `agents` must be an array");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ── Config Validator ─────────────────────────────────────────────────────────

const CONFIG_SCHEMA = {
  agent: {
    type: "object",
    required: true,
    properties: {
      name: { type: "string", required: false },
      model: { type: "string", required: false },
      maxTurns: { type: "integer", min: 1, max: 1000, required: false },
      temperature: { type: "number", min: 0, max: 2, required: false },
      apiKey: { type: "string", required: false },
      apiUrl: { type: "string", required: false },
    },
  },
  memory: {
    type: "object",
    required: false,
    properties: {
      enabled: { type: "boolean", required: false },
      maxItems: { type: "integer", min: 1, max: 10000, required: false },
    },
  },
  sessions: {
    type: "object",
    required: false,
    properties: {
      transcriptLimit: { type: "integer", min: 1, max: 100000, required: false },
    },
  },
  context: {
    type: "object",
    required: false,
    properties: {
      enabled: { type: "boolean", required: false },
      windowTokens: { type: "integer", min: 1, required: false },
      reserveOutputTokens: { type: "integer", min: 1, required: false },
    },
  },
  fileContext: {
    type: "object",
    required: false,
    properties: {
      enabled: { type: "boolean", required: false },
      maxFiles: { type: "integer", min: 1, max: 100, required: false },
      maxIndexFiles: { type: "integer", min: 1, max: 100000, required: false },
    },
  },
  permissions: {
    type: "object",
    required: false,
    properties: {
      mode: { type: "string", enum: ["normal", "yolo"], required: false },
    },
  },
};

/**
 * Validate a configuration object against the expected schema.
 *
 * @param {object} config - The HaxAgent configuration object
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config || typeof config !== "object") {
    errors.push("Config must be a non-null object");
    return { valid: false, errors, warnings };
  }

  if (Array.isArray(config)) {
    errors.push("Config must be an object, not an array");
    return { valid: false, errors, warnings };
  }

  // Validate top-level sections
  for (const [sectionKey, sectionSchema] of Object.entries(CONFIG_SCHEMA)) {
    const section = config[sectionKey];

    if (sectionSchema.required && (section === undefined || section === null)) {
      errors.push(`Missing required config section: "${sectionKey}"`);
      continue;
    }

    if (section === undefined) continue;

    if (typeof section !== "object" || section === null || Array.isArray(section)) {
      errors.push(`Config section "${sectionKey}" must be a plain object`);
      continue;
    }

    // Validate properties within the section
    if (sectionSchema.properties) {
      for (const [propKey, propSchema] of Object.entries(sectionSchema.properties)) {
        const val = section[propKey];
        if (val === undefined) continue;

        validateProperty(`${sectionKey}.${propKey}`, val, propSchema, errors, warnings);
      }
    }

    // Warn about unknown keys
    for (const key of Object.keys(section)) {
      if (!sectionSchema.properties || !(key in sectionSchema.properties)) {
        warnings.push(`Unknown config key: "${sectionKey}.${key}"`);
      }
    }
  }

  // Warn about unknown top-level sections
  for (const key of Object.keys(config)) {
    if (!(key in CONFIG_SCHEMA)) {
      warnings.push(`Unknown config section: "${key}"`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ── Property Validation Helper ──────────────────────────────────────────────

function validateProperty(path, value, schema, errors, warnings) {
  if (schema.type === "integer") {
    if (!Number.isInteger(value)) {
      if (typeof value === "number" && !Number.isInteger(value)) {
        errors.push(`${path}: must be an integer, got ${value}`);
      } else {
        errors.push(`${path}: expected integer, got ${typeof value}`);
      }
      return;
    }
  } else if (schema.type && typeof value !== schema.type) {
    errors.push(`${path}: expected ${schema.type}, got ${typeof value}`);
    return;
  }

  if (schema.type === "string" && schema.enum) {
    if (!schema.enum.includes(value)) {
      errors.push(`${path}: must be one of [${schema.enum.join(", ")}], got "${value}"`);
    }
  }

  if (typeof schema.min === "number" && value < schema.min) {
    errors.push(`${path}: must be >= ${schema.min}, got ${value}`);
  }

  if (typeof schema.max === "number" && value > schema.max) {
    errors.push(`${path}: must be <= ${schema.max}, got ${value}`);
  }
}

module.exports = {
  validatePlugin,
  validateSkill,
  validateAgentDef,
  validateConfig,
  CONFIG_SCHEMA,
};
