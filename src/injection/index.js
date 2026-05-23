'use strict';

const {
  InjectionDetector,
  THREAT_LEVELS,
  THREAT_LEVEL_NAMES,
  DETECTION_TYPES,
} = require('./detector');

const {
  InjectionMonitor,
  ALERT_SEVERITIES,
  DEFAULT_ALERT_THRESHOLD,
} = require('./monitor');

const {
  InjectionSanitizer,
  SANITIZATION_LEVELS,
  LEVEL_NAMES,
  INSTRUCTION_PATTERNS,
  DANGEROUS_DELIMITERS,
  SAFETY_DELIMITER_START,
  SAFETY_DELIMITER_END,
  resolveLevel,
} = require('./sanitizer');

module.exports = {
  InjectionDetector,
  THREAT_LEVELS,
  THREAT_LEVEL_NAMES,
  DETECTION_TYPES,
  InjectionMonitor,
  ALERT_SEVERITIES,
  DEFAULT_ALERT_THRESHOLD,
  InjectionSanitizer,
  SANITIZATION_LEVELS,
  LEVEL_NAMES,
  INSTRUCTION_PATTERNS,
  DANGEROUS_DELIMITERS,
  SAFETY_DELIMITER_START,
  SAFETY_DELIMITER_END,
  resolveLevel,
};
