"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CostTracker } = require("../src/engine/cost-tracker");
const { getCost } = require("../src/pricing");

test("fresh tracker has zero totals", () => {
  const t = new CostTracker();
  const s = t.summary;
  assert.equal(s.turns, 0);
  assert.equal(s.totalInput, 0);
  assert.equal(s.totalOutput, 0);
  assert.equal(s.totalCost, "0.000000");
});

test("recordTurn accumulates tokens and returns turn cost", () => {
  const t = new CostTracker();
  const cost = t.recordTurn("claude-sonnet-4-6", 1_000_000, 1_000_000);
  // Sonnet 4.6 = $3 in / $15 out per 1M
  assert.equal(cost, 18.0, "1M in + 1M out = $3 + $15 = $18");
  const s = t.summary;
  assert.equal(s.turns, 1);
  assert.equal(s.totalInput, 1_000_000);
  assert.equal(s.totalOutput, 1_000_000);
});

test("multiple turns sum into totalCost", () => {
  const t = new CostTracker();
  t.recordTurn("claude-sonnet-4-6", 1_000_000, 0); // $3
  t.recordTurn("claude-sonnet-4-6", 1_000_000, 0); // $3
  const s = t.summary;
  assert.equal(s.turns, 2);
  assert.equal(s.totalInput, 2_000_000);
  assert.equal(Number(s.totalCost), 6.0);
});

test("unknown model contributes zero cost but still records tokens", () => {
  const t = new CostTracker();
  const cost = t.recordTurn("totally-unknown-model-xyz", 1_000_000, 1_000_000);
  assert.equal(cost, 0, "unknown model has no pricing → 0 cost");
  assert.equal(t.summary.totalInput, 1_000_000, "tokens are still tracked");
});

test("recorded turn carries model, tokens and timestamp", () => {
  const t = new CostTracker();
  const before = Date.now();
  t.recordTurn("claude-haiku-4-5-20251001", 100, 200);
  const turn = t._turns[0];
  assert.equal(turn.model, "claude-haiku-4-5-20251001");
  assert.equal(turn.input, 100);
  assert.equal(turn.output, 200);
  assert.ok(turn.timestamp >= before);
});

test("tracker cost matches direct getCost computation", () => {
  const t = new CostTracker();
  const cost = t.recordTurn("claude-opus-4-7", 500_000, 250_000);
  assert.equal(cost, getCost("claude-opus-4-7", 500_000, 250_000));
});
