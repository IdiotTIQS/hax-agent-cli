"use strict";

/**
 * Multi-stage export pipeline for HaxAgent sessions.
 *
 * Phases (run in order):
 *   1. extract   — Transform raw session data into intermediate representation
 *   2. transform — Apply content transformations (anonymize, highlight, etc.)
 *   3. format    — Render into the target output format
 *   4. optimize  — Post-render optimization (minify, compress, etc.)
 *   5. deliver   — Final delivery (write to disk, return buffer, etc.)
 *
 * Each stage has a `name`, optional `phase`, and a `handler(session, context, options)`.
 * The context object carries mutable state across stages:
 *   - context.data      — the intermediate representation from extraction
 *   - context.output    — the rendered output string after formatting
 *   - context.metadata  — arbitrary key/value bag populated by stages
 */

// ── phase order ────────────────────────────────────────────────────────────

const PHASE_ORDER = ["extract", "transform", "format", "optimize", "deliver"];

// ── ExportPipeline ─────────────────────────────────────────────────────────

class ExportPipeline {
  /**
   * @param {object} [options]
   * @param {boolean} [options.autoAddBuiltins]  If true, auto-add all built-in stages
   * @param {string[]} [options.builtinStages]    Subset of builtin stage names to auto-add
   */
  constructor(options = {}) {
    this._stages = [];
    this._options = Object.freeze({ ...options });

    if (options.autoAddBuiltins) {
      const names = options.builtinStages || BUILTIN_STAGE_NAMES;
      for (const name of names) {
        const def = BUILTIN_STAGES[name];
        if (def) {
          this.addStage(def);
        }
      }
    }
  }

  /**
   * Add a stage to the pipeline.
   *
   * @param {object|function} stage
   *   - {string}         name      Stage name (required)
   *   - {function}       handler   (session, context, options) => void | Promise<void>
   *   - {"extract"|"transform"|"format"|"optimize"|"deliver"} [phase]
   *   A plain function is accepted as shorthand for { name: 'anonymous', handler: fn }.
   * @returns {ExportPipeline} this (fluent)
   */
  addStage(stage) {
    if (typeof stage === "function") {
      stage = { name: "anonymous", handler: stage };
    }
    if (!stage || typeof stage.handler !== "function") {
      throw new TypeError("Stage must have a handler function");
    }
    const name = String(stage.name || "anonymous");
    const phase = stage.phase && PHASE_ORDER.includes(stage.phase) ? stage.phase : null;

    this._stages.push({ name, handler: stage.handler, phase });
    return this;
  }

  /**
   * Run the session through every stage in pipeline order.
   *
   * @param {object} session   Session-like object: { id, entries(), metadata()?, updatedAt? }
   * @param {object} [options] Per-run options merged with constructor options
   * @returns {Promise<object>}  { output, context } where context carries metadata and intermediate data
   */
  async process(session, options = {}) {
    const mergedOptions = { ...this._options, ...options };
    const context = {
      data: null,
      output: null,
      metadata: {},
      stagesRun: [],
    };

    // Sort stages by phase per PHASE_ORDER; un-phased stages go after phased ones
    const sorted = this._stages.slice().sort((a, b) => {
      const idxA = a.phase ? PHASE_ORDER.indexOf(a.phase) : PHASE_ORDER.length;
      const idxB = b.phase ? PHASE_ORDER.indexOf(b.phase) : PHASE_ORDER.length;
      return idxA - idxB;
    });

    for (const stage of sorted) {
      await stage.handler(session, context, mergedOptions);
      context.stagesRun.push(stage.name);
    }

    return { output: context.output, context };
  }

  /**
   * Return the pipeline stages (in insertion order, not sorted).
   * @returns {Array<{name:string, phase:string|null}>}
   */
  getStages() {
    return this._stages.map((s) => ({ name: s.name, phase: s.phase }));
  }

  /**
   * Remove all stages.
   */
  clear() {
    this._stages.length = 0;
  }
}

// ── built-in stages ────────────────────────────────────────────────────────

/**
 * Built-in stage: extract the session into a simple intermediate representation.
 *
 * Sets: context.data = { id, updatedAt, exportedAt, entries: [...] }
 */
function builtinExtract(session, context) {
  const entries = typeof session.entries === "function" ? session.entries() : [];
  const metadata = typeof session.metadata === "function" ? session.metadata() : {};

  context.data = {
    id: session.id || "",
    updatedAt: session.updatedAt || metadata?.updatedAt || "",
    exportedAt: new Date().toISOString(),
    projectName: metadata?.projectName || metadata?.project_root || "",
    projectRoot: metadata?.projectRoot || "",
    entries: entries.map((e) => ({
      role: e.role,
      content: e.content,
      name: e.name,
      data: e.data,
      timestamp: e.timestamp,
      isError: e.isError === true,
    })),
  };
  context.metadata.entryCount = entries.length;
}

/**
 * Built-in stage: anonymize sensitive patterns in content.
 *
 * Reads/writes: context.data
 */
function builtinAnonymize(_session, context, options) {
  if (!context.data) return;
  const patterns = options.anonymizePatterns || DEFAULT_ANONYMIZE_PATTERNS;

  for (const entry of context.data.entries) {
    if (typeof entry.content === "string") {
      entry.content = _applyPatterns(entry.content, patterns);
    }
    if (typeof entry.data === "string") {
      entry.data = _applyPatterns(entry.data, patterns);
    }
  }
}

const DEFAULT_ANONYMIZE_PATTERNS = [
  // Email
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL]" },
  // US phone
  { pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, replacement: "[PHONE]" },
  // SSN
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN]" },
  // API key patterns (common prefixes)
  { pattern: /\b(sk-[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_-]{30,}|(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,})\b/g, replacement: "[API_KEY]" },
  // IP addresses
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: "[IP]" },
];

function _applyPatterns(text, patterns) {
  let result = text;
  for (const { pattern, replacement } of patterns) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Built-in stage: compress "images" (base64 data URIs and large blobs).
 *
 * Reads/writes: context.data
 */
function builtinCompressImages(_session, context, _options) {
  if (!context.data) return;
  const dataUriRe = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]{200,}/g;

  for (const entry of context.data.entries) {
    if (typeof entry.content === "string") {
      entry.content = entry.content.replace(dataUriRe, "[COMPRESSED_IMAGE]");
    }
    if (typeof entry.data === "string") {
      entry.data = entry.data.replace(dataUriRe, "[COMPRESSED_IMAGE]");
    }
  }
  context.metadata.imagesCompressed = true;
}

/**
 * Built-in stage: highlight code in content by wrapping code blocks with markers.
 *
 * Reads/writes: context.data
 */
function builtinHighlightCode(_session, context, _options) {
  if (!context.data) return;
  const fenceRe = /```(\w*)\n([\s\S]*?)```/g;

  for (const entry of context.data.entries) {
    if (typeof entry.content !== "string") continue;
    entry.content = entry.content.replace(fenceRe, (_match, lang, code) => {
      const escaped = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const cls = lang ? ` class="language-${lang}"` : "";
      return `<pre${cls}><code>${escaped}</code></pre>`;
    });
  }
  context.metadata.codeHighlighted = true;
}

/**
 * Built-in stage: add metadata block at the top of rendered output.
 *
 * Reads/writes: context.output
 */
function builtinAddMetadata(_session, context, _options) {
  if (typeof context.output !== "string") return;
  const meta = context.data || {};
  const block = [
    "<!-- HaxAgent Export Metadata -->",
    `<!--   id: ${meta.id || "unknown"} -->`,
    `<!--   exportedAt: ${meta.exportedAt || new Date().toISOString()} -->`,
    `<!--   entries: ${meta.entries ? meta.entries.length : 0} -->`,
    meta.projectName ? `<!--   project: ${meta.projectName} -->` : "",
    "<!-- END Metadata -->",
  ]
    .filter(Boolean)
    .join("\n");

  // Insert after doctype if present, otherwise prepend
  const doctypeMatch = context.output.match(/^<!DOCTYPE[^>]*>/i);
  if (doctypeMatch) {
    const idx = doctypeMatch[0].length;
    context.output = doctypeMatch[0] + "\n" + block + "\n" + context.output.slice(idx);
  } else {
    context.output = block + "\n" + context.output;
  }
  context.metadata.metadataAdded = true;
}

/**
 * Built-in stage: minify output by stripping extra whitespace and comments
 * from HTML, CSS, and JS content.
 *
 * Reads/writes: context.output
 */
function builtinMinifyOutput(_session, context, options) {
  if (typeof context.output !== "string") return;
  const aggressive = options.minifyAggressive === true;

  if (aggressive) {
    // Aggressive: collapse all whitespace
    context.output = context.output
      .replace(/\s+/g, " ")
      .trim();
  } else {
    // Standard: remove HTML comments, collapse blank lines, trim trailing ws
    context.output = context.output
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim();
  }
  context.metadata.minified = true;
}

// ── built-in stage registry ────────────────────────────────────────────────

/** @type {Record<string,{name:string, phase:string, handler:Function}>} */
const BUILTIN_STAGES = Object.freeze({
  extract:       Object.freeze({ name: "extract",       phase: "extract",   handler: builtinExtract }),
  anonymize:     Object.freeze({ name: "anonymize",     phase: "transform", handler: builtinAnonymize }),
  compressImages:Object.freeze({ name: "compressImages",phase: "transform", handler: builtinCompressImages }),
  highlightCode: Object.freeze({ name: "highlightCode", phase: "transform", handler: builtinHighlightCode }),
  addMetadata:   Object.freeze({ name: "addMetadata",   phase: "optimize",  handler: builtinAddMetadata }),
  minifyOutput:  Object.freeze({ name: "minifyOutput",  phase: "optimize",  handler: builtinMinifyOutput }),
});

const BUILTIN_STAGE_NAMES = Object.keys(BUILTIN_STAGES);

// ── exports ────────────────────────────────────────────────────────────────

module.exports = {
  ExportPipeline,
  BUILTIN_STAGES,
  BUILTIN_STAGE_NAMES,
  PHASE_ORDER,
  // Internal helpers exported for testing
  _applyPatterns,
  _DEFAULT_ANONYMIZE_PATTERNS: DEFAULT_ANONYMIZE_PATTERNS,
};
