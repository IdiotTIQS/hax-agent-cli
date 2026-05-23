'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { BranchComparison } = require('../../src/branches/comparison');

function makeBranch(name, messages) {
  return { name, messages: messages || [], id: `${name}-id`, parentBranch: null, forkPoint: 0 };
}

function makeMsg(role, content, extra = {}) {
  return { role, content, ...extra };
}

describe('BranchComparison', () => {
  describe('compare', () => {
    it('compares two branches and returns structured result', () => {
      const bc = new BranchComparison();
      const a = makeBranch('a', [
        makeMsg('user', 'hello'),
        makeMsg('assistant', 'hi there'),
      ]);
      const b = makeBranch('b', [
        makeMsg('user', 'hello'),
        makeMsg('assistant', 'greetings friend'),
      ]);

      const result = bc.compare(a, b);
      assert.strictEqual(result.branches[0], 'a');
      assert.strictEqual(result.branches[1], 'b');
      assert.ok(result.messageComparison);
      assert.ok(result.qualityComparison);
      assert.ok(result.efficiencyComparison);
      assert.ok(typeof result.summary === 'string');
    });

    it('detects identical branches', () => {
      const bc = new BranchComparison();
      const a = makeBranch('a', [makeMsg('user', 'same')]);
      const b = makeBranch('b', [makeMsg('user', 'same')]);

      const result = bc.compare(a, b);
      assert.strictEqual(result.messageComparison.overlapPercent, 100);
      assert.strictEqual(result.messageComparison.firstDivergenceIndex, -1);
    });

    it('detects divergence point', () => {
      const bc = new BranchComparison();
      const a = makeBranch('a', [
        makeMsg('user', 'one'),
        makeMsg('assistant', 'two'),
        makeMsg('user', 'three-a'),
      ]);
      const b = makeBranch('b', [
        makeMsg('user', 'one'),
        makeMsg('assistant', 'two'),
        makeMsg('user', 'three-b'),
      ]);

      const result = bc.compare(a, b);
      assert.strictEqual(result.messageComparison.firstDivergenceIndex, 2);
    });
  });

  describe('compareResults', () => {
    it('returns insufficient data for fewer than 2 branches', () => {
      const bc = new BranchComparison();
      const result = bc.compareResults([]);
      assert.strictEqual(result.result, 'insufficient data');
      assert.strictEqual(result.winner, null);

      const single = bc.compareResults([makeBranch('only', [makeMsg('user', 'hi')])]);
      assert.strictEqual(single.result, 'insufficient data');
    });

    it('selects a winner based on content completeness', () => {
      const bc = new BranchComparison();
      const a = makeBranch('a', [
        makeMsg('user', 'question'),
        makeMsg('assistant', 'short'),
      ]);
      const b = makeBranch('b', [
        makeMsg('user', 'question'),
        makeMsg('assistant', 'much longer and more detailed response with real substance'),
      ]);

      const result = bc.compareResults([a, b]);
      assert.ok(result.winner);
      assert.ok(result.scores.length === 2);
      assert.ok(result.comparisonTable);
    });

    it('returns comparison table for all branches', () => {
      const bc = new BranchComparison();
      const branches = [
        makeBranch('x', [makeMsg('user', 'q'), makeMsg('assistant', 'ans')]),
        makeBranch('y', [makeMsg('user', 'q'), makeMsg('assistant', 'answer'), makeMsg('user', 'follow')]),
        makeBranch('z', [makeMsg('user', 'q')]),
      ];

      const result = bc.compareResults(branches);
      assert.ok(result.comparisonTable.x);
      assert.ok(result.comparisonTable.y);
      assert.ok(result.comparisonTable.z);
      assert.ok(result.comparisonTable.x.messageCount >= 0);
    });
  });

  describe('compareQuality', () => {
    it('evaluates quality metrics', () => {
      const bc = new BranchComparison();
      const a = makeBranch('a', [
        makeMsg('user', 'question'),
        makeMsg('assistant', ''),
        makeMsg('assistant', 'detailed response that covers the topic well'),
      ]);
      const b = makeBranch('b', [
        makeMsg('user', 'question'),
        makeMsg('assistant', 'brief'),
      ]);

      const result = bc.compareQuality([a, b]);
      assert.ok(result.best);
      assert.ok(result.metrics.length === 2);
      assert.ok('depth' in result.metrics[0]);
      assert.ok('completeness' in result.metrics[0]);
      assert.ok('coherence' in result.metrics[0]);
      assert.ok('overall' in result.metrics[0]);
    });

    it('returns insufficient data for single branch', () => {
      const bc = new BranchComparison();
      const result = bc.compareQuality([makeBranch('a')]);
      assert.strictEqual(result.result, 'insufficient data');
    });
  });

  describe('compareEfficiency', () => {
    it('compares efficiency across branches', () => {
      const bc = new BranchComparison();
      const a = makeBranch('a', [
        makeMsg('user', 'hello', { usage: { input_tokens: 100, output_tokens: 50 } }),
        makeMsg('assistant', 'world'),
      ]);
      const b = makeBranch('b', [
        makeMsg('user', 'hello', { usage: { input_tokens: 100, output_tokens: 200 } }),
        makeMsg('assistant', 'a much longer response here'),
      ]);

      const result = bc.compareEfficiency([a, b]);
      assert.ok(result.branches.length === 2);
      assert.ok(result.metrics.length === 2);
      assert.ok(result.summary.mostTokenEfficient);
      assert.ok(result.summary.fewestToolCalls);
      assert.ok(result.summary.lowestTokens);
    });

    it('handles branches with tool calls in efficiency', () => {
      const bc = new BranchComparison();
      const a = makeBranch('a', [
        makeMsg('user', 'run'),
        makeMsg('assistant', '', { tool_calls: [{ id: '1', name: 'read' }] }),
        makeMsg('assistant', 'done'),
      ]);
      const b = makeBranch('b', [
        makeMsg('user', 'run'),
        makeMsg('assistant', 'just talk'),
      ]);

      const result = bc.compareEfficiency([a, b]);
      assert.ok(result.metrics.find((m) => m.name === 'a').toolCalls >= 1);
      assert.ok(result.metrics.find((m) => m.name === 'b').toolCalls >= 0);
    });
  });

  describe('bestBy', () => {
    it('finds best by message count', () => {
      const bc = new BranchComparison();
      const a = makeBranch('a', [makeMsg('user', 'a'), makeMsg('assistant', 'b')]);
      const b = makeBranch('b', [makeMsg('user', 'x'), makeMsg('assistant', 'y'), makeMsg('user', 'z')]);

      const result = bc.bestBy([a, b], 'messageCount');
      assert.strictEqual(result.branch.name, 'b');
      assert.strictEqual(result.value, 3);
    });

    it('finds fewest tokens (lowest is best)', () => {
      const bc = new BranchComparison();
      const a = makeBranch('a', [
        makeMsg('user', 'hi', { usage: { input_tokens: 10, output_tokens: 5 } }),
      ]);
      const b = makeBranch('b', [
        makeMsg('user', 'long question here', { usage: { input_tokens: 100, output_tokens: 50 } }),
      ]);

      const result = bc.bestBy([a, b], 'tokenCount');
      assert.strictEqual(result.branch.name, 'a');
    });

    it('returns error for unknown metric', () => {
      const bc = new BranchComparison();
      const result = bc.bestBy([makeBranch('a')], 'unknownMetric');
      assert.ok(result.reason.includes('Unknown metric'));
    });

    it('handles empty branches array', () => {
      const bc = new BranchComparison();
      const result = bc.bestBy([], 'messageCount');
      assert.strictEqual(result.branch, null);
      assert.ok(result.reason.includes('No branches'));
    });
  });

  describe('highlightDifferences', () => {
    it('identifies divergence points', () => {
      const bc = new BranchComparison();
      const a = makeBranch('a', [
        makeMsg('user', 'shared'),
        makeMsg('assistant', 'only-in-a'),
      ]);
      const b = makeBranch('b', [
        makeMsg('user', 'shared'),
        makeMsg('assistant', 'only-in-b'),
      ]);
      const c = makeBranch('c', [
        makeMsg('user', 'shared'),
        makeMsg('assistant', 'only-in-c'),
      ]);

      const result = bc.highlightDifferences([a, b, c]);
      assert.ok(result.divergences.length > 0);
      assert.ok(result.totalDivergences > 0);
    });

    it('detects length discrepancies', () => {
      const bc = new BranchComparison();
      const a = makeBranch('a', [
        makeMsg('user', 'one'),
        makeMsg('assistant', 'two'),
      ]);
      const b = makeBranch('b', [
        makeMsg('user', 'one'),
        makeMsg('assistant', 'two'),
        makeMsg('user', 'three'),
      ]);

      const result = bc.highlightDifferences([a, b]);
      assert.strictEqual(result.lengthDiscrepancy, true);
    });

    it('returns empty divergences for identical branches', () => {
      const bc = new BranchComparison();
      const a = makeBranch('a', [makeMsg('user', 'same')]);
      const b = makeBranch('b', [makeMsg('user', 'same')]);

      const result = bc.highlightDifferences([a, b]);
      assert.strictEqual(result.totalDivergences, 0);
    });
  });
});
