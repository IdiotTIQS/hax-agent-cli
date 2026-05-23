"use strict";

/**
 * Behavior modifiers — situational overlays that adjust agent behavior
 * for specific contexts without changing the underlying personality.
 *
 * Unlike personality profiles (which define a stable behavioral baseline),
 * behavior modifiers are temporary adjustments applied for a specific
 * task or session. Multiple modifiers can be stacked together.
 */

// ---------------------------------------------------------------------------
// Pre-built behavior modifiers
// ---------------------------------------------------------------------------

/**
 * URGENT — Time pressure, prioritize speed over completeness.
 * Best for: critical fixes, time-sensitive responses, quick patches.
 */
const URGENT = Object.freeze({
  name: 'Urgent',
  description: 'Time is critical. Prioritize speed over completeness.',
  instructions: [
    'TIME PRESSURE: You are operating under severe time constraints.',
    '- Give the fastest possible answer that solves the problem.',
    '- Skip explanations, background, and alternatives unless they are essential to the answer.',
    '- If there are multiple solutions, pick the quickest one to implement.',
    '- If you cannot give a complete answer, give the best available partial answer.',
    '- Flag any risks or assumptions rather than verifying them.',
  ],
  marker: '[URGENT]',
});

/**
 * DEEP_DIVE — Thorough analysis, no time limit concern.
 * Best for: architecture reviews, security audits, comprehensive analysis.
 */
const DEEP_DIVE = Object.freeze({
  name: 'Deep Dive',
  description: 'Thorough, comprehensive analysis with no time pressure.',
  instructions: [
    'DEEP ANALYSIS MODE: Take as much time and detail as the problem deserves.',
    '- Explore every angle, edge case, and alternative.',
    '- Challenge your own conclusions. Look for counter-examples.',
    '- Document your reasoning process so it can be reviewed.',
    '- Consider second-order effects and long-term implications.',
    '- When in doubt, go deeper rather than staying shallow.',
    '- Produce a comprehensive analysis, not a quick answer.',
  ],
  marker: '[DEEP_DIVE]',
});

/**
 * PAIR_PROGRAMMING — Collaborative, ask clarifying questions.
 * Best for: collaborative coding, mentoring sessions, design discussions.
 */
const PAIR_PROGRAMMING = Object.freeze({
  name: 'Pair Programming',
  description: 'Collaborative mode — think aloud, ask questions, discuss tradeoffs.',
  instructions: [
    'PAIR PROGRAMMING MODE: You are collaborating closely with a human partner.',
    '- Think aloud: explain what you are doing and why as you go.',
    '- Ask clarifying questions when requirements are ambiguous.',
    '- Propose alternatives and discuss tradeoffs before committing to an approach.',
    '- When you disagree with a direction, say so respectfully and explain why.',
    '- Keep the conversation flowing. Do not go silent for long stretches.',
    '- After each significant step, pause and ask if the direction looks right.',
  ],
  marker: '[PAIR]',
});

/**
 * CODE_REVIEW_MODE — Critical, look for issues.
 * Best for: pull request reviews, code audits, quality checks.
 */
const CODE_REVIEW_MODE = Object.freeze({
  name: 'Code Review Mode',
  description: 'Critical evaluation mode — actively look for issues and improvements.',
  instructions: [
    'CODE REVIEW MODE: You are critically evaluating code for issues.',
    '- Assume nothing. Verify everything.',
    '- Look for: correctness, security, performance, maintainability, and consistency.',
    '- For every finding, cite the specific location and explain the concern.',
    '- Classify issues by severity: BLOCKER, HIGH, MEDIUM, LOW.',
    '- Do not just find problems — suggest concrete improvements.',
    '- Flag things that look suspicious even if you cannot confirm they are bugs.',
    '- Be thorough but fair. Acknowledge what is done well.',
  ],
  marker: '[REVIEW]',
});

/**
 * ONBOARDING — Educational, explain concepts.
 * Best for: new team members, learning sessions, documentation.
 */
const ONBOARDING = Object.freeze({
  name: 'Onboarding',
  description: 'Educational mode — explain concepts, provide context, teach as you go.',
  instructions: [
    'ONBOARDING MODE: You are teaching someone who is learning the system.',
    '- Assume the reader is technically competent but unfamiliar with this specific codebase.',
    '- Explain concepts and conventions as you encounter them.',
    '- Define acronyms and domain-specific terms on first use.',
    '- Show not just WHAT you are doing, but WHY and HOW it fits into the bigger picture.',
    '- Point out patterns and conventions that repeat throughout the codebase.',
    '- Provide references to documentation, style guides, or relevant resources.',
    '- Be patient. Learning takes time.',
  ],
  marker: '[ONBOARD]',
});

/**
 * DEBUGGING — Systematic, hypothesis-driven.
 * Best for: bug hunting, incident response, root cause analysis.
 */
const DEBUGGING = Object.freeze({
  name: 'Debugging',
  description: 'Systematic debugging mode — form hypotheses, test them, eliminate possibilities.',
  instructions: [
    'DEBUGGING MODE: You are systematically investigating an issue.',
    '- Reproduce the issue first. Do not attempt fixes until you understand the problem.',
    '- Form explicit hypotheses and test them one at a time.',
    '- Change one thing at a time. Multiple simultaneous changes obscure the root cause.',
    '- Document what you tried, what you observed, and what you concluded.',
    '- Check your assumptions. The bug is almost always in your code, not the framework.',
    '- Once you find the root cause, check for similar issues elsewhere.',
    '- After fixing, verify the fix and add a test to prevent regression.',
  ],
  marker: '[DEBUG]',
});

const ALL_MODIFIERS = Object.freeze([
  URGENT,
  DEEP_DIVE,
  PAIR_PROGRAMMING,
  CODE_REVIEW_MODE,
  ONBOARDING,
  DEBUGGING,
]);

// ---------------------------------------------------------------------------
// Marker strings used to delimit modifier blocks in prompts
// ---------------------------------------------------------------------------

const MARKER_PREFIX = '---[modifier:';
const MARKER_SUFFIX = ']---';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that an object is a well-formed behavior modifier.
 *
 * @param {object} modifier
 * @returns {boolean}
 */
function isValidModifier(modifier) {
  return !!(
    modifier &&
    typeof modifier === 'object' &&
    typeof modifier.name === 'string' && modifier.name.length > 0 &&
    typeof modifier.description === 'string' &&
    Array.isArray(modifier.instructions) &&
    modifier.instructions.length > 0 &&
    typeof modifier.marker === 'string' && modifier.marker.length > 0
  );
}

/**
 * Look up a modifier by name (case-insensitive match against modifier.name).
 *
 * @param {string} name
 * @returns {object|null}
 */
function getModifierByName(name) {
  if (typeof name !== 'string') return null;
  const lower = name.toLowerCase();
  return ALL_MODIFIERS.find((m) => m.name.toLowerCase() === lower) || null;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Apply a single behavior modifier to a prompt.
 *
 * Injects the modifier's behavioral instructions into the prompt as a
 * delimited block that can later be removed by clearModifiers().
 *
 * @param {string} prompt - The base prompt to augment.
 * @param {object|string} modifier - A BehaviorModifier object or modifier name string.
 * @returns {string} The augmented prompt with modifier instructions.
 */
function applyModifier(prompt, modifier) {
  if (!prompt || typeof prompt !== 'string') {
    return '';
  }

  const resolved = typeof modifier === 'string' ? getModifierByName(modifier) : modifier;
  if (!isValidModifier(resolved)) {
    return prompt;
  }

  const block = [
    MARKER_PREFIX + resolved.name.toUpperCase().replace(/\s+/g, '_') + MARKER_SUFFIX,
    '# ' + resolved.name + ' Mode',
    '',
    resolved.description ? resolved.description + '\n' : '',
    ...resolved.instructions,
    MARKER_PREFIX + 'END' + MARKER_SUFFIX,
  ].join('\n');

  return [prompt, block].filter(Boolean).join('\n\n');
}

/**
 * Stack multiple behavior modifiers together.
 *
 * All modifiers are applied in order. Each modifier's instructions are
 * injected independently. The combined result is a single prompt string.
 *
 * @param {Array<object|string>} modifiers - Array of modifier objects or name strings.
 * @returns {Array<string>} An array of modifier instruction blocks ready to use.
 *   Callers should join these into their prompt manually or use applyModifier
 *   for individual application.
 */
function stackModifiers(modifiers) {
  if (!Array.isArray(modifiers)) {
    return [];
  }

  return modifiers
    .map((m) => {
      const resolved = typeof m === 'string' ? getModifierByName(m) : m;
      if (!isValidModifier(resolved)) return null;

      return [
        MARKER_PREFIX + resolved.name.toUpperCase().replace(/\s+/g, '_') + MARKER_SUFFIX,
        '# ' + resolved.name + ' Mode',
        '',
        resolved.description ? resolved.description + '\n' : '',
        ...resolved.instructions,
        MARKER_PREFIX + 'END' + MARKER_SUFFIX,
      ].join('\n');
    })
    .filter(Boolean);
}

/**
 * Remove all modifier instruction blocks from a prompt.
 *
 * Scans for marker-delimited blocks (inserted by applyModifier or
 * stackModifiers) and removes them, leaving only the base prompt and
 * any non-modifier content.
 *
 * @param {string} prompt - The prompt potentially containing modifier blocks.
 * @returns {string} The prompt with all modifier blocks removed.
 */
function clearModifiers(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return '';
  }

  // Remove blocks delimited by MARKER_PREFIX ... MARKER_PREFIX+END+MARKER_SUFFIX
  // This regex matches from a modifier start marker to the next END marker
  const blockPattern = new RegExp(
    escapeRegex(MARKER_PREFIX) + '[^]*?' + escapeRegex(MARKER_PREFIX + 'END' + MARKER_SUFFIX),
    'g',
  );

  let cleaned = prompt.replace(blockPattern, '');

  // Clean up extra whitespace left behind
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * List all modifier names currently active in a prompt.
 *
 * Parses the marker blocks and returns an array of modifier names found.
 *
 * @param {string} prompt - The prompt to inspect.
 * @returns {Array<string>} Array of active modifier names.
 */
function activeModifiers(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return [];
  }

  const pattern = new RegExp(
    escapeRegex(MARKER_PREFIX) + '([A-Z_]+)' + escapeRegex(MARKER_SUFFIX),
    'g',
  );

  const names = new Set();
  let match;
  while ((match = pattern.exec(prompt)) !== null) {
    if (match[1] !== 'END') {
      // Convert back to human-readable name
      const readable = match[1]
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      names.add(readable);
    }
  }

  return Array.from(names);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Escape special regex characters in a string.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  // Pre-built modifiers
  URGENT,
  DEEP_DIVE,
  PAIR_PROGRAMMING,
  CODE_REVIEW_MODE,
  ONBOARDING,
  DEBUGGING,
  ALL_MODIFIERS,

  // Core API
  applyModifier,
  stackModifiers,
  clearModifiers,
  activeModifiers,

  // Helpers
  isValidModifier,
  getModifierByName,
};
