'use strict';

/**
 * Shared utilities — barrel module.
 *
 * Re-exports everything from the three consolidated modules so consumers
 * only need a single `require('../../shared')`:
 *
 *   const { deepClone, clamp, sha256 } = require('../shared');
 */

const { deepClone } = require('./deep-clone');
const {
  clamp,
  requireArray,
  requireEnum,
  requireNumber,
  requireObject,
  requireString,
} = require('./validation');
const {
  contentHash,
  fingerprint,
  md5,
  sha256,
} = require('./hash');
const {
  serializeProvider,
  serializeError,
  serializeSkill,
  serializeProviderIssue,
  isTerminalToolLimitReason,
} = require('./serialization');

module.exports = {
  // deep-clone
  deepClone,

  // validation
  clamp,
  requireArray,
  requireEnum,
  requireNumber,
  requireObject,
  requireString,

  // hash
  contentHash,
  fingerprint,
  md5,
  sha256,

  // serialization
  serializeProvider,
  serializeError,
  serializeSkill,
  serializeProviderIssue,
  isTerminalToolLimitReason,
};
