'use strict';

const { createHash } = require('node:crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DECISION_TYPES = Object.freeze({
  TOOL_SELECTION: 'tool_selection',
  RESPONSE_PATH: 'response_path',
  ERROR_RECOVERY: 'error_recovery',
  STRATEGY: 'strategy',
  GENERAL: 'general',
});

const CONFIDENCE_LEVELS = Object.freeze({
  VERY_LOW: { min: 0, max: 0.2, label: 'very_low' },
  LOW: { min: 0.2, max: 0.4, label: 'low' },
  MODERATE: { min: 0.4, max: 0.6, label: 'moderate' },
  HIGH: { min: 0.6, max: 0.8, label: 'high' },
  VERY_HIGH: { min: 0.8, max: 1.0, label: 'very_high' },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unique decision ID.
 * @returns {string}
 */
function generateDecisionId() {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `dec_${ts}_${rand}`;
}

/**
 * Clamp a confidence value between 0 and 1.
 * @param {number} value
 * @returns {number}
 */
function clampConfidence(value) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

/**
 * Get a descriptive confidence label.
 * @param {number} value - 0.0 to 1.0
 * @returns {string}
 */
function confidenceLabel(value) {
  const clamped = clampConfidence(value);
  if (clamped >= 0.8) return 'very_high';
  if (clamped >= 0.6) return 'high';
  if (clamped >= 0.4) return 'moderate';
  if (clamped >= 0.2) return 'low';
  return 'very_low';
}

/**
 * Generate a short rationale from alternatives when none is provided.
 * @param {string} chosen - the chosen option
 * @param {object[]} alternatives - list of alternatives with scores
 * @returns {string}
 */
function generateDefaultRationale(chosen, alternatives) {
  if (!Array.isArray(alternatives) || alternatives.length === 0) {
    return `Selected "${chosen}" as the only available option.`;
  }
  const chosenAlt = alternatives.find((a) => a.id === chosen || a.description === chosen);
  if (chosenAlt) {
    return `Selected "${chosen}" based on evaluation of ${alternatives.length} alternatives.`;
  }
  return `Selected "${chosen}" from ${alternatives.length} alternatives.`;
}

/**
 * Compute a content hash for trace integrity.
 * @param {object} decision
 * @returns {string}
 */
function computeDecisionHash(decision) {
  const { hash, ...rest } = decision;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// DecisionTracer
// ---------------------------------------------------------------------------

/**
 * Records agent decision points and builds a full audit trail of why
 * the agent chose specific tools, response paths, and error recovery strategies.
 *
 * Usage:
 *   const tracer = new DecisionTracer();
 *   tracer.traceToolSelection('agent-1', 'fix bug in auth', ['read', 'edit', 'bash'], 'read');
 *   tracer.traceResponsePath('agent-1', 'how to fix?', ['refactor', 'patch', 'rewrite'], 'patch');
 *   tracer.traceErrorRecovery('agent-1', err, ['retry', 'skip', 'ask'], 'retry');
 *   const tree = tracer.getDecisionTree('session-abc');
 */
class DecisionTracer {
  /**
   * @param {object} [options]
   * @param {number} [options.maxDecisionsPerSession] - max decisions to store per session (default: 1000)
   * @param {boolean} [options.enabled] - whether tracing is active (default: true)
   * @param {boolean} [options.computeHashes] - whether to attach integrity hashes (default: true)
   */
  constructor(options = {}) {
    this._maxDecisionsPerSession = Number.isSafeInteger(options.maxDecisionsPerSession) &&
      options.maxDecisionsPerSession > 0
        ? options.maxDecisionsPerSession
        : 1000;
    this._enabled = options.enabled !== false;
    this._computeHashes = options.computeHashes !== false;

    /** @type {Map<string, object[]>} sessionId -> decisions[] */
    this._sessions = new Map();

    this._totalDecisions = 0;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Build a Decision object with common fields.
   * @param {object} params
   * @param {string} params.agentId
   * @param {string} params.type - one of DECISION_TYPES
   * @param {object} params.context
   * @param {object[]} params.alternatives
   * @param {string} [params.rationale]
   * @param {number} [params.confidence]
   * @param {object} [params.outcome]
   * @param {object} [params.metadata]
   * @returns {object}
   */
  _createDecision({ agentId, type, context, alternatives, rationale, confidence, outcome, metadata }) {
    const alts = Array.isArray(alternatives) ? alternatives : [];
    const chosenAlt = outcome && outcome.chosen ? outcome.chosen : null;

    const decision = {
      id: generateDecisionId(),
      timestamp: new Date().toISOString(),
      type: type || DECISION_TYPES.GENERAL,
      agentId: agentId || 'unknown',
      context: context || {},
      alternatives: alts.map((alt, idx) => ({
        index: idx,
        id: alt.id || `alt_${idx}`,
        description: alt.description || '',
        score: Number.isFinite(alt.score) ? alt.score : null,
        pros: Array.isArray(alt.pros) ? alt.pros : [],
        cons: Array.isArray(alt.cons) ? alt.cons : [],
        ...alt._extra,
      })),
      rationale: rationale || generateDefaultRationale(chosenAlt, alts),
      confidence: clampConfidence(confidence),
      confidenceLabel: confidenceLabel(confidence),
      outcome: outcome ? {
        chosen: outcome.chosen || null,
        success: outcome.success !== undefined ? outcome.success : null,
        result: outcome.result !== undefined ? outcome.result : null,
        followUpActions: Array.isArray(outcome.followUpActions) ? outcome.followUpActions : [],
        notes: outcome.notes || null,
      } : {
        chosen: null,
        success: null,
        result: null,
        followUpActions: [],
        notes: null,
      },
      metadata: metadata || {},
    };

    if (this._computeHashes) {
      decision.hash = computeDecisionHash(decision);
    }

    return decision;
  }

  /**
   * Store a decision, associating it with its session.
   * @param {string} sessionId
   * @param {object} decision
   */
  _store(sessionId, decision) {
    if (!this._enabled) return null;

    decision.sessionId = sessionId;

    if (!this._sessions.has(sessionId)) {
      this._sessions.set(sessionId, []);
    }

    const sessionDecisions = this._sessions.get(sessionId);
    if (sessionDecisions.length >= this._maxDecisionsPerSession) {
      return null; // session at capacity
    }

    sessionDecisions.push(decision);
    this._totalDecisions += 1;

    return decision;
  }

  // ---------------------------------------------------------------------------
  // Public tracing methods
  // ---------------------------------------------------------------------------

  /**
   * Record a generic decision point.
   *
   * @param {string} agentId - identifier for the agent
   * @param {object} context - what led to this decision (task, constraints, etc.)
   * @param {object} options - trace options
   * @param {string} [options.sessionId] - session to associate with (auto-generated if omitted)
   * @param {object[]} [options.alternatives] - alternatives considered
   * @param {string} [options.rationale] - human-readable explanation
   * @param {number} [options.confidence] - 0.0 to 1.0
   * @param {object} [options.outcome] - result of the decision
   * @param {object} [options.metadata] - extra data
   * @param {object} decision - shorthand for outcome.chosen
   * @returns {object} the recorded decision
   */
  traceDecision(agentId, context, options, decision) {
    if (!this._enabled) return null;

    // Allow the caller to pass `decision` as a shorthand for outcome.chosen
    const outcome = options.outcome || {};
    if (decision !== undefined && outcome.chosen === undefined) {
      outcome.chosen = decision;
    }

    const sessionId = options.sessionId || `session_${Date.now().toString(36)}`;

    const record = this._createDecision({
      agentId,
      type: DECISION_TYPES.GENERAL,
      context: context || {},
      alternatives: options.alternatives || [],
      rationale: options.rationale || null,
      confidence: options.confidence,
      outcome,
      metadata: options.metadata || {},
    });

    return this._store(sessionId, record);
  }

  /**
   * Trace why a specific tool was selected from available options.
   *
   * @param {string} agentId - identifier for the agent
   * @param {string} task - what the agent is trying to accomplish
   * @param {Array<string|object>} availableTools - all tools the agent could use
   * @param {string|object} selected - the tool that was actually chosen
   * @param {object} [options] - trace options
   * @param {string} [options.sessionId]
   * @param {string} [options.rationale]
   * @param {number} [options.confidence]
   * @param {object} [options.metadata]
   * @returns {object} the recorded decision
   */
  traceToolSelection(agentId, task, availableTools, selected, options = {}) {
    if (!this._enabled) return null;

    const sessionId = options.sessionId || `session_${Date.now().toString(36)}`;
    const selectedName = typeof selected === 'string' ? selected : (selected.name || selected.id || JSON.stringify(selected));

    // Normalize available tools to alternatives
    const alternatives = (Array.isArray(availableTools) ? availableTools : []).map((tool) => {
      if (typeof tool === 'string') {
        const isChosen = tool === selectedName;
        return {
          id: tool,
          description: `Tool: ${tool}`,
          score: isChosen ? 0.9 : 0.5,
          pros: isChosen ? ['Best fit for task'] : [],
          cons: isChosen ? [] : ['Less optimal for this task'],
        };
      }
      // tool is an object
      const toolId = tool.name || tool.id || `tool_${Math.random().toString(36).slice(2, 6)}`;
      const isChosen = toolId === selectedName || tool === selected;
      return {
        id: toolId,
        description: tool.description || `Tool: ${toolId}`,
        score: isChosen ? (tool.score || 0.9) : (tool.score || 0.5),
        pros: Array.isArray(tool.pros) ? tool.pros : (isChosen ? ['Selected for this task'] : []),
        cons: Array.isArray(tool.cons) ? tool.cons : (isChosen ? [] : ['Not selected']),
      };
    });

    const record = this._createDecision({
      agentId,
      type: DECISION_TYPES.TOOL_SELECTION,
      context: {
        task,
        availableToolCount: alternatives.length,
        availableToolNames: alternatives.map((a) => a.id),
      },
      alternatives,
      rationale: options.rationale || `Tool "${selectedName}" was selected for task: "${task}".`,
      confidence: options.confidence,
      outcome: {
        chosen: selectedName,
        success: options.outcome ? options.outcome.success : null,
        result: options.outcome ? options.outcome.result : null,
        followUpActions: [],
        notes: options.outcome ? options.outcome.notes : null,
      },
      metadata: options.metadata || {},
    });

    return this._store(sessionId, record);
  }

  /**
   * Trace why a particular response path was chosen.
   *
   * @param {string} agentId - identifier for the agent
   * @param {string} prompt - the user prompt or context that triggered this
   * @param {Array<string|object>} possiblePaths - all response paths considered
   * @param {string|object} chosen - the response path selected
   * @param {object} [options] - trace options
   * @param {string} [options.sessionId]
   * @param {string} [options.rationale]
   * @param {number} [options.confidence]
   * @param {object} [options.metadata]
   * @returns {object} the recorded decision
   */
  traceResponsePath(agentId, prompt, possiblePaths, chosen, options = {}) {
    if (!this._enabled) return null;

    const sessionId = options.sessionId || `session_${Date.now().toString(36)}`;
    const chosenName = typeof chosen === 'string' ? chosen : (chosen.name || chosen.id || JSON.stringify(chosen));

    const alternatives = (Array.isArray(possiblePaths) ? possiblePaths : []).map((path) => {
      if (typeof path === 'string') {
        const isChosen = path === chosenName;
        return {
          id: path,
          description: path,
          score: isChosen ? 0.9 : 0.5,
          pros: [],
          cons: [],
        };
      }
      const pathId = path.name || path.id || path.label || `path_${Math.random().toString(36).slice(2, 6)}`;
      const isChosen = pathId === chosenName || path === chosen;
      return {
        id: pathId,
        description: path.description || path.label || pathId,
        score: isChosen ? (path.score || 0.9) : (path.score || 0.5),
        pros: Array.isArray(path.pros) ? path.pros : [],
        cons: Array.isArray(path.cons) ? path.cons : [],
      };
    });

    const record = this._createDecision({
      agentId,
      type: DECISION_TYPES.RESPONSE_PATH,
      context: {
        prompt: typeof prompt === 'string' ? prompt : JSON.stringify(prompt),
        pathCount: alternatives.length,
      },
      alternatives,
      rationale: options.rationale || `Response path "${chosenName}" chosen based on prompt analysis.`,
      confidence: options.confidence,
      outcome: {
        chosen: chosenName,
        success: options.outcome ? options.outcome.success : null,
        result: options.outcome ? options.outcome.result : null,
        followUpActions: [],
        notes: options.outcome ? options.outcome.notes : null,
      },
      metadata: options.metadata || {},
    });

    return this._store(sessionId, record);
  }

  /**
   * Trace which error recovery strategy was chosen.
   *
   * @param {string} agentId - identifier for the agent
   * @param {object|string} error - the error that occurred
   * @param {Array<string|object>} strategies - recovery strategies considered
   * @param {string|object} chosen - the strategy selected
   * @param {object} [options] - trace options
   * @param {string} [options.sessionId]
   * @param {string} [options.rationale]
   * @param {number} [options.confidence]
   * @param {object} [options.metadata]
   * @returns {object} the recorded decision
   */
  traceErrorRecovery(agentId, error, strategies, chosen, options = {}) {
    if (!this._enabled) return null;

    const sessionId = options.sessionId || `session_${Date.now().toString(36)}`;
    const chosenName = typeof chosen === 'string' ? chosen : (chosen.name || chosen.id || JSON.stringify(chosen));

    // Normalize error to a string representation
    const errorStr = typeof error === 'string'
      ? error
      : (error && error.message ? error.message : JSON.stringify(error || {}));

    const alternatives = (Array.isArray(strategies) ? strategies : []).map((strat) => {
      if (typeof strat === 'string') {
        const isChosen = strat === chosenName;
        return {
          id: strat,
          description: `Recovery strategy: ${strat}`,
          score: isChosen ? 0.9 : 0.5,
          pros: isChosen ? ['Most appropriate for this error'] : [],
          cons: isChosen ? [] : ['Less effective for this error type'],
        };
      }
      const stratId = strat.name || strat.id || `strat_${Math.random().toString(36).slice(2, 6)}`;
      const isChosen = stratId === chosenName || strat === chosen;
      return {
        id: stratId,
        description: strat.description || `Strategy: ${stratId}`,
        score: isChosen ? (strat.score || 0.9) : (strat.score || 0.5),
        pros: Array.isArray(strat.pros) ? strat.pros : [],
        cons: Array.isArray(strat.cons) ? strat.cons : [],
      };
    });

    const record = this._createDecision({
      agentId,
      type: DECISION_TYPES.ERROR_RECOVERY,
      context: {
        error: errorStr,
        strategyCount: alternatives.length,
        strategyNames: alternatives.map((a) => a.id),
      },
      alternatives,
      rationale: options.rationale || `Recovery strategy "${chosenName}" chosen for error: ${errorStr.slice(0, 100)}.`,
      confidence: options.confidence,
      outcome: {
        chosen: chosenName,
        success: options.outcome ? options.outcome.success : null,
        result: options.outcome ? options.outcome.result : null,
        followUpActions: [],
        notes: options.outcome ? options.outcome.notes : null,
      },
      metadata: options.metadata || {},
    });

    return this._store(sessionId, record);
  }

  // ---------------------------------------------------------------------------
  // Querying
  // ---------------------------------------------------------------------------

  /**
   * Get the full decision tree for a session.
   *
   * @param {string} sessionId
   * @returns {object} decision tree with decisions in chronological order
   */
  getDecisionTree(sessionId) {
    const decisions = this._sessions.get(sessionId) || [];

    // Clone decisions to prevent external mutation
    const cloned = decisions.map((d) => this._sanitizeDecision({ ...d }));

    // Build tree structure — decisions are ordered by timestamp
    cloned.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const tree = {
      sessionId,
      totalDecisions: cloned.length,
      startTime: cloned.length > 0 ? cloned[0].timestamp : null,
      endTime: cloned.length > 0 ? cloned[cloned.length - 1].timestamp : null,
      decisions: cloned,
      summary: this._buildTreeSummary(cloned),
    };

    return tree;
  }

  /**
   * Get all decisions across all sessions.
   *
   * @param {object} [options]
   * @param {string} [options.type] - filter by decision type
   * @param {string} [options.agentId] - filter by agent ID
   * @param {number} [options.limit] - max results (default: 100)
   * @returns {object[]} matching decisions
   */
  getAllDecisions(options = {}) {
    const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : 100;
    const results = [];

    for (const [, decisions] of this._sessions) {
      for (const d of decisions) {
        if (options.type && d.type !== options.type) continue;
        if (options.agentId && d.agentId !== options.agentId) continue;
        results.push(this._sanitizeDecision({ ...d }));
        if (results.length >= limit) return results;
      }
    }

    return results;
  }

  /**
   * Get all session IDs that have recorded decisions.
   * @returns {string[]}
   */
  getSessionIds() {
    return Array.from(this._sessions.keys());
  }

  /**
   * Get the total number of decisions recorded.
   * @returns {number}
   */
  getTotalDecisions() {
    return this._totalDecisions;
  }

  /**
   * Get the number of sessions with recorded decisions.
   * @returns {number}
   */
  getSessionCount() {
    return this._sessions.size;
  }

  /**
   * Clear all recorded decisions.
   */
  reset() {
    this._sessions.clear();
    this._totalDecisions = 0;
  }

  /**
   * Clear decisions for a specific session.
   * @param {string} sessionId
   */
  clearSession(sessionId) {
    const decisions = this._sessions.get(sessionId);
    if (decisions) {
      this._totalDecisions -= decisions.length;
      this._sessions.delete(sessionId);
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _buildTreeSummary(decisions) {
    const typeCounts = {};
    const confidences = [];
    const successCount = { true: 0, false: 0, unknown: 0 };

    for (const d of decisions) {
      typeCounts[d.type] = (typeCounts[d.type] || 0) + 1;
      if (d.confidence != null) confidences.push(d.confidence);
      if (d.outcome.success === true) successCount.true += 1;
      else if (d.outcome.success === false) successCount.false += 1;
      else successCount.unknown += 1;
    }

    const avgConfidence = confidences.length > 0
      ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000) / 1000
      : null;

    return {
      typeBreakdown: typeCounts,
      avgConfidence,
      successRate: (successCount.true + successCount.false) > 0
        ? Math.round((successCount.true / (successCount.true + successCount.false)) * 1000) / 1000
        : null,
      successCounts: successCount,
    };
  }

  _sanitizeDecision(decision) {
    // Remove internal fields, ensure safe output
    if (decision.hash === undefined && this._computeHashes) {
      const { hash, ...rest } = decision;
      return rest;
    }
    return decision;
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/**
 * Create a DecisionTracer instance with sensible defaults.
 * @param {object} [options]
 * @returns {DecisionTracer}
 */
function createTracer(options) {
  return new DecisionTracer(options);
}

module.exports = {
  DecisionTracer,
  createTracer,
  DECISION_TYPES,
  CONFIDENCE_LEVELS,
};
