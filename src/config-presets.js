"use strict";

/**
 * Built-in configuration presets for common usage scenarios.
 * Each preset is a partial settings object that can be merged with user config.
 */

const { mergeSettings } = require('./config');

const PRESETS = Object.freeze({
  /** Fast, lightweight coding sessions with minimal overhead */
  coding: {
    agent: {
      maxTurns: 25,
      maxToolTurns: 25,
    },
    context: {
      autoCompact: true,
      autoCompactThresholdTokens: 0.8,
    },
    tools: {
      shell: { enabled: true, timeoutMs: 30_000 },
    },
  },

  /** Long-running autonomous agent tasks */
  autonomous: {
    agent: {
      maxTurns: 100,
      maxToolTurns: 100,
    },
    permissions: {
      mode: 'auto',
    },
    context: {
      autoCompact: true,
      autoCompactThresholdTokens: 0.75,
    },
    memory: {
      enabled: true,
    },
  },

  /** Safe, read-only code review and analysis */
  review: {
    agent: {
      maxTurns: 10,
      maxToolTurns: 10,
    },
    tools: {
      shell: { enabled: false },
    },
    permissions: {
      mode: 'ask',
    },
  },

  /** Quick Q&A without file modifications */
  chat: {
    agent: {
      maxTurns: 5,
      maxToolTurns: 5,
    },
    tools: {
      shell: { enabled: false },
    },
    permissions: {
      mode: 'ask',
    },
  },

  /** CI/CD pipeline integration — no interactivity */
  ci: {
    permissions: {
      mode: 'yolo',
    },
    context: {
      autoCompact: true,
      autoCompactThresholdTokens: 0.85,
    },
    tools: {
      shell: { enabled: true, timeoutMs: 60_000 },
    },
  },

  /** Learning/education mode with explanations */
  learn: {
    agent: {
      maxTurns: 15,
      maxToolTurns: 15,
      systemPrompt: 'Explain your reasoning step by step. Be thorough and educational.',
    },
    permissions: {
      mode: 'ask',
    },
    context: {
      autoCompact: false,
    },
  },
});

/**
 * Get a preset by name. Returns a shallow copy so callers can modify it.
 */
function getPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return null;
  return JSON.parse(JSON.stringify(preset));
}

/**
 * List all available preset names with descriptions.
 */
function listPresets() {
  const descriptions = {
    coding: 'Fast coding sessions with auto-compaction',
    autonomous: 'Long-running autonomous agent tasks',
    review: 'Safe, read-only code review',
    chat: 'Quick Q&A without file modifications',
    ci: 'CI/CD pipeline — no interactivity',
    learn: 'Educational mode with detailed explanations',
  };

  return Object.keys(PRESETS).map((name) => ({
    name,
    description: descriptions[name] || name,
  }));
}

/**
 * Merge a preset into existing settings. Preset values take precedence.
 * Uses the canonical mergeSettings from config.js instead of a local deep-merge.
 */
function applyPreset(settings, presetName) {
  const preset = getPreset(presetName);
  if (!preset) return settings;
  return mergeSettings(settings, preset);
}

module.exports = { PRESETS, getPreset, listPresets, applyPreset };
