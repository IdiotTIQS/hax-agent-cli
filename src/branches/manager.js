'use strict';

const crypto = require('crypto');

/**
 * Represents a single conversation branch.
 * @typedef {Object} Branch
 * @property {string} id - Unique branch ID
 * @property {string} name - Human-readable branch name
 * @property {string|null} parentBranch - ID of the parent branch (null for main)
 * @property {number} forkPoint - Message index in parent where fork occurred
 * @property {Array} messages - Array of message objects on this branch
 * @property {string} createdAt - ISO timestamp of branch creation
 */

const ERR_INVALID_NAME = 'ERR_INVALID_BRANCH_NAME';
const ERR_BRANCH_NOT_FOUND = 'ERR_BRANCH_NOT_FOUND';
const ERR_CANNOT_DELETE_MAIN = 'ERR_CANNOT_DELETE_MAIN';
const ERR_BRANCH_EXISTS = 'ERR_BRANCH_EXISTS';
const ERR_INVALID_FORK_POINT = 'ERR_INVALID_FORK_POINT';

class BranchManager {
  constructor(options = {}) {
    this._branches = new Map();
    this._currentBranch = null;
    this._baseMessages = options.baseMessages || [];

    this._initMainBranch(options.baseMessages);
  }

  // ------------------------------------------------------------------ public API

  /**
   * Create a new branch forking from a given point in an existing branch.
   * @param {string} name - Unique branch name
   * @param {Object} [opts]
   * @param {string} [opts.fromBranch] - Parent branch name (defaults to current)
   * @param {number} [opts.atIndex] - Message index in parent to fork at
   * @returns {Branch} The newly created branch
   */
  createBranch(name, opts = {}) {
    this._validateBranchName(name);

    if (this._branches.has(name)) {
      throw Object.assign(new Error(`Branch "${name}" already exists`), { code: ERR_BRANCH_EXISTS });
    }

    const parentName = opts.fromBranch || this._currentBranch;
    const parent = this._requireBranch(parentName);

    const forkIndex = typeof opts.atIndex === 'number' ? opts.atIndex : parent.messages.length;
    if (forkIndex < 0 || forkIndex > parent.messages.length) {
      throw Object.assign(
        new Error(`Fork index ${forkIndex} out of range [0, ${parent.messages.length}] for branch "${parentName}"`),
        { code: ERR_INVALID_FORK_POINT }
      );
    }

    const branch = {
      id: this._generateId(),
      name,
      parentBranch: parent.name,
      forkPoint: forkIndex,
      messages: parent.messages.slice(0, forkIndex),
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      metadata: opts.metadata || {},
    };

    this._branches.set(name, branch);
    return branch;
  }

  /**
   * Switch the currently active branch.
   * @param {string} name - Target branch name
   * @returns {Branch} The now-active branch
   */
  switchBranch(name) {
    this._requireBranch(name);
    this._currentBranch = name;
    return this._branches.get(name);
  }

  /**
   * Merge source branch into target branch.
   * Messages from source appended after target's last message, with conflict markers if overlap.
   * @param {string} source - Source branch name
   * @param {string} target - Target branch name
   * @param {Object} [opts]
   * @param {boolean} [opts.keepSource=true] - Whether to keep the source branch after merge
   * @returns {{ target: Branch, merged: Array }} The target branch and the merged message list
   */
  mergeBranch(source, target, opts = {}) {
    const src = this._requireBranch(source);
    const tgt = this._requireBranch(target);

    if (source === target) {
      return { target: tgt, merged: tgt.messages };
    }

    const keepSource = opts.keepSource !== false;
    const newMessages = this._computeMergeMessages(src, tgt, opts.strategy || 'append');

    tgt.messages = newMessages;
    tgt.modifiedAt = new Date().toISOString();

    if (!keepSource) {
      this._branches.delete(source);
      if (this._currentBranch === source) {
        this._currentBranch = target;
      }
    }

    return { target: tgt, merged: tgt.messages };
  }

  /**
   * List all branches with their metadata.
   * @returns {Array<{ name: string, id: string, parentBranch: string|null, messageCount: number, forkPoint: number, createdAt: string, modifiedAt: string, isCurrent: boolean, metadata: Object }>}
   */
  listBranches() {
    const result = [];
    for (const [name, branch] of this._branches) {
      result.push({
        name,
        id: branch.id,
        parentBranch: branch.parentBranch,
        messageCount: branch.messages.length,
        forkPoint: branch.forkPoint,
        createdAt: branch.createdAt,
        modifiedAt: branch.modifiedAt,
        isCurrent: name === this._currentBranch,
        metadata: branch.metadata || {},
      });
    }
    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Delete a branch. The main branch cannot be deleted.
   * @param {string} name - Branch name to delete
   * @returns {boolean} true if deleted
   */
  deleteBranch(name) {
    if (name === 'main') {
      throw Object.assign(new Error('Cannot delete the main branch'), { code: ERR_CANNOT_DELETE_MAIN });
    }

    const branch = this._requireBranch(name);

    // Reassign any child branches to main
    for (const [childName, b] of this._branches) {
      if (b.parentBranch === name) {
        b.parentBranch = 'main';
      }
    }

    this._branches.delete(name);
    if (this._currentBranch === name) {
      this._currentBranch = 'main';
    }

    return true;
  }

  /**
   * Get the currently active branch object.
   * @returns {Branch}
   */
  getCurrentBranch() {
    return this._branches.get(this._currentBranch);
  }

  /**
   * Compute the structural diff between two branches.
   * @param {string} branchA - First branch name
   * @param {string} branchB - Second branch name
   * @returns {{
   *   commonAncestor: string,
   *   forkPoint: number,
   *   sharedMessages: number,
   *   uniqueToA: number,
   *   uniqueToB: number,
   *   divergenceIndex: number,
   *   aOnly: Array,
   *   bOnly: Array,
   *   shared: Array
   * }}
   */
  getBranchDiff(branchA, branchB) {
    const a = this._requireBranch(branchA);
    const b = this._requireBranch(branchB);

    const ancestor = this._findCommonAncestor(a, b);
    const forkPoint = ancestor ? ancestor.forkPoint || 0 : 0;

    const minLen = Math.min(a.messages.length, b.messages.length);
    let divergenceIndex = forkPoint;

    for (let i = forkPoint; i < minLen; i++) {
      if (!this._messagesEqual(a.messages[i], b.messages[i])) {
        divergenceIndex = i;
        break;
      }
      divergenceIndex = i + 1;
    }

    if (divergenceIndex >= minLen && a.messages.length !== b.messages.length) {
      divergenceIndex = minLen;
    }

    return {
      commonAncestor: ancestor ? ancestor.name : 'main',
      forkPoint: divergenceIndex,
      sharedMessages: divergenceIndex,
      uniqueToA: a.messages.length - divergenceIndex,
      uniqueToB: b.messages.length - divergenceIndex,
      divergenceIndex,
      aOnly: a.messages.slice(divergenceIndex),
      bOnly: b.messages.slice(divergenceIndex),
      shared: a.messages.slice(0, divergenceIndex),
    };
  }

  /**
   * Get a specific branch by name.
   * @param {string} name
   * @returns {Branch|undefined}
   */
  getBranch(name) {
    return this._branches.get(name);
  }

  /**
   * Append a message to the current branch.
   * @param {Object} message - Message to append
   * @returns {Branch} Updated current branch
   */
  appendMessage(message) {
    const branch = this._requireBranch(this._currentBranch);
    branch.messages.push(message);
    branch.modifiedAt = new Date().toISOString();
    return branch;
  }

  /**
   * Get the total branch count.
   * @returns {number}
   */
  get branchCount() {
    return this._branches.size;
  }

  // ---------------------------------------------------------------- private / internal

  _initMainBranch(baseMessages) {
    const main = {
      id: this._generateId(),
      name: 'main',
      parentBranch: null,
      forkPoint: 0,
      messages: Array.isArray(baseMessages) ? [...baseMessages] : [],
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      metadata: {},
    };
    this._branches.set('main', main);
    this._currentBranch = 'main';
  }

  _generateId() {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const suffix = crypto.randomBytes(4).toString('hex');
    return `${ts}-${suffix}`;
  }

  _validateBranchName(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw Object.assign(new Error('Branch name must be a non-empty string'), { code: ERR_INVALID_NAME });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw Object.assign(new Error('Branch name may only contain alphanumeric characters, hyphens, and underscores'), { code: ERR_INVALID_NAME });
    }
  }

  _requireBranch(name) {
    const branch = this._branches.get(name);
    if (!branch) {
      throw Object.assign(new Error(`Branch "${name}" not found`), { code: ERR_BRANCH_NOT_FOUND });
    }
    return branch;
  }

  _findCommonAncestor(a, b) {
    if (!a.parentBranch && !b.parentBranch) return null;
    const aAncestors = this._getAncestorChain(a);
    const bAncestors = this._getAncestorChain(b);

    for (const anc of aAncestors) {
      if (bAncestors.some((x) => x.name === anc.name)) {
        return anc;
      }
    }
    return this._branches.get('main');
  }

  _getAncestorChain(branch) {
    const chain = [];
    let current = branch;
    const visited = new Set();
    while (current && current.parentBranch && !visited.has(current.name)) {
      visited.add(current.name);
      const parent = this._branches.get(current.parentBranch);
      if (parent) {
        chain.push(parent);
        current = parent;
      } else {
        break;
      }
    }
    return chain;
  }

  _messagesEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.role === b.role && a.content === b.content;
  }

  _computeMergeMessages(src, tgt, strategy) {
    switch (strategy) {
      case 'interleave':
        return this._interleave(tgt.messages, src.messages);
      case 'replace':
        return [...src.messages];
      case 'append':
      default:
        return this._appendUnique(tgt.messages, src.messages);
    }
  }

  _appendUnique(targetMsgs, sourceMsgs) {
    const result = [...targetMsgs];
    const seen = new Set(result.map((m) => this._messageFingerprint(m)));

    for (const msg of sourceMsgs) {
      const fp = this._messageFingerprint(msg);
      if (!seen.has(fp)) {
        result.push(msg);
        seen.add(fp);
      }
    }
    return result;
  }

  _interleave(a, b) {
    const result = [...a];
    const aFingerprints = new Set(a.map((m) => this._messageFingerprint(m)));
    for (const msg of b) {
      if (!aFingerprints.has(this._messageFingerprint(msg))) {
        result.push(msg);
      }
    }
    return result;
  }

  _messageFingerprint(msg) {
    return `${msg.role || ''}|${(msg.content || '').slice(0, 200)}`;
  }
}

module.exports = {
  BranchManager,
};
