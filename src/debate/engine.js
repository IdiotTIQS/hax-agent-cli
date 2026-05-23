"use strict";

const { resolveFormat, validateParticipants, getPhases, DEBATE_PHASES } = require('./formats');
const { ArgumentScorer } = require('./scoring');

/**
 * Debate state enum.
 */
const DEBATE_STATE = Object.freeze({
  pending: 'pending',
  active: 'active',
  closed: 'closed',
  cancelled: 'cancelled',
});

/**
 * Phase progression order index.
 */
const PHASE_ORDER = Object.freeze({
  [DEBATE_PHASES.opening]: 0,
  [DEBATE_PHASES.arguments]: 1,
  [DEBATE_PHASES.rebuttals]: 2,
  [DEBATE_PHASES.deliberation]: 3,
  [DEBATE_PHASES.verdict]: 4,
});

class DebateEngine {
  /**
   * @param {object} [options]
   * @param {ArgumentScorer} [options.scorer] - Custom argument scorer instance.
   */
  constructor(options = {}) {
    this._scorer = options.scorer instanceof ArgumentScorer ? options.scorer : new ArgumentScorer();
    this._debates = new Map();
    this._sequence = 0;
  }

  /**
   * Initiate a structured debate.
   *
   * @param {string} topic - The debate question or proposition.
   * @param {{ agentId: string, role: string }[]} participants - Array of participant descriptors.
   *   Each must have an `agentId` and a `role` matching the format's role set.
   * @param {string|object} format - Format ID (e.g. 'OXFORD') or a format definition object.
   * @param {object} [options]
   * @param {object} [options.metadata] - Arbitrary metadata to attach to the debate.
   * @param {number} [options.maxArguments] - Max number of arguments per agent (default no limit).
   * @param {number} [options.maxRebuttals] - Max number of rebuttals per agent (default no limit).
   * @returns {object} The created debate record.
   */
  startDebate(topic, participants, format, options = {}) {
    if (typeof topic !== 'string' || topic.trim() === '') {
      throw new Error('topic must be a non-empty string');
    }

    const def = resolveFormat(format);
    const validation = validateParticipants(def, participants);

    if (!validation.valid) {
      throw new Error(`Invalid participants for format '${def.id}': ${validation.errors.join('; ')}`);
    }

    const id = `debate-${++this._sequence}`;
    const phases = getPhases(def);

    const record = {
      id,
      topic: topic.trim(),
      format: def,
      participants: deepClone(participants),
      state: DEBATE_STATE.active,
      currentPhase: phases[0].phase,
      phaseOrder: phases.map((p) => p.phase),
      phases,
      arguments: [],          // { id, agentId, body, timestamp, phase, evidenceIds }
      rebuttals: [],          // { id, agentId, targetArgumentId, body, timestamp, phase }
      evidence: [],           // { id, submitterId, content, source, timestamp, linkedArgumentIds }
      config: {
        maxArguments: Number.isSafeInteger(options.maxArguments) && options.maxArguments > 0 ? options.maxArguments : null,
        maxRebuttals: Number.isSafeInteger(options.maxRebuttals) && options.maxRebuttals > 0 ? options.maxRebuttals : null,
      },
      metadata: deepClone(options.metadata || {}),
      createdAt: new Date().toISOString(),
      closedAt: null,
      verdict: null,
      events: [],
    };

    this._debates.set(id, record);
    this._logEvent(record, 'debateStarted', { topic, format: def.id, participantCount: participants.length });

    return this._sanitizedRecord(record);
  }

  /**
   * Submit an argument on behalf of an agent.
   *
   * @param {string} agentId
   * @param {object} argument
   * @param {string} argument.debateId
   * @param {string} argument.body - The argument text.
   * @param {object} [argument.scores] - Optional explicit dimension scores.
   * @param {string} [argument.position] - 'for', 'against', or null (neutral/exploratory).
   * @returns {object} The created argument record with scoring.
   */
  submitArgument(agentId, argument) {
    requireString(agentId, 'agentId');

    if (!argument || typeof argument !== 'object') {
      throw new Error('argument must be a non-null object');
    }

    const debate = this._getDebate(argument.debateId);

    this._assertActive(debate);
    this._assertParticipant(debate, agentId);
    this._assertCurrentPhase(debate, [DEBATE_PHASES.opening, DEBATE_PHASES.arguments]);

    // Check max arguments per agent
    if (debate.config.maxArguments !== null) {
      const agentArgCount = debate.arguments.filter((a) => a.agentId === agentId).length;
      if (agentArgCount >= debate.config.maxArguments) {
        throw new Error(`Agent '${agentId}' has reached the maximum argument count (${debate.config.maxArguments})`);
      }
    }

    const argId = `${debate.id}-arg-${debate.arguments.length + 1}`;
    const scoring = this._scorer.scoreArgument(argument);

    const record = {
      id: argId,
      debateId: debate.id,
      agentId,
      body: String(argument.body || '').trim(),
      position: argument.position || null,
      scores: argument.scores || null,
      scoring,
      phase: debate.currentPhase,
      timestamp: new Date().toISOString(),
      evidenceIds: [],
    };

    debate.arguments.push(record);
    this._logEvent(debate, 'argumentSubmitted', { argumentId: argId, agentId, composite: scoring.composite });

    return deepClone(record);
  }

  /**
   * Submit a rebuttal against a specific argument.
   *
   * @param {string} agentId
   * @param {string} targetId - ID of the argument being rebutted.
   * @param {object} rebuttal
   * @param {string} rebuttal.debateId
   * @param {string} rebuttal.body - The rebuttal text.
   * @returns {object} The created rebuttal record.
   */
  submitRebuttal(agentId, targetId, rebuttal) {
    requireString(agentId, 'agentId');
    requireString(targetId, 'targetId');

    if (!rebuttal || typeof rebuttal !== 'object') {
      throw new Error('rebuttal must be a non-null object');
    }

    const debate = this._getDebate(rebuttal.debateId);

    this._assertActive(debate);
    this._assertParticipant(debate, agentId);
    this._assertCurrentPhase(debate, [DEBATE_PHASES.rebuttals]);

    const target = debate.arguments.find((a) => a.id === targetId);
    if (!target) {
      throw new Error(`Unknown argument: ${targetId}`);
    }

    // Check max rebuttals per agent
    if (debate.config.maxRebuttals !== null) {
      const agentRebuttalCount = debate.rebuttals.filter((r) => r.agentId === agentId).length;
      if (agentRebuttalCount >= debate.config.maxRebuttals) {
        throw new Error(`Agent '${agentId}' has reached the maximum rebuttal count (${debate.config.maxRebuttals})`);
      }
    }

    const rebId = `${debate.id}-reb-${debate.rebuttals.length + 1}`;
    const scoring = this._scorer.scoreArgument(rebuttal);

    const record = {
      id: rebId,
      debateId: debate.id,
      agentId,
      targetArgumentId: targetId,
      body: String(rebuttal.body || '').trim(),
      scoring,
      phase: debate.currentPhase,
      timestamp: new Date().toISOString(),
    };

    debate.rebuttals.push(record);
    this._logEvent(debate, 'rebuttalSubmitted', { rebuttalId: rebId, agentId, targetId, composite: scoring.composite });

    return deepClone(record);
  }

  /**
   * Submit supporting evidence, optionally linked to specific arguments.
   *
   * @param {string} agentId
   * @param {object} evidence
   * @param {string} evidence.debateId
   * @param {string} evidence.content - The evidence content or description.
   * @param {string} [evidence.source] - Source of the evidence.
   * @param {string[]} [evidence.linkedArgumentIds] - Argument IDs this evidence supports.
   * @returns {object} The created evidence record.
   */
  submitEvidence(agentId, evidence) {
    requireString(agentId, 'agentId');

    if (!evidence || typeof evidence !== 'object') {
      throw new Error('evidence must be a non-null object');
    }

    const debate = this._getDebate(evidence.debateId);

    this._assertActive(debate);
    this._assertParticipant(debate, agentId);

    // Evidence can be submitted during opening, arguments, or rebuttals
    this._assertCurrentPhase(debate, [
      DEBATE_PHASES.opening,
      DEBATE_PHASES.arguments,
      DEBATE_PHASES.rebuttals,
    ]);

    const evId = `${debate.id}-ev-${debate.evidence.length + 1}`;
    const linkedIds = Array.isArray(evidence.linkedArgumentIds) ? evidence.linkedArgumentIds : [];

    // Validate linked argument IDs
    for (const linkedId of linkedIds) {
      if (!debate.arguments.some((a) => a.id === linkedId)) {
        throw new Error(`Unknown argument for evidence linkage: ${linkedId}`);
      }
    }

    const record = {
      id: evId,
      debateId: debate.id,
      submitterId: agentId,
      content: String(evidence.content || '').trim(),
      source: String(evidence.source || '').trim(),
      linkedArgumentIds: linkedIds,
      timestamp: new Date().toISOString(),
    };

    debate.evidence.push(record);

    // Link evidence to the specified arguments
    for (const linkedId of linkedIds) {
      const arg = debate.arguments.find((a) => a.id === linkedId);
      if (arg) {
        arg.evidenceIds.push(evId);
      }
    }

    this._logEvent(debate, 'evidenceSubmitted', { evidenceId: evId, agentId, linkedArgumentIds: linkedIds });

    return deepClone(record);
  }

  /**
   * Retrieve the current state of a debate.
   *
   * @param {string} debateId
   * @returns {object} Full debate state with summary statistics.
   */
  getDebateState(debateId) {
    requireString(debateId, 'debateId');

    const debate = this._getDebate(debateId);
    return this._sanitizedRecord(debate);
  }

  /**
   * Advance the debate to the next phase.
   *
   * @param {string} debateId
   * @returns {object} Updated debate record.
   */
  advancePhase(debateId) {
    requireString(debateId, 'debateId');

    const debate = this._getDebate(debateId);
    this._assertActive(debate);

    const currentIdx = PHASE_ORDER[debate.currentPhase];
    if (currentIdx === undefined) {
      throw new Error(`Unknown phase: ${debate.currentPhase}`);
    }

    const nextPhases = debate.phaseOrder
      .map((p, idx) => ({ phase: p, idx }))
      .filter((p) => PHASE_ORDER[p.phase] > currentIdx)
      .sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase]);

    if (nextPhases.length === 0) {
      throw new Error(`Debate '${debateId}' is already in the final phase (${debate.currentPhase})`);
    }

    const prevPhase = debate.currentPhase;
    debate.currentPhase = nextPhases[0].phase;

    this._logEvent(debate, 'phaseAdvanced', { from: prevPhase, to: debate.currentPhase });

    return this._sanitizedRecord(debate);
  }

  /**
   * Conclude a debate and produce a final summary / verdict.
   *
   * @param {string} debateId
   * @param {object} [options]
   * @param {string} [options.verdict] - Explicit verdict text (optional; if omitted,
   *   the verdict is derived from scored arguments).
   * @param {string} [options.winningAgentId] - Explicitly declare a winning agent.
   * @returns {object} The closed debate record with verdict.
   */
  closeDebate(debateId, options = {}) {
    requireString(debateId, 'debateId');

    const debate = this._getDebate(debateId);
    this._assertActive(debate);

    // Advance to verdict phase if not already there
    if (debate.currentPhase !== DEBATE_PHASES.verdict) {
      debate.currentPhase = DEBATE_PHASES.verdict;
    }

    // Rank all arguments
    let winnerResult = null;
    if (debate.arguments.length > 0) {
      const argsForRanking = debate.arguments.map((a) => ({
        body: a.body,
        scores: a.scores,
      }));
      const ranked = this._scorer.rankArguments(argsForRanking);

      // Map back to argument IDs
      for (let i = 0; i < ranked.length; i++) {
        ranked[i].argumentId = debate.arguments[i].id;
        ranked[i].agentId = debate.arguments[i].agentId;
      }

      winnerResult = this._scorer.determineWinner(ranked);
    }

    // Build verdict
    const verdict = {
      debateId: debate.id,
      topic: debate.topic,
      format: debate.format.id,
      closedAt: new Date().toISOString(),
      totalArguments: debate.arguments.length,
      totalRebuttals: debate.rebuttals.length,
      totalEvidence: debate.evidence.length,
      participants: debate.participants.length,
      winner: options.winningAgentId || null,
      isTie: winnerResult ? winnerResult.isTie : false,
      topArgumentId: winnerResult && winnerResult.winner ? winnerResult.winner.argumentId : null,
      topScore: winnerResult ? winnerResult.topScore : null,
      ruling: typeof options.verdict === 'string' ? options.verdict.trim() : null,
      rankings: winnerResult ? winnerResult.entries.map((e) => ({
        argumentId: e.argumentId,
        agentId: e.agentId,
        composite: e.scoring.composite,
        rank: e.rank,
      })) : [],
    };

    debate.verdict = verdict;
    debate.state = DEBATE_STATE.closed;
    debate.closedAt = verdict.closedAt;
    debate.currentPhase = DEBATE_PHASES.verdict;

    this._logEvent(debate, 'debateClosed', { verdict });

    return this._sanitizedRecord(debate);
  }

  /**
   * Cancel an active debate.
   *
   * @param {string} debateId
   * @param {string} [reason] - Reason for cancellation.
   * @returns {object} The cancelled debate record.
   */
  cancelDebate(debateId, reason = '') {
    requireString(debateId, 'debateId');

    const debate = this._getDebate(debateId);
    this._assertActive(debate);

    debate.state = DEBATE_STATE.cancelled;
    debate.closedAt = new Date().toISOString();

    this._logEvent(debate, 'debateCancelled', { reason });

    return this._sanitizedRecord(debate);
  }

  /**
   * Get all debate IDs (active, closed, cancelled).
   * @param {string} [state] - Filter by state: 'active', 'closed', 'cancelled'.
   * @returns {string[]}
   */
  listDebates(state) {
    const ids = [];
    for (const [id, debate] of this._debates) {
      if (!state || debate.state === state) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Get the argument scorer instance.
   * @returns {ArgumentScorer}
   */
  get scorer() {
    return this._scorer;
  }

  // ---- Private ----

  _getDebate(debateId) {
    const debate = this._debates.get(debateId);
    if (!debate) {
      throw new Error(`Unknown debate: ${debateId}`);
    }
    return debate;
  }

  _assertActive(debate) {
    if (debate.state !== DEBATE_STATE.active) {
      throw new Error(`Debate '${debate.id}' is ${debate.state} and cannot accept new submissions`);
    }
  }

  _assertParticipant(debate, agentId) {
    const isParticipant = debate.participants.some((p) => p.agentId === agentId);
    if (!isParticipant) {
      throw new Error(`Agent '${agentId}' is not a participant in debate '${debate.id}'`);
    }
  }

  _assertCurrentPhase(debate, allowedPhases) {
    if (!allowedPhases.includes(debate.currentPhase)) {
      throw new Error(
        `Debate '${debate.id}' is in phase '${debate.currentPhase}'; ` +
        `expected one of: ${allowedPhases.join(', ')}`
      );
    }
  }

  _logEvent(debate, type, payload) {
    debate.events.push({
      type,
      payload: deepClone(payload),
      timestamp: new Date().toISOString(),
    });
  }

  _sanitizedRecord(debate) {
    return {
      id: debate.id,
      topic: debate.topic,
      format: debate.format,
      participants: deepClone(debate.participants),
      state: debate.state,
      currentPhase: debate.currentPhase,
      phases: deepClone(debate.phases),
      arguments: deepClone(debate.arguments),
      rebuttals: deepClone(debate.rebuttals),
      evidence: deepClone(debate.evidence),
      config: deepClone(debate.config),
      metadata: deepClone(debate.metadata),
      createdAt: debate.createdAt,
      closedAt: debate.closedAt,
      verdict: deepClone(debate.verdict),
      events: deepClone(debate.events),
    };
  }
}

// ---- Helpers ----

function deepClone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

module.exports = {
  DEBATE_STATE,
  DebateEngine,
};
