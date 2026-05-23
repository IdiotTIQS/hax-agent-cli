'use strict';

const {
  CodeExtractor,
  extractCodeBlocks,
  extractFileChanges,
  extractCommands,
  extractPatches,
  organizeByFile,
  generateScript,
} = require('./code-extractor');

const {
  KnowledgeExtractor,
  extractFacts,
  extractHowTo,
  extractConfigurations,
  extractBestPractices,
  extractGotchas,
  generateCheatsheet,
} = require('./knowledge-extractor');

module.exports = {
  CodeExtractor,
  extractCodeBlocks,
  extractFileChanges,
  extractCommands,
  extractPatches,
  organizeByFile,
  generateScript,
  KnowledgeExtractor,
  extractFacts,
  extractHowTo,
  extractConfigurations,
  extractBestPractices,
  extractGotchas,
  generateCheatsheet,
};
