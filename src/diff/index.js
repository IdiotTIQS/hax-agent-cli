'use strict';

const {
  mergeFiles,
  detectConflicts,
  resolveConflicts,
  applyMerge,
  STRATEGIES,
  longestCommonSubsequence,
  computeLineDiff,
} = require('./merge-engine');

const {
  diffFiles,
  diffFunctions,
  diffImports,
  diffExports,
  diffStructure,
  parseImports,
  parseExports,
  parseStructure,
} = require('./semantic-diff');

const {
  createPatch,
  applyPatch,
  reversePatch,
  validatePatch,
  combinePatches,
  summarizePatch,
  parsePatch,
  computeHunks,
  coalesceHunks,
} = require('./patch');

module.exports = {
  mergeFiles,
  detectConflicts,
  resolveConflicts,
  applyMerge,
  STRATEGIES,
  longestCommonSubsequence,
  computeLineDiff,
  diffFiles,
  diffFunctions,
  diffImports,
  diffExports,
  diffStructure,
  parseImports,
  parseExports,
  parseStructure,
  createPatch,
  applyPatch,
  reversePatch,
  validatePatch,
  combinePatches,
  summarizePatch,
  parsePatch,
  computeHunks,
  coalesceHunks,
};
