"use strict";

/**
 * Pluggable formatting pipeline.
 *
 * Register named formatters, then run text through the pipeline.
 * Formatters can be enabled/disabled by name, removed, and reordered.
 *
 * Formatter contract:
 *   {
 *     name: string,
 *     format(text, options): string,
 *     isStreamable?: boolean   // default false
 *   }
 */

/** @type {Map<string, Array<object>>} - per-instance weak-ish not needed, plain Map */
const _pipeline = Symbol("pipeline");
const _streamTransformers = Symbol("streamTransformers");

class FormatPipeline {
  constructor() {
    /** @type {Array<{name:string, fmt:object}>} */
    this[_pipeline] = [];
    /** @type {Set<string>} - names currently disabled */
    this.disabled = new Set();
  }

  /**
   * Register a formatter at the end of the pipeline.
   * @param {{name:string, format:function, isStreamable?:boolean}} formatter
   * @returns {this}
   */
  use(formatter) {
    if (!formatter || typeof formatter.name !== "string" || typeof formatter.format !== "function") {
      throw new TypeError("Formatter must have a string `name` and a `format` function");
    }

    // Remove duplicate by name (replace-at-end semantics)
    this.removeFormatter(formatter.name);
    this[_pipeline].push({ name: formatter.name, fmt: formatter });

    return this;
  }

  /**
   * Run `text` through every enabled formatter in order.
   * @param {string} text
   * @param {object} [options]
   * @returns {string}
   */
  format(text, options = {}) {
    let result = text;
    for (const entry of this[_pipeline]) {
      if (this.disabled.has(entry.name)) continue;
      result = entry.fmt.format(result, options);
    }
    return result;
  }

  /**
   * Create a Transform stream that applies the pipeline to each chunk.
   * Only streamable formatters are applied in streaming mode.
   *
   * @param {import('stream')} [inputStream] - optional readable source to pipe through
   * @returns {Transform}
   */
  formatStream(inputStream) {
    const { Transform } = require("stream");
    const pipeline = this;

    const transform = new Transform({
      decodeStrings: true,
      transform(chunk, encoding, callback) {
        let str = chunk.toString(encoding === "buffer" ? "utf8" : encoding);
        for (const entry of pipeline[_pipeline]) {
          if (pipeline.disabled.has(entry.name)) continue;
          if (entry.fmt.isStreamable !== true) continue;
          str = entry.fmt.format(str);
        }
        callback(null, str);
      },
    });

    if (inputStream) {
      inputStream.pipe(transform);
    }

    return transform;
  }

  /**
   * Remove a formatter by name.
   * @param {string} name
   * @returns {boolean} - true if removed, false if not found
   */
  removeFormatter(name) {
    const idx = this[_pipeline].findIndex((e) => e.name === name);
    if (idx === -1) return false;
    this[_pipeline].splice(idx, 1);
    this.disabled.delete(name);
    return true;
  }

  /**
   * Enable a previously disabled formatter.
   * @param {string} name
   * @returns {boolean} - true if a registered formatter with this name exists
   */
  enable(name) {
    const exists = this[_pipeline].some((e) => e.name === name);
    if (!exists) return false;
    this.disabled.delete(name);
    return true;
  }

  /**
   * Disable a formatter by name (skip it in format() but keep it registered).
   * @param {string} name
   * @returns {boolean} - true if a registered formatter with this name exists
   */
  disable(name) {
    const exists = this[_pipeline].some((e) => e.name === name);
    if (!exists) return false;
    this.disabled.add(name);
    return true;
  }

  /**
   * Returns the ordered list of registered formatter names.
   * @returns {string[]}
   */
  get names() {
    return this[_pipeline].map((e) => e.name);
  }

  /**
   * Returns whether a formatter with the given name is currently enabled.
   * @param {string} name
   * @returns {boolean}
   */
  isEnabled(name) {
    return this[_pipeline].some((e) => e.name === name) && !this.disabled.has(name);
  }

  /**
   * Clear all registered formatters and disabled set.
   */
  clear() {
    this[_pipeline].length = 0;
    this.disabled.clear();
  }
}

module.exports = { FormatPipeline };
