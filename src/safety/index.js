'use strict';

const {
  SafetyAuditor,
  SAFETY_CATEGORIES,
  SEVERITY_WEIGHTS: AUDITOR_SEVERITY_WEIGHTS,
  createFinding,
} = require('./auditor');

const {
  SafeExecutor,
  SafeExecutionError,
  PreValidationError,
  PostValidationError,
  ResourceLimitError,
  TOOL_RISK_LEVELS,
  SENSITIVE_PATH_PATTERNS,
  SUSPICIOUS_SHELL_PATTERNS,
  DEFAULT_RESOURCE_LIMITS,
  classifyToolCategories,
  checkSensitivePath,
  checkSuspiciousShell,
  estimateOutputSize,
  createExecutionRecord,
} = require('./executor');

const {
  RedactionEngine,
  REDACTION_TYPES,
  DEFAULT_PLACEHOLDER_TEMPLATE,
  createDefaultPatterns,
  buildPlaceholder,
  luhnCheck,
  escapeRegExp: escapeRx,
} = require('./redaction');

const {
  RulesEngine,
  createDefaultRules,
  computeRiskScore,
  SEVERITY_LEVELS,
  CATEGORIES,
} = require('./rules-engine');

const {
  ContentScanner,
  VIOLATION_TYPES,
  SEVERITY_ORDER,
  normalizeViolation,
  toStringSafe,
  truncateEvidence,
} = require('./scanner');

module.exports = {
  SafetyAuditor,
  SAFETY_CATEGORIES,
  AUDITOR_SEVERITY_WEIGHTS,
  createFinding,
  SafeExecutor,
  SafeExecutionError,
  PreValidationError,
  PostValidationError,
  ResourceLimitError,
  TOOL_RISK_LEVELS,
  SENSITIVE_PATH_PATTERNS,
  SUSPICIOUS_SHELL_PATTERNS,
  DEFAULT_RESOURCE_LIMITS,
  classifyToolCategories,
  checkSensitivePath,
  checkSuspiciousShell,
  estimateOutputSize,
  createExecutionRecord,
  RedactionEngine,
  REDACTION_TYPES,
  DEFAULT_PLACEHOLDER_TEMPLATE,
  createDefaultPatterns,
  buildPlaceholder,
  luhnCheck,
  escapeRx,
  RulesEngine,
  createDefaultRules,
  computeRiskScore,
  SEVERITY_LEVELS,
  CATEGORIES,
  ContentScanner,
  VIOLATION_TYPES,
  SEVERITY_ORDER,
  normalizeViolation,
  toStringSafe,
  truncateEvidence,
};
