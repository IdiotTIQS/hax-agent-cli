'use strict';

/**
 * Comprehensive branch comparison utilities.
 *
 * Expected branch shape (from BranchManager):
 *   { name, id, parentBranch, forkPoint, messages: [...] }
 *
 * Expected message shape:
 *   { role, content, ...optional fields like usage, tool_calls, timestamp }
 */

const BUILTIN_METRICS = [
  'messageCount',
  'tokenCount',
  'toolCallCount',
  'duration',
  'responseLength',
  'toolEfficiency',
];

class BranchComparison {
  /**
   * @param {Object} [options]
   * @param {Object} [options.metrics] - Custom metric config
   */
  constructor(options = {}) {
    this._metrics = options.metrics || {};
  }

  /**
   * Comprehensive comparison of two branches.
   * @param {Branch} branchA
   * @param {Branch} branchB
   * @returns {Object} Detailed comparison result
   */
  compare(branchA, branchB) {
    const msgDiff = this._compareMessages(branchA, branchB);
    const qualityDiff = this._compareQualityScores(branchA, branchB);
    const efficiencyDiff = this._compareEfficiency(branchA, branchB);

    return {
      branches: [branchA.name, branchB.name],
      messageComparison: msgDiff,
      qualityComparison: qualityDiff,
      efficiencyComparison: efficiencyDiff,
      summary: this._buildComparisonSummary(msgDiff, qualityDiff, efficiencyDiff),
    };
  }

  /**
   * Compare outcomes/results across multiple branches.
   * @param {Branch[]} branches
   * @returns {Object} Outcome comparison
   */
  compareResults(branches) {
    if (!branches || branches.length < 2) {
      return { branches: (branches || []).map((b) => b.name), result: 'insufficient data', winner: null };
    }

    const scored = branches.map((b) => ({
      name: b.name,
      messageCount: b.messages.length,
      lastMessage: b.messages[b.messages.length - 1] || null,
      hasToolCalls: this._countToolCalls(b),
      responseLength: this._totalResponseLength(b),
    }));

    // Score by combination of completeness signals
    const withScores = scored.map((s) => {
      let score = 0;
      if (s.lastMessage && s.lastMessage.role === 'assistant') score += 3;
      if (s.lastMessage && s.lastMessage.content) score += 2;
      if (s.responseLength > 0) score += Math.min(s.responseLength / 100, 5);
      score += Math.log2(Math.max(1, s.messageCount));
      return { ...s, score: Math.round(score * 100) / 100 };
    });

    withScores.sort((a, b) => b.score - a.score);

    return {
      branches: withScores.map((s) => s.name),
      scores: withScores,
      winner: withScores[0] || null,
      comparisonTable: withScores.reduce((t, s) => {
        t[s.name] = {
          messageCount: s.messageCount,
          toolCalls: s.hasToolCalls,
          responseLength: s.responseLength,
          score: s.score,
        };
        return t;
      }, {}),
    };
  }

  /**
   * Compare quality metrics across branches.
   * Quality = response completeness, depth, coherence signals.
   * @param {Branch[]} branches
   * @returns {Object} Quality comparison
   */
  compareQuality(branches) {
    if (!branches || branches.length < 2) {
      return { branches: (branches || []).map((b) => b.name), result: 'insufficient data' };
    }

    const qualities = branches.map((b) => {
      const assistantMessages = b.messages.filter((m) => m.role === 'assistant');
      const totalLength = assistantMessages.reduce((sum, m) => sum + (m.content ? m.content.length : 0), 0);
      const avgLength = assistantMessages.length > 0 ? totalLength / assistantMessages.length : 0;

      // Depth heuristic: average content length, tool invocation diversity
      const depth = Math.min(avgLength / 200, 1);

      // Completeness: has a final assistant message with content
      const lastMsg = b.messages[b.messages.length - 1];
      const completeness = lastMsg && lastMsg.role === 'assistant' && lastMsg.content ? 1 : 0.5;

      // Coherence: turn density (fewer empty assistant messages = more coherent)
      const emptyAssistants = assistantMessages.filter((m) => !m.content || m.content.trim() === '').length;
      const coherence = assistantMessages.length > 0
        ? 1 - (emptyAssistants / assistantMessages.length)
        : 0;

      const overall = (depth * 0.3 + completeness * 0.4 + coherence * 0.3);

      return {
        name: b.name,
        depth: Math.round(depth * 100) / 100,
        completeness: Math.round(completeness * 100) / 100,
        coherence: Math.round(coherence * 100) / 100,
        overall: Math.round(overall * 100) / 100,
        assistantMessageCount: assistantMessages.length,
        totalResponseLength: totalLength,
      };
    });

    qualities.sort((a, b) => b.overall - a.overall);

    return {
      branches: qualities.map((q) => q.name),
      metrics: qualities,
      best: qualities[0] || null,
    };
  }

  /**
   * Compare efficiency metrics: token usage, tool calls, time.
   * @param {Branch[]} branches
   * @returns {Object} Efficiency comparison
   */
  compareEfficiency(branches) {
    if (!branches || branches.length < 2) {
      return { branches: (branches || []).map((b) => b.name), result: 'insufficient data' };
    }

    const efficiencies = branches.map((b) => {
      const tokens = this._countTokens(b);
      const toolCalls = this._countToolCalls(b);
      const messages = b.messages.length;

      // Efficiency: output per input (higher = more efficient)
      const efficiency = tokens.inputTokens > 0
        ? tokens.outputTokens / tokens.inputTokens
        : 0;

      // Tool efficiency: messages per tool call (higher = fewer tools needed)
      const toolEfficiency = toolCalls > 0 ? messages / toolCalls : messages;

      return {
        name: b.name,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        totalTokens: tokens.inputTokens + tokens.outputTokens,
        toolCalls,
        messageCount: messages,
        efficiency: Math.round(efficiency * 1000) / 1000,
        toolEfficiency: Math.round(toolEfficiency * 100) / 100,
      };
    });

    return {
      branches: efficiencies.map((e) => e.name),
      metrics: efficiencies,
      summary: {
        mostTokenEfficient: [...efficiencies].sort((a, b) => b.efficiency - a.efficiency)[0]?.name || null,
        fewestToolCalls: [...efficiencies].sort((a, b) => a.toolCalls - b.toolCalls)[0]?.name || null,
        lowestTokens: [...efficiencies].sort((a, b) => a.totalTokens - b.totalTokens)[0]?.name || null,
      },
    };
  }

  /**
   * Select the best branch by a given metric.
   * @param {Branch[]} branches
   * @param {string} metric - One of: 'messageCount', 'tokenCount', 'toolCallCount', 'duration', 'responseLength', 'toolEfficiency'
   * @returns {{ branch: Branch|null, value: number, reason: string }}
   */
  bestBy(branches, metric) {
    if (!branches || branches.length === 0) {
      return { branch: null, value: 0, reason: 'No branches provided' };
    }
    if (!BUILTIN_METRICS.includes(metric) && !this._metrics[metric]) {
      return { branch: null, value: 0, reason: `Unknown metric: "${metric}". Available: ${BUILTIN_METRICS.join(', ')}` };
    }

    let scored;
    switch (metric) {
      case 'messageCount':
        scored = branches.map((b) => ({ branch: b, value: b.messages.length }));
        scored.sort((a, b) => b.value - a.value);
        break;

      case 'tokenCount': {
        scored = branches.map((b) => {
          const tokens = this._countTokens(b);
          return { branch: b, value: tokens.inputTokens + tokens.outputTokens };
        });
        // For token efficiency, lower is better
        scored.sort((a, b) => a.value - b.value);
        break;
      }

      case 'toolCallCount':
        scored = branches.map((b) => ({ branch: b, value: this._countToolCalls(b) }));
        scored.sort((a, b) => a.value - b.value);
        break;

      case 'duration':
        scored = branches.map((b) => ({ branch: b, value: this._computeDuration(b) }));
        scored.sort((a, b) => a.value - b.value);
        break;

      case 'responseLength':
        scored = branches.map((b) => ({ branch: b, value: this._totalResponseLength(b) }));
        scored.sort((a, b) => b.value - a.value);
        break;

      case 'toolEfficiency':
        scored = branches.map((b) => {
          const tcs = this._countToolCalls(b);
          const eff = tcs > 0 ? b.messages.length / tcs : b.messages.length;
          return { branch: b, value: Math.round(eff * 100) / 100 };
        });
        scored.sort((a, b) => b.value - a.value);
        break;

      default:
        if (this._metrics[metric]) {
          scored = branches.map((b) => ({
            branch: b,
            value: this._metrics[metric](b),
          }));
          scored.sort((a, b) => b.value - a.value);
        } else {
          return { branch: null, value: 0, reason: `Unknown metric: "${metric}"` };
        }
    }

    const best = scored[0];
    return {
      branch: best ? best.branch : null,
      value: best ? best.value : 0,
      metric,
      rankings: scored.map((s) => ({ name: s.branch.name, value: s.value })),
    };
  }

  /**
   * Highlight where branches diverge.
   * @param {Branch[]} branches
   * @returns {Object} Divergence analysis
   */
  highlightDifferences(branches) {
    if (!branches || branches.length < 2) {
      return { branches: (branches || []).map((b) => b.name), divergences: [] };
    }

    const divergences = [];
    const maxLen = Math.max(...branches.map((b) => b.messages.length));

    for (let i = 0; i < maxLen; i++) {
      const messagesAtIndex = branches.map((b) => b.messages[i] || null);
      const nonNull = messagesAtIndex.filter(Boolean);

      if (nonNull.length === 0) continue;

      // Check if all branches agree at this index
      const first = nonNull[0];
      const allSame = nonNull.every((m) =>
        m.role === first.role && m.content === first.content
      );

      if (!allSame) {
        divergences.push({
          index: i,
          messages: branches.map((b, bi) => ({
            branch: b.name,
            message: messagesAtIndex[bi],
            present: messagesAtIndex[bi] !== null,
          })),
        });
      }
    }

    // Also note length differences
    const lengths = branches.map((b) => ({ name: b.name, length: b.messages.length }));
    const lengthDiscrepancy = new Set(lengths.map((l) => l.length)).size > 1;

    return {
      branches: branches.map((b) => b.name),
      divergences,
      totalDivergences: divergences.length,
      lengthDiscrepancy,
      lengths,
    };
  }

  // ---------------------------------------------------------------- private helpers

  _compareMessages(a, b) {
    const shared = [];
    const maxShared = Math.min(a.messages.length, b.messages.length);
    let firstDivergence = -1;

    for (let i = 0; i < maxShared; i++) {
      if (a.messages[i].role === b.messages[i].role && a.messages[i].content === b.messages[i].content) {
        shared.push(i);
      } else {
        if (firstDivergence === -1) firstDivergence = i;
      }
    }

    if (firstDivergence === -1 && a.messages.length !== b.messages.length) {
      firstDivergence = maxShared;
    }

    return {
      sharedCount: shared.length,
      firstDivergenceIndex: firstDivergence,
      aUniqueCount: a.messages.length - shared.length,
      bUniqueCount: b.messages.length - shared.length,
      overlapPercent: maxShared > 0 ? Math.round((shared.length / maxShared) * 100) : 100,
    };
  }

  _compareQualityScores(a, b) {
    const qualityA = this._branchQualityScore(a);
    const qualityB = this._branchQualityScore(b);

    return {
      aScore: qualityA,
      bScore: qualityB,
      delta: Math.round((qualityA - qualityB) * 100) / 100,
      better: qualityA > qualityB ? a.name : qualityB > qualityA ? b.name : 'tie',
    };
  }

  _compareEfficiency(a, b) {
    const effA = this._branchEfficiencyScore(a);
    const effB = this._branchEfficiencyScore(b);

    return {
      aScore: Math.round(effA * 1000) / 1000,
      bScore: Math.round(effB * 1000) / 1000,
      delta: Math.round((effA - effB) * 1000) / 1000,
      better: effA > effB ? a.name : effB > effA ? b.name : 'tie',
    };
  }

  _branchQualityScore(branch) {
    const assistantMsgs = branch.messages.filter((m) => m.role === 'assistant');
    if (assistantMsgs.length === 0) return 0;

    const avgLength = assistantMsgs.reduce((s, m) => s + (m.content ? m.content.length : 0), 0) / assistantMsgs.length;
    const hasFinalAnswer = branch.messages[branch.messages.length - 1]?.role === 'assistant' ? 1 : 0;
    return (avgLength / 500) * 0.4 + hasFinalAnswer * 0.6;
  }

  _branchEfficiencyScore(branch) {
    const tokens = this._countTokens(branch);
    return tokens.inputTokens > 0 ? tokens.outputTokens / tokens.inputTokens : 0;
  }

  _countTokens(branch) {
    let inputTokens = 0;
    let outputTokens = 0;

    for (const msg of branch.messages) {
      if (msg.usage) {
        inputTokens += msg.usage.input_tokens || msg.usage.inputTokens || msg.usage.prompt_tokens || 0;
        outputTokens += msg.usage.output_tokens || msg.usage.outputTokens || msg.usage.completion_tokens || 0;
      }
      // Heuristic fallback: estimate tokens by content length
      if (!msg.usage && msg.content) {
        if (msg.role === 'assistant') {
          outputTokens += Math.ceil(msg.content.length / 4);
        } else if (msg.role === 'user') {
          inputTokens += Math.ceil(msg.content.length / 4);
        }
      }
    }

    return { inputTokens, outputTokens };
  }

  _countToolCalls(branch) {
    let count = 0;
    for (const msg of branch.messages) {
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        count += msg.tool_calls.length;
      }
      if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
        count += msg.toolCalls.length;
      }
      if (msg.tool_use) count += 1;
    }
    return count;
  }

  _totalResponseLength(branch) {
    return branch.messages
      .filter((m) => m.role === 'assistant')
      .reduce((sum, m) => sum + (m.content ? m.content.length : 0), 0);
  }

  _computeDuration(branch) {
    const start = branch.messages[0]?.timestamp;
    const end = branch.messages[branch.messages.length - 1]?.timestamp;
    if (start && end) {
      return new Date(end) - new Date(start);
    }
    return 0;
  }

  _buildComparisonSummary(msgDiff, qualityDiff, efficiencyDiff) {
    const lines = [];
    if (msgDiff.firstDivergenceIndex >= 0) {
      lines.push(`Divergence at message index ${msgDiff.firstDivergenceIndex}`);
    } else {
      lines.push('Branches are identical in message content');
    }
    lines.push(`Quality: ${qualityDiff.better} leads (delta: ${qualityDiff.delta > 0 ? '+' : ''}${qualityDiff.delta})`);
    lines.push(`Efficiency: ${efficiencyDiff.better} leads (delta: ${efficiencyDiff.delta > 0 ? '+' : ''}${efficiencyDiff.delta})`);
    return lines.join('. ');
  }
}

module.exports = {
  BranchComparison,
};
