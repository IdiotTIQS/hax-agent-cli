"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');
const { DebateEngine, DEBATE_STATE } = require('../../src/debate/engine');
const { ArgumentScorer } = require('../../src/debate/scoring');

// ---- helpers ----

function oxfordParticipants() {
  return [
    { agentId: 'agent-proposer', role: 'proposer' },
    { agentId: 'agent-opposer', role: 'opposer' },
    { agentId: 'agent-moderator', role: 'moderator' },
  ];
}

function panelParticipants() {
  return [
    { agentId: 'expert-1', role: 'expert' },
    { agentId: 'expert-2', role: 'expert' },
    { agentId: 'expert-3', role: 'expert' },
    { agentId: 'mod-1', role: 'moderator' },
  ];
}

function roundRobinParticipants() {
  return [
    { agentId: 'panelist-1', role: 'panelist' },
    { agentId: 'panelist-2', role: 'panelist' },
    { agentId: 'panelist-3', role: 'panelist' },
  ];
}

// ---- startDebate ----

test('startDebate creates an active debate record', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Is AI alignment solvable?', oxfordParticipants(), 'OXFORD');

  assert.ok(debate.id.startsWith('debate-'));
  assert.equal(debate.topic, 'Is AI alignment solvable?');
  assert.equal(debate.state, DEBATE_STATE.active);
  assert.equal(debate.currentPhase, 'opening');
  assert.equal(debate.participants.length, 3);
  assert.equal(debate.format.id, 'OXFORD');
  assert.ok(Array.isArray(debate.arguments));
  assert.ok(Array.isArray(debate.events));
});

test('startDebate throws for empty topic', () => {
  const engine = new DebateEngine();
  assert.throws(() => engine.startDebate('', oxfordParticipants(), 'OXFORD'), /non-empty string/);
  assert.throws(() => engine.startDebate('   ', oxfordParticipants(), 'OXFORD'), /non-empty string/);
});

test('startDebate throws for invalid participants', () => {
  const engine = new DebateEngine();
  assert.throws(
    () => engine.startDebate('Topic', [{ agentId: 'x', role: 'proposer' }], 'OXFORD'),
    /Invalid participants/
  );
});

test('startDebate accepts metadata and config options', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Topic', oxfordParticipants(), 'OXFORD', {
    metadata: { priority: 'high' },
    maxArguments: 3,
    maxRebuttals: 2,
  });
  assert.equal(debate.metadata.priority, 'high');
  assert.equal(debate.config.maxArguments, 3);
  assert.equal(debate.config.maxRebuttals, 2);
});

// ---- submitArgument ----

test('submitArgument stores argument with scoring', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Topic', panelParticipants(), 'PANEL');

  const arg = engine.submitArgument('expert-1', {
    debateId: debate.id,
    body: 'According to research, alignment is achievable through iterative refinement.',
    position: 'for',
  });

  assert.ok(arg.id.startsWith(`${debate.id}-arg-`));
  assert.equal(arg.agentId, 'expert-1');
  assert.equal(arg.position, 'for');
  assert.ok(typeof arg.scoring.composite === 'number');
  assert.equal(arg.phase, 'opening');
});

test('submitArgument enforces maxArguments config', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Topic', panelParticipants(), 'PANEL', { maxArguments: 1 });

  engine.submitArgument('expert-1', { debateId: debate.id, body: 'First argument.' });
  assert.throws(
    () => engine.submitArgument('expert-1', { debateId: debate.id, body: 'Second argument.' }),
    /maximum argument count/
  );
});

test('submitArgument throws for non-participant', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Topic', oxfordParticipants(), 'OXFORD');

  assert.throws(
    () => engine.submitArgument('outsider', { debateId: debate.id, body: 'Intruder argument.' }),
    /not a participant/
  );
});

test('submitArgument throws when debate is closed', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Topic', oxfordParticipants(), 'OXFORD');
  engine.closeDebate(debate.id);

  assert.throws(
    () => engine.submitArgument('agent-proposer', { debateId: debate.id, body: 'Late.' }),
    /cannot accept new submissions/
  );
});

// ---- submitRebuttal ----

test('submitRebuttal counters a specific argument', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Topic', oxfordParticipants(), 'OXFORD');

  // Submit an argument during opening
  const arg = engine.submitArgument('agent-proposer', { debateId: debate.id, body: 'Proposal argument.' });

  // Advance to rebuttals phase
  engine.advancePhase(debate.id);  // opening -> arguments
  engine.advancePhase(debate.id);  // arguments -> rebuttals

  const rebuttal = engine.submitRebuttal('agent-opposer', arg.id, {
    debateId: debate.id,
    body: 'This proposal is flawed because it ignores key constraints.',
  });

  assert.ok(rebuttal.id.startsWith(`${debate.id}-reb-`));
  assert.equal(rebuttal.targetArgumentId, arg.id);
  assert.equal(rebuttal.agentId, 'agent-opposer');
  assert.equal(rebuttal.phase, 'rebuttals');
});

test('submitRebuttal throws when target argument does not exist', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Topic', oxfordParticipants(), 'OXFORD');

  engine.advancePhase(debate.id);
  engine.advancePhase(debate.id);

  assert.throws(
    () => engine.submitRebuttal('agent-opposer', 'nonexistent-id', { debateId: debate.id, body: 'Rebuttal.' }),
    /Unknown argument/
  );
});

test('submitRebuttal throws when not in rebuttals phase', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Topic', oxfordParticipants(), 'OXFORD');

  const arg = engine.submitArgument('agent-proposer', { debateId: debate.id, body: 'Arg.' });

  assert.throws(
    () => engine.submitRebuttal('agent-opposer', arg.id, { debateId: debate.id, body: 'Too early.' }),
    /expected one of/
  );
});

// ---- submitEvidence ----

test('submitEvidence stores evidence and links to arguments', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Topic', panelParticipants(), 'PANEL');

  const arg = engine.submitArgument('expert-1', { debateId: debate.id, body: 'Argument with evidence support.' });

  const evidence = engine.submitEvidence('expert-2', {
    debateId: debate.id,
    content: 'Empirical data from 2024 benchmark study.',
    source: 'Journal of AI Research, 2024',
    linkedArgumentIds: [arg.id],
  });

  assert.ok(evidence.id.startsWith(`${debate.id}-ev-`));
  assert.equal(evidence.submitterId, 'expert-2');
  assert.equal(evidence.source, 'Journal of AI Research, 2024');
  assert.deepEqual(evidence.linkedArgumentIds, [arg.id]);

  // Check that the evidence was linked to the argument
  const state = engine.getDebateState(debate.id);
  const updatedArg = state.arguments.find((a) => a.id === arg.id);
  assert.ok(updatedArg.evidenceIds.includes(evidence.id));
});

test('submitEvidence throws for invalid linked argument', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Topic', oxfordParticipants(), 'OXFORD');

  assert.throws(
    () => engine.submitEvidence('agent-proposer', {
      debateId: debate.id,
      content: 'Fake evidence.',
      linkedArgumentIds: ['nonexistent'],
    }),
    /Unknown argument for evidence linkage/
  );
});

// ---- advancePhase ----

test('advancePhase moves through all phases in order', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Topic', oxfordParticipants(), 'OXFORD');

  assert.equal(debate.currentPhase, 'opening');

  engine.advancePhase(debate.id);
  assert.equal(engine.getDebateState(debate.id).currentPhase, 'arguments');

  engine.advancePhase(debate.id);
  assert.equal(engine.getDebateState(debate.id).currentPhase, 'rebuttals');

  engine.advancePhase(debate.id);
  assert.equal(engine.getDebateState(debate.id).currentPhase, 'deliberation');

  engine.advancePhase(debate.id);
  assert.equal(engine.getDebateState(debate.id).currentPhase, 'verdict');

  // Already at final phase
  assert.throws(() => engine.advancePhase(debate.id), /final phase/);
});

// ---- closeDebate ----

test('closeDebate produces a verdict with rankings', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Best approach?', panelParticipants(), 'PANEL');

  engine.submitArgument('expert-1', {
    debateId: debate.id,
    body: 'Research shows supervised fine-tuning is most effective according to multiple studies.',
    scores: { evidence: 8, logic: 7, relevance: 8, clarity: 7 },
  });
  engine.submitArgument('expert-2', {
    debateId: debate.id,
    body: 'RLHF provides better alignment according to empirical data.',
    scores: { evidence: 9, logic: 8, relevance: 8, clarity: 8 },
  });
  engine.submitArgument('expert-3', {
    debateId: debate.id,
    body: 'Constitutional AI is the safest approach.',
    scores: { evidence: 6, logic: 7, relevance: 7, clarity: 6 },
  });

  const closed = engine.closeDebate(debate.id);
  assert.equal(closed.state, DEBATE_STATE.closed);
  assert.ok(closed.verdict !== null);
  assert.equal(closed.verdict.totalArguments, 3);
  assert.ok(Array.isArray(closed.verdict.rankings));
  assert.equal(closed.verdict.rankings.length, 3);
  assert.ok(closed.closedAt !== null);
});

test('closeDebate accepts explicit verdict text', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Topic', oxfordParticipants(), 'OXFORD');

  engine.submitArgument('agent-proposer', {
    debateId: debate.id,
    body: 'Pro side argument with empirical evidence and logical reasoning.',
  });

  const closed = engine.closeDebate(debate.id, {
    verdict: 'The proposer wins based on stronger evidence and logic.',
    winningAgentId: 'agent-proposer',
  });

  assert.equal(closed.verdict.ruling, 'The proposer wins based on stronger evidence and logic.');
  assert.equal(closed.verdict.winner, 'agent-proposer');
});

test('closeDebate handles no arguments gracefully', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Topic', oxfordParticipants(), 'OXFORD');
  const closed = engine.closeDebate(debate.id);

  assert.equal(closed.verdict.totalArguments, 0);
  assert.equal(closed.verdict.rankings.length, 0);
});

// ---- cancelDebate ----

test('cancelDebate sets state to cancelled', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Topic', oxfordParticipants(), 'OXFORD');

  const cancelled = engine.cancelDebate(debate.id, 'Participants withdrew.');
  assert.equal(cancelled.state, DEBATE_STATE.cancelled);
  assert.ok(cancelled.closedAt !== null);
});

// ---- getDebateState ----

test('getDebateState returns full debate state', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Topic', panelParticipants(), 'PANEL');

  engine.submitArgument('expert-1', { debateId: debate.id, body: 'Argument content.' });
  engine.submitEvidence('expert-2', { debateId: debate.id, content: 'Evidence content.' });

  const state = engine.getDebateState(debate.id);
  assert.equal(state.id, debate.id);
  assert.equal(state.arguments.length, 1);
  assert.equal(state.evidence.length, 1);
  assert.ok(Array.isArray(state.events));
  assert.ok(state.events.length > 0);
});

test('getDebateState throws for unknown debate', () => {
  const engine = new DebateEngine();
  assert.throws(() => engine.getDebateState('nonexistent'), /Unknown debate/);
});

// ---- listDebates ----

test('listDebates returns all debate IDs by default', () => {
  const engine = new DebateEngine();
  engine.startDebate('Topic 1', oxfordParticipants(), 'OXFORD');
  engine.startDebate('Topic 2', panelParticipants(), 'PANEL');

  const ids = engine.listDebates();
  assert.equal(ids.length, 2);
});

test('listDebates filters by state', () => {
  const engine = new DebateEngine();
  const d1 = engine.startDebate('Topic 1', oxfordParticipants(), 'OXFORD');
  const d2 = engine.startDebate('Topic 2', panelParticipants(), 'PANEL');
  engine.closeDebate(d1.id);

  const active = engine.listDebates(DEBATE_STATE.active);
  assert.equal(active.length, 1);
  assert.equal(active[0], d2.id);

  const closed = engine.listDebates(DEBATE_STATE.closed);
  assert.equal(closed.length, 1);
  assert.equal(closed[0], d1.id);
});

// ---- custom scorer ----

test('DebateEngine uses custom scorer when injected', () => {
  const customScorer = new ArgumentScorer({ weights: { evidence: 0.4, logic: 0.4, relevance: 0.1, clarity: 0.1 } });
  const engine = new DebateEngine({ scorer: customScorer });

  assert.equal(engine.scorer, customScorer);
});

// ---- multi-format debates ----

test('startDebate supports ROUND_ROBIN format', () => {
  const engine = new DebateEngine();
  const debate = engine.startDebate('Which framework is best?', roundRobinParticipants(), 'ROUND_ROBIN');
  assert.equal(debate.format.id, 'ROUND_ROBIN');
  assert.equal(debate.participants.length, 3);
});

test('startDebate supports SOCRATIC format', () => {
  const engine = new DebateEngine();
  const participants = [
    { agentId: 'q1', role: 'questioner' },
    { agentId: 'r1', role: 'respondent' },
  ];
  const debate = engine.startDebate('What is the nature of intelligence?', participants, 'SOCRATIC');
  assert.equal(debate.format.id, 'SOCRATIC');
  assert.equal(debate.format.rules.collaborativeTruthSeeking, true);
});
