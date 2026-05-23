"use strict";

/**
 * Personality profiles for agent behavior configuration.
 *
 * Each profile defines a five-dimensional behavioral vector that adjusts
 * how an agent communicates and makes decisions:
 *
 *   verbosity     (1-5): concise/minimal → detailed/exhaustive explanations
 *   riskTolerance (1-5): cautious/safe → adventurous/experimental
 *   creativity    (1-5): precise/deterministic → creative/exploratory
 *   formality     (1-5): casual/relaxed → formal/professional
 *   autonomy      (1-5): needs guidance/frequent check-ins → independent/self-directed
 *
 * Profiles can be applied to system prompts, blended together, or
 * converted to human-readable behavior descriptions.
 */

const DIMENSION_LABELS = Object.freeze({
  verbosity: 'Verbosity',
  riskTolerance: 'Risk Tolerance',
  creativity: 'Creativity',
  formality: 'Formality',
  autonomy: 'Autonomy',
});

const DIMENSION_KEYS = Object.freeze(Object.keys(DIMENSION_LABELS));

const VERBOSITY_DESCRIPTIONS = Object.freeze({
  1: 'Be extremely concise. Give the shortest possible answer that fully addresses the question. Omit background, rationale, and examples unless explicitly requested.',
  2: 'Be brief. Provide essential information with minimal elaboration. Include rationale only when the decision is non-obvious.',
  3: 'Provide balanced explanations. Include relevant context and brief rationale without being verbose.',
  4: 'Provide thorough explanations. Include background, reasoning, alternatives considered, and relevant examples.',
  5: 'Provide exhaustive explanations. Include comprehensive background, detailed reasoning, multiple alternatives, examples, edge cases, and references.',
});

const RISK_DESCRIPTIONS = Object.freeze({
  1: 'Be extremely cautious. Flag every risk, edge case, and potential failure mode. Prefer the safest possible approach. Ask for confirmation before any irreversible action.',
  2: 'Be careful. Highlight significant risks and prefer well-established approaches. Test changes thoroughly before recommending them.',
  3: 'Take calculated risks. Balance safety with pragmatism. Consider both established and modern approaches.',
  4: 'Be adventurous. Explore novel solutions and cutting-edge approaches. Accept higher risk for potentially better outcomes.',
  5: 'Be boldly experimental. Push boundaries, explore unconventional solutions, and embrace high-risk high-reward approaches.',
});

const CREATIVITY_DESCRIPTIONS = Object.freeze({
  1: 'Be precise and deterministic. Follow established patterns exactly. Do not improvise or deviate from specifications.',
  2: 'Be mostly conventional. Stick to proven patterns but allow minor variations when appropriate.',
  3: 'Balance convention with creativity. Use established patterns as a foundation but feel free to adapt and improve.',
  4: 'Be inventive. Generate novel approaches and unexpected solutions. Challenge assumptions and conventional wisdom.',
  5: 'Be wildly creative. Brainstorm unconventional ideas, explore multiple divergent paths, and synthesize unexpected connections.',
});

const FORMALITY_DESCRIPTIONS = Object.freeze({
  1: 'Be casual and conversational. Use contractions, colloquial language, and a friendly tone. Write as if chatting with a colleague.',
  2: 'Be relaxed but professional. Use a conversational tone while maintaining basic professional standards.',
  3: 'Be professionally neutral. Use standard professional language without being overly formal or overly casual.',
  4: 'Be formal. Use precise language, proper grammar, and a respectful tone. Avoid contractions and colloquialisms.',
  5: 'Be highly formal. Use academic or diplomatic language. Structure responses with formal sections. Avoid any casual language.',
});

const AUTONOMY_DESCRIPTIONS = Object.freeze({
  1: 'Seek frequent guidance. Ask clarifying questions before proceeding. Confirm each major decision. Do not assume intent.',
  2: 'Confirm key decisions. Proceed independently on routine matters but ask for guidance on significant choices.',
  3: 'Operate with balanced autonomy. Make reasonable decisions independently but escalate when genuinely uncertain.',
  4: 'Act independently. Make decisions and execute without asking for confirmation. Only escalate truly exceptional situations.',
  5: 'Act with full autonomy. Take initiative, make all decisions independently, and report results rather than asking for permission.',
});

// ---------------------------------------------------------------------------
// Pre-built profiles
// ---------------------------------------------------------------------------

/**
 * PRECISE — Maximum accuracy, minimal fluff.
 * Best for: code generation, data processing, formal specifications.
 */
const PRECISE = Object.freeze({
  name: 'Precise',
  description: 'Maximum accuracy with minimal fluff. Focused on correctness and conciseness.',
  verbosity: 1,
  riskTolerance: 1,
  creativity: 1,
  formality: 4,
  autonomy: 4,
});

/**
 * BALANCED — The default, all-purpose profile.
 * Best for: general assistance, everyday development tasks.
 */
const BALANCED = Object.freeze({
  name: 'Balanced',
  description: 'A well-rounded profile suitable for most general-purpose tasks.',
  verbosity: 3,
  riskTolerance: 3,
  creativity: 3,
  formality: 3,
  autonomy: 3,
});

/**
 * CREATIVE — High creativity, exploratory mindset.
 * Best for: brainstorming, design, architecture exploration, content creation.
 */
const CREATIVE = Object.freeze({
  name: 'Creative',
  description: 'Exploratory, inventive, and open to unconventional approaches.',
  verbosity: 4,
  riskTolerance: 4,
  creativity: 5,
  formality: 2,
  autonomy: 4,
});

/**
 * AUDITOR — Systematic, thorough, risk-averse.
 * Best for: code review, security audit, compliance checking.
 */
const AUDITOR = Object.freeze({
  name: 'Auditor',
  description: 'Systematic and thorough, focused on finding issues and verifying correctness.',
  verbosity: 4,
  riskTolerance: 1,
  creativity: 1,
  formality: 5,
  autonomy: 5,
});

/**
 * MENTOR — Educational, patient, thorough.
 * Best for: onboarding, teaching, explaining concepts.
 */
const MENTOR = Object.freeze({
  name: 'Mentor',
  description: 'Patient, educational, and thorough. Focused on teaching and explaining.',
  verbosity: 5,
  riskTolerance: 2,
  creativity: 3,
  formality: 2,
  autonomy: 2,
});

/**
 * EXPLORER — Curious, broad, connective.
 * Best for: research, landscape analysis, technology evaluation.
 */
const EXPLORER = Object.freeze({
  name: 'Explorer',
  description: 'Curious and broad, connecting ideas across domains and exploring possibilities.',
  verbosity: 4,
  riskTolerance: 4,
  creativity: 5,
  formality: 2,
  autonomy: 5,
});

/**
 * SURGEON — Precise, decisive, high-autonomy.
 * Best for: targeted fixes, refactoring, surgical code changes.
 */
const SURGEON = Object.freeze({
  name: 'Surgeon',
  description: 'Precise and decisive, making targeted changes with surgical accuracy.',
  verbosity: 1,
  riskTolerance: 3,
  creativity: 2,
  formality: 3,
  autonomy: 5,
});

/**
 * SHERLOCK — Investigative, evidence-based, systematic.
 * Best for: debugging, root cause analysis, incident investigation.
 */
const SHERLOCK = Object.freeze({
  name: 'Sherlock',
  description: 'Investigative and evidence-based, systematically eliminating possibilities to find the truth.',
  verbosity: 3,
  riskTolerance: 2,
  creativity: 2,
  formality: 4,
  autonomy: 5,
});

const ALL_PROFILES = Object.freeze([
  PRECISE,
  BALANCED,
  CREATIVE,
  AUDITOR,
  MENTOR,
  EXPLORER,
  SURGEON,
  SHERLOCK,
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that an object is a well-formed personality profile.
 *
 * @param {object} profile
 * @returns {boolean}
 */
function isValidProfile(profile) {
  if (!profile || typeof profile !== 'object') return false;
  return DIMENSION_KEYS.every(
    (key) => typeof profile[key] === 'number' && profile[key] >= 1 && profile[key] <= 5
  );
}

/**
 * Validate a single dimension value.
 *
 * @param {number} value
 * @returns {boolean}
 */
function isValidDimension(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * Clamp a dimension value to the valid range [1, 5].
 *
 * @param {number} value
 * @returns {number}
 */
function clampDimension(value) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Apply a personality profile to a base system prompt.
 *
 * Injects behavioral instructions derived from the profile's dimensions
 * into the prompt. The instructions are appended as a formatted block.
 *
 * @param {string} basePrompt - The base system prompt to augment.
 * @param {object} profile - A personality profile with dimension values.
 * @returns {string} The augmented prompt with behavioral instructions.
 */
function applyProfile(basePrompt, profile) {
  if (!basePrompt || typeof basePrompt !== 'string') {
    return '';
  }
  if (!isValidProfile(profile)) {
    return basePrompt;
  }

  const behaviorBlock = profileToPrompt(profile);
  if (!behaviorBlock) {
    return basePrompt;
  }

  return [basePrompt, behaviorBlock].filter(Boolean).join('\n\n');
}

/**
 * Blend two personality profiles together by a given ratio.
 *
 * At ratio 0.0 the result equals profileA, at ratio 1.0 it equals profileB.
 * Values in between produce a weighted average (rounded to nearest integer).
 * The resulting profile is NOT frozen so callers can further customize it.
 *
 * @param {object} profileA - The first profile (used when ratio = 0).
 * @param {object} profileB - The second profile (used when ratio = 1).
 * @param {number} [ratio=0.5] - Blend ratio between 0 and 1.
 * @returns {object} A new blended profile object.
 */
function blendProfiles(profileA, profileB, ratio) {
  if (!isValidProfile(profileA) || !isValidProfile(profileB)) {
    return null;
  }

  const r = typeof ratio === 'number' ? Math.max(0, Math.min(1, ratio)) : 0.5;

  const blended = {
    name: `Blend(${profileA.name},${profileB.name})`,
    description: `Blend of ${profileA.name} (${Math.round((1 - r) * 100)}%) and ${profileB.name} (${Math.round(r * 100)}%).`,
  };

  for (const key of DIMENSION_KEYS) {
    blended[key] = Math.round(profileA[key] * (1 - r) + profileB[key] * r);
  }

  return blended;
}

/**
 * Generate a human-readable behavior description from a personality profile.
 *
 * Produces a formatted markdown block that instructs the agent on how to
 * adjust its behavior along each dimension.
 *
 * @param {object} profile - A personality profile with dimension values.
 * @returns {string} A formatted behavior instruction block.
 */
function profileToPrompt(profile) {
  if (!isValidProfile(profile)) {
    return '';
  }

  const lines = [
    '---',
    '# Personality & Behavioral Guidelines',
    '',
    `Profile: ${profile.name || 'Custom'}`,
    profile.description ? `\n${profile.description}\n` : '',
    '',
    'Adjust your behavior according to the following guidelines:',
    '',
  ].filter(Boolean);

  const dimensionGenerators = {
    verbosity: (v) => VERBOSITY_DESCRIPTIONS[v],
    riskTolerance: (v) => RISK_DESCRIPTIONS[v],
    creativity: (v) => CREATIVITY_DESCRIPTIONS[v],
    formality: (v) => FORMALITY_DESCRIPTIONS[v],
    autonomy: (v) => AUTONOMY_DESCRIPTIONS[v],
  };

  for (const key of DIMENSION_KEYS) {
    const value = profile[key];
    const label = DIMENSION_LABELS[key];
    const description = dimensionGenerators[key](value);
    const bar = '█'.repeat(value) + '░'.repeat(5 - value);
    lines.push(`## ${label} [${bar}] (${value}/5)`);
    lines.push('');
    lines.push(description);
    lines.push('');
  }

  lines.push('---');

  return lines.join('\n');
}

/**
 * Create a custom profile from individual dimension values.
 *
 * Missing dimensions default to the BALANCED profile's values.
 * Values are clamped to the valid range [1, 5].
 *
 * @param {object} dimensions - Partial dimension values.
 * @param {string} [dimensions.name='Custom'] - Profile name.
 * @param {string} [dimensions.description] - Profile description.
 * @param {number} [dimensions.verbosity] - Verbosity level (1-5).
 * @param {number} [dimensions.riskTolerance] - Risk tolerance level (1-5).
 * @param {number} [dimensions.creativity] - Creativity level (1-5).
 * @param {number} [dimensions.formality] - Formality level (1-5).
 * @param {number} [dimensions.autonomy] - Autonomy level (1-5).
 * @returns {object} A new profile object.
 */
function createProfile(dimensions) {
  if (!dimensions || typeof dimensions !== 'object') {
    return null;
  }

  const profile = {
    name: dimensions.name || 'Custom',
    description: dimensions.description || 'A custom personality profile.',
  };

  for (const key of DIMENSION_KEYS) {
    const raw = dimensions[key];
    profile[key] = isValidDimension(raw) ? raw : BALANCED[key];
  }

  return profile;
}

/**
 * Get the Euclidean distance between two profiles in dimension space.
 *
 * @param {object} profileA
 * @param {object} profileB
 * @returns {number} Distance, or -1 if either profile is invalid.
 */
function profileDistance(profileA, profileB) {
  if (!isValidProfile(profileA) || !isValidProfile(profileB)) {
    return -1;
  }

  const sumSquares = DIMENSION_KEYS.reduce((sum, key) => {
    const diff = profileA[key] - profileB[key];
    return sum + diff * diff;
  }, 0);

  return Math.sqrt(sumSquares);
}

module.exports = {
  // Constants
  DIMENSION_LABELS,
  DIMENSION_KEYS,
  VERBOSITY_DESCRIPTIONS,
  RISK_DESCRIPTIONS,
  CREATIVITY_DESCRIPTIONS,
  FORMALITY_DESCRIPTIONS,
  AUTONOMY_DESCRIPTIONS,

  // Pre-built profiles
  PRECISE,
  BALANCED,
  CREATIVE,
  AUDITOR,
  MENTOR,
  EXPLORER,
  SURGEON,
  SHERLOCK,
  ALL_PROFILES,

  // Core API
  applyProfile,
  blendProfiles,
  profileToPrompt,
  createProfile,
  profileDistance,

  // Helpers
  isValidProfile,
  isValidDimension,
  clampDimension,
};
