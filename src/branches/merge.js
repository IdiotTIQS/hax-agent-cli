'use strict';

/**
 * Merge strategies for combining conversation branches.
 *
 * Each strategy determines how messages from multiple branches are combined:
 *   KEEP_MAIN    - Only keep the target (main) branch messages, discard others
 *   TAKE_BEST    - Evaluate branches and keep the best one entirely
 *   COMBINE_ALL  - Combine messages from all branches, deduplicating where possible
 *   MANUAL       - Return conflicts for manual resolution
 */

const STRATEGIES = {
  KEEP_MAIN: 'KEEP_MAIN',
  TAKE_BEST: 'TAKE_BEST',
  COMBINE_ALL: 'COMBINE_ALL',
  MANUAL: 'MANUAL',
};

class BranchMerger {
  /**
   * @param {Object} [options]
   * @param {Function} [options.conflictResolver] - Custom conflict resolver (branches, conflicts) => resolved
   * @param {Function} [options.bestEvaluator] - Custom best-branch evaluator (branches) => bestBranchName
   * @param {Function} [options.messageMatcher] - Custom message equality function (a, b) => boolean
   */
  constructor(options = {}) {
    this._conflictResolver = options.conflictResolver || null;
    this._bestEvaluator = options.bestEvaluator || null;
    this._messageMatcher = options.messageMatcher || this._defaultMessageMatcher;
  }

  /**
   * Perform the merge operation.
   * @param {Object[]} branches - Array of branch objects (each with .name and .messages)
   * @param {string} strategy - One of STRATEGIES values
   * @param {Object} [opts]
   * @param {string} [opts.targetBranch] - Name of target branch (for KEEP_MAIN)
   * @param {string} [opts.baseBranch] - Base/target branch name
   * @returns {{ merged: Array, conflicts: Array, summary: Object }} Merge result
   */
  merge(branches, strategy, opts = {}) {
    if (!branches || branches.length === 0) {
      return { merged: [], conflicts: [], summary: { strategy, branchesMerged: 0, messageCount: 0 } };
    }
    if (branches.length === 1) {
      return this._singleBranchResult(branches[0], strategy);
    }

    switch (strategy) {
      case STRATEGIES.KEEP_MAIN:
        return this._mergeKeepMain(branches, opts);
      case STRATEGIES.TAKE_BEST:
        return this._mergeTakeBest(branches, opts);
      case STRATEGIES.COMBINE_ALL:
        return this._mergeCombineAll(branches, opts);
      case STRATEGIES.MANUAL:
        return this._mergeManual(branches, opts);
      default:
        return {
          merged: [],
          conflicts: [],
          summary: {
            strategy,
            error: `Unknown strategy: "${strategy}". Available: ${Object.values(STRATEGIES).join(', ')}`,
            branchesMerged: 0,
            messageCount: 0,
          },
        };
    }
  }

  /**
   * Detect irreconcilable conflicts between branches.
   * A conflict exists when two branches have different messages at the same index
   * after the fork point, with no clear resolution strategy.
   * @param {Object[]} branches
   * @returns {Object[]} Array of conflict descriptions
   */
  detectMergeConflicts(branches) {
    if (!branches || branches.length < 2) return [];

    const conflicts = [];
    const maxLen = Math.max(...branches.map((b) => b.messages.length));
    const forkPoint = this._findForkPoint(branches);

    for (let i = forkPoint; i < maxLen; i++) {
      const messagesAtIndex = branches.map((b) => ({
        branch: b.name,
        message: b.messages[i] || null,
      }));

      const present = messagesAtIndex.filter((m) => m.message !== null);
      if (present.length < 2) continue;

      // Check if all agree
      const first = present[0].message;
      const allAgree = present.every((m) => this._messageMatcher(m.message, first));

      if (!allAgree) {
        conflicts.push({
          index: i,
          type: 'content_divergence',
          severity: this._assessConflictSeverity(present),
          messages: present.map((p) => ({
            branch: p.branch,
            role: p.message.role,
            contentPreview: p.message.content ? p.message.content.slice(0, 100) : '',
          })),
        });
      }
    }

    // Detect structural conflicts (different numbers of messages after fork)
    const uniqueLengths = new Set(branches.map((b) => b.messages.length));
    if (uniqueLengths.size > 1) {
      conflicts.push({
        index: maxLen,
        type: 'length_mismatch',
        severity: 'low',
        details: branches.map((b) => ({ branch: b.name, messageCount: b.messages.length })),
      });
    }

    return conflicts;
  }

  /**
   * Resolve a set of conflicts according to a strategy or custom resolver.
   * @param {Object[]} conflicts - Conflicts from detectMergeConflicts
   * @param {Object} [opts]
   * @param {string} [opts.strategy='first'] - first | last | longest | merge
   * @returns {Object[]} Resolved conflict entries
   */
  resolveConflicts(conflicts, opts = {}) {
    if (!conflicts || conflicts.length === 0) return [];

    const strategy = opts.strategy || 'first';

    if (this._conflictResolver) {
      return this._conflictResolver(conflicts, opts);
    }

    return conflicts.map((conflict) => {
      if (conflict.type === 'length_mismatch') {
        return { ...conflict, resolution: 'use_max', resolved: true };
      }

      const resolved = { ...conflict, resolved: true };

      switch (strategy) {
        case 'first':
          resolved.resolution = `keep_${conflict.messages[0].branch}`;
          resolved.selectedBranch = conflict.messages[0].branch;
          break;
        case 'last':
          resolved.resolution = `keep_${conflict.messages[conflict.messages.length - 1].branch}`;
          resolved.selectedBranch = conflict.messages[conflict.messages.length - 1].branch;
          break;
        case 'longest': {
          const longest = conflict.messages.reduce((best, m) =>
            m.contentPreview.length > best.contentPreview.length ? m : best
          );
          resolved.resolution = `keep_${longest.branch}`;
          resolved.selectedBranch = longest.branch;
          break;
        }
        case 'merge':
          resolved.resolution = 'merged_content';
          resolved.selectedBranch = null;
          resolved.mergedContent = conflict.messages.map((m) => `[${m.branch}]: ${m.contentPreview}`).join('\n\n');
          break;
        default:
          resolved.resolution = `keep_${conflict.messages[0].branch}`;
          resolved.selectedBranch = conflict.messages[0].branch;
      }

      return resolved;
    });
  }

  /**
   * Create a summary of the merge result.
   * @param {Object[]} branches - Original branches
   * @param {Object} mergedResult - The result from merge()
   * @returns {Object} Merge summary
   */
  createMergeResult(branches, mergedResult) {
    const originalTotal = branches.reduce((sum, b) => sum + b.messages.length, 0);
    const mergedCount = mergedResult.merged ? mergedResult.merged.length : 0;
    const dedupedCount = originalTotal - mergedCount;

    return {
      strategy: mergedResult.summary?.strategy || 'unknown',
      branchesMerged: branches.length,
      branchNames: branches.map((b) => b.name),
      originalMessageCount: originalTotal,
      mergedMessageCount: mergedCount,
      deduplicatedCount: Math.max(0, dedupedCount),
      conflictsFound: mergedResult.conflicts ? mergedResult.conflicts.length : 0,
      conflictsResolved: mergedResult.conflicts
        ? mergedResult.conflicts.filter((c) => c.resolved).length
        : 0,
      timestamp: new Date().toISOString(),
      summary: mergedResult.summary || {},
    };
  }

  // ---------------------------------------------------------------- merge strategies

  _mergeKeepMain(branches, opts) {
    const targetName = opts.targetBranch || opts.baseBranch || 'main';
    const target = branches.find((b) => b.name === targetName) || branches[0];

    return {
      merged: [...target.messages],
      conflicts: [],
      summary: {
        strategy: STRATEGIES.KEEP_MAIN,
        keptBranch: target.name,
        branchesMerged: branches.length,
        messageCount: target.messages.length,
      },
    };
  }

  _mergeTakeBest(branches, opts) {
    let bestBranch;

    if (this._bestEvaluator) {
      const bestName = this._bestEvaluator(branches);
      bestBranch = branches.find((b) => b.name === bestName) || branches[0];
    } else {
      // Default best evaluation: most assistant messages with content
      bestBranch = branches.reduce((best, b) => {
        const bScore = b.messages.filter(
          (m) => m.role === 'assistant' && m.content
        ).length;
        const bestScore = best.messages.filter(
          (m) => m.role === 'assistant' && m.content
        ).length;
        return bScore > bestScore ? b : best;
      });
    }

    return {
      merged: [...bestBranch.messages],
      conflicts: [],
      summary: {
        strategy: STRATEGIES.TAKE_BEST,
        bestBranch: bestBranch.name,
        branchesMerged: branches.length,
        messageCount: bestBranch.messages.length,
      },
    };
  }

  _mergeCombineAll(branches, opts) {
    const forkPoint = this._findForkPoint(branches);
    const baseBranch = branches.find((b) => b.name === (opts.baseBranch || 'main')) || branches[0];

    // Start with base messages up to fork point
    const merged = baseBranch.messages.slice(0, forkPoint);

    // Collect unique messages from all branches after fork point
    const postForkMessages = [];
    const seen = new Set();

    for (const branch of branches) {
      const afterFork = branch.messages.slice(forkPoint);
      for (const msg of afterFork) {
        const fp = this._fingerprint(msg);
        if (!seen.has(fp)) {
          postForkMessages.push({ ...msg, _sourceBranch: branch.name });
          seen.add(fp);
        }
      }
    }

    // Sort post-fork messages by role pattern: user -> assistant alternation
    const sorted = this._sortForConversationFlow(postForkMessages);

    // Strip internal _sourceBranch before returning
    for (const msg of sorted) {
      delete msg._sourceBranch;
    }

    const allMerged = [...merged, ...sorted];

    return {
      merged: allMerged,
      conflicts: this._detectCombineConflicts(branches, forkPoint),
      summary: {
        strategy: STRATEGIES.COMBINE_ALL,
        branchesMerged: branches.length,
        messageCount: allMerged.length,
        forkPoint,
      },
    };
  }

  _mergeManual(branches, opts) {
    const conflicts = this.detectMergeConflicts(branches);
    const baseBranch = branches.find((b) => b.name === (opts.baseBranch || 'main')) || branches[0];

    return {
      merged: [...baseBranch.messages],
      conflicts,
      summary: {
        strategy: STRATEGIES.MANUAL,
        branchesMerged: branches.length,
        messageCount: baseBranch.messages.length,
        conflictsFound: conflicts.length,
        requiresResolution: true,
      },
    };
  }

  // ---------------------------------------------------------------- helpers

  _singleBranchResult(branch, strategy) {
    return {
      merged: [...branch.messages],
      conflicts: [],
      summary: {
        strategy,
        branchesMerged: 1,
        messageCount: branch.messages.length,
        note: 'Single branch — no merge needed',
      },
    };
  }

  _findForkPoint(branches) {
    if (!branches || branches.length < 2) return 0;
    const minLen = Math.min(...branches.map((b) => b.messages.length));

    for (let i = 0; i < minLen; i++) {
      const first = branches[0].messages[i];
      for (let j = 1; j < branches.length; j++) {
        if (!this._messageMatcher(branches[j].messages[i], first)) {
          return i;
        }
      }
    }
    return minLen;
  }

  _defaultMessageMatcher(a, b) {
    if (a === b) return true;
    if (!a || !b) return a === b;
    return a.role === b.role && a.content === b.content;
  }

  _fingerprint(msg) {
    return `${msg.role || ''}|${(msg.content || '').slice(0, 200)}`;
  }

  _assessConflictSeverity(messages) {
    const roles = new Set(messages.map((m) => m.message.role));
    if (roles.size > 1) return 'high';
    const lengths = messages.map((m) => (m.message.content || '').length);
    const avg = lengths.reduce((s, l) => s + l, 0) / lengths.length;
    const variance = lengths.reduce((s, l) => s + (l - avg) ** 2, 0) / lengths.length;
    if (variance > 10000) return 'medium';
    return 'low';
  }

  _sortForConversationFlow(messages) {
    // Separate by role
    const buckets = { user: [], assistant: [], system: [], tool: [] };
    for (const msg of messages) {
      const role = msg.role || 'user';
      (buckets[role] = buckets[role] || []).push(msg);
    }

    const result = [];
    const maxPerRole = Math.max(
      buckets.user.length,
      buckets.assistant.length,
      buckets.system.length,
      buckets.tool ? buckets.tool.length : 0
    );

    // Interleave user/assistant pairs to preserve conversation flow
    for (let i = 0; i < maxPerRole; i++) {
      if (i < buckets.system.length) result.push(buckets.system[i]);
      if (i < buckets.user.length) result.push(buckets.user[i]);
      if (i < buckets.assistant.length) result.push(buckets.assistant[i]);
      if (buckets.tool && i < buckets.tool.length) result.push(buckets.tool[i]);
    }

    return result;
  }

  _detectCombineConflicts(branches, forkPoint) {
    const conflicts = [];
    const maxLen = Math.max(...branches.map((b) => b.messages.length));

    for (let i = forkPoint; i < maxLen; i++) {
      const atI = branches.map((b) => b.messages[i]).filter(Boolean);
      if (atI.length > 1) {
        const first = atI[0];
        const allSame = atI.every((m) => this._messageMatcher(m, first));
        if (!allSame) {
          conflicts.push({
            index: i,
            type: 'combine_conflict',
            severity: 'medium',
            resolved: true,
            resolution: 'all_kept_with_source_tags',
          });
        }
      }
    }

    return conflicts;
  }
}

module.exports = {
  BranchMerger,
  STRATEGIES,
};
