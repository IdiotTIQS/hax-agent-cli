'use strict';

const {
  searchFunctionCalls,
  searchFunctionDefinitions,
  searchVariableReferences,
  searchImports,
  searchClassDefinitions,
  searchPatterns,
  findExcludedRegions,
  isExcluded,
  offsetToPosition,
} = require('./ast-grep');

const { CodeIndex, tokenize, tokenizeSimple, splitIdentifier } = require('./index-builder');

const { QueryParser, tokenizeQuery, splitOr } = require('./query-parser');

const { Ranker } = require('./ranking');

const { ResultsFormatter, extractQueryTerms, highlightMatches } = require('./results-formatter');

module.exports = {
  searchFunctionCalls,
  searchFunctionDefinitions,
  searchVariableReferences,
  searchImports,
  searchClassDefinitions,
  searchPatterns,
  findExcludedRegions,
  isExcluded,
  offsetToPosition,
  CodeIndex,
  tokenize,
  tokenizeSimple,
  splitIdentifier,
  QueryParser,
  tokenizeQuery,
  splitOr,
  Ranker,
  ResultsFormatter,
  extractQueryTerms,
  highlightMatches,
};
