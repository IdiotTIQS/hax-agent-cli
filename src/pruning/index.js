'use strict';

const { PruningEvaluator } = require('./evaluator');
const { ContextPruner, classifyMessageDomains, DOMAIN_PATTERNS } = require('./strategies');

module.exports = {
  PruningEvaluator,
  ContextPruner,
  classifyMessageDomains,
  DOMAIN_PATTERNS,
};
