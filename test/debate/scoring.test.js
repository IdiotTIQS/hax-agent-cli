"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ArgumentScorer,
  DEFAULT_WEIGHTS,
  MAX_SCORE,
  MIN_SCORE,
  SCORING_DIMENSIONS,
} = require('../../src/debate/scoring');

// ---- scoreArgument ----

function makeArg(body, scores, evidenceItems) {
  const arg = { body };
  if (scores) arg.scores = scores;
  if (evidenceItems) arg.evidenceItems = evidenceItems;
  return arg;
}

test('scoreArgument returns all four dimensions and a composite', () => {
  const scorer = new ArgumentScorer();
  const result = scorer.scoreArgument(makeArg('The evidence clearly shows that this approach is superior because of documented research studies.'));
  assert.ok(typeof result.composite === 'number');
  assert.ok(result.composite >= MIN_SCORE && result.composite <= MAX_SCORE);
  assert.ok(result.dimensions.evidence >= MIN_SCORE && result.dimensions.evidence <= MAX_SCORE);
  assert.ok(result.dimensions.logic >= MIN_SCORE && result.dimensions.logic <= MAX_SCORE);
  assert.ok(result.dimensions.relevance >= MIN_SCORE && result.dimensions.relevance <= MAX_SCORE);
  assert.ok(result.dimensions.clarity >= MIN_SCORE && result.dimensions.clarity <= MAX_SCORE);
  assert.equal(typeof result.weights, 'object');
  assert.equal(typeof result.timestamp, 'string');
});

test('scoreArgument with explicit scores respects those values', () => {
  const scorer = new ArgumentScorer();
  const result = scorer.scoreArgument(makeArg('anything', {
    evidence: 10,
    logic: 0,
    relevance: 5,
    clarity: 7,
  }));
  assert.equal(result.dimensions.evidence, 10);
  assert.equal(result.dimensions.logic, 0);
  assert.equal(result.dimensions.relevance, 5);
  assert.equal(result.dimensions.clarity, 7);
});

test('scoreArgument clamps scores to 0-10 range', () => {
  const scorer = new ArgumentScorer();
  const result = scorer.scoreArgument(makeArg('text', {
    evidence: 15,
    logic: -5,
    relevance: 99,
    clarity: -1,
  }));
  assert.equal(result.dimensions.evidence, 10);
  assert.equal(result.dimensions.logic, 0);
  assert.equal(result.dimensions.relevance, 10);
  assert.equal(result.dimensions.clarity, 0);
});

test('scoreArgument boosts evidence when evidenceItems are attached', () => {
  const scorer = new ArgumentScorer();
  const noEvidence = scorer.scoreArgument(makeArg('basic argument', { evidence: 5, logic: 5, relevance: 5, clarity: 5 }));
  const withEvidence = scorer.scoreArgument(makeArg('basic argument', { evidence: 5, logic: 5, relevance: 5, clarity: 5 }, [{ id: 1 }, { id: 2 }, { id: 3 }]));
  assert.ok(withEvidence.dimensions.evidence > noEvidence.dimensions.evidence, 'evidence score should be boosted with evidence items');
});

test('scoreArgument with no body returns neutral heuristic scores', () => {
  const scorer = new ArgumentScorer();
  const result = scorer.scoreArgument(makeArg(''));
  assert.equal(result.dimensions.evidence, 5);
  assert.equal(result.dimensions.logic, 5);
  assert.equal(result.dimensions.relevance, 5);
  assert.equal(result.dimensions.clarity, 5);
});

test('scoreArgument throws for null/undefined argument', () => {
  const scorer = new ArgumentScorer();
  assert.throws(() => scorer.scoreArgument(null), /non-null object/);
  assert.throws(() => scorer.scoreArgument(undefined), /non-null object/);
});

test('scoreArgument detects evidence-related keywords', () => {
  const scorer = new ArgumentScorer();
  const rich = scorer.scoreArgument(makeArg('According to multiple studies and empirical research data, this approach has been proven effective through documented experimentation.'));
  const poor = scorer.scoreArgument(makeArg('This argument has no evidence and is completely unsubstantiated.'));
  assert.ok(rich.dimensions.evidence > poor.dimensions.evidence, 'evidence-rich text should score higher');
});

test('scoreArgument detects logic-related keywords', () => {
  const scorer = new ArgumentScorer();
  const logical = scorer.scoreArgument(makeArg('If the premise holds, then therefore the conclusion follows logically. Hence deduction leads to this result.'));
  const fallacious = scorer.scoreArgument(makeArg('This is a fallacy and contradicts itself, the reasoning is inconsistent.'));
  assert.ok(logical.dimensions.logic > fallacious.dimensions.logic, 'logical text should score higher than fallacious');
});

// ---- rankArguments ----

test('rankArguments returns array sorted by composite score descending', () => {
  const scorer = new ArgumentScorer();
  const args = [
    makeArg('short'),
    makeArg('comprehensive research study with documented empirical evidence and logical reasoning therefore the conclusion is sound and specifically relevant to the core issue', { evidence: 9, logic: 9, relevance: 9, clarity: 9 }),
    makeArg('medium text'),
  ];

  const ranked = scorer.rankArguments(args);
  assert.equal(ranked.length, 3);
  assert.ok(ranked[0].scoring.composite >= ranked[1].scoring.composite);
  assert.ok(ranked[1].scoring.composite >= ranked[2].scoring.composite);
  assert.equal(ranked[0].rank, 1);
  assert.equal(typeof ranked[0].originalIndex, 'number');
});

test('rankArguments handles ties with same rank', () => {
  const scorer = new ArgumentScorer();
  const args = [
    makeArg('a', { evidence: 5, logic: 5, relevance: 5, clarity: 5 }),
    makeArg('b', { evidence: 5, logic: 5, relevance: 5, clarity: 5 }),
  ];

  const ranked = scorer.rankArguments(args);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 1);
  assert.equal(ranked[0].scoring.composite, ranked[1].scoring.composite);
});

test('rankArguments throws for non-array input', () => {
  const scorer = new ArgumentScorer();
  assert.throws(() => scorer.rankArguments('not-array'), /must be an array/);
});

// ---- determineWinner ----

test('determineWinner returns winner when one entry is clearly highest', () => {
  const scorer = new ArgumentScorer();
  const args = [
    makeArg('weak', { evidence: 2, logic: 2, relevance: 2, clarity: 2 }),
    makeArg('strong', { evidence: 9, logic: 9, relevance: 9, clarity: 9 }),
    makeArg('medium', { evidence: 5, logic: 5, relevance: 5, clarity: 5 }),
  ];
  const ranked = scorer.rankArguments(args);
  const result = scorer.determineWinner(ranked);

  assert.equal(result.isTie, false);
  assert.ok(result.winner !== null);
  assert.ok(result.runnerUp !== null);
  assert.equal(result.winner.scoring.composite, 9);
});

test('determineWinner detects ties', () => {
  const scorer = new ArgumentScorer();
  const args = [
    makeArg('a', { evidence: 8, logic: 8, relevance: 8, clarity: 8 }),
    makeArg('b', { evidence: 8, logic: 8, relevance: 8, clarity: 8 }),
  ];
  const ranked = scorer.rankArguments(args);
  const result = scorer.determineWinner(ranked);

  assert.equal(result.isTie, true);
  assert.equal(result.winner, null);
  assert.equal(result.tiedCount, 2);
});

test('determineWinner returns null winner for empty array', () => {
  const scorer = new ArgumentScorer();
  const result = scorer.determineWinner([]);
  assert.equal(result.winner, null);
  assert.equal(result.isTie, false);
});

// ---- weights ----

test('ArgumentScorer uses default weights', () => {
  const scorer = new ArgumentScorer();
  const w = scorer.weights;
  assert.equal(w.evidence, DEFAULT_WEIGHTS.evidence);
  assert.equal(w.logic, DEFAULT_WEIGHTS.logic);
  assert.equal(w.relevance, DEFAULT_WEIGHTS.relevance);
  assert.equal(w.clarity, DEFAULT_WEIGHTS.clarity);
});

test('ArgumentScorer accepts custom weights and normalizes them', () => {
  const scorer = new ArgumentScorer({
    weights: { evidence: 50, logic: 30, relevance: 15, clarity: 5 },
  });
  const w = scorer.weights;
  const sum = w.evidence + w.logic + w.relevance + w.clarity;
  assert.ok(Math.abs(sum - 1) < 0.01, `weights should sum to ~1, got ${sum}`);
  assert.ok(w.evidence > w.logic);
  assert.ok(w.logic > w.relevance);
});

test('setWeights updates and normalizes weights', () => {
  const scorer = new ArgumentScorer();
  scorer.setWeights({ evidence: 0.5, logic: 0.5, relevance: 0, clarity: 0 });
  const w = scorer.weights;
  const sum = w.evidence + w.logic + w.relevance + w.clarity;
  assert.ok(Math.abs(sum - 1) < 0.01);
  assert.ok(w.evidence > 0.4);
});

// ---- constants ----

test('SCORING_DIMENSIONS has the four expected keys', () => {
  assert.equal(SCORING_DIMENSIONS.evidence, 'evidence');
  assert.equal(SCORING_DIMENSIONS.logic, 'logic');
  assert.equal(SCORING_DIMENSIONS.relevance, 'relevance');
  assert.equal(SCORING_DIMENSIONS.clarity, 'clarity');
});
