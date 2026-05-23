"use strict";

/**
 * Debate format constants and definitions.
 * Each format specifies its phases, time limits, participant roles, and rules.
 */

const DEBATE_PHASES = Object.freeze({
  opening: 'opening',
  arguments: 'arguments',
  rebuttals: 'rebuttals',
  deliberation: 'deliberation',
  verdict: 'verdict',
});

const DEBATE_FORMAT_IDS = Object.freeze({
  oxford: 'OXFORD',
  roundRobin: 'ROUND_ROBIN',
  panel: 'PANEL',
  fishbowl: 'FISHBOWL',
  socratic: 'SOCRATIC',
});

const PARTICIPANT_ROLES = Object.freeze({
  proposer: 'proposer',
  opposer: 'opposer',
  moderator: 'moderator',
  expert: 'expert',
  panelist: 'panelist',
  observer: 'observer',
  questioner: 'questioner',
  respondent: 'respondent',
});

/**
 * Oxford-style debate: structured pro/con format.
 *
 * - Two sides: propose and oppose
 * - Moderator manages flow and enforces rules
 * - Opening statements -> arguments -> rebuttals -> closing statements -> verdict
 */
const OXFORD = Object.freeze({
  id: DEBATE_FORMAT_IDS.oxford,
  name: 'Oxford Debate',
  description: 'Structured pro/con format with opening statements, rebuttals, and closing arguments.',
  phases: [
    {
      phase: DEBATE_PHASES.opening,
      name: 'Opening Statements',
      order: 1,
      timeLimitSec: 300,   // 5 minutes per side
      maxTurns: 2,         // one per side
      description: 'Each side presents their opening position.',
    },
    {
      phase: DEBATE_PHASES.arguments,
      name: 'Arguments',
      order: 2,
      timeLimitSec: 480,   // 8 minutes per side
      maxTurns: 6,         // alternating arguments
      description: 'Each side presents substantive arguments with evidence.',
    },
    {
      phase: DEBATE_PHASES.rebuttals,
      name: 'Rebuttals',
      order: 3,
      timeLimitSec: 360,   // 6 minutes per side
      maxTurns: 4,         // alternating rebuttals
      description: 'Each side directly counters the opposing arguments.',
    },
    {
      phase: DEBATE_PHASES.deliberation,
      name: 'Deliberation',
      order: 4,
      timeLimitSec: 180,   // 3 minutes
      maxTurns: 1,
      description: 'Moderator summarizes; judges deliberate.',
    },
    {
      phase: DEBATE_PHASES.verdict,
      name: 'Verdict',
      order: 5,
      timeLimitSec: 0,
      maxTurns: 1,
      description: 'Final decision rendered.',
    },
  ],
  roles: [
    { role: PARTICIPANT_ROLES.proposer, min: 1, max: 1, label: 'Proposer' },
    { role: PARTICIPANT_ROLES.opposer, min: 1, max: 1, label: 'Opposer' },
    { role: PARTICIPANT_ROLES.moderator, min: 1, max: 1, label: 'Moderator' },
  ],
  rules: {
    mustAlternateTurns: true,
    proposerGoesFirst: true,
    evidenceRequired: true,
    allowCrossExamination: false,
    requireClosingStatements: true,
  },
});

/**
 * Round-Robin debate: each participant argues their position while others critique.
 *
 * - Every participant gets a turn to present
 * - All other participants may respond/critique
 * - No fixed pro/con sides — each agent defends their own position
 */
const ROUND_ROBIN = Object.freeze({
  id: DEBATE_FORMAT_IDS.roundRobin,
  name: 'Round-Robin Debate',
  description: 'Every participant presents their position and receives critique from all others.',
  phases: [
    {
      phase: DEBATE_PHASES.opening,
      name: 'Position Statements',
      order: 1,
      timeLimitSec: 180,   // 3 minutes per participant
      maxTurns: 0,         // 0 = as many as there are participants
      description: 'Each participant states their position.',
    },
    {
      phase: DEBATE_PHASES.arguments,
      name: 'Round-Robin Arguments',
      order: 2,
      timeLimitSec: 300,   // 5 minutes per participant
      maxTurns: 0,         // as many rounds as participants
      description: 'Each participant argues their position in turn.',
    },
    {
      phase: DEBATE_PHASES.rebuttals,
      name: 'Critique Round',
      order: 3,
      timeLimitSec: 240,   // 4 minutes per response
      maxTurns: 0,
      description: 'Each participant critiques every other position.',
    },
    {
      phase: DEBATE_PHASES.deliberation,
      name: 'Synthesis',
      order: 4,
      timeLimitSec: 300,
      maxTurns: 1,
      description: 'Participants identify common ground and remaining differences.',
    },
    {
      phase: DEBATE_PHASES.verdict,
      name: 'Verdict',
      order: 5,
      timeLimitSec: 0,
      maxTurns: 1,
      description: 'Best-supported position determined by scoring.',
    },
  ],
  roles: [
    { role: PARTICIPANT_ROLES.panelist, min: 2, max: 10, label: 'Participant' },
  ],
  rules: {
    mustAlternateTurns: true,
    proposerGoesFirst: false,
    evidenceRequired: true,
    allowCrossExamination: true,
    requireClosingStatements: false,
    cyclicOrder: true,       // each participant gets equal turns
  },
});

/**
 * Panel format: experts present to a moderator who synthesizes findings.
 *
 * - Experts present independently
 * - Moderator drives discussion and asks follow-ups
 * - Moderator produces final synthesis
 */
const PANEL = Object.freeze({
  id: DEBATE_FORMAT_IDS.panel,
  name: 'Panel Discussion',
  description: 'Experts present positions to a moderator who synthesizes the findings.',
  phases: [
    {
      phase: DEBATE_PHASES.opening,
      name: 'Expert Introductions',
      order: 1,
      timeLimitSec: 120,    // 2 minutes per expert
      maxTurns: 0,
      description: 'Each expert introduces their perspective.',
    },
    {
      phase: DEBATE_PHASES.arguments,
      name: 'Expert Presentations',
      order: 2,
      timeLimitSec: 360,    // 6 minutes per expert
      maxTurns: 0,
      description: 'Each expert presents their full argument with evidence.',
    },
    {
      phase: DEBATE_PHASES.rebuttals,
      name: 'Moderated Discussion',
      order: 3,
      timeLimitSec: 600,    // 10 minutes total
      maxTurns: 0,
      description: 'Moderator poses questions; experts respond and engage.',
    },
    {
      phase: DEBATE_PHASES.deliberation,
      name: 'Moderator Synthesis',
      order: 4,
      timeLimitSec: 180,
      maxTurns: 1,
      description: 'Moderator synthesizes findings into a unified view.',
    },
    {
      phase: DEBATE_PHASES.verdict,
      name: 'Panel Verdict',
      order: 5,
      timeLimitSec: 0,
      maxTurns: 1,
      description: 'Final recommendation from the moderator.',
    },
  ],
  roles: [
    { role: PARTICIPANT_ROLES.expert, min: 1, max: 8, label: 'Expert' },
    { role: PARTICIPANT_ROLES.moderator, min: 1, max: 1, label: 'Moderator' },
  ],
  rules: {
    mustAlternateTurns: false,
    proposerGoesFirst: false,
    evidenceRequired: true,
    allowCrossExamination: true,
    requireClosingStatements: false,
    moderatorDriven: true,
  },
});

/**
 * Fishbowl format: inner circle debates while outer circle observes; participants rotate in.
 *
 * - Inner circle (2-4) actively debates
 * - Outer circle observes silently
 * - Participants rotate between inner and outer circles
 * - Encourages active listening and multi-perspective understanding
 */
const FISHBOWL = Object.freeze({
  id: DEBATE_FORMAT_IDS.fishbowl,
  name: 'Fishbowl Debate',
  description: 'Inner circle debates while outer circle observes; participants rotate in.',
  phases: [
    {
      phase: DEBATE_PHASES.opening,
      name: 'Initial Seating',
      order: 1,
      timeLimitSec: 60,
      maxTurns: 1,
      description: 'Initial inner-circle participants take their seats and state positions.',
    },
    {
      phase: DEBATE_PHASES.arguments,
      name: 'Inner Circle Discussion',
      order: 2,
      timeLimitSec: 900,    // 15 minutes per rotation cycle
      maxTurns: 0,
      description: 'Inner circle debates; outer circle observes. Rotation occurs at interval.',
    },
    {
      phase: DEBATE_PHASES.rebuttals,
      name: 'Rotating Rebuttals',
      order: 3,
      timeLimitSec: 600,    // 10 minutes
      maxTurns: 0,
      description: 'As participants rotate in, they bring fresh rebuttals from the outer circle perspective.',
    },
    {
      phase: DEBATE_PHASES.deliberation,
      name: 'Full Group Deliberation',
      order: 4,
      timeLimitSec: 300,
      maxTurns: 1,
      description: 'All participants (inner + outer) deliberate together.',
    },
    {
      phase: DEBATE_PHASES.verdict,
      name: 'Consensus Verdict',
      order: 5,
      timeLimitSec: 0,
      maxTurns: 1,
      description: 'Group consensus decision.',
    },
  ],
  roles: [
    { role: PARTICIPANT_ROLES.panelist, min: 4, max: 20, label: 'Participant' },
    { role: PARTICIPANT_ROLES.observer, min: 1, max: 16, label: 'Observer' },
  ],
  rules: {
    mustAlternateTurns: false,
    proposerGoesFirst: false,
    evidenceRequired: false,
    allowCrossExamination: true,
    requireClosingStatements: false,
    innerCircleSize: 3,     // default: 3 active debaters
    rotationIntervalSec: 600, // rotate every 10 minutes
  },
});

/**
 * Socratic format: question-driven exploration to discover truth through inquiry.
 *
 * - No fixed sides — collective search for understanding
 * - Questioner challenges assumptions through questions
 * - Respondent defends or refines their position
 * - Goal is deeper understanding, not winning
 */
const SOCRATIC = Object.freeze({
  id: DEBATE_FORMAT_IDS.socratic,
  name: 'Socratic Dialogue',
  description: 'Question-driven exploration to find truth through iterative inquiry.',
  phases: [
    {
      phase: DEBATE_PHASES.opening,
      name: 'Question Framing',
      order: 1,
      timeLimitSec: 120,
      maxTurns: 1,
      description: 'The central question is framed and scope is set.',
    },
    {
      phase: DEBATE_PHASES.arguments,
      name: 'Socratic Inquiry',
      order: 2,
      timeLimitSec: 900,    // 15 minutes
      maxTurns: 0,
      description: 'Iterative rounds of questioning, response, and refinement.',
    },
    {
      phase: DEBATE_PHASES.rebuttals,
      name: 'Assumption Testing',
      order: 3,
      timeLimitSec: 480,    // 8 minutes
      maxTurns: 0,
      description: 'Key assumptions are identified and systematically tested through questioning.',
    },
    {
      phase: DEBATE_PHASES.deliberation,
      name: 'Synthesis',
      order: 4,
      timeLimitSec: 300,
      maxTurns: 1,
      description: 'What has been learned is synthesized into a refined understanding.',
    },
    {
      phase: DEBATE_PHASES.verdict,
      name: 'Truth Assessment',
      order: 5,
      timeLimitSec: 0,
      maxTurns: 1,
      description: 'Best-supported understanding emerges as the conclusion.',
    },
  ],
  roles: [
    { role: PARTICIPANT_ROLES.questioner, min: 1, max: 3, label: 'Questioner' },
    { role: PARTICIPANT_ROLES.respondent, min: 1, max: 5, label: 'Respondent' },
  ],
  rules: {
    mustAlternateTurns: true,
    proposerGoesFirst: false,
    evidenceRequired: false,
    allowCrossExamination: false,
    requireClosingStatements: false,
    questionLed: true,       // questions, not assertions, drive the debate
    collaborativeTruthSeeking: true,
  },
});

/** Lookup map of format ID to format definition. */
const FORMAT_MAP = Object.freeze({
  [DEBATE_FORMAT_IDS.oxford]: OXFORD,
  [DEBATE_FORMAT_IDS.roundRobin]: ROUND_ROBIN,
  [DEBATE_FORMAT_IDS.panel]: PANEL,
  [DEBATE_FORMAT_IDS.fishbowl]: FISHBOWL,
  [DEBATE_FORMAT_IDS.socratic]: SOCRATIC,
});

/**
 * Resolve a format identifier (string or format object) to its canonical definition.
 * @param {string|object} format - Format ID string or format object.
 * @returns {object} The canonical format definition.
 * @throws {Error} If the format is unrecognized.
 */
function resolveFormat(format) {
  if (format && typeof format === 'object' && format.id) {
    const canonical = FORMAT_MAP[format.id];
    if (canonical) {
      return canonical;
    }
    // If it looks like a custom format object with required fields, return it.
    if (Array.isArray(format.phases) && Array.isArray(format.roles) && typeof format.id === 'string') {
      return format;
    }
  }
  if (typeof format === 'string') {
    const canonical = FORMAT_MAP[format];
    if (canonical) {
      return canonical;
    }
  }
  const valid = Object.values(DEBATE_FORMAT_IDS).join(', ');
  throw new Error(`Unrecognized debate format. Must be one of: ${valid}`);
}

/**
 * Return all registered format IDs.
 * @returns {string[]}
 */
function listFormats() {
  return Object.values(DEBATE_FORMAT_IDS);
}

/**
 * Get the ordered list of phases for a given format.
 * @param {string|object} format
 * @returns {object[]}
 */
function getPhases(format) {
  const def = resolveFormat(format);
  return def.phases.slice().sort((a, b) => a.order - b.order);
}

/**
 * Validate that a set of participants satisfies the role requirements of a format.
 * @param {string|object} format
 * @param {{ agentId: string, role: string }[]} participants
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateParticipants(format, participants) {
  const def = resolveFormat(format);
  const errors = [];

  if (!Array.isArray(participants) || participants.length === 0) {
    errors.push('At least one participant is required.');
    return { valid: false, errors };
  }

  const roleCounts = {};
  for (const p of participants) {
    if (!p || typeof p.role !== 'string') {
      errors.push('Each participant must have a valid role.');
      continue;
    }
    roleCounts[p.role] = (roleCounts[p.role] || 0) + 1;
  }

  for (const roleSpec of def.roles) {
    const count = roleCounts[roleSpec.role] || 0;
    if (count < roleSpec.min) {
      errors.push(`Role '${roleSpec.role}' requires at least ${roleSpec.min} participant(s), got ${count}.`);
    }
    if (count > roleSpec.max) {
      errors.push(`Role '${roleSpec.role}' allows at most ${roleSpec.max} participant(s), got ${count}.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  DEBATE_FORMAT_IDS,
  DEBATE_PHASES,
  FISHBOWL,
  FORMAT_MAP,
  OXFORD,
  PANEL,
  PARTICIPANT_ROLES,
  ROUND_ROBIN,
  SOCRATIC,
  getPhases,
  listFormats,
  resolveFormat,
  validateParticipants,
};
