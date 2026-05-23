"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEBATE_FORMAT_IDS,
  DEBATE_PHASES,
  OXFORD,
  ROUND_ROBIN,
  PANEL,
  FISHBOWL,
  SOCRATIC,
  FORMAT_MAP,
  resolveFormat,
  listFormats,
  getPhases,
  validateParticipants,
} = require('../../src/debate/formats');

// ---- resolveFormat ----

test('resolveFormat returns canonical definition for string ID', () => {
  const fmt = resolveFormat('OXFORD');
  assert.equal(fmt.id, 'OXFORD');
  assert.equal(fmt.name, 'Oxford Debate');
  assert.ok(Array.isArray(fmt.phases));
});

test('resolveFormat returns canonical definition for format object with id', () => {
  const fmt = resolveFormat(OXFORD);
  assert.equal(fmt.id, 'OXFORD');
});

test('resolveFormat throws for unknown format string', () => {
  assert.throws(() => resolveFormat('BOGUS'), /Unrecognized debate format/);
});

test('resolveFormat throws for null/undefined', () => {
  assert.throws(() => resolveFormat(null), /Unrecognized debate format/);
  assert.throws(() => resolveFormat(undefined), /Unrecognized debate format/);
});

test('resolveFormat accepts custom format objects with required fields', () => {
  const custom = {
    id: 'CUSTOM',
    name: 'Custom Format',
    phases: [{ phase: 'opening', name: 'Start', order: 1, timeLimitSec: 60, maxTurns: 1, description: 'desc' }],
    roles: [{ role: 'panelist', min: 1, max: 5, label: 'Speaker' }],
    rules: {},
  };
  const fmt = resolveFormat(custom);
  assert.equal(fmt.id, 'CUSTOM');
});

// ---- listFormats ----

test('listFormats returns all five format IDs', () => {
  const ids = listFormats();
  assert.equal(ids.length, 5);
  assert.ok(ids.includes('OXFORD'));
  assert.ok(ids.includes('ROUND_ROBIN'));
  assert.ok(ids.includes('PANEL'));
  assert.ok(ids.includes('FISHBOWL'));
  assert.ok(ids.includes('SOCRATIC'));
});

// ---- getPhases ----

test('getPhases returns phases sorted by order', () => {
  const phases = getPhases('OXFORD');
  assert.equal(phases.length, 5);
  assert.equal(phases[0].phase, DEBATE_PHASES.opening);
  assert.equal(phases[1].phase, DEBATE_PHASES.arguments);
  assert.equal(phases[2].phase, DEBATE_PHASES.rebuttals);
  assert.equal(phases[3].phase, DEBATE_PHASES.deliberation);
  assert.equal(phases[4].phase, DEBATE_PHASES.verdict);
});

// ---- FORMAT_MAP ----

test('FORMAT_MAP contains all five format definitions', () => {
  assert.equal(Object.keys(FORMAT_MAP).length, 5);
  assert.equal(FORMAT_MAP.OXFORD, OXFORD);
  assert.equal(FORMAT_MAP.ROUND_ROBIN, ROUND_ROBIN);
  assert.equal(FORMAT_MAP.PANEL, PANEL);
  assert.equal(FORMAT_MAP.FISHBOWL, FISHBOWL);
  assert.equal(FORMAT_MAP.SOCRATIC, SOCRATIC);
});

// ---- validateParticipants ----

test('validateParticipants passes with correct role counts', () => {
  const participants = [
    { agentId: 'agent1', role: 'proposer' },
    { agentId: 'agent2', role: 'opposer' },
    { agentId: 'agent3', role: 'moderator' },
  ];
  const result = validateParticipants('OXFORD', participants);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validateParticipants fails when required role is missing', () => {
  const participants = [
    { agentId: 'agent1', role: 'proposer' },
  ];
  const result = validateParticipants('OXFORD', participants);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('opposer')));
  assert.ok(result.errors.some((e) => e.includes('moderator')));
});

test('validateParticipants fails when too many of a role are assigned', () => {
  const participants = [
    { agentId: 'agent1', role: 'proposer' },
    { agentId: 'agent2', role: 'proposer' },
    { agentId: 'agent3', role: 'opposer' },
    { agentId: 'agent4', role: 'moderator' },
  ];
  const result = validateParticipants('OXFORD', participants);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('proposer')));
});

test('validateParticipants fails for empty participants array', () => {
  const result = validateParticipants('OXFORD', []);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('At least one participant')));
});

// ---- Format rules ----

test('OXFORD has required rules', () => {
  assert.equal(OXFORD.rules.mustAlternateTurns, true);
  assert.equal(OXFORD.rules.proposerGoesFirst, true);
  assert.equal(OXFORD.rules.evidenceRequired, true);
});

test('SOCRATIC has question-led rules', () => {
  assert.equal(SOCRATIC.rules.questionLed, true);
  assert.equal(SOCRATIC.rules.collaborativeTruthSeeking, true);
});

test('FISHBOWL has rotation rules', () => {
  assert.equal(typeof FISHBOWL.rules.innerCircleSize, 'number');
  assert.equal(typeof FISHBOWL.rules.rotationIntervalSec, 'number');
});
