"use strict";

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  ContractNegotiator,
  NEGOTIATION_EVENTS,
  VALID_TRANSITIONS,
} = require('../../src/contracts/negotiate');

const { CONTRACT_STATES } = require('../../src/contracts/define');

const sampleContract = {
  name: 'code-review',
  version: '1.0.0',
  input: { type: 'object' },
  output: { type: 'object' },
  requirements: {
    tools: ['file.read', 'file.glob'],
    permissions: ['read'],
    models: ['claude-sonnet-4'],
  },
  guarantees: {
    deliverables: ['review report'],
    qualityLevel: 'thorough',
  },
  timeout: 30000,
  retry: { maxAttempts: 3 },
};

describe('ContractNegotiator - propose', () => {
  it('should create a new negotiation in PROPOSED state', () => {
    const negotiator = new ContractNegotiator();
    const result = negotiator.propose('agent-a', 'agent-b', sampleContract);

    assert.strictEqual(result.state, CONTRACT_STATES.PROPOSED);
    assert.strictEqual(result.from, 'agent-a');
    assert.strictEqual(result.to, 'agent-b');
    assert.ok(result.contractId.startsWith('contract-'));
    assert.strictEqual(result.history.length, 1);
    assert.strictEqual(result.history[0].type, NEGOTIATION_EVENTS.PROPOSED);
  });

  it('should throw for invalid from/to strings', () => {
    const negotiator = new ContractNegotiator();

    assert.throws(() => negotiator.propose('', 'agent-b', sampleContract), {
      message: /from must be a non-empty string/,
    });
    assert.throws(() => negotiator.propose('agent-a', '', sampleContract), {
      message: /to must be a non-empty string/,
    });
    assert.throws(() => negotiator.propose('agent-a', 'agent-b', null), {
      message: /Contract must be a non-null object/,
    });
  });
});

describe('ContractNegotiator - accept', () => {
  let negotiator;
  let contractId;

  beforeEach(() => {
    negotiator = new ContractNegotiator();
    const result = negotiator.propose('agent-a', 'agent-b', sampleContract);
    contractId = result.contractId;
  });

  it('should accept a contract from PROPOSED state', () => {
    const result = negotiator.accept('agent-b', contractId);

    assert.strictEqual(result.state, CONTRACT_STATES.ACCEPTED);
    assert.ok(result.acceptedBy.includes('agent-b'));
    assert.strictEqual(result.history.length, 2);
    assert.strictEqual(result.history[1].type, NEGOTIATION_EVENTS.ACCEPTED);
  });

  it('should throw when non-participant tries to accept', () => {
    assert.throws(() => negotiator.accept('outsider', contractId), {
      message: /not a participant/,
    });
  });

  it('should throw when agent has already accepted', () => {
    negotiator.accept('agent-b', contractId);
    assert.throws(() => negotiator.accept('agent-b', contractId), {
      message: /already accepted/,
    });
  });

  it('should throw for nonexistent contract', () => {
    assert.throws(() => negotiator.accept('agent-b', 'nonexistent'), {
      message: /not found/,
    });
  });
});

describe('ContractNegotiator - reject', () => {
  let negotiator;
  let contractId;

  beforeEach(() => {
    negotiator = new ContractNegotiator();
    const result = negotiator.propose('agent-a', 'agent-b', sampleContract);
    contractId = result.contractId;
  });

  it('should reject a contract with a reason', () => {
    const result = negotiator.reject('agent-b', contractId, 'Missing tool support');

    assert.strictEqual(result.state, CONTRACT_STATES.REJECTED);
    assert.strictEqual(result.reason, 'Missing tool support');
    assert.ok(result.rejectedBy.includes('agent-b'));
    assert.strictEqual(result.history.length, 2);
    assert.strictEqual(result.history[1].type, NEGOTIATION_EVENTS.REJECTED);
  });

  it('should default reason when not provided', () => {
    const result = negotiator.reject('agent-b', contractId);
    assert.strictEqual(result.reason, 'No reason provided');
  });

  it('should throw when agent has already rejected', () => {
    negotiator.reject('agent-b', contractId, 'nope');
    assert.throws(() => negotiator.reject('agent-b', contractId, 'nope again'), {
      message: /already rejected/,
    });
  });
});

describe('ContractNegotiator - counter', () => {
  let negotiator;
  let contractId;

  beforeEach(() => {
    negotiator = new ContractNegotiator();
    const result = negotiator.propose('agent-a', 'agent-b', sampleContract);
    contractId = result.contractId;
  });

  it('should create a counter-proposal', () => {
    const modified = {
      ...sampleContract,
      timeout: 60000,
      requirements: {
        ...sampleContract.requirements,
        tools: ['file.read'],
      },
    };

    const result = negotiator.counter('agent-b', contractId, modified);

    assert.strictEqual(result.state, CONTRACT_STATES.NEGOTIATING);
    assert.ok(Array.isArray(result.changes));
    assert.ok(result.changes.length > 0);
    assert.strictEqual(result.history[1].type, NEGOTIATION_EVENTS.COUNTERED);
  });

  it('should update the current contract after counter', () => {
    const modified = {
      ...sampleContract,
      timeout: 120000,
    };

    negotiator.counter('agent-b', contractId, modified);
    const negotiation = negotiator.getNegotiation(contractId);
    assert.strictEqual(negotiation.currentContract.timeout, 120000);
  });

  it('should throw when non-participant tries to counter', () => {
    assert.throws(() => negotiator.counter('outsider', contractId, sampleContract), {
      message: /not a participant/,
    });
  });

  it('should throw when countering from wrong state', () => {
    negotiator.accept('agent-b', contractId);
    assert.throws(() => negotiator.counter('agent-b', contractId, sampleContract), {
      message: /Invalid state transition/,
    });
  });

  it('should track changes between original and counter', () => {
    const modified = {
      ...sampleContract,
      name: 'enhanced-review',
      timeout: 90000,
    };

    const result = negotiator.counter('agent-b', contractId, modified);
    assert.ok(result.changes.some((c) => c.field === 'name'));
    assert.ok(result.changes.some((c) => c.field === 'timeout'));
  });
});

describe('ContractNegotiator - getNegotiation', () => {
  it('should return full negotiation state', () => {
    const negotiator = new ContractNegotiator();
    const result = negotiator.propose('agent-a', 'agent-b', sampleContract);

    const negotiation = negotiator.getNegotiation(result.contractId);
    assert.ok(negotiation);
    assert.strictEqual(negotiation.contractId, result.contractId);
    assert.strictEqual(negotiation.from, 'agent-a');
    assert.strictEqual(negotiation.to, 'agent-b');
    assert.strictEqual(negotiation.state, CONTRACT_STATES.PROPOSED);
    assert.ok(negotiation.currentContract);
    assert.ok(Array.isArray(negotiation.participants));
    assert.ok(Array.isArray(negotiation.history));
  });

  it('should return null for nonexistent negotiation', () => {
    const negotiator = new ContractNegotiator();
    const negotiation = negotiator.getNegotiation('nonexistent');
    assert.strictEqual(negotiation, null);
  });
});

describe('ContractNegotiator - finalize', () => {
  let negotiator;
  let contractId;

  beforeEach(() => {
    negotiator = new ContractNegotiator();
    const result = negotiator.propose('agent-a', 'agent-b', sampleContract);
    contractId = result.contractId;
    negotiator.accept('agent-b', contractId);
  });

  it('should finalize an accepted contract', () => {
    const result = negotiator.finalize(contractId);

    assert.strictEqual(result.state, CONTRACT_STATES.ACTIVE);
    assert.ok(typeof result.finalizedAt === 'string');
    assert.strictEqual(result.history[2].type, NEGOTIATION_EVENTS.FINALIZED);
  });

  it('should throw when finalizing from PROPOSED state', () => {
    const neg2 = new ContractNegotiator();
    const { contractId: cid } = neg2.propose('agent-a', 'agent-b', sampleContract);

    assert.throws(() => neg2.finalize(cid), {
      message: /Invalid state transition/,
    });
  });

  it('should throw when finalizing rejected contract', () => {
    const neg2 = new ContractNegotiator();
    const { contractId: cid } = neg2.propose('agent-a', 'agent-b', sampleContract);
    neg2.reject('agent-b', cid, 'no');

    assert.throws(() => neg2.finalize(cid), {
      message: /Invalid state transition/,
    });
  });
});

describe('ContractNegotiator - complete and terminate', () => {
  it('should complete an active contract', () => {
    const negotiator = new ContractNegotiator();
    const { contractId } = negotiator.propose('agent-a', 'agent-b', sampleContract);
    negotiator.accept('agent-b', contractId);
    negotiator.finalize(contractId);

    const result = negotiator.complete(contractId);
    assert.strictEqual(result.state, CONTRACT_STATES.COMPLETED);
  });

  it('should terminate a contract at any state before completed', () => {
    const negotiator = new ContractNegotiator();
    const { contractId } = negotiator.propose('agent-a', 'agent-b', sampleContract);

    const result = negotiator.terminate(contractId, 'No longer needed');
    assert.strictEqual(result.state, CONTRACT_STATES.TERMINATED);
    assert.strictEqual(result.reason, 'No longer needed');
  });

  it('should throw when completing from non-active state', () => {
    const negotiator = new ContractNegotiator();
    const { contractId } = negotiator.propose('agent-a', 'agent-b', sampleContract);

    assert.throws(() => negotiator.complete(contractId), {
      message: /Invalid state transition/,
    });
  });
});

describe('ContractNegotiator - full lifecycle', () => {
  it('should support PROPOSED -> ACCEPTED -> ACTIVE -> COMPLETED lifecycle', () => {
    const negotiator = new ContractNegotiator();
    const { contractId } = negotiator.propose('agent-a', 'agent-b', sampleContract);
    assert.strictEqual(negotiator.getNegotiation(contractId).state, CONTRACT_STATES.PROPOSED);

    negotiator.accept('agent-b', contractId);
    assert.strictEqual(negotiator.getNegotiation(contractId).state, CONTRACT_STATES.ACCEPTED);

    negotiator.finalize(contractId);
    assert.strictEqual(negotiator.getNegotiation(contractId).state, CONTRACT_STATES.ACTIVE);

    negotiator.complete(contractId);
    assert.strictEqual(negotiator.getNegotiation(contractId).state, CONTRACT_STATES.COMPLETED);
  });

  it('should support PROPOSED -> NEGOTIATING -> PROPOSED -> ACCEPTED flow', () => {
    const negotiator = new ContractNegotiator();
    const { contractId } = negotiator.propose('agent-a', 'agent-b', sampleContract);

    negotiator.counter('agent-b', contractId, { ...sampleContract, timeout: 60000 });
    assert.strictEqual(negotiator.getNegotiation(contractId).state, CONTRACT_STATES.NEGOTIATING);

    // agent-a re-proposes
    const result = negotiator.propose('agent-a', 'agent-b', { ...sampleContract, timeout: 60000 });
    const newContractId = result.contractId;

    negotiator.accept('agent-b', newContractId);
    assert.strictEqual(negotiator.getNegotiation(newContractId).state, CONTRACT_STATES.ACCEPTED);
  });

  it('should list all negotiations', () => {
    const negotiator = new ContractNegotiator();
    negotiator.propose('agent-a', 'agent-b', sampleContract);
    negotiator.propose('agent-c', 'agent-d', { ...sampleContract, name: 'security-audit' });

    const all = negotiator.negotiations;
    assert.strictEqual(all.length, 2);
    assert.ok(all.every((n) => typeof n.contractId === 'string'));
  });
});
