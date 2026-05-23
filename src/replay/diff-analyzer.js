"use strict";

/**
 * ReplayDiffAnalyzer — compares conversation sessions to find divergence
 * points, measure decision impacts, and perform what-if analyses.
 */
class ReplayDiffAnalyzer {
  constructor(options = {}) {
    this._options = options;
  }

  /**
   * Compare two sessions in detail.
   * @param {object} sessionA - First session recording.
   * @param {object} sessionB - Second session recording.
   * @returns {object} Detailed comparison results.
   */
  compareSessions(sessionA, sessionB) {
    this._validateSessions(sessionA, sessionB);

    const eventsA = sessionA.events;
    const eventsB = sessionB.events;
    const metaA = sessionA.metadata || {};
    const metaB = sessionB.metadata || {};

    // Metadata comparison
    const metadataDiff = {
      sameProvider: metaA.provider === metaB.provider,
      sameModel: metaA.model === metaB.model,
      providerA: metaA.provider || null,
      providerB: metaB.provider || null,
      modelA: metaA.model || null,
      modelB: metaB.model || null,
      sessionAId: metaA.id || null,
      sessionBId: metaB.id || null,
    };

    // Event count comparison
    const countsA = this._countByType(eventsA);
    const countsB = this._countByType(eventsB);
    const allTypes = new Set([...Object.keys(countsA), ...Object.keys(countsB)]);
    const typeDiffs = {};
    for (const type of allTypes) {
      typeDiffs[type] = {
        a: countsA[type] || 0,
        b: countsB[type] || 0,
        delta: (countsB[type] || 0) - (countsA[type] || 0),
      };
    }

    // Duration comparison
    const durationA = this._sessionDuration(sessionA);
    const durationB = this._sessionDuration(sessionB);

    // Tool usage comparison
    const toolsA = this._extractToolNames(eventsA);
    const toolsB = this._extractToolNames(eventsB);
    const uniqueToolsA = [...new Set(toolsA)];
    const uniqueToolsB = [...new Set(toolsB)];
    const toolsOnlyA = uniqueToolsA.filter(t => !uniqueToolsB.includes(t));
    const toolsOnlyB = uniqueToolsB.filter(t => !uniqueToolsA.includes(t));
    const toolsCommon = uniqueToolsA.filter(t => uniqueToolsB.includes(t));

    // Turn structure comparison
    const turnsA = this._extractTurns(eventsA);
    const turnsB = this._extractTurns(eventsB);

    // Message length analysis
    const msgLengthsA = this._messageLengths(eventsA);
    const msgLengthsB = this._messageLengths(eventsB);
    const avgMsgLenA = msgLengthsA.length > 0
      ? msgLengthsA.reduce((s, l) => s + l, 0) / msgLengthsA.length
      : 0;
    const avgMsgLenB = msgLengthsB.length > 0
      ? msgLengthsB.reduce((s, l) => s + l, 0) / msgLengthsB.length
      : 0;

    return {
      metadataDiff,
      totalEvents: { a: eventsA.length, b: eventsB.length, delta: eventsB.length - eventsA.length },
      typeDiffs,
      duration: {
        aMs: durationA,
        bMs: durationB,
        deltaMs: durationB - durationA,
        aFormatted: this._formatMs(durationA),
        bFormatted: this._formatMs(durationB),
      },
      toolUsage: {
        a: uniqueToolsA,
        b: uniqueToolsB,
        onlyInA: toolsOnlyA,
        onlyInB: toolsOnlyB,
        common: toolsCommon,
        totalCallsA: toolsA.length,
        totalCallsB: toolsB.length,
      },
      turns: {
        countA: turnsA.length,
        countB: turnsB.length,
        delta: turnsB.length - turnsA.length,
      },
      messageLengths: {
        avgA: Math.round(avgMsgLenA),
        avgB: Math.round(avgMsgLenB),
        delta: Math.round(avgMsgLenB - avgMsgLenA),
      },
      errorCount: {
        a: countsA.error || 0,
        b: countsB.error || 0,
      },
      similarity: this._computeSimilarity(eventsA, eventsB),
    };
  }

  /**
   * Find the points where two sessions diverged.
   * @param {object} sessionA - First session recording.
   * @param {object} sessionB - Second session recording.
   * @returns {object} Divergence analysis.
   */
  findDivergencePoints(sessionA, sessionB) {
    this._validateSessions(sessionA, sessionB);

    const eventsA = sessionA.events;
    const eventsB = sessionB.events;
    const minLen = Math.min(eventsA.length, eventsB.length);

    const divergencePoints = [];
    let firstDivergence = null;

    for (let i = 0; i < minLen; i++) {
      const a = eventsA[i];
      const b = eventsB[i];

      if (a.type !== b.type) {
        const point = {
          index: i,
          type: 'type_mismatch',
          timestampA: a.timestamp,
          timestampB: b.timestamp,
          typeA: a.type,
          typeB: b.type,
          dataA: a.data,
          dataB: b.data,
        };
        divergencePoints.push(point);
        if (!firstDivergence) firstDivergence = point;
      } else if (!this._deepEqual(a.data, b.data)) {
        const point = {
          index: i,
          type: 'data_divergence',
          timestampA: a.timestamp,
          timestampB: b.timestamp,
          eventType: a.type,
          dataA: a.data,
          dataB: b.data,
        };
        divergencePoints.push(point);
        if (!firstDivergence) firstDivergence = point;
      }
    }

    // Track length difference beyond minLen
    let lengthDiff = null;
    if (eventsA.length !== eventsB.length) {
      lengthDiff = {
        type: 'length_difference',
        aLength: eventsA.length,
        bLength: eventsB.length,
        delta: eventsB.length - eventsA.length,
        extraEventsIn: eventsB.length > eventsA.length ? 'B' : 'A',
        extraCount: Math.abs(eventsB.length - eventsA.length),
      };
    }

    return {
      firstDivergence,
      divergencePoints,
      lengthDiff,
      totalDivergences: divergencePoints.length,
      commonPrefixLength: firstDivergence ? firstDivergence.index : Math.min(eventsA.length, eventsB.length),
      sessionsIdentical: divergencePoints.length === 0 && !lengthDiff,
    };
  }

  /**
   * Analyze an alternate path: what would happen if a different action were taken
   * at a given fork point.
   * @param {object} session - The original session recording.
   * @param {number} forkPoint - Event index where the alternate action is inserted.
   * @param {object} alternateAction - The alternate event to insert.
   *   Shape: { type: string, data: any, context?: object }
   * @returns {object} Alternate path analysis.
   */
  analyzeAlternatePath(session, forkPoint, alternateAction) {
    if (!session || !Array.isArray(session.events)) {
      throw new Error('Session must be an object with an events array.');
    }
    if (typeof forkPoint !== 'number' || forkPoint < 0 || forkPoint >= session.events.length) {
      throw new Error(
        `forkPoint must be a valid event index (0-${session.events.length - 1}), got ${forkPoint}.`
      );
    }
    if (!alternateAction || typeof alternateAction !== 'object' || !alternateAction.type) {
      throw new Error('alternateAction must be an object with a "type" field.');
    }

    const events = session.events;
    const forkEvent = events[forkPoint];

    // Build the alternate path by replacing from forkPoint onward
    const alternateTimestamp = forkEvent.timestamp || new Date().toISOString();

    const alternateEvent = {
      type: alternateAction.type,
      timestamp: alternateTimestamp,
      data: alternateAction.data !== undefined ? alternateAction.data : null,
      context: alternateAction.context !== undefined ? alternateAction.context : {},
    };

    // Construct a hypothetical session with the alternate path
    const prefix = events.slice(0, forkPoint);
    const originalFromFork = events.slice(forkPoint);
    const alternatePath = {
      ...session,
      metadata: {
        ...(session.metadata || {}),
        isAlternatePath: true,
        forkPoint,
        originalEventType: forkEvent.type,
        alternateEventType: alternateAction.type,
      },
      events: [...prefix, alternateEvent],
    };

    // Analyze differences
    const originalForkCounts = this._countByType(originalFromFork);
    const alternateCounts = this._countByType([alternateEvent]);

    const originalActions = originalFromFork.map(e => ({
      type: e.type,
      hasData: e.data !== null && e.data !== undefined,
    }));
    const alternateActions = [{
      type: alternateAction.type,
      hasData: alternateAction.data !== null && alternateAction.data !== undefined,
    }];

    // Estimate impact: how many events would be different
    const replacedCount = originalFromFork.length;
    const addedCount = 1;

    return {
      alternatePath,
      forkPoint,
      forkEvent,
      alternateEvent,
      summary: {
        originalRemainingEvents: replacedCount,
        alternateRemainingEvents: addedCount,
        eventsChanged: replacedCount !== addedCount || forkEvent.type !== alternateAction.type,
        typeChanged: forkEvent.type !== alternateAction.type,
        originalTypes: this._countByType(originalFromFork),
        alternateTypes: alternateCounts,
      },
      originalActions,
      alternateActions,
    };
  }

  /**
   * Measure the impact of a decision within a session.
   * @param {object} decision - The decision event.
   *   Shape: { type: string, data: any, index: number }
   * @param {object} outcome - The observed outcome.
   *   Shape: { eventsAfter: object[], stateAfter: object, metrics?: object }
   * @returns {object} Impact assessment.
   */
  getDecisionImpact(decision, outcome) {
    if (!decision || typeof decision !== 'object') {
      throw new Error('decision must be an object with type, data, and index.');
    }
    if (!outcome || typeof outcome !== 'object') {
      throw new Error('outcome must be an object with eventsAfter array.');
    }

    const eventsAfter = outcome.eventsAfter || [];
    const stateAfter = outcome.stateAfter || {};
    const metrics = outcome.metrics || {};

    // Categorize downstream effects
    const downstreamTypes = this._countByType(eventsAfter);
    const toolCallsAfter = eventsAfter.filter(e => e.type === 'tool_call');
    const errorsAfter = eventsAfter.filter(e => e.type === 'error');
    const messagesAfter = eventsAfter.filter(
      e => e.type === 'user_message' || e.type === 'assistant_response'
    );

    // Calculate impact score (0-100)
    let impactScore = 0;

    // More downstream events = higher impact
    impactScore += Math.min(eventsAfter.length * 5, 25);

    // Errors are high impact
    impactScore += Math.min(errorsAfter.length * 15, 30);

    // Tool calls indicate action was taken
    impactScore += Math.min(toolCallsAfter.length * 10, 25);

    // State changes indicate meaningful effect
    const stateKeys = Object.keys(stateAfter);
    impactScore += Math.min(stateKeys.length * 5, 20);

    impactScore = Math.min(impactScore, 100);

    // Impact level
    let impactLevel;
    if (impactScore >= 75) impactLevel = 'critical';
    else if (impactScore >= 50) impactLevel = 'high';
    else if (impactScore >= 25) impactLevel = 'moderate';
    else impactLevel = 'low';

    return {
      decision: {
        type: decision.type || 'unknown',
        data: decision.data,
        index: decision.index !== undefined ? decision.index : null,
      },
      outcome: {
        totalEventsAfter: eventsAfter.length,
        downstreamTypes,
        toolCallsCount: toolCallsAfter.length,
        errorsCount: errorsAfter.length,
        messagesCount: messagesAfter.length,
        stateChanges: stateKeys,
        metrics,
      },
      impact: {
        score: impactScore,
        level: impactLevel,
        hasErrors: errorsAfter.length > 0,
        causedToolCalls: toolCallsAfter.length > 0,
        causedStateChanges: stateKeys.length > 0,
      },
    };
  }

  // ── private helpers ───────────────────────────────────────────────────

  _validateSessions(a, b) {
    if (!a || typeof a !== 'object' || !Array.isArray(a.events)) {
      throw new Error('sessionA must be an object with an "events" array.');
    }
    if (!b || typeof b !== 'object' || !Array.isArray(b.events)) {
      throw new Error('sessionB must be an object with an "events" array.');
    }
  }

  _countByType(events) {
    const counts = {};
    for (const evt of events) {
      const type = evt.type || 'unknown';
      counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
  }

  _sessionDuration(session) {
    const events = session.events;
    if (events.length < 2) return 0;

    const first = events[0].timestamp;
    const last = events[events.length - 1].timestamp;
    if (!first || !last) return 0;

    const firstMs = new Date(first).getTime();
    const lastMs = new Date(last).getTime();
    return Math.max(0, lastMs - firstMs);
  }

  _extractToolNames(events) {
    const names = [];
    for (const evt of events) {
      if (evt.type === 'tool_call') {
        const name = evt.data?.tool || evt.data?.name || 'unknown';
        names.push(name);
      }
    }
    return names;
  }

  _extractTurns(events) {
    const turns = [];
    for (const evt of events) {
      if (evt.type === 'user_message') {
        turns.push({ type: 'user', timestamp: evt.timestamp });
      } else if (evt.type === 'assistant_response') {
        if (turns.length > 0 && turns[turns.length - 1].type === 'user') {
          turns[turns.length - 1].hasResponse = true;
        }
      }
    }
    return turns;
  }

  _messageLengths(events) {
    const lengths = [];
    for (const evt of events) {
      if (evt.type === 'user_message' || evt.type === 'assistant_response') {
        let content = '';
        if (typeof evt.data === 'string') {
          content = evt.data;
        } else if (evt.data && typeof evt.data === 'object') {
          content = evt.data.content || evt.data.text || '';
        }
        lengths.push(content.length);
      }
    }
    return lengths;
  }

  _deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== typeof b) return false;

    if (typeof a === 'object') {
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((item, idx) => this._deepEqual(item, b[idx]));
      }
      if (Array.isArray(a) !== Array.isArray(b)) return false;

      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;
      return keysA.every(k => keysB.includes(k) && this._deepEqual(a[k], b[k]));
    }

    return a === b;
  }

  _computeSimilarity(eventsA, eventsB) {
    const maxLen = Math.max(eventsA.length, eventsB.length);
    if (maxLen === 0) return { score: 100, description: 'identical (both empty)' };

    let matchCount = 0;
    const minLen = Math.min(eventsA.length, eventsB.length);

    for (let i = 0; i < minLen; i++) {
      if (eventsA[i].type === eventsB[i].type) {
        matchCount += 1;
      }
    }

    const typeSimilarity = Math.round((matchCount / minLen) * 100);
    const lengthSimilarity = Math.round((minLen / maxLen) * 100);
    const overall = Math.round((typeSimilarity + lengthSimilarity) / 2);

    let description;
    if (overall >= 95) description = 'nearly identical';
    else if (overall >= 80) description = 'very similar';
    else if (overall >= 60) description = 'moderately similar';
    else if (overall >= 30) description = 'significantly different';
    else description = 'largely divergent';

    return {
      score: overall,
      description,
      typeSimilarity,
      lengthSimilarity,
    };
  }

  _formatMs(ms) {
    if (ms <= 0) return '0ms';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

module.exports = {
  ReplayDiffAnalyzer,
};
