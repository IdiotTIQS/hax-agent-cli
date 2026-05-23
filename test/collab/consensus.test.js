"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ConsensusProtocol,
  MajorityRule,
  PROPOSAL_STATUS,
  SupermajorityRule,
  UnanimousRule,
  VOTE_VALUES,
  VotingRule,
} = require("../../src/collab/consensus");

// ---- MajorityRule ----

test("MajorityRule: approves when approvals exceed rejections", () => {
  const rule = new MajorityRule(3);
  const result = rule.evaluate({ approved: 3, rejected: 1, abstained: 0 }, 5);

  assert.equal(result.quorumMet, true);
  assert.equal(result.result, "approved");
  assert.equal(result.resolved, true);
});

test("MajorityRule: rejects when rejections exceed approvals", () => {
  const rule = new MajorityRule(3);
  const result = rule.evaluate({ approved: 1, rejected: 3, abstained: 0 }, 5);

  assert.equal(result.quorumMet, true);
  assert.equal(result.result, "rejected");
  assert.equal(result.resolved, true);
});

test("MajorityRule: returns tied when approvals equal rejections", () => {
  const rule = new MajorityRule(0);
  const result = rule.evaluate({ approved: 2, rejected: 2, abstained: 0 }, 5);

  assert.equal(result.result, "tied");
  assert.equal(result.resolved, false);
});

test("MajorityRule: unresolved when quorum is not met", () => {
  const rule = new MajorityRule(5);
  const result = rule.evaluate({ approved: 2, rejected: 1, abstained: 0 }, 5);

  assert.equal(result.quorumMet, false);
  assert.equal(result.result, null);
  assert.equal(result.resolved, false);
});

test("MajorityRule: quorum 0 means always met", () => {
  const rule = new MajorityRule(0);
  const result = rule.evaluate({ approved: 1, rejected: 0, abstained: 0 }, 5);

  assert.equal(result.quorumMet, true);
  assert.equal(result.result, "approved");
});

// ---- SupermajorityRule ----

test("SupermajorityRule: approves when 2/3 of decisive votes approve", () => {
  const rule = new SupermajorityRule(0);
  const result = rule.evaluate({ approved: 4, rejected: 2, abstained: 0 }, 6);

  assert.equal(result.result, "approved");
  assert.equal(result.resolved, true);
});

test("SupermajorityRule: rejects when less than 2/3 approve", () => {
  const rule = new SupermajorityRule(0);
  const result = rule.evaluate({ approved: 3, rejected: 3, abstained: 0 }, 6);

  assert.equal(result.result, "rejected");
  assert.equal(result.resolved, true);
});

test("SupermajorityRule: requires exact 2/3 ratio", () => {
  const rule = new SupermajorityRule(0);
  // 6 approve, 3 reject = 6/9 = 0.666... which hits the threshold
  const result = rule.evaluate({ approved: 6, rejected: 3, abstained: 0 }, 10);

  assert.equal(result.result, "approved");
});

// ---- UnanimousRule ----

test("UnanimousRule: approves when all non-abstention votes are approve", () => {
  const rule = new UnanimousRule(0);
  const result = rule.evaluate({ approved: 5, rejected: 0, abstained: 2 }, 7);

  assert.equal(result.result, "approved");
  assert.equal(result.resolved, true);
});

test("UnanimousRule: rejects when any rejection exists", () => {
  const rule = new UnanimousRule(0);
  const result = rule.evaluate({ approved: 5, rejected: 1, abstained: 0 }, 7);

  assert.equal(result.result, "rejected");
  assert.equal(result.resolved, true);
});

// ---- ConsensusProtocol ----

test("ConsensusProtocol: propose creates an open proposal", () => {
  const protocol = new ConsensusProtocol({ members: ["alice", "bob", "carol"] });

  const prop = protocol.propose("alice", {
    title: "Adopt TypeScript",
    description: "Switch the codebase to TypeScript across all modules.",
  });

  assert.ok(prop.id.startsWith("prop-"));
  assert.equal(prop.proposer, "alice");
  assert.equal(prop.title, "Adopt TypeScript");
  assert.equal(prop.status, PROPOSAL_STATUS.open);
  assert.equal(prop.result, null);
});

test("ConsensusProtocol: propose throws for empty agentId", () => {
  const protocol = new ConsensusProtocol({ members: ["alice"] });

  assert.throws(() => protocol.propose("", { title: "Test" }), {
    message: /non-empty string/,
  });
});

test("ConsensusProtocol: propose throws for non-object proposal", () => {
  const protocol = new ConsensusProtocol({ members: ["alice"] });

  assert.throws(() => protocol.propose("alice", "not-an-object"), {
    message: /must be an object/,
  });
});

test("ConsensusProtocol: vote from eligible member is accepted and tallied", () => {
  // Use quorum=3 so the proposal does not resolve until all three members vote
  const protocol = new ConsensusProtocol({ members: ["alice", "bob", "carol"], rule: new MajorityRule(3) });

  protocol.propose("alice", { title: "Adopt TypeScript" });

  const result = protocol.vote("alice", "prop-1", VOTE_VALUES.approve);
  assert.equal(result.evaluation.approved, 1);
  assert.equal(result.evaluation.rejected, 0);
  assert.equal(result.evaluation.result, null); // Needs more votes for quorum

  protocol.vote("bob", "prop-1", VOTE_VALUES.approve);
  const finalResult = protocol.vote("carol", "prop-1", VOTE_VALUES.reject);

  assert.equal(finalResult.evaluation.approved, 2);
  assert.equal(finalResult.evaluation.rejected, 1);
  assert.equal(finalResult.evaluation.result, "approved");
  assert.equal(finalResult.proposal.status, PROPOSAL_STATUS.resolved);
});

test("ConsensusProtocol: vote throws for non-member agent", () => {
  const protocol = new ConsensusProtocol({ members: ["alice"] });

  protocol.propose("alice", { title: "Test" });

  assert.throws(() => protocol.vote("bob", "prop-1", VOTE_VALUES.approve), {
    message: /not an eligible voter/,
  });
});

test("ConsensusProtocol: vote throws for invalid vote value", () => {
  const protocol = new ConsensusProtocol({ members: ["alice", "bob"] });

  protocol.propose("alice", { title: "Test" });

  assert.throws(() => protocol.vote("alice", "prop-1", "maybe"), {
    message: /vote must be one of/,
  });
});

test("ConsensusProtocol: vote throws on already resolved proposal", () => {
  // With 2 members and majority rule, first vote resolves immediately
  // So we need to use quorum to prevent that
  const protocol = new ConsensusProtocol({ members: ["alice", "bob", "carol"], rule: new MajorityRule(2) });

  protocol.propose("alice", { title: "Test" });
  protocol.vote("alice", "prop-1", VOTE_VALUES.approve);
  protocol.vote("bob", "prop-1", VOTE_VALUES.approve); // Resolves as approved (quorum met, 2 > 0)

  assert.throws(() => protocol.vote("carol", "prop-1", VOTE_VALUES.reject), {
    message: /cannot accept new votes/,
  });
});

test("ConsensusProtocol: getResult returns full proposal state including votes", () => {
  // Use quorum=3 to ensure all three votes are cast before resolution
  const protocol = new ConsensusProtocol({ members: ["alice", "bob", "carol"], rule: new MajorityRule(3) });

  protocol.propose("alice", { title: "Deploy on Friday" });
  protocol.vote("alice", "prop-1", VOTE_VALUES.approve);
  protocol.vote("bob", "prop-1", VOTE_VALUES.reject);
  protocol.vote("carol", "prop-1", VOTE_VALUES.approve);

  const result = protocol.getResult("prop-1");

  assert.equal(result.approved, 2);
  assert.equal(result.rejected, 1);
  assert.equal(result.abstained, 0);
  assert.equal(result.result, "approved");
  assert.equal(result.resolved, true);
  assert.equal(Object.keys(result.votes).length, 3);
});

test("ConsensusProtocol: getPendingProposals returns only open proposals", () => {
  // Use quorum=2 so both votes are needed to resolve
  const protocol = new ConsensusProtocol({ members: ["alice", "bob"], rule: new MajorityRule(2) });

  protocol.propose("alice", { title: "One" });
  protocol.propose("alice", { title: "Two" });

  // Resolve the first
  protocol.vote("alice", "prop-1", VOTE_VALUES.approve);
  protocol.vote("bob", "prop-1", VOTE_VALUES.approve);

  const pending = protocol.getPendingProposals();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].title, "Two");
});

test("ConsensusProtocol: cancel removes an open proposal", () => {
  const protocol = new ConsensusProtocol({ members: ["alice", "bob"] });

  protocol.propose("alice", { title: "Unwanted" });

  const cancelled = protocol.cancel("prop-1", "alice");
  assert.equal(cancelled.status, PROPOSAL_STATUS.cancelled);

  assert.equal(protocol.getPendingProposals().length, 0);
});

test("ConsensusProtocol: cancel throws if called by non-proposer", () => {
  const protocol = new ConsensusProtocol({ members: ["alice", "bob"] });

  protocol.propose("alice", { title: "Test" });

  assert.throws(() => protocol.cancel("prop-1", "bob"), {
    message: /may cancel/,
  });
});

test("ConsensusProtocol: TTL expiry auto-expires open proposals", async () => {
  // Use a very small TTL so the proposal expires almost immediately
  const protocol = new ConsensusProtocol({ members: ["alice"], ttlMs: 5 });

  protocol.propose("alice", { title: "Expired plan" });

  // Wait for TTL to pass
  await delay(10);

  const pending = protocol.getPendingProposals();
  assert.equal(pending.length, 0);

  const all = protocol.getAllProposals();
  assert.equal(all.length, 1);
  assert.equal(all[0].status, PROPOSAL_STATUS.expired);
});

test("ConsensusProtocol: Abstain votes count toward quorum but not result", () => {
  const protocol = new ConsensusProtocol({ members: ["alice", "bob", "carol"], quorum: 3 });

  protocol.propose("alice", { title: "Neutral topic" });
  protocol.vote("alice", "prop-1", VOTE_VALUES.abstain);
  protocol.vote("bob", "prop-1", VOTE_VALUES.approve);
  const result = protocol.vote("carol", "prop-1", VOTE_VALUES.abstain);

  assert.equal(result.evaluation.approved, 1);
  assert.equal(result.evaluation.rejected, 0);
  assert.equal(result.evaluation.abstained, 2);
  assert.equal(result.evaluation.quorumMet, true);
  assert.equal(result.evaluation.result, "approved");
});

test("ConsensusProtocol: getResult throws for unknown proposal", () => {
  const protocol = new ConsensusProtocol({ members: ["alice"] });

  assert.throws(() => protocol.getResult("nonexistent"), {
    message: /Unknown proposal/,
  });
});

test("ConsensusProtocol: SupermajorityRule integration with protocol", () => {
  // Use quorum=5 so all votes are needed before resolution
  const protocol = new ConsensusProtocol({
    members: ["alice", "bob", "carol", "dave", "eve"],
    rule: new SupermajorityRule(5),
  });

  protocol.propose("alice", { title: "Big change" });

  // 4 approve, 1 reject = 80% > 66.7%
  protocol.vote("alice", "prop-1", VOTE_VALUES.approve);
  protocol.vote("bob", "prop-1", VOTE_VALUES.approve);
  protocol.vote("carol", "prop-1", VOTE_VALUES.approve);
  protocol.vote("dave", "prop-1", VOTE_VALUES.approve);
  const result = protocol.vote("eve", "prop-1", VOTE_VALUES.reject);

  assert.equal(result.evaluation.result, "approved");
});

test("ConsensusProtocol: UnanimousRule integration with protocol rejects on single veto", () => {
  // Use quorum=3 so all three votes are needed before resolution
  const protocol = new ConsensusProtocol({
    members: ["alice", "bob", "carol"],
    rule: new UnanimousRule(3),
  });

  protocol.propose("alice", { title: "Critical change" });

  protocol.vote("alice", "prop-1", VOTE_VALUES.approve);
  protocol.vote("bob", "prop-1", VOTE_VALUES.approve);
  const result = protocol.vote("carol", "prop-1", VOTE_VALUES.reject);

  assert.equal(result.evaluation.result, "rejected");
});

// ---- Helpers ----

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
