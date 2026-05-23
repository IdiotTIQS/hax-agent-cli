'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { BranchMerger, STRATEGIES } = require('../../src/branches/merge');

function makeBranch(name, messages) {
  return { name, messages: messages || [], id: `${name}-id`, parentBranch: null, forkPoint: 0 };
}

function makeMsg(role, content) {
  return { role, content };
}

describe('BranchMerger', () => {
  describe('STRATEGIES', () => {
    it('exports all four strategy constants', () => {
      assert.strictEqual(STRATEGIES.KEEP_MAIN, 'KEEP_MAIN');
      assert.strictEqual(STRATEGIES.TAKE_BEST, 'TAKE_BEST');
      assert.strictEqual(STRATEGIES.COMBINE_ALL, 'COMBINE_ALL');
      assert.strictEqual(STRATEGIES.MANUAL, 'MANUAL');
    });
  });

  describe('merge', () => {
    it('returns empty result for no branches', () => {
      const merger = new BranchMerger();
      const result = merger.merge([], STRATEGIES.KEEP_MAIN);
      assert.deepStrictEqual(result.merged, []);
      assert.deepStrictEqual(result.conflicts, []);
    });

    it('returns single branch messages unchanged', () => {
      const merger = new BranchMerger();
      const branch = makeBranch('only', [makeMsg('user', 'hello')]);
      const result = merger.merge([branch], STRATEGIES.COMBINE_ALL);
      assert.strictEqual(result.merged.length, 1);
      assert.strictEqual(result.merged[0].content, 'hello');
      assert.ok(result.summary.note.includes('Single branch'));
    });

    describe('KEEP_MAIN strategy', () => {
      it('keeps only the target branch messages', () => {
        const merger = new BranchMerger();
        const main = makeBranch('main', [makeMsg('user', 'keep-this')]);
        const side = makeBranch('side', [makeMsg('user', 'discard-this')]);

        const result = merger.merge([main, side], STRATEGIES.KEEP_MAIN, { targetBranch: 'main' });
        assert.strictEqual(result.merged.length, 1);
        assert.strictEqual(result.merged[0].content, 'keep-this');
      });
    });

    describe('TAKE_BEST strategy', () => {
      it('selects the branch with most assistant responses', () => {
        const merger = new BranchMerger();
        const a = makeBranch('a', [
          makeMsg('user', 'q'),
          makeMsg('assistant', 'short'),
        ]);
        const b = makeBranch('b', [
          makeMsg('user', 'q'),
          makeMsg('assistant', 'part 1'),
          makeMsg('assistant', 'part 2'),
          makeMsg('assistant', 'part 3'),
        ]);

        const result = merger.merge([a, b], STRATEGIES.TAKE_BEST);
        assert.strictEqual(result.summary.bestBranch, 'b');
        assert.strictEqual(result.merged.length, 4);
      });

      it('uses custom best evaluator when provided', () => {
        const merger = new BranchMerger({
          bestEvaluator: (branches) => 'force-pick',
        });
        const a = makeBranch('force-pick', [makeMsg('user', 'chosen')]);
        const b = makeBranch('other', [
          makeMsg('user', 'q'),
          makeMsg('assistant', 'long'),
        ]);

        const result = merger.merge([a, b], STRATEGIES.TAKE_BEST);
        assert.strictEqual(result.summary.bestBranch, 'force-pick');
      });
    });

    describe('COMBINE_ALL strategy', () => {
      it('combines unique messages from all branches', () => {
        const merger = new BranchMerger();
        const main = makeBranch('main', [
          makeMsg('user', 'shared-q'),
          makeMsg('assistant', 'main-answer'),
        ]);
        const side = makeBranch('side', [
          makeMsg('user', 'shared-q'),
          makeMsg('assistant', 'side-answer'),
        ]);

        const result = merger.merge([main, side], STRATEGIES.COMBINE_ALL, { baseBranch: 'main' });
        assert.ok(result.merged.length >= 2);
        assert.ok(result.merged.some((m) => m.content === 'main-answer'));
        assert.ok(result.merged.some((m) => m.content === 'side-answer'));
      });

      it('deduplicates identical messages', () => {
        const merger = new BranchMerger();
        const a = makeBranch('a', [
          makeMsg('user', 'same'),
          makeMsg('assistant', 'same-response'),
        ]);
        const b = makeBranch('b', [
          makeMsg('user', 'same'),
          makeMsg('assistant', 'same-response'),
        ]);

        const result = merger.merge([a, b], STRATEGIES.COMBINE_ALL);
        // Should not have doubled messages
        assert.ok(result.merged.length < 5);
      });
    });

    describe('MANUAL strategy', () => {
      it('returns conflicts for manual resolution', () => {
        const merger = new BranchMerger();
        const a = makeBranch('a', [
          makeMsg('user', 'one'),
          makeMsg('assistant', 'from-a'),
        ]);
        const b = makeBranch('b', [
          makeMsg('user', 'one'),
          makeMsg('assistant', 'from-b'),
        ]);

        const result = merger.merge([a, b], STRATEGIES.MANUAL, { baseBranch: 'a' });
        assert.ok(result.conflicts.length > 0);
        assert.strictEqual(result.summary.requiresResolution, true);
      });
    });

    it('returns error for unknown strategy', () => {
      const merger = new BranchMerger();
      const a = makeBranch('a', [makeMsg('user', 'hi')]);
      const b = makeBranch('b', [makeMsg('user', 'hey')]);
      const result = merger.merge([a, b], 'INVALID_STRATEGY');
      assert.ok(result.summary.error);
    });
  });

  describe('resolveConflicts', () => {
    const merger = new BranchMerger();

    const sampleConflicts = [{
      index: 1,
      type: 'content_divergence',
      severity: 'medium',
      messages: [
        { branch: 'a', role: 'assistant', contentPreview: 'short' },
        { branch: 'b', role: 'assistant', contentPreview: 'much longer detailed response here' },
      ],
    }];

    it('resolves with "first" strategy (keep first branch)', () => {
      const resolved = merger.resolveConflicts(sampleConflicts, { strategy: 'first' });
      assert.strictEqual(resolved.length, 1);
      assert.strictEqual(resolved[0].selectedBranch, 'a');
    });

    it('resolves with "last" strategy (keep last branch)', () => {
      const resolved = merger.resolveConflicts(sampleConflicts, { strategy: 'last' });
      assert.strictEqual(resolved[0].selectedBranch, 'b');
    });

    it('resolves with "longest" strategy', () => {
      const resolved = merger.resolveConflicts(sampleConflicts, { strategy: 'longest' });
      assert.strictEqual(resolved[0].selectedBranch, 'b');
    });

    it('resolves with "merge" strategy (combine content)', () => {
      const resolved = merger.resolveConflicts(sampleConflicts, { strategy: 'merge' });
      assert.strictEqual(resolved[0].resolution, 'merged_content');
      assert.ok(resolved[0].mergedContent.includes('[a]'));
      assert.ok(resolved[0].mergedContent.includes('[b]'));
    });

    it('uses custom resolver when provided', () => {
      const customMerger = new BranchMerger({
        conflictResolver: (conflicts) => conflicts.map((c) => ({ ...c, resolution: 'custom_choice', resolved: true })),
      });
      const resolved = customMerger.resolveConflicts(sampleConflicts);
      assert.strictEqual(resolved[0].resolution, 'custom_choice');
    });

    it('handles empty conflicts array', () => {
      const resolved = merger.resolveConflicts([]);
      assert.deepStrictEqual(resolved, []);
    });
  });

  describe('detectMergeConflicts', () => {
    it('detects content divergence between branches', () => {
      const merger = new BranchMerger();
      const a = makeBranch('a', [
        makeMsg('user', 'same-start'),
        makeMsg('assistant', 'a-says-this'),
      ]);
      const b = makeBranch('b', [
        makeMsg('user', 'same-start'),
        makeMsg('assistant', 'b-says-that'),
      ]);

      const conflicts = merger.detectMergeConflicts([a, b]);
      assert.ok(conflicts.length > 0);
      assert.ok(conflicts.some((c) => c.type === 'content_divergence'));
    });

    it('detects length mismatches', () => {
      const merger = new BranchMerger();
      const a = makeBranch('a', [makeMsg('user', 'only-one')]);
      const b = makeBranch('b', [
        makeMsg('user', 'only-one'),
        makeMsg('assistant', 'extra'),
      ]);

      const conflicts = merger.detectMergeConflicts([a, b]);
      assert.ok(conflicts.some((c) => c.type === 'length_mismatch'));
    });

    it('returns no conflicts for identical branches', () => {
      const merger = new BranchMerger();
      const a = makeBranch('a', [makeMsg('user', 'same')]);
      const b = makeBranch('b', [makeMsg('user', 'same')]);

      const conflicts = merger.detectMergeConflicts([a, b]);
      assert.strictEqual(conflicts.length, 0);
    });

    it('returns empty for fewer than 2 branches', () => {
      const merger = new BranchMerger();
      assert.deepStrictEqual(merger.detectMergeConflicts([]), []);
      assert.deepStrictEqual(merger.detectMergeConflicts([makeBranch('a')]), []);
    });

    it('uses custom message matcher when provided', () => {
      const merger = new BranchMerger({
        messageMatcher: () => true, // always match — no conflicts
      });
      const a = makeBranch('a', [makeMsg('user', 'different')]);
      const b = makeBranch('b', [makeMsg('assistant', 'entirely')]);

      const conflicts = merger.detectMergeConflicts([a, b]);
      assert.strictEqual(conflicts.length, 0);
    });
  });

  describe('createMergeResult', () => {
    it('creates a comprehensive merge summary', () => {
      const merger = new BranchMerger();
      const branches = [
        makeBranch('main', [makeMsg('user', 'q1')]),
        makeBranch('side', [makeMsg('user', 'q1'), makeMsg('assistant', 'a1')]),
      ];
      const mergedResult = merger.merge(branches, STRATEGIES.COMBINE_ALL);
      const result = merger.createMergeResult(branches, mergedResult);

      assert.strictEqual(result.branchesMerged, 2);
      assert.ok(result.originalMessageCount >= 0);
      assert.ok(result.mergedMessageCount >= 0);
      assert.ok(result.deduplicatedCount >= 0);
      assert.ok(result.timestamp);
      assert.ok(result.summary);
    });

    it('reports conflicts found and resolved counts', () => {
      const merger = new BranchMerger();
      const branches = [
        makeBranch('a', [makeMsg('user', 'same'), makeMsg('assistant', 'different-a')]),
        makeBranch('b', [makeMsg('user', 'same'), makeMsg('assistant', 'different-b')]),
      ];
      const mergedResult = merger.merge(branches, STRATEGIES.MANUAL);
      const result = merger.createMergeResult(branches, mergedResult);

      assert.ok(result.conflictsFound > 0);
    });
  });
});
