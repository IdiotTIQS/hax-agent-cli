'use strict';

const {
  extractFunctions,
  extractClasses,
  extractExports,
  extractJsDoc,
  getFunctionSignature,
  getDependencies,
} = require('./function-extractor');

const { ImportManager } = require('./import-manager');
const { RefactoringEngine } = require('./refactoring');

module.exports = {
  extractFunctions,
  extractClasses,
  extractExports,
  extractJsDoc,
  getFunctionSignature,
  getDependencies,
  ImportManager,
  RefactoringEngine,
};
