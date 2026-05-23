"use strict";

const { randomUUID } = require("node:crypto");

/**
 * Chain types that control how skill nodes are composed and executed.
 * @readonly
 * @enum {string}
 */
const CHAIN_TYPE = Object.freeze({
  SEQUENCE: "SEQUENCE",
  PARALLEL: "PARALLEL",
  CONDITIONAL: "CONDITIONAL",
  LOOP: "LOOP",
  FALLBACK: "FALLBACK",
});

/**
 * Valid statuses a chain step can be in after execution.
 * @readonly
 * @enum {string}
 */
const STEP_STATUS = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
  FALLBACK_TAKEN: "fallback_taken",
});

/**
 * Default configuration applied when none is supplied.
 */
const DEFAULTS = {
  timeout: 60_000,
  maxIterations: 5,
  continueOnError: false,
  parallelConcurrency: Infinity,
};

// ────────────────────────────────────────────────────────────────
// SkillChain — composes multiple skills into sequential pipelines
// ────────────────────────────────────────────────────────────────
class SkillChain {
  /**
   * @param {object} [options]
   * @param {string} [options.id] - Unique identifier (auto-generated).
   * @param {string} [options.name] - Human-readable label.
   * @param {number} [options.timeout] - Global timeout in ms per node.
   * @param {boolean} [options.continueOnError] - Whether to keep running after node failure.
   * @param {number} [options.maxIterations] - Default max loop iterations.
   */
  constructor(options = {}) {
    this.id = options.id || `chain-${randomUUID()}`;
    this.name = options.name || this.id;
    this.type = CHAIN_TYPE.SEQUENCE;
    this.nodes = [];
    this._options = {
      timeout: options.timeout || DEFAULTS.timeout,
      continueOnError: options.continueOnError || DEFAULTS.continueOnError,
      maxIterations: options.maxIterations || DEFAULTS.maxIterations,
    };
    this._trace = [];
    this._results = new Map();
    this._aborted = false;
  }

  // ── fluent builders ─────────────────────────────────────────

  /**
   * Append skills to run one after another.
   * Each argument may be a plain object describing a node or a SkillChain
   * (sub-chain).
   *
   * @param {...(object|SkillChain)} nodeDescriptors
   * @returns {SkillChain} this
   */
  chain(...nodeDescriptors) {
    for (const desc of nodeDescriptors) {
      this.nodes.push(this._normalizeNode(desc, { type: CHAIN_TYPE.SEQUENCE }));
    }
    return this;
  }

  /**
   * Add a set of nodes that will execute concurrently.
   *
   * @param {Array<object|SkillChain>} nodeDescriptors
   * @param {object} [opts]
   * @param {number} [opts.concurrency] - Max parallel executions.
   * @returns {SkillChain} this
   */
  parallel(nodeDescriptors, opts = {}) {
    const parallelNode = {
      id: `parallel-${randomUUID()}`,
      type: CHAIN_TYPE.PARALLEL,
      children: nodeDescriptors.map((d) => this._normalizeNode(d, { type: CHAIN_TYPE.SEQUENCE })),
      config: {
        concurrency: opts.concurrency || DEFAULTS.parallelConcurrency,
      },
    };
    this.nodes.push(parallelNode);
    return this;
  }

  /**
   * Add a conditional node: the wrapped skill / chain only runs if
   * `conditionFn(input, results)` returns true.
   *
   * @param {object|SkillChain} nodeDescriptor
   * @param {function} conditionFn
   * @returns {SkillChain} this
   */
  conditional(nodeDescriptor, conditionFn) {
    if (typeof conditionFn !== "function") {
      throw new TypeError("conditional() requires a function as the second argument.");
    }
    const condNode = this._normalizeNode(nodeDescriptor, { type: CHAIN_TYPE.CONDITIONAL });
    condNode._condition = conditionFn;
    this.nodes.push(condNode);
    return this;
  }

  /**
   * Add a loop node: the wrapped skill / chain is executed repeatedly
   * while `conditionFn(input, results, iteration)` returns true or until
   * maxIterations is reached.
   *
   * @param {object|SkillChain} nodeDescriptor
   * @param {object} opts
   * @param {function} opts.while - Loop condition.
   * @param {number} [opts.maxIterations]
   * @returns {SkillChain} this
   */
  loop(nodeDescriptor, opts = {}) {
    if (typeof opts.while !== "function") {
      throw new TypeError("loop() requires a {while: fn} option.");
    }
    const loopNode = this._normalizeNode(nodeDescriptor, { type: CHAIN_TYPE.LOOP });
    loopNode._whileCondition = opts.while;
    loopNode._maxIterations = opts.maxIterations || this._options.maxIterations;
    this.nodes.push(loopNode);
    return this;
  }

  /**
   * Add a fallback node: tries the primary node first; if it fails, the
   * fallback node runs instead.
   *
   * @param {object|SkillChain} primaryDescriptor
   * @param {object|SkillChain} fallbackDescriptor
   * @returns {SkillChain} this
   */
  fallback(primaryDescriptor, fallbackDescriptor) {
    const fbNode = this._normalizeNode(primaryDescriptor, { type: CHAIN_TYPE.FALLBACK });
    fbNode._fallback = this._normalizeNode(fallbackDescriptor, { type: CHAIN_TYPE.SEQUENCE });
    this.nodes.push(fbNode);
    return this;
  }

  /**
   * Merge the nodes of another chain into this one (flat prepend).
   *
   * @param {SkillChain} other
   * @returns {SkillChain} this
   */
  prepend(other) {
    if (!(other instanceof SkillChain)) {
      throw new TypeError("prepend() expects a SkillChain instance.");
    }
    this.nodes.unshift(...other.nodes);
    return this;
  }

  /**
   * Merge the nodes of another chain into this one (flat append).
   *
   * @param {SkillChain} other
   * @returns {SkillChain} this
   */
  append(other) {
    if (!(other instanceof SkillChain)) {
      throw new TypeError("append() expects a SkillChain instance.");
    }
    this.nodes.push(...other.nodes);
    return this;
  }

  // ── execution ───────────────────────────────────────────────

  /**
   * Execute the entire chain with the given input.
   *
   * @param {*} input - Input data fed to the first node.
   * @param {object} [ctx] - Additional execution context.
   * @returns {Promise<{output: *, trace: Array, results: Map}>}
   */
  async execute(input, ctx = {}) {
    this._trace = [];
    this._results = new Map();
    this._aborted = false;

    const context = {
      input,
      ctx,
      results: this._results,
      trace: this._trace,
      aborted: () => this._aborted,
    };

    // Add root trace entry
    this._recordTrace({
      stepId: this.id,
      stepName: this.name,
      type: this.type,
      status: STEP_STATUS.RUNNING,
      startedAt: Date.now(),
    });

    try {
      const output = await this._executeNode(
        { id: this.id, name: this.name, type: CHAIN_TYPE.SEQUENCE, children: this.nodes },
        { ...context },
      );

      this._recordTrace({
        stepId: this.id,
        stepName: this.name,
        type: this.type,
        status: STEP_STATUS.COMPLETED,
        output,
        completedAt: Date.now(),
      });

      return {
        id: this.id,
        output,
        trace: [...this._trace],
        results: new Map(this._results),
      };
    } catch (err) {
      this._recordTrace({
        stepId: this.id,
        stepName: this.name,
        type: this.type,
        status: STEP_STATUS.FAILED,
        error: serializeError(err),
        completedAt: Date.now(),
      });

      throw err;
    }
  }

  /**
   * Abort a running chain (cooperative — checks between nodes).
   */
  abort() {
    this._aborted = true;
  }

  // ── trace ───────────────────────────────────────────────────

  /**
   * Returns a chronological list of every step the last execution touched.
   *
   * @returns {Array<object>}
   */
  getExecutionTrace() {
    return [...this._trace];
  }

  /**
   * Returns a summary of the last execution with per-step status, duration,
   * and any errors.
   *
   * @returns {object}
   */
  getExecutionSummary() {
    const steps = this._trace.map((t) => ({
      stepId: t.stepId,
      stepName: t.stepName,
      type: t.type,
      status: t.status,
      duration: t.completedAt ? t.completedAt - t.startedAt : null,
      error: t.error || null,
    }));

    const totalDuration = this._trace.length
      ? (this._trace[this._trace.length - 1].completedAt || Date.now()) -
        (this._trace[0].startedAt || Date.now())
      : 0;

    return {
      id: this.id,
      name: this.name,
      totalSteps: steps.length,
      totalDuration,
      steps,
    };
  }

  // ── serialization ───────────────────────────────────────────

  /**
   * Serialize the chain definition to a plain object (used for introspection
   * and to feed the Composer).
   *
   * @returns {object}
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      options: { ...this._options },
      nodes: this.nodes.map((n) => this._nodeToJSON(n)),
    };
  }

  // ── internal: node normalization ────────────────────────────

  _normalizeNode(desc, defaults) {
    // Already a chain? Wrap it as a sub-chain node.
    if (desc instanceof SkillChain) {
      return {
        id: desc.id,
        name: desc.name,
        type: desc.type,
        chain: desc,
        children: desc.nodes,
        config: {},
      };
    }

    // Plain object with optional skill / handler.
    if (typeof desc === "object" && desc !== null) {
      return {
        id: desc.id || `node-${randomUUID()}`,
        name: desc.name || desc.id || "unnamed",
        type: desc.type || defaults.type || CHAIN_TYPE.SEQUENCE,
        skill: desc.skill || desc.handler || null,
        config: desc.config || {},
        children: desc.children || desc.nodes || [],
        _condition: desc.condition || null,
        _fallback: desc.fallback || null,
        _whileCondition: desc.while || null,
        _maxIterations: desc.maxIterations || undefined,
      };
    }

    throw new TypeError(
      `Invalid node descriptor: expected object or SkillChain, got ${typeof desc}`,
    );
  }

  _nodeToJSON(node) {
    const obj = {
      id: node.id,
      name: node.name,
      type: node.type,
    };
    if (node.config && Object.keys(node.config).length) obj.config = node.config;
    if (node.children && node.children.length) obj.children = node.children.map((c) => this._nodeToJSON(c));
    if (node.chain) obj.chain = node.chain.toJSON();
    return obj;
  }

  // ── internal: execution engine ──────────────────────────────

  async _executeNode(node, context) {
    if (context.aborted()) {
      throw new Error("Chain execution was aborted.");
    }

    switch (node.type) {
      case CHAIN_TYPE.SEQUENCE:
        return this._executeSequence(node, context);
      case CHAIN_TYPE.PARALLEL:
        return this._executeParallel(node, context);
      case CHAIN_TYPE.CONDITIONAL:
        return this._executeConditional(node, context);
      case CHAIN_TYPE.LOOP:
        return this._executeLoop(node, context);
      case CHAIN_TYPE.FALLBACK:
        return this._executeFallback(node, context);
      default:
        throw new Error(`Unknown chain node type: ${node.type}`);
    }
  }

  async _executeSequence(node, context) {
    let lastOutput = context.input;

    const children = node.children || [];
    for (const child of children) {
      if (context.aborted()) throw new Error("Chain execution was aborted.");

      try {
        lastOutput = await this._invokeChild(child, { ...context, input: lastOutput });
      } catch (err) {
        if (this._options.continueOnError) {
          this._recordTrace({
            stepId: child.id,
            stepName: child.name,
            type: child.type,
            status: STEP_STATUS.FAILED,
            error: serializeError(err),
            completedAt: Date.now(),
          });
          continue;
        }
        throw err;
      }
    }

    return lastOutput;
  }

  async _executeParallel(node, context) {
    const children = node.children || [];
    const concurrency = node.config && node.config.concurrency
      ? node.config.concurrency
      : DEFAULTS.parallelConcurrency;

    // Execute in batches respecting concurrency limit
    const results = [];
    for (let i = 0; i < children.length; i += concurrency) {
      const batch = children.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((child) =>
          this._invokeChild(child, { ...context }).then(
            (out) => ({ status: "ok", id: child.id, output: out }),
            (err) => ({ status: "error", id: child.id, error: err }),
          ),
        ),
      );
      results.push(...batchResults);

      // Fail fast if any error and not continuing on error
      for (const r of batchResults) {
        if (r.status === "error" && !this._options.continueOnError) {
          throw r.error;
        }
      }
    }

    return results.map((r) => ({ nodeId: r.id, output: r.output }));
  }

  async _executeConditional(node, context) {
    const conditionFn = node._condition;
    if (typeof conditionFn !== "function") {
      throw new Error("Conditional node is missing a condition function.");
    }

    const result = conditionFn(context.input, new Map(context.results));
    if (!result) {
      this._recordTrace({
        stepId: node.id,
        stepName: node.name,
        type: CHAIN_TYPE.CONDITIONAL,
        status: STEP_STATUS.SKIPPED,
        reason: "condition evaluated to false",
        completedAt: Date.now(),
      });
      return context.input;
    }

    return this._executeNodeBody(node, context);
  }

  async _executeLoop(node, context) {
    const whileFn = node._whileCondition;
    const maxIter = node._maxIterations || this._options.maxIterations;
    let lastOutput = context.input;

    for (let i = 0; i < maxIter; i++) {
      if (context.aborted()) throw new Error("Chain execution was aborted.");
      if (!whileFn(lastOutput, new Map(context.results), i)) break;

      this._recordTrace({
        stepId: node.id,
        stepName: node.name,
        type: CHAIN_TYPE.LOOP,
        status: STEP_STATUS.RUNNING,
        iteration: i + 1,
        startedAt: Date.now(),
      });

      try {
        lastOutput = await this._executeNodeBody(node, { ...context, input: lastOutput });

        this._recordTrace({
          stepId: node.id,
          stepName: node.name,
          type: CHAIN_TYPE.LOOP,
          status: STEP_STATUS.COMPLETED,
          iteration: i + 1,
          output: lastOutput,
          completedAt: Date.now(),
        });
      } catch (err) {
        this._recordTrace({
          stepId: node.id,
          stepName: node.name,
          type: CHAIN_TYPE.LOOP,
          status: STEP_STATUS.FAILED,
          iteration: i + 1,
          error: serializeError(err),
          completedAt: Date.now(),
        });
        throw err;
      }
    }

    return lastOutput;
  }

  async _executeFallback(node, context) {
    try {
      return await this._executeNodeBody(node, context);
    } catch (primaryErr) {
      if (!node._fallback) {
        throw primaryErr;
      }

      this._recordTrace({
        stepId: node.id,
        stepName: node.name,
        type: CHAIN_TYPE.FALLBACK,
        status: STEP_STATUS.FALLBACK_TAKEN,
        primaryError: serializeError(primaryErr),
        completedAt: Date.now(),
      });

      return this._invokeChild(node._fallback, context);
    }
  }

  /**
   * Execute the "body" of a node (its handler, sub-chain, or children)
   * WITHOUT performing type-based dispatch through _executeNode.  This
   * is used by _executeConditional, _executeLoop, and _executeFallback
   * to avoid infinite recursion.
   *
   * @param {object} node
   * @param {object} context
   * @returns {Promise<*>}
   */
  async _executeNodeBody(node, context) {
    // Sub-chain delegation
    if (node.chain instanceof SkillChain) {
      const result = await node.chain.execute(context.input, context.ctx);
      return result && typeof result === "object" && "output" in result
        ? result.output
        : result;
    }
    // Leaf handler
    if (typeof node.skill === "function") {
      return node.skill(context.input, node.config, context.results);
    }
    // Nested children (sequential execution)
    if (node.children && node.children.length) {
      let output = context.input;
      for (const child of node.children) {
        output = await this._invokeChild(child, { ...context, input: output });
      }
      return output;
    }
    // Pass-through
    return context.input;
  }

  async _invokeChild(child, context) {
    const startedAt = Date.now();

    this._recordTrace({
      stepId: child.id,
      stepName: child.name,
      type: child.type,
      status: STEP_STATUS.RUNNING,
      startedAt,
    });

    try {
      let output;

      // Case 1: child is a sub-chain — delegate
      if (child.chain instanceof SkillChain) {
        output = await child.chain.execute(context.input, context.ctx);
        output = output && typeof output === "object" && "output" in output
          ? output.output
          : output;
      }
      // Case 2: node type is non-SEQUENCE or has children — delegate to _executeNode
      else if (child.type !== CHAIN_TYPE.SEQUENCE || (child.children && child.children.length)) {
        output = await this._executeNode(child, context);
      }
      // Case 3: SEQUENCE leaf node with a handler function
      else if (typeof child.skill === "function") {
        output = await child.skill(context.input, child.config, context.results);
      }
      // Case 4: SEQUENCE leaf node with no handler — pass input through
      else {
        output = context.input;
      }

      const completedAt = Date.now();
      context.results.set(child.id, { output, status: "completed", duration: completedAt - startedAt });

      this._recordTrace({
        stepId: child.id,
        stepName: child.name,
        type: child.type,
        status: STEP_STATUS.COMPLETED,
        output,
        startedAt,
        completedAt,
        duration: completedAt - startedAt,
      });

      return output;
    } catch (err) {
      const completedAt = Date.now();
      context.results.set(child.id, { error: serializeError(err), status: "failed", duration: completedAt - startedAt });

      this._recordTrace({
        stepId: child.id,
        stepName: child.name,
        type: child.type,
        status: STEP_STATUS.FAILED,
        error: serializeError(err),
        startedAt,
        completedAt,
        duration: completedAt - startedAt,
      });

      throw err;
    }
  }

  // ── internal: trace recording ───────────────────────────────

  _recordTrace(entry) {
    this._trace.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });
  }
}

// ────────────────────────────────────────────────────────────────
// Factory functions (convenience)
// ────────────────────────────────────────────────────────────────

/**
 * Create a sequential skill chain.
 * @param {Array<object|SkillChain>} skills
 * @param {object} [options]
 * @returns {SkillChain}
 */
function createChain(skills, options = {}) {
  const chain = new SkillChain({ ...options, name: options.name || "sequence" });
  chain.type = CHAIN_TYPE.SEQUENCE;
  if (skills && skills.length) chain.chain(...skills);
  return chain;
}

/**
 * Create a parallel skill chain.
 * @param {Array<object|SkillChain>} skills
 * @param {object} [options]
 * @returns {SkillChain}
 */
function createParallel(skills, options = {}) {
  const chain = new SkillChain({ ...options, name: options.name || "parallel" });
  chain.type = CHAIN_TYPE.PARALLEL;
  if (skills && skills.length) chain.parallel(skills);
  return chain;
}

// ────────────────────────────────────────────────────────────────
// Utility
// ────────────────────────────────────────────────────────────────

function serializeError(err) {
  if (err instanceof Error) {
    return { name: err.name || "Error", message: err.message, stack: err.stack, code: err.code };
  }
  if (err && typeof err === "object") {
    return { name: "Error", message: JSON.stringify(err) };
  }
  return { name: "Error", message: String(err || "Unknown error") };
}

// ────────────────────────────────────────────────────────────────
// Exports
// ────────────────────────────────────────────────────────────────

module.exports = {
  SkillChain,
  CHAIN_TYPE,
  STEP_STATUS,
  DEFAULTS,
  createChain,
  createParallel,
  serializeError,
};
