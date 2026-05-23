'use strict';

const { analyzeCodebase, getProjectType, getKeyFiles, getGitStats } = require('./codebase-analyzer');
const { buildProjectContext, selectRelevantFiles, summarizeDirectory } = require('./context-builder');
const {
  analyzeDependencies,
  getOutdatedDependencies,
  detectUnusedDependencies,
  buildDependencyGraph,
  findCircularDependencies,
  getDependencySizes,
} = require('./dependency-analyzer');

module.exports = {
  analyzeCodebase,
  getProjectType,
  getKeyFiles,
  getGitStats,
  buildProjectContext,
  selectRelevantFiles,
  summarizeDirectory,
  analyzeDependencies,
  getOutdatedDependencies,
  detectUnusedDependencies,
  buildDependencyGraph,
  findCircularDependencies,
  getDependencySizes,
};
