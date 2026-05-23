'use strict';

const {
  AnomalyDetector,
  SEVERITY_LEVELS,
  RETRY_THRESHOLD,
  TOKEN_SPIKE_FACTOR,
  SILENCE_GAP_MINUTES,
  TOPIC_SHIFT_RATIO,
  AGGRESSIVE_TOOL_LIMIT,
  NORMAL_BIGRAMS,
  AGGRESSIVE_TOOLS,
} = require('./anomaly-detector');

const { analyzeSession, analyzeSessions, getUsageTrends } = require('./conversation-stats');

const {
  ConversationPredictor,
  CONFIDENCE_WEIGHTS,
  SUCCESS_THRESHOLD,
  FAILURE_THRESHOLD,
  KNOWN_TOOLS,
  TOOL_TRANSITIONS,
} = require('./predictor');

const {
  generateSessionReport,
  generateWeeklyReport,
  generateTeamReport,
  generateSummaryCard,
} = require('./report-generator');

const {
  getToolUsageStats,
  getMostUsedTools,
  getErrorProneTools,
  getToolSequencePatterns,
  getToolUsageTimeline,
} = require('./tool-insights');

module.exports = {
  AnomalyDetector,
  SEVERITY_LEVELS,
  RETRY_THRESHOLD,
  TOKEN_SPIKE_FACTOR,
  SILENCE_GAP_MINUTES,
  TOPIC_SHIFT_RATIO,
  AGGRESSIVE_TOOL_LIMIT,
  NORMAL_BIGRAMS,
  AGGRESSIVE_TOOLS,
  analyzeSession,
  analyzeSessions,
  getUsageTrends,
  ConversationPredictor,
  CONFIDENCE_WEIGHTS,
  SUCCESS_THRESHOLD,
  FAILURE_THRESHOLD,
  KNOWN_TOOLS,
  TOOL_TRANSITIONS,
  generateSessionReport,
  generateWeeklyReport,
  generateTeamReport,
  generateSummaryCard,
  getToolUsageStats,
  getMostUsedTools,
  getErrorProneTools,
  getToolSequencePatterns,
  getToolUsageTimeline,
};
