"use strict";

const { CONTRACT_STATES } = require('./define');

const NEGOTIATION_EVENTS = Object.freeze({
  PROPOSED: 'proposed',
  COUNTERED: 'countered',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  FINALIZED: 'finalized',
  COMPLETED: 'completed',
  TERMINATED: 'terminated',
  EXPIRED: 'expired',
});

const VALID_TRANSITIONS = Object.freeze({
  [CONTRACT_STATES.DRAFT]: [
    CONTRACT_STATES.PROPOSED,
    CONTRACT_STATES.TERMINATED,
  ],
  [CONTRACT_STATES.PROPOSED]: [
    CONTRACT_STATES.NEGOTIATING,
    CONTRACT_STATES.ACCEPTED,
    CONTRACT_STATES.REJECTED,
    CONTRACT_STATES.TERMINATED,
  ],
  [CONTRACT_STATES.NEGOTIATING]: [
    CONTRACT_STATES.PROPOSED,
    CONTRACT_STATES.ACCEPTED,
    CONTRACT_STATES.REJECTED,
    CONTRACT_STATES.TERMINATED,
  ],
  [CONTRACT_STATES.ACCEPTED]: [
    CONTRACT_STATES.ACTIVE,
    CONTRACT_STATES.TERMINATED,
  ],
  [CONTRACT_STATES.REJECTED]: [
    CONTRACT_STATES.PROPOSED,
    CONTRACT_STATES.TERMINATED,
  ],
  [CONTRACT_STATES.ACTIVE]: [
    CONTRACT_STATES.COMPLETED,
    CONTRACT_STATES.TERMINATED,
  ],
  [CONTRACT_STATES.COMPLETED]: [],
  [CONTRACT_STATES.TERMINATED]: [],
});

class NegotiationRecord {
  constructor(contractId, from, to, contract) {
    this._contractId = contractId;
    this._from = from;
    this._to = to;
    this._state = CONTRACT_STATES.DRAFT;
    this._history = [];
    this._currentContract = deepClone(contract);
    this._createdAt = new Date().toISOString();
    this._updatedAt = this._createdAt;
    this._finalizedAt = null;
    this._participants = [from, to];
    this._acceptedBy = [];
    this._rejectedBy = [];
  }

  get contractId() {
    return this._contractId;
  }

  get from() {
    return this._from;
  }

  get to() {
    return this._to;
  }

  get state() {
    return this._state;
  }

  get history() {
    return this._history.map(deepClone);
  }

  get currentContract() {
    return deepClone(this._currentContract);
  }

  get createdAt() {
    return this._createdAt;
  }

  get updatedAt() {
    return this._updatedAt;
  }

  get finalizedAt() {
    return this._finalizedAt;
  }

  get participants() {
    return [...this._participants];
  }

  get acceptedBy() {
    return [...this._acceptedBy];
  }

  get rejectedBy() {
    return [...this._rejectedBy];
  }
}

class ContractNegotiator {
  constructor(options = {}) {
    this._negotiations = new Map();
    this._timeoutMs = Number.isSafeInteger(options.timeout) && options.timeout > 0
      ? options.timeout
      : 60000;
    this._maxRounds = Number.isSafeInteger(options.maxRounds) && options.maxRounds > 0
      ? options.maxRounds
      : 10;
  }

  get negotiations() {
    return Array.from(this._negotiations.values()).map((n) => ({
      contractId: n.contractId,
      from: n.from,
      to: n.to,
      state: n.state,
      updatedAt: n.updatedAt,
      roundCount: n.history.length,
    }));
  }

  propose(from, to, contract) {
    requireString(from, 'from');
    requireString(to, 'to');
    requireContract(contract);

    const contractId = typeof contract.id === 'string'
      ? contract.id
      : `contract-${generateId()}`;

    const record = new NegotiationRecord(contractId, from, to, contract);
    record._state = CONTRACT_STATES.PROPOSED;
    record._history.push(this._createEvent(NEGOTIATION_EVENTS.PROPOSED, from, {
      message: `Contract proposed by ${from} to ${to}`,
      contract: deepClone(contract),
    }));

    this._negotiations.set(contractId, record);

    return {
      contractId,
      state: record._state,
      from,
      to,
      history: record.history,
    };
  }

  accept(agentId, contractId) {
    requireString(agentId, 'agentId');
    requireString(contractId, 'contractId');

    const record = this._getRecord(contractId);
    this._checkParticipant(record, agentId);

    if (record._acceptedBy.includes(agentId)) {
      throw new Error(`Agent ${agentId} has already accepted contract ${contractId}`);
    }

    this._checkTransition(record, CONTRACT_STATES.ACCEPTED);

    record._acceptedBy.push(agentId);
    record._state = CONTRACT_STATES.ACCEPTED;
    record._updatedAt = new Date().toISOString();
    record._history.push(this._createEvent(NEGOTIATION_EVENTS.ACCEPTED, agentId, {
      message: `Contract accepted by ${agentId}`,
    }));

    return {
      contractId,
      state: record._state,
      acceptedBy: record.acceptedBy,
      history: record.history,
    };
  }

  reject(agentId, contractId, reason) {
    requireString(agentId, 'agentId');
    requireString(contractId, 'contractId');

    const record = this._getRecord(contractId);
    this._checkParticipant(record, agentId);

    if (record._rejectedBy.includes(agentId)) {
      throw new Error(`Agent ${agentId} has already rejected contract ${contractId}`);
    }

    this._checkTransition(record, CONTRACT_STATES.REJECTED);

    const reasonText = typeof reason === 'string' ? reason.trim() : 'No reason provided';

    record._rejectedBy.push(agentId);
    record._state = CONTRACT_STATES.REJECTED;
    record._updatedAt = new Date().toISOString();
    record._history.push(this._createEvent(NEGOTIATION_EVENTS.REJECTED, agentId, {
      message: `Contract rejected by ${agentId}: ${reasonText}`,
      reason: reasonText,
    }));

    return {
      contractId,
      state: record._state,
      rejectedBy: record.rejectedBy,
      reason: reasonText,
      history: record.history,
    };
  }

  counter(agentId, contractId, modifiedContract) {
    requireString(agentId, 'agentId');
    requireString(contractId, 'contractId');
    requireContract(modifiedContract);

    const record = this._getRecord(contractId);
    this._checkParticipant(record, agentId);
    this._checkTransition(record, CONTRACT_STATES.NEGOTIATING);

    // Check round limit
    if (record.history.length >= this._maxRounds * 2) {
      throw new Error(`Maximum negotiation rounds (${this._maxRounds}) exceeded for contract ${contractId}`);
    }

    const changes = this._diffContracts(record._currentContract, modifiedContract);

    record._currentContract = deepClone(modifiedContract);
    record._state = CONTRACT_STATES.NEGOTIATING;
    record._updatedAt = new Date().toISOString();
    record._history.push(this._createEvent(NEGOTIATION_EVENTS.COUNTERED, agentId, {
      message: `Counter-proposal from ${agentId}`,
      changes,
      contract: deepClone(modifiedContract),
    }));

    return {
      contractId,
      state: record._state,
      changes,
      history: record.history,
    };
  }

  getNegotiation(contractId) {
    requireString(contractId, 'contractId');

    const record = this._negotiations.get(contractId);
    if (!record) {
      return null;
    }

    return {
      contractId: record.contractId,
      from: record.from,
      to: record.to,
      state: record.state,
      currentContract: record.currentContract,
      history: record.history,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      finalizedAt: record.finalizedAt,
      participants: record.participants,
      acceptedBy: record.acceptedBy,
      rejectedBy: record.rejectedBy,
    };
  }

  finalize(contractId) {
    requireString(contractId, 'contractId');

    const record = this._getRecord(contractId);
    this._checkTransition(record, CONTRACT_STATES.ACTIVE);

    record._state = CONTRACT_STATES.ACTIVE;
    record._finalizedAt = new Date().toISOString();
    record._updatedAt = record._finalizedAt;
    record._history.push(this._createEvent(NEGOTIATION_EVENTS.FINALIZED, 'system', {
      message: `Contract finalized and activated`,
      contract: record.currentContract,
    }));

    return {
      contractId,
      state: record._state,
      finalizedAt: record._finalizedAt,
      currentContract: record.currentContract,
      history: record.history,
    };
  }

  complete(contractId) {
    requireString(contractId, 'contractId');

    const record = this._getRecord(contractId);
    this._checkTransition(record, CONTRACT_STATES.COMPLETED);

    record._state = CONTRACT_STATES.COMPLETED;
    record._updatedAt = new Date().toISOString();
    record._history.push(this._createEvent(NEGOTIATION_EVENTS.COMPLETED, 'system', {
      message: 'Contract completed',
    }));

    return {
      contractId,
      state: record._state,
      history: record.history,
    };
  }

  terminate(contractId, reason) {
    requireString(contractId, 'contractId');

    const record = this._getRecord(contractId);
    this._checkTransition(record, CONTRACT_STATES.TERMINATED);

    const reasonText = typeof reason === 'string' ? reason.trim() : 'No reason provided';

    record._state = CONTRACT_STATES.TERMINATED;
    record._updatedAt = new Date().toISOString();
    record._history.push(this._createEvent(NEGOTIATION_EVENTS.TERMINATED, 'system', {
      message: `Contract terminated: ${reasonText}`,
      reason: reasonText,
    }));

    return {
      contractId,
      state: record._state,
      reason: reasonText,
      history: record.history,
    };
  }

  // --- Internal ---

  _getRecord(contractId) {
    const record = this._negotiations.get(contractId);
    if (!record) {
      throw new Error(`Contract negotiation not found: ${contractId}`);
    }
    return record;
  }

  _checkTransition(record, targetState) {
    const allowed = VALID_TRANSITIONS[record._state];
    if (!allowed || !allowed.includes(targetState)) {
      throw new Error(
        `Invalid state transition: ${record._state} -> ${targetState}. ` +
        `Allowed transitions from ${record._state}: ${(allowed || []).join(', ') || 'none'}`
      );
    }
  }

  _checkParticipant(record, agentId) {
    if (!record._participants.includes(agentId)) {
      throw new Error(`Agent ${agentId} is not a participant in contract ${record.contractId}`);
    }
  }

  _createEvent(type, agentId, payload) {
    return {
      type,
      agentId,
      timestamp: new Date().toISOString(),
      payload: deepClone(payload),
    };
  }

  _diffContracts(original, modified) {
    const changes = [];

    const normalizedOriginal = typeof original === 'object' && original !== null
      ? original
      : {};
    const normalizedModified = typeof modified === 'object' && modified !== null
      ? modified
      : {};

    const allKeys = new Set([
      ...Object.keys(normalizedOriginal),
      ...Object.keys(normalizedModified),
    ]);

    for (const key of allKeys) {
      const origVal = JSON.stringify(normalizedOriginal[key] || null);
      const modVal = JSON.stringify(normalizedModified[key] || null);

      if (origVal !== modVal) {
        changes.push({
          field: key,
          from: deepClone(normalizedOriginal[key] || null),
          to: deepClone(normalizedModified[key] || null),
        });
      }
    }

    return changes;
  }
}

// --- Helpers ---

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function requireContract(contract) {
  if (!contract || typeof contract !== 'object') {
    throw new Error('Contract must be a non-null object');
  }
}

function deepClone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function generateId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${timestamp}-${random}`;
}

module.exports = {
  ContractNegotiator,
  NegotiationRecord,
  NEGOTIATION_EVENTS,
  VALID_TRANSITIONS,
};
