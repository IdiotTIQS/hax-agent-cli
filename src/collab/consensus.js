"use strict";

const VOTE_VALUES = Object.freeze({
  approve: 'approve',
  reject: 'reject',
  abstain: 'abstain',
});

const PROPOSAL_STATUS = Object.freeze({
  open: 'open',
  resolved: 'resolved',
  expired: 'expired',
  cancelled: 'cancelled',
});

/**
 * Base voting-rule strategy.  Subclasses override `evaluate()`.
 */
class VotingRule {
  /**
   * @param {number} quorum  Minimum number of votes (approve + reject + abstain)
   *                         required before a result is returned.  0 = no quorum.
   */
  constructor(quorum = 0) {
    this.quorum = Math.max(0, Number.isSafeInteger(quorum) ? quorum : 0);
  }

  /**
   * Evaluate vote tallies and return a resolved result or null if unresolved.
   * @param {{ total: number, approved: number, rejected: number, abstained: number }} tallies
   * @param {number} voterCount Total number of eligible voters
   * @returns {{
   *   approved: number,
   *   rejected: number,
   *   abstained: number,
   *   result: 'approved'|'rejected'|'tied'|null,
   *   quorum: number,
   *   quorumMet: boolean,
   *   resolved: boolean,
   * }}
   */
  evaluate(tallies, voterCount) {
    throw new Error('VotingRule.evaluate must be implemented by subclass');
  }
}

/**
 * Simple majority: more approvals than rejections wins.
 * Abstentions count toward quorum but not toward either side.
 */
class MajorityRule extends VotingRule {
  evaluate(tallies, voterCount) {
    const total = tallies.approved + tallies.rejected + tallies.abstained;
    const quorumMet = this.quorum === 0 || total >= this.quorum;

    if (!quorumMet) {
      return {
        approved: tallies.approved,
        rejected: tallies.rejected,
        abstained: tallies.abstained,
        result: null,
        quorum: this.quorum,
        quorumMet: false,
        resolved: false,
      };
    }

    const result = tallies.approved > tallies.rejected ? 'approved'
      : tallies.rejected > tallies.approved ? 'rejected'
      : 'tied';

    return {
      approved: tallies.approved,
      rejected: tallies.rejected,
      abstained: tallies.abstained,
      result,
      quorum: this.quorum,
      quorumMet: true,
      resolved: result !== 'tied',
    };
  }
}

/**
 * Supermajority (2/3): at least two-thirds of non-abstention votes must approve.
 */
class SupermajorityRule extends VotingRule {
  evaluate(tallies, voterCount) {
    const total = tallies.approved + tallies.rejected + tallies.abstained;
    const quorumMet = this.quorum === 0 || total >= this.quorum;

    if (!quorumMet) {
      return {
        approved: tallies.approved,
        rejected: tallies.rejected,
        abstained: tallies.abstained,
        result: null,
        quorum: this.quorum,
        quorumMet: false,
        resolved: false,
      };
    }

    const decisive = tallies.approved + tallies.rejected;
    if (decisive === 0) {
      return {
        approved: tallies.approved,
        rejected: tallies.rejected,
        abstained: tallies.abstained,
        result: 'rejected',
        quorum: this.quorum,
        quorumMet: true,
        resolved: true,
      };
    }

    const ratio = tallies.approved / decisive;
    const result = ratio >= 2 / 3 ? 'approved' : 'rejected';

    return {
      approved: tallies.approved,
      rejected: tallies.rejected,
      abstained: tallies.abstained,
      result,
      quorum: this.quorum,
      quorumMet: true,
      resolved: true,
    };
  }
}

/**
 * Unanimous: every non-abstention vote must be an approval.
 */
class UnanimousRule extends VotingRule {
  evaluate(tallies, voterCount) {
    const total = tallies.approved + tallies.rejected + tallies.abstained;
    const quorumMet = this.quorum === 0 || total >= this.quorum;

    if (!quorumMet) {
      return {
        approved: tallies.approved,
        rejected: tallies.rejected,
        abstained: tallies.abstained,
        result: null,
        quorum: this.quorum,
        quorumMet: false,
        resolved: false,
      };
    }

    if (tallies.rejected > 0) {
      return {
        approved: tallies.approved,
        rejected: tallies.rejected,
        abstained: tallies.abstained,
        result: 'rejected',
        quorum: this.quorum,
        quorumMet: true,
        resolved: true,
      };
    }

    const decisive = tallies.approved + tallies.rejected;
    if (decisive === 0) {
      return {
        approved: tallies.approved,
        rejected: tallies.rejected,
        abstained: tallies.abstained,
        result: 'rejected',
        quorum: this.quorum,
        quorumMet: true,
        resolved: true,
      };
    }

    return {
      approved: tallies.approved,
      rejected: tallies.rejected,
      abstained: tallies.abstained,
      result: 'approved',
      quorum: this.quorum,
      quorumMet: true,
      resolved: true,
    };
  }
}

class ConsensusProtocol {
  /**
   * @param {object} [options]
   * @param {VotingRule} [options.rule]     - Voting rule strategy
   * @param {string[]}  [options.members]   - Eligible voter IDs
   * @param {number}    [options.quorum]    - Minimum votes required
   * @param {number}    [options.ttlMs]     - Proposal expiry in milliseconds
   */
  constructor(options = {}) {
    this._rule = options.rule || new MajorityRule(options.quorum);
    this._members = new Set(normalizeList(options.members));
    this._ttlMs = Number.isSafeInteger(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : 0;
    this._proposals = new Map();
    this._sequence = 0;
  }

  /**
   * Add an eligible voter to the protocol.
   */
  addMember(agentId) {
    requireString(agentId, 'agentId');
    this._members.add(agentId);
  }

  /**
   * Remove an eligible voter.  Their existing votes are preserved.
   */
  removeMember(agentId) {
    requireString(agentId, 'agentId');
    this._members.delete(agentId);
  }

  /**
   * Return the current set of eligible voter IDs.
   */
  get members() {
    return Array.from(this._members);
  }

  /**
   * An agent makes a proposal.
   * @returns {object} The created proposal record.
   */
  propose(agentId, proposal) {
    requireString(agentId, 'agentId');

    if (!proposal || typeof proposal !== 'object') {
      throw new Error('proposal must be an object');
    }

    const id = `prop-${++this._sequence}`;
    const record = {
      id,
      proposer: agentId,
      title: String(proposal.title || '').trim(),
      description: String(proposal.description || '').trim(),
      metadata: deepClone(proposal.metadata || {}),
      status: PROPOSAL_STATUS.open,
      votes: {},
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      expiresAt: this._ttlMs > 0 ? new Date(Date.now() + this._ttlMs).toISOString() : null,
      result: null,
    };

    this._proposals.set(id, record);
    return deepClone(record);
  }

  /**
   * An agent votes on a proposal.
   * @param {string} agentId
   * @param {string} proposalId
   * @param {'approve'|'reject'|'abstain'} vote
   * @returns {object} The latest evaluation for the proposal.
   */
  vote(agentId, proposalId, vote) {
    requireString(agentId, 'agentId');
    requireString(proposalId, 'proposalId');
    requireValidVote(vote);

    const proposal = this._getProposal(proposalId);

    if (proposal.status !== PROPOSAL_STATUS.open) {
      throw new Error(`Proposal '${proposalId}' is ${proposal.status} and cannot accept new votes`);
    }

    if (!this._members.has(agentId)) {
      throw new Error(`Agent '${agentId}' is not an eligible voter`);
    }

    proposal.votes[agentId] = { vote, votedAt: new Date().toISOString() };

    // Evaluate
    const tallies = this._tallyVotes(proposal);
    const evaluation = this._rule.evaluate(tallies, this._members.size);

    if (evaluation.resolved) {
      proposal.status = PROPOSAL_STATUS.resolved;
      proposal.resolvedAt = new Date().toISOString();
      proposal.result = { ...evaluation };
    }

    return {
      proposal: deepClone(proposal),
      evaluation,
    };
  }

  /**
   * Get the full result for a proposal.
   */
  getResult(proposalId) {
    requireString(proposalId, 'proposalId');

    const proposal = this._getProposal(proposalId);
    const tallies = this._tallyVotes(proposal);
    const evaluation = this._rule.evaluate(tallies, this._members.size);

    return {
      proposalId,
      title: proposal.title,
      proposer: proposal.proposer,
      status: proposal.status,
      approved: evaluation.approved,
      rejected: evaluation.rejected,
      abstained: evaluation.abstained,
      result: evaluation.result,
      quorum: evaluation.quorum,
      quorumMet: evaluation.quorumMet,
      resolved: evaluation.resolved,
      createdAt: proposal.createdAt,
      resolvedAt: proposal.resolvedAt,
      expiresAt: proposal.expiresAt,
      votes: deepClone(proposal.votes),
    };
  }

  /**
   * Get proposals that are still open (unresolved, not expired/cancelled).
   */
  getPendingProposals() {
    const now = Date.now();
    const pending = [];

    for (const proposal of this._proposals.values()) {
      // Auto-expire if TTL has passed
      if (proposal.status === PROPOSAL_STATUS.open && proposal.expiresAt && new Date(proposal.expiresAt).getTime() <= now) {
        proposal.status = PROPOSAL_STATUS.expired;
        proposal.resolvedAt = new Date().toISOString();
      }

      if (proposal.status === PROPOSAL_STATUS.open) {
        pending.push(deepClone(proposal));
      }
    }

    return pending;
  }

  /**
   * Cancel an open proposal.
   */
  cancel(proposalId, agentId) {
    requireString(proposalId, 'proposalId');

    const proposal = this._getProposal(proposalId);

    if (proposal.status !== PROPOSAL_STATUS.open) {
      throw new Error(`Proposal '${proposalId}' is ${proposal.status} and cannot be cancelled`);
    }

    if (agentId && proposal.proposer !== agentId) {
      throw new Error(`Only the proposer (${proposal.proposer}) may cancel proposal '${proposalId}'`);
    }

    proposal.status = PROPOSAL_STATUS.cancelled;
    proposal.resolvedAt = new Date().toISOString();

    return deepClone(proposal);
  }

  /**
   * Get all proposals.
   */
  getAllProposals() {
    return Array.from(this._proposals.values()).map(deepClone);
  }

  /**
   * Replace the voting rule.
   */
  setRule(rule) {
    if (!(rule instanceof VotingRule)) {
      throw new Error('rule must be an instance of VotingRule');
    }
    this._rule = rule;
  }

  // ---- Private ----

  _getProposal(proposalId) {
    const proposal = this._proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Unknown proposal: ${proposalId}`);
    }
    return proposal;
  }

  _tallyVotes(proposal) {
    let approved = 0;
    let rejected = 0;
    let abstained = 0;

    for (const record of Object.values(proposal.votes)) {
      if (record.vote === VOTE_VALUES.approve) {
        approved++;
      } else if (record.vote === VOTE_VALUES.reject) {
        rejected++;
      } else if (record.vote === VOTE_VALUES.abstain) {
        abstained++;
      }
    }

    return { approved, rejected, abstained, total: approved + rejected + abstained };
  }
}

// ---- Helpers ----

function normalizeList(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

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

function requireValidVote(vote) {
  if (!Object.values(VOTE_VALUES).includes(vote)) {
    throw new Error(`vote must be one of: ${Object.values(VOTE_VALUES).join(', ')}`);
  }
}

module.exports = {
  ConsensusProtocol,
  MajorityRule,
  PROPOSAL_STATUS,
  SupermajorityRule,
  UnanimousRule,
  VOTE_VALUES,
  VotingRule,
};
