"use strict";

const { appendTranscriptEntry, readTranscript } = require("./memory");

const GOAL_ENTRY_TYPE = "goal.meta";

/**
 * Save a goal to the session transcript as a special metadata entry.
 *
 * @param {string} sessionId - The session identifier
 * @param {object|null} goal - Goal object { enabled, text, maxContinuations, createdAt } or null to clear
 * @param {object} [options] - Storage options forwarded to the memory module
 * @returns {object|undefined} The appended transcript entry, or undefined if sessionId is empty
 */
function persistGoal(sessionId, goal, options = {}) {
  if (!sessionId) {
    return undefined;
  }

  const entry = {
    type: GOAL_ENTRY_TYPE,
    goal: goal || null,
    timestamp: new Date().toISOString(),
  };

  return appendTranscriptEntry(sessionId, entry, options);
}

/**
 * Read the last saved goal from the session transcript.
 *
 * Walks the transcript entries in reverse order and returns the most
 * recent goal.meta entry.  A cleared goal (null) or a disabled goal
 * both result in a null return value.
 *
 * @param {string} sessionId - The session identifier
 * @param {object} [options] - Storage options forwarded to the memory module
 * @returns {object|null} The goal object, or null if none / cleared / disabled
 */
function restoreGoal(sessionId, options = {}) {
  if (!sessionId) {
    return null;
  }

  const entries = readTranscript(sessionId, options);

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];

    if (entry && entry.type === GOAL_ENTRY_TYPE) {
      if (!entry.goal || entry.goal.enabled === false) {
        return null;
      }
      return entry.goal;
    }
  }

  return null;
}

module.exports = {
  persistGoal,
  restoreGoal,
};
