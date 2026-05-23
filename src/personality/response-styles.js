"use strict";

/**
 * Response styles for controlling how agents format and deliver their output.
 *
 * A ResponseStyle defines the tone, sentence structure, formatting,
 * and communication patterns an agent uses when responding.
 *
 * Unlike personality profiles (which control decision-making behavior),
 * response styles focus purely on the output shape and delivery.
 */

// ---------------------------------------------------------------------------
// Pre-built response styles
// ---------------------------------------------------------------------------

/**
 * CONCISE — Short, direct, minimal.
 * Best for: quick answers, status updates, simple confirmations.
 */
const CONCISE = Object.freeze({
  name: 'Concise',
  description: 'Short, direct responses with minimal elaboration.',
  tone: 'Direct and matter-of-fact.',
  sentenceStructure: 'Short sentences. One idea per sentence. No fluff.',
  formattingPreferences: [
    'Minimal formatting — plain text preferred.',
    'Bullet points only for lists of 3+ items.',
    'No nested formatting.',
    'Answer first, explanation only if requested.',
  ],
  exampleSignature: 'Answer. (Brief why if needed.)',
});

/**
 * EXPLANATORY — Clear, thorough, reasoning-focused.
 * Best for: architecture decisions, technical analysis, code reviews.
 */
const EXPLANATORY = Object.freeze({
  name: 'Explanatory',
  description: 'Thorough explanations with clear reasoning and supporting detail.',
  tone: 'Clear and instructive. Patient without being condescending.',
  sentenceStructure: 'Complete sentences with logical connectors (because, therefore, however). One paragraph per idea.',
  formattingPreferences: [
    'Use headers to organize sections.',
    'Include code examples where helpful.',
    'Use bullet lists for alternatives and tradeoffs.',
    'Numbered lists for sequential steps or ranked items.',
    'Tables for comparative data.',
  ],
  exampleSignature: 'Answer with context, reasoning, and supporting details.',
});

/**
 * TUTORIAL — Step-by-step, educational.
 * Best for: onboarding, how-to guides, teaching new concepts.
 */
const TUTORIAL = Object.freeze({
  name: 'Tutorial',
  description: 'Step-by-step educational responses designed for learning.',
  tone: 'Encouraging and patient. Assume the reader is learning.',
  sentenceStructure: 'Clear, simple sentences. Introduce concepts before using them. Build from simple to complex.',
  formattingPreferences: [
    'Numbered steps for sequential instructions.',
    'Code examples at every step.',
    'Use "Expected output" after code blocks.',
    'Include "Common mistakes" or "Watch out" callouts.',
    'Recap key points at the end.',
    'Emphasize WHY, not just WHAT.',
  ],
  exampleSignature: 'Step-by-step walkthrough with explanations at each stage.',
});

/**
 * ANALYTICAL — Data-driven, structured, evidence-based.
 * Best for: data analysis, performance reports, metrics discussion.
 */
const ANALYTICAL = Object.freeze({
  name: 'Analytical',
  description: 'Data-driven, structured responses with evidence and metrics.',
  tone: 'Objective and precise. Factual, not opinionated.',
  sentenceStructure: 'Precise language. Quantify whenever possible. "X decreased by 23%" not "X got faster."',
  formattingPreferences: [
    'Lead with the key finding or metric.',
    'Use tables for numerical data.',
    'Include methodology notes (how data was collected, sample size, confidence).',
    'Use charts/ASCII diagrams for trends (when text-only).',
    'Separate observations from interpretations.',
    'End with actionable conclusions.',
  ],
  exampleSignature: 'Finding > Evidence > Methodology > Interpretation > Recommendation.',
});

/**
 * CONVERSATIONAL — Friendly, approachable, engaging.
 * Best for: general chat, brainstorming sessions, UX feedback.
 */
const CONVERSATIONAL = Object.freeze({
  name: 'Conversational',
  description: 'Friendly, approachable responses that feel like a dialogue.',
  tone: 'Warm and engaging. Use contractions and natural language.',
  sentenceStructure: 'Natural flow. Mix short and medium sentences. Ask questions to engage.',
  formattingPreferences: [
    'Minimal formal formatting.',
    'Use em dashes and natural punctuation.',
    'Ask follow-up questions when appropriate.',
    'Acknowledge the user\'s perspective.',
    'Use "we" and "you" to create collaboration feel.',
  ],
  exampleSignature: 'Friendly response that invites further discussion.',
});

/**
 * TECHNICAL — Precise, terminology-heavy, implementation-focused.
 * Best for: API documentation, system design, code generation.
 */
const TECHNICAL = Object.freeze({
  name: 'Technical',
  description: 'Precise, terminology-rich responses focused on implementation details.',
  tone: 'Professional and precise. Use domain terminology correctly.',
  sentenceStructure: 'Technical precision over readability. Use exact terms. Prefer specificity over approachability.',
  formattingPreferences: [
    'Heavy use of code formatting for technical terms.',
    'Include type signatures, interfaces, and schemas.',
    'Use diagrams (ASCII art) for architecture.',
    'Reference specific API versions and methods.',
    'Include performance characteristics and Big-O notation.',
    'Link to relevant documentation or RFCs.',
  ],
  exampleSignature: 'Precise technical answer with implementation details.',
});

const ALL_STYLES = Object.freeze([
  CONCISE,
  EXPLANATORY,
  TUTORIAL,
  ANALYTICAL,
  CONVERSATIONAL,
  TECHNICAL,
]);

// ---------------------------------------------------------------------------
// Style features for detection
// ---------------------------------------------------------------------------

/**
 * Heuristic signatures used by detectStyle() to guess a response's style.
 * Each entry has a `score` function that returns 0-1 for how well the
 * text matches that style.
 */
const STYLE_DETECTORS = Object.freeze({
  CONCISE: (text) => {
    const sentences = text.split(/[.!?]+/).filter(Boolean);
    if (sentences.length === 0) return 0;
    const avgWords = sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / sentences.length;
    const hasFormatting = /[*_`#]/.test(text);
    let score = 0;
    // Few words per sentence
    if (avgWords <= 10) score += 0.4;
    else if (avgWords <= 15) score += 0.2;
    // Short overall
    if (text.length < 200) score += 0.3;
    else if (text.length < 500) score += 0.15;
    // Minimal formatting
    if (!hasFormatting) score += 0.3;
    return Math.min(1, score);
  },

  EXPLANATORY: (text) => {
    const sentences = text.split(/[.!?]+/).filter(Boolean);
    if (sentences.length === 0) return 0;
    const avgWords = sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / sentences.length;
    const hasHeaders = /^#{1,3}\s/m.test(text);
    const hasBullets = /^[-*]\s/m.test(text);
    const hasConnectors = /\b(because|therefore|however|thus|consequently|alternatively)\b/i.test(text);
    let score = 0;
    if (avgWords >= 12 && avgWords <= 25) score += 0.3;
    if (hasHeaders) score += 0.25;
    if (hasBullets) score += 0.2;
    if (hasConnectors) score += 0.25;
    return Math.min(1, score);
  },

  TUTORIAL: (text) => {
    const hasNumberedSteps = /^\d+[\.)]\s/m.test(text);
    const hasCodeBlocks = /```[\s\S]*?```/.test(text) || /`[^`]+`/.test(text);
    const hasInstructional = /\b(first|next|then|finally|now|let's|try|notice|observe|check|verify|run|execute)\b/i.test(text);
    const hasOutput = /output|result|expect|you should see/i.test(text);
    let score = 0;
    if (hasNumberedSteps) score += 0.3;
    if (hasCodeBlocks) score += 0.25;
    if (hasInstructional) score += 0.25;
    if (hasOutput) score += 0.2;
    return Math.min(1, score);
  },

  ANALYTICAL: (text) => {
    const hasNumbers = /\d+[\.,]?\d*\s*(%|ms|s|MB|GB|rps|rpm|times|requests|users)/.test(text);
    const hasComparisons = /\b(compared|versus|vs\.?|increased|decreased|improved|declined|reduced|grew)\b/i.test(text);
    const hasTables = /\|.*\|.*\|/.test(text);
    const hasConclusion = /\b(conclusion|finding|recommendation|insight|takeaway)\b/i.test(text);
    let score = 0;
    if (hasNumbers) score += 0.3;
    if (hasComparisons) score += 0.3;
    if (hasTables) score += 0.2;
    if (hasConclusion) score += 0.2;
    return Math.min(1, score);
  },

  CONVERSATIONAL: (text) => {
    const hasContractions = /\b(I'm|you're|we're|it's|that's|don't|can't|won't|let's)\b/i.test(text);
    const hasQuestions = /\?/.test(text);
    const hasPersonalPronouns = /\b(I|we|you)\b/i.test(text);
    const hasEmotional = /\b(great|awesome|cool|nice|sorry|thanks|wow|interesting|fun)\b/i.test(text);
    const lowFormatting = !/[#*`|]/.test(text);
    let score = 0;
    if (hasContractions) score += 0.3;
    if (hasQuestions) score += 0.2;
    if (hasPersonalPronouns) score += 0.2;
    if (hasEmotional) score += 0.15;
    if (lowFormatting) score += 0.15;
    return Math.min(1, score);
  },

  TECHNICAL: (text) => {
    const hasCodeBlocks = /```[\s\S]*?```/.test(text);
    const hasInlineCode = /`[^`]+`/.test(text);
    const hasTypeNotation = /\b(string|number|boolean|void|Promise|Array|Map|Set|interface|type|enum|class|function)\b/.test(text);
    const hasApiRefs = /\b(API|SDK|endpoint|method|param|return|throws|async|await)\b/i.test(text);
    const hasBigO = /O\([^)]+\)/.test(text);
    const hasComplexTerms = /\b(implementation|architecture|protocol|algorithm|schema|serialize|deserialize|middleware)\b/i.test(text);
    let score = 0;
    if (hasCodeBlocks) score += 0.25;
    if (hasInlineCode) score += 0.2;
    if (hasTypeNotation) score += 0.2;
    if (hasApiRefs) score += 0.15;
    if (hasBigO) score += 0.1;
    if (hasComplexTerms) score += 0.1;
    return Math.min(1, score);
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that an object is a well-formed response style.
 *
 * @param {object} style
 * @returns {boolean}
 */
function isValidStyle(style) {
  return !!(
    style &&
    typeof style === 'object' &&
    typeof style.name === 'string' && style.name.length > 0 &&
    typeof style.description === 'string' &&
    typeof style.tone === 'string' &&
    typeof style.sentenceStructure === 'string' &&
    Array.isArray(style.formattingPreferences) &&
    style.formattingPreferences.length > 0
  );
}

/**
 * Look up a style by name (case-insensitive match against style.name).
 *
 * @param {string} name
 * @returns {object|null}
 */
function getStyleByName(name) {
  if (typeof name !== 'string') return null;
  const lower = name.toLowerCase();
  return ALL_STYLES.find((s) => s.name.toLowerCase() === lower) || null;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Apply a response style to a prompt by injecting formatting instructions.
 *
 * Appends a formatted style block that instructs the agent on tone,
 * sentence structure, and formatting preferences.
 *
 * @param {string} prompt - The base prompt to augment.
 * @param {object|string} style - A ResponseStyle object or a style name string.
 * @returns {string} The augmented prompt with style instructions.
 */
function applyStyle(prompt, style) {
  if (!prompt || typeof prompt !== 'string') {
    return '';
  }

  const resolved = typeof style === 'string' ? getStyleByName(style) : style;
  if (!isValidStyle(resolved)) {
    return prompt;
  }

  const styleBlock = [
    '---',
    '# Response Style',
    '',
    `Style: ${resolved.name}`,
    resolved.description ? `\n${resolved.description}\n` : '',
    `## Tone`,
    resolved.tone,
    '',
    '## Sentence Structure',
    resolved.sentenceStructure,
    '',
    '## Formatting Preferences',
    ...resolved.formattingPreferences.map((pref) => `- ${pref}`),
    '',
    '---',
  ].join('\n');

  return [prompt, styleBlock].filter(Boolean).join('\n\n');
}

/**
 * Heuristically guess which response style a given text most closely matches.
 *
 * Runs all style detectors against the text and returns the style object
 * with the highest confidence score, along with the score.
 *
 * @param {string} text - The response text to analyze.
 * @returns {{ style: object, confidence: number }|null} The best-matching
 *   style and its confidence score (0-1), or null if the text is empty.
 */
function detectStyle(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return null;
  }

  let bestStyle = null;
  let bestScore = -1;

  for (const style of ALL_STYLES) {
    const detectorKey = style.name.toUpperCase().replace(/\s+/g, '_');
    // Map style name to detector key
    const keyMap = {
      CONCISE: 'CONCISE',
      EXPLANATORY: 'EXPLANATORY',
      TUTORIAL: 'TUTORIAL',
      ANALYTICAL: 'ANALYTICAL',
      CONVERSATIONAL: 'CONVERSATIONAL',
      TECHNICAL: 'TECHNICAL',
    };
    const detectorFn = STYLE_DETECTORS[keyMap[style.name.toUpperCase()]];
    if (!detectorFn) continue;

    const score = detectorFn(text);
    if (score > bestScore) {
      bestScore = score;
      bestStyle = style;
    }
  }

  return bestStyle ? { style: bestStyle, confidence: Math.round(bestScore * 100) / 100 } : null;
}

/**
 * Compare two response texts and describe how their styles differ.
 *
 * Returns an object with style detection results for each text, a
 * confidence delta, and a textual summary of the differences.
 *
 * @param {string} textA - First response text.
 * @param {string} textB - Second response text.
 * @returns {{ a: object|null, b: object|null, sameStyle: boolean,
 *   confidenceDelta: number, summary: string }}
 */
function styleDiff(textA, textB) {
  const resultA = detectStyle(textA);
  const resultB = detectStyle(textB);

  const sameStyle = !!(resultA && resultB && resultA.style.name === resultB.style.name);

  const confidenceA = resultA ? resultA.confidence : 0;
  const confidenceB = resultB ? resultB.confidence : 0;

  let summary;
  if (!resultA && !resultB) {
    summary = 'Neither text could be classified with a response style.';
  } else if (!resultA) {
    summary = 'Text A could not be classified. Text B appears ' + resultB.style.name.toLowerCase() + '.';
  } else if (!resultB) {
    summary = 'Text A appears ' + resultA.style.name.toLowerCase() + '. Text B could not be classified.';
  } else if (sameStyle) {
    summary =
      'Both texts appear to be ' +
      resultA.style.name.toLowerCase() +
      ' (A: ' + resultA.confidence + ', B: ' + resultB.confidence + ').';
  } else {
    summary =
      'Text A appears ' +
      resultA.style.name.toLowerCase() +
      ' (' +
      resultA.confidence +
      '), while Text B appears ' +
      resultB.style.name.toLowerCase() +
      ' (' +
      resultB.confidence +
      ').';
  }

  // Additional structural differences
  const metricsA = _computeMetrics(textA);
  const metricsB = _computeMetrics(textB);

  const diffs = [];
  if (Math.abs(metricsA.length - metricsB.length) > 200) {
    diffs.push('significant length difference (' + metricsA.length + ' vs ' + metricsB.length + ' chars)');
  }
  if (Math.abs(metricsA.codeBlocks - metricsB.codeBlocks) > 1) {
    diffs.push('code block count differs (' + metricsA.codeBlocks + ' vs ' + metricsB.codeBlocks + ')');
  }
  if (Math.abs(metricsA.avgSentenceLength - metricsB.avgSentenceLength) > 5) {
    diffs.push(
      'average sentence length differs (' +
        Math.round(metricsA.avgSentenceLength) +
        ' vs ' +
        Math.round(metricsB.avgSentenceLength) +
        ' words)',
    );
  }

  if (diffs.length > 0) {
    summary += ' Additional differences: ' + diffs.join('; ') + '.';
  }

  return {
    a: resultA,
    b: resultB,
    sameStyle,
    confidenceDelta: Math.round((confidenceA - confidenceB) * 100) / 100,
    summary,
  };
}

/**
 * Compute simple text metrics for comparison.
 *
 * @param {string} text
 * @returns {{ length: number, codeBlocks: number, avgSentenceLength: number }}
 */
function _computeMetrics(text) {
  if (!text) return { length: 0, codeBlocks: 0, avgSentenceLength: 0 };

  const codeBlocks = (text.match(/```[\s\S]*?```/g) || []).length;
  const sentences = text.split(/[.!?]+/).filter(Boolean);
  const totalWords = sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).filter(Boolean).length, 0);
  const avgSentenceLength = sentences.length > 0 ? totalWords / sentences.length : 0;

  return {
    length: text.length,
    codeBlocks,
    avgSentenceLength,
  };
}

module.exports = {
  // Pre-built styles
  CONCISE,
  EXPLANATORY,
  TUTORIAL,
  ANALYTICAL,
  CONVERSATIONAL,
  TECHNICAL,
  ALL_STYLES,

  // Core API
  applyStyle,
  detectStyle,
  styleDiff,

  // Helpers
  isValidStyle,
  getStyleByName,
};
