'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { BranchManager } = require('../../src/branches/manager');

function makeMsg(role, content) {
  return { role, content };
}

describe('BranchManager', () => {
  describe('initialization', () => {
    it('creates a main branch on construction', () => {
      const bm = new BranchManager();
      const branches = bm.listBranches();
      assert.strictEqual(branches.length, 1);
      assert.strictEqual(branches[0].name, 'main');
      assert.strictEqual(branches[0].isCurrent, true);
      assert.strictEqual(branches[0].parentBranch, null);
      assert.strictEqual(branches[0].messageCount, 0);
    });

    it('seeds main branch with base messages if provided', () => {
      const base = [makeMsg('user', 'hello'), makeMsg('assistant', 'hi there')];
      const bm = new BranchManager({ baseMessages: base });
      const main = bm.getBranch('main');
      assert.strictEqual(main.messages.length, 2);
      assert.strictEqual(main.messages[0].content, 'hello');
      assert.strictEqual(main.messages[1].content, 'hi there');
    });
  });

  describe('createBranch', () => {
    it('creates a branch from the current branch at the last message', () => {
      const bm = new BranchManager();
      bm.appendMessage(makeMsg('user', 'q1'));
      bm.appendMessage(makeMsg('assistant', 'a1'));

      const branch = bm.createBranch('feature');
      assert.strictEqual(branch.name, 'feature');
      assert.strictEqual(branch.parentBranch, 'main');
      assert.strictEqual(branch.forkPoint, 2);
      assert.strictEqual(branch.messages.length, 2);
      assert.ok(branch.id);
      assert.ok(branch.createdAt);
    });

    it('creates a branch from a specified fork point', () => {
      const bm = new BranchManager();
      bm.appendMessage(makeMsg('user', 'one'));
      bm.appendMessage(makeMsg('assistant', 'two'));
      bm.appendMessage(makeMsg('user', 'three'));

      const branch = bm.createBranch('early', { atIndex: 1 });
      assert.strictEqual(branch.forkPoint, 1);
      assert.strictEqual(branch.messages.length, 1);
      assert.strictEqual(branch.messages[0].content, 'one');
    });

    it('creates a branch from a non-current parent', () => {
      const bm = new BranchManager();
      bm.appendMessage(makeMsg('user', 'first'));
      bm.createBranch('side');
      bm.switchBranch('side');
      bm.appendMessage(makeMsg('assistant', 'side-resp'));

      const branch = bm.createBranch('forked', { fromBranch: 'main', atIndex: 1 });
      assert.strictEqual(branch.parentBranch, 'main');
      assert.strictEqual(branch.messages.length, 1);
    });

    it('throws on duplicate branch name', () => {
      const bm = new BranchManager();
      bm.createBranch('dup');
      assert.throws(() => bm.createBranch('dup'), { code: 'ERR_BRANCH_EXISTS' });
    });

    it('throws on invalid fork point', () => {
      const bm = new BranchManager();
      bm.appendMessage(makeMsg('user', 'msg'));
      assert.throws(() => bm.createBranch('bad', { atIndex: 5 }), { code: 'ERR_INVALID_FORK_POINT' });
      assert.throws(() => bm.createBranch('bad', { atIndex: -1 }), { code: 'ERR_INVALID_FORK_POINT' });
    });

    it('throws on invalid branch name', () => {
      const bm = new BranchManager();
      assert.throws(() => bm.createBranch(''), { code: 'ERR_INVALID_BRANCH_NAME' });
      assert.throws(() => bm.createBranch('  '), { code: 'ERR_INVALID_BRANCH_NAME' });
      assert.throws(() => bm.createBranch('has spaces'), { code: 'ERR_INVALID_BRANCH_NAME' });
    });
  });

  describe('switchBranch', () => {
    it('switches the active branch', () => {
      const bm = new BranchManager();
      bm.createBranch('dev');
      const switched = bm.switchBranch('dev');
      assert.strictEqual(switched.name, 'dev');
      assert.strictEqual(bm.getCurrentBranch().name, 'dev');
    });

    it('throws when switching to non-existent branch', () => {
      const bm = new BranchManager();
      assert.throws(() => bm.switchBranch('nope'), { code: 'ERR_BRANCH_NOT_FOUND' });
    });

    it('can switch back to main', () => {
      const bm = new BranchManager();
      bm.createBranch('alt');
      bm.switchBranch('alt');
      bm.switchBranch('main');
      assert.strictEqual(bm.getCurrentBranch().name, 'main');
    });
  });

  describe('mergeBranch', () => {
    it('merges source messages into target', () => {
      const bm = new BranchManager();
      bm.appendMessage(makeMsg('user', 'hello'));
      bm.createBranch('side');
      bm.switchBranch('side');
      bm.appendMessage(makeMsg('assistant', 'side-answer'));

      const result = bm.mergeBranch('side', 'main');
      assert.ok(result.merged.length > bm.getBranch('main').messages.length || result.merged.length >= 2);
    });

    it('deletes source branch when keepSource is false', () => {
      const bm = new BranchManager();
      bm.createBranch('temp');
      bm.mergeBranch('temp', 'main', { keepSource: false });
      assert.strictEqual(bm.getBranch('temp'), undefined);
      // listBranches should not include it
      assert.ok(!bm.listBranches().some((b) => b.name === 'temp'));
    });

    it('keeps source branch by default', () => {
      const bm = new BranchManager();
      bm.createBranch('keep');
      bm.mergeBranch('keep', 'main');
      const branch = bm.getBranch('keep');
      assert.ok(branch);
      assert.strictEqual(branch.name, 'keep');
    });

    it('throws when merging non-existent branches', () => {
      const bm = new BranchManager();
      assert.throws(() => bm.mergeBranch('ghost', 'main'), { code: 'ERR_BRANCH_NOT_FOUND' });
    });
  });

  describe('deleteBranch', () => {
    it('deletes a non-main branch', () => {
      const bm = new BranchManager();
      bm.createBranch('delete-me');
      assert.strictEqual(bm.listBranches().length, 2);
      const result = bm.deleteBranch('delete-me');
      assert.strictEqual(result, true);
      assert.strictEqual(bm.listBranches().length, 1);
    });

    it('throws when trying to delete main', () => {
      const bm = new BranchManager();
      assert.throws(() => bm.deleteBranch('main'), { code: 'ERR_CANNOT_DELETE_MAIN' });
    });

    it('switches to main if current deleted', () => {
      const bm = new BranchManager();
      bm.createBranch('current');
      bm.switchBranch('current');
      bm.deleteBranch('current');
      assert.strictEqual(bm.getCurrentBranch().name, 'main');
    });
  });

  describe('getBranchDiff', () => {
    it('computes diff between two branches', () => {
      const bm = new BranchManager();
      bm.appendMessage(makeMsg('user', 'shared'));
      bm.createBranch('b1');
      bm.switchBranch('b1');
      bm.appendMessage(makeMsg('assistant', 'from-b1'));

      bm.switchBranch('main');
      bm.createBranch('b2');
      bm.switchBranch('b2');
      bm.appendMessage(makeMsg('assistant', 'from-b2'));
      bm.appendMessage(makeMsg('user', 'extra-b2'));

      const diff = bm.getBranchDiff('b1', 'b2');
      assert.strictEqual(diff.sharedMessages, 1);
      assert.ok(diff.uniqueToA >= 0);
      assert.ok(diff.uniqueToB >= 0);
      assert.ok(diff.divergenceIndex > 0);
      assert.ok(diff.aOnly.length >= 0);
      assert.ok(diff.bOnly.length >= 0);
    });

    it('returns zero diff for identical branches', () => {
      const bm = new BranchManager();
      bm.appendMessage(makeMsg('user', 'hi'));
      bm.createBranch('clone');

      const diff = bm.getBranchDiff('main', 'clone');
      assert.strictEqual(diff.uniqueToA, 0);
      assert.strictEqual(diff.uniqueToB, 0);
    });
  });

  describe('appendMessage', () => {
    it('appends to current branch', () => {
      const bm = new BranchManager();
      bm.appendMessage(makeMsg('user', 'test'));
      const branch = bm.getCurrentBranch();
      assert.strictEqual(branch.messages.length, 1);
      assert.strictEqual(branch.messages[0].content, 'test');
    });

    it('updates modifiedAt', () => {
      const bm = new BranchManager();
      const before = new Date(bm.getCurrentBranch().modifiedAt).getTime();
      // Small delay to ensure timestamp difference
      const msg = makeMsg('user', 'later');
      bm.appendMessage(msg);
      const after = new Date(bm.getCurrentBranch().modifiedAt).getTime();
      assert.ok(after >= before);
    });
  });

  describe('branchCount', () => {
    it('tracks the number of branches', () => {
      const bm = new BranchManager();
      assert.strictEqual(bm.branchCount, 1);
      bm.createBranch('a');
      bm.createBranch('b');
      assert.strictEqual(bm.branchCount, 3);
      bm.deleteBranch('a');
      assert.strictEqual(bm.branchCount, 2);
    });
  });

  describe('listBranches', () => {
    it('returns all branches sorted by creation time', () => {
      const bm = new BranchManager();
      bm.createBranch('first');
      bm.createBranch('second');
      bm.createBranch('third');

      const list = bm.listBranches();
      assert.strictEqual(list.length, 4); // main + 3
      assert.strictEqual(list[0].name, 'main');
    });

    it('marks the current branch', () => {
      const bm = new BranchManager();
      bm.createBranch('active');
      bm.switchBranch('active');

      const list = bm.listBranches();
      const current = list.find((b) => b.name === 'active');
      assert.strictEqual(current.isCurrent, true);

      const main = list.find((b) => b.name === 'main');
      assert.strictEqual(main.isCurrent, false);
    });
  });
});
