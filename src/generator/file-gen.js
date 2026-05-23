"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { TemplateEngine } = require("../optimizer/template-engine");

/**
 * FileGenerator
 *
 * Produces individual files from templates.  Supports simple rendering
 * (template string + variables), declarative specs, batching, and dry-run
 * preview.  Post-generation hooks can format, lint, or adjust file modes.
 *
 * File spec shape:
 * {
 *   path:        string   — absolute or relative (resolved against cwd)
 *   template:    string   — template string with {{var}} syntax
 *   variables:   object   — key-value map for substitution
 *   overwrite:   boolean  — if false, skip when file exists (default true)
 *   createDirs:  boolean  — if true, mkdir -p for parent dirs (default true)
 *   hooks:       object   — { format?, lint?, chmod? }
 * }
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deep-merge variables into one map.  Later entries override earlier ones.
 *
 * @param {...object} sources
 * @returns {object}
 */
function mergeVariables(...sources) {
  const result = Object.create(null);
  for (const src of sources) {
    if (src && typeof src === "object") {
      Object.assign(result, src);
    }
  }
  return result;
}

// ── FileGenerator ────────────────────────────────────────────────────────────

class FileGenerator {
  /**
   * @param {object} [options]
   * @param {TemplateEngine} [options.engine]  — custom template engine
   * @param {string} [options.cwd]             — base directory for relative paths
   * @param {object} [options.defaults]        — default variables applied to all generations
   */
  constructor(options = {}) {
    /** @type {TemplateEngine} */
    this._engine = options.engine || new TemplateEngine();

    /** @type {string} */
    this._cwd = options.cwd || process.cwd();

    /** @type {object} */
    this._defaults = options.defaults || Object.create(null);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Render a template with variables.  Does NOT write to disk.
   *
   * @param {string} template — template string
   * @param {object} [variables={}] — substitution values
   * @returns {string} Rendered output.
   */
  generateFile(template, variables = {}) {
    const vars = mergeVariables(this._defaults, variables);
    if (template == null) return "";
    return this._engine.compile(String(template), vars);
  }

  /**
   * Generate a file from a declarative spec.  Writes to disk.
   *
   * @param {object} spec   — { path, template, variables, overwrite, createDirs, hooks }
   * @returns {{ filePath: string, written: boolean, content: string }}
   *   - written: true if the file was actually written to disk
   */
  generateFromSpec(spec) {
    this._validateSpec(spec, { requirePath: true });

    const filePath = path.isAbsolute(spec.path)
      ? spec.path
      : path.resolve(this._cwd, spec.path);

    const content = this.generateFile(spec.template, spec.variables);

    // Check overwrite flag.
    const overwrite = spec.overwrite !== false;
    if (fs.existsSync(filePath) && !overwrite) {
      return { filePath, written: false, content };
    }

    // Ensure parent directories exist.
    const createDirs = spec.createDirs !== false;
    if (createDirs) {
      const parent = path.dirname(filePath);
      fs.mkdirSync(parent, { recursive: true });
    }

    // Write the file.
    fs.writeFileSync(filePath, content, "utf-8");

    // Run post-generation hooks.
    if (spec.hooks && typeof spec.hooks === "object") {
      this._runHooks(filePath, spec.hooks);
    }

    return { filePath, written: true, content };
  }

  /**
   * Generate multiple files from an array of specs.
   *
   * @param {Array<object>} specs — array of file spec objects
   * @returns {Array<{ filePath: string, written: boolean, content: string }>}
   */
  generateBatch(specs) {
    if (!Array.isArray(specs)) {
      throw new TypeError("FileGenerator.generateBatch: specs must be an array");
    }

    const results = [];
    for (const spec of specs) {
      results.push(this.generateFromSpec(spec));
    }
    return results;
  }

  /**
   * Preview what a spec would produce without writing to disk.
   *
   * @param {object} spec — file spec (path is optional for dry runs)
   * @returns {{ filePath: string | null, content: string, wouldWrite: boolean }}
   */
  dryRun(spec) {
    this._validateSpec(spec, { requirePath: false });

    const filePath = spec.path
      ? (path.isAbsolute(spec.path) ? spec.path : path.resolve(this._cwd, spec.path))
      : null;

    const content = this.generateFile(spec.template, spec.variables);

    const overwrite = spec.overwrite !== false;
    let wouldWrite = overwrite;
    if (filePath && fs.existsSync(filePath) && !overwrite) {
      wouldWrite = false;
    }

    return { filePath, content, wouldWrite };
  }

  // ---------------------------------------------------------------------------
  // Private: hooks
  // ---------------------------------------------------------------------------

  /**
   * Execute post-generation hooks for a file.
   *
   * @param {string} filePath — absolute path to the generated file
   * @param {object} hooks   — { format?, lint?, chmod? }
   * @private
   */
  _runHooks(filePath, hooks) {
    if (hooks.format) {
      this._format(filePath, hooks.format);
    }
    if (hooks.lint) {
      this._lint(filePath, hooks.lint);
    }
    if (hooks.chmod) {
      this._chmod(filePath, hooks.chmod);
    }
  }

  /**
   * Run a formatter command against the generated file.
   *
   * @param {string} filePath
   * @param {string|object} formatConfig — command string or { command, args }
   * @private
   */
  _format(filePath, formatConfig) {
    const cmd = typeof formatConfig === "string"
      ? formatConfig
      : formatConfig.command;

    // Build the full command — substitute {file} placeholder if present.
    const fullCmd = cmd.replace(/\{file\}/g, filePath);

    try {
      execSync(fullCmd, { stdio: "pipe", timeout: 30000 });
    } catch (_err) {
      // Format failure is non-fatal — the file was already written.
    }
  }

  /**
   * Run a linter command against the generated file.
   *
   * @param {string} filePath
   * @param {string|object} lintConfig
   * @private
   */
  _lint(filePath, lintConfig) {
    const cmd = typeof lintConfig === "string"
      ? lintConfig
      : lintConfig.command;

    const fullCmd = cmd.replace(/\{file\}/g, filePath);

    try {
      execSync(fullCmd, { stdio: "pipe", timeout: 30000 });
    } catch (_err) {
      // Lint failure is non-fatal.
    }
  }

  /**
   * Change the file mode (permissions).
   *
   * @param {string} filePath
   * @param {string|number} mode — e.g. "755" or 0o755
   * @private
   */
  _chmod(filePath, mode) {
    const modeNum = typeof mode === "string"
      ? parseInt(mode, 8)
      : mode;

    if (!Number.isFinite(modeNum)) return;

    try {
      fs.chmodSync(filePath, modeNum);
    } catch (_err) {
      // chmod failure is non-fatal.
    }
  }

  // ---------------------------------------------------------------------------
  // Private: validation & helpers
  // ---------------------------------------------------------------------------

  /**
   * Validate a file spec object.
   *
   * @param {object} spec
   * @param {{ requirePath: boolean }} opts
   * @private
   */
  _validateSpec(spec, opts = {}) {
    if (!spec || typeof spec !== "object") {
      throw new TypeError("FileGenerator: spec must be an object");
    }
    if (typeof spec.template !== "string") {
      throw new TypeError("FileGenerator: spec.template must be a string");
    }
    if (opts.requirePath && !spec.path) {
      throw new TypeError("FileGenerator: spec.path must be a non-empty string");
    }
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  FileGenerator,
  mergeVariables,
};
