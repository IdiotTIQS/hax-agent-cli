'use strict';

const {
  sanitizeFilePath,
  sanitizeShellArg,
  sanitizeHtmlContent,
  sanitizeJsonString,
  validateUrl,
  validateEmail,
  redactSecrets,
  getDefaultSecretPatterns,
  isPrivateHost,
  isPrivateIPv4,
  ALLOWED_PROTOCOLS,
  BLOCKED_PROTOCOLS,
} = require('./input-sanitizer');

const {
  AuditLogger,
  SEVERITY_LEVELS: AUDIT_SEVERITY_LEVELS,
  ENTRY_TYPES,
  computeEntryHash,
} = require('./audit-log');

const {
  createWebFetchPolicy,
  createShellPolicy,
  createFilePolicy,
  evaluateWebFetch,
  evaluateShell,
  evaluateFile,
  PolicyEngine,
  evaluateToolCall,
  checkPathAccess,
  checkExtension,
} = require('./content-policy');

module.exports = {
  sanitizeFilePath,
  sanitizeShellArg,
  sanitizeHtmlContent,
  sanitizeJsonString,
  validateUrl,
  validateEmail,
  redactSecrets,
  getDefaultSecretPatterns,
  isPrivateHost,
  isPrivateIPv4,
  ALLOWED_PROTOCOLS,
  BLOCKED_PROTOCOLS,
  AuditLogger,
  AUDIT_SEVERITY_LEVELS,
  ENTRY_TYPES,
  computeEntryHash,
  createWebFetchPolicy,
  createShellPolicy,
  createFilePolicy,
  evaluateWebFetch,
  evaluateShell,
  evaluateFile,
  PolicyEngine,
  evaluateToolCall,
  checkPathAccess,
  checkExtension,
};
